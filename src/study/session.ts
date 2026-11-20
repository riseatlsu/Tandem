import { get as idbGet, set as idbSet } from 'idb-keyval';
import { EXPERIMENTS, TASKS, TASK_ORDER, type ExperimentDef } from '../content';
import { useApp, type StudyInfo, type Workspace, type ChatMsg } from '../store';
import { host } from '../simHost';
import { flush, logEvent, startLogging, type LogSink } from './logger';
import { callFunction, firebaseEnabled, getDb, initFirebase } from '../firebase';
import { CONFIG } from '../config';
import { PROMPT_VERSION } from '../agent/prompts/system.v1';
import type { LogEvent } from './events';

export interface RedeemResult { sessionId: string; experimentId: string; condition: string; orderIndex: number; checkpoint?: string | null; rebound?: boolean }
interface Checkpoint { taskIndex: number; workspaces: Record<string, Workspace>; chats: Record<string, ChatMsg[]>; passed: Record<string, boolean>; timeLeftSec: number | null; savedAt: number }

/** Cyclic Latin square over the tasks after a fixed prefix (e.g. a tutorial that always comes first). */
export function orderTasks(seq: string[], exp: ExperimentDef, orderIndex: number): string[] {
  const cb = exp.counterbalance;
  if (!cb) return seq;
  const k = cb.fixedPrefix ?? 0;
  const head = seq.slice(0, k), tail = seq.slice(k);
  if (!tail.length) return seq;
  const r = ((orderIndex % tail.length) + tail.length) % tail.length;
  return [...head, ...tail.slice(r), ...tail.slice(0, r)];
}

export function startDemo(taskId = TASK_ORDER[0]) {
  useApp.getState().set({ mode: 'demo', study: null });
  void initFirebase().catch(() => undefined);
  host.loadTask(taskId);
}

/** Local study mode for development/tests without Firebase: TEST-<condition>-<n> codes. */
function localRedeem(code: string): RedeemResult {
  const m = code.toUpperCase().match(/^TEST-(SUGGEST|QA|OFF)-(\d+)$/);
  if (!m) throw new Error('Unknown code. (Local mode accepts TEST-SUGGEST-1, TEST-QA-1, TEST-OFF-1.)');
  return { sessionId: `local-${code.toLowerCase()}`, experimentId: 'pilot', condition: m[1].toLowerCase(), orderIndex: Number(m[2]) - 1, checkpoint: null };
}

function firestoreSink(sessionId: string): LogSink {
  return {
    async writeBatch(events: LogEvent[]) {
      const db = await getDb();
      if (!db) throw new Error('no db');
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'sessions', sessionId, 'batches'), {
        seqStart: events[0].seq, seqEnd: events[events.length - 1].seq, clientTime: Date.now(), serverTime: serverTimestamp(),
        events: events.map((e) => ({ ...e, data: JSON.stringify(e.data ?? {}) })),
      });
    },
  };
}
/** Local sink: keeps batches in IndexedDB and on window for tests / manual download. */
function localSink(sessionId: string): LogSink {
  return {
    async writeBatch(events: LogEvent[]) {
      const key = `tandem.localbatches.${sessionId}`;
      const prev = ((await idbGet<LogEvent[][]>(key)) ?? []);
      prev.push(events);
      await idbSet(key, prev);
      (window as unknown as { __tandemLogs?: LogEvent[] }).__tandemLogs = prev.flat();
    },
  };
}

export async function redeem(rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  let r: RedeemResult;
  if (firebaseEnabled()) {
    await initFirebase();
    r = await callFunction<RedeemResult>('redeemCode', { code });
  } else r = localRedeem(code);
  const exp = EXPERIMENTS[r.experimentId];
  if (!exp) throw new Error(`This study (${r.experimentId}) is not available in this version of the app.`);
  const cond = exp.conditions[r.condition];
  if (!cond) throw new Error(`Unknown study condition ${r.condition}.`);
  const seq = orderTasks(cond.taskSequence, exp, r.orderIndex).filter((t) => TASKS[t]);
  const study: StudyInfo = {
    code, sessionId: r.sessionId, experimentId: exp.id, condition: r.condition, taskSequence: seq,
    agentMode: cond.agent.mode, model: cond.agent.model, promptVersion: cond.agent.promptVersion, postSurveyUrl: exp.postSurveyUrl,
  };
  // checkpoint: server copy first, then local
  let cp: Checkpoint | null = null;
  try { if (r.checkpoint) cp = JSON.parse(r.checkpoint); } catch { /* ignore */ }
  if (!cp) { try { cp = (await idbGet<Checkpoint>(`tandem.checkpoint.${r.sessionId}`)) ?? null; } catch { /* ignore */ } }
  const st = useApp.getState();
  st.set({ mode: 'study', study, taskIndex: cp?.taskIndex ?? 0, armOverride: null, workspaces: cp?.workspaces ?? {}, chats: cp?.chats ?? {}, passed: cp?.passed ?? {} });
  await startLogging({
    sessionId: r.sessionId,
    sink: firebaseEnabled() ? firestoreSink(r.sessionId) : localSink(r.sessionId),
    context: () => { const s = useApp.getState(); return { taskId: s.taskId, taskIndex: s.taskIndex, simTime: host.sim ? Math.round(host.sim.simTime * 1000) / 1000 : undefined }; },
  });
  if (cp) logEvent('resume', { taskIndex: cp.taskIndex, savedAt: cp.savedAt });
  else logEvent('session_start', { code, experimentId: exp.id, experimentVersion: exp.version, condition: r.condition, taskSequence: seq, appVersion: CONFIG.appVersion, promptVersion: PROMPT_VERSION, userAgent: navigator.userAgent });
  if (r.rebound) logEvent('code_rebound', {});
  const idx = Math.min(cp?.taskIndex ?? 0, seq.length - 1);
  host.loadTask(seq[idx]);
  if (cp?.timeLeftSec != null) useApp.getState().set({ timeLeftSec: cp.timeLeftSec });
  startCheckpointing();
  const telemetry = exp.logging.telemetry;
  if (telemetry) startTelemetry();
}

let cpTimer: ReturnType<typeof setInterval> | null = null;
let lastCp = '';
export async function saveCheckpoint(force = false) {
  const s = useApp.getState();
  if (s.mode !== 'study' || !s.study) return;
  const keep = new Set(s.study.taskSequence);
  const cp: Checkpoint = {
    taskIndex: s.taskIndex,
    workspaces: Object.fromEntries(Object.entries(s.workspaces).filter(([k]) => keep.has(k))),
    chats: Object.fromEntries(Object.entries(s.chats).filter(([k]) => keep.has(k)).map(([k, v]) => [k, v.slice(-60)])),
    passed: s.passed, timeLeftSec: s.timeLeftSec, savedAt: Date.now(),
  };
  const data = JSON.stringify({ ...cp, savedAt: 0 });
  if (!force && data === lastCp) return;
  lastCp = data;
  try { await idbSet(`tandem.checkpoint.${s.study.sessionId}`, cp); } catch { /* ignore */ }
  if (firebaseEnabled()) {
    try {
      const db = await getDb();
      const { doc, setDoc } = await import('firebase/firestore');
      if (db) await setDoc(doc(db, 'sessions', s.study.sessionId, 'checkpoint', 'current'), { data: JSON.stringify(cp), savedAt: cp.savedAt });
    } catch (e) { console.warn('[checkpoint] save failed', e); }
  }
}
function startCheckpointing() {
  if (cpTimer) clearInterval(cpTimer);
  cpTimer = setInterval(() => void saveCheckpoint(), 3000);
  addEventListener('beforeunload', () => { void saveCheckpoint(true); void flush(); });
}

let telemetryStarted = false;
function startTelemetry() {
  if (telemetryStarted) return;
  telemetryStarted = true;
  addEventListener('focus', () => logEvent('focus', {}));
  addEventListener('blur', () => logEvent('blur', {}));
  let last = Date.now(), idle = false;
  const bump = () => { if (idle) { idle = false; logEvent('idle_end', { idleMs: Date.now() - last }); } last = Date.now(); };
  for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel']) addEventListener(ev, bump, { passive: true });
  setInterval(() => { if (!idle && Date.now() - last > 60_000) { idle = true; logEvent('idle_start', {}); } }, 5000);
}

export async function advanceTask(reason: 'pass' | 'timeout' | 'skip') {
  const s = useApp.getState();
  if (s.mode !== 'study' || !s.study) return;
  if (reason === 'timeout') logEvent('task_timeout', { taskId: s.taskId });
  if (reason === 'skip') logEvent('task_skip', { taskId: s.taskId });
  const next = s.taskIndex + 1;
  if (next >= s.study.taskSequence.length) { await finishSession(); return; }
  s.set({ taskIndex: next });
  host.loadTask(s.study.taskSequence[next]);
  await saveCheckpoint(true);
}

export async function finishSession() {
  const s = useApp.getState();
  if (!s.study) return;
  logEvent('session_end', { passed: s.passed });
  await saveCheckpoint(true);
  await flush();
  await flush();
  const url = s.study.postSurveyUrl;
  useApp.getState().set({ toasts: [] });
  if (url) {
    const u = new URL(url);
    u.searchParams.set('pid', s.study.code);
    u.searchParams.set('exp', s.study.experimentId);
    location.assign(u.toString());
  } else {
    alertDone();
  }
}
function alertDone() { useApp.getState().set({ showSuccess: true }); }
