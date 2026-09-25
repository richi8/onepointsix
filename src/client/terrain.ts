import * as THREE from 'three';
import { smoothstep } from '../shared/geom.ts';
import { fbm } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import { paint } from '../shared/ground.ts';

// The island's ground as square tiles, each drawn at full detail up close and
// with every second or fourth vertex farther off. Up close the triangles are
// exactly World.terrainHeight's, so feet, bullets and bodies meet the ground
// where it's drawn. Coarser tiles hang a skirt down from their edges, which
// hides the cracks where they meet a finer neighbour. Every level takes its
// normals and paint from the full-detail vertices, so the lighting and colours
// don't jump when a tile changes level.

/** Grid cells along a tile's side; every level's step must divide it. */
const TILE = 40;
/** Vertex step of each level, and the distance from the camera to a tile's middle from which it's used. */
const LEVELS: [step: number, from: number][] = [[1, 0], [2, 230], [4, 460]];
/** How far skirts hang below a tile's edge, metres. */
const SKIRT = 4;

const SAND = new THREE.Color(0xb8a57a);
const GRASS = new THREE.Color(0x5b7338);
const GRASS_DRY = new THREE.Color(0x857a45);
const DIRT = new THREE.Color(0x76674c);
const ROCK = new THREE.Color(0x6f6b63);
const SEABED = new THREE.Color(0x6b6450);
const TINT_LUSH = new THREE.Color(0xa4c886);
const TINT_GRASS = new THREE.Color(0xcfe0b8);
const WHITE = new THREE.Color(0xffffff);
const TINT_SEABED = new THREE.Color(0x7d7460);

/** What every full-detail vertex carries, row by row, before it's split into tiles. */
interface Vertices {
  n: number;
  normal: Float32Array;
  color: Float32Array;
  tint: Float32Array;
  splatA: Float32Array;
  splatB: Float32Array;
}

export class Terrain {
  readonly group = new THREE.Group();
  /** Every level of every tile, for swapping attributes and materials. */
  private readonly meshes: THREE.Mesh[] = [];

  constructor(world: World) {
    const v = vertices(world);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const tiles = world.res / TILE;
    for (let tz = 0; tz < tiles; tz++) {
      for (let tx = 0; tx < tiles; tx++) {
        const lod = new THREE.LOD();
        const cx = -world.half + (tx + 0.5) * TILE * world.cell;
        const cz = -world.half + (tz + 0.5) * TILE * world.cell;
        lod.position.set(cx, 0, cz);
        for (const [step, from] of LEVELS) {
          const mesh = new THREE.Mesh(tile(world, v, tx * TILE, tz * TILE, step, cx, cz), material);
          mesh.receiveShadow = true;
          this.meshes.push(mesh);
          lod.addLevel(mesh, from);
        }
        this.group.add(lod);
      }
    }
  }

  /** Swap the flat colours for the textured material, tinted per vertex. */
  applyMaterial(material: THREE.Material): void {
    for (const mesh of this.meshes) {
      mesh.geometry.setAttribute('color', mesh.geometry.getAttribute('tint'));
      mesh.material = material;
    }
  }
}

/** Every full-detail vertex's normal, flat colour, tint and layer weights. */
function vertices(world: World): Vertices {
  const n = world.res + 1;
  // Normals as three.js would give the whole island as one mesh.
  const pos = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = (iz * n + ix) * 3;
      pos[i] = -world.half + ix * world.cell;
      pos[i + 1] = world.heights[iz * n + ix];
      pos[i + 2] = -world.half + iz * world.cell;
    }
  }
  const whole = new THREE.BufferGeometry();
  whole.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  whole.setIndex(indices(world.res, world.res, n));
  whole.computeVertexNormals();
  const normal = whole.getAttribute('normal').array as Float32Array;

  // A flat colour for before the textures arrive, the weights of the five
  // ground layers, and a tint over them for variety and the sea bed.
  const color = new Float32Array(n * n * 3);
  const tint = new Float32Array(n * n * 3);
  const splatA = new Float32Array(n * n * 4);
  const splatB = new Float32Array(n * n);
  const c = new THREE.Color();
  for (let i = 0; i < n * n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const { dry, dirt, rock, sand, seabed, weights } = paint(world, x, y, z, normal[i * 3 + 1]);

    c.copy(GRASS).lerp(GRASS_DRY, smoothstep(0.45, 0.7, dry));
    c.lerp(DIRT, dirt).lerp(ROCK, rock).lerp(SAND, sand).lerp(SEABED, seabed);
    c.toArray(color, i * 3);

    splatA.set(weights.slice(0, 4), i * 4);
    splatB[i] = weights[4];

    const lush = fbm(x / 23, z / 23, world.seed + 11, 2);
    c.copy(TINT_GRASS).lerp(TINT_LUSH, smoothstep(0.35, 0.75, lush)).lerp(WHITE, Math.max(sand, rock));
    c.lerp(TINT_SEABED, seabed);
    c.toArray(tint, i * 3);
  }
  whole.dispose();
  return { n, normal, color, tint, splatA, splatB };
}

/** Two triangles per cell of a `cols` × `rows` grid of vertices `stride` apart, split as World.terrainHeight splits them. */
function indices(cols: number, rows: number, stride: number): number[] {
  const out: number[] = [];
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const a = iz * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      out.push(a, c, b, b, c, d);
    }
  }
  return out;
}

/**
 * One tile at one level: the grid vertices from (ix0, iz0) every `step`
 * across TILE cells, placed around the tile's middle (cx, cz), and a skirt
 * round its edge.
 */
function tile(world: World, v: Vertices, ix0: number, iz0: number, step: number, cx: number, cz: number): THREE.BufferGeometry {
  const m = TILE / step + 1;
  const src: number[] = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) src.push((iz0 + j * step) * v.n + ix0 + i * step);
  const index = indices(m - 1, m - 1, m);

  // The skirt: each edge's vertices again, dropped, joined to the edge by quads facing out.
  const edges: number[][] = [
    Array.from({ length: m }, (_, i) => i), // -z side, left to right
    Array.from({ length: m }, (_, i) => (i + 1) * m - 1), // +x side
    Array.from({ length: m }, (_, i) => m * m - 1 - i), // +z side, right to left
    Array.from({ length: m }, (_, i) => (m - 1 - i) * m), // -x side
  ];
  const dropped = new Map<number, number>();
  for (const edge of edges) {
    for (const k of edge) {
      if (!dropped.has(k)) dropped.set(k, src.length);
      src.push(src[k]);
    }
    for (let e = 0; e + 1 < edge.length; e++) {
      const a = edge[e];
      const b = edge[e + 1];
      // Going round the tile counter-clockwise seen from above, outward is to the right.
      const a2 = src.length - edge.length + e;
      const b2 = a2 + 1;
      index.push(a, b, a2, b, b2, a2);
    }
  }
  const skirtStart = m * m;

  const count = src.length;
  const pos = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const tint = new Float32Array(count * 3);
  const splatA = new Float32Array(count * 4);
  const splatB = new Float32Array(count);
  src.forEach((g, k) => {
    const gx = g % v.n;
    const gz = Math.floor(g / v.n);
    pos[k * 3] = -world.half + gx * world.cell - cx;
    pos[k * 3 + 1] = world.heights[g] - (k >= skirtStart ? SKIRT : 0);
    pos[k * 3 + 2] = -world.half + gz * world.cell - cz;
    normal.set(v.normal.subarray(g * 3, g * 3 + 3), k * 3);
    color.set(v.color.subarray(g * 3, g * 3 + 3), k * 3);
    tint.set(v.tint.subarray(g * 3, g * 3 + 3), k * 3);
    splatA.set(v.splatA.subarray(g * 4, g * 4 + 4), k * 4);
    splatB[k] = v.splatB[g];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('splatA', new THREE.BufferAttribute(splatA, 4));
  geo.setAttribute('splatB', new THREE.BufferAttribute(splatB, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}
