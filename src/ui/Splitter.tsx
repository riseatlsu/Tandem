import { useEffect, useRef, useState } from 'react';
import { logEvent } from '../study/logger';

const KEY = 'tandem.pendantWidth';
const MIN_PENDANT = 400;
const MIN_CELL = 360;
const defaultWidth = () => Math.round(Math.min(600, Math.max(430, innerWidth * 0.37)));
function load(): number | null {
  try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
function save(v: number | null) { try { if (v == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(Math.round(v))); } catch { /* storage unavailable */ } }

/**
 * Drag bar between the cell view and the pendant. Sets --pendant-w on the stage grid.
 * Drag, use ←/→ (Shift for bigger steps), or double-click to reset.
 */
export function Splitter({ stage }: { stage: React.RefObject<HTMLElement | null> }) {
  const [w, setW] = useState<number>(() => load() ?? defaultWidth());
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);

  const clamp = (v: number) => {
    const total = stage.current?.clientWidth ?? innerWidth;
    return Math.round(Math.max(MIN_PENDANT, Math.min(total - MIN_CELL - 18, v)));
  };
  useEffect(() => { stage.current?.style.setProperty('--pendant-w', `${clamp(w)}px`); });
  useEffect(() => {
    const fit = () => setW((v) => clamp(v));
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);

  const commit = (v: number) => { save(v); logEvent('panel_toggle', { split: Math.round(v) }); };
  const total = stage.current?.clientWidth ?? innerWidth;
  return (
    <div className={`splitter ${dragging ? 'dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize cell view and pendant"
      aria-valuemin={MIN_PENDANT} aria-valuemax={Math.max(MIN_PENDANT, total - MIN_CELL)} aria-valuenow={w} tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); start.current = { x: e.clientX, w }; setDragging(true); document.body.classList.add('resizing'); }}
      onPointerMove={(e) => { if (start.current) setW(clamp(start.current.w - (e.clientX - start.current.x))); }}
      onPointerUp={() => { if (!start.current) return; start.current = null; setDragging(false); document.body.classList.remove('resizing'); commit(w); }}
      onDoubleClick={() => { const d = defaultWidth(); setW(clamp(d)); save(null); }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20;
        if (e.key === 'ArrowLeft') { e.preventDefault(); const v = clamp(w + step); setW(v); commit(v); }
        if (e.key === 'ArrowRight') { e.preventDefault(); const v = clamp(w - step); setW(v); commit(v); }
      }}>
      <span className="grip"><i /><i /><i /></span>
    </div>
  );
}
