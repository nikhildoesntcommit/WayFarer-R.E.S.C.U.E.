import type { Gfx } from '../components/PlanCanvas';
import type { Plan, WorldPoint, WorldPolygon } from '../types';
import { polygonCentroid } from '../utils/geo';
import { exitLabels } from '../ai/rules';

import { COLOURS, rgba } from '../theme';

export { COLOURS, rgba };

export const MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const SANS = "'IBM Plex Sans', system-ui, sans-serif";

export interface RenderOpts {
  grid?: boolean;
  clusters?: boolean;
  hazards?: boolean;
  /** id of a highlighted element (zone, door or hazard) */
  selectedId?: string | null;
  /** draw door/exit labels */
  labels?: boolean;
  /** fainter geometry, for use under a heatmap */
  faint?: boolean;
}

export function polyPath(g: Gfx, poly: WorldPolygon, close = true): void {
  const { ctx } = g;
  ctx.beginPath();
  poly.forEach((p, i) => {
    const s = g.w2s(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (close) ctx.closePath();
}

const NICE_STEPS_M = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

function drawGrid(g: Gfx): void {
  const { ctx } = g;
  // the finest grid whose lines are still at least 14 px apart: 1 m for a room, 100 m for a campus
  const step = NICE_STEPS_M.find((n) => n * g.scale >= 14) ?? 1000;
  const tl = g.s2w(0, 0);
  const br = g.s2w(g.width, g.height);
  const major = step * 5;
  ctx.lineWidth = 1;
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    const s = g.w2s({ x, y: 0 });
    ctx.strokeStyle = Math.abs(x % major) < 1e-6 ? rgba(COLOURS.inkFaint, 0.3) : rgba(COLOURS.rule, 0.55);
    ctx.beginPath();
    ctx.moveTo(Math.round(s.x) + 0.5, 0);
    ctx.lineTo(Math.round(s.x) + 0.5, g.height);
    ctx.stroke();
  }
  for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
    const s = g.w2s({ x: 0, y });
    ctx.strokeStyle = Math.abs(y % major) < 1e-6 ? rgba(COLOURS.inkFaint, 0.3) : rgba(COLOURS.rule, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(s.y) + 0.5);
    ctx.lineTo(g.width, Math.round(s.y) + 0.5);
    ctx.stroke();
  }
}

export function hatch(g: Gfx, poly: WorldPolygon, colour: string): void {
  const { ctx } = g;
  ctx.save();
  polyPath(g, poly);
  ctx.clip();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  const pts = poly.map((p) => g.w2s(p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  for (let d = x0 - (y1 - y0); d < x1; d += 8) {
    ctx.beginPath();
    ctx.moveTo(d, y1);
    ctx.lineTo(d + (y1 - y0), y0);
    ctx.stroke();
  }
  ctx.restore();
}

export function label(g: Gfx, text: string, at: WorldPoint, opts: { colour?: string; size?: number; font?: string; dy?: number; bg?: boolean } = {}): void {
  const { ctx } = g;
  const s = g.w2s(at);
  ctx.font = `${opts.size ?? 11}px ${opts.font ?? MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = s.y + (opts.dy ?? 0);
  if (opts.bg !== false) {
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = rgba(COLOURS.paper, 0.85);
    ctx.fillRect(s.x - w / 2, y - 8, w, 16);
  }
  ctx.fillStyle = opts.colour ?? COLOURS.ink;
  ctx.fillText(text, s.x, y);
}

/** The plan itself: perimeter, thick walls, doors/exits, zones, hazards. Pure drawing, no interaction state. */
export function renderPlan(g: Gfx, plan: Plan | null, o: RenderOpts = {}): void {
  const { ctx } = g;
  ctx.fillStyle = COLOURS.paper;
  ctx.fillRect(0, 0, g.width, g.height);
  if (o.grid !== false) drawGrid(g);
  if (!plan) return;
  const faint = o.faint ? 0.55 : 1;

  // building footprint
  if (plan.buildingPerimeterWorld.length >= 3) {
    polyPath(g, plan.buildingPerimeterWorld);
    ctx.fillStyle = rgba(COLOURS.paperEdge, 0.55);
    ctx.fill();
  }

  // walls
  ctx.globalAlpha = faint;
  ctx.fillStyle = COLOURS.ink;
  for (const w of plan.wallsWorld) {
    polyPath(g, w);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // obstacles (camera scans never produce any, imported plans may)
  for (const o2 of plan.obstaclesWorld) {
    polyPath(g, o2);
    ctx.fillStyle = COLOURS.inkSoft;
    ctx.fill();
  }

  // zones
  if (o.clusters !== false) {
    for (const c of plan.clusters) {
      if (c.polygonWorld.length < 3) continue;
      const sel = o.selectedId === c.id;
      polyPath(g, c.polygonWorld);
      ctx.fillStyle = sel ? rgba(COLOURS.brass, 0.3) : rgba(COLOURS.brass, 0.14);
      ctx.fill();
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeStyle = COLOURS.brass;
      ctx.stroke();
      ctx.setLineDash([]);
      const ctr = polygonCentroid(c.polygonWorld);
      label(g, `${c.label} · ${c.people}`, ctr, { colour: COLOURS.inkSoft });
    }
  }

  // hotspots: a dashed catchment ring, a solid centre, a label
  if (o.clusters !== false) {
    for (const h of plan.hotspots ?? []) {
      const sel = o.selectedId === h.id;
      const s = g.w2s(h.at);
      const r = Math.max(6, h.radiusM * g.scale);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = sel ? rgba(COLOURS.brass, 0.3) : rgba(COLOURS.brass, 0.14);
      ctx.fill();
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeStyle = COLOURS.brass;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLOURS.brass;
      ctx.fill();
      label(g, `${h.label} · ${h.people}`, h.at, { colour: COLOURS.inkSoft, dy: -(r + 12) });
    }
  }

  // hazards
  if (o.hazards !== false) {
    for (const h of plan.hazards) {
      const sel = o.selectedId === h.id;
      if (h.kind === 'no_go_zone' && h.polygonWorld && h.polygonWorld.length >= 3) {
        hatch(g, h.polygonWorld, rgba(COLOURS.vermillion, 0.55));
        polyPath(g, h.polygonWorld);
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeStyle = COLOURS.vermillion;
        ctx.stroke();
        label(g, `No-go · T+${h.activeAtSeconds}s`, polygonCentroid(h.polygonWorld), { colour: COLOURS.vermillion });
      } else if (h.kind === 'fire_origin' && h.polygonWorld && h.polygonWorld[0]) {
        const s = g.w2s(h.polygonWorld[0]);
        ctx.strokeStyle = COLOURS.vermillion;
        ctx.lineWidth = sel ? 3 : 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
        ctx.moveTo(s.x - 6, s.y - 6);
        ctx.lineTo(s.x + 6, s.y + 6);
        ctx.moveTo(s.x + 6, s.y - 6);
        ctx.lineTo(s.x - 6, s.y + 6);
        ctx.stroke();
        label(g, `Fire · T+${h.activeAtSeconds}s`, h.polygonWorld[0], { colour: COLOURS.vermillion, dy: 20 });
      } else if (h.kind === 'blocked_exit') {
        const d = plan.doors.find((x) => x.id === h.doorId);
        if (!d) continue;
        const a = g.w2s(d.startWorld);
        const b = g.w2s(d.endWorld);
        ctx.strokeStyle = COLOURS.vermillion;
        ctx.lineWidth = sel ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const mid = { x: (d.startWorld.x + d.endWorld.x) / 2, y: (d.startWorld.y + d.endWorld.y) / 2 };
        label(g, `Blocked · T+${h.activeAtSeconds}s`, mid, { colour: COLOURS.vermillion, dy: -16 });
      }
    }
  }

  // doors / exits
  const names = exitLabels(plan);
  for (const d of plan.doors) {
    const a = g.w2s(d.startWorld);
    const b = g.w2s(d.endWorld);
    const sel = o.selectedId === d.id;
    // opening: paper-coloured gap through the wall, then the door leaf
    ctx.lineCap = 'butt';
    ctx.strokeStyle = COLOURS.paper;
    ctx.lineWidth = Math.max(4, 0.26 * g.scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = d.isExit ? COLOURS.brass : COLOURS.inkSoft;
    ctx.lineWidth = d.isExit ? (sel ? 5 : 3) : sel ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (o.labels !== false && d.isExit) {
      const mid = { x: (d.startWorld.x + d.endWorld.x) / 2, y: (d.startWorld.y + d.endWorld.y) / 2 };
      label(g, names[d.id] ?? 'Exit', mid, { colour: COLOURS.brass, size: 11, dy: 16, font: SANS });
    }
  }
}

/** Distance scale bar, bottom left. */
export function scaleBar(g: Gfx): void {
  const { ctx } = g;
  const target = 90 / g.scale;
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((n) => n >= target) ?? 1000;
  const px = nice * g.scale;
  const x = 12;
  const y = g.height - 14;
  ctx.strokeStyle = COLOURS.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4);
  ctx.lineTo(x + px, y + 4);
  ctx.stroke();
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = COLOURS.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${nice} m`, x, y - 6);
}
