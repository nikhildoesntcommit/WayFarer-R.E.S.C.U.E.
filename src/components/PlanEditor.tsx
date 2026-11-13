import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_MIX, DistanceDialog, DoorDialog, PeopleDialog, TimeDialog } from './Dialogs';
import { PlanCanvas, type Gfx, type PlanCanvasHandle } from './PlanCanvas';
import { COLOURS, label as drawLabel, polyPath, renderPlan, scaleBar } from '../draw/render';
import { emptyPlan, newCluster, newHotspot, nearestSegment, placeDoor, rebuildPlan, scalePlan, uid } from '../draw/tools';
import { checkNewArea } from '../marking/areas';
import { validatePlan } from '../marking/validation';
import { isFinalExitDoor } from '../utils/exits';
import { useApp } from '../store';
import type { Door, Hazard, Plan, WorldPoint, WorldPolygon } from '../types';
import { closestOnSegment, dist, pointInPolygon } from '../utils/geo';

export type EditorMode = 'draw' | 'mark';
type Tool = 'wall' | 'door' | 'erase' | 'calibrate' | 'pan' | 'exit' | 'area' | 'hotspot' | 'fire' | 'select';
type HazardKind = Hazard['kind'];
type AreaShape = 'rect' | 'poly';

const GRID_SNAP_M = 0.25;
const MIN_WALL_M = 0.3;
const UNDO_DEPTH = 60;

type Dlg =
  | { k: 'door'; segmentId: string; at: WorldPoint; exit: boolean }
  | { k: 'doorEdit'; id: string }
  | { k: 'areaNew'; poly: WorldPolygon }
  | { k: 'areaEdit'; id: string }
  | { k: 'hotspotNew'; at: WorldPoint }
  | { k: 'hotspotEdit'; id: string }
  | { k: 'hazTime'; hk: HazardKind; poly?: WorldPolygon; doorId?: string; editId?: string }
  | { k: 'calibrate'; measured: number; factor: (real: number) => number }
  | null;

/** Rebuild wall polygons + perimeter after any change to the centre-lines. */
export const rebuild = rebuildPlan;

function dropDoorRefs(p: Plan, doorIds: string[]): Plan {
  const ids = new Set(doorIds);
  const assign = Object.fromEntries(Object.entries(p.clusterExitAssignment ?? {}).filter(([, e]) => !ids.has(e)));
  return {
    ...p,
    doors: p.doors.filter((d) => !ids.has(d.id)),
    hazards: p.hazards.filter((h) => !(h.doorId && ids.has(h.doorId))),
    clusterExitAssignment: assign,
  };
}

/** Do the walls enclose a floor area yet? (A closed outline is what makes "outer wall" meaningful.) */
function traceOk(p: Plan): boolean {
  return validatePlan(p).perimeterClosed;
}

function distToDoor(d: Door, p: WorldPoint): number {
  return closestOnSegment(p, d.startWorld, d.endWorld).d;
}

type Hit = { type: 'door' | 'wall' | 'zone' | 'hazard' | 'hotspot'; id: string } | null;

function hitTest(plan: Plan, w: WorldPoint, tol: number, walls: boolean, people = true): Hit {
  let best: { d: number; hit: Hit } = { d: Infinity, hit: null };
  const consider = (d: number, hit: Hit) => {
    if (d < best.d) best = { d, hit };
  };
  for (const d of plan.doors) {
    const dd = distToDoor(d, w);
    if (dd <= tol) consider(dd * 0.5, { type: 'door', id: d.id });
  }
  for (const h of plan.hazards) {
    if (h.kind === 'fire_origin' && h.polygonWorld?.[0]) {
      const dd = dist(h.polygonWorld[0], w);
      if (dd <= tol * 1.6) consider(dd * 0.5, { type: 'hazard', id: h.id });
    }
  }
  if (people) {
    for (const hs of plan.hotspots ?? []) {
      const dd = dist(hs.at, w);
      if (dd <= Math.max(tol * 1.6, hs.radiusM * 0.5)) consider(dd * 0.4, { type: 'hotspot', id: hs.id });
    }
  }
  if (walls) {
    for (const s of plan.wallSegments ?? []) {
      const dd = closestOnSegment(w, s.a, s.b).d;
      if (dd <= tol) consider(dd, { type: 'wall', id: s.id });
    }
  }
  if (best.hit) return best.hit;
  for (const h of plan.hazards)
    if (h.kind === 'no_go_zone' && h.polygonWorld && pointInPolygon(w, h.polygonWorld)) return { type: 'hazard', id: h.id };
  if (people) for (const c of plan.clusters) if (pointInPolygon(w, c.polygonWorld)) return { type: 'zone', id: c.id };
  return null;
}

export function PlanEditor({ mode }: { mode: EditorMode }) {
  const nav = useNavigate();
  const plan = useApp((s) => s.plan);
  const hydrated = useApp((s) => s.hydrated);
  const setPlan = useApp((s) => s.setPlan);
  const setSource = useApp((s) => s.setSource);
  const patchPlan = useApp((s) => s.patchPlan);

  const [tool, setTool] = useState<Tool>(mode === 'draw' ? 'wall' : 'exit');
  const [areaShape, setAreaShape] = useState<AreaShape>('rect');
  const [poly, setPoly] = useState<WorldPolygon>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [toast, setToast] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);

  const canvas = useRef<PlanCanvasHandle>(null);
  const planRef = useRef<Plan | null>(plan);
  const scaleRef = useRef(30);
  const hover = useRef<WorldPoint | null>(null);
  const dragStart = useRef<WorldPoint | null>(null);
  const chainStart = useRef<WorldPoint | null>(null);
  const calPts = useRef<WorldPoint[]>([]);
  const undo = useRef<Plan[]>([]);
  planRef.current = plan;

  // A drawn plan is created on first entry (Home resets the store when a path is chosen).
  useEffect(() => {
    if (!hydrated) return;
    if (mode === 'draw' && !useApp.getState().plan) {
      setSource('draw');
      setPlan(emptyPlan('Untitled plan', 'draw'));
    }
  }, [hydrated, mode, setPlan, setSource]);

  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((cur) => (cur === m ? '' : cur)), 4000);
  }, []);

  /** Apply an edit with undo history. */
  const edit = useCallback(
    (fn: (p: Plan) => Plan) => {
      const cur = planRef.current;
      if (!cur) return;
      undo.current.push(cur);
      if (undo.current.length > UNDO_DEPTH) undo.current.shift();
      setUndoDepth(undo.current.length);
      patchPlan(fn);
    },
    [patchPlan],
  );

  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    setUndoDepth(undo.current.length);
    if (prev) setPlan({ ...prev, updatedAt: Date.now() });
    chainStart.current = null;
    setPoly([]);
    canvas.current?.redraw();
  }, [setPlan]);

  const cancelDraft = useCallback(() => {
    chainStart.current = null;
    dragStart.current = null;
    calPts.current = [];
    setPoly([]);
    canvas.current?.redraw();
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDraft();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [cancelDraft, doUndo]);

  const changeTool = (t: Tool) => {
    cancelDraft();
    setSelectedId(null);
    setTool(t);
  };

  const validation = useMemo(() => (plan ? validatePlan(plan) : null), [plan]);

  const snap = (p: WorldPoint): WorldPoint => {
    const cur = planRef.current;
    const tol = Math.max(0.2, 12 / scaleRef.current);
    if (cur) {
      let best: WorldPoint | null = null;
      let bd = tol;
      for (const s of cur.wallSegments ?? [])
        for (const e of [s.a, s.b]) {
          const d = dist(e, p);
          if (d < bd) { bd = d; best = e; }
        }
      if (best) return best;
    }
    return { x: Math.round(p.x / GRID_SNAP_M) * GRID_SNAP_M, y: Math.round(p.y / GRID_SNAP_M) * GRID_SNAP_M };
  };

  const addWall = (a: WorldPoint, b: WorldPoint) => {
    edit((p) => rebuild({ ...p, wallSegments: [...(p.wallSegments ?? []), { id: uid('wall'), a, b }] }));
  };

  /** Validate a drawn outline (no bow-ties, not outside the building, no overlap with another area) before asking for numbers. */
  const submitArea = (pts: WorldPolygon) => {
    const cur = planRef.current;
    if (!cur) return;
    const verdict = checkNewArea(cur, pts);
    if (!verdict.ok) {
      say(verdict.reason);
      setPoly([]);
      canvas.current?.redraw();
      return;
    }
    setDlg({ k: 'areaNew', poly: pts });
  };
  const finishPoly = () => {
    if (poly.length < 3) return;
    submitArea(poly);
  };

  const handlers = {
    onDown: (w: WorldPoint) => {
      dragStart.current = snap(w);
      hover.current = snap(w);
    },
    onMove: (w: WorldPoint) => {
      hover.current = snap(w);
      canvas.current?.redraw();
    },
    onCancel: () => {
      dragStart.current = null;
    },
    onUp: (w: WorldPoint) => {
      const cur = planRef.current;
      if (!cur) return;
      const p = snap(w);
      const start = dragStart.current ?? p;
      dragStart.current = null;
      const tol = Math.max(0.3, 14 / scaleRef.current);

      switch (tool) {
        case 'wall': {
          if (dist(start, p) >= MIN_WALL_M) {
            addWall(start, p);
            chainStart.current = p;
          } else if (!chainStart.current) {
            chainStart.current = p;
          } else if (dist(chainStart.current, p) < MIN_WALL_M) {
            chainStart.current = null;
          } else {
            addWall(chainStart.current, p);
            chainStart.current = p;
          }
          canvas.current?.redraw();
          break;
        }
        case 'door':
        case 'exit': {
          const asExit = tool === 'exit';
          const onDoor = hitTest(cur, w, tol, false);
          if (onDoor?.type === 'door') {
            setDlg({ k: 'doorEdit', id: onDoor.id });
            break;
          }
          const near = nearestSegment(cur, w, Math.max(0.5, 18 / scaleRef.current));
          if (!near) {
            say('Tap on a wall to place a door.');
            break;
          }
          if (asExit) {
            // final exits only exist in the outer wall: refuse a wall that has the building on both sides
            const probe = placeDoor(cur, near.segment.id, near.point, 1);
            if (!probe || !isFinalExitDoor(probe, cur.buildingPerimeterWorld)) {
              say(cur.wallSegments && traceOk(cur)
                ? 'That wall is inside the building. Final exits sit in the outer wall; doors between rooms belong in the Draw step.'
                : 'Close the outer wall first, then place the exit in it.');
              break;
            }
          }
          setDlg({ k: 'door', segmentId: near.segment.id, at: near.point, exit: asExit });
          break;
        }
        case 'area': {
          if (areaShape === 'rect') {
            // drag a rectangle; a plain tap does nothing but explain
            if (Math.abs(p.x - start.x) < 0.5 || Math.abs(p.y - start.y) < 0.5) {
              say('Drag from one corner to the opposite corner. Switch to Polygon for other shapes.');
              break;
            }
            const [x0, x1] = [Math.min(start.x, p.x), Math.max(start.x, p.x)];
            const [y0, y1] = [Math.min(start.y, p.y), Math.max(start.y, p.y)];
            submitArea([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
            break;
          }
          if (poly.length >= 3 && dist(poly[0]!, p) < Math.max(0.4, 14 / scaleRef.current)) {
            finishPoly();
            break;
          }
          setPoly((q) => [...q, p]);
          break;
        }
        case 'hotspot': {
          if (!cur.buildingPerimeterWorld.length || !pointInPolygon(w, cur.buildingPerimeterWorld)) {
            say('Place a hotspot on the floor inside the building.');
            break;
          }
          const existing = hitTest(cur, w, tol, false);
          if (existing?.type === 'hotspot') { setDlg({ k: 'hotspotEdit', id: existing.id }); break; }
          if (cur.wallsWorld.some((wp) => pointInPolygon(p, wp))) {
            say('That point is on a wall. Choose open floor.');
            break;
          }
          setDlg({ k: 'hotspotNew', at: p });
          break;
        }
        case 'fire': {
          if (!cur.buildingPerimeterWorld.length || !pointInPolygon(w, cur.buildingPerimeterWorld)) {
            say('Place the fire inside the building.');
            break;
          }
          const existing = hitTest(cur, w, tol, false);
          if (existing?.type === 'hazard') { setDlg({ k: 'hazTime', hk: 'fire_origin', editId: existing.id }); break; }
          setDlg({ k: 'hazTime', hk: 'fire_origin', poly: [p] });
          break;
        }
        case 'erase': {
          const h = hitTest(cur, w, tol, mode === 'draw', mode === 'mark');
          if (!h) break;
          if (h.type === 'door') {
            edit((pl) => rebuild(dropDoorRefs(pl, [h.id])));
          } else if (h.type === 'wall') {
            edit((pl) => {
              const on = pl.doors.filter((d) => d.wallId === h.id).map((d) => d.id);
              return rebuild({ ...dropDoorRefs(pl, on), wallSegments: (pl.wallSegments ?? []).filter((s) => s.id !== h.id) });
            });
          } else if (h.type === 'zone' || h.type === 'hotspot') {
            edit((pl) => ({
              ...pl,
              clusters: pl.clusters.filter((c) => c.id !== h.id),
              hotspots: (pl.hotspots ?? []).filter((x) => x.id !== h.id),
              clusterExitAssignment: Object.fromEntries(Object.entries(pl.clusterExitAssignment ?? {}).filter(([k]) => k !== h.id)),
            }));
          } else {
            edit((pl) => ({ ...pl, hazards: pl.hazards.filter((x) => x.id !== h.id) }));
          }
          break;
        }
        case 'select': {
          const h = hitTest(cur, w, tol, false);
          setSelectedId(h?.id ?? null);
          if (!h) break;
          if (h.type === 'door') setDlg({ k: 'doorEdit', id: h.id });
          else if (h.type === 'zone') setDlg({ k: 'areaEdit', id: h.id });
          else if (h.type === 'hotspot') setDlg({ k: 'hotspotEdit', id: h.id });
          else {
            const hz = cur.hazards.find((x) => x.id === h.id);
            if (hz) setDlg({ k: 'hazTime', hk: hz.kind, editId: hz.id });
          }
          break;
        }
        case 'calibrate': {
          calPts.current = [...calPts.current, p];
          if (calPts.current.length === 2) {
            const [a, b] = calPts.current as [WorldPoint, WorldPoint];
            const measured = dist(a, b);
            calPts.current = [];
            if (measured < 0.2) say('The two points are too close together.');
            else setDlg({ k: 'calibrate', measured, factor: (real) => real / measured });
          }
          canvas.current?.redraw();
          break;
        }
        default:
          break;
      }
    },
  };

  const paint = (g: Gfx) => {
    scaleRef.current = g.scale;
    const cur = planRef.current;
    renderPlan(g, cur, { selectedId });
    const { ctx } = g;
    const h = hover.current;
    // in-progress wall
    if (tool === 'wall') {
      const from = dragStart.current ?? chainStart.current;
      if (from && h) {
        const a = g.w2s(from);
        const b = g.w2s(h);
        ctx.strokeStyle = COLOURS.ink;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(2, 0.2 * g.scale);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        drawLabel(g, `${dist(from, h).toFixed(2)} m`, { x: (from.x + h.x) / 2, y: (from.y + h.y) / 2 }, { dy: -12 });
      }
    }
    // polygon in progress
    // rectangle being dragged
    if (tool === 'area' && areaShape === 'rect' && dragStart.current && h) {
      const a = dragStart.current;
      polyPath(g, [{ x: a.x, y: a.y }, { x: h.x, y: a.y }, { x: h.x, y: h.y }, { x: a.x, y: h.y }]);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COLOURS.brass;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      drawLabel(g, `${Math.abs(h.x - a.x).toFixed(1)} × ${Math.abs(h.y - a.y).toFixed(1)} m`, { x: (a.x + h.x) / 2, y: (a.y + h.y) / 2 }, {});
    }
    const polyDrafting = tool === 'area' && areaShape === 'poly';
    if (polyDrafting && poly.length > 0) {
      polyPath(g, h ? [...poly, h] : poly, false);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COLOURS.brass;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      poly.forEach((q, i) => {
        const s = g.w2s(q);
        ctx.fillStyle = i === 0 ? COLOURS.ink : COLOURS.brass;
        ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
      });
    }
    if (tool === 'calibrate') {
      for (const q of calPts.current) {
        const s = g.w2s(q);
        ctx.strokeStyle = COLOURS.vermillion;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (h && tool !== 'pan') {
      const s = g.w2s(h);
      ctx.strokeStyle = COLOURS.inkFaint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x - 5, s.y);
      ctx.lineTo(s.x + 5, s.y);
      ctx.moveTo(s.x, s.y - 5);
      ctx.lineTo(s.x, s.y + 5);
      ctx.stroke();
    }
    scaleBar(g);
  };

  const fitPlan = useCallback(() => {
    const p = planRef.current;
    const pts: WorldPoint[] = p ? [...p.buildingPerimeterWorld, ...(p.wallSegments ?? []).flatMap((s) => [s.a, s.b])] : [];
    canvas.current?.fit(pts);
  }, []);

  // when the plan first appears (resume / calibrate hand-off) frame it
  const framed = useRef(false);
  useEffect(() => {
    // only a plan that already has walls when it first appears is framed; the view must never jump while drawing
    if (plan && !framed.current) {
      framed.current = true;
      if ((plan.wallSegments?.length ?? 0) > 0) fitPlan();
    }
  }, [plan, fitPlan]);

  if (!plan) {
    return (
      <div className="screen">
        <div className="page">
          <p>No plan is open.</p>
          <button className="btn" onClick={() => nav('/')}>Back to start</button>
        </div>
      </div>
    );
  }

  // ---------- dialogs ----------
  const dialog = (() => {
    if (!dlg) return null;
    const close = () => setDlg(null);
    if (dlg.k === 'door') {
      return (
        <DoorDialog
          title={dlg.exit ? 'Final exit' : 'Door'}
          hint={dlg.exit ? 'This door is in the outer wall, so people who reach it are out of the building.' : undefined}
          onCancel={close}
          onOk={(w) => {
            const door = placeDoor(plan, dlg.segmentId, dlg.at, w);
            if (!door) say(`That wall is shorter than ${w} m. Choose a narrower door or a longer wall.`);
            else {
              const exit = isFinalExitDoor(door, plan.buildingPerimeterWorld);
              edit((p) => rebuild({ ...p, doors: [...p.doors, door] }));
              say(exit ? 'Final exit placed in the outer wall.' : 'Interior door placed. It is a passage, not a way out of the building.');
            }
            close();
          }}
        />
      );
    }
    if (dlg.k === 'doorEdit') {
      const d = plan.doors.find((x) => x.id === dlg.id);
      if (!d) return null;
      return (
        <DoorDialog
          title={d.isExit ? 'Edit final exit' : 'Edit door'}
          initialWidth={d.widthM}
          onCancel={close}
          onDelete={() => {
            edit((p) => rebuild(dropDoorRefs(p, [d.id])));
            close();
          }}
          onOk={(w) => {
            const mid = { x: (d.startWorld.x + d.endWorld.x) / 2, y: (d.startWorld.y + d.endWorld.y) / 2 };
            const moved = placeDoor(plan, d.wallId, mid, w);
            if (!moved) say('That wall is too short for the new width.');
            else edit((p) => rebuild({ ...p, doors: p.doors.map((x) => (x.id === d.id ? { ...moved, id: d.id } : x)) }));
            close();
          }}
        />
      );
    }
    if (dlg.k === 'areaNew') {
      return (
        <PeopleDialog
          kind="area"
          title="New people area"
          onCancel={() => { close(); setPoly([]); }}
          onOk={({ label, people, mix }) => {
            const c = newCluster(plan.clusters.length + 1, dlg.poly, people, mix);
            if (label) c.label = label;
            edit((p) => rebuild({ ...p, clusters: [...p.clusters, c] }));
            setPoly([]);
            close();
          }}
        />
      );
    }
    if (dlg.k === 'areaEdit') {
      const c = plan.clusters.find((x) => x.id === dlg.id);
      if (!c) return null;
      return (
        <PeopleDialog
          kind="area"
          title="Edit people area"
          initialLabel={c.label}
          initialPeople={c.people}
          initialMix={c.groupMix ?? DEFAULT_MIX}
          onCancel={close}
          onDelete={() => { edit((p) => ({ ...p, clusters: p.clusters.filter((x) => x.id !== c.id) })); close(); }}
          onOk={({ label, people, mix }) => {
            edit((p) => ({ ...p, clusters: p.clusters.map((x) => (x.id === c.id ? { ...x, label: label || x.label, people, groupMix: mix } : x)) }));
            close();
          }}
        />
      );
    }
    if (dlg.k === 'hotspotNew') {
      return (
        <PeopleDialog
          kind="hotspot"
          title="New hotspot"
          initialPeople={20}
          onCancel={close}
          onOk={({ label, people, mix, radiusM }) => {
            const h = newHotspot((plan.hotspots ?? []).length + 1, dlg.at, people, radiusM, mix);
            if (label) h.label = label;
            edit((p) => ({ ...p, hotspots: [...(p.hotspots ?? []), h] }));
            close();
          }}
        />
      );
    }
    if (dlg.k === 'hotspotEdit') {
      const h = (plan.hotspots ?? []).find((x) => x.id === dlg.id);
      if (!h) return null;
      return (
        <PeopleDialog
          kind="hotspot"
          title="Edit hotspot"
          initialLabel={h.label}
          initialPeople={h.people}
          initialMix={h.groupMix ?? DEFAULT_MIX}
          initialRadius={h.radiusM}
          onCancel={close}
          onDelete={() => { edit((p) => ({ ...p, hotspots: (p.hotspots ?? []).filter((x) => x.id !== h.id) })); close(); }}
          onOk={({ label, people, mix, radiusM }) => {
            edit((p) => ({ ...p, hotspots: (p.hotspots ?? []).map((x) => (x.id === h.id ? { ...x, label: label || x.label, people, groupMix: mix, radiusM } : x)) }));
            close();
          }}
        />
      );
    }
    if (dlg.k === 'hazTime') {
      const existing = dlg.editId ? plan.hazards.find((h) => h.id === dlg.editId) : undefined;
      const titles: Record<HazardKind, string> = { blocked_exit: 'Blocked exit', no_go_zone: 'No-go zone', fire_origin: 'Fire' };
      const helps: Record<HazardKind, string> = {
        blocked_exit: 'The exit stops working at this time; people already inside its queue are rerouted.',
        no_go_zone: 'Nobody can enter the area from this time. Anyone caught inside is counted as a casualty.',
        fire_origin: 'The fire spreads outward at 0.5 m/s from this point. People route around it, and anyone it reaches is lost.',
      };
      return (
        <TimeDialog
          title={titles[dlg.hk]}
          help={helps[dlg.hk]}
          initial={existing?.activeAtSeconds ?? 30}
          onCancel={() => { close(); setPoly([]); }}
          onDelete={existing ? () => { edit((p) => ({ ...p, hazards: p.hazards.filter((h) => h.id !== existing.id) })); close(); } : undefined}
          onOk={(t) => {
            if (existing) {
              edit((p) => ({ ...p, hazards: p.hazards.map((h) => (h.id === existing.id ? { ...h, activeAtSeconds: t } : h)) }));
            } else {
              const hz: Hazard = { id: uid('haz'), kind: dlg.hk, activeAtSeconds: t, doorId: dlg.doorId, polygonWorld: dlg.poly };
              edit((p) => ({ ...p, hazards: [...p.hazards, hz] }));
            }
            setPoly([]);
            close();
          }}
        />
      );
    }
    if (dlg.k === 'calibrate') {
      return (
        <DistanceDialog
          measured={dlg.measured}
          onCancel={close}
          onOk={(real) => {
            const f = dlg.factor(real);
            edit((p) => scalePlan(p, f));
            close();
            window.setTimeout(fitPlan, 0);
          }}
        />
      );
    }
    return null;
  })();

  // ---------- toolbar ----------
  const drawTools: { id: Tool; text: string }[] = [
    { id: 'wall', text: 'Wall' },
    { id: 'door', text: 'Door' },
    { id: 'erase', text: 'Eraser' },
    { id: 'calibrate', text: 'Calibrate' },
    { id: 'pan', text: 'Pan' },
  ];
  const markTools: { id: Tool; text: string }[] = [
    { id: 'exit', text: 'Exit' },
    { id: 'area', text: 'Area' },
    { id: 'hotspot', text: 'Hotspot' },
    { id: 'fire', text: 'Fire' },
    { id: 'erase', text: 'Erase' },
    { id: 'select', text: 'Select' },
    { id: 'pan', text: 'Pan' },
  ];
  const tools = mode === 'draw' ? drawTools : markTools;
  const vertical = mode === 'mark';
  const toolbar = (
    <div className={`toolbar${vertical ? ' vertical' : ''}`} role="toolbar" aria-label="Tools">
      {tools.map((t) => (
        <button key={t.id} className={`btn${tool === t.id ? ' active' : ''}`} aria-pressed={tool === t.id} data-testid={`tool-${t.id}`} onClick={() => changeTool(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );

  const drafting = tool === 'area' && areaShape === 'poly';
  const hints: Partial<Record<Tool, string>> = {
    wall: 'Drag to draw a wall, or tap points to chain walls. Tap the last point again to stop.',
    door: 'Tap a wall to place a door. Tap a door to edit it.',
    exit: 'Tap the OUTER wall to place a final exit. Tap an exit to change its width.',
    area: areaShape === 'rect'
      ? 'Drag a rectangle over the floor where people are when the alarm sounds. Areas must not overlap.'
      : 'Tap the corners of the area, then tap the first corner again (or Finish). Edges must not cross.',
    hotspot: 'Tap a point where extra people gather, such as a food stall.',
    fire: 'Tap where the fire starts. People will avoid it.',
    erase: mode === 'draw' ? 'Tap a door or a wall to remove it.' : 'Tap an exit, area, hotspot or fire to delete it.',
    calibrate: 'Tap two points whose real distance you know.',
    select: 'Tap an exit, area, hotspot or fire to edit it.',
    pan: 'Drag to move the view. Pinch or scroll to zoom.',
  };

  const nextLabel = mode === 'draw' ? 'Continue to marking' : 'Run simulation';
  const nextOk = mode === 'draw' ? !!validation?.canMark : !!validation?.canSimulate;
  const goNext = () => nav(mode === 'draw' ? '/mark' : '/simulate');

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn small" onClick={() => nav(mode === 'draw' ? '/' : plan.source === 'camera' ? '/calibrate' : '/draw')} aria-label="Back">
          ← Back
        </button>
        <input
          aria-label="Plan name"
          className="plan-name"
          value={plan.name}
          onChange={(e) => patchPlan((p) => ({ ...p, name: e.target.value }))}
        />
        <button className="btn small" onClick={doUndo} disabled={undoDepth === 0}>Undo</button>
        <button className="btn small" onClick={fitPlan}>Fit</button>
        <button className="btn primary" disabled={!nextOk} onClick={goNext} data-testid="next">
          {nextLabel}
        </button>
      </header>
      <div className="editor">
        {vertical ? toolbar : null}
        <div className="editor-col">
          <PlanCanvas ref={canvas} paint={paint} handlers={handlers} panMode={tool === 'pan'} initialFit={plan.buildingPerimeterWorld} cursor={tool === 'pan' ? 'grab' : 'crosshair'} ariaLabel="Floor plan editor" />
          {toast ? <div className="toast" role="status">{toast}</div> : null}
          <div className="subbar">
            <span className="muted">{hints[tool]}</span>
            {tool === 'area' ? (
              <span className="seg" role="group" aria-label="Area shape">
                {(['rect', 'poly'] as const).map((k) => (
                  <button key={k} className={`btn small${areaShape === k ? ' active' : ''}`} onClick={() => { cancelDraft(); setAreaShape(k); }} data-testid={`shape-${k}`}>
                    {k === 'rect' ? 'Rectangle' : 'Polygon'}
                  </button>
                ))}
              </span>
            ) : null}
            {drafting && poly.length > 0 ? (
              <span className="seg">
                <button className="btn small primary" disabled={poly.length < 3} onClick={finishPoly} data-testid="finish-poly">Finish</button>
                <button className="btn small" onClick={cancelDraft}>Cancel</button>
              </span>
            ) : null}
          </div>
          {!vertical ? toolbar : null}
          {validation ? (
            <div className="validation" data-testid="validation" aria-live="polite">
              {validation.checks.map((c) => (
                <span className="row" key={c.id} title={c.detail}>
                  <span className={c.ok ? 'ok' : c.blocking ? 'danger' : 'warn-text'}>{c.ok ? '✓' : c.blocking ? '✗' : '!'}</span> {c.label}
                </span>
              ))}
              {!nextOk ? (
                <span className="muted">
                  {validation.checks.find((c) => c.blocking && !c.ok)?.detail}
                </span>
              ) : validation.checks.find((c) => !c.ok)?.detail ? (
                <span className="warn-text">{validation.checks.find((c) => !c.ok)?.detail}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {dialog}
    </div>
  );
}
