import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { WorldPoint } from '../types';
import { boundingBox } from '../utils/geo';

/** Drawing surface in the plan's world metres (y up). */
export interface Gfx {
  ctx: CanvasRenderingContext2D;
  /** world -> CSS pixels */
  w2s: (p: WorldPoint) => { x: number; y: number };
  s2w: (x: number, y: number) => WorldPoint;
  /** pixels per metre */
  scale: number;
  width: number;
  height: number;
}

export interface CanvasHandlers {
  onDown?: (w: WorldPoint, e: PointerEvent) => void;
  onMove?: (w: WorldPoint, e: PointerEvent) => void;
  onUp?: (w: WorldPoint, e: PointerEvent) => void;
  /** A second finger arrived: abandon the gesture in progress. */
  onCancel?: () => void;
}

export interface PlanCanvasHandle {
  fit: (points: WorldPoint[]) => void;
  redraw: () => void;
}

interface View {
  cx: number;
  cy: number;
  scale: number;
}

interface Props {
  /** Called on every repaint, after the view transform is known. */
  paint: (g: Gfx) => void;
  handlers?: CanvasHandlers;
  panMode?: boolean;
  initialFit?: WorldPoint[];
  cursor?: string;
  ariaLabel?: string;
  minScale?: number;
  maxScale?: number;
}

const DEFAULT_SCALE = 30;

/**
 * Shared canvas for the draw, marking, calibrate and result screens.
 * One pointer = tool gesture; two pointers or right/middle button = pan/zoom; wheel = zoom.
 */
export const PlanCanvas = forwardRef<PlanCanvasHandle, Props>(function PlanCanvas(
  { paint, handlers, panMode, initialFit, cursor, ariaLabel, minScale = 0.25, maxScale = 400 },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ cx: 10, cy: 7, scale: DEFAULT_SCALE });
  const size = useRef({ w: 300, h: 200, dpr: 1 });
  const paintRef = useRef(paint);
  const handlersRef = useRef(handlers);
  const panModeRef = useRef(panMode);
  const raf = useRef(0);
  const fitted = useRef(false);
  const zoomRef = useRef<(factor: number) => void>(() => undefined);
  paintRef.current = paint;
  handlersRef.current = handlers;
  panModeRef.current = panMode;

  const s2w = useCallback((x: number, y: number): WorldPoint => {
    const v = view.current;
    const { w, h } = size.current;
    return { x: v.cx + (x - w / 2) / v.scale, y: v.cy - (y - h / 2) / v.scale };
  }, []);

  const draw = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = view.current;
    const g: Gfx = {
      ctx,
      scale: v.scale,
      width: w,
      height: h,
      w2s: (p) => ({ x: w / 2 + (p.x - v.cx) * v.scale, y: h / 2 - (p.y - v.cy) * v.scale }),
      s2w,
    };
    // exposed for the end-to-end tests, which need to turn plan metres into pointer positions
    canvas.dataset.view = `${v.cx},${v.cy},${v.scale},${w},${h}`;
    paintRef.current(g);
  }, [s2w]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(
    (pts: WorldPoint[]) => {
      const { w, h } = size.current;
      if (pts.length === 0) {
        view.current = { cx: 10, cy: 7, scale: Math.min(DEFAULT_SCALE, Math.max(minScale, w / 22)) };
      } else {
        const bb = boundingBox(pts);
        const spanX = Math.max(2, bb.maxX - bb.minX);
        const spanY = Math.max(2, bb.maxY - bb.minY);
        const scale = Math.min(maxScale, Math.max(minScale, Math.min((w * 0.88) / spanX, (h * 0.88) / spanY)));
        view.current = { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, scale };
      }
      schedule();
    },
    [maxScale, minScale, schedule],
  );

  useImperativeHandle(ref, () => ({ fit, redraw: schedule }), [fit, schedule]);

  // every React render of the parent repaints (cheap: one canvas)
  useEffect(() => {
    schedule();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      size.current = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
      canvas.width = Math.round(size.current.w * dpr);
      canvas.height = Math.round(size.current.h * dpr);
      if (!fitted.current) {
        fitted.current = true;
        fit(initialFit ?? []);
      }
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // ---- pointer handling ----
    const pts = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'tool' | 'pan' | 'pinch' = 'none';
    let last = { x: 0, y: 0 };
    let pinch = { dist: 0, mid: { x: 0, y: 0 } };

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const zoomAt = (x: number, y: number, factor: number) => {
      const before = s2w(x, y);
      const v = view.current;
      v.scale = Math.min(maxScale, Math.max(minScale, v.scale * factor));
      const { w, h } = size.current;
      v.cx = before.x - (x - w / 2) / v.scale;
      v.cy = before.y + (y - h / 2) / v.scale;
      schedule();
    };

    // Space held = temporary pan (any tool), as in every drawing program.
    let spaceDown = false;
    // Space is only taken while the pointer is over the canvas (so a focused toolbar button keeps working elsewhere)
    // and never while typing in a field.
    let hovering = false;
    let spaceConsumed = false;
    const typingInField = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');
    const keyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typingInField(e.target)) return;
      if (!hovering && !spaceDown) return;
      spaceDown = true;
      spaceConsumed = true;
      canvas.style.cursor = 'grab';
      e.preventDefault(); // stops the page scrolling and the focused button re-firing
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDown = false;
      canvas.style.cursor = '';
      if (spaceConsumed) { spaceConsumed = false; e.preventDefault(); }
    };
    const enter = () => { hovering = true; };
    const leave = () => { hovering = false; };

    // While a tool gesture is dragged against the canvas edge, scroll the view so a long wall can be finished.
    const EDGE = 28;
    let edgeRaf = 0;
    let lastPtr: { x: number; y: number; ev: PointerEvent } | null = null;
    const edgeStep = () => {
      edgeRaf = 0;
      if (mode !== 'tool' || !lastPtr) return;
      const { w, h } = size.current;
      const v = view.current;
      const speed = 10; // screen px per frame at the very edge
      let dx = 0;
      let dy = 0;
      if (lastPtr.x < EDGE) dx = -speed * (1 - Math.max(0, lastPtr.x) / EDGE);
      else if (lastPtr.x > w - EDGE) dx = speed * (1 - Math.max(0, w - lastPtr.x) / EDGE);
      if (lastPtr.y < EDGE) dy = -speed * (1 - Math.max(0, lastPtr.y) / EDGE);
      else if (lastPtr.y > h - EDGE) dy = speed * (1 - Math.max(0, h - lastPtr.y) / EDGE);
      if (dx === 0 && dy === 0) return;
      v.cx += dx / v.scale;
      v.cy -= dy / v.scale;
      schedule();
      handlersRef.current?.onMove?.(s2w(lastPtr.x, lastPtr.y), lastPtr.ev);
      edgeRaf = requestAnimationFrame(edgeStep);
    };

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 2) {
        if (mode === 'tool') handlersRef.current?.onCancel?.();
        mode = 'pinch';
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
      if (pts.size > 2) return;
      last = p;
      // no tool attached (preview, results): a plain drag pans, as people expect from a map
      if (e.button === 1 || e.button === 2 || panModeRef.current || spaceDown || !handlersRef.current?.onDown) {
        mode = 'pan';
      } else {
        mode = 'tool';
        handlersRef.current?.onDown?.(s2w(p.x, p.y), e);
      }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v = view.current;
        v.cx -= (mid.x - pinch.mid.x) / v.scale;
        v.cy += (mid.y - pinch.mid.y) / v.scale;
        zoomAt(mid.x, mid.y, d / pinch.dist);
        pinch = { dist: d, mid };
        return;
      }
      if (mode === 'pan') {
        const v = view.current;
        v.cx -= (p.x - last.x) / v.scale;
        v.cy += (p.y - last.y) / v.scale;
        last = p;
        schedule();
        return;
      }
      handlersRef.current?.onMove?.(s2w(p.x, p.y), e);
      if (mode === 'tool' && e.buttons !== 0) {
        lastPtr = { x: p.x, y: p.y, ev: e };
        if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeStep);
      }
    };
    const up = (e: PointerEvent) => {
      lastPtr = null;
      const p = local(e);
      const wasMode = mode;
      pts.delete(e.pointerId);
      if (wasMode === 'pinch') {
        if (pts.size < 2) mode = 'none';
        return;
      }
      if (wasMode === 'tool') handlersRef.current?.onUp?.(s2w(p.x, p.y), e);
      if (pts.size === 0) mode = 'none';
    };
    const cancel = (e: PointerEvent) => {
      lastPtr = null;
      pts.delete(e.pointerId);
      if (mode === 'tool') handlersRef.current?.onCancel?.();
      if (pts.size === 0) mode = 'none';
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      // A trackpad two-finger scroll arrives as many small pixel deltas (often with a sideways part) and should PAN;
      // a pinch arrives with ctrlKey set and a mouse wheel as large line/notch steps: both ZOOM.
      const trackpadScroll = !e.ctrlKey && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)));
      if (trackpadScroll) {
        const v = view.current;
        v.cx += e.deltaX / v.scale;
        v.cy -= e.deltaY / v.scale;
        schedule();
        return;
      }
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    const zoomBy = (factor: number) => {
      const { w, h } = size.current;
      zoomAt(w / 2, h / 2, factor);
    };
    zoomRef.current = zoomBy;
    const noMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', noMenu);
    canvas.addEventListener('pointerenter', enter);
    canvas.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      canvas.removeEventListener('pointerenter', enter);
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      cancelAnimationFrame(edgeRaf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', noMenu);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef} style={{ cursor: cursor ?? 'crosshair' }}>
      <canvas ref={canvasRef} aria-label={ariaLabel ?? 'Plan canvas'} role="img" data-testid="plan-canvas" />
      <div className="zoom-ctl" role="group" aria-label="Zoom">
        <button type="button" className="btn small" aria-label="Zoom in" data-testid="zoom-in" onClick={() => zoomRef.current(1.4)}>+</button>
        <button type="button" className="btn small" aria-label="Zoom out" data-testid="zoom-out" onClick={() => zoomRef.current(1 / 1.4)}>−</button>
      </div>
    </div>
  );
});
