import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import type { Proposal } from '../store';
import { currentWorkspace } from '../store';

export default function DiffModal({ proposal, onClose, onAccept, onReject }: { proposal: Proposal; onClose(): void; onAccept(edited?: string): void; onReject(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const original = currentWorkspace().code;
  useEffect(() => {
    const e = monaco.editor.createDiffEditor(ref.current!, { theme: 'tandem', automaticLayout: true, renderSideBySide: true, originalEditable: false, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, minimap: { enabled: false }, scrollBeyondLastLine: false });
    const a = monaco.editor.createModel(original, 'javascript');
    const b = monaco.editor.createModel(proposal.newProgram ?? '', 'javascript');
    e.setModel({ original: a, modified: b });
    ed.current = e;
    return () => { e.dispose(); a.dispose(); b.dispose(); };
  }, [original, proposal.newProgram]);
  const accept = () => {
    const v = ed.current?.getModifiedEditor().getValue() ?? '';
    onAccept(v !== (proposal.newProgram ?? '') ? v : undefined);
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="glass modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Review suggested change">
        <div className="modal-head">Review suggested change</div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 10 }}>
          <div className="row"><span className="muted">{proposal.explanation}</span><span className="grow" /><span className="chip">Left: your program</span><span className="chip aqua">Right: suggestion (editable)</span></div>
          <div ref={ref} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', minHeight: 300 }} />
        </div>
        <div className="modal-foot"><button className="btn" onClick={onReject}>Reject</button><button className="btn aqua" onClick={accept}>Apply</button></div>
      </div>
    </div>
  );
}
