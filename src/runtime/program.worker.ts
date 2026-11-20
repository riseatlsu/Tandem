/// <reference lib="webworker" />
/**
 * Executes one user program. Robot calls become postMessage RPCs that the main thread
 * validates and executes on the live SimCore. Created per run; terminated on stop/fault/done.
 */
import { compileProgram, createApi, formatLogArg, RobotFault, userLine } from './robotApi';
import type { MainToWorker, WorkerToMain, WireCommand } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: WorkerToMain) => self.postMessage(m);

// Defense in depth: remove network & storage capabilities before any user code runs.
const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Request', 'WebTransport'];
for (const key of BLOCKED) {
  let o: object | null = self;
  while (o) {
    try { if (Object.prototype.hasOwnProperty.call(o, key)) delete (o as Record<string, unknown>)[key]; } catch { /* ignore */ }
    o = Object.getPrototypeOf(o);
  }
  try { Object.defineProperty(self, key, { value: undefined, writable: false, configurable: false }); } catch { /* ignore */ }
}
try { Object.defineProperty(navigator, 'sendBeacon', { value: undefined }); } catch { /* ignore */ }

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

const call = (cmd: WireCommand, line?: number) =>
  new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    post({ t: 'call', id, cmd, line });
  });

self.onmessage = async (e: MessageEvent<MainToWorker>) => {
  const m = e.data;
  if (m.t === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value); else p.reject(new RobotFault(m.fault));
    return;
  }
  if (m.t === 'start') {
    const api = createApi(call, m.targets, (args, line) => post({ t: 'log', args: args.map(formatLogArg), line }));
    try {
      const fn = compileProgram(m.src);
      await fn(api.robot, api.gripper, api.io, api.targets, api.offset, api.log, api.__hl);
      post({ t: 'done' });
    } catch (err) {
      if (err instanceof RobotFault) post({ t: 'error', message: err.message, fault: err.fault, line: err.fault.line });
      else post({ t: 'error', message: err instanceof Error ? `${err.name}: ${err.message}` : String(err), line: userLine((err as Error)?.stack) });
    }
  }
};
post({ t: 'ready' });
