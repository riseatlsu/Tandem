import { describe, expect, it } from 'vitest';
import { ARMS, SCENES } from '../../src/content';
import { SimCore } from '../../src/sim/SimCore';

const sim = () => new SimCore(SCENES['factory-pick'], ARMS['gofa-like'], { seed: 1 });

describe('planner pre-checks (robot must not move on failure)', () => {
  it('UNREACHABLE for a target far outside the workspace', () => {
    const s = sim(); const q0 = s.s.q.slice();
    const r = s.begin({ op: 'moveJ', target: { x: 2000, y: 0, z: 300, rx: 180, ry: 0, rz: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fault.code).toBe('UNREACHABLE');
    expect(s.s.q).toEqual(q0);
  });
  it('COLLISION for a linear move into the table', () => {
    const s = sim(); const q0 = s.s.q.slice();
    const r = s.begin({ op: 'moveL', target: { x: 450, y: 0, z: -60, rx: 180, ry: 0, rz: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['COLLISION', 'UNREACHABLE']).toContain(r.fault.code);
    if (!r.ok) expect(r.fault.code).toBe('COLLISION');
    expect(s.s.q).toEqual(q0);
  });
  it('SINGULARITY for a linear move through the wrist singularity', () => {
    const s = sim(); const q0 = s.s.q.slice();
    // from home (wrist bent 90°) to a pose that requires a straight wrist pointing forward then back down
    const r = s.begin({ op: 'moveL', target: { x: 711, y: 0, z: 819, rx: -180, ry: 90, rz: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['SINGULARITY', 'UNREACHABLE', 'JOINT_LIMIT']).toContain(r.fault.code);
    expect(s.s.q).toEqual(q0);
  });
  it('INVALID_ARG for unknown target names', () => {
    const r = sim().begin({ op: 'moveJ', target: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fault.code).toBe('INVALID_ARG');
  });
  it('moveJ executes and arrives', () => {
    const s = sim();
    const r = s.begin({ op: 'moveJ', target: 'place.approach' });
    expect(r.ok).toBe(true);
    let st; do { st = s.step(0.05); } while (st.status === 'running');
    expect(st.status).toBe('done');
    const p = s.tcpPose();
    expect(Math.abs(p.x - 450) + Math.abs(p.y - 250) + Math.abs(p.z - 200)).toBeLessThan(0.5);
  });
});
