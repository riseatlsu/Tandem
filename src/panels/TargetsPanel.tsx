import { useState } from 'react';
import { useApp } from '../store';
import { host } from '../simHost';
import { Icon } from '../ui/icons';
import type { Target } from '../sim/types';

export function TargetsPanel() {
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
      <span className={`tgt-ico ${t.source === 'scene' ? 'scene' : ''}`}><Icon.target width={12} height={12} /></span>
      <div style={{ minWidth: 0 }}>
        {editing === t.name ? (
          <input className="field" autoFocus value={draft} style={{ height: 24, width: 120, fontFamily: 'var(--mono)' }}
            onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(t.name)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(t.name); if (e.key === 'Escape') setEditing(null); }} />
        ) : (
          <div className="name" onDoubleClick={() => { if (t.source !== 'scene') { setEditing(t.name); setDraft(t.name); } }} title={t.source === 'scene' ? 'Defined by the cell (read-only)' : 'Double-click to rename'}>{t.name}</div>
        )}
        <div className="xyz">{t.pose.x.toFixed(0)}, {t.pose.y.toFixed(0)}, {t.pose.z.toFixed(0)} mm</div>
      </div>
      <div className="acts">
        <button className="icon-btn" title={`Go to ${t.name}`} disabled={running} onClick={() => host.gotoTarget(t.name)}><Icon.go /></button>
        {t.source !== 'scene' && <>
          <button className="icon-btn" title="Re-teach at current pose" disabled={running} onClick={() => host.teach(t.name)}><Icon.target /></button>
          <button className="icon-btn" title="Rename" onClick={() => { setEditing(t.name); setDraft(t.name); }}><Icon.edit /></button>
          <button className="icon-btn" title="Delete" onClick={() => host.deleteTarget(t.name)}><Icon.trash /></button>
        </>}
      </div>
    </div>
  );
  return (
    <section className="glass panel" style={{ flex: '1 1 0', minHeight: 140 }} aria-label="Targets">
      <div className="panel-head">Targets<span className="spacer" />
        <button className="btn sm aqua" disabled={running} onClick={() => host.teach()} title="Save the current tool pose as a target"><Icon.plus width={13} height={13} /> Teach</button>
      </div>
      <div className="panel-body">
        <div className="target-list">
          {mine.length === 0 && <div className="muted" style={{ padding: '4px 2px 8px' }}>Jog or hand-guide the arm, then press <b>Teach</b>.</div>}
          {mine.map((t) => <Row key={t.name} t={t} />)}
          {scene.length > 0 && <div className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', margin: '8px 2px 2px' }}>Cell targets</div>}
          {scene.map((t) => <Row key={t.name} t={t} />)}
        </div>
      </div>
    </section>
  );
}
