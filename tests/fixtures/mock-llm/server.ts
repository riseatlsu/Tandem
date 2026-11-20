/**
 * Scripted OpenAI-compatible mock (POST /v1/chat/completions, SSE). Deterministic agent flows for dev & E2E.
 * The scenario is chosen from the latest user message; the step index = assistant turns since that message.
 * GET /__requests returns received request bodies; POST /__reset clears them; POST /__quota sets a 429 after N calls.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'));
const PORT = Number(process.env.MOCK_LLM_PORT ?? 8787);
let requests: unknown[] = [];
let quota = Infinity;
let calls = 0;

type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };
const text = (m: Msg) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c: { text?: string }) => c.text ?? '').join('') : '');
const subst = (v: unknown): unknown => {
  if (typeof v === 'string' && v.startsWith('$')) return spec.fixtures[v.slice(1)];
  if (Array.isArray(v)) return v.map(subst);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)]));
  return v;
};

function pick(messages: Msg[]) {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user' && !text(messages[i]).startsWith('TOOL RESULT') && !text(messages[i]).startsWith('(The user')) { lastUser = i; break; }
  const userText = lastUser >= 0 ? text(messages[lastUser]) : '';
  const sc = spec.scenarios.find((s: { match: string }) => new RegExp(s.match, 'i').test(userText));
  const turn = messages.slice(lastUser + 1).filter((m) => m.role === 'assistant').length;
  return sc.steps[Math.min(turn, sc.steps.length - 1)];
}

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
const body = (req: IncomingMessage) => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.url === '/__requests') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(requests)); return; }
  if (req.url === '/__reset') { requests = []; calls = 0; quota = Infinity; res.writeHead(200).end('ok'); return; }
  if (req.url?.startsWith('/__quota')) { quota = Number(new URL(req.url, 'http://x').searchParams.get('n') ?? 0); calls = 0; res.writeHead(200).end('ok'); return; }
  if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  const raw = await body(req);
  const j = JSON.parse(raw);
  requests.push({ model: j.model, tools: (j.tools ?? []).map((t: { function: { name: string } }) => t.function.name), messages: j.messages.length, headers: { token: !!req.headers['x-firebase-token'] } });
  if (++calls > quota) { res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'quota', type: 'quota' } })); return; }
  const step = pick(j.messages);
  const id = `chatcmpl-${Date.now()}`;
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: j.model };
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (step.tool) {
    const args = JSON.stringify(subst(step.args));
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: `call_${calls}`, type: 'function', function: { name: step.tool, arguments: '' } }] }, finish_reason: null }] });
    for (let i = 0; i < args.length; i += 40) send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 40) } }] }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    for (const w of String(step.text).match(/\S+\s*/g) ?? []) { send({ ...base, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] }); await sleep(8); }
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  send({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(PORT, () => console.log(`mock LLM on http://localhost:${PORT}`));
