// The sketch of Calabianca rebuilt (chunk 55): the town as planned, drawn
// from above before it's built, in the map's own coordinates (round (0, 0),
// north up the hill at -z, the sea south at +z, before `moved()` puts it on
// its island). Not a map: nothing here is built. The blockout (chunk 57)
// follows it, and dev/map.html?sketch draws it over the built town.
//
// The town turns round three hubs, the market, the piazza and the palazzo's
// courtyard, each pair joined by an open way, a tight one and one through a
// building. Round them, districts that play and look different: the west's
// steep stepped alleys, the east's road in hairpins and the olive garden, the
// quay split by the warehouse, the cemetery and the villa at the top.

export type District = 'west' | 'quay' | 'market' | 'piazza' | 'east' | 'top';
export type RouteKind = 'open' | 'tight' | 'through' | 'roof';

export interface SketchRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The ground's height over a rectangle, or a ramp along x or z from `y` at its low end (x0 or z0) to `y2`. */
export interface SketchGround extends SketchRect {
  y: number;
  y2?: number;
  along?: 'x' | 'z';
}

/**
 * A building: its footprint, the floor of its ground storey and its
 * storeys. Roofs are flat (walked, behind parapets) or pitched (tiled, out of
 * reach). `court` leaves a courtyard open inside it, `arcade` opens its
 * ground storey between pillars on that side, and `arches` carry ways
 * through its ground storey.
 */
export interface SketchBuilding extends SketchRect {
  name?: string;
  district: District;
  floor: number;
  storeys: number;
  roof: 'flat' | 'pitched';
  court?: SketchRect;
  arcade?: 'x0' | 'x1' | 'z0' | 'z1';
  arches?: SketchRect[];
  /** Storeys 6 m tall instead of 3 (the church). */
  tall?: boolean;
}

/** A room over a lane, joining the buildings either side at `storey`. */
export interface SketchBridge extends SketchRect {
  district: District;
  floor: number;
}

/** Stairs climbing from `from` to `to` toward `up`. */
export interface SketchStair extends SketchRect {
  from: number;
  to: number;
  up: '+x' | '-x' | '+z' | '-z';
}

export interface SketchProp extends SketchRect {
  label: string;
  /** Round (trees), else a box. */
  round?: boolean;
  height: number;
}

export interface SketchRoute {
  kind: RouteKind;
  name: string;
  points: [number, number][];
}

export interface SketchView {
  name: string;
  from: [number, number];
  to: [number, number];
}

export interface SketchPlace {
  name: string;
  x: number;
  z: number;
  hub?: boolean;
}

export interface SketchSpawnZone {
  name: string;
  x: number;
  z: number;
  /** The four spawn points' spread. */
  r: number;
}

export interface Sketch {
  bounds: SketchRect;
  /** Where `moved()` puts the town on its island. */
  at: { x: number; z: number };
  ground: SketchGround[];
  buildings: SketchBuilding[];
  bridges: SketchBridge[];
  stairs: SketchStair[];
  props: SketchProp[];
  routes: SketchRoute[];
  views: SketchView[];
  places: SketchPlace[];
  spawns: SketchSpawnZone[];
}

export const DISTRICT_COLOURS: Record<District, string> = {
  west: '#f2efe6', // whitewash
  quay: '#8fa6b4', // weathered blue-grey
  market: '#dba84a', // ochre
  piazza: '#e8d8b0', // cream stone
  east: '#d9907a', // terracotta pink
  top: '#b4b39c', // grey-green stone
};

const r = (x0: number, x1: number, z0: number, z1: number): SketchRect => ({ x0, x1, z0, z1 });
const b = (name: string | undefined, district: District, x0: number, x1: number, z0: number, z1: number, floor: number, storeys: number, roof: 'flat' | 'pitched', more: Partial<SketchBuilding> = {}): SketchBuilding =>
  ({ ...(name ? { name } : {}), district, x0, x1, z0, z1, floor, storeys, roof, ...more });
const stair = (x0: number, x1: number, z0: number, z1: number, from: number, to: number, up: SketchStair['up']): SketchStair => ({ x0, x1, z0, z1, from, to, up });
const prop = (label: string, x0: number, x1: number, z0: number, z1: number, height: number, round = false): SketchProp => ({ label, x0, x1, z0, z1, height, ...(round ? { round } : {}) });
const tree = (x: number, z: number) => prop('olive', x - 1.5, x + 1.5, z - 1.5, z + 1.5, 4, true);

export const SKETCH: Sketch = {
  bounds: r(-68, 68, -56, 55.6),
  at: { x: 0, z: 240 },

  // Later rectangles lie over earlier ones.
  ground: [
    // The quay, the boat yard and the foot of the road.
    { ...r(-68, 68, 40, 55.6), y: 3 },
    { ...r(-36, 14, 32, 42), y: 3 },
    { ...r(14, 30, 34, 42), y: 3 },
    { ...r(36, 68, 32, 42), y: 3 },
    // The west's alleys, climbing a level every 20 m or so, not where the middle does.
    { ...r(-68, -30, 23, 40), y: 6 },
    { ...r(-68, -30, 1, 23), y: 9 },
    { ...r(-68, -30, -30, 1), y: 12 },
    // The market, the hotel, the Via del Porto and the road's lower hairpin.
    { ...r(-30, 14, 14, 32), y: 6 },
    { ...r(14, 36, 14, 34), y: 6 },
    { ...r(-30, 14, 4, 14), y: 6 },
    { ...r(14, 36, 4, 14), y: 6 },
    // The road's legs, the cottages between them and the olive garden.
    // The first leg climbs west from the quay's east end to Via del Porto.
    { ...r(36, 62, 32, 38), y: 6, y2: 3, along: 'x' },
    { ...r(36, 62, 16, 32), y: 6, y2: 9, along: 'x' },
    { ...r(62, 68, -8, 32), y: 9 },
    { ...r(38, 62, -2, 16), y: 9 },
    { ...r(36, 62, -8, -2), y: 12, y2: 9, along: 'x' },
    // The piazza, the belvedere and what stands round them.
    { ...r(-30, 38, -42, 4), y: 12 },
    { ...r(38, 62, -34, -8), y: 12 },
    { ...r(62, 68, -34, -8), y: 15, y2: 9, along: 'z' },
    // The top: the high street, the cemetery and the villa.
    { ...r(-36, 4, -56, -36), y: 15 },
    { ...r(4, 68, -56, -42), y: 15 },
    { ...r(36, 68, -42, -34), y: 15 },
    { ...r(-68, -36, -56, -30), y: 15 },
    { ...r(-36, -30, -36, -30), y: 12 },
    { ...r(30, 36, 34, 42), y: 3 },
    { ...r(36, 38, -2, 16), y: 9 },
    { ...r(36, 38, 4, 14), y: 6 },
  ],

  buildings: [
    // West: the alleys' houses, narrow and tall, mostly pitched, a few flat roofs to fight over.
    b(undefined, 'west', -68, -62, 25, 40, 6.1, 2, 'pitched'),
    b(undefined, 'west', -59, -51, 28, 40, 6.1, 2, 'flat'),
    b(undefined, 'west', -51, -39, 26, 40, 6.1, 3, 'pitched'),
    b(undefined, 'west', -36, -30, 26, 32, 6.1, 1, 'flat'),
    b(undefined, 'west', -68, -61, 10, 25, 9.1, 2, 'pitched'),
    b(undefined, 'west', -61, -54, 10, 25, 9.1, 1, 'flat'),
    b(undefined, 'west', -51, -39, 19, 26, 6.1, 2, 'flat'),
    b(undefined, 'west', -51, -39, 4, 16, 9.1, 2, 'pitched'),
    b(undefined, 'west', -36, -30, 1, 23, 9.1, 2, 'flat'),
    b(undefined, 'west', -65, -51, -9, 7, 12.1, 2, 'pitched'),
    b('Casa Alta', 'west', -48, -30, -16, 1, 12.1, 3, 'flat'),
    b(undefined, 'west', -68, -60, -28, -12, 12.1, 2, 'pitched'),
    b(undefined, 'west', -60, -54, -24, -12, 12.1, 1, 'flat'),
    b(undefined, 'west', -51, -40, -30, -19, 12.1, 2, 'pitched'),
    b(undefined, 'west', -40, -30, -30, -19, 12.1, 2, 'flat'),
    // The quay: the houses along it (dug into the market's level), the boat shed, the warehouse across it, the fish market.
    b(undefined, 'quay', -36, -24, 32, 42, 3.1, 2, 'flat'),
    b('Albergo del Porto', 'quay', -24, -6, 32, 45, 3.1, 3, 'pitched'),
    b(undefined, 'quay', 0, 14, 32, 39, 3.1, 2, 'flat'),
    b(undefined, 'quay', 18, 30, 34, 42, 3.1, 2, 'flat'),
    b('boat shed', 'quay', -56, -44, 44, 54, 3.1, 2, 'pitched', { arches: [r(-56, -44, 46, 52)] }),
    b('warehouse', 'quay', 20, 40, 46, 55.6, 3.1, 2, 'pitched', { arches: [r(20, 40, 49, 53)] }),
    b('fish market', 'quay', 44, 58, 44, 52, 3.1, 1, 'flat', { arcade: 'z1' }),
    // The market: the loggia, the hotel, and the caffè and its neighbour under the piazza's edge.
    b('loggia', 'market', -30, -24, 14, 30, 6.1, 2, 'flat', { arcade: 'x1' }),
    b('hotel', 'market', 14, 30, 14, 30, 6.1, 3, 'flat', { arches: [r(14, 30, 20, 24)] }),
    // Out to the west's houses: a lane beside it would end at the piazza's face.
    b('caffè', 'market', -30, -12, 4, 14, 6.1, 2, 'flat'),
    b(undefined, 'market', -2, 14, 4, 14, 6.1, 3, 'pitched'),
    b(undefined, 'market', 14, 36, 4, 14, 6.1, 2, 'flat'),
    // The piazza: the church and its tower, the arcade along its east side, the old school behind.
    b('church', 'piazza', -22, 2, -36, -18, 12.1, 1, 'pitched', { tall: true }),
    b('bell tower', 'piazza', 2, 8, -24, -18, 12.1, 6, 'flat'),
    b('portico', 'piazza', 14, 30, -18, 4, 12.1, 2, 'flat', { arcade: 'x0', arches: [r(14, 30, -6, -2)] }),
    b('old school', 'piazza', 14, 30, -42, -20, 12.1, 1, 'flat', { court: r(18, 26, -36, -26) }),
    // The east: the cottages between the road's legs, the palazzo round its courtyard.
    b(undefined, 'east', 36, 44, 22, 32, 6.1, 2, 'pitched'),
    b(undefined, 'east', 44, 52, 22, 32, 7.1, 1, 'flat'),
    b(undefined, 'east', 52, 62, 22, 32, 8.1, 2, 'pitched'),
    b('palazzo', 'east', 38, 62, -34, -8, 12.1, 3, 'pitched', { court: r(46, 54, -25, -17), arches: [r(48, 52, -17, -8), r(38, 46, -22, -18), r(54, 62, -23, -19)] }),
    // The top: the high street's north side, the villa, the cemetery's chapel.
    b(undefined, 'top', -36, -22, -56, -46, 15.1, 2, 'pitched'),
    b(undefined, 'top', -22, -8, -56, -46, 15.1, 1, 'flat'),
    b(undefined, 'top', -8, 4, -56, -46, 15.1, 2, 'pitched'),
    b(undefined, 'top', 4, 20, -56, -50, 15.1, 1, 'pitched'),
    b(undefined, 'top', 20, 36, -56, -50, 15.1, 2, 'flat'),
    b('villa', 'top', 44, 58, -52, -40, 15.1, 2, 'pitched'),
    b('ruined chapel', 'top', -64, -56, -52, -44, 15.1, 1, 'flat'),
  ],

  bridges: [
    { ...r(-47, -43, 16, 19), district: 'west', floor: 12.1 },
    { ...r(-39, -36, 8, 12), district: 'west', floor: 12.1 },
  ],

  stairs: [
    // West alleys.
    stair(-62, -59, 37, 40, 3, 6, '-z'),
    stair(-39, -36, 37, 40, 3, 6, '-z'),
    stair(-54, -51, 21, 25, 6, 9, '-z'),
    stair(-39, -36, 19, 23, 6, 9, '-z'),
    stair(-68, -65, 1, 5, 9, 12, '-z'),
    stair(-51, -48, -3, 1, 9, 12, '-z'),
    stair(-54, -51, -30, -26, 12, 15, '-z'),
    // The harbour steps and the lane beside the hotel.
    stair(-6, 0, 32, 38, 3, 6, '-z'),
    stair(14, 18, 34, 40, 3, 6, '-z'),
    // The grand stair, with a landing halfway.
    stair(-12, -2, 9, 14, 6, 9, '-z'),
    stair(-12, -2, 4, 8, 9, 12, '-z'),
    // Up to the high street: beside the church each side, the lane from the belvedere, the back stairs.
    stair(-30, -22, -36, -32, 12, 15, '-z'),
    stair(8, 14, -40, -36, 12, 15, '-z'),
    stair(30, 38, -42, -38, 12, 15, '-z'),
    stair(62, 68, -14, -10, 9, 12, '-z'),
    stair(62, 68, -32, -28, 12, 15, '-z'),
    // Into the garden from the road's legs.
    stair(46, 50, 13, 16, 7.5, 9, '-z'),
    stair(40, 44, -2, 1, 9, 11.5, '-z'),
  ],

  props: [
    prop('truck', -12, -3, 20, 23, 3),
    prop('stall', -20, -17, 26, 28, 2.2),
    prop('stall', -14, -11, 27, 29, 2.2),
    prop('stall', 2, 5, 25, 27, 2.2),
    prop('stall', 6, 9, 17, 19, 2.2),
    prop('fountain', -11, -5, -11, -5, 1),
    // The piazza broken up: plane trees, a war memorial, the newsstand.
    prop('plane', -26, -21, -14, -9, 6, true),
    prop('plane', -26, -21, -3, 2, 6, true),
    prop('memorial', -17, -14, -2, 1, 2.5),
    prop('kiosk', 4, 8, -12, -8, 2.6),
    prop('boat', -66, -60, 44, 47, 2.5),
    prop('boat', -64, -58, 51, 54, 2.5),
    prop('container', -26, -20, 47, 49.5, 2.6),
    prop('container', 2, 8, 50, 52.5, 2.6),
    prop('container', -6, -3.5, 45, 51, 2.6),
    prop('crates', 60, 63, 46, 49, 2),
    prop('water tower', 60, 66, -54, -48, 14),
    ...[[-60, -40], [-54, -40], [-48, -40], [-60, -34], [-48, -34], [-42, -48], [-42, -38]].map(([x, z]) => prop('tomb', x - 1.5, x + 1.5, z - 1, z + 1, 1.8)),
    ...[[42, 4], [50, 2], [56, 7], [44, 11], [53, 12], [60, 2]].map(([x, z]) => tree(x, z)),
    prop('wall', 38, 58, 7.5, 8.2, 1),
  ],

  routes: [
    // The market and the piazza.
    { kind: 'open', name: 'grand stair', points: [[-6, 22], [-7, 14], [-7, 4], [-8, -8]] },
    { kind: 'tight', name: 'west alleys', points: [[-6, 22], [-22, 24], [-33, 24.5], [-37.5, 24.5], [-37.5, 2.5], [-49.5, 2.5], [-49.5, -17.5], [-30, -17.5], [-8, -8]] },
    { kind: 'through', name: 'caffè', points: [[-6, 22], [-19, 15], [-19, 6], [-19, 2], [-8, -8]] },
    // The piazza and the palazzo.
    { kind: 'open', name: 'portico and belvedere', points: [[-8, -8], [14, -4], [34, -4], [44, -5], [50, -8], [50, -21]] },
    { kind: 'tight', name: 'high street', points: [[-8, -8], [11, -20], [11, -44], [20, -46], [34, -46], [34, -20], [38, -20], [50, -21]] },
    { kind: 'through', name: 'portico rooms', points: [[-8, -8], [14, -12], [30, -12], [38, -14], [50, -21]] },
    // The market and the palazzo.
    { kind: 'open', name: 'hairpins', points: [[-6, 22], [14, 22], [33, 22], [33, 19], [48, 19], [48, 14], [48, 0], [50, -8], [50, -21]] },
    { kind: 'tight', name: 'Via del Porto and the back stairs', points: [[-6, 22], [6, 32], [33, 32], [33, 19], [65, 19], [65, -8], [65, -21], [62, -21], [50, -21]] },
    { kind: 'through', name: 'hotel and terrace', points: [[-6, 22], [16, 18], [30, 16], [33, 14], [30, 9], [30, 4], [34, -4], [38, -14], [50, -21]] },
    // Round the edge: the outer alley, the quay, the road's foot, the top.
    { kind: 'tight', name: 'outer alley', points: [[-60.5, 44], [-60.5, 26.5], [-52.5, 26.5], [-52.5, 8.5], [-66.5, 8.5], [-66.5, -10.5], [-52.5, -10.5], [-52.5, -36]] },
    { kind: 'open', name: 'quay', points: [[-62, 50], [-36, 50], [18, 50], [20, 51], [40, 51], [60, 50], [65, 44], [65, 35], [60, 35], [36, 35], [33, 32]] },
    { kind: 'open', name: 'top', points: [[-52, -36], [-52, -42], [-36, -41], [4, -41], [4, -46], [36, -46], [40, -46], [40, -37], [60, -37], [65, -34], [65, -21]] },
    // The roofs: chosen ones, reached and exposed.
    { kind: 'roof', name: 'quay roofs', points: [[-33, 37], [-27, 37], [7, 37]] },
    { kind: 'roof', name: 'piazza terraces', points: [[-24, 9], [-14, 9], [-2, 9]] },
    { kind: 'roof', name: 'belvedere terrace', points: [[18, 9], [34, 9], [34, 2]] },
    { kind: 'roof', name: 'hotel roof', points: [[17, 17], [27, 27]] },
    { kind: 'roof', name: 'old school roof', points: [[18, -40], [22, -24]] },
    { kind: 'roof', name: 'Casa Alta roof', points: [[-46, -14], [-32, -2]] },
  ],

  // The long views meant to be there; every other street bends, tees or meets a building first.
  views: [
    { name: 'quay', from: [-34, 50], to: [18, 50] },
    { name: 'grand stair', from: [-7, 28], to: [-7, -14] },
    { name: 'hotel roof', from: [16, 22], to: [-26, 22] },
    { name: 'high street west', from: [-36, -41], to: [4, -41] },
    { name: 'high street east', from: [4, -46], to: [36, -46] },
    { name: 'leg 1', from: [36, 35], to: [62, 35] },
    { name: 'leg 2', from: [36, 19], to: [62, 19] },
    { name: 'leg 3', from: [38, -5], to: [62, -5] },
    { name: 'garden', from: [40, 1], to: [61, 14] },
  ],

  places: [
    { name: 'MARKET', x: -6, z: 22, hub: true },
    { name: 'PIAZZA', x: -8, z: -8, hub: true },
    { name: 'COURTYARD', x: 50, z: -21, hub: true },
    { name: 'boat yard', x: -52, z: 41 },
    { name: 'quay', x: -10, z: 47 },
    { name: 'Via del Porto', x: 22, z: 32 },
    { name: 'belvedere', x: 34, z: 1 },
    { name: 'olive garden', x: 50, z: 5 },
    { name: 'high street', x: -16, z: -40 },
    { name: 'cemetery', x: -52, z: -40 },
    { name: 'back stairs', x: 65, z: -21 },
  ],

  // Eight zones of four spawn points, away from the hubs.
  spawns: [
    { name: 'boat yard', x: -58, z: 47, r: 5 },
    { name: 'quay', x: -14, z: 50, r: 6 },
    { name: 'fish market', x: 56, z: 48, r: 5 },
    { name: 'alleys', x: -60, z: -1, r: 5 },
    { name: 'cemetery', x: -50, z: -46, r: 6 },
    { name: 'high street', x: -14, z: -42, r: 6 },
    { name: 'villa', x: 50, z: -38, r: 5 },
    { name: 'hairpin', x: 65, z: 8, r: 5 },
  ],
};

const overlap = (a: SketchRect, c: SketchRect) => a.x0 < c.x1 && c.x0 < a.x1 && a.z0 < c.z1 && c.z0 < a.z1;

/** What doesn't add up: buildings standing in each other or over stairs, ways on the ground running into a building (but through its arches, courtyard or arcade), buildings outside the bounds. */
export function sketchProblems(s: Sketch = SKETCH): string[] {
  const out: string[] = [];
  const named = (bd: SketchBuilding) => bd.name ?? `building at ${bd.x0}, ${bd.z0}`;
  s.buildings.forEach((bd, i) => {
    for (const other of s.buildings.slice(i + 1)) if (overlap(bd, other)) out.push(`${named(bd)} overlaps ${named(other)}`);
    for (const st of s.stairs) if (overlap(bd, st)) out.push(`${named(bd)} stands on a stair at ${st.x0}, ${st.z0}`);
    if (bd.x0 < s.bounds.x0 || bd.x1 > s.bounds.x1 || bd.z0 < s.bounds.z0 || bd.z1 > s.bounds.z1) out.push(`${named(bd)} is outside the bounds`);
  });
  for (const route of s.routes) {
    if (route.kind === 'through' || route.kind === 'roof') continue;
    const samples: [number, number][] = [];
    route.points.forEach(([x, z], i) => {
      const [nx, nz] = route.points[i + 1] ?? [x, z];
      const n = Math.max(1, Math.ceil(Math.hypot(nx - x, nz - z)));
      for (let k = 0; k < n; k++) samples.push([x + ((nx - x) * k) / n, z + ((nz - z) * k) / n]);
    });
    const reported = new Set<SketchBuilding>();
    for (const [x, z] of samples) {
      const within = (q: SketchRect) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1;
      const inside = s.buildings.find((bd) => x > bd.x0 && x < bd.x1 && z > bd.z0 && z < bd.z1 && !bd.arcade && !(bd.arches ?? []).some(within) && !(bd.court && within(bd.court)));
      if (inside && !reported.has(inside)) {
        reported.add(inside);
        out.push(`${route.name} goes through ${named(inside)} at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      }
    }
  }
  // Every metre inside the bounds has ground under it.
  const holes: string[] = [];
  for (let x = s.bounds.x0 + 0.5; x < s.bounds.x1; x += 2) {
    for (let z = s.bounds.z0 + 0.5; z < s.bounds.z1; z += 2) {
      if (!s.ground.some((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1)) holes.push(`${x - 0.5}, ${z - 0.5}`);
    }
  }
  if (holes.length) out.push(`no ground at ${holes.slice(0, 6).join('; ')}${holes.length > 6 ? ` and ${holes.length - 6} more` : ''}`);
  return out;
}
