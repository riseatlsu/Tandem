/**
 * Loads your own 3D models (public/models/...) for arms, fixtures and objects.
 * Formats: .glb/.gltf (with materials), .obj, .stl, .dae. Models are purely visual.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import type { MeshRef } from '../sim/types';
import { glossy } from './materials';

const BASE = import.meta.env.BASE_URL;
const UNIT: Record<NonNullable<MeshRef['units']>, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };
const ext = (f: string) => (f.split('.').pop() ?? '').toLowerCase();
export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'stl', 'dae'];

export const defaultUnits = (file: string): NonNullable<MeshRef['units']> => (['obj', 'stl'].includes(ext(file)) ? 'mm' : 'm');
export const defaultUp = (file: string): 'y' | 'z' => (ext(file) === 'stl' ? 'z' : 'y');
export const modelUrl = (file: string) => (/^(https?:|blob:|data:)/.test(file) ? file : `${BASE}${file.replace(/^\/+/, '')}`);

const cache = new Map<string, Promise<THREE.Object3D>>();
function loadRaw(file: string): Promise<THREE.Object3D> {
  let p = cache.get(file);
  if (!p) {
    const url = modelUrl(file);
    p = new Promise<THREE.Object3D>((resolve, reject) => {
      const e = ext(file);
      if (e === 'glb' || e === 'gltf') new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject);
      else if (e === 'obj') new OBJLoader().load(url, resolve, undefined, reject);
      else if (e === 'stl') new STLLoader().load(url, (geo) => { geo.computeVertexNormals(); resolve(new THREE.Mesh(geo)); }, undefined, reject);
      else if (e === 'dae') new ColladaLoader().load(url, (c) => (c ? resolve(c.scene) : reject(new Error('empty Collada file'))), undefined, reject);
      else reject(new Error(`Unsupported model format .${e}`));
    });
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

/** Applies materials (files without them get a glossy default; `color` overrides) and shadows. */
function finish(root: THREE.Object3D, color: string | undefined, file: string) {
  const plain = ['obj', 'stl'].includes(ext(file));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone(); // clones share materials otherwise
    if (plain || color) {
      const base = Array.isArray(m.material) ? m.material[0] : m.material;
      const c = color ?? ((base as THREE.MeshStandardMaterial | undefined)?.color && !plain ? `#${(base as THREE.MeshStandardMaterial).color.getHexString()}` : '#e3e9ef');
      m.material = glossy(c);
    }
  });
}

/**
 * A ready-to-place model: units, up axis and scale applied, then
 * `align` = 'center' (bounding-box center at the origin), 'bottom' (bottom-center at the origin) or 'none' (file origin),
 * then the ref's rotation (deg) and offset (mm).
 */
export async function loadModel(ref: MeshRef, align: 'center' | 'bottom' | 'none' = 'center'): Promise<THREE.Group> {
  const raw = (await loadRaw(ref.file)).clone(true);
  finish(raw, ref.color, ref.file);
  const inner = new THREE.Group();
  inner.add(raw);
  const s = UNIT[ref.units ?? defaultUnits(ref.file)] * (ref.scale ?? 1);
  inner.scale.setScalar(s);
  if ((ref.upAxis ?? defaultUp(ref.file)) === 'y') inner.rotation.x = Math.PI / 2; // Y-up file → Tandem's Z-up world
  inner.updateMatrixWorld(true);
  if (align !== 'none') {
    const box = new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -c.y, align === 'bottom' ? -box.min.z : -c.z);
  }
  const outer = new THREE.Group();
  outer.add(inner);
  const r = ref.rotation ?? [0, 0, 0];
  outer.rotation.set(r[0] * THREE.MathUtils.DEG2RAD, r[1] * THREE.MathUtils.DEG2RAD, r[2] * THREE.MathUtils.DEG2RAD);
  const o = ref.offset ?? [0, 0, 0];
  outer.position.set(o[0] / 1000, o[1] / 1000, o[2] / 1000);
  return outer;
}

/** Size (mm) of a model's bounding box after units/up/scale/rotation — used to fit collision boxes. */
export async function modelSizeMm(ref: MeshRef): Promise<[number, number, number]> {
  const g = await loadModel({ ...ref, offset: [0, 0, 0] }, 'center');
  g.updateMatrixWorld(true);
  const s = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  return [Math.round(s.x * 1000), Math.round(s.y * 1000), Math.round(s.z * 1000)];
}

/** Placeholder shown while a model loads or when it fails (red wireframe = check the file path). */
export function placeholder(sizeM: [number, number, number], failed = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...sizeM), new THREE.MeshBasicMaterial({ color: failed ? '#ef4b5f' : '#7fb8e6', wireframe: true, transparent: true, opacity: 0.6 }));
  m.name = 'model-placeholder';
  return m;
}

/** Puts a model into `parent` (replacing a placeholder), reporting load errors without throwing. */
export function attachModel(parent: THREE.Object3D, ref: MeshRef, align: 'center' | 'bottom' | 'none', sizeM: [number, number, number], onLoaded?: (g: THREE.Group) => void) {
  const ph = placeholder(sizeM);
  if (align === 'bottom') ph.position.z = sizeM[2] / 2;
  parent.add(ph);
  loadModel(ref, align).then((g) => { parent.remove(ph); parent.add(g); onLoaded?.(g); })
    .catch((e) => { console.warn(`[models] could not load ${ref.file}:`, e?.message ?? e); parent.remove(ph); const bad = placeholder(sizeM, true); if (align === 'bottom') bad.position.z = sizeM[2] / 2; parent.add(bad); });
}

/** Names of the named parts inside a model (for mapping a single-file arm's nodes to links). */
export async function modelNodeNames(file: string): Promise<string[]> {
  const raw = await loadRaw(file);
  const names: string[] = [];
  raw.traverse((o) => { if (o.name && o !== raw && !names.includes(o.name)) names.push(o.name); });
  // glTF splits multi-material meshes into "<name>_1", "<name>_2"… children; they follow their parent anyway
  return names.filter((n) => !(/_\d+$/.test(n) && names.includes(n.replace(/_\d+$/, ''))));
}
