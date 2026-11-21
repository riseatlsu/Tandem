/**
 * Owns the live SimCore + ProgramRunner for the current task and drives them from the render loop.
 * React components talk to it through these functions; the viewport reads `host.sim` every frame.
 */
import { TASKS, robotsFor, sceneForTask, type TaskDef } from './content';
import { DEFAULT_DEMO_MODEL, DEFAULT_MULTI_ARM_MODEL } from './config';
import { SimCore } from './sim/SimCore';
import { evaluateAll } from './sim/predicates/evaluators';
import { DEG, invRigid, mul, rotX, rotY, rotZ, trans, type M4 } from './sim/math/mat4';
import { poseToM4 } from './sim/kinematics/arm';
import type { Fault, PredicateResult, Target } from './sim/types';
import { ProgramRunner } from './runtime/ProgramRunner';
import { consoleLog, currentWorkspace, laneTargets, toast, updateLane, updateWorkspace, useApp, type Workspace } from './store';
import type { ProgramSource } from './runtime/headless';
import { sourceHash } from './runtime/headless';
import { logEvent } from './study/logger';
import type { RunTrace } from './runtime/protocol';

type FrameListener = (sim: SimCore) => void;

class SimHost {
  sim!: SimCore;
  task!: TaskDef;
  private frameListeners = new Set<FrameListener>();
  private lastPred = 0;
  private manual = false; // a UI-initiated motion (Go to target) is running
  runner: ProgramRunner;
  private runCounter = 0;
  lastFaultAt = 0;

  constructor() {
    this.runner = new ProgramRunner(() => this.sim, {
      onState: (s) => useApp.getState().set({ runState: s }),
      onHighlight: (line, blockId, lane) => useApp.getState().set((s) => {
        if (!this.sim.multi || !lane) return { highlight: { line, blockId } };
        if (line === undefined && blockId === undefined) return { highlight: {} };
        return { highlight: { line, blockId, lanes: { ...s.highlight.lanes, [lane]: { line, blockId } } } };
      }),
      onLog: (text, line) => consoleLog(text, 'log', this.sim.simTime, line),
      onEnd: (trace) => this.onRunEnd(trace),
    });
  }

  armId(task = this.task) { return useApp.getState().armOverride ?? task.armId; }

  loadTask(taskId: string) {
    const task = TASKS[taskId];
    if (!task) throw new Error(`Unknown task ${taskId}`);
    this.runner.stop(true);
    this.task = task;
    const st = useApp.getState();
    const robots = sceneForTask(task).robots;
    if (!st.workspaces[taskId]) {
      const presets: Record<string, Target> = Object.fromEntries(Object.entries(task.presetTargets ?? {}).map(([name, pose]) => [name, { name, pose, source: 'preset' as const }]));
      const ws: Workspace = { editor: task.editor, code: task.starter?.code ?? defaultCode(), blocks: null, targets: presets };
      if (robots) ws.lanes = Object.fromEntries(robots.map((r) => [r.id, { code: defaultLaneCode(r.label), targets: {} }]));
      st.set((s) => ({ workspaces: { ...s.workspaces, [taskId]: ws } }));
    }
    this.buildSim();
    // demo: each task starts on its default model (visitors can still switch in the AI partner)
    if (useApp.getState().mode === 'demo') useApp.getState().set({ demoModel: robots ? DEFAULT_MULTI_ARM_MODEL : DEFAULT_DEMO_MODEL });
    useApp.getState().set({ taskId, fault: null, highlight: {}, laneStates: {}, arm: this.sim.primary, lastTrace: null, showSuccess: false, console: [], handGuide: false, taskStartedAt: Date.now(), timeLeftSec: task.timeLimitSec ?? null });
    this.refreshPredicates(true);
    logEvent('task_start', { taskId, armId: this.armId(), editor: currentWorkspace().editor });
  }

  private buildSim() {
    const scene = sceneForTask(this.task);
    this.sim = new SimCore(scene, robotsFor(scene, this.armId()), { seed: this.task.seed });
    this.syncTargets();
  }

  /** Reset the scene to the task's initial state (targets are kept). */
  reset() {
    this.runner.stop(true);
    this.manual = false;
    this.buildSim();
    useApp.getState().set({ fault: null, highlight: {}, showSuccess: false });
    this.refreshPredicates(true);
    logEvent('scene_reset', {});
  }

  setArm(armId: string | null) {
    useApp.getState().set({ armOverride: armId });
    // taught joint configs belong to the previous arm; keep poses only
    const ws = currentWorkspace();
    updateWorkspace({ targets: Object.fromEntries(Object.entries(ws.targets).map(([k, t]) => [k, { ...t, q: undefined }])) });
    this.reset();
  }

  syncTargets() {
    const ws = currentWorkspace();
    for (const r of this.sim.robotIds) this.sim.setTargets(laneTargets(ws, r), r);
  }
  /** The arm Jog, Positions, hand guide and Teach act on. */
  arm(): string {
    const a = useApp.getState().arm;
    return this.sim.robotIds.includes(a) ? a : this.sim.primary;
  }
  selectArm(robot: string) {
    if (!this.sim.robotIds.includes(robot) || useApp.getState().arm === robot) return;
    useApp.getState().set({ arm: robot });
    logEvent('lane_focus', { robot });
  }

  onFrame(fn: FrameListener) { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn); }

  frame(dt: number) {
    if (this.runner.state !== 'idle') {
      this.runner.tick(dt);
      if (this.sim.multi) {
        const ls = this.runner.laneStates();
        const cur = useApp.getState().laneStates;
        if (ls && Object.entries(ls).some(([k, v]) => cur[k] !== v)) useApp.getState().set({ laneStates: ls });
      }
    }
    else if (this.manual && this.sim.busy()) {
      const r = this.sim.step(Math.min(dt, 0.05) * useApp.getState().speed);
      if (r.status !== 'running') this.manual = false;
    }
    const now = performance.now();
    if (now - this.lastPred > 200) { this.lastPred = now; this.refreshPredicates(); }
    for (const l of this.frameListeners) l(this.sim);
  }

  private refreshPredicates(force = false) {
    const st = useApp.getState();
    const preds: PredicateResult[] = evaluateAll(this.task.predicates, this.sim.s, {
      scene: this.sim.scene, targets: this.sim.allTargets(), programCompleted: st.lastTrace?.outcome === 'completed' && !this.sim.busy(),
      runStartTime: 0, runFaults: 0, totalLiquid: this.sim.s.totalLiquid,
    });
    // run-scoped predicates keep the value from the last run
    const runScoped = new Set(['programCompleted', 'noFaults', 'simTimeBelow']);
    const merged = preds.map((p, i) => (runScoped.has(this.task.predicates[i].type) ? st.lastTrace?.predicates[i] ?? { ...p, pass: false } : p));
    if (force || JSON.stringify(merged) !== JSON.stringify(st.predicates)) st.set({ predicates: merged });
    if (this.task.passOn === 'live' && merged.length && merged.every((p) => p.pass)) this.markPassed('live');
  }

  markPassed(how: 'live' | 'run') {
    const st = useApp.getState();
    if (st.passed[this.task.id]) return;
    st.set((s) => ({ passed: { ...s.passed, [this.task.id]: true }, showSuccess: true }));
    logEvent('task_pass', { taskId: this.task.id, how, wallMs: Date.now() - st.taskStartedAt });
  }

  // ---------------- runs
  run(src: ProgramSource) {
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    this.syncTargets();
    const runId = `r${Date.now().toString(36)}${(++this.runCounter).toString(36)}`;
    useApp.getState().set({ fault: null, showSuccess: false, lastTrace: null, laneStates: {} });
    consoleLog('Run started', 'info', this.sim.simTime);
    this.runner.speed = useApp.getState().speed;
    this.runner.start(src, { predicates: this.task.predicates, seed: this.task.seed, runId, maxSimTimeSec: this.task.maxSimTimeSec });
    logEvent('run_start', { runId, programHash: sourceHash(src), seed: this.task.seed, speed: this.runner.speed, editor: currentWorkspace().editor, ...(this.sim.multi ? { arms: this.sim.robotIds.length } : {}) });
  }
  pause() { this.runner.pause(); logEvent('run_pause', {}); }
  resume() { this.runner.resume(); logEvent('run_resume', {}); }
  step() { this.runner.step(); logEvent('run_step', {}); }
  stop() { this.runner.stop(); logEvent('run_stop', {}); }
  setSpeed(v: number) { this.runner.speed = v; useApp.getState().set({ speed: v }); }

  private onRunEnd(trace: RunTrace) {
    const st = useApp.getState();
    st.set({ lastTrace: trace, laneStates: {} });
    if (trace.fault && trace.outcome !== 'stopped') {
      const f = trace.fault;
      st.set({ fault: f, highlight: { line: f.line, blockId: f.blockId, ...(f.robot ? { lanes: { [f.robot]: { line: f.line, blockId: f.blockId } } } : {}) } });
      const who = f.robot && this.sim.multi ? `${this.sim.label(f.robot)}: ` : '';
      consoleLog(`Stopped: ${who}${f.code}: ${f.message}${f.line ? ` (line ${f.line})` : ''}`, 'fault', this.sim.simTime, f.line);
      logEvent('run_fault', { runId: trace.runId, code: f.code, line: f.line, blockId: f.blockId, ...(f.robot ? { robot: f.robot } : {}) });
    } else {
      consoleLog(trace.outcome === 'stopped' ? 'Stopped' : `Program finished in ${trace.simDurationSec.toFixed(1)} s (simulated)`, 'info', this.sim.simTime);
    }
    this.refreshPredicates(true);
    logEvent('run_end', { runId: trace.runId, outcome: trace.outcome, predicates: trace.predicates, simDurationSec: trace.simDurationSec, trace });
    if (this.task.passOn === 'run' && trace.outcome === 'completed' && trace.predicates.length && trace.predicates.every((p) => p.pass)) this.markPassed('run');
  }

  // ---------------- teaching
  private busy(): boolean {
    if (this.runner.state !== 'idle') { toast('Stop the program before jogging.', 'bad'); return true; }
    return false;
  }
  private jogFault(f: Fault | null) {
    if (f) {
      const now = performance.now();
      if (now - this.lastFaultAt > 1200) { toast(f.message, 'bad'); this.lastFaultAt = now; }
    }
    return f;
  }
  /** Study events about an arm carry its id in multi-arm cells. */
  private armTag(robot = this.arm()) { return this.sim.multi ? { robot } : {}; }
  jogJoint(i: number, delta: number, log = true) {
    if (this.busy()) return;
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    const a = this.arm();
    const q = this.sim.rs(a).q.slice();
    q[i] += this.sim.jointType(i, a) === 'P' ? delta / 1000 : delta * DEG;
    this.jogFault(this.sim.setJoints(q, a));
    if (log) logEvent('jog', { mode: 'joint', axis: i + 1, delta, ...this.armTag(a) });
  }
  jogCart(axis: 0 | 1 | 2 | 3 | 4 | 5, delta: number, frame: 'base' | 'tool', log = true) {
    if (this.busy()) return;
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    const a = this.arm();
    const T = this.sim.tcp(a);
    const d: M4 = axis < 3 ? trans(...([0, 1, 2].map((k) => (k === axis ? delta / 1000 : 0)) as [number, number, number])) : [rotX, rotY, rotZ][axis - 3](delta * DEG);
    let target: M4;
    if (frame === 'tool') target = mul(T, d);
    else {
      // rotate about TCP position with base-frame axes
      const p: [number, number, number] = [T[12], T[13], T[14]];
      const Tr = T.slice(); Tr[12] = Tr[13] = Tr[14] = 0;
      const dr = d.slice(); const dt: [number, number, number] = [d[12], d[13], d[14]]; dr[12] = dr[13] = dr[14] = 0;
      target = mul(trans(p[0] + dt[0], p[1] + dt[1], p[2] + dt[2]), mul(dr, Tr));
    }
    this.jogFault(this.sim.moveTcpTo(target, 40, a));
    if (log) logEvent('jog', { mode: 'cart', frame, axis: ['x', 'y', 'z', 'rx', 'ry', 'rz'][axis], delta, ...this.armTag(a) });
  }
  /** Hand-guide (`target` = TCP pose in world): returns true if the robot followed. */
  guideTo(target: M4): boolean {
    if (this.runner.state !== 'idle') return false;
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    const a = this.arm();
    return this.sim.moveTcpTo(mul(invRigid(this.sim.baseOf(a)), target), 30, a) === null;
  }
  gripper(action: 'open' | 'close') {
    if (this.busy()) return;
    const a = this.arm();
    this.sim.gripperNow(action, a);
    logEvent('gripper_manual', { action, holding: this.sim.rs(a).holding?.id ?? null, ...this.armTag(a) });
  }
  private freeName(robots: string[]): string {
    const ws = currentWorkspace();
    const taken = (n: string) => robots.some((r) => laneTargets(ws, r)[n] || this.sim.allTargets(r)[n]);
    let k = 1;
    const prefix = robots.length > 1 ? 'T' : 'P';
    while (taken(`${prefix}${k}`)) k++;
    return `${prefix}${k}`;
  }
  /** Save the current pose of `robot` (default: the selected arm) as a taught position. */
  teach(name?: string, robot = this.arm()): string {
    const n = name ?? this.freeName([robot]);
    const t: Target = { name: n, pose: this.sim.tcpPose(robot), q: this.sim.rs(robot).q.slice(), source: 'taught' };
    updateLane(robot, { targets: { ...laneTargets(currentWorkspace(), robot), [n]: t } });
    this.syncTargets();
    logEvent('target_teach', { name: n, pose: t.pose, ...this.armTag(robot) });
    return n;
  }
  /** Multi-arm: save one name for every arm at its current pose (for moves together). */
  teachAll(name?: string): string {
    const n = name ?? this.freeName(this.sim.robotIds);
    for (const r of this.sim.robotIds) {
      const t: Target = { name: n, pose: this.sim.tcpPose(r), q: this.sim.rs(r).q.slice(), source: 'taught' };
      updateLane(r, { targets: { ...laneTargets(currentWorkspace(), r), [n]: t } });
    }
    this.syncTargets();
    logEvent('teach_all', { name: n, arms: this.sim.robotIds });
    return n;
  }
  renameTarget(from: string, to: string, robot = this.arm()): boolean {
    const mine = laneTargets(currentWorkspace(), robot);
    if (!/^[A-Za-z_][\w.]*$/.test(to) || mine[to] || this.sim.allTargets(robot)[to]) { toast('Names must be unique and use letters, digits, _ or .', 'bad'); return false; }
    const { [from]: t, ...rest } = mine;
    updateLane(robot, { targets: { ...rest, [to]: { ...t, name: to } } });
    this.syncTargets();
    logEvent('target_rename', { from, to, ...this.armTag(robot) });
    return true;
  }
  deleteTarget(name: string, robot = this.arm()) {
    const { [name]: _gone, ...rest } = laneTargets(currentWorkspace(), robot);
    updateLane(robot, { targets: rest });
    this.syncTargets();
    logEvent('target_delete', { name, ...this.armTag(robot) });
  }
  gotoTarget(name: string, robot = this.arm()) {
    if (this.busy()) return;
    this.syncTargets();
    if (this.sim.busy()) this.sim.stopNow();
    const r = this.sim.begin({ op: 'moveJ', target: name, speed: 25, robot });
    if (!r.ok) { toast(`${r.fault.code}: ${r.fault.message}`, 'bad'); return; }
    this.manual = !r.done;
    logEvent('target_goto', { name, ...this.armTag(robot) });
  }
  goHome(robot = this.arm()) {
    if (this.busy()) return;
    if (this.sim.busy()) this.sim.stopNow();
    const r = this.sim.begin({ op: 'home', speed: 30, robot });
    if (!r.ok) { toast(`${r.fault.code}: ${r.fault.message}`, 'bad'); return; }
    this.manual = !r.done;
  }
  /** A target's pose in world coordinates (for drawing). */
  targetMatrix(name: string, robot = this.arm()): M4 | null {
    const t = this.sim.allTargets(robot)[name];
    return t ? mul(this.sim.baseOf(robot), poseToM4(t.pose)) : null;
  }
}

function defaultCode() {
  return `// Robot program — runs top to bottom. Every robot call is awaited.\nawait robot.home();\nawait gripper.open();\n`;
}
function defaultLaneCode(label: string) {
  return `// ${label} — this arm's program. All arms start together when you press Run.\n// await sync() waits for the other arms; robot.moveTogether(target) / robot.follow() move together.\nawait robot.home();\nawait gripper.open();\n`;
}

export const host = new SimHost();
