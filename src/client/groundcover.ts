import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import { fbm, mulberry32 } from '../shared/rng.ts';
import { TUFT_STRIDE, type Vegetation, VEG_CELL, vegetationOf } from '../shared/vegetation.ts';
import { inBuilding, type World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { clamp, smoothstep } from '../shared/geom.ts';
import { GROUND_LAYERS, groundWeights } from '../shared/ground.ts';
import { Layer, LAYERS } from '../shared/layers.ts';
import { surfaceMaterial } from './surfaces.ts';
import { wetMaterial } from './rain.ts';
import { groundTint, onTiles } from './terrain.ts';
import { WIND_GLSL, wind } from './wind.ts';

// Grass, low bushes and pebbles on the ground round the camera. Each 8 m cell
// of the island scatters its own the same way every time, thickest where the
// ground is painted grass, and never on props, under roofs or in the sea.
// Only the cells near the camera are drawn, and everything shrinks away
// toward the edge of its range, so nothing pops in. Nothing collides with
// them, but bots can't see through the bushes and grass: both come from
// shared/vegetation.ts, where the server finds them too.

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
  // Placed by Vegetation.
  grass: { range: 42, density: 1.6, keep: () => 0, size: [0, 0] },
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
  /** Grass only: the ground under each tuft, GROUND floats each (see GrassGround). */
  ground?: Float32Array;
}

/**
 * Floats per tuft of the ground it stands on, for its roots to take the
 * ground's colour: the weights of the five ground layers, then the tint over
 * them, as the terrain paints the spot.
 */
const GROUND = 8;

interface Batch {
  mesh: THREE.InstancedMesh;
  kind: Kind;
  capacity: number;
}

const LUSH = new THREE.Color(0x8ea35a);
const DRY = new THREE.Color(0xb3a262);
const LEAF = new THREE.Color(0x6a8a44);
const tint = new THREE.Color();

export class GroundCover {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly vegetation: Vegetation;
  private readonly weights: Float32Array;
  private readonly cells = new Map<string, Record<KindName, Scatter>>();
  private readonly layers: Record<KindName, Batch>;
  private readonly eye = { value: new THREE.Vector3() };
  private readonly blades = bladeTexture();
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
      if (name === 'grass') {
        geo.setAttribute('groundA', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
        geo.setAttribute('groundB', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
      }
      this.group.add(mesh);
      return { mesh, kind, capacity };
    };
    this.layers = {
      grass: make('grass', grassGeometry(), grassMaterial(this.blades, this.eye, null)),
      bush: make('bush', bushGeometry(), wetMaterial(onTiles(fading(new THREE.MeshStandardMaterial({
        map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0.55,
      }), KINDS.bush.range, this.eye, 0.4), world), 0.9, false)),
      pebble: make('pebble', pebbleGeometry(), wetMaterial(fading(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), KINDS.pebble.range, this.eye, 0), 0.4, false)),
    };
  }

  applyAssets(assets: Assets): void {
    const material = surfaceMaterial(assets, { kind: 'fixed', layer: Layer.rock }, { roughness: 0.95, flatShading: true }, 1, { wet: true });
    this.layers.pebble.mesh.material = fading(material, KINDS.pebble.range, this.eye, 0);
    this.layers.grass.mesh.material = grassMaterial(this.blades, this.eye, assets);
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
      const groundA = mesh.geometry.getAttribute('groundA') as THREE.InstancedBufferAttribute | undefined;
      const groundB = mesh.geometry.getAttribute('groundB') as THREE.InstancedBufferAttribute | undefined;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // Only cells that reach within range of the camera's cell.
          if (Math.max(Math.hypot(dx, dz) - 1.5, 0) * CELL > kind.range) continue;
          const s = this.cell(cx + dx, cz + dz)[name];
          const n = Math.min(s.count, capacity - count);
          matrices.set(s.matrices.subarray(0, n * 16), count * 16);
          colors.set(s.colors.subarray(0, n * 3), count * 3);
          if (s.ground && groundA && groundB) {
            const a = groundA.array as Float32Array;
            const b = groundB.array as Float32Array;
            for (let k = 0; k < n; k++) {
              a.set(s.ground.subarray(k * GROUND, k * GROUND + 4), (count + k) * 4);
              b.set(s.ground.subarray(k * GROUND + 4, k * GROUND + 8), (count + k) * 4);
            }
          }
          count += n;
        }
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      if (groundA && groundB) groundA.needsUpdate = groundB.needsUpdate = true;
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
    const tufts = this.vegetation.tufts(ix, iz);
    // Pebbles carry on from the grass's random numbers, as when both were scattered here.
    const rand = mulberry32((ix * 73856093) ^ (iz * 19349663) ^ this.world.seed);
    for (let k = 0; k < tufts.draws; k++) rand();
    c = {
      grass: this.placeGrass(ix, iz),
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

  private placeGrass(ix: number, iz: number): Scatter {
    const { count, data } = this.vegetation.tufts(ix, iz);
    const matrices = new Float32Array(count * 16);
    const colors = new Float32Array(count * 3);
    const ground = new Float32Array(count * GROUND);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const c = new THREE.Color();
    const seed = this.world.seed;
    for (let k = 0; k < count; k++) {
      const o = k * TUFT_STRIDE;
      const x = data[o];
      const z = data[o + 2];
      q.setFromEuler(e.set(data[o + 6], data[o + 5], data[o + 7]));
      m.compose(pos.set(x, data[o + 1], z), q, scale.set(data[o + 3], data[o + 4], data[o + 3])).toArray(matrices, k * 16);
      // Patches across a field, for looks only: some stretches drier, some
      // greener, and a finer mottle of lighter and darker tufts on top.
      const patch = fbm(x / 13, z / 13, seed + 31, 2);
      const mottle = fbm(x / 4, z / 4, seed + 37, 2);
      const dry = clamp(data[o + 9] + smoothstep(0.5, 0.72, patch) * 0.55 - smoothstep(0.42, 0.25, patch) * 0.25, 0, 1);
      c.copy(LUSH).lerp(DRY, dry).multiplyScalar((0.85 + data[o + 8] * 0.3) * (0.82 + mottle * 0.36)).toArray(colors, k * 3);
      this.groundAt(x, z, ground, k * GROUND);
    }
    return { matrices, colors, count, ground };
  }

  /** The ground under (x, z) into `out` at `at`: layer weights as the terrain blends them, then its tint. */
  private groundAt(x: number, z: number, out: Float32Array, at: number): void {
    const w = this.world;
    const n = w.res + 1;
    const gx = clamp((x + w.half) / w.cell, 0, w.res - 1e-4);
    const gz = clamp((z + w.half) / w.cell, 0, w.res - 1e-4);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * n + ix;
    for (let l = 0; l < GROUND_LAYERS; l++) {
      const W = (v: number) => this.weights[v * GROUND_LAYERS + l];
      out[at + l] = (W(i) * (1 - fx) + W(i + 1) * fx) * (1 - fz) + (W(i + n) * (1 - fx) + W(i + n + 1) * fx) * fz;
    }
    groundTint(w, x, z, Math.max(out[at + Layer.sand], out[at + Layer.rock]), tint).toArray(out, at + GROUND_LAYERS);
  }

  private scatter(ix: number, iz: number, name: 'pebble', rand: () => number): Scatter {
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
      if (y < WATER_LEVEL - 1) continue;
      const i = this.vegetation.vertex(x, z);
      if (keep > kind.keep(this.weights, i)) continue;
      // Not inside or under anything: props, trees, rocks or roofs.
      if (!w.clearAsBuilt(x, y, z, 3.5, 0.05)) continue;
      if (w.buildings.some((b) => inBuilding(b, x, z, 0.3))) continue;
      pos.set(x, y - size * 0.3, z);
      q.setFromEuler(e.set(rand() * 3, turn, rand() * 3));
      scale.set(size * (0.8 + rand() * 0.6), size * 0.6, size);
      m.compose(pos, q, scale).toArray(matrices, count * 16);
      c.setScalar(0.35 + shade * 0.25).toArray(colors, count * 3);
      count++;
    }
    return { matrices, colors, count };
  }
}

/**
 * Shrink instances to nothing over the last stretch of `range` from the eye,
 * and let the wind move their tops by `give`. Cards (with `give`) thicken
 * their alpha by `boost` a mip level as they recede.
 */
function fading(material: THREE.MeshStandardMaterial, range: number, eye: { value: THREE.Vector3 }, give: number, boost = 0.3): THREE.MeshStandardMaterial {
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
            diffuseColor.a *= 1.0 + mip * ${boost.toFixed(2)};
          }
          #include <alphatest_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `${key}-cover-${range}-${give}-${boost}`;
  return material;
}

/**
 * Grass blades that grow out of the ground's own colour, let the sun through
 * when it's behind them, and have soft edges where the multisampling allows.
 * With `assets`, each root takes the colour of the ground textures under it,
 * as the terrain blends them; before they arrive, the blades keep their own.
 */
function grassMaterial(blades: THREE.Texture, eye: { value: THREE.Vector3 }, assets: Assets | null): THREE.MeshStandardMaterial {
  const material = fading(new THREE.MeshStandardMaterial({
    map: blades, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0.55,
  // Soft edges keep receding blades from hollowing out, so they need less
  // thickening than hard-edged cards, and keep ragged tops.
  }), KINDS.grass.range, eye, 1, 0.2);
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    if (assets) {
      shader.uniforms.surfAlbedo = { value: assets.albedo };
      shader.uniforms.surfScale = { value: LAYERS.map((l) => l.scale) };
      shader.uniforms.surfTint = { value: LAYERS.map(({ tint: [r, g, b] }) => new THREE.Vector3(r, g, b)) };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        attribute vec4 groundA;
        attribute vec4 groundB;
        varying vec3 vRoot;
        varying float vUp;
        ${assets ? `
        uniform sampler2DArray surfAlbedo;
        uniform float surfScale[${LAYERS.length}];
        uniform vec3 surfTint[${LAYERS.length}];
        vec3 groundLayer(float layer, vec2 xz, float lod) {
          int i = int(layer + 0.5);
          return textureLod(surfAlbedo, vec3(xz / surfScale[i], layer), lod).rgb * surfTint[i];
        }` : ''}`)
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
        vUp = position.y;
        ${assets ? `
        {
          // The ground's colour where this corner of the card stands, from a
          // small mip, so it follows the texture's patches but not its grain.
          vec2 xz = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
          float lod = log2(float(textureSize(surfAlbedo, 0).x)) - 4.0;
          vRoot = (groundA.x * groundLayer(0.0, xz, lod) + groundA.y * groundLayer(1.0, xz, lod)
            + groundA.z * groundLayer(2.0, xz, lod) + groundA.w * groundLayer(3.0, xz, lod)
            + groundB.x * groundLayer(4.0, xz, lod)) * groundB.yzw;
        }` : 'vRoot = vec3(0.0);'}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoot;\nvarying float vUp;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        ${assets ? `
        // Out of the ground: its colour at the root, a little shaded by the
        // blades round it, turning to the blade's own over the lowest third.
        diffuseColor.rgb = mix(vRoot * 0.85, diffuseColor.rgb, smoothstep(0.0, 0.3, vUp));` : ''}`)
      // Thin blades glow with the light behind them, most toward the tips.
      .replaceAll('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );', /* glsl */ `
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
        {
          float behind = pow(saturate(dot(geometryViewDir, -directLight.direction)), 2.0);
          float through = saturate(-dot(geometryNormal, directLight.direction));
          reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3(1.0, 1.0, 0.75)
            * (behind * 1.2 + through * 0.35) * smoothstep(0.05, 0.6, vUp) * RECIPROCAL_PI;
        }`);
  };
  material.customProgramCacheKey = () => `${key}-grass-${assets ? 1 : 0}`;
  return wetMaterial(material, 0.92, false);
}

/**
 * Three crossed cards of blades, a unit tall. Their normals lean out from the
 * middle as well as up, so a tuft shades like a rounded clump, lit on the
 * sun's side, rather than like the flat ground under it.
 */
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
  const geo = cards(parts, uv, index);
  const normals = geo.getAttribute('normal');
  const n = new THREE.Vector3();
  for (let i = 0; i < normals.count; i++) {
    n.set(parts[i * 3], 0, parts[i * 3 + 2]).normalize().multiplyScalar(0.35);
    n.y = 1;
    n.normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
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
  return filled(canvas);
}

/**
 * The canvas as a texture whose see-through pixels carry the leaves' average
 * colour instead of black. A canvas can't keep a colour where it's fully
 * transparent, and smaller mips averaged that black into the leaves, which
 * turned distant bushes a dark, sky-lit blue-grey.
 */
function filled(canvas: HTMLCanvasElement): THREE.Texture {
  const { width: w, height: h } = canvas;
  const src = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] < 128) continue;
    for (let k = 0; k < 3; k++) sum[k] += src[i + k];
    n++;
  }
  const data = new Uint8Array(w * h * 4);
  // Rows bottom to top, as a canvas texture would be flipped.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4;
      const o = (y * w + x) * 4;
      const clear = src[i + 3] === 0;
      for (let k = 0; k < 3; k++) data[o + k] = clear ? Math.round(sum[k] / Math.max(n, 1)) : src[i + k];
      data[o + 3] = src[i + 3];
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
