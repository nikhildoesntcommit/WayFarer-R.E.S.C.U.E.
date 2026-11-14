import { BSI, DOOR, FINDINGS, MAP } from '../constants';
import { hav } from '../engine/disaster/geo';
import { isFinalExitDoor } from '../utils/exits';
import { peopleSources, totalPeople } from '../utils/sources';
import { doorCapacity } from '../engine/doors';
import { weidmannSpeed } from '../engine/speed';
import type { Door, Finding, MapScenario, Plan, SimulationResult } from '../types';
import { boundingBox, closestOnSegment, dist, polygonCentroid } from '../utils/geo';
import { percentileSorted } from '../utils/stats';
import { templates } from './templates';

/** "Exit A", "Exit B", ... in plan order. */
export function exitLabels(plan: Plan | null): Record<string, string> {
  const out: Record<string, string> = {};
  (plan?.doors ?? []).filter((d) => d.isExit).forEach((d, i) => { out[d.id] = `Exit ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`; });
  return out;
}

function doorOf(plan: Plan | null, id: string): Door | undefined {
  return plan?.doors.find((d) => d.id === id);
}

function cellToWorld(plan: Plan, cell: { row: number; col: number }): { x: number; y: number } {
  const bb = boundingBox(plan.buildingPerimeterWorld);
  return { x: bb.minX + (cell.col + 0.5) * plan.metresPerCell, y: bb.minY + (cell.row + 0.5) * plan.metresPerCell };
}

function doorCentre(d: Door) {
  return { x: (d.startWorld.x + d.endWorld.x) / 2, y: (d.startWorld.y + d.endWorld.y) / 2 };
}

function safeCapacity(widthM: number): number {
  try {
    return doorCapacity(widthM);
  } catch {
    return 0;
  }
}

export function generateFindings(result: SimulationResult, plan: Plan | null, scenario: MapScenario | null): Finding[] {
  const out: Finding[] = [];
  if (!result.conservationPass) {
    const expected = (result.totalPeople ?? 0) * result.runs;
    out.push({
      id: 'conservation_failure', severity: 'critical', category: 'bottleneck',
      evidence: { evacuated: result.evacuated, casualties: result.casualties, remaining: result.remaining, expected },
      ...templates.conservation_failure({ evacuated: result.evacuated, casualties: result.casualties, remaining: result.remaining, expected }),
    });
  }
  if (scenario || result.mapStats) return [...out, ...mapFindings(result, scenario)];
  if (!plan) return out;
  return [...out, ...buildingFindings(result, plan)];
}

// ---------------------------------------------------------------------------------------------
// Path A / B
// ---------------------------------------------------------------------------------------------
function buildingFindings(result: SimulationResult, plan: Plan): Finding[] {
  const out: Finding[] = [];
  const labels = exitLabels(plan);
  const exitIds = Object.keys(result.exitUtilisation);
  const total = result.totalPeople ?? totalPeople(plan);
  const lowest = (except?: string) => exitIds.filter((id) => id !== except).sort((a, b) => result.exitUtilisation[a]! - result.exitUtilisation[b]!)[0];

  /** The cluster that sends most people (in absolute terms) through `exitId`. */
  const biggestUser = (exitId: string) => {
    let best: { id: string; label: string; people: number; n: number } | null = null;
    for (const c of peopleSources(plan)) {
      const share = result.clusterExitShare?.[c.id]?.[exitId] ?? 0;
      const n = share * c.people;
      if (n > 0.5 && (!best || n > best.n)) best = { id: c.id, label: c.label, people: c.people, n };
    }
    return best;
  };
  const baseEvidence = (id: string) => {
    const door = doorOf(plan, id);
    const w = door?.widthM ?? 0;
    return {
      exitId: id, exitLabel: labels[id] ?? id, utilisation: result.exitUtilisation[id] ?? 0,
      loadPersons: result.exitLoads[id] ?? 0, totalPeople: total,
      queueMeanSeconds: result.exitQueueTimes[id] ?? 0, queueMaxSeconds: result.exitQueueMaxTimes?.[id] ?? 0,
      widthM: w, effectiveWidthM: Math.max(0, w - 2 * DOOR.boundaryLayerPerSide), capacityPersonsPerSecond: safeCapacity(w),
      newWidthM: Math.round(w * FINDINGS.widenFactor * 100) / 100,
    };
  };
  const widen = (id: string) => ({ kind: 'widen_exit' as const, doorId: id, newWidthM: Math.round((doorOf(plan, id)?.widthM ?? 0) * FINDINGS.widenFactor * 100) / 100 });

  // --- exit overload ---
  const criticalExits = new Set<string>();
  for (const id of exitIds) {
    const u = result.exitUtilisation[id]!;
    if (u > FINDINGS.criticalUtilisation) {
      criticalExits.add(id);
      const evidence = baseEvidence(id);
      out.push({ id: `exit_overload_critical_${id}`, severity: 'critical', category: 'exit_overload', evidence, ...templates.exit_overload_critical(evidence), action: widen(id) });
    }
  }
  for (const id of exitIds) {
    const u = result.exitUtilisation[id]!;
    if (u > FINDINGS.overloadUtilisation && !criticalExits.has(id)) {
      const under = exitIds.filter((o) => o !== id && result.exitUtilisation[o]! < FINDINGS.underusedUtilisation).sort((a, b) => result.exitUtilisation[a]! - result.exitUtilisation[b]!)[0];
      if (!under) continue;
      const user = biggestUser(id);
      const evidence = {
        ...baseEvidence(id), underusedId: under, underusedLabel: labels[under] ?? under, underusedUtilisation: result.exitUtilisation[under]!,
        clusterId: user?.id, clusterLabel: user?.label, clusterPeople: user?.people,
      };
      out.push({
        id: `exit_overload_${id}`, severity: 'warning', category: 'exit_overload', evidence, ...templates.exit_overload(evidence),
        action: user ? { kind: 'reassign_cluster', clusterId: user.id, toExitId: under } : undefined,
      });
    }
  }

  // --- density bottleneck ---
  if ((result.bottleneckSeconds ?? 0) > BSI.flagDuration && result.bottleneckCell) {
    const at = cellToWorld(plan, result.bottleneckCell);
    const exits = plan.doors.filter((d) => d.isExit);
    const nearest = exits.sort((a, b) => dist(doorCentre(a), at) - dist(doorCentre(b), at))[0];
    const peak = result.peakDensity ?? 0;
    const evidence = {
      cell: result.bottleneckCell, xM: at.x, yM: at.y, thresholdPerM2: BSI.rhoCritical, secondsAbove: result.bottleneckSeconds, peakDensity: peak,
      speedAtPeak: weidmannSpeed(Math.max(peak, BSI.rhoCritical)),
      nearestExitId: nearest?.id, nearestExitLabel: nearest ? labels[nearest.id] : undefined, widthM: nearest?.widthM,
    };
    out.push({
      id: 'bottleneck_density', severity: 'critical', category: 'bottleneck', evidence, ...templates.bottleneck_density(evidence),
      action: nearest ? widen(nearest.id) : undefined,
    });
  }

  // --- queues ---
  for (const id of exitIds) {
    const q = result.exitQueueMaxTimes?.[id] ?? 0;
    if (q > FINDINGS.queueCriticalS) {
      const evidence = baseEvidence(id);
      out.push({ id: `queue_critical_${id}`, severity: 'critical', category: 'queue', evidence, ...templates.queue_critical(evidence), action: widen(id) });
    } else if (q > FINDINGS.queueWarningS) {
      const under = lowest(id);
      const user = biggestUser(id);
      const evidence = { ...baseEvidence(id), underusedLabel: under ? labels[under] : undefined, clusterId: user?.id, clusterLabel: user && under ? user.label : undefined, clusterPeople: user?.people };
      out.push({
        id: `queue_warning_${id}`, severity: 'warning', category: 'queue', evidence, ...templates.queue_warning(evidence),
        action: user && under ? { kind: 'reassign_cluster', clusterId: user.id, toExitId: under } : widen(id),
      });
    }
  }

  // --- unreachable zones ---
  for (const zoneId of result.unreachable) {
    const zone = peopleSources(plan).find((c) => c.id === zoneId);
    if (!zone) continue;
    const ctr = polygonCentroid(zone.polygonWorld);
    const bb = boundingBox(plan.buildingPerimeterWorld);
    const sides: [string, number][] = [['south', ctr.y - bb.minY], ['north', bb.maxY - ctr.y], ['west', ctr.x - bb.minX], ['east', bb.maxX - ctr.x]];
    sides.sort((a, b) => a[1] - b[1]);
    // nearest wall segment to the zone, for the automatic what-if
    let action: Finding['action'];
    let best = Infinity;
    for (const s of plan.wallSegments ?? []) {
      const c = closestOnSegment(ctr, s.a, s.b);
      if (c.d < best && dist(s.a, s.b) >= 1.2) {
        const len = dist(s.a, s.b);
        const ux = (s.b.x - s.a.x) / len;
        const uy = (s.b.y - s.a.y) / len;
        const half = 0.6;
        const t = Math.min(len - half, Math.max(half, c.t * len));
        const door = {
          id: `exit-new-${zoneId}`, wallId: s.id, widthM: 1.2, isExit: true,
          startWorld: { x: s.a.x + ux * (t - half), y: s.a.y + uy * (t - half) },
          endWorld: { x: s.a.x + ux * (t + half), y: s.a.y + uy * (t + half) },
        };
        // a new FINAL exit can only be cut into the outer wall; interior walls do not lead outside
        if (!isFinalExitDoor(door, plan.buildingPerimeterWorld)) continue;
        best = c.d;
        action = { kind: 'add_exit', door };
      }
    }
    const evidence = { zoneId, zoneLabel: zone.label, people: zone.people, side: sides[0]![0] };
    out.push({ id: `unreachable_${zoneId}`, severity: 'critical', category: 'unreachable', evidence, ...templates.unreachable_zones(evidence), action });
  }

  // --- casualty clustering ---
  const hs = result.casualtyHotspot;
  if (hs && hs.meanPerRun >= FINDINGS.casualtyClusterCount) {
    const evidence = { xM: hs.x, yM: hs.y, meanPerRun: hs.meanPerRun, totalCasualtiesPerRun: result.casualties / result.runs };
    out.push({ id: 'casualty_clustering', severity: 'warning', category: 'casualty', evidence, ...templates.casualty_clustering(evidence) });
  }

  // --- slow cluster ---
  if (result.clusterMeanTimes && result.completionTimes.length > 0) {
    const p95Person = percentileSorted(result.completionTimes, 95);
    for (const c of peopleSources(plan)) {
      const mean = result.clusterMeanTimes[c.id];
      if (mean !== undefined && Number.isFinite(mean) && mean > p95Person) {
        const evidence = { clusterId: c.id, clusterLabel: c.label, meanSeconds: mean, p95PersonSeconds: p95Person };
        out.push({ id: `slow_cluster_${c.id}`, severity: 'note', category: 'slow_cluster', evidence, ...templates.slow_cluster(evidence) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Path C
// ---------------------------------------------------------------------------------------------
function mapFindings(result: SimulationResult, scenario: MapScenario | null): Finding[] {
  const out: Finding[] = [];
  const ms = result.mapStats;
  if (!ms) return out;
  const totalPop = result.totalPeople ?? 0;

  for (const e of ms.edgeFlowShare) {
    if (e.share > FINDINGS.roadBottleneckShare) {
      const evidence = { edgeId: e.edgeId, label: e.label, share: e.share };
      out.push({ id: `road_bottleneck_${e.edgeId}`, severity: 'critical', category: 'road_bottleneck', evidence, ...templates.road_bottleneck(evidence) });
    }
  }
  // a regional run can overload hundreds of shelters; the report lists the five worst, not all of them
  const over = ms.shelterLoads
    .filter((s) => s.capacity > 0 && s.load / s.capacity > FINDINGS.shelterOverloadRatio)
    .sort((a, b) => b.load - b.capacity - (a.load - a.capacity))
    .slice(0, 5);
  const spare = ms.shelterLoads.filter((s) => s.load < s.capacity).sort((a, b) => (b.capacity - b.load) - (a.capacity - a.load));
  for (const s of over) {
    // the alternative must be genuinely nearby (within the alternate range), nearest first
    const alt = spare
      .filter((x) => x.shelterId !== s.shelterId && x.lat !== undefined && s.lat !== undefined && hav(x.lat, x.lon!, s.lat, s.lon!) <= MAP.evac.alternateRangeKm)
      .sort((a, b) => hav(a.lat!, a.lon!, s.lat!, s.lon!) - hav(b.lat!, b.lon!, s.lat!, s.lon!))[0];
    const excess = s.load - s.capacity;
    const evidence = { shelterId: s.shelterId, shelterName: s.name, load: s.load, capacity: s.capacity, ratio: s.load / s.capacity, excess, alternateId: alt?.shelterId, alternateName: alt?.name };
    out.push({
      id: `shelter_overload_${s.shelterId}`, severity: 'critical', category: 'shelter_overload', evidence, ...templates.shelter_overload(evidence),
      action: alt ? { kind: 'reassign_shelter', fromShelterId: s.shelterId, toShelterId: alt.shelterId, people: Math.round(Math.min(excess, alt.capacity - alt.load)) } : undefined,
    });
  }
  if (over.length > 0) {
    const unused = ms.shelterLoads
      .filter((s) => s.capacity > 0 && s.load / s.capacity < FINDINGS.shelterUnderusedRatio && over.some((o) => o.lat !== undefined && s.lat !== undefined && hav(o.lat, o.lon!, s.lat, s.lon!) <= MAP.evac.alternateRangeKm))
      .sort((a, b) => b.capacity - b.load - (a.capacity - a.load))
      .slice(0, 3);
    for (const s of unused) {
      {
        const evidence = { shelterId: s.shelterId, shelterName: s.name, load: s.load, capacity: s.capacity, ratio: s.load / s.capacity };
        out.push({ id: `shelter_underused_${s.shelterId}`, severity: 'warning', category: 'shelter_overload', evidence, ...templates.shelter_underused(evidence) });
      }
    }
  }
  if (ms.floodTimingGapMin !== undefined && ms.floodTimingGapMin > 0) {
    const evidence = { gapMin: ms.floodTimingGapMin, region: ms.floodRegion ?? 'the affected area', population: totalPop, disaster: scenario?.disasterKind };
    out.push({ id: 'flood_timing', severity: 'critical', category: 'road_bottleneck', evidence, ...templates.flood_timing(evidence) });
  }
  if (ms.unreachablePopulation > 0) {
    const evidence = { population: ms.unreachablePopulation, share: totalPop > 0 ? ms.unreachablePopulation / (totalPop + ms.unreachablePopulation) : 1 };
    out.push({ id: 'unreachable_population', severity: 'critical', category: 'unreachable', evidence, ...templates.unreachable_population(evidence) });
  }
  return out;
}
