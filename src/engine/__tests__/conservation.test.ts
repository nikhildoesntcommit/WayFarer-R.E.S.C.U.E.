import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../utils/seeds';
import { buildSimContext, sampleAgents, simulateRun } from '../agents';
import { runMonteCarloSync } from '../pipeline';
import { makeRoomPlan, type RoomSpec, type Side } from './helpers';

function randomSpec(rng: SeededRandom): RoomSpec {
  const w = 8 + rng.int(18);
  const h = 6 + rng.int(14);
  const sides: Side[] = ['bottom', 'right', 'top', 'left'];
  const nExits = 1 + rng.int(3);
  const exits = Array.from({ length: nExits }, (_, i) => ({ side: sides[(i + rng.int(2)) % 4]!, width: 0.8 + rng.int(12) / 10 }));
  // exits on the same side would collide; keep one per side
  const uniq = exits.filter((e, i) => exits.findIndex((x) => x.side === e.side) === i);
  const nClusters = 1 + rng.int(3);
  const clusters = Array.from({ length: nClusters }, () => {
    const x0 = 1 + rng.next() * (w - 5);
    const y0 = 1 + rng.next() * (h - 4);
    return {
      rect: [x0, y0, x0 + 2 + rng.next() * 2, y0 + 1.5 + rng.next() * 1.5] as [number, number, number, number],
      people: 5 + rng.int(60),
      mix: { child: rng.next() * 0.3, elderly: rng.next() * 0.2, wheelchair: rng.next() * 0.1 },
    };
  });
  const hazards: RoomSpec['hazards'] = [];
  if (rng.next() < 0.4) hazards.push({ id: 'h1', kind: 'blocked_exit', doorId: 'exit-A', activeAtSeconds: 10 + rng.int(60) });
  if (rng.next() < 0.3) hazards.push({ id: 'h2', kind: 'fire_origin', polygonWorld: [{ x: 1 + rng.next() * (w - 2), y: 1 + rng.next() * (h - 2) }], activeAtSeconds: 5 + rng.int(40) });
  if (rng.next() < 0.3) {
    const x = 1 + rng.next() * (w - 4);
    hazards.push({ id: 'h3', kind: 'no_go_zone', polygonWorld: [{ x, y: 1 }, { x: x + 2, y: 1 }, { x: x + 2, y: 3 }, { x, y: 3 }], activeAtSeconds: 20 + rng.int(40) });
  }
  return { w, h, exits: uniq, clusters, hazards };
}

describe('conservation and invariants', () => {
  it('evacuated + casualties + remaining = total for 20 random plans; nobody walks through a wall', () => {
    const rng = new SeededRandom(2024);
    for (let n = 0; n < 20; n++) {
      const plan = makeRoomPlan(randomSpec(rng));
      const total = plan.clusters.reduce((s, c) => s + c.people, 0);
      const ctx = buildSimContext(plan);
      for (let r = 0; r < 3; r++) {
        const agents = sampleAgents(ctx, new SeededRandom(100 * n + r));
        const res = simulateRun(ctx, agents);
        expect(res.evacuationTimes.length + res.casualties + res.remaining).toBe(total);
        expect(res.conservationOk).toBe(true);
        expect(res.wallViolations).toBe(0);
        expect(res.evacuationTimes.every((t) => t >= 0)).toBe(true);
      }
      const agg = runMonteCarloSync(ctx, 5, 99 + n).result;
      expect(agg.evacuated + agg.casualties + agg.remaining).toBe(5 * total);
      expect(agg.conservationPass).toBe(true);
    }
  });

  it('casualties only occur inside an active hazard zone', () => {
    const plan = makeRoomPlan({
      w: 12, h: 10,
      exits: [{ side: 'top', width: 1.2 }],
      clusters: [{ rect: [3, 2, 9, 4], people: 40 }],
      hazards: [{ id: 'z', kind: 'no_go_zone', polygonWorld: [{ x: 5, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 5 }, { x: 5, y: 5 }], activeAtSeconds: 1 }],
    });
    const ctx = buildSimContext(plan);
    const res = simulateRun(ctx, sampleAgents(ctx, new SeededRandom(5), { noPreMovement: true }), { noPreMovement: true });
    expect(res.casualties).toBeGreaterThan(0);
    for (const c of res.casualtyCells) {
      expect(c.x).toBeGreaterThanOrEqual(5 - ctx.grid.metresPerCell);
      expect(c.x).toBeLessThanOrEqual(7 + ctx.grid.metresPerCell);
    }
    expect(res.evacuationTimes.length + res.casualties + res.remaining).toBe(40);
  });
});
