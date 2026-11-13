import { useEffect, useMemo, useRef, useState } from 'react';
import { PlanCanvas, type Gfx, type PlanCanvasHandle } from '../components/PlanCanvas';
import { CONTOUR } from '../constants';
import { motionReduced } from '../settings';
import { COLOURS, label, renderPlan, rgba, scaleBar } from '../draw/render';
import type { Plan, SimulationResult } from '../types';
import { boundingBox } from '../utils/geo';
import { chainSegments, contourSegments, labelAnchor } from '../utils/contour';

const UP = 3; // bilinear upsampling of the band fill
const REVEAL_STEPS = 8;

function boxBlur(src: Float32Array, rows: number, cols: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let s = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          s += src[rr * cols + cc]!;
          n++;
        }
      out[r * cols + c] = s / n;
    }
  return out;
}

/** Tint ramp between isolines: paper -> vermillion, one step per density level. */
function bandRgba(band: number): [number, number, number, number] {
  if (band <= 0) return [0, 0, 0, 0];
  const a = Math.min(0.62, 0.07 + 0.075 * band);
  const n = parseInt(COLOURS.vermillion.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(a * 255)];
}

export function ContourMap({ plan, result }: { plan: Plan; result: SimulationResult }) {
  const canvas = useRef<PlanCanvasHandle>(null);
  const [reveal, setReveal] = useState(0);

  const model = useMemo(() => {
    const { heatmapRows: rows, heatmapCols: cols } = result;
    const bb = boundingBox(plan.buildingPerimeterWorld);
    const m = plan.metresPerCell;
    const field = boxBlur(boxBlur(result.densityHeatmap, rows, cols), rows, cols);

    // band fill, upsampled so that band edges follow the isolines
    const W = (cols - 1) * UP + 1;
    const H = (rows - 1) * UP + 1;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    const img = octx ? octx.createImageData(W, H) : null;
    const bandAt = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const fy = (H - 1 - y) / UP; // image row 0 is the NORTH edge; field row 0 is the south
      const r0 = Math.min(rows - 2, Math.floor(fy));
      const ty = fy - r0;
      for (let x = 0; x < W; x++) {
        const fx = x / UP;
        const c0 = Math.min(cols - 2, Math.floor(fx));
        const tx = fx - c0;
        const v =
          field[r0 * cols + c0]! * (1 - tx) * (1 - ty) +
          field[r0 * cols + c0 + 1]! * tx * (1 - ty) +
          field[(r0 + 1) * cols + c0]! * (1 - tx) * ty +
          field[(r0 + 1) * cols + c0 + 1]! * tx * ty;
        let b = 0;
        for (const lv of CONTOUR.densityLevels) if (v >= lv) b++;
        bandAt[y * W + x] = b;
      }
    }

    const lines = CONTOUR.densityLevels.map((level) => ({
      level,
      chains: chainSegments(contourSegments(field, rows, cols, level)).filter((ch) => ch.length >= 3),
    }));
    return { rows, cols, bb, m, W, H, img, octx, off, bandAt, lines };
  }, [plan, result]);

  // stepped draw-in (800 ms), or immediate under reduced motion
  useEffect(() => {
    const still = motionReduced();
    if (still) {
      setReveal(REVEAL_STEPS);
      return;
    }
    setReveal(0);
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setReveal(i);
      if (i >= REVEAL_STEPS) window.clearInterval(id);
    }, CONTOUR.drawInMs / REVEAL_STEPS);
    return () => window.clearInterval(id);
  }, [model]);

  const visibleLevels = Math.ceil((reveal / REVEAL_STEPS) * CONTOUR.densityLevels.length);

  const paint = (g: Gfx) => {
    renderPlan(g, plan, { clusters: true, labels: true, faint: true });
    const { ctx } = g;
    const { bb, m, rows, cols } = model;
    const toWorld = (x: number, y: number) => ({ x: bb.minX + (x + 0.5) * m, y: bb.minY + (y + 0.5) * m });

    // band fill, limited to the revealed levels
    if (model.img && model.octx) {
      const d = model.img.data;
      for (let i = 0; i < model.bandAt.length; i++) {
        const b = model.bandAt[i]!;
        const [r, gg, bl, a] = bandRgba(b <= visibleLevels ? b : visibleLevels);
        d[4 * i] = r;
        d[4 * i + 1] = gg;
        d[4 * i + 2] = bl;
        d[4 * i + 3] = a;
      }
      model.octx.putImageData(model.img, 0, 0);
      const tl = g.w2s(toWorld(0, rows - 1));
      const br = g.w2s(toWorld(cols - 1, 0));
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(model.off, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    // isolines + labels
    ctx.lineWidth = 1;
    model.lines.forEach(({ level, chains }, li) => {
      if (li >= visibleLevels) return;
      ctx.strokeStyle = rgba(COLOURS.vermillion, CONTOUR.lineOpacity);
      for (const ch of chains) {
        ctx.beginPath();
        ch.forEach(([x, y], i) => {
          const s = g.w2s(toWorld(x, y));
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
      const longest = chains.reduce<[number, number][] | null>((b, c) => (!b || c.length > b.length ? c : b), null);
      if (longest && longest.length >= 8) {
        const a = labelAnchor(longest);
        label(g, level.toFixed(1), toWorld(a.x, a.y), { colour: COLOURS.vermillion, size: 10 });
      }
    });

    // bottleneck + casualty hot spot
    if (result.bottleneckCell && (result.bottleneckSeconds ?? 0) > 0) {
      const c = toWorld(result.bottleneckCell.col, result.bottleneckCell.row);
      const s = g.w2s(c);
      ctx.strokeStyle = COLOURS.brass;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      label(g, `Bottleneck ${Math.round(result.bottleneckSeconds ?? 0)} s`, c, { colour: COLOURS.brass, dy: -18, size: 11 });
    }
    if (result.casualtyHotspot) {
      const s = g.w2s(result.casualtyHotspot);
      ctx.strokeStyle = COLOURS.vermillion;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - 7, s.y - 7);
      ctx.lineTo(s.x + 7, s.y + 7);
      ctx.moveTo(s.x + 7, s.y - 7);
      ctx.lineTo(s.x - 7, s.y + 7);
      ctx.stroke();
      label(g, 'Casualties', result.casualtyHotspot, { colour: COLOURS.vermillion, dy: 18, size: 11 });
    }
    scaleBar(g);
  };

  return (
    <figure className="contour-box" aria-label="Crowd density map">
      <PlanCanvas ref={canvas} paint={paint} initialFit={plan.buildingPerimeterWorld} cursor="grab" panMode ariaLabel="Peak crowd density, persons per square metre" />
      <figcaption className="label">
        Peak density, persons/m² (mean over {result.runs} trials). Isolines at {CONTOUR.densityLevels.join(', ')}.
      </figcaption>
    </figure>
  );
}
