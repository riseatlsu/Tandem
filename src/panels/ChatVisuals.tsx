/** Rich chat content from the AI partner: block pictures, GIF examples and step-by-step plans. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Blockly from 'blockly';
import { defineBlocks, makeTheme } from '../blocks/definitions';
import { useApp } from '../store';
import { clipById, clipUrl } from '../agent/clips';
import { setPlanStep } from '../agent/plans';
import { Icon } from '../ui/icons';
import { logEvent } from '../study/logger';

/** A read-only picture of blocks, sized to its content. Click to enlarge. */
export function BlockPicture({ json, caption, scale = 0.62, onOpen }: { json: object; caption?: string; scale?: number; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(110);
  useEffect(() => {
    defineBlocks();
    const ws = Blockly.inject(ref.current!, { readOnly: true, theme: makeTheme(), renderer: 'zelos', zoom: { startScale: scale, controls: false, wheel: false }, move: { scrollbars: false, drag: false, wheel: false } });
    Blockly.serialization.workspaces.load(json, ws);
    const bb = ws.getBlocksBoundingBox();
    setH(Math.max(60, Math.min(340, (bb.bottom - bb.top) * ws.scale + 26)));
    const raf = requestAnimationFrame(() => { Blockly.svgResize(ws); ws.scroll(-bb.left * ws.scale + 14, -bb.top * ws.scale + 13); });
    return () => { cancelAnimationFrame(raf); ws.dispose(); };
  }, [json, scale]);
  return (
    <figure className="chat-visual">
      <button className="block-pic" style={{ height: h }} onClick={onOpen} aria-label={`Picture of blocks${caption ? `: ${caption}` : ''}. Click to enlarge.`} title="Click to enlarge">
        <div ref={ref} className="block-pic-ws" aria-hidden />
      </button>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export function ClipView({ clip, caption, onOpen }: { clip: string; caption?: string; onOpen?: () => void }) {
  const c = clipById(clip);
  return (
    <figure className="chat-visual">
      <button className="clip-pic" onClick={onOpen} aria-label={`Example: ${c?.title ?? clip}. Click to enlarge.`} title="Click to enlarge">
        <img src={clipUrl(clip)} alt={c?.about ?? ''} loading="lazy" />
        <span className="clip-badge"><Icon.play width={10} height={10} /> GIF</span>
      </button>
      {(caption || c) && <figcaption>{caption ?? c?.title}</figcaption>}
    </figure>
  );
}

/** Enlarged view for either kind of visual. */
export function VisualModal({ visual, onClose }: { visual: { kind: 'blocks'; json: object; caption?: string } | { kind: 'clip'; clip: string; caption?: string }; onClose(): void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div className="glass modal wide visual-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={visual.caption ?? 'Example'}>
        <div className="modal-head">{visual.caption ?? (visual.kind === 'clip' ? clipById(visual.clip)?.title : 'Blocks')}</div>
        <div className="modal-body">
          {visual.kind === 'clip' ? <img className="visual-big" src={clipUrl(visual.clip)} alt={clipById(visual.clip)?.about ?? ''} /> : <BlockPicture json={visual.json} scale={0.9} />}
        </div>
        <div className="modal-foot"><button className="btn aqua" onClick={onClose}>Close</button></div>
      </div>
    </div>, document.body,
  );
}

function usePlan(planId?: string) {
  return useApp((s) => { const p = s.plans[s.taskId]; return p && (!planId || p.id === planId) ? p : null; });
}

export function PlanCard({ planId }: { planId: string }) {
  const plan = usePlan(planId);
  const taskId = useApp((s) => s.taskId);
  if (!plan) return <div className="plan-card old"><Icon.list width={13} height={13} /> An earlier plan (replaced)</div>;
  const done = plan.steps.filter((s) => s.done).length;
  return (
    <div className="plan-card" role="group" aria-label={`Plan: ${plan.title}`}>
      <div className="plan-head"><Icon.list width={14} height={14} /> <b>{plan.title}</b><span className="spacer" /><span className="chip leaf" style={{ height: 20, fontSize: 11 }}>{done}/{plan.steps.length}</span></div>
      <div className="plan-bar"><i style={{ width: `${(done / plan.steps.length) * 100}%` }} /></div>
      <ol className="plan-steps">
        {plan.steps.map((s, i) => {
          const next = !s.done && plan.steps.slice(0, i).every((x) => x.done);
          return (
            <li key={i} className={`${s.done ? 'done' : ''} ${next ? 'next' : ''}`}>
              <button className="plan-check" role="checkbox" aria-checked={s.done} aria-label={s.text}
                title={s.check && !s.done ? 'Ticks itself when you do this — or tick it yourself' : s.done ? 'Done' : 'Tick when done'}
                onClick={() => setPlanStep(taskId, i, !s.done, 'user')}>{s.done ? <Icon.check width={11} height={11} /> : i + 1}</button>
              <span>{s.text}</span>
              {s.check && !s.done && <span className="auto" title="Ticks itself">auto</span>}
            </li>
          );
        })}
      </ol>
      {done === plan.steps.length && <div className="plan-done"><Icon.sparkle width={13} height={13} /> Plan complete!</div>}
    </div>
  );
}

/** Thin bar pinned to the top of the chat: the current plan's next step. */
export function PlanPin() {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  const done = plan.steps.filter((s) => s.done).length;
  const next = plan.steps.find((s) => !s.done);
  return (
    <div className={`plan-pin ${open ? 'open' : ''}`}>
      <button className="plan-pin-bar" onClick={() => { setOpen(!open); logEvent('panel_toggle', { planPin: !open ? 'open' : 'closed' }); }} aria-expanded={open}>
        <span className="ring" style={{ ['--p' as string]: `${(done / plan.steps.length) * 360}deg` }} />
        <span className="plan-pin-text">{next ? <><b>Next:</b> {next.text}</> : <b>Plan complete</b>}</span>
        <span className="muted">{done}/{plan.steps.length}</span>
        <Icon.down width={12} height={12} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && <PlanCard planId={plan.id} />}
    </div>
  );
}
