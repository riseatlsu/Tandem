import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { ArmDef, MeshRef } from '../sim/types';
import { glossy } from './materials';
import { loadModel, attachModel } from './meshes';
import { fk } from '../sim/kinematics/fk';
import { pos, sub, norm, type M4 } from '../sim/math/mat4';

const BASE = import.meta.env.BASE_URL;
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function setFromArray(o: THREE.Object3D, m: M4) {
  o.matrix.fromArray(m);
  o.matrixWorldNeedsUpdate = true;
}

/** Mesh placement copied from UAIbotJS (create_kuka_kr5 / create_epson_t6), MIT licensed. */
type Placement = { file: string; frame: number; apply: (o: THREE.Object3D) => void; color: string };
const H = 3.14 / 2;
const UAIBOT: Record<'kuka_kr5' | 'epson_t6', Placement[]> = {
  kuka_kr5: [
    { file: 'Base', frame: 0, color: '#30353d', apply: (o) => { o.rotation.x = H; } },
    { file: 'Axis1', frame: 1, color: '#ff7a1a', apply: (o) => { o.rotation.x = H; o.position.set(0, 0, 0.203); o.rotation.y = H; } },
    { file: 'Axis2', frame: 2, color: '#ff7a1a', apply: (o) => { o.rotation.x = -H; o.rotation.z = 3.14; o.rotation.y = -3.14 / 13; o.position.set(0, 0, 0.1); } },
    { file: 'Axis3', frame: 3, color: '#ff7a1a', apply: (o) => { o.rotation.x = H; o.rotation.z = -H; } },
    { file: 'Axis4', frame: 4, color: '#ff7a1a', apply: (o) => { o.rotation.z = -H; o.rotation.x = H; o.position.set(0, 0, -0.218); } },
    { file: 'Axis5', frame: 5, color: '#ff7a1a', apply: (o) => { o.rotation.x = H; } },
    { file: 'Axis6', frame: 7, color: '#3a4049', apply: (o) => { o.rotation.x = H; o.position.set(0, 0, -0.012); } },
  ],
  epson_t6: [
    { file: 'Base', frame: 0, color: '#eef1f5', apply: (o) => { o.translateX(-0.062); o.rotation.x = H; } },
    { file: 'T6Axis1', frame: 1, color: '#f4f6f9', apply: (o) => { o.translateZ(0.2); o.rotation.x = H; } },
    { file: 'T6Cable', frame: 1, color: '#3a4049', apply: (o) => { o.translateZ(0.44); o.rotation.x = H; o.rotation.y = -H; } },
    { file: 'T6Axis2', frame: 2, color: '#f4f6f9', apply: (o) => { o.rotation.x = H; o.translateX(0.275); o.translateY(0.075); } },
    { file: 'T6Axis3', frame: 3, color: '#9aa5b1', apply: (o) => { o.rotation.x = H; } },
  ],
};

export { glossy };

function depthOf(o: THREE.Object3D) { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; }

export class RobotVisual {
  group = new THREE.Group();
  private frames: THREE.Group[] = [];
  private segs: { mesh: THREE.Mesh; a: number; b: number }[] = [];
  private housings: { mesh: THREE.Mesh; joint: number }[] = [];
  private gripper = new THREE.Group();
  private fingers: THREE.Mesh[] = [];
  private opening = 0.06;
  private mats: THREE.MeshPhysicalMaterial[] = [];
  private flash = 0;

  private ghostMat: THREE.MeshPhysicalMaterial | null = null;

  /** `ghost` builds a translucent, shadowless copy used for motion previews. */
  constructor(private arm: ArmDef, opts: { ghost?: boolean } = {}) {
    this.group.name = opts.ghost ? 'ghost' : 'robot';
    if (opts.ghost) this.ghostMat = new THREE.MeshPhysicalMaterial({ color: '#7fdcff', emissive: new THREE.Color('#2aa8ff'), emissiveIntensity: 0.45, roughness: 0.15, transparent: true, opacity: 0.34, depthWrite: false });
    this.arm.links.forEach(() => {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      this.frames.push(g);
      this.group.add(g);
    });
    if (arm.visual.source === 'uaibot') this.loadUaibot(arm.visual.model);
    else if (arm.visual.source === 'mesh') this.loadMeshes(arm.visual);
    else this.buildProcedural(arm.visual.color, arm.visual.accent);
    this.buildGripper();
    this.unshadow();
  }

  private track<T extends THREE.Material>(m: T): T {
    if (this.ghostMat) { m.dispose(); return this.ghostMat as unknown as T; }
    if (m instanceof THREE.MeshPhysicalMaterial) this.mats.push(m);
    return m;
  }
  private unshadow() { if (this.ghostMat) this.group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; }); }

  private loadUaibot(model: 'kuka_kr5' | 'epson_t6') {
    const loader = new OBJLoader();
    for (const p of UAIBOT[model]) {
      loader.load(`${BASE}models/uaibot/${model}/${p.file}.obj`, (root) => {
        const mat = this.track(glossy(p.color, { roughness: 0.38 }));
        root.traverse((c) => { if ((c as THREE.Mesh).isMesh) { (c as THREE.Mesh).material = mat; c.castShadow = true; c.receiveShadow = true; } });
        root.scale.set(0.001, 0.001, 0.001);
        p.apply(root);
        this.frames[p.frame].add(root);
        this.unshadow();
      });
    }
  }

  /** Your own arm models: per-link files and/or one file with named nodes (see ArmDef.visual). */
  private loadMeshes(v: Extract<ArmDef['visual'], { source: 'mesh' }>) {
    const zero = fk(this.arm, new Array(this.arm.dof).fill(0)).frames;
    const linkIndex = (l: number | string) => (typeof l === 'number' ? l : this.arm.links.findIndex((x) => x.name === l));
    // a holder inside a link frame; 'zero' = the model was built in place with every joint at 0
    const holder = (idx: number, frame: 'link' | 'zero' | undefined) => {
      const h = new THREE.Group();
      h.matrixAutoUpdate = false;
      if (frame === 'zero') h.matrix.fromArray(zero[idx]).invert();
      this.frames[idx].add(h);
      return h;
    };
    const adopt = (g: THREE.Object3D) => {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (this.ghostMat) { m.material = this.ghostMat; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 5; }
        else for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if ((mat as THREE.MeshStandardMaterial).emissive) this.mats.push(mat as THREE.MeshPhysicalMaterial);
      });
    };
    for (const p of v.parts ?? []) {
      const idx = linkIndex(p.link);
      if (idx < 0 || idx >= this.frames.length) { console.warn(`[models] arm ${this.arm.id}: unknown link ${p.link}`); continue; }
      attachModel(holder(idx, p.frame), p, 'none', [0.04, 0.04, 0.04], adopt);
    }
    if (v.model) {
      const { nodes, frame = 'zero', ...ref } = v.model;
      loadModel(ref as MeshRef, 'none').then((root) => {
        root.updateMatrixWorld(true);
        const entries = Object.entries(nodes).map(([name, link]) => ({ node: root.getObjectByName(name), idx: linkIndex(link), name }));
        for (const e of entries) if (!e.node || e.idx < 0) console.warn(`[models] arm ${this.arm.id}: node "${e.name}" or its link not found`);
        const ok = entries.filter((e) => e.node && e.idx >= 0).map((e) => ({ ...e, world: e.node!.matrixWorld.clone(), depth: depthOf(e.node!) }));
        ok.sort((a, b) => b.depth - a.depth); // detach children before their parents
        for (const e of ok) {
          e.node!.removeFromParent();
          e.node!.matrixAutoUpdate = false;
          e.node!.matrix.copy(e.world);
          holder(e.idx, frame).add(e.node!);
          adopt(e.node!);
        }
        holder(0, frame).add(root); // anything not mapped rides on the base
        adopt(root);
      }).catch((err) => console.warn(`[models] could not load ${v.model!.file}:`, err?.message ?? err));
    }
  }

  private buildProcedural(color: string, accent: string) {
    const white = this.track(glossy(color));
    const accentMat = this.track(glossy(accent, { roughness: 0.4 }));
    const dark = this.track(glossy('#2a3038', { roughness: 0.5 }));
    // base pedestal
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.06, 48), white);
    base.rotation.x = Math.PI / 2; base.position.z = 0.03; base.castShadow = true;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0962, 0.0962, 0.008, 48), accentMat);
    ring.rotation.x = Math.PI / 2; ring.position.z = 0.004;
    this.frames[0].add(base, ring);
    // capsule links between successive origins (computed once at home, updated per frame)
    const q = this.arm.home;
    const f = fk(this.arm, q);
    const origins = f.frames.map(pos);
    let prev = 0, k = 0;
    for (let i = 1; i < origins.length; i++) {
      if (norm(sub(origins[i], origins[prev])) < 0.005) continue;
      const r = (this.arm.linkRadius[k] ?? 40) / 1000 * 0.82;
      const len = norm(sub(origins[i], origins[prev]));
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 32), white);
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.group.add(m);
      this.segs.push({ mesh: m, a: prev, b: i });
      prev = i; k++;
    }
    // joint housings aligned with each joint axis
    for (let j = 0; j < this.arm.dof; j++) {
      const r = (this.arm.linkRadius[Math.min(j + 1, this.arm.linkRadius.length - 1)] ?? 45) / 1000 * 1.05;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 2.3, 40), white);
      body.rotation.x = Math.PI / 2; body.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, r * 2.34, 40), accentMat);
      cap.rotation.x = Math.PI / 2;
      const capIn = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, r * 2.36, 40), dark);
      capIn.rotation.x = Math.PI / 2;
      g.add(body, cap, capIn);
      const mesh = g as unknown as THREE.Mesh;
      g.matrixAutoUpdate = false;
      this.group.add(g);
      this.housings.push({ mesh, joint: j });
    }
  }

  private buildGripper() {
    const tz = this.arm.toolM[14];
    const body = this.track(glossy('#e8edf2'));
    const dark = this.track(glossy('#2a3038', { roughness: 0.45 }));
    const aqua = this.track(glossy('#2d9bf0', { emissive: new THREE.Color('#1a8cff'), emissiveIntensity: 0.25 }));
    const fl = 0.045;
    const bodyLen = Math.max(0.03, tz - fl);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 32), dark);
    flange.rotation.x = Math.PI / 2; flange.position.z = 0.006;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, bodyLen - 0.012), body);
    housing.position.z = 0.012 + (bodyLen - 0.012) / 2;
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.0755, 0.012, 0.006), aqua);
    led.position.z = 0.018;
    for (const m of [flange, housing]) m.castShadow = true;
    this.gripper.add(flange, housing, led);
    for (const s of [-1, 1]) {
      const fgeo = new THREE.BoxGeometry(0.012, 0.022, fl);
      fgeo.translate(0, 0, fl / 2);
      const finger = new THREE.Mesh(fgeo, dark);
      finger.position.set(0, 0, bodyLen);
      finger.userData.side = s;
      finger.castShadow = true;
      this.fingers.push(finger);
      this.gripper.add(finger);
    }
    this.gripper.matrixAutoUpdate = false;
    this.group.add(this.gripper);
  }

  triggerFlash() { this.flash = 1; }

  update(q: number[], gripperOpen: boolean, holdingWidth: number | null, dt: number) {
    const f = fk(this.arm, q);
    f.frames.forEach((F, i) => setFromArray(this.frames[i], F));
    // links
    for (const s of this.segs) {
      const a = new THREE.Vector3(...pos(f.frames[s.a])), b = new THREE.Vector3(...pos(f.frames[s.b]));
      const d = b.clone().sub(a); const len = d.length();
      const quat = new THREE.Quaternion().setFromUnitVectors(UP, len > 1e-9 ? d.normalize() : UP);
      s.mesh.matrix.compose(a.clone().add(b).multiplyScalar(0.5), quat, ONE);
      s.mesh.matrixWorldNeedsUpdate = true;
    }
    for (const h of this.housings) {
      setFromArray(h.mesh, f.jointFrames[h.joint]);
    }
    setFromArray(this.gripper, f.flange);
    const target = gripperOpen ? this.arm.gripper.stroke / 1000 : holdingWidth ?? 0.004;
    this.opening += (target - this.opening) * Math.min(1, dt * 14);
    for (const fg of this.fingers) fg.position.y = (fg.userData.side as number) * (this.opening / 2 + 0.006);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 1.2);
      for (const m of this.mats) { m.emissive.setRGB(0.9 * this.flash, 0.1 * this.flash, 0.15 * this.flash); }
    }
    return f;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); }
    });
    this.mats.forEach((m) => m.dispose());
    this.ghostMat?.dispose();
  }
}

