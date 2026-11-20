import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useApp, updateWorkspace } from '../store';
import { BlocksEditor } from '../blocks/BlocksEditor';
import { Icon } from '../ui/icons';
import { logEvent } from '../study/logger';
import { resetGenerated } from '../editor/program';
import { host } from '../simHost';

const CodeEditor = lazy(() => import('../editor/CodeEditor'));

export function EditorArea() {
  const ws = useApp((s) => s.workspaces[s.taskId]);
  const mode = useApp((s) => s.mode);
  const consoleLines = useApp((s) => s.console);
  const running = useApp((s) => s.runState !== 'idle');
  const [tab, setTab] = useState<'program' | 'console' | 'signals'>('program');
  const [preview, setPreview] = useState(true);
  const [js, setJs] = useState('');
  const onCode = useCallback((c: string) => setJs(c), []);
  const [, force] = useState(0);
  if (!ws) return null;

  const switchEditor = (e: 'blocks' | 'code') => {
    if (e === ws.editor) return;
    resetGenerated();
    updateWorkspace({ editor: e });
    logEvent('panel_toggle', { editor: e });
  };

  return (
    <section className="glass panel editor-wrap" aria-label="Program editor">
      <div className="editor-tabs">
        <div className="seg" role="tablist">
          <button className={tab === 'program' ? 'on' : ''} onClick={() => setTab('program')}>{ws.editor === 'blocks' ? <Icon.blocks width={12} height={12} /> : <Icon.code width={12} height={12} />} Program</button>
          <button className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>Console {consoleLines.some((l) => l.kind === 'fault') ? '•' : ''}</button>
          <button className={tab === 'signals' ? 'on' : ''} onClick={() => { setTab('signals'); force((x) => x + 1); }}>Signals</button>
        </div>
        <span style={{ flex: 1 }} />
        {tab === 'program' && ws.editor === 'blocks' && (
          <button className={`btn sm ghost`} aria-pressed={preview} onClick={() => { setPreview(!preview); logEvent('editor_preview_toggle', { on: !preview }); }}><Icon.code width={13} height={13} /> {preview ? 'Hide' : 'Show'} JavaScript</button>
        )}
        {mode === 'demo' && (
          <div className="seg" title="Editor for this task (demo mode)">
            <button className={ws.editor === 'blocks' ? 'on' : ''} disabled={running} onClick={() => switchEditor('blocks')}>Blocks</button>
            <button className={ws.editor === 'code' ? 'on' : ''} disabled={running} onClick={() => switchEditor('code')}>Code</button>
          </div>
        )}
      </div>
      <div className={`editor-body ${tab === 'program' && ws.editor === 'blocks' && preview ? 'split' : ''}`}>
        {tab === 'program' && ws.editor === 'blocks' && <BlocksEditor onCode={onCode} />}
        {tab === 'program' && ws.editor === 'blocks' && preview && (
          <div className="js-preview" aria-label="Generated JavaScript (read-only)">
            <div className="panel-head" style={{ paddingBottom: 4 }}>Generated JavaScript</div>
            <pre>{js.replace(/await __hl\('[^']*'\);\n/g, '').replace(/^\s*\n/gm, '') || '// add blocks under “When Run is pressed”'}</pre>
          </div>
        )}
        {tab === 'program' && ws.editor === 'code' && (
          <Suspense fallback={<div className="muted" style={{ padding: 16 }}>Loading editor…</div>}><CodeEditor /></Suspense>
        )}
        {tab === 'console' && (
          <div className="panel-body console" style={{ paddingTop: 10 }}>
            {consoleLines.length === 0 && <div className="muted">Program output and faults appear here. Use <code>log()</code> or the “Show message” block.</div>}
            {consoleLines.map((l) => <div key={l.id} className={`line ${l.kind}`}><span className="t">{l.simTime.toFixed(2)}s</span>{l.text}</div>)}
          </div>
        )}
        {tab === 'signals' && <SignalsView />}
      </div>
    </section>
  );
}

function SignalsView() {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 250); return () => clearInterval(id); }, []);
  const s = host.sim?.s;
  if (!s) return null;
  const Row = ({ k, v, dir }: { k: string; v: boolean | string; dir: 'in' | 'out' }) => (
    <div className="target-row" style={{ cursor: 'default' }}>
      <span className="chip" style={{ height: 20, fontSize: 10.5 }}>{dir === 'in' ? 'INPUT' : 'OUTPUT'}</span>
      <span className="name">{k}</span><span className="grow" />
      <span className={`chip ${v === true ? 'leaf' : v === false ? '' : 'aqua'}`}>{String(v)}</span>
    </div>
  );
  return (
    <div className="panel-body" style={{ paddingTop: 10 }}>
      {Object.keys(s.inputs).length + Object.keys(s.outputs).length === 0 && <div className="muted">This cell has no signals.</div>}
      {Object.entries(s.inputs).map(([k, v]) => <Row key={k} k={k} v={v} dir="in" />)}
      {Object.entries(s.outputs).map(([k, v]) => <Row key={k} k={k} v={v} dir="out" />)}
    </div>
  );
}
