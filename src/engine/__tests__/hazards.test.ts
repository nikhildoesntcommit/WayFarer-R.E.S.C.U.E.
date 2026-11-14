import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../utils/seeds';
import { buildSimContext, sampleAgents, simulateRun } from '../agents';
import { buildHazardRuntime, flameRadius, heatRelease, smokeDoseRate, smokeFrontTable } from '../hazards';
import { rasterize } from '../grid';
import { makeRoomPlan } from './helpers';
import { deriveGeometry } from '../../draw/tools';
import type { Plan } from '../../types';

describe('blocked_exit hazard', () => {
  const cluster = { rect: [2, 5, 8, 8] as [number, number, number, number], people: 40 };

  it('only exit blocked at 30 s: earlier evacuees stay evacuated, the rest remain, nobody exits afterwards', () => {
    const plan = makeRoomPlan({
      w: 10, h: 10, exits: [{ side: 'bottom', width: 0.9 }], clusters: [cluster],
      hazards: [{ id: 'b', kind: 'blocked_exit', doorId: 'exit-A', activeAtSeconds: 30 }],
    });
    const ctx = buildSimContext(plan);
    const res = simulateRun(ctx, sampleAgents(ctx, new SeededRandom(3), { noPreMovement: true }), { noPreMovement: true });
    expect(res.evacuationTimes.length).toBeGreaterThan(5); // (a) people did use it before t = 30
    expect(Math.max(...res.evacuationTimes)).toBeLessThanOrEqual(30 + 1.5); // (b)+(c) nobody is served after the block (one in service may finish)
    expect(res.remaining).toBeGreaterThan(0); // (d) the rest cannot get out
    expect(res.casualties).toBe(0);
    expect(res.evacuationTimes.length + res.remaining).toBe(40);
  });

  it('with a second exit, people re-route and everyone gets out; the blocked exit carries less', () => {
    const plan = makeRoomPlan({
      w: 10, h: 10, exits: [{ side: 'bottom', width: 1.2 }, { side: 'top', width: 1.2 }], clusters: [{ rect: [2, 2, 8, 6], people: 40 }],
      hazards: [{ id: 'b', kind: 'blocked_exit', doorId: 'exit-A', activeAtSeconds: 8 }],
    });
    const ctx = buildSimContext(plan);
    const res = simulateRun(ctx, sampleAgents(ctx, new SeededRandom(4), { noPreMovement: true }), { noPreMovement: true });
    expect(res.remaining).toBe(0);
    expect(res.exitLoads.get('exit-B')!).toBeGreaterThan(res.exitLoads.get('exit-A')!);
  });

  it('people who cannot get out are overcome by smoke; people who can leave early are not', () => {
    const fire = { id: 'f', kind: 'fire_origin' as const, polygonWorld: [{ x: 2, y: 4 }], activeAtSeconds: 0 };
    const open = makeRoomPlan({ w: 14, h: 8, exits: [{ side: 'right', width: 1.0 }], clusters: [{ rect: [1, 2, 5, 6], people: 30 }], hazards: [fire] });
    const cut = makeRoomPlan({
      w: 14, h: 8, exits: [{ side: 'right', width: 1.0 }], clusters: [{ rect: [1, 2, 5, 6], people: 30 }],
      hazards: [fire, { id: 'b', kind: 'blocked_exit', doorId: 'exit-A', activeAtSeconds: 5 }],
    });
    const run = (plan: Plan) => {
      const ctx = buildSimContext(plan);
      return simulateRun(ctx, sampleAgents(ctx, new SeededRandom(9)), {});
    };
    const a = run(open);
    const b = run(cut);
    expect(a.evacuationTimes.length + a.casualties + a.remaining).toBe(30);
    expect(b.evacuationTimes.length + b.casualties + b.remaining).toBe(30);
    expect(b.casualties).toBeGreaterThan(a.casualties);
    expect(b.casualties).toBeGreaterThan(10);
  });
});

describe('fire and smoke model', () => {
  it('heat release follows alpha t^2 and is fuel-limited; flame radius follows the burning area', () => {
    expect(heatRelease(60)).toBeCloseTo(0.0469 * 3600, 3);
    expect(heatRelease(1e4)).toBe(5000);
    expect(flameRadius(1e4)).toBeCloseTo(Math.sqrt(5000 / 500 / Math.PI), 6);
    expect(flameRadius(30)).toBeLessThan(flameRadius(90));
  });

  it('the smoke front only moves outward and travels at a plausible ceiling-jet speed', () => {
    const R = smokeFrontTable();
    for (let k = 1; k < R.length; k++) expect(R[k]!).toBeGreaterThanOrEqual(R[k - 1]!);
    expect(R[Math.round(30 / 0.5)]!).toBeGreaterThan(2); // a fast fire has pushed smoke a few metres within 30 s
    expect(R[Math.round(30 / 0.5)]!).toBeLessThan(25);
    const late = (R[R.length - 1]! - R[R.length - 21]!) / 10; // m/s over the last 10 s
    expect(late).toBeGreaterThan(0.05);
    expect(late).toBeLessThan(1.5);
  });

  it('smoke and flames do not pass through a wall, and reach people on the open side', () => {
    const plan = makeRoomPlan({
      w: 20, h: 8, exits: [{ side: 'right', width: 1 }], clusters: [{ rect: [12, 2, 18, 6], people: 10 }],
      hazards: [{ id: 'f', kind: 'fire_origin', polygonWorld: [{ x: 2, y: 4 }], activeAtSeconds: 0 }],
    });
    // an internal partition with no opening splits the room in two
    const split = deriveGeometry({ ...plan, wallSegments: [...(plan.wallSegments ?? []), { id: 'wall-mid', a: { x: 10, y: 0 }, b: { x: 10, y: 8 } }] });
    const grid = rasterize(split);
    const rt = buildHazardRuntime(split, grid, []);
    const f = rt.fires[0]!;
    let reachedLeft = 0;
    let reachedRight = 0;
    for (let i = 0; i < grid.walk.length; i++) {
      if (!grid.walk[i]) continue;
      const cx = grid.originX + ((i % grid.cols) + 0.5) * grid.metresPerCell;
      if (Number.isFinite(f.smokeAt[i]!)) { if (cx < 10) reachedLeft++; else reachedRight++; }
    }
    expect(reachedLeft).toBeGreaterThan(50);
    expect(reachedRight).toBe(0);
  });

  it('smoke dose rate is higher near the fire than far from it, and zero before the smoke arrives', () => {
    const plan = makeRoomPlan({
      w: 30, h: 8, exits: [{ side: 'right', width: 1 }], clusters: [{ rect: [20, 2, 28, 6], people: 10 }],
      hazards: [{ id: 'f', kind: 'fire_origin', polygonWorld: [{ x: 2, y: 4 }], activeAtSeconds: 0 }],
    });
    const grid = rasterize(plan);
    const rt = buildHazardRuntime(plan, grid, []);
    const cellAt = (x: number, y: number) => Math.floor((y - grid.originY) / grid.metresPerCell) * grid.cols + Math.floor((x - grid.originX) / grid.metresPerCell);
    const near = cellAt(4, 4);
    const far = cellAt(26, 4);
    expect(smokeDoseRate(rt, near, 0)).toBe(0);
    expect(smokeDoseRate(rt, near, 600)).toBeGreaterThan(smokeDoseRate(rt, far, 600));
    expect(smokeDoseRate(rt, far, 600)).toBeGreaterThan(0);
  });
});
