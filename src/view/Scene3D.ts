import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SimCore } from '../sim/SimCore';
import type { FixtureDef, MeshRef, ObjState, SceneDef, Target } from '../sim/types';
import { poseToM4 } from '../sim/kinematics/arm';
import { apply, col, mul, pos, type M4 } from '../sim/math/mat4';
import { RobotVisual } from './robotVisual';
import { glossy } from './materials';
import { attachModel, placeholder } from './meshes';
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
  /** One visual per arm, each inside a holder group placed at the arm's base. */
  private robots = new Map<string, { vis: RobotVisual; holder: THREE.Group; key: string; label?: THREE.Sprite }>();
  private robotArmId = '';
  /** The arm the TCP marker, hand-guide gizmo and target frames belong to (set by the viewport). */
  selectedArm: string | null = null;
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
  private ghosts = new Map<string, { vis: RobotVisual; holder: THREE.Group; key: string }>();
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

    this.offGhost = onGhost((clip) => { this.ghostClip = clip && clip.frames.length ? clip : null; this.ghostT = 0; for (const g of this.ghosts.values()) g.holder.visible = !!this.ghostClip; });
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

  /** Flash an arm red (all arms when `robot` is not given). */
  flashFault(robot?: string) { for (const [id, r] of this.robots) if (!robot || id === robot) r.vis.triggerFlash(); }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- Studio (content editor) support
  private editTc: TransformControls | null = null;
  private editProxy = new THREE.Object3D();
  private editMove: ((posMm: [number, number, number]) => void) | null = null;
  private selBox: THREE.BoxHelper | null = null;
  /** Rebuild the static scene on the next frame (the studio edits the scene in place). */
  invalidate() { this.sceneId = ''; this.targetsKey = ''; this.robotArmId = ''; }
  /** The fixture/object under a pointer position, as "fixture:<id>" / "object:<id>". */
  pick(clientX: number, clientY: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    for (const hit of ray.intersectObjects(this.world.children, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (o.userData.editId) return o.userData.editId as string;
    }
    return null;
  }
  /** The arm under a pointer position (multi-arm cells), or null. */
  pickArm(clientX: number, clientY: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    let best: { id: string; d: number } | null = null;
    for (const [id, rb] of this.robots) {
      const hit = ray.intersectObject(rb.vis.group, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id, d: hit.distance };
    }
    return best?.id ?? null;
  }
  /** Shows a move gizmo at `posMm` (null hides it) and outlines the selected item. */
  setEditTarget(editId: string | null, posMm: [number, number, number] | null, onMove?: (posMm: [number, number, number]) => void) {
    if (!this.editTc) {
      this.editTc = new TransformControls(this.camera, this.renderer.domElement);
      this.editTc.setSize(0.8);
      this.scene.add(this.editProxy);
      this.editTc.attach(this.editProxy);
      this.scene.add(this.editTc.getHelper());
      this.editTc.addEventListener('dragging-changed', (e) => { this.controls.enabled = !(e as unknown as { value: boolean }).value; });
      this.editTc.addEventListener('objectChange', () => { const p = this.editProxy.position; this.editMove?.([Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000)]); });
    }
    this.editMove = onMove ?? null;
    const on = !!posMm;
    this.editTc.enabled = on;
    this.editTc.getHelper().visible = on;
    if (posMm) this.editProxy.position.set(posMm[0] / 1000, posMm[1] / 1000, posMm[2] / 1000);
    this.selectedId = editId;
  }
  private selectedId: string | null = null;
  get editDragging() { return !!this.editTc && (this.editTc as unknown as { dragging: boolean }).dragging; }
  private syncSelection() {
    let target: THREE.Object3D | null = null;
    if (this.selectedId) this.world.traverse((o) => { if (!target && o.userData.editId === this.selectedId) target = o; });
    if (!target) { if (this.selBox) this.selBox.visible = false; return; }
    if (!this.selBox) { this.selBox = new THREE.BoxHelper(target, '#ff9a1f'); this.scene.add(this.selBox); }
    this.selBox.setFromObject(target);
    this.selBox.visible = true;
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
    g.userData.editId = `fixture:${f.id}`;
    if (f.mesh && f.kind !== 'conveyor') {
      attachModel(g, f.mesh, 'center', [sx, sy, sz]);
    } else if (f.kind === 'model') {
      g.add(placeholder([sx, sy, sz], true));
    } else if (f.kind === 'bin' || f.kind === 'rack') {
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

  private objectMesh(o: ObjState, scene: SceneDef): THREE.Group {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.userData.editId = `object:${o.id}`;
    const [sx, sy, sz] = o.size;
    const color = colorHex(o.color);
    // your own model: from the object definition, or from the conveyor that spawned it
    const mesh: MeshRef | undefined = scene.objects.find((d) => d.id === o.id)?.mesh
      ?? scene.conveyors.find((c) => c.spawn.mesh && o.id.startsWith(c.spawn.kind) && /^\d+$/.test(o.id.slice(c.spawn.kind.length)))?.spawn.mesh;
    if (mesh && !o.container) {
      attachModel(g, { color: mesh.color ?? (mesh.file.match(/\.(obj|stl)$/i) ? color : undefined), ...mesh }, 'bottom', [sx, sy, sz]);
    } else if (o.container) {
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

  /** Target frames; `base` places one arm's targets (they are in its base frame) and `tint` colors their dots. */
  private buildTargets(targets: Record<string, Target>, base?: M4, tint?: string, clear = true) {
    if (clear) this.targetGroup.clear();
    for (const t of Object.values(targets)) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.fromArray(base ? mul(base, poseToM4(t.pose)) : poseToM4(t.pose));
      const taught = t.source !== 'scene';
      const L = 0.035;
      const axes: [string, THREE.Euler][] = [['#ef4b5f', new THREE.Euler(0, 0, -Math.PI / 2)], ['#36c25a', new THREE.Euler(0, 0, 0)], ['#2d8cf0', new THREE.Euler(Math.PI / 2, 0, 0)]];
      for (const [c, e] of axes) {
        const geo = new THREE.CylinderGeometry(0.0018, 0.0018, L, 8); geo.translate(0, L / 2, 0);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: taught ? 0.95 : 0.55 }));
        m.rotation.copy(e);
        g.add(m);
      }
      const dot = new THREE.Mesh(new THREE.SphereGeometry(taught ? 0.008 : 0.006, 16, 10), new THREE.MeshBasicMaterial({ color: taught ? tint ?? '#1a8cff' : '#8aa0b8' }));
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
    // arms: (re)build when the arm set or a model changes
    const armKey = sim.robotIds.map((id) => `${id}:${sim.armOf(id).id}:${sim.baseOf(id).join(',')}`).join('|');
    if (armKey !== this.robotArmId) {
      for (const r of this.robots.values()) { this.scene.remove(r.holder); r.vis.dispose(); }
      this.robots.clear();
      for (const id of sim.robotIds) {
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.fromArray(sim.baseOf(id));
        const vis = new RobotVisual(sim.armOf(id));
        holder.add(vis.group);
        let label: THREE.Sprite | undefined;
        if (sim.multi && !this.showcase) {
          label = labelSprite(sim.label(id), sim.color(id) ?? '#0d2240');
          label.scale.multiplyScalar(0.9);
          label.position.set(0, 0, 0.02);
          holder.add(label);
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.125, 48), new THREE.MeshBasicMaterial({ color: sim.color(id) ?? '#1a8cff', transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
          ring.position.z = 0.002;
          holder.add(ring);
        }
        this.scene.add(holder);
        this.robots.set(id, { vis, holder, key: id, label });
      }
      this.robotArmId = armKey;
    }
    const s = sim.s;
    const sel = this.selectedArm && sim.robotIds.includes(this.selectedArm) ? this.selectedArm : sim.primary;
    let f = null as ReturnType<RobotVisual['update']> | null;
    let held: typeof s.objects[number] | null = null;
    for (const id of sim.robotIds) {
      const r = sim.rs(id);
      const h = r.holding ? s.objects.find((o) => o.id === r.holding!.id) ?? null : null;
      const fr = this.robots.get(id)!.vis.update(r.q, r.gripperOpen, h ? Math.min(h.size[0], h.size[1]) : null, dt);
      if (id === sel) f = fr;
      if (h && !held) held = h;
    }
    this.syncGhost(sim, dt);
    if (this.selectedId !== null || this.selBox?.visible) this.syncSelection();

    // objects
    const seen = new Set<string>();
    for (const o of s.objects) {
      seen.add(o.id);
      let m = this.objMeshes.get(o.id);
      if (!m) { m = this.objectMesh(o, sim.scene); this.objMeshes.set(o.id, m); this.world.add(m); }
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

    // targets: every arm's (in its base frame)
    const key = JSON.stringify(sim.robotIds.map((id) => [id, Object.values(sim.allTargets(id)).map((t) => [t.name, t.pose])]));
    if (key !== this.targetsKey) {
      this.targetsKey = key;
      this.targetGroup.clear();
      for (const id of sim.robotIds) this.buildTargets(sim.allTargets(id), sim.multi ? sim.baseOf(id) : undefined, sim.multi ? sim.color(id) : undefined, false);
    }

    // TCP marker + gizmo proxy (selected arm, world frame)
    const tcp = new THREE.Matrix4().fromArray(sim.multi ? mul(sim.baseOf(sel), f!.tcp) : f!.tcp);
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
    const key = (id: string) => `${id}:${sim.armOf(id).id}:${sim.baseOf(id).join(',')}`;
    for (const id of sim.robotIds) {
      const g = this.ghosts.get(id);
      if (g && g.key === key(id)) continue;
      if (g) { this.scene.remove(g.holder); g.vis.dispose(); }
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.fromArray(sim.baseOf(id));
      const vis = new RobotVisual(sim.armOf(id), { ghost: true });
      holder.add(vis.group);
      this.scene.add(holder);
      this.ghosts.set(id, { vis, holder, key: key(id) });
    }
    this.ghostT += dt * clip.speed;
    const end = clip.frames[clip.frames.length - 1].t;
    const fr = sampleGhost(clip.frames, this.ghostT);
    for (const id of sim.robotIds) {
      const g = this.ghosts.get(id)!;
      const r = fr.robots?.[id] ?? (id === sim.primary ? fr : null);
      g.holder.visible = !!r;
      if (r) g.vis.update(r.q, r.open, null, dt);
    }
    if (this.ghostT > end + 0.8) { this.ghostClip = null; for (const g of this.ghosts.values()) g.holder.visible = false; ghostEnded(); }
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
    for (const g of this.ghosts.values()) g.vis.dispose();
    for (const r of this.robots.values()) r.vis.dispose();
    this.editTc?.dispose();
    this.ro.disconnect();
    this.tc.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
