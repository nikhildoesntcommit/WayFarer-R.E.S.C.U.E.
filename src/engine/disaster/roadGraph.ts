import { MAP } from '../../constants';
import type { IndiaGrid, MapAnalysis } from '../../types';
import type { IndiaData, LineCollection } from '../../map/data/loader';
import { cellIndexOf, hav } from './geo';

/** The raw road skeleton: junctions snapped together, one edge per polyline step, with the grid cells each edge crosses. */
export interface RawGraph {
  lat: number[];
  lon: number[];
  edgeFrom: number[];
  edgeTo: number[];
  edgeLenKm: number[];
  edgeCells: Int32Array[];
  adj: number[][];
}

const cache = new WeakMap<object, RawGraph>();

export function buildRawGraph(roads: LineCollection, grid: IndiaGrid): RawGraph {
  const snap = MAP.roads.snapDeg;
  const ids = new Map<string, number>();
  const g: RawGraph = { lat: [], lon: [], edgeFrom: [], edgeTo: [], edgeLenKm: [], edgeCells: [], adj: [] };
  const edgeKey = new Set<string>();
  const node = (lon: number, lat: number): number => {
    const k = `${Math.round(lon / snap)},${Math.round(lat / snap)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = g.lat.length;
      ids.set(k, id);
      g.lat.push(lat);
      g.lon.push(lon);
      g.adj.push([]);
    }
    return id;
  };
  for (const f of roads.features) {
    const pts = f.geometry.coordinates;
    let prev = -1;
    let prevPt: [number, number] | null = null;
    for (const p of pts) {
      const id = node(p[0], p[1]);
      if (prev >= 0 && id !== prev) {
        const key = prev < id ? `${prev}-${id}` : `${id}-${prev}`;
        if (!edgeKey.has(key)) {
          edgeKey.add(key);
          const e = g.edgeFrom.length;
          g.edgeFrom.push(prev);
          g.edgeTo.push(id);
          g.edgeLenKm.push(hav(g.lat[prev]!, g.lon[prev]!, g.lat[id]!, g.lon[id]!));
          // cells crossed by the real (unsnapped) step
          const cells: number[] = [];
          const [x0, y0] = prevPt!;
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(p[0] - x0), Math.abs(p[1] - y0)) / (grid.resDeg / 2)));
          for (let s = 0; s <= n; s++) {
            const ci = cellIndexOf(grid, y0 + ((p[1] - y0) * s) / n, x0 + ((p[0] - x0) * s) / n);
            if (ci >= 0 && cells[cells.length - 1] !== ci) cells.push(ci);
          }
          g.edgeCells.push(Int32Array.from(cells));
          g.adj[prev]!.push(e);
          g.adj[id]!.push(e);
        }
      }
      prev = id;
      prevPt = [p[0], p[1]];
    }
  }
  return g;
}

export function rawGraphOf(data: IndiaData): RawGraph {
  let g = cache.get(data);
  if (!g) {
    g = buildRawGraph(data.roads, data.grid);
    cache.set(data, g);
  }
  return g;
}

/** Nearest-node lookup with a 0.2° bucket hash. */
export class NodeIndex {
  private buckets = new Map<string, number[]>();
  private readonly cell = 0.2;
  constructor(private g: RawGraph) {
    for (let i = 0; i < g.lat.length; i++) {
      const k = this.key(g.lat[i]!, g.lon[i]!);
      const b = this.buckets.get(k);
      if (b) b.push(i);
      else this.buckets.set(k, [i]);
    }
  }
  private key(lat: number, lon: number): string {
    return `${Math.floor(lat / this.cell)},${Math.floor(lon / this.cell)}`;
  }
  nearest(lat: number, lon: number, maxKm: number): { node: number; km: number } | null {
    const reach = Math.ceil(maxKm / 111 / this.cell) + 1;
    const r0 = Math.floor(lat / this.cell);
    const c0 = Math.floor(lon / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let dr = -reach; dr <= reach; dr++)
      for (let dc = -reach; dc <= reach; dc++) {
        const b = this.buckets.get(`${r0 + dr},${c0 + dc}`);
        if (!b) continue;
        for (const i of b) {
          const d = hav(lat, lon, this.g.lat[i]!, this.g.lon[i]!);
          if (d < bd) { bd = d; best = i; }
        }
      }
    return best >= 0 && bd <= maxKm ? { node: best, km: bd } : null;
  }
}

const indexCache = new WeakMap<object, NodeIndex>();
export function nodeIndexOf(data: IndiaData): NodeIndex {
  let ix = indexCache.get(data);
  if (!ix) {
    ix = new NodeIndex(rawGraphOf(data));
    indexCache.set(data, ix);
  }
  return ix;
}

export interface MapSimInput {
  kind: 'earthquake' | 'flood' | 'cyclone';
  nodeLat: number[];
  nodeLon: number[];
  edgeFrom: number[];
  edgeTo: number[];
  edgeLenKm: number[];
  /** probability the edge is blocked at t = 0 (earthquake) */
  edgeBlockProb: number[];
  /** seconds after which the edge is impassable; -1 = never */
  edgeBlockTimeS: number[];
  people: number[];
  accessS: number[];
  /** seconds after which the people at this node are caught where they stand; -1 = never */
  homeBlockTimeS: number[];
  shelters: { id: string; name: string; node: number; capacity: number }[];
  /** Road nodes just outside the hazard footprint: reaching one means being out of danger (assembly points). */
  refuges: number[];
  towns: { name: string; lat: number; lon: number }[];
  /** affected population with no road within reach of its cell: never modelled as moving */
  noAccessPopulation: number;
  regionName: string;
  masterSeed: number;
}

/**
 * Scenario + data -> compact simulation input. Population goes to the nearest road node, shelters (towns outside the
 * hazard) too, and every node that is neither a population/shelter anchor nor a junction is contracted away.
 */
export function buildMapSimInput(analysis: MapAnalysis, data: IndiaData): MapSimInput {
  const g = data.grid;
  const raw = rawGraphOf(data);
  const index = nodeIndexOf(data);
  const n = g.rows * g.cols;
  const affectedMask = new Uint8Array(n);
  for (const i of analysis.affectedCellIndices) affectedMask[i] = 1;

  // ---- anchors
  const popAt = new Map<number, { people: number; accessKmSum: number; home: number }>();
  let noAccess = 0;
  for (const i of analysis.affectedCellIndices) {
    const p = g.population[i]! * (analysis.evacShareByCell?.[i] ?? 1);
    if (p <= 0) continue;
    const hit = index.nearest(g.lat[i]!, g.lon[i]!, MAP.roads.maxAccessKm);
    if (!hit) { noAccess += p; continue; }
    const rec = popAt.get(hit.node) ?? { people: 0, accessKmSum: 0, home: Infinity };
    rec.people += p;
    rec.accessKmSum += hit.km * p;
    const bt = analysis.blockTimeByCell?.[i];
    if (bt !== undefined && bt < rec.home) rec.home = bt;
    popAt.set(hit.node, rec);
  }
  const shelterAt = new Map<number, { id: string; name: string; capacity: number }>();
  for (const s of data.shelters) {
    const ci = cellIndexOf(g, s.lat, s.lon);
    if (ci < 0 || affectedMask[ci]) continue; // a shelter inside the hazard is not a shelter
    const hit = index.nearest(s.lat, s.lon, MAP.roads.maxAccessKm);
    if (!hit) continue;
    const prev = shelterAt.get(hit.node);
    if (!prev || prev.capacity < s.capacity) shelterAt.set(hit.node, { id: s.id, name: s.name, capacity: s.capacity });
  }

  // ---- refuges: unaffected road nodes that touch the footprint, one per ~0.2 degree so the count stays manageable
  const refugeRaw: number[] = [];
  {
    const seen = new Set<string>();
    for (let u = 0; u < raw.lat.length; u++) {
      const cu = cellIndexOf(g, raw.lat[u]!, raw.lon[u]!);
      if (cu < 0 || affectedMask[cu] || !g.landMask[cu]) continue;
      let touches = false;
      for (const e of raw.adj[u]!) {
        const v = raw.edgeFrom[e] === u ? raw.edgeTo[e]! : raw.edgeFrom[e]!;
        const cv = cellIndexOf(g, raw.lat[v]!, raw.lon[v]!);
        if (cv >= 0 && affectedMask[cv]) { touches = true; break; }
      }
      if (!touches) continue;
      const key = `${Math.floor(raw.lat[u]! / 0.2)}:${Math.floor(raw.lon[u]! / 0.2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refugeRaw.push(u);
    }
  }

  // ---- contraction: keep anchors and junctions (degree != 2)
  const keep = new Uint8Array(raw.lat.length);
  for (let i = 0; i < raw.lat.length; i++) if (raw.adj[i]!.length !== 2) keep[i] = 1;
  for (const k of popAt.keys()) keep[k] = 1;
  for (const k of shelterAt.keys()) keep[k] = 1;
  for (const k of refugeRaw) keep[k] = 1;
  const compact = new Map<number, number>();
  const nodeLat: number[] = [];
  const nodeLon: number[] = [];
  const cid = (i: number): number => {
    let c = compact.get(i);
    if (c === undefined) {
      c = nodeLat.length;
      compact.set(i, c);
      nodeLat.push(raw.lat[i]!);
      nodeLon.push(raw.lon[i]!);
    }
    return c;
  };
  const used = new Uint8Array(raw.edgeFrom.length);
  const out: MapSimInput = {
    kind: analysis.scenario.disasterKind,
    nodeLat, nodeLon,
    edgeFrom: [], edgeTo: [], edgeLenKm: [], edgeBlockProb: [], edgeBlockTimeS: [],
    people: [], accessS: [], homeBlockTimeS: [], shelters: [], refuges: [],
    towns: data.shelters.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    noAccessPopulation: noAccess,
    regionName: analysis.regionName,
    masterSeed: analysis.scenario.masterSeed,
  };
  for (let u = 0; u < raw.lat.length; u++) {
    if (!keep[u]) continue;
    for (const e0 of raw.adj[u]!) {
      if (used[e0]) continue;
      let cur = u;
      let e = e0;
      let len = 0;
      let prob = 0;
      let time = Infinity;
      for (;;) {
        used[e] = 1;
        len += raw.edgeLenKm[e]!;
        for (const ci of raw.edgeCells[e]!) {
          const bp = analysis.blockProbByCell?.[ci];
          if (bp !== undefined && bp > prob) prob = bp;
          const bt = analysis.blockTimeByCell?.[ci];
          if (bt !== undefined && bt < time) time = bt;
        }
        const v: number = raw.edgeFrom[e] === cur ? raw.edgeTo[e]! : raw.edgeFrom[e]!;
        if (keep[v]) {
          if (v !== u) {
            out.edgeFrom.push(cid(u));
            out.edgeTo.push(cid(v));
            out.edgeLenKm.push(len);
            out.edgeBlockProb.push(prob);
            out.edgeBlockTimeS.push(Number.isFinite(time) ? time : -1);
          }
          break;
        }
        const next = raw.adj[v]!.find((x) => x !== e);
        if (next === undefined || used[next]) break;
        cur = v;
        e = next;
      }
    }
  }
  // anchors always exist as compact nodes, even if isolated
  for (const k of popAt.keys()) cid(k);
  for (const k of shelterAt.keys()) cid(k);
  for (const k of refugeRaw) cid(k);
  const N = nodeLat.length;
  out.people = new Array<number>(N).fill(0);
  out.accessS = new Array<number>(N).fill(0);
  out.homeBlockTimeS = new Array<number>(N).fill(-1);
  for (const [rawNode, rec] of popAt) {
    const c = compact.get(rawNode)!;
    out.people[c] = Math.round(rec.people);
    out.accessS[c] = (rec.accessKmSum / rec.people / MAP.roads.accessSpeedKmh) * 3600;
    out.homeBlockTimeS[c] = Number.isFinite(rec.home) ? rec.home : -1;
  }
  out.refuges = refugeRaw.map((k) => compact.get(k)!);
  for (const [rawNode, s] of shelterAt) out.shelters.push({ id: s.id, name: s.name, node: compact.get(rawNode)!, capacity: s.capacity });
  return out;
}
