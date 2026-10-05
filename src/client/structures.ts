import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Layer } from '../shared/layers.ts';
import { mulberry32 } from '../shared/rng.ts';
import { watchtower, type World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { surfaceMaterial, UV } from './surfaces.ts';
import { onTiles } from './terrain.ts';

// The watchtowers and shipping containers, built from their parts rather than
// drawn as the boxes they collide as: a tower of posts and cross braces under
// a plank deck, a boarded parapet and a staircase of treads and risers; a
// container with corner posts, rails, ribbed walls and a pair of doors with
// their locking bars. Each is one geometry, drawn once per tower or
// container. What they collide as is unchanged, so every part stays inside
// the boxes the world has for them. A map's pitched roofs are drawn here too:
// two tiled slopes over the layers they collide as, and a gable at each end.

/** Wood's colour: flat, and as a tint over the boards texture once textured. */
const WOOD_FLAT = 0x6b4f33;
const WOOD_TINT = new THREE.Color(0xb0a292).multiplyScalar(1.8);
/** Container paint: flat colours, and tints over the texture. */
const PAINT_FLAT = [0x7a3b2e, 0x2f5a73, 0x4e6b3a, 0x8a7a3a, 0x5d6166];
const PAINT_TINT = [0xc0584a, 0x5d8aad, 0x7d9a5e, 0xc8ae62, 0xa4a8ac];
/** The corrugated texture is bright galvanised steel: paint darkens it. */
const PAINT_SHADE = new THREE.Color(0.62, 0.62, 0.62);

/** Wall plaster: the plain grey of a building given no colour, flat and as a tint over concrete; flat, a colour is this much darker than its tint. */
const PLASTER_FLAT = 0x8d8a82;
const PLASTER_TINT = 0xe0dcd4;
const PLASTER_SHADE = 0.63;
/** Roof tiles' terracotta, flat and as a tint over their texture. */
const TILES_FLAT = 0x8a4330;
const TILES_TINT = 0xf4ece4;
/** How far a pitched roof reaches past its walls, at its eaves and its gables. */
const OVERHANG = 0.25;

/** A map building's plaster `colour` (or the plain grey), flat or as a tint over the concrete texture. */
export function plasterColor(colour: number | undefined, textured: boolean, out: THREE.Color): THREE.Color {
  if (colour === undefined) return out.setHex(textured ? PLASTER_TINT : PLASTER_FLAT);
  out.setHex(colour);
  return textured ? out : out.multiplyScalar(PLASTER_SHADE);
}

/**
 * Every pitched roof of a map as one geometry: two slopes from the eaves up
 * to the ridge, out past the walls, and a gable at each end over its wall,
 * with `plaster` telling each vertex whether it's a gable's (and whose) or tiles' (-1).
 * The slopes carry `surfUv`, metres along the ridge and down from it, so the
 * tiles run down them; each roof's tiles are a shade of their own.
 */
function gableGeometry(world: World): { geometry: THREE.BufferGeometry; plaster: number[]; shade: number[] } {
  const pos: number[] = [];
  const uv: number[] = [];
  const plaster: number[] = [];
  const shade: number[] = [];
  const rand = mulberry32(world.seed + 41);
  let tone = 1;
  const tri = (a: number[], b: number[], c: number[], who: number, uvs = [0, 0, 0, 0, 0, 0]) => {
    pos.push(...a, ...b, ...c);
    uv.push(...uvs);
    plaster.push(who, who, who);
    shade.push(tone, tone, tone);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], who: number, uvs: number[][]) => {
    tri(a, b, c, who, [...uvs[0], ...uvs[1], ...uvs[2]]);
    tri(a, c, d, who, [...uvs[0], ...uvs[2], ...uvs[3]]);
  };
  world.gables.forEach((g, i) => {
    tone = 0.82 + rand() * 0.22;
    const alongX = g.ridge === 'x';
    // Along the ridge (u) and across it (v), to world x, y, z.
    const at = (u: number, v: number, y: number) => (alongX ? [u, y, v] : [v, y, u]);
    const [u0, u1] = alongX ? [g.rect.minX, g.rect.maxX] : [g.rect.minZ, g.rect.maxZ];
    const [v0, v1] = alongX ? [g.rect.minZ, g.rect.maxZ] : [g.rect.minX, g.rect.maxX];
    const vm = (v0 + v1) / 2;
    const top = g.y + g.rise;
    const drop = (OVERHANG * g.rise * 2) / (v1 - v0);
    const [a0, a1] = [u0 - OVERHANG, u1 + OVERHANG];
    // How far down the slope the eaves are from the ridge.
    const slope = Math.hypot(vm - v0 + OVERHANG, g.rise + drop);
    // The slopes, each wound to face up and out whichever way the axes run.
    const flip = alongX ? 1 : -1;
    for (const [ve, side] of [[v0 - OVERHANG, -1], [v1 + OVERHANG, 1]] as const) {
      const eave = [at(a0, ve, g.y - drop), at(a1, ve, g.y - drop)];
      const ridge = [at(a0, vm, top), at(a1, vm, top)];
      // Along the ridge one way on one slope and the other on the other, so neither is mirrored.
      const [s0, s1] = side > 0 ? [a0, a1] : [-a0, -a1];
      const uvs = { e0: [s0, slope], e1: [s1, slope], r0: [s0, 0], r1: [s1, 0] };
      if (side * flip > 0) quad(eave[0], eave[1], ridge[1], ridge[0], -1, [uvs.e0, uvs.e1, uvs.r1, uvs.r0]);
      else quad(eave[0], ridge[0], ridge[1], eave[1], -1, [uvs.e0, uvs.r0, uvs.r1, uvs.e1]);
    }
    // The gables, over the walls' outer faces.
    for (const [u, side] of [[u0, -1], [u1, 1]] as const) {
      const [p, q, r] = [at(u, v0, g.y), at(u, v1, g.y), at(u, vm, top)];
      if (side * flip > 0) tri(p, r, q, i);
      else tri(p, q, r, i);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('surfUv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('layer', new THREE.Float32BufferAttribute(plaster.map((who) => (who < 0 ? UV + Layer.rooftiles : Layer.plaster)), 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  geometry.computeVertexNormals();
  return { geometry, plaster, shade };
}

/** A container's size, as the world builds it: long half-length, half-width and height, from 0.2 below its ground. */
const HALF_LONG = 3;
const HALF_WIDE = 1.2;
const HEIGHT = 2.8;

/** Parts of one geometry, each a box of its own shade. */
class Parts {
  readonly pieces: THREE.BufferGeometry[] = [];

  /** An axis-aligned box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, shade = 1): void {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, shade);
  }

  /** A beam from a to b, `w` wide across and `h` deep, its width kept level. */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, shade = 1): void {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(w, h, len);
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    this.add(g, shade);
  }

  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.pieces)!;
    for (const p of this.pieces) p.dispose();
    // Textured in world space: no UVs needed.
    g.deleteAttribute('uv');
    return g;
  }

  private add(g: THREE.BufferGeometry, shade: number): void {
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(shade), 3));
    this.pieces.push(g);
  }
}

/**
 * A watchtower, from its platform's middle on the outpost's ground: posts at
 * the corners with cross braces between them, a deck of planks on joists, a
 * parapet of boards on three sides and a staircase up the fourth.
 */
function towerGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  const rand = mulberry32(17);
  const shade = () => 0.85 + rand() * 0.2;
  const TOP = 4;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Corner posts, up to the deck's underside.
  const posts = [-1.75, 1.75];
  for (const x of posts) for (const z of posts) p.box(x - 0.18, -0.5, z - 0.18, x + 0.18, TOP - 0.4, z + 0.18, 0.8);
  // Cross braces on each side, and a girt round the posts halfway up.
  for (const [a, b] of [[[-1.75, -1.75], [1.75, -1.75]], [[-1.75, 1.75], [1.75, 1.75]], [[-1.75, -1.75], [-1.75, 1.75]], [[1.75, -1.75], [1.75, 1.75]]]) {
    // Just outside the posts' faces, so they don't cut through each other.
    const out = a[0] === b[0] ? [Math.sign(a[0]) * 0.22, 0] : [0, Math.sign(a[1]) * 0.22];
    const [ax, az] = [a[0] + out[0], a[1] + out[1]];
    const [bx, bz] = [b[0] + out[0], b[1] + out[1]];
    p.beam(v(ax, 0.3, az), v(bx, TOP - 0.7, bz), 0.1, 0.06, 0.75);
    p.beam(v(bx, 0.3, bz), v(ax, TOP - 0.7, az), 0.1, 0.06, 0.75);
    p.beam(v(ax, TOP / 2 - 0.3, az), v(bx, TOP / 2 - 0.3, bz), 0.14, 0.06, 0.8);
  }
  // The deck: rim beams, two joists and planks across with a finger's gap.
  for (const s of [-1, 1]) {
    p.box(-2, TOP - 0.4, s * 2 - (s > 0 ? 0.12 : 0), 2, TOP - 0.06, s * 2 + (s > 0 ? 0 : 0.12), 0.8);
    p.box(s * 2 - (s > 0 ? 0.12 : 0), TOP - 0.4, -2, s * 2 + (s > 0 ? 0 : 0.12), TOP - 0.06, 2, 0.8);
    p.box(-2, TOP - 0.34, s * 0.7 - 0.06, 2, TOP - 0.06, s * 0.7 + 0.06, 0.8);
  }
  const planks = 13;
  const w = 4 / planks;
  for (let i = 0; i < planks; i++) p.box(-2 + i * w + 0.01, TOP - 0.06, -2, -2 + (i + 1) * w - 0.01, TOP, 2, shade());
  // The parapets, each 0.2 thick about its middle line from a0 to a1 at c
  // across: posts on the line, boards on the outer face and a cap rail.
  const parapet = (alongX: boolean, a0: number, a1: number, c: number, out: number) => {
    const at = (a: number, cc: number, y: number): [number, number, number] => (alongX ? [a, y, cc] : [cc, y, a]);
    const put = (a0: number, c0: number, y0: number, a1: number, c1: number, y1: number, s: number) => {
      const [x0, , z0] = at(Math.min(a0, a1), Math.min(c0, c1), 0);
      const [x1, , z1] = at(Math.max(a0, a1), Math.max(c0, c1), 0);
      p.box(x0, y0, z0, x1, y1, z1, s);
    };
    for (let k = 0; k <= 4; k++) {
      const a = a0 + 0.05 + ((a1 - a0 - 0.1) * k) / 4;
      put(a - 0.05, c - 0.05, TOP, a + 0.05, c + 0.05, TOP + 0.95, 0.8);
    }
    for (let r = 0; r < 4; r++) put(a0, c + out * 0.05, TOP + 0.04 + r * 0.23, a1, c + out * 0.1, TOP + 0.24 + r * 0.23, shade());
    put(a0, c - 0.1, TOP + 0.95, a1, c + 0.1, TOP + 1, 0.9);
  };
  parapet(true, -2, 2, -1.9, -1);
  parapet(true, -2, 2, 1.9, 1);
  parapet(false, -1.8, 1.8, -1.9, -1);
  // The staircase: a tread with a nosing and a riser at each step, closed in by stepped side boards.
  for (let i = 0; i < 7; i++) {
    const x0 = 2 + i;
    const top = TOP - 0.5 - 0.5 * i;
    p.box(x0 - (i === 0 ? 0 : 0.03), top - 0.05, -0.8, x0 + 1, top, 0.8, shade());
    p.box(x0 + 0.97, top - 0.5, -0.78, x0 + 1, top - 0.05, 0.78, 0.7);
    for (const s of [-1, 1]) p.box(x0, -0.5, s > 0 ? 0.75 : -0.8, x0 + 1, top - 0.05, s > 0 ? 0.8 : -0.75, 0.75);
    // Under the tread, between the sides: dark, as a closed-in stair is.
    p.box(x0, -0.5, -0.75, x0 + 0.97, top - 0.05, 0.75, 0.35);
  }
  // Stringers along each side, over the side boards' steps.
  for (const s of [-1, 1]) p.beam(v(9, 0, s * 0.8), v(2, TOP - 0.5, s * 0.8), 0.06, 0.24, 0.7);
  return p.geometry();
}

/**
 * A 20-foot shipping container, long along x, from its ground: corner posts,
 * top and bottom rails, ribbed walls and roof, and at the +x end a pair of
 * doors with their locking bars and hinges.
 */
function containerGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  const L = HALF_LONG;
  const W = HALF_WIDE;
  const H = HEIGHT;
  const post = 0.16;
  for (const x of [-L, L - post]) for (const z of [-W, W - post]) p.box(x, 0, z, x + post, H, z + post, 0.7);
  for (const y of [0, H - 0.14]) {
    for (const z of [-W, W - 0.1]) p.box(-L + post, y, z, L - post, y + 0.14, z + 0.1, 0.75);
    for (const x of [-L, L - 0.1]) p.box(x, y, -W + post, x + 0.1, y + 0.14, W - post, 0.75);
  }
  // The long walls: a plate set back, with ribs standing out to the rails' face.
  const period = 0.28;
  for (const s of [-1, 1]) {
    const face = s * W;
    const back = face - s * 0.06;
    const inner = face - s * 0.08;
    p.box(-L + post, 0.14, Math.min(back, inner), L - post, H - 0.14, Math.max(back, inner), 1);
    for (let x = -L + post + 0.08; x + 0.12 < L - post; x += period) {
      p.box(x, 0.14, Math.min(face, back), x + 0.12, H - 0.14, Math.max(face, back), 1);
    }
  }
  // The closed end: a plate with ribs across it.
  p.box(-L + 0.04, 0.14, -W + post, -L + 0.06, H - 0.14, W - post, 1);
  for (let z = -W + post + 0.08; z + 0.12 < W - post; z += period) p.box(-L, 0.14, z, -L + 0.04, H - 0.14, z + 0.12, 1);
  // The roof: a plate with low ribs across.
  p.box(-L + post, H - 0.06, -W + post, L - post, H - 0.03, W - post, 0.95);
  for (let x = -L + 0.4; x < L - 0.3; x += 0.55) p.box(x, H - 0.03, -W + post, x + 0.25, H, W - post, 0.9);
  // The doors: two leaves with their ribs, each with two locking bars, cam keepers and hinges.
  const dx = L - 0.04;
  p.box(dx - 0.02, 0.14, -W + post, dx, H - 0.14, W - post, 0.95);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = side * (0.12 + k * 0.33);
      p.box(dx, 0.3, Math.min(z, z + side * 0.14), dx + 0.025, H - 0.3, Math.max(z, z + side * 0.14), 1);
    }
    for (const z of [side * 0.28, side * 0.75]) {
      p.box(dx + 0.025, 0.1, z - 0.02, dx + 0.06, H - 0.1, z + 0.02, 0.55);
      for (const y of [0.05, H - 0.2]) p.box(dx + 0.02, y, z - 0.05, dx + 0.07, y + 0.15, z + 0.05, 0.5);
      // The handle, at waist height.
      p.box(dx + 0.06, 1.05, Math.min(z, z - side * 0.28), dx + 0.09, 1.12, Math.max(z, z - side * 0.28), 0.5);
    }
    for (const y of [0.4, 1.4, 2.4]) p.box(dx - 0.02, y, side * (W - post) - 0.04, dx + 0.05, y + 0.12, side * (W - post) + 0.04, 0.6);
  }
  return p.geometry();
}

/** The watchtowers and containers of an island, drawn from their parts. */
export class Structures {
  readonly group = new THREE.Group();
  private readonly towers: THREE.InstancedMesh;
  private readonly containers: THREE.InstancedMesh;
  /** The pitched roofs, and which gable's plaster each vertex wears, or -1 for tiles. */
  private readonly gables: THREE.Mesh;
  private readonly plaster: number[];
  private readonly shade: number[];
  private readonly world: World;
  /** Each container's paint, from the world: 0 to 1. */
  private readonly paint: number[] = [];

  /** Drawn for `world`, in place of the props `replaces` lists, which stop being drawn as boxes. */
  constructor(world: World) {
    this.world = world;
    this.towers = new THREE.InstancedMesh(towerGeometry(), onTiles(new THREE.MeshStandardMaterial({ color: WOOD_FLAT, vertexColors: true, roughness: 0.9 }), world), world.towers.length);
    world.towers.forEach(({ outpost }, i) => {
      const o = world.outposts[outpost];
      const t = watchtower(o);
      this.towers.setMatrixAt(i, new THREE.Matrix4().makeTranslation(t.x, o.y, t.z));
    });
    const boxes = world.props.filter((p) => p.style === 'metal');
    this.containers = new THREE.InstancedMesh(containerGeometry(), onTiles(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), world), boxes.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    boxes.forEach(({ box, tint }, i) => {
      const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
      // The doors at one end or the other, as the paint falls.
      const turn = (alongX ? 0 : Math.PI / 2) + (Math.floor(tint * 97) % 2 ? Math.PI : 0);
      m.makeRotationY(turn).setPosition((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
      this.containers.setMatrixAt(i, m);
      this.containers.setColorAt(i, c.setHex(pick(PAINT_FLAT, tint)));
      this.paint.push(tint);
    });
    const gables = gableGeometry(world);
    this.plaster = gables.plaster;
    this.shade = gables.shade;
    this.gables = new THREE.Mesh(gables.geometry, onTiles(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), world));
    this.colourGables(false);
    for (const mesh of [this.towers, this.containers, this.gables]) {
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Each gable in its building's plaster and the slopes in tiles, flat or as tints. */
  private colourGables(textured: boolean): void {
    const colours = this.gables.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    this.plaster.forEach((who, i) => {
      if (who < 0) c.setHex(textured ? TILES_TINT : TILES_FLAT).multiplyScalar(this.shade[i]);
      else plasterColor(this.world.gables[who].colour, textured, c);
      colours.setXYZ(i, c.r, c.g, c.b);
    });
    colours.needsUpdate = true;
  }

  /** The props these are drawn in place of: every tower's and container's. */
  static replaces(world: World): Set<number> {
    const out = new Set<number>();
    for (const t of world.towers) for (const i of t.props) out.add(i);
    for (const g of world.gables) for (const i of g.props) out.add(i);
    world.props.forEach((p, i) => p.style === 'metal' && out.add(i));
    return out;
  }

  /** Swap the flat colours for textures: boards for the towers, painted steel for the containers. */
  applyAssets(assets: Assets): void {
    const world = this.world;
    const old = [this.towers.material, this.containers.material, this.gables.material] as THREE.Material[];
    this.gables.material = onTiles(surfaceMaterial(assets, { kind: 'instanced' }, { vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }, 1, { indoor: true, wet: true, uv: true, age: world.map ? world : undefined }), world);
    this.colourGables(true);
    this.towers.material = onTiles(surfaceMaterial(assets, { kind: 'fixed', layer: Layer.boards }, { color: WOOD_TINT, vertexColors: true, roughness: 0.85 }, 1, { indoor: true, wet: true }), world);
    this.containers.material = onTiles(surfaceMaterial(assets, { kind: 'fixed', layer: Layer.metal }, { color: PAINT_SHADE, vertexColors: true, roughness: 0.55, metalness: 0.25 }, 0.3, { indoor: true, wet: true }), world);
    const c = new THREE.Color();
    this.paint.forEach((tint, i) => this.containers.setColorAt(i, c.setHex(pick(PAINT_TINT, tint))));
    // None to colour where there are no containers.
    if (this.containers.instanceColor) this.containers.instanceColor.needsUpdate = true;
    for (const m of old) m.dispose();
  }
}

function pick(palette: number[], t: number): number {
  return palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
}
