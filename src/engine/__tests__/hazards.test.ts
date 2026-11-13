import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../utils/seeds';
import { buildSimContext, sampleAgents, simulateRun } from '../agents';
import { makeRoomPlan } from './helpers';

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

  it('fire_origin grows at 0.5 m/s and kills those it reaches', () => {
    const plan = makeRoomPlan({
      w: 14, h: 8, exits: [{ side: 'right', width: 1.0 }], clusters: [{ rect: [1, 2, 5, 6], people: 30 }],
      hazards: [{ id: 'f', kind: 'fire_origin', polygonWorld: [{ x: 2, y: 4 }], activeAtSeconds: 0 }],
    });
    const ctx = buildSimContext(plan);
    const res = simulateRun(ctx, sampleAgents(ctx, new SeededRandom(9)), {});
    expect(res.casualties).toBeGreaterThan(0); // slow pre-movement leaves people in the fire's path
    expect(res.evacuationTimes.length + res.casualties + res.remaining).toBe(30);
  });
});
