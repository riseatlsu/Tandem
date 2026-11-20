import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import { defineBlocks, makeTheme } from './definitions';

export function BlocksPreview({ json, onClose, onAccept, onReject }: { json: object; onClose(): void; onAccept(): void; onReject(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    defineBlocks();
    const ws = Blockly.inject(ref.current!, { readOnly: true, theme: makeTheme(), renderer: 'zelos', zoom: { controls: true, wheel: true, startScale: 0.8 }, move: { scrollbars: true, drag: true, wheel: true } });
    Blockly.serialization.workspaces.load(json, ws);
    ws.scrollCenter();
    return () => ws.dispose();
  }, [json]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="glass modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Preview suggested blocks">
        <div className="modal-head">Suggested blocks</div>
        <div className="modal-body"><div ref={ref} style={{ height: '100%', minHeight: 360, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }} /></div>
        <div className="modal-foot"><span className="muted" style={{ marginRight: 'auto' }}>Accepting replaces your current blocks. You can keep editing afterwards.</span><button className="btn" onClick={onReject}>Reject</button><button className="btn aqua" onClick={onAccept}>Accept</button></div>
      </div>
    </div>
  );
}
