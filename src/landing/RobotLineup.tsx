/** Rotating 3D showcase of every arm in Tandem, each gently moving through its joints. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RobotVisual, glossy } from '../view/robotVisual';
import { ARMS } from '../content';
import { fk } from '../sim/kinematics/fk';
import { pos } from '../sim/math/mat4';
import type { ArmDef } from '../sim/types';
import { Icon } from '../ui/icons';

const ORDER = ['gofa-like', 'ur-like', 'kuka-kr5', 'epson-t6'];
const BLURB: Record<string, { kind: string; text: string; tags: string[] }> = {
  'gofa-like': { kind: 'Collaborative · 6-axis', text: 'A GoFa-class cobot built to work beside people: rounded, gentle and the default arm for most levels.', tags: ['Hand guiding', 'Blocks & code', 'Kitchen + factory'] },
  'ur-like': { kind: 'Collaborative · 6-axis', text: 'A UR-class cobot with a long, slim reach. Great for clearing conveyors with loops and offsets.', tags: ['Long reach', 'Conveyor work'] },
  'kuka-kr5': { kind: 'Industrial · 6-axis', text: 'A real KUKA KR5 model. Faster and stiffer than a cobot — the kind of arm that lives behind a fence.', tags: ['Real CAD model', 'Fast'] },
  'epson-t6': { kind: 'SCARA · 4-axis', text: 'An Epson T6 SCARA: fast flat moves plus a vertical axis, the classic arm for pick-and-place.', tags: ['Real CAD model', 'Pick & place'] },
};

/** Approximate reach (mm): farthest tool position over a deterministic sweep of the joint space. */
function reachMm(arm: ArmDef) {
  let best = 0;
  const n = 7;
  for (let i = 0; i < 400; i++) {
    const q = arm.limits.map((l, j) => l.min + (l.max - l.min) * (((i * (j * 2 + 3)) % n) / (n - 1)));
    const p = pos(fk(arm, q).tcp);
    best = Math.max(best, Math.hypot(p[0], p[1]));
  }
  return Math.round(best * 100) * 10;
}

export function RobotLineup() {
  const arms = useMemo(() => ORDER.map((id) => ARMS[id]).filter(Boolean), []);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const armRef = useRef(arms[0]);
  armRef.current = arms[i];
  const specs = useMemo(() => arms.map((a) => ({ reach: reachMm(a), speed: Math.round((a as ArmDef & { maxTcpSpeed?: number }).maxTcpSpeed ?? 0) })), [arms]);

  // create the 3D view only when the lineup scrolls near the viewport (saves a WebGL context + shader compiles at load)
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: '600px' });
    io.observe(host.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.02, 20);
    cam.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight('#e6f4ff', '#f3efe7', 1));
    const sun = new THREE.DirectionalLight('#fff', 1.8); sun.position.set(1.5, -1, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.05, 64), glossy('#ffffff'));
    pedestal.rotation.x = Math.PI / 2; pedestal.position.z = -0.025; pedestal.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.006, 12, 96), new THREE.MeshBasicMaterial({ color: '#5cc8ff' }));
    ring.position.z = 0.001;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.ShadowMaterial({ opacity: 0.12 }));
    shadow.position.z = 0.0005; shadow.receiveShadow = true;
    const stage = new THREE.Group();
    stage.add(pedestal, ring, shadow);
    scene.add(stage);

    let robot: RobotVisual | null = null;
    let shown = '';
    let raf = 0, t0 = performance.now(), visible = true, last = performance.now();
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 }); io.observe(el);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      const arm = armRef.current;
      if (arm.id !== shown) {
        if (robot) { stage.remove(robot.group); robot.dispose(); }
        robot = new RobotVisual(arm); shown = arm.id; t0 = now;
        stage.add(robot.group);
        // frame the arm: distance from its home height
        const h = Math.max(0.5, pos(fk(arm, arm.home).tcp)[2] + 0.35);
        cam.position.set(h * 1.9, -h * 1.9, h * 1.05);
        cam.lookAt(0, 0, h * 0.42);
      }
      const t = (now - t0) / 1000;
      const q = arm.home.map((v, j) => {
        const l = arm.limits[j];
        const amp = Math.min(0.45, (l.max - l.min) * 0.18);
        return Math.max(l.min, Math.min(l.max, v + amp * Math.sin(t * 0.7 + j * 1.3) * (j === 0 ? 1.4 : 1)));
      });
      robot!.update(q, Math.sin(t * 1.4) > 0, null, dt);
      stage.rotation.z = t * 0.25;
      renderer.render(scene, cam);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); robot?.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [near]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setI((x) => (x + 1) % arms.length), 6500);
    return () => clearInterval(id);
  }, [auto, arms.length]);

  const pick = (n: number) => { setAuto(false); setI(((n % arms.length) + arms.length) % arms.length); };
  const a = arms[i], b = BLURB[a.id];
  return (
    <div className="lineup">
      <div className="lineup-stage">
        <div className="lineup-canvas" ref={host} role="img" aria-label={`3D model of the ${a.name}`} />
        <button className="lineup-nav prev" aria-label="Previous robot" onClick={() => pick(i - 1)}><Icon.left width={18} height={18} /></button>
        <button className="lineup-nav next" aria-label="Next robot" onClick={() => pick(i + 1)}><Icon.right width={18} height={18} /></button>
      </div>
      <div className="glass lineup-card" aria-live="polite">
        <div className="eyebrow">{b?.kind}</div>
        <h3>{a.name.replace(/\s*\(.*\)$/, '')}</h3>
        <p>{b?.text}</p>
        <div className="spec-row">
          <div><b>{a.dof}</b><span>axes</span></div>
          <div><b>{(specs[i].reach / 1000).toFixed(2)} m</b><span>reach</span></div>
          {specs[i].speed > 0 && <div><b>{(specs[i].speed / 1000).toFixed(1)} m/s</b><span>top speed</span></div>}
        </div>
        <div className="tag-row">{b?.tags.map((t) => <span key={t} className="chip aqua">{t}</span>)}</div>
        <div className="lineup-dots" role="tablist" aria-label="Choose a robot">
          {arms.map((x, n) => <button key={x.id} role="tab" aria-selected={n === i} aria-label={x.name} className={n === i ? 'on' : ''} onClick={() => pick(n)} />)}
        </div>
      </div>
    </div>
  );
}
