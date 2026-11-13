import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DistanceDialog } from '../components/Dialogs';
import { PlanCanvas, type Gfx, type PlanCanvasHandle } from '../components/PlanCanvas';
import { COLOURS, label, renderPlan, scaleBar } from '../draw/render';
import { scalePlan } from '../draw/tools';
import { useApp } from '../store';
import type { WorldPoint } from '../types';
import { dist, polygonArea } from '../utils/geo';
import { buildCameraPlan } from './planBuilder';

/**
 * Scan -> plan hand-off (spec: "On Done, route to /calibrate with the corner polygon").
 * The tape measure is the ground truth: tap two points, type the real distance, the whole plan is rescaled.
 */
export function CalibrateStage() {
  const nav = useNavigate();
  const hydrated = useApp((s) => s.hydrated);
  const scanPolygon = useApp((s) => s.scanPolygon);
  const plan = useApp((s) => s.plan);
  const setPlan = useApp((s) => s.setPlan);
  const setSource = useApp((s) => s.setSource);
  const canvas = useRef<PlanCanvasHandle>(null);
  const [pts, setPts] = useState<WorldPoint[]>([]);
  const [dlg, setDlg] = useState<number | null>(null);
  const [calibrated, setCalibrated] = useState(false);
  const hover = useRef<WorldPoint | null>(null);

  // build the plan once from the scan
  useEffect(() => {
    if (!hydrated) return;
    if (scanPolygon && scanPolygon.length >= 3) {
      setSource('camera');
      setPlan(buildCameraPlan(scanPolygon));
      useApp.getState().setScanPolygon(null);
      window.setTimeout(() => canvas.current?.fit(scanPolygon), 0);
    } else if (!plan || plan.source !== 'camera') {
      nav('/scan', { replace: true });
    }
  }, [hydrated, scanPolygon, plan, setPlan, setSource, nav]);

  const paint = (g: Gfx) => {
    renderPlan(g, plan, { clusters: false });
    const { ctx } = g;
    pts.forEach((p) => {
      const s = g.w2s(p);
      ctx.strokeStyle = COLOURS.vermillion;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    });
    if (pts.length === 1 && hover.current) {
      const a = g.w2s(pts[0]!);
      const b = g.w2s(hover.current);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COLOURS.vermillion;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      label(g, `${dist(pts[0]!, hover.current).toFixed(2)} m`, { x: (pts[0]!.x + hover.current.x) / 2, y: (pts[0]!.y + hover.current.y) / 2 }, { dy: -12 });
    }
    if (pts.length === 2) {
      const a = g.w2s(pts[0]!);
      const b = g.w2s(pts[1]!);
      ctx.strokeStyle = COLOURS.vermillion;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    scaleBar(g);
  };

  if (!plan) return <div className="page"><p className="muted">Loading…</p></div>;
  const area = polygonArea(plan.buildingPerimeterWorld);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn small" onClick={() => nav('/scan')}>← Rescan</button>
        <h2>Calibrate</h2>
        <button className="btn primary" onClick={() => nav('/mark')} data-testid="calibrate-continue">
          {calibrated ? 'Continue to marking' : 'Skip — scale is right'}
        </button>
      </header>
      <div className="editor">
        <div className="editor-col">
          <PlanCanvas
            ref={canvas}
            paint={paint}
            initialFit={plan.buildingPerimeterWorld}
            ariaLabel="Scanned floor plan"
            handlers={{
              onMove: (w) => {
                hover.current = w;
                canvas.current?.redraw();
              },
              onUp: (w) => {
                const next = [...pts, w];
                if (next.length === 2) {
                  const d = dist(next[0]!, next[1]!);
                  if (d < 0.2) { setPts([]); return; }
                  setPts(next);
                  setDlg(d);
                } else setPts(next);
              },
            }}
          />
          <div className="subbar">
            <span className="muted">
              Phone-sensor distances can be off by 10–20%. Tap two points whose real distance you know (a wall, a door), then type it in.
            </span>
            <span className="num">area <strong>{area.toFixed(1)}</strong><span className="unit">m²</span></span>
          </div>
        </div>
      </div>
      {dlg !== null ? (
        <DistanceDialog
          measured={dlg}
          onCancel={() => { setDlg(null); setPts([]); }}
          onOk={(real) => {
            const f = real / dlg;
            setPlan(scalePlan(plan, f));
            setCalibrated(true);
            setDlg(null);
            setPts([]);
            window.setTimeout(() => canvas.current?.fit(plan.buildingPerimeterWorld.map((p) => ({ x: p.x * f, y: p.y * f }))), 0);
          }}
        />
      ) : null}
    </div>
  );
}
