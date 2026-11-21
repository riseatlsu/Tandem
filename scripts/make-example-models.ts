/**
 * Writes small example models to public/models/examples/ — format references for adding your own:
 *   mini-arm/urdf/mini_arm.urdf + mini-arm/meshes/*.stl   a 6-axis arm described in URDF (import it in the editor)
 *   mini-arm/mini_arm.glb                                 the same arm as ONE file with nodes named after links (modelled at zero pose)
 *   props/machine.glb, props/crate.obj, props/widget.stl  scene props (fixture, decoration, graspable part)
 *   npx tsx scripts/make-example-models.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';

type V = [number, number, number];
interface Prim { pos: number[]; nrm: number[]; idx: number[]; color: [number, number, number] }

function box(c: V, s: V, color: Prim['color']): Prim {
  const p: number[] = [], n: number[] = [], idx: number[] = [];
  const faces: [V, V, V][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [nn, u, v] of faces) {
    const b = p.length / 3;
    for (const [a, bb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) p.push(c[k] + (nn[k] * s[k]) / 2 + (u[k] * a * s[k]) / 2 + (v[k] * bb * s[k]) / 2);
      n.push(...nn);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos: p, nrm: n, idx, color };
}
/** Cylinder of radius r, from z0 to z1 along `axis` ('z' or 'y'), centered at (cx, cy). */
function cyl(r: number, z0: number, z1: number, color: Prim['color'], axis: 'z' | 'y' = 'z', at: V = [0, 0, 0], seg = 32): Prim {
  const p: number[] = [], n: number[] = [], idx: number[] = [];
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    if (axis === 'y') { p.push(at[0] + x, at[1] + z, at[2] + y); n.push(nx, nz, ny); } else { p.push(at[0] + x, at[1] + y, at[2] + z); n.push(nx, ny, nz); }
    return p.length / 3 - 1;
  };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
    const v = [put(r * c0, r * s0, z0, c0, s0, 0), put(r * c1, r * s1, z0, c1, s1, 0), put(r * c1, r * s1, z1, c1, s1, 0), put(r * c0, r * s0, z1, c0, s0, 0)];
    idx.push(v[0], v[1], v[2], v[0], v[2], v[3]);
    const t = [put(0, 0, z1, 0, 0, 1), put(r * c0, r * s0, z1, 0, 0, 1), put(r * c1, r * s1, z1, 0, 0, 1)];
    idx.push(...t);
    const b = [put(0, 0, z0, 0, 0, -1), put(r * c1, r * s1, z0, 0, 0, -1), put(r * c0, r * s0, z0, 0, 0, -1)];
    idx.push(...b);
  }
  if (axis === 'y') for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; // keep outward winding
  return { pos: p, nrm: n, idx, color };
}
const moved = (pr: Prim, d: V): Prim => ({ ...pr, pos: pr.pos.map((v, i) => v + d[i % 3]) });

function stl(prims: Prim[]): Buffer {
  const tris = prims.reduce((a, p) => a + p.idx.length / 3, 0);
  const b = Buffer.alloc(84 + tris * 50);
  b.write('Tandem example', 0);
  b.writeUInt32LE(tris, 80);
  let o = 84;
  for (const p of prims) for (let i = 0; i < p.idx.length; i += 3) {
    const [a, c, d] = [p.idx[i], p.idx[i + 1], p.idx[i + 2]];
    const nn = [0, 1, 2].map((k) => p.nrm[a * 3 + k] + p.nrm[c * 3 + k] + p.nrm[d * 3 + k]);
    const l = Math.hypot(...nn) || 1;
    for (const v of nn) { b.writeFloatLE(v / l, o); o += 4; }
    for (const vi of [a, c, d]) for (let k = 0; k < 3; k++) { b.writeFloatLE(p.pos[vi * 3 + k], o); o += 4; }
    o += 2;
  }
  return b;
}
function obj(prims: Prim[]): string {
  let s = '# Tandem example (millimeters, Z up)\n', base = 1;
  for (const p of prims) {
    for (let i = 0; i < p.pos.length; i += 3) s += `v ${(p.pos[i] * 1000).toFixed(2)} ${(p.pos[i + 1] * 1000).toFixed(2)} ${(p.pos[i + 2] * 1000).toFixed(2)}\n`;
    for (let i = 0; i < p.idx.length; i += 3) s += `f ${p.idx[i] + base} ${p.idx[i + 1] + base} ${p.idx[i + 2] + base}\n`;
    base += p.pos.length / 3;
  }
  return s;
}
/** Binary glTF: one node per entry (named), each a mesh of colored primitives. Geometry given Z-up, written Y-up. */
function glb(nodes: { name: string; prims: Prim[] }[]): Buffer {
  const bins: Buffer[] = []; let off = 0;
  const bufferViews: object[] = [], accessors: object[] = [], meshes: object[] = [], materials: object[] = [], matIndex = new Map<string, number>();
  const add = (data: Buffer, target: number) => { const pad = Buffer.alloc((4 - (data.length % 4)) % 4); bufferViews.push({ buffer: 0, byteOffset: off, byteLength: data.length, target }); bins.push(data, pad); off += data.length + pad.length; return bufferViews.length - 1; };
  for (const nd of nodes) {
    const primitives = nd.prims.map((p) => {
      const pos = new Float32Array(p.pos.length), nrm = new Float32Array(p.nrm.length);
      for (let i = 0; i < p.pos.length; i += 3) { pos[i] = p.pos[i]; pos[i + 1] = p.pos[i + 2]; pos[i + 2] = -p.pos[i + 1]; nrm[i] = p.nrm[i]; nrm[i + 1] = p.nrm[i + 2]; nrm[i + 2] = -p.nrm[i + 1]; }
      const min = [0, 1, 2].map((k) => Math.min(...Array.from(pos).filter((_, i) => i % 3 === k))), max = [0, 1, 2].map((k) => Math.max(...Array.from(pos).filter((_, i) => i % 3 === k)));
      const pv = add(Buffer.from(pos.buffer), 34962); accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
      const nv = add(Buffer.from(nrm.buffer), 34962); accessors.push({ bufferView: nv, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
      const iv = add(Buffer.from(new Uint32Array(p.idx).buffer), 34963); accessors.push({ bufferView: iv, componentType: 5125, count: p.idx.length, type: 'SCALAR' });
      const key = p.color.join(',');
      if (!matIndex.has(key)) { matIndex.set(key, materials.length); materials.push({ pbrMetallicRoughness: { baseColorFactor: [...p.color, 1], metallicFactor: 0, roughnessFactor: 0.35 } }); }
      return { attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: matIndex.get(key) };
    });
    meshes.push({ name: nd.name, primitives });
  }
  const json = { asset: { version: '2.0', generator: 'Tandem make-example-models' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes: nodes.map((nd, i) => ({ name: nd.name, mesh: i })), meshes, materials, accessors, bufferViews, buffers: [{ byteLength: off }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(bins);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]);
}

// ---------------- the mini arm (meters, Z up, zero pose = straight up)
const W: Prim['color'] = [0.95, 0.96, 0.98], A: Prim['color'] = [0.18, 0.6, 0.94], D: Prim['color'] = [0.16, 0.19, 0.22];
const J = [ // joint origins along z (each relative to the previous link frame) and axes
  { z: 0.16, axis: '0 0 1', lim: 6.2832 }, { z: 0.08, axis: '0 1 0', lim: 2.5 }, { z: 0.35, axis: '0 1 0', lim: 2.8 },
  { z: 0.3, axis: '0 0 1', lim: 6.2832 }, { z: 0.08, axis: '0 1 0', lim: 3.05 }, { z: 0.08, axis: '0 0 1', lim: 6.2832 },
];
const LINKS: Prim[][] = [
  [cyl(0.075, 0, 0.03, A), cyl(0.065, 0.03, 0.16, W)], // base
  [cyl(0.06, -0.01, 0.08, W), cyl(0.062, -0.07, 0.07, A, 'y', [0, 0, 0.08])], // link1: turret + shoulder housing
  [box([0, 0, 0.175], [0.07, 0.07, 0.3], W), cyl(0.055, -0.065, 0.065, A, 'y', [0, 0, 0.35])], // link2: upper arm + elbow
  [box([0, 0, 0.12], [0.06, 0.06, 0.24], W), cyl(0.042, 0.24, 0.3, W)], // link3: forearm
  [cyl(0.04, 0, 0.08, W), cyl(0.042, -0.05, 0.05, A, 'y', [0, 0, 0.08])], // link4: wrist 1
  [cyl(0.038, 0, 0.08, W)], // link5: wrist 2
  [cyl(0.034, 0, 0.03, D)], // link6: flange
];
const out = 'public/models/examples';
mkdirSync(`${out}/mini-arm/urdf`, { recursive: true }); mkdirSync(`${out}/mini-arm/meshes`, { recursive: true }); mkdirSync(`${out}/props`, { recursive: true });
const names = ['base_link', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6'];
LINKS.forEach((prims, i) => writeFileSync(`${out}/mini-arm/meshes/${names[i]}.stl`, stl(prims)));
const urdf = `<?xml version="1.0"?>
<!-- Tandem example: a 6-axis arm. Meshes are STL in meters, in each link's frame. -->
<robot name="Tandem Mini 6">
${names.map((n) => `  <link name="${n}"><visual><geometry><mesh filename="package://mini-arm/meshes/${n}.stl"/></geometry></visual></link>`).join('\n')}
  <link name="tool0"/>
${J.map((j, i) => `  <joint name="joint${i + 1}" type="revolute"><parent link="${names[i]}"/><child link="${names[i + 1]}"/><origin xyz="0 0 ${j.z}" rpy="0 0 0"/><axis xyz="${j.axis}"/><limit lower="${-j.lim}" upper="${j.lim}" velocity="1.6" effort="50"/></joint>`).join('\n')}
  <joint name="flange" type="fixed"><parent link="link6"/><child link="tool0"/><origin xyz="0 0 0.03"/></joint>
</robot>
`;
writeFileSync(`${out}/mini-arm/urdf/mini_arm.urdf`, urdf);
// same arm, one GLB, every part placed where it is at zero pose
let z = 0;
const placed = LINKS.map((prims, i) => { if (i > 0) z += J[i - 1].z; return { name: names[i], prims: prims.map((p) => moved(p, [0, 0, z])) }; });
writeFileSync(`${out}/mini-arm/mini_arm.glb`, glb(placed));

// ---------------- props
writeFileSync(`${out}/props/machine.glb`, glb([{ name: 'machine', prims: [
  box([0, 0, 0.3], [0.5, 0.4, 0.6], [0.92, 0.94, 0.97]), box([0, -0.201, 0.38], [0.36, 0.01, 0.26], [0.35, 0.75, 0.98]),
  box([0, 0, 0.62], [0.52, 0.42, 0.04], [0.18, 0.6, 0.94]), cyl(0.02, 0.64, 0.74, [0.2, 0.75, 0.3], 'z', [0.2, 0.15, 0]),
] }]));
writeFileSync(`${out}/props/crate.obj`, obj([box([0, 0, 0.1], [0.3, 0.2, 0.2], W), box([0, 0, 0.205], [0.32, 0.22, 0.01], W)]));
writeFileSync(`${out}/props/widget.stl`, stl([cyl(20, 0, 12, W), cyl(9, 12, 50, W)])); // millimeters (the default for .stl)
console.log('✓ wrote example models to', out);
