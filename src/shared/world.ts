import {
  EXTRACT_RADIUS,
  GRID_RES,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STEP_HEIGHT,
  WATER_FLOOR_DEPTH,
  WATER_LEVEL,
  WORLD_SIZE,
} from './constants.ts';
import { clamp, rayAabb, rayCylinder, rayExit, rayTiltedBox, smoothstep } from './geom.ts';
import { rayRock, rockExit, rockNormal, rockShape, ROCK_BULGE, ROCK_SQUASH } from './rock.ts';
import { buildKit, flightSteps, type KitGable, type KitWall, rampSteps } from './kit.ts';
import type { GameMap, MapGround, MapRamp, MapStair } from './maps/index.ts';
import { fbm, mulberry32 } from './rng.ts';

export interface Cyl {
  kind: 'cyl';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  /** A boulder: rounds and sight meet its faces as drawn, not the flat-topped post it is to walk into. */
  rock?: Rock;
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
  /** Railing's bars: bodies stop at it, but rounds and sight pass through. */
  open?: boolean;
  /** A floor up off the ground that bots can climb to and walk on: stairs, an upper storey, a watchtower's platform. */
  walk?: boolean;
  /** What it is. */
  part: Part;
  /** A top sloping as a road does: rising `x` metres a metre toward +x and `z` toward +z, at `maxY` at its highest corner. Flat if left out. */
  tilt?: { x: number; z: number };
  /** A map's ground: its top drawn with the rest of the ground, as one surface, and only its sides as a box. */
  ground?: boolean;
}

export type Collider = Cyl | Box;
export type PropStyle = 'crate' | 'wall' | 'wood' | 'metal' | 'fence' | 'roof' | 'glass';
/** The parts that can be broken: fence sections, crates, window glass and tables. */
export type PanelKind = 'fence' | 'crate' | 'glass' | 'table';
/**
 * What a prop is: `sill` the wall under a window, `floor` a concrete floor
 * slab, `step` a stair, `timber` a watchtower's woodwork, `container` a
 * shipping container, or one of the parts that can be broken.
 */
export type Part = 'wall' | 'sill' | 'roof' | 'tiles' | 'floor' | 'step' | 'timber' | 'container' | PanelKind;

/** How each part is drawn. */
const PART_STYLE: Record<Part, PropStyle> = {
  wall: 'wall', sill: 'wall', roof: 'roof', tiles: 'roof', floor: 'wall', step: 'wood', timber: 'wood', container: 'metal',
  fence: 'fence', crate: 'crate', glass: 'glass', table: 'wood',
};

export interface Prop {
  box: Box;
  style: PropStyle;
  tint: number;
  /** A map's building's plaster, over its walls, in place of the style's colour. */
  colour?: number;
  /** Index into World.panels, or -1 if it can't be broken. */
  panel: number;
}

/**
 * A breakable piece of cover: a fence section, a crate, a pane of glass or
 * a table. Its health lives on the server; the world only knows if it stands.
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
 * the underside of its (highest) roof. `parts` are the rectangles its walls
 * enclose: one, or two for an L; a map's buildings are built from the kit
 * (see kit.ts), any number of rectangles of up to three storeys.
 */
export interface Building {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  floor: number;
  roof: number;
  plan: Plan | 'kit';
  parts: Rect[];
  /** The upper storey's floor, or null with only one. */
  upper: number | null;
  /** A building of the kit's floors above the ground's, lowest first; `upper` is the first. */
  uppers?: number[];
  /** Index into World.outposts, or -1 for a building out in the country. */
  outpost: number;
}

/** Whether (x, z) lies within `pad` of a building's walls, roof overhang included for a positive pad. */
export function inBuilding(b: Building, x: number, z: number, pad = 0): boolean {
  if (x < b.minX - pad || x > b.maxX + pad || z < b.minZ - pad || z > b.maxZ + pad) return false;
  return b.parts.some((r) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad);
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

/**
 * A doorway, window or archway in a building's wall, centred `at` along it:
 * an archway reaches `height` above its floor.
 */
interface Opening {
  at: number;
  width: number;
  kind: 'door' | 'window' | 'arch';
  height?: number;
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
/** One for each outpost. */
const EXTRACT_COUNT = 6;
/**
 * The outskirts of an outpost, metres from its middle: the ground its guards
 * watch over, given boulders to crouch behind (this many clusters each), and
 * thicker bushes and taller grass (see vegetation.ts).
 */
export const OUTSKIRTS: [number, number] = [45, 130];
const OUTSKIRT_CLUSTERS = 14;
/** Pieces of cover round each extraction point. */
const EXTRACT_COVER = 5;
const FENCE_RUNS = 40;
const FENCE_PANEL = 2;
const FENCE_HEIGHT = 1.1;
const FENCE_THICK = 0.1;
/** A building's walls: thickness, height and the corner posts' size. */
export const HOUSE_WALL = 0.3;
const HOUSE_HEIGHT = 3;
export const HOUSE_ROOF = 0.2;
/** How wide a two-storey building's stairs are: room for a bot's path up them beside the upper floor's edge. */
const STAIR_WIDTH = 1.5;
/** A shipping container's height. */
const CONTAINER_HEIGHT = 2.6;
/** Doorways are wide enough that a bot's path always finds a way through. */
const DOOR_WIDTH = 2.2;
const DOOR_HEIGHT = 2.2;
/** Window glass's thickness. */
const GLASS = 0.03;
/** Buildings out in the country, away from the outposts. */
const HUTS = 9;
const WINDOW_WIDTH = 1.2;
const WINDOW_SILL = 1;
const WINDOW_TOP = 2;
/** Room kept clear between a building and the outpost's walls. */
const HOUSE_CLEARANCE = 1.65;
/** On a map, the most a walked floor's lip may stand over the feet and still be underfoot: sloping floors meet a few centimetres out of true. */
const SEAM = 0.1;
/** Longest ray the collider walk follows, past which nothing is left to hit. */
const MAX_RAY = WORLD_SIZE * 1.5;

/** A box's top over (x, z), taken at the nearest point of its footprint: its maxY, but under a sloping top's highest corner by the slope. */
export function boxTop(c: Box, x: number, z: number): number {
  const t = c.tilt;
  if (!t) return c.maxY;
  const px = clamp(x, c.minX, c.maxX);
  const pz = clamp(z, c.minZ, c.maxZ);
  return c.maxY - (t.x > 0 ? (c.maxX - px) * t.x : (px - c.minX) * -t.x) - (t.z > 0 ? (c.maxZ - pz) * t.z : (pz - c.minZ) * -t.z);
}

/** A collider's top over (x, z): a sloping box's where it's nearest. */
function topAt(c: Collider, x: number, z: number): number {
  return c.kind === 'cyl' ? c.y1 : c.tilt ? boxTop(c, x, z) : c.maxY;
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
 * be sent over the network. A mode played on a fixed map (see maps/) builds
 * it from the map instead, on the island its seed makes as a backdrop.
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
  /** The faces every rock is drawn from, in its own frame (see rock.ts). */
  readonly rockShape: Float64Array;
  readonly props: Prop[] = [];
  /** The fixed map it's built from, or null for an island made from its seed alone. */
  readonly map: GameMap | null;
  /** Where the game is played: the whole island, or a map's bounds. */
  readonly bounds: Rect;
  /** On a map, where operators come into the game. */
  readonly spawns: (Point & { yaw: number })[] = [];
  readonly outposts: Outpost[] = [];
  /** Where operators leave the island; the server opens and closes them. */
  readonly extracts: Point[] = [];
  readonly colliders: Collider[] = [];
  readonly panels: Panel[] = [];
  /** Each freestanding wall's outline. Buildings' walls aren't listed. */
  readonly walls: Box[] = [];
  /** The buildings: one in each outpost, in order, then those out in the country; or a map's. */
  readonly buildings: Building[] = [];
  /** Each outpost's watchtower: the props it's built from, drawn as one. */
  readonly towers: { outpost: number; props: number[] }[] = [];
  /** A map's pitched roofs: the layers each collides as (`props`), drawn as its slopes. */
  readonly gables: (KitGable & { props: number[] })[] = [];
  /** A map's buildings' walls, a storey of a line at a time with their openings, for drawing their trim. */
  readonly facades: KitWall[] = [];
  readonly maxHeight: number;
  private readonly grid = new Map<number, Collider[]>();
  private readonly nearby: Collider[] = [];
  private stamp = 0;
  /** The collider the last raycast stopped at, if it was one. */
  private hit: Collider | null = null;

  constructor(seed: number, map: GameMap | null = null) {
    this.map = map;
    // A map is the same whatever the game's seed: its backdrop and noise come from its own.
    this.seed = (map ? map.seed : seed) >>> 0;
    this.bounds = map ? { ...map.bounds } : { minX: -this.half, minZ: -this.half, maxX: this.half, maxZ: this.half };
    this.rockShape = rockShape(this.seed + 23);
    const n = this.res + 1;
    this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        this.heights[iz * n + ix] = this.rawHeight(-this.half + ix * this.cell, -this.half + iz * this.cell);
      }
    }

    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    if (map) this.shapeGround(map.ground);
    else this.placeOutposts(rng);
    let maxH = -Infinity;
    for (const h of this.heights) if (h > maxH) maxH = h;
    this.maxHeight = maxH;

    // The plans shuffled, so the first four outposts on an island each get a different one.
    const plans = shuffled(PLANS, mulberry32(this.seed ^ 0x1f83d9ab));
    this.outposts.forEach((o, i) => this.buildOutpost(o, i, plans[i % plans.length], rng, this.houseSeed(i)));
    if (!map) this.scatterCover(rng);
    this.placeTrees(rng);
    this.placeRocks(rng);
    if (map) this.buildMap(map, mulberry32(this.seed ^ 0x68e31da5));
    for (const c of this.colliders) this.insert(c);
    if (map) {
      // On the highest floor walked under it: a terrace's, where the ground is built up.
      for (const { x, z, yaw } of map.spawns) this.spawns.push({ x, y: this.groundHeight(x, z, Math.max(this.floorHeight(x, z), ...this.floorTops(x, z, 0.01))), z, yaw });
      return;
    }
    // Its own random stream, so adding extraction points moved nothing else.
    this.placeExtracts(mulberry32(this.seed ^ 0x6a09e667));
    this.placeFences(mulberry32(this.seed ^ 0x3c6ef372));
    this.placeHuts(mulberry32(this.seed ^ 0x510e527f));
    this.placeOutskirtRocks(mulberry32(this.seed ^ 0xa54ff53a));
    this.placeExtractCover(mulberry32(this.seed ^ 0xbb67ae85));
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

  /**
   * Highest surface a player with feet at feetY can stand on (steps
   * included), counting anything within `pad` of (x, z): a player's footing
   * by default, or less for one foot.
   */
  groundHeight(x: number, z: number, feetY: number, pad = PLAYER_RADIUS * 0.6): number {
    let h = this.floorHeight(x, z);
    for (const c of this.query(x, z, PLAYER_RADIUS)) {
      const top = topAt(c, x, z);
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

  /**
   * Tops of the floors up off the ground (stairs, upper storeys, platforms)
   * standing over the square `r` round (x, z), lowest first; with `roofs`,
   * the tops of roofs too.
   */
  floorTops(x: number, z: number, r: number, roofs = false): number[] {
    const out: number[] = [];
    for (const c of this.query(x, z, r)) {
      if (c.kind !== 'box' || !(c.walk || (roofs && (c.part === 'roof' || c.part === 'tiles')))) continue;
      if (c.maxX <= x - r || c.minX >= x + r || c.maxZ <= z - r || c.minZ >= z + r) continue;
      const top = boxTop(c, x, z);
      if (!out.includes(top)) out.push(top);
    }
    return out.sort((a, b) => a - b);
  }

  /** Top of the highest obstacle over (x, z) with its top in (minY, maxY], or -Infinity. A pitched roof's layers are no ledge: nobody climbs onto the tiles. */
  ledgeHeight(x: number, z: number, minY: number, maxY: number): number {
    let best = -Infinity;
    for (const c of this.query(x, z, 0)) {
      const top = topAt(c, x, z);
      if (top <= minY || top > maxY || top <= best) continue;
      if (c.kind === 'box' && c.part === 'tiles') continue;
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
   * feetY + height, ignoring any no higher than `step` above the feet.
   */
  clear(x: number, feetY: number, z: number, height: number, pad: number, step = 0.01): boolean {
    for (const c of this.query(x, z, pad)) {
      if (topAt(c, x, z) <= feetY + this.lip(c, step) || bottomOf(c) >= feetY + height) continue;
      if (overlapsFootprint(c, x, z, pad)) return false;
    }
    return true;
  }

  /**
   * How far over the feet a collider's top may stand and still be underfoot,
   * not in the way: `step`, but on a map, where sloping floors meet at a seam
   * a few centimetres out of true, a walked floor's lip up to SEAM.
   */
  private lip(c: Collider, step: number): number {
    return this.map && c.kind === 'box' && c.walk ? Math.max(step, SEAM) : step;
  }

  /**
   * Like clear, but against the world as it was built: broken panels count,
   * so what's scattered by it comes out the same whenever it's first asked for.
   */
  clearAsBuilt(x: number, feetY: number, z: number, height: number, pad: number): boolean {
    for (const c of this.query(x, z, pad, true)) {
      if (topAt(c, x, z) <= feetY + this.lip(c, 0.01) || bottomOf(c) >= feetY + height) continue;
      if (overlapsFootprint(c, x, z, pad)) return false;
    }
    return true;
  }

  /** Push a body horizontally out of any obstacle taller than a step. */
  collide(b: Body, height = PLAYER_HEIGHT): void {
    const R = PLAYER_RADIUS;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.query(b.x, b.z, R + 0.1)) {
        if (topAt(c, b.x, b.z) <= b.y + STEP_HEIGHT || bottomOf(c) >= b.y + height) continue;
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
      if (topAt(c, x, z) <= y - r || bottomOf(c) >= y + r) continue;
      // The nearest point of the collider to the centre.
      let px: number;
      let py: number;
      let pz: number;
      if (c.kind === 'box') {
        px = clamp(x, c.minX, c.maxX);
        pz = clamp(z, c.minZ, c.maxZ);
        py = clamp(y, c.minY, boxTop(c, px, pz));
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
          [boxTop(c, x, z) - y, 0, 1, 0], [z - c.minZ, 0, 0, -1], [c.maxZ - z, 0, 0, 1],
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

  /**
   * Everything standing that the segment `len` metres from o along the
   * normalized d passes through, glass included, with how far it runs inside
   * each, in no particular order. The ground isn't counted.
   */
  collidersAlong(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number,
    visit: (c: Collider, inside: number) => void,
  ): void {
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
    for (let enter = 0; enter <= len;) {
      const cell = this.grid.get((gx + GRID_OFFSET) * 4096 + gz + GRID_OFFSET);
      if (cell) {
        for (const c of cell) {
          if (c.stamp === stamp || c.gone || (c.kind === 'box' && c.open)) continue;
          c.stamp = stamp;
          const t = this.rayCollider(c, ox, oy, oz, dx, dy, dz);
          if (t < len) visit(c, Math.min(c.kind === 'cyl' && c.rock ? rockExit() : rayExit(), len) - t);
        }
      }
      const exit = Math.min(nextX, nextZ);
      if (exit === Infinity) break;
      enter = exit;
      if (nextX < nextZ) {
        nextX += deltaX;
        gx += stepX;
      } else {
        nextZ += deltaZ;
        gz += stepZ;
      }
    }
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

  /** Whether everything a panel rests on stands, so it could be rebuilt. */
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
      if (c.rock) {
        // A point a round stopped at on a boulder's faces, which reach past its post.
        const k = c.rock;
        const u = Math.hypot((x - k.x) / k.r, (y - k.y) / (k.h * ROCK_SQUASH), (z - k.z) / k.r);
        if (u <= ROCK_BULGE + e) return rockNormal(this.rockShape, k, x, y, z);
        continue;
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

  /** Where a ray first meets a collider, a boulder by its faces, or Infinity; rayExit() or rockExit() then gives where it leaves. */
  private rayCollider(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (c.kind === 'box') {
      return c.tilt
        ? rayTiltedBox(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, c.tilt.x, c.tilt.z)
        : rayAabb(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
    }
    if (c.rock) return rayRock(this.rockShape, c.rock, ox, oy, oz, dx, dy, dz);
    return rayCylinder(ox, oy, oz, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1);
  }

  hasLineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, true) >= d - 0.05;
  }

  /** Somewhere on dry land, clear of everything; on a map, within its bounds. */
  randomLandPoint(rand: () => number): { x: number; y: number; z: number } {
    const b = this.bounds;
    for (let i = 0; i < 60; i++) {
      const x = this.map ? b.minX + rand() * (b.maxX - b.minX) : (rand() - 0.5) * this.size * 0.8;
      const z = this.map ? b.minZ + rand() * (b.maxZ - b.minZ) : (rand() - 0.5) * this.size * 0.8;
      const h = this.terrainHeight(x, z);
      if (h < 1.5 || h > 45) continue;
      if (this.blocked(x, z, PLAYER_RADIUS + 0.2)) continue;
      return { x, y: this.groundHeight(x, z, h), z };
    }
    if (this.spawns.length) return { ...this.spawns[0] };
    return { x: 0, y: this.groundHeight(0, 0, this.terrainHeight(0, 0)), z: 0 };
  }

  /** Whether (x, z) is within the bounds, at least `pad` in from their edges. */
  inBounds(x: number, z: number, pad = 0): boolean {
    const b = this.bounds;
    return x >= b.minX + pad && x <= b.maxX - pad && z >= b.minZ + pad && z <= b.maxZ - pad;
  }

  /** How far (x, z) is outside the map's ground: 0 on it, Infinity with no map. */
  mapDistance(x: number, z: number): number {
    if (!this.map) return Infinity;
    const g = this.map.ground;
    const [x1, z1] = groundEnd(g);
    return Math.hypot(Math.max(g.x0 - x, 0, x - x1), Math.max(g.z0 - z, 0, z - z1));
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
          if (c.kind === 'box' && (c.open || (glass && c.clear))) continue;
          const t = this.rayCollider(c, ox, oy, oz, dx, dy, dz);
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

  /** Colliders near (x, z); `gone` ones too with `all`. */
  private query(x: number, z: number, r: number, all = false): Collider[] {
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
          if (c.stamp === stamp || (c.gone && !all)) continue;
          c.stamp = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  private insert(c: Collider): void {
    // A boulder is filed under every cell its faces reach, which stand out past its post.
    const r = c.kind === 'cyl' ? Math.max(c.r, c.rock ? c.rock.r * ROCK_BULGE : 0) : 0;
    const [x0, z0, x1, z1] =
      c.kind === 'cyl' ? [c.x - r, c.z - r, c.x + r, c.z + r] : [c.minX, c.minZ, c.maxX, c.maxZ];
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
    part: Part, tint = 0,
  ): Box {
    // Every field there from the start, in one order, so the collision loops see boxes of one shape.
    const box: Box = {
      kind: 'box', minX, minY, minZ, maxX, maxY, maxZ, stamp: 0,
      panel: undefined, gone: false, clear: false, open: false, walk: false, part,
    };
    this.props.push({ box, style: PART_STYLE[part], tint, panel: -1 });
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

  /** A freestanding wall: one solid box. */
  private addWall(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
    this.walls.push({ kind: 'box', minX, minY, minZ, maxX, maxY, maxZ, stamp: 0, part: 'wall' });
    return this.addProp(minX, minY, minZ, maxX, maxY, maxZ, 'wall');
  }

  /** Each outpost's own random stream, for its building and the cover round it. */
  private houseSeed(i: number): number {
    return this.seed ^ 0xa54ff53a ^ Math.imul(i + 1, 0x9e3779b1);
  }

  /**
   * A concrete building laid out by `spec`, placed by `f` (local u along its
   * length, v from its front to its back) with its floor at `y` and its walls
   * reaching down to `base`. Walls are solid, with doorways and windows:
   * windows are glazed, and doorways are left open. The
   * roof is solid too. There's a table under a window, and `crates` crates in the rooms.
   */
  private addBuilding(
    spec: Spec, f: Frame, y: number, base: number, rng: () => number, outpost: number, crates: number,
  ): Building {
    const { plan, L, D, W, E } = spec;
    const T = HOUSE_WALL;
    const top = y + HOUSE_HEIGHT;
    const rect = (u0: number, v0: number, u1: number, v1: number): Rect => rectOf(f, u0, v0, u1, v1);
    const alongU: Frame = (a, c) => f(a, c);
    const alongV: Frame = (a, c) => f(c, a);
    const door = (at: number): Opening => ({ at, width: DOOR_WIDTH, kind: 'door' });
    const pane = (at: number): Opening => ({ at, width: WINDOW_WIDTH, kind: 'window' });
    const jitter = () => (rng() - 0.5) * 0.8;
    const post = (u: number, v: number, y0: number, y1: number) => {
      const r = rect(u, v, u + T, v + T);
      this.addProp(r.minX, y0, r.minZ, r.maxX, y1, r.maxZ, 'wall');
    };
    const table = (r: Rect, floor: number) => this.addPanel(r.minX, floor - 0.2, r.minZ, r.maxX, floor + 0.8, r.maxZ, 'table');
    /** Where the crates go, most wanted first: on the ground floor or on an upper floor. */
    const spots: { r: Rect; floor: number }[] = [];
    const corner = (u: number, v: number, floor = y) => spots.push({ r: rect(u, v, u + 1, v + 1), floor });
    let parts: Rect[] = [rect(0, 0, L, D)];
    /** The roof's rectangles, overhang included, in local (u0, v0, u1, v1). */
    let roofs: [number, number, number, number][] = [[-0.3, -0.3, L + 0.3, D + 0.3]];
    let roofY = top;
    let upper: number | null = null;

    switch (plan) {
      case 'one': {
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, base, top);
        this.addFacade(alongU, T, L - T, 0, T, y, base, [door(L * 0.35 + jitter() * 0.4), pane(L * 0.76)], rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(L / 2 + jitter() * 0.5)], rng);
        this.addFacade(alongV, T, D - T, 0, T, y, base, [pane(D / 2)], rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [], rng);
        table(rect(T + 0.05, D / 2 - 0.9, T + 0.95, D / 2 + 0.9), y);
        corner(L - T - 1.15, D - T - 1.15);
        corner(T + 1.2, D - T - 1.15);
        break;
      }
      case 'two': {
        // Room A (u < p) has the front door; room B the door at the far end.
        const p = L * (0.52 + rng() * 0.06);
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, base, top);
        this.addFacade(alongU, T, L - T, 0, T, y, base, [door(p / 2 + jitter()), pane((p + L) / 2 + jitter())], rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(p / 2 + jitter()), pane((p + L) / 2 + jitter())], rng);
        this.addFacade(alongV, T, D - T, 0, T, y, base, [pane(D / 2)], rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [door(D / 2)], rng);
        // The partition between the rooms, with a doorway in the middle.
        this.addFacade(alongV, T, D - T, p - T / 2, p + T / 2, y, base, [door(D / 2 + jitter() * 0.5)], rng);
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
        for (const [u, v] of [[0, E], [0, D - T], [L - T, D - T], [L - T, 0], [a, 0]]) post(u, v, base, top);
        this.addFacade(alongU, T, a, E, E + T, y, base, [door(a * 0.38 + jitter() * 0.3), pane(a * 0.8)], rng);
        // B's side: onto the yard, then the partition with A.
        this.addFacade(alongV, T, D - T, a, a + T, y, base, [door(E / 2), door(mid + jitter() * 0.3)], rng);
        this.addFacade(alongU, a + T, L - T, 0, T, y, base, [pane((a + L) / 2)], rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [pane(E / 2), pane(mid)], rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(a / 2), pane(L - W / 2)], rng);
        this.addFacade(alongV, E + T, D - T, 0, T, y, base, [pane(mid)], rng);
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
        const sv = D - T - STAIR_WIDTH;
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, base, top);
        this.addFacade(alongU, T, L - T, 0, T, y, base, [pane(L * 0.25), door(L * 0.64 + jitter() * 0.3)], rng);
        this.addFacade(alongU, T, L - T, D - T, D, y, base, [pane(L * 0.74)], rng);
        this.addFacade(alongV, T, D - T, 0, T, y, base, [pane(D / 2 - 0.4)], rng);
        this.addFacade(alongV, T, D - T, L - T, L, y, base, [door(D / 2)], rng);
        for (let k = 0; k < steps; k++) {
          const r = rect(sEnd - (k + 1) * run, sv, sEnd - k * run, D - T);
          this.addProp(r.minX, y - 0.2, r.minZ, r.maxX, y + (HOUSE_HEIGHT * (k + 1)) / steps, r.maxZ, 'step').walk = true;
        }
        // The upper floor, with a hole over the stairs.
        for (const r of [rect(T, T, L - T, sv), rect(sEnd, sv, L - T, D - T)]) this.addProp(r.minX, y2 - 0.2, r.minZ, r.maxX, y2, r.maxZ, 'floor').walk = true;
        for (const [u, v] of [[0, 0], [L - T, 0], [0, D - T], [L - T, D - T]]) post(u, v, y2, top2);
        this.addFacade(alongU, T, L - T, 0, T, y2, y2, [pane(L * 0.28), pane(L * 0.72)], rng);
        this.addFacade(alongU, T, L - T, D - T, D, y2, y2, [pane(L * 0.62)], rng);
        this.addFacade(alongV, T, D - T, 0, T, y2, y2, [pane(D / 2 - 0.5)], rng);
        this.addFacade(alongV, T, D - T, L - T, L, y2, y2, [pane(D / 2)], rng);
        table(rect(L - T - 1.9, T + 0.05, L - T - 0.1, T + 0.95), y2);
        // One crate upstairs, in the corner farthest from the stairs' top.
        corner(T + 0.15, T + 0.15, y2);
        corner(L - T - 1.15, D - T - 1.15);
        roofY = top2;
        upper = y2;
        break;
      }
    }

    for (const [u0, v0, u1, v1] of roofs) {
      const r = rect(u0, v0, u1, v1);
      this.addProp(r.minX, roofY, r.minZ, r.maxX, roofY + HOUSE_ROOF, r.maxZ, 'roof');
    }

    for (const { r, floor } of spots.slice(0, crates)) {
      const t = this.terrainHeight((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
      // A crate on the ground reaches down into it; one upstairs stands on its floor.
      const bottom = floor === y ? Math.min(y - 0.2, t - 0.1) : floor;
      this.addPanel(r.minX, bottom, r.minZ, r.maxX, floor + 1, r.maxZ, 'crate', [], rng());
    }

    const all = rect(0, 0, L, D);
    const b: Building = { ...all, floor: y, roof: roofY, plan, parts, upper, outpost };
    this.buildings.push(b);
    return b;
  }

  /**
   * One wall of a building from a0 to a1 along `frame`'s first axis, between
   * c0 and c1 across it, with `openings` in it, standing on the floor at `y`
   * and reaching down to `base`. Solid stretches are a box each; a window has
   * a sill below it and glass on the sill, a doorway or an archway nothing,
   * and every opening a lintel above it. On an island, `rng` is drawn once
   * for each doorway, as when doorways were hung with leaves found open or
   * shut, so everything drawn from it after is placed as it was.
   */
  private addFacade(
    frame: Frame, a0: number, a1: number, c0: number, c1: number, y: number, base: number,
    openings: Opening[], rng?: () => number, height = HOUSE_HEIGHT,
  ): void {
    const top = y + height;
    const box = (u0: number, v0: number, u1: number, v1: number): Rect => rectOf(frame, u0, v0, u1, v1);
    const sorted = [...openings].sort((p, q) => p.at - q.at);
    // The solid stretches: before the first opening, between each pair, after the last.
    for (let i = 0; i <= sorted.length; i++) {
      const u0 = i === 0 ? a0 : sorted[i - 1].at + sorted[i - 1].width / 2;
      const u1 = i === sorted.length ? a1 : sorted[i].at - sorted[i].width / 2;
      if (u1 - u0 < 0.05) continue;
      const r = box(u0, c0, u1, c1);
      this.addProp(r.minX, base, r.minZ, r.maxX, top, r.maxZ, 'wall');
    }
    const mid = (c0 + c1) / 2;
    for (const o of sorted) {
      const r = box(o.at - o.width / 2, c0, o.at + o.width / 2, c1);
      if (o.kind === 'window') {
        this.addProp(r.minX, base, r.minZ, r.maxX, y + WINDOW_SILL, r.maxZ, 'sill');
        const g = box(o.at - o.width / 2, mid - GLASS / 2, o.at + o.width / 2, mid + GLASS / 2);
        const glass = this.addPanel(g.minX, y + WINDOW_SILL, g.minZ, g.maxX, y + WINDOW_TOP, g.maxZ, 'glass');
        this.panels[glass].box.clear = true;
      } else if (o.kind === 'door') rng?.();
      const lintel = y + (o.kind === 'door' ? DOOR_HEIGHT : o.kind === 'window' ? WINDOW_TOP : (o.height ?? DOOR_HEIGHT));
      if (top - lintel > 0.01) this.addProp(r.minX, lintel, r.minZ, r.maxX, top, r.maxZ, 'wall');
    }
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

  /**
   * A map's ground laid over the island's: its own heights over its grid,
   * sloping back into the island's over its blend beyond.
   */
  private shapeGround(g: MapGround): void {
    const [x1, z1] = groundEnd(g);
    const n = this.res + 1;
    for (let iz = 0; iz < n; iz++) {
      const z = -this.half + iz * this.cell;
      const dz = Math.max(g.z0 - z, 0, z - z1);
      if (dz >= g.blend) continue;
      for (let ix = 0; ix < n; ix++) {
        const x = -this.half + ix * this.cell;
        const d = Math.hypot(Math.max(g.x0 - x, 0, x - x1), dz);
        if (d >= g.blend) continue;
        const i = iz * n + ix;
        this.heights[i] += (groundAt(g, x, z) - this.heights[i]) * smoothstep(g.blend, 0, d);
      }
    }
  }

  /**
   * Everything standing on a map's ground, its crates' and containers'
   * colours drawn from `rng`: its buildings from the kit.
   */
  private buildMap(map: GameMap, rng: () => number): void {
    const terraces = map.walls.filter((w) => w.walk);
    const surface = (x: number, z: number) => {
      let y = this.terrainHeight(x, z);
      for (const t of terraces) if (x > t.minX && x < t.maxX && z > t.minZ && z < t.maxZ) y = Math.max(y, t.y1);
      return y;
    };
    const kit = buildKit(map.buildings, map.stairs, (x, z) => this.terrainHeight(x, z), surface);
    /** Plaster the props from `from` on that are walls. */
    const plaster = (from: number, colour: number | undefined) => {
      if (colour === undefined) return;
      for (let i = from; i < this.props.length; i++) if (this.props[i].style === 'wall') this.props[i].colour = colour;
    };
    for (const w of kit.walls) {
      const frame: Frame = w.axis === 'x' ? (a, c) => [a, c] : (a, c) => [c, a];
      const from = this.props.length;
      this.addFacade(frame, w.a0, w.a1, w.line - HOUSE_WALL / 2, w.line + HOUSE_WALL / 2, w.y, w.base, w.openings, undefined, w.height);
      plaster(from, w.colour);
    }
    this.facades.push(...kit.walls);
    for (const g of kit.gables) this.gables.push({ ...g, props: [] });
    for (const b of kit.boxes) {
      const added = this.addProp(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.part);
      added.walk = b.walk;
      added.open = !!b.open;
      plaster(this.props.length - 1, b.colour);
      if (b.gable !== undefined) this.gables[b.gable].props.push(this.props.length - 1);
    }
    for (const c of kit.crates) this.addPanel(c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, 'crate', [], rng());
    for (const b of kit.buildings) {
      const { uppers, ...rest } = b;
      this.buildings.push({ ...rest, plan: 'kit', upper: uppers[0] ?? null, uppers, outpost: -1 });
    }
    for (const w of map.walls) {
      for (const c of w.collides ?? [w]) {
        const box = this.addWall(c.minX, c.y0, c.minZ, c.maxX, c.y1, c.maxZ);
        box.walk = !!w.walk;
        if (w.tilt) box.tilt = this.walls[this.walls.length - 1].tilt = { ...w.tilt };
        if (w.ground) box.ground = true;
        plaster(this.props.length - 1, w.colour);
      }
    }
    for (const s of map.stairs) this.addStair(s);
    for (const r of map.ramps ?? []) this.addRamp(r);
    // The panel of each prop, for crates stacked on it; -1 for a container.
    const panels: number[] = [];
    for (const p of map.props) {
      if (p.kind === 'container') {
        const [lo, hi] = this.heightRange(p.minX, p.minZ, p.maxX, p.maxZ);
        this.addProp(p.minX, lo - 0.2, p.minZ, p.maxX, hi + CONTAINER_HEIGHT, p.maxZ, 'container', rng());
        panels.push(-1);
        continue;
      }
      const h = p.size / 2;
      const under = p.on === undefined ? -1 : panels[p.on];
      // On the crate under it, a walked floor over the ground, or the ground, sunk a little into it where it's uneven.
      // A map of buildings (the old town) sets its crates on the ground under its terraces, as it always has, until it goes (chunk 69).
      const floor = surface(p.x, p.z);
      const raised = under < 0 && !map.buildings.length && floor > this.terrainHeight(p.x, p.z) + 0.05;
      const [lo, hi] = under >= 0 ? [this.panels[under].box.maxY, this.panels[under].box.maxY] : raised ? [floor, floor] : this.heightRange(p.x - h, p.z - h, p.x + h, p.z + h);
      const bottom = under >= 0 || raised ? lo : lo - 0.2;
      panels.push(this.addPanel(p.x - h, bottom, p.z - h, p.x + h, hi + p.size, p.z + h, 'crate', under >= 0 ? [under] : [], rng()));
    }
  }

  /** A flight of steps, each a floor bots climb. */
  private addStair(s: MapStair): void {
    for (const { r, top } of flightSteps(s.x, s.z, s.width, s.climbs, s.y0, s.y1)) {
      this.addProp(r.minX, s.y0 - 0.3, r.minZ, r.maxX, top, r.maxZ, 'step').walk = true;
    }
  }

  /** A ramp's steps, each a floor bots walk, filled down into the ground. */
  private addRamp(r: MapRamp): void {
    for (const { r: q, top } of rampSteps(r)) {
      const [lo] = this.heightRange(q.minX, q.minZ, q.maxX, q.maxZ);
      this.addProp(q.minX, Math.min(lo, r.y0) - 0.3, q.minZ, q.maxX, top, q.maxZ, 'step').walk = true;
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
        if (side === 0) this.addWall(o.x + a, y - 0.5, o.z - S - T, o.x + b, y + h, o.z - S + T);
        if (side === 1) this.addWall(o.x + a, y - 0.5, o.z + S - T, o.x + b, y + h, o.z + S + T);
        if (side === 2) this.addWall(o.x - S - T, y - 0.5, o.z + a, o.x - S + T, y + h, o.z + b);
        if (side === 3) this.addWall(o.x + S - T, y - 0.5, o.z + a, o.x + S + T, y + h, o.z + b);
      }
    }

    // Watchtower: raised platform with parapets, reached by stairs on +x.
    const firstProp = this.props.length;
    const { x: px, y: top, z: pz } = watchtower(o);
    this.addProp(px - 2, top - 0.4, pz - 2, px + 2, top, pz + 2, 'timber').walk = true;
    for (const cx of [-1.75, 1.75]) {
      for (const cz of [-1.75, 1.75]) {
        this.addProp(px + cx - 0.2, y - 0.5, pz + cz - 0.2, px + cx + 0.2, top - 0.4, pz + cz + 0.2, 'timber');
      }
    }
    this.addProp(px - 2, top, pz - 2, px + 2, top + 1, pz - 1.8, 'timber');
    this.addProp(px - 2, top, pz + 1.8, px + 2, top + 1, pz + 2, 'timber');
    this.addProp(px - 2, top, pz - 2, px - 1.8, top + 1, pz + 2, 'timber');
    for (let i = 0; i < 7; i++) {
      this.addProp(px + 2 + i, y - 0.5, pz - 0.8, px + 3 + i, top - 0.5 - 0.5 * i, pz + 0.8, 'timber').walk = true;
    }
    this.towers.push({ outpost: index, props: range(firstProp, this.props.length) });

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
    const spec = specFor(plan, own);
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
      if (build) this.addProp(cx - hx, y - 0.2, cz - hz, cx + hx, y + 2.6, cz + hz, 'container', tint);
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
        this.addWall(x - hx, lo - 0.3, z - hz, x + hx, hi + h, z + hz);
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
      const spec = specFor(rng() < 0.75 ? 'one' : 'two', rng);
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
      this.addProp(r.minX + HOUSE_WALL, lo - 0.3, r.minZ + HOUSE_WALL, r.maxX - HOUSE_WALL, floor, r.maxZ - HOUSE_WALL, 'floor');
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
      if (this.nearOutpost(x, z, 30) || this.mapDistance(x, z) < 6 || this.nearProp(x, z, 2)) continue;
      const s = 0.8 + rng() * 0.7;
      this.trees.push({ x, y, z, s });
      this.colliders.push({ kind: 'cyl', x, z, r: 0.3 * s + 0.05, y0: y - 1, y1: y + 7 * s, stamp: 0 });
    }
  }

  /**
   * Clusters of boulders out on the approaches to each outpost, where its
   * guards patrol, tall enough to crouch behind: somewhere to go to ground.
   */
  private placeOutskirtRocks(rng: () => number): void {
    const start = this.colliders.length;
    for (const o of this.outposts) {
      for (let placed = 0, tries = 0; placed < OUTSKIRT_CLUSTERS && tries < 200; tries++) {
        const a = rng() * Math.PI * 2;
        const d = OUTSKIRTS[0] + rng() * (OUTSKIRTS[1] - OUTSKIRTS[0]);
        const count = 2 + Math.floor(rng() * 3);
        const turn = rng() * Math.PI * 2;
        const x = o.x + Math.sin(a) * d;
        const z = o.z + Math.cos(a) * d;
        const y = this.terrainHeight(x, z);
        if (y < 1.5 || y > 50 || this.nearOutpost(x, z, OUTSKIRTS[0] - 10)) continue;
        if (this.extracts.some((e) => Math.hypot(e.x - x, e.z - z) < 30)) continue;
        if (this.buildings.some((b) => inBuilding(b, x, z, 6)) || this.blocked(x, z, 5)) continue;
        placed++;
        // A short row of them, roughly across the way to the outpost.
        for (let k = 0; k < count; k++) {
          const r = 1.1 + rng() * 0.7;
          const h = r * (0.9 + rng() * 0.25);
          const off = (k - (count - 1) / 2) * 1.9 + (rng() - 0.5) * 0.6;
          const rx = x + Math.cos(turn) * off;
          const rz = z - Math.sin(turn) * off;
          const ry = this.terrainHeight(rx, rz);
          const rock = { x: rx, y: ry, z: rz, r, h, rot: rng() * Math.PI * 2 };
          this.rocks.push(rock);
          this.colliders.push({ kind: 'cyl', x: rx, z: rz, r: r * 0.85, y0: ry - 1, y1: ry + h * 0.85, rock, stamp: 0 });
        }
      }
    }
    for (let i = start; i < this.colliders.length; i++) this.insert(this.colliders[i]);
  }

  /**
   * Low walls and rows of boulders in a ring just outside each extraction point,
   * across the way in, so whoever waits there has something to crouch behind.
   */
  private placeExtractCover(rng: () => number): void {
    const start = this.colliders.length;
    for (const e of this.extracts) {
      const turn = rng() * Math.PI * 2;
      for (let placed = 0, tries = 0; placed < EXTRACT_COVER && tries < 40; tries++) {
        // Stepped round by the golden angle, so a blocked or wet side is skipped and the rest stays spread.
        const a = turn + tries * 2.4 + (rng() - 0.5) * 0.3;
        const d = EXTRACT_RADIUS + 3 + rng() * 5;
        const x = e.x + Math.sin(a) * d;
        const z = e.z + Math.cos(a) * d;
        const y = this.terrainHeight(x, z);
        if (y < 1.5 || this.blocked(x, z, 2.5)) continue;
        // Square to the point, whichever axis is nearer.
        const alongX = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
        if (rng() < 0.5) {
          const len = 3 + rng() * 2;
          const h = 1.1 + rng() * 0.4;
          const hx = alongX ? len / 2 : 0.3;
          const hz = alongX ? 0.3 : len / 2;
          const [lo, hi] = this.heightRange(x - hx, z - hz, x + hx, z + hz);
          if (hi - lo > 1) continue;
          this.addWall(x - hx, lo - 0.3, z - hz, x + hx, hi + h, z + hz);
        } else {
          // Boulders rather than crates, which would be loot crates by the exit.
          const count = 2 + Math.floor(rng() * 2);
          for (let k = 0; k < count; k++) {
            const r = 1 + rng() * 0.5;
            const h = r * (0.95 + rng() * 0.2);
            const off = (k - (count - 1) / 2) * 1.8;
            const rx = x + (alongX ? off : 0);
            const rz = z + (alongX ? 0 : off);
            const ry = this.terrainHeight(rx, rz);
            const rock = { x: rx, y: ry, z: rz, r, h, rot: rng() * Math.PI * 2 };
            this.rocks.push(rock);
            this.colliders.push({ kind: 'cyl', x: rx, z: rz, r: r * 0.85, y0: ry - 1, y1: ry + h * 0.85, rock, stamp: 0 });
          }
        }
        placed++;
      }
    }
    for (let i = start; i < this.colliders.length; i++) this.insert(this.colliders[i]);
  }

  private placeRocks(rng: () => number): void {
    for (let tries = 0; this.rocks.length < 280 && tries < 4000; tries++) {
      const x = (rng() - 0.5) * this.size * 0.96;
      const z = (rng() - 0.5) * this.size * 0.96;
      const y = this.terrainHeight(x, z);
      if (y < -0.5 || y > 55) continue;
      if (this.nearOutpost(x, z, 26) || this.mapDistance(x, z) < 4 || this.nearProp(x, z, 3)) continue;
      const r = 0.6 + rng() ** 2 * 2.6;
      const h = r * (0.6 + rng() * 0.6);
      const rock = { x, y, z, r, h, rot: rng() * Math.PI * 2 };
      this.rocks.push(rock);
      this.colliders.push({ kind: 'cyl', x, z, r: r * 0.85, y0: y - 1, y1: y + h * 0.85, rock, stamp: 0 });
    }
  }
}

/** Local (along, across) to world (x, z). */
type Frame = (a: number, c: number) => [number, number];

/** A building's size: `L` along its length and `D` deep, and an L's wing (`W` wide, jutting `E` out in front). */
interface Spec {
  plan: Plan;
  L: number;
  D: number;
  W: number;
  E: number;
}

/** A plan's size, drawn from `rng`. */
function specFor(plan: Plan, rng: () => number): Spec {
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

/** A map's ground grid's far corner: its greatest x and z. */
function groundEnd(g: MapGround): [number, number] {
  return [g.x0 + (g.heights[0].length - 1) * g.cell, g.z0 + (g.heights.length - 1) * g.cell];
}

/** A map's ground height at (x, z), between its grid's points, and as its nearest edge's beyond them. */
function groundAt(g: MapGround, x: number, z: number): number {
  const rows = g.heights.length;
  const cols = g.heights[0].length;
  const gx = clamp((x - g.x0) / g.cell, 0, cols - 1);
  const gz = clamp((z - g.z0) / g.cell, 0, rows - 1);
  const c = Math.min(Math.floor(gx), cols - 2);
  const r = Math.min(Math.floor(gz), rows - 2);
  const fx = gx - c;
  const fz = gz - r;
  const H = g.heights;
  return (H[r][c] * (1 - fx) + H[r][c + 1] * fx) * (1 - fz) + (H[r + 1][c] * (1 - fx) + H[r + 1][c + 1] * fx) * fz;
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
