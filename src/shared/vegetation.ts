import { WATER_LEVEL } from './constants.ts';
import { clamp } from './geom.ts';
import { GROUND_LAYERS, groundWeights } from './ground.ts';
import { Layer } from './layers.ts';
import { mulberry32 } from './rng.ts';
import { inBuilding, type World } from './world.ts';

// The bushes and grass on the ground, as far as sight is concerned. Bushes are
// scattered here, the same on every client and the server, so the ones a
// player crouches behind are the ones the bots can't see through. Grass isn't
// placed blade by blade: it's a layer up to GRASS_TOP deep, as thick as the
// ground is grassy, that a sight line loses a little to for each metre it runs
// through. Neither stops bullets or bodies.

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

/** Tallest blades of grass. */
const GRASS_TOP = 0.6;
/** Below this, grass is as thick as it gets. */
const GRASS_FULL = 0.25;
/** Share of a sight line lost per metre through thick grass. */
const GRASS_LOSS = 0.8;
/** Metres between samples along a sight line for grass. */
const GRASS_STEP = 0.5;

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

  constructor(world: World) {
    this.world = world;
    this.weights = groundWeights(world);
  }

  /** The bushes in cell (ix, iz), scattered the first time they're asked for. */
  bushes(ix: number, iz: number): Bush[] {
    const key = (ix + 4096) * 8192 + iz + 4096;
    let out = this.cells.get(key);
    if (out) return out;
    out = [];
    const w = this.world;
    const rand = mulberry32((ix * 73856093) ^ (iz * 19349663) ^ w.seed ^ 0x5b0f1e);
    const tries = Math.round(VEG_CELL * VEG_CELL * BUSH_DENSITY + rand());
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
      if (!w.clear(x, y, z, 3.5, size * 0.5)) continue;
      if (w.buildings.some((b) => inBuilding(b, x, z, 0.3))) continue;
      out.push({ x, y: y - 0.02, z, size, height: size * tall, turn, leanX, leanZ, shade });
    }
    this.cells.set(key, out);
    return out;
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
   * How much of a sight line from a to b gets past the bushes and grass
   * between them, from 1 (nothing in the way) down to 0. Solid things are
   * World.hasLineOfSight's business.
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

    // Grass: what's lost in each stretch of the line that runs through it.
    const w = this.world;
    const n = Math.max(1, Math.ceil(len / GRASS_STEP));
    const step = len / n;
    let loss = 0;
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const x = ax + dx * t;
      const z = az + dz * t;
      const above = ay + dy * t - w.terrainHeight(x, z);
      if (above >= GRASS_TOP || above < -0.2) continue;
      const thick = above <= GRASS_FULL ? 1 : (GRASS_TOP - above) / (GRASS_TOP - GRASS_FULL);
      loss += thick * this.grassiness(x, z) * step;
    }
    return through * Math.exp(-GRASS_LOSS * loss);
  }
}
