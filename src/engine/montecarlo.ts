import type { Plan, SimulationResult } from '../types';
import type { TraceFrame } from './agents';
import { InvalidDoorError } from './doors';
import { runMonteCarloSync, type ProgressInfo } from './pipeline';

export interface MonteCarloOutput {
  result: SimulationResult;
  trace?: TraceFrame[];
}

export class SimulationError extends Error {
  doorId?: string;
  widthM?: number;
}

export interface MonteCarloHandle {
  promise: Promise<MonteCarloOutput>;
  cancel: () => void;
}

/**
 * Main-thread API (spec §6.6). Runs in a Web Worker so the UI stays responsive; if workers are unavailable the same
 * pipeline runs inline (slower, but identical numbers).
 */
export function startMonteCarlo(
  plan: Plan,
  runs: number,
  masterSeed: number,
  onProgress?: (p: ProgressInfo) => void,
  onTrace?: (t: TraceFrame[]) => void,
): MonteCarloHandle {
  let worker: Worker | null = null;
  let rejectFn: ((e: Error) => void) | null = null;
  const promise = new Promise<MonteCarloOutput>((resolve, reject) => {
    rejectFn = reject;
    if (typeof Worker === 'undefined') {
      try {
        const { result, trace } = runMonteCarloSync(plan, runs, masterSeed, onProgress, {}, onTrace);
        resolve({ result, trace });
      } catch (e) {
        reject(e instanceof InvalidDoorError ? Object.assign(new SimulationError(e.message), { doorId: e.doorId, widthM: e.widthM }) : (e as Error));
      }
      return;
    }
    worker = new Worker(new URL('./montecarlo.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string } & Record<string, unknown>;
      if (m.type === 'progress') onProgress?.(m as unknown as ProgressInfo);
      else if (m.type === 'trace') onTrace?.(m.trace as TraceFrame[]);
      else if (m.type === 'result') {
        resolve({ result: m.result as SimulationResult });
        worker?.terminate();
      } else if (m.type === 'error') {
        reject(Object.assign(new SimulationError(String(m.message)), { doorId: m.doorId as string | undefined, widthM: m.widthM as number | undefined }));
        worker?.terminate();
      }
    };
    worker.onerror = (ev) => {
      reject(new SimulationError(ev.message || 'The simulation worker failed.'));
      worker?.terminate();
    };
    worker.postMessage({ plan, runs, masterSeed });
  });
  return {
    promise,
    cancel: () => {
      worker?.terminate();
      rejectFn?.(new SimulationError('Cancelled'));
    },
  };
}

export async function runMonteCarlo(plan: Plan, runs: number, masterSeed: number, onProgress?: (p: ProgressInfo) => void): Promise<SimulationResult> {
  return (await startMonteCarlo(plan, runs, masterSeed, onProgress).promise).result;
}
