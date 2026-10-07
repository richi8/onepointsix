import * as THREE from 'three';
import { smoothstep } from '../shared/geom.ts';
import { fbm } from '../shared/rng.ts';
import { boxTop, type Box, type World } from '../shared/world.ts';
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
export const LEVELS: [step: number, from: number][] = [[1, 0], [2, 230], [4, 460]];
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
/** A map's grass, bleached by a southern sun to straw and ochre, in patches. */
const TINT_STRAW = new THREE.Color(0xf2ead6);
const TINT_OCHRE = new THREE.Color(0xecdcb8);

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
    // A map's ground of boxes, drawn as one surface over them.
    const ground = groundSurface(world);
    if (ground) {
      const mesh = new THREE.Mesh(ground, material);
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
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

/**
 * The tint the textured ground takes at (x, z), into `out`: patches of lusher
 * grass, fading to none where it's `bare` (sand or rock), 0..1. Grass roots
 * take it too, to match the ground they grow from.
 */
export function groundTint(world: World, x: number, z: number, bare: number, out: THREE.Color): THREE.Color {
  const lush = fbm(x / 23, z / 23, world.seed + 11, 2);
  if (world.map) return out.copy(TINT_STRAW).lerp(TINT_OCHRE, smoothstep(0.35, 0.75, lush)).lerp(WHITE, bare);
  return out.copy(TINT_GRASS).lerp(TINT_LUSH, smoothstep(0.35, 0.75, lush)).lerp(WHITE, bare);
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

    groundTint(world, x, z, Math.max(sand, rock), c).lerp(TINT_SEABED, seabed);
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

/**
 * The height of the ground at (x, z) as a level with vertices every `step`
 * cells draws it, split into triangles as World.terrainHeight splits them.
 * With a step of 1 it's World.terrainHeight.
 */
export function levelHeight(world: World, x: number, z: number, step: number): number {
  const n = world.res + 1;
  const gx = Math.min(Math.max((x + world.half) / world.cell, 0), world.res - 1e-4);
  const gz = Math.min(Math.max((z + world.half) / world.cell, 0), world.res - 1e-4);
  const ix = Math.min(Math.floor(gx / step) * step, world.res - step);
  const iz = Math.min(Math.floor(gz / step) * step, world.res - step);
  const fx = (gx - ix) / step;
  const fz = (gz - iz) / step;
  const H = world.heights;
  const i = iz * n + ix;
  const a = H[i];
  const b = H[i + step];
  const c = H[i + step * n];
  const d = H[i + step * n + step];
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

/** Which level the tile under (x, z) is drawn at, seen from `eye`, as THREE.LOD picks it. */
export function levelAt(world: World, x: number, z: number, eye: THREE.Vector3): number {
  const size = TILE * world.cell;
  const last = world.res / TILE - 1;
  const tx = Math.min(Math.max(Math.floor((x + world.half) / size), 0), last);
  const tz = Math.min(Math.max(Math.floor((z + world.half) / size), 0), last);
  const d = eye.distanceTo(new THREE.Vector3(-world.half + (tx + 0.5) * size, 0, -world.half + (tz + 0.5) * size));
  let level = 0;
  LEVELS.forEach(([, from], i) => d >= from && (level = i));
  return level;
}

/** Where the camera is, for the shaders that stand things on the level their tile is drawn at. */
export const groundEye = { value: new THREE.Vector3() };
const heightTextures = new WeakMap<World, THREE.DataTexture>();

/** The island's heights, exact, for shaders to read texel by texel. */
function heightTexture(world: World): THREE.DataTexture {
  let tex = heightTextures.get(world);
  if (tex) return tex;
  const n = world.res + 1;
  tex = new THREE.DataTexture(Float32Array.from(world.heights), n, n, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  heightTextures.set(world, tex);
  return tex;
}

/** GLSL: `groundLevel(p, step)`, the ground at world (x, z) `p` as a tile drawn every `step` cells has it. */
function levelGlsl(world: World): string {
  const f = (v: number) => v.toFixed(4);
  return /* glsl */ `
    uniform sampler2D groundHeights;
    float groundLevel(vec2 p, int step) {
      float s = float(step);
      vec2 g = clamp((p + ${f(world.half)}) / ${f(world.cell)}, 0.0, ${f(world.res - 1e-4)});
      vec2 c = min(floor(g / s) * s, vec2(${f(world.res)} - s));
      vec2 k = (g - c) / s;
      ivec2 i = ivec2(c);
      float a = texelFetch(groundHeights, i, 0).r;
      float b = texelFetch(groundHeights, i + ivec2(step, 0), 0).r;
      float cc = texelFetch(groundHeights, i + ivec2(0, step), 0).r;
      float d = texelFetch(groundHeights, i + ivec2(step), 0).r;
      return k.x + k.y <= 1.0 ? a + (b - a) * k.x + (cc - a) * k.y : d + (cc - d) * (1.0 - k.x) + (b - d) * (1.0 - k.y);
    }
  `;
}

/** GLSL for levelHeight and levelAt: `groundDrop(p)` is how far the drawn ground at p stands above the exact ground. */
function groundGlsl(world: World): string {
  const f = (v: number) => v.toFixed(4);
  return /* glsl */ `
    ${levelGlsl(world)}
    uniform vec3 groundEye;
    float groundDrop(vec2 p) {
      float size = ${f(TILE * world.cell)};
      vec2 t = clamp(floor((p + ${f(world.half)}) / size), 0.0, ${f(world.res / TILE - 1)});
      vec2 mid = -${f(world.half)} + (t + 0.5) * size;
      float d = distance(groundEye, vec3(mid.x, 0.0, mid.y));
      ${LEVELS.slice(1).reverse().map(([step, from]) => `if (d >= ${f(from)}) return groundLevel(p, ${step}) - groundLevel(p, 1);`).join('\n      ')}
      return 0.0;
    }
  `;
}

/**
 * Add the GLSL above to a shader: `groundDrop(p)` in its vertex shader. For
 * shaders that place things themselves, such as the impostors' cards.
 */
export function addGroundDrop(shader: THREE.WebGLProgramParametersWithUniforms, world: World): void {
  shader.uniforms.groundHeights = { value: heightTexture(world) };
  shader.uniforms.groundEye = groundEye;
  if (!shader.vertexShader.includes('#include <common>')) throw new Error('Shader anchor #include <common> is missing');
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${groundGlsl(world)}`);
}

/**
 * Add `groundLevel(p, 1)`, the exact ground's height at world (x, z) `p`, to
 * a shader's fragment shader, for surfaces that weather by their height off it.
 */
export function addGroundLevel(shader: THREE.WebGLProgramParametersWithUniforms, world: World): void {
  shader.uniforms.groundHeights = { value: heightTexture(world) };
  if (!shader.fragmentShader.includes('#include <common>')) throw new Error('Shader anchor #include <common> is missing');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${levelGlsl(world)}`);
}

/**
 * Stand each instance of an instanced mesh on the ground as its tile is drawn,
 * rather than on the exact ground, so nothing floats over or sinks into a
 * coarse far tile. Instances may only turn about the vertical.
 */
export function onTiles<M extends THREE.Material>(material: M, world: World): M {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    addGroundDrop(shader, world);
    if (!shader.vertexShader.includes('#include <begin_vertex>')) throw new Error('Shader anchor #include <begin_vertex> is missing');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        transformed.y += groundDrop(instanceMatrix[3].xz) / max(length(instanceMatrix[1].xyz), 1e-4);
      #endif`);
  };
  material.customProgramCacheKey = () => `${key}-on-tiles`;
  return material;
}

/** Metres between a map's ground surface's vertices. */
const GROUND_STEP = 0.25;
/** Tops nearer than this where boxes meet are one surface, their seam closed; farther, a ledge, its box's side showing. */
const GROUND_SEAM = 0.15;
/**
 * How far the surface is lifted over the boxes' tops, so none of their sides
 * shows through it where it meets a box a little out of true (a top is
 * within 3 cm of the floor under it, see scripts/calabianca.mjs), and how
 * far a skirt hangs from its edges, down past the lift, to meet the sides at
 * a ledge.
 */
const GROUND_LIFT = 0.035;
const GROUND_SKIRT = 0.15;
/** The ground surface's colour before the textures: the paving's. */
const GROUND_FLAT = new THREE.Color(0x9a8f7c);

/**
 * A map's ground made of boxes (Box.ground: its floors, flat and sloping) as
 * one surface over their tops, drawn with the terrain's material so it's
 * paved, worn and wet as the terrain is: a grid of vertices every
 * GROUND_STEP over each box, each at the mean of the tops of the boxes
 * meeting there that are near its own, so where two boxes' slopes meet a
 * little out of true the seam closes, and where they're a ledge apart it
 * stays open, the box's side showing. Null if the world has no such boxes.
 */
function groundSurface(world: World): THREE.BufferGeometry | null {
  const boxes = world.props.map((p) => p.box).filter((b) => b.ground);
  if (!boxes.length) return null;
  // Boxes by 2 m cell, for the ones meeting at a point.
  const CELL = 2;
  const cells = new Map<string, Box[]>();
  for (const b of boxes) {
    for (let i = Math.floor(b.minX / CELL); i <= Math.floor(b.maxX / CELL); i++) {
      for (let k = Math.floor(b.minZ / CELL); k <= Math.floor(b.maxZ / CELL); k++) {
        const key = `${i},${k}`;
        const list = cells.get(key);
        if (list) list.push(b);
        else cells.set(key, [b]);
      }
    }
  }
  const E = 1e-6;
  /** The surface's height at (x, z) on box `b`'s side of any ledge. */
  const height = (b: Box, x: number, z: number) => {
    const own = boxTop(b, x, z);
    let [sum, n] = [0, 0];
    for (const g of cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      if (x < g.minX - E || x > g.maxX + E || z < g.minZ - E || z > g.maxZ + E) continue;
      const top = boxTop(g, x, z);
      if (Math.abs(top - own) < GROUND_SEAM) (sum += top), n++;
    }
    return n ? sum / n : own;
  };
  const pos: number[] = [];
  const index: number[] = [];
  for (const b of boxes) {
    const nx = Math.max(1, Math.round((b.maxX - b.minX) / GROUND_STEP));
    const nz = Math.max(1, Math.round((b.maxZ - b.minZ) / GROUND_STEP));
    const first = pos.length / 3;
    for (let k = 0; k <= nz; k++) {
      for (let i = 0; i <= nx; i++) {
        const x = b.minX + ((b.maxX - b.minX) * i) / nx;
        const z = b.minZ + ((b.maxZ - b.minZ) * k) / nz;
        pos.push(x, height(b, x, z) + GROUND_LIFT, z);
      }
    }
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const a = first + k * (nx + 1) + i;
        index.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    // The skirt round its edge, each vertex there again, dropped, facing out.
    const at = (i: number, k: number) => first + k * (nx + 1) + i;
    const rim = [
      ...Array.from({ length: nx + 1 }, (_, i) => at(i, 0)),
      ...Array.from({ length: nz }, (_, k) => at(nx, k + 1)),
      ...Array.from({ length: nx }, (_, i) => at(nx - 1 - i, nz)),
      ...Array.from({ length: nz }, (_, k) => at(0, nz - 1 - k)),
    ];
    // Its own copies of the rim's vertices, so the skirt doesn't bend the surface's normals at its edge.
    const top = pos.length / 3;
    for (const v of rim) pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    const low = pos.length / 3;
    for (const v of rim) pos.push(pos[v * 3], pos[v * 3 + 1] - GROUND_SKIRT, pos[v * 3 + 2]);
    for (let e = 0; e + 1 < rim.length; e++) index.push(top + e, low + e, top + e + 1, top + e + 1, low + e, low + e + 1);
  }
  const count = pos.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const fill = (n: number, v: number[]) => new THREE.Float32BufferAttribute(Array.from({ length: count * n }, (_, i) => v[i % n]), n);
  geo.setAttribute('color', fill(3, [GROUND_FLAT.r, GROUND_FLAT.g, GROUND_FLAT.b]));
  geo.setAttribute('tint', fill(3, [1, 1, 1]));
  // Bare earth under it, where it isn't paved (the pit).
  geo.setAttribute('splatA', fill(4, [0, 0, 1, 0]));
  geo.setAttribute('splatB', fill(1, [0]));
  geo.computeBoundingSphere();
  return geo;
}
