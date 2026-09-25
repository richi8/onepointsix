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
}

export type Collider = Cyl | Box;
export type PropStyle = 'crate' | 'wall' | 'wood' | 'metal' | 'fence' | 'roof';
export type PanelKind = 'wall' | 'fence' | 'crate';

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
}

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

/** A roofed building: its outer footprint, the floor it stands on and the underside of its roof. */
export interface Building {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  floor: number;
  roof: number;
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
const HOUSE_ROOF = 0.2;
/** Doorways are wide enough that a bot's path always finds a way through. */
const DOOR_WIDTH = 2.2;
const DOOR_HEIGHT = 2.2;
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
  /** The buildings in the outposts, one each. */
  readonly buildings: Building[] = [];
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

    this.outposts.forEach((o, i) => this.buildOutpost(o, rng, mulberry32(this.seed ^ 0xa54ff53a ^ Math.imul(i + 1, 0x9e3779b1))));
    this.scatterCover(rng);
    this.placeTrees(rng);
    this.placeRocks(rng);
    for (const c of this.colliders) this.insert(c);
    // Its own random stream, so adding extraction points moved nothing else.
    this.placeExtracts(mulberry32(this.seed ^ 0x6a09e667));
    this.placeFences(mulberry32(this.seed ^ 0x3c6ef372));
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

  /** Whether no obstacle reaches within `pad` of (x, z) between feetY and feetY + height. */
  clear(x: number, feetY: number, z: number, height: number, pad: number): boolean {
    for (const c of this.query(x, z, pad)) {
      if (topOf(c) <= feetY + 0.01 || bottomOf(c) >= feetY + height) continue;
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

  /** Distance along a normalized ray to the first solid hit, or Infinity. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    this.hit = null;
    const terrain = this.raycastTerrain(ox, oy, oz, dx, dy, dz, maxT);
    return this.raycastColliders(ox, oy, oz, dx, dy, dz, Math.min(terrain, maxT, MAX_RAY), terrain);
  }

  /** Like raycast, and also which panel the ray stopped at, or -1 for anything else. */
  raycastPanel(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number,
  ): { t: number; panel: number } {
    const t = this.raycast(ox, oy, oz, dx, dy, dz, maxT);
    const hit = this.hit;
    return { t, panel: t <= maxT && hit?.kind === 'box' ? (hit.panel ?? -1) : -1 };
  }

  // ----------------------------------------------------------------- panels

  /** Break a panel and everything resting on it. Returns what broke, that panel first; nothing if it was already down. */
  breakPanel(id: number): number[] {
    const out: number[] = [];
    const stack = [id];
    while (stack.length) {
      const i = stack.pop()!;
      const panel = this.panels[i];
      if (!panel || panel.box.gone) continue;
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

  /** Whether a panel is standing and everything it rests on too, so it could be rebuilt. */
  supported(id: number): boolean {
    return this.panels[id].restsOn.every((i) => !this.panels[i].box.gone);
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
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.05;
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
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, end: number, best: number,
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
    const [x0, z0, x1, z1] =
      c.kind === 'cyl' ? [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r] : [c.minX, c.minZ, c.maxX, c.maxZ];
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

  /**
   * A two-room concrete building in a corner of the outpost away from the
   * watchtower, its front toward the middle. Its walls are breakable panels
   * with doorways and window openings; the lintels over them rest on the wall
   * either side. Corner posts hold up a roof that can't be broken. `edge` is
   * how far from the outpost's centre the building may reach.
   */
  private addBuilding(o: Outpost, edge: number, rng: () => number): Building {
    const y = o.y;
    const L = 10 + rng() * 1.5;
    const D = 6.5 + rng() * 1;
    // Quadrant +x or -x on the +z side (the tower is at -x, -z), long side along x or z.
    const sx = rng() < 0.5 ? 1 : -1;
    const alongX = rng() < 0.5;
    const [w, d] = alongX ? [L, D] : [D, L];
    const minX = sx > 0 ? o.x + edge - w : o.x - edge;
    const minZ = o.z + edge - d;
    const b: Building = { minX, minZ, maxX: minX + w, maxZ: minZ + d, floor: y, roof: y + HOUSE_HEIGHT };
    this.buildings.push(b);

    // Local frame: u along the long side, v across it from the front (toward the middle) to the back.
    const toWorld = (u: number, v: number): [number, number] => alongX
      ? [sx > 0 ? b.minX + u : b.maxX - u, b.minZ + v]
      : [sx > 0 ? b.minX + v : b.maxX - v, b.maxZ - u];
    const box = (u0: number, v0: number, u1: number, v1: number): [number, number, number, number] => {
      const [ax, az] = toWorld(u0, v0);
      const [bx, bz] = toWorld(u1, v1);
      return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
    };
    const T = HOUSE_WALL;
    const top = y + HOUSE_HEIGHT;
    // Room A (u < p) has the front door; room B the door at the far end.
    const p = L * (0.52 + rng() * 0.06);
    const door = (at: number): Opening => ({ at, width: DOOR_WIDTH, kind: 'door' });
    const pane = (at: number): Opening => ({ at, width: WINDOW_WIDTH, kind: 'window' });
    const jitter = () => (rng() - 0.5) * 0.8;

    for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) {
      const [x0, z0, x1, z1] = box(u, v, u + T, v + T);
      this.addProp(x0, y - 0.5, z0, x1, top, z1, 'wall');
    }
    this.addFacade(box, T, L - T, 0, T, y, [door(p / 2 + jitter()), pane((p + L) / 2 + jitter())]);
    this.addFacade(box, T, L - T, D - T, D, y, [pane(p / 2 + jitter()), pane((p + L) / 2 + jitter())]);
    this.addFacade((u0, v0, u1, v1) => box(v0, u0, v1, u1), T, D - T, 0, T, y, [pane(D / 2)]);
    this.addFacade((u0, v0, u1, v1) => box(v0, u0, v1, u1), T, D - T, L - T, L, y, [door(D / 2)]);
    // The partition between the rooms, with a doorway in the middle.
    this.addFacade((u0, v0, u1, v1) => box(v0, u0, v1, u1), T, D - T, p - T / 2, p + T / 2, y, [door(D / 2 + jitter() * 0.5)]);

    const [rx0, rz0, rx1, rz1] = box(-0.3, -0.3, L + 0.3, D + 0.3);
    this.addProp(rx0, top, rz0, rx1, top + HOUSE_ROOF, rz1, 'roof');

    // A table under the end window of room A, and a crate in the back corner of each room.
    const [tx0, tz0, tx1, tz1] = box(T + 0.05, D / 2 - 0.9, T + 0.95, D / 2 + 0.9);
    this.addProp(tx0, y - 0.2, tz0, tx1, y + 0.8, tz1, 'wood');
    for (const u of [p - T / 2 - 1.15, L - T - 1.15]) {
      const [cx0, cz0, cx1, cz1] = box(u, D - T - 1.15, u + 1, D - T - 0.15);
      this.addPanel(cx0, y - 0.2, cz0, cx1, y + 1, cz1, 'crate', [], rng());
    }
    return b;
  }

  /**
   * One wall of a building from a0 to a1 along its local u axis, between v0
   * and v1 across, with `openings` in it. `box` turns a local rectangle into
   * world x and z bounds. Solid stretches are ordinary wall columns; a window
   * has a sill panel below it, and every opening a lintel above it resting on
   * the columns either side.
   */
  private addFacade(
    box: (u0: number, v0: number, u1: number, v1: number) => [number, number, number, number],
    a0: number, a1: number, v0: number, v1: number, y: number, openings: Opening[],
  ): void {
    const top = y + HOUSE_HEIGHT;
    const sorted = [...openings].sort((p, q) => p.at - q.at);
    // Each solid stretch's top panels in u order: before the first opening, between each pair, after the last.
    const runs: number[][] = [];
    for (let i = 0; i <= sorted.length; i++) {
      const u0 = i === 0 ? a0 : sorted[i - 1].at + sorted[i - 1].width / 2;
      const u1 = i === sorted.length ? a1 : sorted[i].at - sorted[i].width / 2;
      if (u1 - u0 < 0.05) {
        runs.push([]);
        continue;
      }
      const [x0, z0, x1, z1] = box(u0, v0, u1, v1);
      const tops = this.addWall(x0, y - 0.5, z0, x1, top, z1, y, false);
      // addWall orders its columns along the world axis, which may run against u.
      const [ax, az] = box(u0, v0, u0, v0);
      const [bx, bz] = box(u1, v0, u1, v0);
      const reversed = Math.abs(bx - ax) > Math.abs(bz - az) ? bx < ax : bz < az;
      runs.push(reversed ? tops.reverse() : tops);
    }
    sorted.forEach((o, i) => {
      const [x0, z0, x1, z1] = box(o.at - o.width / 2, v0, o.at + o.width / 2, v1);
      if (o.kind === 'window') this.addPanel(x0, y - 0.5, z0, x1, y + WINDOW_SILL, z1, 'wall');
      const left = runs[i].at(-1) ?? -1;
      const right = runs[i + 1][0] ?? -1;
      this.addPanel(x0, y + (o.kind === 'door' ? DOOR_HEIGHT : WINDOW_TOP), z0, x1, top, z1, 'wall', [left, right]);
    });
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

  /** `house` is the outpost's own stream for its building, so its details don't shift the rest of the island. */
  private buildOutpost(o: Outpost, rng: () => number, house: () => number): void {
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

    // Shipping containers and crates as cover inside the walls.
    const taken: [number, number, number, number][] = [[px - 3, pz - 3, px + 10.5, pz + 3]];
    const b = this.addBuilding(o, S - T - HOUSE_CLEARANCE, house);
    // Kept well clear, so nothing stands in front of a doorway.
    taken.push([b.minX - 1.5, b.minZ - 1.5, b.maxX + 1.5, b.maxZ + 1.5]);
    const free = (x0: number, z0: number, x1: number, z1: number) =>
      taken.every(([a, b, c, d]) => x1 + 1.2 < a || x0 - 1.2 > c || z1 + 1.2 < b || z0 - 1.2 > d);

    for (let placed = 0, tries = 0; placed < 2 && tries < 30; tries++) {
      const alongX = rng() < 0.5;
      const hx = alongX ? 3 : 1.2;
      const hz = alongX ? 1.2 : 3;
      const cx = o.x + (rng() - 0.5) * 2 * (S - 5);
      const cz = o.z + (rng() - 0.5) * 2 * (S - 5);
      if (!free(cx - hx, cz - hz, cx + hx, cz + hz)) continue;
      taken.push([cx - hx, cz - hz, cx + hx, cz + hz]);
      this.addProp(cx - hx, y - 0.2, cz - hz, cx + hx, y + 2.6, cz + hz, 'metal', rng());
      placed++;
    }

    for (let placed = 0, tries = 0; placed < 8 && tries < 60; tries++) {
      const s = rng() < 0.5 ? 1.2 : 1.6;
      const cx = o.x + (rng() - 0.5) * 2 * (S - 2.5);
      const cz = o.z + (rng() - 0.5) * 2 * (S - 2.5);
      const h = s / 2;
      if (!free(cx - h, cz - h, cx + h, cz + h)) continue;
      taken.push([cx - h, cz - h, cx + h, cz + h]);
      const base = this.addPanel(cx - h, y - 0.2, cz - h, cx + h, y + s, cz + h, 'crate', [], rng());
      if (rng() < 0.35) {
        const s2 = 1.1;
        const ox = cx + (rng() - 0.5) * 0.3;
        const oz = cz + (rng() - 0.5) * 0.3;
        this.addPanel(ox - s2 / 2, y + s, oz - s2 / 2, ox + s2 / 2, y + s + s2, oz + s2 / 2, 'crate', [base], rng());
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
