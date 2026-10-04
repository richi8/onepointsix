import * as THREE from 'three';
import { KIT_WALL, placeBlocks, SLAB, type KitOpening, type KitWall, type Placed } from '../shared/kit.ts';
import type { MapTrim } from '../shared/maps/index.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { surfaceMaterial } from './surfaces.ts';
import { onTiles } from './terrain.ts';
import { features } from './features.ts';
import { BLOOMS, Boxes, CANVAS, CREAM, IRON, LEAVES, painted, plain, Shapes, STEM, STONE, TERRACOTTA, type Stuff } from './townparts.ts';

// A map town's buildings dressed over their walls, drawn only: nothing here
// collides, stops a round or casts a sound, so the town plays just as its
// boxes do. On every face of a wall that looks outdoors: a stone plinth
// along its foot, a cornice under its roof, string courses between its
// storeys and stone at its corners where its building has them (MapTrim),
// stone round its windows and doors, painted shutters folded back beside
// its windows, window boxes of flowers, creepers climbing beside its doors
// and striped awnings over them; and a stone cap along every parapet and
// freestanding wall. All of it is boxes, each a few centimetres proud of the
// wall, drawn as one instanced mesh.

const T = KIT_WALL;
/** How far apart along a face it's sampled for where it looks outdoors. */
const STEP = 0.25;
/** How far out from a face (or in from it) a point is taken as beyond it. */
const OUT = 0.35;
/** Window and door surrounds' width, and how far they stand out. */
const JAMB = 0.12;
const PROUD = 0.03;
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
class Face {
  readonly w: KitWall;
  /** Which way out it faces across the wall's line, -1 or 1. */
  readonly s: 1 | -1;
  private readonly boxes: Boxes;

  constructor(w: KitWall, s: 1 | -1, boxes: Boxes) {
    this.w = w;
    this.s = s;
    this.boxes = boxes;
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

/** The dressing of a map's town and its features (see features.ts). */
export class Dressing {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly boxes: Boxes;
  /** What isn't a box: wheels, trees' crowns, hulls, the bell tower's roof. */
  private readonly shapes: THREE.Mesh | null;

  private constructor(world: World, boxes: Boxes, shapes: THREE.BufferGeometry | null) {
    this.boxes = boxes;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.deleteAttribute('uv');
    this.mesh = new THREE.InstancedMesh(geometry, onTiles(new THREE.MeshStandardMaterial({ roughness: 0.85 }), world), boxes.matrices.length);
    boxes.matrices.forEach((m, i) => {
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, boxes.stuffs[i].flat);
    });
    geometry.setAttribute('layer', new THREE.InstancedBufferAttribute(Float32Array.from(boxes.stuffs, (s) => s.layer), 1));
    this.shapes = shapes ? new THREE.Mesh(shapes, new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true, side: THREE.DoubleSide })) : null;
    for (const mesh of [this.mesh, this.shapes]) {
      if (!mesh) continue;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** A map town's dressing, or null for a world that isn't one. */
  static build(world: World): Dressing | null {
    if (!world.map || !world.facades.length) return null;
    const boxes = new Boxes();
    const shapes = new Shapes();
    dressFacades(world, boxes);
    features(world, boxes, shapes);
    return new Dressing(world, boxes, shapes.geometry());
  }

  /** Swap the flat colours for the textures, tinted. */
  applyAssets(assets: Assets, world: World): void {
    const old = [this.mesh.material, this.shapes?.material] as (THREE.Material | undefined)[];
    this.mesh.material = onTiles(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85 }, 1, { indoor: true, wet: true }), world);
    this.boxes.stuffs.forEach((s, i) => this.mesh.setColorAt(i, s.tint));
    this.mesh.instanceColor!.needsUpdate = true;
    if (this.shapes) {
      this.shapes.material = surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85, vertexColors: true, side: THREE.DoubleSide }, 1, { indoor: true, wet: true });
      this.shapes.geometry.setAttribute('color', this.shapes.geometry.getAttribute('tint'));
    }
    for (const m of old) m?.dispose();
  }
}

/** The trim over every wall of a map's buildings that looks outdoors, and the caps along their tops, into `boxes`. */
export function dressFacades(world: World, boxes: Boxes): void {
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
      for (const run of runs) dressRun(world, face, run, outdoors);
    }
  }
  caps(world, boxes, placed);
}

/** Stone along the tops of parapets, balconies' railings and freestanding walls, not of the railings indoors round the stairs. */
function caps(world: World, boxes: Boxes, placed: readonly Placed[]): void {
  const inRoom = (x: number, z: number) => placed.some(({ block: b }) => x > b.minX + T / 2 && x < b.maxX - T / 2 && z > b.minZ + T / 2 && z < b.maxZ - T / 2);
  for (const p of world.props) {
    const b = p.box;
    if (b.part !== 'wall' || b.walk) continue;
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

function dressRun(world: World, face: Face, run: Run, outdoors: (x: number, y: number, z: number) => boolean): void {
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

  for (const o of own) {
    const [o0, o1] = [o.at - o.width / 2, o.at + o.width / 2];
    const head = w.y + headOf(o);
    const bottom = w.y + (o.kind === 'window' ? SILL - 0.05 : 0);
    // Its surround: jambs either side and a head over it, an arch's with a keystone.
    if (head < top - 0.05) {
      face.box(o0 - JAMB, o0, 0, PROUD, bottom, head, STONE);
      face.box(o1, o1 + JAMB, 0, PROUD, bottom, head, STONE);
      face.box(o0 - JAMB - 0.04, o1 + JAMB + 0.04, 0, PROUD + 0.02, head, Math.min(head + 0.18, top - 0.02), STONE);
      if (o.kind === 'arch') face.box(o.at - 0.16, o.at + 0.16, 0, PROUD + 0.04, head - 0.12, Math.min(head + 0.26, top - 0.02), STONE);
    }
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
      if (w.y > world.terrainHeight(...face.at(o.at, 1)) + 2 && rand() < (trim.flowers ?? 0)) flowers(face, o.at, o.width, w.y + SILL, rand);
    } else if (o.kind === 'door' && ground) {
      // Only where the street is at the door.
      const [sx, sz] = face.at(o.at, 0.6);
      if (Math.abs(world.groundHeight(sx, sz, w.y + 0.3) - w.y) > 0.5) continue;
      if (rand() < (trim.awnings ?? 0)) awning(face, o.at, o.width + 0.8, w.y, rand);
      else if (rand() < (trim.plants ?? 0)) {
        const width = 1 + rand() * 0.8;
        const side = rand() < 0.5 ? -1 : 1;
        const [p, q] = side < 0 ? [o0 - JAMB - 0.05 - width, o0 - JAMB - 0.05] : [o1 + JAMB + 0.05, o1 + JAMB + 0.05 + width];
        const height = 2.2 + rand() * 0.6;
        if (free(p, q, 0, height, o)) creeper(face, p, q, w.y, height, rand);
      }
    }
  }
}

/** A window box of flowers under the window from `at - width / 2` to `at + width / 2`, its sill at `y`. */
function flowers(face: Face, at: number, width: number, y: number, rand: () => number): void {
  face.box(at - width / 2 + 0.05, at + width / 2 - 0.05, 0.06, 0.28, y - 0.22, y - 0.02, TERRACOTTA);
  // Two iron brackets under it.
  for (const a of [at - width / 3, at + width / 3]) face.box(a - 0.02, a + 0.02, 0, 0.26, y - 0.32, y - 0.22, IRON);
  const bloom = BLOOMS[Math.floor(rand() * BLOOMS.length)];
  const n = Math.round(width * 12);
  for (let k = 0; k < n; k++) {
    const a = at - width / 2 + 0.1 + rand() * (width - 0.2);
    const s = 0.1 + rand() * 0.1;
    const leaf = rand() < 0.45 ? bloom : LEAVES[Math.floor(rand() * LEAVES.length)];
    face.turned(a, 0.1 + rand() * 0.16, y + rand() * 0.18, [s, s, s], rand() * Math.PI, leaf, rand() * Math.PI);
  }
}

/** A creeper climbing the face from b0 to b1 along it, from the ground at `y` to `height` over it, flowering. */
function creeper(face: Face, b0: number, b1: number, y: number, height: number, rand: () => number): void {
  const root = rand() < 0.5 ? b0 + 0.15 : b1 - 0.15;
  face.box(root - 0.04, root + 0.04, 0.01, 0.07, y - 0.1, y + height * 0.7, STEM);
  const bloom = BLOOMS[rand() < 0.6 ? 0 : Math.floor(rand() * BLOOMS.length)];
  const n = Math.round((b1 - b0) * height * 70);
  for (let k = 0; k < n; k++) {
    // Thicker toward the top, where it spreads.
    const v = Math.sqrt(rand());
    const yy = y + 0.3 + v * (height - 0.3);
    const spread = 0.25 + 0.75 * v;
    const a = root + (rand() - 0.5) * (b1 - b0) * spread * 1.6;
    if (a < b0 || a > b1) continue;
    const s = 0.08 + rand() * 0.06;
    const leaf = rand() < 0.35 ? bloom : LEAVES[Math.floor(rand() * LEAVES.length)];
    face.turned(a, 0.03 + rand() * 0.12, yy, [s, 0.03, s], rand() * Math.PI * 2, leaf, (rand() - 0.5) * 0.8);
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
