import { yawToward } from '../geom.ts';
import type { Rect } from '../world.ts';
import { moved, type Facing, type GameMap, type MapArea, type MapBox, type MapLane, type MapProp, type MapRamp, type MapSpawn, type MapStair } from './index.ts';
import { levelGround, type Level } from './levels.ts';

// Calabianca rebuilt (Phase 10): Deathmatch's map, laid out after the most
// played three-lane map there is, at 1:1, its units taken as 1.905 cm. Its
// plan is drawn below as places: rectangles of ground at one of four heights
// (the lowest, round the defenders' end and under the middle; most lanes a
// level up; the two far ends and the tunnels another; the attackers' end at
// the top), with the ramps and stairs between them. Everything inside the
// map's area that isn't a place, a ramp or a stair is solid: blocks of stone
// standing 6 m over the ground beside them, but a parapet a metre thick
// along the south, where the attackers' end looks over it to the sea, a
// ledge along the shore below it. The covered ways (the tunnels,
// the doorways) are places with a ceiling, the block carried over them.
//
// The three lanes: long A on the east, from the attackers' end through the
// double doors, past the pit, up the ramp to A; mid, down from the
// attackers' end to the doors at its top, with the catwalk up out of it to
// short and A; and the B tunnels on the west, up from the attackers' end
// through the upper tunnels to B, the lower tunnels joining them to mid.
// The defenders' end lies between A and B, the corridor past it from mid's
// doors to B's. The double doors are fixed walls with a gap between them to
// see, shoot and walk through, as there are no doors.
//
// Laid out in the plan's own metres, x east and z south from its north-west
// corner, and moved onto the south coast of the island its seed makes, so
// the sea lies in front and the hills behind.
//
// Its look: the blocks are houses plastered a colour for each part of the
// map, so a player knows where they are by it (whitewash round B and the
// tunnels, cream through mid and the corridor, ochre round A, rose along
// long A and the pit, pale blue on the attackers' side over the sea), and
// dressed in stone (see client/blocks.ts); the parapet along the sea and
// the cover are stone. The ground is flagstones in the lanes, cobbles in
// the squares at the two ends and the sites, earth in the pit, worn along
// the ways through (`lanes`).

/** The map's area: the plan's 88 m square, its corners on the terrain's 4 m grid. */
const SIZE = 88;
/** The four heights, over the sea. */
const LOW = 4.3;
const MID = 5.8;
const HIGH = 7.8;
const TOP = 9;
/** How far a block stands over the ground beside it. */
const BLOCK = 6;
/** How far the parapet along the sea stands over the ground behind it. */
const PARAPET = 1.1;
/** Where the parapet stands, a metre thick: along the south edge, behind the attackers' end. */
const SEA_SIDE = 83;
/** A doorway's height. */
const DOOR = 3;
/** A tunnel's height. */
const TUNNEL = 3.2;

/** The houses' plaster, by part of the map. */
const PLASTER = {
  white: 0xf4f1ea,
  cream: 0xeee2c4,
  ochre: 0xe8bd6a,
  rose: 0xe8b09c,
  blue: 0xc8dce4,
} as const;

/** The plaster of a block standing at (x, z): its part of the map's; none along the sea, where the parapet is stone. */
function plasterAt(x: number, z: number): number | undefined {
  if (z >= SEA_SIDE) return undefined;
  if (z >= 63) return PLASTER.blue;
  if (x < 24) return PLASTER.white;
  if (x >= 56 && z >= 38) return PLASTER.rose;
  if (x >= 50 && z < 38) return PLASTER.ochre;
  return PLASTER.cream;
}

/** A place of the plan: a rectangle of ground at height `y`, its corners on whole metres, roofed at `ceiling` if covered. */
interface Place extends Rect {
  name: string;
  y: number;
  ceiling?: number;
}

const place = (name: string, minX: number, maxX: number, minZ: number, maxZ: number, y: number, ceiling?: number): Place =>
  ({ name, minX, maxX, minZ, maxZ, y, ...(ceiling ? { ceiling } : {}) });

/** The plan, west to east and north to south. Later places over earlier ones. */
export const PLACES: Place[] = [
  // B: the platform and the site on it at the north-west corner, the lower
  // ground in front of them, the tunnels' exit into it, its double doors and
  // the window east to the corridor.
  place('B back', 7, 12, 1, 7, HIGH),
  place('B platform', 7, 14, 7, 15, HIGH),
  place('B site', 14, 21, 7, 15, HIGH),
  place('B', 6, 21, 15, 27, MID),
  place('B', 14, 19, 27, 29, MID),
  place('B', 14, 17, 29, 31, MID),
  place('B tunnels exit', 8, 11, 27, 29, MID, MID + TUNNEL + 1),
  place('B tunnels exit', 8, 11, 29, 35, HIGH, HIGH + TUNNEL),
  place('B doors', 21, 23, 17, 22, MID, MID + DOOR),
  place('B window', 21, 23, 10, 12, HIGH, HIGH + 2.2),
  // The corridor from B's doors down past the defenders' end to mid's.
  place('CT mid', 30, 41, 13, 22, LOW),
  place('CT mid', 41, 48, 18, 24, LOW),
  place('CT spawn', 48, 52, 13, 23, LOW),
  // Mid: from its doors down the length of the map to the attackers' end,
  // rising as it goes; the catwalk along its east side, a level over it at
  // the doors, and short east of it, up its stairs onto the walk to A.
  place('mid doors', 36, 41, 22, 30, LOW),
  place('mid doors', 37, 41, 30, 32, LOW, LOW + DOOR + 0.2),
  place('mid', 37, 43, 32, 37, LOW),
  place('mid', 37, 45, 47, 52, MID),
  place('catwalk', 43, 45, 32, 47, MID),
  place('short', 45, 57, 31, 36, MID),
  place('short', 52, 57, 29, 31, MID),
  place('short', 52, 57, 19, 29, HIGH),
  place('short', 52, 56, 13, 19, LOW),
  place('short', 56, 58, 13, 19, HIGH),
  // A: its site at the north-east, the bend behind it, the ground under its
  // edge to the south.
  place('A', 52, 58, 9, 13, HIGH),
  place('A', 58, 72, 9, 16, HIGH),
  place('A back', 66, 78, 3, 9, HIGH),
  place('under A', 58, 70, 16, 23, MID),
  // Long A, from the ramp up to A down to its doors and the pit beside them.
  place('long A', 70, 82, 18, 27, MID),
  place('long A', 70, 81, 27, 30, MID),
  place('long A', 70, 80, 30, 47, MID),
  place('long A', 80, 83, 42, 49, MID),
  place('long A', 76, 80, 47, 49, MID),
  place('long corner', 57, 70, 39, 47, MID),
  place('long doors', 57, 62, 47, 48, MID, MID + DOOR),
  place('long doors', 57, 62, 48, 55, MID),
  place('long doors', 57, 62, 55, 57, MID, MID + DOOR),
  place('pit', 65, 70, 47, 58, MID),
  place('pit', 70, 71, 55, 58, MID),
  place('pit', 71, 75, 53, 58, LOW),
  place('pit platform', 76, 83, 49, 56, HIGH),
  // The attackers' side of mid and long: the ground round the block at its
  // middle, out to the long doors.
  place('top mid', 33, 40, 52, 58, MID),
  place('top mid', 35, 40, 48, 52, MID),
  place('top mid', 40, 56, 52, 57, MID),
  place('outside long', 49, 62, 57, 69, MID),
  place('outside long', 49, 56, 69, 70, MID),
  place('suicide', 37, 41, 58, 74, MID),
  place('T ramp', 41, 56, 70, 74, MID),
  place('T ramp', 48, 56, 74, 81, MID),
  place('T ramp', 48, 52, 81, 84, MID),
  // The attackers' end, along the sea.
  place('T spawn', 5, 40, 74, 83, TOP),
  place('T spawn', 14, 21, 65, 74, TOP),
  place('T spawn', 21, 29, 67, 74, TOP),
  place('T spawn', 25, 29, 65, 67, TOP),
  // The B tunnels: outside them, the ledge and stairs up into them, the
  // upper tunnels, and the lower ones down their stairs to mid.
  place('outside tunnels', 8, 22, 52, 63, MID),
  place('outside tunnels', 8, 13, 63, 74, MID),
  place('tunnels ledge', 11, 21, 48, 50, HIGH),
  place('tunnels ledge', 8, 22, 50, 52, HIGH),
  place('upper tunnels', 14, 17, 42, 48, HIGH, HIGH + TUNNEL),
  place('upper tunnels', 6, 16, 35, 42, HIGH, HIGH + TUNNEL),
  place('upper tunnels', 16, 23, 37, 42, HIGH, HIGH + TUNNEL),
  place('tunnel stairs', 23, 29, 37, 42, LOW, HIGH + TUNNEL),
  place('lower tunnels', 24, 37, 32, 37, LOW, LOW + TUNNEL),
];

/** Steps of a flight's: its rise and run, as the kit's. */
const RUN = 0.55;
const RISE = 0.5;

/** A flight of steps from `y0` up to `y1` toward `climbs`, `a0`..`a1` across, its foot on the line `foot`. */
function flight(a0: number, a1: number, foot: number, climbs: Facing, y0: number, y1: number): MapStair {
  const mid = (a0 + a1) / 2;
  const width = a1 - a0 - 0.2;
  return climbs === '-z' || climbs === '+z' ? { x: mid, z: foot, width, climbs, y0, y1 } : { x: foot, z: mid, width, climbs, y0, y1 };
}

/** How far a flight from `y0` to `y1` runs. */
const runOf = (y0: number, y1: number) => Math.ceil((y1 - y0) / RISE - 1e-6) * RUN;

const STAIRS: MapStair[] = [
  // Up from B into the tunnels' exit, and from B onto its platform.
  flight(8, 11, 27, '+z', MID, HIGH),
  flight(10, 14, 15 + runOf(MID, HIGH), '-z', MID, HIGH),
  // Up from outside the tunnels onto their ledge.
  flight(14, 17, 52 + runOf(MID, HIGH), '-z', MID, HIGH),
  // The tunnel stairs, from the lower tunnels up to the upper.
  flight(37, 42, 23 + runOf(LOW, HIGH), '-x', LOW, HIGH),
  // From the catwalk up to short, and from the defenders' end up to it.
  flight(52, 57, 31, '-z', MID, HIGH),
  flight(13, 19, 52, '+x', LOW, HIGH),
  // From suicide up to the attackers' end.
  flight(37, 41, 74 - runOf(MID, TOP), '+z', MID, TOP),
  // Onto the pit's platform from long A.
  flight(76, 83, 49 - runOf(MID, HIGH), '+z', MID, HIGH),
];

const RAMPS: MapRamp[] = [
  // The corridor from B's doors down to the defenders' end, and its bay beside B's window.
  { minX: 23, maxX: 30, minZ: 13, maxZ: 22, climbs: '-x', y0: LOW, y1: MID },
  { minX: 23, maxX: 27, minZ: 10, maxZ: 13, climbs: '-x', y0: MID - (4 / 7) * (MID - LOW), y1: MID },
  // Mid rising toward the attackers' end.
  { minX: 37, maxX: 43, minZ: 37, maxZ: 47, climbs: '+z', y0: LOW, y1: MID },
  // Long A's ramp up to A, and the pit's down from long.
  { minX: 72, maxX: 78, minZ: 9, maxZ: 18, climbs: '-z', y0: MID, y1: HIGH },
  { minX: 71, maxX: 75, minZ: 47, maxZ: 53, climbs: '-z', y0: LOW, y1: MID },
  // From outside the tunnels and from mid's side up to the attackers' end.
  { minX: 8, maxX: 13, minZ: 63, maxZ: 74, climbs: '+z', y0: MID, y1: TOP },
  { minX: 40, maxX: 48, minZ: 74, maxZ: 84, climbs: '-x', y0: MID, y1: TOP },
];

// ---------------------------------------------------------------- the plan, a metre at a time

/** What a metre of the area is: solid; or open, with the ground's height there, the highest it reaches (a ramp's or stair's top) and its ceiling. */
interface Cell {
  open: boolean;
  y: number;
  top: number;
  ceiling: number;
}

const cells: Cell[] = Array.from({ length: SIZE * SIZE }, () => ({ open: false, y: LOW, top: LOW, ceiling: Infinity }));
const cellAt = (x: number, z: number) => cells[Math.floor(z) * SIZE + Math.floor(x)];
const each = (r: Rect, f: (c: Cell, x: number, z: number) => void) => {
  for (let z = Math.floor(r.minZ); z < Math.ceil(r.maxZ); z++) for (let x = Math.floor(r.minX); x < Math.ceil(r.maxX); x++) f(cells[z * SIZE + x], x, z);
};
for (const p of PLACES) {
  each(p, (c) => {
    c.open = true;
    c.y = c.top = p.y;
    c.ceiling = p.ceiling ?? Infinity;
  });
}
const stairRect = (s: MapStair): Rect => {
  const run = runOf(s.y0, s.y1);
  const h = s.width / 2 + 0.1;
  switch (s.climbs) {
    case '-z': return { minX: s.x - h, maxX: s.x + h, minZ: s.z - run, maxZ: s.z };
    case '+z': return { minX: s.x - h, maxX: s.x + h, minZ: s.z, maxZ: s.z + run };
    case '-x': return { minX: s.x - run, maxX: s.x, minZ: s.z - h, maxZ: s.z + h };
    case '+x': return { minX: s.x, maxX: s.x + run, minZ: s.z - h, maxZ: s.z + h };
  }
};
for (const s of STAIRS) each(stairRect(s), (c) => (c.top = Math.max(c.top, s.y1)));
for (const r of RAMPS) {
  each(r, (c) => {
    if (!c.open) Object.assign(c, { open: true, y: Math.min(r.y0, r.y1), ceiling: Infinity });
    c.top = Math.max(c.top, r.y1);
  });
}

/** The ground's height at (x, z) in the plan: its place's, or the lowest under a block. */
function levelOf(x: number, z: number): number {
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return LOW;
  return cellAt(x, z).y;
}

/** The highest any open ground reaches within `r` metres of the cell at (x, z). */
function highestNear(x: number, z: number, r: number): number {
  let top = -Infinity;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const [cx, cz] = [x + dx, z + dz];
      if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) continue;
      const c = cells[cz * SIZE + cx];
      if (c.open) top = Math.max(top, c.top);
    }
  }
  return top;
}

/** Each solid metre's top: a block over the ground beside it, or the parapet along the sea; and each covered metre's roof from its ceiling up to the same. */
function solidTop(x: number, z: number): number {
  if (z >= SEA_SIDE) return Math.max(LOW, highestNear(x, z, 6)) + PARAPET;
  const near = highestNear(x, z, 4);
  return Number.isFinite(near) ? near + BLOCK : TOP + BLOCK;
}

/** Boxes over the cells `want` gives a span for, plastered as the cells are, merged along rows and then down the rows they match. */
function merged(want: (x: number, z: number) => [number, number] | null): MapBox[] {
  const out: MapBox[] = [];
  let open: MapBox[] = [];
  const box = (minX: number, z: number, span: [number, number], colour: number | undefined): MapBox =>
    ({ minX, maxX: minX + 1, minZ: z, maxZ: z + 1, y0: span[0], y1: span[1], ...(colour !== undefined ? { colour } : {}) });
  for (let z = 0; z < SIZE; z++) {
    const rows: MapBox[] = [];
    for (let x = 0; x < SIZE; x++) {
      const span = want(x, z);
      if (!span) continue;
      const colour = plasterAt(x + 0.5, z + 0.5);
      const last = rows[rows.length - 1];
      if (last && last.maxX === x && last.y0 === span[0] && last.y1 === span[1] && last.colour === colour) last.maxX = x + 1;
      else rows.push(box(x, z, span, colour));
    }
    const next: MapBox[] = [];
    for (const row of rows) {
      const k = open.findIndex((b) => b.minX === row.minX && b.maxX === row.maxX && b.y0 === row.y0 && b.y1 === row.y1 && b.colour === row.colour);
      if (k >= 0) {
        open[k].maxZ = z + 1;
        next.push(open.splice(k, 1)[0]);
      } else {
        out.push(row);
        next.push(row);
      }
    }
    open = next;
  }
  return out;
}

/** Behind the parapet, a ledge along the sea at the lowest height, out of bounds, so the sea shows over the parapet. */
const BLOCKS = merged((x, z) => (cellAt(x, z).open || z > SEA_SIDE ? null : [LOW - 0.5, solidTop(x, z)]));
const ROOFS = merged((x, z) => {
  const c = cellAt(x, z);
  return c.open && Number.isFinite(c.ceiling) ? [c.ceiling, highestNear(x, z, 4) + BLOCK] : null;
});

// ---------------------------------------------------------------- the ground

/** The ground beyond the map: the sea in front, the hillside rising behind and beside it. */
function beyond(x: number, z: number): number {
  if (z >= SIZE + 4) return -6;
  if (z >= SIZE) return LOW - ((z - SIZE) / 4) * (LOW + 6);
  const cx = Math.min(SIZE - 0.5, Math.max(0.5, x));
  const cz = Math.min(SIZE - 0.5, Math.max(0.5, z));
  return Math.min(30, levelOf(cx, cz) + Math.max(0, -x, x - SIZE) * 0.5 + Math.max(0, -z) * 0.75);
}

const LEVELS: Level[] = [{ minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE, y: LOW }, ...PLACES];

/** The ground grid: every 4 m from (-60, -60), 53 points a side. */
const GROUND = levelGround({
  area: { minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE },
  levels: LEVELS,
  grid: { x0: -60, z0: -60, cols: 53, rows: 53 },
  beyond,
  dug: [],
  skip: [...RAMPS, ...BLOCKS],
  blend: 30,
});

// ---------------------------------------------------------------- cover

/** A box of stone over the rectangle, `h` over the ground there; one `walk`ed on if it's to be stood on. */
function cover(minX: number, maxX: number, minZ: number, maxZ: number, h: number, walk = false): MapBox {
  const y = levelOf((minX + maxX) / 2, (minZ + maxZ) / 2);
  return { minX, maxX, minZ, maxZ, y0: y - 0.4, y1: y + h, ...(walk ? { walk } : {}) };
}

/** A wall from the ground at `y` up to `y1`, its thickness along whichever side is the thinner. */
const wall = (minX: number, maxX: number, minZ: number, maxZ: number, y: number, y1: number): MapBox => ({ minX, maxX, minZ, maxZ, y0: y - 0.2, y1 });

/** A door's leaf, fixed: a wall drawn as an old wooden door. */
const leaf = (minX: number, maxX: number, minZ: number, maxZ: number, y: number, y1: number): MapBox => ({ ...wall(minX, maxX, minZ, maxZ, y, y1), look: 'doors' });

/** The double doors: each pair of leaves a fixed wall with a gap between them. */
const DOORS: MapBox[] = [
  leaf(21.9, 22.1, 17, 19.3, MID, MID + DOOR), leaf(21.9, 22.1, 20.7, 22, MID, MID + DOOR),
  leaf(37, 38.3, 30.9, 31.1, LOW, LOW + DOOR + 0.2), leaf(39.7, 41, 30.9, 31.1, LOW, LOW + DOOR + 0.2),
  leaf(57, 59, 47.4, 47.6, MID, MID + DOOR), leaf(60.4, 62, 47.4, 47.6, MID, MID + DOOR),
  leaf(57, 59, 55.9, 56.1, MID, MID + DOOR), leaf(60.4, 62, 55.9, 56.1, MID, MID + DOOR),
];

const COVER: MapBox[] = [
  // B.
  cover(9.5, 11, 1.5, 3.5, 1.2), cover(7, 8.5, 6.5, 8, 1),
  cover(16.5, 18, 8.5, 10, 1.1), cover(15, 16.5, 12.5, 14, 1.1),
  cover(12, 14, 17.5, 19.5, 1.4), cover(15.5, 19.5, 24.5, 26.5, 1.3),
  // The corridor past the defenders' end, and the defenders' end.
  cover(31, 40, 13.2, 15, 1.8), cover(24.5, 26.5, 20.5, 22, 1.1), cover(46.5, 48, 16.5, 18.5, 1.3),
  // Mid's box under the catwalk, and the top of mid.
  cover(40.5, 42, 33, 35, 1.2, true), cover(35.2, 37, 48, 50, 1.2),
  // The tunnels.
  cover(24.2, 27, 32.3, 33.8, 1.1), cover(30.5, 32, 35.3, 37, 1),
  cover(6, 8, 35, 37, 1.4), cover(12, 13.5, 37.5, 39, 1.1),
  cover(19, 21, 60, 62.5, 1.3),
  // The attackers' end: a stack against the wall north, a cart along the sea.
  cover(27, 28.5, 69.5, 74, 2.2), cover(8, 11.5, 77.5, 79, 1.3),
  // Mid's attackers' side and outside long.
  cover(37.3, 38.8, 62.5, 64.8, 1.2), cover(58.5, 60.5, 60.5, 64, 1.4),
  // Long A: the big box at its corner, the car near its top.
  cover(61.5, 66.5, 39, 41.5, 1.6), cover(76, 78.5, 21, 25, 1.4),
  // A: the platform on the site, the boxes behind it and at short.
  cover(65.5, 71, 11.5, 15.5, 1.6, true), cover(58.5, 61.5, 9.5, 11, 1.2), cover(52.5, 54.5, 23, 24.5, 1.1),
  cover(58.2, 62, 16.3, 17.8, 1.2),
];

/** The rail along short's top over the defenders' end, and the low wall between A and its ramp. */
const RAILS: MapBox[] = [
  wall(52, 52.3, 19, 23, HIGH, HIGH + 1),
  wall(71.6, 72, 9, 16.5, HIGH, HIGH + 1.1),
];

const PROPS: MapProp[] = [
  { kind: 'crate', x: 19.5, z: 13.2, size: 1.2 },
  { kind: 'crate', x: 60.7, z: 49.2, size: 1.4 },
  { kind: 'crate', x: 60.7, z: 49.2, size: 1.1, on: 1 },
  { kind: 'crate', x: 43.8, z: 22.5, size: 1.2 },
  { kind: 'crate', x: 60.9, z: 68.3, size: 1.2 },
  { kind: 'crate', x: 14, z: 65.8, size: 1.3 },
  { kind: 'crate', x: 66.8, z: 39.2, size: 1.2 },
];

// ---------------------------------------------------------------- spawns

/** A spawn at (x, z), looking toward (tx, tz). */
function spawn(x: number, z: number, tx: number, tz: number): MapSpawn {
  return { x, z, yaw: yawToward(x, z, tx, tz) };
}

/** 24 spawn points round the whole map, each looking along its way out. */
const SPAWNS: MapSpawn[] = [
  // The attackers' end and outside the tunnels.
  spawn(11, 80, 30, 78), spawn(22, 79, 40, 78), spawn(34, 78, 45, 78), spawn(18, 70, 18, 80),
  spawn(12, 57, 15, 52), spawn(20, 55, 15, 52),
  // Long's corner, B.
  spawn(60, 43, 75, 43), spawn(9.5, 4, 10, 15), spawn(8.5, 23, 20, 20), spawn(18.5, 11, 10, 11),
  // The corridor, the defenders' end and mid's doors.
  spawn(32, 18.5, 45, 20), spawn(50, 16, 40, 20), spawn(38.5, 25, 38.5, 35), spawn(30, 34.5, 37, 34.5),
  // A and long.
  spawn(74, 5, 62, 7), spawn(61, 13, 70, 12), spawn(80, 21, 75, 40), spawn(75, 35, 75, 20),
  spawn(64, 20, 72, 20),
  // The pit, outside long and the attackers' side of mid.
  spawn(73, 56.5, 73, 47), spawn(80, 53, 70, 45), spawn(53, 66, 53, 55), spawn(52, 78, 50, 70), spawn(35, 55, 40, 50),
];

// ---------------------------------------------------------------- the ways through

/** The ways players take through it, worn into the paving and drawn on the dev view. */
const LANES: MapLane[] = [
  { name: 'long A', points: [[52, 78], [52, 62], [59, 52], [74, 45], [75, 25], [75, 12], [66, 10]] },
  { name: 'mid', points: [[38, 72], [38, 55], [40, 42], [39, 28], [36, 18], [26, 17], [15, 21]] },
  { name: 'B tunnels', points: [[26, 78], [11, 70], [15, 57], [15, 46], [10, 39], [9.5, 30], [11, 22], [16, 11]] },
  { name: 'lower tunnels', points: [[22, 40], [30, 34.5], [39, 34.5]] },
  { name: 'short', points: [[44, 42], [44, 34], [54, 33], [54.5, 24], [56, 12]] },
  { name: 'CT', points: [[36, 18], [50, 18], [54, 15], [60, 12]] },
];

// ---------------------------------------------------------------- the map

const PLAN: GameMap = {
  id: 'calabianca-2',
  name: 'Calabianca',
  seed: 4,
  ground: GROUND.ground,
  bounds: { minX: 5.4, maxX: 82.6, minZ: 1.4, maxZ: 83.6 },
  buildings: [],
  walls: [...GROUND.terraces, ...BLOCKS, ...ROOFS, ...DOORS, ...RAILS, ...COVER],
  stairs: STAIRS,
  ramps: RAMPS,
  props: PROPS,
  spawns: SPAWNS,
  sun: 110,
  paving: {
    area: { minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE },
    patches: [
      { minX: 5, maxX: 41, minZ: 65, maxZ: 84, kind: 'cobbles' },
      { minX: 30, maxX: 52, minZ: 13, maxZ: 24, kind: 'cobbles' },
      { minX: 52, maxX: 79, minZ: 3, maxZ: 16, kind: 'cobbles' },
      { minX: 6, maxX: 22, minZ: 1, maxZ: 15, kind: 'cobbles' },
      { minX: 65, maxX: 76, minZ: 47, maxZ: 58, kind: 'earth' },
    ],
  },
  lanes: LANES,
  areas: PLACES.map(({ name, minX, maxX, minZ, maxZ }): MapArea => ({ name, minX, maxX, minZ, maxZ })),
};

/** Where the map stands on its island: its middle on x = 0, the sea along its south edge. */
export const CALABIANCA_2: GameMap = moved(PLAN, -SIZE / 2, 296 - SIZE);
