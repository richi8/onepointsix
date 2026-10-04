// The light baked over a map's town: how much of the sky's light and of the
// sun's bounced reaches each point, from each of six directions. Pure numbers,
// no three.js, so it runs in a worker (see townlight.ts) and in the tests.
//
// The town is cut into cells CELL wide, each open or solid (a wall, a floor,
// the ground). The light along each of many directions is carried through
// the cells a layer at a time, as a sweep: a cell sees along a direction what
// the cell one layer upstream sees, blended between its neighbours, or that
// cell itself if it's solid. Upward, an open way out of the town is sky;
// meeting a solid cell is meeting a surface, which gives back its colour
// times the light on its face: the sky on it (from the first sweeps) and the
// sun if the cell in front of that face sees the sun (from a sweep toward
// it). Each cell sums what it sees into an ambient cube, the light arriving
// on a surface facing +x, -x, +y, -y, +z and -z, so a wall's face reads only
// the side it faces, and a solid cell takes each side's light from the open
// cell on that side: the inside and outside of a wall each read their own,
// though one cell holds both.

import { HOUSE_ROOF, type Box, type World } from '../shared/world.ts';

/** Metres across a cell. */
export const BAKE_CELL = 0.5;
/** Directions over the sky the first sweeps carry its light along, and all round the second the light bounced. */
const SKY_RAYS = 40;
const BOUNCE_RAYS = 48;
/** The sky's share is stored as the square root of a share of this, the sun's bounced likewise, for the bytes to hold the dark finely. */
export const SKY_RANGE = 1.5;
export const SUN_RANGE = 0.6;
/** The six faces of the ambient cube, in the order they're stored. */
const AXES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export interface BakeInput {
  /** The volume's corner, and its cells each way. */
  x0: number;
  y0: number;
  z0: number;
  nx: number;
  ny: number;
  nz: number;
  /** The boxes that stand still: minX, minY, minZ, maxX, maxY, maxZ each. */
  boxes: Float32Array;
  /** Each box's colour, linear red, green and blue. */
  albedo: Float32Array;
  /** The ground's height at the corners of a grid half a cell across over the volume, (2nx + 1) × (2nz + 1), rows along x. */
  ground: Float32Array;
  /** The ground's colour, linear. */
  groundAlbedo: [number, number, number];
  /** Toward the sun. */
  sun: [number, number, number];
  /** The sine of the hills' height over the horizon, from the town, at each of `horizon.length` bearings round from +x toward +z. */
  horizon: Float32Array;
}

/**
 * The baked light: four bytes a cell, cells in x, then y, then z.
 * `skySides`: the sky's share on faces facing +x, -x, +z and -z;
 * `skyUpDown`: on faces facing +y and -y, then the sun's bounced on them;
 * `sunSides`: the sun's bounced on faces facing +x, -x, +z and -z;
 * `tint`: the colour of the sun's light bounced there, red, green and blue
 * over the brightest of them, and 255 where the cell is open, 0 solid.
 * A share is the light on a face as a share of what the open, flat ground
 * round the town would give it, the sun's as a share of the sun's own; each
 * byte holds the square root of one over SKY_RANGE or SUN_RANGE.
 */
export interface Baked {
  skySides: Uint8Array;
  skyUpDown: Uint8Array;
  sunSides: Uint8Array;
  tint: Uint8Array;
}

/** Metres the volume reaches past a map's bounds, and above its highest roof. */
const MARGIN = 4;
const HEADROOM = 1.5;
/** The paving's colour, sRGB. */
const PAVING = 0x9a8f7c;

/**
 * What to bake over a map's town, or null for an island: its boxes that
 * neither break nor move (not the panels: glass, door leaves, crates,
 * fences, tables), each coloured by `colourOf` (sRGB), and the ground.
 */
export function bakeInput(world: World, colourOf: (box: Box) => number, sun: [number, number, number]): BakeInput | null {
  const map = world.map;
  if (!map) return null;
  const C = BAKE_CELL;
  const b = map.bounds;
  const x0 = Math.floor((b.minX - MARGIN) / C) * C;
  const z0 = Math.floor((b.minZ - MARGIN) / C) * C;
  const nx = Math.ceil((b.maxX + MARGIN - x0) / C);
  const nz = Math.ceil((b.maxZ + MARGIN - z0) / C);
  let low = Infinity;
  for (let x = b.minX; x <= b.maxX; x += 1) for (let z = b.minZ; z <= b.maxZ; z += 1) low = Math.min(low, world.terrainHeight(x, z));
  let high = -Infinity;
  for (const h of world.buildings) high = Math.max(high, h.roof + HOUSE_ROOF);
  const y0 = Math.floor((low - 1) / C) * C;
  const ny = Math.ceil((high + HEADROOM - y0) / C);
  const inside = (c: Box) => c.maxX > x0 && c.minX < x0 + nx * C && c.maxZ > z0 && c.minZ < z0 + nz * C && c.maxY > y0 && c.minY < y0 + ny * C;
  const kept = world.colliders.filter((c): c is Box => c.kind === 'box' && c.panel === undefined && !c.clear && inside(c));
  const boxes = new Float32Array(kept.length * 6);
  const albedo = new Float32Array(kept.length * 3);
  kept.forEach((c, i) => {
    boxes.set([c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ], i * 6);
    albedo.set(linear(colourOf(c)), i * 3);
  });
  const gw = 2 * nx + 1;
  const ground = new Float32Array(gw * (2 * nz + 1));
  for (let k = 0; k <= 2 * nz; k++) for (let i = 0; i < gw; i++) ground[k * gw + i] = world.terrainHeight(x0 + (i * C) / 2, z0 + (k * C) / 2);
  // The hills' height round the town, seen from the middle of it, a little over its ground.
  const horizon = new Float32Array(64);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const eye = world.terrainHeight(cx, cz) + 2;
  horizon.forEach((_, i) => {
    const a = ((i + 0.5) / horizon.length) * 2 * Math.PI;
    let top = 0;
    for (let r = 40; r < 1500; r += 8) {
      const h = world.terrainHeight(cx + Math.cos(a) * r, cz + Math.sin(a) * r) - eye;
      top = Math.max(top, h / Math.hypot(h, r));
    }
    horizon[i] = top;
  });
  const l = Math.hypot(...sun);
  return { x0, y0, z0, nx, ny, nz, boxes, albedo, ground, groundAlbedo: linear(PAVING), sun: [sun[0] / l, sun[1] / l, sun[2] / l], horizon };
}

/** An sRGB colour's linear red, green and blue. */
function linear(hex: number): [number, number, number] {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

export function bake(input: BakeInput): Baked {
  const { nx, ny, nz } = input;
  const n = nx * ny * nz;
  const { solid, colour } = occupancy(input);
  const sunVis = new Float32Array(n);
  sweep(input, solid, input.sun, 1, sunVis, 0, null, 0, null, 0, true);

  // The sky's light straight from it, summed on each face.
  const sky = Array.from({ length: 6 }, () => new Float32Array(n));
  const up = spread(SKY_RAYS, true);
  for (const d of up) {
    const [ax, wx, ay, wy, az, wz] = active(d);
    sweep(input, solid, d, horizonOpen(input, d), sky[ax], wx, sky[ay], wy, sky[az], wz, false);
  }
  // What the open, flat ground would give each face: the sky above, and the ground lit by it below.
  const round = spread(BOUNCE_RAYS, false);
  const G = lum(input.groundAlbedo);
  const ref = AXES.map((a) => {
    let s = 0;
    for (const d of up) s += Math.max(0, a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) * ((2 * Math.PI) / SKY_RAYS);
    for (const d of round) if (d[1] < 0) s += G * Math.max(0, a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) * ((4 * Math.PI) / BOUNCE_RAYS);
    return s;
  });
  for (let a = 0; a < 6; a++) {
    const k = (2 * Math.PI) / SKY_RAYS / ref[a];
    const f = sky[a];
    for (let c = 0; c < n; c++) f[c] *= k;
  }

  // Light bounced once off what each cell sees: the sky's on a face as its
  // sky share, the sun's where the cell in front of it is in the sun.
  const exposed = faces(input, solid);
  const lit = new Float32Array(n * 6);
  for (let a = 0; a < 6; a++) {
    const f = sky[a];
    for (let c = 0; c < n; c++) lit[c * 6 + a] = f[c];
  }
  const sun = Array.from({ length: 6 }, () => new Float32Array(n));
  const sunRgb = new Float32Array(n * 3);
  // Each colour, linear, and its brightness, the ground's last.
  const boxes = input.boxes.length / 6;
  const albedo = new Float32Array((boxes + 1) * 4);
  for (let k = 0; k <= boxes; k++) {
    const rgb = k === boxes ? input.groundAlbedo : Array.from(input.albedo.subarray(k * 3, k * 3 + 3));
    albedo.set([rgb[0], rgb[1], rgb[2], lum(rgb)], k * 4);
  }
  const [, sy] = input.sun;
  const sunFacing = AXES.map((a) => Math.max(0, a[0] * input.sun[0] + a[1] * sy + a[2] * input.sun[2]));
  const groundSun = Math.max(0, sy);
  const context: Bounce = { solid, exposed, colour, albedo, lit, sunVis, sunFacing, sky, sun, sunRgb, ref };
  for (const d of round) {
    // Out of the volume downward or below the hills: the ground in the open, lit by the sky and the sun.
    const below = d[1] < 0 || horizonOpen(input, d) === 0;
    const g = input.groundAlbedo;
    const outside = below ? [G, g[0] * groundSun, g[1] * groundSun, g[2] * groundSun] : [0, 0, 0, 0];
    bounce(input, context, d, outside);
  }
  return pack(input, solid, exposed, sky, sun, sunRgb);
}

/** The three faces of the ambient cube a direction falls on, and how squarely: the x face, the y face and the z face. */
function active(d: readonly number[]): [number, number, number, number, number, number] {
  return [d[0] >= 0 ? 0 : 1, Math.abs(d[0]), d[1] >= 0 ? 2 : 3, Math.abs(d[1]), d[2] >= 0 ? 4 : 5, Math.abs(d[2])];
}

/** `count` directions spread evenly over the sky (`upper`) or all round. */
function spread(count: number, upper: boolean): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = upper ? (i + 0.5) / count : 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
}

/** 1 if the sky shows along `d` over the hills round the town, else 0. */
function horizonOpen(input: BakeInput, d: [number, number, number]): number {
  const h = input.horizon;
  const bearing = (Math.atan2(d[2], d[0]) / (2 * Math.PI) + 1) % 1;
  return d[1] > h[Math.floor(bearing * h.length) % h.length] ? 1 : 0;
}

function lum(c: readonly number[]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Which cells are solid, and each solid one's colour (an index into the
 * boxes' colours, or the ground's, `boxes.length / 6`). A box makes a cell
 * solid where it fills much of it, or runs through it as a slab, so a wall
 * or floor thinner than a cell always shuts it; the ground where it fills
 * half a cell; what little the boxes and the ground fill otherwise counts
 * together.
 */
function occupancy(input: BakeInput): { solid: Uint8Array; colour: Uint16Array } {
  const { x0, y0, z0, nx, ny, nz, boxes } = input;
  const C = BAKE_CELL;
  const n = nx * ny * nz;
  const solid = new Uint8Array(n);
  const colour = new Uint16Array(n);
  const fill = new Float32Array(n);
  const most = new Float32Array(n);
  const count = boxes.length / 6;
  for (let b = 0; b < count; b++) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = boxes.subarray(b * 6, b * 6 + 6);
    const i0 = Math.max(0, Math.floor((minX - x0) / C));
    const i1 = Math.min(nx - 1, Math.floor((maxX - x0) / C - 1e-6));
    const j0 = Math.max(0, Math.floor((minY - y0) / C));
    const j1 = Math.min(ny - 1, Math.floor((maxY - y0) / C - 1e-6));
    const k0 = Math.max(0, Math.floor((minZ - z0) / C));
    const k1 = Math.min(nz - 1, Math.floor((maxZ - z0) / C - 1e-6));
    for (let k = k0; k <= k1; k++) {
      const oz = Math.min(maxZ, z0 + (k + 1) * C) - Math.max(minZ, z0 + k * C);
      for (let j = j0; j <= j1; j++) {
        const oy = Math.min(maxY, y0 + (j + 1) * C) - Math.max(minY, y0 + j * C);
        for (let i = i0; i <= i1; i++) {
          const ox = Math.min(maxX, x0 + (i + 1) * C) - Math.max(minX, x0 + i * C);
          if (ox <= 0 || oy <= 0 || oz <= 0) continue;
          const c = (k * ny + j) * nx + i;
          const f = (ox * oy * oz) / (C * C * C);
          const wide = (ox >= 0.6 * C ? 1 : 0) + (oy >= 0.6 * C ? 1 : 0) + (oz >= 0.6 * C ? 1 : 0);
          const slab = wide >= 2 && Math.min(ox, oy, oz) >= 0.1;
          if (slab || f >= 0.4) solid[c] = 1;
          fill[c] += f;
          if (f > most[c]) (most[c] = f), (colour[c] = b);
        }
      }
    }
  }
  // The ground: how much of each cell lies under it, from the four quarters of its column.
  const gw = 2 * nx + 1;
  const ground = count;
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const hs: number[] = [];
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const p = (2 * k + b) * gw + 2 * i + a;
        hs.push((input.ground[p] + input.ground[p + 1] + input.ground[p + gw] + input.ground[p + gw + 1]) / 4);
      }
      for (let j = 0; j < ny; j++) {
        const lo = y0 + j * C;
        let g = 0;
        for (const h of hs) g += Math.min(Math.max((h - lo) / C, 0), 1) / 4;
        if (g <= 0) break;
        const c = (k * ny + j) * nx + i;
        if (g >= 0.5 && !solid[c]) {
          solid[c] = 1;
          colour[c] = ground;
        } else if (!solid[c] && fill[c] + g >= 0.5) solid[c] = 1;
        if (g > most[c]) colour[c] = ground;
      }
    }
  }
  return { solid, colour };
}

/** For each solid cell, which of its six faces (as AXES) give onto an open cell, a bit each; 0 for open cells. */
function faces(input: BakeInput, solid: Uint8Array): Uint8Array {
  const { nx, ny, nz } = input;
  const out = new Uint8Array(solid.length);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = (k * ny + j) * nx + i;
        if (!solid[c]) continue;
        let m = 0;
        if (i + 1 < nx && !solid[c + 1]) m |= 1;
        if (i > 0 && !solid[c - 1]) m |= 2;
        if (j + 1 < ny && !solid[c + nx]) m |= 4;
        if (j > 0 && !solid[c - nx]) m |= 8;
        if (k + 1 < nz && !solid[c + nx * ny]) m |= 16;
        if (k > 0 && !solid[c - nx * ny]) m |= 32;
        out[c] = m;
      }
    }
  }
  return out;
}

/** How a sweep along d steps: the axis it goes layer by layer along, and the other two's offsets per layer. */
interface Plan {
  /** Strides in the volume along the main axis and the other two, and their cell counts. */
  stride: [number, number, number];
  count: [number, number, number];
  /** Layers in order, each upstream of the next. */
  first: number;
  step: number;
  /** Upstream of a cell is one layer back, `fu` + `tu` cells along the second axis and `fv` + `tv` along the third. */
  fu: number;
  fv: number;
  tu: number;
  tv: number;
}

function plan(input: BakeInput, d: [number, number, number]): Plan {
  const { nx, ny, nz } = input;
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  const strides = [1, nx, nx * ny];
  const counts = [nx, ny, nz];
  const main = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const [u, v] = [0, 1, 2].filter((a) => a !== main);
  const s = d[main] > 0 ? 1 : -1;
  const ou = d[u] / Math.abs(d[main]);
  const ov = d[v] / Math.abs(d[main]);
  return {
    stride: [strides[main], strides[u], strides[v]],
    count: [counts[main], counts[u], counts[v]],
    // Toward d is upstream: start from the far end that way.
    first: s > 0 ? counts[main] - 1 : 0,
    step: -s,
    fu: Math.floor(ou),
    fv: Math.floor(ov),
    tu: ou - Math.floor(ou),
    tv: ov - Math.floor(ov),
  };
}

/**
 * Carry how much shows through along d: an open cell sees what the cell
 * upstream of it sees, blended; a solid cell shows nothing; out of the
 * volume shows `out`. Each open cell adds what it sees times `wa` to `a`
 * (or sets it, if `set`), times `wb` to `b` and `wc` to `c`.
 */
function sweep(
  input: BakeInput, solid: Uint8Array, d: [number, number, number], out: number,
  a: Float32Array, wa: number, b: Float32Array | null, wb: number, c: Float32Array | null, wc: number, set: boolean,
): void {
  const p = plan(input, d);
  const [sm, su, sv] = p.stride;
  const [nm, nu, nv] = p.count;
  // What each cell of a layer shows downstream, with a border of the outside round it.
  const W = nu + 2;
  let prev = new Float32Array(W * (nv + 2)).fill(out);
  let next = new Float32Array(W * (nv + 2)).fill(out);
  const { fu, fv, tu, tv } = p;
  const w00 = (1 - tu) * (1 - tv);
  const w10 = tu * (1 - tv);
  const w01 = (1 - tu) * tv;
  const w11 = tu * tv;
  const [U0, U1] = columns(nu, fu);
  const B = b ?? a;
  const Cc = c ?? a;
  if (!b) wb = 0;
  if (!c) wc = 0;
  for (let m = p.first, l = 0; l < nm; l++, m += p.step) {
    for (let j = 0; j < nv; j++) {
      const r0 = (Math.min(Math.max(j + fv, -1), nv) + 1) * W;
      const r1 = (Math.min(Math.max(j + fv + 1, -1), nv) + 1) * W;
      const row = (j + 1) * W + 1;
      let cell = m * sm + j * sv;
      for (let i = 0; i < nu; i++, cell += su) {
        if (solid[cell]) {
          next[row + i] = 0;
          continue;
        }
        const u0 = U0[i];
        const u1 = U1[i];
        const v = w00 * prev[r0 + u0] + w10 * prev[r0 + u1] + w01 * prev[r1 + u0] + w11 * prev[r1 + u1];
        next[row + i] = v;
        if (set) a[cell] = v;
        else if (v > 0) {
          a[cell] += v * wa;
          B[cell] += v * wb;
          Cc[cell] += v * wc;
        }
      }
    }
    const t = prev;
    prev = next;
    next = t;
  }
}

/** For each cell along a layer's row, the two upstream it blends between, in a row with a border each end. */
function columns(nu: number, fu: number): [Int32Array, Int32Array] {
  const u0 = new Int32Array(nu);
  const u1 = new Int32Array(nu);
  for (let i = 0; i < nu; i++) {
    u0[i] = Math.min(Math.max(i + fu, -1), nu) + 1;
    u1[i] = Math.min(Math.max(i + fu + 1, -1), nu) + 1;
  }
  return [u0, u1];
}

/** What the bounce sweeps read and add to. */
interface Bounce {
  solid: Uint8Array;
  exposed: Uint8Array;
  /** Each solid cell's colour, and each colour's linear red, green and blue and brightness. */
  colour: Uint16Array;
  albedo: Float32Array;
  /** The sky's share on each face of each cell, straight from the sky, six a cell. */
  lit: Float32Array;
  sunVis: Float32Array;
  /** How squarely each face of the cube faces the sun. */
  sunFacing: number[];
  sky: Float32Array[];
  sun: Float32Array[];
  sunRgb: Float32Array;
  ref: number[];
}

/**
 * Carry the light bounced off surfaces along d, the sky's (its brightness)
 * and the sun's (red, green and blue): an open cell sees what the cell
 * upstream sees, blended; a solid cell shows the light its face turned most
 * toward the cell gives back; out of the volume shows `outside`. Each open
 * cell adds it to the three faces of its cube it falls on.
 */
function bounce(input: BakeInput, ctx: Bounce, d: [number, number, number], outside: number[]): void {
  const { solid, exposed, colour, albedo, lit, sunVis, sunFacing, sky, sun, sunRgb, ref } = ctx;
  const { nx, ny } = input;
  const p = plan(input, d);
  const [sm, su, sv] = p.stride;
  const [nm, nu, nv] = p.count;
  const W = nu + 2;
  const size = W * (nv + 2) * 4;
  const border = new Float32Array(size);
  for (let i = 0; i < size; i += 4) border.set(outside, i);
  let prev = border.slice();
  let next = border.slice();
  const { fu, fv, tu, tv } = p;
  const w00 = (1 - tu) * (1 - tv);
  const w10 = tu * (1 - tv);
  const w01 = (1 - tu) * tv;
  const w11 = tu * tv;
  const [U0, U1] = columns(nu, fu);
  const [ax, wx, ay, wy, az, wz] = active(d);
  const k = (4 * Math.PI) / BOUNCE_RAYS;
  const kx = (wx * k) / ref[ax];
  const ky = (wy * k) / ref[ay];
  const kz = (wz * k) / ref[az];
  const sx = (wx * 4) / BOUNCE_RAYS;
  const sy = (wy * 4) / BOUNCE_RAYS;
  const sz = (wz * 4) / BOUNCE_RAYS;
  const skyX = sky[ax];
  const skyY = sky[ay];
  const skyZ = sky[az];
  const sunX = sun[ax];
  const sunY = sun[ay];
  const sunZ = sun[az];
  // The face of a solid cell turned most back along d, for each set of its faces that are open.
  const best = new Int8Array(64).fill(-1);
  for (let m = 1; m < 64; m++) {
    let top = -2;
    for (let f = 0; f < 6; f++) {
      if (!(m & (1 << f))) continue;
      const facing = -(AXES[f][0] * d[0] + AXES[f][1] * d[1] + AXES[f][2] * d[2]);
      if (facing > top) (best[m] = f), (top = facing);
    }
  }
  const neighbour = [1, -1, nx, -nx, nx * ny, -nx * ny];
  for (let m = p.first, l = 0; l < nm; l++, m += p.step) {
    for (let j = 0; j < nv; j++) {
      const r0 = (Math.min(Math.max(j + fv, -1), nv) + 1) * W;
      const r1 = (Math.min(Math.max(j + fv + 1, -1), nv) + 1) * W;
      const row = (j + 1) * W + 1;
      let cell = m * sm + j * sv;
      for (let i = 0; i < nu; i++, cell += su) {
        const o = (row + i) * 4;
        if (solid[cell]) {
          const f = best[exposed[cell]];
          if (f < 0) {
            next[o] = next[o + 1] = next[o + 2] = next[o + 3] = 0;
            continue;
          }
          const front = cell + neighbour[f];
          const q = colour[cell] * 4;
          next[o] = albedo[q + 3] * lit[front * 6 + f];
          const s = sunVis[front] * sunFacing[f];
          next[o + 1] = albedo[q] * s;
          next[o + 2] = albedo[q + 1] * s;
          next[o + 3] = albedo[q + 2] * s;
          continue;
        }
        const u0 = U0[i];
        const u1 = U1[i];
        const i00 = (r0 + u0) * 4;
        const i10 = (r0 + u1) * 4;
        const i01 = (r1 + u0) * 4;
        const i11 = (r1 + u1) * 4;
        const v0 = w00 * prev[i00] + w10 * prev[i10] + w01 * prev[i01] + w11 * prev[i11];
        const v1 = w00 * prev[i00 + 1] + w10 * prev[i10 + 1] + w01 * prev[i01 + 1] + w11 * prev[i11 + 1];
        const v2 = w00 * prev[i00 + 2] + w10 * prev[i10 + 2] + w01 * prev[i01 + 2] + w11 * prev[i11 + 2];
        const v3 = w00 * prev[i00 + 3] + w10 * prev[i10 + 3] + w01 * prev[i01 + 3] + w11 * prev[i11 + 3];
        next[o] = v0;
        next[o + 1] = v1;
        next[o + 2] = v2;
        next[o + 3] = v3;
        if (v0 > 0) {
          skyX[cell] += v0 * kx;
          skyY[cell] += v0 * ky;
          skyZ[cell] += v0 * kz;
        }
        const sl = 0.2126 * v1 + 0.7152 * v2 + 0.0722 * v3;
        if (sl > 0) {
          sunX[cell] += sl * sx;
          sunY[cell] += sl * sy;
          sunZ[cell] += sl * sz;
          sunRgb[cell * 3] += v1;
          sunRgb[cell * 3 + 1] += v2;
          sunRgb[cell * 3 + 2] += v3;
        }
      }
    }
    const t = prev;
    prev = next;
    next = t;
  }
}

/**
 * Into bytes: a solid cell takes each face's light from the open cell on
 * that side of it, so a surface reads the side it faces; where that side is
 * solid too, from the open cells round it.
 */
function pack(input: BakeInput, solid: Uint8Array, exposed: Uint8Array, sky: Float32Array[], sun: Float32Array[], sunRgb: Float32Array): Baked {
  const { nx, ny } = input;
  const n = solid.length;
  const neighbour = [1, -1, nx, -nx, nx * ny, -nx * ny];
  const take = (field: Float32Array, c: number, a: number): number => {
    if (!solid[c]) return field[c];
    if (exposed[c] & (1 << a)) return field[c + neighbour[a]];
    let s = 0;
    let k = 0;
    for (let f = 0; f < 6; f++) if (exposed[c] & (1 << f)) (s += field[c + neighbour[f]]), k++;
    return k ? s / k : 0;
  };
  const byte = (x: number, range: number) => Math.round(Math.sqrt(Math.min(Math.max(x / range, 0), 1)) * 255);
  const skySides = new Uint8Array(n * 4);
  const skyUpDown = new Uint8Array(n * 4);
  const sunSides = new Uint8Array(n * 4);
  const tint = new Uint8Array(n * 4);
  for (let c = 0; c < n; c++) {
    const o = c * 4;
    skySides[o] = byte(take(sky[0], c, 0), SKY_RANGE);
    skySides[o + 1] = byte(take(sky[1], c, 1), SKY_RANGE);
    skySides[o + 2] = byte(take(sky[4], c, 4), SKY_RANGE);
    skySides[o + 3] = byte(take(sky[5], c, 5), SKY_RANGE);
    skyUpDown[o] = byte(take(sky[2], c, 2), SKY_RANGE);
    skyUpDown[o + 1] = byte(take(sky[3], c, 3), SKY_RANGE);
    skyUpDown[o + 2] = byte(take(sun[2], c, 2), SUN_RANGE);
    skyUpDown[o + 3] = byte(take(sun[3], c, 3), SUN_RANGE);
    sunSides[o] = byte(take(sun[0], c, 0), SUN_RANGE);
    sunSides[o + 1] = byte(take(sun[1], c, 1), SUN_RANGE);
    sunSides[o + 2] = byte(take(sun[4], c, 4), SUN_RANGE);
    sunSides[o + 3] = byte(take(sun[5], c, 5), SUN_RANGE);
    // The colour of the sun's bounced light, from the cell or the open cells round it.
    let r = 0;
    let g = 0;
    let b = 0;
    if (!solid[c]) (r = sunRgb[c * 3]), (g = sunRgb[c * 3 + 1]), (b = sunRgb[c * 3 + 2]);
    else {
      for (let f = 0; f < 6; f++) {
        if (!(exposed[c] & (1 << f))) continue;
        const q = (c + neighbour[f]) * 3;
        r += sunRgb[q];
        g += sunRgb[q + 1];
        b += sunRgb[q + 2];
      }
    }
    const top = Math.max(r, g, b);
    if (top > 0) {
      tint[o] = Math.round((r / top) * 255);
      tint[o + 1] = Math.round((g / top) * 255);
      tint[o + 2] = Math.round((b / top) * 255);
    } else tint[o] = tint[o + 1] = tint[o + 2] = 255;
    tint[o + 3] = solid[c] ? 0 : 255;
  }
  return { skySides, skyUpDown, sunSides, tint };
}
