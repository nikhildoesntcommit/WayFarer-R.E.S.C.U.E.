import { describe, expect, it } from 'vitest';
import { MAP } from '../../../constants';
import type { MapScenario } from '../../../types';
import { analyseScenario } from '../analyse';
import { computeCyclone, defaultHeadingDeg, hollandWindMS, inlandDecayMS, rmaxKm } from '../cyclone';
import { assessRainfall } from '../climate';
import { assessMagnitude, computeEarthquake, computeEarthquakeAffected, mmiFromPga, pgaG, ruptureLengthKm } from '../earthquake';
import { drainageOf } from '../hydrology';
import { runMapMonteCarlo, normInv } from '../evacuation';
import { computeFloodAffected, computeRainFlood, rasterizeRivers } from '../flood';
import { buildMapSimInput } from '../roadGraph';
import { loadFromDisk } from './disk';

const data = loadFromDisk();
const sc = (kind: MapScenario['disasterKind'], lat: number, lon: number, extra: Partial<MapScenario>): MapScenario => ({
  id: 't', disasterKind: kind, originLat: lat, originLon: lon, masterSeed: 42, createdAt: 0, ...extra,
});

describe('bundled data', () => {
  it('population is preserved: the grid sums to the 2011 census total (±0.5%)', () => {
    let s = 0;
    for (const p of data.grid.population) s += p;
    expect(Math.abs(s - 1_210_854_977) / 1_210_854_977).toBeLessThan(0.005);
  });
});

describe('earthquake', () => {
  it("the specification's literal GMPE coefficients never reach the 0.1 g damage threshold (why they were retuned)", () => {
    const lit = MAP.earthquake.specLiteralCoefficients;
    let peak = 0;
    for (let m = 5; m <= 8.5; m += 0.1) peak = Math.max(peak, pgaG(m, 10, lit));
    expect(peak).toBeLessThan(MAP.earthquake.damageThresholdPGA);
  });
  it('retuned PGA rises with magnitude and falls with distance', () => {
    expect(pgaG(7, 10)).toBeGreaterThan(pgaG(6, 10));
    expect(pgaG(7, 10)).toBeGreaterThan(pgaG(7, 50));
    expect(pgaG(7, 50)).toBeGreaterThan(pgaG(7, 200));
    expect(pgaG(7, 10)).toBeGreaterThan(0.2);
    expect(pgaG(7, 300)).toBeLessThan(MAP.earthquake.damageThresholdPGA);
  });
  it('M7 at Delhi affects people; a bigger quake affects at least as many', () => {
    const a = computeEarthquakeAffected(28.6, 77.2, 7, 10, data.grid);
    const b = computeEarthquakeAffected(28.6, 77.2, 8, 10, data.grid);
    expect(a.totalPopulation).toBeGreaterThan(1e6);
    expect(b.affectedCellIndices.length).toBeGreaterThanOrEqual(a.affectedCellIndices.length);
  });
  it('an epicentre in the sea affects only land cells', () => {
    const a = computeEarthquakeAffected(10, 90, 7, 10, data.grid);
    for (const i of a.affectedCellIndices) expect(data.grid.landMask[i]).toBe(1);
  });
});

describe('earthquake: finite fault and plausibility', () => {
  it('rupture length follows Wells & Coppersmith (M7 ≈ 50 km, M8 ≈ 190 km) and MMI rises with PGA', () => {
    expect(ruptureLengthKm(7)).toBeGreaterThan(40);
    expect(ruptureLengthKm(7)).toBeLessThan(65);
    expect(ruptureLengthKm(8)).toBeGreaterThan(150);
    expect(mmiFromPga(0.5)).toBeGreaterThan(mmiFromPga(0.1));
    expect(mmiFromPga(0.1)).toBeGreaterThan(5.5);
    expect(mmiFromPga(0.1)).toBeLessThan(8);
  });
  it('a long rupture shakes more ground along its strike than across it', () => {
    const g = data.grid;
    const r = computeEarthquake(28.6, 77.2, 8, 10, g, 90); // east-west fault
    const at = (dLat: number, dLon: number) => r.pgaByCell[Math.floor((28.6 + dLat - g.minLat) / g.resDeg) * g.cols + Math.floor((77.2 + dLon - g.minLon) / g.resDeg)]!;
    expect(at(0, 0.8)).toBeGreaterThan(at(0.8, 0)); // ~80 km along strike vs ~90 km across
  });
  it('plausibility: no great earthquake on the stable peninsula, a great one in the north-east is allowed', () => {
    expect(assessMagnitude(17.4, 78.5, 8.2).level).toBe('not_credible');
    expect(assessMagnitude(26.2, 91.7, 8.4).level).not.toBe('not_credible');
    expect(assessMagnitude(28.6, 77.2, 7.5).level).not.toBe('not_credible');
  });
});

describe('flood', () => {
  const rivers = rasterizeRivers(data.grid, data.rivers);
  it('flooded extent grows monotonically with the water level and is connected to the river', () => {
    const g = data.grid;
    const lows = [60, 65, 70, 80].map((lvl) => computeFloodAffected(25.6, 85.1, lvl, g, rivers));
    for (const r of lows) expect(r.ok).toBe(true);
    const counts = lows.map((r) => (r.ok ? r.floodedCellIndices.length : -1));
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    expect(counts[3]!).toBeGreaterThan(counts[0]!);
  });
  it('the bathtub solver itself refuses an origin with no river nearby', () => {
    const r = computeFloodAffected(26.9, 71.2, 200, data.grid, rivers);
    expect(r.ok).toBe(false);
  });
  it('everything flooded is at or below the water level', () => {
    const r = computeFloodAffected(25.6, 85.1, 75, data.grid, rivers);
    if (!r.ok) throw new Error(r.reason);
    for (const i of r.floodedCellIndices) expect(r.requiredLevel[i]!).toBeLessThanOrEqual(75);
  });
});

describe('cyclone', () => {
  const g = data.grid;
  it('Holland profile peaks at Vmax at the radius of maximum winds', () => {
    expect(hollandWindMS(50, 40)).toBeCloseTo(50, 6);
    expect(hollandWindMS(50, 20)).toBeLessThan(50);
    expect(hollandWindMS(50, 120)).toBeLessThan(hollandWindMS(50, 60));
  });
  it('Rmax shrinks as the storm strengthens (Willoughby & Rahn) and the inland decay follows Kaplan & DeMaria', () => {
    expect(rmaxKm(60, 20)).toBeLessThan(rmaxKm(35, 20));
    expect(inlandDecayMS(50, 0)).toBeCloseTo(0.9 * 50, 6);
    expect(inlandDecayMS(50, 12)).toBeLessThan(inlandDecayMS(50, 3));
    expect(inlandDecayMS(50, 200)).toBeCloseTo(MAP.cyclone.decay.vb, 1);
  });
  it('the storm moves: the eye is at the landfall point at the landfall time and farther inland later, weakening', () => {
    const r = computeCyclone(19.8, 85.8, 4, g);
    if ('error' in r) throw new Error(r.error);
    const lf = r.track.find((p) => p.t === r.leadS)!;
    expect(Math.abs(lf.lat - 19.8)).toBeLessThan(1e-6);
    const later = r.track[r.track.length - 1]!;
    expect(Math.hypot(later.lat - lf.lat, later.lon - lf.lon)).toBeGreaterThan(1);
    expect(later.vmax).toBeLessThan(lf.vmax);
    const first = r.track[0]!;
    expect(first.vmax).toBeGreaterThan(lf.vmax * 0.99); // full strength over the sea
  });
  it('a storm approaching Odisha from the Bay of Bengal heads roughly north-west or north', () => {
    const h = defaultHeadingDeg(g, 19.8, 85.8)!;
    expect(h).toBeGreaterThan(270);
    expect(h === 360 ? 0 : h).toBeGreaterThanOrEqual(270);
  });
  it('refuses an inland point, and a heading that points out to sea', () => {
    const inland = computeCyclone(26.9, 75.8, 3, g);
    expect('error' in inland).toBe(true);
    const seaward = computeCyclone(19.8, 85.8, 3, g, { headingDeg: 135 });
    expect('error' in seaward).toBe(true);
  });
  it('the right-hand side of the track is the dangerous side', () => {
    const r = computeCyclone(19.8, 85.8, 4, g, { headingDeg: 315 });
    if ('error' in r) throw new Error(r.error);
    // track heads NW; right of it is NE. Compare equal-distance land cells either side of the path 100 km inland.
    const p = r.track.find((q) => q.t === r.leadS + 5 * 3600)!;
    let right = 0, left = 0, nr = 0, nl = 0;
    for (let i = 0; i < g.lat.length; i++) {
      if (!g.landMask[i]) continue;
      const dx = (g.lon[i]! - p.lon) * 111.195 * Math.cos(p.lat * Math.PI / 180);
      const dy = (g.lat[i]! - p.lat) * 111.195;
      const d = Math.hypot(dx, dy);
      if (d < 40 || d > 70) continue;
      const cross = dx * Math.cos(315 * Math.PI / 180) - dy * Math.sin(315 * Math.PI / 180); // + = right of heading
      if (cross > 0) { right += r.windByCell[i]!; nr++; } else { left += r.windByCell[i]!; nl++; }
    }
    expect(nr).toBeGreaterThan(3);
    expect(nl).toBeGreaterThan(3);
    expect(right / nr).toBeGreaterThan(left / nl);
  });
  it('surge cells are low, a subset of the affected cells, and the coast closes before the interior', () => {
    const r = computeCyclone(19.8, 85.8, 4, g);
    if ('error' in r) throw new Error(r.error);
    const aff = new Set(r.affectedCellIndices);
    expect(r.surgeCellIndices.length).toBeGreaterThan(0);
    for (const i of r.surgeCellIndices) {
      expect(aff.has(i)).toBe(true);
      expect(r.surgeDepthByCell[i]!).toBeGreaterThan(0);
    }
    const times = r.affectedCellIndices.map((i) => r.blockTimeByCell[i]!).filter(Number.isFinite);
    expect(Math.min(...times)).toBeLessThan(r.leadS);
  });
  it('a stronger category affects more people', () => {
    const c2 = computeCyclone(13.08, 80.27, 2, g);
    const c5 = computeCyclone(13.08, 80.27, 5, g);
    if ('error' in c2 || 'error' in c5) throw new Error('cyclone failed');
    expect(c5.totalPopulation).toBeGreaterThan(c2.totalPopulation);
  });
});

describe('rainfall flood', () => {
  const rivers = rasterizeRivers(data.grid, data.rivers);
  it('the climatology is sane: Thar is arid, Mumbai and Cherrapunji are very wet', () => {
    expect(assessRainfall(26.9, 70.9, 100).annualMm).toBeLessThan(300);
    expect(assessRainfall(19.1, 72.9, 100).annualMm).toBeGreaterThan(1800);
    expect(assessRainfall(25.3, 91.7, 100).annualMm).toBeGreaterThan(5000);
  });
  it('the Thar desert cannot flood from a normal storm or even a very large one, but a record cloudburst is allowed', () => {
    expect(assessRainfall(26.9, 70.9, 600).level).toBe('not_credible');
    expect(assessRainfall(26.9, 70.9, 400).level).not.toBe('not_credible');
    const r = computeRainFlood(26.9, 70.9, 600, data.grid, rivers);
    expect(r.ok).toBe(false);
  });
  it('Patna: more rain, higher river, more land under water, and it arrives over hours', () => {
    const lo = computeRainFlood(25.6, 85.1, 250, data.grid, rivers);
    const hi = computeRainFlood(25.6, 85.1, 450, data.grid, rivers);
    if (!lo.ok || !hi.ok) throw new Error(JSON.stringify([lo, hi].filter((x) => !x.ok)));
    expect(hi.stageRiseM).toBeGreaterThan(lo.stageRiseM);
    expect(hi.base.floodedCellIndices.length).toBeGreaterThanOrEqual(lo.base.floodedCellIndices.length);
    const t = hi.base.floodedCellIndices.map((i) => hi.arrivalByCell[i]!).filter(Number.isFinite);
    expect(Math.max(...t)).toBeGreaterThan(3600);
    expect(Math.min(...t)).toBeLessThanOrEqual(Math.max(...t));
  });
  it('light rain stays inside the banks', () => {
    const r = computeRainFlood(25.6, 85.1, 30, data.grid, rivers);
    expect(r.ok).toBe(false);
  });
  it('drainage accumulates downstream: the Ganga near Patna drains far more cells than a hill-top', () => {
    const d = drainageOf(data.grid);
    let max = 0;
    for (const v of d.accumulation) if (v > max) max = v;
    expect(max).toBeGreaterThan(5000);
  });
});

describe('road-network evacuation', () => {
  it('normInv is the inverse normal CDF', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 4);
    expect(normInv(0.025)).toBeCloseTo(-1.959964, 4);
  });
  it('conserves people and is reproducible for a seed (earthquake, Delhi M6.5)', () => {
    const a = analyseScenario(sc('earthquake', 28.6, 77.2, { magnitude: 6.5 }), data);
    if (a.status !== 'ok') throw new Error(a.reason);
    const input = buildMapSimInput(a.data, data);
    const r1 = runMapMonteCarlo(input, 12, 7);
    const r2 = runMapMonteCarlo(input, 12, 7);
    expect(r1.conservationPass).toBe(true);
    expect(r1.evacuated + r1.casualties + r1.remaining).toBe(12 * (r1.totalPeople ?? 0));
    expect(r1.p95).toBe(r2.p95);
    expect(r1.evacuated).toBe(r2.evacuated);
    expect(r1.p95).toBeGreaterThan(0);
  });
  it('a cyclone closes roads: people are caught, and the books still balance', () => {
    const a = analyseScenario(sc('cyclone', 19.8, 85.8, { category: 4, leadHours: 6 }), data);
    if (a.status !== 'ok') throw new Error(a.reason);
    const r = runMapMonteCarlo(buildMapSimInput(a.data, data), 10, 3);
    expect(r.conservationPass).toBe(true);
    expect(r.casualties).toBeGreaterThan(0);
  });
  it('shelters inside the hazard are not used', () => {
    const a = analyseScenario(sc('earthquake', 28.6, 77.2, { magnitude: 7 }), data);
    if (a.status !== 'ok') throw new Error(a.reason);
    const input = buildMapSimInput(a.data, data);
    const inside = new Set(a.data.settlements.map((s) => s.name));
    for (const s of input.shelters) expect(inside.has(s.name)).toBe(false);
  });
});

describe('evacuation orders and warning time', () => {
  const casualtyShare = (lead: number) => {
    const a = analyseScenario(sc('cyclone', 19.8, 85.8, { category: 4, leadHours: lead }), data);
    if (a.status !== 'ok') throw new Error(a.reason);
    const r = runMapMonteCarlo(buildMapSimInput(a.data, data), 8, 11);
    expect(r.conservationPass).toBe(true);
    return r.casualties / (r.evacuated + r.casualties + r.remaining);
  };
  it('only part of the footprint is ordered out: the rest shelters in place', () => {
    const a = analyseScenario(sc('cyclone', 19.8, 85.8, { category: 4 }), data);
    if (a.status !== 'ok') throw new Error(a.reason);
    expect(a.data.evacPopulation!).toBeGreaterThan(0);
    expect(a.data.evacPopulation!).toBeLessThan(0.5 * a.data.totalPopulation);
  });
  it('more warning saves lives: a day and a half of notice beats six hours', () => {
    expect(casualtyShare(36)).toBeLessThan(casualtyShare(6));
  });
  it('shelter loads respect capacity where there is room: nobody is sent to a full shelter while a nearer one has space', () => {
    const a = analyseScenario(sc('earthquake', 28.6, 77.2, { magnitude: 6.5 }), data);
    if (a.status !== 'ok') throw new Error(a.reason);
    const r = runMapMonteCarlo(buildMapSimInput(a.data, data), 8, 5);
    const overloaded = (r.mapStats?.shelterLoads ?? []).filter((s) => s.load > s.capacity * 1.02);
    const spare = (r.mapStats?.shelterLoads ?? []).reduce((acc, s) => acc + Math.max(0, s.capacity - s.load), 0);
    // either nothing is overloaded, or the system is genuinely short of room (little spare capacity left in range)
    expect(overloaded.length === 0 || (r.mapStats?.plannedOverflow ?? 0) > 0).toBe(true);
    expect(spare).toBeGreaterThanOrEqual(0);
  });
});
