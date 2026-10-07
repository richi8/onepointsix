// Lays out Calabianca (Deathmatch's map, src/shared/maps/calabianca2.ts)
// after the most played three-lane map there is, from its navigation mesh:
// every patch of floor a bot can walk, with its height, as the analysis
// library awpy (MIT) publishes it for its tests. Its units are taken as
// 2.54 cm, as the players there are 72 tall. Writes the geometry, a grid of
// 25 cm cells, as boxes into src/shared/maps/calabianca2grid.ts, which is
// committed, so this only needs running again to change it.
//
//   node scripts/calabianca.mjs
//
// The steps, on the grid: each cell takes the floors of the patches over its
// middle (two where one floor runs over another: the way out of the
// defenders' end runs under the walk from short to A); the floors are
// widened by a player's radius, as the mesh keeps that far off every wall;
// heights are put on 25 cm steps, as the game's ramps climb, so slopes become
// steps too low to notice. What's left is solid: a small hole in the floor is
// a piece of cover; the rest are houses standing 6 m over the highest floor
// within 6 m (on whole metres), but along the sea behind the attackers' end, where it's a
// parapet a metre thick and nothing beyond. The covered ways (the tunnels)
// are roofed 3.25 m over their floor, the double doors are fixed leaves with
// a gap between them under a lintel, and the spawn points are spread over
// the whole map, as far from each other as they'll go.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const AWPY = '94f3571367012b763d3730d92bb4502b50a89bd8';
const SOURCE = `https://raw.githubusercontent.com/pnxenopoulos/awpy/${AWPY}/tests/de_dust2.json`;
const CACHE = new URL('../node_modules/.cache/calabianca/', import.meta.url).pathname;
const OUT = new URL('../src/shared/maps/calabianca2grid.ts', import.meta.url).pathname;

/** Metres a unit; the overview's corner and units a pixel, as its own description file gives them. */
const U = 0.0254;
const [OX, OY, PX] = [-2476, 3239, 4.4];
/** The grid's cell and the heights' step, metres. */
const C = 0.25;
const STEP = 0.25;
/** The plan's side: the overview's 1024 pixels. */
const N = Math.ceil((1024 * PX * U) / C);
/** Cells a player's radius widens the floors by (the mesh keeps 16 units, 0.41 m, off the walls). */
const HULL = 2;
/** Cells each way the floors' heights are smoothed over, and how near in height they're taken to be one floor. */
const SMOOTH = 4;
const BUMP = 0.4;
/** Floors over one cell nearer than this are one. */
const LAYER = 1.5;
/** A hole in the floor this small (m²) is cover, so high over the floor round it. */
const COVER_AREA = 4;
const COVER = 1.2;
/** How far a house stands over the highest floor within HOUSE_REACH metres, its top put on whole metres. */
const HOUSE = 6;
const HOUSE_REACH = 6;
/** The parapet along the sea: how far it stands over the floor behind it, and how thick it is; how near the plan's south edge the floor must end for it. */
const PARAPET = 1.1;
const PARAPET_THICK = 1;
const SEA_SIDE = 15;
/** A covered way's ceiling over its floor, and a doorway's. */
const TUNNEL = 3.25;
const DOORWAY = 3;
/** A door leaf's thickness, and the gap left between a pair. */
const LEAF = 0.2;
const GAP = 1.6;
/** How many spawn points, and how far from the walls they keep at the least. */
const SPAWNS = 24;
const SPAWN_ROOM = 1;

/** An overview pixel's (x, z) on the plan, in metres. */
const px = (x, y) => [x * PX * U, y * PX * U];
/** Rectangles of the overview, in its pixels, roofed over as tunnels: the upper tunnels and the stairs down from them, the way in from outside the tunnels, the way out to B, and the lower tunnels. */
const TUNNELS = [
  [62, 405, 330, 502],
  [140, 502, 200, 560],
  [95, 318, 130, 405],
  [283, 383, 440, 438],
];
/** The double doors, each across its doorway from hinge to hinge, in overview pixels: B's, mid's and the two pairs at long. */
const DOORS = [
  [262, 214, 262, 255],
  [446, 366, 489, 366],
  [689, 563, 726, 563],
  [689, 665, 726, 665],
];
/**
 * The original's leaves, standing open, from hinge to edge in overview
 * pixels: the mesh keeps off them, so they'd stand as walls; the floor is
 * carried over where they swing, and the doors here are fixed shut but for a
 * gap.
 */
const SWINGS = [
  [263, 214, 254.4, 233], [270, 237.6, 261, 255],
  [446, 365.6, 465, 374.4], [470, 356.6, 488.6, 366.4],
  [689.5, 563.8, 704.5, 554.5], [710, 572.5, 725.5, 562],
  [689.5, 666, 704.5, 656], [710, 675, 725.5, 664],
];
/** How far round an open leaf the floor is carried, metres. */
const SWING_CLEAR = 0.6;
/**
 * A box's top stands this far over the floor round it at the least, and
 * covers at most this much (m²); one square and of a crate's size is a crate,
 * the rest stone, which bots walk round (the bots' paths drop no more than
 * 1.2 m, so a box's top would be a trap) and players climb.
 */
const BOX_RISE = 0.75;
const BOX_AREA = 16;
const CRATE = [0.9, 1.7];

async function navMesh() {
  const file = `${CACHE}de_dust2.json`;
  if (!existsSync(file)) {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const nav = await navMesh();
const areas = Object.values(nav.areas);
const zLow = Math.min(...areas.flatMap((a) => a.corners.map((c) => c.z)));
const at = (c) => [(c.x - OX) * U, (OY - c.y) * U, (c.z - zLow) * U];
const idx = (i, k) => k * N + i;
const inside = (i, k) => i >= 0 && k >= 0 && i < N && k < N;
const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------------------------------------------------------------- the floors

/** Each cell's floors, lowest first, metres over the lowest. */
const floors = Array.from({ length: N * N }, () => []);
for (const a of areas) {
  const p = a.corners.map(at);
  for (let t = 1; t + 1 < p.length; t++) {
    const [A, B, D] = [p[0], p[t], p[t + 1]];
    const det = (B[1] - D[1]) * (A[0] - D[0]) + (D[0] - B[0]) * (A[1] - D[1]);
    if (Math.abs(det) < 1e-9) continue;
    const [x0, x1] = [Math.min(A[0], B[0], D[0]), Math.max(A[0], B[0], D[0])];
    const [z0, z1] = [Math.min(A[1], B[1], D[1]), Math.max(A[1], B[1], D[1])];
    for (let k = Math.max(0, Math.floor(z0 / C)); k <= Math.min(N - 1, Math.floor(z1 / C)); k++) {
      for (let i = Math.max(0, Math.floor(x0 / C)); i <= Math.min(N - 1, Math.floor(x1 / C)); i++) {
        const [x, z] = [(i + 0.5) * C, (k + 0.5) * C];
        const l1 = ((B[1] - D[1]) * (x - D[0]) + (D[0] - B[0]) * (z - D[1])) / det;
        const l2 = ((D[1] - A[1]) * (x - D[0]) + (A[0] - D[0]) * (z - D[1])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        floors[idx(i, k)].push(l1 * A[2] + l2 * B[2] + l3 * D[2]);
      }
    }
  }
}
for (const f of floors) {
  f.sort((a, b) => a - b);
  const one = [];
  for (const y of f) if (one.length && y - one[one.length - 1] < LAYER) one[one.length - 1] = y;
  else one.push(y);
  f.splice(0, f.length, ...one);
}
// Widened by the hull: each empty cell near a floor takes its nearest's.
let ring = [];
for (let c = 0; c < N * N; c++) if (floors[c].length) ring.push(c);
const reached = new Uint8Array(N * N);
for (const c of ring) reached[c] = 1;
for (let d = 0; d < HULL; d++) {
  const next = [];
  for (const c of ring) {
    const [i, k] = [c % N, Math.floor(c / N)];
    for (const [di, dk] of FOUR) {
      if (!inside(i + di, k + dk)) continue;
      const n = idx(i + di, k + dk);
      if (reached[n]) continue;
      reached[n] = 1;
      floors[n] = [...floors[c]];
      next.push(n);
    }
  }
  ring = next;
}
// Slots of floor a cell or two wide cut into the walls, where the mesh's
// patches don't quite meet, filled: the floors opened (shrunk by a cell and
// grown back), keeping each cell's own.
{
  const had = floors.map((f) => f.length > 0);
  const kept = new Uint8Array(N * N);
  for (let k = 1; k < N - 1; k++) for (let i = 1; i < N - 1; i++) {
    let all = true;
    for (let dk = -1; dk <= 1 && all; dk++) for (let di = -1; di <= 1; di++) if (!had[idx(i + di, k + dk)]) all = false;
    if (all) kept[idx(i, k)] = 1;
  }
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    const c = idx(i, k);
    if (!had[c]) continue;
    let near = false;
    for (let dk = -1; dk <= 1 && !near; dk++) for (let di = -1; di <= 1; di++) if (inside(i + di, k + dk) && kept[idx(i + di, k + dk)]) near = true;
    if (!near) floors[c] = [];
  }
}
// The floors' bumps, a few centimetres where the mesh's patches meet, which
// would round to steps of their own, smoothed: each floor, twice, the mean of
// those within BUMP of it in the square SMOOTH cells each way round it. Then
// on the height steps.
for (let pass = 0; pass < 2; pass++) {
  const before = floors.map((f) => [...f]);
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    const c = idx(i, k);
    before[c].forEach((h, layer) => {
      let [sum, n] = [0, 0];
      for (let dk = -SMOOTH; dk <= SMOOTH; dk++) for (let di = -SMOOTH; di <= SMOOTH; di++) {
        if (!inside(i + di, k + dk)) continue;
        for (const g of before[idx(i + di, k + dk)]) if (Math.abs(g - h) <= BUMP) (sum += g), n++;
      }
      floors[c][layer] = sum / n;
    });
  }
}
for (const f of floors) f.forEach((y, j) => (f[j] = Math.round(y / STEP)));
// Where the original's doors swing open, floor: each cell near a leaf takes
// the floor of the nearest that has one.
{
  const swung = [];
  for (const [a, b, c2, d] of SWINGS) {
    const [x0, z0] = px(a, b);
    const [x1, z1] = px(c2, d);
    const len2 = (x1 - x0) ** 2 + (z1 - z0) ** 2;
    for (let k = Math.floor((Math.min(z0, z1) - SWING_CLEAR) / C); k <= Math.ceil((Math.max(z0, z1) + SWING_CLEAR) / C); k++) {
      for (let i = Math.floor((Math.min(x0, x1) - SWING_CLEAR) / C); i <= Math.ceil((Math.max(x0, x1) + SWING_CLEAR) / C); i++) {
        const [x, z] = [(i + 0.5) * C, (k + 0.5) * C];
        const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (z - z0) * (z1 - z0)) / len2));
        if (Math.hypot(x - x0 - t * (x1 - x0), z - z0 - t * (z1 - z0)) < SWING_CLEAR && !floors[idx(i, k)].length) swung.push(idx(i, k));
      }
    }
  }
  let left = swung;
  while (left.length) {
    const next = [];
    const filled = [];
    for (const c of left) {
      const [i, k] = [c % N, Math.floor(c / N)];
      const from = FOUR.map(([di, dk]) => idx(i + di, k + dk)).find((n) => floors[n].length);
      if (from === undefined) next.push(c);
      else filled.push([c, from]);
    }
    if (!filled.length) break;
    for (const [c, from] of filled) floors[c] = [...floors[from]];
    left = next;
  }
}
// The boxes standing about: tops of floor well over the floor all round
// them. Those square and of a crate's size become crates (bots go to them
// for ammunition), the floor under them their foot's.
const crates = [];
/** Each stone box's top, in steps; NaN elsewhere. */
const boxTop = new Float64Array(N * N).fill(NaN);
{
  const seen = new Uint8Array(N * N);
  const rise = Math.round(BOX_RISE / STEP);
  for (let c = 0; c < N * N; c++) {
    if (seen[c] || floors[c].length !== 1) continue;
    const h = floors[c][0];
    const cells = [];
    const stack = [c];
    seen[c] = 1;
    let foot = -Infinity;
    let box = true;
    while (stack.length) {
      const d = stack.pop();
      cells.push(d);
      const [i, k] = [d % N, Math.floor(d / N)];
      for (const [di, dk] of FOUR) {
        if (!inside(i + di, k + dk)) continue;
        const n = idx(i + di, k + dk);
        const f = floors[n];
        if (f.length === 1 && Math.abs(f[0] - h) <= 1) {
          if (!seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        } else if (f.length === 1 && f[0] <= h - rise) foot = Math.max(foot, f[0]);
        else if (f.length) box = false;
      }
      if (cells.length * C * C > BOX_AREA) box = false;
    }
    if (!box || !Number.isFinite(foot) || cells.length * C * C > BOX_AREA) continue;
    const is = cells.map((d) => d % N);
    const ks = cells.map((d) => Math.floor(d / N));
    const [w, d] = [(Math.max(...is) - Math.min(...is) + 1) * C, (Math.max(...ks) - Math.min(...ks) + 1) * C];
    if (Math.abs(w - d) > 0.4 || Math.min(w, d) < CRATE[0] || Math.max(w, d) > CRATE[1] || cells.length * C * C < 0.75 * w * d) {
      for (const e of cells) boxTop[e] = floors[e][0];
      continue;
    }
    const size = Math.min(w, d, (h - foot) * STEP);
    crates.push([(Math.min(...is) * C + w / 2), (Math.min(...ks) * C + d / 2), size, foot]);
    for (const e of cells) floors[e] = [foot];
  }
}
const open = (c) => floors[c].length > 0;
const lowest = (c) => floors[c][0];
const highest = (c) => floors[c][floors[c].length - 1];

// ---------------------------------------------------------------- what's solid

/** Each solid cell's top, in steps; NaN where open, or where nothing stands (beyond the parapet). */
const solidTop = new Float64Array(N * N).fill(NaN);
/** Which solid cells are cover, and which the parapet. */
const isCover = new Uint8Array(N * N);
const isParapet = new Uint8Array(N * N);
// The highest floor within reach of each cell, a square max filter, along rows then columns.
const R = Math.round(HOUSE_REACH / C);
const rowMax = new Float64Array(N * N).fill(-Infinity);
const near = new Float64Array(N * N).fill(-Infinity);
for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
  let m = -Infinity;
  for (let d = -R; d <= R; d++) if (inside(i + d, k) && open(idx(i + d, k))) m = Math.max(m, highest(idx(i + d, k)));
  rowMax[idx(i, k)] = m;
}
for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
  let m = -Infinity;
  for (let d = -R; d <= R; d++) if (inside(i, k + d)) m = Math.max(m, rowMax[idx(i, k + d)]);
  near[idx(i, k)] = m;
}
// Past the reach, the nearest floor's height, for the houses out at the plan's edge.
const nearest = new Float64Array(N * N).fill(NaN);
{
  const queue = [];
  for (let c = 0; c < N * N; c++) if (open(c)) { nearest[c] = highest(c); queue.push(c); }
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h];
    const [i, k] = [c % N, Math.floor(c / N)];
    for (const [di, dk] of FOUR) {
      if (!inside(i + di, k + dk)) continue;
      const n = idx(i + di, k + dk);
      if (!Number.isNaN(nearest[n])) continue;
      nearest[n] = nearest[c];
      queue.push(n);
    }
  }
}
/** A house's top over a floor `h` steps up: HOUSE over it, on whole metres. */
const houseTop = (h) => Math.ceil((h + STEP_OF(HOUSE)) / 4) * 4;
// The holes and the solid round them, as pieces.
const piece = new Int32Array(N * N).fill(-1);
const pieces = [];
for (let c = 0; c < N * N; c++) {
  if (open(c) || piece[c] >= 0) continue;
  const cells = [];
  let border = false;
  const stack = [c];
  piece[c] = pieces.length;
  while (stack.length) {
    const d = stack.pop();
    cells.push(d);
    const [i, k] = [d % N, Math.floor(d / N)];
    for (const [di, dk] of FOUR) {
      if (!inside(i + di, k + dk)) {
        border = true;
        continue;
      }
      const n = idx(i + di, k + dk);
      if (open(n) || piece[n] >= 0) continue;
      piece[n] = pieces.length;
      stack.push(n);
    }
  }
  pieces.push({ cells, border });
}
const STEP_OF = (m) => Math.round(m / STEP);
for (const { cells, border } of pieces) {
  if (!border && cells.length * C * C <= COVER_AREA) {
    // Cover: over the highest floor beside it.
    let top = -Infinity;
    for (const d of cells) {
      const [i, k] = [d % N, Math.floor(d / N)];
      for (const [di, dk] of FOUR) if (inside(i + di, k + dk) && open(idx(i + di, k + dk))) top = Math.max(top, highest(idx(i + di, k + dk)));
    }
    for (const d of cells) {
      solidTop[d] = top + STEP_OF(COVER);
      isCover[d] = 1;
    }
    continue;
  }
  for (const d of cells) solidTop[d] = houseTop(Number.isFinite(near[d]) ? near[d] : nearest[d]);
}
// Along the sea: south of the last floor in each column, where that's near the south edge, a parapet and then nothing.
const seaRows = Math.round(SEA_SIDE / C);
for (let i = 0; i < N; i++) {
  let last = -1;
  for (let k = 0; k < N; k++) if (open(idx(i, k))) last = k;
  if (last < 0 || last < N - seaRows) continue;
  for (let k = last + 1; k < N; k++) {
    const c = idx(i, k);
    if (open(c)) continue;
    solidTop[c] = k - last <= PARAPET_THICK / C ? highest(idx(i, last)) + STEP_OF(PARAPET) : NaN;
    isCover[c] = 0;
    isParapet[c] = Number.isNaN(solidTop[c]) ? 0 : 1;
  }
}
// Solid cells with no floor near at all (out past the plan): nothing.

// ---------------------------------------------------------------- roofs and doors

/** Each covered cell's ceiling, in steps, under the roof over it up to the houses' height. */
const ceiling = new Float64Array(N * N).fill(NaN);
for (const [a, b, c2, d] of TUNNELS) {
  const [x0, z0] = px(a, b);
  const [x1, z1] = px(c2, d);
  for (let k = Math.floor(z0 / C); k < Math.ceil(z1 / C); k++) {
    for (let i = Math.floor(x0 / C); i < Math.ceil(x1 / C); i++) {
      const c = idx(i, k);
      if (open(c) && floors[c].length === 1) ceiling[c] = Math.ceil((lowest(c) + TUNNEL / STEP) / 2) * 2;
    }
  }
}
const leaves = [];
for (const [a, b, c2, d] of DOORS) {
  const [x0, z0] = px(a, b);
  const [x1, z1] = px(c2, d);
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const [mx, mz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  const floor = lowest(idx(Math.floor(mx / C), Math.floor(mz / C)));
  const top = floor + Math.round(DOORWAY / STEP);
  // The doorway as the floors have it, along the door's line from its middle
  // to the walls either side; each leaf from its wall, a little into it, to
  // the gap in the doorway's middle.
  const line = alongX ? mz : mx;
  const cellAt = (a) => (alongX ? idx(Math.floor(a / C), Math.floor(line / C)) : idx(Math.floor(line / C), Math.floor(a / C)));
  let [a0, a1] = [alongX ? mx : mz, alongX ? mx : mz];
  while (open(cellAt(a0 - C))) a0 -= C;
  while (open(cellAt(a1 + C))) a1 += C;
  a0 = Math.floor(a0 / C) * C;
  a1 = Math.ceil(a1 / C) * C;
  const [s0, s1] = [a0 - 0.2, a1 + 0.2];
  const m = (a0 + a1) / 2;
  for (const [p, q] of [[s0, m - GAP / 2], [m + GAP / 2, s1]]) {
    leaves.push(alongX ? [p, q, line - LEAF / 2, line + LEAF / 2, floor, top] : [line - LEAF / 2, line + LEAF / 2, p, q, floor, top]);
  }
  // A lintel over the doorway, a metre deep, from the leaves' tops.
  const [r0, r1] = [s0, s1];
  for (let u = Math.floor(r0 / C); u < Math.ceil(r1 / C); u++) {
    for (let v = Math.floor((line - 0.5) / C); v < Math.ceil((line + 0.5) / C); v++) {
      const c = alongX ? idx(u, v) : idx(v, u);
      if (open(c)) ceiling[c] = top;
    }
  }
}
/** A roof's top: the houses' height round it. */
const roofTop = (c) => houseTop(near[c]);

// ---------------------------------------------------------------- spawn points

// How far each open cell is from anything solid, in cells (a city-block distance).
const room = new Int32Array(N * N).fill(1 << 20);
const queue = [];
for (let c = 0; c < N * N; c++) {
  const [i, k] = [c % N, Math.floor(c / N)];
  // The grid's edge, too, as the map's bounds keep inside it.
  if (!open(c) || floors[c].length > 1 || !Number.isNaN(ceiling[c]) || !Number.isNaN(boxTop[c]) || i === 0 || k === 0 || i === N - 1 || k === N - 1) {
    room[c] = 0;
    queue.push(c);
  }
}
for (let h = 0; h < queue.length; h++) {
  const c = queue[h];
  const [i, k] = [c % N, Math.floor(c / N)];
  for (const [di, dk] of FOUR) {
    if (!inside(i + di, k + dk)) continue;
    const n = idx(i + di, k + dk);
    if (room[n] <= room[c] + 1) continue;
    room[n] = room[c] + 1;
    queue.push(n);
  }
}
// Well inside the floors' extent, which the map's bounds keep inside.
let [i0, i1, k0, k1] = [N, 0, N, 0];
for (let c = 0; c < N * N; c++) {
  if (!open(c)) continue;
  const [i, k] = [c % N, Math.floor(c / N)];
  [i0, i1, k0, k1] = [Math.min(i0, i), Math.max(i1, i), Math.min(k0, k), Math.max(k1, k)];
}
const EDGE = Math.ceil(1.75 / C);
// The floor a body walks both ways, steps of half a metre at most: its
// largest stretch, so no spawn point is on a ledge only climbed to (the B
// window's sill).
const walked = new Int32Array(N * N).fill(-1);
let main = -1;
{
  let biggest = 0;
  for (let c = 0; c < N * N; c++) {
    if (walked[c] >= 0 || floors[c].length !== 1 || !Number.isNaN(boxTop[c])) continue;
    const stack = [c];
    walked[c] = c;
    let size = 0;
    while (stack.length) {
      const d = stack.pop();
      size++;
      const [i, k] = [d % N, Math.floor(d / N)];
      for (const [di, dk] of FOUR) {
        if (!inside(i + di, k + dk)) continue;
        const n = idx(i + di, k + dk);
        if (walked[n] >= 0 || floors[n].length !== 1 || !Number.isNaN(boxTop[n]) || Math.abs(lowest(n) - lowest(d)) > 2) continue;
        walked[n] = c;
        stack.push(n);
      }
    }
    if (size > biggest) [biggest, main] = [size, c];
  }
}
const candidates = [];
for (let c = 0; c < N * N; c++) {
  if (room[c] * C < SPAWN_ROOM || room[c] >= 1 << 20) continue;
  if (walked[c] !== main) continue;
  if ((c % N) - i0 < EDGE || i1 - (c % N) < EDGE || Math.floor(c / N) - k0 < EDGE || k1 - Math.floor(c / N) < EDGE) continue;
  // Flat under a player's whole width.
  const [i, k] = [c % N, Math.floor(c / N)];
  let flat = true;
  for (let dk = -2; dk <= 2 && flat; dk++) for (let di = -2; di <= 2; di++) if (floors[idx(i + di, k + dk)].length !== 1 || lowest(idx(i + di, k + dk)) !== lowest(c)) flat = false;
  if (!flat) continue;
  candidates.push(c);
}
// The first in the attackers' end, the rest each as far from those before as can be.
const spawns = [candidates.reduce((b, c) => (Math.floor(c / N) > Math.floor(b / N) ? c : b))];
const far = new Float64Array(candidates.length).fill(Infinity);
while (spawns.length < SPAWNS) {
  const s = spawns[spawns.length - 1];
  let best = -1;
  candidates.forEach((c, j) => {
    const d = Math.hypot((c % N) - (s % N), Math.floor(c / N) - Math.floor(s / N)) + 3 * Math.abs(lowest(c) - lowest(s));
    far[j] = Math.min(far[j], d);
    if (best < 0 || far[j] > far[best]) best = j;
  });
  spawns.push(candidates[best]);
}
/** The way from a cell with the longest run of floor at its height ahead, of eight. */
function lookout(c) {
  let best = [0, 0];
  for (let a = 0; a < 8; a++) {
    const [dx, dz] = [Math.cos((a * Math.PI) / 4), Math.sin((a * Math.PI) / 4)];
    let run = 0;
    for (let t = 1; t < N; t++) {
      const [i, k] = [Math.round((c % N) + dx * t), Math.round(Math.floor(c / N) + dz * t)];
      if (!inside(i, k) || !open(idx(i, k)) || Math.abs(lowest(idx(i, k)) - lowest(c)) > 4) break;
      run = t;
    }
    if (run > best[0]) best = [run, a];
  }
  return best[1];
}

// ---------------------------------------------------------------- merged into boxes

/** Rectangles of cells alike by `get` (null where none), merged along rows and down the rows they match. */
function merged(get) {
  const out = [];
  let rows0 = [];
  for (let k = 0; k < N; k++) {
    const rows = [];
    for (let i = 0; i < N; i++) {
      const v = get(idx(i, k));
      if (v === null) continue;
      const last = rows[rows.length - 1];
      if (last && last[1] === i && last.key === v.join()) last[1] = i + 1;
      else rows.push(Object.assign([i, i + 1, k, k + 1, ...v], { key: v.join() }));
    }
    const next = [];
    for (const r of rows) {
      const j = rows0.findIndex((b) => b[0] === r[0] && b[1] === r[1] && b.key === r.key);
      if (j >= 0) {
        rows0[j][3] = k + 1;
        next.push(rows0.splice(j, 1)[0]);
      } else {
        out.push(r);
        next.push(r);
      }
    }
    rows0 = next;
  }
  return out.map((r) => [...r]);
}

const FLOORS = merged((c) => (open(c) && Number.isNaN(boxTop[c]) ? [lowest(c)] : null));
const BOXES = merged((c) => (Number.isNaN(boxTop[c]) ? null : [boxTop[c]]));
const DECKS = merged((c) => (floors[c].length > 1 ? [highest(c)] : null));
const BLOCKS = merged((c) => (!open(c) && !isCover[c] && !isParapet[c] && !Number.isNaN(solidTop[c]) ? [solidTop[c]] : null));
const PARAPETS = merged((c) => (isParapet[c] ? [solidTop[c]] : null));
const COVERS = merged((c) => (isCover[c] ? [solidTop[c]] : null));
const ROOFS = merged((c) => (Number.isNaN(ceiling[c]) ? null : [ceiling[c], Math.max(roofTop(c), ceiling[c] + 2)]));
const CRATES = crates.map(([x, z, size, foot]) => [Math.round(x * 100), Math.round(z * 100), Math.round(size * 100), foot]);
const SPAWN_POINTS = spawns.map((c) => [c % N, Math.floor(c / N), lookout(c)]);
const LEAVES = leaves.map((l) => [...l.slice(0, 4).map((v) => Math.round(v * 100)), ...l.slice(4)]);

const list = (name, doc, rows) => `/** ${doc} */\nexport const ${name}: readonly number[] = [${rows.flat().join(',')}];\n`;
writeFileSync(OUT, `// Made by scripts/calabianca.mjs from the navigation mesh of the map it's
// laid out after: don't edit it by hand. Cells are ${C} m, from the plan's
// north-west corner, x east and z south; heights are steps of ${STEP} m over
// the lowest floor.

/** Cells a side, a cell's size and a height step's, metres. */
export const GRID = { size: ${N}, cell: ${C}, step: ${STEP} };
${list('FLOORS', 'Floors, each a box solid down to the ground: minX, maxX, minZ, maxZ (cells) and its top (steps).', FLOORS)}
${list('DECKS', 'Floors over other floors, each a slab: minX, maxX, minZ, maxZ and its top.', DECKS)}
${list('BLOCKS', 'Houses: minX, maxX, minZ, maxZ and the top.', BLOCKS)}
${list('PARAPETS', 'The parapet along the sea: minX, maxX, minZ, maxZ and the top.', PARAPETS)}
${list('BOXES', 'The original\'s boxes, stone, not walked by bots: minX, maxX, minZ, maxZ and the top.', BOXES)}
${list('COVERS', 'Cover standing in the floor: minX, maxX, minZ, maxZ and the top.', COVERS)}
${list('ROOFS', 'Roofs over the covered ways: minX, maxX, minZ, maxZ, the ceiling and the top.', ROOFS)}
${list('LEAVES', "The doors' leaves: minX, maxX, minZ, maxZ (centimetres), the floor and the top (steps).", LEAVES)}
${list('CRATES', 'Crates: x, z, a side (centimetres) and the floor under it (steps).', CRATES)}
${list('SPAWNS', "Spawn points: x, z (cells; the cell's middle) and the way it looks, eighths of a turn from +x toward +z.", SPAWN_POINTS)}`);
console.log(`${N}² cells: ${FLOORS.length} floors, ${DECKS.length} decks, ${BLOCKS.length} blocks, ${PARAPETS.length} parapets, ${COVERS.length} covers, ${BOXES.length} boxes, ${ROOFS.length} roofs, ${LEAVES.length} leaves, ${CRATES.length} crates, ${SPAWN_POINTS.length} spawns`);
