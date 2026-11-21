/**
 * Multi-lane run scheduler (SPEC §21.3–§21.4), shared by live runs (ProgramRunner) and headless runs.
 *
 * Every robot has a lane: one program issuing robot calls. The scheduler decides when calls begin and when
 * simulated time may advance, using only sim state and the lanes' states, never wall-clock timing:
 *   - time advances only while no lane is computing (`js`) and at least one lane is executing a command;
 *   - calls that become ready at the same sim time begin in lane order;
 *   - `sync` calls park a lane until every live lane has parked at its next sync.
 * Single-arm runs are one lane, which reduces to the original rule "time advances only while a command runs".
 */
import type { SimCore } from '../sim/SimCore';
import type { Fault, RobotCommand } from '../sim/types';
import type { TraceEntry } from './protocol';

export interface LaneCall { id: number; cmd: RobotCommand; line?: number; blockId?: string }
type Reply = { ok: true; value?: unknown } | { ok: false; fault: Fault };
/** js: computing between calls · pending: a call is waiting to begin · executing: a command is running ·
 *  parked: waiting at a sync · done: the lane's program finished */
export type LaneState = 'js' | 'pending' | 'executing' | 'parked' | 'done';

interface Lane { id: string; state: LaneState; call?: LaneCall; syncs: number }

export interface SchedulerHooks {
  /** Deliver the result of a call back to its lane. */
  reply(lane: string, call: LaneCall, r: Reply): void;
  /** A call is about to begin (highlighting, logging). */
  onBegin?(lane: string, call: LaneCall): void;
  entry?(e: TraceEntry): void;
}

export class Scheduler {
  readonly lanes: Lane[];
  /** While paused, no new call begins and time stands still, except during a Step. */
  paused = false;
  private stepRequested = false;
  /** Lanes released by the current Step; null when not stepping. */
  private stepping: Set<string> | null = null;
  /** Called when a Step has finished (no released lane is still executing). */
  onStepDone?: () => void;

  constructor(private sim: SimCore, laneIds: string[], private hooks: SchedulerHooks) {
    this.lanes = laneIds.map((id) => ({ id, state: 'js', syncs: 0 }));
  }

  lane(id: string): Lane {
    const l = this.lanes.find((x) => x.id === id);
    if (!l) throw new Error(`Unknown lane ${id}`);
    return l;
  }
  /** A lane issued a robot call. */
  call(laneId: string, call: LaneCall) {
    const l = this.lane(laneId);
    l.state = 'pending';
    l.call = call;
  }
  /** A lane's program returned. */
  laneDone(laneId: string) { const l = this.lane(laneId); l.state = 'done'; l.call = undefined; }
  allDone() { return this.lanes.every((l) => l.state === 'done'); }
  anyComputing() { return this.lanes.some((l) => l.state === 'js'); }
  isStepping() { return !!this.stepping; }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.stepping = null; this.stepRequested = false; }
  /** Release one command on every lane that has one ready, then pause again (D10). */
  step() { if (this.paused) this.stepRequested = true; }

  private reply(l: Lane, r: Reply) {
    const call = l.call!;
    l.state = 'js';
    l.call = undefined;
    this.hooks.reply(l.id, call, r);
  }
  private record(l: Lane, call: LaneCall, result: 'ok' | Fault) {
    this.hooks.entry?.({ simTime: this.sim.simTime, line: call.line, blockId: call.blockId, cmd: call.cmd, result, ...(this.sim.multi ? { robot: l.id } : {}) });
  }
  private withLoc(l: Lane, call: LaneCall, f: Fault): Fault {
    return { ...f, line: f.line ?? call.line, blockId: f.blockId ?? call.blockId, ...(this.sim.multi ? { robot: f.robot ?? l.id } : {}) };
  }
  private fail(l: Lane, f: Fault): Fault {
    const call = l.call!;
    const full = this.withLoc(l, call, f);
    this.record(l, call, full);
    this.reply(l, { ok: false, fault: full });
    return full;
  }

  /**
   * Do everything that can happen at the current sim time: begin ready calls (in lane order), release syncs,
   * detect sync mismatches. Returns a fault if one occurred (the run should end).
   */
  pump(): Fault | null {
    if (this.anyComputing()) return null; // wait until every lane has settled
    if (this.paused && !this.stepping) {
      if (!this.stepRequested) return null;
      this.stepRequested = false;
      this.stepping = new Set(this.lanes.filter((l) => l.state === 'pending' || l.state === 'executing' || l.state === 'parked').map((l) => l.id));
    }
    for (const l of this.lanes) {
      if (l.state !== 'pending') continue;
      if (this.stepping && !this.stepping.has(l.id)) continue;
      const call = l.call!;
      if (call.cmd.op === 'sync') { l.state = 'parked'; continue; }
      this.hooks.onBegin?.(l.id, call);
      const b = this.sim.begin({ ...call.cmd, robot: l.id } as RobotCommand);
      if (!b.ok) return this.fail(l, b.fault);
      if (b.done) {
        this.record(l, call, 'ok');
        this.reply(l, { ok: true, value: b.value });
        if (this.stepping) this.stepping.delete(l.id);
      } else l.state = 'executing';
    }
    const f = this.resolveSyncs();
    if (f) return f;
    this.checkStepDone();
    return null;
  }

  private resolveSyncs(): Fault | null {
    const parked = this.lanes.filter((l) => l.state === 'parked');
    if (!parked.length) return null;
    // a sync needs every lane: one that has already finished can never reach it
    if (parked.length === this.lanes.length) return this.release(parked);
    // nobody can make progress: some lanes are parked, the others have finished
    const stuck = this.lanes.every((l) => l.state === 'parked' || l.state === 'done');
    if (stuck) {
      const done = this.lanes.filter((l) => l.state === 'done').map((l) => this.sim.label(l.id));
      const w = parked[0];
      return this.fail(w, {
        code: 'SYNC_MISMATCH',
        message: `${this.sim.label(w.id)} is waiting at sync #${w.syncs + 1}, but ${done.join(' and ')} ${done.length > 1 ? 'have' : 'has'} already finished. Every arm needs the same “Wait for each other” and “Move together” blocks.`,
      });
    }
    return null;
  }

  private release(parked: Lane[]): Fault | null {
    const kinds = parked.map((l) => (l.call!.cmd as Extract<RobotCommand, { op: 'sync' }>).kind);
    const n = parked[0].syncs + 1;
    for (const l of parked) l.syncs++;
    const record = () => { for (const l of parked) this.record(l, l.call!, 'ok'); };
    if (kinds.every((k) => k === 'wait')) {
      record();
      for (const l of parked) { this.reply(l, { ok: true }); this.stepping?.delete(l.id); }
      return null;
    }
    const leaders = parked.filter((_, i) => kinds[i] === 'move');
    if (leaders.length !== 1 || kinds.includes('wait')) {
      const desc = parked.map((l, i) => `${this.sim.label(l.id)}: ${kinds[i] === 'wait' ? '“Wait for each other”' : kinds[i] === 'move' ? '“Move together”' : '“Follow”'}`).join(', ');
      const why = leaders.length > 1 ? 'Only one arm can lead a move together; the others follow.' : leaders.length === 0 ? 'Every “Follow” needs one arm doing “Move together”.' : 'All arms must be at the same kind of sync block.';
      return this.fail(parked[0], { code: 'SYNC_MISMATCH', message: `Sync #${n} doesn’t match (${desc}). ${why}` });
    }
    const leader = leaders[0];
    const cmd = leader.call!.cmd as Extract<RobotCommand, { op: 'sync'; kind: 'move' }>;
    for (const l of parked) this.hooks.onBegin?.(l.id, l.call!);
    const b = this.sim.beginSync(leader.id, { target: cmd.target, speed: cmd.speed }, parked.filter((l) => l !== leader).map((l) => l.id));
    if (!b.ok) {
      const at = parked.find((l) => l.id === b.fault.robot) ?? leader;
      return this.fail(at, b.fault);
    }
    for (const l of parked) l.state = 'executing';
    return null;
  }

  private checkStepDone() {
    if (!this.stepping) return;
    // a lane parked at a sync whose partners are held by the pause doesn't keep the Step open
    if (this.lanes.some((l) => this.stepping!.has(l.id) && (l.state === 'executing' || l.state === 'pending'))) return;
    this.stepping = null;
    this.onStepDone?.();
  }

  /** May simulated time advance right now? */
  canAdvance(): boolean {
    if (this.anyComputing()) return false;
    if (this.paused && !this.stepping) return false;
    return this.lanes.some((l) => l.state === 'executing');
  }

  /** Advance simulated time (stops early when a command ends) and deliver results. */
  advance(dtSec: number): Fault | null {
    if (!this.canAdvance()) return null;
    const r = this.sim.stepAll(dtSec);
    let fault: Fault | null = null;
    for (const e of r.events) {
      const l = this.lanes.find((x) => x.id === e.robot);
      if (!l || l.state !== 'executing') continue;
      if (e.status === 'done') {
        this.record(l, l.call!, 'ok');
        this.reply(l, { ok: true, value: e.value });
        this.stepping?.delete(l.id);
      } else fault ??= this.fail(l, e.fault);
    }
    this.checkStepDone();
    return fault;
  }
}
