import { apply, norm, pos, sub, type M4, type V3 } from '../math/mat4';
import type { FixtureDef } from '../types';

export interface OBB { id: string; center: V3; half: V3; yaw: number; mount: boolean }

/** Expand scene fixtures into solid boxes (meters). Bins become a floor + four walls. */
export function fixtureBoxes(fixtures: FixtureDef[]): OBB[] {
  const out: OBB[] = [];
  for (const f of fixtures) {
    if (f.kind === 'region' || f.visualOnly) continue;
    const c: V3 = [f.center[0] / 1000, f.center[1] / 1000, f.center[2] / 1000];
    const h: V3 = [f.size[0] / 2000, f.size[1] / 2000, f.size[2] / 2000];
    const yaw = ((f.yaw ?? 0) * Math.PI) / 180;
    if (f.kind === 'bin' || f.kind === 'rack') {
      const w = (f.wall ?? 8) / 2000;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const at = (lx: number, ly: number, lz: number): V3 => [c[0] + cy * lx - sy * ly, c[1] + sy * lx + cy * ly, c[2] + lz];
      out.push({ id: f.id + ':floor', center: at(0, 0, -h[2] + w), half: [h[0], h[1], w], yaw, mount: !!f.mount });
      out.push({ id: f.id + ':wx+', center: at(h[0] - w, 0, 0), half: [w, h[1], h[2]], yaw, mount: false });
      out.push({ id: f.id + ':wx-', center: at(-h[0] + w, 0, 0), half: [w, h[1], h[2]], yaw, mount: false });
      out.push({ id: f.id + ':wy+', center: at(0, h[1] - w, 0), half: [h[0], w, h[2]], yaw, mount: false });
      out.push({ id: f.id + ':wy-', center: at(0, -h[1] + w, 0), half: [h[0], w, h[2]], yaw, mount: false });
    } else {
      out.push({ id: f.id, center: c, half: h, yaw, mount: !!f.mount });
    }
  }
  return out;
}

export function toLocal(b: OBB, p: V3): V3 {
  const d = sub(p, b.center);
  const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
  return [c * d[0] - s * d[1], s * d[0] + c * d[1], d[2]];
}

/** Signed distance from point to box: >0 outside, <0 = penetration depth. */
export function pointBoxSigned(b: OBB, p: V3): number {
  const l = toLocal(b, p);
  const q: V3 = [Math.abs(l[0]) - b.half[0], Math.abs(l[1]) - b.half[1], Math.abs(l[2]) - b.half[2]];
  const outside = norm([Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]);
  const inside = Math.min(Math.max(q[0], q[1], q[2]), 0);
  return outside + inside;
}

export function pointInBoxXY(b: OBB, p: V3, margin = 0): boolean {
  const l = toLocal(b, p);
  return Math.abs(l[0]) <= b.half[0] + margin && Math.abs(l[1]) <= b.half[1] + margin;
}

/** Penetration (m, >0 means overlap) of a capsule into a box, via segment sampling. */
export function capsuleBoxPenetration(a: V3, b: V3, r: number, box: OBB): number {
  const len = norm(sub(b, a));
  const n = Math.max(2, Math.ceil(len / 0.015) + 1);
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    best = Math.min(best, pointBoxSigned(box, p));
  }
  return r - best;
}

/** Sample points of an object (box or cylinder) given its bottom-center pose and size (m). */
export function objectSamplePoints(pose: M4, size: V3): V3[] {
  const [sx, sy, sz] = size;
  const pts: V3[] = [];
  for (const fx of [-0.5, 0, 0.5]) for (const fy of [-0.5, 0, 0.5]) for (const fz of [0, 0.5, 1])
    pts.push(apply(pose, [fx * sx, fy * sy, fz * sz]));
  return pts;
}
export { pos };
