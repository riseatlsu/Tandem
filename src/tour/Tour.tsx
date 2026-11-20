/**
 * Guided tour overlay: a spotlight on the element being explained, a floating arrow, and a glass card
 * with text and (sometimes) a GIF. Required before the first study task (no skip, untimed); optional in the demo.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../store';
import { TOUR, type TourCtx, type TourStep } from './steps';
import { agentFeatures, agentMode } from '../agent/controller';
import { clipById, clipUrl } from '../agent/clips';
import { logEvent } from '../study/logger';
import { host } from '../simHost';
import { saveCheckpoint } from '../study/session';
import { Icon } from '../ui/icons';

export function startTour() {
  const st = useApp.getState();
  if (st.tour) return;
  st.set({ tour: { step: 0, required: false } });
}

let startedAt = 0;
export function endTour(completed: boolean) {
  const st = useApp.getState();
  const t = st.tour;
  if (!t) return;
  st.set({ tour: null, tourDone: true, pendantScreen: 'home', handGuide: false });
  logEvent('tour_end', { completed, required: t.required, lastStep: t.step, durationMs: Date.now() - startedAt });
  if (t.required && st.mode === 'study') {
    // The tour ran on the first task's cell: give the participant a fresh start and a full timer.
    const taskId = st.taskId;
    st.set((s) => {
      const { [taskId]: _w, ...workspaces } = s.workspaces;
      const { [taskId]: _p, ...plans } = s.plans;
      void _w; void _p;
      return { workspaces, plans, chats: { ...s.chats, [taskId]: [] } };
    });
    host.loadTask(taskId);
    void saveCheckpoint(true);
  }
}

function ctxNow(): TourCtx {
  const s = useApp.getState();
  return { mode: s.mode, agentMode: agentMode(), features: agentFeatures(), editor: s.workspaces[s.taskId]?.editor ?? 'blocks', screen: s.pendantScreen };
}

type Rect = { left: number; top: number; width: number; height: number };
const PAD = 8;

export function TourOverlay() {
  const tour = useApp((s) => s.tour);
  const screen = useApp((s) => s.pendantScreen);
  const editor = useApp((s) => s.workspaces[s.taskId]?.editor);
  const steps = useMemo(() => { const c = ctxNow(); return TOUR.filter((s) => !s.when || s.when(c)); }, [tour?.required]);  
  const index = Math.min(tour?.step ?? 0, steps.length - 1);
  const step: TourStep | undefined = tour ? steps[index] : undefined;
  const ctx = useMemo(ctxNow, [screen, editor, tour]);  
  const [rect, setRect] = useState<Rect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });

  // begin / step changes
  useEffect(() => {
    if (!tour) return;
    if (tour.step === 0) { startedAt = Date.now(); logEvent('tour_start', { required: tour.required }); useApp.getState().set({ agentOpen: false, handGuide: false }); }
  }, [tour?.required, tour !== null]);  
  useEffect(() => {
    if (!step) return;
    logEvent('tour_step', { id: step.id, index });
    if (step.screen && useApp.getState().pendantScreen !== step.screen) useApp.getState().set({ pendantScreen: step.screen });
  }, [step?.id]);  

  // auto-advance once a waiting step's action happened
  const waiting = !!step?.waitFor && !step.waitFor(ctx);
  useEffect(() => {
    if (step?.waitFor && step.waitFor(ctx)) { const t = setTimeout(() => next(), 450); return () => clearTimeout(t); }
  }, [ctx, step?.id]);  

  // follow the target element
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect((p) => (p && Math.abs(p.left - r.left) < 0.5 && Math.abs(p.top - r.top) < 0.5 && Math.abs(p.width - r.width) < 0.5 && Math.abs(p.height - r.height) < 0.5 ? p : { left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    measure();
    const id = setInterval(measure, 120);
    addEventListener('resize', measure);
    return () => { clearInterval(id); removeEventListener('resize', measure); };
  }, [step?.id, step?.target]);  
  useLayoutEffect(() => { if (card.current) setCardSize({ w: card.current.offsetWidth, h: card.current.offsetHeight }); }, [step?.id, rect !== null]);

  useEffect(() => {
    if (!tour) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, .monaco-editor')) return;
      if (e.key === 'Escape' && !tour.required) endTour(false);
      if ((e.key === 'ArrowRight' || e.key === 'Enter') && !waiting) next();
      if (e.key === 'ArrowLeft') back();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  if (!tour || !step) return null;
  function next() {
    const t = useApp.getState().tour;
    if (!t) return;
    if (t.step >= steps.length - 1) endTour(true);
    else useApp.getState().set({ tour: { ...t, step: t.step + 1 } });
  }
  function back() {
    const t = useApp.getState().tour;
    if (t && t.step > 0) useApp.getState().set({ tour: { ...t, step: t.step - 1 } });
  }

  // card + arrow placement
  const vw = innerWidth, vh = innerHeight, gap = 30;
  let left = vw / 2 - cardSize.w / 2, top = vh / 2 - cardSize.h / 2;
  let arrow: { x: number; y: number; dir: 'left' | 'right' | 'up' | 'down' } | null = null;
  if (rect) {
    const order: Record<string, ('left' | 'right' | 'top' | 'bottom')[]> = { left: ['left', 'right', 'top', 'bottom'], right: ['right', 'left', 'bottom', 'top'], top: ['top', 'bottom', 'left', 'right'], bottom: ['bottom', 'top', 'left', 'right'] };
    const fits = (p: string) => p === 'left' ? rect.left - gap - cardSize.w > 8 : p === 'right' ? rect.left + rect.width + gap + cardSize.w < vw - 8 : p === 'top' ? rect.top - gap - cardSize.h > 8 : rect.top + rect.height + gap + cardSize.h < vh - 8;
    const place = order[step.place ?? 'bottom'].find(fits);
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    if (place === 'left') { left = rect.left - gap - cardSize.w; top = cy - cardSize.h / 2; arrow = { x: rect.left - PAD - 26, y: cy, dir: 'right' }; }
    else if (place === 'right') { left = rect.left + rect.width + gap; top = cy - cardSize.h / 2; arrow = { x: rect.left + rect.width + PAD + 26, y: cy, dir: 'left' }; }
    else if (place === 'top') { left = cx - cardSize.w / 2; top = rect.top - gap - cardSize.h; arrow = { x: cx, y: rect.top - PAD - 24, dir: 'down' }; }
    else if (place === 'bottom') { left = cx - cardSize.w / 2; top = rect.top + rect.height + gap; arrow = { x: cx, y: rect.top + rect.height + PAD + 24, dir: 'up' }; }
    // big targets (the whole cell or pendant): put the card inside, near the edge
    else { left = cx - cardSize.w / 2; top = rect.top + rect.height - cardSize.h - 24; }
    left = Math.max(12, Math.min(vw - cardSize.w - 12, left));
    top = Math.max(12, Math.min(vh - cardSize.h - 12, top));
  }
  const clip = step.clip?.(ctx);
  const last = index === steps.length - 1;

  return createPortal(
    <div className="tour" role="dialog" aria-modal="false" aria-label={`Tour step ${index + 1} of ${steps.length}: ${step.title}`}>
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
      ) : <div className="tour-dim" />}
      {arrow && (
        <div className={`tour-arrow ${arrow.dir}`} style={{ left: arrow.x, top: arrow.y }} aria-hidden>
          <svg viewBox="0 0 48 48" width="44" height="44"><defs><linearGradient id="ta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9ff0ff" /><stop offset=".5" stopColor="#2d9bf0" /><stop offset="1" stopColor="#0b5fc4" /></linearGradient></defs>
            <path d="M24 44 L6 24 H16 V4 H32 V24 H42 Z" fill="url(#ta)" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" /><path d="M18 8 H30 V20" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2" strokeLinecap="round" /></svg>
        </div>
      )}
      <div ref={card} className={`glass tour-card ${clip ? 'has-clip' : ''}`} style={{ left, top }}>
        <div className="tour-top">
          <span className="tour-count">{index + 1} / {steps.length}</span>
          <span className="tour-dots">{steps.map((s, i) => <i key={s.id} className={i < index ? 'done' : i === index ? 'cur' : ''} />)}</span>
          {!tour.required && <button className="icon-btn" aria-label="Close tour" title="Close tour" onClick={() => endTour(false)}><Icon.x width={13} height={13} /></button>}
        </div>
        <h3>{step.title}</h3>
        <p>{step.body(ctx)}</p>
        {clip && <figure className="tour-clip"><img src={clipUrl(clip)} alt={clipById(clip)?.about ?? ''} /></figure>}
        {waiting && <div className="tour-wait"><span className="ghost-dot" /> {step.waitHint}</div>}
        <div className="tour-foot">
          {!tour.required && index < steps.length - 1 && <button className="btn sm ghost" onClick={() => endTour(false)}>Skip tour</button>}
          <span className="grow" />
          {index > 0 && <button className="btn sm" onClick={back}><Icon.back width={12} height={12} /> Back</button>}
          <button className="btn sm aqua" disabled={waiting} onClick={next}>{last ? (useApp.getState().mode === 'study' ? 'Start the first task' : 'Finish') : index === 0 ? 'Start the tour' : 'Next'}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
