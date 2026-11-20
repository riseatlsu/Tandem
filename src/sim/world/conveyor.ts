import { DEG, mul, pos, rotZ, trans } from '../math/mat4';
import { nextRandom } from '../rng';
import type { ConveyorDef, SimState } from '../types';

export function stepConveyors(s: SimState, defs: ConveyorDef[], dt: number) {
  for (const c of defs) {
    const st = s.conveyors[c.id];
    const a = c.start.map((v) => v / 1000), b = c.end.map((v) => v / 1000);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
    const along = (p: number[]) => (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1] + (p[2] - a[2]) * dir[2];
    const running = s.outputs[c.runOutput] === true;
    const parts = s.objects.filter((o) => o.onConveyor === c.id && s.holding?.id !== o.id).sort((x, y) => along(pos(y.pose)) - along(pos(x.pose)));
    const sizeAlong = c.spawn.size[0] / 1000;
    const gap = 0.01;
    // spawn
    if (running && st.spawned < c.spawn.count && s.simTime >= st.nextSpawn) {
      const last = parts[parts.length - 1];
      if (!last || along(pos(last.pose)) > sizeAlong + gap) {
        const [r1, ns1] = nextRandom(s.rng); s.rng = ns1;
        const color = c.spawn.colors[Math.min(c.spawn.colors.length - 1, Math.floor(r1 * c.spawn.colors.length))];
        const [r2, ns2] = nextRandom(s.rng); s.rng = ns2;
        const yaw = Math.atan2(dir[1], dir[0]) / DEG;
        s.spawnCounter++;
        // The first part starts waiting at the sensor (unless prefill is false), so the cell reads correctly before Run.
        const startAt = st.spawned === 0 && c.spawn.prefill !== false ? L : 0;
        s.objects.push({
          id: `${c.spawn.kind}${s.spawnCounter}`, kind: c.spawn.kind, shape: c.spawn.shape ?? 'box',
          size: [c.spawn.size[0] / 1000, c.spawn.size[1] / 1000, c.spawn.size[2] / 1000],
          pose: mul(trans(a[0] + dir[0] * startAt, a[1] + dir[1] * startAt, a[2] + dir[2] * startAt), rotZ(yaw * DEG)), color, graspable: true, onConveyor: c.id,
        });
        st.spawned++;
        st.nextSpawn = s.simTime + c.spawn.intervalSec + c.spawn.jitterSec * (r2 * 2 - 1);
      }
    }
    // move
    let limit = L;
    for (const o of parts) {
      const p = pos(o.pose);
      const cur = along(p);
      let nx = running ? Math.min(cur + c.speed / 1000 * dt, limit) : cur;
      nx = Math.max(nx, cur > limit ? limit : cur);
      if (nx !== cur) { o.pose[12] = a[0] + dir[0] * nx; o.pose[13] = a[1] + dir[1] * nx; o.pose[14] = a[2] + dir[2] * nx; }
      limit = Math.min(nx, limit) - (sizeAlong + gap);
    }
    const atEnd = parts.find((o) => L - along(pos(o.pose)) < 0.002);
    s.inputs[c.sensorInput] = !!atEnd;
    if (c.colorInput) s.inputs[c.colorInput] = atEnd ? atEnd.color : 'none';
  }
}
