import { MONTE_CARLO, SIM } from '../constants';
import type { Cell, SimulationResult } from '../types';
import { bootstrapPercentileCI, mean, percentileSorted, stdDev } from '../utils/stats';
import { deriveSeed, SeededRandom } from '../utils/seeds';
import { buildSimContext, sampleAgents, simulateRun, type RunResult, type SimContext, type SimOptions, type TraceFrame } from './agents';

export interface ProgressInfo {
  completed: number;
  total: number;
  p50: number;
  p95: number;
}

export interface PipelineOutput {
  result: SimulationResult;
  ctx: SimContext;
  trace?: TraceFrame[];
}

/** Aggregate per-run outputs into the specification's SimulationResult (§6.6). */
export function aggregateResults(ctx: SimContext, runsOut: RunResult[], masterSeed: number): SimulationResult {
  const runs = runsOut.length;
  const { grid } = ctx;
  const E = ctx.exitIds.length;

  const exitTimesArr: number[] = [];
  let total = 0;
  for (const r of runsOut) total += r.evacuationTimes.length;
  const completion = new Float32Array(total);
  let k = 0;
  let evacuated = 0;
  let casualties = 0;
  let remaining = 0;
  let conservation = true;
  for (const r of runsOut) {
    for (const t of r.evacuationTimes) completion[k++] = t;
    if (r.evacuationTimes.length > 0) exitTimesArr.push(r.lastCompletion);
    evacuated += r.evacuationTimes.length;
    casualties += r.casualties;
    remaining += r.remaining;
    if (!r.conservationOk) conservation = false;
  }
  if (evacuated + casualties + remaining !== runs * ctx.totalPeople) conservation = false;
  completion.sort();
  const exitTimes = Float32Array.from(exitTimesArr);
  const sortedExit = Float64Array.from(exitTimesArr).sort();
  const ci = bootstrapPercentileCI(sortedExit, masterSeed ^ 0x9e3779b9, MONTE_CARLO.bootstrapIterations);

  const exitLoads: Record<string, number> = {};
  const exitUtilisation: Record<string, number> = {};
  const exitQueueTimes: Record<string, number> = {};
  const exitQueueMaxTimes: Record<string, number> = {};
  ctx.exitIds.forEach((id, e) => {
    let load = 0, waitSum = 0, cnt = 0, mx = 0;
    for (const r of runsOut) {
      load += r.exitLoads.get(id) ?? 0;
      waitSum += r.queueWaitSum[e]!;
      cnt += r.queueCount[e]!;
      mx += r.queueMax[e]!;
    }
    exitLoads[id] = load / runs;
    exitUtilisation[id] = ctx.totalPeople > 0 ? load / runs / ctx.totalPeople : 0;
    exitQueueTimes[id] = cnt > 0 ? waitSum / cnt : 0;
    exitQueueMaxTimes[id] = mx / runs;
  });

  const cells = grid.rows * grid.cols;
  const heat = new Float32Array(cells);
  const critMean = new Float32Array(cells);
  for (const r of runsOut) {
    for (let i = 0; i < cells; i++) {
      heat[i] = heat[i]! + r.densityAccum[i]! / runs;
      critMean[i] = critMean[i]! + r.critSeconds[i]! / runs;
    }
  }
  let peakI = 0;
  let critI = 0;
  for (let i = 1; i < cells; i++) {
    if (heat[i]! > heat[peakI]!) peakI = i;
    if (critMean[i]! > critMean[critI]!) critI = i;
  }
  const cellOf = (i: number): Cell => ({ row: (i / grid.cols) | 0, col: i % grid.cols });

  // casualty hot spots: 2 m² bins, mean casualties per run
  const bins = new Map<string, { n: number; x: number; y: number }>();
  for (const r of runsOut)
    for (const c of r.casualtyCells) {
      const bx = Math.floor(c.x / SIM.casualtyBinM);
      const by = Math.floor(c.y / SIM.casualtyBinM);
      const key = `${bx},${by}`;
      const b = bins.get(key) ?? { n: 0, x: (bx + 0.5) * SIM.casualtyBinM, y: (by + 0.5) * SIM.casualtyBinM };
      b.n++;
      bins.set(key, b);
    }
  let hotspot: { x: number; y: number; meanPerRun: number } | undefined;
  for (const b of bins.values()) if (!hotspot || b.n / runs > hotspot.meanPerRun) hotspot = { x: b.x, y: b.y, meanPerRun: b.n / runs };

  const clusterMeanTimes: Record<string, number> = {};
  const clusterExitShare: Record<string, Record<string, number>> = {};
  const clusterPeople: Record<string, number> = {};
  ctx.clusters.forEach((cl, ci2) => {
    let ts = 0, tc = 0;
    const counts = new Array<number>(E).fill(0);
    for (const r of runsOut) {
      ts += r.clusterTimeSum[ci2]!;
      tc += r.clusterTimeCount[ci2]!;
      for (let e = 0; e < E; e++) counts[e] = counts[e]! + r.clusterExitCounts[ci2]![e]!;
    }
    clusterMeanTimes[cl.id] = tc > 0 ? ts / tc : NaN;
    clusterPeople[cl.id] = cl.people;
    const tot = counts.reduce((a, b) => a + b, 0);
    clusterExitShare[cl.id] = Object.fromEntries(ctx.exitIds.map((id, e) => [id, tot > 0 ? counts[e]! / tot : 0]));
  });

  return {
    strategy: 'as_marked',
    runs,
    completionTimes: completion,
    exitTimes,
    p50: percentileSorted(sortedExit, 50),
    p95: percentileSorted(sortedExit, 95),
    mean: mean(sortedExit),
    stdDev: stdDev(sortedExit),
    ci95P50Lower: ci.p50Lower,
    ci95P50Upper: ci.p50Upper,
    ci95P95Lower: ci.p95Lower,
    ci95P95Upper: ci.p95Upper,
    evacuated,
    casualties,
    remaining,
    unreachable: [...ctx.unreachableClusters],
    exitLoads,
    exitUtilisation,
    exitQueueTimes,
    densityHeatmap: heat,
    heatmapRows: grid.rows,
    heatmapCols: grid.cols,
    conservationPass: conservation,
    totalPeople: ctx.totalPeople,
    exitQueueMaxTimes,
    peakDensity: heat[peakI]!,
    peakDensityCell: cellOf(peakI),
    bottleneckSeconds: critMean[critI]!,
    bottleneckCell: cellOf(critI),
    casualtyHotspot: hotspot,
    clusterMeanTimes,
    clusterExitShare,
    clusterPeople,
  };
}

/** The whole Monte Carlo pipeline, synchronously. The worker, the tests and the what-if comparison all use this. */
export function runMonteCarloSync(
  planOrCtx: Parameters<typeof buildSimContext>[0] | SimContext,
  runs: number,
  masterSeed: number,
  onProgress?: (p: ProgressInfo) => void,
  opts: SimOptions = {},
  onTrace?: (trace: TraceFrame[]) => void,
): PipelineOutput {
  const ctx = 'grid' in planOrCtx && 'hazards' in planOrCtx ? (planOrCtx as SimContext) : buildSimContext(planOrCtx);
  const results: RunResult[] = [];
  const exitSoFar: number[] = [];
  let trace: TraceFrame[] | undefined;
  for (let r = 0; r < runs; r++) {
    const rng = new SeededRandom(deriveSeed(masterSeed, r));
    const agents = sampleAgents(ctx, rng, opts);
    const res = simulateRun(ctx, agents, { ...opts, trace: r === 0 });
    if (r === 0) {
      trace = res.trace;
      if (trace) onTrace?.(trace);
    }
    res.trace = undefined;
    results.push(res);
    if (res.evacuationTimes.length > 0) exitSoFar.push(res.lastCompletion);
    if ((r + 1) % MONTE_CARLO.progressEvery === 0 || r === runs - 1) {
      const s = Float64Array.from(exitSoFar).sort();
      onProgress?.({ completed: r + 1, total: runs, p50: percentileSorted(s, 50), p95: percentileSorted(s, 95) });
    }
  }
  return { result: aggregateResults(ctx, results, masterSeed), ctx, trace };
}
