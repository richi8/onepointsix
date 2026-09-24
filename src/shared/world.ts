import {
  GRID_RES,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  STEP_HEIGHT,
  WATER_FLOOR_DEPTH,
  WATER_LEVEL,
  WORLD_SIZE,
} from './constants.ts';
import { clamp, rayAabb, rayCylinder, smoothstep } from './geom.ts';
import { fbm, mulberry32 } from './rng.ts';

export interface Cyl {
  kind: 'cyl';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  stamp: number;
}

export interface Box {
  kind: 'box';
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  stamp: number;
}

export type Collider = Cyl | Box;
export type PropStyle = 'crate' | 'wall' | 'wood' | 'metal';

export interface Prop {
  box: Box;
  style: PropStyle;
  tint: number;
}

export interface Tree {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface Rock {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  rot: number;
}

export interface Outpost {
  name: string;
  x: number;
  y: number;
  z: number;
}

/** Anything that moves through the world with a player-sized collision hull. */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

const GRID_CELL = 8;
const GRID_OFFSET = 1024;
const OUTPOST_NAMES = ['Fort Ash', 'Radio Hill', 'Quarry', 'Old Mill', 'Pinecrest', 'Lookout'];

function topOf(c: Collider): number {
  return c.kind === 'cyl' ? c.y1 : c.maxY;
}

function bottomOf(c: Collider): number {
  return c.kind === 'cyl' ? c.y0 : c.minY;
}

function overlapsFootprint(c: Collider, x: number, z: number, pad: number): boolean {
  if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) < c.r + pad;
  return x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad;
}

/**
 * The static game world, generated deterministically from a seed. Both the
 * server and every client build their own copy, so only the seed ever needs to
 * be sent over the network.
 */
export class World {
  readonly seed: number;
  readonly size = WORLD_SIZE;
  readonly half = WORLD_SIZE / 2;
  readonly res = GRID_RES;
  readonly cell = WORLD_SIZE / GRID_RES;
  readonly heights: Float32Array;
  readonly trees: Tree[] = [];
  readonly rocks: Rock[] = [];
  readonly props: Prop[] = [];
  readonly outposts: Outpost[] = [];
  readonly colliders: Collider[] = [];
  readonly maxHeight: number;
  private readonly grid = new Map<number, Collider[]>();
  private readonly nearby: Collider[] = [];
  private stamp = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const n = this.res + 1;
    this.heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        this.heights[iz * n + ix] = this.rawHeight(-this.half + ix * this.cell, -this.half + iz * this.cell);
      }
    }

    const rng = mulberry32(this.seed ^ 0x9e3779b9);
    this.placeOutposts(rng);
    let maxH = -Infinity;
    for (const h of this.heights) if (h > maxH) maxH = h;
    this.maxHeight = maxH;

    for (const o of this.outposts) this.buildOutpost(o, rng);
    this.scatterCover(rng);
    this.placeTrees(rng);
    this.placeRocks(rng);
    for (const c of this.colliders) this.insert(c);
  }

  // ---------------------------------------------------------------- queries

  /** Height of the rendered terrain mesh, matching its triangulation exactly. */
  terrainHeight(x: number, z: number): number {
    const n = this.res + 1;
    const gx = clamp((x + this.half) / this.cell, 0, this.res - 1e-4);
    const gz = clamp((z + this.half) / this.cell, 0, this.res - 1e-4);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * n + ix;
    const H = this.heights;
    const h00 = H[i];
    const h10 = H[i + 1];
    const h01 = H[i + n];
    const h11 = H[i + n + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Walkable floor ignoring props: terrain, or the shallow sea bed. */
  floorHeight(x: number, z: number): number {
    return Math.max(this.terrainHeight(x, z), WATER_LEVEL - WATER_FLOOR_DEPTH);
  }

  /** Highest surface a player with feet at feetY can stand on (steps included). */
  groundHeight(x: number, z: number, feetY: number): number {
    let h = this.floorHeight(x, z);
    const pad = PLAYER_RADIUS * 0.6;
    for (const c of this.query(x, z, PLAYER_RADIUS)) {
      const top = topOf(c);
      if (top > feetY + STEP_HEIGHT || top <= h) continue;
      if (overlapsFootprint(c, x, z, pad)) h = top;
    }
    return h;
  }

  /** Lowest overhead surface above a player's head. */
  ceilingHeight(x: number, z: number, headY: number): number {
    let ceil = Infinity;
    for (const c of this.query(x, z, PLAYER_RADIUS)) {
      const bottom = bottomOf(c);
      if (bottom < headY - 0.01 || bottom >= ceil) continue;
      if (overlapsFootprint(c, x, z, PLAYER_RADIUS * 0.9)) ceil = bottom;
    }
    return ceil;
  }

  /** Push a body horizontally out of any obstacle taller than a step. */
  collide(b: Body): void {
    const R = PLAYER_RADIUS;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.query(b.x, b.z, R + 0.1)) {
        if (topOf(c) <= b.y + STEP_HEIGHT || bottomOf(c) >= b.y + PLAYER_HEIGHT) continue;
        let nx = 0;
        let nz = 0;
        let pen = 0;
        if (c.kind === 'cyl') {
          const dx = b.x - c.x;
          const dz = b.z - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + R;
          if (d >= min) continue;
          if (d < 1e-6) nx = 1;
          else {
            nx = dx / d;
            nz = dz / d;
          }
          pen = min - d;
        } else {
          const dx = b.x - clamp(b.x, c.minX, c.maxX);
          const dz = b.z - clamp(b.z, c.minZ, c.maxZ);
          const d2 = dx * dx + dz * dz;
          if (d2 >= R * R) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            pen = R - d;
          } else {
            const l = b.x - c.minX;
            const r = c.maxX - b.x;
            const bk = b.z - c.minZ;
            const f = c.maxZ - b.z;
            const m = Math.min(l, r, bk, f);
            if (m === l) (nx = -1), (pen = l + R);
            else if (m === r) (nx = 1), (pen = r + R);
            else if (m === bk) (nz = -1), (pen = bk + R);
            else (nz = 1), (pen = f + R);
          }
        }
        b.x += nx * pen;
        b.z += nz * pen;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= vn * nx;
          b.vz -= vn * nz;
        }
      }
    }
  }

  /** Distance along a normalized ray to the first solid hit, or Infinity. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    let best = this.raycastTerrain(ox, oy, oz, dx, dy, dz, maxT);
    const end = Math.min(best, maxT);
    const ex = ox + dx * end;
    const ez = oz + dz * end;
    const x0 = Math.min(ox, ex);
    const x1 = Math.max(ox, ex);
    const z0 = Math.min(oz, ez);
    const z1 = Math.max(oz, ez);
    for (const c of this.colliders) {
      let t: number;
      if (c.kind === 'cyl') {
        if (c.x + c.r < x0 || c.x - c.r > x1 || c.z + c.r < z0 || c.z - c.r > z1) continue;
        t = rayCylinder(ox, oy, oz, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1);
      } else {
        if (c.maxX < x0 || c.minX > x1 || c.maxZ < z0 || c.minZ > z1) continue;
        t = rayAabb(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
      }
      if (t < best) best = t;
    }
    return best;
  }

  hasLineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.05;
  }

  randomLandPoint(rand: () => number): { x: number; y: number; z: number } {
    for (let i = 0; i < 60; i++) {
      const x = (rand() - 0.5) * this.size * 0.8;
      const z = (rand() - 0.5) * this.size * 0.8;
      const h = this.terrainHeight(x, z);
      if (h < 1.5 || h > 45) continue;
      if (this.blocked(x, z, PLAYER_RADIUS + 0.2)) continue;
      return { x, y: this.groundHeight(x, z, h), z };
    }
    return { x: 0, y: this.groundHeight(0, 0, this.terrainHeight(0, 0)), z: 0 };
  }

  nearestOutpost(x: number, z: number): { outpost: Outpost; dist: number } | null {
    let best: Outpost | null = null;
    let bestD = Infinity;
    for (const o of this.outposts) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bestD) (best = o), (bestD = d);
    }
    return best ? { outpost: best, dist: bestD } : null;
  }

  // ------------------------------------------------------------- internals

  private raycastTerrain(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    if (oy < this.terrainHeight(ox, oz)) return 0;
    const step = 0.75;
    let prev = 0;
    let t = 0;
    while (t < maxT) {
      t = Math.min(t + step, maxT);
      const y = oy + dy * t;
      if (y > this.maxHeight && dy >= 0) return Infinity;
      if (y < this.terrainHeight(ox + dx * t, oz + dz * t)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 10; i++) {
          const m = (lo + hi) / 2;
          if (oy + dy * m < this.terrainHeight(ox + dx * m, oz + dz * m)) hi = m;
          else lo = m;
        }
        return hi;
      }
      prev = t;
    }
    return Infinity;
  }

  private query(x: number, z: number, r: number): Collider[] {
    const out = this.nearby;
    out.length = 0;
    const stamp = ++this.stamp;
    const gx0 = Math.floor((x - r) / GRID_CELL);
    const gx1 = Math.floor((x + r) / GRID_CELL);
    const gz0 = Math.floor((z - r) / GRID_CELL);
    const gz1 = Math.floor((z + r) / GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const cell = this.grid.get((gx + GRID_OFFSET) * 4096 + gz + GRID_OFFSET);
        if (!cell) continue;
        for (const c of cell) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  private insert(c: Collider): void {
    const [x0, z0, x1, z1] =
      c.kind === 'cyl' ? [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r] : [c.minX, c.minZ, c.maxX, c.maxZ];
    for (let gx = Math.floor(x0 / GRID_CELL); gx <= Math.floor(x1 / GRID_CELL); gx++) {
      for (let gz = Math.floor(z0 / GRID_CELL); gz <= Math.floor(z1 / GRID_CELL); gz++) {
        const key = (gx + GRID_OFFSET) * 4096 + gz + GRID_OFFSET;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(c);
      }
    }
  }

  private blocked(x: number, z: number, pad: number): boolean {
    for (const c of this.query(x, z, pad)) if (overlapsFootprint(c, x, z, pad)) return true;
    return false;
  }

  private nearOutpost(x: number, z: number, r: number): boolean {
    return this.outposts.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  }

  private nearProp(x: number, z: number, pad: number): boolean {
    return this.props.some((p) => overlapsFootprint(p.box, x, z, pad));
  }

  private rawHeight(x: number, z: number): number {
    const s = this.seed;
    const d = Math.hypot(x, z) / this.half;
    const coast = d + (fbm(x / 110, z / 110, s + 7, 3) - 0.5) * 0.4;
    const island = 1 - smoothstep(0.58, 0.92, coast);
    const hills = fbm(x / 170, z / 170, s, 5);
    const ridge = 1 - Math.abs(fbm(x / 80, z / 80, s + 31, 4) * 2 - 1);
    const mountain = smoothstep(0.5, 0.72, fbm(x / 260, z / 260, s + 57, 3));
    const land = 2 + hills * 20 + ridge * ridge * 6 + mountain * ridge * 38;
    return island * land - (1 - island) * 14;
  }

  private heightRange(x0: number, z0: number, x1: number, z1: number): [number, number] {
    const hs = [
      this.terrainHeight(x0, z0),
      this.terrainHeight(x1, z0),
      this.terrainHeight(x0, z1),
      this.terrainHeight(x1, z1),
      this.terrainHeight((x0 + x1) / 2, (z0 + z1) / 2),
    ];
    return [Math.min(...hs), Math.max(...hs)];
  }

  private addProp(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    style: PropStyle, tint = 0,
  ): void {
    const box: Box = { kind: 'box', minX, minY, minZ, maxX, maxY, maxZ, stamp: 0 };
    this.props.push({ box, style, tint });
    this.colliders.push(box);
  }

  private placeOutposts(rng: () => number): void {
    for (let attempt = 0; attempt < 500 && this.outposts.length < OUTPOST_NAMES.length; attempt++) {
      const x = (rng() - 0.5) * this.size * 0.7;
      const z = (rng() - 0.5) * this.size * 0.7;
      const y = this.terrainHeight(x, z);
      if (y < 3 || y > 30) continue;
      let rough = 0;
      for (const [ox, oz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
        rough = Math.max(rough, Math.abs(this.terrainHeight(x + ox, z + oz) - y));
      }
      if (rough > 7) continue;
      if (this.outposts.some((o) => Math.hypot(o.x - x, o.z - z) < 160)) continue;
      this.outposts.push({ name: OUTPOST_NAMES[this.outposts.length], x, y, z });
    }

    // Flatten a plateau under each outpost.
    const n = this.res + 1;
    const inner = 22;
    const outer = 42;
    for (const o of this.outposts) {
      for (let iz = 0; iz < n; iz++) {
        const z = -this.half + iz * this.cell;
        if (Math.abs(z - o.z) > outer) continue;
        for (let ix = 0; ix < n; ix++) {
          const x = -this.half + ix * this.cell;
          const d = Math.hypot(x - o.x, z - o.z);
          if (d > outer) continue;
          const i = iz * n + ix;
          this.heights[i] += (o.y - this.heights[i]) * smoothstep(outer, inner, d);
        }
      }
    }
  }

  private buildOutpost(o: Outpost, rng: () => number): void {
    const y = o.y;
    const S = 14;
    const T = 0.25;

    // Perimeter walls with a gate in the middle of each side; some collapsed.
    for (let side = 0; side < 4; side++) {
      for (const [a, b] of [[-S, -2.5], [2.5, S]]) {
        const roll = rng();
        if (roll < 0.2) continue;
        const h = roll < 0.4 ? 1.2 : 3;
        if (side === 0) this.addProp(o.x + a, y - 0.5, o.z - S - T, o.x + b, y + h, o.z - S + T, 'wall');
        if (side === 1) this.addProp(o.x + a, y - 0.5, o.z + S - T, o.x + b, y + h, o.z + S + T, 'wall');
        if (side === 2) this.addProp(o.x - S - T, y - 0.5, o.z + a, o.x - S + T, y + h, o.z + b, 'wall');
        if (side === 3) this.addProp(o.x + S - T, y - 0.5, o.z + a, o.x + S + T, y + h, o.z + b, 'wall');
      }
    }

    // Watchtower: raised platform with parapets, reached by stairs on +x.
    const px = o.x - 6;
    const pz = o.z - 6;
    const top = y + 4;
    this.addProp(px - 2, top - 0.4, pz - 2, px + 2, top, pz + 2, 'wood');
    for (const cx of [-1.75, 1.75]) {
      for (const cz of [-1.75, 1.75]) {
        this.addProp(px + cx - 0.2, y - 0.5, pz + cz - 0.2, px + cx + 0.2, top - 0.4, pz + cz + 0.2, 'wood');
      }
    }
    this.addProp(px - 2, top, pz - 2, px + 2, top + 1, pz - 1.8, 'wood');
    this.addProp(px - 2, top, pz + 1.8, px + 2, top + 1, pz + 2, 'wood');
    this.addProp(px - 2, top, pz - 2, px - 1.8, top + 1, pz + 2, 'wood');
    for (let i = 0; i < 7; i++) {
      this.addProp(px + 2 + i, y - 0.5, pz - 0.8, px + 3 + i, top - 0.5 - 0.5 * i, pz + 0.8, 'wood');
    }

    // Shipping containers and crates as cover inside the walls.
    const taken: [number, number, number, number][] = [[px - 3, pz - 3, px + 10.5, pz + 3]];
    const free = (x0: number, z0: number, x1: number, z1: number) =>
      taken.every(([a, b, c, d]) => x1 + 1.2 < a || x0 - 1.2 > c || z1 + 1.2 < b || z0 - 1.2 > d);

    for (let placed = 0, tries = 0; placed < 2 && tries < 30; tries++) {
      const alongX = rng() < 0.5;
      const hx = alongX ? 3 : 1.2;
      const hz = alongX ? 1.2 : 3;
      const cx = o.x + (rng() - 0.5) * 2 * (S - 5);
      const cz = o.z + (rng() - 0.5) * 2 * (S - 5);
      if (!free(cx - hx, cz - hz, cx + hx, cz + hz)) continue;
      taken.push([cx - hx, cz - hz, cx + hx, cz + hz]);
      this.addProp(cx - hx, y - 0.2, cz - hz, cx + hx, y + 2.6, cz + hz, 'metal', rng());
      placed++;
    }

    for (let placed = 0, tries = 0; placed < 8 && tries < 60; tries++) {
      const s = rng() < 0.5 ? 1.2 : 1.6;
      const cx = o.x + (rng() - 0.5) * 2 * (S - 2.5);
      const cz = o.z + (rng() - 0.5) * 2 * (S - 2.5);
      const h = s / 2;
      if (!free(cx - h, cz - h, cx + h, cz + h)) continue;
      taken.push([cx - h, cz - h, cx + h, cz + h]);
      this.addProp(cx - h, y - 0.2, cz - h, cx + h, y + s, cz + h, 'crate', rng());
      if (rng() < 0.35) {
        const s2 = 1.1;
        const ox = cx + (rng() - 0.5) * 0.3;
        const oz = cz + (rng() - 0.5) * 0.3;
        this.addProp(ox - s2 / 2, y + s, oz - s2 / 2, ox + s2 / 2, y + s + s2, oz + s2 / 2, 'crate', rng());
      }
      placed++;
    }
  }

  /** Ruined walls and crate piles out in the open, so fields have some cover. */
  private scatterCover(rng: () => number): void {
    for (let placed = 0, tries = 0; placed < 45 && tries < 800; tries++) {
      const x = (rng() - 0.5) * this.size * 0.8;
      const z = (rng() - 0.5) * this.size * 0.8;
      const y = this.terrainHeight(x, z);
      if (y < 1.5 || y > 40 || this.nearOutpost(x, z, 35)) continue;
      placed++;
      if (rng() < 0.5) {
        const len = 3 + rng() * 4;
        const h = 1.2 + rng() * 1.4;
        const alongX = rng() < 0.5;
        const hx = alongX ? len / 2 : 0.3;
        const hz = alongX ? 0.3 : len / 2;
        const [lo, hi] = this.heightRange(x - hx, z - hz, x + hx, z + hz);
        this.addProp(x - hx, lo - 0.3, z - hz, x + hx, hi + h, z + hz, 'wall');
      } else {
        const count = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < count; k++) {
          const s = 1.1 + rng() * 0.5;
          const cx = x + k * 1.9;
          const cz = z + (rng() - 0.5) * 0.8;
          const [lo, hi] = this.heightRange(cx - s / 2, cz - s / 2, cx + s / 2, cz + s / 2);
          this.addProp(cx - s / 2, lo - 0.3, cz - s / 2, cx + s / 2, hi + s, cz + s / 2, 'crate', rng());
        }
      }
    }
  }

  private placeTrees(rng: () => number): void {
    for (let tries = 0; this.trees.length < 1100 && tries < 12000; tries++) {
      const x = (rng() - 0.5) * this.size * 0.96;
      const z = (rng() - 0.5) * this.size * 0.96;
      const y = this.terrainHeight(x, z);
      if (y < 1.5 || y > 50) continue;
      if (fbm(x / 110, z / 110, this.seed + 99, 3) < 0.48) continue;
      if (this.nearOutpost(x, z, 30) || this.nearProp(x, z, 2)) continue;
      const s = 0.8 + rng() * 0.7;
      this.trees.push({ x, y, z, s });
      this.colliders.push({ kind: 'cyl', x, z, r: 0.3 * s + 0.05, y0: y - 1, y1: y + 7 * s, stamp: 0 });
    }
  }

  private placeRocks(rng: () => number): void {
    for (let tries = 0; this.rocks.length < 280 && tries < 4000; tries++) {
      const x = (rng() - 0.5) * this.size * 0.96;
      const z = (rng() - 0.5) * this.size * 0.96;
      const y = this.terrainHeight(x, z);
      if (y < -0.5 || y > 55) continue;
      if (this.nearOutpost(x, z, 26) || this.nearProp(x, z, 3)) continue;
      const r = 0.6 + rng() ** 2 * 2.6;
      const h = r * (0.6 + rng() * 0.6);
      this.rocks.push({ x, y, z, r, h, rot: rng() * Math.PI * 2 });
      this.colliders.push({ kind: 'cyl', x, z, r: r * 0.85, y0: y - 1, y1: y + h * 0.85, stamp: 0 });
    }
  }
}
