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
    g.dispose();
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

  geometry(): THREE.BufferGeometry | null {
    if (!this.pieces.length) return null;
    const g = mergeGeometries(this.pieces)!;
    for (const p of this.pieces) p.dispose();
    return g;
  }
}

