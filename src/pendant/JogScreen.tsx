import { useEffect, useRef, useState } from 'react';
import { useApp, type JogMode } from '../store';
import { host } from '../simHost';
import { Icon } from '../ui/icons';
import { logEvent } from '../study/logger';

/**
 * Pendant-style jogging, modelled on a 3-axis joystick pendant:
 * pick a motion mode, push the stick for smooth motion (speed ∝ deflection),
 * twist (rocker) for the third axis, or tap the arrows to step by an increment.
 */

interface Axis { index: number; label: string; unit: string; enabled: boolean }
const MODES: { id: JogMode; label: string }[] = [
  { id: 'axes13', label: 'Axes 1–3' }, { id: 'axes46', label: 'Axes 4–6' }, { id: 'linear', label: 'Linear' }, { id: 'reorient', label: 'Reorient' },
];
const STEPS = [0.1, 1, 10];
const DEADZONE = 0.12;
const TICK_MS = 40;

function axesFor(mode: JogMode): (Axis | null)[] {
  const sim = host.sim;
  if (!sim) return [null, null, null];
  const dof = sim.arm.dof;
  const scara = sim.arm.kind === 'scara4';
  if (mode === 'axes13' || mode === 'axes46') {
    const base = mode === 'axes13' ? 0 : 3;
    return [0, 1, 2].map((k) => {
      const i = base + k;
      if (i >= dof) return null;
      return { index: i, label: `J${i + 1}`, unit: sim.jointType(i) === 'P' ? 'mm' : '°', enabled: true };
    });
  }
  if (mode === 'linear') return ['X', 'Y', 'Z'].map((l, k) => ({ index: k, label: l, unit: 'mm', enabled: true }));
  return ['Rx', 'Ry', 'Rz'].map((l, k) => ({ index: 3 + k, label: l, unit: '°', enabled: !(scara && k < 2) }));
}

/** Full-deflection speed per tick for an axis (deg or mm per second). */
function rate(mode: JogMode, a: Axis) {
  if (mode === 'linear') return 150;
  if (a.unit === 'mm') return 100;
  return 40;
}

export function JogScreen() {
  const jog = useApp((s) => s.jog);
  const handGuide = useApp((s) => s.handGuide);
  const hgMode = useApp((s) => s.handGuideMode);
  const running = useApp((s) => s.runState !== 'idle');
  const armKey = useApp((s) => `${s.taskId}:${s.armOverride}`);
  const set = useApp((s) => s.set);
  const [vals, setVals] = useState<{ joints: number[]; tcp: number[]; grip: boolean }>({ joints: [], tcp: [], grip: true });
  const isJoint = jog.mode === 'axes13' || jog.mode === 'axes46';
  const axes = axesFor(jog.mode);
  void armKey;

  useEffect(() => {
    let last = 0;
    const off = host.onFrame((sim) => {
      const now = performance.now();
      if (now - last < 90) return;
      last = now;
      const p = sim.tcpPose();
      setVals({ joints: sim.jointsDisplay(), tcp: [p.x, p.y, p.z, p.rx, p.ry, p.rz], grip: sim.s.gripperOpen });
    });
    return () => { off(); };
  }, []);

  const apply = (a: Axis, delta: number, log: boolean) => {
    if (isJoint) host.jogJoint(a.index, delta, log);
    else host.jogCart(a.index as 0 | 1 | 2 | 3 | 4 | 5, delta, jog.frame, log);
  };

  // ---- continuous stick motion
  const defl = useRef<[number, number, number]>([0, 0, 0]);
  const session = useRef<{ start: number; totals: Record<string, number> } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const axesRef = useRef(axes);
  axesRef.current = axes;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const startStick = () => {
    if (timer.current) return;
    session.current = { start: performance.now(), totals: {} };
    timer.current = setInterval(() => {
      const d = defl.current;
      axesRef.current.forEach((a, k) => {
        if (!a || !a.enabled) return;
        const v = d[k];
        const m = Math.abs(v);
        if (m < DEADZONE) return;
        const mag = Math.pow((m - DEADZONE) / (1 - DEADZONE), 1.6);
        const delta = Math.sign(v) * mag * rate(useApp.getState().jog.mode, a) * (TICK_MS / 1000);
        applyRef.current(a, delta, false);
        const t = session.current!.totals;
        t[a.label] = (t[a.label] ?? 0) + delta;
      });
    }, TICK_MS);
  };
  const endStick = () => {
    defl.current = [0, 0, 0];
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const s = session.current;
    session.current = null;
    if (s && Object.keys(s.totals).length) {
      const st = useApp.getState().jog;
      logEvent('jog', { input: 'joystick', mode: st.mode, frame: st.mode === 'linear' || st.mode === 'reorient' ? st.frame : undefined,
        durationMs: Math.round(performance.now() - s.start), totals: Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, +v.toFixed(2)])) });
    }
  };
  useEffect(() => () => endStick(), []);

  // ---- arrow stepping (tap = one increment, hold = repeat)
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHold = () => { if (hold.current) { clearTimeout(hold.current); clearInterval(hold.current); } hold.current = null; };
  const startHold = (a: Axis | null, sgn: number) => {
    if (!a || !a.enabled || running) return;
    stopHold();
    const step = () => apply(a, jog.step * sgn, true);
    step();
    hold.current = setTimeout(() => { hold.current = setInterval(step, 110); }, 380);
  };
  useEffect(() => stopHold, []);

  const disabled = running;
  const arrow = (slot: number, sgn: number, dir: 'up' | 'down' | 'left' | 'right', cls: string) => {
    const a = axes[slot];
    const off = !a || !a.enabled || disabled;
    const I = Icon[dir];
    return (
      <button className={`jog-arrow ${cls}`} disabled={off} aria-label={a ? `${a.label} ${sgn > 0 ? 'plus' : 'minus'}` : undefined}
        onPointerDown={(e) => { e.stopPropagation(); startHold(a, sgn); }} onPointerUp={stopHold} onPointerLeave={stopHold}>
        <I width={16} height={16} /><span>{a ? `${a.label}${sgn > 0 ? '+' : '−'}` : ''}</span>
      </button>
    );
  };

  const readLabels = isJoint ? vals.joints.map((_, i) => `J${i + 1}`) : ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz'];
  const readVals = isJoint ? vals.joints : vals.tcp;
  const activeLabels = new Set(axes.filter(Boolean).map((a) => a!.label));
  const limits = host.sim?.arm.limits ?? [];

  return (
    <div className="screen-pad jog-screen">
      <div className="seg seg-lg" role="tablist" aria-label="Motion mode" data-tour="jog-modes">
        {MODES.map((m) => {
          const empty = axesFor(m.id).every((a) => !a);
          return <button key={m.id} className={jog.mode === m.id ? 'on' : ''} disabled={empty} onClick={() => set({ jog: { ...jog, mode: m.id } })}>{m.label}</button>;
        })}
      </div>
      <div className="row jog-options">
        {!isJoint ? (
          <div className="seg" aria-label="Coordinate frame">
            <button className={jog.frame === 'base' ? 'on' : ''} onClick={() => set({ jog: { ...jog, frame: 'base' } })}>Base</button>
            <button className={jog.frame === 'tool' ? 'on' : ''} onClick={() => set({ jog: { ...jog, frame: 'tool' } })}>Tool</button>
          </div>
        ) : <span className="muted small">Each joint turns on its own</span>}
        <span className="grow" />
        <span className="muted small">Arrow step</span>
        <div className="seg" aria-label="Arrow step size">
          {STEPS.map((s) => <button key={s} className={jog.step === s ? 'on' : ''} onClick={() => set({ jog: { ...jog, step: s } })}>{s}</button>)}
        </div>
      </div>

      <div className={`jog-controls ${disabled ? 'off' : ''}`} onPointerUp={stopHold} data-tour="jog-stick">
        <Stick disabled={disabled} axes={[axes[0], axes[1]]} onStart={startStick} onEnd={endStick} onMove={(x, y) => { defl.current[0] = x; defl.current[1] = y; }}>
          {arrow(1, 1, 'up', 'n')}{arrow(1, -1, 'down', 's')}{arrow(0, -1, 'left', 'w')}{arrow(0, 1, 'right', 'e')}
        </Stick>
        <Rocker disabled={disabled || !axes[2]?.enabled} onStart={startStick} onEnd={endStick} onMove={(v) => { defl.current[2] = v; }}>
          {arrow(2, 1, 'up', 'n')}{arrow(2, -1, 'down', 's')}
        </Rocker>
      </div>
      <div className="muted small center jog-hint">{disabled ? 'Stop the program to jog the arm.' : 'Drag the stick to move smoothly · tap an arrow to step'}</div>

      <div className="readouts">
        {readLabels.map((l, i) => {
          const v = readVals[i] ?? 0;
          const lim = isJoint ? limits[i] : undefined;
          const P = isJoint && host.sim?.jointType(i) === 'P';
          const frac = lim ? ((P ? v / 1000 : v * Math.PI / 180) - lim.min) / (lim.max - lim.min) : null;
          return (
            <div key={l} className={`readout ${activeLabels.has(l) ? 'on' : ''}`}>
              <span className="lbl">{l}</span>
              <span className="val">{v.toFixed(1)}<small>{isJoint ? (P ? 'mm' : '°') : i < 3 ? 'mm' : '°'}</small></span>
              {frac !== null && <span className="lim"><i style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} /></span>}
            </div>
          );
        })}
      </div>

      <div className="jog-actions">
        <button data-tour="jog-handguide" className={`btn tile-btn ${handGuide ? 'leaf' : ''}`} disabled={running} aria-pressed={handGuide} onClick={() => set({ handGuide: !handGuide })}><Icon.hand width={18} height={18} /> Hand guide</button>
        <button className="btn tile-btn" disabled={running} onClick={() => host.gripper(vals.grip ? 'close' : 'open')}><Icon.grip width={18} height={18} /> {vals.grip ? 'Close gripper' : 'Open gripper'}</button>
        <button className="btn tile-btn" disabled={running} onClick={() => host.goHome()}><Icon.home width={18} height={18} /> Go home</button>
        <button data-tour="jog-teach" className="btn tile-btn aqua" disabled={running} onClick={() => host.teach()} title="Save the current tool pose as a position"><Icon.target width={18} height={18} /> Teach position</button>
      </div>
      {handGuide && (
        <div className="row center-row">
          <span className="muted small">Drag the handle at the tool in the cell view</span>
          <div className="seg">
            <button className={hgMode === 'translate' ? 'on' : ''} onClick={() => set({ handGuideMode: 'translate' })}><Icon.move width={13} height={13} /> Move</button>
            <button className={hgMode === 'rotate' ? 'on' : ''} onClick={() => set({ handGuideMode: 'rotate' })}><Icon.rotate width={13} height={13} /> Rotate</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Spring-return 2-axis stick. Calls onMove with x (right +) and y (up +) in [-1, 1]. */
function Stick({ disabled, axes, onStart, onEnd, onMove, children }: {
  disabled: boolean; axes: (Axis | null)[]; onStart: () => void; onEnd: () => void; onMove: (x: number, y: number) => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  const [active, setActiveState] = useState(false);
  const live = useRef(false);
  const setActive = (v: boolean) => { live.current = v; setActiveState(v); };
  const radius = () => (ref.current ? ref.current.clientWidth * 0.3 : 60);
  const update = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const R = radius();
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    if (!axes[0]?.enabled) dx = 0;
    if (!axes[1]?.enabled) dy = 0;
    setPos([dx, dy]);
    onMove(dx / R, -dy / R);
  };
  return (
    <div className={`stick ${active ? 'active' : ''}`} ref={ref}>
      <div className="stick-ring" />
      {children}
      <div className="stick-knob" role="slider" aria-label="Joystick" aria-valuenow={0} tabIndex={-1}
        style={{ transform: `translate(calc(-50% + ${pos[0]}px), calc(-50% + ${pos[1]}px))` }}
        onPointerDown={(e) => { if (disabled) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } setActive(true); update(e); onStart(); }}
        onPointerMove={(e) => { if (live.current) update(e); }}
        onPointerUp={() => { if (!live.current) return; setActive(false); setPos([0, 0]); onMove(0, 0); onEnd(); }}
        onPointerCancel={() => { setActive(false); setPos([0, 0]); onMove(0, 0); onEnd(); }} />
    </div>
  );
}

/** Spring-return vertical rocker for the third axis (up +). */
function Rocker({ disabled, onStart, onEnd, onMove, children }: {
  disabled: boolean; onStart: () => void; onEnd: () => void; onMove: (v: number) => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  const [active, setActiveState] = useState(false);
  const live = useRef(false);
  const setActive = (v: boolean) => { live.current = v; setActiveState(v); };
  const update = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const R = r.height * 0.28;
    const dy = Math.max(-R, Math.min(R, e.clientY - (r.top + r.height / 2)));
    setY(dy);
    onMove(-dy / R);
  };
  return (
    <div className={`rocker ${active ? 'active' : ''} ${disabled ? 'off' : ''}`} ref={ref}>
      {children}
      <div className="rocker-knob" role="slider" aria-label="Third axis" aria-valuenow={0} tabIndex={-1}
        style={{ transform: `translate(-50%, calc(-50% + ${y}px))` }}
        onPointerDown={(e) => { if (disabled) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } setActive(true); update(e); onStart(); }}
        onPointerMove={(e) => { if (live.current) update(e); }}
        onPointerUp={() => { if (!live.current) return; setActive(false); setY(0); onMove(0); onEnd(); }}
        onPointerCancel={() => { setActive(false); setY(0); onMove(0); onEnd(); }} />
    </div>
  );
}
