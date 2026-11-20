import type { Fault, Pose, PredicateResult, RobotCommand } from '../sim/types';

export type WireCommand = RobotCommand | { op: 'hl'; blockId: string };

export type MainToWorker =
  | { t: 'start'; runId: string; src: string; targets: Record<string, Pose> }
  | { t: 'reply'; id: number; ok: true; value?: unknown }
  | { t: 'reply'; id: number; ok: false; fault: Fault };

export type WorkerToMain =
  | { t: 'ready' }
  | { t: 'call'; id: number; cmd: WireCommand; line?: number }
  | { t: 'log'; args: string[]; line?: number }
  | { t: 'done' }
  | { t: 'error'; message: string; line?: number; fault?: Fault };

export interface TraceEntry { simTime: number; line?: number; blockId?: string; cmd: RobotCommand; result: 'ok' | Fault }
export interface RunTrace {
  runId: string;
  source: 'user' | 'dryrun';
  programHash: string;
  seed: number;
  entries: TraceEntry[];
  logs: { simTime: number; text: string }[];
  outcome: 'completed' | 'fault' | 'stopped' | 'timeout';
  fault?: Fault;
  predicates: PredicateResult[];
  simDurationSec: number;
}

export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
