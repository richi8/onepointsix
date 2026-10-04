import { STEP_HEIGHT } from './constants.ts';
import type { Facing, MapBlock, MapBuilding, MapOpening, MapStair } from './maps/index.ts';
import type { Part, Rect } from './world.ts';

// The building kit: a map's buildings, given as blocks of storeys with their
// doors, windows, arches, balconies, stairs and crates (see maps/index.ts),
// worked out as the boxes the world is made of. Walls stand on the blocks'
// edges, so two blocks side by side, of one building or of two, share one
// wall, with the openings either asks for cut through it. Roofs are flat and
// walked on, railed by a parapet where they look out over a drop, and run on
// without one into a roof beside them at the same height.

/** A wall's thickness, a storey's height floor to floor, and a roof's or a floor's thickness. */
export const KIT_WALL = 0.3;
export const STOREY = 3;
export const SLAB = 0.2;
/** A parapet's height above its roof, a railing's above its floor, and a railing's thickness. */
const PARAPET = 1;
const RAIL = 1;
const RAIL_THICK = 0.1;
/** A flight's rise and run per step, as the island's buildings' stairs. */
const STEP_RISE = 0.5;
const STEP_RUN = 0.55;
const FLIGHT_WIDTH = 1.5;
/** How much of a flight's top is left without a railing along its open side, for stepping off it sideways. */
const OFF_SIDE = 1.1;
/** Openings' widths and an arch's height, unless a map says otherwise. */
const WIDTH: Record<MapOpening['kind'], number> = { door: 2.2, window: 1.2, arch: 2.4 };
const ARCH_HEIGHT = 2.6;
const CRATE = 1.1;
/** How far round an outside stair's top steps a parapet is left open, to step onto the roof from it. */
const STAIR_LANDING = 0.6;
/** Heights this near are taken as the same. */
const EPS = 0.05;

/** An opening in a wall line: its middle `at` along the line, which way its door leaves swing across it, and an arch's height. */
export interface KitOpening {
  at: number;
  width: number;
  kind: MapOpening['kind'];
  inward: 1 | -1;
  height?: number;
}

/**
 * A straight wall along x (`axis` 'x', its middle on z = `line`) or along z,
 * from `a0` to `a1`, one storey: its floor at `y`, reaching down to `base`,
 * with its openings.
 */
export interface KitWall {
  axis: 'x' | 'z';
  line: number;
  a0: number;
  a1: number;
  y: number;
  base: number;
  openings: KitOpening[];
}

export interface KitBox extends Rect {
  minY: number;
  maxY: number;
  part: Part;
  walk: boolean;
}

/** What a building of the kit is, for the world's list of buildings. */
export interface KitBuilding extends Rect {
  floor: number;
  /** The underside of its highest roof. */
  roof: number;
  parts: Rect[];
  /** Its storeys' floors above the ground's, lowest first. */
  uppers: number[];
}

export interface Kit {
  walls: KitWall[];
  boxes: KitBox[];
  /** Crates, each its own box. */
  crates: KitBox[];
  buildings: KitBuilding[];
}

/** A block with what it's worked out from: its building's floor and its own roof's underside. */
interface Placed {
  block: MapBlock;
  building: MapBuilding;
  floor: number;
  top: number;
}

const DIR: Record<Facing, [number, number]> = { '-x': [-1, 0], '+x': [1, 0], '-z': [0, -1], '+z': [0, 1] };
const SIDES: Facing[] = ['-z', '+z', '-x', '+x'];

/** Which way a side's wall runs, the line it stands on, and the way out of the block across it. */
function sideOf(b: Rect, side: Facing): { axis: 'x' | 'z'; line: number; out: 1 | -1; lo: number; hi: number } {
  switch (side) {
    case '-z': return { axis: 'x', line: b.minZ, out: -1, lo: b.minX, hi: b.maxX };
    case '+z': return { axis: 'x', line: b.maxZ, out: 1, lo: b.minX, hi: b.maxX };
    case '-x': return { axis: 'z', line: b.minX, out: -1, lo: b.minZ, hi: b.maxZ };
    case '+x': return { axis: 'z', line: b.maxX, out: 1, lo: b.minZ, hi: b.maxZ };
  }
}

/** A rectangle grown by `by` each way (shrunk if negative). */
function grown(r: Rect, by: number): Rect {
  return { minX: r.minX - by, minZ: r.minZ - by, maxX: r.maxX + by, maxZ: r.maxZ + by };
}

/** A box `a0` to `a1` along a line's axis, `c0` to `c1` across it. */
function onLine(axis: 'x' | 'z', a0: number, a1: number, c0: number, c1: number): Rect {
  return axis === 'x'
    ? { minX: a0, maxX: a1, minZ: Math.min(c0, c1), maxZ: Math.max(c0, c1) }
    : { minZ: a0, maxZ: a1, minX: Math.min(c0, c1), maxX: Math.max(c0, c1) };
}

function inside(r: Rect, x: number, z: number): boolean {
  return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
}

/** What's left of `r` with `cut` taken out of it: up to four rectangles. */
export function subtract(r: Rect, cut: Rect): Rect[] {
  if (cut.minX >= r.maxX || cut.maxX <= r.minX || cut.minZ >= r.maxZ || cut.maxZ <= r.minZ) return [r];
  const out: Rect[] = [];
  const z0 = Math.max(r.minZ, cut.minZ);
  const z1 = Math.min(r.maxZ, cut.maxZ);
  if (cut.minZ > r.minZ) out.push({ ...r, maxZ: cut.minZ });
  if (cut.maxZ < r.maxZ) out.push({ ...r, minZ: cut.maxZ });
  if (cut.minX > r.minX) out.push({ minX: r.minX, maxX: cut.minX, minZ: z0, maxZ: z1 });
  if (cut.maxX < r.maxX) out.push({ minX: cut.maxX, maxX: r.maxX, minZ: z0, maxZ: z1 });
  return out.filter((q) => q.maxX - q.minX > 1e-3 && q.maxZ - q.minZ > 1e-3);
}

function intersect(a: Rect, b: Rect): Rect | null {
  const r = { minX: Math.max(a.minX, b.minX), minZ: Math.max(a.minZ, b.minZ), maxX: Math.min(a.maxX, b.maxX), maxZ: Math.min(a.maxZ, b.maxZ) };
  return r.maxX > r.minX && r.maxZ > r.minZ ? r : null;
}

/** The steps of a flight `width` wide, its foot's middle at (x, z), climbing toward `climbs` from `y0` to `y1`: each step's footprint and top. */
export function flightSteps(x: number, z: number, width: number, climbs: Facing, y0: number, y1: number): { r: Rect; top: number }[] {
  const steps = Math.max(1, Math.ceil((y1 - y0) / STEP_RISE - 1e-6));
  const [ux, uz] = DIR[climbs];
  const half = width / 2;
  const out: { r: Rect; top: number }[] = [];
  for (let k = 0; k < steps; k++) {
    const [a0, a1] = [k * STEP_RUN, (k + 1) * STEP_RUN];
    const xa = x + ux * a0 - Math.abs(uz) * half;
    const xb = x + ux * a1 + Math.abs(uz) * half;
    const za = z + uz * a0 - Math.abs(ux) * half;
    const zb = z + uz * a1 + Math.abs(ux) * half;
    out.push({ r: { minX: Math.min(xa, xb), minZ: Math.min(za, zb), maxX: Math.max(xa, xb), maxZ: Math.max(za, zb) }, top: y0 + ((y1 - y0) * (k + 1)) / steps });
  }
  return out;
}

/**
 * Work out a map's buildings. `ground` is the terrain's height; `stairs` are
 * the map's outside stairs, whose tops open the parapets they reach;
 * `surface` is what's walked on outside, the terrain or a terrace over it,
 * where a roof's edge meeting it as high runs on into it with no parapet.
 */
export function buildKit(
  buildings: readonly MapBuilding[], stairs: readonly MapStair[], ground: (x: number, z: number) => number, surface = ground,
): Kit {
  const T = KIT_WALL;
  const boxes: KitBox[] = [];
  const crates: KitBox[] = [];
  const box = (r: Rect, minY: number, maxY: number, part: Part, walk = false) => boxes.push({ ...r, minY, maxY, part, walk });
  const lowest = (r: Rect) => {
    let lo = Infinity;
    for (let x = r.minX; x <= r.maxX + 1e-6; x += Math.max((r.maxX - r.minX) / Math.ceil(r.maxX - r.minX), 0.01)) {
      for (let z = r.minZ; z <= r.maxZ + 1e-6; z += Math.max((r.maxZ - r.minZ) / Math.ceil(r.maxZ - r.minZ), 0.01)) lo = Math.min(lo, ground(x, z));
    }
    return lo;
  };
  const placed: Placed[] = buildings.flatMap((b) => b.blocks.map((block) => ({ block, building: b, floor: b.floor, top: b.floor + STOREY * block.storeys })));
  /** The highest roof over (x, z) among the blocks, or -Infinity. */
  const roofOver = (x: number, z: number) => {
    let top = -Infinity;
    for (const p of placed) if (inside(p.block, x, z)) top = Math.max(top, p.top);
    return top;
  };

  // Holes in the floors and roofs over flights, by the height of the floor's top.
  const holes: { r: Rect; y: number }[] = [];
  /** Railings round the holes, to clip to the floor round them: the strip, its floor's top and the block's inside. */
  const rails: { r: Rect; y: number; room: Rect }[] = [];
  for (const b of buildings) {
    for (const f of b.flights ?? []) {
      const [ux, uz] = DIR[f.climbs];
      const p = placed.find((q) => q.building === b && inside(q.block, f.x + ux * 0.3, f.z + uz * 0.3));
      if (!p) throw new Error(`A flight at (${f.x}, ${f.z}) stands in no block of its building`);
      const y0 = b.floor + STOREY * f.storey;
      const y1 = f.storey + 1 < p.block.storeys ? y0 + STOREY : p.top + SLAB;
      const width = f.width ?? FLIGHT_WIDTH;
      const steps = flightSteps(f.x, f.z, width, f.climbs, y0, y1);
      for (const s of steps) box(s.r, y0 - SLAB, s.top, 'step', true);
      const run = steps.length * STEP_RUN;
      const hole = steps.reduce((a, s) => ({ minX: Math.min(a.minX, s.r.minX), minZ: Math.min(a.minZ, s.r.minZ), maxX: Math.max(a.maxX, s.r.maxX), maxZ: Math.max(a.maxZ, s.r.maxZ) }), steps[0].r);
      holes.push({ r: hole, y: y1 });
      // Railings across its foot and along both sides up to its last steps.
      const room = grown(p.block, -T / 2);
      const [cx, cz] = [Math.abs(uz), Math.abs(ux)];
      const footA = -RAIL_THICK;
      const along = (a0: number, a1: number, c0: number, c1: number): Rect => {
        const xs = [f.x + ux * a0 + cx * c0, f.x + ux * a1 + cx * c1];
        const zs = [f.z + uz * a0 + cz * c0, f.z + uz * a1 + cz * c1];
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      };
      const half = width / 2;
      rails.push({ r: along(footA, 0, -half - RAIL_THICK, half + RAIL_THICK), y: y1, room });
      for (const s of [-1, 1]) rails.push({ r: along(footA, run - OFF_SIDE, s * half, s * (half + RAIL_THICK)), y: y1, room });
    }
  }
  /** A floor or roof slab, less the holes in it. */
  const slab = (r: Rect, y0: number, y1: number, part: Part, walk: boolean) => {
    let pieces = [r];
    for (const h of holes) if (Math.abs(h.y - y1) < 1e-6) pieces = pieces.flatMap((q) => subtract(q, h.r));
    for (const q of pieces) box(q, y0, y1, part, walk);
  };

  // Walls, a storey of a side at a time, merged along each line.
  const spans = new Map<string, KitWall[]>();
  for (const p of placed) {
    const b = p.block;
    const base = lowest(grown(b, T / 2)) - 0.5;
    for (let s = b.from ?? 0; s < b.storeys; s++) {
      const y = p.floor + STOREY * s;
      for (const side of SIDES) {
        const { axis, line, out, lo, hi } = sideOf(b, side);
        const [a0, a1] = axis === 'x' ? [lo - T / 2, hi + T / 2] : [lo + T / 2, hi - T / 2];
        const openings = (b.openings ?? [])
          .filter((o) => o.side === side && (o.storey ?? 0) === s)
          .map((o): KitOpening => ({ at: lo + o.at, width: o.width ?? WIDTH[o.kind], kind: o.kind, inward: out === 1 ? -1 : 1, height: o.kind === 'arch' ? (o.height ?? ARCH_HEIGHT) : undefined }));
        const key = `${axis} ${line.toFixed(3)} ${y.toFixed(3)}`;
        const list = spans.get(key) ?? [];
        list.push({ axis, line, a0, a1, y, base: s === 0 ? base : y, openings });
        spans.set(key, list);
      }
    }
  }
  const walls: KitWall[] = [];
  for (const list of spans.values()) {
    list.sort((p, q) => p.a0 - q.a0);
    let cur: KitWall | null = null;
    for (const w of list) {
      if (cur && w.a0 <= cur.a1 + 1e-6) {
        cur.a1 = Math.max(cur.a1, w.a1);
        cur.base = Math.min(cur.base, w.base);
        for (const o of w.openings) if (!cur.openings.some((q) => Math.abs(q.at - o.at) < 1e-6)) cur.openings.push(o);
      } else {
        if (cur) walls.push(cur);
        cur = { ...w, openings: [...w.openings] };
      }
    }
    if (cur) walls.push(cur);
  }
  // Thresholds under doorways and arches standing above the ground.
  for (const w of walls) {
    if (w.base >= w.y - 1e-6) continue;
    for (const o of w.openings) {
      if (o.kind === 'window') continue;
      box(onLine(w.axis, o.at - o.width / 2, o.at + o.width / 2, w.line - T / 2, w.line + T / 2), w.base, w.y, 'floor');
    }
  }

  // Floors and roofs.
  for (const p of placed) {
    const b = p.block;
    const from = b.from ?? 0;
    const room = grown(b, -T / 2);
    if (from === 0) box(room, lowest(grown(b, T / 2)) - 0.3, p.floor, 'floor');
    for (let s = Math.max(from, 1); s < b.storeys; s++) {
      const y = p.floor + STOREY * s;
      // Over a passage, the floor reaches across the walls' tops either side.
      slab(s === from ? grown(b, T / 2) : room, y - SLAB, y, 'floor', true);
    }
    slab(room, p.top, p.top + SLAB, 'roof', true);
  }

  // The railings round the holes, where there's floor beside them.
  for (const { r, y, room } of rails) {
    const q = intersect(r, room);
    if (!q || Math.min(q.maxX - q.minX, q.maxZ - q.minZ) < RAIL_THICK - 1e-6) continue;
    box(q, y, y + RAIL, 'wall');
  }

  // Where outside stairs come up to a roof: round their top steps, a step below the top.
  const landings: { r: Rect; top: number }[] = [];
  for (const s of stairs) {
    const steps = flightSteps(s.x, s.z, s.width, s.climbs, s.y0, s.y1);
    for (const st of steps) if (st.top >= s.y1 - STEP_HEIGHT) landings.push({ r: grown(st.r, STAIR_LANDING), top: s.y1 });
  }

  // Each roof's edges: a parapet over a drop, a strip over the wall into a roof as high, nothing against a wall going on up.
  for (const p of placed) {
    const b = p.block;
    const roofTop = p.top + SLAB;
    for (const side of SIDES) {
      const { axis, line, out, lo, hi } = sideOf(b, side);
      const marks = new Set([lo, hi]);
      for (const q of placed) for (const v of axis === 'x' ? [q.block.minX, q.block.maxX] : [q.block.minZ, q.block.maxZ]) if (v > lo && v < hi) marks.add(v);
      const cuts = landings.filter((l) => Math.abs(l.top - roofTop) < 0.3 && intersect(l.r, onLine(axis, lo, hi, line - T / 2, line + T / 2)));
      for (const l of cuts) for (const v of axis === 'x' ? [l.r.minX, l.r.maxX] : [l.r.minZ, l.r.maxZ]) if (v > lo && v < hi) marks.add(v);
      const at = [...marks].sort((u, v) => u - v);
      const runs: { a0: number; a1: number; kind: 'parapet' | 'strip' | null }[] = [];
      for (let i = 0; i + 1 < at.length; i++) {
        const m = (at[i] + at[i + 1]) / 2;
        const [ox, oz] = axis === 'x' ? [m, line + out * T] : [line + out * T, m];
        const beyond = roofOver(ox, oz);
        const outside = surface(ox, oz);
        let kind: 'parapet' | 'strip' | null;
        if (beyond > p.top + EPS) kind = null;
        else if (beyond > p.top - EPS) kind = out === 1 ? 'strip' : null;
        // A terrace or the ground beyond as high: walked onto. Higher: its own face walls it.
        else if (outside > roofTop + STEP_HEIGHT) kind = null;
        else if (outside > roofTop - STEP_HEIGHT) kind = 'strip';
        else {
          const [px, pz] = axis === 'x' ? [m, line] : [line, m];
          kind = cuts.some((l) => inside(grown(l.r, 1e-3), px, pz)) ? 'strip' : 'parapet';
        }
        const last = runs[runs.length - 1];
        if (last && last.kind === kind) last.a1 = at[i + 1];
        else runs.push({ a0: at[i], a1: at[i + 1], kind });
      }
      for (const r of runs) {
        if (!r.kind) continue;
        // Along x the ends reach over the corners; along z they stop at them.
        const grow = axis === 'x' ? T / 2 : -T / 2;
        const a0 = r.a0 === lo ? lo - grow : r.a0;
        const a1 = r.a1 === hi ? hi + grow : r.a1;
        const rect = onLine(axis, a0, a1, line - T / 2, line + T / 2);
        if (r.kind === 'parapet') box(rect, p.top, roofTop + PARAPET, 'wall');
        else box(rect, p.top, roofTop, 'roof', true);
      }
    }
  }

  // Balconies: a slab out from the wall, railed round.
  for (const p of placed) {
    for (const bal of p.block.balconies ?? []) {
      const { axis, line, out, lo } = sideOf(p.block, bal.side);
      const y = p.floor + STOREY * bal.storey;
      const [a0, a1] = [lo + bal.at - bal.width / 2, lo + bal.at + bal.width / 2];
      const c0 = line + (out * T) / 2;
      const c1 = c0 + out * bal.depth;
      box(onLine(axis, a0, a1, c0, c1), y - SLAB, y, 'floor', true);
      box(onLine(axis, a0, a1, c1 - out * RAIL_THICK, c1), y, y + RAIL, 'wall');
      for (const [e0, e1] of [[a0, a0 + RAIL_THICK], [a1 - RAIL_THICK, a1]]) box(onLine(axis, e0, e1, c0, c1 - out * RAIL_THICK), y, y + RAIL, 'wall');
    }
  }

  // Crates in the rooms.
  for (const b of buildings) {
    for (const c of b.crates ?? []) {
      const y = b.floor + STOREY * (c.storey ?? 0);
      const h = (c.size ?? CRATE) / 2;
      const r = { minX: c.x - h, minZ: c.z - h, maxX: c.x + h, maxZ: c.z + h };
      const bottom = (c.storey ?? 0) === 0 ? Math.min(y - SLAB, ground(c.x, c.z) - 0.1) : y;
      crates.push({ ...r, minY: bottom, maxY: y + 2 * h, part: 'crate', walk: false });
    }
  }

  const records = buildings.map((b): KitBuilding => {
    const parts = b.blocks.map((k) => grown(k, T / 2));
    const most = Math.max(...b.blocks.map((k) => k.storeys));
    const uppers = Array.from({ length: most - 1 }, (_, i) => b.floor + STOREY * (i + 1));
    return {
      minX: Math.min(...parts.map((r) => r.minX)), minZ: Math.min(...parts.map((r) => r.minZ)),
      maxX: Math.max(...parts.map((r) => r.maxX)), maxZ: Math.max(...parts.map((r) => r.maxZ)),
      floor: b.floor, roof: b.floor + STOREY * most, parts, uppers,
    };
  });
  return { walls, boxes, crates, buildings: records };
}
