import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../draw/tools';
import { rasterize } from '../grid';
import { makeRoomPlan } from './helpers';

describe('rasterize', () => {
  it('a bare 10 m × 10 m perimeter at 0.5 m/cell is a 20×20 grid, all walkable', () => {
    const plan = emptyPlan('bare', 'draw');
    plan.buildingPerimeterWorld = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const g = rasterize(plan);
    expect(g.rows).toBe(20);
    expect(g.cols).toBe(20);
    expect(g.walkable.flat().every(Boolean)).toBe(true);
  });

  it('walls block cells and leave the interior open; a door opens a passage', () => {
    const plan = makeRoomPlan({ w: 10, h: 10, exits: [{ side: 'bottom', width: 1.2 }], clusters: [{ rect: [2, 2, 8, 8], people: 5 }] });
    const g = rasterize(plan);
    const at = (x: number, y: number) => g.walkable[Math.floor((y - g.originY) / g.metresPerCell)]![Math.floor((x - g.originX) / g.metresPerCell)];
    expect(at(5, 5)).toBe(true);
    expect(at(2, 0)).toBe(false); // on the bottom wall, away from the door
    expect(at(5, 0)).toBe(true); // in the door opening
    expect(g.exits.size).toBe(1);
    expect([...g.exits.values()][0]!.length).toBeGreaterThan(0);
  });
});
