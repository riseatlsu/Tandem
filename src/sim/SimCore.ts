import { DEG, invRigid, mul, pos, toEulerXYZ, type M4 } from './math/mat4';
import type { AgentStateView, ArmDef, Fault, Pose, RobotCommand, SceneDef, SimState, StepResult, Target, TargetRef } from './types';
import { fk } from './kinematics/fk';
import { poseToM4 } from './kinematics/arm';
import { restartSeeds, solveIK } from './kinematics/ik';
import { fixtureBoxes, type OBB } from './collision/shapes';
import { checkCollision } from './collision/check';
import { isFault, planMoveJ, planMoveL, sampleTrajectory, type Trajectory } from './planner/motion';
import { dropObject, findGraspable, objFromDef, tiltOf } from './world/objects';
import { stepConveyors } from './world/conveyor';
import { stepPouring } from './world/pour';
import { stepSensors } from './world/sensors';

export const DT = 0.001;
const GRIPPER_TIME = 0.4;

export function m4ToPose(m: M4): Pose {
  const [a, b, c] = toEulerXYZ(m);
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  return { x: r(m[12] * 1000), y: r(m[13] * 1000), z: r(m[14] * 1000), rx: r(a / DEG), ry: r(b / DEG), rz: r(c / DEG) };
}

export class SimCore {
  readonly scene: SceneDef;
  readonly arm: ArmDef;
  readonly boxes: OBB[];
  s: SimState;
  private traj: Trajectory | null = null;

  constructor(scene: SceneDef, arm: ArmDef, opts: { seed: number; state?: SimState }) {
    this.scene = scene;
    this.arm = arm;
    this.boxes = fixtureBoxes(scene.fixtures);
    if (opts.state) { this.s = structuredClone(opts.state); return; }
    const objects = scene.objects.map(objFromDef);
    this.s = {
      simTime: 0, q: arm.home.slice(), gripperOpen: true, holding: null, objects,
      inputs: Object.fromEntries(scene.io.inputs.map((i) => [i.name, i.initial])),
      outputs: Object.fromEntries(scene.io.outputs.map((o) => [o.name, o.initial])),
      conveyors: Object.fromEntries(scene.conveyors.map((c) => [c.id, { nextSpawn: 0, spawned: 0 }])),
      rng: opts.seed >>> 0, spilled: 0, faults: [], active: null, spawnCounter: 0,
      targets: {},
      totalLiquid: objects.reduce((sum, o) => sum + (o.container ? o.container.fill * o.container.capacity : 0), 0),
    };
    stepSensors(this.s, scene);
    stepConveyors(this.s, scene.conveyors, 0);
  }

  clone(): SimCore {
    const c = new SimCore(this.scene, this.arm, { seed: 0, state: this.s });
    c.traj = this.traj ? structuredClone(this.traj) : null;
    return c;
  }
  snapshot(): SimState { return structuredClone(this.s); }

  // ---------------- queries
  get simTime() { return this.s.simTime; }
  tcp(): M4 { return fk(this.arm, this.s.q).tcp; }
  tcpPose(): Pose { return m4ToPose(this.tcp()); }
  jointsDisplay(): number[] {
    return this.s.q.map((v, i) => (this.jointType(i) === 'P' ? v * 1000 : v / DEG));
  }
  jointType(i: number) { return this.arm.links.find((l) => l.joint?.index === i)!.joint!.type; }
  allTargets(): Record<string, Target> {
    const sceneT = Object.fromEntries(Object.entries(this.scene.sceneTargets).map(([name, pose]) => [name, { name, pose, source: 'scene' as const }]));
    return { ...sceneT, ...this.s.targets };
  }
  setTargets(t: Record<string, Target>) { this.s.targets = structuredClone(t); }

  resolveTarget(ref: TargetRef): { pose: Pose; q?: number[] } | Fault {
    if (typeof ref === 'string') {
      const t = this.allTargets()[ref];
      if (!t) return { code: 'INVALID_ARG', message: `Unknown target “${ref}”. Teach it first or check the name.` };
      return { pose: t.pose, q: t.q };
    }
    if (!ref || ['x', 'y', 'z', 'rx', 'ry', 'rz'].some((k) => typeof (ref as unknown as Record<string, unknown>)[k] !== 'number' || !isFinite((ref as unknown as Record<string, number>)[k])))
      return { code: 'INVALID_ARG', message: 'A pose needs numeric x, y, z (mm) and rx, ry, rz (degrees).' };
    return { pose: ref };
  }

  private heldInfo() {
    if (!this.s.holding) return null;
    const o = this.s.objects.find((x) => x.id === this.s.holding!.id)!;
    return { rel: this.s.holding.rel, size: o.size };
  }

  private fault(f: Fault): { ok: false; fault: Fault } {
    this.s.faults.push(f);
    return { ok: false, fault: f };
  }

  // ---------------- command execution
  /** Validate + plan a command. Instant commands complete immediately (done=true). */
  begin(cmd: RobotCommand): { ok: true; done: boolean; value?: unknown } | { ok: false; fault: Fault } {
    if (this.s.active) return this.fault({ code: 'INVALID_ARG', message: 'A command is already running.' });
    const speed = 'speed' in cmd && cmd.speed !== undefined ? cmd.speed : 50;
    if (typeof speed !== 'number' || !(speed > 0 && speed <= 100)) return this.fault({ code: 'INVALID_ARG', message: 'Speed must be a percentage between 1 and 100.' });
    const ctx = { arm: this.arm, boxes: this.boxes, held: this.heldInfo(), speedPct: speed };
    const start = (motion?: Trajectory, until?: number, onDone?: { gripper?: 'open' | 'close' }) => {
      this.traj = motion ?? null;
      this.s.active = { cmd, startTime: this.s.simTime, until, onDone, motion: motion ? { kind: 'path', times: [], qs: [], t: 0 } : undefined };
      return { ok: true as const, done: false };
    };
    switch (cmd.op) {
      case 'home':
      case 'moveJoints':
      case 'moveJ': {
        let q1: number[];
        if (cmd.op === 'home') q1 = this.arm.home.slice();
        else if (cmd.op === 'moveJoints') {
          if (!Array.isArray(cmd.jointsDeg) || cmd.jointsDeg.length !== this.arm.dof || cmd.jointsDeg.some((v) => typeof v !== 'number' || !isFinite(v)))
            return this.fault({ code: 'INVALID_ARG', message: `moveJoints needs ${this.arm.dof} joint values.` });
          q1 = cmd.jointsDeg.map((v, i) => (this.jointType(i) === 'P' ? v / 1000 : v * DEG));
        } else {
          const t = this.resolveTarget(cmd.target);
          if (isFault(t)) return this.fault(t);
          if (t.q && t.q.length === this.arm.dof) q1 = t.q;
          else {
            const r = solveIK(this.arm, poseToM4(t.pose), this.s.q, { restarts: [this.arm.home, ...restartSeeds(this.arm)] });
            if (!r.ok) return this.fault(r.reason === 'JOINT_LIMIT'
              ? { code: 'JOINT_LIMIT', message: 'The target is only reachable by exceeding a joint limit.' }
              : { code: 'UNREACHABLE', message: `The target (x ${t.pose.x}, y ${t.pose.y}, z ${t.pose.z}) is outside the workspace for this orientation.` });
            q1 = r.q;
          }
        }
        const tr = planMoveJ(ctx, this.s.q, q1);
        if (isFault(tr)) return this.fault(tr);
        return start(tr);
      }
      case 'moveL': {
        const t = this.resolveTarget(cmd.target);
        if (isFault(t)) return this.fault(t);
        const tr = planMoveL(ctx, this.s.q, poseToM4(t.pose));
        if (isFault(tr)) return this.fault(tr);
        return start(tr);
      }
      case 'gripper':
        if (cmd.action !== 'open' && cmd.action !== 'close') return this.fault({ code: 'INVALID_ARG', message: 'Gripper action must be open or close.' });
        return start(undefined, this.s.simTime + GRIPPER_TIME, { gripper: cmd.action });
      case 'wait':
        if (typeof cmd.ms !== 'number' || !(cmd.ms >= 0)) return this.fault({ code: 'INVALID_ARG', message: 'wait() needs a non-negative number of milliseconds.' });
        return start(undefined, this.s.simTime + cmd.ms / 1000);
      case 'waitInput': {
        if (!(cmd.name in this.s.inputs)) return this.fault({ code: 'INVALID_ARG', message: `Unknown input “${cmd.name}”. Available: ${Object.keys(this.s.inputs).join(', ')}.` });
        if (this.s.inputs[cmd.name] === cmd.value) return { ok: true, done: true };
        return start(undefined, cmd.timeoutMs !== undefined ? this.s.simTime + cmd.timeoutMs / 1000 : undefined);
      }
      case 'setOutput':
        if (!(cmd.name in this.s.outputs)) return this.fault({ code: 'INVALID_ARG', message: `Unknown output “${cmd.name}”. Available: ${Object.keys(this.s.outputs).join(', ')}.` });
        this.s.outputs[cmd.name] = cmd.value;
        return { ok: true, done: true };
      case 'query':
        switch (cmd.what) {
          case 'pose': return { ok: true, done: true, value: this.tcpPose() };
          case 'joints': return { ok: true, done: true, value: this.jointsDisplay().map((v) => Math.round(v * 100) / 100) };
          case 'holding': return { ok: true, done: true, value: this.s.holding?.id ?? null };
          case 'input':
            if (!cmd.name || !(cmd.name in this.s.inputs)) return this.fault({ code: 'INVALID_ARG', message: `Unknown input “${cmd.name}”.` });
            return { ok: true, done: true, value: this.s.inputs[cmd.name] };
        }
        return this.fault({ code: 'INVALID_ARG', message: 'Unknown query.' });
      default:
        return this.fault({ code: 'INVALID_ARG', message: `Unknown command.` });
    }
  }

  /** Advance simulated time while a command is active. Time is frozen when idle (see SPEC §6.1). */
  step(dtSec: number): StepResult {
    if (!this.s.active) return { status: 'idle' };
    let remaining = dtSec;
    while (remaining > 1e-9) {
      const h = Math.min(DT, remaining);
      remaining -= h;
      const r = this.substep(h);
      if (r) return r;
    }
    return { status: 'running' };
  }

  private substep(h: number): StepResult | null {
    const s = this.s;
    const a = s.active!;
    s.simTime += h;
    if (this.traj) {
      const smp = sampleTrajectory(this.traj, s.simTime - a.startTime);
      s.q = smp.q;
      if (smp.done) { this.traj = null; a.motion = undefined; }
    }
    this.worldStep(h);
    // completion
    const c = a.cmd;
    if ((c.op === 'moveJ' || c.op === 'moveL' || c.op === 'moveJoints' || c.op === 'home') && !this.traj) return this.finish();
    if (c.op === 'wait' && s.simTime >= a.until! - 1e-9) return this.finish();
    if (c.op === 'gripper' && s.simTime >= a.until! - 1e-9) {
      this.applyGripper(c.action);
      return this.finish();
    }
    if (c.op === 'waitInput') {
      if (s.inputs[c.name] === c.value) return this.finish();
      if (a.until !== undefined && s.simTime >= a.until - 1e-9) {
        s.active = null;
        const f: Fault = { code: 'TIMEOUT', message: `Input “${c.name}” did not become ${JSON.stringify(c.value)} within ${c.timeoutMs} ms.` };
        s.faults.push(f);
        return { status: 'fault', fault: f };
      }
    }
    return null;
  }

  private finish(value?: unknown): StepResult { this.s.active = null; return { status: 'done', value }; }

  private worldStep(h: number) {
    const s = this.s;
    if (s.holding) {
      const o = s.objects.find((x) => x.id === s.holding!.id);
      if (o) o.pose = mul(this.tcp(), s.holding.rel);
    }
    stepConveyors(s, this.scene.conveyors, h);
    stepPouring(s, h);
    stepSensors(s, this.scene);
  }

  private applyGripper(action: 'open' | 'close') {
    const s = this.s;
    if (action === 'close') {
      s.gripperOpen = false;
      if (!s.holding) {
        const tcp = this.tcp();
        const o = findGraspable(s, this.arm, tcp);
        if (o) { s.holding = { id: o.id, rel: mul(invRigid(tcp), o.pose) }; o.onConveyor = null; }
      }
    } else {
      s.gripperOpen = true;
      if (s.holding) {
        const o = s.objects.find((x) => x.id === s.holding!.id);
        s.holding = null;
        if (o) dropObject(s, o, this.boxes);
      }
    }
  }

  /** Halt in place (kinematic arm → instantaneous). */
  stopNow() { this.s.active = null; this.traj = null; }

  // ---------------- direct manipulation (jog / hand-guide)
  setJoints(q: number[]): Fault | null {
    for (let i = 0; i < this.arm.dof; i++) {
      const l = this.arm.limits[i];
      if (q[i] < l.min || q[i] > l.max) return { code: 'JOINT_LIMIT', message: `Joint ${i + 1} limit reached.` };
    }
    const held = this.heldInfo();
    const hit = checkCollision(this.arm, q, this.boxes, held ? { pose: mul(fk(this.arm, q).tcp, held.rel), size: held.size } : null);
    if (hit) return { code: 'COLLISION', message: `Blocked by ${hit.fixture.split(':')[0]}.` };
    this.s.q = q.slice();
    this.worldStep(0);
    return null;
  }
  /** Move TCP to pose via IK seeded at current q (jog / hand guide). */
  moveTcpTo(target: M4, maxIter = 40): Fault | null {
    const r = solveIK(this.arm, target, this.s.q, { maxIter });
    if (!r.ok) return { code: r.reason, message: r.reason === 'JOINT_LIMIT' ? 'Joint limit reached.' : 'Out of reach.' };
    const jump = Math.max(...r.q.map((v, i) => Math.abs(v - this.s.q[i])));
    if (jump > 30 * DEG) return { code: 'SINGULARITY', message: 'Near a singularity — the arm would flip.' };
    return this.setJoints(r.q);
  }
  gripperNow(action: 'open' | 'close') { this.applyGripper(action); this.worldStep(0); }

  // ---------------- views
  agentView(): AgentStateView {
    const s = this.s;
    const r = (v: number) => Math.round(v * 1000);
    return {
      simTimeSec: Math.round(s.simTime * 1000) / 1000,
      robot: {
        arm: this.arm.id, jointsDeg: this.jointsDisplay().map((v) => Math.round(v * 10) / 10), tcp: this.tcpPose(),
        gripper: s.gripperOpen ? 'open' : 'closed', holding: s.holding?.id ?? null,
      },
      objects: s.objects.map((o) => {
        const p = pos(o.pose);
        return { id: o.id, kind: o.kind, color: o.color, position: [r(p[0]), r(p[1]), r(p[2])] as [number, number, number], upright: !o.toppled && tiltOf(o) < 10 * DEG, ...(o.container ? { fill: Math.round(o.container.fill * 100) / 100 } : {}) };
      }),
      inputs: { ...s.inputs }, outputs: { ...s.outputs },
      lastFault: s.faults[s.faults.length - 1] ?? null,
    };
  }
}
