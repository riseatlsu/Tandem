/**
 * Participant codes, shared by `scripts/gen-codes.ts` (CLI) and Tandem Studio (scripts/vite/studio-plugin.ts).
 * A code doc (codes/{CODE}) fixes the experiment, condition, counterbalancing orderIndex, locked model and AI mode.
 * Service-account keys live in `keys/` (gitignored) or GOOGLE_APPLICATION_CREDENTIALS; they never reach the browser.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';

export const KEY_DIR = 'keys';
export const KEY_FILE = `${KEY_DIR}/service-account.json`;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const newCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + ALPHA[randomInt(ALPHA.length)]).join('');

type Exp = { id: string; version: string; conditions: Record<string, { agent: { mode: string; model?: string } }> };
export interface CodeRow { code: string; link: string; condition: string; orderIndex: number; model: string | null; agentMode: string; status?: 'unused' | 'started' | 'inactive'; firstUsedAt?: string | null }

export interface ServiceKey { project_id: string; client_email: string; private_key: string }
/** Parse and sanity-check a service-account JSON. Throws a readable error. */
export function parseKey(text: string): ServiceKey {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); } catch { throw new Error('That file is not JSON. Use the key file Firebase downloads (Project settings > Service accounts > Generate new private key).'); }
  if (j.type !== 'service_account' || typeof j.project_id !== 'string' || typeof j.client_email !== 'string' || typeof j.private_key !== 'string')
    throw new Error('That JSON is not a service-account key (it needs type "service_account", project_id, client_email and private_key).');
  return j as unknown as ServiceKey;
}
/** Where the key is: $GOOGLE_APPLICATION_CREDENTIALS, else keys/service-account.json, else the first service-account JSON in keys/. */
export function findKey(root = process.cwd()): { path: string; shown: string; key: ServiceKey } | null {
  const env = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const candidates = env ? [resolve(env.replace(/^~(?=\/)/, process.env.HOME ?? '~'))] : [];
  const dir = join(root, KEY_DIR);
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => (a === 'service-account.json' ? -1 : b === 'service-account.json' ? 1 : a.localeCompare(b)));
    candidates.push(...files.map((f) => join(dir, f)));
  }
  for (const p of candidates) {
    try { return { path: p, shown: env && p === candidates[0] ? 'GOOGLE_APPLICATION_CREDENTIALS' : relative(root, p), key: parseKey(readFileSync(p, 'utf8')) }; } catch { /* try the next one */ }
  }
  return null;
}

/** GitHub Pages address from the origin remote, e.g. https://owner.github.io/Repo/ ('' if unknown). */
export function defaultSiteUrl(root = process.cwd()): string {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}/` : '';
  } catch { return ''; }
}
export const linkFor = (siteUrl: string, code: string) => (siteUrl ? `${siteUrl.replace(/\/?$/, '/')}?code=${code}` : `?code=${code}`);

/** Plan `per` new codes per condition. `nextIndex` continues each condition's orderIndex so later batches keep counterbalancing even. */
export function planCodes(exp: Exp, per: number, siteUrl: string, nextIndex: Record<string, number> = {}, taken: Set<string> = new Set()): CodeRow[] {
  const rows: CodeRow[] = [];
  for (const [condition, c] of Object.entries(exp.conditions)) {
    for (let i = 0; i < per; i++) {
      let code = newCode();
      while (taken.has(code)) code = newCode();
      taken.add(code);
      rows.push({ code, link: linkFor(siteUrl, code), condition, orderIndex: (nextIndex[condition] ?? 0) + i, model: c.agent.model ?? null, agentMode: c.agent.mode });
    }
  }
  return rows;
}

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows: CodeRow[]): string {
  const withStatus = rows.some((r) => r.status);
  const head = ['code', 'link', 'condition', 'orderIndex', 'model', 'agentMode', ...(withStatus ? ['status', 'firstUsedAt'] : [])];
  return [head.join(','), ...rows.map((r) => [r.code, r.link, r.condition, r.orderIndex, r.model ?? '', r.agentMode, ...(withStatus ? [r.status, r.firstUsedAt ?? ''] : [])].map(cell).join(','))].join('\n') + '\n';
}

/** Every code already issued for an experiment, oldest order first. */
export async function listCodes(db: Firestore, expId: string, siteUrl: string): Promise<CodeRow[]> {
  const snap = await db.collection('codes').where('experimentId', '==', expId).get();
  const ts = (v: unknown) => (v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate().toISOString() : null);
  return snap.docs.map((d) => {
    const x = d.data();
    return { code: d.id, link: linkFor(siteUrl, d.id), condition: x.condition, orderIndex: x.orderIndex ?? 0, model: x.model ?? null, agentMode: x.agentMode ?? '', status: x.active === false ? 'inactive' as const : x.boundUid ? 'started' as const : 'unused' as const, firstUsedAt: ts(x.firstUsedAt) };
  }).sort((a, b) => a.condition.localeCompare(b.condition) || a.orderIndex - b.orderIndex);
}

/** Create `per` codes per condition in Firestore (never overwrites an existing code) and return them. */
export async function generateCodes(db: Firestore, exp: Exp, per: number, siteUrl: string): Promise<CodeRow[]> {
  if (!Number.isInteger(per) || per < 1 || per > 500) throw new Error('Codes per condition must be a whole number from 1 to 500.');
  const existing = await listCodes(db, exp.id, siteUrl);
  const next: Record<string, number> = {};
  for (const r of existing) next[r.condition] = Math.max(next[r.condition] ?? 0, r.orderIndex + 1);
  const rows = planCodes(exp, per, siteUrl, next, new Set(existing.map((r) => r.code)));
  const { FieldValue } = await import('firebase-admin/firestore');
  for (let i = 0; i < rows.length; i += 400) { // Firestore allows 500 writes per batch
    const batch = db.batch();
    for (const r of rows.slice(i, i + 400)) batch.create(db.doc(`codes/${r.code}`), { experimentId: exp.id, experimentVersion: exp.version, condition: r.condition, orderIndex: r.orderIndex, model: r.model, agentMode: r.agentMode, active: true, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  return rows;
}

/** A Firestore handle for Studio/CLI: the emulator when FIRESTORE_EMULATOR_HOST is set, otherwise the service-account key. */
export async function adminDb(root = process.cwd()): Promise<{ db: Firestore; projectId: string; mode: 'emulator' | 'live' } | null> {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const name = 'tandem-codes-emulator';
    const app = getApps().find((a) => a.name === name) ?? initializeApp({ projectId: 'demo-tandem' }, name);
    return { db: getFirestore(app), projectId: 'demo-tandem', mode: 'emulator' };
  }
  const found = findKey(root);
  if (!found) return null;
  const name = `tandem-codes-${createHash('sha256').update(found.key.private_key).digest('hex').slice(0, 12)}`; // new key → new app
  const app = getApps().find((a) => a.name === name)
    ?? initializeApp({ credential: cert({ projectId: found.key.project_id, clientEmail: found.key.client_email, privateKey: found.key.private_key }), projectId: found.key.project_id }, name);
  return { db: getFirestore(app), projectId: found.key.project_id, mode: 'live' };
}
