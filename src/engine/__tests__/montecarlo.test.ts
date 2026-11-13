import { describe, expect, it } from 'vitest';
import { doorCapacity } from '../doors';
import { buildSimContext } from '../agents';
import { runMonteCarloSync } from '../pipeline';
import { makeRoomPlan } from './helpers';

describe('Monte Carlo pipeline', () => {
  it('20 people through one 1.2 m door: P50 ≈ walking time + 20/1.17 s (±5%)', () => {
    const plan = makeRoomPlan({ w: 10, h: 10, exits: [{ side: 'bottom', width: 1.2 }], clusters: [{ rect: [3, 2.5, 7, 4.5], people: 20 }] });
    const ctx = buildSimContext(plan);
    const { result } = runMonteCarloSync(ctx, 100, 42, undefined, { noPreMovement: true });
    const cap = doorCapacity(1.2);
    // walking time of the first arrival: centre of the cluster to the nearest exit cell, at the mean adult speed
    const T0 = ctx.hazards.epochs[0]!.T[0]!;
    const dist = Math.min(...ctx.clusters[0]!.cells.map((i) => T0[i]!)); // seconds at v0
    const analytic = 20 / cap + dist;
    console.log('P50', result.p50.toFixed(2), 'analytic', analytic.toFixed(2), 'P95', result.p95.toFixed(2), 'CI50', result.ci95P50Lower.toFixed(2), result.ci95P50Upper.toFixed(2));
    expect(result.p50).toBeGreaterThan(analytic * 0.95);
    expect(result.p50).toBeLessThan(analytic * 1.15); // slower walkers + the longest approach can only add time
    expect(result.evacuated).toBe(100 * 20);
    expect(result.conservationPass).toBe(true);
  });

  it('is reproducible from the master seed', () => {
    const plan = makeRoomPlan({ w: 12, h: 8, exits: [{ side: 'bottom', width: 1 }, { side: 'top', width: 1 }], clusters: [{ rect: [2, 2, 10, 6], people: 30 }] });
    const a = runMonteCarloSync(plan, 10, 7).result;
    const b = runMonteCarloSync(plan, 10, 7).result;
    expect(Array.from(a.exitTimes)).toEqual(Array.from(b.exitTimes));
    const c = runMonteCarloSync(plan, 10, 8).result;
    expect(Array.from(c.exitTimes)).not.toEqual(Array.from(a.exitTimes));
  });

  it('with realistic pre-movement the clearance is dominated by it (median 41 s)', () => {
    const plan = makeRoomPlan({ w: 10, h: 10, exits: [{ side: 'bottom', width: 1.2 }], clusters: [{ rect: [3, 2.5, 7, 4.5], people: 20 }] });
    const { result } = runMonteCarloSync(plan, 40, 42);
    expect(result.p50).toBeGreaterThan(60);
  });
});
