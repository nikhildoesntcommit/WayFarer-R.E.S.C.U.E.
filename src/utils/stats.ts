import { MONTE_CARLO } from '../constants';
import { SeededRandom } from './seeds';

/** Percentile with linear interpolation. `sorted` must be ascending. q in [0,100]. */
export function percentileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const pos = (Math.min(100, Math.max(0, q)) / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const f = pos - lo;
  return sorted[lo]! * (1 - f) + sorted[hi]! * f;
}

export function mean(a: ArrayLike<number>): number {
  if (a.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s / a.length;
}

/** Sample standard deviation (n-1). */
export function stdDev(a: ArrayLike<number>): number {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i]! - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

export interface BootstrapCI {
  p50Lower: number;
  p50Upper: number;
  p95Lower: number;
  p95Upper: number;
}

/** Percentile bootstrap (default 1000 resamples) for P50 and P95. */
export function bootstrapPercentileCI(
  values: ArrayLike<number>,
  seed: number,
  iterations: number = MONTE_CARLO.bootstrapIterations,
): BootstrapCI {
  const n = values.length;
  if (n === 0) return { p50Lower: NaN, p50Upper: NaN, p95Lower: NaN, p95Upper: NaN };
  const rng = new SeededRandom(seed);
  const p50s = new Float64Array(iterations);
  const p95s = new Float64Array(iterations);
  const buf = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) buf[i] = values[rng.int(n)]!;
    buf.sort();
    p50s[it] = percentileSorted(buf, 50);
    p95s[it] = percentileSorted(buf, 95);
  }
  p50s.sort();
  p95s.sort();
  return {
    p50Lower: percentileSorted(p50s, 2.5),
    p50Upper: percentileSorted(p50s, 97.5),
    p95Lower: percentileSorted(p95s, 2.5),
    p95Upper: percentileSorted(p95s, 97.5),
  };
}
