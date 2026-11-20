import type { SimCore } from '../sim/SimCore';
import type { Fault, PredicateDef, Pose, RobotCommand } from '../sim/types';
import { evaluateAll } from '../sim/predicates/evaluators';
import { hashString, type MainToWorker, type RunTrace, type TraceEntry, type WorkerToMain } from './protocol';

export type RunState = 'idle' | 'running' | 'paused' | 'stepping';
export interface RunnerHooks {
  onState(s: RunState): void;
  onHighlight(line: number | undefined, blockId: string | undefined): void;
  onLog(text: string, line?: number): void;
  onEnd(trace: RunTrace): void;
  onCommand?(cmd: RobotCommand, line?: number): void;
}
const RUNAWAY_MS = 3000;

export class ProgramRunner {
  state: RunState = 'idle';
  speed = 1;
  private worker: Worker | null = null;
  private pendingCall: { id: number; cmd: RobotCommand; line?: number } | null = null;
  private activeCall: { id: number; cmd: RobotCommand; line?: number } | null = null;
  private lastActivity = 0;
  private startSimTime = 0;
  private entries: TraceEntry[] = [];
  private logs: RunTrace['logs'] = [];
  private blockId: string | undefined;
  private faults = 0;
  private runId = '';
  private src = '';
  private opts: { predicates: PredicateDef[]; maxSimTimeSec: number; seed: number } = { predicates: [], maxSimTimeSec: 600, seed: 0 };

  constructor(private sim: () => SimCore, private hooks: RunnerHooks) {}

  private setState(s: RunState) { this.state = s; this.hooks.onState(s); }

  start(src: string, opts: { predicates: PredicateDef[]; maxSimTimeSec?: number; seed: number; runId: string }) {
    this.stop(true);
    this.src = src;
    this.runId = opts.runId;
    this.opts = { predicates: opts.predicates, maxSimTimeSec: opts.maxSimTimeSec ?? 600, seed: opts.seed };
    this.entries = []; this.logs = []; this.faults = 0; this.blockId = undefined;
    this.startSimTime = this.sim().simTime;
    this.sim().s.faults = [];
    const w = new Worker(new URL('./program.worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (e: MessageEvent<WorkerToMain>) => this.onMessage(e.data);
    w.onerror = (e) => { e.preventDefault(); this.end('fault', { code: 'USER_ERROR', message: e.message || 'Program error' }); };
    const sim = this.sim();
    const targets: Record<string, Pose> = Object.fromEntries(Object.entries(sim.allTargets()).map(([k, t]) => [k, t.pose]));
    this.post({ t: 'start', runId: this.runId, src, targets });
    this.lastActivity = performance.now();
    this.setState('running');
  }

  private post(m: MainToWorker) { this.worker?.postMessage(m); }

  private onMessage(m: WorkerToMain) {
    if (!this.worker) return;
    this.lastActivity = performance.now();
    switch (m.t) {
      case 'ready': return;
      case 'log': this.logs.push({ simTime: this.sim().simTime, text: m.args.join(' ') }); this.hooks.onLog(m.args.join(' '), m.line); return;
      case 'done': this.end('completed'); return;
      case 'error': {
        const f: Fault = m.fault ?? { code: 'USER_ERROR', message: m.message, line: m.line, blockId: this.blockId };
        if (!m.fault) this.faults++;
        this.end('fault', { ...f, line: f.line ?? m.line, blockId: f.blockId ?? this.blockId });
        return;
      }
      case 'call': {
        if (m.cmd.op === 'hl') {
          this.blockId = m.cmd.blockId;
          this.hooks.onHighlight(undefined, this.blockId);
          this.post({ t: 'reply', id: m.id, ok: true });
          return;
        }
        const call = { id: m.id, cmd: m.cmd as RobotCommand, line: m.line };
        if (this.state === 'paused') { this.pendingCall = call; return; }
        this.execute(call);
      }
    }
  }

  private execute(call: { id: number; cmd: RobotCommand; line?: number }) {
    const sim = this.sim();
    this.hooks.onHighlight(call.line, this.blockId);
    this.hooks.onCommand?.(call.cmd, call.line);
    const b = sim.begin(call.cmd);
    if (!b.ok) {
      this.faults++;
      const f = { ...b.fault, line: call.line, blockId: this.blockId };
      this.entries.push({ simTime: sim.simTime, line: call.line, blockId: this.blockId, cmd: call.cmd, result: f });
      this.post({ t: 'reply', id: call.id, ok: false, fault: f });
      return;
    }
    if (b.done) { this.complete(call, b.value); return; }
    this.activeCall = call;
  }

  private complete(call: { id: number; cmd: RobotCommand; line?: number }, value?: unknown) {
    this.entries.push({ simTime: this.sim().simTime, line: call.line, blockId: this.blockId, cmd: call.cmd, result: 'ok' });
    this.activeCall = null;
    this.lastActivity = performance.now();
    if (this.state === 'stepping') this.setState('paused');
    this.post({ t: 'reply', id: call.id, ok: true, value });
  }

  /** Called every animation frame with real elapsed seconds. */
  tick(frameDt: number) {
    if (!this.worker) return;
    if (this.state === 'paused') { this.lastActivity = performance.now(); return; }
    const sim = this.sim();
    if (this.activeCall) {
      const r = sim.step(Math.min(frameDt, 0.05) * this.speed);
      if (r.status === 'done') this.complete(this.activeCall, r.value);
      else if (r.status === 'fault') {
        this.faults++;
        const call = this.activeCall; this.activeCall = null;
        const f = { ...r.fault, line: call.line, blockId: this.blockId };
        this.entries.push({ simTime: sim.simTime, line: call.line, blockId: this.blockId, cmd: call.cmd, result: f });
        this.post({ t: 'reply', id: call.id, ok: false, fault: f });
      }
      this.lastActivity = performance.now();
      if (sim.simTime - this.startSimTime > this.opts.maxSimTimeSec) {
        this.end('timeout', { code: 'SIM_TIME_LIMIT', message: `The run exceeded ${this.opts.maxSimTimeSec}s of simulated time.` });
      }
    } else if (performance.now() - this.lastActivity > RUNAWAY_MS) {
      this.end('fault', { code: 'RUNAWAY', message: 'The program kept running for 3 s without commanding the robot. Is there a loop with no motion or wait inside?', blockId: this.blockId });
    }
  }

  pause() { if (this.state === 'running' || this.state === 'stepping') this.setState('paused'); }
  resume() {
    if (this.state !== 'paused') return;
    this.setState('running');
    this.flushPending();
  }
  step() {
    if (this.state !== 'paused') return;
    this.setState('stepping');
    this.flushPending();
  }
  private flushPending() {
    if (this.pendingCall) { const c = this.pendingCall; this.pendingCall = null; this.execute(c); }
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
    this.activeCall = null;
    this.pendingCall = null;
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
      runId: this.runId, source: 'user', programHash: hashString(this.src), seed: this.opts.seed,
      entries: this.entries.slice(-500), logs: this.logs.slice(-200), outcome, fault, predicates,
      simDurationSec: Math.round((sim.simTime - this.startSimTime) * 1000) / 1000,
    };
    this.setState('idle');
    this.hooks.onEnd(trace);
  }
}
