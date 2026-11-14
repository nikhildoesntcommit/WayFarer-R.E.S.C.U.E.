import { describe, expect, it } from 'vitest';
import { makeRoomPlan } from '../../engine/__tests__/helpers';
import { runMonteCarloSync } from '../../engine/pipeline';
import { acceptable, numbersIn } from '../narrator';
import { estimatePlan, estimatorInfo, predictFromFeatures } from '../surrogate';
import { planFeatures } from '../surrogateFeatures';

const room = (people: number, exitWidth: number) =>
  makeRoomPlan({ w: 24, h: 14, exits: [{ side: 'bottom', width: exitWidth }, { side: 'top', width: exitWidth }], clusters: [{ rect: [3, 3, 21, 11], people }] });

describe('estimator model (trained on simulator output)', () => {
  it('features are physical and deterministic', () => {
    const a = planFeatures(room(200, 1.5))!;
    expect(a).toEqual(planFeatures(room(200, 1.5)));
    expect(a[0]).toBeCloseTo(Math.log(200), 6); // ln people
    expect(a[5]).toBe(2); // exits
    expect(a[3]).toBeCloseTo(2 * (1.5 - 0.3) * 1.3, 1); // door capacity, SFPE
  });
  it('a plan with nobody marked or no exit gives no estimate', () => {
    expect(estimatePlan(makeRoomPlan({ w: 10, h: 10, exits: [], clusters: [{ rect: [2, 2, 8, 8], people: 10 }] }))).toBeNull();
  });
  it('agrees with the full simulation within its stated band for rooms in its range', () => {
    let inside = 0;
    const cases: [number, number][] = [[80, 1.2], [300, 1.8], [600, 2.4], [150, 1.0], [900, 3.0]];
    for (const [n, w] of cases) {
      const plan = room(n, w);
      const sim = runMonteCarloSync(plan, 100, 5).result.p95;
      const est = estimatePlan(plan)!;
      expect(est.outOfRange).toEqual([]);
      if (sim >= est.p95Low * 0.9 && sim <= est.p95High * 1.1) inside++;
    }
    expect(inside).toBeGreaterThanOrEqual(4);
  });
  it('more people or narrower exits never make the estimate faster (monotone where physics is)', () => {
    expect(estimatePlan(room(900, 1.2))!.p95).toBeGreaterThan(estimatePlan(room(100, 1.2))!.p95);
    expect(estimatePlan(room(500, 0.9))!.p95).toBeGreaterThan(estimatePlan(room(500, 3.0))!.p95);
  });
  it('flags a room far outside its training range instead of guessing', () => {
    const f = planFeatures(room(200, 1.5))!.slice();
    f[0] = Math.log(200000);
    expect(predictFromFeatures(f).outOfRange).toContain('people');
  });
  it('reports honest held-out accuracy', () => {
    expect(estimatorInfo.heldOut).toBeGreaterThan(100);
    expect(estimatorInfo.p95WithinTwentyPercent).toBeGreaterThan(0.7);
  });
});

describe('on-device wording check', () => {
  const facts = 'All 545 people get out; 95% within 4.9 min. The 4 exits are used fairly evenly (largest share 43%).';
  it('reads numbers with separators and decimals', () => {
    expect(numbersIn('12,345 people, 4.9 min, 43%')).toEqual(['12345', '4.9', '43']);
  });
  it('accepts a faithful rewording', () => {
    expect(acceptable(facts, 'Everyone, all 545 people, gets out within 4.9 min for 95% of cases, and the 4 exits share the load well, with the busiest taking 43%.')).toBe(true);
  });
  it('rejects an invented or altered number, or a rewrite that drops the figures', () => {
    expect(acceptable(facts, 'Everyone, all 550 people, gets out within 4.9 min for 95% of cases, and the 4 exits share the load well, with the busiest taking 43%.')).toBe(false);
    expect(acceptable(facts, 'Everybody gets out quickly and the exits are used well, so the building looks fine overall for evacuation.')).toBe(false);
    expect(acceptable(facts, 'ok')).toBe(false);
  });
});
