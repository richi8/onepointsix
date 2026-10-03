import * as THREE from 'three';
import { HOUSE_ROOF, inBuilding, type Box, type Building, type Tree, type World } from '../shared/world.ts';
import { ISLAND_GLSL, islandUniforms, SLOT_PAIR, type IslandMap } from './islandmap.ts';

// How much of the sky's light reaches each point inside the buildings, and
// in what colour. Each building has a small grid of cells over it, and each
// cell holds the share of directions up to the sky that leave the building
// through a doorway or a window without meeting a wall,
// each counted as much as the sky that way isn't hidden outside, by hills,
// trees and other buildings. To that is added the light bounced once off the
// floor, walls and ceiling round it, each as lit as the room is beside it and
// in its own colour, and off the ground outside a doorway: so a room is lit
// from its windows and doors and dark in its far corners, a floor in a pool of
// light brightens the ceiling over it, and a wooden room is warmer than a
// concrete one. A room facing a hill is darker than one facing the sea. The grids are stacked in
// one 3D texture that materials sample, finding a building's grid from the
// island's map (see islandmap.ts); a building's grid is worked out again, a
// little each frame, when its doors or panels change, and so is any other's
// within reach whose sky that changed.

/** Most buildings with a grid in the texture. */
export const MAX_BUILDINGS = 16;
/** Cells along each side of a building's slot in the texture, x, y and z. */
const SLOT: [number, number, number] = [32, 16, 32];
/** About how wide a cell is, metres; each building's cells are fitted to its footprint. */
const CELL = 0.5;
/** Rays are marched through blocks this wide. */
const VOXEL = 0.25;
/** Directions up to the sky each cell looks along. */
const RAYS = 40;
/** Directions all round each cell looks along for light bounced off what's round it. */
const BOUNCE_RAYS = 32;
/** Light inside with no sky in view and nothing lit round it, from light bounced more than once. */
const AMBIENT = 0.15;
/** How much the light bounced off what's round a cell is worth. */
const BOUNCE_GAIN = 4.0;
/** How much the share of sky seen is worth: a point beside a wall, seeing half the sky, is fully lit. */
const GAIN = 2.6;
/** The colour of what's round a building that's not a prop: the ground under it and outside, sRGB. */
const GROUND = 0x6f6a52;
/** Of anything else solid: concrete. */
const CONCRETE = 0x8d8a82;
/** Light in a building before its grid is worked out: the old flat share. */
const FLAT = 0.3;
/** Milliseconds a frame may spend working out grids. */
const BUDGET = 2.5;
/** How far outside a building hills and buildings are looked for, and trees; metres. */
const OUTSIDE_REACH = 150;
const TREE_REACH = 45;
/** How much of the sky a tree's crown hides behind it. */
const CROWN_SHADE = 0.6;
/** Directions outside worked out per step of a job. */
const OUTSIDE_STEP = 8;
/** How much the sky outside a building has to change, any way, for its cells to be worked out again. */
const OUTSIDE_CHANGE = 0.02;
/**
 * Indoors, a floor facing the sky's light straight on would look brighter than
 * the walls round it, though that light comes in sideways through windows: it
 * gets this share of it at most.
 */
const FLOOR_SHARE = 0.7;
/**
 * The sun's light bounced to a cell, as a share of the sun's own, is kept as
 * a share of this, for the bytes to hold it finely: it's never much.
 */
const SUN_RANGE = 0.5;
/** How much the sun's light bounced once is worth, standing in for the light bounced again. */
const SUN_GAIN = 4;
/** The sun no higher than this (the sine of its height) is taken to be down. */
const SUN_LOW = 0.02;
/** Numbers a patch of sun takes in a job's list. */
const PATCH = 9;
/**
 * How much of a patch's light a cell takes, as a surface there would facing
 * it: about half, as surfaces turned from it take light bounced from others.
 */
const PATCH_FACING = 0.5;
/** Patches are taken to be no nearer than this, metres, so one beside a cell doesn't blaze. */
const NEAREST_PATCH = 0.5;

/**
 * Uniforms shared by every material that dims indoors: the textures of the
 * sky's light and the sun's bounced, the sun's light (colour times
 * intensity), and for each building's slot the corner of its grid, cells per
 * metre along x, y and z, and the cell count each way. Which slot a point is
 * in is read from the island's map.
 */
export const indoorUniforms = {
  indoorGrid: { value: blank() as THREE.Data3DTexture },
  indoorSunGrid: { value: blank() as THREE.Data3DTexture },
  indoorSun: { value: new THREE.Color(0, 0, 0) },
  indoorCorner: { value: Array.from({ length: MAX_BUILDINGS }, () => new THREE.Vector4()) },
  indoorScale: { value: Array.from({ length: MAX_BUILDINGS }, () => new THREE.Vector4()) },
  indoorCount: { value: Array.from({ length: MAX_BUILDINGS }, () => new THREE.Vector3()) },
  ...islandUniforms,
};

/**
 * GLSL for a fragment shader: `indoorSky(p, n, sun)` is the share of the sky's
 * light reaching point `p` on a surface facing `n`, both in world space, in
 * each of red, green and blue, and whether that's indoors, 0 to 1; `sun` is
 * set to the sun's light bounced there off what's round it, 0 outdoors. It
 * looks a little off the surface, into the space it faces, so a wall's inside
 * face and its outside face each read their own side.
 */
export const INDOOR_GLSL = /* glsl */ `
  uniform highp sampler3D indoorGrid;
  uniform highp sampler3D indoorSunGrid;
  uniform vec3 indoorSun;
  uniform vec4 indoorCorner[${MAX_BUILDINGS}];
  uniform vec4 indoorScale[${MAX_BUILDINGS}];
  uniform vec3 indoorCount[${MAX_BUILDINGS}];
  ${ISLAND_GLSL}
  vec4 indoorSky(vec3 p, vec3 n, out vec3 sun) {
    sun = vec3(0.0);
    vec3 q = p + n * 0.2;
    int pair = int(islandCell(q).b + 0.5);
    int slot = pair % ${SLOT_PAIR} - 1;
    int other = pair / ${SLOT_PAIR} - 1;
    if (slot < 0) return vec4(1.0, 1.0, 1.0, 0.0);
    if (other >= 0) {
      // Two buildings side by side: the first's, within its walls (inside the
      // ring of cells round its grid), else the second's.
      vec2 w = (q.xz - indoorCorner[slot].xz) * indoorScale[slot].xz;
      if (any(lessThan(w, vec2(1.0))) || any(greaterThan(w, indoorCount[slot].xz - 1.0))) slot = other;
    }
    vec4 corner = indoorCorner[slot];
    vec3 c = (q - corner.xyz) * indoorScale[slot].xyz;
    vec3 count = indoorCount[slot];
    if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, count))) return vec4(1.0, 1.0, 1.0, 0.0);
    c = clamp(c, vec3(0.5), count - 0.5);
    vec3 uvw = vec3(c.x / ${SLOT[0]}.0, c.y / ${SLOT[1]}.0, (float(slot) * ${SLOT[2]}.0 + c.z) / (${SLOT[2] * MAX_BUILDINGS}.0));
    sun = texture(indoorSunGrid, uvw).rgb * ${SUN_RANGE.toFixed(2)} * indoorSun;
    return texture(indoorGrid, uvw);
  }
`;

/**
 * Patch a shader, as it's compiled, to dim the sky's light (and the
 * environment's reflections) indoors, and add the sun's light bounced in.
 * Direct light is left alone: shadows already keep the sun out, bar what
 * comes through doors and windows.
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
        vec3 indoorN = inverseTransformDirection(normal, viewMatrix);
        vec3 indoorBounce;
        vec4 indoor = indoorSky(vIndoorWorld, indoorN, indoorBounce);
        // Indoors, a floor gets no more of the sky's light than the walls round it.
        vec3 sky = indoor.rgb * mix(1.0, ${FLOOR_SHARE.toFixed(2)}, indoor.a * clamp(indoorN.y, 0.0, 1.0));
        reflectedLight.indirectDiffuse *= sky;
        reflectedLight.indirectSpecular *= sky;
        reflectedLight.indirectDiffuse += indoorBounce * BRDF_Lambert(material.diffuseColor);
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
  /** The trees near enough to hide some of its sky. */
  trees: Tree[];
  /** How much of the sky each ray's way shows outside the building, 0 to 1, once worked out. */
  outside: Float32Array | null;
  /** How much of the sun shows outside it, 0 to 1: none below the horizon. */
  sun: number;
}

/**
 * One building's grid being worked out: the sky outside a few directions at a
 * time, then a layer of cells at a time the sky each sees, then a layer at a
 * time the light bounced to each.
 */
interface Job {
  slot: number;
  /** The next direction outside to work out, then the next layer of cells up, then up again for bounced light. */
  ray: number;
  layer: number;
  bounced: number;
  /** The sky outside as it's being worked out again, to set on the grid once done. */
  outside: Float32Array;
  /** Only the sky outside may have changed: if it hasn't, the cells are left as they are. */
  only: boolean;
  /** What each block is, over the building and a margin round it: 0 open, or one more than its colour in `colours`. */
  solid: Uint8Array;
  vx: number;
  vy: number;
  vz: number;
  /** Linear red, green and blue of each colour a block can be. */
  colours: number[];
  /** The share of sky each cell sees, -1 in a solid block, NaN outdoors. */
  seen: Float32Array;
  /** How lit each cell's surfaces are by the sky, to bounce: 1 outdoors. */
  lit: Float32Array;
  /** The light bounced to each open cell, red, green and blue. */
  bounce: Float32Array;
  /** The sun's light bounced to each open cell, as a share of the sun's, red, green and blue. */
  sunBounce: Float32Array;
  /** How much of the sun each open block gets once asked, in hundredths, or -1 not yet asked. */
  sunlit: Int8Array;
  /**
   * The patches of sun on the faces of the blocks, gathered cell by cell,
   * PATCH numbers each: where they are, the way they face, and the sun's
   * light they give back, red, green and blue, times their area.
   */
  patches: number[];
  /** How much of the sun showed outside before it was worked out again. */
  sunWas: number;
}

export class IndoorLight {
  private readonly world: World;
  private readonly grids: Grid[] = [];
  private readonly texture: THREE.Data3DTexture;
  /** Four bytes a cell: the sky's light in red, green and blue, and 255 indoors or 0 outside. */
  private readonly data: Uint8Array;
  /** And the sun's light bounced there, as a share of SUN_RANGE of the sun's, red, green and blue. */
  private readonly sunTexture: THREE.Data3DTexture;
  private readonly sunData: Uint8Array;
  /** Toward the sun, as worked out, and as last set, to work out next. */
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly sunNext = new THREE.Vector3(0, 1, 0);
  /** Buildings changed since they were worked out, to do first, oldest change first. */
  private readonly urgent: number[] = [];
  /** Buildings not worked out yet, or whose sky outside may have changed, done nearest first. */
  private readonly queue: number[] = [];
  /** Buildings whose sky outside may have changed since it was worked out. */
  private readonly stale = new Set<number>();
  /** Of those, the ones worked out but for that, whose cells needn't be worked out again if it hasn't. */
  private readonly recheck = new Set<number>();
  /** How each building's cover stood when it was last worked out. */
  private readonly signs: string[] = [];
  private job: Job | null = null;
  /** Where the camera was, to work out the nearest buildings first. */
  private readonly near = new THREE.Vector3();
  /** Unit directions over the sky, spread evenly. */
  private readonly rays: [number, number, number][];
  /** Unit directions all round, spread evenly. */
  private readonly round: [number, number, number][];
  /** The colour of each box, sRGB. */
  private readonly albedo: (box: Box) => number;

  /** Buildings' slots are marked on `island`, for materials to find; `albedo` is a box's colour, sRGB. */
  constructor(world: World, island: IslandMap, albedo: (box: Box) => number = () => CONCRETE) {
    this.world = world;
    this.albedo = albedo;
    this.rays = skyRays(RAYS);
    this.round = roundRays(BOUNCE_RAYS);
    const [w, h, d] = SLOT;
    this.data = new Uint8Array(w * h * d * MAX_BUILDINGS * 4).fill(255);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 0;
    this.texture = new THREE.Data3DTexture(this.data, w, h, d * MAX_BUILDINGS);
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.unpackAlignment = 1;
    indoorUniforms.indoorGrid.value = this.texture;
    this.sunData = new Uint8Array(this.data.length);
    this.sunTexture = new THREE.Data3DTexture(this.sunData, w, h, d * MAX_BUILDINGS);
    this.sunTexture.format = THREE.RGBAFormat;
    this.sunTexture.type = THREE.UnsignedByteType;
    this.sunTexture.minFilter = this.sunTexture.magFilter = THREE.LinearFilter;
    this.sunTexture.unpackAlignment = 1;
    this.sunTexture.needsUpdate = true;
    indoorUniforms.indoorSunGrid.value = this.sunTexture;

    const { indoorCorner, indoorScale, indoorCount } = indoorUniforms;
    world.buildings.slice(0, MAX_BUILDINGS).forEach((b, slot) => {
      const g = gridFor(world, b);
      this.grids.push(g);
      this.flat(slot);
      this.signs.push(this.sign(g));
      this.queue.push(slot);
      indoorCorner.value[slot].set(g.x0, g.y0, g.z0, slot);
      indoorScale.value[slot].set(1 / g.sx, 1 / g.sy, 1 / g.sz, 0);
      indoorCount.value[slot].set(g.nx, g.ny, g.nz);
    });
    island.slots(this.grids.length, (slot) => {
      const g = this.grids[slot];
      return [g.x0, g.z0, g.x0 + g.nx * g.sx, g.z0 + g.nz * g.sz];
    });
    this.texture.needsUpdate = true;
  }

  /**
   * The sky's light at a point in red, green and blue, as materials see it
   * looking at that very point: blended between the cells round it.
   */
  at(x: number, y: number, z: number, out: THREE.Color): THREE.Color {
    return this.sample(this.data, 1, x, y, z, out);
  }

  /** The sun's light bounced to a point, as a share of the sun's, red, green and blue. */
  sunAt(x: number, y: number, z: number, out: THREE.Color): THREE.Color {
    return this.sample(this.sunData, SUN_RANGE, x, y, z, out);
  }

  /** Blend a texture's cells round a point, as the shaders do; white times `range` outdoors, or nothing for the sun's. */
  private sample(data: Uint8Array, range: number, x: number, y: number, z: number, out: THREE.Color): THREE.Color {
    const none = data === this.sunData ? 0 : range;
    out.setRGB(none, none, none, THREE.LinearSRGBColorSpace);
    const [w, h, d] = SLOT;
    // The building whose walls it's within, as the shaders choose between two side by side; else any whose grid reaches it.
    const within = (g: Grid) => {
      const cx = (x - g.x0) / g.sx;
      const cz = (z - g.z0) / g.sz;
      return cx >= 1 && cz >= 1 && cx <= g.nx - 1 && cz <= g.nz - 1;
    };
    const first = this.grids.findIndex(within);
    for (let n = 0; n < this.grids.length; n++) {
      const slot = first >= 0 ? (first + n) % this.grids.length : n;
      const g = this.grids[slot];
      let cx = (x - g.x0) / g.sx;
      let cy = (y - g.y0) / g.sy;
      let cz = (z - g.z0) / g.sz;
      if (cx < 0 || cy < 0 || cz < 0 || cx > g.nx || cy > g.ny || cz > g.nz) continue;
      cx = Math.min(Math.max(cx, 0.5), g.nx - 0.5) - 0.5;
      cy = Math.min(Math.max(cy, 0.5), g.ny - 0.5) - 0.5;
      cz = Math.min(Math.max(cz, 0.5), g.nz - 0.5) - 0.5;
      const ix = Math.min(Math.floor(cx), g.nx - 2);
      const iy = Math.min(Math.floor(cy), g.ny - 2);
      const iz = Math.min(Math.floor(cz), g.nz - 2);
      const fx = cx - ix;
      const fy = cy - iy;
      const fz = cz - iz;
      let r = 0;
      let gr = 0;
      let b = 0;
      for (let k = 0; k < 8; k++) {
        const ox = k & 1;
        const oy = (k >> 1) & 1;
        const oz = k >> 2;
        const weight = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
        const i = (((slot * d + iz + oz) * h + iy + oy) * w + ix + ox) * 4;
        r += data[i] * weight;
        gr += data[i + 1] * weight;
        b += data[i + 2] * weight;
      }
      const k = range / 255;
      return out.setRGB(r * k, gr * k, b * k, THREE.LinearSRGBColorSpace);
    }
    return out;
  }

  /**
   * The sun's light, colour times intensity, and the way to
   * it: every building is worked out again if it's moved.
   */
  setSun(dir: THREE.Vector3, light: THREE.Color): void {
    indoorUniforms.indoorSun.value.copy(light);
    this.sunNext.copy(dir).normalize();
  }

  /** The sun set last has moved since the buildings were worked out: work them all out again. */
  private sunMoved(): void {
    if (this.sunNext.dot(this.sunDir) > 0.99996) return;
    this.sunDir.copy(this.sunNext);
    if (this.job) this.queue.push(this.job.slot);
    this.job = null;
    this.grids.forEach((_, slot) => {
      this.recheck.delete(slot);
      if (!this.urgent.includes(slot) && !this.queue.includes(slot)) this.queue.push(slot);
    });
  }

  /** Where the camera is: the buildings round it are worked out first. */
  focus(p: THREE.Vector3): void {
    this.near.copy(p);
  }

  /**
   * Panels or doors may have changed: work out again each building whose
   * cover isn't as it was, and the sky outside every other within reach of it.
   */
  changed(): void {
    this.grids.forEach((g, slot) => {
      if (this.signs[slot] === this.sign(g)) return;
      this.redo(slot);
      const b = g.building;
      this.grids.forEach((other, o) => {
        const ob = other.building;
        const reach = OUTSIDE_REACH + Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + Math.hypot(ob.maxX - ob.minX, ob.maxZ - ob.minZ) / 2;
        if (o !== slot && Math.hypot((b.minX + b.maxX - ob.minX - ob.maxX) / 2, (b.minZ + b.maxZ - ob.minZ - ob.maxZ) / 2) < reach) this.restale(o);
      });
    });
  }

  /** The sky outside a building may have changed: work it out again, and its cells if it has. */
  private restale(slot: number): void {
    this.stale.add(slot);
    // A job already past its sky outside is started over.
    if (this.job?.slot === slot && this.job.ray >= RAYS) {
      this.job = null;
      if (!this.urgent.includes(slot)) this.queue.push(slot);
      return;
    }
    if (this.job?.slot === slot || this.urgent.includes(slot) || this.queue.includes(slot)) return;
    this.recheck.add(slot);
    this.queue.push(slot);
  }

  /** How a building's cover stands, to tell when it changes. */
  private sign(g: Grid): string {
    const doors = this.world.doors;
    return g.boxes.map((b) => (b.gone ? '-' : b.door !== undefined && doors[b.door].open ? 'o' : '+')).join('');
  }

  /** Once a frame: carry on working out grids for a couple of milliseconds. */
  update(): void {
    this.sunMoved();
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
    this.sunMoved();
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
    this.recheck.delete(slot);
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
    this.fill(slot, (x, y, z, _i, rgb) => {
      if (!inside(g, x, y, z)) return false;
      rgb[0] = rgb[1] = rgb[2] = FLAT;
      return true;
    });
  }

  /**
   * Set every cell of a slot from `value(x, y, z, i, rgb, sun)` at its
   * centre, which sets `rgb` to the sky's light and `sun` to the sun's
   * bounced, and returns true for a cell indoors, false outdoors.
   */
  private fill(slot: number, value: (x: number, y: number, z: number, i: number, rgb: number[], sun: number[]) => boolean): void {
    const g = this.grids[slot];
    const [w, h, d] = SLOT;
    const rgb = [1, 1, 1];
    const sun = [0, 0, 0];
    for (let iz = 0; iz < g.nz; iz++) {
      for (let iy = 0; iy < g.ny; iy++) {
        for (let ix = 0; ix < g.nx; ix++) {
          rgb[0] = rgb[1] = rgb[2] = 1;
          sun[0] = sun[1] = sun[2] = 0;
          const indoors = value(g.x0 + (ix + 0.5) * g.sx, g.y0 + (iy + 0.5) * g.sy, g.z0 + (iz + 0.5) * g.sz, (iz * g.ny + iy) * g.nx + ix, rgb, sun);
          const k = (((slot * d + iz) * h + iy) * w + ix) * 4;
          for (let c = 0; c < 3; c++) {
            this.data[k + c] = Math.round(Math.min(Math.max(rgb[c], 0), 1) * 255);
            this.sunData[k + c] = indoors ? Math.round(Math.min(Math.max(sun[c] / SUN_RANGE, 0), 1) * 255) : 0;
          }
          this.data[k + 3] = indoors ? 255 : 0;
        }
      }
    }
  }

  /** Start on a building: mark which blocks round it are solid, and in what colour. */
  private start(slot: number): Job {
    const g = this.grids[slot];
    this.signs[slot] = this.sign(g);
    const b = g.building;
    const only = this.recheck.delete(slot);
    const fresh = this.stale.delete(slot) || !g.outside;
    const colours: number[] = [];
    const known = new Map<number, number>();
    const colour = (hex: number): number => {
      let k = known.get(hex);
      if (k === undefined) {
        const c = new THREE.Color().setHex(hex);
        k = colours.length / 3;
        colours.push(c.r, c.g, c.b);
        known.set(hex, k);
      }
      return k + 1;
    };
    // The blocks reach a little past the cells, so rays leave through open air.
    const vx = Math.ceil((g.nx * g.sx) / VOXEL);
    const vy = Math.ceil((g.ny * g.sy) / VOXEL);
    const vz = Math.ceil((g.nz * g.sz) / VOXEL);
    const solid = new Uint8Array(vx * vy * vz);
    for (const box of g.boxes) {
      if (box.gone || box.clear) continue;
      const k = colour(this.albedo(box));
      const x0 = Math.max(Math.floor((box.minX - g.x0) / VOXEL), 0);
      const x1 = Math.min(Math.ceil((box.maxX - g.x0) / VOXEL), vx);
      const y0 = Math.max(Math.floor((box.minY - g.y0) / VOXEL), 0);
      const y1 = Math.min(Math.ceil((box.maxY - g.y0) / VOXEL), vy);
      const z0 = Math.max(Math.floor((box.minZ - g.z0) / VOXEL), 0);
      const z1 = Math.min(Math.ceil((box.maxZ - g.z0) / VOXEL), vz);
      for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) solid[(z * vy + y) * vx + x] = k;
    }
    // The ground under the building.
    const ground = colour(GROUND);
    for (let z = 0; z < vz; z++) {
      for (let x = 0; x < vx; x++) {
        const h = this.world.terrainHeight(g.x0 + (x + 0.5) * VOXEL, g.z0 + (z + 0.5) * VOXEL);
        const top = Math.min(Math.ceil((Math.min(h, b.floor) - g.y0) / VOXEL), vy);
        for (let y = 0; y < top; y++) solid[(z * vy + y) * vx + x] ||= ground;
      }
    }
    const n = g.nx * g.ny * g.nz;
    const sunWas = g.sun;
    const sun = this.sunDir;
    g.sun = sun.y > SUN_LOW ? this.outsideSky(g, [sun.x, sun.y, sun.z]) : 0;
    return {
      slot, ray: fresh ? 0 : RAYS, layer: 0, bounced: 0, outside: new Float32Array(RAYS), only: only && fresh,
      solid, vx, vy, vz, colours, seen: new Float32Array(n), lit: new Float32Array(n), bounce: new Float32Array(n * 3),
      sunBounce: new Float32Array(n * 3), sunlit: new Int8Array(vx * vy * vz).fill(-1), sunWas, patches: [],
    };
  }

  /** Work out a few directions outside, or one layer of cells. Returns whether the building is done. */
  private step(job: Job): boolean {
    const g = this.grids[job.slot];
    if (job.ray < RAYS) {
      const end = Math.min(job.ray + OUTSIDE_STEP, RAYS);
      for (; job.ray < end; job.ray++) job.outside[job.ray] = this.outsideSky(g, this.rays[job.ray]);
      if (job.ray < RAYS) return false;
      const was = g.outside;
      g.outside = job.outside;
      // Nothing to do if the sky outside is as it was.
      return job.only && !!was && was.every((v, k) => Math.abs(v - job.outside[k]) < OUTSIDE_CHANGE) && Math.abs(g.sun - job.sunWas) < OUTSIDE_CHANGE;
    }
    if (job.layer < g.ny) {
      this.seeLayer(job, g, job.layer++);
      if (job.layer === g.ny) {
        this.light(job, g);
        this.findPatches(job, g);
      }
      return false;
    }
    this.bounceLayer(job, g, job.bounced++);
    return job.bounced >= g.ny;
  }

  /** The share of sky each cell of a layer sees. */
  private seeLayer(job: Job, g: Grid, iy: number): void {
    const outside = g.outside!;
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
        if (job.solid[voxelAt(job, x - g.x0, y - g.y0, z - g.z0)]) {
          job.seen[i] = -1;
          continue;
        }
        let open = 0;
        this.rays.forEach(([dx, dy, dz], k) => {
          if (march(job, x - g.x0, y - g.y0, z - g.z0, dx, dy, dz) < 0) open += outside[k];
        });
        job.seen[i] = open / this.rays.length;
      }
    }
  }

  /** Every cell's sky seen: how lit the surfaces in each are by the sky, those in walls as the room beside them. */
  private light(job: Job, g: Grid): void {
    const { seen, lit } = job;
    for (let i = 0; i < seen.length; i++) {
      const s = seen[i];
      lit[i] = Number.isNaN(s) ? 1 : s >= 0 ? Math.min(AMBIENT + GAIN * s, 1) : -1;
    }
    for (let i = 0; i < seen.length; i++) {
      if (lit[i] >= 0) continue;
      let sum = 0;
      let n = 0;
      around(g, i, (j) => {
        if (seen[j] >= 0) (sum += lit[j]), n++;
      });
      lit[i] = n ? sum / n : AMBIENT;
    }
  }

  /**
   * The light bounced to each open cell of a layer, off whatever its rays
   * meet: the sky's, as lit as the cell before it, and the sun's where that
   * face is in the sun, as much as it faces it.
   */
  private bounceLayer(job: Job, g: Grid, iy: number): void {
    const { seen, lit, bounce, sunBounce, colours, solid } = job;
    const [gr, gg, gb] = colours;
    const sun = this.sunDir;
    const y = g.y0 + (iy + 0.5) * g.sy;
    for (let iz = 0; iz < g.nz; iz++) {
      const z = g.z0 + (iz + 0.5) * g.sz;
      for (let ix = 0; ix < g.nx; ix++) {
        const i = (iz * g.ny + iy) * g.nx + ix;
        if (!(seen[i] >= 0)) continue;
        const x = g.x0 + (ix + 0.5) * g.sx;
        let r = 0;
        let gn = 0;
        let b = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (const [dx, dy, dz] of this.round) {
          const hit = march(job, x - g.x0, y - g.y0, z - g.z0, dx, dy, dz);
          if (hit < 0) {
            // Out to the sky, counted already, or down to the ground outside, in the open and the sun.
            if (dy < 0) {
              r += gr;
              gn += gg;
              b += gb;
              const shone = g.sun * Math.max(sun.y, 0);
              sr += gr * shone;
              sg += gg * shone;
              sb += gb * shone;
            }
            continue;
          }
          const c = (solid[hit] - 1) * 3;
          const l = lit[cellOf(job, g, before)];
          r += colours[c] * l;
          gn += colours[c + 1] * l;
          b += colours[c + 2] * l;
        }
        const k = BOUNCE_GAIN / this.round.length;
        bounce[i * 3] = AMBIENT + r * k;
        bounce[i * 3 + 1] = AMBIENT + gn * k;
        bounce[i * 3 + 2] = AMBIENT + b * k;
        // The ground outside, by the rays; the patches of sun inside, each by a ray to it.
        const ks = SUN_GAIN / this.round.length;
        sr *= ks;
        sg *= ks;
        sb *= ks;
        const { patches } = job;
        for (let p = 0; p < patches.length; p += PATCH) {
          const ox = patches[p] - x;
          const oy = patches[p + 1] - y;
          const oz = patches[p + 2] - z;
          const d = Math.hypot(ox, oy, oz);
          // Facing the cell, and not right in it.
          const facing = -(ox * patches[p + 3] + oy * patches[p + 4] + oz * patches[p + 5]) / d;
          if (facing <= 0 || d < 1e-3) continue;
          if (march(job, x - g.x0, y - g.y0, z - g.z0, ox / d, oy / d, oz / d, d - VOXEL) >= 0) continue;
          const k = (SUN_GAIN * PATCH_FACING * facing) / (Math.PI * Math.max(d * d, NEAREST_PATCH * NEAREST_PATCH));
          sr += patches[p + 6] * k;
          sg += patches[p + 7] * k;
          sb += patches[p + 8] * k;
        }
        sunBounce[i * 3] = sr;
        sunBounce[i * 3 + 1] = sg;
        sunBounce[i * 3 + 2] = sb;
      }
    }
  }

  /**
   * Every face of a solid block the sun shines on, beside an open block,
   * gathered into one patch for each cell they're in, as bright as they
   * are together and placed and facing as their average.
   */
  private findPatches(job: Job, g: Grid): void {
    if (this.sunDir.y <= SUN_LOW) return;
    const { solid, vx, vy, vz, colours } = job;
    const sun = this.sunDir;
    const layer = vx * vy;
    const cells = new Map<number, number[]>();
    const area = VOXEL * VOXEL;
    for (let z = 0; z < vz; z++) {
      for (let y = 0; y < vy; y++) {
        for (let x = 0; x < vx; x++) {
          const v = (z * vy + y) * vx + x;
          if (solid[v]) continue;
          // Each neighbour that's solid, and the way its face toward this block looks.
          for (let f = 0; f < 6; f++) {
            const axis = f >> 1;
            const sign = f & 1 ? 1 : -1;
            const at = axis === 0 ? x - sign : axis === 1 ? y - sign : z - sign;
            if (at < 0 || at >= (axis === 0 ? vx : axis === 1 ? vy : vz)) continue;
            const u = v - sign * (axis === 0 ? 1 : axis === 1 ? vx : layer);
            if (!solid[u]) continue;
            const facing = sign * (axis === 0 ? sun.x : axis === 1 ? sun.y : sun.z);
            if (facing <= 0) continue;
            const cell = cellOf(job, g, v);
            // Outdoors, the sun on the walls and the ground is counted by the rays out of doorways.
            if (Number.isNaN(job.seen[cell])) continue;
            const shone = facing * area * this.sunOn(job, g, v);
            if (shone <= 0) continue;
            const c = (solid[u] - 1) * 3;
            let p = cells.get(cell);
            if (!p) cells.set(cell, (p = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
            // The face's middle, from the grid's corner as the cells are not: set below.
            p[0] += ((axis === 0 ? x + 0.5 - sign * 0.5 : x + 0.5) * VOXEL) * shone;
            p[1] += ((axis === 1 ? y + 0.5 - sign * 0.5 : y + 0.5) * VOXEL) * shone;
            p[2] += ((axis === 2 ? z + 0.5 - sign * 0.5 : z + 0.5) * VOXEL) * shone;
            p[3 + axis] += sign * shone;
            p[6] += colours[c] * shone;
            p[7] += colours[c + 1] * shone;
            p[8] += colours[c + 2] * shone;
            p[9] += shone;
          }
        }
      }
    }
    for (const p of cells.values()) {
      const w = p[9];
      const n = Math.hypot(p[3], p[4], p[5]) || 1;
      // A little off the face, so a ray to it from a cell needn't graze it.
      const nx = p[3] / n;
      const ny = p[4] / n;
      const nz = p[5] / n;
      job.patches.push(
        g.x0 + p[0] / w + nx * 0.05, g.y0 + p[1] / w + ny * 0.05, g.z0 + p[2] / w + nz * 0.05, nx, ny, nz, p[6], p[7], p[8],
      );
    }
  }

  /**
   * How much of the sun an open block gets: whether a ray from it to the sun
   * leaves the building, and then whether a hill or a building outside is in
   * the way and how much the trees' crowns hide.
   */
  private sunOn(job: Job, g: Grid, v: number): number {
    if (job.sunlit[v] < 0) {
      const x = (v % job.vx + 0.5) * VOXEL;
      const y = ((Math.floor(v / job.vx) % job.vy) + 0.5) * VOXEL;
      const z = (Math.floor(v / (job.vx * job.vy)) + 0.5) * VOXEL;
      const { x: dx, y: dy, z: dz } = this.sunDir;
      const keep = before;
      let shows = 0;
      if (march(job, x, y, z, dx, dy, dz) < 0) {
        const t = exitBox(x, y, z, dx, dy, dz, 0, 0, 0, job.vx * VOXEL, job.vy * VOXEL, job.vz * VOXEL) + 0.05;
        const ox = g.x0 + x + dx * t;
        const oy = g.y0 + y + dy * t;
        const oz = g.z0 + z + dz * t;
        if (this.world.raycast(ox, oy, oz, dx, dy, dz, OUTSIDE_REACH) >= OUTSIDE_REACH) {
          shows = 1;
          for (const tree of g.trees) shows *= 1 - CROWN_SHADE * crossesCrown(tree, ox, oy, oz, dx, dy, dz);
        }
      }
      before = keep;
      job.sunlit[v] = Math.round(shows * 100);
    }
    return job.sunlit[v] / 100;
  }

  /**
   * How much of the sky shows along direction d from the building, outside
   * it: from a few spots inside, out past its walls, whether a hill or
   * another building is in the way, and how much the trees' crowns hide.
   */
  private outsideSky(g: Grid, [dx, dy, dz]: [number, number, number]): number {
    const b = g.building;
    const w = this.world;
    const inset = 0.6;
    const spots: [number, number, number][] = [
      [(b.minX + b.maxX) / 2, b.floor + 1.5, (b.minZ + b.maxZ) / 2],
      [b.minX + inset, b.floor + 1.2, b.minZ + inset],
      [b.maxX - inset, b.floor + 1.2, b.minZ + inset],
      [b.minX + inset, b.floor + 1.2, b.maxZ - inset],
      [b.maxX - inset, b.floor + 1.2, b.maxZ - inset],
    ];
    let sum = 0;
    for (const [x, y, z] of spots) {
      // Out through the building's bounds, a little past them.
      const t = exitBox(x, y, z, dx, dy, dz, b.minX - 0.4, b.floor - 1, b.minZ - 0.4, b.maxX + 0.4, g.top + 0.6, b.maxZ + 0.4) + 0.1;
      const ox = x + dx * t;
      const oy = y + dy * t;
      const oz = z + dz * t;
      if (w.raycast(ox, oy, oz, dx, dy, dz, OUTSIDE_REACH) < OUTSIDE_REACH) continue;
      let shows = 1;
      for (const tree of g.trees) shows *= 1 - CROWN_SHADE * crossesCrown(tree, ox, oy, oz, dx, dy, dz);
      sum += shows;
    }
    return sum / spots.length;
  }

  /** A building is worked out: light its cells, and fill those in walls and under the floor from the room beside them. */
  private finish(job: Job): void {
    const g = this.grids[job.slot];
    // Its sky outside was as it was: so are its cells.
    if (job.bounced < g.ny) return;
    const { seen, bounce, sunBounce } = job;
    this.fill(job.slot, (_x, _y, _z, i, rgb, sun) => {
      const s = seen[i];
      if (Number.isNaN(s)) return false;
      if (s >= 0) {
        for (let c = 0; c < 3; c++) {
          rgb[c] = bounce[i * 3 + c] + GAIN * s;
          sun[c] = sunBounce[i * 3 + c];
        }
        return true;
      }
      // In a wall: as the open cells inside next to it, so its inside face reads the room.
      let n = 0;
      rgb[0] = rgb[1] = rgb[2] = 0;
      around(g, i, (j) => {
        if (!(seen[j] >= 0)) return;
        for (let c = 0; c < 3; c++) {
          rgb[c] += bounce[j * 3 + c] + GAIN * seen[j];
          sun[c] += sunBounce[j * 3 + c];
        }
        n++;
      });
      for (let c = 0; c < 3; c++) {
        rgb[c] = n ? rgb[c] / n : AMBIENT;
        sun[c] = n ? sun[c] / n : 0;
      }
      return true;
    });
    this.texture.needsUpdate = true;
    this.sunTexture.needsUpdate = true;
  }
}

/** Call `visit` with the index of each cell next to cell `i`, corners too, and `i` itself. */
function around(g: Grid, i: number, visit: (j: number) => void): void {
  const ix = i % g.nx;
  const iy = Math.floor(i / g.nx) % g.ny;
  const iz = Math.floor(i / (g.nx * g.ny));
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = ix + dx;
        const y = iy + dy;
        const z = iz + dz;
        if (x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz) visit((z * g.ny + y) * g.nx + x);
      }
    }
  }
}

/** How far along a ray from inside a box it leaves the box. */
function exitBox(
  x: number, y: number, z: number, dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
): number {
  const tx = dx > 0 ? (maxX - x) / dx : dx < 0 ? (minX - x) / dx : Infinity;
  const ty = dy > 0 ? (maxY - y) / dy : dy < 0 ? (minY - y) / dy : Infinity;
  const tz = dz > 0 ? (maxZ - z) / dz : dz < 0 ? (minZ - z) / dz : Infinity;
  return Math.max(Math.min(tx, ty, tz), 0);
}

/**
 * How much a ray passes through a tree's crown, 0 to 1: a cone round its
 * trunk from a little up it to its top, as its needles thin toward the top.
 */
function crossesCrown(tree: Tree, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const flat = dx * dx + dz * dz;
  if (flat < 1e-6) return 0;
  const t = ((tree.x - ox) * dx + (tree.z - oz) * dz) / flat;
  if (t <= 0) return 0;
  const off = Math.hypot(ox + dx * t - tree.x, oz + dz * t - tree.z);
  const up = (oy + dy * t - tree.y) / (TREE_HEIGHT * tree.s);
  if (up < 0.15 || up > 1) return 0;
  const r = CROWN_RADIUS * tree.s * (1 - up) / 0.85;
  return off < r ? 1 - off / r : 0;
}

/** A unit tree's height and its crown's radius at the bottom, metres. */
const TREE_HEIGHT = 7;
const CROWN_RADIUS = 2.4;

/** A building's cells: a whole number across its footprint each way, and one more all round; up it, enough to reach over its roof. */
function gridFor(world: World, b: Building): Grid {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const sx = w / Math.max(1, Math.round(w / CELL));
  const sz = d / Math.max(1, Math.round(d / CELL));
  const nx = Math.min(Math.round(w / sx) + 2, SLOT[0]);
  const nz = Math.min(Math.round(d / sz) + 2, SLOT[2]);
  const top = b.roof + HOUSE_ROOF;
  const y0 = b.floor - 0.5;
  // A building too tall for its slot's cells, as one of three storeys, takes taller ones.
  const sy = Math.max(CELL, (top + 0.6 - y0) / SLOT[1]);
  const ny = Math.min(Math.ceil((top + 0.6 - y0) / sy - 1e-6), SLOT[1]);
  const x0 = b.minX - sx;
  const z0 = b.minZ - sz;
  const boxes = world.colliders.filter((c): c is Box =>
    c.kind === 'box' && c.maxX > x0 - 1 && c.minX < x0 + nx * sx + 1 && c.maxZ > z0 - 1 && c.minZ < z0 + nz * sz + 1 && c.maxY > y0 && c.minY < top + 1);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const trees = world.trees.filter((t) => Math.hypot(t.x - cx, t.z - cz) < TREE_REACH);
  return { building: b, x0, y0, z0, sx, sy, sz, nx, ny, nz, top, boxes, trees, outside: null, sun: 0 };
}

/** Whether a point is indoors: within the walls, off the ground and under the roof. */
function inside(g: Grid, x: number, y: number, z: number): boolean {
  return y > g.building.floor - 0.3 && y < g.top && inBuilding(g.building, x, z);
}

/** The block a point is in, measured from the grid's corner. */
function voxelAt(job: Job, x: number, y: number, z: number): number {
  return (Math.floor(z / VOXEL) * job.vy + Math.floor(y / VOXEL)) * job.vx + Math.floor(x / VOXEL);
}

/** The cell a block is in. */
function cellOf(job: Job, g: Grid, v: number): number {
  const x = v % job.vx;
  const y = Math.floor(v / job.vx) % job.vy;
  const z = Math.floor(v / (job.vx * job.vy));
  const ix = Math.min(Math.floor(((x + 0.5) * VOXEL) / g.sx), g.nx - 1);
  const iy = Math.min(Math.floor(((y + 0.5) * VOXEL) / g.sy), g.ny - 1);
  const iz = Math.min(Math.floor(((z + 0.5) * VOXEL) / g.sz), g.nz - 1);
  return (iz * g.ny + iy) * g.nx + ix;
}

/** The last open block a ray passed through before the solid one `march` returned. */
let before = 0;

/**
 * Where a ray from (x, y, z), measured from the grid's corner, first meets a
 * solid block, by a 3D walk from block to block: that block, setting
 * `before` to the open one it came from, or -1 if it leaves the blocks or
 * goes `reach` metres first.
 */
function march(job: Job, x: number, y: number, z: number, dx: number, dy: number, dz: number, reach = Infinity): number {
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
    const was = (iz * vy + iy) * vx + ix;
    if (Math.min(tx, ty, tz) > reach) return -1;
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
    if (ix < 0 || iy < 0 || iz < 0 || ix >= vx || iy >= vy || iz >= vz) return -1;
    const v = (iz * vy + iy) * vx + ix;
    if (solid[v]) {
      before = was;
      return v;
    }
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

/** `n` directions spread evenly all round. */
function roundRays(n: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
}

/** A texture that lights everything fully, until the real one is made. */
function blank(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.needsUpdate = true;
  return t;
}
