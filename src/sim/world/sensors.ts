import type { RegionDef, SceneDef, SimState } from '../types';
import { isHeld, objectCenter } from './objects';

export function inRegion(r: RegionDef, p: [number, number, number] | number[], tolMm = 0): boolean {
  const t = tolMm / 1000;
  return [0, 1, 2].every((i) => Math.abs(p[i] - r.center[i] / 1000) <= r.size[i] / 2000 + t);
}

export function stepSensors(s: SimState, scene: SceneDef) {
  const region = (id: string) => scene.regions.find((r) => r.id === id);
  for (const cs of scene.colorSensors ?? []) {
    const r = region(cs.region);
    const o = r && s.objects.find((o) => !isHeld(s, o.id) && inRegion(r, objectCenter(o)));
    s.inputs[cs.input] = o ? o.color : 'none';
  }
  for (const ps of scene.presenceSensors ?? []) {
    const r = region(ps.region);
    s.inputs[ps.input] = !!(r && s.objects.some((o) => !isHeld(s, o.id) && inRegion(r, objectCenter(o))));
  }
}
