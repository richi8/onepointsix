import { yawToward } from '../geom.ts';
import type { GameMap, MapSpawn } from './index.ts';

// A first map, to try the format and the building kit on: one street
// running east and west, yards behind both sides, and walls all round. On its
// north side a row of four buildings sharing their walls: a two-storey house
// with a balcony and a hatch onto its roof, a three-storey one with a room
// over a passage to the yard beside it, and a one-storey one whose roof is
// reached from that room. On its south side a two-room house with an outside
// stair up to its roof, and a two-storey one with a balcony over the street,
// an arched way through to its yard and a hatch onto its roof. Played on
// until the town is built.

/** The ground's level along the street, and the buildings' floors. */
const STREET = 16;
const FLOOR = STREET + 0.1;

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
    // North side, its fronts on z = -4.
    {
      floor: FLOOR,
      blocks: [{
        minX: -22, minZ: -11, maxX: -14, maxZ: -4, storeys: 2,
        openings: [
          { side: '+z', at: 4, kind: 'door' }, { side: '+z', at: 1.5, kind: 'window' }, { side: '+z', at: 6.5, kind: 'window' },
          { side: '-z', at: 4, kind: 'window' }, { side: '-x', at: 3.5, kind: 'window' },
          { side: '-x', at: 3.5, kind: 'door', storey: 1 }, { side: '+z', at: 1.5, kind: 'window', storey: 1 }, { side: '-z', at: 2, kind: 'window', storey: 1 },
        ],
        balconies: [{ side: '-x', storey: 1, at: 3.5, width: 3, depth: 1.4 }],
      }],
      flights: [{ x: -20.6, z: -10.1, climbs: '+x', storey: 0 }, { x: -15.4, z: -4.9, climbs: '-x', storey: 1 }],
      crates: [{ x: -21.2, z: -5, storey: 1 }],
    },
    {
      floor: FLOOR,
      blocks: [
        {
          minX: -14, minZ: -11, maxX: -6, maxZ: -4, storeys: 3,
          openings: [
            { side: '+z', at: 4, kind: 'door' }, { side: '+z', at: 1.5, kind: 'window' }, { side: '+z', at: 6.5, kind: 'window' }, { side: '-z', at: 1.5, kind: 'window' },
            { side: '+x', at: 3, kind: 'door', storey: 1 }, { side: '+z', at: 1.5, kind: 'window', storey: 1 }, { side: '-z', at: 6.5, kind: 'window', storey: 1 },
            { side: '-x', at: 2.5, kind: 'door', storey: 2 }, { side: '+x', at: 3.5, kind: 'door', storey: 2 },
            { side: '+z', at: 1.5, kind: 'window', storey: 2 }, { side: '+z', at: 6.5, kind: 'window', storey: 2 }, { side: '-z', at: 4, kind: 'window', storey: 2 },
          ],
        },
        // A room over the passage to the north yard.
        {
          minX: -6, minZ: -11, maxX: -2, maxZ: -4, storeys: 2, from: 1,
          openings: [
            { side: '+x', at: 3.5, kind: 'door', storey: 1 }, { side: '+z', at: 2, kind: 'window', storey: 1 }, { side: '-z', at: 2, kind: 'window', storey: 1 },
          ],
        },
      ],
      flights: [
        { x: -12.6, z: -10.1, climbs: '+x', storey: 0 },
        { x: -7.4, z: -4.9, climbs: '-x', storey: 1 },
        { x: -7.4, z: -10.1, climbs: '-x', storey: 2 },
      ],
      crates: [{ x: -13.2, z: -6.5, storey: 2 }],
    },
    {
      floor: FLOOR,
      blocks: [{
        minX: -2, minZ: -11, maxX: 6, maxZ: -4, storeys: 1,
        openings: [
          { side: '+z', at: 4, kind: 'door' }, { side: '-z', at: 5.5, kind: 'door' },
          { side: '+z', at: 1.5, kind: 'window' }, { side: '+z', at: 6.6, kind: 'window' }, { side: '+x', at: 3.5, kind: 'window' },
        ],
      }],
      crates: [{ x: -1, z: -10 }],
    },
    // South side, its fronts on z = 4.
    {
      floor: FLOOR,
      blocks: [
        {
          minX: 4, minZ: 4, maxX: 9.5, maxZ: 11, storeys: 1,
          openings: [
            { side: '-z', at: 2.75, kind: 'door' }, { side: '+x', at: 3.5, kind: 'door' },
            { side: '-x', at: 3.5, kind: 'window' }, { side: '+z', at: 2.75, kind: 'window' },
          ],
        },
        {
          minX: 9.5, minZ: 4, maxX: 15, maxZ: 11, storeys: 1,
          openings: [{ side: '+z', at: 2.75, kind: 'door' }, { side: '-z', at: 2.75, kind: 'window' }, { side: '+x', at: 2, kind: 'window' }],
        },
      ],
      crates: [{ x: 14.2, z: 9.9 }],
    },
    {
      floor: FLOOR,
      blocks: [
        {
          minX: -16, minZ: 4, maxX: -6, maxZ: 10, storeys: 2,
          openings: [
            { side: '-z', at: 7, kind: 'door' }, { side: '-z', at: 2, kind: 'window' }, { side: '-z', at: 4.5, kind: 'window' },
            { side: '-x', at: 3, kind: 'window' }, { side: '+z', at: 2, kind: 'window' },
            { side: '-z', at: 4, kind: 'door', storey: 1 }, { side: '-z', at: 8, kind: 'window', storey: 1 },
            { side: '-x', at: 3, kind: 'window', storey: 1 }, { side: '+z', at: 2, kind: 'window', storey: 1 },
          ],
          balconies: [{ side: '-z', storey: 1, at: 4, width: 3.2, depth: 1.4 }],
        },
        // An arched way through to the south yard, a room over it.
        {
          minX: -6, minZ: 4, maxX: -2, maxZ: 10, storeys: 2,
          openings: [
            { side: '-z', at: 2, kind: 'arch' }, { side: '+z', at: 2, kind: 'arch' },
            { side: '-x', at: 3, kind: 'door', storey: 1 }, { side: '-z', at: 2, kind: 'window', storey: 1 },
          ],
        },
      ],
      flights: [{ x: -8.5, z: 9.1, climbs: '-x', storey: 0 }, { x: -2.9, z: 5.35, climbs: '+z', storey: 1 }],
      crates: [{ x: -15.2, z: 9.2 }],
    },
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
