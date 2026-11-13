/** Deterministic PRNG (mulberry32) with the distributions the simulation needs. */
export class SeededRandom {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }

  /** Standard normal (Box–Muller, with the second variate cached). */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Normal truncated to [min, max] by resampling (bounded retries, then clamped). */
  truncatedNormal(mean: number, sd: number, min: number, max: number): number {
    for (let i = 0; i < 16; i++) {
      const x = mean + sd * this.normal();
      if (x >= min && x <= max) return x;
    }
    return Math.min(max, Math.max(min, mean));
  }

  /** Lognormal parameterised by its median and sigma of the underlying normal. */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }
}

/** Independent, reproducible stream per run: SplitMix-style mixing of (master, index). */
export function deriveSeed(master: number, index: number): number {
  let z = (master >>> 0) + Math.imul(index + 1, 0x9e3779b9);
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}
