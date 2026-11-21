import type { SimCore } from '../sim/SimCore';
import type { Fault, PredicateDef, Pose, RobotCommand } from '../sim/types';
import { evaluateAll } from '../sim/predicates/evaluators';
import { type LaneSpec, type MainToWorker, type RunTrace, type TraceEntry, type WorkerToMain } from './protocol';
import { Scheduler } from './scheduler';
import { laneSources, sourceHash, type ProgramSource } from './headless';

export type RunState = 'idle' | 'running' | 'paused' | 'stepping';
export interface RunnerHooks {
  onState(s: RunState): void;
  /** `lane` is the robot whose program is at this line/block (always set; "A" in single-arm cells). */
  onHighlight(line: number | undefined, blockId: string | undefined, lane?: string): void;
  onLog(text: string, line?: number, lane?: string): void;
  onEnd(trace: RunTrace): void;
  onCommand?(cmd: RobotCommand, line?: number, lane?: string): void;
}
const RUNAWAY_MS = 3000;

/** Runs a program (one lane per robot) in a sandboxed worker against the live SimCore, driven by the render loop. */
export class ProgramRunner {
  state: RunState = 'idle';
  speed = 1;
  private worker: Worker | null = null;
  private sched: Scheduler | null = null;
  private lastActivity = 0;
  private startSimTime = 0;
  private entries: TraceEntry[] = [];
  private logs: RunTrace['logs'] = [];
  private blockIds: Record<string, string | undefined> = {};
  private faults = 0;
  private runId = '';
  private src: ProgramSource = '';
  private opts: { predicates: PredicateDef[]; maxSimTimeSec: number; seed: number } = { predicates: [], maxSimTimeSec: 600, seed: 0 };

  constructor(private sim: () => SimCore, private hooks: RunnerHooks) {}

  private setState(s: RunState) { this.state = s; this.hooks.onState(s); }

  start(src: ProgramSource, opts: { predicates: PredicateDef[]; maxSimTimeSec?: number; seed: number; runId: string }) {
    this.stop(true);
    const sim = this.sim();
    this.src = src;
    this.runId = opts.runId;
    this.opts = { predicates: opts.predicates, maxSimTimeSec: opts.maxSimTimeSec ?? 600, seed: opts.seed };
    this.entries = []; this.logs = []; this.faults = 0; this.blockIds = {};
    this.startSimTime = sim.simTime;
    sim.s.faults = [];
    const sources = laneSources(sim, src);
    const laneIds = sim.robotIds.filter((id) => id in sources);
    this.sched = new Scheduler(sim, laneIds, {
      reply: (_lane, call, r) => {
        if (!r.ok) this.faults++;
        this.post(r.ok ? { t: 'reply', id: call.id, ok: true, value: r.value } : { t: 'reply', id: call.id, ok: false, fault: r.fault });
      },
      onBegin: (lane, call) => { this.hooks.onHighlight(call.line, call.blockId, lane); this.hooks.onCommand?.(call.cmd, call.line, lane); },
      entry: (e) => this.entries.push(e),
    });
    this.sched.onStepDone = () => { if (this.state === 'stepping') { this.sched?.pause(); this.setState('paused'); } };
    const w = new Worker(new URL('./program.worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (e: MessageEvent<WorkerToMain>) => this.onMessage(e.data);
    w.onerror = (e) => { e.preventDefault(); this.end('fault', { code: 'USER_ERROR', message: e.message || 'Program error' }); };
    const lanes: LaneSpec[] = laneIds.map((robot) => ({ robot, src: sources[robot], targets: Object.fromEntries(Object.entries(sim.allTargets(robot)).map(([k, t]) => [k, t.pose])) as Record<string, Pose> }));
    this.post({ t: 'start', runId: this.runId, lanes });
    this.lastActivity = performance.now();
    this.setState('running');
  }

  private post(m: MainToWorker) { this.worker?.postMessage(m); }

  private onMessage(m: WorkerToMain) {
    if (!this.worker || !this.sched) return;
    this.lastActivity = performance.now();
    const multi = this.sim().multi;
    switch (m.t) {
      case 'ready': return;
      case 'log': {
        const text = (multi ? `[${this.sim().label(m.lane)}] ` : '') + m.args.join(' ');
        this.logs.push({ simTime: this.sim().simTime, text });
        this.hooks.onLog(text, m.line, m.lane);
        return;
      }
      case 'laneDone': this.sched.laneDone(m.lane); this.pump(); return;
      case 'done': this.end('completed'); return;
      case 'error': {
        const f: Fault = m.fault ?? { code: 'USER_ERROR', message: m.message, line: m.line, blockId: this.blockIds[m.lane] };
        if (!m.fault) this.faults++;
        this.end('fault', { ...f, line: f.line ?? m.line, blockId: f.blockId ?? this.blockIds[m.lane], ...(multi ? { robot: f.robot ?? m.lane } : {}) });
        return;
      }
      case 'call': {
        if (m.cmd.op === 'hl') {
          this.blockIds[m.lane] = m.cmd.blockId;
          this.hooks.onHighlight(undefined, m.cmd.blockId, m.lane);
          this.post({ t: 'reply', id: m.id, ok: true });
          return;
        }
        this.sched.call(m.lane, { id: m.id, cmd: m.cmd as RobotCommand, line: m.line, blockId: this.blockIds[m.lane] });
        this.pump();
      }
    }
  }

  /** Begin whatever can begin now. A fault is replied to its lane; the worker then reports the error and the run ends. */
  private pump() { this.sched?.pump(); }

  /** Called every animation frame with real elapsed seconds. */
  tick(frameDt: number) {
    const sched = this.sched;
    if (!this.worker || !sched) return;
    this.pump();
    if (this.state === 'paused') { this.lastActivity = performance.now(); return; }
    if (sched.canAdvance()) {
      const sim = this.sim();
      sched.advance(Math.min(frameDt, 0.05) * this.speed);
      this.lastActivity = performance.now();
      if (sim.simTime - this.startSimTime > this.opts.maxSimTimeSec) {
        this.end('timeout', { code: 'SIM_TIME_LIMIT', message: `The run exceeded ${this.opts.maxSimTimeSec}s of simulated time.` });
      }
    } else if (sched.anyComputing() && performance.now() - this.lastActivity > RUNAWAY_MS) {
      this.end('fault', { code: 'RUNAWAY', message: 'The program kept running for 3 s without commanding the robot. Is there a loop with no motion or wait inside?', blockId: Object.values(this.blockIds).find(Boolean) });
    }
  }

  /** What each lane is doing right now (null when no run is active). */
  laneStates(): Record<string, import('./scheduler').LaneState> | null {
    return this.sched ? Object.fromEntries(this.sched.lanes.map((l) => [l.id, l.state])) : null;
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'stepping') return;
    this.sched?.pause();
    this.setState('paused');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.sched?.resume();
    this.setState('running');
    this.pump();
  }
  /** While paused: run one command on every arm that has one ready, then pause again. */
  step() {
    if (this.state !== 'paused') return;
    this.setState('stepping');
    this.sched?.step();
    this.pump();
  }

  /** Stop the program; the robot halts in place. */
  stop(silent = false) {
    if (!this.worker) return;
    if (silent) { this.teardown(); return; }
    this.end('stopped');
  }

  private teardown() {
    this.worker?.terminate();
    this.worker = null;
    this.sched = null;
    this.sim().stopNow();
    this.hooks.onHighlight(undefined, undefined);
  }

  private end(outcome: RunTrace['outcome'], fault?: Fault) {
    if (!this.worker) return;
    this.teardown();
    const sim = this.sim();
    const predicates = evaluateAll(this.opts.predicates, sim.s, {
      scene: sim.scene, targets: sim.allTargets(), programCompleted: outcome === 'completed', runStartTime: this.startSimTime,
      runFaults: this.faults + (fault && outcome !== 'stopped' ? 1 : 0), totalLiquid: sim.s.totalLiquid,
    });
    const trace: RunTrace = {
      runId: this.runId, source: 'user', programHash: sourceHash(this.src), seed: this.opts.seed,
      entries: this.entries.slice(-500), logs: this.logs.slice(-200), outcome, fault, predicates,
      simDurationSec: Math.round((sim.simTime - this.startSimTime) * 1000) / 1000,
    };
    this.setState('idle');
    this.hooks.onEnd(trace);
  }
}
