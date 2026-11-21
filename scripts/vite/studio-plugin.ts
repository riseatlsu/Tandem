/**
 * Dev-server-only API for Tandem Studio (the content editor at ?editor). Never part of a build.
 *   GET  /__studio/models          → every model/URDF file under public/models
 *   GET  /__studio/file?path=…     → read a content JSON / solution file
 *   POST /__studio/save {path, content} → write one whitelisted file
 *   GET  /__studio/codes/status    → is a service-account key set up (project + account only; the key never leaves this process)
 *   POST /__studio/codes/key {content} / POST /codes/key/remove → store / delete keys/service-account.json (gitignored)
 *   GET  /__studio/codes/list?experiment=…  → codes already issued
 *   POST /__studio/codes/generate {experiment, perCondition, siteUrl} → create codes in Firestore, also saved to exports/codes/*.csv
 * Requests must carry `X-Tandem-Studio: 1` (a custom header, so other sites can't post here without a CORS preflight, which this server never grants).
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { KEY_DIR, KEY_FILE, adminDb, defaultSiteUrl, findKey, generateCodes, listCodes, parseKey, toCsv } from '../lib/codes';

const ROOT = process.cwd();
const WRITABLE = [/^content\/(arms|scenes|tasks|experiments)\/[a-z0-9][a-z0-9-]*\.json$/, /^tests\/fixtures\/solutions\/[a-z0-9][a-z0-9-]*\.js$/];
const READABLE = [...WRITABLE];
const MODEL_EXT = /\.(glb|gltf|obj|stl|dae|urdf)$/i;

export function safe(p: string, rules: RegExp[] = WRITABLE) {
  const norm = p.replace(/\\/g, '/');
  if (norm.includes('..') || !rules.some((r) => r.test(norm))) return null;
  const abs = resolve(ROOT, norm);
  return abs.startsWith(ROOT + sep) ? abs : null;
}
function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (MODEL_EXT.test(f)) out.push(relative(join(ROOT, 'public'), p).split(sep).join('/'));
  }
  return out;
}
function codesStatus() {
  let expectedProject = '';
  try { expectedProject = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8')).projects?.prod ?? ''; } catch { /* none */ }
  const base = { expectedProject, siteUrl: defaultSiteUrl(ROOT) };
  if (process.env.FIRESTORE_EMULATOR_HOST) return { ...base, mode: 'emulator' as const, projectId: 'demo-tandem', account: null, keyFile: null, removable: false };
  const k = findKey(ROOT);
  return k ? { ...base, mode: 'live' as const, projectId: k.key.project_id, account: k.key.client_email, keyFile: k.shown, removable: k.shown === KEY_FILE }
    : { ...base, mode: 'none' as const, projectId: null, account: null, keyFile: null, removable: false };
}
function readExperiment(id: unknown) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Bad experiment id');
  const p = join(ROOT, 'content', 'experiments', `${id}.json`);
  if (!existsSync(p)) throw new Error(`Save the experiment first (content/experiments/${id}.json does not exist yet).`);
  return JSON.parse(readFileSync(p, 'utf8'));
}
async function db() {
  const c = await adminDb(ROOT);
  if (!c) throw new Error('No service-account key yet. Add one under Participant codes.');
  return c;
}
const send = (res: ServerResponse, code: number, body: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const body = (req: IncomingMessage) => new Promise<string>((r, j) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 5e6) j(new Error('too large')); }); req.on('end', () => r(b)); });

async function codesRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
  const p = url.pathname, post = req.method === 'POST';
  if (!post && p === '/codes/status') return send(res, 200, codesStatus());
  if (post && p === '/codes/key') {
    const { content } = JSON.parse(await body(req)) as { content: string };
    parseKey(String(content)); // throws a readable error for the wrong file
    mkdirSync(join(ROOT, KEY_DIR), { recursive: true });
    writeFileSync(join(ROOT, KEY_FILE), content, { mode: 0o600 });
    return send(res, 200, codesStatus());
  }
  if (post && p === '/codes/key/remove') { rmSync(join(ROOT, KEY_FILE), { force: true }); return send(res, 200, codesStatus()); }
  if (!post && p === '/codes/list') {
    const exp = readExperiment(url.searchParams.get('experiment'));
    const c = await db();
    return send(res, 200, { projectId: c.projectId, rows: await listCodes(c.db, exp.id, url.searchParams.get('siteUrl') ?? defaultSiteUrl(ROOT)) });
  }
  if (post && p === '/codes/generate') {
    const { experiment, perCondition, siteUrl } = JSON.parse(await body(req)) as { experiment: string; perCondition: number; siteUrl?: string };
    const exp = readExperiment(experiment);
    const c = await db();
    const rows = await generateCodes(c.db, exp, Number(perCondition), siteUrl ?? defaultSiteUrl(ROOT));
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 18); // ms, so quick batches never overwrite
    const csvPath = `exports/codes/${exp.id}-v${exp.version}-${stamp}${c.mode === 'emulator' ? '-emulator' : ''}.csv`;
    mkdirSync(join(ROOT, 'exports', 'codes'), { recursive: true });
    writeFileSync(join(ROOT, csvPath), toCsv(rows));
    return send(res, 200, { projectId: c.projectId, mode: c.mode, rows, csvPath });
  }
  send(res, 404, { error: 'unknown codes endpoint' });
}

export function studioPlugin() {
  return {
    name: 'tandem-studio',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use(path: string, fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void } }) {
      server.middlewares.use('/__studio', async (req, res) => {
        try {
          if (req.headers['x-tandem-studio'] !== '1') return send(res, 403, { error: 'missing studio header' });
          const url = new URL(req.url ?? '/', 'http://x');
          if (req.method === 'GET' && url.pathname === '/models') return send(res, 200, { files: walk(join(ROOT, 'public', 'models')).sort() });
          if (req.method === 'GET' && url.pathname === '/file') {
            const abs = safe(url.searchParams.get('path') ?? '', READABLE);
            if (!abs) return send(res, 400, { error: 'path not allowed' });
            return send(res, 200, { exists: existsSync(abs), content: existsSync(abs) ? readFileSync(abs, 'utf8') : null });
          }
          if (req.method === 'POST' && url.pathname === '/save') {
            const { path, content } = JSON.parse(await body(req)) as { path: string; content: string };
            const abs = safe(path, WRITABLE);
            if (!abs || typeof content !== 'string') return send(res, 400, { error: `Not allowed to write ${path}` });
            if (path.endsWith('.json')) JSON.parse(content); // never write broken JSON
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, content.endsWith('\n') ? content : content + '\n');
            return send(res, 200, { ok: true, path });
          }
          if (url.pathname.startsWith('/codes/')) return await codesRoute(req, res, url);
          send(res, 404, { error: 'unknown studio endpoint' });
        } catch (e) { send(res, 500, { error: (e as Error).message }); }
      });
    },
  };
}
