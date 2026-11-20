import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { TASKS, TASK_ORDER } from '../../src/content';
import { simFor } from './helpers';
import { runHeadless } from '../../src/runtime/headless';
import { evaluateAll } from '../../src/sim/predicates/evaluators';

const solution = (id: string) => readFileSync(`tests/fixtures/solutions/${id}.js`, 'utf8');

describe('every task has a passing reference solution', () => {
  for (const id of TASK_ORDER.filter((i) => existsSync(`tests/fixtures/solutions/${i}.js`))) {
    it(id, async () => {
      const t = TASKS[id];
      const sim = simFor(id);
      const trace = await runHeadless(sim, solution(id), { predicates: t.predicates, seed: t.seed });
      if (trace.outcome !== 'completed') console.error(id, trace.fault);
      const failed = trace.predicates.filter((p) => !p.pass);
      if (failed.length) console.error(id, failed, trace.logs.slice(-3));
      expect(trace.outcome).toBe('completed');
      expect(failed).toEqual([]);
    });
  }
  it('tut-jog-teach passes live once P1 is taught', () => {
    const t = TASKS['tut-jog-teach'];
    const sim = simFor('tut-jog-teach');
    const ctx = () => ({ scene: sim.scene, targets: sim.allTargets(), programCompleted: false, runStartTime: 0, runFaults: 0, totalLiquid: 0 });
    expect(evaluateAll(t.predicates, sim.s, ctx())[0].pass).toBe(false);
    sim.setTargets({ P1: { name: 'P1', pose: sim.tcpPose(), q: sim.s.q, source: 'taught' } });
    expect(evaluateAll(t.predicates, sim.s, ctx())[0].pass).toBe(true);
  });
});

describe('determinism', () => {
  it('same program + seed → identical trace; different seed → different color order', async () => {
    const strip = (t: Awaited<ReturnType<typeof runHeadless>>) => JSON.stringify({ ...t, runId: '' });
    const a = await runHeadless(simFor('sort-colors', 42), solution('sort-colors'), { predicates: TASKS['sort-colors'].predicates });
    const b = await runHeadless(simFor('sort-colors', 42), solution('sort-colors'), { predicates: TASKS['sort-colors'].predicates });
    const c = await runHeadless(simFor('sort-colors', 43), solution('sort-colors'), { predicates: TASKS['sort-colors'].predicates });
    expect(strip(a)).toBe(strip(b));
    expect(a.logs.map((l) => l.text)).not.toEqual(c.logs.map((l) => l.text));
  });
});

describe('runtime errors', () => {
  it('reports user errors with the right line', async () => {
    const tr = await runHeadless(simFor('tut-first-program'), 'await robot.home();\n\nnotDefined();\n');
    expect(tr.outcome).toBe('fault');
    expect(tr.fault?.code).toBe('USER_ERROR');
    expect(tr.fault?.line).toBe(3);
  });
  it('reports robot faults with the calling line', async () => {
    const tr = await runHeadless(simFor('tut-first-program'), 'await robot.home();\nawait robot.moveJ("missing");\n');
    expect(tr.fault?.code).toBe('INVALID_ARG');
    expect(tr.fault?.line).toBe(2);
  });
});
