import { describe, expect, it } from 'vitest';
import { parseUrdf, resolveMeshPath, urdfTips, urdfToArm } from '../../src/content/urdf';
import { buildArm } from '../../src/sim/kinematics/arm';
import { fk } from '../../src/sim/kinematics/fk';
import { pos } from '../../src/sim/math/mat4';

// base → (revolute about z, 0.3 up) → link1 → (revolute about y, 0.4 up) → link2 → (fixed 0.3 along x) → tool0
const URDF = `<?xml version="1.0"?>
<robot name="mini">
  <!-- a two-joint test arm -->
  <link name="base"><visual><geometry><mesh filename="package://mini/meshes/base.stl" scale="0.001 0.001 0.001"/></geometry></visual></link>
  <link name="link1"><visual><origin xyz="0 0 0.2" rpy="0 0 1.5708"/><geometry><mesh filename="../meshes/l1.dae"/></geometry></visual></link>
  <link name="link2"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
  <link name="tool0"/>
  <joint name="j1" type="revolute"><parent link="base"/><child link="link1"/><origin xyz="0 0 0.3"/><axis xyz="0 0 1"/><limit lower="-3.14" upper="3.14" velocity="2"/></joint>
  <joint name="j2" type="revolute"><parent link="link1"/><child link="link2"/><origin xyz="0 0 0.4"/><axis xyz="0 1 0"/><limit lower="-1.5" upper="1.5" velocity="2"/></joint>
  <joint name="tip" type="fixed"><parent link="link2"/><child link="tool0"/><origin xyz="0.3 0 0"/></joint>
</robot>`;

describe('URDF import', () => {
  const m = parseUrdf(URDF);
  it('parses the tree and finds the tip', () => {
    expect(m.root).toBe('base');
    expect(urdfTips(m)).toEqual(['tool0']);
  });
  it('resolves package:// and relative mesh paths next to the URDF', () => {
    expect(resolveMeshPath('package://mini/meshes/base.stl', 'models/mini/urdf/mini.urdf')).toBe('models/mini/meshes/base.stl');
    expect(resolveMeshPath('../meshes/l1.dae', 'models/mini/urdf/mini.urdf')).toBe('models/mini/meshes/l1.dae');
  });
  it('builds an arm whose kinematics match the URDF', () => {
    const { arm: json, warnings } = urdfToArm(m, { id: 'mini', tip: 'tool0', urdfPath: 'models/mini/urdf/mini.urdf', toolZmm: 0 });
    expect(warnings.some((w) => w.includes('box'))).toBe(true);
    const arm = buildArm(json);
    expect(arm.dof).toBe(2);
    expect(json.jointLimitsDeg[1].min).toBeCloseTo(-85.94, 1);
    const at = (q: number[]) => pos(fk(arm, q).flange).map((v) => +v.toFixed(4));
    expect(at([0, 0])).toEqual([0.3, 0, 0.7]);
    expect(at([Math.PI / 2, 0])).toEqual([0, 0.3, 0.7]); // j1 turns about z
    expect(at([0, Math.PI / 2])).toEqual([0, 0, 0.4]); // j2 about +y tips x down
    const parts = json.visual.source === 'mesh' ? json.visual.parts! : [];
    expect(parts.map((p) => [p.link, p.file, p.upAxis])).toEqual([['base', 'models/mini/meshes/base.stl', 'z'], ['link1', 'models/mini/meshes/l1.dae', 'y']]);
    expect(parts[0].scale).toBe(0.001);
    expect(parts[1].offset).toEqual([0, 0, 200]);
    expect(parts[1].rotation![2]).toBeCloseTo(90, 2);
  });
});
