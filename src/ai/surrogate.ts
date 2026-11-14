import weights from './surrogate-weights.json';
import type { Plan } from '../types';
import { planFeatures } from './surrogateFeatures';

/**
 * The estimator: a small neural network (11 inputs → 32 → 32 → 3) trained on thousands of rooms that were each run through
 * this app's own simulator. It answers in milliseconds what the 200-trial simulation answers in seconds, so the marking
 * screen can show an instant estimate and the results can be cross-checked. It learns the SIMULATOR, not reality: it is
 * as good as the simulator and no better. Outside the range of rooms it was trained on it says so instead of guessing.
 */
interface Layer { W: number[][]; b: number[] }
const W = weights as unknown as {
  mean: number[]; std: number[]; outMean: number[]; outStd: number[]; layers: Layer[]; lo: number[]; hi: number[]; band80Log: number[] | number;
  n_train: number; n_test: number; metrics: { mlp: { p95_mape_pct: number; p95_within_20pct: number; p95_r2_log: number } };
};

export interface Estimate {
  /** typical (median) time for the last person to get out */
  p50: number;
  /** time within which the last person is out in 95 % of trials */
  p95: number;
  /** 80 % of the time the true P95 lies inside this band (from held-out rooms) */
  p95Low: number;
  p95High: number;
  /** share of people not out in time (lost or still inside), 0–1 */
  lostShare: number;
  /** the plan is outside the range of rooms the model was trained on: do not trust the figures */
  outOfRange: string[];
}

export const estimatorInfo = {
  trainedOn: W.n_train,
  heldOut: W.n_test,
  p95WithinTwentyPercent: W.metrics.mlp.p95_within_20pct,
  p95MeanErrorPercent: W.metrics.mlp.p95_mape_pct,
};

const relu = (x: number) => (x > 0 ? x : 0);

export function predictFromFeatures(f: number[]): Estimate {
  let a = f.map((v, i) => (v - W.mean[i]!) / W.std[i]!);
  W.layers.forEach((L, li) => {
    const next = L.b.map((b, j) => {
      let s = b;
      for (let i = 0; i < a.length; i++) s += a[i]! * L.W[j]![i]!;
      return li < W.layers.length - 1 ? relu(s) : s;
    });
    a = next;
  });
  const y = a.map((v, i) => v * W.outStd[i]! + W.outMean[i]!);
  const band = typeof W.band80Log === 'number' ? W.band80Log : W.band80Log[0]!;
  const p95 = Math.exp(y[0]!);
  const names = ['people', 'mean walk time', 'far walk time', 'exit capacity', 'clearing time', 'exits', 'alarm delay', 'fire', 'fire-to-exit distance', 'fire-to-people distance', 'vulnerable share'];
  const outOfRange = f.flatMap((v, i) => (v < W.lo[i]! - 1e-9 || v > W.hi[i]! + 1e-9 ? [names[i]!] : []));
  return {
    p50: Math.exp(y[1]!), p95, p95Low: p95 * Math.exp(-band), p95High: p95 * Math.exp(band),
    lostShare: Math.min(1, Math.max(0, y[2]!) ** 2), outOfRange,
  };
}

/** Instant estimate for a plan, or null when the plan cannot be analysed yet (no exit, nobody marked). */
export function estimatePlan(plan: Plan): Estimate | null {
  const f = planFeatures(plan);
  return f ? predictFromFeatures(f) : null;
}
