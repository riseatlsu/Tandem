/**
 * Study logger: event → IndexedDB queue → batched Firestore writes (SPEC §14.1).
 * No-op in demo mode. The sink is injected by session.ts once Firebase is ready.
 */
import { get, set } from 'idb-keyval';
import type { LogEvent, LogEventType } from './events';

export interface LogSink { writeBatch(events: LogEvent[]): Promise<void> }

const QUEUE_KEY = 'tandem.logqueue';
const SEQ_KEY = 'tandem.logseq';
let enabled = false;
let sessionId = '';
let seq = 0;
let buffer: LogEvent[] = [];
let sink: LogSink | null = null;
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;
let context: () => { taskId?: string; taskIndex?: number; simTime?: number } = () => ({});
const FORBIDDEN = /(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})|(sk-[A-Za-z0-9_-]{16,})/g; // JWTs / API keys

export async function startLogging(opts: { sessionId: string; sink: LogSink | null; context: typeof context }) {
  enabled = true;
  sessionId = opts.sessionId;
  sink = opts.sink;
  context = opts.context;
  try {
    seq = ((await get<number>(`${SEQ_KEY}.${sessionId}`)) ?? 0);
    const q = (await get<LogEvent[]>(`${QUEUE_KEY}.${sessionId}`)) ?? [];
    buffer = q.concat(buffer);
  } catch { /* storage unavailable */ }
  if (timer) clearInterval(timer);
  timer = setInterval(() => void flush(), 5000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
}

export function isLogging() { return enabled; }

function scrub(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(FORBIDDEN, '[redacted]');
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
}

export function logEvent(type: LogEventType, data: Record<string, unknown> = {}) {
  if (!enabled) return;
  const ev: LogEvent = { seq: ++seq, t: Date.now(), sessionId, type, ...context(), data: scrub(data) as Record<string, unknown> };
  buffer.push(ev);
  void persist();
  if (buffer.length >= 50) void flush();
}

async function persist() {
  try {
    await set(`${QUEUE_KEY}.${sessionId}`, buffer);
    await set(`${SEQ_KEY}.${sessionId}`, seq);
  } catch { /* ignore */ }
}

export async function flush(): Promise<void> {
  if (!enabled || flushing || !sink || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.slice(0, 200);
  try {
    // keep each Firestore doc well under 1 MB
    let size = 0, n = 0;
    for (const e of batch) { size += JSON.stringify(e).length; if (size > 450_000 && n > 0) break; n++; }
    await sink.writeBatch(batch.slice(0, n));
    buffer = buffer.slice(n);
    await persist();
  } catch (e) {
    console.warn('[logger] flush failed; will retry', e);
  } finally {
    flushing = false;
  }
}

export const pendingCount = () => buffer.length;
