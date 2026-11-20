/**
 * Tandem backend — two HTTPS functions:
 *  - llmProxy:   thin, streaming, OpenAI-compatible proxy. Holds the API key; enforces auth, model allowlist / study
 *                model lock, per-user + per-IP + global quotas and a kill switch. Never logs prompt content.
 *  - redeemCode: binds a study participant code to the caller's anonymous uid and returns the session (+ checkpoint).
 */
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { cors, fail, verify } from './http.js';
import { getConfig } from './config.js';
import { addTokens, checkAndCount } from './quota.js';

initializeApp();
const db = getFirestore();
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const MAX_BODY = 256 * 1024;
const opts = { region: process.env.FUNCTION_REGION ?? 'us-central1', secrets: [OPENAI_API_KEY], timeoutSeconds: 180, memory: '256MiB' as const, concurrency: 40 };

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0] : req.ip ?? '').trim();
}
const ipHash = (ip: string) => createHash('sha256').update(`${process.env.IP_SALT ?? 'tandem'}:${ip}`).digest('hex').slice(0, 24);

export async function handleLlm(req: Request, res: Response, apiKey: string) {
  if (cors(req, res)) return;
  const cfg = await getConfig(db);
  if (req.method === 'GET' && req.path.endsWith('/config')) { res.json({ enabled: cfg.enabled, demoModels: cfg.demoModels }); return; }
  if (req.method !== 'POST' || !req.path.endsWith('/chat/completions')) return void fail(res, 404, 'not_found');
  if ((req.rawBody?.length ?? 0) > MAX_BODY) return void fail(res, 413, 'too_large');
  const uid = await verify(req);
  if (!uid) return void fail(res, 401, 'unauthenticated');
  if (!cfg.enabled) return void fail(res, 503, 'disabled');

  const body = { ...(req.body ?? {}) } as Record<string, unknown>;
  const part = await db.doc(`participants/${uid}`).get();
  const study = part.exists ? part.data()! : null;
  let keys: string[];
  if (study) {
    if (study.agentMode === 'off') return void fail(res, 403, 'agent_off');
    body.model = study.model ?? cfg.demoModels[0];
    const quota = await checkAndCount(db, [{ key: `uid:${uid}`, ...cfg.limits.study }]);
    if (quota) return void fail(res, 429, 'quota', { scope: quota });
    keys = [`uid:${uid}`];
  } else {
    if (typeof body.model !== 'string' || !cfg.demoModels.includes(body.model)) return void fail(res, 400, 'model_not_allowed', { allowed: cfg.demoModels });
    const ip = `ip:${ipHash(clientIp(req))}`;
    const quota = await checkAndCount(db, [
      { key: `uid:${uid}`, ...cfg.limits.demo },
      { key: ip, ...cfg.limits.demo },
      { key: 'demo:global', requests: Number.MAX_SAFE_INTEGER, tokens: cfg.demoDailyTokenBudget },
    ]);
    if (quota) return void fail(res, 429, 'quota', { scope: quota });
    keys = [`uid:${uid}`, ip, 'demo:global'];
  }
  delete body.user; delete body.metadata; delete body.store; delete body.n;
  body.stream = true;
  body.stream_options = { include_usage: true };
  const cap = cfg.maxOutputTokens;
  for (const k of ['max_tokens', 'max_completion_tokens']) if (typeof body[k] !== 'number' || (body[k] as number) > cap) body[k] = undefined;
  body.max_completion_tokens = Math.min(Number(body.max_completion_tokens ?? cap), cap);
  delete body.max_tokens;

  const upstream = await fetch(process.env.LLM_UPSTREAM_URL ?? 'https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body),
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    res.status(upstream.status === 429 ? 503 : upstream.status).type('application/json').send(text || JSON.stringify({ error: 'upstream_error' }));
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('data:') && line.includes('"usage"')) {
        try { const j = JSON.parse(line.slice(5)); if (j.usage) usage = j.usage; } catch { /* partial */ }
      }
    }
  }
  res.end();
  if (usage) await addTokens(db, keys, usage).catch(() => undefined);
}

export async function handleRedeem(req: Request, res: Response) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return void fail(res, 405, 'method');
  const uid = await verify(req);
  if (!uid) return void fail(res, 401, 'unauthenticated');
  const code = String((req.body ?? {}).code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) return void fail(res, 400, 'bad_code');
  const result = await db.runTransaction(async (tx) => {
    const cref = db.doc(`codes/${code}`);
    const c = await tx.get(cref);
    if (!c.exists || c.data()!.active === false) return null;
    const cd = c.data()!;
    const sessionId = `s_${code}`;
    const sref = db.doc(`sessions/${sessionId}`);
    const s = await tx.get(sref);
    const rebound = !!cd.boundUid && cd.boundUid !== uid;
    if (rebound) tx.delete(db.doc(`participants/${cd.boundUid}`));
    tx.set(db.doc(`participants/${uid}`), { code, experimentId: cd.experimentId, condition: cd.condition, orderIndex: cd.orderIndex ?? 0, model: cd.model ?? null, agentMode: cd.agentMode ?? 'suggest', boundAt: FieldValue.serverTimestamp() });
    tx.set(cref, { boundUid: uid, firstUsedAt: cd.firstUsedAt ?? FieldValue.serverTimestamp() }, { merge: true });
    if (!s.exists) tx.set(sref, { code, uid, experimentId: cd.experimentId, condition: cd.condition, orderIndex: cd.orderIndex ?? 0, startedAt: FieldValue.serverTimestamp() });
    else tx.update(sref, { uid, ...(rebound ? { reboundAt: FieldValue.serverTimestamp() } : {}) });
    return { sessionId, experimentId: cd.experimentId, condition: cd.condition, orderIndex: cd.orderIndex ?? 0, rebound };
  });
  if (!result) return void fail(res, 404, 'unknown_code');
  const cp = await db.doc(`sessions/${result.sessionId}/checkpoint/current`).get();
  res.json({ ...result, checkpoint: cp.exists ? (cp.data()!.data as string) : null });
}

export const llmProxy = onRequest(opts, (req, res) => handleLlm(req, res as unknown as Response, OPENAI_API_KEY.value()));
export const redeemCode = onRequest({ ...opts, secrets: [] }, (req, res) => handleRedeem(req, res as unknown as Response));
