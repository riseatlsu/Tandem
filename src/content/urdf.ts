/**
 * URDF → Tandem arm JSON. Pure (no DOM), so it runs in the editor and in unit tests.
 * Follows one serial chain from the root link to a tip link; fixed joints are kept as joint-less links.
 * Each movable joint becomes  pre = T(origin)·A,  post = A⁻¹  where A turns Tandem's joint axis (+Z)
 * onto the URDF axis — so every Tandem link frame equals the URDF link frame and visual origins carry over.
 */
import { DEG, I4, mul, rotX, rotY, rotZ, toEulerXYZ, trans, type M4 } from '../sim/math/mat4';
import type { ArmJson, ArmLink, ArmMeshPart } from '../sim/types';

// ---------------- tiny XML reader (URDF only needs elements + attributes)
export interface XmlEl { name: string; attrs: Record<string, string>; children: XmlEl[] }
export function parseXml(src: string): XmlEl {
  const text = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root: XmlEl = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, close, name, attrSrc, self] = m;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of attrSrc.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[3] ?? a[4] ?? '';
    const el: XmlEl = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  return root;
}
const kids = (e: XmlEl, n: string) => e.children.filter((c) => c.name === n);
const kid = (e: XmlEl, n: string) => e.children.find((c) => c.name === n);
const nums = (s: string | undefined, d: number[]) => (s ? s.trim().split(/\s+/).map(Number) : d);

// ---------------- URDF model
type V3 = [number, number, number];
export interface UrdfVisual { file?: string; primitive?: string; xyz: V3; rpy: V3; scale: number }
export interface UrdfJoint { name: string; type: 'revolute' | 'continuous' | 'prismatic' | 'fixed' | 'floating' | 'planar'; parent: string; child: string; xyz: V3; rpy: V3; axis: V3; lower?: number; upper?: number; velocity?: number }
export interface UrdfModel { name: string; links: string[]; joints: UrdfJoint[]; visuals: Record<string, UrdfVisual[]>; root: string }

export function parseUrdf(xml: string): UrdfModel {
  const robot = kid(parseXml(xml), 'robot');
  if (!robot) throw new Error('Not a URDF file (no <robot> element).');
  const links = kids(robot, 'link').map((l) => l.attrs.name);
  const visuals: Record<string, UrdfVisual[]> = {};
  for (const l of kids(robot, 'link')) {
    visuals[l.attrs.name] = kids(l, 'visual').map((v) => {
      const o = kid(v, 'origin'), g = kid(v, 'geometry');
      const mesh = g && kid(g, 'mesh');
      return {
        file: mesh?.attrs.filename, primitive: !mesh && g?.children[0]?.name || undefined,
        xyz: nums(o?.attrs.xyz, [0, 0, 0]) as V3, rpy: nums(o?.attrs.rpy, [0, 0, 0]) as V3, scale: nums(mesh?.attrs.scale, [1])[0],
      };
    });
  }
  const joints: UrdfJoint[] = kids(robot, 'joint').map((j) => {
    const o = kid(j, 'origin'), lim = kid(j, 'limit');
    const axis = nums(kid(j, 'axis')?.attrs.xyz, [1, 0, 0]);
    const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    return {
      name: j.attrs.name, type: j.attrs.type as UrdfJoint['type'], parent: kid(j, 'parent')?.attrs.link ?? '', child: kid(j, 'child')?.attrs.link ?? '',
      xyz: nums(o?.attrs.xyz, [0, 0, 0]) as V3, rpy: nums(o?.attrs.rpy, [0, 0, 0]) as V3, axis: [axis[0] / n, axis[1] / n, axis[2] / n],
      lower: lim?.attrs.lower !== undefined ? +lim.attrs.lower : undefined, upper: lim?.attrs.upper !== undefined ? +lim.attrs.upper : undefined,
      velocity: lim?.attrs.velocity !== undefined ? +lim.attrs.velocity : undefined,
    };
  });
  const children = new Set(joints.map((j) => j.child));
  const root = links.find((l) => !children.has(l)) ?? links[0];
  return { name: robot.attrs.name ?? 'robot', links, joints, visuals, root };
}

/** Links you can choose as the end of the arm (the last link of each branch from the root). */
export function urdfTips(m: UrdfModel): string[] {
  const parents = new Set(m.joints.map((j) => j.parent));
  return m.links.filter((l) => l !== m.root && !parents.has(l));
}
/** Joints from root to tip. */
export function urdfChain(m: UrdfModel, tip: string): UrdfJoint[] {
  const out: UrdfJoint[] = [];
  for (let cur = tip; cur !== m.root;) {
    const j = m.joints.find((x) => x.child === cur);
    if (!j) throw new Error(`Link "${tip}" is not connected to the root link "${m.root}".`);
    out.unshift(j);
    cur = j.parent;
  }
  return out;
}

const rpyM = (r: V3): M4 => mul(rotZ(r[2]), mul(rotY(r[1]), rotX(r[0]))); // URDF: fixed-axis roll, pitch, yaw
/** Rotation taking +Z onto unit vector a (Rodrigues). */
function zTo(a: V3): M4 {
  const c = a[2];
  if (c > 1 - 1e-9) return I4();
  if (c < -1 + 1e-9) return rotX(Math.PI);
  const k: V3 = [-a[1], a[0], 0]; const s = Math.hypot(k[0], k[1]); k[0] /= s; k[1] /= s;
  const t = Math.acos(c), sn = Math.sin(t), v = 1 - Math.cos(t);
  const [x, y, z] = k;
  // column-major
  return [
    Math.cos(t) + x * x * v, y * x * v + z * sn, z * x * v - y * sn, 0,
    x * y * v - z * sn, Math.cos(t) + y * y * v, z * y * v + x * sn, 0,
    x * z * v + y * sn, y * z * v - x * sn, Math.cos(t) + z * z * v, 0,
    0, 0, 0, 1,
  ];
}
const transpose3 = (m: M4): M4 => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
const r9 = (m: M4) => m.map((v) => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(9)));

/** Turns a URDF mesh filename into a path under public/ ("models/..."). */
export function resolveMeshPath(filename: string, urdfPath: string): string {
  const dir = urdfPath.split('/').slice(0, -1);
  let parts: string[];
  const pkg = filename.match(/^package:\/\/([^/]+)\/(.*)$/);
  if (pkg) {
    const at = dir.lastIndexOf(pkg[1]);
    const base = at >= 0 ? dir.slice(0, at + 1) : dir[dir.length - 1] === 'urdf' ? dir.slice(0, -1) : dir;
    parts = [...base, ...pkg[2].split('/')];
  } else {
    parts = [...dir, ...filename.replace(/^file:\/\//, '').split('/')];
  }
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

export interface UrdfArmOptions { id: string; name?: string; tip: string; urdfPath: string; toolZmm?: number; linkRadiusMm?: number }
export interface UrdfArmResult { arm: ArmJson; warnings: string[]; meshFiles: string[] }

export function urdfToArm(m: UrdfModel, o: UrdfArmOptions): UrdfArmResult {
  const warnings: string[] = [];
  const chain = urdfChain(m, o.tip);
  const links: ArmLink[] = [{ name: m.root, pre: I4(), joint: null, post: I4() }];
  const limits: ArmJson['jointLimitsDeg'] = [];
  let dof = 0;
  for (const j of chain) {
    const origin = mul(trans(j.xyz[0], j.xyz[1], j.xyz[2]), rpyM(j.rpy));
    if (j.type === 'revolute' || j.type === 'continuous' || j.type === 'prismatic') {
      const A = zTo(j.axis);
      const P = j.type === 'prismatic';
      links.push({ name: j.child, pre: r9(mul(origin, A)), joint: { index: dof++, type: P ? 'P' : 'R' }, post: r9(transpose3(A)) });
      if (P) limits.push({ min: Math.round((j.lower ?? -0.2) * 1000), max: Math.round((j.upper ?? 0.2) * 1000), maxVel: Math.round((j.velocity ?? 0.25) * 1000) });
      else if (j.type === 'continuous') limits.push({ min: -360, max: 360, maxVel: Math.round((j.velocity ?? Math.PI / 2) / DEG) });
      else limits.push({ min: +((j.lower ?? -Math.PI) / DEG).toFixed(2), max: +((j.upper ?? Math.PI) / DEG).toFixed(2), maxVel: Math.round(Math.min(j.velocity ?? Math.PI / 2, 4) / DEG) });
    } else {
      if (j.type !== 'fixed') warnings.push(`Joint "${j.name}" is ${j.type}; treated as fixed.`);
      links.push({ name: j.child, pre: r9(origin), joint: null, post: I4() });
    }
  }
  if (!dof) throw new Error('The chain to that tip link has no movable joints.');

  const parts: ArmMeshPart[] = [];
  const meshFiles: string[] = [];
  for (const l of links) for (const v of m.visuals[l.name] ?? []) {
    if (!v.file) { warnings.push(`Link "${l.name}" uses a ${v.primitive ?? 'primitive'} shape, which is skipped (only mesh visuals are imported).`); continue; }
    const file = resolveMeshPath(v.file, o.urdfPath);
    const ext = file.split('.').pop()!.toLowerCase();
    if (!['stl', 'dae', 'obj', 'glb', 'gltf'].includes(ext)) { warnings.push(`Mesh ${file} has an unsupported format (.${ext}).`); continue; }
    meshFiles.push(file);
    const e = toEulerXYZ(rpyM(v.rpy));
    parts.push({
      link: l.name, file, units: 'm', ...(v.scale !== 1 ? { scale: v.scale } : {}), upAxis: ext === 'stl' || ext === 'obj' ? 'z' : 'y',
      ...(v.xyz.some((x) => x) ? { offset: v.xyz.map((x) => +(x * 1000).toFixed(3)) as V3 } : {}),
      ...(e.some((x) => Math.abs(x) > 1e-9) ? { rotation: e.map((x) => +(x / DEG).toFixed(4)) as V3 } : {}),
    });
  }
  const home = limits.map((l) => Math.min(l.max, Math.max(l.min, 0)));
  const arm: ArmJson = {
    id: o.id, name: o.name ?? m.name, kind: dof === 6 ? 'articulated6' : 'other',
    links, jointLimitsDeg: limits, tool: { x: 0, y: 0, z: o.toolZmm ?? 120, rx: 0, ry: 0, rz: 0 }, homeDeg: home,
    maxTcpSpeed: 1000, linkRadius: links.map(() => o.linkRadiusMm ?? 45),
    visual: { source: 'mesh', parts }, gripper: { stroke: 60, graspTolerance: 15, alignTolDeg: 20 },
  };
  return { arm, warnings, meshFiles };
}
