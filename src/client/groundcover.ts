import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import { clamp } from '../shared/geom.ts';
import { mulberry32 } from '../shared/rng.ts';
import { type Vegetation, VEG_CELL, vegetationOf } from '../shared/vegetation.ts';
import { inBuilding, type World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { groundWeights } from '../shared/ground.ts';
import { Layer } from '../shared/layers.ts';
import { surfaceMaterial } from './surfaces.ts';
import { WIND_GLSL, wind } from './wind.ts';

// Grass, low bushes and pebbles on the ground round the camera. Each 8 m cell
// of the island scatters its own the same way every time, thickest where the
// ground is painted grass, and never on props, under roofs or in the sea.
// Only the cells near the camera are drawn, and everything shrinks away
// toward the edge of its range, so nothing pops in. Nothing collides with
// them, but bots can't see through the bushes and thick grass: the bushes come
// from shared/vegetation.ts, where the server finds them too.

const CELL = VEG_CELL;

interface Kind {
  /** Metres out it's drawn to. */
  range: number;
  /** How many to try per square metre. */
  density: number;
  /** Chance of keeping a try, from the ground layer weights at its spot. */
  keep: (w: Float32Array, i: number) => number;
  /** Height range in metres. */
  size: [number, number];
}

const KINDS = {
  grass: { range: 42, density: 1.6, keep: (w, i) => w[i + Layer.grass] + w[i + Layer.dryGrass] * 0.8, size: [0.3, 0.6] },
  // Placed by Vegetation; drawn out to where bots can see.
  bush: { range: 120, density: 0.018, keep: () => 0, size: [0, 0] },
  pebble: { range: 35, density: 0.07, keep: (w, i) => 0.25 + w[i + Layer.rock] + w[i + Layer.dirt] * 0.8 + w[i + Layer.sand] * 0.5, size: [0.06, 0.26] },
} satisfies Record<string, Kind>;
type KindName = keyof typeof KINDS;

/** Instances of one kind in one cell: matrices, colours and count. */
interface Scatter {
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  kind: Kind;
  capacity: number;
}

const LUSH = new THREE.Color(0x8ea35a);
const DRY = new THREE.Color(0xb3a262);
const LEAF = new THREE.Color(0x6a8a44);

export class GroundCover {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly vegetation: Vegetation;
  private readonly weights: Float32Array;
  private readonly cells = new Map<string, Record<KindName, Scatter>>();
  private readonly layers: Record<KindName, Batch>;
  private readonly eye = { value: new THREE.Vector3() };
  private cx = NaN;
  private cz = NaN;

  constructor(world: World) {
    this.world = world;
    this.vegetation = vegetationOf(world);
    this.weights = groundWeights(world);
    const make = (name: KindName, geo: THREE.BufferGeometry, material: THREE.Material): Batch => {
      const kind = KINDS[name];
      const r = Math.ceil(kind.range / CELL) + 1;
      // Room for every cell in range at a little over the most they'd hold.
      const capacity = Math.ceil((2 * r + 1) ** 2 * CELL * CELL * kind.density * 0.9);
      const mesh = new THREE.InstancedMesh(geo, material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.group.add(mesh);
      return { mesh, kind, capacity };
    };
    this.layers = {
      grass: make('grass', grassGeometry(), fading(new THREE.MeshStandardMaterial({
        map: bladeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0.55,
      }), KINDS.grass.range, this.eye, 1)),
      bush: make('bush', bushGeometry(), fading(new THREE.MeshStandardMaterial({
        map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0.55,
      }), KINDS.bush.range, this.eye, 0.4)),
      pebble: make('pebble', pebbleGeometry(), fading(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), KINDS.pebble.range, this.eye, 0)),
    };
  }

  applyAssets(assets: Assets): void {
    const material = surfaceMaterial(assets, { kind: 'fixed', layer: Layer.rock }, { roughness: 0.95, flatShading: true });
    this.layers.pebble.mesh.material = fading(material, KINDS.pebble.range, this.eye, 0);
  }

  /** Fill in the cells round `eye`; cheap unless it has moved into another cell. */
  update(eye: THREE.Vector3): void {
    this.eye.value.copy(eye);
    const cx = Math.floor(eye.x / CELL);
    const cz = Math.floor(eye.z / CELL);
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    for (const name of Object.keys(KINDS) as KindName[]) {
      const { mesh, kind, capacity } = this.layers[name];
      const r = Math.ceil(kind.range / CELL);
      let count = 0;
      const matrices = mesh.instanceMatrix.array as Float32Array;
      const colors = mesh.instanceColor!.array as Float32Array;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // Only cells that reach within range of the camera's cell.
          if (Math.max(Math.hypot(dx, dz) - 1.5, 0) * CELL > kind.range) continue;
          const s = this.cell(cx + dx, cz + dz)[name];
          const n = Math.min(s.count, capacity - count);
          matrices.set(s.matrices.subarray(0, n * 16), count * 16);
          colors.set(s.colors.subarray(0, n * 3), count * 3);
          count += n;
        }
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
    // Forget cells well out of range.
    if (this.cells.size > 1200) {
      for (const key of this.cells.keys()) {
        const [x, z] = key.split(',').map(Number);
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) * CELL > 150) this.cells.delete(key);
      }
    }
  }

  /** What a cell holds, scattered the first time it's needed. */
  private cell(ix: number, iz: number): Record<KindName, Scatter> {
    const key = `${ix},${iz}`;
    let c = this.cells.get(key);
    if (c) return c;
    const rand = mulberry32((ix * 73856093) ^ (iz * 19349663) ^ this.world.seed);
    c = {
      grass: this.scatter(ix, iz, 'grass', rand),
      bush: this.placeBushes(ix, iz),
      pebble: this.scatter(ix, iz, 'pebble', rand),
    };
    this.cells.set(key, c);
    return c;
  }

  private placeBushes(ix: number, iz: number): Scatter {
    const bushes = this.vegetation.bushes(ix, iz);
    const matrices = new Float32Array(bushes.length * 16);
    const colors = new Float32Array(bushes.length * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const c = new THREE.Color();
    bushes.forEach((b, k) => {
      q.setFromEuler(e.set(b.leanX, b.turn, b.leanZ));
      m.compose(pos.set(b.x, b.y, b.z), q, scale.set(b.size, b.height, b.size)).toArray(matrices, k * 16);
      c.copy(LEAF).multiplyScalar(0.75 + b.shade * 0.4).toArray(colors, k * 3);
    });
    return { matrices, colors, count: bushes.length };
  }

  private scatter(ix: number, iz: number, name: 'grass' | 'pebble', rand: () => number): Scatter {
    const w = this.world;
    const kind = KINDS[name];
    const tries = Math.round(CELL * CELL * kind.density + rand());
    const matrices = new Float32Array(tries * 16);
    const colors = new Float32Array(tries * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const c = new THREE.Color();
    let count = 0;
    for (let k = 0; k < tries; k++) {
      const x = (ix + rand()) * CELL;
      const z = (iz + rand()) * CELL;
      const keep = rand();
      const size = kind.size[0] + rand() * (kind.size[1] - kind.size[0]);
      const turn = rand() * Math.PI * 2;
      const shade = rand();
      if (Math.abs(x) > w.half - 1 || Math.abs(z) > w.half - 1) continue;
      const y = w.terrainHeight(x, z);
      if (y < WATER_LEVEL + (name === 'pebble' ? -1 : 0.4)) continue;
      const i = this.vegetation.vertex(x, z);
      if (keep > kind.keep(this.weights, i)) continue;
      // Not inside or under anything: props, trees, rocks or roofs.
      if (!w.clear(x, y, z, 3.5, 0.05)) continue;
      if (w.buildings.some((b) => inBuilding(b, x, z, 0.3))) continue;
      pos.set(x, y - (name === 'pebble' ? size * 0.3 : 0.02), z);
      if (name === 'pebble') {
        q.setFromEuler(e.set(rand() * 3, turn, rand() * 3));
        scale.set(size * (0.8 + rand() * 0.6), size * 0.6, size);
      } else {
        q.setFromEuler(e.set((rand() - 0.5) * 0.2, turn, (rand() - 0.5) * 0.2));
        scale.set(size, size * (0.8 + rand() * 0.4), size);
      }
      m.compose(pos, q, scale).toArray(matrices, count * 16);
      if (name === 'grass') {
        const dry = clamp(this.weights[i + Layer.dryGrass] / (this.weights[i + Layer.grass] + this.weights[i + Layer.dryGrass] + 1e-3), 0, 1);
        c.copy(LUSH).lerp(DRY, dry).multiplyScalar(0.85 + shade * 0.3);
      } else c.setScalar(0.35 + shade * 0.25);
      c.toArray(colors, count * 3);
      count++;
    }
    return { matrices, colors, count };
  }
}

/**
 * Shrink instances to nothing over the last stretch of `range` from the eye,
 * and let the wind move their tops by `give`.
 */
function fading(material: THREE.MeshStandardMaterial, range: number, eye: { value: THREE.Vector3 }, give: number): THREE.MeshStandardMaterial {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.windTime = wind;
    shader.uniforms.coverEye = eye;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform vec3 coverEye;\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        {
          vec3 base = instanceMatrix[3].xyz;
          float fade = 1.0 - smoothstep(${(range * 0.7).toFixed(1)}, ${range.toFixed(1)}, distance(base.xz, coverEye.xz));
          transformed *= fade;
          ${give > 0 ? `
          float s = length(instanceMatrix[1].xyz);
          vec3 push = windPush(base, windTime) * position.y * position.y * ${(give * 0.25).toFixed(3)};
          transformed += transpose(mat3(instanceMatrix)) * push / (s * s);` : ''}
        }`);
    // Cards light as the ground they grow from, from either side.
    if (give > 0) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        // Smaller mips average leaves into the gaps round them and fall under
        // the alpha test, hollowing cards out at a distance; make up for it.
        .replace('#include <alphatest_fragment>', /* glsl */ `
          {
            vec2 texel = vMapUv * vec2(textureSize(map, 0));
            float mip = max(0.0, 0.5 * log2(max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));
            diffuseColor.a *= 1.0 + mip * 0.3;
          }
          #include <alphatest_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `${key}-cover-${range}-${give}`;
  return material;
}

/** Three crossed cards of blades, a unit tall, lighting as if they faced up. */
function grassGeometry(): THREE.BufferGeometry {
  const parts: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * 0.45;
    const dz = Math.sin(a) * 0.45;
    const base = parts.length / 3;
    parts.push(-dx, 0, -dz, dx, 0, dz, -dx, 1, -dz, dx, 1, dz);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return cards(parts, uv, index);
}

/** A low dome of leafy cards, a unit tall. */
function bushGeometry(): THREE.BufferGeometry {
  const parts: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const rand = mulberry32(5);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rand();
    const tilt = k < 4 ? 0 : 0.9;
    const w = 0.7;
    const dx = Math.cos(a) * w;
    const dz = Math.sin(a) * w;
    // Upright cards round the middle and a few leaning across the top.
    const ox = Math.sin(a) * tilt * 0.3;
    const oz = -Math.cos(a) * tilt * 0.3;
    const base = parts.length / 3;
    parts.push(-dx + ox, 0, -dz + oz, dx + ox, 0, dz + oz, -dx * 0.8 - ox, 1, -dz * 0.8 - oz, dx * 0.8 - ox, 1, dz * 0.8 - oz);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return cards(parts, uv, index);
}

function cards(pos: number[], uv: number[], index: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Facing up, so they light like the ground they grow from.
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(index);
  return geo;
}

function pebbleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.getAttribute('position');
  const rand = mulberry32(3);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.8 + rand() * 0.4), pos.getY(i), pos.getZ(i) * (0.8 + rand() * 0.4));
  geo.computeVertexNormals();
  return geo;
}

/** Blades of grass on transparent, darker at the roots. */
function bladeTexture(): THREE.Texture {
  const w = 128;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const rand = mulberry32(11);
  for (let k = 0; k < 46; k++) {
    const x = 6 + rand() * (w - 12);
    const top = h * (0.05 + rand() * 0.45);
    const lean = (rand() - 0.5) * 30;
    const width = 2 + rand() * 3;
    const grad = g.createLinearGradient(0, h, 0, top);
    const l = 38 + rand() * 22;
    grad.addColorStop(0, `hsl(78, 35%, ${l * 0.55}%)`);
    grad.addColorStop(1, `hsl(${68 + rand() * 20}, 48%, ${l}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - width, h);
    g.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top);
    g.quadraticCurveTo(x + lean * 0.3 + width * 0.5, (h + top) / 2, x + width, h);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Clusters of small leaves on transparent. */
function leafTexture(): THREE.Texture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const g = canvas.getContext('2d')!;
  const rand = mulberry32(13);
  for (let k = 0; k < 220; k++) {
    // Denser toward the bottom middle, where the bush is full.
    const y = s * (1 - Math.sqrt(rand()) * 0.95);
    const spread = (0.25 + (y / s) * 0.25) * s;
    const x = s / 2 + (rand() - 0.5) * 2 * spread;
    g.fillStyle = `hsl(${80 + rand() * 30}, ${35 + rand() * 20}%, ${24 + rand() * 24}%)`;
    g.beginPath();
    g.ellipse(x, y, 3 + rand() * 4, 1.5 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
