/// <reference lib="webworker" />
import { SimCore, type RobotSetup } from '../sim/SimCore';
import type { PredicateDef, SceneDef, SimState } from '../sim/types';
import { runHeadless, type ProgramSource } from './headless';

declare const self: DedicatedWorkerGlobalScope;
export interface DryRunRequest { scene: SceneDef; robots: RobotSetup[]; state: SimState; src: ProgramSource; predicates: PredicateDef[]; maxSimTimeSec: number; seed: number; recordEvery?: number }

self.onmessage = async (e: MessageEvent<DryRunRequest>) => {
  const r = e.data;
  const sim = new SimCore(r.scene, r.robots, { seed: r.seed, state: r.state });
  const trace = await runHeadless(sim, r.src, { source: 'dryrun', predicates: r.predicates, maxSimTimeSec: r.maxSimTimeSec, seed: r.seed, maxEntries: 300, recordEvery: r.recordEvery });
  self.postMessage(trace);
};
