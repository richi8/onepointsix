import { yawToward } from '../geom.ts';
import type { Rect } from '../world.ts';
import { BLOCKS, BOXES, COVERS, CRATES, DECKS, FACADES, FLOORS, GRID, LEAVES, PARAPETS, ROOFS, SLOPES, SPAWNS, TURNED } from './calabianca2grid.ts';
import { moved, type GameMap, type MapBox, type MapFacade, type MapLane, type MapStone, type MapProp, type MapSpawn, type Paving } from './index.ts';
import { levelGround } from './levels.ts';

// Calabianca rebuilt (Phase 10): Deathmatch's map, laid out after the most
// played three-lane map there is, from its navigation mesh, at 1:1 with its
// units taken as 2.54 cm, a player's height there as here. The geometry is
// made by scripts/calabianca.mjs into calabianca2grid.ts: floors on a 25 cm
// grid, each a box solid down to the ground, its top a plane sloping as the
// original's roads do, but flights of steps where it's as steep as stairs;
// decks where one floor runs over another
// (the walk from short to A, over the way out of the defenders' end); houses
// standing 6 m over the floors beside them wherever there's no floor, cover
// where there's a small hole in it, the original's boxes in stone (bots go
// round them, players climb them), a parapet along the sea; the tunnels
// roofed; the double doors fixed leaves with a gap between them; the
// original's boxes that are a crate's size and square, crates.
//
// The three lanes: long A on the east, from the attackers' end through the
// double doors, past the pit, up to A; mid, from the attackers' end to the
// doors at its top, with the catwalk up out of it to short and A; and the B
// tunnels on the west, up from outside them through the upper tunnels to B,
// the lower tunnels joining them to mid. The defenders start between A and
// mid's doors, under the walk to A, and the corridor from there runs past
// mid's doors to B's.
//
// Laid out in the plan's own metres, x east and z south from the original
// overview's north-west corner, and moved onto the south coast of the island
// its seed makes, so the sea lies behind the attackers' end and the hills
// behind the rest.
//
// Its look: the houses are plastered a colour for each part of the map, so a
// player knows where they are by it (whitewash round B and the tunnels, cream
// through mid and the corridor, ochre round A and short, rose along long A
// and the pit, pale blue round the attackers' end), and dressed in stone (see
// client/blocks.ts); the parapet and the cover are stone. The ground is
// flagstones in the lanes, cobbles in the squares at the two ends and the
// sites, earth in the pit, worn along the ways through (`lanes`).

const { size: N, cell: C, step: STEP } = GRID;
/** The plan's side, metres. */
const SIZE = N * C;
/** The lowest floor's height over the sea. */
const BASE = 4.3;
/** How far under the ground the floors' boxes reach. */
const UNDER = 0.5;
/** A deck's thickness. */
const DECK = 0.4;
/** Metres an overview pixel: where the places below are measured. */
const PX = (1024 * 4.4 * 0.0254) / 1024;

/** A rectangle given in the overview's pixels, in the plan's metres. */
const px = (x0: number, y0: number, x1: number, y1: number): Rect => ({ minX: x0 * PX, maxX: x1 * PX, minZ: y0 * PX, maxZ: y1 * PX });

/** The houses' plaster, by part of the map. */
const PLASTER = {
  white: 0xf4f1ea,
  cream: 0xeee2c4,
  ochre: 0xe8bd6a,
  rose: 0xe8b09c,
  blue: 0xc8dce4,
} as const;

/** The plaster of a house standing at (x, z), by its part of the map. */
function plasterAt(x: number, z: number): number {
  const [u, v] = [x / PX, z / PX];
  if (v > 730) return PLASTER.blue;
  if (u < 300 && v < 600) return PLASTER.white;
  if (u < 300) return PLASTER.blue;
  if (u > 690 && v > 300) return PLASTER.rose;
  if (u > 570 && v < 380) return PLASTER.ochre;
  return PLASTER.cream;
}

/**
 * The places, by the names players give them, in the overview's pixels:
 * later ones over earlier, for the Deathmatch simulation's report of where
 * fights happen and the dev view.
 */
const PLACES: [string, number, number, number, number][] = [
  ['B', 55, 175, 260, 375],
  ['B site', 75, 75, 260, 180],
  ['B back', 75, 10, 140, 80],
  ['B window', 220, 110, 265, 150],
  ['B doors', 250, 200, 275, 262],
  ['CT mid', 265, 110, 575, 275],
  ['mid doors', 420, 270, 505, 385],
  ['CT spawn', 575, 150, 680, 275],
  ['catwalk', 500, 370, 620, 445],
  ['short', 610, 270, 685, 445],
  ['A site', 615, 95, 860, 195],
  ['A back', 780, 30, 930, 100],
  ['A ramp', 835, 190, 975, 330],
  ['long A', 835, 330, 975, 560],
  ['long corner', 675, 450, 835, 560],
  ['pit', 855, 585, 915, 695],
  ['long doors', 675, 550, 745, 685],
  ['outside long', 600, 620, 745, 830],
  ['mid', 435, 380, 535, 640],
  ['top mid', 395, 610, 670, 700],
  ['suicide', 395, 700, 480, 870],
  ['T spawn', 50, 740, 665, 1010],
  ['T ramp', 580, 700, 670, 1010],
  ['outside tunnels', 85, 560, 285, 760],
  ['tunnels', 140, 500, 205, 580],
  ['upper tunnels', 60, 400, 285, 505],
  ['tunnel stairs', 255, 420, 335, 505],
  ['lower tunnels', 280, 378, 445, 440],
  ['B tunnels', 90, 315, 135, 405],
];

// ---------------------------------------------------------------- the geometry

/** The grid's rows of `n` numbers, each a rectangle of cells and the rest. */
function rows(list: readonly number[], n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
const cells = (r: number[]): Rect => ({ minX: r[0] * C, maxX: r[1] * C, minZ: r[2] * C, maxZ: r[3] * C });
const height = (steps: number) => BASE + steps * STEP;
/** A house's plaster, from the middle of its box. */
const plastered = (r: Rect) => ({ colour: plasterAt((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2) });

/** The stairs, a box a step. */
const STAIR_BOXES: MapBox[] = rows(FLOORS, 5).map((r) => ({ ...cells(r), y0: BASE - UNDER, y1: height(r[4]), walk: true }));
/** The floors, flat or sloping as the original's roads do, each solid deep enough under its lowest corner. */
const FLOOR_BOXES: MapBox[] = [
  ...STAIR_BOXES,
  ...rows(SLOPES, 7).map(([i0, i1, k0, k1, top, gx, gz]): MapBox => {
    const r = cells([i0, i1, k0, k1]);
    const tilt = { x: gx / 1000, z: gz / 1000 };
    const rise = Math.abs(tilt.x) * (r.maxX - r.minX) + Math.abs(tilt.z) * (r.maxZ - r.minZ);
    return { ...r, y0: BASE - UNDER - rise, y1: BASE + top / 100, walk: true, ground: true, ...(gx || gz ? { tilt } : {}) };
  }),
];
const DECK_BOXES: MapBox[] = rows(DECKS, 5).map((r) => ({ ...cells(r), y0: height(r[4]) - DECK, y1: height(r[4]), walk: true }));
const BLOCK_BOXES: MapBox[] = rows(BLOCKS, 5).map((r) => {
  const box = { ...cells(r), y0: BASE - UNDER, y1: height(r[4]) };
  return { ...box, ...plastered(box) };
});
const PARAPET_BOXES: MapBox[] = rows(PARAPETS, 5).map((r) => ({ ...cells(r), y0: BASE - UNDER, y1: height(r[4]) }));
const COVER_BOXES: MapBox[] = rows(COVERS, 5).map((r) => ({ ...cells(r), y0: BASE - UNDER, y1: height(r[4]) }));
/** The original's boxes, stone: players climb them, bots go round; drawn as they stand (STONES) where they're box-shaped. */
const STONE_BOXES: MapBox[] = rows(BOXES, 6).map((r) => ({ ...cells(r), y0: BASE - UNDER, y1: height(r[4]), ...(r[5] ? { look: 'under' as const } : {}) }));
const STONES: MapStone[] = rows(TURNED, 7).map(([x, z, width, depth, turn, y0, y1]) => ({
  // Down into the ground under the floor round it, which may slope away from it.
  x: x / 100, z: z / 100, width: width / 100, depth: depth / 100, turn: (turn / 10) * (Math.PI / 180), y0: Math.min(height(y0) - 0.2, BASE - UNDER), y1: height(y1),
}));
const ROOF_BOXES: MapBox[] = rows(ROOFS, 6).map((r) => {
  const box = { ...cells(r), y0: height(r[4]), y1: height(r[5]) };
  return { ...box, ...plastered(box) };
});
const DOOR_LEAVES: MapBox[] = rows(LEAVES, 6).map((r) => ({
  minX: r[0] / 100, maxX: r[1] / 100, minZ: r[2] / 100, maxZ: r[3] / 100, y0: height(r[4]) - 0.2, y1: height(r[5]), look: 'doors',
}));

/** The houses' diagonal walls, straightened over the stairs of corners their boxes make. */
const FACADE_WALLS: MapFacade[] = rows(FACADES, 8).map(([x0, z0, x1, z1, out, depth, y0, y1]) => ({
  x0: x0 / 100, z0: z0 / 100, x1: x1 / 100, z1: z1 / 100, out: out / 100, depth: depth / 100, y0: height(y0), y1: height(y1),
  colour: plasterAt((x0 + x1) / 200, (z0 + z1) / 200),
}));

/** The original's boxes square and of a crate's size, as crates: bots go to them for ammunition. */
const CRATE_PROPS: MapProp[] = rows(CRATES, 4).map(([x, z, size]) => ({ kind: 'crate', x: x / 100, z: z / 100, size: size / 100 }));

/** 24 spawn points spread over the whole map, each looking along its longest way out. */
const SPAWN_POINTS: MapSpawn[] = rows(SPAWNS, 3).map(([i, k, a]) => {
  const [x, z] = [(i + 0.5) * C, (k + 0.5) * C];
  return { x, z, yaw: yawToward(x, z, x + Math.cos((a * Math.PI) / 4), z + Math.sin((a * Math.PI) / 4)) };
});

// ---------------------------------------------------------------- the ground

/** The terrain's area: the plan rounded out to the terrain's 4 m grid. */
const AREA = Math.ceil(SIZE / 4) * 4;

/** The ground beyond the map: the sea in front, the hillside rising behind and beside it. */
function beyond(x: number, z: number): number {
  if (z >= AREA + 4) return -6;
  if (z >= AREA) return BASE - ((z - AREA) / 4) * (BASE + 6);
  return Math.min(30, BASE + Math.max(0, -x, x - AREA) * 0.5 + Math.max(0, -z) * 0.75);
}

const POINTS = Math.ceil((AREA + 120) / 4) + 1;
const GROUND = levelGround({
  area: { minX: 0, maxX: AREA, minZ: 0, maxZ: AREA },
  levels: [{ minX: 0, maxX: AREA, minZ: 0, maxZ: AREA, y: BASE }],
  grid: { x0: -60, z0: -60, cols: POINTS, rows: POINTS },
  beyond,
  dug: [],
  skip: [],
  blend: 30,
});

// ---------------------------------------------------------------- the ways through

/** A polyline in the overview's pixels, in the plan's metres. */
const way = (name: string, points: [number, number][]): MapLane => ({ name, points: points.map(([u, v]) => [u * PX, v * PX] as const) });

/** The ways players take through it, worn into the paving and drawn on the dev view. */
const LANES: MapLane[] = [
  way('long A', [[550, 900], [600, 760], [700, 700], [708, 600], [708, 520], [900, 500], [900, 250], [800, 150]]),
  way('mid', [[450, 900], [480, 650], [480, 400], [470, 330], [380, 220], [270, 232], [160, 250]]),
  way('B tunnels', [[300, 900], [190, 700], [170, 540], [170, 460], [110, 420], [112, 330], [160, 250]]),
  way('lower tunnels', [[300, 470], [330, 410], [470, 410]]),
  way('short', [[480, 410], [600, 405], [650, 350], [650, 280], [700, 160]]),
  way('CT', [[380, 220], [600, 210], [700, 160]]),
];

/** Paving by place, in the overview's pixels. */
const patch = (kind: Paving, x0: number, y0: number, x1: number, y1: number) => ({ ...px(x0, y0, x1, y1), kind });

// ---------------------------------------------------------------- the map

const spread = [...FLOOR_BOXES, ...DECK_BOXES].reduce(
  (b, f) => ({ minX: Math.min(b.minX, f.minX), maxX: Math.max(b.maxX, f.maxX), minZ: Math.min(b.minZ, f.minZ), maxZ: Math.max(b.maxZ, f.maxZ) }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
);

const PLAN: GameMap = {
  id: 'calabianca-2',
  name: 'Calabianca',
  seed: 4,
  ground: GROUND.ground,
  bounds: { minX: spread.minX + 0.4, maxX: spread.maxX - 0.4, minZ: spread.minZ + 0.4, maxZ: spread.maxZ - 0.4 },
  buildings: [],
  walls: [...GROUND.terraces, ...FLOOR_BOXES, ...DECK_BOXES, ...BLOCK_BOXES, ...PARAPET_BOXES, ...COVER_BOXES, ...STONE_BOXES, ...ROOF_BOXES, ...DOOR_LEAVES],
  stairs: [],
  props: CRATE_PROPS,
  spawns: SPAWN_POINTS,
  sun: 110,
  paving: {
    area: { minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE },
    patches: [
      patch('cobbles', 50, 740, 670, 1010),
      patch('cobbles', 575, 150, 680, 275),
      patch('cobbles', 615, 30, 930, 195),
      patch('cobbles', 70, 10, 262, 180),
      patch('earth', 845, 555, 930, 705),
    ],
  },
  lanes: LANES,
  facades: FACADE_WALLS,
  stones: STONES,
  areas: PLACES.map(([name, ...r]) => ({ name, ...px(...r) })),
};

/** Where the plan's corner is moved to on the island: its middle on x = 0, the sea along its south edge. */
const [DX, DZ] = [-AREA / 2, 296 - AREA];

export const CALABIANCA_2: GameMap = moved(PLAN, DX, DZ);

/** Where a point of the original's overview, in its pixels, stands on the island. */
export function onIsland(u: number, v: number): [number, number] {
  return [u * PX + DX, v * PX + DZ];
}
