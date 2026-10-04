import { yawToward } from '../geom.ts';
import { moved, type Facing, type GameMap, type MapBalcony, type MapBlock, type MapBuilding, type MapBox, type MapFlight, type MapOpening, type MapSpawn, type MapStair } from './index.ts';

// Calabianca: a whitewashed town on a hillside above the sea, Deathmatch's
// map. It falls from a high street at the back (north) to a harbour front at
// the sea (south) in four levels 3 m apart, a storey each: the harbour, the
// lower street, the square's street and the high street. Every row of houses
// stands on one level with its back dug into the next level up, so its upper
// storey opens onto the street above, and a one-storey house's roof carries
// on from that street. Three lanes run down the slope, with stairs where they
// climb a level, and an alley along each edge; two of them pass under a
// house. In the middle the square, in front of the church and its bell tower,
// carries on over the roofs of the houses below it.
//
// Laid out round (0, 0) and moved onto the south coast of the island its seed
// makes, so the sea lies in front and the hills behind. Plain boxes for now:
// the town's look comes later.

/** The levels' ground, from the sea up, and the floors of the houses on them. */
const HARBOUR = 3;
const LOWER = 6;
const SQUARE = 9;
const HIGH = 12;
const FLOOR = 0.1;

/** Where each level's terrace edge stands: the ground falls a level across the 4 m north of each, under a terrace box. */
const EDGE_LOWER = 32;
const EDGE_SQUARE = 8;
const EDGE_HIGH = -24;
/** The town's edges: walls on the lines x = ±68, the houses' backs on z = -56, and the sea wall's inside on z = 55.6. */
const WEST = -68;
const EAST = 68;
const NORTH = -56;
const SEA = 55.6;

/** The ground's level at z, north to south, and the hillside behind the town rising to the backdrop's hills. */
function levelAt(z: number): number {
  if (z >= 60) return -6;
  if (z >= EDGE_LOWER) return HARBOUR;
  if (z >= EDGE_SQUARE) return LOWER;
  if (z >= EDGE_HIGH) return SQUARE;
  if (z >= NORTH) return HIGH;
  return Math.min(30, HIGH + (NORTH - z) * 0.75);
}

/** The ground grid: every 4 m from (-100, -100), the levels across the town and the land rising beyond its sides. */
const GROUND_FROM = -100;
const GROUND_CELLS = 51;
const heights = Array.from({ length: GROUND_CELLS }, (_, r) => {
  const z = GROUND_FROM + 4 * r;
  return Array.from({ length: GROUND_CELLS }, (_, c) => {
    const x = GROUND_FROM + 4 * c;
    const side = Math.max(0, Math.abs(x) - EAST);
    return z >= 60 ? levelAt(z) : levelAt(z) + side * 0.5;
  });
});

const op = (side: Facing, at: number, kind: MapOpening['kind'], storey = 0, width?: number): MapOpening => ({ side, at, kind, storey, ...(width ? { width } : {}) });

/**
 * A house: one block from x0 to x1, its back on z0 (uphill) and its front on
 * z1 (downhill, onto its street), `storeys` storeys. Its front gets a door
 * (`door` along it, the middle if left out) and windows; with `back`, it's
 * dug into the terrace behind and its first storey opens onto the street
 * above by a door that far along its back. Inside, a flight along its back
 * wall to the first storey, one along its east wall to the second, and a
 * hatch onto the roof from the top storey, unless its roof is reached from
 * outside: carrying on from the street above (`flush`), or up an outside
 * stair (`outside`). A crate in the back corner opposite the stairs.
 */
interface House {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  floor: number;
  storeys: number;
  back?: number;
  roof?: 'hatch' | 'outside' | 'flush';
  door?: number;
  openings?: MapOpening[];
  balconies?: MapBalcony[];
  /** More blocks of the same house: rooms over a lane. */
  more?: MapBlock[];
  /** The upper flights along its west wall instead, leaving its east wall free for a door. */
  west?: boolean;
}

function house(h: House): MapBuilding {
  const W = h.x1 - h.x0;
  const D = h.z1 - h.z0;
  const extra = h.openings ?? [];
  const openings: MapOpening[] = [...extra];
  /** A window, unless an opening asked for is near it. */
  const window = (side: Facing, at: number, storey: number) => {
    if (openings.some((o) => o.side === side && (o.storey ?? 0) === storey && Math.abs(o.at - at) < 2.2)) return;
    openings.push(op(side, at, 'window', storey));
  };
  openings.push(op('+z', h.door ?? W / 2, 'door'));
  if (h.back !== undefined) openings.push(op('-z', h.back, 'door', 1));
  for (let s = 0; s < h.storeys; s++) {
    for (const at of s === 0 ? [1.6, W - 1.6] : [1.6, W / 2, W - 1.6]) window('+z', at, s);
    if (h.back !== undefined && s >= 1) window('-z', W - 1.6, s);
  }
  const flights: MapFlight[] = [];
  const alongBack = (storey: number): MapFlight => ({ x: h.x0 + 1.4, z: h.z0 + 0.9, climbs: '+x', storey });
  const alongEast = (storey: number): MapFlight => ({ x: h.west ? h.x0 + 0.9 : h.x1 - 0.9, z: h.z1 - 1.4, climbs: '-z', storey });
  const roof = h.roof ?? 'hatch';
  if (h.storeys >= 2) flights.push(alongBack(0));
  if (h.storeys >= 3) flights.push(alongEast(1));
  if (roof === 'hatch') flights.push(h.storeys === 3 ? alongBack(2) : h.storeys === 2 ? alongEast(1) : alongBack(0));
  if (D < 8 || W < 9) throw new Error(`A house at x ${h.x0}..${h.x1} is too small for its stairs`);
  return {
    floor: h.floor,
    blocks: [{ minX: h.x0, maxX: h.x1, minZ: h.z0, maxZ: h.z1, storeys: h.storeys, openings, ...(h.balconies ? { balconies: h.balconies } : {}) }, ...(h.more ?? [])],
    flights,
    crates: [{ x: h.x1 - 2.3, z: h.z0 + 2.3 }],
  };
}

/** A flight of steps outside along a house's back, from the street above up to its roof, climbing west from `x`. */
function roofStair(x: number, back: number, from: number, roof: number): MapStair {
  return { x, z: back - 0.9, width: 1.5, climbs: '-x', y0: from, y1: roof };
}

/** Stairs up a lane or alley from one level to the next, `x0` to `x1` between its walls, up to the terrace edge on `edge`. */
function laneStair(x0: number, x1: number, edge: number, from: number): MapStair {
  const run = 3.3;
  return { x: (x0 + x1) / 2, z: edge - 0.15 + run, width: x1 - x0 - 0.5, climbs: '-z', y0: from, y1: from + 3 };
}

/** A terrace's edge across the town: the 4 m north of `edge`, up to the level above. */
function terrace(edge: number, below: number): MapBox {
  return { minX: WEST, maxX: EAST, minZ: edge - 4, maxZ: edge - 0.15, y0: below - 0.5, y1: below + 3, walk: true };
}

/** The edge wall on one side, a piece for each level, 3.5 m over its street. */
function edgeWall(x0: number, x1: number): MapBox[] {
  return [
    { minX: x0, maxX: x1, minZ: EDGE_LOWER, maxZ: SEA + 0.5, y0: HARBOUR - 0.5, y1: HARBOUR + 3.5 },
    { minX: x0, maxX: x1, minZ: EDGE_SQUARE, maxZ: EDGE_LOWER, y0: LOWER - 0.5 - 3, y1: LOWER + 3.5 },
    { minX: x0, maxX: x1, minZ: EDGE_HIGH, maxZ: EDGE_SQUARE, y0: SQUARE - 0.5 - 3, y1: SQUARE + 3.5 },
    { minX: x0, maxX: x1, minZ: -38, maxZ: EDGE_HIGH, y0: HIGH - 0.5 - 3, y1: HIGH + 3.5 },
  ];
}

/** A spawn at (x, z), looking toward (tx, tz). */
function spawn(x: number, z: number, tx: number, tz: number): MapSpawn {
  return { x, z, yaw: yawToward(x, z, tx, tz) };
}

// The rows of houses, south to north. Each row's lanes: the west alley
// x -68..-64, the west lane -45..-40, the middle lane -3..3 (up to the
// square) and the church lane -14..-9 (above it), the east lane 40..45 and
// the east alley 64..68.

/** The harbour front: z 32..44, on the harbour, facing the quay; first storeys onto the lower street. */
const h1 = HARBOUR + FLOOR;
const HARBOUR_ROW: MapBuilding[] = [
  house({ x0: -64, x1: -54, z0: 32, z1: 44, floor: h1, storeys: 2, back: 6.5, openings: [op('-x', 7, 'door'), op('-x', 4, 'window', 1)] }),
  house({ x0: -54, x1: -45, z0: 32, z1: 44, floor: h1, storeys: 3, back: 6, openings: [op('+x', 8, 'door'), op('+x', 6, 'window', 1), op('+x', 6, 'window', 2)] }),
  house({
    x0: -40, x1: -28, z0: 32, z1: 44, floor: h1, storeys: 2, back: 7.5,
    openings: [op('-x', 6, 'window'), op('+z', 6, 'door', 1)],
    balconies: [{ side: '+z', storey: 1, at: 6, width: 3.2, depth: 1.4 }],
  }),
  house({ x0: -28, x1: -16, z0: 32, z1: 44, floor: h1, storeys: 1, roof: 'flush' }),
  // Over the middle lane where it leaves the quay, a room joining this house to the next.
  house({
    x0: -16, x1: -3, z0: 32, z1: 44, floor: h1, storeys: 3, back: 7, west: true,
    openings: [op('+x', 6, 'door')],
    more: [{
      minX: -3, maxX: 3, minZ: 38, maxZ: 44, storeys: 2, from: 1,
      openings: [op('-x', 3, 'door', 1), op('+x', 3, 'door', 1), op('+z', 3, 'window', 1), op('-z', 3, 'window', 1)],
    }],
  }),
  house({ x0: 3, x1: 15, z0: 32, z1: 44, floor: h1, storeys: 2, back: 7.5, openings: [op('-x', 6, 'door', 0)] }),
  house({ x0: 15, x1: 27, z0: 32, z1: 44, floor: h1, storeys: 2, back: 5.9, roof: 'outside' }),
  house({ x0: 27, x1: 40, z0: 32, z1: 44, floor: h1, storeys: 1, roof: 'flush', openings: [op('+x', 6, 'door')] }),
  house({ x0: 45, x1: 55, z0: 32, z1: 44, floor: h1, storeys: 3, back: 6.5, openings: [op('-x', 6, 'window'), op('-x', 6, 'window', 1)] }),
  house({ x0: 55, x1: 64, z0: 32, z1: 44, floor: h1, storeys: 2, back: 6, openings: [op('+x', 7, 'door')] }),
];

/** Below the square: z 8..22, on the lower street; first storeys onto the square's street, and the square over the one-storey roofs. */
const h2 = LOWER + FLOOR;
const LOWER_ROW: MapBuilding[] = [
  house({ x0: -64, x1: -54, z0: 8, z1: 22, floor: h2, storeys: 2, back: 6.5, openings: [op('-x', 8, 'door')] }),
  // Over the west lane, a room joining this house to the next.
  house({
    x0: -54, x1: -45, z0: 8, z1: 22, floor: h2, storeys: 2, back: 6, door: 3.5, west: true,
    openings: [op('+x', 11.5, 'door')],
    more: [{
      minX: -45, maxX: -40, minZ: 12, maxZ: 18, storeys: 2, from: 1,
      openings: [op('-x', 3, 'door', 1), op('+x', 3, 'door', 1), op('+z', 2.5, 'window', 1), op('-z', 2.5, 'window', 1)],
    }],
  }),
  house({ x0: -40, x1: -26, z0: 8, z1: 22, floor: h2, storeys: 2, back: 6.5, roof: 'outside', openings: [op('-x', 11, 'window')] }),
  house({ x0: -26, x1: -14, z0: 8, z1: 22, floor: h2, storeys: 2, back: 7.5 }),
  house({ x0: -14, x1: -3, z0: 8, z1: 22, floor: h2, storeys: 1, roof: 'flush', openings: [op('+x', 9, 'door')] }),
  house({ x0: 3, x1: 13, z0: 8, z1: 22, floor: h2, storeys: 1, roof: 'flush', openings: [op('-x', 9, 'window')] }),
  house({
    x0: 13, x1: 27, z0: 8, z1: 22, floor: h2, storeys: 2, back: 7.5,
    openings: [op('+z', 4, 'door', 1)],
    balconies: [{ side: '+z', storey: 1, at: 4, width: 3.2, depth: 1.4 }],
  }),
  house({ x0: 27, x1: 40, z0: 8, z1: 22, floor: h2, storeys: 2, back: 6.5, openings: [op('+x', 9, 'door')] }),
  house({ x0: 45, x1: 64, z0: 8, z1: 22, floor: h2, storeys: 2, back: 9, openings: [op('-x', 9, 'door'), op('+x', 6, 'window')] }),
];

/** The square's row: z -24..-10, on the square's street; first storeys onto the high street. The church stands back from it. */
const h3 = SQUARE + FLOOR;
const SQUARE_ROW: MapBuilding[] = [
  house({ x0: -64, x1: -45, z0: -24, z1: -10, floor: h3, storeys: 2, back: 9, openings: [op('+x', 9, 'door'), op('-x', 7, 'window')] }),
  house({ x0: -40, x1: -27, z0: -24, z1: -10, floor: h3, storeys: 2, back: 7, openings: [op('-x', 7, 'window')] }),
  house({ x0: -27, x1: -14, z0: -24, z1: -10, floor: h3, storeys: 1, roof: 'flush', openings: [op('+x', 8, 'door')] }),
  // The church: one tall room, its roof carrying on from the high street, the bell tower in its front corner.
  {
    floor: h3,
    blocks: [{
      minX: -9, maxX: 13, minZ: -24, maxZ: -16, storeys: 1,
      openings: [op('+z', 11, 'door', 0, 2.8), op('+z', 4, 'window'), op('+z', 16, 'window'), op('-x', 4, 'door')],
    }],
    crates: [{ x: -6.5, z: -21.5 }],
  },
  house({
    x0: 13, x1: 26, z0: -24, z1: -10, floor: h3, storeys: 2, back: 6.4, roof: 'outside',
    openings: [op('-x', 11, 'door'), op('-x', 11, 'window', 1)],
  }),
  house({ x0: 26, x1: 40, z0: -24, z1: -10, floor: h3, storeys: 1, roof: 'flush', openings: [op('+x', 9, 'door')] }),
  house({ x0: 45, x1: 64, z0: -24, z1: -10, floor: h3, storeys: 2, back: 9, openings: [op('-x', 7, 'window'), op('+x', 8, 'door')] }),
];

/** The high street's row: z -56..-38, on the high street, the town's north edge behind it. */
const h4 = HIGH + FLOOR;
const HIGH_ROW: MapBuilding[] = [
  house({ x0: -68, x1: -48, z0: -56, z1: -38, floor: h4, storeys: 3, door: 12 }),
  house({
    x0: -48, x1: -28, z0: -56, z1: -38, floor: h4, storeys: 2, door: 7,
    openings: [op('+z', 14, 'door', 1)],
    balconies: [{ side: '+z', storey: 1, at: 14, width: 4, depth: 1.4 }],
  }),
  house({ x0: -28, x1: -8, z0: -56, z1: -38, floor: h4, storeys: 2, door: 13 }),
  house({
    x0: -8, x1: 12, z0: -56, z1: -38, floor: h4, storeys: 3, door: 10,
    openings: [op('+z', 10, 'door', 2)],
    balconies: [{ side: '+z', storey: 2, at: 10, width: 3.2, depth: 1.4 }],
  }),
  house({ x0: 12, x1: 32, z0: -56, z1: -38, floor: h4, storeys: 2, door: 8 }),
  house({ x0: 32, x1: 50, z0: -56, z1: -38, floor: h4, storeys: 2, door: 11 }),
  house({ x0: 50, x1: 68, z0: -56, z1: -38, floor: h4, storeys: 3, door: 7 }),
];

/** Every lane's and alley's stairs, up each terrace edge they cross. */
const LANES: [number, number][] = [[WEST, -64], [-45, -40], [40, 45], [64, EAST]];
const STAIRS: MapStair[] = [
  ...LANES.flatMap(([x0, x1]) => [laneStair(x0, x1, EDGE_LOWER, HARBOUR), laneStair(x0, x1, EDGE_SQUARE, LOWER), laneStair(x0, x1, EDGE_HIGH, SQUARE)]),
  // The middle lane up to the lower street and the square, and the church lane up to the high street.
  laneStair(-3, 3, EDGE_LOWER, HARBOUR),
  laneStair(-3, 3, EDGE_SQUARE, LOWER),
  laneStair(-14, -9, EDGE_HIGH, SQUARE),
  // Up to the roofs of houses with no hatch.
  roofStair(26, EDGE_LOWER, LOWER, h1 + 6.2),
  roofStair(-27, EDGE_SQUARE, SQUARE, h2 + 6.2),
  roofStair(25, EDGE_HIGH, HIGH, h3 + 6.2),
];

const TOWN: GameMap = {
  id: 'calabianca',
  name: 'Calabianca',
  seed: 4,
  ground: { x0: GROUND_FROM, z0: GROUND_FROM, cell: 4, heights, blend: 30 },
  // Inside the walls, the houses' backs and the sea wall, by a body's width: nobody meets the edge before the wall.
  bounds: { minX: WEST + 0.55, maxX: EAST - 0.55, minZ: NORTH + 0.55, maxZ: SEA - 0.4 },
  buildings: [...HARBOUR_ROW, ...LOWER_ROW, ...SQUARE_ROW, ...HIGH_ROW],
  walls: [
    terrace(EDGE_LOWER, HARBOUR),
    terrace(EDGE_SQUARE, LOWER),
    terrace(EDGE_HIGH, SQUARE),
    ...edgeWall(WEST - 0.3, WEST),
    ...edgeWall(EAST, EAST + 0.3),
    // The sea wall along the quay, and the quay's face down into the harbour under it.
    { minX: WEST, maxX: EAST, minZ: SEA, maxZ: SEA + 0.5, y0: HARBOUR - 0.5, y1: HARBOUR + 1.1 },
    { minX: WEST, maxX: EAST, minZ: SEA + 0.5, maxZ: 60, y0: -6, y1: HARBOUR },
    // The bell tower, in the church's front corner.
    { minX: 9, maxX: 13, minZ: -20, maxZ: -16, y0: SQUARE - 0.5, y1: SQUARE + 16 },
    // The fountain in the square.
    { minX: 0.5, maxX: 3.5, minZ: -7.5, maxZ: -4.5, y0: SQUARE - 0.3, y1: SQUARE + 0.8 },
  ],
  stairs: STAIRS,
  props: [
    // Cargo on the quay.
    { kind: 'container', minX: -24, maxX: -18, minZ: 47.5, maxZ: 49.9 },
    { kind: 'container', minX: 22, maxX: 28, minZ: 50, maxZ: 52.4 },
    { kind: 'crate', x: -40, z: 48, size: 1.4 },
    { kind: 'crate', x: -39.9, z: 47.9, size: 1.1, on: 2 },
    { kind: 'crate', x: 6, z: 49, size: 1.2 },
    { kind: 'crate', x: 48, z: 47, size: 1.4 },
    { kind: 'crate', x: -62, z: 52, size: 1.2 },
    // The lower street.
    { kind: 'crate', x: -20, z: 24.5, size: 1.2 },
    { kind: 'crate', x: 22, z: 26, size: 1.4 },
    { kind: 'crate', x: 50, z: 24, size: 1.2 },
    // The square's street.
    { kind: 'crate', x: -38, z: -2, size: 1.4 },
    { kind: 'crate', x: 30, z: 0, size: 1.2 },
    // The high street, and a lorry's box standing in it.
    { kind: 'container', minX: -24, maxX: -18, minZ: -35, maxZ: -32.6 },
    { kind: 'crate', x: 20, z: -31, size: 1.4 },
    { kind: 'crate', x: 46, z: -34, size: 1.2 },
  ],
  spawns: [
    // The quay, looking up into the town.
    ...[-56, -30, -8, 14, 36, 58].map((x) => spawn(x, 51, x, 30)),
    // The lower street.
    ...[-58, -33, -9, 9, 33, 57].map((x) => spawn(x, 25, x < 0 ? x + 10 : x - 10, 25)),
    // The square's street and the square.
    ...[-56, -30, 22, 54].map((x) => spawn(x, -3, x < 0 ? x + 10 : x - 10, -3)),
    spawn(6, -12.5, 2, 0),
    spawn(-6, 1, 2, -6),
    // The high street.
    ...[-58, -36, -12, 10, 34, 58].map((x) => spawn(x, -33, x < 0 ? x + 10 : x - 10, -33)),
    // Lanes and alleys.
    spawn(-66, 42, -66, 30),
    spawn(66, 16, 66, 0),
    spawn(-42.5, 20, -42.5, 30),
    spawn(42.5, -16, 42.5, 0),
    spawn(-11.5, -14, -11.5, 0),
    spawn(42.5, 38, 42.5, 50),
    spawn(-66, -14, -66, 0),
    spawn(-42.5, -16, -42.5, -2),
  ],
  lanes: [
    { name: 'quay', points: [[WEST, 50], [EAST, 50]] },
    { name: 'lower street', points: [[WEST, 26], [EAST, 26]] },
    { name: "square's street", points: [[WEST, -2], [EAST, -2]] },
    { name: 'high street', points: [[WEST, -32], [EAST, -32]] },
    { name: 'west alley', points: [[-66, 54], [-66, -36]] },
    { name: 'west lane', points: [[-42.5, 54], [-42.5, -36]] },
    { name: 'middle lane', points: [[0, 54], [0, -2], [2, -12], [-11.5, -16], [-11.5, -36]] },
    { name: 'east lane', points: [[42.5, 54], [42.5, -36]] },
    { name: 'east alley', points: [[66, 54], [66, -36]] },
  ],
};

/** Where the town stands on its island: the quay on the coast. */
export const CALABIANCA: GameMap = moved(TOWN, 0, 240);
