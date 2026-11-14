import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateFindings } from '../ai/findings';
import { Num } from '../components/Modal';
import { PlanCanvas, type Gfx, type PlanCanvasHandle } from '../components/PlanCanvas';
import { MONTE_CARLO } from '../constants';
import { renderPlan, scaleBar } from '../draw/render';
import type { TraceFrame } from '../engine/agents';
import { startMonteCarlo, type SimulationError } from '../engine/montecarlo';
import type { ProgressInfo } from '../engine/pipeline';
import { useApp } from '../store';
import { countOut, drawFire, drawTraceFrame } from './visualiser';
import { buildFires } from '../engine/hazards';
import { rasterize } from '../engine/grid';

const PLAYBACK_X = 8; // preview plays at 8x real time

export function SimulationStage() {
  const nav = useNavigate();
  const plan = useApp((s) => s.plan);
  const hydrated = useApp((s) => s.hydrated);
  const setResult = useApp((s) => s.setResult);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; doorId?: string } | null>(null);
  const [previewEnded, setPreviewEnded] = useState(false);
  const [tick, setTick] = useState(0);
  const canvas = useRef<PlanCanvasHandle>(null);
  const trace = useRef<TraceFrame[] | null>(null);
  const t0 = useRef(0);
  const frameIdx = useRef(0);
  const ended = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!plan) {
      nav('/', { replace: true });
      return;
    }
    let alive = true;
    const handle = startMonteCarlo(
      plan,
      MONTE_CARLO.defaultRuns,
      plan.masterSeed,
      (p) => alive && setProgress(p),
      (t) => {
        if (!alive) return;
        trace.current = t;
        t0.current = performance.now();
      },
    );
    handle.promise
      .then(({ result }) => {
        if (!alive) return;
        const findings = generateFindings(result, plan, null);
        setResult(result, findings);
        setDone(true);
      })
      .catch((e: SimulationError) => {
        if (!alive || e.message === 'Cancelled') return;
        setError({ message: e.message, doorId: e.doorId });
      });
    return () => {
      alive = false;
      handle.cancel();
    };
    // the plan object is stable for the lifetime of this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // animation clock
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const tr = trace.current;
      if (tr && tr.length > 0 && !ended.current) {
        const elapsed = ((performance.now() - t0.current) / 1000) * PLAYBACK_X;
        let i = frameIdx.current;
        while (i < tr.length - 1 && tr[i + 1]!.t <= elapsed) i++;
        frameIdx.current = i;
        if (i >= tr.length - 1) {
          ended.current = true;
          setPreviewEnded(true);
        }
        setTick((n) => n + 1);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (done && previewEnded) nav('/results');
  }, [done, previewEnded, nav]);

  // no preview frames at all (nobody could move): do not wait for an animation that will never come
  useEffect(() => {
    if (done && !trace.current) nav('/results');
  }, [done, nav]);

  const fireLayer = useMemo(() => {
    if (!plan || !plan.hazards.some((h) => h.kind === 'fire_origin')) return null;
    try {
      const grid = rasterize(plan);
      return { grid, fires: buildFires(plan, grid) };
    } catch {
      return null;
    }
  }, [plan]);

  const paint = (g: Gfx) => {
    renderPlan(g, plan, { clusters: false, labels: false });
    const tr = trace.current;
    if (fireLayer) drawFire(g, fireLayer.grid, fireLayer.fires, tr?.[frameIdx.current]?.t ?? 0);
    drawTraceFrame(g, tr?.[frameIdx.current]);
    scaleBar(g);
  };

  const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
  const counts = countOut(trace.current?.[frameIdx.current]);
  void tick;

  if (error) {
    return (
      <div className="screen">
        <div className="page">
          <h1>The simulation could not run</h1>
          <p className="danger" role="alert">{error.message}</p>
          <p>Fix the layout and run it again. Nothing was saved as a result.</p>
          <button className="btn primary" onClick={() => nav('/mark')}>Back to marking</button>{' '}
          <button className="btn" onClick={() => nav('/draw')}>Back to layout</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="topbar">
        <h2>Simulating {MONTE_CARLO.defaultRuns} trials</h2>
        <button className="btn small" onClick={() => nav('/mark')}>Cancel</button>
        <button className="btn primary" disabled={!done} onClick={() => nav('/results')} data-testid="view-results">
          {done ? 'View results' : `${pct}%`}
        </button>
      </header>
      <div className="editor">
        <div className="editor-col">
          <PlanCanvas ref={canvas} paint={paint} initialFit={plan?.buildingPerimeterWorld} cursor="default" ariaLabel="Evacuation preview (trial 1 of 200)" />
          <div className="subbar">
            <span className="label">Trial 1 preview, {PLAYBACK_X}× speed</span>
            <span className="num">{counts.out}<span className="unit">out</span> / {counts.total}</span>
            {counts.dead > 0 ? <span className="danger num">{counts.dead}<span className="unit">casualties</span></span> : null}
            <button className="btn small" onClick={() => (done ? nav('/results') : undefined)} disabled={!done} data-testid="skip-preview">Skip preview</button>
          </div>
          <div className="validation" aria-live="polite">
            <span className="bar" style={{ flex: '1 1 160px' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="row">
              <span className="label">Trials</span> <span className="num">{progress?.completed ?? 0}/{MONTE_CARLO.defaultRuns}</span>
            </span>
            <span className="row">
              <span className="label">P50</span> {progress && Number.isFinite(progress.p50) ? <Num v={progress.p50} unit="s" digits={0} className="roll" key={`a${progress.completed}`} /> : '—'}
            </span>
            <span className="row">
              <span className="label">P95</span> {progress && Number.isFinite(progress.p95) ? <Num v={progress.p95} unit="s" digits={0} className="roll" key={`b${progress.completed}`} /> : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
