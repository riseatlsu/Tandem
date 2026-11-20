/** Column-major 4x4 rigid transforms (same layout as three.js). Meters/radians. */
export type M4 = number[];
export type V3 = [number, number, number];

export const I4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export const mulAll = (...ms: M4[]): M4 => ms.reduce((acc, m) => mul(acc, m), I4());

export const trans = (x: number, y: number, z: number): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export function rotX(t: number): M4 {
  const c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
export function rotY(t: number): M4 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
export function rotZ(t: number): M4 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export const pos = (m: M4): V3 => [m[12], m[13], m[14]];
export const col = (m: M4, i: 0 | 1 | 2): V3 => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
export const withPos = (m: M4, p: V3): M4 => { const o = m.slice(); o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; return o; };

/** Inverse of a rigid transform. */
export function invRigid(m: M4): M4 {
  const o = I4();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
  const p = pos(m);
  for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * p[0] + o[4 + r] * p[1] + o[8 + r] * p[2]);
  return o;
}
export function apply(m: M4, p: V3): V3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
export function applyDir(m: M4, d: V3): V3 {
  return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
}

/** R = Rx(a)·Ry(b)·Rz(c) (intrinsic XYZ, same as three.js 'XYZ'). */
export const fromEulerXYZ = (a: number, b: number, c: number): M4 => mul(mul(rotX(a), rotY(b)), rotZ(c));
export function toEulerXYZ(m: M4): V3 {
  const m11 = m[0], m12 = m[4], m13 = m[8], m22 = m[5], m23 = m[9], m32 = m[6], m33 = m[10];
  const b = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), b, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), b, 0];
}

// ---- vectors
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Rotation error (axis*angle, world frame) taking R_cur to R_tgt. */
export function rotError(cur: M4, tgt: M4): V3 {
  // R_err = R_tgt · R_cur^T
  const Rc = invRigid(withPos(cur, [0, 0, 0]));
  const E = mul(withPos(tgt, [0, 0, 0]), Rc);
  const tr = E[0] + E[5] + E[10];
  const cos = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const ang = Math.acos(cos);
  const v: V3 = [E[6] - E[9], E[8] - E[2], E[1] - E[4]];
  if (ang < 1e-9) return [0, 0, 0];
  if (Math.PI - ang < 1e-6) {
    // 180° — pick axis from diagonal
    const xx = Math.sqrt(Math.max(0, (E[0] + 1) / 2)), yy = Math.sqrt(Math.max(0, (E[5] + 1) / 2)), zz = Math.sqrt(Math.max(0, (E[10] + 1) / 2));
    const ax: V3 = xx >= yy && xx >= zz ? [xx, E[1] / (2 * xx), E[2] / (2 * xx)] : yy >= zz ? [E[1] / (2 * yy), yy, E[6] / (2 * yy)] : [E[2] / (2 * zz), E[6] / (2 * zz), zz];
    return scale(ax, ang / norm(ax));
  }
  return scale(v, ang / (2 * Math.sin(ang)));
}
export const rotAngle = (a: M4, b: M4) => norm(rotError(a, b));

// ---- quaternions for slerp  [x,y,z,w]
export type Q = [number, number, number, number];
export function quatFromM4(m: M4): Q {
  const m11 = m[0], m12 = m[4], m13 = m[8], m21 = m[1], m22 = m[5], m23 = m[9], m31 = m[2], m32 = m[6], m33 = m[10];
  const tr = m11 + m22 + m33;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s; }
  else if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s; }
  else if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s; }
  else { const s = 2 * Math.sqrt(1 + m33 - m11 - m22); w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
export function m4FromQuat(q: Q, p: V3 = [0, 0, 0]): M4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, p[0], p[1], p[2], 1];
}
export function slerp(a: Q, b: Q, t: number): Q {
  let [bx, by, bz, bw] = b;
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (c > 0.9995) {
    const r: Q = [a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t];
    const n = Math.hypot(...r); return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const th = Math.acos(c), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}
export function interpPose(a: M4, b: M4, t: number): M4 {
  return m4FromQuat(slerp(quatFromM4(a), quatFromM4(b), t), lerp3(pos(a), pos(b), t));
}

// ---- small dense linear algebra
/** Solve A x = b (A n×n, row-major arrays) with partial pivoting. Returns null if singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
export function det(A: number[][]): number {
  const n = A.length; const M = A.map((r) => r.slice()); let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return 0;
    if (p !== c) { [M[c], M[p]] = [M[p], M[c]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; }
  }
  return d;
}

export const DEG = Math.PI / 180;
