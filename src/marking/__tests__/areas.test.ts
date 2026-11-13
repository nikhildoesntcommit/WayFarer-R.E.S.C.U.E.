import { describe, expect, it } from 'vitest';
import { newCluster, newHotspot } from '../../draw/tools';
import { buildSimContext, sampleAgents } from '../../engine/agents';
import { runMonteCarloSync } from '../../engine/pipeline';
import { makeRoomPlan } from '../../engine/__tests__/helpers';
import type { WorldPolygon } from '../../types';
import { SeededRandom } from '../../utils/seeds';
import { checkNewArea, isSimplePolygon, overlapAreaM2, planAreaProblems } from '../areas';
import { validatePlan } from '../validation';

const rect = (x0: number, y0: number, x1: number, y1: number): WorldPolygon => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const MIX = { adult: 1, child: 0, elderly: 0, wheelchair: 0 };

describe('people areas', () => {
  it('rejects a bow-tie outline and accepts a plain one', () => {
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toBe(false);
    expect(isSimplePolygon(rect(0, 0, 3, 2))).toBe(true);
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false);
  });

  it('measures overlap area', () => {
    const o = overlapAreaM2(rect(0, 0, 4, 4), rect(2, 2, 6, 6));
    expect(o).toBeGreaterThan(3.6);
    expect(o).toBeLessThan(4.4);
    expect(overlapAreaM2(rect(0, 0, 1, 1), rect(5, 5, 6, 6))).toBe(0);
  });

  it('refuses a new area that overlaps an existing one, or lies outside the building', () => {
    const plan = makeRoomPlan({ w: 12, h: 8, exits: [{ side: 'bottom', width: 1.2 }], clusters: [{ rect: [1, 1, 6, 6], people: 10 }] });
    expect(checkNewArea(plan, rect(5, 2, 9, 5)).ok).toBe(false); // overlaps
    expect(checkNewArea(plan, rect(7, 1, 11, 5)).ok).toBe(true); // clear floor
    expect(checkNewArea(plan, rect(20, 20, 24, 24)).ok).toBe(false); // outside
    expect(checkNewArea(plan, [{ x: 7, y: 1 }, { x: 11, y: 5 }, { x: 11, y: 1 }, { x: 7, y: 5 }]).ok).toBe(false); // bow-tie
    expect(checkNewArea(plan, rect(8, 2, 8.4, 2.4)).ok).toBe(false); // tiny
  });

  it('flags overlaps that an older plan file already contains, and blocks the simulation', () => {
    const plan = makeRoomPlan({
      w: 12, h: 8, exits: [{ side: 'bottom', width: 1.2 }],
      clusters: [{ rect: [1, 1, 6, 6], people: 10 }, { rect: [4, 2, 9, 6], people: 10 }],
    });
    expect(planAreaProblems(plan)[0]).toMatch(/overlap/);
    const v = validatePlan(plan);
    expect(v.checks.find((c) => c.id === 'areas')!.ok).toBe(false);
    expect(v.canSimulate).toBe(false);
  });

  it('even if two overlapping areas slip through, nobody is placed twice on the same floor cell', () => {
    const plan = makeRoomPlan({
      w: 12, h: 8, exits: [{ side: 'bottom', width: 1.2 }],
      clusters: [{ rect: [1, 1, 6, 6], people: 10 }, { rect: [1, 1, 6, 6], people: 10 }], // identical
    });
    const ctx = buildSimContext(plan);
    expect(ctx.clusters[1]!.cells.length).toBeLessThanOrEqual(1); // the second area owns no cells of its own
    expect(ctx.totalPeople).toBe(20); // people are still counted once each
  });
});

describe('hotspots', () => {
  it('bunch people around the point, and add to the total', () => {
    let plan = makeRoomPlan({ w: 20, h: 10, exits: [{ side: 'bottom', width: 2 }], clusters: [{ rect: [1, 1, 19, 9], people: 40 }] });
    plan = { ...plan, hotspots: [newHotspot(1, { x: 15, y: 6 }, 30, 2, MIX)] };
    const ctx = buildSimContext(plan);
    expect(ctx.totalPeople).toBe(70);
    const agents = sampleAgents(ctx, new SeededRandom(5));
    const hs = agents.filter((a) => a.clusterId === plan.hotspots[0]!.id);
    expect(hs).toHaveLength(30);
    const dists = hs.map((a) => Math.hypot(a.x - 15, a.y - 6));
    expect(Math.max(...dists)).toBeLessThanOrEqual(2 + 0.75); // radius + one cell diagonal
    const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
    // uniform over a 2 m disc would average 1.33 m; a Gaussian pull toward the centre must be tighter
    expect(mean).toBeLessThan(1.2);
  });

  it('are simulated and reported like any other group of people', () => {
    let plan = makeRoomPlan({ w: 20, h: 10, exits: [{ side: 'bottom', width: 2 }], clusters: [{ rect: [1, 1, 8, 9], people: 10 }] });
    plan = { ...plan, hotspots: [newHotspot(1, { x: 16, y: 5 }, 25, 1.5, MIX)] };
    const { result } = runMonteCarloSync(plan, 5, 3);
    expect(result.totalPeople).toBe(35);
    expect(result.evacuated).toBe(5 * 35);
    expect(result.conservationPass).toBe(true);
    expect(Object.keys(result.clusterMeanTimes ?? {})).toContain(plan.hotspots[0]!.id);
  });

  it('a hotspot alone is enough to satisfy "people placed"', () => {
    let plan = makeRoomPlan({ w: 12, h: 8, exits: [{ side: 'bottom', width: 1.2 }], clusters: [] });
    plan = { ...plan, hotspots: [newHotspot(1, { x: 6, y: 4 }, 12, 2, MIX)] };
    expect(validatePlan(plan).canSimulate).toBe(true);
    void newCluster;
  });
});
