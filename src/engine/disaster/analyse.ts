import { MAP } from '../../constants';
import type { DataStatus, MapAnalysis, MapScenario } from '../../types';
import type { IndiaData } from '../../map/data/loader';
import { computeCyclone } from './cyclone';
import { assessMagnitude, computeEarthquake, mmiRoman, roadBlockProbability } from './earthquake';
import { computeRainFlood, rasterizeRivers } from './flood';
import { cellAreaKm2, cellIndexOf, hav, sumPopulation } from './geo';
import { cycloneShare, floodShare, quakeShare } from './orders';

const riverCache = new WeakMap<object, Uint8Array>();

function riversOf(data: IndiaData): Uint8Array {
  let r = riverCache.get(data);
  if (!r) {
    r = rasterizeRivers(data.grid, data.rivers);
    riverCache.set(data, r);
  }
  return r;
}

export function nearestTown(data: IndiaData, lat: number, lon: number): string {
  let best = 'the origin';
  let bd = Infinity;
  for (const s of data.shelters) {
    const d = hav(lat, lon, s.lat, s.lon);
    if (d < bd) { bd = d; best = s.name; }
  }
  return best;
}

/** Step C2 -> C3: "Compute affected area". */
export function analyseScenario(s: MapScenario, data: IndiaData): DataStatus<MapAnalysis> {
  const g = data.grid;
  const n = g.rows * g.cols;
  let affected: number[] = [];
  let surge: number[] = [];
  let field: Float32Array | null = null;
  let blockProb: Float32Array | null = null;
  let blockTime: Float32Array | null = null;
  let depth: Float32Array | null = null;
  let arrival: Float32Array | null = null;
  let durationS = 0;
  let track: MapAnalysis['track'];
  const facts: string[] = [];
  const notes: string[] = [];

  const originCell = cellIndexOf(g, s.originLat, s.originLon);
  if (originCell < 0) return { status: 'missing', reason: 'That point is outside the mapped area.' };
  const hours = (sec: number) => `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`;

  if (s.disasterKind === 'earthquake') {
    const magnitude = s.magnitude ?? 7;
    const a = assessMagnitude(s.originLat, s.originLon, magnitude);
    if (a.level === 'not_credible') return { status: 'missing', reason: a.note };
    notes.push(a.note);
    const r = computeEarthquake(s.originLat, s.originLon, magnitude, MAP.earthquake.depthKmDefault, g, s.strikeDeg);
    affected = r.affectedCellIndices;
    field = r.pgaByCell;
    arrival = r.arrivalByCell;
    for (const i of affected) durationS = Math.max(durationS, r.arrivalByCell[i]!);
    blockProb = new Float32Array(n);
    for (const i of affected) blockProb[i] = roadBlockProbability(r.pgaByCell[i]!);
    facts.push(
      `The rupture is about ${Math.round(r.ruptureKm)} km long (Wells & Coppersmith), running ${Math.round(r.strikeDeg)}° from north through the epicentre.`,
      `The strongest shaking on land reaches intensity ${mmiRoman(r.peakMmi)} on the Mercalli scale; shaking above 0.1 g (about intensity VII) is counted as damaging.`,
      `The strong shaking travels at about ${MAP.earthquake.sWaveKmS} km/s, so it reaches the edge of the damaged area after about ${Math.round(durationS)} s.`,
    );
  } else if (s.disasterKind === 'flood') {
    const rain = s.rainfallMm ?? 200;
    const r = computeRainFlood(s.originLat, s.originLon, rain, g, riversOf(data));
    if (!r.ok) return { status: 'missing', reason: r.reason };
    affected = r.base.floodedCellIndices;
    depth = r.base.depthByCell;
    field = r.base.depthByCell;
    blockTime = r.arrivalByCell;
    arrival = r.arrivalByCell;
    for (const i of affected) durationS = Math.max(durationS, r.arrivalByCell[i]!);
    notes.push(r.assessment.note);
    facts.push(
      `${Math.round(rain)} mm of rain in 24 h on soil that sheds about ${Math.round(r.runoffMm)} mm of it as runoff (SCS Curve Number).`,
      `${r.usedMappedRiver ? 'The river' : 'The drainage line'} here collects from about ${Math.round(r.catchmentKm2).toLocaleString('en-IN')} km² (found by routing water across the elevation grid) and peaks at about ${Math.round(r.peakDischargeM3s).toLocaleString('en-IN')} m³/s about ${r.timeToPeakH.toFixed(0)} h after the rain starts.`,
      `That lifts the river about ${r.stageRiseM.toFixed(1)} m above its banks; the water then spreads only over connected low ground.`,
    );
  } else {
    const r = computeCyclone(s.originLat, s.originLon, s.category ?? 3, g, { headingDeg: s.headingDeg, speedKmh: s.speedKmh, leadHours: s.leadHours });
    if ('error' in r) return { status: 'missing', reason: r.error };
    affected = r.affectedCellIndices;
    surge = r.surgeCellIndices;
    field = r.windByCell;
    depth = r.surgeDepthByCell;
    blockTime = r.blockTimeByCell;
    arrival = r.blockTimeByCell;
    track = r.track.map(({ t, lat, lon, vmax, rmaxKm }) => ({ t, lat, lon, vmax, rmaxKm }));
    durationS = r.leadS + 4 * 3600;
    const lf = r.track.find((p) => p.t >= r.leadS)!;
    facts.push(
      `The storm moves ${r.headingDeg}° from north at ${Math.round(r.speedKmh)} km/h and makes landfall ${hours(r.leadS)} after the alert, with its strongest winds on the right of its track.`,
      `Its core is ${Math.round(lf.rmaxKm)} km wide (radius of maximum wind); over land it weakens as Kaplan & DeMaria describe.`,
      `Storm surge peaks at about ${r.peakSurgeM.toFixed(1)} m on the coast to the right of the landfall point and fades by about ${MAP.cyclone.surgeDecayMPerKm} m for every km inland.`,
      `Roads are treated as unsafe once the wind reaches ${MAP.cyclone.galeWindMS} m/s (gale force); the peak wind at landfall is ${Math.round(lf.vmax)} m/s.`,
    );
  }

  if (affected.length === 0) {
    return { status: 'missing', reason: 'Nothing on land is affected at this severity. Increase the severity or move the origin.' };
  }

  let area = 0;
  for (const i of affected) area += cellAreaKm2(g, g.lat[i]!);
  const mask = new Uint8Array(n);
  for (const i of affected) mask[i] = 1;
  // who leaves
  const share = new Float32Array(n);
  let evacPop = 0;
  for (const i of affected) {
    share[i] =
      s.disasterKind === 'earthquake' ? quakeShare(field?.[i] ?? 0)
      : s.disasterKind === 'flood' ? floodShare(depth?.[i] ?? 0)
      : cycloneShare(field?.[i] ?? 0, depth?.[i] ?? 0);
    evacPop += g.population[i]! * share[i]!;
  }
  facts.push(`${Math.round(evacPop).toLocaleString('en-IN')} of the ${Math.round(sumPopulation(g, affected)).toLocaleString('en-IN')} people in the footprint are ordered or forced to leave; the rest are assumed to shelter in place.`);
  const settlements = data.shelters
    .filter((t) => {
      const i = cellIndexOf(g, t.lat, t.lon);
      return i >= 0 && mask[i];
    })
    .sort((a, b) => b.population - a.population)
    .slice(0, 6)
    .map((t) => ({ name: t.name, population: t.population }));

  return {
    status: 'ok',
    data: {
      scenario: s,
      affectedCellIndices: affected,
      surgeCellIndices: surge,
      fieldByCell: field,
      totalPopulation: sumPopulation(g, affected),
      areaKm2: area,
      settlements,
      blockProbByCell: blockProb,
      blockTimeByCell: blockTime,
      depthByCell: depth,
      regionName: nearestTown(data, s.originLat, s.originLon),
      arrivalTimeByCell: arrival,
      durationS,
      track,
      facts,
      notes,
      evacShareByCell: share,
      evacPopulation: evacPop,
    },
  };
}
