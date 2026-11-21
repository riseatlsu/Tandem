/** Runs a program directly against a SimCore (no rendering, no RPC). Used by dry runs and tests. */
import type { SimCore } from '../sim/SimCore';
import type { Fault, PredicateDef, Pose, RobotCommand } from '../sim/types';
import { evaluateAll } from '../sim/predicates/evaluators';
import { compileProgram, createApi, formatLogArg, RobotFault, runProgram, userLine } from './robotApi';
import { hashString, type GhostFrame, type RunTrace, type TraceEntry, type WireCommand } from './protocol';
import { Scheduler } from './scheduler';

export interface HeadlessOpts {
  runId?: string; source?: 'user' | 'dryrun'; maxSimTimeSec?: number; predicates?: PredicateDef[]; seed?: number; maxEntries?: number;
  /** Record robot frames (joints + gripper) every N simulated seconds, for the ghost preview. */
  recordEvery?: number;
  /** Awaited after every simulation step; lets a caller pace the run in real time (landing page hero). */
  onStep?: (sim: SimCore) => Promise<void> | void;
  /** Wall-clock ms a lane may compute without calling the robot before the run stops with RUNAWAY. */
  runawayMs?: number;
}

/** A program per robot (multi-arm), or one program for the first robot. */
export type ProgramSource = string | Record<string, string>;
export const laneSources = (sim: SimCore, src: ProgramSource): Record<string, string> =>
  typeof src === 'string' ? { [sim.primary]: src } : src;
/**
 * Multi-arm program files (reference solutions, Studio) mark each arm's program with a line `// @lane <robotId>`.
 * Returns one program per arm, or the text unchanged when it has no markers.
 */
export function splitLanes(text: string): ProgramSource {
  const parts = text.split(/^\/\/ @lane ([A-Za-z][A-Za-z0-9]*)[ \t]*$/m);
  if (parts.length < 3) return text;
  const out: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1].replace(/^\r?\n/, '');
  return out;
}
/** The inverse of splitLanes: one text with a `// @lane <robotId>` line before each arm's program. */
export const joinLanes = (src: Record<string, string>) => Object.entries(src).map(([r, c]) => `// @lane ${r}\n${c.replace(/\n?$/, '\n')}`).join('');
export const sourceHash = (src: ProgramSource) => hashString(typeof src === 'string' ? src : JSON.stringify(Object.entries(src).sort()));

/** Yield to the event loop so lanes waiting on resolved calls run (a macrotask, so all microtasks drain). */
const tick = (() => {
  if (typeof MessageChannel === 'undefined') return () => new Promise<void>((r) => setTimeout(r, 0));
  const ch = new MessageChannel();
  const q: (() => void)[] = [];
  ch.port1.onmessage = () => q.shift()?.();
  return () => new Promise<void>((r) => { q.push(r); ch.port2.postMessage(0); });
})();

export async function runHeadless(sim: SimCore, src: ProgramSource, opts: HeadlessOpts = {}): Promise<RunTrace> {
  const startTime = sim.simTime;
  const maxSim = opts.maxSimTimeSec ?? 600;
  const entries: TraceEntry[] = [];
  const logs: RunTrace['logs'] = [];
  const sources = laneSources(sim, src);
  const laneIds = sim.robotIds.filter((id) => id in sources);
  const multi = sim.multi;
  const blockIds: Record<string, string | undefined> = {};
  let faults = 0;
  sim.s.faults = [];
  const frames: GhostFrame[] = [];
  let lastRec = -Infinity;
  const rec = (force = false) => {
    if (!opts.recordEvery || frames.length >= 3000) return;
    if (!force && sim.simTime - lastRec < opts.recordEvery) return;
    lastRec = sim.simTime;
    const p = sim.rs();
    frames.push({
      t: Math.round((sim.simTime - startTime) * 1000) / 1000, q: p.q.slice(), open: p.gripperOpen,
      ...(multi ? { robots: Object.fromEntries(sim.robotIds.map((id) => [id, { q: sim.rs(id).q.slice(), open: sim.rs(id).gripperOpen }])) } : {}),
    });
  };
  rec(true);

  let lastCall = performance.now();
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let nextId = 1;
  const sched = new Scheduler(sim, laneIds, {
    reply(_lane, call, r) {
      lastCall = performance.now();
      const w = waiting.get(call.id);
      if (!w) return;
      waiting.delete(call.id);
      if (r.ok) w.resolve(r.value); else { faults++; w.reject(new RobotFault(r.fault)); }
    },
    entry(e) { if (entries.length < (opts.maxEntries ?? 2000)) entries.push(e); },
  });

  let failure: { fault: Fault; outcome: RunTrace['outcome'] } | null = null;
  const lanePromises = laneIds.map(async (lane) => {
    const call = (cmd: WireCommand, line?: number): Promise<unknown> => {
      if (cmd.op === 'hl') { blockIds[lane] = cmd.blockId; return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        lastCall = performance.now();
        sched.call(lane, { id, cmd: cmd as RobotCommand, line, blockId: blockIds[lane] });
      });
    };
    const targetMap: Record<string, Pose> = Object.fromEntries(Object.entries(sim.allTargets(lane)).map(([k, t]) => [k, t.pose]));
    const prefix = multi ? `[${sim.label(lane)}] ` : '';
    const api = createApi(call, targetMap, (args, line) => logs.push({ simTime: sim.simTime, text: prefix + (line ? `[line ${line}] ` : '') + args.map(formatLogArg).join(' ') }), multi ? lane : undefined);
    try {
      await runProgram(compileProgram(sources[lane], multi ? lane : undefined), api);
      sched.laneDone(lane);
    } catch (e) {
      sched.laneDone(lane);
      if (failure) return;
      if (e instanceof RobotFault) failure = { fault: e.fault, outcome: e.fault.code === 'SIM_TIME_LIMIT' ? 'timeout' : 'fault' };
      else {
        faults++;
        failure = { fault: { code: 'USER_ERROR', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e), line: userLine((e as Error)?.stack, multi ? lane : undefined), blockId: blockIds[lane], ...(multi ? { robot: lane } : {}) }, outcome: 'fault' };
      }
    }
  });

  // drive the scheduler until every lane has finished or the run fails
  for (;;) {
    if (sched.anyComputing()) await tick(); // let lanes run until they call the robot again (or finish)
    if (failure || sched.allDone()) break;
    const f = sched.pump();
    if (f) { await tick(); break; } // the faulting lane throws; let it settle so `failure` is set
    if (sched.canAdvance()) {
      const af = sched.advance(0.02);
      rec();
      if (opts.onStep) await opts.onStep(sim);
      if (af) { await tick(); break; }
      if (sim.simTime - startTime > maxSim) {
        sim.stopNow();
        failure = { fault: { code: 'SIM_TIME_LIMIT', message: `Exceeded the ${maxSim}s simulated time limit.` }, outcome: 'timeout' };
        break;
      }
    } else if (sched.anyComputing()) {
      if (performance.now() - lastCall > (opts.runawayMs ?? 3000)) {
        failure = { fault: { code: 'RUNAWAY', message: 'The program kept running for 3 s without commanding the robot. Is there a loop with no motion or wait inside?' }, outcome: 'fault' };
        break;
      }
    } else if (!sched.allDone()) {
      // nothing is running, computing or able to begin (should not happen: headless runs are never paused)
      failure = { fault: { code: 'USER_ERROR', message: 'The run stalled: no arm could continue.' }, outcome: 'fault' };
      break;
    }
  }
  sim.stopNow();
  if (!failure) await Promise.race([Promise.all(lanePromises), tick()]);

  const result = failure as { fault: Fault; outcome: RunTrace['outcome'] } | null;
  const outcome: RunTrace['outcome'] = result?.outcome ?? 'completed';
  const predicates = evaluateAll(opts.predicates ?? [], sim.s, {
    scene: sim.scene, targets: sim.allTargets(), programCompleted: outcome === 'completed', runStartTime: startTime, runFaults: faults, totalLiquid: sim.s.totalLiquid,
  });
  rec(true);
  return {
    runId: opts.runId ?? `run-${Date.now().toString(36)}`, source: opts.source ?? 'dryrun', programHash: sourceHash(src), seed: opts.seed ?? 0,
    entries, logs, outcome, fault: result?.fault, predicates, simDurationSec: Math.round((sim.simTime - startTime) * 1000) / 1000,
    ...(opts.recordEvery ? { frames } : {}),
  };
}
