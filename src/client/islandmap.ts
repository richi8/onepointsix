import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import type { Panel, Rect, World } from '../shared/world.ts';

// One coarse map over the whole island that the rain and the light inside
// buildings both read, so it costs materials a single texture:
// - red: the top of the highest standing roof over each cell, or NO_ROOF,
//   so floors under roofs far off stay dry (the rain's own map is sharper,
//   but reaches only 32 m round the camera);
// - alpha: which part of the cell the roofs cover, where an edge crosses
//   it, so the floor just inside a far wall stays dry too (see `coverCode`);
// - green: how much water gathers there in rain, 0 to 1: hollows in the
//   ground, where it's flat enough to hold a puddle, and a little on level
//   ground;
// - blue: which building's light volume covers the cell, its slot plus one,
//   or 0 for none (see indoorlight.ts).

/** Metres across a cell. */
export const ISLAND_CELL = 2;
/** Roof height where there's none. */
export const NO_ROOF = -1000;
/** Steps across a cell in which a roof's edge is placed. */
const EDGE_STEPS = 16;
/** Metres round a cell over which the ground is averaged, to tell a hollow. */
const HOLLOW_REACH = 6;
/** How far below its surroundings, metres, the ground has to lie to hold a puddle and to be full of one. */
const HOLLOW_START = 0.015;
const HOLLOW_FULL = 0.12;
/** Steeper than this (rise over run) holds no water. */
const HOLLOW_SLOPE = 0.08;
/** Ground about this flat, such as an outpost's yard, gathers some water wherever it's a touch lower. */
const LEVEL_SLOPE = 0.025;
export const LEVEL_GATHER = 0.35;

export const islandUniforms = {
  islandMap: { value: new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType) },
  /** The map's corner in the world (x, z), one over its width, and its cells a side. */
  islandCorner: { value: new THREE.Vector4(0, 0, 1, 1) },
};

/** Whether a panel keeps the rain off what's below it: a roof, or a floor with a room under it. */
export function shelters(p: Panel): boolean {
  return (p.kind === 'roof' || p.kind === 'floor') && !p.box.gone;
}

/**
 * The part of a cell covered along one axis, from step `a` to step `b` of
 * EDGE_STEPS, as a code from 0 to 31: 0 for all of it, 1 to 15 for from that
 * step to the far side, 17 to 31 for from the near side to that step less 16.
 * Not reaching either side, it's taken to reach the nearer.
 */
function edgeCode(a: number, b: number): number {
  if (a <= 0 && b >= EDGE_STEPS) return 0;
  if (a > 0 && (b >= EDGE_STEPS || EDGE_STEPS - a > b)) return a;
  return EDGE_STEPS + b;
}

function underEdge(f: number, code: number): boolean {
  if (code === 0) return true;
  return code < EDGE_STEPS ? f >= code / EDGE_STEPS : f <= (code - EDGE_STEPS) / EDGE_STEPS;
}

/**
 * Which part of a cell the roofs over it cover, from `mask`, EDGE_STEPS² steps
 * of it marked where any roof touches them, rows along z: a code along x plus
 * 32 times one along z (see `edgeCode`) for a rectangle covered; or, plus
 * 1024, for a rectangle left open at a side or corner, as at the inside
 * corner of an L-shaped building. Whichever reads the fewer steps wrongly,
 * rounded outward onto the roof, so a floor under one is never read as out
 * in the rain; ground outside may be read as under it, a step off its edge.
 */
export function coverCode(mask: Uint8Array): number {
  const n = EDGE_STEPS;
  const covered = [n, -1, n, -1];
  const open = [n, -1, n, -1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const box = mask[j * n + i] ? covered : open;
      box[0] = Math.min(box[0], i);
      box[1] = Math.max(box[1], i);
      box[2] = Math.min(box[2], j);
      box[3] = Math.max(box[3], j);
    }
  }
  if (open[1] < 0) return 0;
  const count = (box: number[], value: number) => {
    let c = 0;
    for (let j = box[2]; j <= box[3]; j++) for (let i = box[0]; i <= box[1]; i++) c += mask[j * n + i] === value ? 1 : 0;
    return c;
  };
  const code = (box: number[]) => edgeCode(box[0], box[1] + 1) + 32 * edgeCode(box[2], box[3] + 1);
  const atSide = (lo: number, hi: number) => lo === 0 || hi === n - 1;
  const rectWrong = count(covered, 0);
  if (rectWrong > 0 && atSide(open[0], open[1]) && atSide(open[2], open[3]) && count(open, 1) === 0) return 1024 + code(open);
  return code(covered);
}

/** Whether (fx, fz), fractions across a cell, is under what `code` says the roofs cover (see `coverCode`). */
export function underCover(code: number, fx: number, fz: number): boolean {
  const inside = underEdge(fx, code % 32) && underEdge(fz, Math.floor(code / 32) % 32);
  return code >= 1024 ? !inside : inside;
}

/**
 * GLSL: `islandCell(p)` is the map's cell under world point `p`, unfiltered;
 * `islandRoof(p)` the top of the roof over `p`, or NO_ROOF; `islandPuddle(p)`
 * how much water gathers there, filtered.
 */
export const ISLAND_GLSL = /* glsl */ `
  #ifndef ISLAND_MAP
  #define ISLAND_MAP
  uniform sampler2D islandMap;
  uniform vec4 islandCorner;
  vec4 islandCell(vec3 p) {
    ivec2 c = ivec2(floor((p.xz - islandCorner.xy) * islandCorner.z * islandCorner.w));
    int n = int(islandCorner.w) - 1;
    return texelFetch(islandMap, clamp(c, ivec2(0), ivec2(n)), 0);
  }
  bool islandUnderEdge(float f, float code) {
    return code < 0.5 || (code < ${EDGE_STEPS}.0 ? f >= code / ${EDGE_STEPS}.0 : f <= (code - ${EDGE_STEPS}.0) / ${EDGE_STEPS}.0);
  }
  float islandRoof(vec3 p) {
    vec4 cell = islandCell(p);
    vec2 f = fract((p.xz - islandCorner.xy) * islandCorner.z * islandCorner.w);
    int code = int(cell.a + 0.5);
    bool inside = islandUnderEdge(f.x, float(code & 31)) && islandUnderEdge(f.y, float((code >> 5) & 31));
    return inside != (code >= 1024) ? cell.r : ${NO_ROOF.toFixed(1)};
  }
  float islandPuddle(vec3 p) {
    return texture(islandMap, (p.xz - islandCorner.xy) * islandCorner.z).g;
  }
  #endif
`;

/** The island's map, kept up to date as roofs fall; one per island. */
export class IslandMap {
  private readonly world: World;
  readonly cells: number;
  /** The map as half floats, RGBA per cell, rows along z. */
  private readonly data: Uint16Array;
  private readonly texture: THREE.DataTexture;

  constructor(world: World) {
    this.world = world;
    this.cells = Math.ceil(world.size / ISLAND_CELL);
    this.data = new Uint16Array(this.cells * this.cells * 4);
    this.texture = new THREE.DataTexture(this.data, this.cells, this.cells, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.puddles();
    this.roofs();
    islandUniforms.islandMap.value = this.texture;
    islandUniforms.islandCorner.value.set(-world.half, -world.half, 1 / (this.cells * ISLAND_CELL), this.cells);
  }

  /** Work out the roofs again, after one has fallen or been rebuilt: everywhere, or only over `area`. */
  roofs(area?: Rect): void {
    const n = this.cells;
    const x0 = -this.world.half;
    // Cells any part of which is under the rectangle.
    const cellsOf = (r: Rect): [number, number, number, number] => [
      Math.max(Math.floor((r.minX - x0) / ISLAND_CELL), 0),
      Math.min(Math.ceil((r.maxX - x0) / ISLAND_CELL) - 1, n - 1),
      Math.max(Math.floor((r.minZ - x0) / ISLAND_CELL), 0),
      Math.min(Math.ceil((r.maxZ - x0) / ISLAND_CELL) - 1, n - 1),
    ];
    // The area's cells, a cell more all round.
    const [a0, a1, b0, b1] = area ? cellsOf({ minX: area.minX - ISLAND_CELL, maxX: area.maxX + ISLAND_CELL, minZ: area.minZ - ISLAND_CELL, maxZ: area.maxZ + ISLAND_CELL }) : [0, n - 1, 0, n - 1];
    const w = a1 - a0 + 1;
    const top = new Float32Array(w * (b1 - b0 + 1)).fill(NO_ROOF);
    // Cells covered whole, and for those covered in part, which steps of them (see coverCode).
    const whole = new Uint8Array(top.length);
    const masks = new Map<number, Uint8Array>();
    const steps = (lo: number, hi: number): [number, number] => [
      Math.max(Math.floor(lo * EDGE_STEPS), 0), Math.min(Math.ceil(hi * EDGE_STEPS), EDGE_STEPS) - 1,
    ];
    for (const p of this.world.panels) {
      if (!shelters(p)) continue;
      const b = p.box;
      const [i0, i1, j0, j1] = cellsOf(b);
      for (let j = Math.max(j0, b0); j <= Math.min(j1, b1); j++) {
        for (let i = Math.max(i0, a0); i <= Math.min(i1, a1); i++) {
          const k = (j - b0) * w + (i - a0);
          top[k] = Math.max(top[k], b.maxY);
          if (whole[k]) continue;
          const cx = x0 + i * ISLAND_CELL;
          const cz = x0 + j * ISLAND_CELL;
          const [s0, s1] = steps((b.minX - cx) / ISLAND_CELL, (b.maxX - cx) / ISLAND_CELL);
          const [t0, t1] = steps((b.minZ - cz) / ISLAND_CELL, (b.maxZ - cz) / ISLAND_CELL);
          if (s0 === 0 && t0 === 0 && s1 === EDGE_STEPS - 1 && t1 === EDGE_STEPS - 1) {
            whole[k] = 1;
            masks.delete(k);
            continue;
          }
          let mask = masks.get(k);
          if (!mask) masks.set(k, (mask = new Uint8Array(EDGE_STEPS * EDGE_STEPS)));
          for (let t = t0; t <= t1; t++) mask.fill(1, t * EDGE_STEPS + s0, t * EDGE_STEPS + s1 + 1);
        }
      }
    }
    for (let j = b0; j <= b1; j++) {
      for (let i = a0; i <= a1; i++) {
        const k = (j - b0) * w + (i - a0);
        const mask = masks.get(k);
        this.data[(j * n + i) * 4] = THREE.DataUtils.toHalfFloat(top[k]);
        this.data[(j * n + i) * 4 + 3] = THREE.DataUtils.toHalfFloat(mask ? coverCode(mask) : 0);
      }
    }
    this.texture.needsUpdate = true;
  }

  /** Mark each building's cells with its slot plus one, from `bounds(slot)`: its light volume's corners on the ground. */
  slots(count: number, bounds: (slot: number) => [number, number, number, number]): void {
    const n = this.cells;
    const x0 = -this.world.half;
    for (let i = 0; i < n * n; i++) this.data[i * 4 + 2] = 0;
    for (let s = 0; s < count; s++) {
      const [minX, minZ, maxX, maxZ] = bounds(s);
      const one = THREE.DataUtils.toHalfFloat(s + 1);
      for (let j = Math.max(Math.floor((minZ - x0) / ISLAND_CELL), 0); j <= Math.min(Math.floor((maxZ - x0) / ISLAND_CELL), n - 1); j++) {
        for (let i = Math.max(Math.floor((minX - x0) / ISLAND_CELL), 0); i <= Math.min(Math.floor((maxX - x0) / ISLAND_CELL), n - 1); i++) {
          this.data[(j * n + i) * 4 + 2] = one;
        }
      }
    }
    this.texture.needsUpdate = true;
  }

  /** The top of the roof over (x, z) in the map, or NO_ROOF, as the shaders read it. */
  roofAt(x: number, z: number): number {
    const i = this.index(x, z);
    const code = THREE.DataUtils.fromHalfFloat(this.data[i * 4 + 3]);
    const fx = (x + this.world.half) / ISLAND_CELL;
    const fz = (z + this.world.half) / ISLAND_CELL;
    if (!underCover(code, fx - Math.floor(fx), fz - Math.floor(fz))) return NO_ROOF;
    return THREE.DataUtils.fromHalfFloat(this.data[i * 4]);
  }

  /** How much water gathers at (x, z) in the map, 0 to 1. */
  puddleAt(x: number, z: number): number {
    return THREE.DataUtils.fromHalfFloat(this.data[this.index(x, z) * 4 + 1]);
  }

  private index(x: number, z: number): number {
    const n = this.cells;
    const i = Math.min(Math.max(Math.floor((x + this.world.half) / ISLAND_CELL), 0), n - 1);
    const j = Math.min(Math.max(Math.floor((z + this.world.half) / ISLAND_CELL), 0), n - 1);
    return j * n + i;
  }

  /**
   * Where water gathers: cells lower than the ground round them, and flat
   * enough to hold it; not in the sea.
   */
  private puddles(): void {
    const n = this.cells;
    const w = this.world;
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) h[j * n + i] = w.terrainHeight(-w.half + (i + 0.5) * ISLAND_CELL, -w.half + (j + 0.5) * ISLAND_CELL);
    }
    // The ground round each cell, by a box blur each way.
    const r = Math.round(HOLLOW_REACH / ISLAND_CELL);
    const across = new Float32Array(n * n);
    const round = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += h[j * n + Math.min(Math.max(i, 0), n - 1)];
      for (let i = 0; i < n; i++) {
        across[j * n + i] = sum / (2 * r + 1);
        sum += h[j * n + Math.min(i + r + 1, n - 1)] - h[j * n + Math.max(i - r, 0)];
      }
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) sum += across[Math.min(Math.max(j, 0), n - 1) * n + i];
      for (let j = 0; j < n; j++) {
        round[j * n + i] = sum / (2 * r + 1);
        sum += across[Math.min(j + r + 1, n - 1) * n + i] - across[Math.max(j - r, 0) * n + i];
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const gx = (h[j * n + Math.min(i + 1, n - 1)] - h[j * n + Math.max(i - 1, 0)]) / (2 * ISLAND_CELL);
        const gz = (h[Math.min(j + 1, n - 1) * n + i] - h[Math.max(j - 1, 0) * n + i]) / (2 * ISLAND_CELL);
        const flat = 1 - smooth(HOLLOW_SLOPE * 0.5, HOLLOW_SLOPE, Math.hypot(gx, gz));
        const hollow = smooth(HOLLOW_START, HOLLOW_FULL, round[k] - h[k]);
        const level = 1 - smooth(LEVEL_SLOPE * 0.5, LEVEL_SLOPE, Math.hypot(gx, gz));
        const dry = h[k] > WATER_LEVEL + 0.3 ? 1 : 0;
        this.data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(Math.max(hollow * flat, level * LEVEL_GATHER) * dry);
      }
    }
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
