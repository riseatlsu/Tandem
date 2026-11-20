import type { SimCore } from '../sim/SimCore';
import type { PredicateDef } from '../sim/types';
import { hashString, type RunTrace } from './protocol';
import type { DryRunRequest } from './dryrun.worker';

/** Run a candidate program on a headless clone in a worker. The live scene is untouched. */
export function dryRun(sim: SimCore, src: string, predicates: PredicateDef[], opts: { maxSimTimeSec?: number; seed?: number; wallMs?: number } = {}): Promise<RunTrace> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./dryrun.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({
        runId: `dry-${Date.now().toString(36)}`, source: 'dryrun', programHash: hashString(src), seed: opts.seed ?? 0, entries: [], logs: [],
        outcome: 'timeout', fault: { code: 'RUNAWAY', message: 'The dry run did not finish within 5 s of real time (infinite loop?).' }, predicates: [], simDurationSec: 0,
      });
    }, opts.wallMs ?? 5000);
    w.onmessage = (e: MessageEvent<RunTrace>) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    const req: DryRunRequest = { scene: sim.scene, arm: sim.arm, state: sim.snapshot(), src, predicates, maxSimTimeSec: opts.maxSimTimeSec ?? 600, seed: opts.seed ?? 0 };
    w.postMessage(req);
  });
}
