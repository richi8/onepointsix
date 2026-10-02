import { WATER_LEVEL } from '../shared/constants.ts';
import type { Collider, PanelKind, World } from '../shared/world.ts';
import type { SoundField } from './soundfield.ts';

// How the island shapes what you hear: a sound reaches the ear through
// whatever lies between, over the top of it, or round it through a doorway or
// a corner, whichever is loudest. The space round a sound and round the ear
// make it ring like a room, a walled yard or the open, and the sea and the
// trees are only heard where they are.

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
 * How much each metre of a thing dulls sound passing through it, as the
 * exponent of what gets through: a masonry wall 0.3 m thick lets under a
 * tenth through, a thin door or fence two thirds, a pane of glass a third,
 * a tree trunk more still.
 */
const THROUGH: Record<PanelKind, number> = { wall: 9, roof: 9, door: 6, fence: 4, crate: 1.2, glass: 40, floor: 9, timber: 3 };
/** Trunks are thin cylinders, rocks thick ones. */
const TRUNK_LOSS = 0.5;
const ROCK_LOSS = 2;
/** Cylinders thinner than this are trunks. */
const TRUNK_RADIUS = 0.7;
/** Anything else solid: floors, stairs and the like. */
const SOLID_LOSS = 3;
/** Each metre of hill in the way. */
const GROUND_LOSS = 0.6;
/** Metres between checks of the ground along the way. */
const GROUND_STEP = 1;
/** A sound that gets over the top is this muffled. */
const OVER = 0.5;
/**
 * How muffled a sound is by one bend on its way round: a little for a slight
 * turn, a third for a right angle.
 */
const BEND = 0.1;
const RIGHT_ANGLE_BEND = 0.25;
/** Metres over which a sound drops to half; for choosing the loudest way. */
const HALF = 40;

/** How a sound reaches the ear. */
export interface Heard {
  /** How muffled, from 0 when the way is clear to 1 when nothing gets through. */
  occ: number;
  /** Metres it travels. */
  d: number;
  /** Where it seems to come from: itself, or the corner it comes round. */
  x: number;
  y: number;
  z: number;
}

/**
 * How a sound at `at` reaches the ear: straight through what's in between,
 * over the top of it, or, with a sound field, round it, whichever is the
 * loudest.
 */
export function hear(world: World, field: SoundField | null, ear: Point3, at: Point3): Heard {
  const ay = Math.max(at.y, world.terrainHeight(at.x, at.z) + SOURCE_LIFT);
  const d = Math.hypot(at.x - ear.x, ay - ear.y, at.z - ear.z);
  const best: Heard = { occ: through(world, ear.x, ear.y, ear.z, at.x, ay, at.z), d, x: at.x, y: at.y, z: at.z };
  if (best.occ <= 0.05) return best;
  // Over the top, if neither end has a roof over it.
  if (best.occ > OVER && Math.hypot(at.x - ear.x, at.z - ear.z) <= DETOUR_RANGE
    && clear(world, ear.x, ear.y + OVER_THE_TOP, ear.z, at.x, ay + OVER_THE_TOP, at.z)
    && roofed(world, ear.x, ear.y, ear.z) < 0.5 && roofed(world, at.x, ay, at.z) < 0.5) best.occ = OVER;
  const route = field?.route(ear, at);
  if (!route) return best;
  // Every leg of the way must be open in the air too: on the ground, the field is flat and doesn't know about hills.
  const points = [ear, ...route.corners, { x: at.x, y: ay, z: at.z }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!clear(world, a.x, a.y, a.z, b.x, b.y, b.z)) return best;
  }
  let open = 1;
  for (const turn of route.turns) open *= 1 - (BEND + RIGHT_ANGLE_BEND * Math.min(turn / (Math.PI / 2), 1));
  const occ = 1 - open;
  const length = Math.hypot(route.length, ay - ear.y);
  if (loudness(occ, length) <= loudness(best.occ, d)) return best;
  const c = points[1];
  return { occ, d: length, x: c.x, y: c.y, z: c.z };
}

/** Roughly how loud a sound arrives, for choosing between ways: quieter with distance and muffling. */
function loudness(occ: number, d: number): number {
  return (1 - occ * 0.5) * (HALF / (HALF + d));
}

/**
 * How much lies between the ear and a sound, going straight through or over
 * the top: 0 when the way is clear, 0.5 when it's blocked but the sound gets
 * over the top (a wall, a crate), and more when it doesn't: most for a
 * building or a hill, less for a door or a tree trunk.
 */
export function occlusion(world: World, ear: Point3, at: Point3): number {
  return hear(world, null, ear, at).occ;
}

/**
 * How muffled a sound is going straight through everything between a and b,
 * 0 to 1: each thing counts by what it's made of and how thick it is where
 * the line crosses it, and hills by how much ground is in the way.
 */
export function through(world: World, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return 0;
  // Stop just short, so what the sound comes from doesn't hide it.
  const reach = len - 0.3;
  let loss = 0;
  world.collidersAlong(ax, ay, az, dx / len, dy / len, dz / len, reach, (c, inside) => (loss += inside * lossOf(world, c)));
  const steps = Math.floor(reach / GROUND_STEP);
  for (let i = 1; i <= steps; i++) {
    const f = (i * GROUND_STEP) / len;
    if (ay + dy * f < world.terrainHeight(ax + dx * f, az + dz * f)) loss += GROUND_LOSS * GROUND_STEP;
  }
  return 1 - Math.exp(-loss);
}

function lossOf(world: World, c: Collider): number {
  if (c.kind === 'cyl') return c.r < TRUNK_RADIUS ? TRUNK_LOSS : ROCK_LOSS;
  if (c.panel !== undefined) return THROUGH[world.panels[c.panel].kind];
  return c.clear ? THROUGH.glass : SOLID_LOSS;
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

/** Rays round the horizon for how walled in a place is: many round the ear, fewer round a sound. */
const EAR_RAYS = 12;
const SOURCE_RAYS = 6;
/** Walls further than this don't make a place ring. */
const ENCLOSURE_RANGE = 30;

/** A roof within this far overhead makes a room of the walls round the ear. */
const ROOF_RANGE = 12;
/**
 * The rays looking for a roof: straight up, and round it tilted this far
 * from upright, so a branch or an overhang covers only part of the sky.
 */
const ROOF_RAYS = 6;
const ROOF_TILT = 0.5;
/** Share of the ringing left under the open sky: a walled yard echoes a little, but doesn't ring like a room. */
const OPEN_SKY = 0.3;

/**
 * The kind of space round a point, as shares that add up to 1: a room (walls
 * with a roof over them), a walled yard (walls under the open sky) or the
 * open. `walls` is how closed in it is, from 0 in the open to 1 boxed in.
 */
export interface Space {
  room: number;
  yard: number;
  open: number;
  walls: number;
}

/**
 * The space round `p`: each way round counts by how near the first wall,
 * hill or tree is, and rays up say how much of the sky is roofed over.
 */
export function space(world: World, p: Point3, rays = EAR_RAYS): Space {
  let sum = 0;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const t = world.raycast(p.x, p.y, p.z, Math.sin(a), 0, Math.cos(a), ENCLOSURE_RANGE);
    if (t < ENCLOSURE_RANGE) sum += 1 - t / ENCLOSURE_RANGE;
  }
  const walls = sum / rays;
  const roof = roofed(world, p.x, p.y, p.z);
  return { room: roof * walls, yard: (1 - roof) * walls, open: 1 - walls, walls };
}

/** How much of the sky over (x, y, z) a roof, or anything else, covers within ROOF_RANGE: 0 to 1. */
export function roofed(world: World, x: number, y: number, z: number): number {
  let hits = world.raycast(x, y, z, 0, 1, 0, ROOF_RANGE) < ROOF_RANGE ? 1 : 0;
  const s = Math.sin(ROOF_TILT);
  const c = Math.cos(ROOF_TILT);
  for (let i = 0; i < ROOF_RAYS - 1; i++) {
    const a = (i / (ROOF_RAYS - 1)) * Math.PI * 2;
    if (world.raycast(x, y, z, Math.sin(a) * s, c, Math.cos(a) * s, ROOF_RANGE) < ROOF_RANGE) hits++;
  }
  return hits / ROOF_RAYS;
}

/** The space round a sound, from fewer rays. */
export function sourceSpace(world: World, p: Point3): Space {
  return space(world, { x: p.x, y: Math.max(p.y, world.terrainHeight(p.x, p.z) + 1), z: p.z }, SOURCE_RAYS);
}

/**
 * How closed in the ear is, from 0 in the open to 1 boxed in on every side,
 * for how much the wind and the rain get in. Walls with only sky above them
 * count for much less than a room's.
 */
export function enclosure(world: World, ear: Point3, s = space(world, ear)): number {
  return s.room + s.yard * OPEN_SKY;
}

const SHORE_DIRECTIONS = 16;
const SHORE_RADII = [6, 12, 24, 40, 64, 100, 150, 220];

/**
 * The nearest open water round (x, z), or null when there's none within about
 * 220 m: at the nearest radius where any direction finds water, the middle of
 * the widest run of neighbouring directions that do, so it lies on the water
 * even with sea on both sides of a narrow point.
 */
export function nearestWater(world: World, x: number, z: number): { x: number; z: number; dist: number } | null {
  if (world.terrainHeight(x, z) < WATER_LEVEL) return { x, z, dist: 0 };
  const wet: boolean[] = [];
  for (const r of SHORE_RADII) {
    let any = false;
    for (let i = 0; i < SHORE_DIRECTIONS; i++) {
      const a = (i / SHORE_DIRECTIONS) * Math.PI * 2;
      wet[i] = world.terrainHeight(x + Math.sin(a) * r, z + Math.cos(a) * r) < WATER_LEVEL;
      any ||= wet[i];
    }
    if (!any) continue;
    // Runs of wet directions round the circle, each from a wet one after a dry one; the widest wins.
    const N = SHORE_DIRECTIONS;
    let bestStart = 0;
    let bestLength = N;
    if (wet.includes(false)) {
      bestLength = 0;
      for (let i = 0; i < N; i++) {
        if (!wet[i] || wet[(i + N - 1) % N]) continue;
        let n = 0;
        while (wet[(i + n) % N]) n++;
        if (n > bestLength) (bestStart = i), (bestLength = n);
      }
    }
    const a = ((bestStart + (bestLength - 1) / 2) / SHORE_DIRECTIONS) * Math.PI * 2;
    return { x: x + Math.sin(a) * r, z: z + Math.cos(a) * r, dist: r };
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
