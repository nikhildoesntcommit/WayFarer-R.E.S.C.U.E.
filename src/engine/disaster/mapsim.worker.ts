/// <reference lib="webworker" />
import { runMapMonteCarlo, MapSimError } from './evacuation';
import type { MapSimInput } from './roadGraph';

export interface MapWorkerRequest {
  input: MapSimInput;
  runs: number;
  masterSeed: number;
}

self.onmessage = (e: MessageEvent<MapWorkerRequest>) => {
  try {
    const { input, runs, masterSeed } = e.data;
    const result = runMapMonteCarlo(input, runs, masterSeed, (p) => self.postMessage({ type: 'progress', ...p }));
    self.postMessage({ type: 'result', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err), known: err instanceof MapSimError });
  }
};
