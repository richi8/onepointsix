import { smoothstep } from './geom.ts';
import { fbm } from './rng.ts';
import type { World } from './world.ts';

// A map's hillside beyond its town, as southern Italy's: terraced olive
// groves behind dry-stone walls where the slopes allow, maquis and rock
// elsewhere, and everything else grass the sun has bleached. Nobody goes
// there, so none of it plays; the ground's paint (ground.ts) and what's
// planted on it (client/greenery.ts) both read it from here, so the groves'
// earth lies under their olives.

/** Metres of height between one terrace and the next. */
export const TERRACE_RISE = 2.2;
/** Steepest a slope is terraced, as rise over run. */
const TERRACE_STEEPEST = 1.1;

/** How far (x, z) lies outside a map's bounds, metres: 0 inside, and inside always for a world without a map. */
export function beyondTown(world: World, x: number, z: number): number {
  if (!world.map) return 0;
  const b = world.bounds;
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
}

/** How steep the ground is at (x, z), as rise over run. */
export function slopeAt(world: World, x: number, z: number): number {
  const d = 2;
  const gx = (world.terrainHeight(x + d, z) - world.terrainHeight(x - d, z)) / (2 * d);
  const gz = (world.terrainHeight(x, z + d) - world.terrainHeight(x, z - d)) / (2 * d);
  return Math.hypot(gx, gz);
}

/**
 * How much (x, z) is terraced olive grove, 0 to 1: in broad patches of the
 * hillside, off the shore and below the bare tops, on slopes gentle enough
 * to terrace, and not right against the town.
 */
export function groveAt(world: World, x: number, z: number): number {
  if (!world.map) return 0;
  const away = smoothstep(4, 9, beyondTown(world, x, z));
  if (away <= 0) return 0;
  const y = world.terrainHeight(x, z);
  const patch = smoothstep(0.43, 0.5, fbm(x / 85, z / 85, world.seed + 201, 3));
  const height = smoothstep(3, 6, y) * smoothstep(52, 42, y);
  const slope = smoothstep(TERRACE_STEEPEST, TERRACE_STEEPEST * 0.8, slopeAt(world, x, z));
  return away * patch * height * slope;
}

/** How thick the maquis grows at (x, z), 0 to 1: in patches off the groves, thinning on the tops. */
export function maquisAt(world: World, x: number, z: number): number {
  if (!world.map) return 0;
  const away = smoothstep(2.5, 6, beyondTown(world, x, z));
  if (away <= 0) return 0;
  const y = world.terrainHeight(x, z);
  if (y < 1.2) return 0;
  const patch = smoothstep(0.38, 0.55, fbm(x / 45, z / 45, world.seed + 211, 3));
  return away * patch * smoothstep(70, 45, y) * (1 - groveAt(world, x, z));
}
