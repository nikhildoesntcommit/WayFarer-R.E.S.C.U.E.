import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import type { WorldPoint } from '../types';
import { arSupported, xrSystem, type XRSessionLike } from './arSupport';
import { median } from './geometry';
import { scanArea } from './planBuilder';

type State = 'checking' | 'unsupported' | 'idle' | 'running' | 'error';
const MIN_CORNER_GAP_M = 0.3;
const AVERAGE_WINDOW_MS = 400;
/** How far the hit point may wander (m) during the averaging window. A depth sensor pins the surface down, so it is held to more. */
const MAX_WANDER_M = { depth: 0.04, plain: 0.08 };

/**
 * AR walk-around scan with the standard WebXR hit-test API (Android Chrome + ARCore). The phone tracks its own position,
 * so the user walks to each floor corner and taps; no standing point, phone height or compass is needed.
 * The page itself is the DOM-overlay root, so its buttons stay usable on top of the camera image.
 */
export function ArScan() {
  const nav = useNavigate();
  const setSource = useApp((s) => s.setSource);
  const setScanPolygon = useApp((s) => s.setScanPolygon);
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<XRSessionLike | null>(null);
  const latest = useRef<{ x: number; y: number; z: number } | null>(null);
  const recent = useRef<{ t: number; x: number; z: number }[]>([]);
  const [depth, setDepth] = useState(false);
  const [state, setState] = useState<State>('checking');
  const [msg, setMsg] = useState('');
  const [aimed, setAimed] = useState(false);
  const [corners, setCorners] = useState<WorldPoint[]>([]);
  const cornersRef = useRef<WorldPoint[]>([]);
  cornersRef.current = corners;

  useEffect(() => setSource('camera'), [setSource]);

  useEffect(() => {
    let alive = true;
    void arSupported().then((ok) => alive && setState(ok ? 'idle' : 'unsupported'));
    return () => {
      alive = false;
      void session.current?.end().catch(() => undefined);
    };
  }, []);

  // is the reticle on a surface? (sampled, not per frame)
  useEffect(() => {
    if (state !== 'running') return;
    const id = window.setInterval(() => setAimed(latest.current !== null), 200);
    return () => window.clearInterval(id);
  }, [state]);

  const start = async () => {
    const xr = xrSystem();
    if (!xr) return;
    setMsg('');
    try {
      const s = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        // 'depth-sensing' is used when the phone has a depth sensor or ARCore depth (ToF, LiDAR-class, dual camera); it is optional
        optionalFeatures: ['local-floor', 'dom-overlay', 'depth-sensing'],
        depthSensing: { usagePreference: ['cpu-optimized', 'gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
        domOverlay: { root: root.current },
      });
      session.current = s;
      setDepth((s as unknown as { depthUsage?: string }).depthUsage !== undefined);
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { xrCompatible: true }) as WebGLRenderingContext | null;
      if (!gl) throw new Error('WebGL is not available.');
      const Layer = (window as unknown as { XRWebGLLayer: new (s: unknown, g: unknown) => unknown }).XRWebGLLayer;
      s.updateRenderState({ baseLayer: new Layer(s, gl) });
      let ref: unknown;
      try {
        ref = await s.requestReferenceSpace('local-floor');
      } catch {
        ref = await s.requestReferenceSpace('local');
      }
      const viewer = await s.requestReferenceSpace('viewer');
      const source = await s.requestHitTestSource({ space: viewer });
      s.addEventListener('end', () => {
        session.current = null;
        latest.current = null;
        setState('idle');
      });
      const onFrame = (_t: number, frame: Parameters<Parameters<XRSessionLike['requestAnimationFrame']>[0]>[1]) => {
        s.requestAnimationFrame(onFrame);
        const fb = s.renderState.baseLayer?.framebuffer ?? null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const hit = frame.getHitTestResults(source)[0];
        const p = hit?.getPose(ref)?.transform.position;
        latest.current = p ? { x: p.x, y: p.y, z: p.z } : null;
        const now = performance.now();
        if (p) recent.current.push({ t: now, x: p.x, z: p.z });
        while (recent.current.length > 0 && now - recent.current[0]!.t > 1000) recent.current.shift();
      };
      s.requestAnimationFrame(onFrame);
      setCorners([]);
      setState('running');
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error && e.message ? e.message : 'The AR session could not be started.');
    }
  };

  const place = () => {
    if (!latest.current) {
      setMsg('Aim at the floor until the circle turns green, then tap again.');
      return;
    }
    // the point is the median of the last 0.4 s of hit-tests, so tracking jitter and hand tremor average out
    const w = recent.current.filter((r) => performance.now() - r.t <= AVERAGE_WINDOW_MS);
    if (w.length < 3) {
      setMsg('Hold the circle on the corner for a moment and tap again.');
      return;
    }
    const mx = median(w.map((r) => r.x));
    const mz = median(w.map((r) => r.z));
    const wander = Math.max(...w.map((r) => Math.hypot(r.x - mx, r.z - mz)));
    if (wander > (depth ? MAX_WANDER_M.depth : MAX_WANDER_M.plain)) {
      setMsg('The circle was moving. Steady it on the corner and tap again.');
      return;
    }
    // WebXR: x right, z towards the viewer. The plan wants x east, y north, so y = -z (a proper rotation seen from above).
    const pt = { x: mx, y: -mz };
    if (cornersRef.current.some((c) => Math.hypot(c.x - pt.x, c.y - pt.y) < MIN_CORNER_GAP_M)) {
      setMsg('That is the same corner as one already placed.');
      return;
    }
    setMsg('');
    setCorners((c) => [...c, pt]);
  };

  const done = () => {
    void session.current?.end().catch(() => undefined);
    setScanPolygon(corners);
    nav('/calibrate');
  };

  return (
    <div className="screen ar-root" ref={root} data-testid="ar-root">
      {state !== 'running' ? (
        <>
          <header className="topbar">
            <Link to="/scan" className="btn small">← Back</Link>
            <h2>AR scan</h2>
          </header>
          <main className="page" aria-label="AR scan">
            {state === 'checking' ? <p>Checking this phone…</p> : null}
            {state === 'unsupported' ? (
              <div className="panel" role="alert" data-testid="ar-unsupported">
                <p className="danger" style={{ margin: 0 }}>AR scanning is not available in this browser. It needs Chrome on an Android phone that supports Google’s ARCore, opened over https.</p>
                <p><Link className="btn primary" to="/scan/walk">Walk along the walls instead</Link>{' '}<Link className="btn" to="/scan/size">Type the size</Link></p>
              </div>
            ) : null}
            {state === 'error' ? <p className="danger" role="alert">{msg}</p> : null}
            {state === 'idle' || state === 'error' ? (
              <>
                <ol>
                  <li>Press Start. Allow the camera when asked.</li>
                  <li>Move the phone slowly so it can see the floor, until the circle turns green.</li>
                  <li>Walk to each corner of the room, aim the circle at the spot where the wall meets the floor, and tap <em>Place corner</em>.</li>
                  <li>Go around in order, then press <em>Done</em>.</li>
                </ol>
                <button className="btn primary" onClick={() => void start()} data-testid="ar-start">Start</button>
              </>
            ) : null}
          </main>
        </>
      ) : (
        <div className="ar-hud" data-testid="ar-hud">
          <div className={`ar-reticle ${aimed ? 'on' : ''}`} aria-hidden="true" />
          <div className="ar-bar">
            <p className="num" aria-live="polite">{depth ? <span data-testid="ar-depth">Depth sensor on · </span> : null}{corners.length} corner{corners.length === 1 ? '' : 's'}{corners.length >= 3 ? <> · {scanArea(corners).toFixed(1)} m²</> : null}</p>
            {msg ? <p className="warn-text" role="alert">{msg}</p> : !aimed ? <p className="muted" style={{ color: '#fff' }}>Move the phone slowly to find the floor…</p> : null}
            <div className="scan-actions">
              <button className="btn primary" onClick={place} data-testid="ar-place">Place corner</button>
              <button className="btn small" disabled={corners.length === 0} onClick={() => setCorners((c) => c.slice(0, -1))}>Undo</button>
              <button className="btn small primary" disabled={corners.length < 3} onClick={done} data-testid="ar-done">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
