import * as THREE from 'three';
import { HOUSE_ROOF, inBuilding, type Box, type Building, type World } from '../shared/world.ts';

// How much of the sky's light reaches each point inside the buildings. Each
// building has a small grid of cells over it, and each cell holds the share of
// directions up to the sky that leave the building through a doorway, a
// window or a hole in the roof without meeting a wall. So a room is lit from
// its windows and doors and dark in its far corners, and a blown-out wall or
// a fallen roof lets the light in. The grids are stacked in one 3D texture
// that materials sample; a building's grid is worked out again, a little each
// frame, when its doors or panels change.

/** Most buildings with a grid in the texture. */
export const MAX_BUILDINGS = 16;
/** Buildings nearest the camera that materials look at: the rest are left lit as outdoors. */
const NEAR = 4;
/** Cells along each side of a building's slot in the texture, x, y and z. */
const SLOT: [number, number, number] = [32, 16, 32];
/** About how wide a cell is, metres; each building's cells are fitted to its footprint. */
const CELL = 0.5;
/** Rays are marched through blocks this wide. */
const VOXEL = 0.25;
/** Directions up to the sky each cell looks along. */
const RAYS = 40;
/** Light inside with no sky in view, from light bouncing about. */
const BOUNCE = 0.3;
/** How much the share of sky seen is worth: a point beside a wall, seeing half the sky, is fully lit. */
const GAIN = 2.6;
/** Light in a building before its grid is worked out: the old flat share. */
const FLAT = 0.3;
/** Milliseconds a frame may spend working out grids. */
const BUDGET = 2.5;

/**
 * Uniforms shared by every material that dims indoors: the texture, and for
 * each of the buildings nearest the camera the corner of its grid with its
 * slot in `w` (-1 for none), cells per metre along x, y and z, and the cell
 * count each way.
 */
export const indoorUniforms = {
  indoorGrid: { value: blank() as THREE.Data3DTexture },
  indoorCorner: { value: Array.from({ length: NEAR }, () => new THREE.Vector4(0, 0, 0, -1)) },
  indoorScale: { value: Array.from({ length: NEAR }, () => new THREE.Vector4()) },
  indoorCount: { value: Array.from({ length: NEAR }, () => new THREE.Vector3()) },
};

/**
 * GLSL for a fragment shader: `indoorSky(p, n)` is the share of the sky's light
 * reaching point `p` on a surface facing `n`, both in world space. It looks a
 * little off the surface, into the space it faces, so a wall's inside face
 * and its outside face each read their own side.
 */
export const INDOOR_GLSL = /* glsl */ `
  uniform highp sampler3D indoorGrid;
  uniform vec4 indoorCorner[${NEAR}];
  uniform vec4 indoorScale[${NEAR}];
  uniform vec3 indoorCount[${NEAR}];
  float indoorSky(vec3 p, vec3 n) {
    vec3 q = p + n * 0.2;
    for (int i = 0; i < ${NEAR}; i++) {
      vec4 corner = indoorCorner[i];
      if (corner.w < 0.0) continue;
      vec3 c = (q - corner.xyz) * indoorScale[i].xyz;
      vec3 count = indoorCount[i];
      if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, count))) continue;
      c = clamp(c, vec3(0.5), count - 0.5);
      vec3 uvw = vec3(c.x / ${SLOT[0]}.0, c.y / ${SLOT[1]}.0, (corner.w * ${SLOT[2]}.0 + c.z) / (${SLOT[2] * MAX_BUILDINGS}.0));
      return texture(indoorGrid, uvw).r;
    }
    return 1.0;
  }
`;

/**
 * Patch a shader, as it's compiled, to dim the sky's light (and the
 * environment's reflections) indoors. Direct light is left alone: shadows
 * already keep the sun out, bar what comes through doors and windows.
 */
export function addIndoor(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, indoorUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vIndoorWorld;')
    .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
      {
        vec4 indoorP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          indoorP = instanceMatrix * indoorP;
        #endif
        vIndoorWorld = (modelMatrix * indoorP).xyz;
      }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vIndoorWorld;\n${INDOOR_GLSL}`)
    .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
      {
        float sky = indoorSky(vIndoorWorld, inverseTransformDirection(normal, viewMatrix));
        reflectedLight.indirectDiffuse *= sky;
        reflectedLight.indirectSpecular *= sky;
      }`);
}

/** Make any material dim indoors, keeping whatever it already does as it compiles. */
export function dimIndoors(material: THREE.Material): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    addIndoor(shader);
  };
  material.customProgramCacheKey = () => `${key()}-indoor`;
}

/** A building's cells: where they start, how wide they are and how many there are each way. */
interface Grid {
  building: Building;
  x0: number;
  y0: number;
  z0: number;
  sx: number;
  sy: number;
  sz: number;
  nx: number;
  ny: number;
  nz: number;
  /** Top of the roof: cells above it are outdoors. */
  top: number;
  /** The boxes that might stand in its way, standing or not. */
  boxes: Box[];
}

/** One building's grid being worked out, a layer of cells at a time. */
interface Job {
  slot: number;
  /** The next layer of cells up. */
  layer: number;
  /** 1 where a block is solid, over the building and a margin round it. */
  solid: Uint8Array;
  vx: number;
  vy: number;
  vz: number;
  /** The share of sky each cell sees, -1 in a solid block, NaN outdoors. */
  seen: Float32Array;
}

export class IndoorLight {
  private readonly world: World;
  private readonly grids: Grid[] = [];
  private readonly texture: THREE.Data3DTexture;
  private readonly data: Uint8Array;
  /** Buildings changed since they were worked out, to do first, oldest change first. */
  private readonly urgent: number[] = [];
  /** Buildings not worked out yet, done nearest first. */
  private readonly queue: number[] = [];
  /** How each building's cover stood when it was last worked out. */
  private readonly signs: string[] = [];
  private job: Job | null = null;
  /** Where the camera was, to work out the nearest buildings first. */
  private readonly near = new THREE.Vector3();
  /** Unit directions over the sky, spread evenly. */
  private readonly rays: [number, number, number][];

  constructor(world: World) {
    this.world = world;
    this.rays = skyRays(RAYS);
    const [w, h, d] = SLOT;
    this.data = new Uint8Array(w * h * d * MAX_BUILDINGS).fill(255);
    this.texture = new THREE.Data3DTexture(this.data, w, h, d * MAX_BUILDINGS);
    this.texture.format = THREE.RedFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.unpackAlignment = 1;
    indoorUniforms.indoorGrid.value = this.texture;

    world.buildings.slice(0, MAX_BUILDINGS).forEach((b, slot) => {
      const g = gridFor(world, b);
      this.grids.push(g);
      this.flat(slot);
      this.signs.push(this.sign(g));
      this.queue.push(slot);
    });
    this.texture.needsUpdate = true;
    this.focus(this.near);
  }

  /** The share of the sky's light at a point, as materials see it but for the nearest cell. */
  at(x: number, y: number, z: number): number {
    const [w, h, d] = SLOT;
    for (let slot = 0; slot < this.grids.length; slot++) {
      const g = this.grids[slot];
      const ix = Math.floor((x - g.x0) / g.sx);
      const iy = Math.floor((y - g.y0) / g.sy);
      const iz = Math.floor((z - g.z0) / g.sz);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= g.nx || iy >= g.ny || iz >= g.nz) continue;
      return this.data[((slot * d + iz) * h + iy) * w + ix] / 255;
    }
    return 1;
  }

  /** Where the camera is: the buildings round it are the ones drawn dim inside, and worked out first. */
  focus(p: THREE.Vector3): void {
    this.near.copy(p);
    const away = (g: Grid) => {
      const b = g.building;
      return Math.hypot(Math.max(b.minX - p.x, p.x - b.maxX, 0), Math.max(b.minZ - p.z, p.z - b.maxZ, 0));
    };
    const slots = this.grids.map((g, slot) => ({ slot, d: away(g) })).sort((a, b) => a.d - b.d).slice(0, NEAR);
    const { indoorCorner, indoorScale, indoorCount } = indoorUniforms;
    for (let i = 0; i < NEAR; i++) {
      const s = slots[i];
      if (!s) {
        indoorCorner.value[i].w = -1;
        continue;
      }
      const g = this.grids[s.slot];
      indoorCorner.value[i].set(g.x0, g.y0, g.z0, s.slot);
      indoorScale.value[i].set(1 / g.sx, 1 / g.sy, 1 / g.sz, 0);
      indoorCount.value[i].set(g.nx, g.ny, g.nz);
    }
  }

  /** Panels or doors may have changed: work out again each building whose cover isn't as it was. */
  changed(): void {
    this.grids.forEach((g, slot) => {
      if (this.signs[slot] !== this.sign(g)) this.redo(slot);
    });
  }

  /** How a building's cover stands, to tell when it changes. */
  private sign(g: Grid): string {
    const doors = this.world.doors;
    return g.boxes.map((b) => (b.gone ? '-' : b.door !== undefined && doors[b.door].open ? 'o' : '+')).join('');
  }

  /** Once a frame: carry on working out grids for a couple of milliseconds. */
  update(): void {
    if (!this.job && !this.pending()) return;
    const until = performance.now() + BUDGET;
    do {
      if (!this.job) this.job = this.start(this.next());
      if (this.step(this.job)) {
        this.finish(this.job);
        this.job = null;
        if (!this.pending()) break;
      }
    } while (performance.now() < until);
  }

  /** Work out every grid now, as a still picture needs. */
  finishAll(): void {
    while (this.job || this.pending()) {
      if (!this.job) this.job = this.start(this.next());
      while (!this.step(this.job));
      this.finish(this.job);
      this.job = null;
    }
  }

  private pending(): number {
    return this.urgent.length + this.queue.length;
  }

  private redo(slot: number): void {
    // Started over, with whatever changed.
    if (this.job?.slot === slot) this.job = null;
    const i = this.queue.indexOf(slot);
    if (i >= 0) this.queue.splice(i, 1);
    if (!this.urgent.includes(slot)) this.urgent.push(slot);
  }

  /** The next building to work out: the oldest change, or else the nearest not yet done. */
  private next(): number {
    if (this.urgent.length) return this.urgent.shift()!;
    let best = 0;
    let bestD = Infinity;
    this.queue.forEach((slot, i) => {
      const b = this.grids[slot].building;
      const d = Math.hypot((b.minX + b.maxX) / 2 - this.near.x, (b.minZ + b.maxZ) / 2 - this.near.z);
      if (d < bestD) (best = i), (bestD = d);
    });
    return this.queue.splice(best, 1)[0];
  }

  /** Fill a building's slot with the old flat cut: dim inside its walls and under its roof. */
  private flat(slot: number): void {
    const g = this.grids[slot];
    this.fill(slot, (x, y, z) => (inside(g, x, y, z) ? FLAT : 1));
  }

  /** Set every cell of a slot from `value(x, y, z)` at its centre. */
  private fill(slot: number, value: (x: number, y: number, z: number, i: number) => number): void {
    const g = this.grids[slot];
    const [w, h, d] = SLOT;
    for (let iz = 0; iz < g.nz; iz++) {
      for (let iy = 0; iy < g.ny; iy++) {
        for (let ix = 0; ix < g.nx; ix++) {
          const v = value(g.x0 + (ix + 0.5) * g.sx, g.y0 + (iy + 0.5) * g.sy, g.z0 + (iz + 0.5) * g.sz, (iz * g.ny + iy) * g.nx + ix);
          this.data[((slot * d + iz) * h + iy) * w + ix] = Math.round(Math.min(Math.max(v, 0), 1) * 255);
        }
      }
    }
  }

  /** Start on a building: mark which blocks round it are solid. */
  private start(slot: number): Job {
    const g = this.grids[slot];
    this.signs[slot] = this.sign(g);
    const b = g.building;
    // The blocks reach a little past the cells, so rays leave through open air.
    const vx = Math.ceil((g.nx * g.sx) / VOXEL);
    const vy = Math.ceil((g.ny * g.sy) / VOXEL);
    const vz = Math.ceil((g.nz * g.sz) / VOXEL);
    const solid = new Uint8Array(vx * vy * vz);
    for (const box of g.boxes) {
      if (box.gone || box.clear) continue;
      const x0 = Math.max(Math.floor((box.minX - g.x0) / VOXEL), 0);
      const x1 = Math.min(Math.ceil((box.maxX - g.x0) / VOXEL), vx);
      const y0 = Math.max(Math.floor((box.minY - g.y0) / VOXEL), 0);
      const y1 = Math.min(Math.ceil((box.maxY - g.y0) / VOXEL), vy);
      const z0 = Math.max(Math.floor((box.minZ - g.z0) / VOXEL), 0);
      const z1 = Math.min(Math.ceil((box.maxZ - g.z0) / VOXEL), vz);
      for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) solid[(z * vy + y) * vx + x] = 1;
    }
    // The ground under the building.
    for (let z = 0; z < vz; z++) {
      for (let x = 0; x < vx; x++) {
        const ground = this.world.terrainHeight(g.x0 + (x + 0.5) * VOXEL, g.z0 + (z + 0.5) * VOXEL);
        const top = Math.min(Math.ceil((Math.min(ground, b.floor) - g.y0) / VOXEL), vy);
        for (let y = 0; y < top; y++) solid[(z * vy + y) * vx + x] = 1;
      }
    }
    return { slot, layer: 0, solid, vx, vy, vz, seen: new Float32Array(g.nx * g.ny * g.nz) };
  }

  /** Work out one layer of cells. Returns whether the building is done. */
  private step(job: Job): boolean {
    const g = this.grids[job.slot];
    const iy = job.layer++;
    const y = g.y0 + (iy + 0.5) * g.sy;
    for (let iz = 0; iz < g.nz; iz++) {
      const z = g.z0 + (iz + 0.5) * g.sz;
      for (let ix = 0; ix < g.nx; ix++) {
        const x = g.x0 + (ix + 0.5) * g.sx;
        const i = (iz * g.ny + iy) * g.nx + ix;
        if (!inside(g, x, y, z)) {
          job.seen[i] = NaN;
          continue;
        }
        const vx = Math.floor((x - g.x0) / VOXEL);
        const vy = Math.floor((y - g.y0) / VOXEL);
        const vz = Math.floor((z - g.z0) / VOXEL);
        if (job.solid[(vz * job.vy + vy) * job.vx + vx]) {
          job.seen[i] = -1;
          continue;
        }
        let open = 0;
        for (const [dx, dy, dz] of this.rays) if (escapes(job, x - g.x0, y - g.y0, z - g.z0, dx, dy, dz)) open++;
        job.seen[i] = open / this.rays.length;
      }
    }
    return job.layer >= g.ny;
  }

  /** A building is worked out: light its cells, and fill those in walls from the room beside them. */
  private finish(job: Job): void {
    const g = this.grids[job.slot];
    const seen = job.seen;
    const at = (ix: number, iy: number, iz: number) =>
      ix < 0 || iy < 0 || iz < 0 || ix >= g.nx || iy >= g.ny || iz >= g.nz ? NaN : seen[(iz * g.ny + iy) * g.nx + ix];
    this.fill(job.slot, (_x, _y, _z, i) => {
      const s = seen[i];
      if (Number.isNaN(s)) return 1;
      if (s >= 0) return BOUNCE + GAIN * s;
      // In a wall: as the open cells inside next to it, so its inside face reads the room.
      const ix = i % g.nx;
      const iy = Math.floor(i / g.nx) % g.ny;
      const iz = Math.floor(i / (g.nx * g.ny));
      let sum = 0;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = at(ix + dx, iy + dy, iz + dz);
            if (v >= 0) (sum += v), n++;
          }
        }
      }
      return n ? BOUNCE + (GAIN * sum) / n : BOUNCE;
    });
    this.texture.needsUpdate = true;
  }
}

/** A building's cells: a whole number across its footprint each way, and one more all round. */
function gridFor(world: World, b: Building): Grid {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const sx = w / Math.max(1, Math.round(w / CELL));
  const sz = d / Math.max(1, Math.round(d / CELL));
  const sy = CELL;
  const nx = Math.min(Math.round(w / sx) + 2, SLOT[0]);
  const nz = Math.min(Math.round(d / sz) + 2, SLOT[2]);
  const top = b.roof + HOUSE_ROOF;
  const y0 = b.floor - 0.5;
  const ny = Math.min(Math.ceil((top + 0.6 - y0) / sy), SLOT[1]);
  const x0 = b.minX - sx;
  const z0 = b.minZ - sz;
  const boxes = world.colliders.filter((c): c is Box =>
    c.kind === 'box' && c.maxX > x0 - 1 && c.minX < x0 + nx * sx + 1 && c.maxZ > z0 - 1 && c.minZ < z0 + nz * sz + 1 && c.maxY > y0 && c.minY < top + 1);
  return { building: b, x0, y0, z0, sx, sy, sz, nx, ny, nz, top, boxes };
}

/** Whether a point is indoors: within the walls, off the ground and under the roof. */
function inside(g: Grid, x: number, y: number, z: number): boolean {
  return y > g.building.floor - 0.3 && y < g.top && inBuilding(g.building, x, z);
}

/**
 * Whether a ray from (x, y, z), measured from the grid's corner, leaves the
 * blocks without meeting a solid one: a 3D walk from block to block.
 */
function escapes(job: Job, x: number, y: number, z: number, dx: number, dy: number, dz: number): boolean {
  let ix = Math.floor(x / VOXEL);
  let iy = Math.floor(y / VOXEL);
  let iz = Math.floor(z / VOXEL);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(VOXEL / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(VOXEL / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(VOXEL / dz) : Infinity;
  let tx = dx !== 0 ? ((dx > 0 ? (ix + 1) * VOXEL - x : x - ix * VOXEL) / Math.abs(dx)) : Infinity;
  let ty = dy !== 0 ? ((dy > 0 ? (iy + 1) * VOXEL - y : y - iy * VOXEL) / Math.abs(dy)) : Infinity;
  let tz = dz !== 0 ? ((dz > 0 ? (iz + 1) * VOXEL - z : z - iz * VOXEL) / Math.abs(dz)) : Infinity;
  const { solid, vx, vy, vz } = job;
  for (;;) {
    if (tx < ty && tx < tz) {
      ix += stepX;
      tx += tdx;
    } else if (ty < tz) {
      iy += stepY;
      ty += tdy;
    } else {
      iz += stepZ;
      tz += tdz;
    }
    if (ix < 0 || iy < 0 || iz < 0 || ix >= vx || iy >= vy || iz >= vz) return true;
    if (solid[(iz * vy + iy) * vx + ix]) return false;
  }
}

/** `n` directions spread evenly over the sky, from the horizon up. */
function skyRays(n: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = (i + 0.5) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
}

/** A texture that lights everything fully, until the real one is made. */
function blank(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array([255]), 1, 1, 1);
  t.format = THREE.RedFormat;
  t.needsUpdate = true;
  return t;
}
