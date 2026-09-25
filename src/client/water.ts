import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import { clamp, smoothstep } from '../shared/geom.ts';
import type { World } from '../shared/world.ts';

// The sea: a fine grid round the camera that rolls with waves, inside a flat
// ring out to the horizon. Both share one material that takes the sea's depth
// from a height map of the island: shallow water is clear and pale, deep
// water dark, waves die down toward the shore and foam laps along it. The
// sky reflects off it through the scene's environment map.

/** Metres across the rolling grid and between its vertices. */
const GRID = 240;
const SPACING = 2;
/** Metres across the whole sea. */
const SEA = 6000;
/** Waves reach full height in water this deep. */
const FULL_DEPTH = 4;

/** Wave trains: direction (x, z), wavelength in metres, height in metres, speed in m/s. */
const WAVES: [number, number, number, number, number][] = [
  [0.8, 0.6, 14, 0.09, 4.2],
  [-0.3, 0.95, 9, 0.06, 3.4],
  [0.95, -0.3, 6, 0.035, 2.8],
  [0.2, 0.98, 3.7, 0.02, 2.1],
];

/** WAVES as GLSL: `waves(p, t, amp, out slope)` returns the height and fills in the slope. */
const WAVES_GLSL = /* glsl */ `
  float waves(vec2 p, float t, float amp, float detail, out vec2 slope) {
    float h = 0.0;
    slope = vec2(0.0);
    ${WAVES.map(([dx, dz, len, height, speed], i) => {
      const n = Math.hypot(dx, dz);
      const k = (2 * Math.PI) / len;
      // The shortest waves fade out with distance, where they'd only shimmer.
      const fade = i >= 2 ? ' * detail' : '';
      return `{
      vec2 d = vec2(${(dx / n).toFixed(4)}, ${(dz / n).toFixed(4)});
      float ph = dot(d, p) * ${k.toFixed(4)} - t * ${(k * speed).toFixed(4)};
      float a = ${height.toFixed(4)} * amp${fade};
      h += a * sin(ph);
      slope += d * (a * ${k.toFixed(4)} * cos(ph));
    }`;
    }).join('\n    ')}
    return h;
  }
`;

/** How high the sea stands at (x, z) at time t, in water `depth` deep, as the shader has it. */
export function waveHeight(x: number, z: number, t: number, depth: number): number {
  const amp = smoothstep(0, FULL_DEPTH, depth);
  let h = 0;
  for (const [dx, dz, len, height, speed] of WAVES) {
    const n = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / len;
    h += height * amp * Math.sin(((dx / n) * x + (dz / n) * z) * k - t * k * speed);
  }
  return WATER_LEVEL + h;
}

const UNDER_FOG = new THREE.Color(0x1d4450);
const UNDER_NEAR = 0;
const UNDER_FAR = 22;

export class Water {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly grid: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly time = { value: 0 };
  private readonly gridCentre = { value: new THREE.Vector2() };
  /** Fog and background as they are above water, to restore on surfacing. */
  private saved: { color: THREE.Color; near: number; far: number } | null = null;

  constructor(world: World) {
    this.world = world;
    const material = seaMaterial(world, this.time, this.gridCentre);
    const cells = GRID / SPACING;
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID, cells, cells).rotateX(-Math.PI / 2), material);
    this.ring = new THREE.Mesh(ring(GRID / 2, SEA / 2), material);
    for (const mesh of [this.grid, this.ring]) {
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.position.y = WATER_LEVEL;
      this.group.add(mesh);
    }
  }

  /** Where the sea stands over (x, z) right now. */
  surface(x: number, z: number): number {
    return waveHeight(x, z, this.time.value, WATER_LEVEL - this.world.terrainHeight(x, z));
  }

  /**
   * Follow the camera, roll the waves on by `time`, and fog the view in green
   * while the camera is under the surface.
   */
  update(camera: THREE.Camera, time: number, scene: THREE.Scene, sky: THREE.Object3D): void {
    this.time.value = time;
    const p = camera.position;
    const cx = Math.round(p.x / SPACING) * SPACING;
    const cz = Math.round(p.z / SPACING) * SPACING;
    this.gridCentre.value.set(cx, cz);
    this.grid.position.set(cx, WATER_LEVEL, cz);
    this.ring.position.set(cx, WATER_LEVEL, cz);

    const under = p.y < this.surface(p.x, p.z) - 0.02;
    const fog = scene.fog as THREE.Fog;
    if (under && !this.saved) {
      this.saved = { color: fog.color.clone(), near: fog.near, far: fog.far };
      fog.color.copy(UNDER_FOG);
      fog.near = UNDER_NEAR;
      fog.far = UNDER_FAR;
      scene.background = UNDER_FOG;
      sky.visible = false;
    } else if (!under && this.saved) {
      fog.color.copy(this.saved.color);
      fog.near = this.saved.near;
      fog.far = this.saved.far;
      scene.background = this.saved.color;
      sky.visible = true;
      this.saved = null;
    }
  }
}

/** A flat square ring from `inner` to `outer` metres out, facing up. */
function ring(inner: number, outer: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [x, z] of corners) pos.push(x * inner, 0, z * inner);
  for (const [x, z] of corners) pos.push(x * outer, 0, z * outer);
  const index: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // Inner i, inner j, outer i, outer j; wound to face up.
    index.push(i, 4 + i, j, j, 4 + i, 4 + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(24).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(index);
  return geo;
}

/** The island's heights as a half-float texture, for the sea's depth. */
function heightMap(world: World): THREE.DataTexture {
  const n = world.res + 1;
  const data = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = THREE.DataUtils.toHalfFloat(clamp(world.heights[i], -60, 200));
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function seaMaterial(world: World, time: { value: number }, centre: { value: THREE.Vector2 }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.1, metalness: 0, envMapIntensity: 0.5, transparent: true, side: THREE.DoubleSide,
  });
  const n = world.res + 1;
  const uniforms = {
    seaTime: time,
    seaCentre: centre,
    seaHeights: { value: heightMap(world) },
    // Maps world x, z to the height map's texel centres.
    seaMap: { value: new THREE.Vector4(1 / world.size * ((n - 1) / n), world.half, 0.5 / n, 0) },
  };
  const common = /* glsl */ `
    uniform float seaTime;
    uniform vec2 seaCentre;
    uniform sampler2D seaHeights;
    uniform vec4 seaMap;
    varying vec3 vSeaPos;
    float seaDepth(vec2 p) {
      vec2 uv = (p + seaMap.y) * seaMap.x + seaMap.z;
      return ${WATER_LEVEL.toFixed(2)} - texture(seaHeights, uv).r;
    }
    ${WAVES_GLSL}
  `;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${common}`)
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        {
          vec2 p = (modelMatrix * vec4(transformed, 1.0)).xz;
          // Only the rolling grid moves; it settles flat at its edge to meet the ring.
          float edge = max(abs(p.x - seaCentre.x), abs(p.y - seaCentre.y));
          float roll = 1.0 - smoothstep(${(GRID * 0.3).toFixed(1)}, ${(GRID * 0.5 - SPACING).toFixed(1)}, edge);
          vec2 slope;
          transformed.y += waves(p, seaTime, smoothstep(0.0, ${FULL_DEPTH.toFixed(1)}, seaDepth(p)) * roll, 1.0, slope);
        }`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${common}`)
      .replace('#include <map_fragment>', /* glsl */ `
        float depth = seaDepth(vSeaPos.xz);
        float far = length(vSeaPos - cameraPosition);
        vec2 slope;
        waves(vSeaPos.xz, seaTime, smoothstep(0.0, ${FULL_DEPTH.toFixed(1)}, depth), 1.0 - smoothstep(60.0, 220.0, far), slope);
        // Ripples too fine for the grid, fading out with distance.
        float fine = 1.0 - smoothstep(20.0, 90.0, far);
        vec2 rp = vSeaPos.xz;
        slope += fine * 0.03 * vec2(
          sin(rp.x * 2.3 + seaTime * 1.9 + sin(rp.y * 1.7)) + sin(rp.y * 3.1 - seaTime * 2.3),
          cos(rp.y * 2.1 - seaTime * 1.6 + sin(rp.x * 1.3)) + cos(rp.x * 2.9 + seaTime * 2.1));
        vec3 seaNormal = normalize(vec3(-slope.x, 1.0, -slope.y));

        // Clear and pale over sand, dark out at sea.
        float deep = smoothstep(0.0, 12.0, depth);
        vec3 water = mix(vec3(0.07, 0.17, 0.16), vec3(0.012, 0.04, 0.055), deep);
        // Foam laps in bands along the shore, moving in and out.
        float shore = 1.0 - smoothstep(0.0, 0.9, depth);
        float bands = sin(depth * 9.0 - seaTime * 1.3 + sin(rp.x * 0.35 + rp.y * 0.21) * 2.0) * 0.5 + 0.5;
        float speck = sin(rp.x * 5.3 + sin(rp.y * 4.1)) * sin(rp.y * 6.7 + seaTime) * 0.5 + 0.5;
        float foam = shore * smoothstep(0.45, 0.8, bands * 0.7 + speck * 0.45) + 1.0 - smoothstep(0.0, 0.08, depth);
        foam = clamp(foam, 0.0, 1.0) * step(-0.3, depth);
        diffuseColor.rgb = mix(water, vec3(0.8, 0.82, 0.8), foam);
        diffuseColor.a = mix(mix(0.65, 0.94, smoothstep(0.0, 3.0, depth)), 0.95, foam);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, foam);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        normal = normalize((viewMatrix * vec4(seaNormal, 0.0)).xyz);
        // Seen from below, the surface faces down.
        normal *= gl_FrontFacing ? 1.0 : -1.0;`);
  };
  material.customProgramCacheKey = () => 'sea';
  return material;
}
