import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Layer } from '../shared/layers.ts';
import { UNTEXTURED } from './surfaces.ts';

// What a map town's dressing and features are made of and put together
// from (see dressing.ts and features.ts): boxes as instances, and other
// shapes merged into one geometry, each part of a stuff with its texture
// layer, its tint over it and its colour before the textures come.

/** What each box is made of: its texture layer, its tint over it, and its colour before the textures come. */
export interface Stuff {
  layer: number;
  tint: THREE.Color;
  flat: THREE.Color;
}
export const stuff = (layer: number, tint: number, flat: number): Stuff => ({ layer, tint: new THREE.Color(tint), flat: new THREE.Color(flat) });
export const STONE = stuff(Layer.ashlar, 0xf6f2ea, 0xb8b0a0);
/** Painted wood: the boards' texture is dark, so the paint's tint is brightened past it. */
export const painted = (c: number): Stuff => stuff(Layer.boards, new THREE.Color(c).multiplyScalar(1.9).getHex(), c);
export const plain = (c: number): Stuff => stuff(UNTEXTURED, c, c);
export const IRON = plain(0x2a2a2a);
export const TERRACOTTA = plain(0xa85a3a);
export const STEM = plain(0x4a3a28);
export const LEAVES = [plain(0x3d6a2a), plain(0x4f7d34), plain(0x355a26)];
export const BLOOMS = [plain(0xd8327a), plain(0xe84a3c), plain(0xf2efe6), plain(0xe8c040), plain(0xb04ad0)];
/** Awnings' stripes: each a colour with cream. */
export const CANVAS = [0xb83a30, 0x2f6a9a, 0x3f7a4a, 0xd09a2a];
export const CREAM = plain(0xeee6d2);

/**
 * A leaf in its own frame: from its stalk at the origin up +y to its tip at
 * 1, half a unit across at its widest, its face toward +z and folded a
 * little along its midrib.
 */
const LEAF = (() => {
  const g = new THREE.BufferGeometry();
  const [stalk, l, tip, r] = [[0, 0, 0], [-0.32, 0.45, 0.1], [0, 1, 0], [0.32, 0.45, 0.1]];
  g.setAttribute('position', new THREE.Float32BufferAttribute([...stalk, ...tip, ...l, ...stalk, ...r, ...tip], 3));
  return g;
})();

/** A tapered square trough, 1 across at its rim, 0.8 at its foot, from y = 0 to 1, open at the top. */
const TROUGH = (() => {
  const g = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.8, 1, 4, 1, false).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  g.deleteAttribute('normal');
  return g;
})();

const basis = new THREE.Matrix4();
const turn = new THREE.Quaternion();

/** Boxes as instances: each one's matrix and what it's made of. */
export class Boxes {
  readonly matrices: THREE.Matrix4[] = [];
  readonly stuffs: Stuff[] = [];

  /** An axis-aligned box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s: Stuff): void {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
    this.matrices.push(new THREE.Matrix4().makeScale(x1 - x0, y1 - y0, z1 - z0).setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    this.stuffs.push(s);
  }

  /** A box `size` big, turned by `q`, its middle at `at`. */
  turned(at: THREE.Vector3, size: THREE.Vector3, q: THREE.Quaternion, s: Stuff): void {
    this.matrices.push(new THREE.Matrix4().compose(at, q, size));
    this.stuffs.push(s);
  }
}

/** Shapes merged into one geometry: each vertex's flat colour (`color`), its tint once textured (`tint`) and its layer. */
export class Shapes {
  private readonly pieces: THREE.BufferGeometry[] = [];

  /** `g` placed by `m`, made of `s`. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, s: Stuff): void {
    const q = g.index ? g.toNonIndexed() : g.clone();
    if (g !== LEAF && g !== TROUGH) g.dispose();
    for (const name of Object.keys(q.attributes)) if (name !== 'position' && name !== 'normal') q.deleteAttribute(name);
    if (!q.getAttribute('normal')) q.computeVertexNormals();
    q.applyMatrix4(m);
    const n = q.getAttribute('position').count;
    const fill = (c: THREE.Color) => new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3);
    q.setAttribute('color', fill(s.flat));
    q.setAttribute('tint', fill(s.tint));
    q.setAttribute('layer', new THREE.Float32BufferAttribute(new Array(n).fill(s.layer), 1));
    this.pieces.push(q);
  }

  /** A leaf `size` long from its stalk at `at`, its tip toward `along`, its face toward `facing` (made square to it). */
  leaf(at: THREE.Vector3, along: THREE.Vector3, facing: THREE.Vector3, size: number, s: Stuff): void {
    const y = along.clone().normalize();
    const z = facing.clone().addScaledVector(y, -facing.dot(y));
    // Any face at all, for a leaf along the way it was to face.
    if (z.lengthSq() < 1e-8) z.set(1, 0, 0).addScaledVector(y, -y.x);
    z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    turn.setFromRotationMatrix(basis.makeBasis(x, y, z));
    this.add(LEAF, new THREE.Matrix4().compose(at, turn, new THREE.Vector3(size, size, size)), s);
  }

  /** A tapered trough `size` (width, height, depth) standing at `at`, turned by `q`. */
  trough(at: THREE.Vector3, q: THREE.Quaternion, size: THREE.Vector3, s: Stuff): void {
    this.add(TROUGH, new THREE.Matrix4().compose(at, q, size), s);
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.pieces.length) return null;
    const g = mergeGeometries(this.pieces)!;
    for (const p of this.pieces) p.dispose();
    return g;
  }
}

