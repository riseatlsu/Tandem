/**
 * "Finish it" / "fix the bugs" tasks start with a block program (task.starter.steps). The starter must not
 * already pass, and the intended fix (written here as steps) must pass every goal — so the bugs are real and
 * fixable with blocks alone.
 */
import { describe, expect, it } from 'vitest';
import { TASKS } from '../../src/content';
import { simFor } from './helpers';
import { runHeadless } from '../../src/runtime/headless';
import { stepsToJs, validateSteps, type Step } from '../../src/blocks/steps';

const starter = (id: string) => structuredClone(TASKS[id].starter!.steps as Step[]);
type Loop = Extract<Step, { do: Step[] }>;
const body = (s: Step) => (s as Loop).do;

const FIXES: Record<string, (s: Step[]) => Step[]> = {
  // finish the loop: replace the note with grab, lift, drop
  'factory-bin-three': (s) => {
    const loop = body(s[2]);
    loop.splice(3, 1, { gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'bin.drop' }, { gripper: 'open' });
    return s;
  },
  // 1. two layers, not one · 2. rows shift in Y by `row` · 3. place at the layer's height
  'palletize-2x2x2': (s) => {
    (s[2] as Loop & { to: number }).to = 1;
    const inner = body(body(body(s[2])[0])[0]);
    for (const st of inner) if ('moveOffset' in st) { st.dy = 'row * 70'; if (st.dz === 0) st.dz = 'layer * 50'; }
    return s;
  },
  // 1. close the gripper on the pitcher · 2. keep it tipped long enough to fill the cup
  'kitchen-pour': (s) => {
    s.splice(4, 0, { gripper: 'close' });
    const wait = s.find((x) => 'wait' in x) as { wait: number };
    wait.wait = 0.5;
    return s;
  },
};

describe('block starters', () => {
  for (const [id, fix] of Object.entries(FIXES)) {
    describe(id, () => {
      const t = TASKS[id];
      const env = () => { const sim = simFor(id); return { targets: Object.keys(sim.allTargets()), inputs: sim.scene.io.inputs.map((i) => i.name), outputs: sim.scene.io.outputs.map((o) => o.name) }; };
      it('is a blocks task whose starter is valid steps', () => {
        expect(t.editor).toBe('blocks');
        expect(validateSteps(starter(id), env())).toEqual([]);
      });
      it('the starter does not pass yet', async () => {
        const tr = await runHeadless(simFor(id), stepsToJs(starter(id)), { predicates: t.predicates, maxSimTimeSec: 300 });
        expect(tr.outcome === 'completed' && tr.predicates.every((p) => p.pass)).toBe(false);
      });
      it('the intended fix passes every goal', async () => {
        const tr = await runHeadless(simFor(id), stepsToJs(fix(starter(id))), { predicates: t.predicates });
        if (tr.outcome !== 'completed' || !tr.predicates.every((p) => p.pass)) console.error(id, tr.fault, tr.predicates);
        expect(tr.outcome).toBe('completed');
        expect(tr.predicates.every((p) => p.pass)).toBe(true);
      });
    });
  }
  // each listed bug must break the task on its own: undo one fix at a time
  const ONE_BUG: Record<string, ((s: Step[]) => void)[]> = {
    'palletize-2x2x2': [
      (s) => { (s[2] as Loop & { to: number }).to = 0; },
      (s) => { for (const st of body(body(body(s[2])[0])[0])) if ('moveOffset' in st) st.dy = 'col * 70'; },
      (s) => { for (const st of body(body(body(s[2])[0])[0])) if ('moveOffset' in st && st.mode === 'linear' && st.dz === 'layer * 50') st.dz = 0; },
    ],
    'kitchen-pour': [
      (s) => { s.splice(s.findIndex((x) => 'gripper' in x && x.gripper === 'close'), 1); },
      (s) => { (s.find((x) => 'wait' in x) as { wait: number }).wait = 0.1; },
    ],
  };
  for (const [id, bugs] of Object.entries(ONE_BUG)) bugs.forEach((bug, i) => {
    it(`${id}: bug ${i + 1} alone still fails the task`, async () => {
      const s = FIXES[id](starter(id));
      bug(s);
      const tr = await runHeadless(simFor(id), stepsToJs(s), { predicates: TASKS[id].predicates, maxSimTimeSec: 300 });
      expect(tr.outcome === 'completed' && tr.predicates.every((p) => p.pass)).toBe(false);
    });
  });
  it('no demo task is code-only any more', () => {
    for (const t of Object.values(TASKS)) if (t.demo) expect(t.editor, t.id).toBe('blocks');
  });
});
