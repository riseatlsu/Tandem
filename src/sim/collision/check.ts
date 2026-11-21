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

// ---------------- arm vs arm (SPEC §21.3)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Shortest distance between segments p1–q1 and p2–q2 (Ericson, Real-Time Collision Detection §5.1.9). */
export function segSegDist(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot3(d1, d1), e = dot3(d2, d2), f = dot3(d2, r);
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) return norm(r);
  if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot3(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot3(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1 = add(p1, scale(d1, s)), c2 = add(p2, scale(d2, t));
  return norm(sub(c1, c2));
}

function pointSegDist(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a), l2 = dot3(ab, ab);
  const t = l2 > 1e-12 ? clamp01(dot3(sub(p, a), ab) / l2) : 0;
  return norm(sub(p, add(a, scale(ab, t))));
}

/** Arm capsules in world coordinates (`base` = the arm's mount transform). */
export function worldCapsules(arm: ArmDef, base: M4, q: number[]): Capsule[] {
  const tr = (v: V3): V3 => [
    base[0] * v[0] + base[4] * v[1] + base[8] * v[2] + base[12],
    base[1] * v[0] + base[5] * v[1] + base[9] * v[2] + base[13],
    base[2] * v[0] + base[6] * v[1] + base[10] * v[2] + base[14],
  ];
  return armCapsules(arm, q).map((c) => ({ ...c, a: tr(c.a), b: tr(c.b) }));
}

export interface ArmClash { segA: number; segB: number; depth: number }
/** First overlapping capsule pair between two arms (penetration > `tol` m), or null. */
export function capsulesClash(A: Capsule[], B: Capsule[], tol = 0.002): ArmClash | null {
  for (const ca of A) for (const cb of B) {
    const depth = ca.r + cb.r - segSegDist(ca.a, ca.b, cb.a, cb.b);
    if (depth > tol) return { segA: ca.seg, segB: cb.seg, depth };
  }
  return null;
}
/** First sample point (of a held part) inside one of the capsules, or null. */
export function pointsInCapsules(pts: V3[], caps: Capsule[], tol = 0.002): { seg: number; depth: number } | null {
  for (const c of caps) for (const p of pts) {
    const depth = c.r - pointSegDist(p, c.a, c.b);
    if (depth > tol) return { seg: c.seg, depth };
  }
  return null;
}
