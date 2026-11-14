import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../utils/seeds';
import { buildSimContext, sampleAgents } from '../agents';
import { makeRoomPlan } from './helpers';

const plan = () => makeRoomPlan({
  w: 20, h: 12, exits: [{ side: 'bottom', width: 1.2 }, { side: 'top', width: 1.2 }],
  clusters: [{ rect: [2, 3, 18, 9], people: 600 }],
});

describe('companion groups', () => {
  it('a large share of people travel with companions who share an exit and a start', () => {
    const ctx = buildSimContext(plan());
    const a = sampleAgents(ctx, new SeededRandom(9));
    let together = 0;
    for (let i = 1; i < a.length; i++) if (a[i]!.startCell === a[i - 1]!.startCell) together++;
    expect(together / a.length).toBeGreaterThan(0.4);
    expect(together / a.length).toBeLessThan(0.85);
  });
  it('companions leave together at the pace of the slowest', () => {
    const ctx = buildSimContext(plan());
    const a = sampleAgents(ctx, new SeededRandom(9));
    for (let i = 1; i < a.length; i++) {
      if (a[i]!.startCell !== a[i - 1]!.startCell) continue;
      expect(a[i]!.freeSpeed).toBe(a[i - 1]!.freeSpeed);
      expect(a[i]!.exitIdx).toBe(a[i - 1]!.exitIdx);
      expect(a[i]!.preMovementDelay).toBe(a[i - 1]!.preMovementDelay);
    }
  });
  it('turning groups off gives independent people (a test hook)', () => {
    const ctx = buildSimContext(plan());
    const a = sampleAgents(ctx, new SeededRandom(9), { noGroups: true });
    let same = 0;
    for (let i = 1; i < a.length; i++) if (a[i]!.freeSpeed === a[i - 1]!.freeSpeed) same++;
    expect(same).toBeLessThan(5);
  });
});
