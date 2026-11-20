/**
 * Owns the live SimCore + ProgramRunner for the current task and drives them from the render loop.
 * React components talk to it through these functions; the viewport reads `host.sim` every frame.
 */
import { ARMS, TASKS, sceneForTask, type TaskDef } from './content';
import { SimCore } from './sim/SimCore';
import { evaluateAll } from './sim/predicates/evaluators';
import { DEG, mul, rotX, rotY, rotZ, trans, type M4 } from './sim/math/mat4';
import { poseToM4 } from './sim/kinematics/arm';
import type { Fault, PredicateResult, Target } from './sim/types';
import { ProgramRunner } from './runtime/ProgramRunner';
import { consoleLog, currentWorkspace, toast, updateWorkspace, useApp } from './store';
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
      onHighlight: (line, blockId) => useApp.getState().set({ highlight: { line, blockId } }),
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
    if (!st.workspaces[taskId]) {
      const presets: Record<string, Target> = Object.fromEntries(Object.entries(task.presetTargets ?? {}).map(([name, pose]) => [name, { name, pose, source: 'preset' as const }]));
      st.set((s) => ({ workspaces: { ...s.workspaces, [taskId]: { editor: task.editor, code: task.starter?.code ?? defaultCode(), blocks: null, targets: presets } } }));
    }
    this.buildSim();
    useApp.getState().set({ taskId, fault: null, highlight: {}, lastTrace: null, showSuccess: false, console: [], handGuide: false, taskStartedAt: Date.now(), timeLeftSec: task.timeLimitSec ?? null });
    this.refreshPredicates(true);
    logEvent('task_start', { taskId, armId: this.armId(), editor: currentWorkspace().editor });
  }

  private buildSim() {
    const arm = ARMS[this.armId()];
    this.sim = new SimCore(sceneForTask(this.task), arm, { seed: this.task.seed });
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

  syncTargets() { this.sim.setTargets(currentWorkspace()?.targets ?? {}); }

  onFrame(fn: FrameListener) { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn); }

  frame(dt: number) {
    if (this.runner.state !== 'idle') this.runner.tick(dt);
    else if (this.manual && this.sim.s.active) {
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
      scene: this.sim.scene, targets: this.sim.allTargets(), programCompleted: st.lastTrace?.outcome === 'completed' && !this.sim.s.active,
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
  run(src: string) {
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    this.syncTargets();
    const runId = `r${Date.now().toString(36)}${(++this.runCounter).toString(36)}`;
    useApp.getState().set({ fault: null, showSuccess: false, lastTrace: null });
    consoleLog(`▶ Run started`, 'info', this.sim.simTime);
    this.runner.speed = useApp.getState().speed;
    this.runner.start(src, { predicates: this.task.predicates, seed: this.task.seed, runId, maxSimTimeSec: this.task.maxSimTimeSec });
    logEvent('run_start', { runId, programHash: hashOf(src), seed: this.task.seed, speed: this.runner.speed, editor: currentWorkspace().editor });
  }
  pause() { this.runner.pause(); logEvent('run_pause', {}); }
  resume() { this.runner.resume(); logEvent('run_resume', {}); }
  step() { this.runner.step(); logEvent('run_step', {}); }
  stop() { this.runner.stop(); logEvent('run_stop', {}); }
  setSpeed(v: number) { this.runner.speed = v; useApp.getState().set({ speed: v }); }

  private onRunEnd(trace: RunTrace) {
    const st = useApp.getState();
    st.set({ lastTrace: trace });
    if (trace.fault && trace.outcome !== 'stopped') {
      st.set({ fault: trace.fault, highlight: { line: trace.fault.line, blockId: trace.fault.blockId } });
      consoleLog(`■ ${trace.fault.code}: ${trace.fault.message}${trace.fault.line ? ` (line ${trace.fault.line})` : ''}`, 'fault', this.sim.simTime, trace.fault.line);
      logEvent('run_fault', { runId: trace.runId, code: trace.fault.code, line: trace.fault.line, blockId: trace.fault.blockId });
    } else {
      consoleLog(trace.outcome === 'stopped' ? '■ Stopped' : `✓ Program finished in ${trace.simDurationSec.toFixed(1)} s (simulated)`, 'info', this.sim.simTime);
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
  jogJoint(i: number, delta: number, log = true) {
    if (this.busy()) return;
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    const q = this.sim.s.q.slice();
    q[i] += this.sim.jointType(i) === 'P' ? delta / 1000 : delta * DEG;
    this.jogFault(this.sim.setJoints(q));
    if (log) logEvent('jog', { mode: 'joint', axis: i + 1, delta });
  }
  jogCart(axis: 0 | 1 | 2 | 3 | 4 | 5, delta: number, frame: 'base' | 'tool', log = true) {
    if (this.busy()) return;
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    const T = this.sim.tcp();
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
    this.jogFault(this.sim.moveTcpTo(target));
    if (log) logEvent('jog', { mode: 'cart', frame, axis: ['x', 'y', 'z', 'rx', 'ry', 'rz'][axis], delta });
  }
  /** Hand-guide: returns true if the robot followed. */
  guideTo(target: M4): boolean {
    if (this.runner.state !== 'idle') return false;
    if (this.manual) { this.sim.stopNow(); this.manual = false; }
    return this.sim.moveTcpTo(target, 30) === null;
  }
  gripper(action: 'open' | 'close') {
    if (this.busy()) return;
    this.sim.gripperNow(action);
    logEvent('gripper_manual', { action, holding: this.sim.s.holding?.id ?? null });
  }
  teach(name?: string): string {
    const ws = currentWorkspace();
    let n = name;
    if (!n) { let k = 1; while (ws.targets[`P${k}`] || this.sim.allTargets()[`P${k}`]) k++; n = `P${k}`; }
    const t: Target = { name: n, pose: this.sim.tcpPose(), q: this.sim.s.q.slice(), source: 'taught' };
    updateWorkspace({ targets: { ...ws.targets, [n]: t } });
    this.syncTargets();
    logEvent('target_teach', { name: n, pose: t.pose });
    return n;
  }
  renameTarget(from: string, to: string): boolean {
    const ws = currentWorkspace();
    if (!/^[A-Za-z_][\w.]*$/.test(to) || ws.targets[to] || this.sim.scene.sceneTargets[to]) { toast('Names must be unique and use letters, digits, _ or .', 'bad'); return false; }
    const { [from]: t, ...rest } = ws.targets;
    updateWorkspace({ targets: { ...rest, [to]: { ...t, name: to } } });
    this.syncTargets();
    logEvent('target_rename', { from, to });
    return true;
  }
  deleteTarget(name: string) {
    const { [name]: _gone, ...rest } = currentWorkspace().targets;
    updateWorkspace({ targets: rest });
    this.syncTargets();
    logEvent('target_delete', { name });
  }
  gotoTarget(name: string) {
    if (this.busy()) return;
    this.syncTargets();
    if (this.sim.s.active) this.sim.stopNow();
    const r = this.sim.begin({ op: 'moveJ', target: name, speed: 25 });
    if (!r.ok) { toast(`${r.fault.code}: ${r.fault.message}`, 'bad'); return; }
    this.manual = !r.done;
    logEvent('target_goto', { name });
  }
  goHome() {
    if (this.busy()) return;
    if (this.sim.s.active) this.sim.stopNow();
    const r = this.sim.begin({ op: 'home', speed: 30 });
    if (!r.ok) { toast(`${r.fault.code}: ${r.fault.message}`, 'bad'); return; }
    this.manual = !r.done;
  }
  targetMatrix(name: string): M4 | null {
    const t = this.sim.allTargets()[name];
    return t ? poseToM4(t.pose) : null;
  }
}

function defaultCode() {
  return `// Robot program — runs top to bottom. Every robot call is awaited.\nawait robot.home();\nawait gripper.open();\n`;
}
function hashOf(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

export const host = new SimHost();
