import { apply, col, pos } from '../math/mat4';
import type { SimState } from '../types';
import { objectTopZ } from './objects';

const RATE = 0.5; // fraction of source capacity per second at full flow (≥ 30° past horizontal)

export function stepPouring(s: SimState, dt: number) {
  if (!s.holding) return;
  const src = s.objects.find((o) => o.id === s.holding!.id);
  if (!src?.container || src.container.fill <= 0) return;
  const upZ = col(src.pose, 2)[2];
  if (upZ >= 0) return; // tilt must exceed 90°
  const flow = Math.min(1, Math.asin(Math.min(1, -upZ)) / (Math.PI / 6)); // ramps from 0 at 90° to 1 at 120°
  const lip = apply(src.pose, [0, 0, src.size[2]]);
  const amount = Math.min(src.container.fill * src.container.capacity, RATE * flow * src.container.capacity * dt);
  src.container.fill -= amount / src.container.capacity;
  const tgt = s.objects.find((o) => {
    if (o.id === src.id || !o.container || o.toppled) return false;
    const p = pos(o.pose);
    return Math.hypot(lip[0] - p[0], lip[1] - p[1]) <= 0.04 && lip[2] >= objectTopZ(o) - 0.01;
  });
  if (tgt?.container) {
    const room = (1 - tgt.container.fill) * tgt.container.capacity;
    const inAmt = Math.min(room, amount);
    tgt.container.fill += inAmt / tgt.container.capacity;
    s.spilled += amount - inAmt;
  } else {
    s.spilled += amount;
  }
}
