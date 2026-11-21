import { pos } from '../math/mat4';
import type { PredicateDef, PredicateResult, SceneDef, SimState, Target } from '../types';
import { inRegion } from '../world/sensors';
import { isHeld, objectCenter, objectTopZ, tiltOf } from '../world/objects';

export interface PredicateCtx { scene: SceneDef; targets: Record<string, Target>; programCompleted: boolean; runStartTime: number; runFaults: number; totalLiquid: number }

const DEG = Math.PI / 180;

function defaultLabel(p: PredicateDef): string {
  switch (p.type) {
    case 'objectInRegion': return `${p.object} is in ${p.region}`;
    case 'countInRegion': return `${p.count} ${p.color ? p.color + ' ' : ''}${p.kind}(s) in ${p.region}`;
    case 'sortedByColor': return `Every ${p.kind} sorted by color`;
    case 'stackPattern': return `${p.rows}×${p.cols}×${p.layers} stack on ${p.region}`;
    case 'upright': return `${p.object} is upright`;
    case 'fillAtLeast': return `${p.object} is at least ${Math.round(p.frac * 100)}% full`;
    case 'spilledAtMost': return `Spilled no more than ${Math.round(p.frac * 100)}%`;
    case 'noFaults': return 'No protective stops';
    case 'simTimeBelow': return `Cycle finishes within ${p.sec}s`;
    case 'programCompleted': return 'Program runs to completion';
    case 'targetTaught': return `Target “${p.name}” is taught${p.robot ? ` on arm ${p.robot}` : ''}`;
    case 'holding': return `${p.robot ? `Arm ${p.robot}'s gripper` : 'Gripper'} holds ${p.object ?? 'a part'}`;
    case 'objectOn': return `${p.object} sits on ${p.on}`;
    case 'handedOver': return `${p.object} handed from arm ${p.from} to arm ${p.to}`;
    case 'noArmCollisions': return 'The arms never collide';
  }
}

export function evaluate(p: PredicateDef, s: SimState, ctx: PredicateCtx): PredicateResult {
  const label = p.label ?? defaultLabel(p);
  const region = (id: string) => ctx.scene.regions.find((r) => r.id === id);
  const free = (id: string) => !isHeld(s, id);
  switch (p.type) {
    case 'objectInRegion': {
      const o = s.objects.find((x) => x.id === p.object); const r = region(p.region);
      return { label, pass: !!(o && r && free(o.id) && inRegion(r, objectCenter(o), p.tolMm ?? 5)) };
    }
    case 'countInRegion': {
      const r = region(p.region);
      const n = r ? s.objects.filter((o) => o.kind === p.kind && (!p.color || o.color === p.color) && free(o.id) && inRegion(r, objectCenter(o), 5)).length : 0;
      return { label, pass: n >= p.count, detail: `${n}/${p.count}` };
    }
    case 'sortedByColor': {
      const objs = s.objects.filter((o) => o.kind === p.kind);
      const ok = objs.filter((o) => { const r = region(p.map[o.color]); return r && free(o.id) && inRegion(r, objectCenter(o), 5); }).length;
      const need = p.minCount ?? objs.length;
      return { label, pass: ok >= need && ok === objs.length, detail: `${ok}/${Math.max(need, objs.length)}` };
    }
    case 'stackPattern': {
      const r = region(p.region);
      const objs = r ? s.objects.filter((o) => o.kind === p.kind && free(o.id) && !o.toppled && inRegion(r, objectCenter(o), p.tolMm ?? 10)) : [];
      const need = p.rows * p.cols * p.layers;
      let pass = objs.length >= need;
      if (pass && objs.length) {
        const h = objs[0].size[2];
        const w = Math.min(objs[0].size[0], objs[0].size[1]);
        const base = r!.center[2] / 1000 - r!.size[2] / 2000;
        // every layer needs rows × cols cubes in separate grid spots (not stacked on each other), and nothing above
        const cells: [number, number][][] = Array.from({ length: p.layers }, () => []);
        let extra = false;
        for (const o of objs) {
          const layer = Math.round((pos(o.pose)[2] - base) / h);
          if (layer < 0 || layer >= p.layers) { extra = true; continue; }
          const [x, y] = pos(o.pose);
          if (!cells[layer].some(([cx, cy]) => Math.hypot(cx - x, cy - y) < w * 0.6)) cells[layer].push([x, y]);
        }
        pass = !extra && cells.every((c) => c.length >= p.rows * p.cols);
      }
      return { label, pass, detail: `${Math.min(objs.length, need)}/${need}` };
    }
    case 'upright': {
      const o = s.objects.find((x) => x.id === p.object);
      return { label, pass: !!(o && !o.toppled && free(o.id) && tiltOf(o) < 10 * DEG) };
    }
    case 'fillAtLeast': {
      const o = s.objects.find((x) => x.id === p.object);
      const f = o?.container?.fill ?? 0;
      return { label, pass: f >= p.frac - 1e-9, detail: `${Math.round(f * 100)}%` };
    }
    case 'spilledAtMost': {
      const frac = ctx.totalLiquid > 0 ? s.spilled / ctx.totalLiquid : 0;
      return { label, pass: frac <= p.frac + 1e-9, detail: `${Math.round(frac * 100)}%` };
    }
    case 'noFaults': return { label, pass: ctx.runFaults === 0 };
    case 'simTimeBelow': {
      const t = s.simTime - ctx.runStartTime;
      return { label, pass: ctx.programCompleted && t < p.sec, detail: `${t.toFixed(1)}s` };
    }
    case 'programCompleted': return { label, pass: ctx.programCompleted };
    case 'targetTaught': return { label, pass: (p.robot ? s.robots[p.robot]?.targets[p.name] : ctx.targets[p.name])?.source === 'taught' };
    case 'holding': {
      const robots = p.robot ? [s.robots[p.robot]].filter(Boolean) : Object.values(s.robots);
      return { label, pass: robots.some((r) => (p.object ? r.holding?.id === p.object : !!r.holding)) };
    }
    case 'objectOn': {
      const o = s.objects.find((x) => x.id === p.object), b = s.objects.find((x) => x.id === p.on);
      if (!o || !b || !free(o.id) || o.toppled) return { label, pass: false };
      const tol = (p.tolMm ?? 10) / 1000;
      const oc = objectCenter(o), bc = pos(b.pose);
      const half = Math.max(b.size[0], b.size[1]) / 2 + tol;
      const resting = Math.abs(pos(o.pose)[2] - objectTopZ(b)) <= 0.005;
      return { label, pass: resting && Math.abs(oc[0] - bc[0]) <= half && Math.abs(oc[1] - bc[1]) <= half };
    }
    case 'handedOver': {
      const o = s.objects.find((x) => x.id === p.object);
      return { label, pass: !!o?.handovers?.some((h) => h.from === p.from && h.to === p.to) };
    }
    case 'noArmCollisions': return { label, pass: !s.faults.some((f) => f.code === 'ARM_COLLISION') };
  }
}

export const evaluateAll = (ps: PredicateDef[], s: SimState, ctx: PredicateCtx) => ps.map((p) => evaluate(p, s, ctx));
