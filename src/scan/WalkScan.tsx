import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import type { WorldPoint } from '../types';
import { scanArea } from './planBuilder';
import { closeLoop, Pdr, snapRightAngles, strideFromWalk } from './pdr';
import { useSensors } from './sensors';

type Stage = 'intro' | 'walking' | 'calibrating';

/** Walk the walls: steps counted from the accelerometer, direction from the compass, a tap at every corner. */
export function WalkScan() {
  const nav = useNavigate();
  const setSource = useApp((s) => s.setSource);
  const setScanPolygon = useApp((s) => s.setScanPolygon);
  const { orient, motion, requestMotion, live } = useSensors();
  const pdr = useRef(new Pdr());
  const dir = useRef({ x: 0, y: 1, have: false });
  const [stage, setStage] = useState<Stage>('intro');
  const [strideCm, setStrideCm] = useState('70');
  const [snap, setSnap] = useState(true);
  const [corners, setCorners] = useState<WorldPoint[]>([]);
  const [view, setView] = useState({ steps: 0, x: 0, y: 0 });
  const [calDist, setCalDist] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setSource('camera'), [setSource]);

  // motion samples -> steps
  useEffect(() => {
    if (stage === 'intro') return;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const o = orient.current;
      if (o.live) {
        // average the compass as a direction so that 359° and 1° do not cancel
        const r = (o.heading * Math.PI) / 180;
        const d = dir.current;
        d.x = d.have ? d.x + 0.15 * (Math.sin(r) - d.x) : Math.sin(r);
        d.y = d.have ? d.y + 0.15 * (Math.cos(r) - d.y) : Math.cos(r);
        d.have = true;
      }
      const h = dir.current.have ? (((Math.atan2(dir.current.x, dir.current.y) * 180) / Math.PI) + 360) % 360 : NaN;
      pdr.current.feed(performance.now() / 1000, Math.hypot(a.x, a.y, a.z), h);
    };
    window.addEventListener('devicemotion', onMotion);
    const id = window.setInterval(() => setView({ steps: pdr.current.steps, x: pdr.current.x, y: pdr.current.y }), 250);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      window.clearInterval(id);
    };
  }, [stage, orient]);

  const stride = Math.min(1.2, Math.max(0.35, Number(strideCm) / 100 || 0.7));

  const begin = async () => {
    setError('');
    if (motion !== 'granted') {
      const ok = await requestMotion();
      if (!ok) {
        setError('Motion sensors are blocked or missing on this device. Use "Type the size" instead.');
        return;
      }
    }
    pdr.current = new Pdr(stride);
    dir.current = { x: 0, y: 1, have: false };
    setCorners([{ x: 0, y: 0 }]);
    setStage('walking');
  };

  const startCalibration = async () => {
    setError('');
    if (motion !== 'granted' && !(await requestMotion())) {
      setError('Motion sensors are blocked or missing on this device.');
      return;
    }
    pdr.current = new Pdr(stride);
    setCalDist('');
    setStage('calibrating');
  };

  const finishCalibration = () => {
    const d = Number(calDist);
    if (!(d > 0)) {
      setError('Type the distance you walked, in metres.');
      return;
    }
    const s = strideFromWalk(d, pdr.current.steps);
    setStrideCm(String(Math.round(s * 100)));
    setError('');
    setStage('intro');
  };

  const addCorner = () => setCorners((c) => [...c, pdr.current.position()]);

  const finish = () => {
    // the walker is back at the first corner: the final position is the loop's closing point
    const pts = [...corners, pdr.current.position()];
    if (pts.length < 4) {
      setError('Mark at least three corners, then walk back to where you started.');
      return;
    }
    let poly = closeLoop(pts);
    if (snap) poly = snapRightAngles(poly) ?? poly;
    setScanPolygon(poly);
    nav('/calibrate');
  };

  const dist = Math.hypot(view.x - (corners[0]?.x ?? 0), view.y - (corners[0]?.y ?? 0));

  return (
    <div className="screen">
      <header className="topbar">
        <Link to="/scan" className="btn small">← Back</Link>
        <h2>Walk along the walls</h2>
      </header>
      <main className="page" aria-label="Walking scan">
        {stage === 'intro' ? (
          <>
            <ol>
              <li>Hold the phone flat in front of you, like a map, with its top pointing the way you walk.</li>
              <li>Stand in a corner and press <em>Start here</em>.</li>
              <li>Walk along the wall to the next corner and tap <em>Corner</em>. Repeat around the room.</li>
              <li>Walk back to where you started and press <em>Finish</em>.</li>
            </ol>
            <div className="setting">
              <h3>Your step length</h3>
              <div className="ctl">
                <input inputMode="numeric" value={strideCm} onChange={(e) => setStrideCm(e.target.value)} aria-label="Step length in centimetres" data-testid="stride" style={{ width: '5rem' }} /> cm
                <button className="btn small" onClick={() => void startCalibration()} data-testid="calibrate-stride">Measure it</button>
              </div>
              <p>Typical is 60–80 cm. For better accuracy, press Measure it and walk a distance you know, such as 10 m.</p>
            </div>
            <label className="setting">
              <h3>The room has square corners</h3>
              <div className="ctl"><input className="switch" type="checkbox" role="switch" checked={snap} onChange={(e) => setSnap(e.target.checked)} data-testid="snap" /></div>
              <p>Straightens walls to right angles when they are already close. Switch off for a room with angled walls.</p>
            </label>
            {motion === 'needs-gesture' || motion === 'idle' ? <p className="muted">The phone will ask for permission to use its motion sensors.</p> : null}
            {error ? <p className="danger" role="alert">{error}</p> : null}
            <button className="btn primary" onClick={() => void begin()} data-testid="walk-start">Start here</button>
          </>
        ) : null}

        {stage === 'calibrating' ? (
          <div className="panel">
            <p>Walk in a straight line over a distance you know, then come back here and type it.</p>
            <p className="num" data-testid="cal-steps">{view.steps} steps</p>
            <label className="field"><span className="label">Distance walked (m)</span><input inputMode="decimal" value={calDist} onChange={(e) => setCalDist(e.target.value)} data-testid="cal-dist" aria-label="Distance walked in metres" /></label>
            {error ? <p className="danger" role="alert">{error}</p> : null}
            <button className="btn primary" onClick={finishCalibration} data-testid="cal-done">Use this</button>{' '}
            <button className="btn" onClick={() => setStage('intro')}>Cancel</button>
          </div>
        ) : null}

        {stage === 'walking' ? (
          <>
            <div className="panel" aria-live="polite">
              <p className="num" data-testid="walk-readout">{view.steps} steps · {dist.toFixed(1)} m from the start · {corners.length - 1} corner{corners.length === 2 ? '' : 's'} marked{corners.length >= 4 ? <> · {scanArea(corners).toFixed(1)} m²</> : null}</p>
              {!live ? <p className="muted">Waiting for the compass…</p> : null}
            </div>
            {error ? <p className="danger" role="alert">{error}</p> : null}
            <div className="scan-actions">
              <button className="btn primary big" onClick={addCorner} data-testid="walk-corner">Corner</button>
              <button className="btn small" disabled={corners.length < 2} onClick={() => setCorners((c) => c.slice(0, -1))}>Undo corner</button>
              <button className="btn small primary" onClick={finish} data-testid="walk-finish">Finish — I am back at the start</button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
