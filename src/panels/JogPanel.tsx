import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { host } from '../simHost';
import { Icon } from '../ui/icons';

const STEPS = [0.1, 1, 10];
export function JogPanel() {
  const jog = useApp((s) => s.jog);
  const handGuide = useApp((s) => s.handGuide);
  const hgMode = useApp((s) => s.handGuideMode);
  const running = useApp((s) => s.runState !== 'idle');
  const set = useApp((s) => s.set);
  const [vals, setVals] = useState<number[]>([]);
  const [grip, setGrip] = useState(true);
  const hold = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let last = 0;
    const off = host.onFrame((sim) => {
      const now = performance.now();
      if (now - last < 100) return;
      last = now;
      setVals(jog.mode === 'joint' ? sim.jointsDisplay() : (() => { const p = sim.tcpPose(); return [p.x, p.y, p.z, p.rx, p.ry, p.rz]; })());
      setGrip(sim.s.gripperOpen);
    });
    return () => { off(); };
  }, [jog.mode]);

  const dof = host.sim?.arm.dof ?? 6;
  const isP = (i: number) => jog.mode === 'joint' && host.sim?.jointType(i) === 'P';
  const labels = jog.mode === 'joint' ? Array.from({ length: dof }, (_, i) => `J${i + 1}`) : ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz'];
  const scara = host.sim?.arm.kind === 'scara4';
  const limits = host.sim?.arm.limits ?? [];
  const nudge = (i: number, sgn: number) => {
    const step = jog.step * sgn;
    if (jog.mode === 'joint') host.jogJoint(i, step);
    else host.jogCart(i as 0 | 1 | 2 | 3 | 4 | 5, step, jog.frame);
  };
  const startHold = (i: number, sgn: number) => {
    nudge(i, sgn);
    stopHold();
    hold.current = setInterval(() => nudge(i, sgn), 70);
  };
  const stopHold = () => { if (hold.current) clearInterval(hold.current); hold.current = null; };

  return (
    <section className="glass panel" style={{ flex: '0 0 auto' }} aria-label="Jog">
      <div className="panel-head">Jog<span className="spacer" />
        <div className="seg" role="tablist">
          <button className={jog.mode === 'joint' ? 'on' : ''} onClick={() => set({ jog: { ...jog, mode: 'joint' } })}>Joint</button>
          <button className={jog.mode === 'cart' ? 'on' : ''} onClick={() => set({ jog: { ...jog, mode: 'cart' } })}>Cartesian</button>
        </div>
      </div>
      <div className="panel-body stack" style={{ gap: 8 }}>
        <div className="row">
          {jog.mode === 'cart' && (
            <div className="seg">
              <button className={jog.frame === 'base' ? 'on' : ''} onClick={() => set({ jog: { ...jog, frame: 'base' } })}>Base</button>
              <button className={jog.frame === 'tool' ? 'on' : ''} onClick={() => set({ jog: { ...jog, frame: 'tool' } })}>Tool</button>
            </div>
          )}
          <span className="grow" />
          <div className="seg" title="Step size (mm or °)">
            {STEPS.map((s) => <button key={s} className={jog.step === s ? 'on' : ''} onClick={() => set({ jog: { ...jog, step: s } })}>{s}</button>)}
          </div>
        </div>
        <div className="jog-grid" onMouseUp={stopHold} onMouseLeave={stopHold}>
          {labels.map((l, i) => {
            const disabled = running || (scara && jog.mode === 'cart' && (i === 3 || i === 4));
            const v = vals[i] ?? 0;
            const lim = limits[i];
            const frac = jog.mode === 'joint' && lim ? ((isP(i) ? v / 1000 : v * Math.PI / 180) - lim.min) / (lim.max - lim.min) : null;
            return (
              <div key={l} style={{ display: 'contents' }}>
                <span className="lbl">{l}</span>
                <span className="val">{v.toFixed(1)}{jog.mode === 'joint' ? (isP(i) ? ' mm' : '°') : i < 3 ? ' mm' : '°'}
                  {frac !== null && <span className="bar" style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />}
                </span>
                <button className="jog-btn" disabled={disabled} aria-label={`${l} minus`} onMouseDown={() => startHold(i, -1)}>−</button>
                <button className="jog-btn" disabled={disabled} aria-label={`${l} plus`} onMouseDown={() => startHold(i, 1)}>+</button>
              </div>
            );
          })}
        </div>
        <div className="row wrap">
          <button className={`btn sm ${handGuide ? 'leaf' : ''}`} disabled={running} aria-pressed={handGuide} onClick={() => set({ handGuide: !handGuide })}><Icon.hand width={14} height={14} /> Hand guide</button>
          {handGuide && (
            <div className="seg">
              <button className={hgMode === 'translate' ? 'on' : ''} onClick={() => set({ handGuideMode: 'translate' })} title="Move"><Icon.move width={13} height={13} /></button>
              <button className={hgMode === 'rotate' ? 'on' : ''} onClick={() => set({ handGuideMode: 'rotate' })} title="Rotate"><Icon.rotate width={13} height={13} /></button>
            </div>
          )}
          <span className="grow" />
          <button className="btn sm" disabled={running} onClick={() => host.gripper(grip ? 'close' : 'open')}><Icon.grip width={14} height={14} /> {grip ? 'Close' : 'Open'}</button>
          <button className="btn sm" disabled={running} title="Go home" onClick={() => host.goHome()}><Icon.home width={14} height={14} /></button>
        </div>
      </div>
    </section>
  );
}
