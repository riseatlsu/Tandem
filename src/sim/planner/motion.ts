import { mul, interpPose, invRigid, pos, rotAngle, sub, norm, type M4, type V3 } from '../math/mat4';
import type { ArmDef, Fault } from '../types';
import { fk } from '../kinematics/fk';
import { manipulability, solveIK } from '../kinematics/ik';
import { checkCollision } from '../collision/check';
import type { OBB } from '../collision/shapes';
import { makeProfile, profilePos, type Profile } from './profile';

export interface Trajectory { s: number[]; qs: number[][]; profile: Profile }
export interface PlanCtx { arm: ArmDef; boxes: OBB[]; held: { rel: M4; size: V3 } | null; speedPct: number }

const DEG = Math.PI / 180;
const fmtDeg = (r: number) => `${(r / DEG).toFixed(1)}°`;

export function sampleTrajectory(tr: Trajectory, t: number): { q: number[]; done: boolean } {
  const s = profilePos(tr.profile, t);
  const done = t >= tr.profile.T;
  if (tr.qs.length === 1) return { q: tr.qs[0], done };
  let i = 1;
  while (i < tr.s.length - 1 && tr.s[i] < s) i++;
  const s0 = tr.s[i - 1], s1 = tr.s[i];
  const u = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 1;
  const a = tr.qs[i - 1], b = tr.qs[i];
  return { q: a.map((v, k) => v + (b[k] - v) * u), done };
}

export function limitFault(arm: ArmDef, q: number[]): Fault | null {
  for (let i = 0; i < arm.dof; i++) {
    const l = arm.limits[i];
    if (q[i] < l.min - 1e-9 || q[i] > l.max + 1e-9)
      return { code: 'JOINT_LIMIT', message: `Joint ${i + 1} would be at ${fmtDeg(q[i])} (limit ${fmtDeg(l.min)} … ${fmtDeg(l.max)}).`, detail: { joint: i + 1 } };
  }
  return null;
}

export function collisionFault(ctx: PlanCtx, q: number[]): Fault | null {
  const held = ctx.held ? { pose: mul(fk(ctx.arm, q).tcp, ctx.held.rel), size: ctx.held.size } : null;
  const hit = checkCollision(ctx.arm, q, ctx.boxes, held);
  if (!hit) return null;
  const who = hit.link === -1 ? 'The held part' : hit.link === 99 ? 'The gripper' : `Arm link ${hit.link + 1}`;
  return { code: 'COLLISION', message: `${who} would hit “${hit.fixture.split(':')[0]}” (${(hit.depth * 1000).toFixed(0)} mm overlap).`, detail: hit };
}

/** Joint-space move with synchronized trapezoidal profile. */
export function planMoveJ(ctx: PlanCtx, q0: number[], q1: number[]): Trajectory | Fault {
  const lf = limitFault(ctx.arm, q1);
  if (lf) return lf;
  const sp = Math.max(0.01, Math.min(1, ctx.speedPct / 100));
  const maxD = Math.max(...q1.map((v, i) => Math.abs(v - q0[i])));
  const n = Math.max(2, Math.ceil(maxD / (2 * DEG)) + 1);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const q = q0.map((v, i) => v + (q1[i] - v) * u);
    const cf = collisionFault(ctx, q);
    if (cf) return cf;
  }
  // parameter s∈[0,1]; max param speed limited by every joint
  let vs = Infinity;
  q1.forEach((v, i) => { const d = Math.abs(v - q0[i]); if (d > 1e-9) vs = Math.min(vs, (ctx.arm.limits[i].maxVel * sp) / d); });
  if (!isFinite(vs)) vs = 1;
  return { s: [0, 1], qs: [q0, q1], profile: makeProfile(1, vs, 0.15 + 0.25 * sp) };
}

/** Straight-line TCP move. Path is pre-solved with IK every ~2 mm / 1°. */
export function planMoveL(ctx: PlanCtx, q0: number[], target: M4): Trajectory | Fault {
  const arm = ctx.arm;
  const T0 = fk(arm, q0).tcp;
  const dist = norm(sub(pos(target), pos(T0)));
  const ang = arm.ikRows ? 0 : rotAngle(T0, target);
  const n = Math.max(2, Math.ceil(Math.max(dist / 0.002, ang / DEG)) + 1);
  const qs: number[][] = [q0];
  const s: number[] = [0];
  const wRot = 0.2; // m per rad
  let prev = q0;
  const m0 = manipulability(arm, q0);
  for (let k = 1; k < n; k++) {
    const u = k / (n - 1);
    const Tk = interpPose(T0, target, u);
    const r = solveIK(arm, Tk, prev, { maxIter: 60 });
    if (!r.ok) {
      if (r.reason === 'JOINT_LIMIT') return { code: 'JOINT_LIMIT', message: `The linear path would exceed a joint limit at ${(u * 100).toFixed(0)}% of the way.` };
      return { code: 'UNREACHABLE', message: `The linear path leaves the workspace at ${(u * 100).toFixed(0)}% of the way (${fmtMm(pos(Tk))}).` };
    }
    const jump = Math.max(...r.q.map((v, i) => Math.abs(v - prev[i])));
    if (jump > 10 * DEG) return { code: 'SINGULARITY', message: `A joint would flip ${fmtDeg(jump)} at ${(u * 100).toFixed(0)}% of the path — the arm passes near a singularity.` };
    const mk = manipulability(arm, r.q);
    if (mk < Math.min(1e-4, m0 * 0.02)) return { code: 'SINGULARITY', message: `The path passes through a singular configuration at ${(u * 100).toFixed(0)}% of the way.` };
    const lf = limitFault(arm, r.q);
    if (lf) return lf;
    const cf = collisionFault(ctx, r.q);
    if (cf) return cf;
    qs.push(r.q);
    s.push(s[s.length - 1] + Math.max(dist / (n - 1), (ang / (n - 1)) * wRot));
    prev = r.q;
  }
  const sp = Math.max(0.01, Math.min(1, ctx.speedPct / 100));
  let v = (arm.maxTcpSpeed / 1000) * sp;
  for (let k = 1; k < qs.length; k++) {
    const ds = s[k] - s[k - 1];
    if (ds <= 0) continue;
    for (let i = 0; i < arm.dof; i++) {
      const dq = Math.abs(qs[k][i] - qs[k - 1][i]);
      if (dq > 1e-12) v = Math.min(v, (arm.limits[i].maxVel * sp * ds) / dq);
    }
  }
  return { s, qs, profile: makeProfile(s[s.length - 1], v, 0.15 + 0.25 * sp) };
}
/** One arm taking part in a synced move. `base` maps the arm's base frame to world. */
export interface SyncArm { id: string; ctx: PlanCtx; q0: number[]; base: M4 }
export type SyncPlan = { trajs: Record<string, Trajectory> } | (Fault & { robot: string });

/**
 * Synced move (SPEC §21.3): the leader's TCP follows a straight line to `target` (leader base frame); every
 * follower keeps its TCP rigidly at the offset it had to the leader's TCP at the start. All arms share one
 * path parameter and one trapezoidal profile, so they start and stop together.
 */
export function planSyncMove(leader: SyncArm, target: M4, followers: SyncArm[]): SyncPlan {
  const arms = [leader, ...followers];
  const L0 = fk(leader.ctx.arm, leader.q0).tcp;
  const Lw0 = mul(leader.base, L0);
  const invLw0 = invRigid(Lw0);
  const offsets = arms.map((a) => mul(invLw0, mul(a.base, fk(a.ctx.arm, a.q0).tcp)));
  const invBase = arms.map((a) => invRigid(a.base));
  const dist = norm(sub(pos(target), pos(L0)));
  const ang = leader.ctx.arm.ikRows ? 0 : rotAngle(L0, target);
  const n = Math.max(2, Math.ceil(Math.max(dist / 0.002, ang / DEG)) + 1);
  const wRot = 0.2;
  const goalsAt = (u: number) => {
    const Lw = mul(leader.base, interpPose(L0, target, u));
    return arms.map((_, i) => mul(invBase[i], mul(Lw, offsets[i])));
  };
  const qs: number[][][] = arms.map((a) => [a.q0]);
  const prev = arms.map((a) => a.q0);
  const m0 = arms.map((a) => manipulability(a.ctx.arm, a.q0));
  let prevGoals = arms.map((a) => fk(a.ctx.arm, a.q0).tcp);
  const s: number[] = [0];
  for (let k = 1; k < n; k++) {
    const u = k / (n - 1);
    const goals = goalsAt(u);
    let ds = 0;
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      const at = `${(u * 100).toFixed(0)}% of the way`;
      const r = solveIK(a.ctx.arm, goals[i], prev[i], { maxIter: 60 });
      if (!r.ok) {
        if (r.reason === 'JOINT_LIMIT') return { code: 'JOINT_LIMIT', message: `The move together would push a joint past its limit at ${at}.`, robot: a.id };
        return { code: 'UNREACHABLE', message: `The move together leaves this arm's workspace at ${at} (${fmtMm(pos(goals[i]))}).`, robot: a.id };
      }
      const jump = Math.max(...r.q.map((v, j) => Math.abs(v - prev[i][j])));
      if (jump > 10 * DEG) return { code: 'SINGULARITY', message: `A joint would flip ${fmtDeg(jump)} at ${at} — the arm passes near a singularity.`, robot: a.id };
      if (manipulability(a.ctx.arm, r.q) < Math.min(1e-4, m0[i] * 0.02)) return { code: 'SINGULARITY', message: `The path passes through a singular configuration at ${at}.`, robot: a.id };
      const lf = limitFault(a.ctx.arm, r.q);
      if (lf) return { ...lf, robot: a.id };
      const cf = collisionFault(a.ctx, r.q);
      if (cf) return { ...cf, robot: a.id };
      qs[i].push(r.q);
      prev[i] = r.q;
      const d = norm(sub(pos(goals[i]), pos(prevGoals[i])));
      const ra = a.ctx.arm.ikRows ? 0 : rotAngle(prevGoals[i], goals[i]);
      ds = Math.max(ds, d, ra * wRot);
    }
    prevGoals = goals;
    s.push(s[s.length - 1] + Math.max(ds, 1e-9));
  }
  const sp = Math.max(0.01, Math.min(1, leader.ctx.speedPct / 100));
  let v = Math.min(...arms.map((a) => a.ctx.arm.maxTcpSpeed / 1000)) * sp;
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i].ctx.arm;
    for (let k = 1; k < s.length; k++) {
      const dsk = s[k] - s[k - 1];
      for (let j = 0; j < arm.dof; j++) {
        const dq = Math.abs(qs[i][k][j] - qs[i][k - 1][j]);
        if (dq > 1e-12) v = Math.min(v, (arm.limits[j].maxVel * sp * dsk) / dq);
      }
    }
  }
  const profile = makeProfile(s[s.length - 1], v, 0.15 + 0.25 * sp);
  return { trajs: Object.fromEntries(arms.map((a, i) => [a.id, { s, qs: qs[i], profile }])) };
}

const fmtMm = (p: V3) => `x ${(p[0] * 1000).toFixed(0)}, y ${(p[1] * 1000).toFixed(0)}, z ${(p[2] * 1000).toFixed(0)} mm`;

export const isFault = (x: unknown): x is Fault => !!x && typeof x === 'object' && 'code' in (x as object) && 'message' in (x as object);
