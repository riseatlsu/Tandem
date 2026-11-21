import { TASKS, robotsFor, sceneForTask } from '../../src/content';
import { SimCore } from '../../src/sim/SimCore';

export function simFor(id: string, seed?: number) {
  const t = TASKS[id];
  const scene = sceneForTask(t);
  const sim = new SimCore(scene, robotsFor(scene, t.armId), { seed: seed ?? t.seed });
  // task presets are positions the user starts with (like the app's workspace does)
  if (t.presetTargets) sim.setTargets(Object.fromEntries(Object.entries(t.presetTargets).map(([name, pose]) => [name, { name, pose, source: 'preset' as const }])));
  return sim;
}
