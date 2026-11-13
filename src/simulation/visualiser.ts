import type { Gfx } from '../components/PlanCanvas';
import { COLOURS, label } from '../draw/render';
import type { TraceFrame } from '../engine/agents';

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
  label(g, `T+${Math.round(frame.t)} s`, g.s2w(g.width - 44, 16), { colour: COLOURS.ink, size: 12 });
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
