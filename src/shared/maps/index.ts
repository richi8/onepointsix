import type { Mode } from '../protocol.ts';
import type { Plan, Rect } from '../world.ts';
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

/**
 * A building, until the building kit: one of the island's plans with its
 * size given. Its footprint starts at (x, z), its length `L` along x for a
 * front facing ±z and along z for one facing ±x, and `D` deep; an L's wing is
 * `W` wide and juts `E` out in front. With `flip`, its plan runs the other way
 * along its front. Its floor is at `floor`, `crates` crates in its rooms.
 */
export interface MapBuilding {
  plan: Plan;
  x: number;
  z: number;
  L: number;
  D: number;
  W?: number;
  E?: number;
  facing: Facing;
  flip?: boolean;
  floor: number;
  crates?: number;
}

/** A solid box from `y0` up to `y1`: a freestanding wall. */
export interface MapBox extends Rect {
  y0: number;
  y1: number;
}

/**
 * A flight of steps `width` wide, its foot's middle at (x, z) on the ground
 * at `y0`, climbing toward `climbs` to `y1`, where it ends.
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
