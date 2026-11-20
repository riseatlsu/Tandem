import { pos } from '../math/mat4';
import type { PredicateDef, PredicateResult, SceneDef, SimState, Target } from '../types';
import { inRegion } from '../world/sensors';
import { objectCenter, tiltOf } from '../world/objects';

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
    case 'targetTaught': return `Target “${p.name}” is taught`;
    case 'holding': return p.object ? `Gripper holds ${p.object}` : 'Gripper holds a part';
  }
}

export function evaluate(p: PredicateDef, s: SimState, ctx: PredicateCtx): PredicateResult {
  const label = p.label ?? defaultLabel(p);
  const region = (id: string) => ctx.scene.regions.find((r) => r.id === id);
  const free = (id: string) => s.holding?.id !== id;
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
        const base = r!.center[2] / 1000 - r!.size[2] / 2000;
        const perLayer = new Array(p.layers).fill(0);
        for (const o of objs) {
          const layer = Math.round((pos(o.pose)[2] - base) / h);
          if (layer >= 0 && layer < p.layers) perLayer[layer]++;
        }
        pass = perLayer.every((n) => n >= p.rows * p.cols);
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
    case 'targetTaught': return { label, pass: ctx.targets[p.name]?.source === 'taught' };
    case 'holding': return { label, pass: p.object ? s.holding?.id === p.object : !!s.holding };
  }
}

export const evaluateAll = (ps: PredicateDef[], s: SimState, ctx: PredicateCtx) => ps.map((p) => evaluate(p, s, ctx));
