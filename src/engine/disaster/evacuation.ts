import { MAP, MONTE_CARLO } from '../../constants';
import type { SimulationResult } from '../../types';
import { bootstrapPercentileCI, mean, percentileSorted, stdDev } from '../../utils/stats';
import { deriveSeed, SeededRandom } from '../../utils/seeds';
import { MinHeap } from '../fmm';
import type { ProgressInfo } from '../pipeline';
import { hav } from './geo';
import type { MapSimInput } from './roadGraph';

const E = MAP.evac;
const R = MAP.roads;

/** Inverse standard normal CDF (Acklam), for quantile cohorts. */
export function normInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

interface Csr {
  start: Int32Array;
  edges: Int32Array;
}

function csr(nodes: number, from: number[], to: number[]): Csr {
  const deg = new Int32Array(nodes + 1);
  for (let e = 0; e < from.length; e++) {
    deg[from[e]! + 1]!++;
    deg[to[e]! + 1]!++;
  }
  for (let i = 0; i < nodes; i++) deg[i + 1]! += deg[i]!;
  const fill = deg.slice(0, nodes);
  const edges = new Int32Array(deg[nodes]!);
  for (let e = 0; e < from.length; e++) {
    edges[fill[from[e]!]!++] = e;
    edges[fill[to[e]!]!++] = e;
  }
  return { start: deg, edges };
}

interface Tree {
  nextEdge: Int32Array; // edge towards the nearest shelter, -1 at shelters / unreachable
  root: Int32Array; // shelter index, -1 if unreachable
  hops: Int32Array;
}

/** Multi-source Dijkstra from every shelter over the edges that are usable, by travel time. */
function routeTree(input: MapSimInput, adj: Csr, travelS: Float64Array, usable: (e: number) => boolean): Tree {
  const N = input.nodeLat.length;
  const dist = new Float64Array(N).fill(Infinity);
  const nextEdge = new Int32Array(N).fill(-1);
  const root = new Int32Array(N).fill(-1);
  const hops = new Int32Array(N).fill(0);
  const heap = new MinHeap();
  input.shelters.forEach((s, i) => {
    dist[s.node] = 0;
    root[s.node] = i;
    heap.push(0, s.node);
  });
  while (heap.size > 0) {
    const { key, val: u } = heap.pop();
    if (key > dist[u]!) continue;
    for (let k = adj.start[u]!; k < adj.start[u + 1]!; k++) {
      const e = adj.edges[k]!;
      if (!usable(e)) continue;
      const v = input.edgeFrom[e] === u ? input.edgeTo[e]! : input.edgeFrom[e]!;
      const nd = key + travelS[e]!;
      if (nd < dist[v]!) {
        dist[v] = nd;
        nextEdge[v] = e;
        root[v] = root[u]!;
        hops[v] = hops[u]! + 1;
        heap.push(nd, v);
      }
    }
  }
  return { nextEdge, root, hops };
}


/** Single-source Dijkstra from one shelter: travel time to it from every node and the edge each node takes towards it. */
function treeFrom(input: MapSimInput, adj: Csr, travelS: Float64Array, usable: (e: number) => boolean, src: number): { dist: Float64Array; nextEdge: Int32Array } {
  const N = input.nodeLat.length;
  const dist = new Float64Array(N).fill(Infinity);
  const nextEdge = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  dist[src] = 0;
  heap.push(0, src);
  while (heap.size > 0) {
    const { key, val: u } = heap.pop();
    if (key > dist[u]!) continue;
    for (let k = adj.start[u]!; k < adj.start[u + 1]!; k++) {
      const e = adj.edges[k]!;
      if (!usable(e)) continue;
      const v = input.edgeFrom[e] === u ? input.edgeTo[e]! : input.edgeFrom[e]!;
      const nd = key + travelS[e]!;
      if (nd < dist[v]!) {
        dist[v] = nd;
        nextEdge[v] = e;
        heap.push(nd, v);
      }
    }
  }
  return { dist, nextEdge };
}

interface Assignment { node: number; shelter: number; people: number }
interface Plan {
  assignments: Assignment[];
  /** per shelter: the edge each node takes towards it (null if no one is assigned to it) */
  towards: (Int32Array | null)[];
  overflow: number;
  totalCapacity: number;
}

/**
 * Capacity-constrained assignment of evacuees to shelters (a greedy solution of the transportation problem): all
 * (node, shelter) pairs are served in order of increasing travel time; a shelter that fills up drops out and its would-be
 * evacuees move on to their next nearest one. Optimal whenever capacity does not bind, and never worse than "everyone
 * to the nearest shelter" for the shelters. People left over when every reachable shelter is full still go to their
 * nearest one (overflow): the report shows that shelter over capacity rather than hiding the people.
 */
function planAssignments(input: MapSimInput, adj: Csr, travelS: Float64Array, reachable: number[], usable: (e: number) => boolean, maxTravelS = Infinity): Plan {
  const S = input.shelters.length;
  const dist: Float64Array[] = [];
  const nextEdge: Int32Array[] = [];
  for (let s = 0; s < S; s++) {
    const t = treeFrom(input, adj, travelS, usable, input.shelters[s]!.node);
    dist.push(t.dist);
    nextEdge.push(t.nextEdge);
  }
  const cap = input.shelters.map((sh) => Math.floor(sh.capacity));
  const order = new Map<number, Int32Array>();
  const ptr = new Map<number, number>();
  const rem = new Map<number, number>();
  const unplaced: number[] = [];
  const heap = new MinHeap();
  for (const n of reachable) {
    const idx = Array.from({ length: S }, (_, i) => i).filter((i) => dist[i]![n]! <= maxTravelS).sort((a, b) => dist[a]![n]! - dist[b]![n]!);
    order.set(n, Int32Array.from(idx));
    ptr.set(n, 0);
    rem.set(n, input.people[n]!);
    if (idx.length > 0) heap.push(dist[idx[0]!]![n]!, n);
    else unplaced.push(n);
  }
  const got = new Map<string, number>();
  while (heap.size > 0) {
    const { val: n } = heap.pop();
    const o = order.get(n)!;
    let p = ptr.get(n)!;
    while (p < o.length && cap[o[p]!]! <= 0) p++;
    if (p >= o.length) { unplaced.push(n); continue; }
    ptr.set(n, p);
    const s = o[p]!;
    const take = Math.min(rem.get(n)!, cap[s]!);
    cap[s]! -= take;
    rem.set(n, rem.get(n)! - take);
    got.set(`${n}:${s}`, (got.get(`${n}:${s}`) ?? 0) + take);
    if (rem.get(n)! > 0) {
      // this shelter is now full: the remainder looks at the next candidate
      ptr.set(n, p + 1);
      let q = p + 1;
      while (q < o.length && cap[o[q]!]! <= 0) q++;
      if (q < o.length) { ptr.set(n, q); heap.push(dist[o[q]!]![n]!, n); } else unplaced.push(n);
    }
  }
  let overflow = 0;
  for (const n of unplaced) {
    const left = rem.get(n)!;
    if (left <= 0) continue;
    const o = order.get(n)!;
    let s = o[0] ?? -1;
    if (s < 0) {
      // nothing within range: the nearest at any distance
      let bd = Infinity;
      for (let i = 0; i < S; i++) if (dist[i]![n]! < bd) { bd = dist[i]![n]!; s = i; }
      if (s < 0) continue;
    }
    got.set(`${n}:${s}`, (got.get(`${n}:${s}`) ?? 0) + left);
    overflow += left;
  }
  const assignments: Assignment[] = [];
  const used = new Set<number>();
  for (const [key, people] of got) {
    if (people <= 0) continue;
    const [n, s] = key.split(':').map(Number) as [number, number];
    assignments.push({ node: n, shelter: s, people });
    used.add(s);
  }
  assignments.sort((a, b) => a.node - b.node || dist[a.shelter]![a.node]! - dist[b.shelter]![b.node]!);
  const towards = nextEdge.map((t, s) => (used.has(s) ? t : null));
  return { assignments, towards, overflow, totalCapacity: input.shelters.reduce((a, sh) => a + Math.floor(sh.capacity), 0) };
}

/** Name an edge after the nearest town to its middle. */
function edgeLabel(input: MapSimInput, e: number): string {
  const lat = (input.nodeLat[input.edgeFrom[e]!]! + input.nodeLat[input.edgeTo[e]!]!) / 2;
  const lon = (input.nodeLon[input.edgeFrom[e]!]! + input.nodeLon[input.edgeTo[e]!]!) / 2;
  let best = input.regionName;
  let bd = Infinity;
  for (const t of input.towns) {
    const d = hav(lat, lon, t.lat, t.lon);
    if (d < bd) { bd = d; best = t.name; }
  }
  return `the road near ${best} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`;
}

export class MapSimError extends Error {}

/**
 * Road-network evacuation (spec §9.5, "MVP" model): cohorts of people leave each population node after a lognormal
 * delay, follow the fastest route to the nearest reachable shelter, queue FIFO at every road edge and at the shelter
 * entrance, and are lost if an edge closes before they have crossed it. Individual agents are not simulated.
 */
export function runMapMonteCarlo(
  input: MapSimInput,
  runs: number,
  masterSeed: number,
  onProgress?: (p: ProgressInfo) => void,
): SimulationResult {
  const N = input.nodeLat.length;
  const M = input.edgeFrom.length;
  if (input.shelters.length === 0 && input.refuges.length === 0) throw new MapSimError('No shelter outside the hazard is reachable from this area of the map.');
  // People first get out of danger (reach a refuge just outside the footprint), which is what decides who is caught.
  // Where they then sleep is planned separately and capacity-aware (see the shelter plan at the end).
  const dests = input.refuges.length > 0
    ? input.refuges.map((node, i) => ({ id: `refuge-${i}`, name: 'Safe ground', node, capacity: Infinity }))
    : input.shelters;
  const formal = input;
  input = { ...input, shelters: dests };
  const adj = csr(N, input.edgeFrom, input.edgeTo);
  const travelS = new Float64Array(M);
  for (let e = 0; e < M; e++) travelS[e] = (input.edgeLenKm[e]! / R.roadSpeedKmh) * 3600;
  const capPerS = R.roadCapacityPerHour / 3600;
  const intakePerS = input.shelters.map((sh) => (Number.isFinite(sh.capacity) ? Math.max(R.shelterIntakeMinPerHour, R.shelterIntakeCapacityFractionPerHour * sh.capacity) / 3600 : Infinity));

  // baseline connectivity (no random blocking): who can ever get out?
  const base = routeTree(input, adj, travelS, (e) => input.edgeBlockTimeS[e]! !== 0);
  const reachable: number[] = [];
  let totalPeople = 0;
  let unreachablePop = input.noAccessPopulation;
  let hopSum = 0;
  for (let n = 0; n < N; n++) {
    if (input.people[n]! <= 0) continue;
    if (base.root[n]! >= 0) {
      reachable.push(n);
      totalPeople += input.people[n]!;
      hopSum += base.hops[n]!;
    } else unreachablePop += input.people[n]!;
  }
  if (totalPeople === 0) throw new MapSimError('Nobody in the affected area has a road route to a shelter.');
  const cohorts = Math.max(1, Math.min(E.maxCohortsPerNode, Math.floor(E.eventBudgetPerTrial / Math.max(1, hopSum))));
  // the plan: who goes to which shelter (capacity-aware), on the roads that are open at the start
  const plan = planAssignments(input, adj, travelS, reachable, (e) => input.edgeBlockTimeS[e]! !== 0);
  const byNode = new Map<number, Assignment[]>();
  for (const a of plan.assignments) {
    const l = byNode.get(a.node);
    if (l) l.push(a);
    else byNode.set(a.node, [a]);
  }

  const S = input.shelters.length;
  const exitTimes: number[] = [];
  const completion: number[] = [];
  const t90s: number[] = [];
  let evacuated = 0;
  let casualties = 0;
  let remaining = 0;
  let conservation = true;
  const shelterLoad = new Float64Array(S);
  const shelterWaitSum = new Float64Array(S);
  const edgeFlow = new Float64Array(M);
  const edgeEverUsed = new Uint8Array(M);
  const progressEvery = MONTE_CARLO.progressEvery;
  const sortedSoFar: number[] = [];

  const blocked0 = new Uint8Array(M);
  const blockT = new Float64Array(M);
  const free = new Float64Array(2 * M);
  const shelterFree = new Float64Array(S);

  for (let run = 0; run < runs; run++) {
    const rng = new SeededRandom(deriveSeed(masterSeed, run));
    const trialFactor = Math.exp(E.trialJitterSigma * rng.normal());
    for (let e = 0; e < M; e++) {
      const bp = input.edgeBlockProb[e]!;
      const bt = input.edgeBlockTimeS[e]!;
      blocked0[e] = bp > 0 && rng.next() < bp ? 1 : bt === 0 ? 1 : 0;
      blockT[e] = blocked0[e] ? 0 : bt < 0 ? Infinity : bt;
    }
    const tree = routeTree(input, adj, travelS, (e) => !blocked0[e]);
    free.fill(0);
    shelterFree.fill(0);

    // cohorts: each departs after its own delay and is bound for the shelter the plan gave it
    const cNode: number[] = [];
    const cSize: number[] = [];
    const cShelter: number[] = [];
    const cFallback: number[] = [];
    const heap = new MinHeap();
    let caught = 0;
    let stuck = 0;
    for (const n of reachable) {
      const P = input.people[n]!;
      const k = Math.min(cohorts, P);
      const jitter = E.nodeJitterSigma * rng.normal();
      const home = input.homeBlockTimeS[n]!;
      const slots = byNode.get(n) ?? [];
      let ai = 0;
      let aLeft = slots[0]?.people ?? 0;
      for (let q = 0; q < k; q++) {
        const size = Math.floor(P / k) + (q < P % k ? 1 : 0);
        if (size === 0) continue;
        const z = normInv((q + 0.5) / k);
        const depart = E.preMovementMedianS * trialFactor * Math.exp(E.preMovementSigma * z + jitter);
        let left = size;
        while (left > 0 && ai < slots.length) {
          const take = Math.min(left, aLeft);
          left -= take;
          aLeft -= take;
          if (home >= 0 && home <= depart) {
            caught += take; // the hazard reached them before they left
          } else {
            const c = cNode.length;
            cNode.push(n);
            cSize.push(take);
            cShelter.push(slots[ai]!.shelter);
            cFallback.push(0);
            heap.push(depart + input.accessS[n]!, c);
          }
          if (aLeft === 0) { ai++; aLeft = slots[ai]?.people ?? 0; }
        }
        if (left > 0) stuck += left; // rounding guard: never happens when the plan covers everyone
      }
    }

    let out = 0;
    let lastFinish = 0;
    const arrivals: { t: number; m: number }[] = [];
    while (heap.size > 0) {
      const { key: t, val: c } = heap.pop();
      const n = cNode[c]!;
      const m = cSize[c]!;
      if (t > E.maxTimeS) {
        stuck += m;
        continue;
      }
      let e = -1;
      let arrivedAt = -1;
      if (cFallback[c] === 0) {
        const sh = cShelter[c]!;
        if (n === input.shelters[sh]!.node) arrivedAt = sh;
        else {
          e = plan.towards[sh]![n]!;
          if (e < 0 || blocked0[e]) cFallback[c] = 1; // the planned route is cut in this trial: take the nearest open way out
        }
      }
      if (cFallback[c] === 1) {
        e = tree.nextEdge[n]!;
        if (e < 0) arrivedAt = tree.root[n]!;
      }
      if (arrivedAt >= 0 || e < 0) {
        const s = arrivedAt;
        if (s < 0) {
          stuck += m; // this trial's blocked roads cut the node off
          continue;
        }
        const start = Math.max(t, shelterFree[s]!);
        const finish = start + m / intakePerS[s]!;
        if (finish > E.maxTimeS) {
          stuck += m; // still queueing at the shelter gate when the time cap is reached
          continue;
        }
        shelterFree[s] = finish;
        shelterLoad[s]! += m;
        shelterWaitSum[s]! += (start - t) * m;
        out += m;
        completion.push(shelterFree[s]!);
        arrivals.push({ t: shelterFree[s]!, m });
        if (shelterFree[s]! > lastFinish) lastFinish = shelterFree[s]!;
        continue;
      }
      if (blockT[e]! <= t) {
        caught += m;
        continue;
      }
      const dir = input.edgeFrom[e] === n ? 0 : 1;
      const slot = 2 * e + dir;
      const start = Math.max(t, free[slot]!);
      if (blockT[e]! <= start) {
        caught += m;
        continue;
      }
      free[slot] = start + m / capPerS;
      const arrive = free[slot]! + travelS[e]!;
      if (blockT[e]! < arrive) {
        caught += m; // the road closed while they were on it
        continue;
      }
      edgeFlow[e]! += m;
      edgeEverUsed[e] = 1;
      const next = input.edgeFrom[e] === n ? input.edgeTo[e]! : input.edgeFrom[e]!;
      cNode[c] = next;
      heap.push(arrive, c);
    }

    evacuated += out;
    casualties += caught;
    remaining += stuck;
    if (out + caught + stuck !== totalPeople) conservation = false;
    if (out > 0) {
      exitTimes.push(lastFinish);
      sortedSoFar.push(lastFinish);
    }
    arrivals.sort((a, b) => a.t - b.t);
    let cum = 0;
    let t90 = Infinity;
    for (const a of arrivals) {
      cum += a.m;
      if (cum >= 0.9 * totalPeople) { t90 = a.t; break; }
    }
    t90s.push(t90);

    if ((run + 1) % progressEvery === 0 || run === runs - 1) {
      const s = Float64Array.from(sortedSoFar).sort();
      onProgress?.({ completed: run + 1, total: runs, p50: percentileSorted(s, 50), p95: percentileSorted(s, 95) });
    }
  }

  if (evacuated + casualties + remaining !== runs * totalPeople) conservation = false;
  const sortedExit = Float64Array.from(exitTimes).sort();
  const ci = bootstrapPercentileCI(sortedExit, masterSeed ^ 0x9e3779b9, MONTE_CARLO.bootstrapIterations);
  const completionSorted = Float32Array.from(completion).sort();

  // ---- where everybody sleeps: capacity-aware plan over the formal shelters, scaled by the share that got out
  const exitLoads: Record<string, number> = {};
  const exitUtilisation: Record<string, number> = {};
  const exitQueueTimes: Record<string, number> = {};
  const shelterLoads: { shelterId: string; name: string; load: number; capacity: number }[] = [];
  let plannedOverflow = 0;
  let totalCapacity = 0;
  if (formal.shelters.length > 0) {
    const sp = planAssignments(formal, adj, travelS, reachable, (e) => input.edgeBlockTimeS[e]! !== 0, E.maxShelterTravelS);
    const escaped = evacuated / (runs * totalPeople);
    const loadOf = new Float64Array(formal.shelters.length);
    for (const a of sp.assignments) loadOf[a.shelter]! += a.people * escaped;
    formal.shelters.forEach((s, i) => {
      exitLoads[s.id] = loadOf[i]!;
      exitUtilisation[s.id] = loadOf[i]! / totalPeople;
      exitQueueTimes[s.id] = 0;
      if (loadOf[i]! > 0) shelterLoads.push({ shelterId: s.id, name: s.name, load: loadOf[i]!, capacity: s.capacity });
    });
    // idle shelters nearby so "redirect to ..." has candidates with spare capacity
    for (const [i, s] of formal.shelters.entries()) if (loadOf[i]! === 0 && shelterLoads.length < 60) shelterLoads.push({ shelterId: s.id, name: s.name, load: 0, capacity: s.capacity });
    plannedOverflow = sp.overflow * escaped;
    totalCapacity = sp.totalCapacity;
  }

  const edgeFlowShare: { edgeId: string; share: number; label: string }[] = [];
  for (let e = 0; e < M; e++) {
    const share = edgeFlow[e]! / runs / totalPeople;
    if (share >= 0.05) edgeFlowShare.push({ edgeId: `e${e}`, share, label: edgeLabel(input, e) });
  }
  edgeFlowShare.sort((a, b) => b.share - a.share);

  // when does the hazard first reach a road that evacuees use, versus when 90% have escaped (median trial)?
  let tFirst = Infinity;
  for (let e = 0; e < M; e++) {
    const bt = input.edgeBlockTimeS[e]!;
    if (edgeEverUsed[e] && bt > 0 && bt < tFirst) tFirst = bt;
  }
  const finiteT90 = Float64Array.from(t90s.filter(Number.isFinite)).sort();
  const t90Median = finiteT90.length > 0 ? percentileSorted(finiteT90, 50) : Infinity;
  const gap = Number.isFinite(tFirst) && Number.isFinite(t90Median) && tFirst < t90Median ? (t90Median - tFirst) / 60 : undefined;

  return {
    strategy: 'as_marked',
    runs,
    completionTimes: completionSorted,
    exitTimes: Float32Array.from(exitTimes),
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
    unreachable: [],
    exitLoads,
    exitUtilisation,
    exitQueueTimes,
    densityHeatmap: new Float32Array(0),
    heatmapRows: 0,
    heatmapCols: 0,
    conservationPass: conservation,
    totalPeople,
    mapStats: {
      edgeFlowShare: edgeFlowShare.slice(0, 12),
      shelterLoads,
      unreachablePopulation: unreachablePop,
      floodTimingGapMin: gap,
      floodRegion: input.regionName,
      plannedOverflow,
      totalShelterCapacity: totalCapacity,
    },
  };
}
