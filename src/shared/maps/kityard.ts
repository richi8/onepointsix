import { yawToward } from '../geom.ts';
import type { GameMap, MapSpawn } from './index.ts';

// A yard of the building kit's later pieces (chunk 56), to try them before
// the town is built from them: two houses under pitched roofs, a block round
// a courtyard, an arcade along the front of another, a hall with a storey
// 6 m tall under a pitched roof, a room bridging a lane at the height of the
// building beyond it, which stands on a terrace reached by a ramp, and every
// building plastered its own colour. Flat ground at 10 m, walled round.

/** The ground's level, and the floors of the buildings standing on it. */
const GROUND = 10;
const FLOOR = GROUND + 0.1;
/** The terrace's top, and the floor of the building standing on it. */
const TERRACE = GROUND + 3;

/** A spawn at (x, z), facing the middle of the yard. */
function spawn(x: number, z: number): MapSpawn {
  return { x, z, yaw: yawToward(x, z, 0, 0) };
}

export const KIT_YARD: GameMap = {
  id: 'kit-yard',
  name: 'Kit Yard',
  seed: 3,
  ground: { x0: -48, z0: -36, cell: 4, heights: Array.from({ length: 19 }, () => Array<number>(25).fill(GROUND)), blend: 30 },
  bounds: { minX: -40, minZ: -30, maxX: 40, maxZ: 30 },
  buildings: [
    // A house of two storeys under a roof pitched along its length.
    {
      floor: FLOOR,
      colour: 0xd9907a,
      blocks: [{
        minX: -36, minZ: -8, maxX: -26, maxZ: 4, storeys: 2, roof: 'pitched',
        openings: [
          { side: '+z', at: 5, kind: 'door' }, { side: '+z', at: 2, kind: 'window' }, { side: '+z', at: 8, kind: 'window' }, { side: '-x', at: 6, kind: 'window' },
          { side: '+z', at: 5, kind: 'window', storey: 1 }, { side: '-z', at: 5, kind: 'window', storey: 1 }, { side: '+x', at: 6, kind: 'window', storey: 1 },
        ],
      }],
      flights: [{ x: -34.6, z: -7.1, climbs: '+x', storey: 0 }],
      crates: [{ x: -27.5, z: 2.8, storey: 1 }],
    },
    // A cottage, its ridge across its square.
    {
      floor: FLOOR,
      colour: 0xf2efe6,
      blocks: [{
        minX: -36, minZ: 10, maxX: -28, maxZ: 18, storeys: 1, roof: 'pitched', ridge: 'x',
        openings: [{ side: '-z', at: 4, kind: 'door' }, { side: '+x', at: 4, kind: 'window' }, { side: '+z', at: 4, kind: 'window' }],
      }],
      crates: [{ x: -29.5, z: 16.5 }],
    },
    // Rooms round a courtyard, reached from the street through the south range.
    {
      floor: FLOOR,
      colour: 0xdba84a,
      blocks: [{
        minX: -20, minZ: -26, maxX: 4, maxZ: -4, storeys: 2, court: { minX: -12, minZ: -19, maxX: -4, maxZ: -11 },
        openings: [
          { side: '+z', at: 12, kind: 'arch' }, { side: '+z', at: 4, kind: 'window' }, { side: '+z', at: 20, kind: 'window' },
          { side: '+z', at: 4, kind: 'window', storey: 1 }, { side: '+z', at: 12, kind: 'window', storey: 1 }, { side: '+z', at: 20, kind: 'window', storey: 1 },
          { side: '-x', at: 11, kind: 'door' }, { side: '-x', at: 11, kind: 'window', storey: 1 },
          { side: '+x', at: 3, kind: 'window' }, { side: '+x', at: 18, kind: 'window' },
          { side: '+z', at: 4, kind: 'arch', court: true }, { side: '+x', at: 4, kind: 'door', court: true },
          { side: '-z', at: 4, kind: 'window', court: true }, { side: '-x', at: 4, kind: 'window', court: true },
          { side: '-z', at: 4, kind: 'window', court: true, storey: 1 }, { side: '+x', at: 4, kind: 'window', court: true, storey: 1 },
        ],
      }],
      flights: [{ x: -18.6, z: -25.1, climbs: '+x', storey: 0 }, { x: 3.1, z: -17.6, climbs: '+z', storey: 1 }],
      crates: [{ x: -1, z: -24.5 }, { x: -18.5, z: -13, storey: 1 }],
    },
    // Rooms behind an arcade, open at its ends too, the arcade's upper floor a room over it.
    {
      floor: FLOOR,
      colour: 0xe8d8b0,
      blocks: [
        {
          minX: 10, minZ: -26, maxX: 34, maxZ: -16, storeys: 2,
          openings: [
            { side: '+z', at: 6, kind: 'door' }, { side: '+z', at: 18, kind: 'door' }, { side: '-z', at: 12, kind: 'window' },
            { side: '+z', at: 12, kind: 'door', storey: 1 }, { side: '-z', at: 6, kind: 'window', storey: 1 }, { side: '-z', at: 18, kind: 'window', storey: 1 },
          ],
        },
        {
          minX: 10, minZ: -16, maxX: 34, maxZ: -11, storeys: 2, arcade: { side: '+z', bays: 5 },
          openings: [
            { side: '-x', at: 2.5, kind: 'arch', width: 3 }, { side: '+x', at: 2.5, kind: 'arch', width: 3 },
            { side: '+z', at: 3, kind: 'window', storey: 1 }, { side: '+z', at: 12, kind: 'window', storey: 1 }, { side: '+z', at: 21, kind: 'window', storey: 1 },
          ],
        },
      ],
      flights: [{ x: 11.4, z: -25.1, climbs: '+x', storey: 0 }, { x: 32.6, z: -25.1, climbs: '-x', storey: 1 }],
      crates: [{ x: 22, z: -25, storey: 1 }],
    },
    // A hall, its one storey 6 m tall, under a roof pitched along it.
    {
      floor: FLOOR,
      storey: 6,
      colour: 0xb4b39c,
      blocks: [{
        minX: 10, minZ: 0, maxX: 26, maxZ: 16, storeys: 1, roof: 'pitched', ridge: 'z',
        openings: [
          { side: '-x', at: 8, kind: 'door' }, { side: '-z', at: 8, kind: 'door' },
          { side: '+x', at: 4, kind: 'window' }, { side: '+x', at: 12, kind: 'window' }, { side: '-x', at: 3, kind: 'window' }, { side: '-x', at: 13, kind: 'window' },
        ],
      }],
      crates: [{ x: 24.5, z: 14.5 }],
    },
    // A house by the lane, its upper storey joined across it to the one on the terrace.
    {
      floor: FLOOR,
      colour: 0x8fa6b4,
      blocks: [{
        minX: 30, minZ: 2, maxX: 38, maxZ: 10, storeys: 2,
        openings: [
          { side: '-x', at: 4, kind: 'door' }, { side: '-z', at: 4, kind: 'window' }, { side: '+x', at: 4, kind: 'window' },
          { side: '-z', at: 4, kind: 'window', storey: 1 }, { side: '-x', at: 4, kind: 'window', storey: 1 },
        ],
      }],
      flights: [{ x: 36.6, z: 2.9, climbs: '-x', storey: 0 }],
    },
    // On the terrace, with the room over the lane on the lane's floor, a storey below its own.
    {
      floor: TERRACE + 0.1,
      colour: 0x9bb08a,
      blocks: [
        {
          minX: 30, minZ: 16, maxX: 38, maxZ: 26, storeys: 1,
          openings: [{ side: '-x', at: 5, kind: 'door' }, { side: '+z', at: 4, kind: 'window' }, { side: '-x', at: 2, kind: 'window' }],
        },
        {
          minX: 31, minZ: 10, maxX: 37, maxZ: 16, storeys: 2, from: 1, floor: FLOOR,
          openings: [
            { side: '-z', at: 3, kind: 'door', storey: 1 }, { side: '+z', at: 3, kind: 'door', storey: 1 },
            { side: '-x', at: 3, kind: 'window', storey: 1 }, { side: '+x', at: 3, kind: 'window', storey: 1 },
          ],
        },
      ],
      flights: [{ x: 37.1, z: 17.4, climbs: '+z', storey: 0 }],
    },
  ],
  walls: [
    { minX: -40.3, minZ: -30.3, maxX: 40.3, maxZ: -30, y0: GROUND - 0.5, y1: GROUND + 3 },
    { minX: -40.3, minZ: 30, maxX: 40.3, maxZ: 30.3, y0: GROUND - 0.5, y1: GROUND + 3 },
    { minX: -40.3, minZ: -30, maxX: -40, maxZ: 30, y0: GROUND - 0.5, y1: GROUND + 3 },
    { minX: 40, minZ: -30, maxX: 40.3, maxZ: 30, y0: GROUND - 0.5, y1: GROUND + 3 },
    // The terrace, its top walked.
    { minX: 14, minZ: 16, maxX: 40, maxZ: 30, y0: GROUND - 0.5, y1: TERRACE, walk: true },
  ],
  stairs: [],
  ramps: [{ minX: -6, minZ: 20, maxX: 14, maxZ: 26, climbs: '+x', y0: GROUND, y1: TERRACE }],
  props: [
    { kind: 'crate', x: 6, z: -2, size: 1.2 },
    { kind: 'crate', x: -8, z: -15, size: 1.4 },
  ],
  spawns: [
    spawn(-37, -26), spawn(37, -6), spawn(-37, 26), spawn(0, 12),
    spawn(-12, 28), spawn(-15, 5), spawn(6, 5), spawn(28, -6),
  ],
};
