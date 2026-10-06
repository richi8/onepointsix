import * as THREE from 'three';
import { KIT_WALL, placeBlocks, SLAB, type KitOpening, type KitWall, type Placed } from '../shared/kit.ts';
import type { MapTrim } from '../shared/maps/index.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { surfaceMaterial, UNTEXTURED } from './surfaces.ts';
import { ALL_EDGES, roundable, roundCode } from './rounding.ts';
import { onTiles } from './terrain.ts';
import { features } from './features.ts';
import { doorProps, dressBlocks } from './blocks.ts';
import { roofs } from './roofs.ts';
import { balconies, railProps } from './balconies.ts';
import { Life } from './life.ts';
import { signs } from './signs.ts';
import { BLOOMS, Boxes, CANVAS, CREAM, fineAfter, IRON, isFine, LEAVES, painted, plain, Shapes, STEM, STONE, TERRACOTTA, tileKey, type Stuff } from './townparts.ts';
import { bougainvillea, pots, vine } from './plants.ts';

// A map town's buildings dressed over their walls, drawn only: nothing here
// collides, stops a round or casts a sound, so the town plays just as its
// boxes do. On every face of a wall that looks outdoors: a stone plinth
// along its foot, a cornice under its roof, string courses between its
// storeys and stone at its corners where its building has them (MapTrim),
// stone round its windows and doors, painted shutters folded back beside
// its windows, window boxes of flowers, creepers climbing beside its doors
// and striped awnings over them, pots by them, bougainvillea over them and
// vines along its walls (see plants.ts); and a stone cap along every parapet and
// freestanding wall. A map's solid blocks are dressed too (see blocks.ts).
// All of it is boxes, each a few centimetres proud of the wall, drawn as
// instanced meshes, one a tile.

const T = KIT_WALL;
/** How far apart along a face it's sampled for where it looks outdoors. */
const STEP = 0.25;
/** How far out from a face (or in from it) a point is taken as beyond it. */
const OUT = 0.35;
/** Window and door surrounds' width, and how far they stand out: with the glass and the leaves in the wall's middle, set 23 cm in. */
const JAMB = 0.12;
const REVEAL = 0.08;
/** How far quoins stand out. */
const PROUD = 0.03;
/** A window's stone sill: how far it stands out, how thick it is, and how far past the surround it reaches. */
const SILL_OUT = 0.14;
const SILL_THICK = 0.08;
const SILL_PAST = 0.05;
/** A window's sill and head over its floor, and a door's head, as the world builds them. */
const SILL = 1;
const WINDOW_TOP = 2;
const DOOR_TOP = 2.2;
const ARCH_TOP = 2.6;
/** A stone course at the corners. */
const COURSE = 0.36;

/**
 * One face of a storey of wall: positions on it as `a` along the wall,
 * `o` out from its face and y.
 */
export class Face {
  readonly w: KitWall;
  /** Which way out it faces across the wall's line, -1 or 1. */
  readonly s: 1 | -1;
  private readonly boxes: Boxes;

  constructor(w: KitWall, s: 1 | -1, boxes: Boxes) {
    this.w = w;
    this.s = s;
    this.boxes = boxes;
  }

  /** The world point at `a` along, `o` out and `y` up. */
  point(a: number, o: number, y: number): THREE.Vector3 {
    const [x, z] = this.at(a, o);
    return new THREE.Vector3(x, y, z);
  }

  /** The way out of the face. */
  out(): THREE.Vector3 {
    return this.w.axis === 'x' ? new THREE.Vector3(0, 0, this.s) : new THREE.Vector3(this.s, 0, 0);
  }

  /** The world's (x, z) at `a` along and `o` out. */
  at(a: number, o: number): [number, number] {
    const c = this.w.line + this.s * (T / 2 + o);
    return this.w.axis === 'x' ? [a, c] : [c, a];
  }

  /** A box from a0 to a1 along, o0 to o1 out, y0 to y1 up. */
  box(a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, s: Stuff): void {
    const [p, q] = [this.at(Math.min(a0, a1), Math.min(o0, o1)), this.at(Math.max(a0, a1), Math.max(o0, o1))];
    this.boxes.box(Math.min(p[0], q[0]), y0, Math.min(p[1], q[1]), Math.max(p[0], q[0]), y1, Math.max(p[1], q[1]), s);
  }

  /** A box `size` (along, out, up) at (a, o, y), turned by `angle` about the face's normal and `tilt` about the wall's line. */
  turned(a: number, o: number, y: number, size: [number, number, number], angle: number, s: Stuff, tilt = 0): void {
    const [x, z] = this.at(a, o);
    // The face's frame, along it, out and up, as the world's axes: along it whichever way keeps the frame a turn.
    const out = this.w.axis === 'x' ? new THREE.Vector3(0, 0, this.s) : new THREE.Vector3(this.s, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(out, up), out, up);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    // Tilting out toward up, then turning about the way out.
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    this.boxes.turned(new THREE.Vector3(x, y, z), new THREE.Vector3(...size), q, s);
  }
}

/** A stretch of a face that looks outdoors, of one building, under its roof or not. */
interface Run {
  a0: number;
  a1: number;
  owner: Placed;
  top: boolean;
}

/**
 * The dressing of a map's town and its features (see features.ts), split
 * into tiles so each pass draws only those it sees, each tile's fine detail
 * left out of the far shadows and the sea's reflection (see fineAfter).
 */
export class Dressing {
  readonly group = new THREE.Group();
  /** Each tile's boxes, and which of `boxes` they are, coarse ones first. */
  private readonly tiles: { mesh: THREE.InstancedMesh; boxes: number[] }[] = [];
  private readonly boxes: Boxes;
  /** What isn't a box: wheels, leaves, hulls, the bell tower's roof; by tile. */
  private readonly shapes: THREE.Mesh[] = [];
  /** The near shadow map's camera, whose map alone the fine detail is drawn into. */
  private near: THREE.Camera | null = null;

  private constructor(world: World, boxes: Boxes, shapes: { geometry: THREE.BufferGeometry; coarse: number }[], lettering: THREE.Mesh | null) {
    this.boxes = boxes;
    const near = () => this.near;
    const base = roundable(new THREE.BoxGeometry(1, 1, 1));
    base.deleteAttribute('uv');
    const material = onTiles(new THREE.MeshStandardMaterial({ roughness: 0.85 }), world);
    const byTile = new Map<string, { coarse: number[]; fine: number[] }>();
    const at = new THREE.Vector3();
    const size = new THREE.Vector3();
    boxes.matrices.forEach((m, i) => {
      at.setFromMatrixPosition(m);
      size.setFromMatrixScale(m);
      const key = tileKey(at.x, at.z);
      let t = byTile.get(key);
      if (!t) byTile.set(key, (t = { coarse: [], fine: [] }));
      (isFine(size.x, size.y, size.z) ? t.fine : t.coarse).push(i);
    });
    for (const { coarse, fine } of byTile.values()) {
      const which = [...coarse, ...fine];
      const geometry = base.clone();
      // Stone, wood and metal rounded at every edge; cloth, leaves and flowers left as they are.
      geometry.setAttribute('round', new THREE.InstancedBufferAttribute(Float32Array.from(which, (i) => (boxes.stuffs[i].layer < UNTEXTURED ? roundCode(ALL_EDGES, 0.012) : 0)), 1));
      geometry.setAttribute('layer', new THREE.InstancedBufferAttribute(Float32Array.from(which, (i) => boxes.stuffs[i].layer), 1));
      const mesh = new THREE.InstancedMesh(geometry, material, which.length);
      which.forEach((b, k) => {
        mesh.setMatrixAt(k, boxes.matrices[b]);
        mesh.setColorAt(k, boxes.stuffs[b].flat);
      });
      fineAfter(mesh, coarse.length, near);
      this.tiles.push({ mesh, boxes: which });
    }
    base.dispose();
    const shapeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true, side: THREE.DoubleSide });
    for (const { geometry, coarse } of shapes) {
      const mesh = new THREE.Mesh(geometry, shapeMaterial);
      fineAfter(mesh, coarse, near);
      this.shapes.push(mesh);
    }
    for (const mesh of [...this.tiles.map((t) => t.mesh), ...this.shapes]) {
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (lettering) this.group.add(lettering);
  }

  /** A map town's dressing, or null for a world that isn't one. */
  static build(world: World): Dressing | null {
    if (!world.map) return null;
    const boxes = new Boxes();
    const shapes = new Shapes();
    const life = new Life(world, boxes, shapes);
    dressFacades(world, boxes, shapes, life);
    life.string();
    life.roofs();
    dressBlocks(world, boxes);
    features(world, boxes, shapes);
    roofs(world, boxes, shapes);
    balconies(world, boxes, shapes);
    const lettering = signs(world, boxes);
    return new Dressing(world, boxes, shapes.tiles(), lettering);
  }

  /** Draw the fine detail into the shadow map seen through `camera` alone: the near one's. */
  nearShadows(camera: THREE.Camera): void {
    this.near = camera;
  }

  /** Swap the flat colours for the textures, tinted. */
  applyAssets(assets: Assets, world: World): void {
    const old = new Set([...this.tiles.map((t) => t.mesh.material), ...this.shapes.map((m) => m.material)] as THREE.Material[]);
    const material = onTiles(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85 }, 1, { indoor: true, wet: true, age: world, round: true }), world);
    for (const { mesh, boxes } of this.tiles) {
      mesh.material = material;
      boxes.forEach((b, k) => mesh.setColorAt(k, this.boxes.stuffs[b].tint));
      mesh.instanceColor!.needsUpdate = true;
    }
    const shapeMaterial = surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85, vertexColors: true, side: THREE.DoubleSide }, 1, { indoor: true, wet: true });
    for (const mesh of this.shapes) {
      mesh.material = shapeMaterial;
      mesh.geometry.setAttribute('color', mesh.geometry.getAttribute('tint'));
    }
    for (const m of old) m.dispose();
  }
}

/** The trim over every wall of a map's buildings that looks outdoors, and the caps along their tops, into `boxes`. */
export function dressFacades(world: World, boxes: Boxes, shapes = new Shapes(), life?: Life): void {
  const placed = placeBlocks(world.map!.buildings);
  /** The block whose rooms (or roof space) hold (x, y, z), if any. */
  const indoor = (x: number, y: number, z: number): Placed | null => {
    for (const p of placed) {
      const b = p.block;
      if (x <= b.minX - T / 2 || x >= b.maxX + T / 2 || z <= b.minZ - T / 2 || z >= b.maxZ + T / 2) continue;
      const bottom = p.floor + p.height * (b.from ?? 0) - SLAB;
      const top = p.top + SLAB + (p.pitched ? Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 4 : 0);
      if (y > bottom && y < top) return p;
    }
    return null;
  };
  /** Open air at (x, y, z): not in the ground nor in anything built. */
  const open = (x: number, y: number, z: number) => world.terrainHeight(x, z) < y - 0.05 && world.clearAsBuilt(x, y - 0.05, z, 0.1, 0.02);
  const outdoors = (x: number, y: number, z: number) => !indoor(x, y, z) && open(x, y, z);

  for (const w of world.facades) {
    for (const s of [-1, 1] as const) {
      const face = new Face(w, s, boxes);
      const top = w.y + w.height;
      // Where it looks outdoors, a stretch at a time, by whose wall it is and whether its roof is above.
      const runs: Run[] = [];
      for (let a = w.a0 + STEP / 2; a < w.a1; a += STEP) {
        const [ox, oz] = face.at(a, OUT);
        const [ix, iz] = face.at(a, -T - OUT);
        const owner = outdoors(ox, w.y + 1.6, oz) ? indoor(ix, w.y + 1.6, iz) : null;
        if (!owner) continue;
        const roofed = !indoor(ix, top + 0.6, iz) && !indoor(ox, top + 0.6, oz);
        const last = runs[runs.length - 1];
        if (last && last.owner.building === owner.building && last.top === roofed && Math.abs(last.a1 - (a - STEP / 2)) < 1e-6) last.a1 = a + STEP / 2;
        else runs.push({ a0: a - STEP / 2, a1: a + STEP / 2, owner, top: roofed });
      }
      for (const run of runs) dressRun(world, face, shapes, run, outdoors, life);
    }
  }
  caps(world, boxes, placed, new Set([...railProps(world), ...doorProps(world)]));
}

/** Stone along the tops of parapets and freestanding walls, not of the railings indoors round the stairs nor of balconies' (see balconies.ts), nor of door leaves. */
function caps(world: World, boxes: Boxes, placed: readonly Placed[], rails: Set<number>): void {
  const inRoom = (x: number, z: number) => placed.some(({ block: b }) => x > b.minX + T / 2 && x < b.maxX - T / 2 && z > b.minZ + T / 2 && z < b.maxZ - T / 2);
  for (const [i, p] of world.props.entries()) {
    const b = p.box;
    if (b.part !== 'wall' || b.walk || rails.has(i)) continue;
    const [dx, dz, dy] = [b.maxX - b.minX, b.maxZ - b.minZ, b.maxY - b.minY];
    const thin = Math.min(dx, dz);
    if (thin > 0.6 || Math.max(dx, dz) < 1.5) continue;
    // A building's parapets and railings, or a map's freestanding walls.
    if (p.colour !== undefined && (dy < 0.9 || dy > 1.3 || inRoom((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2))) continue;
    const grow = 0.04;
    const [gx, gz] = dx < dz ? [grow, 0] : [0, grow];
    boxes.box(b.minX - gx, b.maxY, b.minZ - gz, b.maxX + gx, b.maxY + 0.07, b.maxZ + gz, STONE);
  }
}

/** A building's dressing, and a stream of choices of its own. */
function trimOf(run: Run): MapTrim {
  return run.owner.building.trim ?? {};
}

/** The openings of a storey of wall on a stretch of it, with their extents. */
function openingsOn(w: KitWall, a0: number, a1: number): KitOpening[] {
  return w.openings.filter((o) => o.at > a0 && o.at < a1);
}

/** How high an opening reaches over its floor. */
function headOf(o: KitOpening): number {
  return o.kind === 'window' ? WINDOW_TOP : o.kind === 'door' ? DOOR_TOP : (o.height ?? ARCH_TOP);
}

function dressRun(world: World, face: Face, shapes: Shapes, run: Run, outdoors: (x: number, y: number, z: number) => boolean, life?: Life): void {
  const w = face.w;
  const trim = trimOf(run);
  const rand = mulberry32(Math.floor((w.line * 7919 + w.y * 104729 + run.a0 * 1299709) * 1000) ^ 0x5bd1e995);
  const top = w.y + w.height;
  // Its building's ground storey: a line of wall merged with a lower building's reaches down to that one's foot.
  const ground = !run.owner.block.from && Math.abs(run.owner.floor - w.y) < 0.01 && w.base < w.y - 1e-6;
  const own = openingsOn(w, run.a0 - 0.01, run.a1 + 0.01);
  // Whether the corner at each end turns outdoors, and how far round it to reach: past a wall along z's end, over the wall along x's.
  const corner = (end: number, dir: -1 | 1) => {
    const reach = w.axis === 'z' ? T : 0;
    const [x, z] = face.at(end + dir * (reach + 0.2), 0.2);
    return Math.abs(end - (dir < 0 ? w.a0 : w.a1)) < STEP && outdoors(x, w.y + 1.6, z) ? reach : -1;
  };
  const lo = corner(run.a0, -1);
  const hi = corner(run.a1, 1);
  const a0 = run.a0 - Math.max(lo, 0);
  const a1 = run.a1 + Math.max(hi, 0);
  /** The stretches of [b0, b1] clear of doorways and arches (and windows too, if `windows`). */
  const between = (b0: number, b1: number, windows: boolean, pad = 0): [number, number][] => {
    const out: [number, number][] = [];
    let at = b0;
    for (const o of [...own].sort((p, q) => p.at - q.at)) {
      if (o.kind === 'window' && !windows) continue;
      const [o0, o1] = [o.at - o.width / 2 - pad, o.at + o.width / 2 + pad];
      if (o0 > at) out.push([at, Math.min(o0, b1)]);
      at = Math.max(at, o1);
    }
    if (at < b1) out.push([at, b1]);
    return out.filter(([p, q]) => q - p > 0.05);
  };

  // The plinth along the ground storey's foot, wrapping the corners.
  if (ground) {
    for (const [p, q] of between(a0 - (lo >= 0 ? 0.06 : 0), a1 + (hi >= 0 ? 0.06 : 0), false)) face.box(p, q, 0, 0.06, w.base, w.y + 0.45, STONE);
  }
  // A string course at the floor of each storey above the ground's, and the cornice under the roof.
  if (trim.quoins && !ground) {
    for (const [p, q] of between(a0 - (lo >= 0 ? 0.04 : 0), a1 + (hi >= 0 ? 0.04 : 0), false)) face.box(p, q, 0, 0.04, w.y - 0.12, w.y + 0.04, STONE);
  }
  if (run.top) {
    const [p, q] = [a0 - (lo >= 0 ? 0.12 : 0), a1 + (hi >= 0 ? 0.12 : 0)];
    face.box(p, q, 0, 0.12, top - 0.1, top + SLAB, STONE);
    face.box(p + (lo >= 0 ? 0.06 : 0), q - (hi >= 0 ? 0.06 : 0), 0, 0.06, top - 0.26, top - 0.1, STONE);
  }
  // Stone at the corners: courses long and short in turn, the other face's the other way round.
  if (trim.quoins) {
    for (const [end, dir, reach] of [[run.a0, 1, lo], [run.a1, -1, hi]] as const) {
      if (reach < 0) continue;
      const c = end - dir * reach;
      const from = w.y + (ground ? 0.45 : 0.04);
      const n = Math.max(1, Math.round((top - (run.top ? 0.26 : 0.12) - from) / COURSE));
      const h = (top - (run.top ? 0.26 : 0.12) - from) / n;
      const flip = w.axis === 'x' ? 0 : 1;
      for (let k = 0; k < n; k++) {
        const len = (k + flip) % 2 ? 0.42 : 0.7;
        const y0 = from + k * h;
        const [s0, s1] = dir > 0 ? [c - PROUD, c + len] : [c - len, c + PROUD];
        // Not over an opening.
        if (own.some((o) => o.at + o.width / 2 + JAMB > s0 && o.at - o.width / 2 - JAMB < s1 && y0 < w.y + headOf(o) + 0.2 && y0 + h > w.y + (o.kind === 'window' ? SILL - 0.1 : 0))) continue;
        face.box(s0, s1, 0, PROUD, y0 + 0.01, y0 + h - 0.01, STONE);
      }
    }
  }

  const paint = trim.paint?.length ? painted(trim.paint[Math.floor(rand() * trim.paint.length)]) : null;
  /** Whether a stretch along the face from b0 to b1, from y0 to y1 over the floor, is clear of the openings and their surrounds, and on the run. */
  const free = (b0: number, b1: number, y0: number, y1: number, beside?: KitOpening) =>
    b0 > run.a0 + 0.1 && b1 < run.a1 - 0.1
    && !own.some((o) => o !== beside && o.at + o.width / 2 + JAMB + 0.05 > b0 && o.at - o.width / 2 - JAMB - 0.05 < b1 && y0 < headOf(o) + 0.2 && y1 > (o.kind === 'window' ? SILL - 0.1 : 0));

  // What people grow by it, from a stream of its own too.
  const grow = mulberry32(Math.floor((w.line * 7919 + w.y * 104729 + run.a0 * 1299709) * 1000) ^ 0x3f84d5b5);
  if (ground && grow() < (trim.vines ?? 0)) {
    // Along the longest stretch of the ground storey clear of its doors and windows, and well off them, where the street runs along it.
    const [p, q] = between(run.a0 + 0.3, run.a1 - 0.3, true, 0.9).reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m), [0, 0]);
    const level = (a: number) => world.groundHeight(...face.at(a, 0.6), w.y + 0.3);
    if (q - p > 2 && Math.abs(level(p) - w.y) < 0.5 && Math.abs(level(q) - w.y) < 0.5) vine(face, shapes, p, q, level((p + q) / 2), Math.min(2.6 + grow() * 0.3, top - w.y - 0.2), grow);
  }
  // Pots along the foot of the ground storey, here and there, under its windows or against its blank walls.
  if (ground && grow() < (trim.pots ?? 0) * 0.7) {
    const stretches = between(run.a0 + 0.3, run.a1 - 0.3, false, 0.6).filter(([p, q]) => q - p > 0.8);
    if (stretches.length) {
      const [p, q] = stretches[Math.floor(grow() * stretches.length)];
      const width = Math.min(q - p, 0.6 + grow() * 0.8);
      const a = p + grow() * (q - p - width);
      const level = world.groundHeight(...face.at(a + width / 2, 0.4), w.y + 0.3);
      if (free(a, a + width, 0, 0.9) && Math.abs(level - w.y) < 0.5 && Math.abs(world.groundHeight(...face.at(a, 0.4), w.y + 0.3) - level) < 0.1 && Math.abs(world.groundHeight(...face.at(a + width, 0.4), w.y + 0.3) - level) < 0.1) {
        pots(face, shapes, a, a + width, level, free(a, a + width, 0, 1.9), grow);
      }
    }
  }
  if (life) {
    // What people have put up on it, from a stream of its own, so the rest is chosen as before.
    const mid = (run.a0 + run.a1) / 2;
    const street = ground && Math.abs(world.groundHeight(...face.at(mid, 0.8), w.y + 0.3) - w.y) < 0.6;
    const windows = own.filter((o) => o.kind === 'window');
    life.wall(face, run.a0, run.a1, street, (b0, b1, y0, y1) => free(b0, b1, y0, y1), windows, mulberry32(Math.floor((w.line * 7919 + w.y * 104729 + run.a0 * 1299709) * 1000) ^ 0x2c1b3c6d));
  }
  for (const o of own) {
    const [o0, o1] = [o.at - o.width / 2, o.at + o.width / 2];
    const head = w.y + headOf(o);
    const bottom = w.y + (o.kind === 'window' ? SILL - 0.05 : 0);
    // Its surround: jambs either side and a head over it, an arch's with a keystone.
    if (head < top - 0.05) {
      const foot = o.kind === 'window' ? w.y + SILL : bottom;
      face.box(o0 - JAMB, o0, 0, REVEAL, foot, head, STONE);
      face.box(o1, o1 + JAMB, 0, REVEAL, foot, head, STONE);
      face.box(o0 - JAMB - 0.04, o1 + JAMB + 0.04, 0, REVEAL + 0.02, head, Math.min(head + 0.18, top - 0.02), STONE);
      // A drip moulding along the head's top.
      if (head + 0.24 < top - 0.02) face.box(o0 - JAMB - 0.07, o1 + JAMB + 0.07, 0, REVEAL + 0.05, head + 0.18, head + 0.24, STONE);
      if (o.kind === 'arch') face.box(o.at - 0.16, o.at + 0.16, 0, REVEAL + 0.04, head - 0.12, Math.min(head + 0.26, top - 0.02), STONE);
    }
    // A stone sill standing out under a window, the frame's foot on it.
    if (o.kind === 'window') face.box(o0 - JAMB - SILL_PAST, o1 + JAMB + SILL_PAST, -0.01, SILL_OUT, w.y + SILL - SILL_THICK, w.y + SILL, STONE);
    if (o.kind === 'window') {
      // Shutters folded back either side.
      const leaf = o.width / 2;
      if (paint && rand() < (trim.shutters ?? 0) && free(o0 - JAMB - leaf - 0.02, o0 - JAMB, SILL, WINDOW_TOP, o) && free(o1 + JAMB, o1 + JAMB + leaf + 0.02, SILL, WINDOW_TOP, o)) {
        for (const [p, q] of [[o0 - JAMB - leaf, o0 - JAMB - 0.01], [o1 + JAMB + 0.01, o1 + JAMB + leaf]]) {
          face.box(p, q, 0.01, 0.05, w.y + SILL, w.y + WINDOW_TOP, paint);
          for (let k = 0; k < 6; k++) {
            const y = w.y + SILL + 0.12 + k * 0.15;
            face.box(p + 0.05, q - 0.05, 0.05, 0.065, y, y + 0.04, paint);
          }
        }
      }
      // A box of flowers under an upper window.
      if (w.y > world.terrainHeight(...face.at(o.at, 1)) + 2 && rand() < (trim.flowers ?? 0)) flowers(face, shapes, o.at, o.width, w.y + SILL, rand);
    } else if (o.kind === 'door' && ground) {
      // Only where the street is at the door.
      const [sx, sz] = face.at(o.at, 0.6);
      const street = world.groundHeight(sx, sz, w.y + 0.3);
      if (Math.abs(street - w.y) > 0.5) continue;
      const awned = rand() < (trim.awnings ?? 0);
      /** The side a creeper climbs, if one does. */
      let climbed = 0;
      if (awned) awning(face, o.at, o.width + 0.8, w.y, rand);
      else if (rand() < (trim.plants ?? 0)) {
        const width = 1 + rand() * 0.8;
        const side = rand() < 0.5 ? -1 : 1;
        const [p, q] = side < 0 ? [o0 - JAMB - 0.05 - width, o0 - JAMB - 0.05] : [o1 + JAMB + 0.05, o1 + JAMB + 0.05 + width];
        const height = 2.2 + rand() * 0.6;
        if (free(p, q, 0, height, o)) {
          creeper(face, shapes, p, q, w.y, height, rand);
          climbed = side;
        }
      }
      // Bougainvillea up one side and over the head, where nothing else climbs.
      const reach = 0.5;
      const [l0, l1, r0, r1] = [o0 - JAMB - reach, o0 - JAMB - 0.03, o1 + JAMB + 0.03, o1 + JAMB + reach];
      let flowered = 0;
      if (!awned && !climbed && grow() < (trim.bougainvillea ?? 0) && free(l0, l1, 0, 2.8, o) && free(r0, r1, 0, 2.8, o) && top - w.y > DOOR_TOP + 0.6) {
        flowered = grow() < 0.5 ? -1 : 1;
        bougainvillea(face, shapes, l0, r1, flowered < 0 ? l0 + 0.15 : r1 - 0.15, w.y + DOOR_TOP + 0.2, w.y, Math.min(top + 0.2, w.y + 3.3), grow);
      }
      // Pots on the other side, or either.
      if (grow() < (trim.pots ?? 0)) {
        const side = climbed || flowered ? -(climbed || flowered) : grow() < 0.5 ? -1 : 1;
        const width = 0.5 + grow() * 0.9;
        const [p, q] = side < 0 ? [o0 - JAMB - 0.08 - width, o0 - JAMB - 0.08] : [o1 + JAMB + 0.08, o1 + JAMB + 0.08 + width];
        const level = world.groundHeight(...face.at((p + q) / 2, 0.4), w.y + 0.3);
        // Low pots under a window beside the door; a lemon tree only where nothing's over it.
        if (free(p, q, 0, 0.9, o) && Math.abs(level - street) < 0.15) pots(face, shapes, p, q, level, free(p, q, 0, 1.9, o), grow);
      }
    }
  }
}

/** A window box of geraniums on brackets before the window from `at - width / 2` to `at + width / 2`, its sill at `y`. */
function flowers(face: Face, shapes: Shapes, at: number, width: number, y: number, rand: () => number): void {
  const [o0, o1] = [SILL_OUT + 0.02, SILL_OUT + 0.24];
  const w = width + 0.1;
  // Its own frame: x along the wall, z out of it.
  const out = face.out();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(out.x, out.z));
  shapes.trough(face.point(at, (o0 + o1) / 2, y - 0.2), q, new THREE.Vector3(w, 0.2, o1 - o0), TERRACOTTA);
  // Two iron brackets under it, braced back to the wall.
  for (const a of [at - width / 3, at + width / 3]) {
    face.box(a - 0.015, a + 0.015, 0, o1, y - 0.23, y - 0.2, IRON);
    face.turned(a, o1 / 4, y - 0.33, [0.02, 0.02, Math.hypot(o1 / 2, 0.2)], 0, IRON, -Math.atan2(o1 / 2, 0.2));
  }
  const bloom = BLOOMS[Math.floor(rand() * BLOOMS.length)];
  const up = new THREE.Vector3(0, 1, 0);
  // Leaves spilling out of it, and clusters of flowers on stalks over them.
  const n = Math.round(width * 90);
  for (let k = 0; k < n; k++) {
    const a = at - w / 2 + 0.06 + rand() * (w - 0.12);
    const base = face.point(a, o0 + 0.03 + rand() * (o1 - o0 - 0.06), y - 0.02);
    const lean = new THREE.Vector3((rand() - 0.5) * 1.6, 0.3 + rand() * 0.9, 0).applyQuaternion(q).add(out.clone().multiplyScalar(rand() * 0.8));
    const facing = up.clone().addScaledVector(out, 0.5).add(new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5));
    shapes.leaf(base, lean, facing, 0.09 + rand() * 0.06, LEAVES[Math.floor(rand() * LEAVES.length)]);
  }
  for (let k = 0; k < Math.round(width * 7); k++) {
    const a = at - w / 2 + 0.1 + rand() * (w - 0.2);
    const top = face.point(a, (o0 + o1) / 2 + (rand() - 0.5) * 0.1, y + 0.08 + rand() * 0.14);
    const foot = face.point(a, (o0 + o1) / 2, y - 0.02);
    shapes.add(new THREE.CylinderGeometry(0.006, 0.006, 1, 3, 1, true), new THREE.Matrix4().compose(foot.clone().add(top).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, top.clone().sub(foot).normalize()), new THREE.Vector3(1, foot.distanceTo(top), 1)), LEAVES[0]);
    for (let f = 0; f < 5; f++) {
      const p = top.clone().add(new THREE.Vector3((rand() - 0.5) * 0.09, rand() * 0.06, (rand() - 0.5) * 0.09));
      shapes.add(new THREE.OctahedronGeometry(1, 0), new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.03, 0.022, 0.03)), bloom);
    }
  }
}

/** A creeper climbing the face from b0 to b1 along it, from the ground at `y` to `height` over it, its stems branching and its leaves and flowers thickest at the top. */
function creeper(face: Face, shapes: Shapes, b0: number, b1: number, y: number, height: number, rand: () => number): void {
  const root = rand() < 0.5 ? b0 + 0.15 : b1 - 0.15;
  const out = face.out();
  const stem = (p: THREE.Vector3, q: THREE.Vector3, r: number) => {
    const len = p.distanceTo(q);
    const g = new THREE.CylinderGeometry(r * 0.7, r, len, 5, 1, true);
    shapes.add(g, new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()), new THREE.Vector3(1, 1, 1)), STEM);
  };
  // The trunk up the wall, twisting a little, and branches fanning out from it toward the top.
  let p = face.point(root, 0.05, y - 0.1);
  const trunk: THREE.Vector3[] = [p];
  for (let k = 1; k <= 5; k++) {
    const q = face.point(root + (rand() - 0.5) * 0.25, 0.05 + rand() * 0.04, y + (height * 0.7 * k) / 5);
    stem(p, q, 0.035 - k * 0.004);
    trunk.push(q);
    p = q;
  }
  for (let k = 0; k < 5; k++) {
    const from = trunk[2 + Math.floor(rand() * 4)];
    const to = face.point(b0 + rand() * (b1 - b0), 0.06, Math.min(y + height, from.y + 0.3 + rand() * 0.8));
    stem(from, to, 0.015);
  }
  const bloom = BLOOMS[rand() < 0.6 ? 0 : Math.floor(rand() * BLOOMS.length)];
  const n = Math.round((b1 - b0) * height * 170);
  for (let k = 0; k < n; k++) {
    // Thicker toward the top, where it spreads.
    const v = Math.sqrt(rand());
    const yy = y + 0.3 + v * (height - 0.3);
    const spread = 0.25 + 0.75 * v;
    const a = root + (rand() - 0.5) * (b1 - b0) * spread * 1.6;
    if (a < b0 || a > b1) continue;
    const at = face.point(a, 0.04 + rand() * 0.14, yy);
    const along = new THREE.Vector3(rand() - 0.5, rand() - 0.7, rand() - 0.5);
    const flower = rand() < 0.35;
    shapes.leaf(at, along, out.clone().add(new THREE.Vector3(0, 0.4, 0)), flower ? 0.08 + rand() * 0.04 : 0.1 + rand() * 0.07, flower ? bloom : LEAVES[Math.floor(rand() * LEAVES.length)]);
  }
}

/** A striped awning `width` wide over the doorway at `at`, its floor at `y`, sloping out from over its head, with its arms. */
function awning(face: Face, at: number, width: number, y: number, rand: () => number): void {
  const colour = plain(CANVAS[Math.floor(rand() * CANVAS.length)]);
  const [high, low, reach] = [y + 2.75, y + 2.35, 1.3];
  const slope = Math.hypot(reach, high - low);
  const tilt = Math.atan2(high - low, reach);
  const stripes = Math.max(3, Math.round(width / 0.25));
  const sw = width / stripes;
  for (let k = 0; k < stripes; k++) {
    const a = at - width / 2 + (k + 0.5) * sw;
    const s = k % 2 ? CREAM : colour;
    face.turned(a, reach / 2, (high + low) / 2, [sw, slope, 0.02], 0, s, -tilt);
    // The valance hanging from its front.
    face.box(a - sw / 2, a + sw / 2, reach - 0.01, reach + 0.01, low - 0.22, low, s);
  }
  // The arms, from the wall to its front corners.
  const arm = Math.hypot(reach, 0.5);
  for (const a of [at - width / 2 + 0.05, at + width / 2 - 0.05]) face.turned(a, reach / 2, low - 0.2, [0.03, arm, 0.03], 0, IRON, Math.atan2(0.5, reach));
}
