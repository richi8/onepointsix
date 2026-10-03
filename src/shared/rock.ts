// The one lumpy boulder every rock on an island is drawn from, and rays
// against it. Built here rather than by the renderer, so rounds and sight meet
// exactly the faces players see.

import { mulberry32 } from './rng.ts';

/** How much taller than wide a rock is drawn, against its height `h`. */
export const ROCK_SQUASH = 0.9;
/** The furthest a corner is pushed out from the unit sphere. */
export const ROCK_BULGE = 1.15;

/** Where a rock stands, how wide and tall, and its turn about the vertical. */
export interface RockPlace {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  rot: number;
}

/**
 * The rock's faces in its own frame, around a unit sphere: an icosahedron cut
 * once into 80 triangles, each corner pushed in or out by 0.8 to 1.15. Nine
 * numbers a triangle, wound outwards.
 */
export function rockShape(seed: number): Float64Array {
  const t = (1 + Math.sqrt(5)) / 2;
  const ico = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const unit = (v: number[]): number[] => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const mid = (a: number[], b: number[]): number[] => unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  const rand = mulberry32(seed);
  const jitter = new Map<string, number>();
  const corner = (v: number[]): number[] => {
    const key = `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
    let k = jitter.get(key);
    if (k === undefined) jitter.set(key, (k = 0.8 + rand() * 0.35));
    return [v[0] * k, v[1] * k, v[2] * k];
  };
  const out = new Float64Array(80 * 9);
  let n = 0;
  for (const [i, j, k] of faces) {
    const a = unit(ico[i]);
    const b = unit(ico[j]);
    const c = unit(ico[k]);
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    for (const tri of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) {
      for (const v of tri) out.set(corner(v), n), (n += 3);
    }
  }
  return out;
}

let EXIT = 0;
let FACE = -1;

/** Where the ray left the rock the last rayRock hit. */
export function rockExit(): number {
  return EXIT;
}

/**
 * Distance along a normalized ray to where it first meets a rock placed at
 * `p`, 0 if it starts inside, or Infinity; rockExit() then gives where it leaves.
 */
export function rayRock(
  shape: Float64Array, p: RockPlace, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
): number {
  // Into the rock's own frame, where it's about a unit sphere; distances along the ray stay as they were.
  const cos = Math.cos(p.rot);
  const sin = Math.sin(p.rot);
  const sy = p.h * ROCK_SQUASH;
  const qx = ox - p.x;
  const qz = oz - p.z;
  const px = (qx * cos - qz * sin) / p.r;
  const py = (oy - p.y) / sy;
  const pz = (qx * sin + qz * cos) / p.r;
  const ex = (dx * cos - dz * sin) / p.r;
  const ey = dy / sy;
  const ez = (dx * sin + dz * cos) / p.r;
  // Nothing to test unless it meets the sphere every corner lies within.
  const a = ex * ex + ey * ey + ez * ez;
  const b = px * ex + py * ey + pz * ez;
  const c = px * px + py * py + pz * pz - ROCK_BULGE * ROCK_BULGE;
  if (b * b - a * c < 0 || (b > 0 && c > 0)) return Infinity;
  return rayShape(shape, px, py, pz, ex, ey, ez);
}

/** Möller–Trumbore against every face; the nearest entry ahead, or 0 from inside. */
function rayShape(s: Float64Array, px: number, py: number, pz: number, ex: number, ey: number, ez: number): number {
  let near = Infinity;
  let nearOut = false;
  let far = -Infinity;
  FACE = -1;
  for (let i = 0; i < s.length; i += 9) {
    const e1x = s[i + 3] - s[i], e1y = s[i + 4] - s[i + 1], e1z = s[i + 5] - s[i + 2];
    const e2x = s[i + 6] - s[i], e2y = s[i + 7] - s[i + 1], e2z = s[i + 8] - s[i + 2];
    const hx = ey * e2z - ez * e2y, hy = ez * e2x - ex * e2z, hz = ex * e2y - ey * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det;
    const sx = px - s[i], sy = py - s[i + 1], sz = pz - s[i + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (ex * qx + ey * qy + ez * qz);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t < 0) continue;
    if (t > far) far = t;
    // Wound outwards: a positive det is a face the ray crosses on its way in.
    if (t < near) (near = t), (nearOut = det < 0), (FACE = i);
  }
  if (near === Infinity) return Infinity;
  EXIT = far;
  // The first face it meets is one it leaves by: it started inside.
  return nearOut ? 0 : near;
}

/**
 * The outward normal of a rock placed at `p` at the world point (x, y, z) on
 * or near it: of the face a line out from its middle through the point crosses.
 */
export function rockNormal(shape: Float64Array, p: RockPlace, x: number, y: number, z: number): [number, number, number] {
  const cos = Math.cos(p.rot);
  const sin = Math.sin(p.rot);
  const sy = p.h * ROCK_SQUASH;
  const qx = x - p.x;
  const qz = z - p.z;
  const lx = (qx * cos - qz * sin) / p.r;
  const ly = (y - p.y) / sy;
  const lz = (qx * sin + qz * cos) / p.r;
  if (Math.hypot(lx, ly, lz) < 1e-9 || rayShape(shape, 0, 0, 0, lx, ly, lz) === Infinity || FACE < 0) return [0, 1, 0];
  const i = FACE;
  const e1x = shape[i + 3] - shape[i], e1y = shape[i + 4] - shape[i + 1], e1z = shape[i + 5] - shape[i + 2];
  const e2x = shape[i + 6] - shape[i], e2y = shape[i + 7] - shape[i + 1], e2z = shape[i + 8] - shape[i + 2];
  // The face's normal in the rock's frame, back out through the inverse transpose of its placing.
  const nx = (e1y * e2z - e1z * e2y) / p.r;
  const ny = (e1z * e2x - e1x * e2z) / sy;
  const nz = (e1x * e2y - e1y * e2x) / p.r;
  const wx = nx * cos + nz * sin;
  const wz = -nx * sin + nz * cos;
  const len = Math.hypot(wx, ny, wz);
  return [wx / len, ny / len, wz / len];
}
