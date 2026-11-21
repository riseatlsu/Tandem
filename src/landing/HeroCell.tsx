/** Landing hero: the real simulator replaying reference solutions in real time, looping through a few cells. */
import { useEffect, useRef } from 'react';
import { Scene3D } from '../view/Scene3D';
import { SimCore } from '../sim/SimCore';
import { ARMS, TASKS, sceneForTask } from '../content';
import { runHeadless } from '../runtime/headless';
import binThree from '../../tests/fixtures/solutions/factory-bin-three.js?raw';
import sortColors from '../../tests/fixtures/solutions/sort-colors.js?raw';
import pourDrink from '../../tests/fixtures/solutions/kitchen-pour.js?raw';

const SHOWS = [
  { task: 'factory-bin-three', src: binThree },
  { task: 'sort-colors', src: sortColors },
  { task: 'kitchen-pour', src: pourDrink },
];
const SPEED = 1.5;

export function HeroCell({ onScene }: { onScene?: (title: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let sim: SimCore | null = null;
    let stopped = false;
    const s3 = new Scene3D(ref.current!, { onGuide: () => false, onGuideStart() {}, onGuideEnd() {}, onCameraMove() {} }, () => sim);
    s3.setShowcase();
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    (async () => {
      for (let k = 0; !stopped; k++) {
        const show = SHOWS[k % SHOWS.length];
        const task = TASKS[show.task];
        const run = new SimCore(sceneForTask(task), ARMS[task.armId], { seed: task.seed + k });
        sim = run;
        onScene?.(run.scene.title);
        let wall = performance.now(), simT = 0, lastYield = performance.now();
        await runHeadless(run, show.src, {
          maxSimTimeSec: 240,
          onStep: async (sm) => {
            // pace simulated time to the wall clock (and hold still while the hero is off screen)
            const now = performance.now();
            if ((now - wall) / 1000 * SPEED - (sm.simTime - simT) > 0.25) { wall = now; simT = sm.simTime; } // slow machine: drop the backlog, don't fast-forward
            while (!stopped && (sm.simTime - simT) > ((performance.now() - wall) / 1000) * SPEED) {
              await frame(); lastYield = performance.now();
              if (s3.paused) { wall = performance.now(); simT = sm.simTime; }
            }
            if (performance.now() - lastYield > 12) { await frame(); lastYield = performance.now(); } // always let the page breathe
            if (stopped) throw new Error('stopped');
          },
        }).catch(() => undefined);
        const pause = performance.now();
        while (!stopped && performance.now() - pause < 1500) await frame();
      }
    })();
    const io = new IntersectionObserver(([e]) => { s3.paused = !e.isIntersecting; }, { threshold: 0.05 });
    io.observe(ref.current!);
    return () => { stopped = true; io.disconnect(); s3.dispose(); };
  }, []);  
  return <div className="hero-cell" ref={ref} aria-label="Live simulation of a robot arm at work" role="img" />;
}
