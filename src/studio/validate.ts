/** Cross-reference checks for environments (beyond the zod schema). Pure, so it is unit-tested. */
import type { SceneDef } from '../sim/types';

export function validateScene(d: SceneDef): string[] {
  const out: string[] = [];
  // ids must be unique within fixtures, parts and zones (a zone may share its fixture's id, e.g. "rack")
  for (const [what, list] of [['fixture', d.fixtures], ['part', d.objects], ['zone', d.regions]] as const) {
    const ids = list.map((x) => x.id);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) out.push(`Duplicate ${what} ids: ${[...new Set(dup)].join(', ')}`);
  }
  if (!d.fixtures.some((f) => f.mount)) out.push('No fixture is marked “robot is mounted on this” (usually the table).');
  const ins = d.io.inputs.map((i) => i.name), outs = d.io.outputs.map((o) => o.name), regs = d.regions.map((r) => r.id);
  for (const c of d.conveyors) {
    if (!outs.includes(c.runOutput)) out.push(`Conveyor ${c.id}: output “${c.runOutput}” does not exist.`);
    if (!ins.includes(c.sensorInput)) out.push(`Conveyor ${c.id}: input “${c.sensorInput}” does not exist.`);
  }
  for (const s of [...(d.colorSensors ?? []), ...(d.presenceSensors ?? [])]) {
    if (!ins.includes(s.input)) out.push(`A sensor uses unknown input “${s.input}”.`);
    if (!regs.includes(s.region)) out.push(`A sensor uses unknown zone “${s.region}”.`);
  }
  for (const f of d.fixtures) if (f.kind === 'model' && !f.mesh) out.push(`Fixture ${f.id} is a 3D model but has no model file.`);
  return out;
}
