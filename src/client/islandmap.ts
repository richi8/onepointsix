import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import type { Rect, World } from '../shared/world.ts';

// One coarse map over the whole island that the rain and the light inside
// buildings both read, so it costs materials a single texture:
// - red: the top of the highest standing roof over each cell, or NO_ROOF,
//   so floors under roofs far off stay dry (the rain's own map is sharper,
//   but reaches only 32 m round the camera);
// - green: how much water gathers there in rain, 0 to 1: hollows in the
//   ground, where it's flat enough to hold a puddle, and a little on level
//   ground;
// - blue: which building's light volume covers the cell, its slot plus one,
//   or 0 for none (see indoorlight.ts).

/** Metres across a cell. */
export const ISLAND_CELL = 2;
/** Roof height where there's none. */
export const NO_ROOF = -1000;
/** Metres round a cell over which the ground is averaged, to tell a hollow. */
const HOLLOW_REACH = 6;
/** How far below its surroundings, metres, the ground has to lie to hold a puddle and to be full of one. */
const HOLLOW_START = 0.015;
const HOLLOW_FULL = 0.12;
/** Steeper than this (rise over run) holds no water. */
const HOLLOW_SLOPE = 0.08;
/** Ground about this flat, such as an outpost's yard, gathers some water wherever it's a touch lower. */
const LEVEL_SLOPE = 0.025;
const LEVEL_GATHER = 0.35;

export const islandUniforms = {
  islandMap: { value: new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType) },
  /** The map's corner in the world (x, z), one over its width, and its cells a side. */
  islandCorner: { value: new THREE.Vector4(0, 0, 1, 1) },
};

/**
 * GLSL: `islandCell(p)` is the map's cell under world point `p`, unfiltered;
 * `islandPuddle(p)` how much water gathers there, filtered.
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
    const cellsOf = (r: Rect): [number, number, number, number] => [
      Math.max(Math.ceil((r.minX - x0) / ISLAND_CELL - 0.5), 0),
      Math.min(Math.floor((r.maxX - x0) / ISLAND_CELL - 0.5), n - 1),
      Math.max(Math.ceil((r.minZ - x0) / ISLAND_CELL - 0.5), 0),
      Math.min(Math.floor((r.maxZ - x0) / ISLAND_CELL - 0.5), n - 1),
    ];
    // Cells whose middle is under the area, a cell more all round.
    const [a0, a1, b0, b1] = area ? cellsOf({ minX: area.minX - ISLAND_CELL, maxX: area.maxX + ISLAND_CELL, minZ: area.minZ - ISLAND_CELL, maxZ: area.maxZ + ISLAND_CELL }) : [0, n - 1, 0, n - 1];
    const top = new Float32Array(n * n).fill(NO_ROOF);
    for (const p of this.world.panels) {
      const b = p.box;
      if (p.kind !== 'roof' || b.gone) continue;
      const [i0, i1, j0, j1] = cellsOf(b);
      for (let j = Math.max(j0, b0); j <= Math.min(j1, b1); j++) {
        for (let i = Math.max(i0, a0); i <= Math.min(i1, a1); i++) top[j * n + i] = Math.max(top[j * n + i], b.maxY);
      }
    }
    for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) this.data[(j * n + i) * 4] = THREE.DataUtils.toHalfFloat(top[j * n + i]);
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

  /** The top of the roof over (x, z) in the map, or NO_ROOF. */
  roofAt(x: number, z: number): number {
    const i = this.index(x, z);
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
