/** Runs a program directly against a SimCore (no rendering, no RPC). Used by dry runs and tests. */
import type { SimCore } from '../sim/SimCore';
import type { Fault, PredicateDef, Pose, RobotCommand } from '../sim/types';
import { evaluateAll } from '../sim/predicates/evaluators';
import { compileProgram, createApi, formatLogArg, RobotFault, userLine } from './robotApi';
import { hashString, type GhostFrame, type RunTrace, type TraceEntry, type WireCommand } from './protocol';

export interface HeadlessOpts {
  runId?: string; source?: 'user' | 'dryrun'; maxSimTimeSec?: number; predicates?: PredicateDef[]; seed?: number; maxEntries?: number;
  /** Record robot frames (joints + gripper) every N simulated seconds, for the ghost preview. */
  recordEvery?: number;
  /** Awaited after every simulation step; lets a caller pace the run in real time (landing page hero). */
  onStep?: (sim: SimCore) => Promise<void> | void;
}

export async function runHeadless(sim: SimCore, src: string, opts: HeadlessOpts = {}): Promise<RunTrace> {
  const startTime = sim.simTime;
  const maxSim = opts.maxSimTimeSec ?? 600;
  const entries: TraceEntry[] = [];
  const logs: RunTrace['logs'] = [];
  let blockId: string | undefined;
  let faults = 0;
  const frames: GhostFrame[] = [];
  let lastRec = -Infinity;
  const rec = (force = false) => {
    if (!opts.recordEvery || frames.length >= 3000) return;
    if (!force && sim.simTime - lastRec < opts.recordEvery) return;
    lastRec = sim.simTime;
    frames.push({ t: Math.round((sim.simTime - startTime) * 1000) / 1000, q: sim.s.q.slice(), open: sim.s.gripperOpen });
  };
  rec(true);

  const call = async (cmd: WireCommand, line?: number): Promise<unknown> => {
    if (cmd.op === 'hl') { blockId = cmd.blockId; return; }
    const rc = cmd as RobotCommand;
    const push = (result: 'ok' | Fault) => { if (entries.length < (opts.maxEntries ?? 2000)) entries.push({ simTime: sim.simTime, line, blockId, cmd: rc, result }); };
    const b = sim.begin(rc);
    if (!b.ok) { faults++; push({ ...b.fault, line, blockId }); throw new RobotFault({ ...b.fault, line, blockId }); }
    if (b.done) { push('ok'); rec(true); return b.value; }
    for (;;) {
      const r = sim.step(0.02);
      rec();
      if (opts.onStep) await opts.onStep(sim);
      if (r.status === 'done') { push('ok'); return r.value; }
      if (r.status === 'fault') { faults++; push({ ...r.fault, line, blockId }); throw new RobotFault({ ...r.fault, line, blockId }); }
      if (sim.simTime - startTime > maxSim) {
        sim.stopNow();
        const f: Fault = { code: 'SIM_TIME_LIMIT', message: `Exceeded the ${maxSim}s simulated time limit.`, line, blockId };
        throw new RobotFault(f);
      }
    }
  };
  const targetMap: Record<string, Pose> = Object.fromEntries(Object.entries(sim.allTargets()).map(([k, t]) => [k, t.pose]));
  const api = createApi(call, targetMap, (args, line) => logs.push({ simTime: sim.simTime, text: (line ? `[line ${line}] ` : '') + args.map(formatLogArg).join(' ') }));

  let outcome: RunTrace['outcome'] = 'completed';
  let fault: Fault | undefined;
  try {
    const fn = compileProgram(src);
    await fn(api.robot, api.gripper, api.io, api.targets, api.offset, api.log, api.__hl);
  } catch (e) {
    if (e instanceof RobotFault) { fault = e.fault; outcome = e.fault.code === 'SIM_TIME_LIMIT' ? 'timeout' : 'fault'; }
    else { fault = { code: 'USER_ERROR', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e), line: userLine((e as Error)?.stack), blockId }; outcome = 'fault'; faults++; }
  }
  const predicates = evaluateAll(opts.predicates ?? [], sim.s, {
    scene: sim.scene, targets: sim.allTargets(), programCompleted: outcome === 'completed', runStartTime: startTime, runFaults: faults, totalLiquid: sim.s.totalLiquid,
  });
  rec(true);
  return {
    runId: opts.runId ?? `run-${Date.now().toString(36)}`, source: opts.source ?? 'dryrun', programHash: hashString(src), seed: opts.seed ?? 0,
    entries, logs, outcome, fault, predicates, simDurationSec: Math.round((sim.simTime - startTime) * 1000) / 1000,
    ...(opts.recordEvery ? { frames } : {}),
  };
}
