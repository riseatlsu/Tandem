import { useApp } from '../store';
import { host } from '../simHost';
import { programSource } from '../editor/program';
import { Icon } from '../ui/icons';
import { logEvent } from '../study/logger';
import { useEffect } from 'react';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];
export function RunBar() {
  const runState = useApp((s) => s.runState);
  const speed = useApp((s) => s.speed);
  const fault = useApp((s) => s.fault);
  const handGuide = useApp((s) => s.handGuide);
  const set = useApp((s) => s.set);
  const idle = runState === 'idle';
  const run = () => { if (handGuide) set({ handGuide: false }); host.run(programSource()); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (useApp.getState().runState === 'idle') run(); }
      if (e.key === 'Escape' && useApp.getState().runState !== 'idle') { e.preventDefault(); host.stop(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const status = runState === 'running' || runState === 'stepping' ? 'Running' : runState === 'paused' ? 'Paused' : fault ? 'Protective stop' : 'Ready';
  const pulse = runState === 'running' || runState === 'stepping' ? 'running' : runState === 'paused' ? 'paused' : fault ? 'fault' : '';
  return (
    <div className="glass runbar" role="toolbar" aria-label="Run controls">
      {idle ? (
        <button className="btn leaf lg" onClick={run} title="Run (⌘/Ctrl + Enter)"><Icon.play /> Run</button>
      ) : runState === 'paused' ? (
        <button className="btn leaf lg" onClick={() => host.resume()}><Icon.play /> Resume</button>
      ) : (
        <button className="btn lg" onClick={() => host.pause()}><Icon.pause /> Pause</button>
      )}
      <button className="btn lg" disabled={runState !== 'paused'} onClick={() => host.step()} title="Execute one robot command"><Icon.step /> Step</button>
      <button className="btn rose lg" disabled={idle} onClick={() => host.stop()} title="Stop (Esc)"><Icon.stop /> Stop</button>
      <button className="btn lg ghost" onClick={() => host.reset()} title="Reset the cell to its starting state"><Icon.reset /> Reset</button>
      <div className="status"><span className={`pulse ${pulse}`} />{status}</div>
      <span className="spacer" />
      <span className="muted speed-label" style={{ fontWeight: 550 }}>Speed</span>
      <div className="seg" aria-label="Simulation speed">
        {SPEEDS.map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => { host.setSpeed(s); logEvent('speed_change', { speed: s }); }}>{s}×</button>)}
      </div>
    </div>
  );
}
