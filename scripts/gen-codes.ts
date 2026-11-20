/**
 * Create participant codes for an experiment.
 *   npx tsx scripts/gen-codes.ts --experiment pilot --per-condition 10 [--project my-proj] [--emulator] [--dry-run]
 * Writes codes/{CODE} docs (condition, counterbalancing orderIndex, locked model, agent mode) and prints a CSV.
 * Auth: GOOGLE_APPLICATION_CREDENTIALS (service account) or `--emulator` (FIRESTORE_EMULATOR_HOST=127.0.0.1:8080).
 */
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k: string) => args.includes(`--${k}`);
const expId = opt('experiment');
if (!expId) { console.error('Usage: gen-codes --experiment <id> [--per-condition N] [--project id] [--emulator] [--dry-run]'); process.exit(1); }
const exp = JSON.parse(readFileSync(`content/experiments/${expId}.json`, 'utf8'));
const per = Number(opt('per-condition', '10'));
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + ALPHA[randomInt(ALPHA.length)]).join('');

const rows: { code: string; condition: string; orderIndex: number; model: string | null; agentMode: string }[] = [];
for (const [condition, c] of Object.entries<{ agent: { mode: string; model?: string }; taskSequence: string[] }>(exp.conditions)) {
  for (let i = 0; i < per; i++) rows.push({ code: code(), condition, orderIndex: i, model: c.agent.model ?? null, agentMode: c.agent.mode });
}
console.log('code,condition,orderIndex,model,agentMode');
for (const r of rows) console.log([r.code, r.condition, r.orderIndex, r.model ?? '', r.agentMode].join(','));

if (!flag('dry-run')) {
  if (flag('emulator')) process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: opt('project', flag('emulator') ? 'demo-tandem' : undefined) });
  const db = getFirestore();
  const batch = db.batch();
  for (const r of rows) batch.set(db.doc(`codes/${r.code}`), { experimentId: exp.id, experimentVersion: exp.version, condition: r.condition, orderIndex: r.orderIndex, model: r.model, agentMode: r.agentMode, active: true, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  console.error(`✓ wrote ${rows.length} codes for ${exp.id}`);
}
