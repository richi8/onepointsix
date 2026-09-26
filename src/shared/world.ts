import {
  GRID_RES,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STEP_HEIGHT,
  WATER_FLOOR_DEPTH,
  WATER_LEVEL,
  WORLD_SIZE,
} from './constants.ts';
import { clamp, rayAabb, rayCylinder, smoothstep } from './geom.ts';
import { fbm, mulberry32 } from './rng.ts';

export interface Cyl {
  kind: 'cyl';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  stamp: number;
  gone?: boolean;
}

export interface Box {
  kind: 'box';
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  stamp: number;
  /** Index into World.panels if it can be broken. */
  panel?: number;
  /** Broken and out of the world: nothing collides with it or hits it. */
  gone?: boolean;
  /** Glass: sight and light pass through it, though bodies and rounds don't. */
  clear?: boolean;
  /** Index into World.doors if it's a door leaf, which moves as the door opens and shuts. */
  door?: number;
}

export type Collider = Cyl | Box;
export type PropStyle = 'crate' | 'wall' | 'wood' | 'metal' | 'fence' | 'roof' | 'door' | 'glass';
export type PanelKind = 'wall' | 'fence' | 'crate' | 'door' | 'glass' | 'roof';

export interface Prop {
  box: Box;
  style: PropStyle;
  tint: number;
  /** Index into World.panels, or -1 if it can't be broken. */
  panel: number;
}

/**
 * A breakable piece of cover: one column or row of a wall, a fence section or
 * a crate. Its health lives on the server; the world only knows if it stands.
 */
export interface Panel {
  box: Box;
  kind: PanelKind;
  /** Index into World.props, for drawing it. */
  prop: number;
  /** Panels resting on this one, which come down with it. */
  carries: number[];
  /** Panels this one rests on; it can only be rebuilt while they stand. */
  restsOn: number[];
  /**
   * 'all' when it's held up by several panels and comes down only once every
   * one of them has gone, as a roof section is; otherwise any one going brings it down.
   */
  falls?: 'all';
}

/**
 * One leaf of a door, hinged at (x, z) in the middle of its wall. Shut, it
 * reaches `length` along (shutX, shutZ); open, it lies along (openX, openZ),
 * swung into the room. Its panel's box moves between the two.
 */
export interface Door {
  panel: number;
  x: number;
  z: number;
  shutX: number;
  shutZ: number;
  openX: number;
  openZ: number;
  length: number;
  y0: number;
  y1: number;
  open: boolean;
  /** The other leaf of the doorway, which opens and shuts with this one, or -1. */
  pair: number;
}

/** A rectangle on the ground. */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** How a building is laid out: one room, two rooms, an L round a corner, or two storeys with stairs. */
export type Plan = 'one' | 'two' | 'ell' | 'tall';
export const PLANS: readonly Plan[] = ['one', 'two', 'ell', 'tall'];

export interface Tree {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface Rock {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  rot: number;
}

/**
 * A roofed building: its outer footprint's bounds, the floor it stands on and
 * the underside of its roof. `parts` are the rectangles its walls enclose:
 * one, or two for an L.
 */
export interface Building {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  floor: number;
  roof: number;
  plan: Plan;
  parts: Rect[];
  /** The upper storey's floor, or null with only one. */
  upper: number | null;
  /** Index into World.outposts, or -1 for a building out in the country. */
  outpost: number;
}

/** Whether (x, z) lies within `pad` of a building's walls, roof overhang included for a positive pad. */
export function inBuilding(b: Building, x: number, z: number, pad = 0): boolean {
  if (x < b.minX - pad || x > b.maxX + pad || z < b.minZ - pad || z > b.maxZ + pad) return false;
  return b.parts.some((r) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad);
}

/** Where a door leaf stands, shut or open: its footprint's min x, min z, max x and max z. */
export function leafRect(d: Door, open: boolean): [number, number, number, number] {
  const dx = open ? d.openX : d.shutX;
  const dz = open ? d.openZ : d.shutZ;
  const ex = d.x + dx * d.length;
  const ez = d.z + dz * d.length;
  const t = DOOR_LEAF / 2;
  return Math.abs(dx) > Math.abs(dz)
    ? [Math.min(d.x, ex), d.z - t, Math.max(d.x, ex), d.z + t]
    : [d.x - t, Math.min(d.z, ez), d.x + t, Math.max(d.z, ez)];
}

export interface Outpost {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** Height of a watchtower's platform above its outpost, and its offset from the outpost's centre on both axes. */
const TOWER_TOP = 4;
const TOWER_OFFSET = -6;

/** The middle of an outpost's watchtower platform, on its floor. */
export function watchtower(o: Outpost): Point {
  return { x: o.x + TOWER_OFFSET, y: o.y + TOWER_TOP, z: o.z + TOWER_OFFSET };
}

/** A doorway or window in a building's wall, centred `at` along it. */
interface Opening {
  at: number;
  width: number;
  kind: 'door' | 'window';
}

/** Anything that moves through the world with a player-sized collision hull. */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

const GRID_CELL = 8;
const GRID_OFFSET = 1024;
const OUTPOST_NAMES = ['Fort Ash', 'Radio Hill', 'Quarry', 'Old Mill', 'Pinecrest', 'Lookout'];
const EXTRACT_COUNT = 4;
/** Walls are split into columns about this wide. */
const WALL_PANEL = 1.6;
/** Tall walls are split into rows this far above the ground: crouch cover below, a window above. */
const WALL_SPLIT = 1.3;
const FENCE_RUNS = 40;
const FENCE_PANEL = 2;
const FENCE_HEIGHT = 1.1;
const FENCE_THICK = 0.1;
/** A building's walls: thickness, height and the corner posts' size. */
export const HOUSE_WALL = 0.3;
const HOUSE_HEIGHT = 3;
export const HOUSE_ROOF = 0.2;
/** Doorways are wide enough that a bot's path always finds a way through, and take a pair of leaves. */
const DOOR_WIDTH = 2.2;
const DOOR_HEIGHT = 2.2;
/** A door leaf's thickness, and the gap left where a pair meets. */
const DOOR_LEAF = 0.06;
const DOOR_GAP = 0.01;
/** Share of doors found open. */
const DOORS_OPEN = 0.4;
/** Window glass's thickness. */
const GLASS = 0.03;
/** Roofs are split into sections about this wide, each held by the walls under it. */
const ROOF_STRIP = 2.4;
/** Buildings out in the country, away from the outposts. */
const HUTS = 9;
const WINDOW_WIDTH = 1.2;
const WINDOW_SILL = 1;
const WINDOW_TOP = 2;
/** Room kept clear between a building and the outpost's walls. */
const HOUSE_CLEARANCE = 1.65;
/** Longest ray the collider walk follows, past which nothing is left to hit. */
const MAX_RAY = WORLD_SIZE * 1.5;

function topOf(c: Collider): number {
  return c.kind === 'cyl' ? c.y1 : c.maxY;
}

function bottomOf(c: Collider): number {
  return c.kind === 'cyl' ? c.y0 : c.minY;
}

function overlapsFootprint(c: Collider, x: number, z: number, pad: number): boolean {
  if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) < c.r + pad;
  return x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad;
}

/**
 * The static game world, generated deterministically from a seed. Both the
 * server and every client build their own copy, so only the seed ever needs to
 * be sent over the network.
 */
export class World {
  readonly seed: number;
  readonly size = WORLD_SIZE;
  readonly half = WORLD_SIZE / 2;
  readonly res = GRID_RES;
  readonly cell = WORLD_SIZE / GRID_RES;
  readonly heights: Float32Array;
  readonly trees: Tree[] = [];
  readonly rocks: Rock[] = [];
  readonly props: Prop[] = [];
  readonly outposts: Outpost[] = [];
  /** Where operators leave the island; the server opens and closes them. */
  readonly extracts: Point[] = [];
  readonly colliders: Collider[] = [];
  readonly panels: Panel[] = [];
  /** Each freestanding wall's whole outline; the wall itself is its panels. Buildings' walls aren't listed. */
  readonly walls: Box[] = [];
  /** The buildings: one in each outpost, in order, then those out in the country. */
  readonly buildings: Building[] = [];
  readonly doors: Door[] = [];
  readonly maxHeight: number;
  private readonly grid = new Map<number, Collider[]>();
  private readonly nearby: Collider[] = [];
  private stamp = 0;
  /** The collider the last raycast stopped at, if it was one. */
  private hit: Collider | null = null;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const n = this.res + 1;
    this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        this.heights[iz * n + ix] = this.rawHeight(-this.half + ix * this.cell, -this.half + iz * this.cell);
      }
    }

    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    this.placeOutposts(rng);
    let maxH = -Infinity;
    for (const h of this.heights) if (h > maxH) maxH = h;
    this.maxHeight = maxH;

    // The plans shuffled, so the first four outposts on an island each get a different one.
    const plans = shuffled(PLANS, mulberry32(this.seed ^ 0x1f83d9ab));
    this.outposts.forEach((o, i) => this.buildOutpost(o, i, plans[i % plans.length], rng, this.houseSeed(i)));
    this.scatterCover(rng);
    this.placeTrees(rng);
    this.placeRocks(rng);
    for (const c of this.colliders) this.insert(c);
    // Its own random stream, so adding extraction points moved nothing else.
    this.placeExtracts(mulberry32(this.seed ^ 0x6a09e667));
    this.placeFences(mulberry32(this.seed ^ 0x3c6ef372));
    this.placeHuts(mulberry32(this.seed ^ 0x510e527f));
  }

  // ---------------------------------------------------------------- queries

  /** Height of the rendered terrain mesh, matching its triangulation exactly. */
  terrainHeight(x: number, z: number): number {
    const n = this.res + 1;
    const gx = clamp((x + this.half) / this.cell, 0, this.res - 1e-4);
    const gz = clamp((z + this.half) / this.cell, 0, this.res - 1e-4);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * n + ix;
    const H = this.heights;
    const h00 = H[i];
    const h10 = H[i + 1];
    const h01 = H[i + n];
    const h11 = H[i + n + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Walkable floor ignoring props: terrain, or the shallow sea bed. */
  floorHeight(x: number, z: number): number {
    return Math.max(this.terrainHeight(x, z), WATER_LEVEL - WATER_FLOOR_DEPTH);
  }

  /** Highest surface a player with feet at feetY can stand on (steps included). */
  groundHeight(x: number, z: number, feetY: number): number {
    let h = this.floorHeight(x, z);
    const pad = PLAYER_RADIUS * 0.6;
    for (const c of this.query(x, z, PLAYER_RADIUS)) {
      const top = topOf(c);
      if (top > feetY + STEP_HEIGHT || top <= h) continue;
      if (overlapsFootprint(c, x, z, pad)) h = top;
    }
    return h;
  }

  /** Lowest overhead surface above a player's head. */
  ceilingHeight(x: number, z: number, headY: number): number {
    let ceil = Infinity;
    for (const c of this.query(x, z, PLAYER_RADIUS)) {
      const bottom = bottomOf(c);
      if (bottom < headY - 0.01 || bottom >= ceil) continue;
      if (overlapsFootprint(c, x, z, PLAYER_RADIUS * 0.9)) ceil = bottom;
    }
    return ceil;
  }

  /** Top of the highest obstacle over (x, z) with its top in (minY, maxY], or -Infinity. */
  ledgeHeight(x: number, z: number, minY: number, maxY: number): number {
    let best = -Infinity;
    for (const c of this.query(x, z, 0)) {
      const top = topOf(c);
      if (top <= minY || top > maxY || top <= best) continue;
      if (overlapsFootprint(c, x, z, 0)) best = top;
    }
    return best;
  }

  /** Whether a player hull `height` tall fits with its feet at (x, y, z). */
  fits(x: number, y: number, z: number, height: number): boolean {
    if (this.floorHeight(x, z) > y + STEP_HEIGHT) return false;
    return this.clear(x, y, z, height, PLAYER_RADIUS * 0.9);
  }

  /**
   * Whether no obstacle reaches within `pad` of (x, z) between feetY and
   * feetY + height, ignoring any no higher than `step` above the feet. Without
   * `doors`, door leaves don't count: a path goes through a shut door, which
   * is opened on the way.
   */
  clear(x: number, feetY: number, z: number, height: number, pad: number, doors = true, step = 0.01): boolean {
    for (const c of this.query(x, z, pad)) {
      if (topOf(c) <= feetY + step || bottomOf(c) >= feetY + height) continue;
      if (!doors && c.kind === 'box' && c.door !== undefined) continue;
      if (overlapsFootprint(c, x, z, pad)) return false;
    }
    return true;
  }

  /** Push a body horizontally out of any obstacle taller than a step. */
  collide(b: Body, height = PLAYER_HEIGHT): void {
    const R = PLAYER_RADIUS;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.query(b.x, b.z, R + 0.1)) {
        if (topOf(c) <= b.y + STEP_HEIGHT || bottomOf(c) >= b.y + height) continue;
        let nx = 0;
        let nz = 0;
        let pen = 0;
        if (c.kind === 'cyl') {
          const dx = b.x - c.x;
          const dz = b.z - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + R;
          if (d >= min) continue;
          if (d < 1e-6) nx = 1;
          else {
            nx = dx / d;
            nz = dz / d;
          }
          pen = min - d;
        } else {
          const dx = b.x - clamp(b.x, c.minX, c.maxX);
          const dz = b.z - clamp(b.z, c.minZ, c.maxZ);
          const d2 = dx * dx + dz * dz;
          if (d2 >= R * R) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            pen = R - d;
          } else {
            const l = b.x - c.minX;
            const r = c.maxX - b.x;
            const bk = b.z - c.minZ;
            const f = c.maxZ - b.z;
            const m = Math.min(l, r, bk, f);
            if (m === l) (nx = -1), (pen = l + R);
            else if (m === r) (nx = 1), (pen = r + R);
            else if (m === bk) (nz = -1), (pen = bk + R);
            else (nz = 1), (pen = f + R);
          }
        }
        b.x += nx * pen;
        b.z += nz * pen;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= vn * nx;
          b.vz -= vn * nz;
        }
      }
    }
  }

  /**
   * Push a ball of radius `r` at (x, y, z) out of every collider it overlaps,
   * in all three directions, as a ragdoll's joints are. Writes the total push
   * to `out` and returns whether there was any. The ground is left out.
   */
  sphereOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
    out.x = out.y = out.z = 0;
    let any = false;
    for (const c of this.query(x, z, r)) {
      if (topOf(c) <= y - r || bottomOf(c) >= y + r) continue;
      // The nearest point of the collider to the centre.
      let px: number;
      let py: number;
      let pz: number;
      if (c.kind === 'box') {
        px = clamp(x, c.minX, c.maxX);
        py = clamp(y, c.minY, c.maxY);
        pz = clamp(z, c.minZ, c.maxZ);
      } else {
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const k = d > c.r ? c.r / d : 1;
        px = c.x + dx * k;
        pz = c.z + dz * k;
        py = clamp(y, c.y0, c.y1);
      }
      let nx = x - px;
      let ny = y - py;
      let nz = z - pz;
      const d2 = nx * nx + ny * ny + nz * nz;
      if (d2 >= r * r) continue;
      let pen: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx /= d;
        ny /= d;
        nz /= d;
        pen = r - d;
      } else if (c.kind === 'box') {
        // The centre is inside: out through the nearest face.
        const faces: [number, number, number, number][] = [
          [x - c.minX, -1, 0, 0], [c.maxX - x, 1, 0, 0], [y - c.minY, 0, -1, 0],
          [c.maxY - y, 0, 1, 0], [z - c.minZ, 0, 0, -1], [c.maxZ - z, 0, 0, 1],
        ];
        const [depth, fx, fy, fz] = faces.reduce((a, b) => (b[0] < a[0] ? b : a));
        (nx = fx), (ny = fy), (nz = fz), (pen = depth + r);
      } else {
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const side = c.r - d;
        const top = c.y1 - y;
        if (top < side) (nx = 0), (ny = 1), (nz = 0), (pen = top + r);
        else if (d > 1e-6) (nx = dx / d), (ny = 0), (nz = dz / d), (pen = side + r);
        else (nx = 1), (ny = 0), (nz = 0), (pen = side + r);
      }
      out.x += nx * pen;
      out.y += ny * pen;
      out.z += nz * pen;
      any = true;
    }
    return any;
  }

  /** Distance along a normalized ray to the first solid hit, or Infinity. With `glass`, it passes through glass. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, glass = false): number {
    this.hit = null;
    const terrain = this.raycastTerrain(ox, oy, oz, dx, dy, dz, maxT);
    return this.raycastColliders(ox, oy, oz, dx, dy, dz, Math.min(terrain, maxT, MAX_RAY), terrain, glass);
  }

  /** Like raycast, and also which panel the ray stopped at, or -1 for anything else. */
  raycastPanel(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, glass = false,
  ): { t: number; panel: number } {
    const t = this.raycast(ox, oy, oz, dx, dy, dz, maxT, glass);
    const hit = this.hit;
    return { t, panel: t <= maxT && hit?.kind === 'box' ? (hit.panel ?? -1) : -1 };
  }

  // ----------------------------------------------------------------- panels

  /**
   * Break a panel and everything resting on it, save what something else
   * still holds up. Returns what broke, that panel first; nothing if it was already down.
   */
  breakPanel(id: number): number[] {
    const out: number[] = [];
    const stack = [id];
    while (stack.length) {
      const i = stack.pop()!;
      const panel = this.panels[i];
      if (!panel || panel.box.gone) continue;
      if (i !== id && panel.falls === 'all' && panel.restsOn.some((j) => !this.panels[j].box.gone)) continue;
      panel.box.gone = true;
      out.push(i);
      stack.push(...panel.carries);
    }
    return out;
  }

  /** Stand a single panel back up, or knock it down, exactly as told. */
  setPanel(id: number, standing: boolean): void {
    const panel = this.panels[id];
    if (panel) panel.box.gone = !standing;
  }

  /** Whether what a panel rests on stands, so it could be rebuilt: all of it, or for one held by several, any. */
  supported(id: number): boolean {
    const p = this.panels[id];
    if (p.falls === 'all' && p.restsOn.length) return p.restsOn.some((i) => !this.panels[i].box.gone);
    return p.restsOn.every((i) => !this.panels[i].box.gone);
  }

  // ------------------------------------------------------------------ doors

  /** Open or shut a door leaf, moving its box to match. */
  setDoor(id: number, open: boolean): void {
    const d = this.doors[id];
    if (!d) return;
    d.open = open;
    const [x0, z0, x1, z1] = leafRect(d, open);
    const box = this.panels[d.panel].box;
    box.minX = x0;
    box.minZ = z0;
    box.maxX = x1;
    box.maxZ = z1;
  }

  /** Door leaves open right now. */
  openDoors(): number[] {
    const out: number[] = [];
    this.doors.forEach((d, i) => d.open && out.push(i));
    return out;
  }

  /** Open exactly the doors `open` and shut the rest, as a joining client is told. */
  syncDoors(open: readonly number[]): void {
    const set = new Set(open);
    this.doors.forEach((_, i) => this.setDoor(i, set.has(i)));
  }

  /**
   * The door leaf someone at (x, y, z) facing `yaw` would open or shut: the
   * nearest doorway within reach that's roughly ahead, or -1. Broken leaves
   * are left out.
   */
  doorFacing(x: number, y: number, z: number, yaw: number, reach: number): number {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best = -1;
    let bestD = reach;
    this.doors.forEach((d, i) => {
      if (this.panels[d.panel].box.gone || y < d.y0 - 1 || y > d.y1) return;
      // The middle of the doorway: past the leaf's shut middle, halfway to its pair.
      const [x0, z0, x1, z1] = leafRect(d, false);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const dx = cx - x;
      const dz = cz - z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestD) return;
      if (dist > 0.8 && (dx * fx + dz * fz) / dist < 0.5) return;
      best = i;
      bestD = dist;
    });
    return best;
  }

  /** Panels broken right now. */
  brokenPanels(): number[] {
    const out: number[] = [];
    this.panels.forEach((p, i) => p.box.gone && out.push(i));
    return out;
  }

  /** Stand everything up except `broken`, as a joining client is told. */
  syncPanels(broken: readonly number[]): void {
    const down = new Set(broken);
    this.panels.forEach((p, i) => (p.box.gone = down.has(i)));
  }

  /** Outward normal of the solid surface at a point on it, such as a raycast hit. */
  surfaceNormal(x: number, y: number, z: number): [number, number, number] {
    const e = 0.02;
    for (const c of this.query(x, z, e)) {
      if (c.kind === 'box') {
        if (x < c.minX - e || x > c.maxX + e || y < c.minY - e || y > c.maxY + e || z < c.minZ - e || z > c.maxZ + e) continue;
        const faces: [number, number, number, number][] = [
          [Math.abs(x - c.minX), -1, 0, 0], [Math.abs(c.maxX - x), 1, 0, 0],
          [Math.abs(y - c.minY), 0, -1, 0], [Math.abs(c.maxY - y), 0, 1, 0],
          [Math.abs(z - c.minZ), 0, 0, -1], [Math.abs(c.maxZ - z), 0, 0, 1],
        ];
        const [, nx, ny, nz] = faces.reduce((a, b) => (b[0] < a[0] ? b : a));
        return [nx, ny, nz];
      }
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > c.r + e || y < c.y0 - e || y > c.y1 + e) continue;
      if (Math.abs(y - c.y1) < e || d < 1e-6) return [0, 1, 0];
      return [dx / d, 0, dz / d];
    }
    const s = 0.5;
    const hx = this.terrainHeight(x + s, z) - this.terrainHeight(x - s, z);
    const hz = this.terrainHeight(x, z + s) - this.terrainHeight(x, z - s);
    const len = Math.hypot(hx, 2 * s, hz);
    return [-hx / len, (2 * s) / len, -hz / len];
  }

  hasLineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, true) >= d - 0.05;
  }

  randomLandPoint(rand: () => number): { x: number; y: number; z: number } {
    for (let i = 0; i < 60; i++) {
      const x = (rand() - 0.5) * this.size * 0.8;
      const z = (rand() - 0.5) * this.size * 0.8;
      const h = this.terrainHeight(x, z);
      if (h < 1.5 || h > 45) continue;
      if (this.blocked(x, z, PLAYER_RADIUS + 0.2)) continue;
      return { x, y: this.groundHeight(x, z, h), z };
    }
    return { x: 0, y: this.groundHeight(0, 0, this.terrainHeight(0, 0)), z: 0 };
  }

  nearestOutpost(x: number, z: number): { outpost: Outpost; dist: number } | null {
    let best: Outpost | null = null;
    let bestD = Infinity;
    for (const o of this.outposts) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bestD) (best = o), (bestD = d);
    }
    return best ? { outpost: best, dist: bestD } : null;
  }

  // ------------------------------------------------------------- internals

  /**
   * Walk the collider grid cell by cell along the ray, testing what each cell
   * holds, and stop once a hit lies within the cell being walked: any later
   * hit would be in a later cell. Returns the nearer of `best` and any hit.
   */
  private raycastColliders(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, end: number, best: number, glass: boolean,
  ): number {
    const stamp = ++this.stamp;
    let gx = Math.floor(ox / GRID_CELL);
    let gz = Math.floor(oz / GRID_CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const ax = Math.abs(dx);
    const az = Math.abs(dz);
    const deltaX = ax > 1e-12 ? GRID_CELL / ax : Infinity;
    const deltaZ = az > 1e-12 ? GRID_CELL / az : Infinity;
    let nextX = ax > 1e-12 ? ((dx > 0 ? (gx + 1) * GRID_CELL - ox : ox - gx * GRID_CELL) / ax) : Infinity;
    let nextZ = az > 1e-12 ? ((dz > 0 ? (gz + 1) * GRID_CELL - oz : oz - gz * GRID_CELL) / az) : Infinity;
    let enter = 0;
    while (enter <= end && enter < best) {
      const cell = this.grid.get((gx + GRID_OFFSET) * 4096 + gz + GRID_OFFSET);
      if (cell) {
        for (const c of cell) {
          if (c.stamp === stamp || c.gone) continue;
          c.stamp = stamp;
          if (glass && c.kind === 'box' && c.clear) continue;
          const t = c.kind === 'cyl'
            ? rayCylinder(ox, oy, oz, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1)
            : rayAabb(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
          if (t < best) (best = t), (this.hit = c);
        }
      }
      const exit = Math.min(nextX, nextZ);
      if (best <= exit || exit === Infinity) break;
      enter = exit;
      if (nextX < nextZ) {
        nextX += deltaX;
        gx += stepX;
      } else {
        nextZ += deltaZ;
        gz += stepZ;
      }
    }
    return best;
  }

  private raycastTerrain(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    if (oy < this.terrainHeight(ox, oz)) return 0;
    const step = 0.75;
    let prev = 0;
    let t = 0;
    while (t < maxT) {
      t = Math.min(t + step, maxT);
      const y = oy + dy * t;
      if (y > this.maxHeight && dy >= 0) return Infinity;
      if (y < this.terrainHeight(ox + dx * t, oz + dz * t)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 10; i++) {
          const m = (lo + hi) / 2;
          if (oy + dy * m < this.terrainHeight(ox + dx * m, oz + dz * m)) hi = m;
          else lo = m;
        }
        return hi;
      }
      prev = t;
    }
    return Infinity;
  }

  private query(x: number, z: number, r: number): Collider[] {
    const out = this.nearby;
    out.length = 0;
    const stamp = ++this.stamp;
    const gx0 = Math.floor((x - r) / GRID_CELL);
    const gx1 = Math.floor((x + r) / GRID_CELL);
    const gz0 = Math.floor((z - r) / GRID_CELL);
    const gz1 = Math.floor((z + r) / GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const cell = this.grid.get((gx + GRID_OFFSET) * 4096 + gz + GRID_OFFSET);
        if (!cell) continue;
        for (const c of cell) {
          if (c.stamp === stamp || c.gone) continue;
          c.stamp = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  private insert(c: Collider): void {
    let [x0, z0, x1, z1] =
      c.kind === 'cyl' ? [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r] : [c.minX, c.minZ, c.maxX, c.maxZ];
    if (c.kind === 'box' && c.door !== undefined) {
      // Wherever the leaf swings, it stays in the cells it's filed under.
      const d = this.doors[c.door];
      const [a, b, e, f] = leafRect(d, !d.open);
      [x0, z0, x1, z1] = [Math.min(x0, a), Math.min(z0, b), Math.max(x1, e), Math.max(z1, f)];
    }
    for (let gx = Math.floor(x0 / GRID_CELL); gx <= Math.floor(x1 / GRID_CELL); gx++) {
      for (let gz = Math.floor(z0 / GRID_CELL); gz <= Math.floor(z1 / GRID_CELL); gz++) {
        const key = (gx + GRID_OFFSET) * 4096 + gz + GRID_OFFSET;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(c);
      }
    }
  }

  private blocked(x: number, z: number, pad: number): boolean {
    for (const c of this.query(x, z, pad)) if (overlapsFootprint(c, x, z, pad)) return true;
    return false;
  }

  private nearOutpost(x: number, z: number, r: number): boolean {
    return this.outposts.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  }

  private nearProp(x: number, z: number, pad: number): boolean {
    return this.props.some((p) => overlapsFootprint(p.box, x, z, pad));
  }

  private rawHeight(x: number, z: number): number {
    const s = this.seed;
    const d = Math.hypot(x, z) / this.half;
    const coast = d + (fbm(x / 110, z / 110, s + 7, 3) - 0.5) * 0.4;
    const island = 1 - smoothstep(0.58, 0.92, coast);
    const hills = fbm(x / 170, z / 170, s, 5);
    const ridge = 1 - Math.abs(fbm(x / 80, z / 80, s + 31, 4) * 2 - 1);
    const mountain = smoothstep(0.5, 0.72, fbm(x / 260, z / 260, s + 57, 3));
    const land = 2 + hills * 20 + ridge * ridge * 6 + mountain * ridge * 38;
    return island * land - (1 - island) * 14;
  }

  private heightRange(x0: number, z0: number, x1: number, z1: number): [number, number] {
    const hs = [
      this.terrainHeight(x0, z0),
      this.terrainHeight(x1, z0),
      this.terrainHeight(x0, z1),
      this.terrainHeight(x1, z1),
      this.terrainHeight((x0 + x1) / 2, (z0 + z1) / 2),
    ];
    return [Math.min(...hs), Math.max(...hs)];
  }

  private addProp(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    style: PropStyle, tint = 0,
  ): Box {
    const box: Box = { kind: 'box', minX, minY, minZ, maxX, maxY, maxZ, stamp: 0 };
    this.props.push({ box, style, tint, panel: -1 });
    this.colliders.push(box);
    return box;
  }

  /** A breakable prop, resting on the panels `on`. Returns its panel id. */
  private addPanel(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    kind: PanelKind, on: readonly number[] = [], tint = 0,
  ): number {
    const box = this.addProp(minX, minY, minZ, maxX, maxY, maxZ, kind, tint);
    const id = this.panels.length;
    box.panel = id;
    this.props[this.props.length - 1].panel = id;
    const restsOn = on.filter((i) => i >= 0);
    this.panels.push({ box, kind, prop: this.props.length - 1, carries: [], restsOn });
    for (const i of restsOn) this.panels[i].carries.push(id);
    return id;
  }

  /**
   * A wall of breakable panels: columns about WALL_PANEL wide, and a second
   * row above WALL_SPLIT over `groundY` when it's tall enough. Top panels rest
   * on the ones below, so blowing out the bottom leaves a hole to walk through.
   * Returns each column's top panel, in order along the wall.
   */
  private addWall(
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, groundY: number, freestanding = true,
  ): number[] {
    if (freestanding) this.walls.push({ kind: 'box', minX, minY, minZ, maxX, maxY, maxZ, stamp: 0 });
    const tops: number[] = [];
    const alongX = maxX - minX >= maxZ - minZ;
    const a0 = alongX ? minX : minZ;
    const len = alongX ? maxX - minX : maxZ - minZ;
    const cols = Math.max(1, Math.round(len / WALL_PANEL));
    const split = groundY + WALL_SPLIT;
    const rows = maxY - split > 0.5 ? [minY, split, maxY] : [minY, maxY];
    for (let i = 0; i < cols; i++) {
      const a = a0 + (len * i) / cols;
      const b = a0 + (len * (i + 1)) / cols;
      let below = -1;
      for (let r = 0; r + 1 < rows.length; r++) {
        below = alongX
          ? this.addPanel(a, rows[r], minZ, b, rows[r + 1], maxZ, 'wall', [below])
          : this.addPanel(minX, rows[r], a, maxX, rows[r + 1], b, 'wall', [below]);
      }
      tops.push(below);
    }
    return tops;
  }

  /** Each outpost's own random stream, for its building and the cover round it. */
  private houseSeed(i: number): number {
    return this.seed ^ 0xa54ff53a ^ Math.imul(i + 1, 0x9e3779b1);
  }

  /** A plan's size: `L` along its length and `D` deep, and an L's wing (`W` wide, jutting `E` out in front). */
  private spec(plan: Plan, rng: () => number): Spec {
    switch (plan) {
      case 'one':
        return { plan, L: 6 + rng(), D: 4.8 + rng() * 0.6, W: 0, E: 0 };
      case 'two':
        return { plan, L: 10 + rng() * 1.5, D: 6.5 + rng(), W: 0, E: 0 };
      case 'ell': {
        const E = 3.6 + rng() * 0.6;
        return { plan, L: 9.5 + rng(), D: 6 + rng() * 0.6 + E, W: 4.4 + rng() * 0.4, E };
      }
      case 'tall':
        return { plan, L: 7.4 + rng() * 0.8, D: 6 + rng() * 0.5, W: 0, E: 0 };
    }
  }

  /**
   * A concrete building laid out by `spec`, placed by `f` (local u along its
   * length, v from its front to its back) with its floor at `y` and its walls
   * reaching down to `base`. Walls are breakable panels with doorways and
   * windows: lintels over the openings rest on the wall either side, windows
   * are glazed, and each doorway is hung with a pair of leaves. The roof comes
   * in sections, each held up by the walls and posts under it until they've
   * all gone. There's a table under a window, and `crates` crates in the rooms.
   */
  private addBuilding(spec: Spec, f: Frame, y: number, base: number, rng: () => number, outpost: number, crates: number): Building {
    const { plan, L, D, W, E } = spec;
    const T = HOUSE_WALL;
    const top = y + HOUSE_HEIGHT;
    const first = this.panels.length;
    const rect = (u0: number, v0: number, u1: number, v1: number): Rect => rectOf(f, u0, v0, u1, v1);
    const alongU: Frame = (a, c) => f(a, c);
    const alongV: Frame = (a, c) => f(c, a);
    const door = (at: number): Opening => ({ at, width: DOOR_WIDTH, kind: 'door' });
    const pane = (at: number): Opening => ({ at, width: WINDOW_WIDTH, kind: 'window' });
    const jitter = () => (rng() - 0.5) * 0.8;
    const post = (u: number, v: number, y0: number, y1: number, breakable: boolean) => {
      const r = rect(u, v, u + T, v + T);
      if (breakable) this.addPanel(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, 'wall');
      else this.addProp(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, 'wall');
    };
    const table = (r: Rect, floor: number) => this.addProp(r.minX, floor - 0.2, r.minZ, r.maxX, floor + 0.8, r.maxZ, 'wood');
    /** Where the crates go, most wanted first. */
    const spots: Rect[] = [];
    const corner = (u: number, v: number) => spots.push(rect(u, v, u + 1, v + 1));
    let parts: Rect[] = [rect(0, 0, L, D)];
    /** The roof's rectangles, overhang included, in local (u0, v0, u1, v1). */
    let roofs: [number, number, number, number][] = [[-0.3, -0.3, L + 0.3, D + 0.3]];
    let roofY = top;
    let upper: number | null = null;

    switch (plan) {
      case 'one': {
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, base, top, true);
        this.addFacade(alongU, T, L - T, 0, T, y, base, [door(L * 0.35 + jitter() * 0.4), pane(L * 0.76)], 1, rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(L / 2 + jitter() * 0.5)], -1, rng);
        this.addFacade(alongV, T, D - T, 0, T, y, base, [pane(D / 2)], 1, rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [], -1, rng);
        table(rect(T + 0.05, D / 2 - 0.9, T + 0.95, D / 2 + 0.9), y);
        corner(L - T - 1.15, D - T - 1.15);
        corner(T + 1.2, D - T - 1.15);
        break;
      }
      case 'two': {
        // Room A (u < p) has the front door; room B the door at the far end.
        const p = L * (0.52 + rng() * 0.06);
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, base, top, true);
        this.addFacade(alongU, T, L - T, 0, T, y, base, [door(p / 2 + jitter()), pane((p + L) / 2 + jitter())], 1, rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(p / 2 + jitter()), pane((p + L) / 2 + jitter())], -1, rng);
        this.addFacade(alongV, T, D - T, 0, T, y, base, [pane(D / 2)], 1, rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [door(D / 2)], -1, rng);
        // The partition between the rooms, with a doorway in the middle.
        this.addFacade(alongV, T, D - T, p - T / 2, p + T / 2, y, base, [door(D / 2 + jitter() * 0.5)], 1, rng);
        table(rect(T + 0.05, D / 2 - 0.9, T + 0.95, D / 2 + 0.9), y);
        corner(p - T / 2 - 1.15, D - T - 1.15);
        corner(L - T - 1.15, D - T - 1.15);
        break;
      }
      case 'ell': {
        // Room A along the back (u < L - W, v > E) and room B down the far end,
        // jutting out E in front of A round a yard; a doorway joins them.
        const a = L - W;
        const mid = E + (D - E) / 2;
        for (const [u, v] of [[0, E], [0, D - T], [L - T, D - T], [L - T, 0], [a, 0]]) post(u, v, base, top, true);
        this.addFacade(alongU, T, a, E, E + T, y, base, [door(a * 0.38 + jitter() * 0.3), pane(a * 0.8)], 1, rng);
        // B's side: onto the yard, then the partition with A.
        this.addFacade(alongV, T, D - T, a, a + T, y, base, [door(E / 2), door(mid + jitter() * 0.3)], 1, rng);
        this.addFacade(alongU, a + T, L - T, 0, T, y, base, [pane((a + L) / 2)], 1, rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [pane(E / 2), pane(mid)], -1, rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(a / 2), pane(L - W / 2)], -1, rng);
        this.addFacade(alongV, E + T, D - T, 0, T, y, base, [pane(mid)], 1, rng);
        table(rect(T + 0.05, mid - 0.9, T + 0.95, mid + 0.9), y);
        corner(a - 1.15, D - T - 1.15);
        corner(L - T - 1.15, T + 0.15);
        parts = [rect(0, E, L, D), rect(a, 0, L, D)];
        roofs = [[-0.3, E - 0.3, a, D + 0.3], [a, -0.3, L + 0.3, D + 0.3]];
        break;
      }
      case 'tall': {
        // Stairs up the back wall, climbing toward the near end, to an upper
        // storey with a window each way. The top step is beside the floor above.
        const y2 = top;
        const top2 = y2 + HOUSE_HEIGHT;
        const run = 0.55;
        const steps = Math.round(HOUSE_HEIGHT / 0.5);
        const sEnd = T + steps * run;
        const sv = D - T - 1.2;
        // The ground storey's posts carry the upper floor, so they stand.
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, base, top, false);
        this.addFacade(alongU, T, L - T, 0, T, y, base, [pane(L * 0.25), door(L * 0.64 + jitter() * 0.3)], 1, rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(L * 0.74)], -1, rng);
        this.addFacade(alongV, T, D - T, 0, T, y, base, [pane(D / 2 - 0.4)], 1, rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [door(D / 2)], -1, rng);
        const ground = range(first, this.panels.length);
        for (let k = 0; k < steps; k++) {
          const r = rect(sEnd - (k + 1) * run, sv, sEnd - k * run, D - T);
          this.addProp(r.minX, y - 0.2, r.minZ, r.maxX, y + (HOUSE_HEIGHT * (k + 1)) / steps, r.maxZ, 'wood');
        }
        // The upper floor, with a hole over the stairs.
        for (const r of [rect(T, T, L - T, sv), rect(sEnd, sv, L - T, D - T)]) this.addProp(r.minX, y2 - 0.2, r.minZ, r.maxX, y2, r.maxZ, 'wall');
        const upstairs = this.panels.length;
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, y2, top2, true);
        this.addFacade(alongU, T, L - T, 0, T, y2, y2, [pane(L * 0.28), pane(L * 0.72)], 1, rng);
        this.addFacade(alongU, T, L - T, D - T, D, y2, y2, [pane(L * 0.62)], -1, rng);
        this.addFacade(alongV, T, D - T, 0, T, y2, y2, [pane(D / 2 - 0.5)], 1, rng);
        this.addFacade(alongV, T, D - T, L - T, L, y2, y2, [pane(D / 2)], -1, rng);
        this.rest(range(upstairs, this.panels.length), y2, ground);
        table(rect(L - T - 1.9, T + 0.05, L - T - 0.1, T + 0.95), y2);
        corner(T + 0.15, T + 0.15);
        corner(L - T - 1.15, D - T - 1.15);
        roofY = top2;
        upper = y2;
        break;
      }
    }

    // Roof sections across the shorter way, so each spans wall to wall.
    const strips: number[] = [];
    for (const [u0, v0, u1, v1] of roofs) {
      const alongLength = u1 - u0 >= v1 - v0;
      const len = alongLength ? u1 - u0 : v1 - v0;
      const n = Math.max(1, Math.round(len / ROOF_STRIP));
      for (let i = 0; i < n; i++) {
        const a0 = (alongLength ? u0 : v0) + (len * i) / n;
        const a1 = (alongLength ? u0 : v0) + (len * (i + 1)) / n;
        const r = alongLength ? rect(a0, v0, a1, v1) : rect(u0, a0, u1, a1);
        strips.push(this.addPanel(r.minX, roofY, r.minZ, r.maxX, roofY + HOUSE_ROOF, r.maxZ, 'roof'));
      }
    }
    this.rest(strips, roofY, range(first, this.panels.length));

    for (const r of spots.slice(0, crates)) {
      const t = this.terrainHeight((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
      this.addPanel(r.minX, Math.min(y - 0.2, t - 0.1), r.minZ, r.maxX, y + 1, r.maxZ, 'crate', [], rng());
    }

    const all = rect(0, 0, L, D);
    const b: Building = { ...all, floor: y, roof: roofY, plan, parts, upper, outpost };
    this.buildings.push(b);
    return b;
  }

  /**
   * Stand the panels `ids` whose bottom is at height `y` on whatever panels
   * among `among` end there beneath them: they stay up while any of those do.
   */
  private rest(ids: readonly number[], y: number, among: readonly number[]): void {
    for (const id of ids) {
      const p = this.panels[id].box;
      if (Math.abs(p.minY - y) > 1e-6) continue;
      const under = among.filter((j) => {
        const b = this.panels[j].box;
        return j !== id && Math.abs(b.maxY - y) < 1e-6
          && Math.min(b.maxX, p.maxX) - Math.max(b.minX, p.minX) > 0.01 && Math.min(b.maxZ, p.maxZ) - Math.max(b.minZ, p.minZ) > 0.01;
      });
      if (!under.length) continue;
      this.panels[id].falls = 'all';
      for (const j of under) {
        this.panels[id].restsOn.push(j);
        this.panels[j].carries.push(id);
      }
    }
  }

  /**
   * One wall of a building from a0 to a1 along `frame`'s first axis, between
   * c0 and c1 across it, with `openings` in it, standing on the floor at `y`
   * and reaching down to `base`. Solid stretches are ordinary wall columns; a
   * window has a sill panel below it and glass on the sill, a doorway a pair
   * of leaves that swing toward `inward` across the wall, and every opening a
   * lintel above it resting on the columns either side.
   */
  private addFacade(
    frame: Frame, a0: number, a1: number, c0: number, c1: number, y: number, base: number,
    openings: Opening[], inward: 1 | -1, rng: () => number,
  ): void {
    const top = y + HOUSE_HEIGHT;
    const box = (u0: number, v0: number, u1: number, v1: number): Rect => rectOf(frame, u0, v0, u1, v1);
    const sorted = [...openings].sort((p, q) => p.at - q.at);
    // Each solid stretch's top panels in order along the wall: before the first opening, between each pair, after the last.
    const runs: number[][] = [];
    for (let i = 0; i <= sorted.length; i++) {
      const u0 = i === 0 ? a0 : sorted[i - 1].at + sorted[i - 1].width / 2;
      const u1 = i === sorted.length ? a1 : sorted[i].at - sorted[i].width / 2;
      if (u1 - u0 < 0.05) {
        runs.push([]);
        continue;
      }
      const r = box(u0, c0, u1, c1);
      const tops = this.addWall(r.minX, base, r.minZ, r.maxX, top, r.maxZ, y, false);
      // addWall orders its columns along the world axis, which may run against the wall's.
      const [ax, az] = frame(u0, c0);
      const [bx, bz] = frame(u1, c0);
      const reversed = Math.abs(bx - ax) > Math.abs(bz - az) ? bx < ax : bz < az;
      runs.push(reversed ? tops.reverse() : tops);
    }
    const mid = (c0 + c1) / 2;
    sorted.forEach((o, i) => {
      const r = box(o.at - o.width / 2, c0, o.at + o.width / 2, c1);
      if (o.kind === 'window') {
        const sill = this.addPanel(r.minX, base, r.minZ, r.maxX, y + WINDOW_SILL, r.maxZ, 'wall');
        const g = box(o.at - o.width / 2, mid - GLASS / 2, o.at + o.width / 2, mid + GLASS / 2);
        const glass = this.addPanel(g.minX, y + WINDOW_SILL, g.minZ, g.maxX, y + WINDOW_TOP, g.maxZ, 'glass', [sill]);
        this.panels[glass].box.clear = true;
      } else {
        const open = rng() < DOORS_OPEN;
        const half = o.width / 2;
        const leaves = [-1, 1].map((side) => {
          const [hx, hz] = frame(o.at + side * half, mid);
          const [sx, sz] = frame(o.at + side * half - side, mid);
          const [ix, iz] = frame(o.at + side * half, mid + inward);
          return this.addDoor(hx, hz, sx - hx, sz - hz, ix - hx, iz - hz, half - DOOR_GAP / 2, y + 0.02, y + DOOR_HEIGHT - 0.04, open);
        });
        this.doors[leaves[0]].pair = leaves[1];
        this.doors[leaves[1]].pair = leaves[0];
      }
      const left = runs[i].at(-1) ?? -1;
      const right = runs[i + 1][0] ?? -1;
      this.addPanel(r.minX, y + (o.kind === 'door' ? DOOR_HEIGHT : WINDOW_TOP), r.minZ, r.maxX, top, r.maxZ, 'wall', [left, right]);
    });
  }

  /** A door leaf hinged at (x, z), reaching `length` along (sx, sz) shut and along (ox, oz) open. Returns its index. */
  private addDoor(
    x: number, z: number, sx: number, sz: number, ox: number, oz: number, length: number, y0: number, y1: number, open: boolean,
  ): number {
    const id = this.doors.length;
    const d: Door = { panel: -1, x, z, shutX: sx, shutZ: sz, openX: ox, openZ: oz, length, y0, y1, open, pair: -1 };
    this.doors.push(d);
    const [x0, z0, x1, z1] = leafRect(d, open);
    d.panel = this.addPanel(x0, y0, z0, x1, y1, z1, 'door');
    this.panels[d.panel].box.door = id;
    return id;
  }

  private placeOutposts(rng: () => number): void {
    // Ideal sites are spread out and flat; relax both until every outpost fits.
    for (const [spacing, maxRough, maxY] of [[160, 7, 30], [130, 9, 36], [100, 12, 42], [70, 16, 50]]) {
      for (let attempt = 0; attempt < 500 && this.outposts.length < OUTPOST_NAMES.length; attempt++) {
        const x = (rng() - 0.5) * this.size * 0.7;
        const z = (rng() - 0.5) * this.size * 0.7;
        const y = this.terrainHeight(x, z);
        if (y < 3 || y > maxY) continue;
        let rough = 0;
        for (const [ox, oz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
          rough = Math.max(rough, Math.abs(this.terrainHeight(x + ox, z + oz) - y));
        }
        if (rough > maxRough) continue;
        if (this.outposts.some((o) => Math.hypot(o.x - x, o.z - z) < spacing)) continue;
        this.outposts.push({ name: OUTPOST_NAMES[this.outposts.length], x, y, z });
      }
    }

    // Flatten a plateau under each outpost.
    const n = this.res + 1;
    const inner = 22;
    const outer = 42;
    for (const o of this.outposts) {
      for (let iz = 0; iz < n; iz++) {
        const z = -this.half + iz * this.cell;
        if (Math.abs(z - o.z) > outer) continue;
        for (let ix = 0; ix < n; ix++) {
          const x = -this.half + ix * this.cell;
          const d = Math.hypot(x - o.x, z - o.z);
          if (d > outer) continue;
          const i = iz * n + ix;
          this.heights[i] += (o.y - this.heights[i]) * smoothstep(outer, inner, d);
        }
      }
    }
  }

  /** `house` seeds the outpost's own stream, for its building and the cover round it, so their details don't shift the rest of the island. */
  private buildOutpost(o: Outpost, index: number, plan: Plan, rng: () => number, house: number): void {
    const y = o.y;
    const S = 14;
    const T = 0.25;

    // Perimeter walls with a gate in the middle of each side; some collapsed.
    for (let side = 0; side < 4; side++) {
      for (const [a, b] of [[-S, -2.5], [2.5, S]]) {
        const roll = rng();
        if (roll < 0.2) continue;
        const h = roll < 0.4 ? 1.2 : 3;
        if (side === 0) this.addWall(o.x + a, y - 0.5, o.z - S - T, o.x + b, y + h, o.z - S + T, y);
        if (side === 1) this.addWall(o.x + a, y - 0.5, o.z + S - T, o.x + b, y + h, o.z + S + T, y);
        if (side === 2) this.addWall(o.x - S - T, y - 0.5, o.z + a, o.x - S + T, y + h, o.z + b, y);
        if (side === 3) this.addWall(o.x + S - T, y - 0.5, o.z + a, o.x + S + T, y + h, o.z + b, y);
      }
    }

    // Watchtower: raised platform with parapets, reached by stairs on +x.
    const { x: px, y: top, z: pz } = watchtower(o);
    this.addProp(px - 2, top - 0.4, pz - 2, px + 2, top, pz + 2, 'wood');
    for (const cx of [-1.75, 1.75]) {
      for (const cz of [-1.75, 1.75]) {
        this.addProp(px + cx - 0.2, y - 0.5, pz + cz - 0.2, px + cx + 0.2, top - 0.4, pz + cz + 0.2, 'wood');
      }
    }
    this.addProp(px - 2, top, pz - 2, px + 2, top + 1, pz - 1.8, 'wood');
    this.addProp(px - 2, top, pz + 1.8, px + 2, top + 1, pz + 2, 'wood');
    this.addProp(px - 2, top, pz - 2, px - 1.8, top + 1, pz + 2, 'wood');
    for (let i = 0; i < 7; i++) {
      this.addProp(px + 2 + i, y - 0.5, pz - 0.8, px + 3 + i, top - 0.5 - 0.5 * i, pz + 0.8, 'wood');
    }

    const tower: Rect = { minX: px - 3, minZ: pz - 3, maxX: px + 10.5, maxZ: pz + 3 };
    const edge = S - T - HOUSE_CLEARANCE;
    // Until chunk 23 every outpost had the same two-room building, and the
    // cover round it came from the island's stream. That stream is still drawn
    // from as it was then, and the draws thrown away, so everything past the
    // outposts stands where it did.
    const old = mulberry32(house);
    const [oldL, oldD] = [10 + old() * 1.5, 6.5 + old()];
    const [oldSx, oldAlongX] = [old() < 0.5 ? 1 : -1, old() < 0.5];
    this.outpostCover(o, rng, [tower, grow(this.corner(o, edge, oldL, oldD, oldSx, oldAlongX), 1.5)], false);

    // The building in a corner away from the watchtower, its front toward the middle.
    const own = mulberry32(house);
    const spec = this.spec(plan, own);
    const sx = own() < 0.5 ? 1 : -1;
    const alongX = own() < 0.5;
    const r = this.corner(o, edge, spec.L, spec.D, sx, alongX);
    const f = frameOf(r.minX, r.minZ, spec.L, spec.D, alongX, alongX ? sx < 0 : true, alongX ? false : sx < 0);
    const b = this.addBuilding(spec, f, y, y - 0.5, own, index, 2);
    // Kept well clear, so nothing stands in front of a doorway.
    this.outpostCover(o, own, [tower, grow(b, 1.5)], true);
  }

  /**
   * Where a building `L` long and `D` deep goes in an outpost: the +z corner
   * on the side `sx`, reaching `edge` from the middle, long side along x or z.
   */
  private corner(o: Outpost, edge: number, L: number, D: number, sx: number, alongX: boolean): Rect {
    const [w, d] = alongX ? [L, D] : [D, L];
    const minX = sx > 0 ? o.x + edge - w : o.x - edge;
    const minZ = o.z + edge - d;
    return { minX, minZ, maxX: minX + w, maxZ: minZ + d };
  }

  /**
   * Shipping containers and crates as cover inside an outpost's walls, clear
   * of the rectangles `taken`. Without `build`, only the random draws are made.
   */
  private outpostCover(o: Outpost, rng: () => number, taken: Rect[], build: boolean): void {
    const y = o.y;
    const S = 14;
    const free = (x0: number, z0: number, x1: number, z1: number) =>
      taken.every((t) => x1 + 1.2 < t.minX || x0 - 1.2 > t.maxX || z1 + 1.2 < t.minZ || z0 - 1.2 > t.maxZ);

    for (let placed = 0, tries = 0; placed < 2 && tries < 30; tries++) {
      const alongX = rng() < 0.5;
      const hx = alongX ? 3 : 1.2;
      const hz = alongX ? 1.2 : 3;
      const cx = o.x + (rng() - 0.5) * 2 * (S - 5);
      const cz = o.z + (rng() - 0.5) * 2 * (S - 5);
      if (!free(cx - hx, cz - hz, cx + hx, cz + hz)) continue;
      taken.push({ minX: cx - hx, minZ: cz - hz, maxX: cx + hx, maxZ: cz + hz });
      const tint = rng();
      if (build) this.addProp(cx - hx, y - 0.2, cz - hz, cx + hx, y + 2.6, cz + hz, 'metal', tint);
      placed++;
    }

    for (let placed = 0, tries = 0; placed < 8 && tries < 60; tries++) {
      const s = rng() < 0.5 ? 1.2 : 1.6;
      const cx = o.x + (rng() - 0.5) * 2 * (S - 2.5);
      const cz = o.z + (rng() - 0.5) * 2 * (S - 2.5);
      const h = s / 2;
      if (!free(cx - h, cz - h, cx + h, cz + h)) continue;
      taken.push({ minX: cx - h, minZ: cz - h, maxX: cx + h, maxZ: cz + h });
      const tint = rng();
      const base = build ? this.addPanel(cx - h, y - 0.2, cz - h, cx + h, y + s, cz + h, 'crate', [], tint) : -1;
      if (rng() < 0.35) {
        const s2 = 1.1;
        const ox = cx + (rng() - 0.5) * 0.3;
        const oz = cz + (rng() - 0.5) * 0.3;
        const tint2 = rng();
        if (build) this.addPanel(ox - s2 / 2, y + s, oz - s2 / 2, ox + s2 / 2, y + s + s2, oz + s2 / 2, 'crate', [base], tint2);
      }
      placed++;
    }
  }

  /** Ruined walls and crate piles out in the open, so fields have some cover. */
  private scatterCover(rng: () => number): void {
    for (let placed = 0, tries = 0; placed < 45 && tries < 800; tries++) {
      const x = (rng() - 0.5) * this.size * 0.8;
      const z = (rng() - 0.5) * this.size * 0.8;
      const y = this.terrainHeight(x, z);
      if (y < 1.5 || y > 40 || this.nearOutpost(x, z, 35)) continue;
      placed++;
      if (rng() < 0.5) {
        const len = 3 + rng() * 4;
        const h = 1.2 + rng() * 1.4;
        const alongX = rng() < 0.5;
        const hx = alongX ? len / 2 : 0.3;
        const hz = alongX ? 0.3 : len / 2;
        const [lo, hi] = this.heightRange(x - hx, z - hz, x + hx, z + hz);
        this.addWall(x - hx, lo - 0.3, z - hz, x + hx, hi + h, z + hz, hi);
      } else {
        const count = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < count; k++) {
          const s = 1.1 + rng() * 0.5;
          const cx = x + k * 1.9;
          const cz = z + (rng() - 0.5) * 0.8;
          const [lo, hi] = this.heightRange(cx - s / 2, cz - s / 2, cx + s / 2, cz + s / 2);
          this.addPanel(cx - s / 2, lo - 0.3, cz - s / 2, cx + s / 2, hi + s, cz + s / 2, 'crate', [], rng());
        }
      }
    }
  }

  /** Extraction points on low ground toward the coast, far from outposts and from each other. */
  private placeExtracts(rng: () => number): void {
    const candidates: Point[] = [];
    for (let tries = 0; candidates.length < 60 && tries < 3000; tries++) {
      const x = (rng() - 0.5) * this.size * 0.9;
      const z = (rng() - 0.5) * this.size * 0.9;
      const h = this.terrainHeight(x, z);
      if (h < 2 || h > 14 || Math.hypot(x, z) < this.half * 0.35) continue;
      if (this.nearOutpost(x, z, 90) || this.blocked(x, z, 3)) continue;
      candidates.push({ x, y: this.groundHeight(x, z, h), z });
    }
    // Greedy farthest-point picks spread them around the island.
    while (this.extracts.length < EXTRACT_COUNT && candidates.length) {
      let best = 0;
      let bestD = -1;
      candidates.forEach((c, i) => {
        const d = this.extracts.length ? Math.min(...this.extracts.map((e) => Math.hypot(e.x - c.x, e.z - c.z))) : Math.hypot(c.x, c.z);
        if (d > bestD) (best = i), (bestD = d);
      });
      this.extracts.push(candidates.splice(best, 1)[0]);
    }
  }

  /**
   * Runs of wooden fence out in the fields, placed last from their own random
   * stream so nothing else moved when they were added.
   */
  private placeFences(rng: () => number): void {
    for (let placed = 0, tries = 0; placed < FENCE_RUNS && tries < 1500; tries++) {
      const x = (rng() - 0.5) * this.size * 0.8;
      const z = (rng() - 0.5) * this.size * 0.8;
      const alongX = rng() < 0.5;
      const count = 2 + Math.floor(rng() * 4);
      if (this.nearOutpost(x, z, 40) || this.extracts.some((e) => Math.hypot(e.x - x, e.z - z) < 20)) continue;
      const sections: [number, number, number, number, number, number][] = [];
      for (let i = 0; i < count; i++) {
        const a = (i - count / 2) * FENCE_PANEL;
        const [x0, z0, x1, z1] = alongX
          ? [x + a, z - FENCE_THICK / 2, x + a + FENCE_PANEL, z + FENCE_THICK / 2]
          : [x - FENCE_THICK / 2, z + a, x + FENCE_THICK / 2, z + a + FENCE_PANEL];
        const [lo, hi] = this.heightRange(x0, z0, x1, z1);
        if (lo < 1.5 || hi > 38 || hi - lo > 0.8) break;
        if (this.blocked((x0 + x1) / 2, (z0 + z1) / 2, FENCE_PANEL / 2 + 0.6)) break;
        sections.push([x0, lo - 0.3, z0, x1, hi + FENCE_HEIGHT, z1]);
      }
      if (sections.length < count) continue;
      placed++;
      for (const [x0, y0, z0, x1, y1, z1] of sections) {
        this.addPanel(x0, y0, z0, x1, y1, z1, 'fence', [], rng());
        this.insert(this.colliders[this.colliders.length - 1]);
      }
    }
  }

  /**
   * Small buildings out in the country, on flat, dry ground clear of
   * everything else and away from the outposts, each with a crate. Placed last,
   * from their own random stream, so nothing else moved when they were added.
   */
  private placeHuts(rng: () => number): void {
    const start = this.colliders.length;
    for (let placed = 0, tries = 0; placed < HUTS && tries < 1500; tries++) {
      const x = (rng() - 0.5) * this.size * 0.75;
      const z = (rng() - 0.5) * this.size * 0.75;
      const spec = this.spec(rng() < 0.75 ? 'one' : 'two', rng);
      const alongX = rng() < 0.5;
      const flipU = rng() < 0.5;
      const flipV = rng() < 0.5;
      if (this.nearOutpost(x, z, 45) || this.extracts.some((e) => Math.hypot(e.x - x, e.z - z) < 30)) continue;
      if (this.buildings.some((b) => Math.hypot((b.minX + b.maxX) / 2 - x, (b.minZ + b.maxZ) / 2 - z) < 40)) continue;
      const [w, d] = alongX ? [spec.L, spec.D] : [spec.D, spec.L];
      const r: Rect = { minX: x - w / 2, minZ: z - d / 2, maxX: x + w / 2, maxZ: z + d / 2 };
      let lo = Infinity;
      let hi = -Infinity;
      for (let sx = r.minX - 1; sx <= r.maxX + 1; sx += 1) {
        for (let sz = r.minZ - 1; sz <= r.maxZ + 1; sz += 1) {
          const h = this.terrainHeight(sx, sz);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      if (lo < 2.5 || hi > 40 || hi - lo > 0.4) continue;
      const clear = grow(r, 1.5);
      if (!this.groundClear(clear)) continue;
      // No tree near enough for its crown to reach through the roof.
      if (this.trees.some((t) => t.x > clear.minX - 2 && t.x < clear.maxX + 2 && t.z > clear.minZ - 2 && t.z < clear.maxZ + 2)) continue;
      const floor = hi + 0.1;
      const f = frameOf(r.minX, r.minZ, spec.L, spec.D, alongX, flipU, flipV);
      this.addBuilding(spec, f, floor, lo - 0.3, rng, -1, 1);
      // A concrete floor over the uneven ground.
      this.addProp(r.minX + HOUSE_WALL, lo - 0.3, r.minZ + HOUSE_WALL, r.maxX - HOUSE_WALL, floor, r.maxZ - HOUSE_WALL, 'wall');
      placed++;
    }
    for (let i = start; i < this.colliders.length; i++) this.insert(this.colliders[i]);
  }

  /** Whether nothing solid stands on the rectangle. */
  private groundClear(r: Rect): boolean {
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    for (const c of this.query(cx, cz, Math.hypot(r.maxX - r.minX, r.maxZ - r.minZ) / 2)) {
      const [x0, z0, x1, z1] = c.kind === 'cyl' ? [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r] : [c.minX, c.minZ, c.maxX, c.maxZ];
      if (x0 < r.maxX && x1 > r.minX && z0 < r.maxZ && z1 > r.minZ) return false;
    }
    return true;
  }

  private placeTrees(rng: () => number): void {
    for (let tries = 0; this.trees.length < 1100 && tries < 12000; tries++) {
      const x = (rng() - 0.5) * this.size * 0.96;
      const z = (rng() - 0.5) * this.size * 0.96;
      const y = this.terrainHeight(x, z);
      if (y < 1.5 || y > 50) continue;
      if (fbm(x / 110, z / 110, this.seed + 99, 3) < 0.48) continue;
      if (this.nearOutpost(x, z, 30) || this.nearProp(x, z, 2)) continue;
      const s = 0.8 + rng() * 0.7;
      this.trees.push({ x, y, z, s });
      this.colliders.push({ kind: 'cyl', x, z, r: 0.3 * s + 0.05, y0: y - 1, y1: y + 7 * s, stamp: 0 });
    }
  }

  private placeRocks(rng: () => number): void {
    for (let tries = 0; this.rocks.length < 280 && tries < 4000; tries++) {
      const x = (rng() - 0.5) * this.size * 0.96;
      const z = (rng() - 0.5) * this.size * 0.96;
      const y = this.terrainHeight(x, z);
      if (y < -0.5 || y > 55) continue;
      if (this.nearOutpost(x, z, 26) || this.nearProp(x, z, 3)) continue;
      const r = 0.6 + rng() ** 2 * 2.6;
      const h = r * (0.6 + rng() * 0.6);
      this.rocks.push({ x, y, z, r, h, rot: rng() * Math.PI * 2 });
      this.colliders.push({ kind: 'cyl', x, z, r: r * 0.85, y0: y - 1, y1: y + h * 0.85, stamp: 0 });
    }
  }
}

/** Local (along, across) to world (x, z). */
type Frame = (a: number, c: number) => [number, number];

interface Spec {
  plan: Plan;
  L: number;
  D: number;
  W: number;
  E: number;
}

/**
 * The frame for a footprint at (minX, minZ), `L` along its length and `D`
 * deep: its length runs along x or z, and each local axis either way.
 */
function frameOf(minX: number, minZ: number, L: number, D: number, alongX: boolean, flipU: boolean, flipV: boolean): Frame {
  return (u, v) => {
    const uu = flipU ? L - u : u;
    const vv = flipV ? D - v : v;
    return alongX ? [minX + uu, minZ + vv] : [minX + vv, minZ + uu];
  };
}

/** A local rectangle in world space. */
function rectOf(f: Frame, a0: number, c0: number, a1: number, c1: number): Rect {
  const [ax, az] = f(a0, c0);
  const [bx, bz] = f(a1, c1);
  return { minX: Math.min(ax, bx), minZ: Math.min(az, bz), maxX: Math.max(ax, bx), maxZ: Math.max(az, bz) };
}

function grow(r: Rect, by: number): Rect {
  return { minX: r.minX - by, minZ: r.minZ - by, maxX: r.maxX + by, maxZ: r.maxZ + by };
}

/** The whole numbers from `a` up to but not including `b`. */
function range(a: number, b: number): number[] {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

/** A copy of `list` in an order drawn from `rng`. */
function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
