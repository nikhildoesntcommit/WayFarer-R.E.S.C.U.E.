import type { SimulationResult } from '../../types';
import type { ProgressInfo } from '../pipeline';
import { runMapMonteCarlo } from './evacuation';
import type { MapSimInput } from './roadGraph';

export interface MapSimHandle {
  promise: Promise<SimulationResult>;
  cancel: () => void;
}

/** Main-thread entry for Path C: worker when available, inline otherwise (identical numbers). */
export function startMapSimulation(input: MapSimInput, runs: number, masterSeed: number, onProgress?: (p: ProgressInfo) => void): MapSimHandle {
  let worker: Worker | null = null;
  let rejectFn: ((e: Error) => void) | null = null;
  const promise = new Promise<SimulationResult>((resolve, reject) => {
    rejectFn = reject;
    if (typeof Worker === 'undefined') {
      try {
        resolve(runMapMonteCarlo(input, runs, masterSeed, onProgress));
      } catch (e) {
        reject(e as Error);
      }
      return;
    }
    worker = new Worker(new URL('./mapsim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; result?: SimulationResult; message?: string } & Partial<ProgressInfo>;
      if (m.type === 'progress') onProgress?.(m as ProgressInfo);
      else if (m.type === 'result') {
        resolve(m.result!);
        worker?.terminate();
      } else if (m.type === 'error') {
        reject(new Error(m.message));
        worker?.terminate();
      }
    };
    worker.onerror = (ev) => {
      reject(new Error(ev.message || 'The map simulation worker failed.'));
      worker?.terminate();
    };
    worker.postMessage({ input, runs, masterSeed });
  });
  return {
    promise,
    cancel: () => {
      worker?.terminate();
      rejectFn?.(new Error('Cancelled'));
    },
  };
}
