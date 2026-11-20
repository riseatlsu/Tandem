/**
 * Runs inside `firebase emulators:exec` (see package.json "test"). Starts the mock LLM upstream on :8787.
 * Covers SPEC §20.1 checks 9–11: auth, model allowlist/lock, quotas, kill switch, and security rules.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-tandem';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const MOCK = 'http://127.0.0.1:8787';
initializeApp({ projectId: PROJECT });
const db = getFirestore();
let mock: ChildProcess;

async function anonToken(): Promise<{ token: string; uid: string }> {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', body: JSON.stringify({ returnSecureToken: true }), headers: { 'Content-Type': 'application/json' } });
  const j = await r.json() as { idToken: string; localId: string };
  return { token: j.idToken, uid: j.localId };
}
const chat = (token: string | null, model: string, origin = 'http://localhost:5173') => fetch(`${FN}/llmProxy/v1/chat/completions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { 'X-Firebase-Token': token } : {}) },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hello' }], stream: true }),
});
const redeem = (token: string, code: string) => fetch(`${FN}/redeemCode`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-Token': token }, body: JSON.stringify({ code }) });
async function clearUsage() { const s = await db.collection('usage').get(); await Promise.all(s.docs.map((d) => d.ref.delete())); }

beforeAll(async () => {
  mock = spawn('npx', ['tsx', '../tests/fixtures/mock-llm/server.ts'], { stdio: 'ignore', env: { ...process.env, MOCK_LLM_PORT: '8787' } });
  for (let i = 0; i < 60; i++) { try { await fetch(`${MOCK}/__reset`, { method: 'POST' }); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  await db.doc('codes/TEST-0001').set({ experimentId: 'pilot', condition: 'suggest', orderIndex: 0, model: 'gpt-5-mini', agentMode: 'suggest', active: true });
  await db.doc('codes/TEST-OFF1').set({ experimentId: 'pilot', condition: 'off', orderIndex: 0, agentMode: 'off', active: true });
});
afterAll(() => { mock?.kill(); });
beforeEach(async () => {
  await db.doc('config/llm').set({ enabled: true, demoModels: ['gpt-5-mini'], limits: { demo: { requests: 50, tokens: 1e9 }, study: { requests: 50, tokens: 1e9 } }, demoDailyTokenBudget: 1e9, maxOutputTokens: 1000 });
  await clearUsage();
  await fetch(`${MOCK}/__reset`, { method: 'POST' });
});

describe('llmProxy', () => {
  it('rejects requests without a token (401)', async () => {
    expect((await chat(null, 'gpt-5-mini')).status).toBe(401);
  });
  it('rejects non-allowlisted models in demo mode (400)', async () => {
    const { token } = await anonToken();
    expect((await chat(token, 'gpt-4o-super')).status).toBe(400);
  });
  it('streams for an allowlisted demo model', async () => {
    const { token } = await anonToken();
    const r = await chat(token, 'gpt-5-mini');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    expect(await r.text()).toContain('[DONE]');
  });
  it('locks study participants to the condition model', async () => {
    const { token } = await anonToken();
    expect((await redeem(token, 'TEST-0001')).status).toBe(200);
    const r = await chat(token, 'some-other-model');
    expect(r.status).toBe(200); await r.text();
    const reqs = await (await fetch(`${MOCK}/__requests`)).json() as { model: string }[];
    expect(reqs.at(-1)!.model).toBe('gpt-5-mini');
  });
  it('rejects participants whose condition has the agent off (403)', async () => {
    const { token } = await anonToken();
    await redeem(token, 'TEST-OFF1');
    expect((await chat(token, 'gpt-5-mini')).status).toBe(403);
  });
  it('enforces the per-uid demo cap (429)', async () => {
    await db.doc('config/llm').set({ limits: { demo: { requests: 2, tokens: 1e9 }, study: { requests: 50, tokens: 1e9 } } }, { merge: true });
    const { token } = await anonToken();
    for (let i = 0; i < 2; i++) { const r = await chat(token, 'gpt-5-mini'); expect(r.status).toBe(200); await r.text(); }
    expect((await chat(token, 'gpt-5-mini')).status).toBe(429);
  });
  it('enforces the global demo token budget for fresh users (429)', async () => {
    await db.doc('config/llm').set({ demoDailyTokenBudget: 100 }, { merge: true });
    const a = await anonToken();
    const r = await chat(a.token, 'gpt-5-mini'); await r.text(); // mock reports 120 tokens
    await new Promise((res) => setTimeout(res, 300));
    const b = await anonToken();
    const r2 = await chat(b.token, 'gpt-5-mini');
    expect(r2.status).toBe(429);
    expect(((await r2.json()) as { scope: string }).scope).toBe('demo:global');
  });
  it('honours the kill switch (503)', async () => {
    await db.doc('config/llm').set({ enabled: false }, { merge: true });
    const { token } = await anonToken();
    expect((await chat(token, 'gpt-5-mini')).status).toBe(503);
  });
  it('grants CORS to the allowed origin', async () => {
    // (the Functions emulator reflects every origin itself, so the deny path is unit-tested in cors.test.ts)
    const { token } = await anonToken();
    const ok = await chat(token, 'gpt-5-mini', 'http://localhost:5173');
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173'); await ok.text();
  });
});

describe('redeemCode + security rules', () => {
  const batch = (token: string, sid: string) => fetch(`${FS}/sessions/${sid}/batches`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { seqStart: { integerValue: '1' }, seqEnd: { integerValue: '1' }, clientTime: { integerValue: '1' }, events: { arrayValue: { values: [{ mapValue: { fields: { type: { stringValue: 'session_start' } } } }] } } } }),
  });
  it('unknown codes are rejected', async () => {
    const { token } = await anonToken();
    expect((await redeem(token, 'NOPE-0000')).status).toBe(404);
  });
  it('clients cannot read codes, usage or sessions', async () => {
    const { token } = await anonToken();
    for (const p of ['codes/TEST-0001', 'config/llm', 'sessions/s_TEST-0001']) {
      const r = await fetch(`${FS}/${p}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(r.status).toBe(403);
    }
  });
  it('only the bound participant can append log batches; nobody can read them', async () => {
    const a = await anonToken();
    expect((await batch(a.token, 's_TEST-0001')).status).toBe(403); // before redeem
    expect((await redeem(a.token, 'TEST-0001')).status).toBe(200);
    expect((await batch(a.token, 's_TEST-0001')).status).toBe(200);
    const b = await anonToken();
    expect((await batch(b.token, 's_TEST-0001')).status).toBe(403);
    const list = await fetch(`${FS}/sessions/s_TEST-0001/batches`, { headers: { Authorization: `Bearer ${a.token}` } });
    expect(list.status).toBe(403);
  });
  it('re-redeeming on a new device rebinds the code', async () => {
    const a = await anonToken();
    await redeem(a.token, 'TEST-0001');
    const b = await anonToken();
    const r = await (await redeem(b.token, 'TEST-0001')).json() as { rebound: boolean; sessionId: string };
    expect(r.rebound).toBe(true);
    expect((await batch(b.token, r.sessionId)).status).toBe(200);
    expect((await batch(a.token, r.sessionId)).status).toBe(403);
  });
});
