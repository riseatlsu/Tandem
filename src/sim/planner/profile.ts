/** Trapezoidal velocity profile over a scalar distance S with max speed v and accel time ta. */
export interface Profile { S: number; v: number; a: number; T: number; tAcc: number }

export function makeProfile(S: number, v: number, tAccMax = 0.25): Profile {
  if (S <= 1e-12 || v <= 0) return { S: 0, v: 1, a: 1, T: 0, tAcc: 0 };
  const a = v / tAccMax;
  if (S >= v * tAccMax) return { S, v, a, T: S / v + tAccMax, tAcc: tAccMax };
  // triangular
  const tAcc = Math.sqrt(S / a);
  return { S, v: a * tAcc, a, T: 2 * tAcc, tAcc };
}

export function profilePos(p: Profile, t: number): number {
  if (p.T === 0) return p.S;
  if (t <= 0) return 0;
  if (t >= p.T) return p.S;
  const { a, v, tAcc, T } = p;
  if (t < tAcc) return 0.5 * a * t * t;
  if (t > T - tAcc) { const r = T - t; return p.S - 0.5 * a * r * r; }
  return 0.5 * a * tAcc * tAcc + v * (t - tAcc);
}
