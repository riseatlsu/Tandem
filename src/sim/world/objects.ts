import { DEG, apply, col, dot, invRigid, mul, pos, rotZ, rotX, trans, withPos, type M4, type V3 } from '../math/mat4';
import type { ArmDef, ObjState, ObjectDef, SimState } from '../types';
import { pointInBoxXY, type OBB } from '../collision/shapes';

export function objFromDef(d: ObjectDef): ObjState {
  return {
    id: d.id, kind: d.kind, shape: d.shape,
    size: [d.size[0] / 1000, d.size[1] / 1000, d.size[2] / 1000],
    pose: mul(trans(d.position[0] / 1000, d.position[1] / 1000, d.position[2] / 1000), rotZ((d.yaw ?? 0) * DEG)),
    color: d.color ?? '#3b82f6', graspable: d.graspable ?? true,
    container: d.container ? { ...d.container } : undefined,
    onConveyor: null,
  };
}

/** Object's up axis tilt from world vertical (rad). */
export const tiltOf = (o: ObjState) => Math.acos(Math.max(-1, Math.min(1, col(o.pose, 2)[2])));
/** Height of the object's top above its pose origin in world z (approx, upright or toppled). */
export function objectTopZ(o: ObjState): number {
  if (o.toppled) return pos(o.pose)[2] + (o.shape === 'cylinder' ? o.size[0] / 2 : o.size[1] / 2);
  return pos(o.pose)[2] + o.size[2];
}
/** World-space center of the object's footprint (for support/region checks). */
export function objectCenter(o: ObjState): V3 {
  return apply(o.pose, [0, 0, o.size[2] / 2]);
}

/** Find a graspable object between the fingers. */
export function findGraspable(s: SimState, arm: ArmDef, tcp: M4): ObjState | null {
  const tcpP = pos(tcp);
  const toolZ = col(tcp, 2);
  const tol = arm.gripper.graspTolerance / 1000;
  let best: ObjState | null = null, bestD = Infinity;
  for (const o of s.objects) {
    if (!o.graspable || s.holding?.id === o.id || o.toppled) continue;
    const width = Math.min(o.size[0], o.size[1]);
    if (width > arm.gripper.stroke / 1000 + 1e-6) continue;
    const l = apply(invRigid(o.pose), tcpP);
    const h = o.size[2];
    if (Math.abs(l[0]) > tol || Math.abs(l[1]) > tol) continue;
    if (l[2] < 0.1 * h - 0.002 || l[2] > h + 0.005) continue;
    const up = col(o.pose, 2);
    const align = -dot(toolZ, up); // gripper should point down the object's axis
    if (align < Math.cos(arm.gripper.alignTolDeg * DEG)) continue;
    const d = Math.hypot(l[0], l[1]);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/** Drop an object straight down onto the highest support below its center. Returns spill amount. */
export function dropObject(s: SimState, o: ObjState, boxes: OBB[]): void {
  const c = objectCenter(o);
  const p = pos(o.pose);
  const bottom = Math.min(p[2], c[2] - 0.001);
  let support = -0.75; // floor
  for (const b of boxes) {
    const top = b.center[2] + b.half[2];
    if (top <= bottom + 0.01 && pointInBoxXY(b, c)) support = Math.max(support, top);
  }
  for (const other of s.objects) {
    if (other.id === o.id || s.holding?.id === other.id) continue;
    const top = objectTopZ(other);
    const oc = pos(other.pose);
    const half = Math.max(other.size[0], other.size[1]) / 2;
    if (top <= bottom + 0.01 && Math.abs(c[0] - oc[0]) <= half && Math.abs(c[1] - oc[1]) <= half) support = Math.max(support, top);
  }
  const tilt = tiltOf(o);
  const up = col(o.pose, 2);
  const yaw = Math.atan2(col(o.pose, 0)[1], col(o.pose, 0)[0]);
  if (tilt > 30 * DEG) {
    // topple: lie on its side in the direction it was leaning
    const lean = Math.atan2(up[1], up[0]);
    const radius = o.shape === 'cylinder' ? o.size[0] / 2 : o.size[1] / 2;
    o.pose = mul(trans(c[0], c[1], support + radius), mul(rotZ(lean - Math.PI / 2), rotX(-Math.PI / 2)));
    o.pose = withPos(o.pose, apply(o.pose, [0, 0, -o.size[2] / 2]));
    o.pose[14] = support + radius;
    o.toppled = true;
    if (o.container && o.container.fill > 0) {
      s.spilled += o.container.fill * o.container.capacity;
      o.container.fill = 0;
    }
  } else {
    o.pose = mul(trans(c[0], c[1], support), rotZ(yaw));
  }
}
