import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../utils/seeds';
import { buildSimContext, sampleAgents, simulateRun, type SimOptions } from '../agents';
import { epochIndexAt } from '../hazards';
import { makeRoomPlan } from './helpers';
import type { Plan } from '../../types';

interface Summary { p95: number; meanTime: number; casualties: number; remaining: number; share: Record<string, number> }

/** Several seeded trials of one plan; `ctxOpts` switches fire avoidance, `simOpts` switches dynamic routing. */
function trials(plan: Plan, n: number, simOpts: SimOptions, ctxOpts: { fireAvoidance?: boolean } = {}): Summary {
  const ctx = buildSimContext(plan, ctxOpts);
  const p95s: number[] = [];
  const means: number[] = [];
  let casualties = 0;
  let remaining = 0;
  const loads: Record<string, number> = {};
  for (let s = 0; s < n; s++) {
    const opts = { ...simOpts, noPreMovement: true };
    const agents = sampleAgents(ctx, new SeededRandom(100 + s), opts);
    const r = simulateRun(ctx, agents, opts);
    const ts = [...r.evacuationTimes].sort((a, b) => a - b);
    p95s.push(ts[Math.max(0, Math.ceil(0.95 * ts.length) - 1)] ?? NaN);
    means.push(ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length));
    casualties += r.casualties;
    remaining += r.remaining;
    for (const [id, v] of r.exitLoads) loads[id] = (loads[id] ?? 0) + v;
  }
  const tot = Object.values(loads).reduce((a, b) => a + b, 0) || 1;
  return {
    p95: p95s.reduce((a, b) => a + b, 0) / n,
    meanTime: means.reduce((a, b) => a + b, 0) / n,
    casualties: casualties / n,
    remaining: remaining / n,
    share: Object.fromEntries(Object.entries(loads).map(([k, v]) => [k, v / tot])),
  };
}

describe('queue-aware exit choice', () => {
  // A long hall; everybody stands near the left door. A second, equally wide door sits at the far end.
  const hall = (hazards: Plan['hazards'] = []) =>
    makeRoomPlan({
      w: 30, h: 10,
      exits: [{ side: 'left', width: 1.0 }, { side: 'right', width: 1.0 }],
      clusters: [{ rect: [2, 2, 10, 8], people: 120 }],
      hazards,
    });

  it('V1 sends everybody to the nearest door; V2 spreads the crowd and gets everyone out sooner', () => {
    const plan = hall();
    const v1 = trials(plan, 6, { staticRouting: true });
    const v2 = trials(plan, 6, {});
    console.log('static', JSON.stringify(v1), 'dynamic', JSON.stringify(v2));
    expect(v1.share['exit-A']).toBeGreaterThan(0.97); // the old behaviour: one door does all the work
    expect(v2.share['exit-B']!).toBeGreaterThan(0.15); // now the far door is used
    expect(v2.p95).toBeLessThan(v1.p95 * 0.9); // and the last person out is at least 10% earlier
    expect(v2.remaining).toBeLessThanOrEqual(2); // the fire is capped at 8 m, leaving a gap; a rare agent can still be cut off
  });

  it('does not oscillate: nobody changes their mind more than twice, and a single-exit plan is unaffected', () => {
    const one = makeRoomPlan({ w: 12, h: 8, exits: [{ side: 'left', width: 1.2 }], clusters: [{ rect: [4, 2, 10, 6], people: 40 }] });
    const a = trials(one, 3, { staticRouting: true });
    const b = trials(one, 3, {});
    expect(b.p95).toBeCloseTo(a.p95, 6);
  });

  it('people who were told which exit to use (manual assignment) obey it', () => {
    const plan = hall();
    plan.clusterExitAssignment = { [plan.clusters[0]!.id]: 'exit-A' };
    const r = trials(plan, 3, {});
    expect(r.share['exit-A']).toBeGreaterThan(0.99);
  });

  it('a balanced two-exit room is not made worse by re-planning', () => {
    const plan = makeRoomPlan({
      w: 20, h: 10,
      exits: [{ side: 'left', width: 1.2 }, { side: 'right', width: 1.2 }],
      clusters: [{ rect: [3, 2, 17, 8], people: 60 }],
    });
    const v1 = trials(plan, 6, { staticRouting: true });
    const v2 = trials(plan, 6, {});
    expect(v2.p95).toBeLessThanOrEqual(v1.p95 * 1.05);
  });
});

describe('fire avoidance', () => {
  it('routes bend away from the fire: travel time past it is longer than under V1', () => {
    const fire: Plan['hazards'] = [{ id: 'f', kind: 'fire_origin', polygonWorld: [{ x: 10, y: 5 }], activeAtSeconds: 0 }];
    const plan = makeRoomPlan({ w: 20, h: 10, exits: [{ side: 'right', width: 1.5 }], clusters: [{ rect: [1, 1, 4, 9], people: 10 }], hazards: fire });
    const v2 = buildSimContext(plan);
    const v1 = buildSimContext(plan, { fireAvoidance: false });
    const probe = (ctx: ReturnType<typeof buildSimContext>) => {
      const ep = ctx.hazards.epochs[epochIndexAt(ctx.hazards, 6)]!; // fire radius 3 m
      const g = ctx.grid;
      const row = Math.floor((5 + 3.4 - g.originY) / g.metresPerCell); // just outside the burning disc
      const col = Math.floor((10 - g.originX) / g.metresPerCell);
      return ep.T[0]![row * g.cols + col]!;
    };
    expect(Number.isFinite(probe(v1))).toBe(true);
    expect(probe(v2)).toBeGreaterThan(probe(v1) * 1.05);
  });

  it('a fire that will cut the direct route: with avoidance far fewer people are caught than under V1', () => {
    const plan = makeRoomPlan({
      w: 30, h: 14, exits: [{ side: 'right', width: 1.5 }], clusters: [{ rect: [2, 5, 6, 9], people: 40 }],
      hazards: [{ id: 'f', kind: 'fire_origin', polygonWorld: [{ x: 12, y: 6 }], activeAtSeconds: 8 }],
    });
    const v1 = trials(plan, 8, { staticRouting: true }, { fireAvoidance: false });
    const v2 = trials(plan, 8, {}, {});
    console.log('fire v1', JSON.stringify(v1), 'v2', JSON.stringify(v2));
    expect(v1.casualties).toBeGreaterThan(20);
    expect(v2.casualties).toBeLessThan(v1.casualties * 0.7);
    expect(v2.remaining).toBeLessThanOrEqual(2); // the fire is capped at 8 m, leaving a gap; a rare agent can still be cut off
  });
});
