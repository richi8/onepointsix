import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import { clamp, smoothstep } from '../shared/geom.ts';
import type { World } from '../shared/world.ts';

// The sea: a fine grid round the camera that rolls with waves, inside a ring
// whose vertices spread out with distance, still rolling with the longer
// waves, then flat out to the horizon. They share one material that takes the
// sea's depth from a height map of the island: shallow water is clear and
// pale, deep water dark, waves die down toward the shore and foam laps along
// it. It mirrors the island, the sky, bodies, bags and debris from a small
// picture drawn each frame any sea is in view, from below the surface, and each wave fades out where it's too fine for the
// vertices or pixels to show, so the far sea doesn't shimmer in rings.

/** Metres across the rolling grid and between its vertices. */
const GRID = 240;
const SPACING = 2;
/** Metres out the rolling ring reaches, and how much farther apart its rings of vertices are each time. */
const RING = 1000;
const RING_GROWTH = 1.06;
/** Metres across the whole sea. */
const SEA = 6000;
/** Waves reach full height in water this deep. */
const FULL_DEPTH = 4;
/** The reflection is drawn at this share of the screen's width and height. */
const REFLECTION_SCALE = 1 / 3;
/** Objects drawn in the reflection are in this layer as well as the default one. */
export const REFLECTED = 1;
/** Rays across and up the screen that look for the sea. */
const LOOK_COLUMNS = 16;
const LOOK_ROWS = 9;

/** Wave trains: direction (x, z), wavelength in metres, height in metres, speed in m/s. The first is a long swell. */
const WAVES: [number, number, number, number, number][] = [
  [0.7, 0.72, 48, 0.1, 8.6],
  [0.8, 0.6, 14, 0.09, 4.2],
  [-0.3, 0.95, 9, 0.06, 3.4],
  [0.95, -0.3, 6, 0.035, 2.8],
  [0.2, 0.98, 3.7, 0.02, 2.1],
];

/**
 * WAVES as GLSL: `waves(p, t, amp, size, out slope)` returns the height and
 * fills in the slope. Each train fades out as `size`, the metres between
 * vertices or across a pixel, grows toward its wavelength, where it would
 * only alias.
 */
const WAVES_GLSL = /* glsl */ `
  float waves(vec2 p, float t, float amp, float size, out vec2 slope) {
    float h = 0.0;
    slope = vec2(0.0);
    ${WAVES.map(([dx, dz, len, height, speed]) => {
      const n = Math.hypot(dx, dz);
      const k = (2 * Math.PI) / len;
      return `{
      vec2 d = vec2(${(dx / n).toFixed(4)}, ${(dz / n).toFixed(4)});
      float ph = dot(d, p) * ${k.toFixed(4)} - t * ${(k * speed).toFixed(4)};
      float a = ${height.toFixed(4)} * amp * (1.0 - smoothstep(${(len / 8).toFixed(3)}, ${(len / 3).toFixed(3)}, size));
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
const RAY = new THREE.Vector3();
const UNDER_NEAR = 0;
const UNDER_FAR = 22;

/** The small mirror picture of the island the sea reflects, and what's needed to look it up. */
interface Reflection {
  target: THREE.WebGLRenderTarget;
  camera: THREE.PerspectiveCamera;
  /** From the world to the picture's texture coordinates. */
  matrix: { value: THREE.Matrix4 };
  /** 1 while the picture is up to date, 0 while the sea should fall back to the sky's. */
  on: { value: number };
}

export class Water {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly grid: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly flat: THREE.Mesh;
  private readonly time = { value: 0 };
  private readonly gridCentre = { value: new THREE.Vector2() };
  private readonly reflection: Reflection;
  /** Fog and background as they are above water, to restore on surfacing. */
  private saved: { color: THREE.Color; near: number; far: number; background: THREE.Scene['background'] } | null = null;

  constructor(world: World) {
    this.world = world;
    this.reflection = {
      target: reflectionTarget(),
      camera: new THREE.PerspectiveCamera(),
      matrix: { value: new THREE.Matrix4() },
      on: { value: 0 },
    };
    this.reflection.camera.layers.set(REFLECTED);
    const material = seaMaterial(world, this.time, this.gridCentre, this.reflection);
    const cells = GRID / SPACING;
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID, cells, cells).rotateX(-Math.PI / 2), material);
    this.ring = new THREE.Mesh(spreadRing(GRID / 2, RING, cells), material);
    this.flat = new THREE.Mesh(ring(RING, SEA / 2), material);
    for (const mesh of [this.grid, this.ring, this.flat]) {
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.position.y = WATER_LEVEL;
      this.group.add(mesh);
    }
  }

  /** Whether the camera is under the surface. */
  get under(): boolean {
    return this.saved !== null;
  }

  /** Whether the last frame drew the reflection. */
  get reflecting(): boolean {
    return this.reflection.on.value > 0;
  }

  /** Free the reflection's picture. */
  dispose(): void {
    this.reflection.target.dispose();
  }

  /**
   * Draw the picture the sea reflects: what's in the REFLECTED layer, seen
   * from `camera` mirrored in the surface, at a fraction of the screen's
   * resolution. Shadows and matrices are reused from the last frame. If
   * `force`, even with no sea in view.
   */
  reflect(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, force = false): void {
    const r = this.reflection;
    if (this.under || camera.position.y < WATER_LEVEL || (!force && !this.seaInView(camera, (scene.fog as THREE.Fog | null)?.far ?? camera.far))) {
      r.on.value = 0;
      return;
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(REFLECTION_SCALE).floor();
    if (r.target.width !== size.x || r.target.height !== size.y) r.target.setSize(Math.max(size.x, 1), Math.max(size.y, 1));
    // The lights light the reflection too.
    for (const o of scene.children) if ((o as THREE.Light).isLight) o.layers.enable(REFLECTED);

    const cam = r.camera;
    mirror(camera, cam);
    r.matrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    clipBelow(cam, WATER_LEVEL - 0.3);

    const was = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    const autoMatrix = scene.matrixWorldAutoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.matrixWorldAutoUpdate = false;
    renderer.setRenderTarget(r.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(was);
    renderer.shadowMap.autoUpdate = shadows;
    scene.matrixWorldAutoUpdate = autoMatrix;
    r.on.value = 1;
  }

  /**
   * Whether any open sea is in view within `far` metres: rays through a grid
   * across the screen, each marched over the terrain to where it meets the
   * surface, looking for one that isn't hidden by a hill first and comes down
   * on water rather than dry ground. Buildings and trees aren't counted, so it
   * errs toward drawing the reflection.
   */
  seaInView(camera: THREE.Camera, far: number): boolean {
    const eye = camera.position;
    const w = this.world;
    for (let i = 0; i < LOOK_COLUMNS; i++) {
      for (let j = 0; j < LOOK_ROWS; j++) {
        const ray = RAY.set((i / (LOOK_COLUMNS - 1)) * 2 - 1, (j / (LOOK_ROWS - 1)) * 2 - 1, 0.5).unproject(camera).sub(eye).normalize();
        if (ray.y > -1e-4) continue;
        const toSea = (WATER_LEVEL - eye.y) / ray.y;
        if (toSea > far) continue;
        let hidden = false;
        for (let t = Math.min(1, toSea); t < toSea && !hidden; t += Math.max(1, t * 0.04)) {
          hidden = w.terrainHeight(eye.x + ray.x * t, eye.z + ray.z * t) > eye.y + ray.y * t;
        }
        if (!hidden && w.terrainHeight(eye.x + ray.x * toSea, eye.z + ray.z * toSea) < WATER_LEVEL) return true;
      }
    }
    return false;
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
    this.flat.position.set(cx, WATER_LEVEL, cz);

    const under = p.y < this.surface(p.x, p.z) - 0.02;
    const fog = scene.fog as THREE.Fog;
    if (under && !this.saved) {
      this.saved = { color: fog.color.clone(), near: fog.near, far: fog.far, background: scene.background };
      this.submerge(scene);
      sky.visible = false;
    } else if (!under && this.saved) {
      fog.color.copy(this.saved.color);
      fog.near = this.saved.near;
      fog.far = this.saved.far;
      scene.background = this.saved.background;
      sky.visible = true;
      this.saved = null;
    }
  }

  /**
   * The island was lit anew (its textures arrived, or the time or weather
   * changed): if the camera is under water, keep the new fog for surfacing and
   * the underwater fog for now.
   */
  relit(scene: THREE.Scene): void {
    if (!this.saved) return;
    const fog = scene.fog as THREE.Fog;
    this.saved = { color: fog.color.clone(), near: fog.near, far: fog.far, background: scene.background };
    this.submerge(scene);
  }

  private submerge(scene: THREE.Scene): void {
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(UNDER_FOG);
    fog.near = UNDER_NEAR;
    fog.far = UNDER_FAR;
    scene.background = UNDER_FOG;
  }
}

/**
 * Sway and stretch `camera`'s view a little, as seen through moving water, at
 * `time` seconds. Undone by the camera's next updateProjectionMatrix.
 */
export function wobble(camera: THREE.PerspectiveCamera, time: number): void {
  const m = camera.projectionMatrix.elements;
  m[0] *= 1 + 0.025 * Math.sin(time * 1.7);
  m[5] *= 1 + 0.025 * Math.sin(time * 1.3 + 1.1);
  // A slow shear, as if the view leaned in the current.
  m[4] += 0.02 * Math.sin(time * 0.9 + 0.4);
  m[1] += 0.015 * Math.sin(time * 1.1 + 2.3);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/**
 * The picture the reflection is drawn into. three.js draws into a picture
 * with shaders of their own, in linear colour and not tone mapped, which
 * would compile every material a second time: seconds on a cold shader
 * cache. Told it's a picture for XR, it uses the screen's, tone mapped and
 * in sRGB; the sea undoes both as it reads it (seaUnmap).
 */
function reflectionTarget(): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, colorSpace: THREE.SRGBColorSpace });
  (target as { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
  return target;
}

/**
 * GLSL undoing what the screen's shaders do to a colour at the end: sRGB
 * encoding, then three.js's Neutral tone mapping and exposure, which the
 * renderer uses (see main.ts). Colours never tone mapped, like the sky's,
 * come out a little brighter, as if they had been.
 */
const UNMAP_GLSL = /* glsl */ `
  vec3 seaUnmap(vec3 c) {
    c = sRGBTransferEOTF(vec4(max(c, 0.0), 1.0)).rgb;
    // The compression above 0.76 and the desaturation toward the peak with it.
    const float start = 0.8 - 0.04;
    const float d = 1.0 - start;
    float newPeak = min(max(c.r, max(c.g, c.b)), 0.999);
    if (newPeak >= start) {
      float peak = d * d / (1.0 - newPeak) - d + start;
      float g = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
      c = (min(c, vec3(newPeak)) - g * newPeak) / (1.0 - g) * (peak / newPeak);
    }
    // The toe: the darkest channel was lowered by an offset that depends on it.
    float low = min(c.r, min(c.g, c.b));
    float x = low < 0.04 ? sqrt(max(low, 0.0) / 6.25) : low + 0.04;
    return (c + (x - low)) / toneMappingExposure;
  }
`;

/** Set `out` to `camera` mirrored in the sea's surface, looking up at what it sees reflected. */
function mirror(camera: THREE.PerspectiveCamera, out: THREE.PerspectiveCamera): void {
  const e = camera.matrixWorld.elements;
  const pos = new THREE.Vector3(e[12], 2 * WATER_LEVEL - e[13], e[14]);
  // Forward is -z, up is +y; both mirrored in the surface.
  const forward = new THREE.Vector3(-e[8], e[9], -e[10]);
  out.position.copy(pos);
  out.up.set(e[4], -e[5], e[6]);
  out.lookAt(pos.add(forward));
  out.updateMatrixWorld();
  out.projectionMatrix.copy(camera.projectionMatrix);
  out.far = camera.far;
}

/**
 * Bend `camera`'s near plane onto the horizontal plane at `height`, so
 * nothing below it is drawn; Lengyel's oblique frustum, as three.js's
 * Reflector does it.
 */
function clipBelow(camera: THREE.PerspectiveCamera, height: number): void {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height).applyMatrix4(camera.matrixWorldInverse);
  const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const m = camera.projectionMatrix.elements;
  const q = new THREE.Vector4(
    (Math.sign(clip.x) + m[8]) / m[0],
    (Math.sign(clip.y) + m[9]) / m[5],
    -1,
    (1 + m[10]) / m[14],
  );
  clip.multiplyScalar(2 / clip.dot(q));
  m[2] = clip.x;
  m[6] = clip.y;
  m[10] = clip.z + 1;
  m[14] = clip.w;
}

/**
 * Square rings of vertices from `inner` to `outer` metres out, facing up,
 * `cells` to a side at every ring. Each ring is RING_GROWTH times farther out
 * than the last, so the vertices spread with distance and the inner edge
 * matches the rolling grid's.
 */
function spreadRing(inner: number, outer: number, cells: number): THREE.BufferGeometry {
  const radii = [inner];
  while (radii[radii.length - 1] < outer) radii.push(Math.min(radii[radii.length - 1] * RING_GROWTH, outer));
  const around = cells * 4;
  const pos: number[] = [];
  for (const r of radii) {
    // Round the square counter-clockwise seen from above, from its -x, -z corner.
    for (let k = 0; k < around; k++) {
      const side = Math.floor(k / cells);
      const f = ((k % cells) / cells) * 2 - 1;
      const [x, z] = [[f, -1], [1, f], [-f, 1], [-1, -f]][side];
      pos.push(x * r, 0, z * r);
    }
  }
  const index: number[] = [];
  for (let i = 0; i + 1 < radii.length; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * around + k;
      const b = i * around + ((k + 1) % around);
      const c = a + around;
      const d = b + around;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(index);
  return geo;
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

function seaMaterial(world: World, time: { value: number }, centre: { value: THREE.Vector2 }, reflection: Reflection): THREE.MeshStandardMaterial {
  // The sky's picture only lights the water a little; the reflection does the rest.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.1, metalness: 0, envMapIntensity: 0.15, transparent: true, side: THREE.DoubleSide,
  });
  const n = world.res + 1;
  const uniforms = {
    seaTime: time,
    seaCentre: centre,
    seaHeights: { value: heightMap(world) },
    // Maps world x, z to the height map's texel centres.
    seaMap: { value: new THREE.Vector4(1 / world.size * ((n - 1) / n), world.half, 0.5 / n, 0) },
    seaReflection: { value: reflection.target.texture },
    seaReflectionMatrix: reflection.matrix,
    seaReflecting: reflection.on,
  };
  const common = /* glsl */ `
    uniform float seaTime;
    uniform vec2 seaCentre;
    uniform sampler2D seaHeights;
    uniform vec4 seaMap;
    uniform sampler2D seaReflection;
    uniform mat4 seaReflectionMatrix;
    uniform float seaReflecting;
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
          // Metres between vertices here: the grid's spacing, then the ring's rows, which spread with distance;
          // the flat sea past the ring settles as the ring's last waves fade.
          float edge = max(abs(p.x - seaCentre.x), abs(p.y - seaCentre.y));
          float size = edge < ${(GRID / 2).toFixed(1)} ? ${SPACING.toFixed(1)} : edge * ${(RING_GROWTH - 1).toFixed(3)};
          float roll = 1.0 - smoothstep(${(RING * 0.7).toFixed(1)}, ${(RING - 1).toFixed(1)}, edge);
          vec2 slope;
          // Waves a little finer than the vertices still show; a vertex every
          // quarter wavelength or so is enough to roll.
          transformed.y += waves(p, seaTime, smoothstep(0.0, ${FULL_DEPTH.toFixed(1)}, seaDepth(p)) * roll, size * 0.5, slope);
        }`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${common}\n${UNMAP_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */ `
        float depth = seaDepth(vSeaPos.xz);
        float far = length(vSeaPos - cameraPosition);
        vec2 slope;
        // Each wave only while a pixel is small beside it.
        vec2 pixel = fwidth(vSeaPos.xz);
        waves(vSeaPos.xz, seaTime, smoothstep(0.0, ${FULL_DEPTH.toFixed(1)}, depth), max(pixel.x, pixel.y), slope);
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
        normal *= gl_FrontFacing ? 1.0 : -1.0;`)
      // The island and sky mirrored in it, more at a glancing angle, rippled
      // by the waves; foam and the underside reflect nothing.
      .replace('#include <opaque_fragment>', /* glsl */ `
        if (seaReflecting > 0.5 && gl_FrontFacing) {
          vec3 toEye = normalize(cameraPosition - vSeaPos);
          float facing = max(dot(toEye, seaNormal), 0.0);
          // Schlick's Fresnel, held back at grazing angles, where real waves
          // turn some of their faces up to the sky well above the horizon;
          // there the mirror is read further up the sky, which is bluer.
          float grazing = pow(1.0 - facing, 4.0);
          float fresnel = min(0.02 + 0.98 * pow(1.0 - facing, 5.0), 0.6);
          vec4 at = seaReflectionMatrix * vec4(vSeaPos.x, ${WATER_LEVEL.toFixed(2)}, vSeaPos.z, 1.0);
          vec2 uv = at.xy / at.w + seaNormal.xz * vec2(0.06, 0.1) - vec2(0.0, 0.012 * grazing);
          vec3 mirrored = seaUnmap(texture2D(seaReflection, uv).rgb);
          float k = fresnel * (1.0 - foam);
          outgoingLight = mix(outgoingLight, mirrored, k);
          diffuseColor.a = mix(diffuseColor.a, 1.0, k);
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'sea';
  return material;
}
