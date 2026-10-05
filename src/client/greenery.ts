import * as THREE from 'three';
import { Layer } from '../shared/layers.ts';
import { ROCK_SQUASH } from '../shared/rock.ts';
import { fbm, mulberry32 } from '../shared/rng.ts';
import { beyondTown, groveAt, maquisAt, slopeAt, TERRACE_RISE } from '../shared/hillside.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { standsOn } from './features.ts';
import { species, type Kind } from './species.ts';
import { surfaceMaterial } from './surfaces.ts';
import { onTiles } from './terrain.ts';
import type { Planting, Species } from './trees.ts';

// What grows on a map, and the hillside round it (see shared/hillside.ts):
// the town's plane trees and olives, grown over the trunks they collide as;
// beyond the walls, olives in rows along terraces held up by dry-stone
// walls, the maquis's shrubs in patches, holm oaks and umbrella pines where
// the island would have had its spruces, cypresses in rows and alone, the
// map's own planted trees (MapPlant), and outcrops of pale rock. All drawn
// only: nothing beyond the walls is ever reached, and the town's trees stand
// on their trunks' boxes.

/** A tree as placed: its kind, its foot, its size as a share of its kind's usual, its turn, and its foliage's tint. */
export interface Plant {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  s: number;
  turn: number;
  tint: [number, number, number];
}

/** A stretch of dry-stone wall along a terrace, from (x0, z0) to (x1, z1), its foot and its top at its contour's level. */
export interface TerraceWall {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
}

/** A rock of an outcrop, as World's rocks are placed. */
export interface Outcrop {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  rot: number;
}

/** Metres round the town's middle the hillside is planted. */
const REACH = 300;
/** Metres between the olives along a terrace, and between the maquis's shrubs. */
const OLIVE_EVERY = 8;
const SHRUB_EVERY = 4.2;
/** Metres a sample of the terraces' contours covers. */
const CONTOUR_CELL = 2;
/** How far the terrace walls' tops stand over their contour, and their feet sink under it; how thick they are at the foot and at the top. */
const WALL_TOP = 0.8;
const WALL_FOOT = 1.2;
const WALL_THICK = 0.6;
const WALL_CAP = 0.4;
/** Each kind's usual height, metres: its unit shape is scaled to it. */
const HEIGHT: Record<Kind, number> = { olive: 5.5, plane: 15, cypress: 13, pine: 14, oak: 8.5, shrub: 2.2 };

/** The town's middle. */
function middle(world: World): [number, number] {
  const b = world.bounds;
  return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
}

/** A tint from HSL in sRGB, as linear RGB. */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/** Each kind's tint over its leaves, from a draw `r` and another `q`, both 0..1. */
const TINT: Record<Kind, (r: number, q: number) => [number, number, number]> = {
  olive: (r, q) => hsl(0.18 + r * 0.06, 0.1 + q * 0.15, 0.8 + r * 0.14),
  plane: (r, q) => hsl(0.2 + r * 0.06, 0.25 + q * 0.2, 0.78 + q * 0.14),
  cypress: (r, q) => hsl(0.24 + r * 0.06, 0.15 + q * 0.15, 0.78 + q * 0.16),
  pine: (r, q) => hsl(0.2 + r * 0.06, 0.2 + q * 0.15, 0.78 + q * 0.16),
  oak: (r, q) => hsl(0.19 + r * 0.07, 0.15 + q * 0.15, 0.74 + q * 0.18),
  shrub: (r, q) => hsl(0.15 + r * 0.1, 0.18 + q * 0.2, 0.74 + q * 0.2),
};

/**
 * Every tree and shrub a map plants, in a fixed order from its seed: the
 * town's, the map's own beyond the walls, the island's trees as oaks and
 * pines, the groves' olives, cypresses and the maquis.
 */
export function plantings(world: World): Plant[] {
  const map = world.map;
  if (!map) return [];
  const out: Plant[] = [];
  const rand = mulberry32(world.seed ^ 0x2545f491);
  const add = (kind: Kind, x: number, y: number, z: number, s: number) => {
    out.push({ kind, x, y, z, s, turn: rand() * Math.PI * 2, tint: TINT[kind](rand(), rand()) });
  };
  const ground = (x: number, z: number) => world.terrainHeight(x, z) - 0.15;

  // The town's: grown over the trunks they collide as.
  for (const b of map.walls) {
    if (b.look !== 'plane' && b.look !== 'olive') continue;
    const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
    add(b.look, x, standsOn(world, b) - 0.1, z, b.look === 'plane' ? 0.95 + rand() * 0.1 : 0.85 + rand() * 0.2);
  }
  // The map's own.
  for (const p of map.plants ?? []) add(p.kind, p.x, ground(p.x, p.z), p.z, p.s ?? 1);

  const [cx, cz] = middle(world);
  const near = (x: number, z: number) => Math.hypot(x - cx, z - cz) < REACH;
  // The island's trees, as holm oaks and umbrella pines, but in the groves and close to the town.
  for (const t of world.trees) {
    const pine = rand() < 0.35;
    const s = 0.8 + rand() * 0.35;
    if (beyondTown(world, t.x, t.z) < 7 || groveAt(world, t.x, t.z) > 0.3) continue;
    add(pine ? 'pine' : 'oak', t.x, t.y - 0.15, t.z, pine ? s * 0.95 : s);
  }

  // Olives in rows along the terraces, each halfway up its own.
  for (let x = cx - REACH; x < cx + REACH; x += OLIVE_EVERY) {
    for (let z = cz - REACH; z < cz + REACH; z += OLIVE_EVERY) {
      let px = x + (rand() - 0.5) * OLIVE_EVERY * 0.6;
      let pz = z + (rand() - 0.5) * OLIVE_EVERY * 0.6;
      const keep = rand();
      const s = 0.8 + rand() * 0.35;
      if (!near(px, pz) || keep > groveAt(world, px, pz) * 1.2) continue;
      // Up or down the slope to the middle of its terrace.
      const h = world.terrainHeight(px, pz);
      const target = (Math.floor(h / TERRACE_RISE) + 0.5) * TERRACE_RISE;
      const d = 1;
      const gx = (world.terrainHeight(px + d, pz) - world.terrainHeight(px - d, pz)) / (2 * d);
      const gz = (world.terrainHeight(px, pz + d) - world.terrainHeight(px, pz - d)) / (2 * d);
      const g2 = gx * gx + gz * gz;
      if (g2 > 0.01) {
        px += (gx * (target - h)) / g2;
        pz += (gz * (target - h)) / g2;
      }
      if (groveAt(world, px, pz) < 0.15) continue;
      add('olive', px, ground(px, pz), pz, s);
    }
  }

  // Cypresses in short rows along the slope, and standing alone.
  for (let row = 0; row < 7; row++) {
    let x = cx + (rand() - 0.5) * REACH * 1.6;
    let z = cz + (rand() - 0.5) * REACH * 1.6;
    const count = 6 + Math.floor(rand() * 8);
    const flip = rand() < 0.5 ? -1 : 1;
    const s = 0.85 + rand() * 0.2;
    for (let k = 0; k < count; k++) {
      const h = world.terrainHeight(x, z);
      if (near(x, z) && h > 2 && beyondTown(world, x, z) > 6 && slopeAt(world, x, z) < 0.9) add('cypress', x, ground(x, z), z, s * (0.92 + rand() * 0.16));
      // Along the contour: square to the slope.
      const gx = world.terrainHeight(x + 1, z) - world.terrainHeight(x - 1, z);
      const gz = world.terrainHeight(x, z + 1) - world.terrainHeight(x, z - 1);
      const g = Math.hypot(gx, gz) || 1;
      x += (-gz / g) * 4.5 * flip;
      z += (gx / g) * 4.5 * flip;
    }
  }
  for (let k = 0; k < 40; k++) {
    const x = cx + (rand() - 0.5) * REACH * 1.8;
    const z = cz + (rand() - 0.5) * REACH * 1.8;
    const s = 0.75 + rand() * 0.35;
    if (!near(x, z) || world.terrainHeight(x, z) < 2 || beyondTown(world, x, z) < 6 || groveAt(world, x, z) > 0.5) continue;
    add('cypress', x, ground(x, z), z, s);
  }

  // The maquis: shrubs thick in its patches, a few out on the open grass.
  for (let x = cx - REACH; x < cx + REACH; x += SHRUB_EVERY) {
    for (let z = cz - REACH; z < cz + REACH; z += SHRUB_EVERY) {
      const px = x + (rand() - 0.5) * SHRUB_EVERY * 0.9;
      const pz = z + (rand() - 0.5) * SHRUB_EVERY * 0.9;
      const keep = rand();
      const s = 0.55 + rand() ** 2 * 1.1;
      if (!near(px, pz)) continue;
      const m = maquisAt(world, px, pz);
      const open = beyondTown(world, px, pz) > 4 && world.terrainHeight(px, pz) > 1.5 && groveAt(world, px, pz) < 0.2 ? 0.035 : 0;
      if (keep > Math.max(m * 0.85, open)) continue;
      add('shrub', px, ground(px, pz) + 0.05, pz, s);
    }
  }
  return out;
}

/**
 * The dry-stone walls holding up the groves' terraces: the ground's
 * contours every TERRACE_RISE metres, traced cell by cell where it's grove,
 * a stretch of wall along each.
 */
export function terraces(world: World): TerraceWall[] {
  if (!world.map) return [];
  const out: TerraceWall[] = [];
  const [cx, cz] = middle(world);
  const n = Math.ceil((REACH * 2) / CONTOUR_CELL);
  const x0 = cx - REACH;
  const z0 = cz - REACH;
  const h = new Float32Array((n + 1) * (n + 1));
  const g = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * CONTOUR_CELL;
      const z = z0 + j * CONTOUR_CELL;
      h[j * (n + 1) + i] = world.terrainHeight(x, z);
      g[j * (n + 1) + i] = Math.hypot(x - cx, z - cz) < REACH ? groveAt(world, x, z) : 0;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * (n + 1) + i;
      const corners = [k, k + 1, k + n + 2, k + n + 1];
      if (Math.min(...corners.map((c) => g[c])) < 0.2) continue;
      const hs = corners.map((c) => h[c]);
      const at = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const lo = Math.ceil(Math.min(...hs) / TERRACE_RISE);
      const hi = Math.floor(Math.max(...hs) / TERRACE_RISE);
      for (let level = lo; level <= hi; level++) {
        const y = level * TERRACE_RISE;
        // Where the contour crosses each edge of the cell.
        const cuts: [number, number][] = [];
        for (let e = 0; e < 4; e++) {
          const [a, b] = [hs[e], hs[(e + 1) % 4]];
          if ((a < y) === (b < y) || a === b) continue;
          const t = (y - a) / (b - a);
          const [p, q] = [at[e], at[(e + 1) % 4]];
          cuts.push([x0 + (i + p[0] + (q[0] - p[0]) * t) * CONTOUR_CELL, z0 + (j + p[1] + (q[1] - p[1]) * t) * CONTOUR_CELL]);
        }
        for (let c = 0; c + 1 < cuts.length; c += 2) {
          const [[ax, az], [bx, bz]] = [cuts[c], cuts[c + 1]];
          if (Math.hypot(bx - ax, bz - az) < 0.05) continue;
          out.push({ x0: ax, z0: az, x1: bx, z1: bz, y0: y - WALL_FOOT, y1: y + WALL_TOP });
        }
      }
    }
  }
  return out;
}

/** Outcrops of pale rock breaking through the hillside's steeper slopes and tops, a few rocks to each. */
export function outcrops(world: World): Outcrop[] {
  if (!world.map) return [];
  const out: Outcrop[] = [];
  const [cx, cz] = middle(world);
  const rand = mulberry32(world.seed ^ 0x1b873593);
  for (let tries = 0; tries < 900 && out.length < 220; tries++) {
    const x = cx + (rand() - 0.5) * REACH * 2;
    const z = cz + (rand() - 0.5) * REACH * 2;
    const count = 2 + Math.floor(rand() * 4);
    const turn = rand() * Math.PI * 2;
    const y = world.terrainHeight(x, z);
    if (Math.hypot(x - cx, z - cz) > REACH || y < 2 || beyondTown(world, x, z) < 8 || groveAt(world, x, z) > 0.1) continue;
    const rough = Math.max(slopeAt(world, x, z) - 0.45, (y - 35) / 20) + fbm(x / 30, z / 30, world.seed + 221, 2) - 0.5;
    if (rough < 0.15) continue;
    for (let k = 0; k < count; k++) {
      const r = 0.8 + rand() ** 1.5 * 2.2;
      const a = turn + k * 2.1 + rand();
      const d = k ? 1 + rand() * 2.5 : 0;
      const rx = x + Math.cos(a) * d;
      const rz = z + Math.sin(a) * d;
      const h = r * (0.6 + rand() * 0.6);
      // Sunk well in, so it breaks through rather than sits on top.
      out.push({ x: rx, y: world.terrainHeight(rx, rz) - r * 0.25, z: rz, r, h, rot: rand() * Math.PI * 2 });
    }
  }
  return out;
}

/** The stands of trees a map's world draws (see trees.ts), each kind its own. */
export function greenery(world: World): { species: Species; plants: Planting[]; tile: number }[] {
  const plants = plantings(world);
  const kinds = [...new Set(plants.map((p) => p.kind))];
  return kinds.map((kind) => {
    const sp = species(kind, world.seed * 13 + kind.length);
    const unit = HEIGHT[kind] / sp.height;
    return {
      species: sp,
      tile: 100,
      plants: plants.filter((p) => p.kind === kind).map((p) => ({ x: p.x, y: p.y, z: p.z, s: p.s * unit, turn: p.turn, color: new THREE.Color(...p.tint) })),
    };
  });
}

const WALL_FLAT = 0x9a9284;
const WALL_TINT = 0xb4aea4;

/** A number from 0 to 1 for a point, the same wherever it's asked for. */
function hash(x: number, z: number): number {
  const k = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(z * 100) * 78.233) * 43758.5453;
  return k - Math.floor(k);
}

/**
 * Every terrace wall as one shape: battered faces, narrower at the top, and
 * a ragged top, its height at each end taken from where the end is, so the
 * stretches either side of it meet.
 */
function wallGeometry(walls: readonly TerraceWall[]): THREE.BufferGeometry {
  const pos = new Float32Array(walls.length * 6 * 2 * 3 * 3);
  let o = 0;
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    for (const p of [a, b, c, a, c, d]) pos.set(p, (o += 3) - 3);
  };
  for (const w of walls) {
    const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
    // Across it, and a little past each end, so the stretches overlap.
    const [ux, uz] = [(w.x1 - w.x0) / len, (w.z1 - w.z0) / len];
    const [nx, nz] = [-uz, ux];
    const ends = [[w.x0 - ux * 0.08, w.z0 - uz * 0.08, w.x0, w.z0], [w.x1 + ux * 0.08, w.z1 + uz * 0.08, w.x1, w.z1]];
    const corner = (e: number, side: number, top: boolean): number[] => {
      const [x, z, hx, hz] = ends[e];
      const half = (top ? WALL_CAP : WALL_THICK) / 2;
      const y = top ? w.y1 + (hash(hx, hz) - 0.5) * 0.3 + (hash(hx + side, hz) - 0.5) * 0.08 : w.y0;
      return [x + nx * half * side, y, z + nz * half * side];
    };
    const [a0, a1, b0, b1] = [corner(0, -1, false), corner(1, -1, false), corner(0, 1, false), corner(1, 1, false)];
    const [c0, c1, d0, d1] = [corner(0, -1, true), corner(1, -1, true), corner(0, 1, true), corner(1, 1, true)];
    quad(a0, a1, c1, c0);
    quad(b1, b0, d0, d1);
    quad(c0, c1, d1, d0);
    quad(b0, a0, c0, d0);
    quad(a1, b1, d1, c1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
  g.computeVertexNormals();
  return g;
}

/** The hillside's terrace walls and outcrops, drawn. */
export class Hillside {
  readonly group = new THREE.Group();
  private readonly walls: THREE.Mesh;
  private readonly rocks: THREE.InstancedMesh;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.walls = new THREE.Mesh(wallGeometry(terraces(world)), new THREE.MeshStandardMaterial({ color: WALL_FLAT, roughness: 0.95 }));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();

    const rocks = outcrops(world);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(world.rockShape, 3));
    geo.computeVertexNormals();
    this.rocks = new THREE.InstancedMesh(geo, onTiles(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), world), Math.max(rocks.length, 1));
    this.rocks.count = rocks.length;
    const c = new THREE.Color();
    const rand = mulberry32(world.seed + 31);
    rocks.forEach((r, i) => {
      this.rocks.setMatrixAt(i, m.compose(v.set(r.x, r.y, r.z), q.setFromAxisAngle(up, r.rot), s.set(r.r, r.h * ROCK_SQUASH, r.r)));
      const k = 0.62 + rand() * 0.12;
      this.rocks.setColorAt(i, c.setRGB(k, k * 0.97, k * 0.9, THREE.SRGBColorSpace));
    });
    for (const mesh of [this.walls, this.rocks]) {
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Swap the flat colours for textures: rock for the walls and the outcrops, pale. */
  applyAssets(assets: Assets): void {
    this.walls.material = surfaceMaterial(assets, { kind: 'fixed', layer: Layer.rock }, { roughness: 0.95, color: WALL_TINT }, 1.5, { wet: true });
    this.rocks.material = onTiles(surfaceMaterial(assets, { kind: 'fixed', layer: Layer.rock }, { roughness: 0.9 }, 1, { wet: true }), this.world);
    const c = new THREE.Color();
    for (let i = 0; i < this.rocks.count; i++) this.rocks.setColorAt(i, this.rocks.getColorAt(i, c).multiplyScalar(1.45));
    this.rocks.instanceColor!.needsUpdate = true;
  }
}
