import { WATER_LEVEL } from './constants.ts';
import { clamp } from './geom.ts';
import { GROUND_LAYERS, groundWeights } from './ground.ts';
import { Layer } from './layers.ts';
import { mulberry32 } from './rng.ts';
import { inBuilding, OUTSKIRTS, type Tree, type World } from './world.ts';

// The bushes and grass on the ground, and the trees' crowns, as far as sight
// is concerned. Bushes and grass are scattered here, tuft by tuft and bush by
// bush, the same on every client and the server, so the ones a player crouches
// behind are the ones the bots can't see through: a lone tuft hides a little
// and a gap in a field hides nothing. None of them stops bullets or bodies.
// Someone inside a bush sees out through it, as its leaves are pushed aside
// right in front of their eyes.

/** Metres square each cell of scattered bushes covers. */
export const VEG_CELL = 8;

/** Bushes tried per square metre. */
const BUSH_DENSITY = 0.018;
/** Bush width range in metres; they're about as tall as they're wide. */
const BUSH_SIZE: [number, number] = [0.5, 1.3];
/** Of a bush's width, how far out from its middle it's thick enough to hide behind. */
const BUSH_CORE = 0.35;
/** And how far out its thinner edges reach. */
const BUSH_EDGE = 0.6;

/** Grass tufts tried per square metre, and their height range before the stretch. */
const TUFT_DENSITY = 1.6;
const TUFT_SIZE: [number, number] = [0.3, 0.6];
/** Of a tuft's size, how far out from its middle its blades reach. */
const TUFT_REACH = 0.45;
/**
 * On an outpost's outskirts bushes grow this many times as thick, and grass up
 * to this many times as tall, fading in and out over OUTSKIRT_FADE metres.
 */
const OUTSKIRT_BUSHES = 2.5;
const OUTSKIRT_GRASS = 1.7;
const OUTSKIRT_FADE = 15;
/** Tallest a tuft grows, with its stretch: no sight line above this touches grass. */
const GRASS_TOP = TUFT_SIZE[1] * 1.2 * OUTSKIRT_GRASS;
/**
 * Share of a sight line a tuft stops, crossed through its middle low down.
 * Its blades thin out from halfway up to nothing near the top.
 */
export const TUFT_BLOCK = 0.85;
/** Metres between samples along a sight line, looking for where it runs low enough for grass. */
const GRASS_STEP = 0.5;
/**
 * Cover for someone sneaking through: a bush at least this tall, or tufts in
 * one 1 m square whose heights add up to this many metres.
 */
const COVER_BUSH = 0.8;
const COVER_GRASS = 1.2;
/** Grass cells kept before they're all let go and scattered again as needed. */
const GRASS_CELLS = 3000;

/**
 * A spruce's shape, in metres for a tree of scale 1 standing on its foot: how
 * tall it is, where the crown's lowest living whorl starts and how far its
 * longest limbs reach. The trees are drawn to this.
 */
export const TREE_HEIGHT = 7;
export const CROWN_BASE = 1.3;
export const CROWN_REACH = 2.35;
/** How far the lowest limbs droop below CROWN_BASE, per metre out from the trunk. */
const CROWN_DROOP = 0.35;
/** Widest a crown gets, for a tree of scale 1. */
const CROWN_WIDEST = CROWN_REACH + 0.2;
/**
 * Share of a sight line lost per metre of needles it crosses, near the trunk;
 * the crown thins out toward its edges to CROWN_THIN of that.
 */
const CROWN_DENSITY = 1.6;
const CROWN_THIN = 0.4;
/** Metres between samples along a sight line through a crown. */
const CROWN_STEP = 0.2;
/** Needles this close to someone's eyes are pushed aside: they see out of a tree they stand in. */
const CROWN_ASIDE = 1.2;

/** Horizontal reach of a scale-1 spruce's limbs at height `y` above its foot: a narrow cone, rounded at the foot. */
export function crownReach(y: number): number {
  const f = Math.min(Math.max((y - CROWN_BASE) / (TREE_HEIGHT - 0.2 - CROWN_BASE), 0), 1);
  return CROWN_REACH * (1 - f) ** 0.95 * (0.82 + 0.18 * Math.min(1, f * 6)) + 0.2;
}

/** Floats per tuft in Tufts.data. */
export const TUFT_STRIDE = 10;

/**
 * The grass tufts of one cell, sorted by the 1 m square they stand in: square
 * (sx, sz) of the cell holds tufts start[sz * VEG_CELL + sx] up to the next.
 * Each is TUFT_STRIDE floats: x, y, z, size (width), height, turn, leanX,
 * leanZ, shade (0..1) and dryness (0..1).
 */
export interface Tufts {
  count: number;
  data: Float32Array;
  start: Uint16Array;
  /** Random numbers drawn scattering them, for whatever is scattered after them from the same seed. */
  draws: number;
}

export interface Bush {
  x: number;
  y: number;
  z: number;
  /** Width in metres. */
  size: number;
  /** Height in metres. */
  height: number;
  /** Yaw and a little lean, in radians. */
  turn: number;
  leanX: number;
  leanZ: number;
  /** 0..1, for varying its colour. */
  shade: number;
}

/** Below this much showing through bushes and grass, something is hidden. */
export const CONCEALED = 0.3;
/** Height of a bag's top, which has to show for it to be seen. */
const BAG_TOP = 0.3;

/**
 * Whether a bag lying at (x, y, z) shows to an eye at (ex, ey, ez): nothing
 * solid in the way, and not hidden in the bushes or grass.
 */
export function bagShows(world: World, ex: number, ey: number, ez: number, x: number, y: number, z: number): boolean {
  const top = y + BAG_TOP;
  return world.hasLineOfSight(ex, ey, ez, x, top, z) && vegetationOf(world).seeThrough(ex, ey, ez, x, top, z) >= CONCEALED;
}

const cache = new WeakMap<World, Vegetation>();

/** The world's bushes and grass, worked out once per world. */
export function vegetationOf(world: World): Vegetation {
  let v = cache.get(world);
  if (!v) cache.set(world, (v = new Vegetation(world)));
  return v;
}

export class Vegetation {
  private readonly world: World;
  private readonly weights: Float32Array;
  private readonly cells = new Map<number, Bush[]>();
  private readonly grass = new Map<number, Tufts>();
  /** The trees standing in each cell, by key. */
  private readonly trees = new Map<number, Tree[]>();
  /** 1 m squares of ground a sight line passes low over, by key; reused. */
  private readonly squares = new Set<number>();

  constructor(world: World) {
    this.world = world;
    this.weights = groundWeights(world);
    for (const t of world.trees) {
      const key = (Math.floor(t.x / VEG_CELL) + 4096) * 8192 + Math.floor(t.z / VEG_CELL) + 4096;
      const list = this.trees.get(key);
      if (list) list.push(t);
      else this.trees.set(key, [t]);
    }
  }

  /** The bushes in cell (ix, iz), scattered the first time they're asked for. */
  bushes(ix: number, iz: number): Bush[] {
    const key = (ix + 4096) * 8192 + iz + 4096;
    let out = this.cells.get(key);
    if (out) return out;
    out = [];
    const w = this.world;
    const rand = mulberry32((ix * 73856093) ^ (iz * 19349663) ^ w.seed ^ 0x5b0f1e);
    const wild = this.outskirts((ix + 0.5) * VEG_CELL, (iz + 0.5) * VEG_CELL);
    const tries = Math.round(VEG_CELL * VEG_CELL * BUSH_DENSITY * (1 + (OUTSKIRT_BUSHES - 1) * wild) + rand());
    for (let k = 0; k < tries; k++) {
      const x = (ix + rand()) * VEG_CELL;
      const z = (iz + rand()) * VEG_CELL;
      const keep = rand();
      const size = BUSH_SIZE[0] + rand() * (BUSH_SIZE[1] - BUSH_SIZE[0]);
      const tall = 0.8 + rand() * 0.4;
      const turn = rand() * Math.PI * 2;
      const leanX = (rand() - 0.5) * 0.2;
      const leanZ = (rand() - 0.5) * 0.2;
      const shade = rand();
      if (Math.abs(x) > w.half - 1 || Math.abs(z) > w.half - 1) continue;
      const y = w.terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.4) continue;
      const i = this.vertex(x, z);
      if (keep > (this.weights[i + Layer.grass] + this.weights[i + Layer.dryGrass] * 0.5) * 0.9) continue;
      // Not inside or under anything: props, trees, rocks or roofs.
      if (!w.clearAsBuilt(x, y, z, 3.5, size * 0.5)) continue;
      if (w.buildings.some((b) => inBuilding(b, x, z, 0.3))) continue;
      out.push({ x, y: y - 0.02, z, size, height: size * tall, turn, leanX, leanZ, shade });
    }
    this.cells.set(key, out);
    return out;
  }

  /** The grass tufts in cell (ix, iz), scattered the first time they're asked for. */
  tufts(ix: number, iz: number): Tufts {
    const key = (ix + 4096) * 8192 + iz + 4096;
    let out = this.grass.get(key);
    if (out) return out;
    if (this.grass.size >= GRASS_CELLS) this.grass.clear();
    const w = this.world;
    const weights = this.weights;
    const rand = mulberry32((ix * 73856093) ^ (iz * 19349663) ^ w.seed);
    let draws = 0;
    const next = (): number => (draws++, rand());
    const tries = Math.round(VEG_CELL * VEG_CELL * TUFT_DENSITY + next());
    const kept: number[] = [];
    const squareOf: number[] = [];
    for (let k = 0; k < tries; k++) {
      const x = (ix + next()) * VEG_CELL;
      const z = (iz + next()) * VEG_CELL;
      const keep = next();
      const size = TUFT_SIZE[0] + next() * (TUFT_SIZE[1] - TUFT_SIZE[0]);
      const turn = next() * Math.PI * 2;
      const shade = next();
      if (Math.abs(x) > w.half - 1 || Math.abs(z) > w.half - 1) continue;
      const y = w.terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.4) continue;
      const i = this.vertex(x, z);
      const grass = weights[i + Layer.grass];
      const dryGrass = weights[i + Layer.dryGrass];
      if (keep > grass + dryGrass * 0.8) continue;
      // Not inside or under anything: props, trees, rocks or roofs.
      if (!w.clearAsBuilt(x, y, z, 3.5, 0.05)) continue;
      if (w.buildings.some((b) => inBuilding(b, x, z, 0.3))) continue;
      const leanX = (next() - 0.5) * 0.2;
      const leanZ = (next() - 0.5) * 0.2;
      const height = size * (0.8 + next() * 0.4) * (1 + (OUTSKIRT_GRASS - 1) * this.outskirts(x, z));
      const dry = clamp(dryGrass / (grass + dryGrass + 1e-3), 0, 1);
      kept.push(x, y - 0.02, z, size, height, turn, leanX, leanZ, shade, dry);
      const sx = Math.min(Math.floor(x - ix * VEG_CELL), VEG_CELL - 1);
      const sz = Math.min(Math.floor(z - iz * VEG_CELL), VEG_CELL - 1);
      squareOf.push(sz * VEG_CELL + sx);
    }
    // Sort by square, keeping the scattering order within each.
    const count = squareOf.length;
    const squares = VEG_CELL * VEG_CELL;
    const start = new Uint16Array(squares + 1);
    for (const s of squareOf) start[s + 1]++;
    for (let s = 0; s < squares; s++) start[s + 1] += start[s];
    const fill = start.slice(0, squares);
    const data = new Float32Array(count * TUFT_STRIDE);
    for (let k = 0; k < count; k++) {
      const at = fill[squareOf[k]]++;
      for (let f = 0; f < TUFT_STRIDE; f++) data[at * TUFT_STRIDE + f] = kept[k * TUFT_STRIDE + f];
    }
    out = { count, data, start, draws };
    this.grass.set(key, out);
    return out;
  }

  /** How far (x, z) is into an outpost's outskirts, where the growth is wilder: 0 outside, 1 well in. */
  outskirts(x: number, z: number): number {
    const d = this.world.nearestOutpost(x, z)?.dist ?? Infinity;
    return Math.min(clamp((d - OUTSKIRTS[0] + OUTSKIRT_FADE) / OUTSKIRT_FADE, 0, 1), clamp((OUTSKIRTS[1] + OUTSKIRT_FADE - d) / OUTSKIRT_FADE, 0, 1));
  }

  /** Index into the ground layer weights of the terrain vertex nearest (x, z). */
  vertex(x: number, z: number): number {
    const w = this.world;
    const n = w.res + 1;
    const ix = clamp(Math.round((x + w.half) / w.cell), 0, w.res);
    const iz = clamp(Math.round((z + w.half) / w.cell), 0, w.res);
    return (iz * n + ix) * GROUND_LAYERS;
  }

  /** How thick the grass grows at (x, z), 0..1. */
  grassiness(x: number, z: number): number {
    const i = this.vertex(x, z);
    return Math.min(this.weights[i + Layer.grass] + this.weights[i + Layer.dryGrass] * 0.8, 1);
  }

  /**
   * Whether the 1 m square of ground at (x, z) gives someone sneaking through
   * it some cover: a bush over it, or grass grown thick and tall there.
   */
  cover(x: number, z: number): boolean {
    const sx = Math.floor(x);
    const sz = Math.floor(z);
    const ix = Math.floor(sx / VEG_CELL);
    const iz = Math.floor(sz / VEG_CELL);
    const cx = sx + 0.5;
    const cz = sz + 0.5;
    for (let jz = Math.floor((cz - 1.5) / VEG_CELL); jz <= Math.floor((cz + 1.5) / VEG_CELL); jz++) {
      for (let jx = Math.floor((cx - 1.5) / VEG_CELL); jx <= Math.floor((cx + 1.5) / VEG_CELL); jx++) {
        for (const b of this.bushes(jx, jz)) {
          if (b.height >= COVER_BUSH && Math.hypot(b.x - cx, b.z - cz) < b.size * BUSH_EDGE + 0.5) return true;
        }
      }
    }
    const { data, start } = this.tufts(ix, iz);
    const sq = (sz - iz * VEG_CELL) * VEG_CELL + (sx - ix * VEG_CELL);
    let height = 0;
    for (let k = start[sq]; k < start[sq + 1]; k++) height += data[k * TUFT_STRIDE + 4];
    return height >= COVER_GRASS;
  }

  /**
   * How much of a sight line from a to b gets past the bushes, grass and
   * tree crowns between them, from 1 (nothing in the way) down to 0. `a` is
   * the one looking: a bush they're in doesn't hide what's outside it from
   * them, nor do the needles right in front of their eyes.
   * Solid things are World.hasLineOfSight's business.
   */
  seeThrough(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    let through = 1;

    // Bushes: every cell the line passes near, each bush once.
    const reach = BUSH_SIZE[1] * BUSH_EDGE;
    const seen = new Set<number>();
    const steps = Math.max(1, Math.ceil(len / (VEG_CELL / 2)));
    for (let s = 0; s <= steps; s++) {
      const px = ax + (dx * s) / steps;
      const pz = az + (dz * s) / steps;
      const x0 = Math.floor((px - VEG_CELL / 4 - reach) / VEG_CELL);
      const x1 = Math.floor((px + VEG_CELL / 4 + reach) / VEG_CELL);
      const z0 = Math.floor((pz - VEG_CELL / 4 - reach) / VEG_CELL);
      const z1 = Math.floor((pz + VEG_CELL / 4 + reach) / VEG_CELL);
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const key = (ix + 4096) * 8192 + iz + 4096;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const b of this.bushes(ix, iz)) {
            // Looking out from inside it.
            if (Math.hypot(ax - b.x, az - b.z) < b.size * BUSH_CORE && ay - b.y < b.height) continue;
            // Closest the line comes to the bush's stem, seen from above.
            const t = len > 1e-6 ? clamp(((b.x - ax) * dx + (b.z - az) * dz) / (len * len), 0, 1) : 0;
            const off = Math.hypot(ax + dx * t - b.x, az + dz * t - b.z);
            if (off > b.size * BUSH_EDGE) continue;
            // Over the top, allowing for the dome narrowing upward.
            const above = ay + dy * t - b.y;
            if (above < 0 || above > b.height * (off < b.size * BUSH_CORE ? 0.9 : 0.6)) continue;
            through *= off < b.size * BUSH_CORE ? 0.08 : 0.45;
            if (through < 0.01) return 0;
          }
        }
      }
    }
    through *= this.crownsThrough(ax, ay, az, dx, dy, dz, len);
    if (through < 0.01) return 0;
    return through * this.grassThrough(ax, ay, az, dx, dy, dz, len);
  }

  /** How much of a sight line gets past the tree crowns it runs through, 1 down to 0. */
  private crownsThrough(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number): number {
    const reach = CROWN_WIDEST * 1.5;
    const len2 = len * len;
    const len3 = Math.hypot(len, dy);
    const seen = new Set<number>();
    let thick = 0;
    const steps = Math.max(1, Math.ceil(len / (VEG_CELL / 2)));
    for (let s = 0; s <= steps; s++) {
      const px = ax + (dx * s) / steps;
      const pz = az + (dz * s) / steps;
      const x0 = Math.floor((px - VEG_CELL / 4 - reach) / VEG_CELL);
      const x1 = Math.floor((px + VEG_CELL / 4 + reach) / VEG_CELL);
      const z0 = Math.floor((pz - VEG_CELL / 4 - reach) / VEG_CELL);
      const z1 = Math.floor((pz + VEG_CELL / 4 + reach) / VEG_CELL);
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const key = (ix + 4096) * 8192 + iz + 4096;
          if (seen.has(key)) continue;
          seen.add(key);
          const trees = this.trees.get(key);
          if (!trees) continue;
          for (const t of trees) {
            // Where the line, seen from above, crosses the circle the crown stands in.
            const widest = CROWN_WIDEST * t.s;
            if (len < 1e-6) continue;
            const mid = ((t.x - ax) * dx + (t.z - az) * dz) / len2;
            const off2 = (ax + dx * mid - t.x) ** 2 + (az + dz * mid - t.z) ** 2;
            if (off2 >= widest * widest) continue;
            const half = Math.sqrt(widest * widest - off2) / len;
            const t0 = Math.max(mid - half, 0);
            const t1 = Math.min(mid + half, 1);
            if (t1 <= t0) continue;
            // Sample along it, adding up the needles crossed.
            const foot = t.y - 0.2;
            const n = Math.ceil(((t1 - t0) * len3) / CROWN_STEP);
            const step = ((t1 - t0) * len3) / n;
            for (let k = 0; k < n; k++) {
              const u = t0 + ((t1 - t0) * (k + 0.5)) / n;
              if (u * len3 < CROWN_ASIDE) continue;
              const h = (ay + dy * u - foot) / t.s;
              if (h > TREE_HEIGHT) continue;
              const r = Math.hypot(ax + dx * u - t.x, az + dz * u - t.z) / t.s;
              if (h < CROWN_BASE - 0.2 - CROWN_DROOP * r) continue;
              const edge = crownReach(Math.max(h, CROWN_BASE));
              if (r >= edge) continue;
              thick += step * CROWN_DENSITY * (CROWN_THIN + (1 - CROWN_THIN) * (1 - r / edge));
            }
            if (thick > 4.6) return 0;
          }
        }
      }
    }
    return Math.exp(-thick);
  }

  /** How much of a sight line gets past the grass tufts it runs through, 1 down to 0. */
  private grassThrough(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number): number {
    // The 1 m squares near every stretch of the line low enough for grass.
    const w = this.world;
    const squares = this.squares;
    squares.clear();
    const n = Math.max(1, Math.ceil(len / GRASS_STEP));
    const near = GRASS_STEP / 2 + TUFT_SIZE[1] * TUFT_REACH;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const x = ax + dx * t;
      const z = az + dz * t;
      const above = ay + dy * t - w.terrainHeight(x, z);
      if (above >= GRASS_TOP + 0.3 || above < -0.2) continue;
      for (let sz = Math.floor(z - near); sz <= Math.floor(z + near); sz++) {
        for (let sx = Math.floor(x - near); sx <= Math.floor(x + near); sx++) squares.add((sx + 65536) * 131072 + sz + 65536);
      }
    }
    if (squares.size === 0) return 1;

    // Each tuft in them once: what's lost crossing it at the height the line passes.
    let through = 1;
    const len2 = len * len;
    for (const key of squares) {
      const sx = Math.floor(key / 131072) - 65536;
      const sz = (key % 131072) - 65536;
      const ix = Math.floor(sx / VEG_CELL);
      const iz = Math.floor(sz / VEG_CELL);
      const { data, start } = this.tufts(ix, iz);
      const sq = (sz - iz * VEG_CELL) * VEG_CELL + (sx - ix * VEG_CELL);
      for (let k = start[sq]; k < start[sq + 1]; k++) {
        const o = k * TUFT_STRIDE;
        const tx = data[o];
        const tz = data[o + 2];
        const r = data[o + 3] * TUFT_REACH;
        const t = len > 1e-6 ? clamp(((tx - ax) * dx + (tz - az) * dz) / len2, 0, 1) : 0;
        const off = Math.hypot(ax + dx * t - tx, az + dz * t - tz);
        if (off >= r) continue;
        const u = Math.max(ay + dy * t - data[o + 1], 0) / data[o + 4];
        if (u >= 0.95) continue;
        // Thick up to halfway, thinning to nothing near the top; a glancing line crosses less of it.
        const thick = u < 0.5 ? 1 : (0.95 - u) / 0.45;
        through *= 1 - TUFT_BLOCK * thick * Math.sqrt(1 - (off * off) / (r * r));
        if (through < 0.01) return 0;
      }
    }
    return through;
  }
}
