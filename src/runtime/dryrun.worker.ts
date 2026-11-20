/// <reference lib="webworker" />
import { SimCore } from '../sim/SimCore';
import type { ArmDef, PredicateDef, SceneDef, SimState } from '../sim/types';
import { runHeadless } from './headless';

declare const self: DedicatedWorkerGlobalScope;
export interface DryRunRequest { scene: SceneDef; arm: ArmDef; state: SimState; src: string; predicates: PredicateDef[]; maxSimTimeSec: number; seed: number }

self.onmessage = async (e: MessageEvent<DryRunRequest>) => {
  const r = e.data;
  const sim = new SimCore(r.scene, r.arm, { seed: r.seed, state: r.state });
  const trace = await runHeadless(sim, r.src, { source: 'dryrun', predicates: r.predicates, maxSimTimeSec: r.maxSimTimeSec, seed: r.seed, maxEntries: 300 });
  self.postMessage(trace);
};
