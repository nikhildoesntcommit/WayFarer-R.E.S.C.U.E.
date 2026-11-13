import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { useApp } from '../store';
import type { WorldPoint } from '../types';

import {
  AimError, computeCornerPosition, DEFAULT_PHONE_HEIGHT_M, DUPLICATE_CORNER_M, nearestCornerDistance, tapToVideoPixels,
} from './geometry';
import { scanArea } from './planBuilder';
import { useSensors } from './sensors';

type CamState = 'starting' | 'live' | 'denied' | 'unsupported' | 'error';

/** Path A (spec §7 Screen 2A / §8): corner-tap with the gyroscope. */
export function CameraCapture() {
  const nav = useNavigate();
  const setSource = useApp((s) => s.setSource);
  const setScanPolygon = useApp((s) => s.setScanPolygon);
  const video = useRef<HTMLVideoElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const { orient, motion, requestMotion, live: orientLive, still, absolute } = useSensors();

  const [cam, setCam] = useState<CamState>('starting');
  const [camMsg, setCamMsg] = useState('');
  const [corners, setCorners] = useState<WorldPoint[]>([]);
  const [heightStr, setHeightStr] = useState(String(DEFAULT_PHONE_HEIGHT_M));
  const [preview, setPreview] = useState<{ d: number; ok: boolean; msg: string }>({ d: NaN, ok: false, msg: 'Aim below the horizon' });
  const [warn, setWarn] = useState('');
  const [confirm, setConfirm] = useState<WorldPoint | null>(null);
  const [manual, setManual] = useState(false);

  const height = Number(heightStr);
  const heightOk = Number.isFinite(height) && height >= 0.5 && height <= 2.5;

  const startCamera = useCallback(async () => {
    setCam('starting');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCam('unsupported');
      setCamMsg(
        window.isSecureContext
          ? 'This browser cannot access a camera.'
          : 'The camera needs a secure (HTTPS) connection. Open the app from its https:// address, not from an http:// or local-network address.',
      );
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setCam('live');
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setCam('denied');
        setCamMsg('Camera permission was denied. Allow camera access for this site in your browser settings, or draw the layout instead.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setCam('error');
        setCamMsg('No camera was found on this device.');
      } else {
        setCam('error');
        setCamMsg(`The camera could not be started (${name || 'unknown error'}).`);
      }
    }
  }, []);

  useEffect(() => {
    setSource('camera');
    void startCamera();
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [setSource, startCamera]);

  // live distance to whatever is under the crosshair
  useEffect(() => {
    if (cam !== 'live') return;
    const id = window.setInterval(() => {
      const v = video.current;
      if (!v || !v.videoWidth) return;
      const o = orient.current;
      if (!o.live) {
        setPreview({ d: NaN, ok: false, msg: 'Waiting for the motion sensors…' });
        return;
      }
      try {
        const p = computeCornerPosition({
          beta: o.beta, headingDeg: o.heading, phoneHeightM: heightOk ? height : DEFAULT_PHONE_HEIGHT_M,
          videoWidth: v.videoWidth, videoHeight: v.videoHeight, tapX: v.videoWidth / 2, tapY: v.videoHeight / 2,
        });
        setPreview({ d: p.distanceM, ok: true, msg: '' });
      } catch (e) {
        setPreview({ d: NaN, ok: false, msg: e instanceof AimError ? e.message : 'Cannot measure' });
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [cam, orient, height, heightOk]);

  // mini plan (top-down), also used by manual mode
  useEffect(() => {
    const c = mini.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(244,235,220,0.92)';
    ctx.fillRect(0, 0, W, H);
    const pts = [{ x: 0, y: 0 }, ...corners];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const span = Math.max(4, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const s = (Math.min(W, H) - 24) / span;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const P = (p: WorldPoint) => ({ x: W / 2 + (p.x - cx) * s, y: H / 2 - (p.y - cy) * s });
    ctx.strokeStyle = '#182230';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach((p, i) => {
      const q = P(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    if (corners.length >= 3) ctx.closePath();
    ctx.stroke();
    corners.forEach((p, i) => {
      const q = P(p);
      ctx.fillStyle = '#B8862A';
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#182230';
      ctx.font = '10px monospace';
      ctx.fillText(String(i + 1), q.x + 6, q.y - 6);
    });
    const me = P({ x: 0, y: 0 });
    ctx.strokeStyle = '#7A8694';
    ctx.strokeRect(me.x - 4, me.y - 4, 8, 8);
  }, [corners]);

  const addCorner = (p: WorldPoint, force = false) => {
    if (!force && corners.length > 0 && nearestCornerDistance(corners, p) < DUPLICATE_CORNER_M) {
      setConfirm(p);
      return;
    }
    setCorners((c) => [...c, p]);
  };

  const onTap = (e: React.PointerEvent<HTMLDivElement>) => {
    setWarn('');
    if (cam !== 'live' || !video.current) return;
    if (!heightOk) {
      setWarn('Enter your phone height between 0.5 and 2.5 m first.');
      return;
    }
    if (!still) {
      setWarn('Hold still, then tap again.');
      return;
    }
    const o = orient.current;
    if (!o.live) {
      setWarn('The motion sensors are not reporting. Enable them, or use manual placement.');
      return;
    }
    const v = video.current;
    const r = e.currentTarget.getBoundingClientRect();
    const px = tapToVideoPixels(e.clientX - r.left, e.clientY - r.top, r.width, r.height, v.videoWidth, v.videoHeight);
    try {
      const p = computeCornerPosition({
        beta: o.beta, headingDeg: o.heading, phoneHeightM: height, videoWidth: v.videoWidth, videoHeight: v.videoHeight, tapX: px.x, tapY: px.y,
      });
      addCorner({ x: p.x, y: p.y });
    } catch (err) {
      setWarn(err instanceof AimError ? err.message : 'Could not place that corner.');
    }
  };

  const onManualTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // manual mode: corners are tapped on the mini plan, at a provisional scale that /calibrate then fixes
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 20 - 10;
    const y = 10 - ((e.clientY - r.top) / r.height) * 20;
    addCorner({ x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 });
  };

  const done = () => {
    setScanPolygon(corners);
    nav('/calibrate');
  };

  const fallbackNeeded = cam === 'denied' || cam === 'unsupported' || cam === 'error';
  const motionBlocked = cam === 'live' && (motion === 'denied' || motion === 'unavailable');

  if (fallbackNeeded) {
    return (
      <div className="screen">
        <div className="page">
          <h1>Scan a room</h1>
          <div className="panel" role="alert" data-testid="camera-error">
            <p className="danger" style={{ margin: 0 }}>{camMsg}</p>
          </div>
          <p>You can still build the same analysis by drawing the floor plan yourself.</p>
          <button className="btn primary" onClick={() => nav('/draw')} data-testid="use-draw">Use draw mode instead</button>{' '}
          <button className="btn" onClick={() => void startCamera()}>Try the camera again</button>{' '}
          <button className="btn" onClick={() => nav('/')}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen scan">
      <div className="scan-stage" onPointerUp={manual ? undefined : onTap} data-testid="scan-stage">
        <video ref={video} playsInline muted autoPlay className="scan-video" style={{ visibility: manual ? 'hidden' : 'visible' }} />
        <div className="crosshair" aria-hidden="true"><span /><span /></div>
        <div className="scan-top" onPointerUp={(e) => e.stopPropagation()}>
          <button className="btn small" onClick={() => nav('/')}>← Back</button>
          <label className="scan-height">
            <span className="label">Phone height (m)</span>
            <input value={heightStr} inputMode="decimal" onChange={(e) => setHeightStr(e.target.value)} onPointerUp={(e) => e.stopPropagation()} aria-invalid={!heightOk} aria-label="Phone height in metres" />
          </label>
          <canvas ref={mini} width={120} height={120} className="scan-mini" aria-label="Plan so far" onPointerUp={manual ? onManualTap : undefined} />
        </div>
        <div className="scan-readout num" aria-live="polite">
          {preview.ok ? <>{preview.d.toFixed(2)}<span className="unit">m</span> to the point under the crosshair</> : preview.msg}
        </div>
      </div>
      <div className="scan-bottom" onPointerUp={(e) => e.stopPropagation()}>
        <p className="scan-help">Stand at a corner. Aim the crosshair where the wall meets the floor. Tap to place a corner.</p>
        {warn ? <p className="danger" role="alert" style={{ margin: 0 }}>{warn}</p> : null}
        {!still && cam === 'live' ? <p className="warn-text" style={{ margin: 0 }}>Hold still…</p> : null}
        {motion === 'needs-gesture' ? (
          <button className="btn" onClick={() => void requestMotion()}>Enable motion sensors</button>
        ) : null}
        {cam === 'live' && motion === 'granted' && !orientLive ? <p className="muted" style={{ margin: 0 }}>Waiting for motion sensor readings…</p> : null}
        {cam === 'live' && orientLive && !absolute ? <p className="muted" style={{ margin: 0 }}>Compass not available: the plan’s north will be arbitrary (its shape is unaffected).</p> : null}
        {motionBlocked ? (
          <p className="warn-text" style={{ margin: 0 }}>
            Motion sensors are {motion === 'denied' ? 'blocked' : 'unavailable'}.{' '}
            <button className="btn small" onClick={() => setManual(true)}>Place corners by hand</button>
          </p>
        ) : null}
        {manual ? <p className="muted" style={{ margin: 0 }}>Tap the corners on the small plan (top right). You will set the real scale on the next screen.</p> : null}
        <div className="scan-actions">
          <span className="num">{corners.length}<span className="unit">corners</span>{corners.length >= 3 ? <> · {scanArea(corners).toFixed(1)}<span className="unit">m²</span></> : null}</span>
          <button className="btn small" disabled={corners.length === 0} onClick={() => setCorners((c) => c.slice(0, -1))}>Undo last corner</button>
          <button className="btn small primary" disabled={corners.length < 3} onClick={done} data-testid="scan-done">Done</button>
        </div>
      </div>
      {confirm ? (
        <Modal title="Same corner?" onClose={() => setConfirm(null)}>
          <p>This corner is only {nearestCornerDistance(corners, confirm).toFixed(2)} m from another one. Was that a double tap?</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>Discard it</button>
            <button className="btn primary" onClick={() => { addCorner(confirm, true); setConfirm(null); }}>Keep it</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

