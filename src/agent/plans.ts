/**
 * Step-by-step plans made by the AI partner (`make_plan`). Steps with a check tick themselves off as the
 * user makes progress; steps without one are ticked by the user. Ticks are sticky.
 */
import { useApp, type Plan, type PlanCheck, type PlanStep } from '../store';
import { logEvent } from '../study/logger';

export interface PlanCtx {
  taughtTargets: string[];
  program: string;
  screen: string;
  holding: boolean;
  lastRunCompleted: boolean;
  goals: boolean[];
}

const USES: Record<Extract<PlanCheck, { type: 'uses' }>['command'], RegExp> = {
  moveJ: /robot\.moveJ\(/, moveL: /robot\.moveL\(/, home: /robot\.home\(/, 'gripper.open': /gripper\.open\(/, 'gripper.close': /gripper\.close\(/,
  waitFor: /io\.waitFor\(/, 'io.set': /io\.set\(/, wait: /robot\.wait\(/, loop: /\b(for|while)\s*\(/, offset: /\boffset\(/,
};

export function checkPasses(c: PlanCheck, ctx: PlanCtx): boolean {
  switch (c.type) {
    case 'target': return c.name ? ctx.taughtTargets.includes(c.name) : ctx.taughtTargets.length > 0;
    case 'uses': return USES[c.command]?.test(ctx.program) ?? false;
    case 'screen': return ctx.screen === c.screen;
    case 'holding': return ctx.holding;
    case 'run': return ctx.lastRunCompleted;
    case 'goal': return !!ctx.goals[c.index];
  }
}

/** Returns the steps that just became done (does not mutate). */
export function newlyDone(plan: Plan, ctx: PlanCtx): number[] {
  return plan.steps.flatMap((s, i) => (!s.done && s.check && checkPasses(s.check, ctx) ? [i] : []));
}

export function setPlanStep(taskId: string, index: number, done: boolean, by: 'auto' | 'user') {
  const st = useApp.getState();
  const plan = st.plans[taskId];
  if (!plan || !plan.steps[index] || plan.steps[index].done === done) return;
  const steps: PlanStep[] = plan.steps.map((s, i) => (i === index ? { ...s, done } : s));
  st.set((s) => ({ plans: { ...s.plans, [taskId]: { ...plan, steps } } }));
  logEvent('plan_step_done', { planId: plan.id, index, done, by, text: plan.steps[index].text });
}

/** Called a few times a second with live context; ticks any steps whose checks now pass. */
export function updatePlan(ctx: PlanCtx) {
  const st = useApp.getState();
  const plan = st.plans[st.taskId];
  if (!plan) return;
  for (const i of newlyDone(plan, ctx)) setPlanStep(st.taskId, i, true, 'auto');
}

export function planSummary(plan: Plan | undefined) {
  if (!plan) return null;
  return { title: plan.title, steps: plan.steps.map((s, i) => ({ n: i + 1, text: s.text, done: s.done, auto: !!s.check })) };
}

/** Ticks plan steps from live state (throttled; only does work while a plan exists). */
export function initPlanTracking(host: { onFrame(fn: (sim: { busy(): boolean; s: { robots: Record<string, { holding: unknown }> } }) => void): unknown }, program: () => string) {
  let last = 0;
  host.onFrame((sim) => {
    const now = performance.now();
    if (now - last < 300) return;
    last = now;
    const st = useApp.getState();
    if (!st.plans[st.taskId]) return;
    const ws = st.workspaces[st.taskId];
    updatePlan({
      taughtTargets: Object.values(ws?.targets ?? {}).filter((t) => t.source === 'taught').map((t) => t.name),
      program: program(),
      screen: st.pendantScreen,
      holding: Object.values(sim.s.robots).some((r) => !!r.holding),
      lastRunCompleted: st.lastTrace?.outcome === 'completed',
      goals: st.predicates.map((p) => p.pass),
    });
  });
}
