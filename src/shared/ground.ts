import { clamp, smoothstep } from './geom.ts';
import { fbm } from './rng.ts';
import { ROAD_WIDTH, type World } from './world.ts';
import { Layer } from './layers.ts';

// What the ground is painted with, worked out once per terrain vertex: the
// renderer blends its textures by these weights, and footsteps sound like the
// layer that's strongest underfoot, so the two always agree.

/** The ground layers, in splat order. */
export const GROUND_LAYERS = 5;

/** Everything the paint at one vertex is made from, for its colours and weights. */
export interface Paint {
  dry: number;
  dirt: number;
  rock: number;
  sand: number;
  seabed: number;
  /** How much of each ground layer, by Layer index, summing to 1. */
  weights: number[];
}

/** The paint at a terrain vertex at (x, y, z) whose normal points up by `flat`. */
export function paint(world: World, x: number, y: number, z: number, flat: number): Paint {
  const dry = fbm(x / 60, z / 60, world.seed + 5, 3);
  const outpost = world.nearestOutpost(x, z);
  const town = world.nearestTown(x, z);
  const dirt = Math.max(
    outpost ? smoothstep(26, 16, outpost.dist) : 0,
    // Bare in a town, bar the yards with grass in them.
    town ? smoothstep(town.town.r + 6, town.town.r - 4, town.dist) * (world.inGreen(x, z) ? 0.15 : 1) : 0,
    smoothstep(ROAD_WIDTH / 2 + 3, ROAD_WIDTH / 2, world.roadDistance(x, z)),
  );
  const rock = smoothstep(0.86, 0.72, flat) + smoothstep(38, 52, y);
  const sand = smoothstep(2.2, 0.8, y);
  const seabed = smoothstep(-0.5, -3, y);
  const w = [0, 0, 0, 0, 0];
  const toward = (layer: number, t: number): void => {
    t = clamp(t, 0, 1);
    for (let k = 0; k < w.length; k++) w[k] = w[k] * (1 - t) + (k === layer ? t : 0);
  };
  w[Layer.grass] = 1;
  toward(Layer.dryGrass, smoothstep(0.42, 0.72, dry));
  toward(Layer.dirt, dirt);
  toward(Layer.rock, rock);
  toward(Layer.sand, sand);
  return { dry, dirt, rock, sand, seabed, weights: w };
}

/**
 * The up component of each terrain vertex's normal, as three.js's
 * computeVertexNormals gives it for the terrain mesh: the sum of the faces'
 * unnormalized normals around it, normalized.
 */
export function terrainNormalsY(world: World): Float32Array {
  const n = world.res + 1;
  const H = world.heights;
  const c = world.cell;
  const sum = new Float32Array(n * n * 3);
  const add = (i: number, x: number, y: number, z: number): void => {
    sum[i * 3] += x;
    sum[i * 3 + 1] += y;
    sum[i * 3 + 2] += z;
  };
  for (let iz = 0; iz < world.res; iz++) {
    for (let ix = 0; ix < world.res; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const d = a + n + 1;
      const e = a + n;
      // Triangles (a, e, b) and (b, e, d), as the mesh is indexed.
      for (const [p, q, r] of [[a, e, b], [b, e, d]]) {
        const px = (p % n) * c, pz = Math.floor(p / n) * c;
        const ux = (q % n) * c - px, uy = H[q] - H[p], uz = Math.floor(q / n) * c - pz;
        const vx = (r % n) * c - px, vy = H[r] - H[p], vz = Math.floor(r / n) * c - pz;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        add(p, nx, ny, nz);
        add(q, nx, ny, nz);
        add(r, nx, ny, nz);
      }
    }
  }
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = sum[i * 3 + 1] / Math.hypot(sum[i * 3], sum[i * 3 + 1], sum[i * 3 + 2]);
  return out;
}

const cache = new WeakMap<World, Float32Array>();

/** Every terrain vertex's layer weights, GROUND_LAYERS each, row by row. */
export function groundWeights(world: World): Float32Array {
  let out = cache.get(world);
  if (out) return out;
  const n = world.res + 1;
  const flat = terrainNormalsY(world);
  out = new Float32Array(n * n * GROUND_LAYERS);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -world.half + ix * world.cell;
      const z = -world.half + iz * world.cell;
      out.set(paint(world, x, world.heights[i], z, flat[i]).weights, i * GROUND_LAYERS);
    }
  }
  cache.set(world, out);
  return out;
}

/**
 * The ground layer that shows most at (x, z), blending the weights across the
 * terrain triangle there as the vertex weights are interpolated for drawing.
 */
export function groundLayerAt(world: World, x: number, z: number): number {
  const W = groundWeights(world);
  const n = world.res + 1;
  const gx = clamp((x + world.half) / world.cell, 0, world.res - 1e-4);
  const gz = clamp((z + world.half) / world.cell, 0, world.res - 1e-4);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * n + ix;
  // The same split as World.terrainHeight.
  const [p, q, r, wq, wr] = fx + fz <= 1
    ? [i, i + 1, i + n, fx, fz]
    : [i + n + 1, i + n, i + 1, 1 - fx, 1 - fz];
  let best = 0;
  let bestW = -1;
  for (let k = 0; k < GROUND_LAYERS; k++) {
    const w = W[p * GROUND_LAYERS + k] * (1 - wq - wr) + W[q * GROUND_LAYERS + k] * wq + W[r * GROUND_LAYERS + k] * wr;
    if (w > bestW) (bestW = w), (best = k);
  }
  return best;
}
