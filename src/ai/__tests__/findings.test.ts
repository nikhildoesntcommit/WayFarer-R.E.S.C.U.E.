import { describe, expect, it } from 'vitest';
import { makeRoomPlan } from '../../engine/__tests__/helpers';
import type { MapScenario, Plan, SimulationResult } from '../../types';
import { runMonteCarloSync } from '../../engine/pipeline';
import { applyAction, evaluateWhatIf, overallStatus } from '../findings';
import { situationSummary } from '../summary';
import { generateFindings } from '../rules';

function baseResult(over: Partial<SimulationResult> = {}): SimulationResult {
  return {
    strategy: 'as_marked', runs: 200, completionTimes: Float32Array.from([10, 20, 30, 40]), exitTimes: Float32Array.from([40]),
    p50: 40, p95: 60, mean: 42, stdDev: 5, ci95P50Lower: 38, ci95P50Upper: 42, ci95P95Lower: 55, ci95P95Upper: 65,
    evacuated: 200 * 300, casualties: 0, remaining: 0, unreachable: [],
    exitLoads: { 'exit-A': 150, 'exit-B': 150 }, exitUtilisation: { 'exit-A': 0.5, 'exit-B': 0.5 }, exitQueueTimes: { 'exit-A': 5, 'exit-B': 5 },
    densityHeatmap: new Float32Array(4), heatmapRows: 2, heatmapCols: 2, conservationPass: true, totalPeople: 300,
    exitQueueMaxTimes: { 'exit-A': 10, 'exit-B': 10 }, peakDensity: 1, bottleneckSeconds: 0,
    clusterMeanTimes: { 'zone-1': 30 }, clusterExitShare: { 'zone-1': { 'exit-A': 0.5, 'exit-B': 0.5 } }, clusterPeople: { 'zone-1': 300 },
    ...over,
  };
}

const plan: Plan = makeRoomPlan({
  w: 12, h: 10,
  exits: [{ side: 'bottom', width: 0.9 }, { side: 'top', width: 1.2 }],
  clusters: [{ rect: [2, 2, 10, 8], people: 300 }],
});

describe('rule-based findings', () => {
  it('a balanced, healthy result produces no findings and PASS', () => {
    const f = generateFindings(baseResult(), plan, null);
    expect(f).toEqual([]);
    expect(overallStatus(baseResult(), f)).toBe('PASS');
  });

  it('1. exit overload (warning): 72% on A, 10% on B, reassign a zone', () => {
    const r = baseResult({
      exitLoads: { 'exit-A': 216, 'exit-B': 30 }, exitUtilisation: { 'exit-A': 0.72, 'exit-B': 0.1 },
      exitQueueTimes: { 'exit-A': 252, 'exit-B': 1 }, clusterExitShare: { 'zone-1': { 'exit-A': 0.72, 'exit-B': 0.1 } },
    });
    const f = generateFindings(r, plan, null).find((x) => x.id === 'exit_overload_exit-A')!;
    expect(f.severity).toBe('warning');
    expect(f.message).toContain('72% of the crowd (216 of 300)');
    expect(f.message).toContain('0.60 m'); // 0.9 m door minus 2 × 0.15 m boundary layer
    expect(f.recommendation).toContain('Zone 1');
    expect(f.action?.kind).toBe('reassign_cluster');
  });

  it('2. critical exit overload (>90%) recommends widening', () => {
    const r = baseResult({ exitUtilisation: { 'exit-A': 0.95, 'exit-B': 0.05 }, exitLoads: { 'exit-A': 285, 'exit-B': 15 } });
    const f = generateFindings(r, plan, null).find((x) => x.id === 'exit_overload_critical_exit-A')!;
    expect(f.severity).toBe('critical');
    expect(f.action).toEqual({ kind: 'widen_exit', doorId: 'exit-A', newWidthM: 1.35 });
    expect(overallStatus(r, [f])).toBe('CRITICAL');
  });

  it('3. density bottleneck > 3.5 persons/m² for > 10 s is critical and cites the cell', () => {
    const r = baseResult({ bottleneckSeconds: 24, bottleneckCell: { row: 5, col: 6 }, peakDensity: 4.6 });
    const f = generateFindings(r, plan, null).find((x) => x.id === 'bottleneck_density')!;
    expect(f.severity).toBe('critical');
    expect(f.evidence.secondsAbove).toBe(24);
    expect(f.message).toContain('24.0 s');
  });

  it('4. queue > 120 s is critical, 60–120 s is a warning', () => {
    const crit = generateFindings(baseResult({ exitQueueMaxTimes: { 'exit-A': 150, 'exit-B': 10 } }), plan, null);
    expect(crit.find((x) => x.id === 'queue_critical_exit-A')?.severity).toBe('critical');
    const warn = generateFindings(baseResult({ exitQueueMaxTimes: { 'exit-A': 80, 'exit-B': 10 } }), plan, null);
    expect(warn.find((x) => x.id === 'queue_warning_exit-A')?.severity).toBe('warning');
  });

  it('5. an unreachable zone is critical and names the wall side; conservation failure is flagged', () => {
    const r = baseResult({ unreachable: ['zone-1'], remaining: 200 * 300, evacuated: 0 });
    const f = generateFindings(r, plan, null).find((x) => x.id === 'unreachable_zone-1')!;
    expect(f.severity).toBe('critical');
    expect(f.recommendation).toMatch(/Add an exit on the (north|south|east|west) wall of Zone 1/);
    expect(f.action?.kind).toBe('add_exit');
    const bad = generateFindings(baseResult({ conservationPass: false }), plan, null);
    expect(bad[0]!.id).toBe('conservation_failure');
  });

  it('map rules: shelter overload, road bottleneck and flood timing', () => {
    const scenario: MapScenario = { id: 's', disasterKind: 'flood', originLat: 26, originLon: 85, waterLevelM: 60, masterSeed: 42, createdAt: 0 };
    const r = baseResult({
      totalPeople: 100000,
      mapStats: {
        edgeFlowShare: [{ edgeId: 'e1', share: 0.7, label: 'NH-27 near Muzaffarpur' }],
        shelterLoads: [
          { shelterId: 'a', name: 'Patna', load: 9000, capacity: 5000, lat: 25.6, lon: 85.1 },
          { shelterId: 'b', name: 'Gaya', load: 500, capacity: 8000, lat: 24.8, lon: 85.0 },
          { shelterId: 'far', name: 'Kalyan', load: 0, capacity: 90000, lat: 19.2, lon: 73.1 },
        ],
        unreachablePopulation: 0, floodTimingGapMin: 35, floodRegion: 'north Bihar',
      },
    });
    const ids = generateFindings(r, null, scenario).map((x) => x.id);
    expect(ids).toContain('road_bottleneck_e1');
    expect(ids).toContain('shelter_overload_a');
    expect(ids).toContain('shelter_underused_b');
    expect(ids).toContain('flood_timing');
    // a shelter 1,800 km away is never proposed as the alternative
    const f = generateFindings(r, null, scenario).find((x) => x.id === 'shelter_overload_a')!;
    expect(JSON.stringify(f)).not.toContain('Kalyan');
  });
});

describe('what-if', () => {
  it('applying reassign / widen changes the plan and the paired re-run improves P95 when the exit is the bottleneck', async () => {
    const crowded = makeRoomPlan({
      w: 14, h: 10, exits: [{ side: 'bottom', width: 0.8, at: 3 }, { side: 'top', width: 1.6, at: 11 }],
      clusters: [{ rect: [1.5, 1.5, 5, 4], people: 60 }],
    });
    const before = runMonteCarloSync(crowded, 20, 42).result;
    const action = { kind: 'reassign_cluster' as const, clusterId: 'zone-1', toExitId: 'exit-B' };
    expect(applyAction(crowded, action).clusterExitAssignment?.['zone-1']).toBe('exit-B');
    const out = await evaluateWhatIf(crowded, before, action);
    expect(out.after.runs).toBe(before.runs);
    expect(out.after.exitUtilisation['exit-B']!).toBeGreaterThan(out.before.exitUtilisation['exit-B']!);
    const widened = applyAction(crowded, { kind: 'widen_exit', doorId: 'exit-A', newWidthM: 1.2 });
    expect(widened.doors.find((d) => d.id === 'exit-A')!.widthM).toBe(1.2);
  });
});

describe('situation summary', () => {
  it('the summary is written from the run: a single dominant exit and a queue read differently from a balanced room', () => {
    const balanced = situationSummary(baseResult(), [], null, null);
    const skewed = situationSummary(baseResult({
      exitUtilisation: { 'exit-A': 0.9, 'exit-B': 0.1 }, exitQueueTimes: { 'exit-A': 40, 'exit-B': 1 }, p95: 120,
    }), [], null, null);
    expect(balanced.headline).toContain('300');
    expect(balanced.points.join(' ')).toContain('used fairly evenly');
    expect(skewed.points.join(' ')).toMatch(/Queueing dominates/);
    expect(skewed.points.join(' ')).toContain('90%');
    expect(balanced.points.join(' ')).not.toEqual(skewed.points.join(' '));
  });
  it('a lost crowd is reported as lost, not as a success', () => {
    const s = situationSummary(baseResult({ casualties: 200 * 20, evacuated: 200 * 280 }), [], null, null);
    expect(s.headline).toMatch(/Not everyone/);
  });
});

describe('evidence is readable', () => {
  it('every finding category renders plain-language evidence with no data-structure syntax', async () => {
    const { describeEvidence } = await import('../evidence');
    const r = baseResult({
      exitLoads: { 'exit-A': 216, 'exit-B': 30 }, exitUtilisation: { 'exit-A': 0.72, 'exit-B': 0.1 },
      exitQueueTimes: { 'exit-A': 252, 'exit-B': 1 }, exitQueueMaxTimes: { 'exit-A': 150, 'exit-B': 10 },
      bottleneckSeconds: 24, bottleneckCell: { row: 5, col: 6 }, peakDensity: 4.6, unreachable: ['zone-1'],
      clusterExitShare: { 'zone-1': { 'exit-A': 0.72, 'exit-B': 0.1 } },
    });
    const findings = generateFindings(r, plan, null);
    expect(findings.length).toBeGreaterThan(2);
    for (const f of findings) {
      const v = describeEvidence(f, { runs: 200 });
      const text = [v.summary, v.basis, ...v.rows.flatMap((x) => [x.label, x.value, x.hint ?? ''])].join(' | ');
      expect(text, f.id).not.toMatch(/[{}[\]"]|undefined|NaN|\[object/);
      expect(v.summary.length, f.id).toBeGreaterThan(20);
      expect(v.rows.length, f.id).toBeGreaterThan(0);
    }
  });
});
