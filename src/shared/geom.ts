export const TAU = Math.PI * 2;

export type Vec3 = [number, number, number];

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

export function angleDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}

/** Yaw that faces from (x, z) toward (tx, tz); yaw 0 faces -z. */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

// Ray tests below take a normalized direction and return the distance to the
// first hit, 0 if the origin is inside, or Infinity on a miss.

let T0 = 0;
let T1 = 0;

/** Where the ray left what the last rayAabb or rayCylinder hit. */
export function rayExit(): number {
  return T1;
}

function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  if (a > T0) T0 = a;
  if (b < T1) T1 = b;
  return T0 <= T1;
}

export function rayAabb(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  T0 = -Infinity;
  T1 = Infinity;
  if (!slab(ox, dx, minX, maxX) || !slab(oy, dy, minY, maxY) || !slab(oz, dz, minZ, maxZ)) return Infinity;
  if (T1 < 0) return Infinity;
  return T0 > 0 ? T0 : 0;
}

/** Vertical finite cylinder. */
export function rayCylinder(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cz: number, r: number, y0: number, y1: number,
): number {
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  const c = px * px + pz * pz - r * r;
  T0 = -Infinity;
  T1 = Infinity;
  if (a < 1e-12) {
    if (c > 0) return Infinity;
  } else {
    const b = px * dx + pz * dz;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    T0 = (-b - s) / a;
    T1 = (-b + s) / a;
  }
  if (!slab(oy, dy, y0, y1) || T1 < 0) return Infinity;
  return T0 > 0 ? T0 : 0;
}

export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : Infinity;
}
