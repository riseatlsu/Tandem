import { startTour } from '../tour/Tour';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useApp, updateWorkspace, type PendantScreen } from '../store';
import { ARMS, TASKS } from '../content';
import { host } from '../simHost';
import { Icon } from '../ui/icons';
import { Markdown } from '../ui/Markdown';
import { BlocksEditor } from '../blocks/BlocksEditor';
import { resetGenerated } from '../editor/program';
import { logEvent } from '../study/logger';
import type { Target } from '../sim/types';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { useSoundPrefs } from '../ui/SoundToggles';

const CodeEditor = lazy(() => import('../editor/CodeEditor'));
export const go = (screen: PendantScreen) => {
  const s = useApp.getState();
  if (s.pendantScreen === screen) return;
  s.set({ pendantScreen: screen });
  logEvent('panel_toggle', { pendant: screen });
};

// ---------------------------------------------------------------- Home
const APPS: { id: PendantScreen; label: string; sub: string; icon: keyof typeof Icon; tone: string }[] = [
  { id: 'program', label: 'Program', sub: 'Build & edit', icon: 'blocks', tone: 'aqua' },
  { id: 'jog', label: 'Jog', sub: 'Move the arm', icon: 'joystick', tone: 'leaf' },
  { id: 'positions', label: 'Positions', sub: 'Taught points', icon: 'target', tone: 'violet' },
  { id: 'io', label: 'I/O', sub: 'Signals', icon: 'plug', tone: 'amber' },
  { id: 'log', label: 'Log', sub: 'Messages', icon: 'terminal', tone: 'slate' },
  { id: 'settings', label: 'Settings', sub: 'Arm & editor', icon: 'gear', tone: 'silver' },
];

export function HomeScreen() {
  const taskId = useApp((s) => s.taskId);
  const preds = useApp((s) => s.predicates);
  const faultLog = useApp((s) => s.console.some((l) => l.kind === 'fault'));
  const task = TASKS[taskId];
  const done = preds.filter((p) => p.pass).length;
  const frac = preds.length ? done / preds.length : 0;
  return (
    <div className="screen-pad home">
      <button className="task-card" onClick={() => go('task')}>
        <span className="ring" style={{ ['--p' as string]: frac }}><b>{done}/{preds.length}</b></span>
        <span className="task-card-text">
          <span className="eyebrow">Current task</span>
          <span className="t">{task?.title}</span>
          <span className="muted small">{done === preds.length && preds.length ? 'All goals met' : 'Tap to read the brief and goals'}</span>
        </span>
        <Icon.chevron width={16} height={16} className="chev" />
      </button>
      <div className="app-grid">
        {APPS.map((a) => {
          const I = Icon[a.icon];
          return (
            <button key={a.id} className="app-tile" data-tour={`tile-${a.id}`} onClick={() => go(a.id)}>
              <span className={`app-icon ${a.tone}`}><I width={26} height={26} />{a.id === 'log' && faultLog && <i className="badge" />}</span>
              <span className="app-label">{a.label}</span>
              <span className="app-sub">{a.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Task
export function TaskScreen() {
  const taskId = useApp((s) => s.taskId);
  const preds = useApp((s) => s.predicates);
  const task = TASKS[taskId];
  const [hint, setHint] = useState(-1);
  useEffect(() => setHint(-1), [taskId]);
  if (!task) return null;
  return (
    <div className="screen-pad stack">
      <div>
        <div className="screen-h1">{task.title}</div>
        <div className="brief"><Markdown text={task.brief} /></div>
      </div>
      <div className="group-label">Goals</div>
      <ul className="checklist" aria-label="Goals">
        {preds.map((p, i) => (
          <li key={i} className={p.pass ? 'pass' : ''}>
            <span className="check">{p.pass && <Icon.check width={11} height={11} />}</span>
            <span>{p.label}</span>
            {p.detail && <span className="detail">{p.detail}</span>}
          </li>
        ))}
      </ul>
      {task.hints?.length ? (
        <div>
          {hint >= 0 && <div className="hint">{task.hints[hint]}</div>}
          {hint < task.hints.length - 1 && <button className="btn sm ghost" onClick={() => { setHint(hint + 1); logEvent('help_open', { hint: hint + 1 }); }}><Icon.info /> {hint < 0 ? 'Show a hint' : 'Another hint'}</button>}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Program (always mounted, so Blockly keeps its state)
export function ProgramScreen() {
  const ws = useApp((s) => s.workspaces[s.taskId]);
  const [view, setView] = useState<'blocks' | 'js'>('blocks');
  const [js, setJs] = useState('');
  const onCode = useCallback((c: string) => setJs(c), []);
  if (!ws) return null;
  const blocks = ws.editor === 'blocks';
  return (
    <div className="program-screen">
      {blocks && (
        <div className="program-bar">
          <div className="seg" aria-label="Program view">
            <button className={view === 'blocks' ? 'on' : ''} onClick={() => setView('blocks')}><Icon.blocks width={12} height={12} /> Blocks</button>
            <button className={view === 'js' ? 'on' : ''} onClick={() => { setView('js'); logEvent('editor_preview_toggle', { on: true }); }}><Icon.code width={12} height={12} /> JavaScript</button>
          </div>
          <span className="grow" />
          <span className="muted small">{view === 'blocks' ? 'Drag blocks under “When Run is pressed”' : 'Read-only — generated from your blocks'}</span>
        </div>
      )}
      <div className="program-body">
        {blocks && <div className="layer" style={{ visibility: view === 'blocks' ? 'visible' : 'hidden' }}><ErrorBoundary label="block editor"><BlocksEditor onCode={onCode} /></ErrorBoundary></div>}
        {blocks && view === 'js' && (
          <pre className="js-preview layer" aria-label="Generated JavaScript (read-only)">{js.replace(/await __hl\('[^']*'\);\n/g, '').replace(/^\s*\n/gm, '') || '// add blocks under “When Run is pressed”'}</pre>
        )}
        {!blocks && <ErrorBoundary label="code editor" key={ws.editor}><Suspense fallback={<div className="muted" style={{ padding: 16 }}>Loading editor…</div>}><CodeEditor /></Suspense></ErrorBoundary>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Positions
export function PositionsScreen() {
  const ws = useApp((s) => s.workspaces[s.taskId]);
  const running = useApp((s) => s.runState !== 'idle');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (!ws || !host.sim) return null;
  const all: Target[] = Object.values({ ...host.sim.allTargets(), ...ws.targets });
  const mine = all.filter((t) => t.source !== 'scene');
  const scene = all.filter((t) => t.source === 'scene');
  const commit = (from: string) => { if (draft && draft !== from) host.renameTarget(from, draft); setEditing(null); };
  const Row = ({ t }: { t: Target }) => (
    <div className="target-row">
      <span className={`tgt-ico ${t.source === 'scene' ? 'scene' : ''}`}><Icon.target width={13} height={13} /></span>
      <div style={{ minWidth: 0 }}>
        {editing === t.name ? (
          <input className="field" autoFocus value={draft} style={{ height: 26, width: 130, fontFamily: 'var(--mono)' }}
            onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(t.name)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(t.name); if (e.key === 'Escape') setEditing(null); }} />
        ) : <div className="name">{t.name}</div>}
        <div className="xyz">{t.pose.x.toFixed(0)}, {t.pose.y.toFixed(0)}, {t.pose.z.toFixed(0)} mm</div>
      </div>
      <div className="acts">
        <button className="btn sm" title={`Move the arm to ${t.name}`} disabled={running} onClick={() => host.gotoTarget(t.name)}><Icon.go width={13} height={13} /> Go to</button>
        {t.source !== 'scene' && <>
          <button className="icon-btn" title="Re-teach at the current pose" disabled={running} onClick={() => host.teach(t.name)}><Icon.target /></button>
          <button className="icon-btn" title="Rename" onClick={() => { setEditing(t.name); setDraft(t.name); }}><Icon.edit /></button>
          <button className="icon-btn" title="Delete" onClick={() => host.deleteTarget(t.name)}><Icon.trash /></button>
        </>}
      </div>
    </div>
  );
  return (
    <div className="screen-pad stack">
      <button className="btn aqua lg" disabled={running} onClick={() => host.teach()}><Icon.plus width={15} height={15} /> Teach new position here</button>
      <div className="group-label">Your positions</div>
      <div className="target-list">
        {mine.length === 0 && <div className="empty-note">Jog or hand-guide the arm, then teach a position. Programs move between positions.</div>}
        {mine.map((t) => <Row key={t.name} t={t} />)}
      </div>
      {scene.length > 0 && <>
        <div className="group-label">Cell positions <span className="muted">(read-only)</span></div>
        <div className="target-list">{scene.map((t) => <Row key={t.name} t={t} />)}</div>
      </>}
    </div>
  );
}

// ---------------------------------------------------------------- I/O
export function IOScreen() {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 250); return () => clearInterval(id); }, []);
  const s = host.sim?.s;
  if (!s) return null;
  const Row = ({ k, v }: { k: string; v: boolean | string }) => (
    <div className="io-row">
      <span className={`led ${v === true ? 'on' : ''}`} />
      <span className="name">{k}</span><span className="grow" />
      <span className={`chip ${v === true ? 'leaf' : v === false ? '' : 'aqua'}`}>{v === true ? 'ON' : v === false ? 'OFF' : String(v)}</span>
    </div>
  );
  const ins = Object.entries(s.inputs);
  const outs = Object.entries(s.outputs);
  return (
    <div className="screen-pad stack">
      {ins.length + outs.length === 0 && <div className="empty-note">This cell has no signals.</div>}
      {ins.length > 0 && <><div className="group-label">Inputs · sensors</div><div className="io-list">{ins.map(([k, v]) => <Row key={k} k={k} v={v} />)}</div></>}
      {outs.length > 0 && <><div className="group-label">Outputs</div><div className="io-list">{outs.map(([k, v]) => <Row key={k} k={k} v={v} />)}</div></>}
    </div>
  );
}

// ---------------------------------------------------------------- Log
export function LogScreen() {
  const lines = useApp((s) => s.console);
  return (
    <div className="screen-pad console">
      {lines.length === 0 && <div className="empty-note" style={{ fontFamily: 'var(--font)' }}>Program messages and faults appear here. Use <code>log()</code> or the “Show message” block.</div>}
      {lines.map((l) => <div key={l.id} className={`line ${l.kind}`}><span className="t">{l.simTime.toFixed(2)}s</span>{l.text}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------- Settings
export function SettingsScreen() {
  const mode = useApp((s) => s.mode);
  const taskId = useApp((s) => s.taskId);
  const ws = useApp((s) => s.workspaces[s.taskId]);
  const armOverride = useApp((s) => s.armOverride);
  const showFrames = useApp((s) => s.showFrames);
  const running = useApp((s) => s.runState !== 'idle');
  const set = useApp((s) => s.set);
  const task = TASKS[taskId];
  const [snd, setSnd] = useSoundPrefs();
  const switchEditor = (e: 'blocks' | 'code') => {
    if (!ws || e === ws.editor) return;
    resetGenerated();
    updateWorkspace({ editor: e });
    logEvent('panel_toggle', { editor: e });
  };
  return (
    <div className="screen-pad stack">
      <div className="settings-group">
        <label className="setting">
          <span><b>Show positions in the cell</b><small>Draw a small frame at every position</small></span>
          <input type="checkbox" className="switch" checked={showFrames} onChange={() => set({ showFrames: !showFrames })} />
        </label>
      </div>
      <div className="settings-group">
        <label className="setting">
          <span><b>Sound effects</b><small>Button taps, motor hum, gripper and alerts</small></span>
          <input type="checkbox" className="switch" checked={snd.sfx} onChange={() => setSnd({ sfx: !snd.sfx })} />
        </label>
        {mode === 'demo' && (
          <label className="setting">
            <span><b>Background music</b><small>Calm ambient music on repeat</small></span>
            <input type="checkbox" className="switch" checked={snd.music} onChange={() => setSnd({ music: !snd.music })} />
          </label>
        )}
        <label className="setting">
          <span><b>Volume</b></span>
          <input type="range" min={0} max={1} step={0.05} value={snd.volume} aria-label="Volume" className="volume" onChange={(e) => setSnd({ volume: +e.target.value })} />
        </label>
      </div>
      {mode === 'demo' && (
        <div className="settings-group">
          <div className="setting">
            <span><b>Robot arm</b><small>Try the task with a different arm</small></span>
            <select className="field" value={armOverride ?? ''} aria-label="Choose arm" disabled={running}
              onChange={(e) => { host.setArm(e.target.value || null); logEvent('arm_change', { arm: e.target.value }); }}>
              <option value="">Task default ({ARMS[task?.armId ?? '']?.name.split(' (')[0]})</option>
              {Object.values(ARMS).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="setting">
            <span><b>Programming style</b><small>Blocks for beginners, JavaScript for full control</small></span>
            <div className="seg">
              <button className={ws?.editor === 'blocks' ? 'on' : ''} disabled={running} onClick={() => switchEditor('blocks')}>Blocks</button>
              <button className={ws?.editor === 'code' ? 'on' : ''} disabled={running} onClick={() => switchEditor('code')}>Code</button>
            </div>
          </div>
        </div>
      )}
      <div className="settings-group about">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
        <span><b>Tandem</b><small>{host.sim ? ARMS[host.armId()]?.name : ''} · {host.sim?.scene.title}</small></span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={running} onClick={() => startTour()}>Take the tour</button>
      </div>
    </div>
  );
}
