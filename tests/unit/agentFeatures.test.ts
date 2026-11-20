import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkPasses, newlyDone, type PlanCtx } from '../../src/agent/plans';
import { sampleGhost } from '../../src/view/ghost';
import { runHeadless } from '../../src/runtime/headless';
import { EXPERIMENTS } from '../../src/content';
import { simFor } from './helpers';
import type { Plan } from '../../src/store';

const ctx = (p: Partial<PlanCtx> = {}): PlanCtx => ({ taughtTargets: [], program: '', screen: 'home', holding: false, lastRunCompleted: false, goals: [], ...p });

describe('AI plans', () => {
  it('checks tick from live state', () => {
    expect(checkPasses({ type: 'target' }, ctx({ taughtTargets: ['P1'] }))).toBe(true);
    expect(checkPasses({ type: 'target', name: 'P2' }, ctx({ taughtTargets: ['P1'] }))).toBe(false);
    expect(checkPasses({ type: 'uses', command: 'moveL' }, ctx({ program: "await robot.moveL('pick');" }))).toBe(true);
    expect(checkPasses({ type: 'uses', command: 'loop' }, ctx({ program: 'for (let i = 0; i < 3; i++) {}' }))).toBe(true);
    expect(checkPasses({ type: 'screen', screen: 'jog' }, ctx({ screen: 'jog' }))).toBe(true);
    expect(checkPasses({ type: 'goal', index: 1 }, ctx({ goals: [false, true] }))).toBe(true);
    expect(checkPasses({ type: 'run' }, ctx())).toBe(false);
  });
  it('only reports open steps with passing checks; manual steps never auto-tick', () => {
    const plan: Plan = { id: 'p', title: 't', createdAt: 0, steps: [
      { text: 'a', check: { type: 'screen', screen: 'jog' }, done: true },
      { text: 'b', check: { type: 'holding' }, done: false },
      { text: 'c', done: false },
    ] };
    expect(newlyDone(plan, ctx({ screen: 'jog', holding: true }))).toEqual([1]);
  });
});

describe('ghost preview', () => {
  it('interpolates recorded frames', () => {
    const f = [{ t: 0, q: [0, 0], open: true }, { t: 1, q: [1, 2], open: false }];
    expect(sampleGhost(f, 0.5).q).toEqual([0.5, 1]);
    expect(sampleGhost(f, 5).q).toEqual([1, 2]);
    expect(sampleGhost(f, -1).open).toBe(true);
  });
  it('dry runs can record robot motion without changing the trace otherwise', async () => {
    const src = readFileSync('tests/fixtures/solutions/tut-first-program.js', 'utf8');
    const plain = await runHeadless(simFor('tut-first-program'), src, {});
    const rec = await runHeadless(simFor('tut-first-program'), src, { recordEvery: 1 / 30 });
    expect(plain.frames).toBeUndefined();
    expect(rec.frames!.length).toBeGreaterThan(30);
    expect(rec.frames!.at(-1)!.t).toBeCloseTo(rec.simDurationSec, 1);
    const { frames: _f, runId: _a, ...restRec } = rec; const { runId: _b, ...restPlain } = plain;
    void _f; void _a; void _b;
    expect(restRec).toEqual(restPlain);
  });
});

describe('experiment feature flags', () => {
  it('pilot conditions declare every AI feature explicitly (all off)', () => {
    for (const c of ['suggest', 'qa']) expect(EXPERIMENTS.pilot.conditions[c].agent.features).toEqual({ visuals: false, plans: false, preview: false });
  });
});
