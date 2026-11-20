/** mulberry32 — state is a single uint32 kept in SimState so clones stay deterministic. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const ns = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, ns];
}
