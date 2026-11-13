import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IndiaMap } from './IndiaMap';
import { loadIndiaData, type IndiaData } from './data/loader';
import { buildOverlay } from './overlay';
import { generateFindings } from '../ai/findings';
import { Num } from '../components/Modal';
import { MONTE_CARLO } from '../constants';
import { analyseScenario } from '../engine/disaster/analyse';
import { galeRadiusKm } from '../engine/disaster/cyclone';
import { startMapSimulation } from '../engine/disaster/mapsim';
import { buildMapSimInput } from '../engine/disaster/roadGraph';
import type { ProgressInfo } from '../engine/pipeline';
import { motionReduced } from '../settings';
import { useApp } from '../store';
import type { MapAnalysis, SimulationResult } from '../types';

/** Real time the hazard replay takes. The hazard itself spans hours or minutes of scenario time. */
const REPLAY_MS = 10_000;

function clockText(kind: MapAnalysis['scenario']['disasterKind'], s: number): string {
  if (kind === 'earthquake') return `${Math.round(s)} s after the rupture`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} min after the alert`;
}

/**
 * Path C, two things at once: the hazard is replayed on the map (so the person can see what the model thinks is
 * happening: the storm moving, the river rising, the shaking spreading) while the 200 evacuation trials run in the
 * background. The results appear when both are done.
 */
export function MapSimulateStage() {
  const nav = useNavigate();
  const hydrated = useApp((s) => s.hydrated);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState('');
  const [data, setData] = useState<IndiaData | null>(null);
  const [analysis, setAnalysis] = useState<MapAnalysis | null>(null);
  const [clock, setClock] = useState<number | null>(0);
  const [replayDone, setReplayDone] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const skip = useRef(false);

  // ---- 1. load, analyse, then run the trials in the background
  useEffect(() => {
    if (!hydrated) return;
    const { scenario } = useApp.getState();
    if (!scenario) {
      nav('/map', { replace: true });
      return;
    }
    let alive = true;
    let cancel: (() => void) | undefined;
    let timer = 0;
    void (async () => {
      const r = await loadIndiaData();
      if (!alive) return;
      if (r.status !== 'ok') {
        setError(r.reason);
        return;
      }
      let a = useApp.getState().mapAnalysis;
      if (!a || a.scenario.id !== scenario.id) {
        const fresh = analyseScenario(scenario, r.data);
        if (fresh.status !== 'ok') {
          setError(fresh.reason);
          return;
        }
        a = fresh.data;
        useApp.getState().setMapAnalysis(a);
      }
      setData(r.data);
      setAnalysis(a);
      // give the replay a moment to start drawing before the (synchronous) road-network build
      timer = window.setTimeout(() => {
        if (!alive) return;
        const input = buildMapSimInput(a!, r.data);
        const h = startMapSimulation(input, MONTE_CARLO.defaultRuns, scenario.masterSeed, (p) => alive && setProgress(p));
        cancel = h.cancel;
        h.promise
          .then((res) => alive && setResult(res))
          .catch((e: Error) => {
            if (alive && e.message !== 'Cancelled') setError(e.message);
          });
      }, 600);
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      cancel?.();
    };
  }, [hydrated, nav]);

  // ---- 2. replay the hazard
  const durationS = Math.max(analysis?.durationS ?? 0, 30);
  useEffect(() => {
    if (!analysis) return;
    const length = motionReduced() ? 600 : REPLAY_MS;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = skip.current ? 1 : Math.min(1, (now - t0) / length);
      setClock(p * durationS);
      if (p >= 1) {
        setClock(null); // null = show the final extent with contour lines
        setReplayDone(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, durationS]);

  // ---- 3. both finished: hand over
  useEffect(() => {
    if (!result || !replayDone) return;
    const { scenario } = useApp.getState();
    if (!scenario) return;
    useApp.getState().setResult(result, generateFindings(result, null, scenario));
    // a short beat so the final extent is seen before the page changes
    const id = window.setTimeout(() => nav('/results'), 900);
    return () => window.clearTimeout(id);
  }, [result, replayDone, nav]);

  const overlay = useMemo(() => (analysis && data ? buildOverlay(analysis, data.grid) : null), [analysis, data]);
  const kind = analysis?.scenario.disasterKind;
  const track = analysis?.track ?? null;
  const eye = useMemo(() => {
    if (!track || clock === null || track.length === 0) return null;
    let k = 0;
    while (k + 1 < track.length && track[k + 1]!.t <= clock) k++;
    const a = track[k]!;
    const b = track[Math.min(k + 1, track.length - 1)]!;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (clock - a.t) / (b.t - a.t))) : 0;
    const vmax = a.vmax + (b.vmax - a.vmax) * f;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, radiusKm: galeRadiusKm(vmax, a.rmaxKm) };
  }, [track, clock]);

  const shown = clock ?? durationS;
  const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;
  const landfallS = analysis?.scenario.disasterKind === 'cyclone' ? (analysis.scenario.leadHours ?? 12) * 3600 : null;

  if (error) {
    return (
      <div className="screen"><div className="page">
        <h1>The simulation could not run</h1>
        <p className="danger" role="alert">{error}</p>
        <button className="btn primary" onClick={() => nav('/map')}>Back to the map</button>
      </div></div>
    );
  }
  return (
    <div className="screen">
      <header className="topbar">
        <h2>Simulation</h2>
        {!replayDone ? <button className="btn small" onClick={() => { skip.current = true; }} data-testid="skip-replay">Skip replay</button> : null}
        <button className="btn small" onClick={() => nav('/map')}>Cancel</button>
      </header>
      <div className="panel" style={{ margin: 0, borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
        <p style={{ margin: '0 0 4px' }} aria-live="polite" data-testid="replay-status">
          <span className="step-tag">{replayDone ? 'DONE' : 'STEP 1'}</span>{' '}
          {kind ? (replayDone ? `The ${kind} has run its course.` : `The ${kind} unfolds`) : 'Loading…'}
          {kind && analysis ? <> · <strong className="num" data-testid="replay-clock">{clockText(kind, shown)}</strong>{landfallS !== null && shown >= landfallS && !replayDone ? ' · landfall' : ''}</> : null}
        </p>
        <p style={{ margin: 0 }}>
          <span className="step-tag">{result ? 'DONE' : 'STEP 2'}</span> Evacuation trials{' '}
          <span className="num">{progress?.completed ?? 0}/{MONTE_CARLO.defaultRuns}</span>
          {progress && Number.isFinite(progress.p50) ? <> · P50 <Num v={progress.p50 / 3600} unit="h" digits={1} /> · P95 <Num v={progress.p95 / 3600} unit="h" digits={1} /></> : null}
        </p>
        <div className="bar" role="progressbar" aria-label="Evacuation trials" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 6 }}><span style={{ width: `${pct}%` }} /></div>
        {replayDone && !result ? <p className="muted" style={{ margin: '6px 0 0' }}>Finishing the evacuation trials…</p> : null}
      </div>
      <div className="map-wrap">
        {data && overlay ? <IndiaMap data={data} pin={analysis ? { lat: analysis.scenario.originLat, lon: analysis.scenario.originLon } : null} overlay={overlay} kind={kind} fitOverlay clockS={clock} track={track} eye={eye} /> : <p className="muted" style={{ padding: 16 }}>Loading map data…</p>}
      </div>
    </div>
  );
}
