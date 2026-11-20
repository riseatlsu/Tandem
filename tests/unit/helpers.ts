import { ARMS, TASKS, sceneForTask } from '../../src/content';
import { SimCore } from '../../src/sim/SimCore';

export function simFor(id: string, seed?: number) {
  const t = TASKS[id];
  return new SimCore(sceneForTask(t), ARMS[t.armId], { seed: seed ?? t.seed });
}
