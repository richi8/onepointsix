import { yawToward } from '../geom.ts';
import type { Rect } from '../world.ts';
import { moved, type Facing, type GameMap, type MapBlock, type MapBox, type MapBuilding, type MapCrate, type MapFlight, type MapOpening, type MapPlant, type MapProp, type MapRamp, type MapSign, type MapSpawn, type MapStair, type MapTrim } from './index.ts';
import { levelGround, type Level } from './levels.ts';

// Calabianca: a whitewashed town on a hillside above the sea, Deathmatch's
// map, built from its sketch (dev/townsketch.ts). It falls from the high
// street at the back (north) to the quay at the sea (south), and its fights
// turn round three hubs: the market low in the middle, with a crashed truck,
// stalls and an arcaded loggia; the piazza above it, in front of the church
// and its bell tower, joined to the market by a grand stair; and the
// palazzo's courtyard to the east. Each pair is joined by an open way, a
// tight one and one through a building.
//
// Round them, districts that play and look different. The west: narrow tall
// houses on steep stepped alleys, with rooms over two of them. The quay: the
// harbour front, split by the warehouse, with the boat yard at its west end
// and the fish market at its east. The east: a road climbing from the quay
// in three legs, its hairpins round a row of cottages and the olive garden,
// up to the palazzo. The top: the high street, the cemetery and its ruined
// chapel, and the villa by the water tower. Each district climbs its own
// way: many short flights, the grand stair, the road's ramps.
//
// The ground is drawn as levels (see levels.ts), the terrain topped up to
// them by walked terraces. Laid out round (0, 0) and moved onto the south
// coast of the island its seed makes, so the sea lies in front and the hills
// behind. Each district's buildings are plastered their own colour and
// dressed their own way (MapTrim); the features say what they are
// (MapBox.look), and the ground what it's paved with, for how they're drawn
// (see client/townlook.ts, dressing.ts and features.ts).

/** The town's edges: walls on the lines x = ±68 and z = -56, and the sea wall's inside on z = 55.6. */
const WEST = -68;
const EAST = 68;
const NORTH = -56;
const SEA = 55.6;
/** A ground floor stands this far over its ground. */
const FLOOR = 0.1;
const STOREY = 3;

/** Each district's plaster: the sketch's, paler. */
const PLASTER = {
  west: 0xf4f1ea,
  quay: 0xc8dce4,
  market: 0xe8bd6a,
  piazza: 0xeee2c4,
  east: 0xe8b09c,
  top: 0xd8d2bc,
} as const;
type District = keyof typeof PLASTER;
/** Each district's windows: how far apart along a wall, and how wide. */
const WINDOWS: Record<District, { every: number; width: number }> = {
  west: { every: 3, width: 1 },
  quay: { every: 3.5, width: 1.4 },
  market: { every: 3.5, width: 1.2 },
  piazza: { every: 4.5, width: 1.2 },
  east: { every: 3.5, width: 1.2 },
  top: { every: 4, width: 1.2 },
};

/**
 * Each district's dressing: the west's whitewashed houses plain at the
 * corners, with green and blue shutters and flowers everywhere, pots of
 * geraniums by every other door; stone corners and awnings over the quay's,
 * the market's and the piazza's doors; the east's houses in creepers,
 * bougainvillea and vines; the top's sober, but for its vines.
 */
const TRIM: Record<District, MapTrim> = {
  west: { shutters: 0.6, paint: [0x4f7d55, 0x3f7f7c, 0x46709a], flowers: 0.3, plants: 0.35, pots: 0.8, bougainvillea: 0.35, vines: 0.2 },
  quay: { quoins: true, shutters: 0.5, paint: [0x3d6a8f, 0x8a3b32, 0xd8d4c8], flowers: 0.1, awnings: 0.5, pots: 0.35 },
  market: { quoins: true, shutters: 0.7, paint: [0x5b7b3d, 0x6b4a2f], flowers: 0.2, awnings: 0.6, plants: 0.2, pots: 0.5, bougainvillea: 0.2 },
  piazza: { quoins: true, shutters: 0.6, paint: [0x4a6a50, 0x6f5a44], flowers: 0.15, awnings: 0.3, pots: 0.5, bougainvillea: 0.25 },
  east: { quoins: true, shutters: 0.7, paint: [0x7d8f6a, 0x4c5e7a], flowers: 0.3, plants: 0.4, pots: 0.7, bougainvillea: 0.45, vines: 0.4 },
  top: { shutters: 0.4, paint: [0x6a5a48, 0x5d6a72], flowers: 0.1, plants: 0.2, pots: 0.5, bougainvillea: 0.25, vines: 0.35 },
};

const lv = (minX: number, maxX: number, minZ: number, maxZ: number, y: number): Level => ({ minX, maxX, minZ, maxZ, y });

// The ground's levels, later ones over earlier: the quay at 3 m, the market
// and the west's lowest alleys at 6, the west's middle and the garden at 9,
// the piazza, the palazzo and the west's top at 12, and the high street, the
// cemetery and the villa at 15.
const LEVELS: Level[] = [
  lv(WEST, EAST, NORTH, 56, 3),
  // The west's alleys, climbing a level every 20 m or so, not where the middle does.
  lv(WEST, -30, 23, 40, 6),
  lv(WEST, -30, 1, 23, 9),
  lv(WEST, -30, -30, 1, 12),
  // The market and the hotel, Via del Porto behind it.
  lv(-30, 14, 4, 32, 6),
  lv(14, 36, 4, 34, 6),
  // The piazza and the belvedere, the top behind.
  lv(-30, 38, -42, 4, 12),
  lv(WEST, -36, NORTH, -30, 15),
  lv(-36, 2, NORTH, -36, 15),
  lv(2, EAST, NORTH, -42, 15),
  lv(-36, -30, -36, -30, 12),
  // The grand stair's landing, halfway up.
  lv(-12, -2, 4, 11, 9),
  // The east: the cottages between the road's first two legs, the garden, the palazzo and the back stairs beside it.
  lv(36, 44, 22, 32, 6),
  lv(44, 52, 22, 32, 7),
  lv(52, 62, 22, 32, 8),
  lv(36, 62, 16, 22, 6),
  lv(36, 62, -2, 16, 9),
  lv(36, 52, -8, -2, 12),
  lv(52, 62, -8, -2, 9),
  lv(38, 62, -32, -8, 12),
  lv(36, 62, -42, -32, 15),
  lv(62, EAST, -14, 32, 9),
  lv(62, EAST, -31, -14, 12),
  lv(62, EAST, -42, -31, 15),
  // Notches cut into the level above for stairs between houses.
  lv(-62, -59, 36, 40, 3),
  lv(-39, -36, 36, 40, 3),
  lv(-54, -51, 19, 23, 6),
  lv(-39, -36, 19, 23, 6),
  lv(-51, -48, -3, 1, 9),
  lv(62, EAST, -18, -14, 9),
  lv(62, EAST, -35, -31, 12),
];

/** Steps of a flight's: its rise and run, as the kit's. */
const RUN = 0.55;
const RISE = 0.5;

/** A flight of steps up a lane `x0`..`x1` (or `z0`..`z1`) between walls, its top on `top`, climbing toward `climbs` from `y0` to `y1`. */
function stair(a0: number, a1: number, top: number, climbs: Facing, y0: number, y1: number, width = a1 - a0 - 0.6): MapStair {
  const run = Math.ceil((y1 - y0) / RISE - 1e-6) * RUN;
  const mid = (a0 + a1) / 2;
  switch (climbs) {
    case '-z': return { x: mid, z: top + run, width, climbs, y0, y1 };
    case '+z': return { x: mid, z: top - run, width, climbs, y0, y1 };
    case '-x': return { x: top + run, z: mid, width, climbs, y0, y1 };
    case '+x': return { x: top - run, z: mid, width, climbs, y0, y1 };
  }
}

const STAIRS: MapStair[] = [
  // The west: up the alleys and lanes.
  stair(-62, -59, 36, '-z', 3, 6),
  stair(-39, -36, 36, '-z', 3, 6),
  stair(-54, -51, 19, '-z', 6, 9),
  stair(-39, -36, 19, '-z', 6, 9),
  stair(WEST, -65, 1, '-z', 9, 12),
  stair(-51, -48, -3, '-z', 9, 12),
  stair(-54, -51, -30, '-z', 12, 15),
  // From the quay: the harbour steps, the lane beside the hotel's, and the yard below Via del Porto.
  stair(-6, 0, 32, '-z', 3, 6),
  stair(14, 18, 34, '-z', 3, 6),
  stair(30, 36, 34, '-z', 3, 6),
  // The grand stair, with its landing halfway.
  stair(-12, -2, 11, '-z', 6, 9, 8.2),
  stair(-12, -2, 4, '-z', 9, 12, 8.2),
  // Up to the high street: beside the church, behind the bell tower, and from the belvedere.
  stair(-30, -22, -36, '-z', 12, 15),
  stair(6, 12, -42, '-z', 12, 15, 5.4),
  stair(31, 36, -42, '-z', 12, 15),
  // The back stairs beside the palazzo.
  stair(62, EAST, -18, '-z', 9, 12),
  stair(62, EAST, -35, '-z', 12, 15),
  // Onto the fish market's roof, along its east wall.
  stair(58, 59.9, 46, '-z', 3, 6.3, 1.5),
  // Into the garden from the road's second leg, and up from it to the third.
  { x: 48, z: 16 + 4 * RUN, width: 3.4, climbs: '-z', y0: 7.4, y1: 9 },
  stair(40, 44, -2, '-z', 9, 12),
];

/** The road's three legs, climbing in hairpins from the quay to the palazzo. */
const RAMPS: MapRamp[] = [
  { minX: 36, maxX: 62, minZ: 32, maxZ: 38, climbs: '-x', y0: 3, y1: 6 },
  { minX: 36, maxX: 62, minZ: 16, maxZ: 22, climbs: '+x', y0: 6, y1: 9 },
  { minX: 52, maxX: 62, minZ: -8, maxZ: -2, climbs: '-x', y0: 9, y1: 12 },
];

// ---------------------------------------------------------------- buildings

const op = (side: Facing, at: number, kind: MapOpening['kind'], storey = 0, width?: number): MapOpening => ({ side, at, kind, storey, ...(width ? { width } : {}) });
const door = (side: Facing, at: number, storey = 0) => op(side, at, 'door', storey);
const arch = (side: Facing, at: number, width = 2.4, storey = 0) => op(side, at, 'arch', storey, width);

/**
 * A flight of stairs inside a block along the inside of its wall on `side`,
 * starting near that wall's lesser end (`lo`) or its greater, and climbing
 * toward the other, from storey `storey`.
 */
function along(k: Rect, side: Facing, end: 'lo' | 'hi', storey: number): MapFlight {
  const [inX, inZ] = [0.9, 0.9];
  const foot = 1.4;
  switch (side) {
    case '-z': return { z: k.minZ + inZ, x: end === 'lo' ? k.minX + foot : k.maxX - foot, climbs: end === 'lo' ? '+x' : '-x', storey };
    case '+z': return { z: k.maxZ - inZ, x: end === 'lo' ? k.minX + foot : k.maxX - foot, climbs: end === 'lo' ? '+x' : '-x', storey };
    case '-x': return { x: k.minX + inX, z: end === 'lo' ? k.minZ + foot : k.maxZ - foot, climbs: end === 'lo' ? '+z' : '-z', storey };
    case '+x': return { x: k.maxX - inX, z: end === 'lo' ? k.minZ + foot : k.maxZ - foot, climbs: end === 'lo' ? '+z' : '-z', storey };
  }
}

/** A building as written below: its district, its ground's level, and its blocks. */
interface Spec {
  name?: string;
  district: District;
  /** The ground's level its ground floor stands on. */
  level: number;
  storey?: number;
  /** Its dressing, if not its district's. */
  trim?: MapTrim;
  blocks: MapBlock[];
  /** Flights of stairs, as along() gives them, by block. */
  flights?: MapFlight[];
  crates?: MapCrate[];
  signs?: MapSign[];
}

/** A block from x0 to x1 and z0 to z1. */
function block(x0: number, x1: number, z0: number, z1: number, storeys: number, more: Partial<MapBlock> = {}): MapBlock {
  return { minX: x0, maxX: x1, minZ: z0, maxZ: z1, storeys, ...more };
}

const r = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

// The west: narrow tall houses up the alleys, mostly under pitched roofs, a
// few flat ones to fight over, and rooms over two lanes.
const W1 = r(-68, -62, 25, 40);
const W2 = r(-59, -51, 28, 40);
const W3 = r(-51, -39, 26, 40);
const W4 = r(-36, -30, 26, 32);
const W5 = r(-68, -61, 10, 25);
const W6 = r(-61, -54, 10, 25);
const W7 = r(-51, -39, 19, 26);
const W8 = r(-51, -39, 4, 16);
const W9 = r(-36, -30, 1, 23);
const W10 = r(-65, -51, -9, 7);
const CASA_ALTA = r(-48, -30, -16, 1);
const W12 = r(-68, -60, -28, -12);
const W13 = r(-60, -54, -24, -12);
const W14 = r(-51, -40, -30, -19);
const W15 = r(-40, -30, -30, -19);
const WEST_SIDE: Spec[] = [
  {
    district: 'west', level: 6,
    blocks: [{ ...W1, storeys: 2, roof: 'pitched', openings: [door('+x', 7)] }],
    flights: [along(W1, '-x', 'hi', 0)],
    crates: [{ x: -63.5, z: 26.5 }],
  },
  {
    district: 'west', level: 6,
    blocks: [{ ...W2, storeys: 2, openings: [door('-x', 3), door('-z', 4)] }],
    flights: [along(W2, '+z', 'lo', 0), along(W2, '+x', 'hi', 1)],
  },
  {
    district: 'west', level: 6,
    blocks: [{ ...W3, storeys: 3, roof: 'pitched', openings: [door('+x', 4), door('-z', 8), door('+x', 5, 2)], balconies: [{ side: '+x', storey: 2, at: 5, width: 2.6, depth: 1.2 }] }],
    flights: [along(W3, '+z', 'lo', 0), along(W3, '+x', 'hi', 1)],
    crates: [{ x: -49.5, z: 27.5, storey: 1 }],
  },
  {
    district: 'west', level: 6,
    blocks: [{ ...W4, storeys: 1, openings: [door('-x', 3)] }],
    flights: [along(W4, '+x', 'lo', 0)],
  },
  {
    district: 'west', level: 9,
    blocks: [{ ...W5, storeys: 2, roof: 'pitched', openings: [door('-z', 4)] }],
    flights: [along(W5, '-x', 'hi', 0)],
    crates: [{ x: -62.5, z: 23.5 }],
  },
  {
    district: 'west', level: 9,
    blocks: [{ ...W6, storeys: 1, openings: [door('-z', 3), door('+x', 5), door('-x', 7)] }],
    flights: [along(W6, '+z', 'lo', 0)],
  },
  {
    district: 'west', level: 6,
    blocks: [{ ...W7, storeys: 2, openings: [door('-x', 4), door('-z', 8, 1)] }],
    flights: [along(W7, '+z', 'hi', 0), along(W7, '-z', 'lo', 1)],
  },
  // With a room over the lane south of it onto the roof beyond, and one over the lane east of it into the house there.
  {
    district: 'west', level: 9,
    blocks: [
      { ...W8, storeys: 2, roof: 'pitched', openings: [door('-x', 5), door('-z', 8), door('+z', 6, 1), door('+x', 6, 1)] },
      block(-47, -43, 16, 19, 2, { from: 1, roof: 'pitched', ridge: 'z', openings: [arch('+z', 2, 2.4, 1), op('-x', 1.5, 'window', 1, 1), op('+x', 1.5, 'window', 1, 1)] }),
      block(-39, -36, 8, 12, 2, { from: 1, roof: 'pitched', ridge: 'x', openings: [arch('+x', 2, 2.4, 1), op('-z', 1.5, 'window', 1, 1), op('+z', 1.5, 'window', 1, 1)] }),
    ],
    flights: [along(W8, '-z', 'lo', 0)],
    crates: [{ x: -39.7, z: 15.3 }],
  },
  {
    district: 'west', level: 9,
    blocks: [{ ...W9, storeys: 2, openings: [door('-x', 12)] }],
    flights: [along(W9, '-x', 'hi', 0), along(W9, '-x', 'lo', 1)],
  },
  {
    district: 'west', level: 12,
    blocks: [{ ...W10, storeys: 2, roof: 'pitched', openings: [door('-x', 4), door('+x', 3)] }],
    flights: [along(W10, '+z', 'lo', 0)],
    crates: [{ x: -52.5, z: 5.5 }],
  },
  {
    name: 'Casa Alta', district: 'west', level: 12,
    blocks: [{
      ...CASA_ALTA, storeys: 3,
      openings: [door('-x', 6), door('+x', 9), door('-z', 9), door('+x', 9, 2)],
      balconies: [{ side: '+x', storey: 2, at: 9, width: 3.2, depth: 1.4 }],
    }],
    flights: [along(CASA_ALTA, '-z', 'lo', 0), along(CASA_ALTA, '+x', 'hi', 1), along(CASA_ALTA, '-z', 'lo', 2)],
    crates: [{ x: -46.5, z: -0.5 }, { x: -31.5, z: -14.5, storey: 1 }],
  },
  {
    district: 'west', level: 12,
    blocks: [{ ...W12, storeys: 2, roof: 'pitched', openings: [door('+z', 5)] }],
    flights: [along(W12, '-x', 'hi', 0)],
  },
  {
    district: 'west', level: 12,
    blocks: [{ ...W13, storeys: 1, openings: [door('+z', 3), door('+x', 6)] }],
    flights: [along(W13, '-x', 'lo', 0)],
  },
  {
    district: 'west', level: 12,
    blocks: [{ ...W14, storeys: 2, roof: 'pitched', openings: [door('-x', 8), door('+z', 6), door('-z', 8, 1)] }],
    flights: [along(W14, '-z', 'lo', 0)],
    crates: [{ x: -41.5, z: -20.5 }],
  },
  {
    district: 'west', level: 12,
    blocks: [{ ...W15, storeys: 2, openings: [door('+z', 5), door('+x', 3), arch('-z', 2, 2.4, 1)] }],
    flights: [along(W15, '+x', 'hi', 0), along(W15, '+z', 'lo', 1)],
  },
];

// The quay: the houses along it, dug into the market's level, their first
// storeys opening onto it; the boat shed and the warehouse, with ways through
// them; the fish market under its arcade.
const Q1 = r(-36, -24, 32, 42);
const ALBERGO = r(-24, -6, 32, 45);
const Q3 = r(0, 14, 32, 39);
const Q4 = r(18, 30, 34, 42);
const BOAT_SHED = r(-56, -44, 44, 54);
const WAREHOUSE = r(20, 40, 46, SEA);
const FISH_MARKET = r(44, 58, 44, 52);
const QUAY: Spec[] = [
  {
    district: 'quay', level: 3,
    blocks: [{ ...Q1, storeys: 2, openings: [door('+z', 6), door('-z', 9, 1)] }],
    signs: [{ side: '+z', at: 6, kind: 'board', text: 'TRATTORIA DA PINO' }],
    flights: [along(Q1, '-z', 'lo', 0), along(Q1, '+x', 'hi', 1)],
    crates: [{ x: -25.5, z: 33.5 }],
  },
  {
    name: 'Albergo del Porto', district: 'quay', level: 3,
    blocks: [{ ...ALBERGO, storeys: 3, roof: 'pitched', openings: [door('+z', 9), door('+x', 10), door('-z', 6, 1), door('+z', 9, 2)], balconies: [{ side: '+z', storey: 2, at: 9, width: 4, depth: 1.4 }] }],
    signs: [{ side: '+z', at: 9, kind: 'board', text: 'ALBERGO DEL PORTO' }],
    flights: [along(ALBERGO, '-x', 'hi', 0), along(ALBERGO, '+x', 'lo', 1)],
    crates: [{ x: -7.5, z: 33.5 }, { x: -22.5, z: 33.5, storey: 2 }],
  },
  {
    district: 'quay', level: 3,
    blocks: [{ ...Q3, storeys: 2, openings: [door('+z', 7), door('-x', 4), door('-z', 4, 1)] }],
    signs: [{ side: '+z', at: 7, kind: 'board', text: 'BAR DEL MOLO' }],
    flights: [along(Q3, '+x', 'hi', 0), along(Q3, '-x', 'hi', 1)],
  },
  {
    district: 'quay', level: 3,
    blocks: [{ ...Q4, storeys: 2, openings: [door('+z', 6), door('-x', 5), door('-z', 4, 1)] }],
    signs: [{ side: '+z', at: 6, kind: 'board', text: 'SALI E TABACCHI' }, { side: '+z', at: 8.4, kind: 'tabacchi' }],
    flights: [along(Q4, '+x', 'hi', 0), along(Q4, '-x', 'lo', 1)],
    crates: [{ x: 28.5, z: 35.5 }],
  },
  {
    name: 'boat shed', district: 'quay', level: 3, trim: { quoins: true },
    blocks: [{ ...BOAT_SHED, storeys: 2, roof: 'pitched', ridge: 'x', openings: [op('-x', 5, 'arch', 0, 4), op('+x', 5, 'arch', 0, 4)] }],
    signs: [{ side: '+x', storey: 1, kind: 'painted', text: 'CANTIERE NAVALE' }],
    flights: [along(BOAT_SHED, '-z', 'lo', 0)],
    crates: [{ x: -45.5, z: 52.5 }],
  },
  {
    name: 'warehouse', district: 'quay', level: 3, trim: { quoins: true },
    blocks: [{ ...WAREHOUSE, storeys: 2, roof: 'pitched', ridge: 'x', openings: [op('-x', 5, 'arch', 0, 4), op('+x', 5, 'arch', 0, 4), door('-z', 10)] }],
    signs: [{ side: '-z', storey: 1, kind: 'painted', text: 'MAGAZZINI GENERALI' }],
    flights: [along(WAREHOUSE, '-z', 'lo', 0)],
    crates: [{ x: 38.5, z: 47.5 }, { x: 30, z: 54.5, storey: 1 }],
  },
  {
    name: 'fish market', district: 'quay', level: 3,
    blocks: [{ ...FISH_MARKET, storeys: 1, arcade: { side: '+z', bays: 4 }, openings: [door('-x', 4)] }],
    signs: [{ side: '-z', kind: 'painted', text: 'PESCHERIA' }],
    crates: [{ x: 56.5, z: 45.5 }],
  },
];

// The market: the loggia along its west side, the hotel along its east with a
// way through it, and under the piazza's edge the caffè, the tall house and
// the terrace, joined to the piazza by the grand stair between them.
const LOGGIA = r(-30, -24, 14, 32);
const HOTEL = r(14, 30, 14, 30);
const CAFFE = r(-30, -12, 4, 14);
const M4 = r(-2, 14, 4, 14);
const M5 = r(14, 36, 4, 14);
const MARKET: Spec[] = [
  {
    name: 'loggia', district: 'market', level: 6,
    blocks: [{ ...LOGGIA, storeys: 2, arcade: { side: '+x', bays: 4 }, openings: [arch('-x', 10.5)] }],
    signs: [{ side: '+x', storey: 1, kind: 'painted', text: 'MERCATO' }],
    flights: [along(LOGGIA, '-x', 'lo', 0), along(LOGGIA, '-x', 'hi', 1)],
  },
  {
    name: 'hotel', district: 'market', level: 6,
    // Its arches don't line up, so the way through bends and doesn't see from the market up the road.
    blocks: [{ ...HOTEL, storeys: 3, openings: [arch('-x', 8, 4), arch('+x', 12.5, 4), door('+z', 8), door('-z', 8, 2), door('-x', 4, 2)], balconies: [{ side: '-x', storey: 2, at: 4, width: 3.2, depth: 1.4 }] }],
    signs: [{ side: '-x', storey: 1, at: 12, kind: 'blade', text: 'HOTEL' }],
    flights: [along(HOTEL, '-z', 'lo', 0), along(HOTEL, '+z', 'hi', 1), along(HOTEL, '-z', 'lo', 2)],
    crates: [{ x: 28.5, z: 15.5 }, { x: 15.5, z: 28.5, storey: 2 }],
  },
  {
    name: 'caffè', district: 'market', level: 6,
    blocks: [{ ...CAFFE, storeys: 2, openings: [door('+z', 11), door('+x', 5, 1)] }],
    signs: [{ side: '+z', at: 11, kind: 'board', text: 'CAFFÈ CENTRALE' }],
    flights: [along(CAFFE, '-z', 'lo', 0)],
    crates: [{ x: -28.5, z: 12.5 }],
  },
  {
    district: 'market', level: 6,
    blocks: [{ ...M4, storeys: 3, roof: 'pitched', ridge: 'x', openings: [door('+z', 8), door('-x', 5, 1), door('-z', 8, 2)] }],
    signs: [{ side: '+z', at: 8, kind: 'board', text: 'ALIMENTARI' }],
    flights: [along(M4, '+x', 'hi', 0), along(M4, '+z', 'lo', 1)],
    crates: [{ x: 12.5, z: 5.5, storey: 1 }],
  },
  {
    district: 'market', level: 6,
    blocks: [{ ...M5, storeys: 2, openings: [door('+z', 19), door('+x', 5, 1)] }],
    signs: [{ side: '+z', at: 19, kind: 'board', text: 'FARMACIA' }, { side: '+z', at: 16.6, kind: 'farmacia' }],
    flights: [along(M5, '-z', 'lo', 0), along(M5, '+z', 'lo', 1)],
    crates: [{ x: 34.5, z: 5.5 }],
  },
];

// The piazza: the church, its bell tower beside it, the portico along the
// piazza's east side with a way through, the old school round its courtyard.
const CHURCH = r(-22, 2, -36, -18);
const PORTICO = r(14, 30, -18, 4);
const OLD_SCHOOL = r(14, 30, -42, -22);
const PIAZZA: Spec[] = [
  {
    name: 'church', district: 'piazza', level: 12, storey: 6, trim: { quoins: true },
    blocks: [{ ...CHURCH, storeys: 1, roof: 'pitched', openings: [door('+z', 12), door('-x', 9), door('+x', 3)] }],
    crates: [{ x: -20.5, z: -34.5 }],
  },
  {
    name: 'portico', district: 'piazza', level: 12,
    blocks: [{ ...PORTICO, storeys: 2, arcade: { side: '-x', bays: 6 }, openings: [arch('+x', 14, 3), door('+x', 6), door('+z', 8)] }],
    flights: [along(PORTICO, '+z', 'lo', 0), along(PORTICO, '+x', 'lo', 1)],
    crates: [{ x: 15.5, z: -16.5, storey: 1 }],
  },
  {
    name: 'old school', district: 'piazza', level: 12,
    blocks: [{
      ...OLD_SCHOOL, storeys: 1, court: r(18, 26, -36, -26),
      openings: [door('+z', 8), door('-x', 10), arch('+z', 4, 2.4), { ...door('-x', 5), court: true }, { ...door('+x', 5), court: true }],
    }],
    crates: [{ x: 15.5, z: -40.5 }],
  },
];

// The east: the cottages between the road's first two legs, and the palazzo
// round its courtyard, entered from three sides.
const C1 = r(36, 44, 22, 32);
const C2 = r(44, 52, 22, 32);
const C3 = r(52, 62, 22, 32);
const PALAZZO = r(38, 62, -32, -8);
const EAST_SIDE: Spec[] = [
  {
    district: 'east', level: 6,
    blocks: [{ ...C1, storeys: 2, roof: 'pitched', ridge: 'z', openings: [door('-z', 4), door('-x', 5)] }],
    flights: [along(C1, '+z', 'lo', 0)],
  },
  {
    district: 'east', level: 7,
    blocks: [{ ...C2, storeys: 1, openings: [door('-z', 4)] }],
    flights: [along(C2, '+z', 'lo', 0)],
    crates: [{ x: 51, z: 26 }],
  },
  {
    district: 'east', level: 8,
    blocks: [{ ...C3, storeys: 2, roof: 'pitched', ridge: 'z', openings: [door('-z', 5)] }],
    flights: [along(C3, '+z', 'lo', 0)],
    crates: [{ x: 60.5, z: 23.5, storey: 1 }],
  },
  {
    name: 'palazzo', district: 'east', level: 12,
    blocks: [{
      ...PALAZZO, storeys: 3, roof: 'pitched', court: r(46, 54, -25, -17),
      openings: [
        arch('-x', 12, 3), arch('+x', 11, 3), arch('+z', 12, 3), door('-z', 12, 1), door('+z', 6, 2), door('+z', 18, 2),
        { ...arch('+z', 4, 3), court: true }, { ...arch('-x', 5, 3), court: true }, { ...arch('+x', 4, 3), court: true },
      ],
      balconies: [{ side: '+z', storey: 2, at: 6, width: 3.2, depth: 1.4 }, { side: '+z', storey: 2, at: 18, width: 3.2, depth: 1.4 }],
    }],
    flights: [along(r(38, 62, -32, -25), '-z', 'lo', 0), along(r(38, 62, -32, -25), '-z', 'hi', 1)],
    crates: [{ x: 60.5, z: -9.5 }, { x: 39.5, z: -9.5, storey: 2 }],
  },
];

// The top: the high street's north side, the villa and the cemetery's chapel.
const T1 = r(-36, -22, NORTH, -46);
const T2 = r(-22, -8, NORTH, -46);
const T3 = r(-8, 4, NORTH, -46);
const T4 = r(4, 20, NORTH, -50);
const T5 = r(20, 36, NORTH, -50);
const VILLA = r(44, 58, -52, -40);
const CHAPEL = r(-64, -56, -52, -44);
const TOP: Spec[] = [
  {
    district: 'top', level: 15,
    blocks: [{ ...T1, storeys: 2, roof: 'pitched', ridge: 'x', openings: [door('+z', 7)] }],
    flights: [along(T1, '-z', 'lo', 0)],
  },
  {
    district: 'top', level: 15,
    blocks: [{ ...T2, storeys: 1, openings: [door('+z', 7)] }],
    flights: [along(T2, '-z', 'lo', 0)],
    crates: [{ x: -9.5, z: -54.5 }],
  },
  {
    district: 'top', level: 15,
    blocks: [{ ...T3, storeys: 2, roof: 'pitched', ridge: 'z', openings: [door('+z', 6)] }],
    flights: [along(T3, '-z', 'lo', 0)],
  },
  {
    district: 'top', level: 15,
    blocks: [{ ...T4, storeys: 1, roof: 'pitched', ridge: 'x', openings: [door('+z', 8)] }],
    crates: [{ x: 18.5, z: -54.5 }],
  },
  {
    district: 'top', level: 15,
    blocks: [{ ...T5, storeys: 2, openings: [door('+z', 8)] }],
    flights: [along(T5, '-z', 'lo', 0), along(T5, '-z', 'hi', 1)],
  },
  {
    name: 'villa', district: 'top', level: 15,
    blocks: [{ ...VILLA, storeys: 2, roof: 'pitched', openings: [door('+z', 7), door('-x', 6), door('+z', 7, 1)], balconies: [{ side: '+z', storey: 1, at: 7, width: 4, depth: 1.4 }] }],
    flights: [along(VILLA, '-z', 'lo', 0)],
    crates: [{ x: 56.5, z: -50.5, storey: 1 }],
  },
  {
    name: 'ruined chapel', district: 'top', level: 15, trim: { quoins: true, plants: 1 },
    blocks: [{ ...CHAPEL, storeys: 1, openings: [door('+z', 4), arch('+x', 4)] }],
    flights: [along(CHAPEL, '-z', 'lo', 0)],
  },
];

const SPECS: Spec[] = [...WEST_SIDE, ...QUAY, ...MARKET, ...PIAZZA, ...EAST_SIDE, ...TOP];

// ---------------------------------------------------------------- the ground

/** The ground beyond the town: the sea in front, the hillside rising behind and beside it. */
function beyond(x: number, z: number): number {
  if (z >= 60) return -6;
  const cx = Math.min(EAST - 0.5, Math.max(WEST + 0.5, x));
  const cz = Math.min(55.5, Math.max(NORTH + 0.5, z));
  const inside = levelOf(cx, cz);
  return Math.min(30, inside + Math.max(0, Math.abs(x) - EAST) * 0.5 + Math.max(0, NORTH - z) * 0.75);
}

/** The level at (x, z) inside the town, as drawn. */
function levelOf(x: number, z: number): number {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const l = LEVELS[i];
    if (x >= l.minX && x < l.maxX && z >= l.minZ && z < l.maxZ) return l.y;
  }
  return 3;
}

/** The rooms of the blocks standing on the ground, inside their walls, and the floors they stand on. */
const GROUNDED = SPECS.flatMap((s) => s.blocks.filter((k) => !k.from).map((k) => ({ minX: k.minX + 0.15, maxX: k.maxX - 0.15, minZ: k.minZ + 0.15, maxZ: k.maxZ - 0.15, floor: (k.floor ?? s.level + FLOOR) - FLOOR })));

/** The ground grid: every 4 m from (-100, -100), 51 points a side. */
const GROUND = levelGround({
  area: { minX: WEST, maxX: EAST, minZ: NORTH, maxZ: 56 },
  levels: LEVELS,
  grid: { x0: -100, z0: -100, cols: 51, rows: 51 },
  beyond,
  dug: GROUNDED,
  skip: RAMPS,
  blend: 30,
});

// ---------------------------------------------------------------- windows

/**
 * Every building with its windows: along each wall not shared with another
 * block, nor looking into the ground, nor out of the town, at the district's
 * spacing, kept off the corners and the doors and arches.
 */
function withWindows(specs: readonly Spec[]): MapBuilding[] {
  const all = specs.flatMap((s) => s.blocks.map((k) => ({ k, s })));
  const height = (s: Spec) => s.storey ?? STOREY;
  return specs.map((s): MapBuilding => {
    const style = WINDOWS[s.district];
    const floor = s.level + FLOOR;
    const blocks = s.blocks.map((k): MapBlock => {
      const openings = [...(k.openings ?? [])];
      const own = (k.floor ?? floor);
      for (const side of ['-z', '+z', '-x', '+x'] as Facing[]) {
        const alongX = side === '-z' || side === '+z';
        const line = side === '-z' ? k.minZ : side === '+z' ? k.maxZ : side === '-x' ? k.minX : k.maxX;
        const [lo, hi] = alongX ? [k.minX, k.maxX] : [k.minZ, k.maxZ];
        const out = side === '+z' || side === '+x' ? 1 : -1;
        if (line <= WEST || line >= EAST || line <= NORTH) continue;
        for (let st = k.from ?? 0; st < k.storeys; st++) {
          const y = own + height(s) * st;
          const n = Math.floor((hi - lo - 2) / style.every);
          if (n < 1) continue;
          const first = (hi - lo - (n - 1) * style.every) / 2;
          for (let i = 0; i < n; i++) {
            const at = first + i * style.every;
            const a = lo + at;
            // Not where a doorway, arch or another window is.
            if (openings.some((o) => o.side === side && !o.court && (o.storey ?? 0) === st && Math.abs(o.at - at) < ((o.width ?? 2.4) + style.width) / 2 + 0.5)) continue;
            // Not on a wall another block stands against.
            const shared = all.some(({ k: q, s: qs }) => {
              if (q === k) return false;
              const qLines = alongX ? [q.minZ, q.maxZ] : [q.minX, q.maxX];
              if (!qLines.some((v) => Math.abs(v - line) < 1e-6)) return false;
              const [q0, q1] = alongX ? [q.minX, q.maxX] : [q.minZ, q.maxZ];
              if (a + style.width / 2 <= q0 || a - style.width / 2 >= q1) return false;
              const qFloor = q.floor ?? qs.level + FLOOR;
              return qFloor + height(qs) * (q.from ?? 0) < y + height(s) - 0.1 && qFloor + height(qs) * q.storeys > y + 0.1;
            });
            if (shared) continue;
            // Not looking into the ground outside.
            const [px, pz] = alongX ? [a, line + out * 0.6] : [line + out * 0.6, a];
            if (GROUND.levelAt(px, pz) > y + 0.6) continue;
            openings.push(op(side, at, 'window', st, style.width));
          }
        }
      }
      return { ...k, openings };
    });
    return {
      name: s.name ?? `${s.district} house`,
      floor, colour: PLASTER[s.district], trim: s.trim ?? TRIM[s.district], blocks,
      ...(s.storey ? { storey: s.storey } : {}),
      ...(s.flights ? { flights: s.flights } : {}),
      ...(s.crates ? { crates: s.crates.map((c) => flush(c, s.blocks)) } : {}),
      ...(s.signs ? { signs: s.signs } : {}),
    };
  });
}

/** How near a wall a crate is set flush against it, so no gap is left beside it a body could be caught in. */
const FLUSH = 1.8;

/** A crate near its block's walls set flush against them. */
function flush(c: MapCrate, blocks: readonly MapBlock[]): MapCrate {
  const k = blocks.find((b) => c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ);
  if (!k) return c;
  const off = 0.15 + (c.size ?? 1.1) / 2 + 0.03;
  const x = c.x - k.minX < FLUSH ? k.minX + off : k.maxX - c.x < FLUSH ? k.maxX - off : c.x;
  const z = c.z - k.minZ < FLUSH ? k.minZ + off : k.maxZ - c.z < FLUSH ? k.maxZ - off : c.z;
  return { ...c, x, z };
}

// ---------------------------------------------------------------- the rest

/** A solid box over a rectangle, from a little under the ground's level there to `h` over it. */
function solid(minX: number, maxX: number, minZ: number, maxZ: number, h: number, under = 0.4): MapBox {
  const y = levelOf((minX + maxX) / 2, (minZ + maxZ) / 2);
  return { minX, maxX, minZ, maxZ, y0: y - under, y1: y + h };
}

/** The edge walls along x = ±68 and z = -56, 3.5 m over the ground inside them, but where a building's wall stands on the line. */
function edgeWalls(): MapBox[] {
  const out: MapBox[] = [];
  const onLine = (axis: 'x' | 'z', line: number, a: number) => SPECS.some((s) => s.blocks.some((k) => (axis === 'x' ? (k.minZ === line || k.maxZ === line) && a > k.minX && a < k.maxX : (k.minX === line || k.maxX === line) && a > k.minZ && a < k.maxZ)));
  const run = (axis: 'x' | 'z', line: number, a0: number, a1: number, c0: number, c1: number, inside: (a: number) => [number, number]) => {
    let cur: MapBox | null = null;
    for (let a = a0; a < a1; a++) {
      if (onLine(axis, line, a + 0.5)) {
        cur = null;
        continue;
      }
      const y = levelOf(...inside(a + 0.5));
      const top = y + 3.5;
      if (cur && cur.y1 === top) {
        if (axis === 'x') cur.maxX = a + 1;
        else cur.maxZ = a + 1;
        continue;
      }
      cur = axis === 'x'
        ? { minX: a, maxX: a + 1, minZ: c0, maxZ: c1, y0: y - 4, y1: top }
        : { minZ: a, maxZ: a + 1, minX: c0, maxX: c1, y0: y - 4, y1: top };
      out.push(cur);
    }
  };
  run('z', WEST, NORTH, SEA, WEST - 0.3, WEST, (a) => [WEST + 0.5, a]);
  run('z', EAST, NORTH, SEA, EAST, EAST + 0.3, (a) => [EAST - 0.5, a]);
  run('x', NORTH, WEST, EAST, NORTH - 0.3, NORTH, (a) => [a, NORTH + 0.5]);
  return out;
}

/** An olive's or a plane's trunk. */
const trunk = (x: number, z: number, h: number, w: number, look: 'plane' | 'olive') => ({ ...solid(x - w / 2, x + w / 2, z - w / 2, z + w / 2, h), look });
const as = (box: MapBox, look: MapBox['look']): MapBox => ({ ...box, look });
/**
 * A heap of rubble `h` high over the rectangle, as drawn: colliding as three
 * tiers, a low bed over all of it, higher toward the middle, its peak there.
 */
function heap(minX: number, maxX: number, minZ: number, maxZ: number, h: number): MapBox {
  const box = as(solid(minX, maxX, minZ, maxZ, h), 'rubble');
  const [cx, cz, hx, hz] = [(minX + maxX) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2];
  const tier = (share: number, top: number) => ({ minX: cx - hx * share, maxX: cx + hx * share, minZ: cz - hz * share, maxZ: cz + hz * share, y0: box.y0, y1: box.y1 - h * (1 - top) });
  return { ...box, collides: [tier(1, 0.4), tier(0.55, 0.75), tier(0.25, 1)] };
}

const FEATURES: MapBox[] = [
  // The sea wall along the quay, and the quay's face down into the harbour under it.
  { minX: WEST, maxX: EAST, minZ: SEA, maxZ: SEA + 0.5, y0: 2.5, y1: 4.1 },
  { minX: WEST, maxX: EAST, minZ: SEA + 0.5, maxZ: 60, y0: -6, y1: 3, look: 'quay' },
  // The bell tower, solid, beside the church.
  as(solid(2.15, 8, -24, -18, 18, 0.5), 'belltower'),
  // The market: the crashed truck and the stalls.
  as(solid(-12, -3, 20, 23, 3), 'truck'),
  as(solid(-20, -17, 26, 28, 1.1), 'stall'),
  as(solid(-14, -11, 27, 29, 1.1), 'stall'),
  as(solid(2, 5, 25, 27, 1.1), 'stall'),
  as(solid(6, 9, 17, 19, 1.1), 'stall'),
  // Carts: in the yard at the road's hairpin, and two along the high street, breaking up its long views.
  as(solid(32.5, 34.5, 17, 20, 1.3), 'cart'),
  as(solid(-32, -29, -42.5, -40.5, 1.3), 'cart'),
  as(solid(-4.5, -1.5, -41, -39, 1.3), 'cart'),
  // Sandbags where the longest views run, along the market's south side and in Via
  // del Porto against the hotel's wall, past its doorway.
  as(solid(10.2, 13.4, 31.15, 31.85, 1.1), 'sandbags'),
  as(solid(25, 28.2, 30.15, 30.85, 1.1), 'sandbags'),
  // Rubble fallen from the ruined chapel, by its arch and its door.
  heap(-55.85, -53.6, -51.4, -49.6, 0.8),
  heap(-63.5, -61.8, -43.85, -42.4, 0.6),
  // The piazza: the fountain, the plane trees, the war memorial and the kiosk.
  as(solid(-11, -5, -11, -5, 0.9), 'fountain'),
  trunk(-23.5, -11.5, 5, 0.8, 'plane'),
  trunk(-23.5, -0.5, 5, 0.8, 'plane'),
  as(solid(-17, -14, -2, 1, 2.5), 'memorial'),
  as(solid(4, 8, -12, -8, 2.6), 'kiosk'),
  // The boat yard's boats, hauled out.
  as(solid(-66, -60, 44, 47, 2), 'boat'),
  as(solid(-64, -58, 51, 54, 2), 'boat'),
  // The water tower by the villa: four legs and the tank on them.
  ...[[60, -54], [65.5, -54], [60, -48.5], [65.5, -48.5]].map(([x, z]) => as(solid(x, x + 0.5, z, z + 0.5, 9), 'leg')),
  as(solid(60, 66, -54, -48, 14, -9), 'tank'),
  // The cemetery's tombs.
  ...[[-60, -40], [-54, -40], [-48, -40], [-60, -34], [-48, -34], [-42, -48], [-42, -38]].map(([x, z]) => as(solid(x - 1.5, x + 1.5, z - 1, z + 1, 1.2), 'tomb')),
  // The olive garden: its trees and the low wall across it.
  ...[[42, 4], [50, 2], [56, 7], [44, 11], [53, 12], [60, 2]].map(([x, z]) => trunk(x, z, 3, 0.5, 'olive')),
  solid(38, 58, 7.5, 8.2, 1),
  // The back stairs' end over the quay, railed.
  { minX: 62, maxX: EAST, minZ: 31.7, maxZ: 32, y0: 2.5, y1: 10 },
];

const PROPS: MapProp[] = [
  // Cargo on the quay.
  { kind: 'container', minX: -26, maxX: -20, minZ: 47, maxZ: 49.5 },
  { kind: 'container', minX: 2, maxX: 8, minZ: 50, maxZ: 52.5 },
  { kind: 'container', minX: -6, maxX: -3.5, minZ: 45, maxZ: 51 },
  { kind: 'crate', x: 67.27, z: 51.5, size: 1.4 },
  { kind: 'crate', x: 67.3, z: 51.4, size: 1.1, on: 3 },
  { kind: 'crate', x: 67.35, z: 54.6, size: 1.2 },
  { kind: 'crate', x: -38, z: 50, size: 1.2 },
  { kind: 'crate', x: 12, z: 46, size: 1.4 },
  // Outside the boat shed's east arch, across the quay's long view.
  { kind: 'crate', x: -41, z: 47.3, size: 1.4 },
  { kind: 'crate', x: -41, z: 47.3, size: 1.1, on: 8 },
  // The market.
  { kind: 'crate', x: -16, z: 18, size: 1.2 },
  { kind: 'crate', x: 9, z: 29, size: 1.4 },
  { kind: 'crate', x: 35.2, z: 30.5, size: 1.2 },
  // The piazza and the high street.
  { kind: 'crate', x: -2, z: 0, size: 1.2 },
  { kind: 'crate', x: 34, z: -24, size: 1.4 },
  { kind: 'crate', x: -26, z: -44, size: 1.2 },
  { kind: 'crate', x: 22, z: -46, size: 1.4 },
  // The west's alleys and the road.
  { kind: 'crate', x: -56.2, z: 25.8, size: 1.2 },
  { kind: 'crate', x: 58, z: 19, size: 1.2 },
];

/**
 * Trees beyond the walls: cypresses in rows outside the cemetery's north and
 * west walls, as round every Italian cemetery, and a pair at its corner;
 * umbrella pines over the villa at the top and on the point east of the
 * quay; and a few cypresses up the slope behind the high street.
 */
const PLANTS: MapPlant[] = [
  ...Array.from({ length: 7 }, (_, i): MapPlant => ({ kind: 'cypress', x: -65.5 + i * 4.6, z: NORTH - 2.6, s: 0.9 + ((i * 7) % 3) * 0.08 })),
  ...Array.from({ length: 6 }, (_, i): MapPlant => ({ kind: 'cypress', x: WEST - 2.6, z: -53 + i * 4.4, s: 0.9 + ((i * 5) % 3) * 0.08 })),
  { kind: 'cypress', x: WEST - 3.5, z: NORTH - 3.5, s: 1.15 },
  { kind: 'pine', x: 48, z: NORTH - 7, s: 1 },
  { kind: 'pine', x: 61, z: NORTH - 9, s: 0.9 },
  { kind: 'pine', x: EAST + 9, z: -44, s: 0.95 },
  { kind: 'pine', x: EAST + 10, z: 40, s: 0.85 },
  { kind: 'pine', x: EAST + 16, z: 48, s: 1 },
  { kind: 'pine', x: WEST - 12, z: 46, s: 0.9 },
  { kind: 'cypress', x: -6, z: NORTH - 8, s: 1 },
  { kind: 'cypress', x: -1.5, z: NORTH - 8.5, s: 1.1 },
  { kind: 'cypress', x: 18, z: NORTH - 6, s: 0.95 },
];

/** A spawn at (x, z), looking toward (tx, tz). */
function spawn(x: number, z: number, tx: number, tz: number): MapSpawn {
  return { x, z, yaw: yawToward(x, z, tx, tz) };
}

/** The sketch's eight zones of four spawn points, away from the hubs, each looking toward the nearest. */
const SPAWNS: MapSpawn[] = [
  // The boat yard.
  spawn(-58, 47, -6, 22), spawn(-64.5, 49.5, -6, 22), spawn(-62, 41.5, -6, 22), spawn(-54, 41.5, -6, 22),
  // The quay.
  spawn(-14, 50, -6, 22), spawn(-20.5, 52.5, -6, 22), spawn(-7.5, 47.5, -6, 22), spawn(-8.5, 54, -6, 22),
  // The fish market's end of the quay.
  spawn(59.5, 51.5, 40, 50), spawn(51, 53.5, 40, 50), spawn(59.5, 43.5, 50, 36), spawn(63.5, 47.5, 64, 36),
  // The west's alleys.
  spawn(-60, -10.5, -8, -8), spawn(-53, 8.5, -8, -8), spawn(-66, 8.5, -8, -8), spawn(-49.5, 2, -8, -8),
  // The cemetery.
  spawn(-50, -46, -8, -8), spawn(-50, -53, -8, -8), spawn(-43.5, -43.5, -8, -8), spawn(-56, -42.5, -8, -8),
  // The high street.
  spawn(-14, -42, -8, -8), spawn(-21, -42, -8, -8), spawn(-7, -42, -8, -8), spawn(-17.5, -44.5, -8, -8),
  // Between the villa and the palazzo.
  spawn(50, -37, 36, -37), spawn(44, -37, 30, -37), spawn(56, -37, 66, -37), spawn(47, -38.5, 40, -46),
  // The road's hairpin at the back stairs.
  spawn(65, 8, 50, -21), spawn(65, 0, 50, -21), spawn(57.5, 5.5, 50, -21), spawn(59.5, 12, 50, -21),
];

const TOWN: GameMap = {
  id: 'calabianca',
  name: 'Calabianca',
  seed: 4,
  ground: GROUND.ground,
  // Inside the walls, the houses' backs and the sea wall, by a body's width: nobody meets the edge before the wall.
  bounds: { minX: WEST + 0.55, maxX: EAST - 0.55, minZ: NORTH + 0.55, maxZ: SEA - 0.4 },
  buildings: withWindows(SPECS),
  walls: [...GROUND.terraces, ...edgeWalls(), ...FEATURES],
  stairs: STAIRS,
  ramps: RAMPS,
  props: PROPS,
  spawns: SPAWNS,
  // From the south-west, over the sea, raking across the church and the market.
  sun: 110,
  plants: PLANTS,
  // Flagstones down the lanes and along the quay; cobbles on the squares, the
  // courtyards and the road; grass in the olive garden and the cemetery; the
  // boat yard bare.
  paving: {
    area: r(WEST, EAST, NORTH, SEA + 0.5),
    patches: [
      { ...r(-24, 14, 14, 32), kind: 'cobbles' },
      { ...r(-30, 14, -18, 4), kind: 'cobbles' },
      { ...r(46, 54, -25, -17), kind: 'cobbles' },
      { ...r(18, 26, -36, -26), kind: 'cobbles' },
      { ...r(36, EAST, 32, 38), kind: 'cobbles' },
      { ...r(30, EAST, 16, 22), kind: 'cobbles' },
      { ...r(30, 36, 16, 34), kind: 'cobbles' },
      { ...r(62, EAST, -8, 38), kind: 'cobbles' },
      { ...r(52, EAST, -8, -2), kind: 'cobbles' },
      { ...r(36, 62, -2, 16), kind: 'grass' },
      { ...r(WEST, -36, NORTH, -30), kind: 'grass' },
      { ...r(WEST, -56, 40, SEA), kind: 'earth' },
    ],
  },
  lanes: [
    { name: 'quay', points: [[-62, 50], [18, 50], [20, 44], [40, 44], [60, 42], [65, 36]] },
    { name: 'road', points: [[65, 36], [62, 35], [36, 35], [33, 26], [36, 19], [62, 19], [65, 15], [65, -5], [62, -5], [36, -5]] },
    { name: 'Via del Porto', points: [[0, 30], [33, 32]] },
    { name: 'grand stair', points: [[-7, 22], [-7, -8]] },
    { name: 'outer alley', points: [[-60.5, 44], [-60.5, 26.5], [-52.5, 26.5], [-52.5, 8.5], [-66.5, 8.5], [-66.5, -10.5], [-52.5, -10.5], [-52.5, -36]] },
    { name: 'west alleys', points: [[-24, 24.5], [-37.5, 24.5], [-37.5, 2.5], [-49.5, 2.5], [-49.5, -17.5], [-30, -17.5]] },
    { name: 'high street', points: [[-52, -40], [4, -40], [4, -46], [40, -46], [40, -37], [65, -37]] },
  ],
};

/** Where the town stands on its island: the quay on the coast. */
export const CALABIANCA: GameMap = moved(TOWN, 0, 240);
