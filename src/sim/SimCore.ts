import { DEG, I4, apply, invRigid, mul, pos, rotZ, toEulerXYZ, trans, type M4 } from './math/mat4';
import type { AgentRobotView, AgentStateView, ArmDef, Fault, Pose, RobotBase, RobotCommand, RobotEvent, RobotState, SceneDef, SimState, StepResult, Target, TargetRef } from './types';
import { fk } from './kinematics/fk';
import { poseToM4 } from './kinematics/arm';
import { restartSeeds, solveIK } from './kinematics/ik';
import { fixtureBoxes, objectSamplePoints, type OBB } from './collision/shapes';
import { capsulesClash, checkCollision, pointsInCapsules, worldCapsules, type Capsule } from './collision/check';
import { isFault, planMoveJ, planMoveL, planSyncMove, sampleTrajectory, type SyncArm, type Trajectory } from './planner/motion';
import { dropObject, findGraspable, holdersOf, objFromDef, tiltOf } from './world/objects';
import { stepConveyors } from './world/conveyor';
import { stepPouring } from './world/pour';
import { stepSensors } from './world/sensors';

export const DT = 0.001;
const GRIPPER_TIME = 0.4;
/** Time resolution of the arm-vs-arm pre-check (s). */
const CLASH_DT = 0.01;

export function m4ToPose(m: M4): Pose {
  const [a, b, c] = toEulerXYZ(m);
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  return { x: r(m[12] * 1000), y: r(m[13] * 1000), z: r(m[14] * 1000), rx: r(a / DEG), ry: r(b / DEG), rz: r(c / DEG) };
}

/** One arm in the cell. Single-arm cells use one robot with id "A" and an identity base. */
export interface RobotSetup { id: string; arm: ArmDef; base?: RobotBase; label?: string; color?: string; targets?: Record<string, Pose> }
interface Unit { id: string; arm: ArmDef; base: M4; baseInv: M4; yaw: number; boxes: OBB[]; sceneTargets: Record<string, Pose>; label: string; color?: string }

const baseMatrix = (b?: RobotBase): M4 => (b ? mul(trans(b.x / 1000, b.y / 1000, b.z / 1000), rotZ(b.rz * DEG)) : I4());
const SEG = (seg: number) => (seg === 99 ? 'gripper' : seg === -1 ? 'held part' : `link ${seg + 1}`);

export class SimCore {
  readonly scene: SceneDef;
  readonly setup: RobotSetup[];
  /** Robot ids in a fixed order; the first is the default target of commands without `robot`. */
  readonly robotIds: string[];
  readonly primary: string;
  /** Fixture boxes in world coordinates. */
  readonly boxes: OBB[];
  private units: Record<string, Unit> = {};
  s: SimState;
  private trajs: Record<string, Trajectory | null> = {};

  constructor(scene: SceneDef, arms: ArmDef | RobotSetup[], opts: { seed: number; state?: SimState }) {
    this.scene = scene;
    this.setup = Array.isArray(arms) ? arms : [{ id: 'A', arm: arms, targets: scene.sceneTargets }];
    if (!this.setup.length) throw new Error('SimCore needs at least one robot');
    this.robotIds = this.setup.map((r) => r.id);
    this.primary = this.robotIds[0];
    this.boxes = fixtureBoxes(scene.fixtures);
    for (const r of this.setup) {
      const base = baseMatrix(r.base);
      const baseInv = invRigid(base);
      const yaw = (r.base?.rz ?? 0) * DEG;
      const boxes = r.base ? this.boxes.map((b) => ({ ...b, center: apply(baseInv, b.center), yaw: b.yaw - yaw })) : this.boxes;
      this.units[r.id] = { id: r.id, arm: r.arm, base, baseInv, yaw, boxes, sceneTargets: r.targets ?? {}, label: r.label ?? (this.setup.length > 1 ? `Arm ${r.id}` : r.arm.name), color: r.color };
      this.trajs[r.id] = null;
    }
    if (opts.state) { this.s = structuredClone(opts.state); return; }
    const objects = scene.objects.map(objFromDef);
    this.s = {
      simTime: 0,
      robots: Object.fromEntries(this.setup.map((r) => [r.id, { q: r.arm.home.slice(), gripperOpen: true, holding: null, active: null, targets: {} } satisfies RobotState])),
      objects,
      inputs: Object.fromEntries(scene.io.inputs.map((i) => [i.name, i.initial])),
      outputs: Object.fromEntries(scene.io.outputs.map((o) => [o.name, o.initial])),
      conveyors: Object.fromEntries(scene.conveyors.map((c) => [c.id, { nextSpawn: 0, spawned: 0 }])),
      rng: opts.seed >>> 0, spilled: 0, faults: [], spawnCounter: 0,
      totalLiquid: objects.reduce((sum, o) => sum + (o.container ? o.container.fill * o.container.capacity : 0), 0),
    };
    stepSensors(this.s, scene);
    stepConveyors(this.s, scene.conveyors, 0);
  }

  clone(): SimCore {
    const c = new SimCore(this.scene, this.setup, { seed: 0, state: this.s });
    c.trajs = structuredClone(this.trajs);
    return c;
  }
  snapshot(): SimState { return structuredClone(this.s); }

  // ---------------- robots
  get multi() { return this.robotIds.length > 1; }
  /** The first robot's arm (the only arm in single-arm cells). */
  get arm(): ArmDef { return this.units[this.primary].arm; }
  armOf(id = this.primary): ArmDef { return this.unit(id).arm; }
  label(id = this.primary): string { return this.unit(id).label; }
  color(id = this.primary): string | undefined { return this.unit(id).color; }
  /** Arm mount transform (base frame → world). */
  baseOf(id = this.primary): M4 { return this.unit(id).base; }
  private unit(id: string): Unit {
    const u = this.units[id];
    if (!u) throw new Error(`Unknown robot ${id}`);
    return u;
  }
  /** Live state of one robot (joints, gripper, holding, active command, taught targets). */
  rs(id = this.primary): RobotState { return this.s.robots[id]; }
  busy(id?: string): boolean { return id ? !!this.s.robots[id]?.active : Object.values(this.s.robots).some((r) => r.active); }

  // ---------------- queries
  get simTime() { return this.s.simTime; }
  /** TCP in the robot's base frame. */
  tcp(id = this.primary): M4 { return fk(this.unit(id).arm, this.rs(id).q).tcp; }
  tcpWorld(id = this.primary): M4 { return mul(this.unit(id).base, this.tcp(id)); }
  tcpPose(id = this.primary): Pose { return m4ToPose(this.tcp(id)); }
  jointsDisplay(id = this.primary): number[] {
    return this.rs(id).q.map((v, i) => (this.jointType(i, id) === 'P' ? v * 1000 : v / DEG));
  }
  jointType(i: number, id = this.primary) { return this.unit(id).arm.links.find((l) => l.joint?.index === i)!.joint!.type; }
  allTargets(id = this.primary): Record<string, Target> {
    const sceneT = Object.fromEntries(Object.entries(this.unit(id).sceneTargets).map(([name, pose]) => [name, { name, pose, source: 'scene' as const }]));
    return { ...sceneT, ...this.rs(id).targets };
  }
  setTargets(t: Record<string, Target>, id = this.primary) { this.rs(id).targets = structuredClone(t); }

  resolveTarget(ref: TargetRef, id = this.primary): { pose: Pose; q?: number[] } | Fault {
    if (typeof ref === 'string') {
      const t = this.allTargets(id)[ref];
      if (!t) return { code: 'INVALID_ARG', message: `Unknown target “${ref}”${this.multi ? ` for ${this.label(id)}` : ''}. Teach it first or check the name.` };
      return { pose: t.pose, q: t.q };
    }
    if (!ref || ['x', 'y', 'z', 'rx', 'ry', 'rz'].some((k) => typeof (ref as unknown as Record<string, unknown>)[k] !== 'number' || !isFinite((ref as unknown as Record<string, number>)[k])))
      return { code: 'INVALID_ARG', message: 'A pose needs numeric x, y, z (mm) and rx, ry, rz (degrees).' };
    return { pose: ref };
  }

  private heldInfo(id: string) {
    const h = this.rs(id).holding;
    if (!h) return null;
    const o = this.s.objects.find((x) => x.id === h.id)!;
    return { rel: h.rel, size: o.size };
  }

  private fault(f: Fault, id?: string): { ok: false; fault: Fault } {
    const full = this.multi && id && !f.robot ? { ...f, robot: id } : f;
    this.s.faults.push(full);
    return { ok: false, fault: full };
  }

  /** A robot that holds a shared or two-handed part may only move in a synced move (SPEC §21.3). */
  private graspCheck(id: string): Fault | null {
    const h = this.rs(id).holding;
    if (!h) return null;
    const o = this.s.objects.find((x) => x.id === h.id);
    const holders = holdersOf(this.s, h.id);
    if (holders.length > 1) {
      const names = holders.map((r) => this.label(r)).join(' and ');
      return { code: 'SHARED_GRASP', message: `${names} are both holding “${h.id}”, so ${this.label(id)} can’t move it alone. Open one gripper, or use “Move together”.` };
    }
    if (o?.twoHanded) return { code: 'NEEDS_TWO_HANDS', message: `“${h.id}” is too wide for one gripper. Grip it with both arms, then lift it with “Move together”.` };
    return null;
  }

  // ---------------- command execution
  /** Validate + plan a command for one robot. Instant commands complete immediately (done=true). */
  begin(cmd: RobotCommand): { ok: true; done: boolean; value?: unknown } | { ok: false; fault: Fault } {
    const id = cmd.robot ?? this.primary;
    if (!this.units[id]) return this.fault({ code: 'INVALID_ARG', message: `Unknown robot “${id}”.` });
    const u = this.unit(id), r = this.rs(id);
    if (r.active) return this.fault({ code: 'INVALID_ARG', message: 'A command is already running.' }, id);
    const speed = 'speed' in cmd && cmd.speed !== undefined ? cmd.speed : 50;
    if (typeof speed !== 'number' || !(speed > 0 && speed <= 100)) return this.fault({ code: 'INVALID_ARG', message: 'Speed must be a percentage between 1 and 100.' }, id);
    const ctx = { arm: u.arm, boxes: u.boxes, held: this.heldInfo(id), speedPct: speed };
    const start = (motion?: Trajectory, until?: number, onDone?: { gripper?: 'open' | 'close' }) => {
      if (motion) {
        const clash = this.armClash({ [id]: motion });
        if (clash) return this.fault(clash, id);
      }
      this.trajs[id] = motion ?? null;
      r.active = { cmd, startTime: this.s.simTime, until, onDone, motion: !!motion };
      return { ok: true as const, done: false };
    };
    switch (cmd.op) {
      case 'home':
      case 'moveJoints':
      case 'moveJ': {
        const g = this.graspCheck(id);
        if (g) return this.fault(g, id);
        let q1: number[];
        if (cmd.op === 'home') q1 = u.arm.home.slice();
        else if (cmd.op === 'moveJoints') {
          if (!Array.isArray(cmd.jointsDeg) || cmd.jointsDeg.length !== u.arm.dof || cmd.jointsDeg.some((v) => typeof v !== 'number' || !isFinite(v)))
            return this.fault({ code: 'INVALID_ARG', message: `moveJoints needs ${u.arm.dof} joint values.` }, id);
          q1 = cmd.jointsDeg.map((v, i) => (this.jointType(i, id) === 'P' ? v / 1000 : v * DEG));
        } else {
          const t = this.resolveTarget(cmd.target, id);
          if (isFault(t)) return this.fault(t, id);
          if (t.q && t.q.length === u.arm.dof) q1 = t.q;
          else {
            const ik = solveIK(u.arm, poseToM4(t.pose), r.q, { restarts: [u.arm.home, ...restartSeeds(u.arm)] });
            if (!ik.ok) return this.fault(ik.reason === 'JOINT_LIMIT'
              ? { code: 'JOINT_LIMIT', message: 'The target is only reachable by exceeding a joint limit.' }
              : { code: 'UNREACHABLE', message: `The target (x ${t.pose.x}, y ${t.pose.y}, z ${t.pose.z}) is outside the workspace for this orientation.` }, id);
            q1 = ik.q;
          }
        }
        const tr = planMoveJ(ctx, r.q, q1);
        if (isFault(tr)) return this.fault(tr, id);
        return start(tr);
      }
      case 'moveL': {
        const g = this.graspCheck(id);
        if (g) return this.fault(g, id);
        const t = this.resolveTarget(cmd.target, id);
        if (isFault(t)) return this.fault(t, id);
        const tr = planMoveL(ctx, r.q, poseToM4(t.pose));
        if (isFault(tr)) return this.fault(tr, id);
        return start(tr);
      }
      case 'gripper':
        if (cmd.action !== 'open' && cmd.action !== 'close') return this.fault({ code: 'INVALID_ARG', message: 'Gripper action must be open or close.' }, id);
        return start(undefined, this.s.simTime + GRIPPER_TIME, { gripper: cmd.action });
      case 'wait':
        if (typeof cmd.ms !== 'number' || !(cmd.ms >= 0)) return this.fault({ code: 'INVALID_ARG', message: 'wait() needs a non-negative number of milliseconds.' }, id);
        return start(undefined, this.s.simTime + cmd.ms / 1000);
      case 'waitInput': {
        if (!(cmd.name in this.s.inputs)) return this.fault({ code: 'INVALID_ARG', message: `Unknown input “${cmd.name}”. Available: ${Object.keys(this.s.inputs).join(', ')}.` }, id);
        if (this.s.inputs[cmd.name] === cmd.value) return { ok: true, done: true };
        return start(undefined, cmd.timeoutMs !== undefined ? this.s.simTime + cmd.timeoutMs / 1000 : undefined);
      }
      case 'setOutput':
        if (!(cmd.name in this.s.outputs)) return this.fault({ code: 'INVALID_ARG', message: `Unknown output “${cmd.name}”. Available: ${Object.keys(this.s.outputs).join(', ')}.` }, id);
        this.s.outputs[cmd.name] = cmd.value;
        return { ok: true, done: true };
      case 'query':
        switch (cmd.what) {
          case 'pose': return { ok: true, done: true, value: this.tcpPose(id) };
          case 'joints': return { ok: true, done: true, value: this.jointsDisplay(id).map((v) => Math.round(v * 100) / 100) };
          case 'holding': return { ok: true, done: true, value: r.holding?.id ?? null };
          case 'input':
            if (!cmd.name || !(cmd.name in this.s.inputs)) return this.fault({ code: 'INVALID_ARG', message: `Unknown input “${cmd.name}”.` }, id);
            return { ok: true, done: true, value: this.s.inputs[cmd.name] };
        }
        return this.fault({ code: 'INVALID_ARG', message: 'Unknown query.' }, id);
      case 'sync':
        return this.fault({ code: 'INVALID_ARG', message: 'Sync commands are coordinated by the run scheduler.' }, id);
      default:
        return this.fault({ code: 'INVALID_ARG', message: `Unknown command.` }, id);
    }
  }

  /**
   * Synced move (SPEC §21.3): `leader` moves in a straight line to `target`, every follower keeps its offset to
   * the leader's TCP, so parts held by several arms move rigidly. All arms must be idle.
   */
  beginSync(leader: string, cmd: { target: TargetRef; speed?: number }, followers: string[]): { ok: true } | { ok: false; fault: Fault } {
    const group = [leader, ...followers];
    for (const id of group) {
      if (!this.units[id]) return this.fault({ code: 'INVALID_ARG', message: `Unknown robot “${id}”.` });
      if (this.rs(id).active) return this.fault({ code: 'INVALID_ARG', message: 'A command is already running.' }, id);
    }
    const speed = cmd.speed ?? 50;
    if (typeof speed !== 'number' || !(speed > 0 && speed <= 100)) return this.fault({ code: 'INVALID_ARG', message: 'Speed must be a percentage between 1 and 100.' }, leader);
    const t = this.resolveTarget(cmd.target, leader);
    if (isFault(t)) return this.fault(t, leader);
    // every part held by a group member must be held only by group members, and two-handed parts by at least two
    for (const id of group) {
      const h = this.rs(id).holding;
      if (!h) continue;
      const holders = holdersOf(this.s, h.id);
      const outsider = holders.find((x) => !group.includes(x));
      if (outsider) return this.fault({ code: 'SHARED_GRASP', message: `${this.label(outsider)} is also holding “${h.id}” but isn’t part of this move together.` }, outsider);
      const o = this.s.objects.find((x) => x.id === h.id);
      if (o?.twoHanded && holders.length < 2) return this.fault({ code: 'NEEDS_TWO_HANDS', message: `“${h.id}” is too wide for one gripper. Close both arms’ grippers on it before moving together.` }, id);
    }
    const arm = (id: string): SyncArm => {
      const u = this.unit(id);
      return { id, base: u.base, q0: this.rs(id).q, ctx: { arm: u.arm, boxes: u.boxes, held: this.heldInfo(id), speedPct: speed } };
    };
    const plan = planSyncMove(arm(leader), poseToM4(t.pose), followers.map(arm));
    if (isFault(plan)) { const { robot, ...f } = plan; return this.fault(f, robot); }
    const clash = this.armClash(plan.trajs);
    if (clash) return this.fault(clash, leader);
    for (const id of group) {
      this.trajs[id] = plan.trajs[id];
      const c: RobotCommand = id === leader ? { op: 'sync', kind: 'move', target: cmd.target, speed, robot: id } : { op: 'sync', kind: 'follow', robot: id };
      this.rs(id).active = { cmd: c, startTime: this.s.simTime, motion: true };
    }
    return { ok: true };
  }

  /**
   * Arm-vs-arm pre-check (SPEC §21.3 / D8): sample the new motions over time against every other arm's committed
   * motion (or its resting pose), including parts the arms hold. Returns an ARM_COLLISION fault or null.
   */
  private armClash(newTrajs: Record<string, Trajectory>): Fault | null {
    if (!this.multi) return null;
    const ids = this.robotIds;
    const now = this.s.simTime;
    const T = Math.max(0, ...Object.values(newTrajs).map((t) => t.profile.T));
    const qAt = (id: string, dt: number): number[] => {
      if (newTrajs[id]) return sampleTrajectory(newTrajs[id], dt).q;
      const tr = this.trajs[id], a = this.rs(id).active;
      if (tr && a) return sampleTrajectory(tr, now + dt - a.startTime).q;
      return this.rs(id).q;
    };
    // static parts of the check: who holds what, and which pairs need checking
    const held = ids.map((id) => {
      const h = this.rs(id).holding;
      const o = h && this.s.objects.find((x) => x.id === h.id);
      return h && o ? { id, obj: o.id, rel: h.rel, size: o.size, holders: holdersOf(this.s, o.id) } : null;
    });
    for (let t = 0; ; t += CLASH_DT) {
      const tt = Math.min(t, T);
      const qs = ids.map((id) => qAt(id, tt));
      const caps: Capsule[][] = ids.map((id, i) => worldCapsules(this.unit(id).arm, this.unit(id).base, qs[i]));
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        if (!newTrajs[ids[i]] && !newTrajs[ids[j]]) continue;
        // grippers closed on the same part sit next to each other by design
        const share = held[i] && held[j] && held[i]!.obj === held[j]!.obj;
        const a = share ? caps[i].filter((c) => c.seg !== 99) : caps[i];
        const b = share ? caps[j].filter((c) => c.seg !== 99) : caps[j];
        const hit = capsulesClash(a, b);
        if (hit) return this.clashFault(ids[i], ids[j], hit.segA, hit.segB, tt, now);
      }
      for (let i = 0; i < ids.length; i++) {
        const h = held[i];
        if (!h || h.holders[0] !== ids[i]) continue; // the first holder carries the part
        const pose = mul(mul(this.unit(ids[i]).base, fk(this.unit(ids[i]).arm, qs[i]).tcp), h.rel);
        const pts = objectSamplePoints(pose, h.size);
        for (let j = 0; j < ids.length; j++) {
          if (h.holders.includes(ids[j])) continue;
          if (!h.holders.some((x) => newTrajs[x]) && !newTrajs[ids[j]]) continue;
          // grippers may touch parts (as with any loose part); arm links may not
          const hit = pointsInCapsules(pts, caps[j].filter((c) => c.seg !== 99));
          if (hit) return this.clashFault(ids[i], ids[j], -1, hit.seg, tt, now);
        }
      }
      if (tt >= T) return null;
    }
  }

  private clashFault(a: string, b: string, segA: number, segB: number, dt: number, now: number): Fault {
    const when = dt < CLASH_DT ? 'right away' : `${dt.toFixed(1)} s into the move`;
    return {
      code: 'ARM_COLLISION',
      message: `${this.label(a)} and ${this.label(b)} would hit each other ${when} (${SEG(segA)} of ${this.label(a)}, ${SEG(segB)} of ${this.label(b)}).`,
      detail: { arms: [a, b], atSimTime: Math.round((now + dt) * 1000) / 1000, links: [segA, segB] },
    };
  }

  /** Advance simulated time for every active command; stops early at the first substep where any command ends. */
  stepAll(dtSec: number): { active: boolean; events: RobotEvent[] } {
    if (!this.busy()) return { active: false, events: [] };
    let remaining = dtSec;
    while (remaining > 1e-9) {
      const h = Math.min(DT, remaining);
      remaining -= h;
      const ev = this.substep(h);
      if (ev.length) return { active: this.busy(), events: ev };
    }
    return { active: true, events: [] };
  }

  /** Single-robot stepping (manual moves, tests): the first robot event, or running/idle. */
  step(dtSec: number): StepResult {
    if (!this.busy()) return { status: 'idle' };
    const r = this.stepAll(dtSec);
    const e = r.events[0];
    if (e) return e.status === 'done' ? { status: 'done', value: e.value } : { status: 'fault', fault: e.fault };
    return { status: 'running' };
  }

  private substep(h: number): RobotEvent[] {
    const s = this.s;
    s.simTime += h;
    for (const id of this.robotIds) {
      const tr = this.trajs[id], a = s.robots[id].active;
      if (!tr || !a) continue;
      const smp = sampleTrajectory(tr, s.simTime - a.startTime);
      s.robots[id].q = smp.q;
      if (smp.done) { this.trajs[id] = null; a.motion = false; }
    }
    this.worldStep(h);
    const events: RobotEvent[] = [];
    for (const id of this.robotIds) {
      const r = s.robots[id];
      const a = r.active;
      if (!a) continue;
      const c = a.cmd;
      const done = (value?: unknown) => { r.active = null; events.push({ robot: id, status: 'done', value }); };
      if ((c.op === 'moveJ' || c.op === 'moveL' || c.op === 'moveJoints' || c.op === 'home' || c.op === 'sync') && !this.trajs[id]) done();
      else if (c.op === 'wait' && s.simTime >= a.until! - 1e-9) done();
      else if (c.op === 'gripper' && s.simTime >= a.until! - 1e-9) { this.applyGripper(c.action, id); done(); }
      else if (c.op === 'waitInput') {
        if (s.inputs[c.name] === c.value) done();
        else if (a.until !== undefined && s.simTime >= a.until - 1e-9) {
          r.active = null;
          const f: Fault = { code: 'TIMEOUT', message: `Input “${c.name}” did not become ${JSON.stringify(c.value)} within ${c.timeoutMs} ms.`, ...(this.multi ? { robot: id } : {}) };
          s.faults.push(f);
          events.push({ robot: id, status: 'fault', fault: f });
        }
      }
    }
    return events;
  }

  private worldStep(h: number) {
    const s = this.s;
    const done = new Set<string>();
    for (const id of this.robotIds) {
      const hold = s.robots[id].holding;
      if (!hold || done.has(hold.id)) continue;
      done.add(hold.id);
      const holders = holdersOf(s, hold.id);
      const driver = holders.find((x) => this.trajs[x]) ?? holders[0];
      const o = s.objects.find((x) => x.id === hold.id);
      if (o) o.pose = mul(this.tcpWorld(driver), s.robots[driver].holding!.rel);
    }
    stepConveyors(s, this.scene.conveyors, h);
    stepPouring(s, h);
    stepSensors(s, this.scene);
  }

  private applyGripper(action: 'open' | 'close', id: string) {
    const s = this.s;
    const r = s.robots[id];
    if (action === 'close') {
      r.gripperOpen = false;
      if (!r.holding) {
        const tcp = this.tcpWorld(id);
        const o = findGraspable(s, this.unit(id).arm, tcp, id);
        if (o) {
          const before = holdersOf(s, o.id);
          r.holding = { id: o.id, rel: mul(invRigid(tcp), o.pose) };
          o.onConveyor = null;
          if (!o.twoHanded) for (const from of before) (o.handovers ??= []).push({ from, to: id });
        }
      }
    } else {
      r.gripperOpen = true;
      if (r.holding) {
        const oid = r.holding.id;
        r.holding = null;
        const o = s.objects.find((x) => x.id === oid);
        const rest = holdersOf(s, oid);
        // a two-handed part can't hang from one gripper: letting go with one arm drops it
        if (o?.twoHanded) for (const x of rest) s.robots[x].holding = null;
        if (o && (!rest.length || o.twoHanded)) dropObject(s, o, this.boxes);
      }
    }
  }

  /** Halt in place (kinematic arms → instantaneous). Without an id, every robot stops. */
  stopNow(id?: string) {
    for (const r of id ? [id] : this.robotIds) { if (this.s.robots[r]) this.s.robots[r].active = null; this.trajs[r] = null; }
  }

  // ---------------- direct manipulation (jog / hand-guide)
  setJoints(q: number[], id = this.primary): Fault | null {
    const u = this.unit(id);
    for (let i = 0; i < u.arm.dof; i++) {
      const l = u.arm.limits[i];
      if (q[i] < l.min || q[i] > l.max) return { code: 'JOINT_LIMIT', message: `Joint ${i + 1} limit reached.` };
    }
    const g = this.graspCheck(id);
    if (g) return g;
    const held = this.heldInfo(id);
    const hit = checkCollision(u.arm, q, u.boxes, held ? { pose: mul(fk(u.arm, q).tcp, held.rel), size: held.size } : null);
    if (hit) return { code: 'COLLISION', message: `Blocked by ${hit.fixture.split(':')[0]}.` };
    if (this.multi) {
      const mine = worldCapsules(u.arm, u.base, q);
      for (const other of this.robotIds) {
        if (other === id) continue;
        const ou = this.unit(other);
        if (capsulesClash(mine, worldCapsules(ou.arm, ou.base, this.rs(other).q))) return { code: 'ARM_COLLISION', message: `Blocked by ${this.label(other)}.` };
      }
    }
    this.rs(id).q = q.slice();
    this.worldStep(0);
    return null;
  }
  /** Move TCP (base frame) to pose via IK seeded at current q (jog / hand guide). */
  moveTcpTo(target: M4, maxIter = 40, id = this.primary): Fault | null {
    const u = this.unit(id), q0 = this.rs(id).q;
    const r = solveIK(u.arm, target, q0, { maxIter });
    if (!r.ok) return { code: r.reason, message: r.reason === 'JOINT_LIMIT' ? 'Joint limit reached.' : 'Out of reach.' };
    const jump = Math.max(...r.q.map((v, i) => Math.abs(v - q0[i])));
    if (jump > 30 * DEG) return { code: 'SINGULARITY', message: 'Near a singularity — the arm would flip.' };
    return this.setJoints(r.q, id);
  }
  gripperNow(action: 'open' | 'close', id = this.primary) { this.applyGripper(action, id); this.worldStep(0); }

  // ---------------- views
  private robotView(id: string): AgentRobotView {
    const r = this.rs(id);
    return {
      arm: this.unit(id).arm.id, jointsDeg: this.jointsDisplay(id).map((v) => Math.round(v * 10) / 10), tcp: this.tcpPose(id),
      gripper: r.gripperOpen ? 'open' : 'closed', holding: r.holding?.id ?? null,
    };
  }
  agentView(): AgentStateView {
    const s = this.s;
    const r = (v: number) => Math.round(v * 1000);
    return {
      simTimeSec: Math.round(s.simTime * 1000) / 1000,
      robot: this.robotView(this.primary),
      ...(this.multi ? { robots: this.robotIds.map((id) => ({ id, label: this.label(id), ...this.robotView(id) })) } : {}),
      objects: s.objects.map((o) => {
        const p = pos(o.pose);
        return { id: o.id, kind: o.kind, color: o.color, position: [r(p[0]), r(p[1]), r(p[2])] as [number, number, number], upright: !o.toppled && tiltOf(o) < 10 * DEG, ...(o.container ? { fill: Math.round(o.container.fill * 100) / 100 } : {}) };
      }),
      inputs: { ...s.inputs }, outputs: { ...s.outputs },
      lastFault: s.faults[s.faults.length - 1] ?? null,
    };
  }
}
