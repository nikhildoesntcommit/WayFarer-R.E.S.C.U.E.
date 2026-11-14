import type { Gfx } from '../components/PlanCanvas';
import { COLOURS, label } from '../draw/render';
import type { TraceFrame } from '../engine/agents';
import type { FireHazard } from '../engine/hazards';
import type { Grid } from '../engine/grid';
import { FIRE } from '../constants';

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

let layerCanvas: HTMLCanvasElement | null = null;

/** Flames (solid, in the danger colour) and smoke (grey, denser near the fire) at time t. Both follow walls and doors. */
export function drawFire(g: Gfx, grid: Grid | null, fires: FireHazard[], t: number): void {
  if (!grid || fires.length === 0 || typeof document === 'undefined') return;
  if (!fires.some((f) => t >= f.activeAt)) return;
  const { rows, cols } = grid;
  if (!layerCanvas) layerCanvas = document.createElement('canvas');
  if (layerCanvas.width !== cols || layerCanvas.height !== rows) { layerCanvas.width = cols; layerCanvas.height = rows; }
  const lc = layerCanvas.getContext('2d');
  if (!lc) return;
  const img = lc.createImageData(cols, rows);
  const [fr, fg, fb] = hexRgb(COLOURS.vermillion);
  const [sr, sg, sb] = hexRgb(COLOURS.inkSoft);
  for (let i = 0; i < rows * cols; i++) {
    let flame = false;
    let smoke = false;
    let near = Infinity;
    for (const f of fires) {
      if (t < f.activeAt) continue;
      if (f.flameAt[i]! <= t) flame = true;
      if (f.smokeAt[i]! <= t) { smoke = true; near = Math.min(near, f.dist[i]!); }
    }
    if (!flame && !smoke) continue;
    const row = (i / cols) | 0;
    const col = i - row * cols;
    const o = 4 * ((rows - 1 - row) * cols + col);
    if (flame) { img.data[o] = fr; img.data[o + 1] = fg; img.data[o + 2] = fb; img.data[o + 3] = 235; }
    else { img.data[o] = sr; img.data[o + 1] = sg; img.data[o + 2] = sb; img.data[o + 3] = Math.round(55 + 85 * Math.exp(-near / FIRE.doseDecayM)); }
  }
  lc.putImageData(img, 0, 0);
  const a = g.w2s({ x: grid.originX, y: grid.originY + rows * grid.metresPerCell });
  const b = g.w2s({ x: grid.originX + cols * grid.metresPerCell, y: grid.originY });
  g.ctx.save();
  g.ctx.imageSmoothingEnabled = false;
  g.ctx.drawImage(layerCanvas, a.x, a.y, b.x - a.x, b.y - a.y);
  g.ctx.restore();
}

/** Draw one animation frame of the preview run: people as dots, queues in brass, casualties as vermillion crosses. */
export function drawTraceFrame(g: Gfx, frame: TraceFrame | undefined): void {
  if (!frame) return;
  const { ctx } = g;
  const n = frame.status.length;
  const r = Math.max(1.5, Math.min(4, 0.22 * g.scale));
  for (let i = 0; i < n; i++) {
    const st = frame.status[i]!;
    if (st === 3) continue; // out
    const s = g.w2s({ x: frame.pos[2 * i]!, y: frame.pos[2 * i + 1]! });
    if (st === 4) {
      ctx.strokeStyle = COLOURS.vermillion;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = st === 2 ? COLOURS.brass : st === 0 ? COLOURS.inkFaint : st === 5 ? COLOURS.inkSoft : COLOURS.ink;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  label(g, `T+${Math.round(frame.t)} s`, g.s2w(56, 18), { colour: COLOURS.ink, size: 12 });
}

export function countOut(frame: TraceFrame | undefined): { out: number; dead: number; total: number } {
  if (!frame) return { out: 0, dead: 0, total: 0 };
  let out = 0;
  let dead = 0;
  for (const s of frame.status) {
    if (s === 3) out++;
    else if (s === 4) dead++;
  }
  return { out, dead, total: frame.status.length };
}
