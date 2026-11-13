/**
 * Marching squares on a regular scalar field (row-major, `rows` x `cols`).
 * Vertices are the field samples; output coordinates are in sample units: x = column, y = row (fractional).
 */
export type Segment = [x0: number, y0: number, x1: number, y1: number];

export function contourSegments(field: ArrayLike<number>, rows: number, cols: number, level: number): Segment[] {
  const out: Segment[] = [];
  const at = (r: number, c: number) => field[r * cols + c]!;
  const lerp = (a: number, b: number) => {
    const d = b - a;
    return Math.abs(d) < 1e-12 ? 0.5 : (level - a) / d;
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = at(r, c);
      const tr = at(r, c + 1);
      const br = at(r + 1, c + 1);
      const bl = at(r + 1, c);
      if (!(Number.isFinite(tl) && Number.isFinite(tr) && Number.isFinite(br) && Number.isFinite(bl))) continue;
      const idx = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      const top = (): [number, number] => [c + lerp(tl, tr), r];
      const right = (): [number, number] => [c + 1, r + lerp(tr, br)];
      const bottom = (): [number, number] => [c + lerp(bl, br), r + 1];
      const left = (): [number, number] => [c, r + lerp(tl, bl)];
      const seg = (p: [number, number], q: [number, number]) => out.push([p[0], p[1], q[0], q[1]]);

      switch (idx) {
        case 1: case 14: seg(left(), bottom()); break;
        case 2: case 13: seg(bottom(), right()); break;
        case 3: case 12: seg(left(), right()); break;
        case 4: case 11: seg(top(), right()); break;
        case 6: case 9: seg(top(), bottom()); break;
        case 7: case 8: seg(top(), left()); break;
        case 5: {
          const centreAbove = (tl + tr + br + bl) / 4 >= level;
          if (centreAbove) { seg(top(), left()); seg(bottom(), right()); }
          else { seg(top(), right()); seg(left(), bottom()); }
          break;
        }
        case 10: {
          const centreAbove = (tl + tr + br + bl) / 4 >= level;
          if (centreAbove) { seg(top(), right()); seg(left(), bottom()); }
          else { seg(top(), left()); seg(bottom(), right()); }
          break;
        }
      }
    }
  }
  return out;
}

/** Join segments that share endpoints into polylines (useful for smooth strokes and label placement). */
export function chainSegments(segments: Segment[]): [number, number][][] {
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const ends = new Map<string, number[]>();
  segments.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const arr = ends.get(k);
      if (arr) arr.push(i);
      else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: [number, number][][] = [];
  const next = (k: string): number => {
    for (const i of ends.get(k) ?? []) if (!used[i]) return i;
    return -1;
  };
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segments[i]!;
    const line: [number, number][] = [[s[0], s[1]], [s[2], s[3]]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line[line.length - 1]! : line[0]!;
        const j = next(key(tip[0], tip[1]));
        if (j < 0) break;
        used[j] = 1;
        const t = segments[j]!;
        const a: [number, number] = [t[0], t[1]];
        const b: [number, number] = [t[2], t[3]];
        const far = key(a[0], a[1]) === key(tip[0], tip[1]) ? b : a;
        if (dir) line.push(far);
        else line.unshift(far);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Midpoint (by vertex count) of a polyline, with the local direction, for label placement. */
export function labelAnchor(line: [number, number][]): { x: number; y: number; angle: number } {
  const i = Math.floor((line.length - 1) / 2);
  const a = line[i]!;
  const b = line[Math.min(line.length - 1, i + 1)]!;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
