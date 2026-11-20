import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SimCore } from '../sim/SimCore';
import type { FixtureDef, ObjState, SceneDef, Target } from '../sim/types';
import { poseToM4 } from '../sim/kinematics/arm';
import { apply, col, pos, type M4 } from '../sim/math/mat4';
import { RobotVisual, glossy } from './robotVisual';
import { ghostEnded, onGhost, sampleGhost, type GhostClip } from './ghost';

export const COLOR_NAMES: Record<string, string> = {
  red: '#ef4b5f', green: '#36c25a', blue: '#2d8cf0', yellow: '#f8c630', orange: '#ff8a2a', purple: '#9b6bff', white: '#f4f6f8', black: '#2a3038',
};
export const colorHex = (c: string) => COLOR_NAMES[c] ?? c;
const mm = (v: number) => v / 1000;

function labelSprite(text: string, color = '#0d2240', bg = 'rgba(255,255,255,0.88)') {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 44px Inter, -apple-system, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 44;
  c.width = w; c.height = 76;
  ctx.font = font;
  ctx.fillStyle = bg;
  const r = 36;
  ctx.beginPath(); ctx.roundRect(2, 2, w - 4, 72, r); ctx.fill();
  ctx.strokeStyle = 'rgba(16,64,128,0.15)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 22, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w / 76 * 0.04, 0.04, 1);
  s.renderOrder = 10;
  return s;
}

function beltTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b3139'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#353c46'; for (let i = 0; i < 64; i += 16) g.fillRect(i, 0, 7, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(256, 256, 10, 256, 256, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.55, 'rgba(236,246,255,0.7)'); grd.addColorStop(1, 'rgba(236,246,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(26,140,255,0.08)'; g.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Scene3DCallbacks {
  onGuide(target: M4): boolean;
  onGuideStart(): void;
  onGuideEnd(): void;
  onCameraMove(): void;
}

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private tc: TransformControls;
  private proxy = new THREE.Object3D();
  private world = new THREE.Group();
  private robot: RobotVisual | null = null;
  private robotArmId = '';
  private objMeshes = new Map<string, THREE.Group>();
  private targetGroup = new THREE.Group();
  private belts: { tex: THREE.Texture; speed: number; runOutput: string; len: number }[] = [];
  private stream: THREE.Mesh;
  private tcpMarker: THREE.Mesh;
  private sceneId = '';
  private lastSimTime = 0;
  private dragging = false;
  guideEnabled = false;
  private ro: ResizeObserver;
  private raf = 0;
  private lastT = performance.now();
  private targetsKey = '';
  private ghost: RobotVisual | null = null;
  private ghostClip: GhostClip | null = null;
  private ghostT = 0;
  private offGhost: () => void;
  /** exposed for E2E hand-guide simulation */
  cbForTests: Scene3DCallbacks;

  constructor(private host: HTMLElement, cb: Scene3DCallbacks, private onFrame: (dt: number) => SimCore | null) {
    this.cbForTests = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '3D robot cell view. Drag to orbit, scroll to zoom.');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 50);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.7, -1.3, 1.1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 6;
    this.controls.addEventListener('end', () => cb.onCameraMove());

    // lights
    this.scene.add(new THREE.HemisphereLight('#d6ecff', '#f3efe7', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(1.6, -1.2, 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -1.6; sun.shadow.camera.right = 1.6; sun.shadow.camera.top = 1.6; sun.shadow.camera.bottom = -1.6;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 8;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 5;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#bfe6ff', 0.6);
    rim.position.set(-2, 2, 1.5);
    this.scene.add(rim);

    // floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 96), new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false }));
    floor.position.z = -0.75;
    this.scene.add(floor);
    const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
    shadowCatcher.position.z = -0.749; shadowCatcher.receiveShadow = true;
    this.scene.add(shadowCatcher);

    this.scene.add(this.world, this.targetGroup);

    // pour stream
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 1, 12, 1, true), new THREE.MeshPhysicalMaterial({ color: '#59c5ff', transmission: 0.5, roughness: 0.05, transparent: true, opacity: 0.85 }));
    this.stream.visible = false;
    this.scene.add(this.stream);

    // TCP marker
    this.tcpMarker = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 12, 40), new THREE.MeshBasicMaterial({ color: '#1a8cff', transparent: true, opacity: 0.85 }));
    this.scene.add(this.tcpMarker);

    // hand-guide gizmo
    this.scene.add(this.proxy);
    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSize(0.85);
    this.tc.attach(this.proxy);
    this.tc.enabled = false;
    const helper = this.tc.getHelper();
    helper.visible = false;
    this.scene.add(helper);
    this.tc.addEventListener('dragging-changed', (e) => {
      const d = (e as unknown as { value: boolean }).value;
      this.dragging = d;
      this.controls.enabled = !d;
      if (d) cb.onGuideStart(); else cb.onGuideEnd();
    });
    this.tc.addEventListener('objectChange', () => {
      if (!this.dragging) return;
      this.proxy.updateMatrixWorld();
      const m = this.proxy.matrixWorld.toArray();
      const ok = cb.onGuide(m);
      (this.tcpMarker.material as THREE.MeshBasicMaterial).color.set(ok ? '#2fb84a' : '#ef4b5f');
    });

    this.offGhost = onGhost((clip) => { this.ghostClip = clip && clip.frames.length ? clip : null; this.ghostT = 0; if (this.ghost) this.ghost.group.visible = !!this.ghostClip; });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  setGuide(on: boolean, mode: 'translate' | 'rotate') {
    this.guideEnabled = on;
    this.tc.enabled = on;
    this.tc.getHelper().visible = on;
    this.tc.setMode(mode);
    this.tc.setSpace(mode === 'rotate' ? 'local' : 'world');
    (this.tcpMarker.material as THREE.MeshBasicMaterial).color.set(on ? '#2fb84a' : '#1a8cff');
  }

  flashFault() { this.robot?.triggerFlash(); }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Pause rendering (e.g. when scrolled out of view on the landing page). */
  paused = false;
  /** Landing-page mode: no zoom/pan (the page scrolls), slow auto-orbit, no TCP marker or target frames. */
  private showcase = false;
  setShowcase() {
    this.showcase = true;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.tcpMarker.visible = false;
    this.targetGroup.visible = false;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused) { this.lastT = performance.now(); return; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const sim = this.onFrame(dt);
    if (sim) this.sync(sim, dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ---------------- scene construction
  private buildScene(scene: SceneDef) {
    this.world.clear();
    this.objMeshes.clear();
    this.belts = [];
    for (const f of scene.fixtures) this.world.add(this.fixtureMesh(f, scene));
    // table legs
    const table = scene.fixtures.find((f) => f.mount);
    if (table) {
      const legMat = glossy('#c9d3dd', { metalness: 0.6, roughness: 0.3, clearcoat: 0.2 });
      const hx = mm(table.size[0]) / 2 - 0.06, hy = mm(table.size[1]) / 2 - 0.06;
      const top = mm(table.center[2]) - mm(table.size[2]) / 2;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, top + 0.75), legMat);
        leg.position.set(mm(table.center[0]) + sx * hx, mm(table.center[1]) + sy * hy, (top - 0.75) / 2);
        leg.castShadow = true;
        this.world.add(leg);
      }
    }
    // region decals
    for (const r of scene.regions) {
      if (r.id.endsWith('_end')) continue;
      const w = mm(r.size[0]), d = mm(r.size[1]);
      const shape = new THREE.Shape();
      const rr = Math.min(w, d) * 0.12;
      shape.moveTo(-w / 2 + rr, -d / 2); shape.lineTo(w / 2 - rr, -d / 2); shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + rr);
      shape.lineTo(w / 2, d / 2 - rr); shape.quadraticCurveTo(w / 2, d / 2, w / 2 - rr, d / 2); shape.lineTo(-w / 2 + rr, d / 2);
      shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - rr); shape.lineTo(-w / 2, -d / 2 + rr); shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + rr, -d / 2);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shape.getPoints(8).map((p) => new THREE.Vector3(p.x, p.y, 0))), new THREE.LineBasicMaterial({ color: '#1a8cff', transparent: true, opacity: 0.35 }));
      const bottom = mm(r.center[2]) - mm(r.size[2]) / 2;
      line.position.set(mm(r.center[0]), mm(r.center[1]), Math.max(bottom, 0) + 0.0015);
      this.world.add(line);
    }
  }

  private fixtureMesh(f: FixtureDef, scene: SceneDef): THREE.Object3D {
    const g = new THREE.Group();
    const [cx, cy, cz] = f.center.map(mm);
    const [sx, sy, sz] = f.size.map(mm);
    g.position.set(cx, cy, cz);
    g.rotation.z = ((f.yaw ?? 0) * Math.PI) / 180;
    const color = f.color ?? '#dfe7ef';
    if (f.kind === 'bin' || f.kind === 'rack') {
      const w = mm(f.wall ?? 8);
      const mat = glossy(color, { roughness: 0.28, transmission: f.kind === 'bin' ? 0.12 : 0, thickness: 0.01 });
      const parts: [number, number, number, number, number, number][] = [
        [0, 0, -sz / 2 + w / 2, sx, sy, w], [sx / 2 - w / 2, 0, 0, w, sy, sz], [-sx / 2 + w / 2, 0, 0, w, sy, sz], [0, sy / 2 - w / 2, 0, sx, w, sz], [0, -sy / 2 + w / 2, 0, sx, w, sz],
      ];
      for (const [x, y, z, a, b, c] of parts) {
        const m = new THREE.Mesh(new RoundedBoxGeometry(a, b, c, 2, Math.min(w / 2.2, 0.004)), mat);
        m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
      }
    } else if (f.kind === 'conveyor') {
      const frame = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz - 0.012, 2, 0.008), glossy('#c9d3dd', { metalness: 0.55, roughness: 0.3, clearcoat: 0.3 }));
      frame.position.z = -0.006; frame.castShadow = true; frame.receiveShadow = true;
      const tex = beltTexture();
      const conv = scene.conveyors[0];
      tex.repeat.set(sx / 0.05, 1);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(sx - 0.03, sy - 0.03, 0.012), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      belt.position.z = sz / 2 - 0.006; belt.receiveShadow = true;
      for (const s of [-1, 1]) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, sy - 0.02, 24), glossy('#9aa5b1', { metalness: 0.7 }));
        roller.position.set(s * (sx / 2 - 0.02), 0, sz / 2 - 0.02);
        g.add(roller);
        const rail = new THREE.Mesh(new RoundedBoxGeometry(sx, 0.012, 0.03, 2, 0.004), glossy('#e7edf3', { metalness: 0.4 }));
        rail.position.set(0, s * (sy / 2 - 0.006), sz / 2 + 0.01);
        g.add(rail);
      }
      g.add(frame, belt);
      if (conv) this.belts.push({ tex, speed: mm(conv.speed), runOutput: conv.runOutput, len: 0.05 });
      // sensor beacon at the conveyor end
      if (conv) {
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 20), glossy('#2a3038'));
        beacon.rotation.x = Math.PI / 2;
        beacon.position.set(mm(conv.end[0]) - cx, sy / 2 + 0.02 - 0.0, sz / 2 + 0.045);
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.014, 20, 12), new THREE.MeshStandardMaterial({ color: '#2fb84a', emissive: '#2fb84a', emissiveIntensity: 0.6 }));
        lens.position.set(mm(conv.end[0]) - cx, sy / 2 + 0.02, sz / 2 + 0.095);
        lens.name = 'sensor-lens';
        g.add(beacon, lens);
      }
    } else if (f.kind !== 'region') {
      const radius = Math.min(0.012, sx / 4, sy / 4, sz / 4);
      const mat = f.mount ? glossy(color, { roughness: 0.42, clearcoat: 0.5 }) : glossy(color);
      const m = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 3, radius), mat);
      m.castShadow = !f.mount; m.receiveShadow = true;
      g.add(m);
    }
    if (f.label) {
      const s = labelSprite(f.label);
      s.position.set(0, 0, sz / 2 + 0.06);
      g.add(s);
    }
    return g;
  }

  private objectMesh(o: ObjState): THREE.Group {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const [sx, sy, sz] = o.size;
    const color = colorHex(o.color);
    if (o.container) {
      // translucent glass vessel + liquid
      const r = sx / 2;
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, sz, 40, 1, true), new THREE.MeshPhysicalMaterial({ color, transmission: 0.75, roughness: 0.06, thickness: 0.004, transparent: true, opacity: 0.55, side: THREE.DoubleSide, clearcoat: 1 }));
      glass.rotation.x = Math.PI / 2; glass.position.z = sz / 2; glass.castShadow = true;
      const bottom = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.004, 40), new THREE.MeshPhysicalMaterial({ color, transmission: 0.6, roughness: 0.1, transparent: true, opacity: 0.6 }));
      bottom.rotation.x = Math.PI / 2; bottom.position.z = 0.002;
      const liquidGeo = new THREE.CylinderGeometry(r * 0.86, r * 0.82, 1, 32);
      liquidGeo.rotateX(Math.PI / 2); liquidGeo.translate(0, 0, 0.5);
      const liquid = new THREE.Mesh(liquidGeo, new THREE.MeshPhysicalMaterial({ color: '#4fbfff', transmission: 0.35, roughness: 0.08, transparent: true, opacity: 0.88, emissive: '#0a5fb0', emissiveIntensity: 0.15 }));
      liquid.name = 'liquid';
      liquid.position.z = 0.004;
      liquid.userData.h = sz * 0.92;
      g.add(glass, bottom, liquid);
    } else if (o.shape === 'cylinder') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2, sz, 32), glossy(color, { transmission: o.kind === 'tube' ? 0.4 : 0, thickness: 0.004 }));
      m.rotation.x = Math.PI / 2; m.position.z = sz / 2; m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      if (o.kind === 'tube') {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2 + 0.0015, sx / 2 + 0.0015, 0.014, 24), glossy('#f4f6f8'));
        cap.rotation.x = Math.PI / 2; cap.position.z = sz - 0.007;
        g.add(cap);
      }
    } else {
      const m = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(sx, sy, sz) * 0.12), glossy(color, { roughness: 0.25 }));
      m.position.z = sz / 2; m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  private buildTargets(targets: Record<string, Target>) {
    this.targetGroup.clear();
    for (const t of Object.values(targets)) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.fromArray(poseToM4(t.pose));
      const taught = t.source !== 'scene';
      const L = 0.035;
      const axes: [string, THREE.Euler][] = [['#ef4b5f', new THREE.Euler(0, 0, -Math.PI / 2)], ['#36c25a', new THREE.Euler(0, 0, 0)], ['#2d8cf0', new THREE.Euler(Math.PI / 2, 0, 0)]];
      for (const [c, e] of axes) {
        const geo = new THREE.CylinderGeometry(0.0018, 0.0018, L, 8); geo.translate(0, L / 2, 0);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: taught ? 0.95 : 0.55 }));
        m.rotation.copy(e);
        g.add(m);
      }
      const dot = new THREE.Mesh(new THREE.SphereGeometry(taught ? 0.008 : 0.006, 16, 10), new THREE.MeshBasicMaterial({ color: taught ? '#1a8cff' : '#8aa0b8' }));
      g.add(dot);
      const s = labelSprite(t.name, taught ? '#0b5fc4' : '#3a5372', taught ? 'rgba(232,246,255,0.92)' : 'rgba(255,255,255,0.8)');
      s.scale.multiplyScalar(0.72);
      s.position.set(0, 0, -0.03);
      g.add(s);
      this.targetGroup.add(g);
    }
  }

  setTargetsVisible(v: boolean) { this.targetGroup.visible = v; }

  // ---------------- per-frame sync
  private sync(sim: SimCore, dt: number) {
    if (sim.scene.id !== this.sceneId) {
      this.sceneId = sim.scene.id;
      this.buildScene(sim.scene);
      const cam = sim.scene.camera;
      if (cam) {
        this.camera.position.set(...(cam.position.map(mm) as [number, number, number]));
        this.controls.target.set(...(cam.target.map(mm) as [number, number, number]));
        if (this.showcase) { this.controls.target.z += 0.12; this.camera.position.lerpVectors(this.controls.target, this.camera.position, 1.3); }
      }
      this.lastSimTime = sim.simTime;
    }
    if (sim.arm.id !== this.robotArmId || !this.robot) {
      if (this.robot) { this.scene.remove(this.robot.group); this.robot.dispose(); }
      this.robot = new RobotVisual(sim.arm);
      this.robotArmId = sim.arm.id;
      this.scene.add(this.robot.group);
    }
    const s = sim.s;
    const held = s.holding ? s.objects.find((o) => o.id === s.holding!.id) : null;
    const f = this.robot.update(s.q, s.gripperOpen, held ? Math.min(held.size[0], held.size[1]) : null, dt);
    this.syncGhost(sim, dt);

    // objects
    const seen = new Set<string>();
    for (const o of s.objects) {
      seen.add(o.id);
      let m = this.objMeshes.get(o.id);
      if (!m) { m = this.objectMesh(o); this.objMeshes.set(o.id, m); this.world.add(m); }
      m.matrix.fromArray(o.pose);
      m.matrixWorldNeedsUpdate = true;
      if (o.container) {
        const liq = m.getObjectByName('liquid') as THREE.Mesh;
        liq.visible = o.container.fill > 0.005;
        liq.scale.set(1, 1, Math.max(0.001, o.container.fill * (liq.userData.h as number)));
      }
    }
    for (const [id, m] of this.objMeshes) if (!seen.has(id)) { this.world.remove(m); this.objMeshes.delete(id); }

    // pour stream
    this.stream.visible = false;
    if (held?.container && held.container.fill > 0 && col(held.pose, 2)[2] < 0) {
      const lip = apply(held.pose, [0, 0, held.size[2]]);
      let bottomZ = -0.75;
      for (const o of s.objects) if (o !== held && o.container) { const p = pos(o.pose); if (Math.hypot(p[0] - lip[0], p[1] - lip[1]) < 0.045) bottomZ = Math.max(bottomZ, p[2] + o.size[2] * (0.1 + 0.85 * o.container.fill)); }
      if (bottomZ === -0.75) bottomZ = 0;
      const len = Math.max(0.005, lip[2] - bottomZ);
      this.stream.visible = true;
      this.stream.scale.set(1, len, 1);
      this.stream.rotation.set(Math.PI / 2, 0, 0);
      this.stream.position.set(lip[0], lip[1], lip[2] - len / 2);
    }

    // belts move only with simulated time
    const dSim = sim.simTime - this.lastSimTime;
    this.lastSimTime = sim.simTime;
    for (const b of this.belts) if (s.outputs[b.runOutput] === true && dSim > 0) b.tex.offset.x -= (b.speed * dSim) / b.len;
    this.world.traverse((o) => {
      if (o.name === 'sensor-lens') {
        const on = Object.entries(s.inputs).some(([k, v]) => k.includes('present') && v === true);
        ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.6 : 0.25;
      }
    });

    // targets
    const allT = sim.allTargets();
    const key = JSON.stringify(Object.values(allT).map((t) => [t.name, t.pose]));
    if (key !== this.targetsKey) { this.targetsKey = key; this.buildTargets(allT); }

    // TCP marker + gizmo proxy
    const tcp = new THREE.Matrix4().fromArray(f.tcp);
    this.tcpMarker.matrixAutoUpdate = false;
    this.tcpMarker.matrix.copy(tcp);
    this.tcpMarker.matrixWorldNeedsUpdate = true;
    if (!this.dragging) {
      tcp.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
      if (!this.guideEnabled) (this.tcpMarker.material as THREE.MeshBasicMaterial).color.set('#1a8cff');
      else (this.tcpMarker.material as THREE.MeshBasicMaterial).color.set('#2fb84a');
    }
  }

  /** Replays a recorded dry run on a translucent arm, then hides it. */
  private syncGhost(sim: SimCore, dt: number) {
    const clip = this.ghostClip;
    if (!clip) return;
    if (!this.ghost || this.ghost.group.userData.arm !== sim.arm.id) {
      if (this.ghost) { this.scene.remove(this.ghost.group); this.ghost.dispose(); }
      this.ghost = new RobotVisual(sim.arm, { ghost: true });
      this.ghost.group.userData.arm = sim.arm.id;
      this.scene.add(this.ghost.group);
    }
    this.ghost.group.visible = true;
    this.ghostT += dt * clip.speed;
    const end = clip.frames[clip.frames.length - 1].t;
    const fr = sampleGhost(clip.frames, this.ghostT);
    this.ghost.update(fr.q, fr.open, null, dt);
    if (this.ghostT > end + 0.8) { this.ghostClip = null; this.ghost.group.visible = false; ghostEnded(); }
  }

  resetCamera(scene: SceneDef) {
    const cam = scene.camera;
    if (!cam) return;
    this.camera.position.set(...(cam.position.map(mm) as [number, number, number]));
    this.controls.target.set(...(cam.target.map(mm) as [number, number, number]));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.offGhost();
    this.ghost?.dispose();
    this.ro.disconnect();
    this.tc.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
