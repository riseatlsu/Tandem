import { cross, mul, pos, col, rotZ, trans, sub, type M4, type V3 } from '../math/mat4';
import type { ArmDef } from '../types';

export interface FKResult {
  /** world transform of each link frame (same order as arm.links) */
  frames: M4[];
  /** world frame at each joint (where the joint axis lives = parent·pre), indexed by joint index */
  jointFrames: M4[];
  flange: M4;
  tcp: M4;
}

export function fk(arm: ArmDef, q: number[], base: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]): FKResult {
  const frames: M4[] = [];
  const jointFrames: M4[] = new Array(arm.dof);
  let T = base;
  for (const l of arm.links) {
    T = mul(T, l.pre);
    if (l.joint) {
      jointFrames[l.joint.index] = T;
      const v = q[l.joint.index] ?? 0;
      T = mul(T, l.joint.type === 'R' ? rotZ(v) : trans(0, 0, v));
    }
    T = mul(T, l.post);
    frames.push(T);
  }
  const flange = frames[frames.length - 1];
  return { frames, jointFrames, flange, tcp: mul(flange, arm.toolM) };
}

export const tcpOf = (arm: ArmDef, q: number[]) => fk(arm, q).tcp;

/** 6×dof geometric Jacobian of the TCP (rows: vx vy vz wx wy wz). */
export function jacobian(arm: ArmDef, q: number[], f: FKResult = fk(arm, q)): number[][] {
  const p = pos(f.tcp);
  const J: number[][] = Array.from({ length: 6 }, () => new Array(arm.dof).fill(0));
  for (const l of arm.links) {
    if (!l.joint) continue;
    const i = l.joint.index;
    const F = f.jointFrames[i];
    const z: V3 = col(F, 2);
    if (l.joint.type === 'R') {
      const v = cross(z, sub(p, pos(F)));
      J[0][i] = v[0]; J[1][i] = v[1]; J[2][i] = v[2]; J[3][i] = z[0]; J[4][i] = z[1]; J[5][i] = z[2];
    } else {
      J[0][i] = z[0]; J[1][i] = z[1]; J[2][i] = z[2];
    }
  }
  return J;
}
