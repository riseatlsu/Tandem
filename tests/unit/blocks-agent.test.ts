import { describe, expect, it } from 'vitest';
import { stepsToJs, stepsToWorkspaceJson, validateSteps, workspaceJsonToSteps, type Step } from '../../src/blocks/steps';
import { parseAction } from '../../src/agent/jsonProtocol';
import { searchDocs } from '../../src/agent/docsSearch';
import { trimHistory } from '../../src/agent/graph';
import { orderTasks } from '../../src/study/session';
import { EXPERIMENTS, TASKS } from '../../src/content';
import { runHeadless } from '../../src/runtime/headless';
import { simFor } from './helpers';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

const SORT: Step[] = [
  { home: true }, { gripper: 'open' },
  { forEach: 'i', from: 1, to: 6, do: [
    { waitInput: 'part_present', value: true },
    { move: 'pick.approach' }, { move: 'pick', mode: 'linear' },
    { ifInput: 'part_color', value: 'red', do: [{ gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'red.drop' }],
      else: [{ ifInput: 'part_color', value: 'green', do: [{ gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'green.drop' }],
        else: [{ gripper: 'close' }, { move: 'pick.approach', mode: 'linear' }, { move: 'blue.drop' }] }] },
    { gripper: 'open' },
  ] },
  { home: true },
];

describe('block steps', () => {
  it('round-trip steps → Blockly JSON → steps', () => {
    const pal: Step[] = [{ home: true }, { forEach: 'row', from: 0, to: 1, do: [{ moveOffset: 'pallet.corner', dx: 0, dy: 'row * 70', dz: 50, mode: 'linear', speed: 30 }] }];
    const back = workspaceJsonToSteps(stepsToWorkspaceJson(pal));
    expect(back[1]).toMatchObject({ forEach: 'row', from: 0, to: 1 });
    expect((back[1] as { do: Step[] }).do[0]).toMatchObject({ moveOffset: 'pallet.corner', dy: '(row * 70)', mode: 'linear', speed: 30 });
    expect(workspaceJsonToSteps(stepsToWorkspaceJson(SORT))).toHaveLength(SORT.length);
  });
  it('a block-style sorting program solves sort-colors', async () => {
    const t = TASKS['sort-colors'];
    const tr = await runHeadless(simFor('sort-colors'), stepsToJs(SORT), { predicates: t.predicates });
    expect(tr.outcome).toBe('completed');
    expect(tr.predicates.every((p) => p.pass)).toBe(true);
  });
  it('validation names unknown targets and signals', () => {
    const errs = validateSteps([{ move: 'nowhere' }, { waitInput: 'ghost', value: true }, { fly: 1 }], { targets: ['pick'], inputs: ['part_present'], outputs: [] });
    expect(errs.join('\n')).toMatch(/unknown target "nowhere"/);
    expect(errs.join('\n')).toMatch(/unknown input "ghost"/);
    expect(errs.join('\n')).toMatch(/unknown step/);
  });
});

describe('agent helpers', () => {
  it('parses fenced action blocks for the JSON fallback protocol', () => {
    expect(parseAction('```action\n{"tool":"read_task","args":{}}\n```')).toEqual({ tool: 'read_task', args: {} });
    expect(parseAction('plain answer')).toBeNull();
    expect(parseAction('```action\n{oops}\n```')).toHaveProperty('error');
  });
  it('docs search finds the linear-move section', () => {
    expect(searchDocs('linear move straight line')[0].text).toMatch(/straight line/);
  });
  it('trims history at a human-message boundary', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => (i % 2 ? new AIMessage(`a${i}`) : new HumanMessage(`h${i}`)));
    const t = trimHistory(msgs, 10);
    expect(t.length).toBeLessThanOrEqual(10);
    expect(t[0]).toBeInstanceOf(HumanMessage);
  });
});

describe('study counterbalancing', () => {
  it('keeps the tutorial first and rotates the rest by order index', () => {
    const exp = EXPERIMENTS['pilot'];
    const seq = exp.conditions.suggest.taskSequence;
    expect(orderTasks(seq, exp, 0)).toEqual(seq);
    expect(orderTasks(seq, exp, 1)).toEqual([seq[0], seq[2], seq[1]]);
    expect(orderTasks(seq, exp, 2)).toEqual(seq);
  });
});
