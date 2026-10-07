import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import { boxTop, type Box, type World } from '../shared/world.ts';
import { ISLAND_GLSL, islandUniforms, shelters } from './islandmap.ts';

// Rain: streaks falling through a box that follows the camera, as many as it's
// raining hard, splashes where they land, wet ground, trees, grass and
// bodies, puddles where water gathers, rippling, and now and then lightning,
// far off ahead of the rain. Every drop has a fixed place
// in the world that wraps round the box, so turning or walking doesn't drag
// the rain along; the vertex shader does all the moving, so the streaks cost
// one draw call and no work on the CPU. A sharp map of the roofs round the
// camera, and the island's coarser one farther off, keep the rain, its
// splashes and the wet off whatever is under one.

const DROPS = 9000;
/** Metres across and high of the box of rain round the camera. */
const BOX = 50;
const HEIGHT = 26;
/** How the drops fall, in m/s: slanted a little by the wind. */
const FALL = new THREE.Vector3(1.6, -10, 0.9);
/** Seconds of fall each streak shows, which sets its length. */
const STREAK = 0.06;
/** How wide a streak is, metres. */
const STREAK_WIDTH = 0.012;

/** Cells along each side of the roof map, and how wide each is, metres. */
export const ROOF_CELLS = 128;
export const ROOF_CELL = 0.5;
/** Metres the camera may move from the roof map's middle before it's made again round it. */
const ROOF_SLACK = 8;
/** Height in the roof map where nothing is overhead. */
export const OPEN_SKY = -1e4;

/** Splashes alive at once, how long each lasts and how far from the camera they land. */
const SPLASHES = 700;
const SPLASH_LIFE = 0.22;
const SPLASH_RANGE = 22;

/** Seconds between lightning strikes in a full storm, at least and at most. */
const STRIKE_GAP: [number, number] = [18, 55];
/** Metres off a strike lands, nearest and farthest; with no rain falling yet, no nearer than STRIKE_DRY. */
const STRIKE_NEAR = 700;
const STRIKE_FAR = 4500;
const STRIKE_DRY = 3200;

/**
 * Uniforms shared by the rain and every material that gets wet: the roof
 * map round the camera, its corner in the world (x, z) and one over its
 * width; how wet things are, 0 dry to 1 soaked; how full the puddles are,
 * 0 to 1; how hard it's raining, 0 to 1, and the seconds that ripple the
 * puddles. Past the roof map, the island's coarser one (islandmap.ts).
 */
export const rainUniforms = {
  roofMap: { value: roofTexture(new Float32Array(ROOF_CELLS * ROOF_CELLS).fill(OPEN_SKY)) },
  roofCorner: { value: new THREE.Vector3(0, 0, 1 / (ROOF_CELLS * ROOF_CELL)) },
  wetness: { value: 0 },
  puddles: { value: 0 },
  rainfall: { value: 0 },
  rainTime: { value: 0 },
  ...islandUniforms,
};

/** GLSL: `underRoof(p)` is 1 where a roof covers world point `p`, else 0. */
export const ROOF_GLSL = /* glsl */ `
  uniform sampler2D roofMap;
  uniform vec3 roofCorner;
  ${ISLAND_GLSL}
  float underRoof(vec3 p) {
    vec2 uv = (p.xz - roofCorner.xy) * roofCorner.z;
    // Round the camera the sharp map, farther off the island's.
    float top = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))) ? islandRoof(p) : texture(roofMap, uv).r;
    return p.y < top - 0.05 ? 1.0 : 0.0;
  }
`;

/** GLSL: `underRoof` for what never stands under a roof, such as trees and grass. */
const OPEN_GLSL = 'float underRoof(vec3 p) { return 0.0; }';

/**
 * GLSL for a surface's fragment shader, after its colour and roughness are
 * known: wet ground is darker and shinier, walls less so, and flat ground
 * gathers puddles where water would, in the hollows, which mirror the sky
 * and ripple in the rain. Puddles fill from the deepest hollows outward and
 * shrink back into them as they drain. Needs `underRoof` and, for puddles,
 * `ISLAND_GLSL`.
 */
export const WET_GLSL = /* glsl */ `
  uniform float wetness;
  uniform float puddles;
  uniform float rainfall;
  uniform float rainTime;
  float wetHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float wetNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), f.x), mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // How wet a point facing n is, how much of a puddle it holds, and how glossy
  // its film of water is, into wet.x, wet.y and wet.z; gather is how much
  // water the ground there gathers, 0 to 1.
  vec3 wetAt(vec3 p, vec3 n, float gather) {
    if (wetness <= 0.0 && puddles <= 0.0) return vec3(0.0);
    float open = 1.0 - underRoof(p);
    float w = wetness * open * mix(0.45, 1.0, clamp(n.y, 0.0, 1.0));
    float patches = wetNoise(p.xz * 0.35) * 0.65 + wetNoise(p.xz * 1.3) * 0.35;
    // Water lies in the hollows, its edge ragged, reaching farther out of them
    // the fuller they are, and the last of it shrinks into the deepest.
    float pool = gather * 1.3 + (patches - 0.5) * 0.6;
    float edge = mix(0.95, 0.5, sqrt(puddles)) + max(0.7 - puddles * 4.2, 0.0);
    float puddle = open * smoothstep(0.985, 0.996, n.y) * smoothstep(edge + 0.045, edge + 0.075, pool);
    // A film of water comes and goes in patches, thicker toward the hollows.
    float film = w * smoothstep(0.45, 0.7, patches + gather * 0.4) * smoothstep(0.95, 0.99, n.y);
    return vec3(w, puddle, film);
  }
  // The slope of a puddle's surface at p, rippled by drops landing in it:
  // a ring spreading from a random spot in each half-metre cell, each on its own beat.
  vec2 rippleAt(vec2 p) {
    vec2 slope = vec2(0.0);
    vec2 base = floor(p * 2.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = base + vec2(float(i), float(j));
        float h = wetHash(cell);
        vec2 c = (cell + vec2(h, wetHash(cell + 17.3))) * 0.5;
        float t = fract(rainTime * 1.1 + h * 7.0);
        vec2 to = p - c;
        float d = length(to);
        float x = (d - t * 0.3) * 60.0;
        float ring = exp(-x * x * 0.08) * (1.0 - t) * (1.0 - t);
        slope += to / max(d, 1e-3) * cos(x) * ring * 0.3 * rainfall;
      }
    }
    return slope;
  }
`;

/**
 * Patch a surface shader to get wet in the rain. `pos` and `normal` name its
 * world position and normal; `gather`, GLSL for how much water gathers on it,
 * 0 to 1, lets flat parts of it hold puddles.
 */
export function addWet(shader: THREE.WebGLProgramParametersWithUniforms, pos: string, normal: string, gather: string | null): void {
  Object.assign(shader.uniforms, rainUniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${ROOF_GLSL}\n${WET_GLSL}`)
    .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
      vec3 wet = wetAt(${pos}, ${normal}, ${gather ?? '0.0'});
      ${gather ? '' : 'wet.y = 0.0;'}
      // Soaking deepens a colour as well as darkening it. The ground under a
      // puddle stays soaked after the rest has dried round it.
      float soaked = max(wet.x, wet.y);
      diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.0 + 0.5 * soaked)) * (1.0 - 0.15 * soaked - 0.35 * wet.y);
      // Soaked soil and grass stay mostly matte; only a thin film on the flat
      // catches the sky. A puddle's rim stays dull rather than half glossy,
      // which would show a bright sky as a pale haze.
      roughnessFactor = mix(mix(mix(roughnessFactor, 0.9, soaked), 0.78, wet.z), 0.03, smoothstep(0.9, 1.0, wet.y));`)
    // A puddle lies flat, whatever the ground's bumps, but for its ripples.
    .replace('#include <lights_fragment_begin>', /* glsl */ `
      if (wet.y > 0.0) {
        vec2 ripple = rainfall > 0.0 ? rippleAt(${pos}.xz) : vec2(0.0);
        normal = normalize(mix(normal, (viewMatrix * vec4(normalize(vec3(-ripple.x, 1.0, -ripple.y)), 0.0)).xyz, wet.y));
      }
      #include <lights_fragment_begin>`);
}

export interface WetOptions {
  /** The roughness a soaked surface goes toward. */
  gloss?: number;
  /** For what can stand under a roof, which then keeps it dry, but for as soaked as `soak` says. */
  sheltered?: boolean;
  /**
   * How soaked it still is under a roof, 0 to 1: a uniform (see Soak), or
   * 'instanced' for each instance's in the instanced attribute `soakAt`.
   */
  soak?: { value: number } | 'instanced';
  /** How much of the sky's reflection a soaked surface keeps, which turns grass and leaves grey. */
  sky?: number;
  /**
   * How much of the direct light's gloss a soaked surface gets back, where
   * the material had taken it away, as needles do against edge-on glare.
   */
  glint?: number;
  /**
   * For what's in your hands, drawn in a view of its own: the world's up in
   * that view's space. Where it is doesn't count, only how soaked `soak` says.
   */
  held?: { value: THREE.Vector3 };
}

/**
 * Make a material get wet in the rain, darker and a little glossier, keeping
 * whatever it already does as it compiles: for trees, grass, bodies, bags and
 * debris. Its world position is worked out from the view, and how much it
 * faces up from its normal.
 */
export function wetMaterial<M extends THREE.MeshStandardMaterial>(material: M, options: WetOptions = {}): M {
  const { gloss = 0.45, sheltered = true, soak, sky = 1, glint = 0, held } = options;
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, rainUniforms);
    if (soak && soak !== 'instanced') shader.uniforms.wetSoak = soak;
    if (held) shader.uniforms.wetUp = held;
    const anchors = ['#include <common>', '#include <clearcoat_normal_fragment_begin>', '#include <lights_fragment_end>', '#include <aomap_fragment>'];
    for (const anchor of anchors) {
      if (!shader.fragmentShader.includes(anchor)) throw new Error(`Shader anchor ${anchor} is missing`);
    }
    if (soak === 'instanced') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float soakAt;\nvarying float vWetSoak;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetSoak = soakAt;');
    }
    const soakDecl = (soak === 'instanced' ? 'varying float vWetSoak;\n#define wetSoak vWetSoak' : soak ? 'uniform float wetSoak;' : '')
      + (held ? '\nuniform vec3 wetUp;' : '');
    const soaking = held
      ? 'soaked = wetness * wetSoak * mix(0.45, 1.0, clamp(dot(normal, wetUp), 0.0, 1.0));'
      : /* glsl */ `
          mat3 wetToWorld = transpose(mat3(viewMatrix));
          vec3 wetP = wetToWorld * (-vViewPosition - viewMatrix[3].xyz);
          vec3 wetN = wetToWorld * normal;
          soaked = wetAt(wetP, wetN, 0.0).x;
          ${soak ? '// Still wet from the rain under a roof, drying.\nsoaked = max(soaked, wetness * wetSoak * mix(0.45, 1.0, clamp(wetN.y, 0.0, 1.0)));' : ''}`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${sheltered && !held ? ROOF_GLSL : OPEN_GLSL}\n${WET_GLSL}\n${soakDecl}`)
      // Once the normal is known, whatever has replaced three.js's normal
      // chunks; the colour and roughness are only used with the lights after.
      .replace('#include <clearcoat_normal_fragment_begin>', /* glsl */ `
        float soaked = 0.0;
        if (wetness > 0.0) {
          ${soaking}
          diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.0 + 0.4 * soaked)) * (1.0 - 0.12 * soaked);
          roughnessFactor = mix(roughnessFactor, min(roughnessFactor, ${gloss.toFixed(2)}), soaked);
        }
        #include <clearcoat_normal_fragment_begin>`)
      // Before anything the material adds after the lights, which may take the gloss away; given back after.
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        ${glint > 0 ? 'vec3 wetGlint = reflectedLight.directSpecular;' : ''}
        ${sky < 1 ? `reflectedLight.indirectSpecular *= mix(1.0, ${sky.toFixed(2)}, soaked);` : ''}`)
      .replace('#include <aomap_fragment>', /* glsl */ `
        ${glint > 0 ? `reflectedLight.directSpecular = max(reflectedLight.directSpecular, wetGlint * ${glint.toFixed(2)} * soaked);` : ''}
        #include <aomap_fragment>`);
  };
  const soakKey = soak === 'instanced' ? '-soaks' : soak ? '-soak' : '';
  material.customProgramCacheKey = () => `${key()}-wet${sheltered ? '' : '-open'}${soakKey}-${sky}-${glint}${held ? '-held' : ''}`;
  return material;
}

/** Seconds something soaked through takes to dry under a roof, and something dry to soak through in the rain. */
const DRY_TIME = 240;
const SOAK_TIME = 20;
/** Seconds between looks at whether something soaking is under a roof. */
const SHELTER_CHECK = 0.5;

/** How wet the island is, how hard it's raining, and whether a point is under a roof. */
export interface Shelter {
  /** Open ground: 0 dry to 1 soaked. */
  readonly wet: number;
  /** 0 to 1. */
  readonly rainfall: number;
  sheltered(x: number, y: number, z: number): boolean;
}

/**
 * How soaked one thing is that comes in and out of the rain, such as a
 * soldier: it soaks through out in it and dries slowly under a roof or once
 * the rain stops, rather than the moment it does. Its `level` is a uniform
 * for `wetMaterial`, a share of how wet the island is.
 */
export class Soak {
  /** 0 dry to 1 soaked through. */
  readonly level = { value: 0 };
  private open = true;
  private begun = false;
  private wait = Math.random() * SHELTER_CHECK;

  /** Start as soaked as `level`, rather than as wet as where it's first seen. */
  begin(level: number): void {
    this.level.value = level;
    this.begun = true;
    // Look at once whether it's under a roof.
    this.wait = 0;
  }

  /** Soak or dry by `dt` seconds at (x, y, z), a point on it about halfway up. */
  update(shelter: Shelter | null, x: number, y: number, z: number, dt: number): void {
    if (!shelter || shelter.wet <= 0) {
      this.level.value = 0;
      this.begun = false;
      return;
    }
    this.wait -= dt;
    if (this.wait <= 0 || !this.begun) {
      this.open = !shelter.sheltered(x, y, z);
      this.wait = SHELTER_CHECK;
    }
    // First seen out in the wet, it's been out in it; first seen under a roof, it's dry.
    if (!this.begun) {
      this.level.value = this.open ? 1 : 0;
      this.begun = true;
    } else if (this.open && shelter.rainfall > 0) this.level.value = Math.min(this.level.value + (dt * shelter.rainfall) / SOAK_TIME, 1);
    else this.level.value = Math.max(this.level.value - dt / DRY_TIME, 0);
  }
}

export class Rain implements Shelter {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly world: World;
  private readonly roofs = new Float32Array(ROOF_CELLS * ROOF_CELLS);
  private readonly roofAt = new THREE.Vector2(Infinity, Infinity);
  /** The roofs and floors. */
  private readonly shelters: Box[];
  private readonly splashes: THREE.Points;
  private readonly splashMaterial: THREE.ShaderMaterial;
  private readonly splashPos: THREE.BufferAttribute;
  private readonly splashBorn: THREE.BufferAttribute;
  private readonly streaks: THREE.InstancedBufferGeometry;
  private nextSplash = 0;
  private splashDebt = 0;
  private fall = 0;
  private stormy = 0;
  private wetLevel = 0;
  private lastTime = 0;
  /** Storm seconds to the next strike: they pass faster the stormier it is. */
  private toStrike = 0;
  /** When the last strike lit the sky, and how near it was, 0 far to 1 near. */
  private struckAt = -Infinity;
  private strikeNear = 0;
  /** Called with a strike's distance, metres, as its flash lights the sky. */
  onStrike: ((distance: number) => void) | null = null;

  constructor(world: World) {
    this.world = world;
    this.shelters = shelters(world);
    const quad = new THREE.InstancedBufferGeometry();
    // x: which side of the streak, y: 0 at its head, 1 at its tail.
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    quad.setIndex([0, 2, 1, 1, 2, 3]);
    const seeds = new Float32Array(DROPS * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    quad.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
    quad.instanceCount = DROPS;
    this.streaks = quad;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        center: { value: new THREE.Vector3() },
        time: { value: 0 },
        color: { value: new THREE.Color() },
        ...rainUniforms,
      },
      vertexShader: /* glsl */ `
        uniform vec3 center;
        uniform float time;
        attribute vec3 seed;
        varying float vFade;
        varying float vAcross;
        ${ROOF_GLSL}
        const vec3 box = vec3(${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
        const vec3 fall = vec3(${FALL.x.toFixed(2)}, ${FALL.y.toFixed(2)}, ${FALL.z.toFixed(2)});
        void main() {
          // Where the drop's head is now, wrapped into the box round the camera.
          vec3 p = seed * box + fall * time;
          p = center + (fract((p - center) / box + 0.5) - 0.5) * box;
          vec4 head = modelViewMatrix * vec4(p, 1.0);
          vec4 tail = modelViewMatrix * vec4(p - fall * ${STREAK.toFixed(3)}, 1.0);
          vec4 view = mix(head, tail, position.y);
          // Widened across the streak as it's seen.
          vec3 along = normalize(tail.xyz - head.xyz);
          vec3 side = normalize(cross(along, view.xyz));
          view.xyz += side * position.x * ${(STREAK_WIDTH / 2).toFixed(4)};
          float d = length(view.xyz);
          // Thin out far off and right in front of the eye, and none under a roof.
          vFade = smoothstep(${(BOX / 2).toFixed(1)}, ${(BOX / 5).toFixed(1)}, d) * smoothstep(0.4, 1.8, d) * (1.0 - underRoof(p));
          vAcross = position.x;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying float vFade;
        varying float vAcross;
        void main() {
          if (vFade <= 0.0) discard;
          gl_FragColor = vec4(color, 0.34 * vFade * (1.0 - vAcross * vAcross));
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const streaks = new THREE.Mesh(quad, this.material);
    streaks.frustumCulled = false;

    const splashGeo = new THREE.BufferGeometry();
    this.splashPos = new THREE.BufferAttribute(new Float32Array(SPLASHES * 3), 3);
    this.splashBorn = new THREE.BufferAttribute(new Float32Array(SPLASHES).fill(-1e3), 1);
    this.splashPos.setUsage(THREE.DynamicDrawUsage);
    this.splashBorn.setUsage(THREE.DynamicDrawUsage);
    splashGeo.setAttribute('position', this.splashPos);
    splashGeo.setAttribute('born', this.splashBorn);
    this.splashMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color() }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        uniform float time;
        uniform float scale;
        attribute float born;
        varying float vAge;
        void main() {
          vAge = (time - born) / ${SPLASH_LIFE.toFixed(2)};
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          // A splash about 12 cm across, growing as it goes; scale is pixels per metre a metre off.
          gl_PointSize = vAge < 0.0 || vAge > 1.0 ? 0.0 : scale * (0.05 + 0.08 * vAge) / -view.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying float vAge;
        void main() {
          // A crown of spray: a flattened ring, brightest along its bottom edge.
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          c.y *= 2.2;
          float r = length(c);
          float ring = smoothstep(0.55, 0.85, r) * smoothstep(1.0, 0.85, r) * step(-0.2, c.y);
          float a = ring * (1.0 - vAge) * 0.55;
          if (a < 0.01) discard;
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.splashes = new THREE.Points(splashGeo, this.splashMaterial);
    this.splashes.frustumCulled = false;
    const size = new THREE.Vector2();
    this.splashes.onBeforeRender = (renderer, _scene, camera) => {
      const u = this.splashMaterial.uniforms;
      u.scale.value = (renderer.getDrawingBufferSize(size).y / 2) * camera.projectionMatrix.elements[5];
    };
    this.group.add(streaks, this.splashes);
    this.group.visible = false;
  }

  /**
   * How hard it's raining and how stormy it is, 0 to 1, and the colour the
   * streaks catch from the sky; how wet the ground is and how full the
   * puddles, 0 to 1.
   */
  set(rainfall: number, storm: number, color: THREE.Color, wet: number, puddles: number): void {
    this.fall = rainfall;
    this.stormy = storm;
    this.wetLevel = wet;
    this.group.visible = rainfall > 0;
    this.streaks.instanceCount = Math.ceil(DROPS * rainfall);
    rainUniforms.wetness.value = wet;
    rainUniforms.puddles.value = puddles;
    rainUniforms.rainfall.value = rainfall;
    this.material.uniforms.color.value.copy(color);
    this.splashMaterial.uniforms.color.value.copy(color).multiplyScalar(1.3);
  }

  get wet(): number {
    return this.wetLevel;
  }

  get rainfall(): number {
    return this.fall;
  }

  /** Whether a roof, or a floor, is over (x, y, z). */
  sheltered(x: number, y: number, z: number): boolean {
    for (const b of this.shelters) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && boxTop(b, x, z) > y) return true;
    }
    return false;
  }

  /** How bright lightning is lighting the sky now, 0 to 1. */
  get flash(): number {
    const t = this.lastTime - this.struckAt;
    if (t < 0 || t > 0.9) return 0;
    // Two or three flickers, dying away; ahead of the rain, only a glow beyond the hills.
    const flicker = Math.max(Math.exp(-t * 18), 0.8 * Math.exp(-Math.abs(t - 0.18) * 30), 0.5 * Math.exp(-Math.abs(t - 0.42) * 22));
    return flicker * (0.35 + 0.65 * this.strikeNear) * (0.3 + 0.7 * this.fall);
  }

  /** Fall round `eye` at `time` seconds, splash, and strike now and then. */
  update(eye: THREE.Vector3, time: number): void {
    const dt = Math.min(Math.max(time - this.lastTime, 0), 0.1);
    this.lastTime = time;
    this.placeRoofs(eye);
    if (this.stormy > 0) this.storm(time, dt);
    if (this.fall <= 0) return;
    rainUniforms.rainTime.value = time % 1000;
    this.material.uniforms.center.value.copy(eye);
    this.material.uniforms.time.value = time % 1000;
    this.splashMaterial.uniforms.time.value = time % 1000;
    this.splash(eye, time % 1000, dt);
  }

  /** Splashes on whatever the rain lands on round the camera: ground, floors in the open, roofs and the sea. */
  private splash(eye: THREE.Vector3, time: number, dt: number): void {
    this.splashDebt += dt * this.fall * (SPLASHES / SPLASH_LIFE);
    const n = Math.min(Math.floor(this.splashDebt), SPLASHES);
    this.splashDebt -= n;
    if (!n) return;
    const pos = this.splashPos.array as Float32Array;
    const born = this.splashBorn.array as Float32Array;
    const w = this.world;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPLASH_RANGE;
      const x = eye.x + Math.cos(a) * r;
      const z = eye.z + Math.sin(a) * r;
      const y = Math.max(w.groundHeight(x, z, 1e4), WATER_LEVEL);
      const i = this.nextSplash;
      this.nextSplash = (i + 1) % SPLASHES;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y + 0.03;
      pos[i * 3 + 2] = z;
      // Staggered through the frame so they don't pulse together.
      born[i] = time - Math.random() * dt;
    }
    this.splashPos.needsUpdate = true;
    this.splashBorn.needsUpdate = true;
  }

  private storm(time: number, dt: number): void {
    if (dt <= 0) return;
    // The first comes sooner than the rest.
    if (!this.toStrike) this.toStrike = gap() * 0.4;
    this.toStrike -= dt * this.stormy;
    if (this.toStrike > 0) return;
    this.toStrike = gap();
    this.struckAt = time;
    const nearest = STRIKE_DRY + (STRIKE_NEAR - STRIKE_DRY) * this.fall;
    const distance = nearest + Math.random() ** 1.5 * (STRIKE_FAR - nearest);
    this.strikeNear = 1 - (distance - STRIKE_NEAR) / (STRIKE_FAR - STRIKE_NEAR);
    this.onStrike?.(distance);
  }

  /** Make the roof map again if the camera has moved far from its middle. */
  private placeRoofs(eye: THREE.Vector3): void {
    const at = this.roofAt;
    if (Math.abs(eye.x - at.x) < ROOF_SLACK && Math.abs(eye.z - at.y) < ROOF_SLACK) return;
    at.set(Math.round(eye.x / ROOF_CELL) * ROOF_CELL, Math.round(eye.z / ROOF_CELL) * ROOF_CELL);
    const size = ROOF_CELLS * ROOF_CELL;
    const x0 = at.x - size / 2;
    const z0 = at.y - size / 2;
    roofHeights(this.world, x0, z0, this.roofs);
    const tex = rainUniforms.roofMap.value;
    (tex.image.data as Float32Array).set(this.roofs);
    tex.needsUpdate = true;
    rainUniforms.roofCorner.value.set(x0, z0, 1 / size);
  }
}

/**
 * The roof map with its corner at (x0, z0): for each cell, the top of the
 * highest roof over its middle, or OPEN_SKY; a floor counts, as the
 * roof of the room under it. Rows run along z.
 */
export function roofHeights(world: World, x0: number, z0: number, out = new Float32Array(ROOF_CELLS * ROOF_CELLS)): Float32Array {
  out.fill(OPEN_SKY);
  for (const b of shelters(world)) {
    const i0 = Math.max(Math.ceil((b.minX - x0) / ROOF_CELL - 0.5), 0);
    const i1 = Math.min(Math.floor((b.maxX - x0) / ROOF_CELL - 0.5), ROOF_CELLS - 1);
    const j0 = Math.max(Math.ceil((b.minZ - z0) / ROOF_CELL - 0.5), 0);
    const j1 = Math.min(Math.floor((b.maxZ - z0) / ROOF_CELL - 0.5), ROOF_CELLS - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) out[j * ROOF_CELLS + i] = Math.max(out[j * ROOF_CELLS + i], boxTop(b, x0 + (i + 0.5) * ROOF_CELL, z0 + (j + 0.5) * ROOF_CELL));
    }
  }
  return out;
}

function gap(): number {
  return STRIKE_GAP[0] + Math.random() * (STRIKE_GAP[1] - STRIKE_GAP[0]);
}

function roofTexture(data: Float32Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, ROOF_CELLS, ROOF_CELLS, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
