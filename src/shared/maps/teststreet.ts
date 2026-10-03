import { yawToward } from '../geom.ts';
import type { GameMap, MapSpawn } from './index.ts';

// A first map, to try the format on: one street running east and west, a
// two-storey house on its north side and a two-room one on its south, with
// an outside stair up to the south one's roof, yards behind both, and walls
// all round. Played on until the town is built.

/** The ground's level along the street. */
const STREET = 16;

/** A spawn at (x, z), facing the middle of the street. */
function spawn(x: number, z: number): MapSpawn {
  return { x, z, yaw: yawToward(x, z, 0, 0) };
}

export const TEST_STREET: GameMap = {
  id: 'test-street',
  name: 'Test Street',
  seed: 3,
  ground: {
    x0: -32,
    z0: -24,
    cell: 4,
    // A row every 4 m from the north: the hillside behind the north yard, the street, and the south yard falling away.
    heights: [
      [18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5, 18.5],
      [17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5, 17.5],
      [16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5, 16.5],
      ...Array.from({ length: 8 }, () => Array<number>(17).fill(STREET)),
      [15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5],
      [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15],
    ],
    blend: 30,
  },
  bounds: { minX: -28, minZ: -18, maxX: 28, maxZ: 18 },
  buildings: [
    { plan: 'tall', x: -14, z: -10.5, L: 8, D: 6.5, facing: '+z', floor: STREET + 0.1, crates: 2 },
    { plan: 'two', x: 4, z: 4, L: 11, D: 7, facing: '-z', flip: true, floor: STREET + 0.1, crates: 2 },
  ],
  walls: [
    { minX: -28.3, minZ: -18.3, maxX: 28.3, maxZ: -18, y0: STREET - 0.5, y1: STREET + 3 },
    { minX: -28.3, minZ: 18, maxX: 28.3, maxZ: 18.3, y0: STREET - 0.5, y1: STREET + 3 },
    { minX: -28.3, minZ: -18, maxX: -28, maxZ: 18, y0: STREET - 0.5, y1: STREET + 3 },
    { minX: 28, minZ: -18, maxX: 28.3, maxZ: 18, y0: STREET - 0.5, y1: STREET + 3 },
  ],
  stairs: [{ x: 16.05, z: 11, width: 1.5, climbs: '-z', y0: STREET, y1: STREET + 3.3 }],
  props: [
    { kind: 'crate', x: 0, z: 0.5, size: 1.4 },
    { kind: 'crate', x: 0.1, z: 0.4, size: 1.1, on: 0 },
    { kind: 'crate', x: -21, z: -2, size: 1.2 },
    { kind: 'crate', x: 21, z: 2.5, size: 1.4 },
    { kind: 'crate', x: -4, z: 14, size: 1.2 },
    { kind: 'container', minX: 2, minZ: -15.5, maxX: 8, maxZ: -13.1 },
  ],
  spawns: [
    spawn(-25, -15), spawn(25, -15), spawn(-25, 15), spawn(25, 15),
    spawn(-25, 0), spawn(25, 0), spawn(-4, -15), spawn(12, -15),
    spawn(0, 15), spawn(-14, 14),
  ],
};
