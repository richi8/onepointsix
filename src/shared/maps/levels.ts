import type { Rect } from '../world.ts';
import type { MapBox, MapGround } from './index.ts';

// A map's ground from levels drawn by hand: flat rectangles at the heights
// the streets, squares and terraces are meant to be, a metre at a time, with
// sharp steps between them. The terrain is a grid of points 4 m apart that
// runs straight between them, so it can't make a sharp step: each point takes
// the lowest level round it, so the terrain never rises over a level, and
// wherever it falls short of one, a walked box tops it up to it, its face the
// step. Buildings dug in below the levels round them push the points round
// their footprints down to their floors, and the boxes stop at their walls.

/** A rectangle of ground at height `y`, its corners on whole metres. */
export interface Level extends Rect {
  y: number;
}

export interface Levelled {
  ground: MapGround;
  /** The walked boxes topping the terrain up to the levels. */
  terraces: MapBox[];
  /** The level at (x, z), as drawn: the last rectangle over it. */
  levelAt: (x: number, z: number) => number;
}

/** The terrain's cell, as the world's. */
const CELL = 4;
/** Heights this near are the same. */
const EPS = 0.01;
/** How far a terrace box reaches under the terrain beneath it. */
const DEPTH = 0.5;

/**
 * The ground of `area` (its corners on the terrain's 4 m grid) from
 * `levels`, later ones over earlier, with `grid` cells round it given by
 * `beyond`, the heights of the backdrop's edge round the town. `dug` are
 * buildings' rooms, inside their walls, with the height of the ground under
 * their floors: the terrain is pushed down to it under them where the levels
 * round them are higher, and nothing is topped up over them, nor over `skip`
 * (ramps, which fill themselves down to the ground).
 */
export function levelGround(opts: {
  area: Rect;
  levels: readonly Level[];
  grid: { x0: number; z0: number; cols: number; rows: number };
  beyond: (x: number, z: number) => number;
  dug: readonly (Rect & { floor: number })[];
  skip: readonly Rect[];
  blend: number;
}): Levelled {
  const { area, levels, grid } = opts;
  const W = area.maxX - area.minX;
  const D = area.maxZ - area.minZ;
  // The levels a metre at a time.
  const raster = new Float32Array(W * D).fill(NaN);
  for (const l of levels) {
    for (let z = Math.max(l.minZ, area.minZ); z < Math.min(l.maxZ, area.maxZ); z++) {
      for (let x = Math.max(l.minX, area.minX); x < Math.min(l.maxX, area.maxX); x++) raster[(z - area.minZ) * W + (x - area.minX)] = l.y;
    }
  }
  const at = (x: number, z: number) => raster[(Math.floor(z) - area.minZ) * W + (Math.floor(x) - area.minX)];
  for (let i = 0; i < raster.length; i++) if (Number.isNaN(raster[i])) throw new Error(`No level at ${area.minX + (i % W)}, ${area.minZ + Math.floor(i / W)}`);
  const inArea = (x: number, z: number) => x >= area.minX && x < area.maxX && z >= area.minZ && z < area.maxZ;

  // Each cell's lowest level, then each point the lowest of the cells round it, pushed down under the dug-in footprints.
  const cellLow = (cx: number, cz: number) => {
    const x0 = grid.x0 + cx * CELL;
    const z0 = grid.z0 + cz * CELL;
    if (!inArea(x0 + CELL / 2, z0 + CELL / 2)) return opts.beyond(x0 + CELL / 2, z0 + CELL / 2);
    let lo = Infinity;
    for (let z = z0; z < z0 + CELL; z++) for (let x = x0; x < x0 + CELL; x++) lo = Math.min(lo, inArea(x, z) ? at(x, z) : opts.beyond(x + 0.5, z + 0.5));
    return lo;
  };
  const lows: number[][] = Array.from({ length: grid.rows - 1 }, (_, cz) => Array.from({ length: grid.cols - 1 }, (_, cx) => cellLow(cx, cz)));
  const heights = Array.from({ length: grid.rows }, (_, r) => Array.from({ length: grid.cols }, (_, c) => {
    let h = Infinity;
    for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
      const row = lows[r + dr];
      if (row && row[c + dc] !== undefined) h = Math.min(h, row[c + dc]);
    }
    return h;
  }));
  for (const d of opts.dug) {
    const c0 = Math.floor((d.minX - grid.x0) / CELL);
    const c1 = Math.ceil((d.maxX - grid.x0) / CELL);
    const r0 = Math.floor((d.minZ - grid.z0) / CELL);
    const r1 = Math.ceil((d.maxZ - grid.z0) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) heights[r][c] = Math.min(heights[r][c], d.floor);
  }

  // Each metre the terrain falls short of its level under, topped up, and merged into rows, then rows into boxes.
  const inside = (rs: readonly Rect[], x: number, z: number) => rs.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  const need = new Float32Array(W * D).fill(NaN);
  const base = new Float32Array(W * D);
  for (let z = area.minZ; z < area.maxZ; z++) {
    for (let x = area.minX; x < area.maxX; x++) {
      const [cx, cz] = [x + 0.5, z + 0.5];
      if (inside(opts.dug, cx, cz) || inside(opts.skip, cx, cz)) continue;
      const c = Math.floor((x - grid.x0) / CELL);
      const r = Math.floor((z - grid.z0) / CELL);
      const corners = [heights[r][c], heights[r][c + 1], heights[r + 1][c], heights[r + 1][c + 1]];
      const y = at(x, z);
      if (corners.every((h) => Math.abs(h - y) < EPS)) continue;
      const i = (z - area.minZ) * W + (x - area.minX);
      need[i] = y;
      base[i] = Math.min(...corners) - DEPTH;
    }
  }
  const terraces: MapBox[] = [];
  let open: MapBox[] = [];
  for (let z = area.minZ; z < area.maxZ; z++) {
    const rows: MapBox[] = [];
    for (let x = area.minX; x < area.maxX; x++) {
      const i = (z - area.minZ) * W + (x - area.minX);
      if (Number.isNaN(need[i])) continue;
      const last = rows[rows.length - 1];
      if (last && last.maxX === x && last.y1 === need[i]) {
        last.maxX = x + 1;
        last.y0 = Math.min(last.y0, base[i]);
      } else rows.push({ minX: x, maxX: x + 1, minZ: z, maxZ: z + 1, y0: base[i], y1: need[i], walk: true });
    }
    // A row the same as one in the row before carries that box on.
    const next: MapBox[] = [];
    for (const row of rows) {
      const k = open.findIndex((b) => b.minX === row.minX && b.maxX === row.maxX && b.y1 === row.y1);
      if (k >= 0) {
        const b = open[k];
        b.maxZ = z + 1;
        b.y0 = Math.min(b.y0, row.y0);
        open.splice(k, 1);
        next.push(b);
      } else {
        terraces.push(row);
        next.push(row);
      }
    }
    open = next;
  }

  return {
    ground: { x0: grid.x0, z0: grid.z0, cell: CELL, heights, blend: opts.blend },
    terraces,
    levelAt: (x, z) => (inArea(x, z) ? at(x, z) : opts.beyond(x, z)),
  };
}
