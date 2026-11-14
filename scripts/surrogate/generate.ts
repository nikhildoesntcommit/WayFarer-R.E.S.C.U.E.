/**
 * Builds the training set for the estimator model: random rooms, each run through the real simulator.
 * usage: npx vite-node scripts/surrogate/generate.ts <seed> <count> <out.jsonl>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { makeRoomPlan, type Side } from '../../src/engine/__tests__/helpers';
import { runMonteCarloSync } from '../../src/engine/pipeline';
import { planFeatures } from '../../src/ai/surrogateFeatures';
import { SeededRandom } from '../../src/utils/seeds';

const [seedArg, countArg, out, mode] = process.argv.slice(2);
const big = mode === 'big'; // crowds of hundreds to thousands (halls, venues)
const rng = new SeededRandom(Number(seedArg));
const count = Number(countArg);
writeFileSync(out!, '');
const sides: Side[] = ['bottom', 'right', 'top', 'left'];
const u = (a: number, b: number) => a + (b - a) * rng.next();
let made = 0;
let tries = 0;
while (made < count && tries < count * 4) {
  tries++;
  let w = u(8, 60);
  let h = u(6, 40);
  let bigClusters: { rect: [number, number, number, number]; people: number; mix: { adult: number; child: number; elderly: number; wheelchair: number } }[] | null = null;
  if (big) {
    const T = Math.exp(u(Math.log(250), Math.log(3000)));
    const nC = 1 + rng.int(3);
    const parts = Array.from({ length: nC }, () => rng.next() + 0.3);
    const sum = parts.reduce((a, b) => a + b, 0);
    const spec = parts.map((p) => ({ people: Math.round((T * p) / sum), dens: Math.exp(u(Math.log(0.15), Math.log(3))) }));
    const areas = spec.map((c) => c.people / c.dens);
    const roomArea = Math.max(300, areas.reduce((a, b) => a + b, 0) * u(1.5, 3));
    const aspect = u(0.4, 1);
    w = Math.sqrt(roomArea / aspect); h = w * aspect;
    bigClusters = spec.map((c, i) => {
      const a = areas[i]!;
      const cw = Math.min(w - 2, Math.sqrt(a) * u(0.7, 1.4));
      const ch = Math.min(h - 2, a / cw);
      const x0 = 1 + rng.next() * Math.max(0, w - 2 - cw); const y0 = 1 + rng.next() * Math.max(0, h - 2 - ch);
      const kids = rng.next() < 0.4 ? u(0, 0.3) : 0; const eld = rng.next() < 0.4 ? u(0, 0.3) : 0; const whl = rng.next() < 0.2 ? u(0, 0.05) : 0;
      return { rect: [x0, y0, x0 + cw, y0 + ch] as [number, number, number, number], people: c.people, mix: { adult: 1 - kids - eld - whl, child: kids, elderly: eld, wheelchair: whl } };
    });
  }
  const nEx = big ? 1 + rng.int(6) : 1 + rng.int(4);
  const exits = Array.from({ length: nEx }, () => {
    const side = sides[rng.int(4)]!;
    const len = side === 'bottom' || side === 'top' ? w : h;
    return { side, width: Math.round(u(0.9, 3.0) * 10) / 10, at: u(1.5, len - 1.5) };
  });
  // two exits on one wall must not overlap
  const bad = exits.some((a, i) => exits.some((b, j) => j > i && a.side === b.side && Math.abs((a.at ?? 0) - (b.at ?? 0)) < (a.width + b.width) / 2 + 0.3));
  if (bad) continue;
  const nCl = 1 + rng.int(3);
  const clusters = bigClusters ?? Array.from({ length: nCl }, () => {
    const x0 = u(1, w * 0.6); const y0 = u(1, h * 0.6);
    const x1 = Math.min(w - 1, x0 + u(2, w * 0.5)); const y1 = Math.min(h - 1, y0 + u(2, h * 0.5));
    const area = (x1 - x0) * (y1 - y0);
    const dens = Math.exp(u(Math.log(0.05), Math.log(2.2)));
    const kids = rng.next() < 0.4 ? u(0, 0.3) : 0;
    const eld = rng.next() < 0.4 ? u(0, 0.3) : 0;
    const whl = rng.next() < 0.2 ? u(0, 0.05) : 0;
    return { rect: [x0, y0, x1, y1] as [number, number, number, number], people: Math.max(5, Math.round(area * dens)), mix: { adult: 1 - kids - eld - whl, child: kids, elderly: eld, wheelchair: whl } };
  });
  const hazards = rng.next() < 0.3 ? [{ id: 'f', kind: 'fire_origin' as const, polygonWorld: [{ x: u(1, w - 1), y: u(1, h - 1) }], activeAtSeconds: 0 }] : [];
  try {
    const plan = makeRoomPlan({ w, h, exits, clusters, hazards, metresPerCell: Math.max(0.3, Math.sqrt((w * h) / 6000)) });
    plan.alarmTimeSeconds = [0, 15, 30, 60][rng.int(4)]!;
    const f = planFeatures(plan);
    if (!f) continue;
    const total = clusters.reduce((s, c) => s + c.people, 0);
    if (total > 4200) continue;
    const r = runMonteCarloSync(plan, big ? 10 : 40, 1000 + made).result;
    const lost = (r.casualties + r.remaining) / (r.runs * r.totalPeople!);
    appendFileSync(out!, JSON.stringify({ f, p50: r.p50, p95: r.p95, lost }) + '\n');
    made++;
  } catch {
    // an invalid random room (door does not fit etc.) is simply skipped
  }
}
console.log('done', made, 'of', tries, 'tries');
