import type { Mode } from '../protocol.ts';
import type { Rect } from '../world.ts';
import { TEST_STREET } from './teststreet.ts';

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
 * One rectangle of a building, its walls standing on its edges (the
 * rectangle runs along their middles, so a block beside it shares the wall),
 * `storeys` storeys of 3 m high under a flat roof railed round by a parapet.
 * With `from`, the storeys below that one are left open: a passage under it,
 * walled by the blocks either side.
 */
export interface MapBlock extends Rect {
  storeys: number;
  from?: number;
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
 * just the same.
 */
export interface MapBuilding {
  floor: number;
  blocks: MapBlock[];
  flights?: MapFlight[];
  crates?: MapCrate[];
}

/** A solid box from `y0` up to `y1`: a freestanding wall. */
export interface MapBox extends Rect {
  y0: number;
  y1: number;
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
  props: MapProp[];
  spawns: MapSpawn[];
}

/** The fixed map a mode is played on, or null for the island made from the game's seed. */
export function mapFor(mode: Mode): GameMap | null {
  return mode === 'deathmatch' ? TEST_STREET : null;
}
