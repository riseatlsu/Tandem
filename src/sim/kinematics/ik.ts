import { det, norm, pos, rotError, solve, sub, type M4 } from '../math/mat4';
import type { ArmDef } from '../types';
import { fk, jacobian } from './fk';

export interface IKOptions { maxIter?: number; posTol?: number; rotTol?: number; restarts?: number[][] }
export type IKResult = { ok: true; q: number[]; iters: number } | { ok: false; reason: 'UNREACHABLE' | 'JOINT_LIMIT'; q: number[] };

const clampToLimits = (arm: ArmDef, q: number[]) => q.map((v, i) => Math.min(arm.limits[i].max, Math.max(arm.limits[i].min, v)));

function taskError(arm: ArmDef, cur: M4, tgt: M4): number[] {
  const e = [...sub(pos(tgt), pos(cur)), ...rotError(cur, tgt)];
  return (arm.ikRows ?? [0, 1, 2, 3, 4, 5]).map((r) => e[r]);
}

/** Damped least-squares IK from a seed. Rotation error is weighted so 1 rad ≈ 0.2 m. */
function solveFrom(arm: ArmDef, target: M4, seed: number[], maxIter: number, posTol: number, rotTol: number): { q: number[]; ok: boolean; iters: number; clamped: boolean } {
  const rows = arm.ikRows ?? [0, 1, 2, 3, 4, 5];
  const W = rows.map((r) => (r < 3 ? 1 : 0.2));
  let q = seed.slice();
  let clamped = false;
  for (let it = 0; it < maxIter; it++) {
    const f = fk(arm, q);
    const e = taskError(arm, f.tcp, target);
    const pe = Math.hypot(...e.filter((_, k) => rows[k] < 3));
    const re = Math.hypot(...e.filter((_, k) => rows[k] >= 3));
    if (pe < posTol && re < rotTol) return { q, ok: true, iters: it, clamped };
    const Jfull = jacobian(arm, q, f);
    const J = rows.map((r, k) => Jfull[r].map((v) => v * W[k]));
    const ew = e.map((v, k) => v * W[k]);
    const m = J.length, n = arm.dof;
    const err = Math.hypot(...ew);
    const lambda = Math.min(0.05, 0.5 * err) + 1e-4;
    // dq = Jᵀ (J Jᵀ + λ² I)⁻¹ e
    const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => {
      let s = 0; for (let k = 0; k < n; k++) s += J[i][k] * J[j][k];
      return s + (i === j ? lambda * lambda : 0);
    }));
    const y = solve(A, ew);
    if (!y) break;
    const dq = Array.from({ length: n }, (_, k) => { let s = 0; for (let i = 0; i < m; i++) s += J[i][k] * y[i]; return s; });
    const step = Math.hypot(...dq);
    const maxStep = 0.3;
    const sc = step > maxStep ? maxStep / step : 1;
    const nq = q.map((v, k) => v + dq[k] * sc);
    const cq = clampToLimits(arm, nq);
    if (cq.some((v, k) => v !== nq[k])) clamped = true;
    q = cq;
  }
  return { q, ok: false, iters: maxIter, clamped };
}

export function solveIK(arm: ArmDef, target: M4, seed: number[], opts: IKOptions = {}): IKResult {
  const maxIter = opts.maxIter ?? 100, posTol = opts.posTol ?? 1e-4, rotTol = opts.rotTol ?? 0.05 * (Math.PI / 180);
  const seeds = [seed, ...(opts.restarts ?? [])];
  let anyClamped = false;
  let last = seed;
  for (const s of seeds) {
    const r = solveFrom(arm, target, s, maxIter, posTol, rotTol);
    if (r.ok) return { ok: true, q: r.q, iters: r.iters };
    anyClamped ||= r.clamped;
    last = r.q;
  }
  // Distinguish "a solution exists but violates limits" by retrying without limits.
  if (anyClamped) {
    const free: ArmDef = { ...arm, limits: arm.limits.map((l) => ({ ...l, min: -1e9, max: 1e9 })) };
    const r = solveFrom(free, target, seed, maxIter, posTol, rotTol);
    if (r.ok) return { ok: false, reason: 'JOINT_LIMIT', q: r.q };
  }
  return { ok: false, reason: 'UNREACHABLE', q: last };
}

/** Deterministic restart seeds spread across the joint space (used for moveJ to a raw pose). */
export function restartSeeds(arm: ArmDef, count = 8): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < count; k++) {
    out.push(arm.limits.map((l, i) => {
      const span = Math.min(l.max, Math.PI) - Math.max(l.min, -Math.PI);
      const frac = ((k * 0.618034 + i * 0.381966) % 1);
      return arm.home[i] + (frac - 0.5) * span * 0.6;
    }).map((v, i) => Math.min(arm.limits[i].max, Math.max(arm.limits[i].min, v))));
  }
  return out;
}

/** Yoshikawa manipulability on the IK rows; ~0 near singularities. */
export function manipulability(arm: ArmDef, q: number[]): number {
  const rows = arm.ikRows ?? [0, 1, 2, 3, 4, 5];
  const Jf = jacobian(arm, q);
  const J = rows.map((r) => Jf[r]);
  const A = J.map((ri) => J.map((rj) => ri.reduce((s, v, k) => s + v * rj[k], 0)));
  return Math.sqrt(Math.max(0, det(A)));
}
export { norm };
