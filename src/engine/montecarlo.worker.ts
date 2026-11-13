/// <reference lib="webworker" />
import { InvalidDoorError } from './doors';
import { runMonteCarloSync } from './pipeline';
import type { Plan } from '../types';

export interface WorkerRequest {
  plan: Plan;
  runs: number;
  masterSeed: number;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { plan, runs, masterSeed } = e.data;
  try {
    const { result } = runMonteCarloSync(
      plan,
      runs,
      masterSeed,
      (p) => self.postMessage({ type: 'progress', ...p }),
      {},
      // the preview run is posted as soon as run 0 is done, so the animation can start while the other runs go on
      (trace) => self.postMessage({ type: 'trace', trace }),
    );
    const transfer: Transferable[] = [result.densityHeatmap.buffer, result.completionTimes.buffer, result.exitTimes.buffer];
    self.postMessage({ type: 'result', result }, transfer);
  } catch (err) {
    if (err instanceof InvalidDoorError) {
      self.postMessage({ type: 'error', message: err.message, doorId: err.doorId, widthM: err.widthM });
    } else {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
