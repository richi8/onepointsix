import { WATER_LEVEL } from '../shared/constants.ts';
import type { World } from '../shared/world.ts';

// How the island shapes what you hear: walls and hills between you and a
// sound muffle it, walls around you make it ring, and the sea and the trees
// are only heard where they are.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Sounds at their source are raised this far off the ground, so a footfall isn't hidden by the ground it's on. */
const SOURCE_LIFT = 0.4;
/** How much higher a sound can go round an obstacle, over its top. */
const OVER_THE_TOP = 2.5;
/** Past this, sounds are only checked along the straight line. */
const DETOUR_RANGE = 250;

/**
 * How much lies between the ear and a sound: 0 when the way is clear, 0.5
 * when it's blocked but the sound gets over the top (a wall, a crate), and 1
 * when it doesn't (a building, a hill).
 */
export function occlusion(world: World, ear: Point3, at: Point3): number {
  const ay = Math.max(at.y, world.terrainHeight(at.x, at.z) + SOURCE_LIFT);
  if (clear(world, ear.x, ear.y, ear.z, at.x, ay, at.z)) return 0;
  const d = Math.hypot(at.x - ear.x, at.z - ear.z);
  if (d > DETOUR_RANGE) return 1;
  return clear(world, ear.x, ear.y + OVER_THE_TOP, ear.z, at.x, ay + OVER_THE_TOP, at.z) ? 0.5 : 1;
}

function clear(world: World, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return true;
  // Stop just short, so what the sound comes from doesn't hide it.
  return world.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.3) >= d - 0.35;
}

/** Rays for how enclosed the ear is, round the horizon. */
const ENCLOSURE_RAYS = 12;
/** Walls further than this don't make a place ring. */
const ENCLOSURE_RANGE = 30;

/** A roof within this far overhead makes a room of the walls round the ear. */
const ROOF_RANGE = 12;
/** Share of the ringing left under the open sky: a walled yard echoes a little, but doesn't ring like a room. */
const OPEN_SKY = 0.3;

/**
 * How closed in the ear is, from 0 in the open to 1 boxed in on every side:
 * each way round counts by how near the first wall, hill or tree is. Walls
 * with only sky above them count for much less than a room's.
 */
export function enclosure(world: World, ear: Point3): number {
  let sum = 0;
  for (let i = 0; i < ENCLOSURE_RAYS; i++) {
    const a = (i / ENCLOSURE_RAYS) * Math.PI * 2;
    const t = world.raycast(ear.x, ear.y, ear.z, Math.sin(a), 0, Math.cos(a), ENCLOSURE_RANGE);
    if (t < ENCLOSURE_RANGE) sum += 1 - t / ENCLOSURE_RANGE;
  }
  const roofed = world.raycast(ear.x, ear.y, ear.z, 0, 1, 0, ROOF_RANGE) < ROOF_RANGE;
  return (sum / ENCLOSURE_RAYS) * (roofed ? 1 : OPEN_SKY);
}

const SHORE_DIRECTIONS = 16;
const SHORE_RADII = [6, 12, 24, 40, 64, 100, 150, 220];

/** The nearest open water found round (x, z), or null when there's none within about 220 m. */
export function nearestWater(world: World, x: number, z: number): { x: number; z: number; dist: number } | null {
  if (world.terrainHeight(x, z) < WATER_LEVEL) return { x, z, dist: 0 };
  for (const r of SHORE_RADII) {
    // Averaged over the directions that find water, for a steady bearing.
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let i = 0; i < SHORE_DIRECTIONS; i++) {
      const a = (i / SHORE_DIRECTIONS) * Math.PI * 2;
      const wx = x + Math.sin(a) * r;
      const wz = z + Math.cos(a) * r;
      if (world.terrainHeight(wx, wz) >= WATER_LEVEL) continue;
      sx += wx;
      sz += wz;
      n++;
    }
    if (n) return { x: sx / n, z: sz / n, dist: r };
  }
  return null;
}

/** Trees within this many metres count toward the birdsong. */
const TREE_RANGE = 40;

/** How wooded it is round (x, z), from 0 with no trees near to 1 in a wood. */
export function woodland(world: World, x: number, z: number): number {
  let n = 0;
  for (const t of world.trees) {
    const dx = t.x - x;
    const dz = t.z - z;
    if (dx * dx + dz * dz < TREE_RANGE * TREE_RANGE) n++;
  }
  return Math.min(n / 12, 1);
}
