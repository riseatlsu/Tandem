/**
 * Multi-arm sim + runtime (SPEC §21.3–§21.4): lanes, the clock rule, arm-vs-arm pre-checks, syncs,
 * synced moves with two-handed parts, handovers and Pause/Step. Uses an inline two-arm test cell;
 * the shipped duo-* tasks are covered by tasks.test.ts once they exist.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ARMS, DEMO_TASKS, TASKS } from '../../src/content';
import { simFor } from './helpers';
import { SimCore, type RobotSetup } from '../../src/sim/SimCore';
import type { Pose, SceneDef } from '../../src/sim/types';
import { runHeadless, splitLanes } from '../../src/runtime/headless';
import { Scheduler } from '../../src/runtime/scheduler';
import { evaluateAll } from '../../src/sim/predicates/evaluators';
import { pos } from '../../src/sim/math/mat4';
import { lanesToJs, lanesToWorkspaceJson, validateLanes, workspaceJsonToLanes, type Lanes } from '../../src/blocks/steps';

const down = (x: number, y: number, z: number): Pose => ({ x, y, z, rx: 180, ry: 0, rz: 0 });
// Two GoFa-class arms side by side, 800 mm apart, both facing +X (like a dual-arm robot's shoulders).
// Targets are in each arm's own base frame: A's y = world y + 400, B's y = world y − 400.
const SCENE: SceneDef = {
  id: 'duo-test', title: 'Duo test', environment: 'custom',
  fixtures: [{ id: 'table', kind: 'box', center: [400, 0, -20], size: [1400, 1600, 40], mount: true }],
  objects: [
    { id: 'beam', kind: 'beam', shape: 'box', size: [40, 400, 40], position: [500, 0, 0], twoHanded: true },
    { id: 'bar', kind: 'bar', shape: 'box', size: [40, 300, 40], position: [500, 0, 0] },
  ],
  regions: [], io: { inputs: [], outputs: [] }, conveyors: [], sceneTargets: {},
  robots: [
    { id: 'A', label: 'Left arm', armId: 'gofa-like', base: { x: 0, y: -400, z: 0, rz: 0 }, targets: {
      mid: down(500, 400, 150), 'beam.above': down(500, 280, 150), 'beam.grip': down(500, 280, 20), lift: down(500, 280, 200), set: down(600, 280, 20),
      'bar.above': down(500, 400, 150), 'bar.grip': down(500, 400, 20),
    } },
    { id: 'B', label: 'Right arm', armId: 'gofa-like', base: { x: 0, y: 400, z: 0, rz: 0 }, targets: {
      mid: down(500, -400, 150), 'beam.above': down(500, -280, 150), 'beam.grip': down(500, -280, 20),
      'bar.above': down(500, -280, 150), 'bar.grip': down(500, -280, 20),
    } },
  ],
};
const withOnly = (keep: string) => ({ ...SCENE, objects: SCENE.objects.filter((o) => o.id === keep) });
const setup = (scene: SceneDef): RobotSetup[] => scene.robots!.map((r) => ({ id: r.id, arm: ARMS[r.armId], base: r.base, label: r.label, targets: r.targets }));
const duo = (keep = 'beam') => { const sc = withOnly(keep); return new SimCore(sc, setup(sc), { seed: 1 }); };
const strip = (t: Awaited<ReturnType<typeof runHeadless>>) => JSON.stringify({ ...t, runId: '' });

const GRAB_BEAM = 'await gripper.open();\nawait robot.moveJ("beam.above");\nawait robot.moveL("beam.grip");\nawait gripper.close();\n';

describe('lanes run in parallel', () => {
  it('two lanes take about as long as the slower one, not the sum', async () => {
    const a = await runHeadless(duo(), { A: 'await robot.moveJ("mid");' });
    const b = await runHeadless(duo(), { B: 'await robot.moveJ("beam.above");' });
    const both = await runHeadless(duo(), { A: 'await robot.moveJ("beam.above");', B: 'await robot.moveJ("beam.above");' });
    expect(a.outcome).toBe('completed');
    expect(b.outcome).toBe('completed');
    expect(both.outcome).toBe('completed');
    expect(both.entries.map((e) => e.robot).sort()).toEqual(['A', 'B']);
    const single = await runHeadless(duo(), { A: 'await robot.moveJ("beam.above");' });
    expect(both.simDurationSec).toBeLessThan(single.simDurationSec * 1.2);
  });

  it('a single string program drives the first robot only', async () => {
    const sim = duo();
    const t = await runHeadless(sim, 'await robot.moveJ("mid");');
    expect(t.outcome).toBe('completed');
    expect(sim.rs('B').q).toEqual(ARMS['gofa-like'].home);
  });
});

describe('clock rule: outcomes never depend on how long programs compute', () => {
  it('random compute delays in each lane give identical traces', async () => {
    const jitter = 'await new Promise((r) => setTimeout(r, Math.random() * 4));\n';
    const A = `${jitter}${GRAB_BEAM}${jitter}await sync();\n${jitter}await robot.moveTogether("lift");\nlog("A done");`;
    const B = `${jitter}${GRAB_BEAM}${jitter}await sync();\n${jitter}await robot.follow();\nlog("B done");`;
    const runs = [];
    for (let i = 0; i < 6; i++) runs.push(strip(await runHeadless(duo(), { A, B }, { recordEvery: 0.05 })));
    expect(JSON.parse(runs[0]).outcome).toBe('completed');
    for (const r of runs) expect(r).toBe(runs[0]);
  });

  it('time stands still while a lane is computing', () => {
    const sim = duo();
    const sched = new Scheduler(sim, ['A', 'B'], { reply() {} });
    sched.call('A', { id: 1, cmd: { op: 'wait', ms: 100 } });
    expect(sched.pump()).toBeNull();
    expect(sched.canAdvance()).toBe(false); // B has not called yet
    sched.call('B', { id: 2, cmd: { op: 'wait', ms: 50 } });
    sched.pump();
    expect(sched.canAdvance()).toBe(true);
    sched.advance(1);
    expect(sim.simTime).toBeCloseTo(0.05, 6); // stops at B's completion; B is computing again
    expect(sched.canAdvance()).toBe(false);
  });
});

describe('arm-vs-arm pre-check', () => {
  it('ARM_COLLISION when both arms head for the same spot; neither moves', async () => {
    const sim = duo();
    const t = await runHeadless(sim, { A: 'await robot.moveJ("mid");', B: 'await robot.moveJ("mid");' });
    expect(t.outcome).toBe('fault');
    expect(t.fault?.code).toBe('ARM_COLLISION');
    expect(t.fault?.robot).toBe('B');
    expect((t.fault?.detail as { arms: string[] }).arms.sort()).toEqual(['A', 'B']);
    expect(t.fault?.line).toBe(1);
    expect(sim.rs('A').q).toEqual(ARMS['gofa-like'].home);
    expect(sim.rs('B').q).toEqual(ARMS['gofa-like'].home);
    expect(evaluateAll([{ type: 'noArmCollisions' }], sim.s, { scene: sim.scene, targets: {}, programCompleted: false, runStartTime: 0, runFaults: 1, totalLiquid: 0 })[0].pass).toBe(false);
  });

  it('a stationary arm in the way is caught too', async () => {
    const t = await runHeadless(duo(), { A: 'await robot.moveJ("mid");\nawait sync();', B: 'await sync();\nawait robot.moveJ("mid");' });
    expect(t.fault?.code).toBe('ARM_COLLISION');
    expect(t.fault?.robot).toBe('B');
    expect(t.fault?.line).toBe(2);
  });

  it('“Wait for each other” fixes it', async () => {
    const t = await runHeadless(duo(), { A: 'await robot.moveJ("mid");\nawait robot.home();\nawait sync();', B: 'await sync();\nawait robot.moveJ("mid");' });
    expect(t.outcome).toBe('completed');
  });

  it('jogging into the other arm is refused', () => {
    const sim = duo();
    expect(sim.begin({ op: 'moveJ', target: 'mid', robot: 'A' }).ok).toBe(true);
    while (sim.busy()) sim.stepAll(0.05);
    const ik = sim.clone();
    expect(ik.begin({ op: 'moveJ', target: 'mid', robot: 'B' }).ok).toBe(false);
  });
});

describe('two-handed parts and synced moves', () => {
  it('carries the beam rigidly with Move together and sets it down', async () => {
    const sim = duo();
    const A = `${GRAB_BEAM}await sync();\nawait robot.moveTogether("lift");\nawait robot.moveTogether("set");\nawait gripper.open();\nawait sync();`;
    const B = `${GRAB_BEAM}await sync();\nawait robot.follow();\nawait robot.follow();\nawait sync();\nawait gripper.open();`;
    const dist = () => { const a = pos(sim.tcpWorld('A')), b = pos(sim.tcpWorld('B')); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    let d0 = -1, maxDev = 0, maxZ = 0;
    const t = await runHeadless(sim, { A, B }, {
      onStep: (s) => {
        if (s.rs('A').holding && s.rs('B').holding) { if (d0 < 0) d0 = dist(); maxDev = Math.max(maxDev, Math.abs(dist() - d0)); }
        maxZ = Math.max(maxZ, pos(s.s.objects[0].pose)[2]);
      },
    });
    if (t.outcome !== 'completed') console.error(t.fault);
    expect(t.outcome).toBe('completed');
    expect(maxDev).toBeLessThan(0.0005); // grasp offset kept within 0.5 mm
    expect(maxZ).toBeGreaterThan(0.17);
    const beam = pos(sim.s.objects[0].pose);
    expect(beam[0]).toBeCloseTo(0.6, 2);
    expect(beam[2]).toBeCloseTo(0, 3);
    expect(t.entries.filter((e) => e.cmd.op === 'sync').length).toBe(8);
  });

  it('NEEDS_TWO_HANDS when one arm tries to lift it', async () => {
    const t = await runHeadless(duo(), { A: `${GRAB_BEAM}await robot.moveL("beam.above");` });
    expect(t.fault?.code).toBe('NEEDS_TWO_HANDS');
    expect(t.fault?.line).toBe(5);
  });

  it('SHARED_GRASP when both hold it and one moves alone', async () => {
    const t = await runHeadless(duo(), { A: `${GRAB_BEAM}await sync();\nawait robot.moveL("beam.above");`, B: `${GRAB_BEAM}await sync();` });
    expect(t.fault?.code).toBe('SHARED_GRASP');
    expect(t.fault?.robot).toBe('A');
  });

  it('letting go with one arm drops a lifted two-handed part', async () => {
    const sim = duo();
    const A = `${GRAB_BEAM}await sync();\nawait robot.moveTogether("lift");\nawait gripper.open();\nawait sync();`;
    const B = `${GRAB_BEAM}await sync();\nawait robot.follow();\nawait sync();`;
    const t = await runHeadless(sim, { A, B });
    expect(t.outcome).toBe('completed');
    expect(sim.rs('B').holding).toBeNull();
    expect(pos(sim.s.objects[0].pose)[2]).toBeCloseTo(0, 3);
  });
});

describe('sync mismatches', () => {
  it('SYNC_MISMATCH when one lane finishes without its sync', async () => {
    const t = await runHeadless(duo(), { A: 'await robot.moveJ("beam.above");\nawait sync();', B: 'await robot.wait(10);' });
    expect(t.fault?.code).toBe('SYNC_MISMATCH');
    expect(t.fault?.robot).toBe('A');
    expect(t.fault?.line).toBe(2);
  });
  it('SYNC_MISMATCH when two arms both lead a move together', async () => {
    const t = await runHeadless(duo(), { A: 'await robot.moveTogether("lift");', B: 'await robot.moveTogether("mid");' });
    expect(t.fault?.code).toBe('SYNC_MISMATCH');
    expect(t.fault?.message).toMatch(/Only one arm/);
  });
  it('SYNC_MISMATCH when a wait meets a follow', async () => {
    const t = await runHeadless(duo(), { A: 'await sync();', B: 'await robot.follow();' });
    expect(t.fault?.code).toBe('SYNC_MISMATCH');
  });
});

describe('handover', () => {
  it('records a mid-air re-grasp from A to B', async () => {
    const sim = duo('bar');
    const A = 'await gripper.open();\nawait robot.moveJ("bar.above");\nawait robot.moveL("bar.grip");\nawait gripper.close();\nawait robot.moveL("bar.above");\nawait sync();\nawait sync();\nawait gripper.open();\nawait sync();\nawait robot.home();';
    const B = 'await gripper.open();\nawait sync();\nawait robot.moveJ("bar.above");\nawait robot.moveL({ x: 500, y: -280, z: 150, rx: 180, ry: 0, rz: 0 });\nawait gripper.close();\nawait sync();\nawait sync();\nawait robot.moveL({ x: 500, y: -280, z: 250, rx: 180, ry: 0, rz: 0 });';
    const t = await runHeadless(sim, { A, B }, { predicates: [{ type: 'handedOver', object: 'bar', from: 'A', to: 'B' }, { type: 'holding', object: 'bar', robot: 'B' }] });
    if (t.outcome !== 'completed') console.error(t.fault);
    expect(t.outcome).toBe('completed');
    expect(t.predicates.map((p) => p.pass)).toEqual([true, true]);
  });
});

describe('Pause / Step (D10)', () => {
  it('Step begins one command on every ready arm and ends when they finish', () => {
    const sim = duo();
    const replies: string[] = [];
    const sched = new Scheduler(sim, ['A', 'B'], { reply: (lane) => replies.push(lane) });
    let stepDone = 0;
    sched.onStepDone = () => stepDone++;
    sched.pause();
    sched.call('A', { id: 1, cmd: { op: 'wait', ms: 300 } });
    sched.call('B', { id: 2, cmd: { op: 'wait', ms: 100 } });
    sched.pump();
    expect(sched.canAdvance()).toBe(false); // paused: nothing begins
    sched.step();
    sched.pump();
    expect(sched.canAdvance()).toBe(true);
    sched.advance(1); // B's wait ends first
    expect(replies).toEqual(['B']);
    sched.call('B', { id: 3, cmd: { op: 'wait', ms: 100 } }); // B's next command is held by the step
    sched.pump();
    expect(sched.lane('B').state).toBe('pending');
    sched.advance(1); // A's wait ends → step done
    expect(replies).toEqual(['B', 'A']);
    expect(stepDone).toBe(1);
    expect(sim.simTime).toBeCloseTo(0.3, 6);
  });
});

describe('content', () => {
  it('base frames: a target taught on B lands where B reaches in the world', () => {
    const sim = duo();
    expect(sim.begin({ op: 'moveJ', target: 'beam.above', robot: 'B' }).ok).toBe(true);
    while (sim.busy()) sim.stepAll(0.05);
    const w = pos(sim.tcpWorld('B'));
    expect(w.map((v) => Math.round(v * 1000))).toEqual([500, 120, 150]);
  });
});

describe('duo tasks need coordination', () => {
  const sol = (id: string) => splitLanes(readFileSync(`tests/fixtures/solutions/${id}.js`, 'utf8')) as Record<string, string>;
  const run = (id: string, lanes: Record<string, string>) => runHeadless(simFor(id), lanes, { predicates: TASKS[id].predicates });

  it('duo-tutorial: without “Wait for each other” the right arm reaches in too early and the task fails', async () => {
    const s = sol('duo-tutorial');
    const t = await run('duo-tutorial', { A: s.A.replace(/await sync\(\);.*\n/g, '').replace(/await robot\.moveTogether.*\n?/, ''), B: s.B.replace(/await sync\(\);.*\n/g, '').replace(/await robot\.follow.*\n?/, '') });
    // the right arm reaches the empty pad before the block arrives (or bumps into the left arm)
    expect(t.fault?.code === 'ARM_COLLISION' || !t.predicates[0].pass).toBe(true);
  });
  it('duo-handover: moving the right arm before the left lets go is a SHARED_GRASP', async () => {
    const s = sol('duo-handover');
    const t = await run('duo-handover', { A: s.A.replace('await sync(); // 3: let go — the right arm may move\n', ''), B: s.B.replace('await sync(); // 3\n', '') });
    expect(t.fault?.code).toBe('SHARED_GRASP');
  });
  it('duo-assembly: one arm alone can’t lift the propeller', async () => {
    const s = sol('duo-assembly');
    const A = s.A.replace(/await sync\(\); \/\/ 3[\s\S]*$/, "await robot.moveL('prop.lift');\n");
    const B = s.B.replace(/await robot\.moveJ\('prop\.above'\);[\s\S]*$/, '');
    const t = await run('duo-assembly', { A: A.replace(/await sync\(\); \/\/ 2.*\n/, ''), B: B.replace(/await sync\(\); \/\/ 2\n/, '') });
    expect(t.fault?.code).toBe('NEEDS_TWO_HANDS');
  });
  it('the shipped tasks are listed in the demo after the single-arm levels', () => {
    const duo = DEMO_TASKS.filter((id) => id.startsWith('duo-'));
    expect(duo).toEqual(['duo-tutorial', 'duo-handover', 'duo-throughput', 'duo-assembly']);
    expect(DEMO_TASKS.indexOf('duo-tutorial')).toBeGreaterThan(DEMO_TASKS.indexOf('lab-tubes'));
  });
});

describe('lanes steps format (blocks ↔ agent)', () => {
  const TUT: Lanes = {
    A: [{ move: 'block.above' }, { gripper: 'open' }, { move: 'block', mode: 'linear' }, { gripper: 'close' }, { move: 'block.above', mode: 'linear' }, { move: 'middle.above' }, { move: 'middle', mode: 'linear' }, { gripper: 'open' }, { move: 'middle.above', mode: 'linear' }, { move: 'ready' }, { sync: 'wait' }, { sync: 'wait' }, { sync: 'move', target: 'ready.low', speed: 30 }],
    B: [{ gripper: 'open' }, { sync: 'wait' }, { move: 'middle.above' }, { move: 'middle', mode: 'linear' }, { gripper: 'close' }, { move: 'middle.above', mode: 'linear' }, { move: 'right.above' }, { move: 'right', mode: 'linear' }, { gripper: 'open' }, { move: 'right.above', mode: 'linear' }, { move: 'ready' }, { sync: 'wait' }, { sync: 'follow' }],
  };
  // defaults written out by the converter (speed 50, joint moves) compare equal to omitted ones
  const norm = (l: Lanes) => JSON.parse(JSON.stringify(l, (k, v) => ((k === 'speed' && v === 50) || (k === 'mode' && v === 'joint') ? undefined : v)));
  it('round-trips through the Blockly workspace JSON with paired sync ids and one leader', () => {
    const json = lanesToWorkspaceJson(TUT, { A: 'Left arm', B: 'Right arm' }) as { blocks: { blocks: { next?: unknown }[] } };
    expect(norm(workspaceJsonToLanes(json))).toEqual(norm(TUT));
    const flat = JSON.stringify(json);
    const ids = [...flat.matchAll(/"syncId":"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(3); // each sync shared by both lanes
    expect(flat).toContain('"role":"lead","leader":"A"');
    expect(flat).toContain('"role":"follow","leader":"A"');
  });
  it('validates per-arm targets and sync pairing', () => {
    const sim = simFor('duo-tutorial');
    const env = (r: string) => ({ targets: Object.keys(sim.allTargets(r)), inputs: [], outputs: [] });
    expect(validateLanes(TUT, env, ['A', 'B'])).toEqual([]);
    expect(validateLanes({ A: [{ move: 'right' }], B: [] }, env, ['A', 'B']).join()).toMatch(/unknown target "right"/); // B's target, not A's
    expect(validateLanes({ A: [{ sync: 'wait' }], B: [] }, env, ['A', 'B']).join()).toMatch(/same number of sync steps/);
    expect(validateLanes({ A: [{ sync: 'move', target: 'ready' }], B: [{ sync: 'move', target: 'ready' }] }, env, ['A', 'B']).join()).toMatch(/sync #1 doesn't match/);
    expect(validateLanes({ A: [{ repeat: 2, do: [{ sync: 'wait' }] }], B: [{ repeat: 2, do: [{ sync: 'wait' }] }] }, env, ['A', 'B']).join()).toMatch(/top level/);
    expect(validateLanes({ A: [] }, env, ['A', 'B']).join()).toMatch(/lanes.B is missing/);
  });
  it('blocks-generated lanes solve the tutorial', async () => {
    const t = await runHeadless(simFor('duo-tutorial'), lanesToJs(TUT), { predicates: TASKS['duo-tutorial'].predicates });
    expect(t.outcome).toBe('completed');
    expect(t.predicates.every((p) => p.pass)).toBe(true);
  });
});
