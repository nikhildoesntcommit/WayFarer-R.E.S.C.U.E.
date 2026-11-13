import { describe, expect, it } from 'vitest';
import { deriveGeometry, emptyPlan, placeDoor } from '../../draw/tools';
import { runMonteCarloSync } from '../../engine/pipeline';
import type { Plan, WallSegment } from '../../types';
import { deriveExits, isFinalExitDoor } from '../exits';

const seg = (id: string, ax: number, ay: number, bx: number, by: number): WallSegment => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });

/** 20 x 10 m building, one partition wall at x = 10 with a 1.2 m door, one real exit in the bottom wall of the right room. */
function twoRoomBuilding(): Plan {
  let p = emptyPlan('two rooms', 'draw');
  p.wallSegments = [
    seg('b', 0, 0, 20, 0), seg('r', 20, 0, 20, 10), seg('t', 20, 10, 0, 10), seg('l', 0, 10, 0, 0),
    seg('mid', 10, 0, 10, 10),
  ];
  p = deriveGeometry(p);
  return p;
}

describe('final exits come from the outer perimeter, not from a checkbox', () => {
  it('a door in the outer wall is an exit; a door in a partition is not', () => {
    let p = twoRoomBuilding();
    const outer = placeDoor(p, 'b', { x: 15, y: 0 }, 1.2)!;
    const inner = placeDoor(p, 'mid', { x: 10, y: 5 }, 1.2)!;
    p = deriveGeometry({ ...p, doors: [outer, inner] });
    expect(p.doors.find((d) => d.id === outer.id)!.isExit).toBe(true);
    expect(p.doors.find((d) => d.id === inner.id)!.isExit).toBe(false);
  });

  it('an unclosed outline never produces an exit', () => {
    let p = emptyPlan('open', 'draw');
    p.wallSegments = [seg('b', 0, 0, 20, 0), seg('r', 20, 0, 20, 10), seg('t', 20, 10, 0, 10)]; // left side missing
    p = deriveGeometry(p);
    const d = placeDoor(p, 'b', { x: 10, y: 0 }, 1.2)!;
    p = deriveGeometry({ ...p, doors: [d] });
    expect(p.doors[0]!.isExit).toBe(false);
  });

  it('a door onto a walled inner courtyard is not an exit', () => {
    let p = emptyPlan('courtyard', 'draw');
    p.wallSegments = [
      seg('b', 0, 0, 30, 0), seg('r', 30, 0, 30, 20), seg('t', 30, 20, 0, 20), seg('l', 0, 20, 0, 0),
      // inner courtyard ring, fully enclosed
      seg('c1', 10, 5, 20, 5), seg('c2', 20, 5, 20, 15), seg('c3', 20, 15, 10, 15), seg('c4', 10, 15, 10, 5),
    ];
    p = deriveGeometry(p);
    const toCourtyard = placeDoor(p, 'c1', { x: 15, y: 5 }, 1.2)!;
    const outside = placeDoor(p, 'b', { x: 5, y: 0 }, 1.2)!;
    p = deriveGeometry({ ...p, doors: [toCourtyard, outside] });
    expect(p.doors.find((d) => d.id === toCourtyard.id)!.isExit).toBe(false);
    expect(p.doors.find((d) => d.id === outside.id)!.isExit).toBe(true);
  });

  it('a stale "exit" flag on an interior door is corrected, and references to it are dropped', () => {
    let p = twoRoomBuilding();
    const inner = { ...placeDoor(p, 'mid', { x: 10, y: 5 }, 1.2)!, isExit: true };
    p = { ...p, doors: [inner], clusterExitAssignment: { z1: inner.id }, hazards: [{ id: 'h', kind: 'blocked_exit', doorId: inner.id, activeAtSeconds: 10 }] };
    const fixed = deriveExits(p);
    expect(fixed.doors[0]!.isExit).toBe(false);
    expect(fixed.clusterExitAssignment).toEqual({});
    expect(fixed.hazards).toHaveLength(0);
  });

  it('works for a scanned room whose perimeter is given explicitly', () => {
    const p = emptyPlan('scan', 'camera');
    const corners = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
    p.wallSegments = corners.map((c, i) => ({ id: `w${i}`, a: c, b: corners[(i + 1) % 4]! }));
    const g = deriveGeometry(p, { perimeter: corners });
    const d = placeDoor(g, 'w0', { x: 3, y: 0 }, 1)!;
    expect(isFinalExitDoor(d, g.buildingPerimeterWorld)).toBe(true);
  });

  it('people in the far room can only leave through the outer exit (the partition door is a passage, not an escape)', () => {
    let p = twoRoomBuilding();
    const outer = placeDoor(p, 'b', { x: 15, y: 0 }, 1.5)!;
    const inner = placeDoor(p, 'mid', { x: 10, y: 5 }, 1.5)!;
    p = deriveGeometry({
      ...p,
      doors: [outer, inner],
      clusters: [{ id: 'left', label: 'Left room', polygonWorld: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }], people: 10, groupMix: { adult: 1, child: 0, elderly: 0, wheelchair: 0 } }],
    });
    const { result } = runMonteCarloSync(p, 5, 7);
    expect(Object.keys(result.exitLoads)).toEqual([outer.id]);
    expect(result.evacuated).toBe(5 * 10);
    // they had to cross the partition and walk to x ≈ 15: a lower bound far above "reach the nearest door"
    expect(result.p50).toBeGreaterThan(12);
  });
});
