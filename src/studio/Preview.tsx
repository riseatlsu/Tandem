/** Live 3D preview for Tandem Studio: renders a draft scene with a draft/real arm, supports picking and a move gizmo. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Scene3D } from '../view/Scene3D';
import { SimCore } from '../sim/SimCore';
import { robotsFor } from '../content';
import { splitLanes } from '../runtime/headless';
import type { ArmDef, PredicateDef, SceneDef, Target } from '../sim/types';
import { runHeadless } from '../runtime/headless';
import type { RunTrace } from '../runtime/protocol';

export interface PreviewHandle {
  /** Run a program on a fresh copy of the scene in real time (×speed). Resolves with the trace. */
  play(src: string, predicates: PredicateDef[], seed: number, speed?: number): Promise<RunTrace | null>;
  stop(): void;
  setJoints(q: number[]): void;
  camera(): { position: [number, number, number]; target: [number, number, number] } | null;
}
interface Props {
  scene: SceneDef | null; arm: ArmDef | null; seed?: number; targets?: Record<string, Target>;
  selected?: string | null; selectedPos?: [number, number, number] | null;
  onPick?(id: string | null): void; onMove?(posMm: [number, number, number]): void;
  onError?(msg: string | null): void;
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ scene, arm, seed = 1, targets, selected, selectedPos, onPick, onMove, onError }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const s3 = useRef<Scene3D | null>(null);
  const sim = useRef<SimCore | null>(null);
  const playing = useRef(0);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef({ onPick, onMove }); cb.current = { onPick, onMove };

  useEffect(() => {
    const v = new Scene3D(host.current!, { onGuide: () => false, onGuideStart() {}, onGuideEnd() {}, onCameraMove() {} }, () => sim.current);
    s3.current = v;
    let down: { x: number; y: number } | null = null;
    const el = v.renderer.domElement;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || v.editDragging) { down = null; return; }
      down = null;
      cb.current.onPick?.(v.pick(e.clientX, e.clientY));
    };
    el.addEventListener('pointerdown', pd); el.addEventListener('pointerup', pu);
    return () => { el.removeEventListener('pointerdown', pd); el.removeEventListener('pointerup', pu); v.dispose(); };
  }, []);

  // rebuild the sim whenever the draft changes
  const key = JSON.stringify([scene, arm, seed, targets]);
  useEffect(() => {
    playing.current++;
    if (!scene || !arm) { sim.current = null; return; }
    try {
      const sc = structuredClone(scene);
      const s = new SimCore(sc, robotsFor(sc, arm.id), { seed });
      if (targets) s.setTargets(targets);
      sim.current = s;
      s3.current?.invalidate();
      setErr(null); onError?.(null);
    } catch (e) { const m = (e as Error).message; setErr(m); onError?.(m); }
  }, [key]);  

  useEffect(() => { s3.current?.setEditTarget(selected ?? null, selectedPos ?? null, (p) => cb.current.onMove?.(p)); }, [selected, selectedPos?.join(',')]);  

  useImperativeHandle(ref, () => ({
    async play(src, predicates, sd, speed = 1.5) {
      if (!scene || !arm) return null;
      const token = ++playing.current;
      const sc = structuredClone(scene);
      const run = new SimCore(sc, robotsFor(sc, arm.id), { seed: sd });
      if (targets) run.setTargets(targets);
      sim.current = run;
      const wall = performance.now();
      let lastYield = wall;
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      try {
        const trace = await runHeadless(run, splitLanes(src), {
          predicates, seed: sd, maxSimTimeSec: 600,
          onStep: async (sm) => {
            while (token === playing.current && sm.simTime > ((performance.now() - wall) / 1000) * speed) { await frame(); lastYield = performance.now(); }
            if (performance.now() - lastYield > 12) { await frame(); lastYield = performance.now(); }
            if (token !== playing.current) throw new Error('stopped');
          },
        });
        return token === playing.current ? trace : null; // stopped or superseded: not a real result
      } catch { return null; }
    },
    stop() { playing.current++; },
    setJoints(q) { if (sim.current) sim.current.rs().q = q.slice(); },
    camera() {
      const v = s3.current; if (!v) return null;
      const r = (x: number) => Math.round(x * 1000);
      return { position: v.camera.position.toArray().map(r) as [number, number, number], target: v.controls.target.toArray().map(r) as [number, number, number] };
    },
  }));

  return (
    <div className="st-preview">
      <div ref={host} className="st-canvas" />
      {err && <div className="st-preview-err">Preview error: {err}</div>}
    </div>
  );
});
