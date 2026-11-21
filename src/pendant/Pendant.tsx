import { useEffect } from 'react';
import { useApp, type PendantScreen } from '../store';
import { host } from '../simHost';
import { programSource } from '../editor/program';
import { Icon } from '../ui/icons';
import { AgentButton } from '../panels/ChatPanel';
import { agentMode } from '../agent/controller';
import { JogScreen } from './JogScreen';
import { HomeScreen, IOScreen, LogScreen, PositionsScreen, ProgramScreen, SettingsScreen, TaskScreen, go } from './screens';

const TITLES: Record<PendantScreen, string> = {
  home: 'Home', task: 'Task', program: 'Program', jog: 'Jog', positions: 'Positions', io: 'Inputs & outputs', log: 'Log', settings: 'Settings',
};
const DOCK: { id: PendantScreen; label: string; icon: keyof typeof Icon }[] = [
  { id: 'home', label: 'Home', icon: 'home' }, { id: 'program', label: 'Program', icon: 'blocks' },
  { id: 'jog', label: 'Jog', icon: 'joystick' }, { id: 'positions', label: 'Positions', icon: 'target' },
];

/** The teach pendant: a status bar, one screen at a time, a dock, and hardware run keys. */
export function Pendant() {
  const screen = useApp((s) => s.pendantScreen);
  const runState = useApp((s) => s.runState);
  const fault = useApp((s) => s.fault);
  const idle = runState === 'idle';

  const run = () => {
    if (useApp.getState().handGuide) useApp.getState().set({ handGuide: false });
    host.run(programSource());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (useApp.getState().runState === 'idle') run(); }
      if (e.key === 'Escape' && useApp.getState().runState !== 'idle') { e.preventDefault(); host.stop(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const status = runState === 'running' || runState === 'stepping' ? 'Running' : runState === 'paused' ? 'Paused' : fault ? 'Protective stop' : 'Ready';
  const pulse = runState === 'running' || runState === 'stepping' ? 'running' : runState === 'paused' ? 'paused' : fault ? 'fault' : '';
  const inDock = DOCK.some((d) => d.id === screen);

  return (
    <section className="pendant" aria-label="Teach pendant" data-tour="pendant">
      <div className="pendant-screen">
        <header className="pd-status">
          {!inDock ? (
            <button className="pd-back" onClick={() => go('home')}><Icon.back width={16} height={16} /> Home</button>
          ) : <span className="pd-brand"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="" /></span>}
          <span className="pd-title">{TITLES[screen]}</span>
          <span className="grow" />
          {agentMode() !== 'off' && <AgentButton />}
          <span className={`pd-state ${pulse}`}><span className={`pulse ${pulse}`} />{status}</span>
        </header>
        <div className="pd-body" data-tour="pendant-body">
          <div className={`pd-layer ${screen === 'program' ? '' : 'hidden'}`} aria-hidden={screen !== 'program'}><ProgramScreen /></div>
          {screen !== 'program' && (
            <div className="pd-layer scroll" key={screen}>
              {screen === 'home' && <HomeScreen />}
              {screen === 'task' && <TaskScreen />}
              {screen === 'jog' && <JogScreen />}
              {screen === 'positions' && <PositionsScreen />}
              {screen === 'io' && <IOScreen />}
              {screen === 'log' && <LogScreen />}
              {screen === 'settings' && <SettingsScreen />}
            </div>
          )}
        </div>
        <nav className="pd-dock" aria-label="Pendant screens">
          {DOCK.map((d) => {
            const I = Icon[d.icon];
            return <button key={d.id} data-tour={`dock-${d.id}`} className={screen === d.id ? 'on' : ''} aria-current={screen === d.id ? 'page' : undefined} onClick={() => go(d.id)}><I width={19} height={19} /><span>{d.label}</span></button>;
          })}
        </nav>
      </div>

      <div className="pd-keys" role="toolbar" aria-label="Run controls" data-tour="run-keys">
        {idle ? (
          <button className="hw-key run" onClick={run} title="Run (⌘/Ctrl + Enter)"><Icon.play width={18} height={18} /> Run</button>
        ) : runState === 'paused' ? (
          <button className="hw-key run" onClick={() => host.resume()}><Icon.play width={18} height={18} /> Resume</button>
        ) : (
          <button className="hw-key" onClick={() => host.pause()}><Icon.pause width={18} height={18} /> Pause</button>
        )}
        <button className="hw-key" disabled={runState !== 'paused'} onClick={() => host.step()} title="Execute one robot command (while paused)"><Icon.step width={18} height={18} /> Step</button>
        <span className="grow" />
        <button className="estop" onClick={() => { if (useApp.getState().runState !== 'idle') host.stop(); }} title="Stop the program (Esc)" aria-label="Stop"><span>STOP</span></button>
      </div>
    </section>
  );
}
