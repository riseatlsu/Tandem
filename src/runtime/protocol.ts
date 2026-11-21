import type { Fault, Pose, PredicateResult, RobotCommand } from '../sim/types';

export type WireCommand = RobotCommand | { op: 'hl'; blockId: string };

/** One robot's program in a run. Single-arm runs have one lane (robot "A"). */
export interface LaneSpec { robot: string; src: string; targets: Record<string, Pose> }

export type MainToWorker =
  | { t: 'start'; runId: string; lanes: LaneSpec[] }
  | { t: 'reply'; id: number; ok: true; value?: unknown }
  | { t: 'reply'; id: number; ok: false; fault: Fault };

export type WorkerToMain =
  | { t: 'ready' }
  | { t: 'call'; lane: string; id: number; cmd: WireCommand; line?: number }
  | { t: 'log'; lane: string; args: string[]; line?: number }
  | { t: 'laneDone'; lane: string }
  | { t: 'done' }
  | { t: 'error'; lane: string; message: string; line?: number; fault?: Fault };

/** One sample of robot motion recorded during a dry run (simulated seconds from the start of the run).
 *  `q`/`open` are the first robot's; multi-arm runs add every robot under `robots`. */
export interface GhostFrame { t: number; q: number[]; open: boolean; robots?: Record<string, { q: number[]; open: boolean }> }
export interface TraceEntry { simTime: number; line?: number; blockId?: string; robot?: string; cmd: RobotCommand; result: 'ok' | Fault }
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
  frames?: GhostFrame[];
}

export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
