/** Ghost preview bus: the AI partner (or the user) asks the 3D view to replay recorded motion on a translucent arm. */
import type { GhostFrame } from '../runtime/protocol';

export interface GhostClip { frames: GhostFrame[]; speed: number; label?: string }
type Listener = (clip: GhostClip | null) => void;
const listeners = new Set<Listener>();
let current: GhostClip | null = null;

export function playGhost(clip: GhostClip | null) { current = clip; for (const l of listeners) l(clip); }
export function onGhost(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }
export const ghostPlaying = () => !!current;
/** Called by the view when a replay finishes. */
export function ghostEnded() { playGhost(null); }

/** Joint/gripper state at time t (linear interpolation between samples). */
export function sampleGhost(frames: GhostFrame[], t: number): GhostFrame {
  if (t <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid; }
  const a = frames[lo], b = frames[hi];
  const k = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const lerp = (x: { q: number[]; open: boolean }, y: { q: number[]; open: boolean }) => ({ q: x.q.map((v, i) => v + (y.q[i] - v) * k), open: k < 0.5 ? x.open : y.open });
  const robots = a.robots && b.robots ? Object.fromEntries(Object.keys(a.robots).map((id) => [id, lerp(a.robots![id], b.robots![id] ?? a.robots![id])])) : undefined;
  return { t, ...lerp(a, b), ...(robots ? { robots } : {}) };
}
