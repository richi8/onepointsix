import type { Mode } from '../protocol.ts';
import type { Rect } from '../world.ts';
import { CALABIANCA } from './calabianca.ts';

// A fixed map: the ground, buildings and everything else a mode is played on,
// laid out by hand, one typed file per map in this folder. The World is built
// from it on the server and on every client alike. Everything is in the
// world's own metres: x east, z south, y up, with the sea at 0.

/** Which way something faces, or runs: its front, or the way a stair climbs. */
export type Facing = '-x' | '+x' | '-z' | '+z';

/**
 * The ground, shaped by hand: heights in metres on a grid `cell` metres
 * apart, row by row from `z0` southward and each row from `x0` eastward, so
 * `heights[r][c]` stands at (x0 + c × cell, z0 + r × cell). Between points it
 * runs straight. Beyond the grid it slopes over `blend` metres into the
 * backdrop: the island the map's seed would make, drawn but not played on.
 */
export interface MapGround {
  x0: number;
  z0: number;
  cell: number;
  heights: readonly (readonly number[])[];
  blend: number;
}

/** What fills a gap in a wall: a doorway hung with a pair of leaves, a glazed window, or an archway with nothing in it. */
export type OpeningKind = 'door' | 'window' | 'arch';

/**
 * A gap in one of a block's walls, on storey `storey` (0, the ground's, if
 * left out), its middle `at` metres along the wall's line from the block's
 * corner with the lesser x or z. A door is 2.2 m wide, a window 1.2 and an
 * arch 2.4, unless `width` says otherwise; an arch reaches `height` above its
 * floor, 2.6 m if left out, and the full storey at 3. On a wall shared with
 * the next block, either block's openings go through it, and a door's leaves
 * swing into the block that has it.
 */
export interface MapOpening {
  side: Facing;
  /** On the block's courtyard's wall on that side, not its outside's. */
  court?: boolean;
  at: number;
  kind: OpeningKind;
  storey?: number;
  width?: number;
  height?: number;
}

/**
 * A balcony off a block's wall on `storey` (1 or more): a slab `width` wide
 * and `depth` deep, its middle `at` along the wall as an opening's, railed
 * round. A door or an arch onto it is an opening of its own.
 */
export interface MapBalcony {
  side: Facing;
  storey: number;
  at: number;
  width: number;
  depth: number;
}

/**
 * A ground storey open on one side between pillars: `bays` arches 2.6 m
 * high across the whole side, `pillar` metres wide between them and at the
 * corners (0.6 if left out).
 */
export interface MapArcade {
  side: Facing;
  bays: number;
  pillar?: number;
}

/**
 * One rectangle of a building, its walls standing on its edges (the
 * rectangle runs along their middles, so a block beside it shares the wall),
 * `storeys` storeys of its building's storey height (3 m unless it says
 * otherwise) under a roof. The roof is flat, walked and railed round by a
 * parapet; or `pitched`, tiled and out of reach, its ridge along `ridge`
 * (the longer side if left out), its gable ends over the other two walls.
 * With `from`, the storeys below that one are left open: a passage under it,
 * walled by the blocks either side. `floor` stands it on a floor of its own,
 * not its building's: a room over a lane at whatever height it needs.
 * With `court`, a rectangle inside it is left open to the sky, a courtyard,
 * walled round as the block's outside is; its walls' openings are given as
 * the block's, with `court` set, `at` from the courtyard's corner. The
 * rooms round it are joined on every storey by archways at their corners.
 */
export interface MapBlock extends Rect {
  storeys: number;
  from?: number;
  floor?: number;
  roof?: 'flat' | 'pitched';
  ridge?: 'x' | 'z';
  court?: Rect;
  arcade?: MapArcade;
  openings?: MapOpening[];
  balconies?: MapBalcony[];
}

/**
 * A flight of stairs inside a building, from storey `storey`'s floor up to
 * the next one's, or from a block's top storey through a hatch onto its roof:
 * its foot's middle at (x, z), on the floor where it starts, climbing toward
 * `climbs`, `width` wide (1.5 m if left out). The floor above has a hole over
 * it, railed along its open side up to its last steps, where it's stepped off.
 */
export interface MapFlight {
  x: number;
  z: number;
  climbs: Facing;
  storey: number;
  width?: number;
}

/** A crate inside a building, its middle at (x, z) on storey `storey`'s floor (0 if left out), `size` a side (1.1 m if left out). */
export interface MapCrate {
  x: number;
  z: number;
  storey?: number;
  size?: number;
}

/**
 * A building: blocks side by side on one ground floor, at `floor`, joined by
 * their shared walls' openings, with flights of stairs between their storeys
 * and crates in their rooms. Blocks of one building and the next share walls
 * just the same. Its storeys are `storey` metres floor to floor (3 if left
 * out: taller for a church), and its walls are plastered `colour` (a plain
 * grey if left out).
 */
export interface MapBuilding {
  floor: number;
  storey?: number;
  colour?: number;
  blocks: MapBlock[];
  flights?: MapFlight[];
  crates?: MapCrate[];
}

/**
 * A solid box from `y0` up to `y1`: a freestanding wall, or with `walk` a
 * terrace's edge, its top a floor walked on: the ground falling a level is
 * hidden under it.
 */
export interface MapBox extends Rect {
  y0: number;
  y1: number;
  walk?: boolean;
}

/**
 * A flight of steps outside, `width` wide, its foot's middle at (x, z) on
 * the ground at `y0`, climbing toward `climbs` to `y1`, where it ends. Coming
 * up beside a roof as high, it opens the roof's parapet round its top steps.
 */
export interface MapStair {
  x: number;
  z: number;
  width: number;
  climbs: Facing;
  y0: number;
  y1: number;
}

/**
 * A ramp: the rectangle's ground made a walked slope, from `y0` at its foot
 * up toward `climbs` to `y1` at its head, in steps too low to notice, filled
 * solid down to the ground: a road climbing where the terrain's 4 m grid
 * can't, with a face of its own over lower ground beside it.
 */
export interface MapRamp extends Rect {
  climbs: Facing;
  y0: number;
  y1: number;
}

/**
 * A crate `size` metres a side, its middle at (x, z), on the ground, or on
 * the crate `on` (its index in the map's props); or a shipping container
 * over the rectangle.
 */
export type MapProp =
  | { kind: 'crate'; x: number; z: number; size: number; on?: number }
  | ({ kind: 'container' } & Rect);

/** Where an operator comes into the game, on the ground, looking toward `yaw` (as yawToward() has it). */
export interface MapSpawn {
  x: number;
  z: number;
  yaw: number;
}

/** A street or lane as drawn on the dev view of a map from above (dev/map.html): it plays no part in the game. */
export interface MapLane {
  name: string;
  points: readonly (readonly [number, number])[];
}

export interface GameMap {
  /** Its key: the menu's board of games on it is kept under it. */
  id: string;
  name: string;
  /** The backdrop island, and the noise everything is drawn with (the grass, the rocks' faces), come from this. */
  seed: number;
  ground: MapGround;
  /** Where the game is played: nobody goes beyond it. */
  bounds: Rect;
  buildings: MapBuilding[];
  walls: MapBox[];
  stairs: MapStair[];
  ramps?: MapRamp[];
  props: MapProp[];
  spawns: MapSpawn[];
  /** Its lanes and streets, for the dev view. */
  lanes?: MapLane[];
}

/** The fixed map a mode is played on, or null for the island made from the game's seed. */
export function mapFor(mode: Mode): GameMap | null {
  return mode === 'deathmatch' ? CALABIANCA : null;
}

/**
 * A map laid out round (0, 0) moved `dx` east and `dz` south: to stand it on
 * the backdrop island where its seed has the ground it wants round it.
 */
export function moved(map: GameMap, dx: number, dz: number): GameMap {
  const rect = <T extends Rect>(r: T): T => ({ ...r, minX: r.minX + dx, maxX: r.maxX + dx, minZ: r.minZ + dz, maxZ: r.maxZ + dz });
  const at = <T extends { x: number; z: number }>(p: T): T => ({ ...p, x: p.x + dx, z: p.z + dz });
  return {
    ...map,
    ground: { ...map.ground, x0: map.ground.x0 + dx, z0: map.ground.z0 + dz },
    bounds: rect(map.bounds),
    buildings: map.buildings.map((b) => ({
      ...b,
      blocks: b.blocks.map((k) => ({ ...rect(k), ...(k.court ? { court: rect(k.court) } : {}) })),
      flights: b.flights?.map(at),
      crates: b.crates?.map(at),
    })),
    walls: map.walls.map(rect),
    stairs: map.stairs.map(at),
    ramps: map.ramps?.map(rect),
    props: map.props.map((p) => (p.kind === 'crate' ? at(p) : rect(p))),
    spawns: map.spawns.map(at),
    lanes: map.lanes?.map((l) => ({ ...l, points: l.points.map(([x, z]) => [x + dx, z + dz] as const) })),
  };
}
