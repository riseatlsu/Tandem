import { add, applyDir, col, norm, pos, scale, sub, type M4, type V3 } from '../math/mat4';
import type { ArmDef } from '../types';
import { fk } from '../kinematics/fk';
import { capsuleBoxPenetration, objectSamplePoints, pointBoxSigned, type OBB } from './shapes';

export interface Capsule { a: V3; b: V3; r: number; seg: number }

export function armCapsules(arm: ArmDef, q: number[]): Capsule[] {
  const f = fk(arm, q);
  const origins = f.frames.map(pos);
  const caps: Capsule[] = [];
  let prev = origins[0];
  let k = 0;
  for (let i = 1; i < origins.length; i++) {
    if (norm(sub(origins[i], prev)) < 0.005) continue;
    caps.push({ a: prev, b: origins[i], r: (arm.linkRadius[k] ?? 40) / 1000, seg: k });
    prev = origins[i];
    k++;
  }
  // gripper body: flange → just above TCP so that the TCP itself may touch surfaces
  const r = 0.028;
  const tcpP = pos(f.tcp);
  const z = col(f.tcp, 2);
  const end = sub(tcpP, scale(z, r + 0.004));
  if (norm(sub(end, pos(f.flange))) > 0.005) caps.push({ a: pos(f.flange), b: end, r, seg: 99 });
  return caps;
}

export interface CollisionHit { link: number; fixture: string; depth: number }

/** Returns first collision of arm (and held object) with fixtures, or null. */
export function checkCollision(arm: ArmDef, q: number[], boxes: OBB[], held?: { pose: M4; size: V3 } | null): CollisionHit | null {
  const caps = armCapsules(arm, q);
  for (const c of caps) {
    for (const b of boxes) {
      if (b.mount && c.seg <= 1) continue;
      const d = capsuleBoxPenetration(c.a, c.b, c.r, b);
      if (d > 0.002) return { link: c.seg, fixture: b.id, depth: d };
    }
  }
  if (held) {
    const pts = objectSamplePoints(held.pose, held.size);
    for (const b of boxes) for (const p of pts) {
      const d = -pointBoxSigned(b, p);
      if (d > 0.002) return { link: -1, fixture: b.id, depth: d };
    }
  }
  return null;
}
export { add, applyDir };
