import { useEffect, useRef, useState } from 'react';
import { Scene3D } from './Scene3D';
import { host } from '../simHost';
import { useApp } from '../store';
import { Icon } from '../ui/icons';
import { logEvent } from '../study/logger';
import { FAULT_HELP } from '../sim/types';
import { ARMS } from '../content';
import { go } from '../pendant/screens';
import { soundFrame } from '../audio/sound';
import { onGhost, playGhost } from './ghost';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];
export function Viewport({ onAskAgent }: { onAskAgent?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const handGuide = useApp((s) => s.handGuide);
  const hgMode = useApp((s) => s.handGuideMode);
  const blocked = useApp((s) => s.handGuideBlocked);
  const showFrames = useApp((s) => s.showFrames);
  const fault = useApp((s) => s.fault);
  const showSuccess = useApp((s) => s.showSuccess);
  const taskId = useApp((s) => s.taskId);
  const armOverride = useApp((s) => s.armOverride);
  const editor = useApp((s) => s.workspaces[s.taskId]?.editor);
  const preds = useApp((s) => s.predicates);
  const speed = useApp((s) => s.speed);
  const set = useApp((s) => s.set);
  const [tcp, setTcp] = useState('');
  const guideStats = useRef({ fails: 0, start: '' });
  const [ghost, setGhost] = useState(false);
  useEffect(() => onGhost((c) => setGhost(!!c)), []);
  useEffect(() => { /* stop the ghost when the scene changes */ playGhost(null); }, [taskId]);

  useEffect(() => {
    if (!ref.current) return;
    let lastCam = 0;
    let lastRead = 0;
    const s3 = new Scene3D(ref.current, {
      onGuide: (m) => {
        const ok = host.guideTo(m);
        if (!ok) guideStats.current.fails++;
        if (useApp.getState().handGuideBlocked !== !ok) set({ handGuideBlocked: !ok });
        return ok;
      },
      onGuideStart: () => { const a = host.arm(); guideStats.current = { fails: 0, start: JSON.stringify(host.sim.tcpPose(a)) }; logEvent('handguide_start', { pose: host.sim.tcpPose(a), ...(host.sim.multi ? { robot: a } : {}) }); },
      onGuideEnd: () => { const a = host.arm(); set({ handGuideBlocked: false }); logEvent('handguide_end', { pose: host.sim.tcpPose(a), ikFailures: guideStats.current.fails, ...(host.sim.multi ? { robot: a } : {}) }); },
      onCameraMove: () => { const now = Date.now(); if (now - lastCam > 2000) { lastCam = now; logEvent('camera_move', { position: s3.camera.position.toArray().map((v) => +v.toFixed(2)) }); } },
    }, (dt) => {
      if (!host.sim) return null;
      host.frame(dt);
      if (sceneRef.current) sceneRef.current.selectedArm = host.arm(); // the first frame runs inside the constructor
      const st = host.sim.s;
      const r0 = host.sim.rs(host.arm());
      soundFrame(r0.q, r0.gripperOpen, r0.holding?.id ?? null,
        useApp.getState().runState === 'running' && host.sim.scene.conveyors.some((c) => st.outputs[c.runOutput] === true));
      const now = performance.now();
      if (now - lastRead > 120) {
        lastRead = now;
        const p = host.sim.tcpPose(host.arm());
        setTcp(`${host.sim.multi ? `${host.sim.label(host.arm())} · ` : ''}X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}  ·  Rx ${p.rx.toFixed(0)}°  Ry ${p.ry.toFixed(0)}°  Rz ${p.rz.toFixed(0)}°`);
      }
      return host.sim;
    });
    sceneRef.current = s3;
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
      // Test hook: drive a hand-guide drag through the same callbacks the gizmo uses.
      (window as unknown as Record<string, unknown>).__tandemGuide = (dxMm: number, dyMm = 0, dzMm = 0) => {
        const cb = (s3 as unknown as { cbForTests: import('./Scene3D').Scene3DCallbacks }).cbForTests;
        cb.onGuideStart();
        const steps = 10;
        let ok = true;
        for (let i = 1; i <= steps; i++) {
          const T = host.sim.tcpWorld(host.arm()).slice();
          T[12] += dxMm / 1000 / steps; T[13] += dyMm / 1000 / steps; T[14] += dzMm / 1000 / steps;
          ok = cb.onGuide(T) && ok;
        }
        cb.onGuideEnd();
        return ok;
      };
    }
    // multi-arm: clicking an arm (without dragging the camera) selects it for Jog / Positions
    let down: [number, number] | null = null;
    const el = ref.current;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || !host.sim?.multi || useApp.getState().handGuide) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 4) return;
      const id = s3.pickArm(e.clientX, e.clientY);
      if (id) host.selectArm(id);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); s3.dispose(); sceneRef.current = null; };
  }, [set]);

  useEffect(() => { sceneRef.current?.setGuide(handGuide, hgMode); }, [handGuide, hgMode]);
  useEffect(() => { sceneRef.current?.setTargetsVisible(showFrames); }, [showFrames]);
  useEffect(() => {
    if (!fault) return;
    const arms = (fault.detail as { arms?: string[] } | undefined)?.arms;
    if (arms) arms.forEach((a) => sceneRef.current?.flashFault(a));
    else sceneRef.current?.flashFault(fault.robot);
  }, [fault]);

  const multi = !!host.sim?.multi;
  const armName = host.sim ? (multi ? `${host.sim.robotIds.length} arms` : ARMS[host.armId()]?.name) : '';
  void taskId; void armOverride;

  return (
    <div className="viewport" ref={ref} data-tour="viewport">
      <div className="vp-overlay tl">
        <span className="chip"><span className="dot" style={{ color: '#1a8cff' }} />{host.sim?.scene.title}</span>
        <span className="chip">{armName}</span>
        {preds.length > 0 && (() => { const done = preds.filter((p) => p.pass).length; return (
          <button data-tour="goals" className={`chip chip-btn ${done === preds.length ? 'leaf' : ''}`} onClick={() => go('task')} title="Open the task on the pendant"><Icon.flag width={12} height={12} />{done}/{preds.length} goals</button>
        ); })()}
      </div>
      <div className="vp-overlay tr">
        <div className="vp-glass">
          <button className={`icon-btn ${showFrames ? 'on' : ''}`} title="Show target frames" aria-pressed={showFrames} onClick={() => set({ showFrames: !showFrames })}><Icon.eye /></button>
          <button className="icon-btn" title="Reset camera" onClick={() => host.sim && sceneRef.current?.resetCamera(host.sim.scene)}><Icon.camera /></button>
        </div>
      </div>
      {ghost && (
        <div className="vp-overlay" style={{ left: '50%', top: 12, transform: 'translateX(-50%)' }}>
          <span className="hg-banner ghost-banner"><span className="ghost-dot" /> Ghost preview — the real robot isn’t moving
            <button className="icon-btn" aria-label="Stop preview" onClick={() => playGhost(null)}><Icon.x width={12} height={12} /></button></span>
        </div>
      )}
      {handGuide && (
        <div className="vp-overlay" style={{ left: '50%', top: 12, transform: 'translateX(-50%)' }}>
          <span className={`hg-banner ${blocked ? 'bad' : ''}`}>{blocked ? 'Can’t reach there — the arm holds its last valid pose' : 'Hand guiding · drag the handle at the tool'}</span>
        </div>
      )}
      <div className="vp-overlay bl"><div className="vp-glass"><span className="vp-readout">TCP {tcp}</span></div></div>
      <div className="vp-overlay br">
        <div className="vp-glass" data-tour="vp-controls">
          <label className="vp-speed" title="Simulation speed">
            <span>Sim speed</span>
            <select value={speed} aria-label="Simulation speed" onChange={(e) => { const v = +e.target.value; host.setSpeed(v); logEvent('speed_change', { speed: v }); }}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <button className="btn sm ghost" onClick={() => host.reset()} title="Put every part back where it started"><Icon.reset width={13} height={13} /> Reset</button>
        </div>
      </div>
      {fault && !showSuccess && (
        <div className="fault-card" role="alert">
          <div className="row"><span className="code">PROTECTIVE STOP · {fault.code}{multi && fault.robot ? ` · ${host.sim.label(fault.robot)}` : ''}</span><span className="grow" />
            <button className="icon-btn" aria-label="Dismiss" onClick={() => set({ fault: null })}><Icon.x /></button></div>
          <div className="title">{fault.message}</div>
          <div className="muted">{FAULT_HELP[fault.code]}{fault.line && editor === 'code' ? ` · line ${fault.line}` : fault.blockId ? ' · the block is marked in your program' : ''}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn sm" onClick={() => { host.reset(); }}><Icon.reset /> Reset scene</button>
            {(fault.blockId || fault.line) && <button className="btn sm" onClick={() => go('program')}><Icon.blocks /> Show in program</button>}
            {onAskAgent && <button className="btn sm aqua" onClick={onAskAgent}><Icon.sparkle /> Ask AI partner about this</button>}
          </div>
        </div>
      )}
      {showSuccess && (
        <div className="fault-card success-card" role="status">
          <div className="row"><span className="code">TASK COMPLETE</span><span className="grow" />
            <button className="icon-btn" aria-label="Dismiss" onClick={() => set({ showSuccess: false })}><Icon.x /></button></div>
          <div className="title">Nicely done — every goal is met.</div>
        </div>
      )}
    </div>
  );
}
