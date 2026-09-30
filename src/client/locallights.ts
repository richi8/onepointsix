import * as THREE from 'three';

// Spotlights after dark other than your own flashlight: the outposts' lamps
// and other people's flashlights. three.js lights each spotlight with a
// shadow map of its own, and each map takes one of the 16 textures a material
// may read, most of which the island's materials already use. So these are
// lit by a patch to three.js's lighting chunk instead, from a list kept in
// uniforms that every lit material shares, and their shadows are drawn into
// one atlas, a tile each, by three.js's own shadow renderer. The nearest few
// are lit fully, farther ones with their diffuse light only, and every one
// that casts shadows gets a tile, the nearest few a large one. Lights fade
// over a few metres as they cross the budget, so none goes out at once.
//
// The uniforms are handed to three.js's built-in materials by reference:
// arrays of numbers it passes through, and the atlas is a texture that
// clones as itself, so the copy each material makes of its uniforms still
// points at the same data.

/** Lights at most, and lit fully at most. */
export const MAX_LIGHTS = 16;
const FULL = 6;
/** Metres over which a light fades as it crosses either budget. */
const FADE = 6;
/**
 * The atlas's grid of large tiles, the first BIG of them large and the last
 * row cut into small ones, a quarter the size, one per light past those.
 */
const COLS = 3;
const ROWS = 3;
const BIG = COLS * (ROWS - 1);
const TILES = MAX_LIGHTS;
/** Texels a side of a large tile. */
const TILE = 512;

/** Where tile i lies in the atlas, in large tiles: corner, then size. */
function tileRect(i: number): THREE.Vector4 {
  if (i < BIG) return new THREE.Vector4(i % COLS, Math.floor(i / COLS), 1, 1);
  const k = i - BIG;
  return new THREE.Vector4((k % (COLS * 2)) * 0.5, ROWS - 1 + Math.floor(k / (COLS * 2)) * 0.5, 0.5, 0.5);
}

/** One light for this frame. */
export interface LocalLight {
  x: number;
  y: number;
  z: number;
  /** Unit direction it shines along. */
  dx: number;
  dy: number;
  dz: number;
  color: THREE.Color;
  intensity: number;
  range: number;
  decay: number;
  /** Half-angle of its cone, radians, and the share of it that softens toward the edge. */
  angle: number;
  penumbra: number;
  /** Whether it may cast shadows, if there's a tile for it. */
  shadow: boolean;
  /** How near the camera it is, to rank it; metres. */
  near: number;
}

// Four vec4s a light: position and range; direction and the cone's outer cosine;
// colour times intensity and the inner cosine; decay, shadow tile (-1 none), share lit fully (the rest diffuse only).
const data = new Float32Array(MAX_LIGHTS * 16);
/** x: lights in use; y: 1 while drawing apart with `localView`; z, w: one texel of the atlas, across and down. */
const info = new Float32Array([0, 0, 1 / (TILE * COLS), 1 / (TILE * ROWS)]);
/** World to view space, for a picture drawn apart whose own view matrix isn't the world's. */
const view = new Float32Array(16);
/** World to a tile's [0, 1] square and depth, per tile. */
const shadowMatrices = new Float32Array(TILES * 16);

/** The atlas: a depth texture compared as it's read, and a stand-in target until the shadow renderer takes it. */
const atlasTarget = new THREE.WebGLRenderTarget(TILE * COLS, TILE * ROWS);
const atlas = new THREE.DepthTexture(TILE * COLS, TILE * ROWS, THREE.UnsignedIntType);
atlas.format = THREE.DepthFormat;
atlas.compareFunction = THREE.LessEqualCompare;
atlas.minFilter = atlas.magFilter = THREE.LinearFilter;
atlas.name = 'localShadowAtlas';
atlasTarget.depthTexture = atlas;
// Every material's copy of its uniforms keeps this very texture.
atlas.clone = function (this: THREE.DepthTexture) {
  return this;
} as THREE.DepthTexture['clone'];

const UNIFORMS = {
  localLights: { value: data },
  localInfo: { value: info },
  localView: { value: view },
  localShadowMatrix: { value: shadowMatrices },
  localAtlas: { value: atlas },
};

const PARS = /* glsl */ `
  uniform vec4 localLights[${MAX_LIGHTS * 4}];
  uniform vec4 localInfo;
  uniform mat4 localView;
  uniform mat4 localShadowMatrix[${TILES}];
  uniform sampler2DShadow localAtlas;

  // How much of a local light reaches world point p, through its shadow tile.
  float localShadow(int tile, vec3 p) {
    vec4 s = localShadowMatrix[tile] * vec4(p, 1.0);
    if (s.w <= 0.0) return 1.0;
    vec3 c = s.xyz / s.w;
    if (c.z >= 1.0) return 1.0;
    // The tile's corner and size in large tiles, as tileRect has them.
    float t = float(tile);
    vec4 rect = tile < ${BIG}
      ? vec4(mod(t, ${COLS}.0), floor(t / ${COLS}.0), 1.0, 1.0)
      : vec4(mod(t - ${BIG}.0, ${COLS * 2}.0) * 0.5, ${ROWS - 1}.0 + floor((t - ${BIG}.0) / ${COLS * 2}.0) * 0.5, 0.5, 0.5);
    // Kept half a texel inside the tile, so the filter never reads the next one.
    vec2 texel = localInfo.zw * vec2(${COLS}.0, ${ROWS}.0) / rect.zw;
    vec2 uv = clamp(c.xy, texel * 1.5, 1.0 - texel * 1.5);
    vec2 at = (rect.xy + uv * rect.zw) / vec2(${COLS}.0, ${ROWS}.0);
    vec2 d = localInfo.zw;
    return 0.25 * (
      texture(localAtlas, vec3(at + vec2(-0.5, -0.5) * d, c.z)) +
      texture(localAtlas, vec3(at + vec2(0.5, -0.5) * d, c.z)) +
      texture(localAtlas, vec3(at + vec2(-0.5, 0.5) * d, c.z)) +
      texture(localAtlas, vec3(at + vec2(0.5, 0.5) * d, c.z)));
  }
`;

const LOOP = /* glsl */ `
  #if defined( RE_Direct )
  if ( localInfo.x > 0.0 ) {
    // World space from view space; the view matrix is a rotation and a move, or a mirror's.
    mat4 localV = localInfo.y > 0.5 ? localView : viewMatrix;
    mat3 localToWorld = transpose( mat3( localV ) );
    vec3 localP = localToWorld * ( geometryPosition - localV[ 3 ].xyz );
    vec3 localN = localToWorld * geometryNormal;
    int localCount = int( localInfo.x );
    for ( int i = 0; i < ${MAX_LIGHTS}; i ++ ) {
      if ( i >= localCount ) break;
      vec4 la = localLights[ i * 4 ];
      vec3 toLight = la.xyz - localP;
      float d = length( toLight );
      if ( d >= la.w ) continue;
      vec3 l = toLight / d;
      vec4 lb = localLights[ i * 4 + 1 ];
      float angleCos = dot( - l, lb.xyz );
      if ( angleCos <= lb.w ) continue;
      vec4 lc = localLights[ i * 4 + 2 ];
      vec4 ld = localLights[ i * 4 + 3 ];
      float lit = getSpotAttenuation( lb.w, lc.w, angleCos ) * getDistanceAttenuation( d, la.w, ld.x );
      // Read a little off the surface, more the farther from the light.
      if ( ld.y >= 0.0 && receiveShadow ) lit *= localShadow( int( ld.y ), localP + localN * ( 0.02 + 0.006 * d ) );
      if ( lit <= 0.0 ) continue;
      IncidentLight localLight;
      localLight.color = lc.rgb * lit;
      localLight.direction = normalize( ( localV * vec4( l, 0.0 ) ).xyz );
      localLight.visible = true;
      // Farther lights give only their diffuse light, blended across the budget.
      if ( ld.z < 1.0 ) {
        reflectedLight.directDiffuse += saturate( dot( geometryNormal, localLight.direction ) ) * localLight.color * ( 1.0 - ld.z ) * BRDF_Lambert( material.diffuseColor );
      }
      if ( ld.z > 0.0 ) {
        localLight.color *= ld.z;
        RE_Direct( localLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      }
    }
  }
  #endif
`;

/** The anchor in three.js's lighting chunk the lights are added after: the end of its spotlights. */
const SPOT_END = /#if \( NUM_SPOT_LIGHTS > 0 \)[\s\S]*?#pragma unroll_loop_end\s*#endif/;

/** three.js's lighting chunk with the local lights added after its own spotlights. */
export function localChunk(chunk: string): string {
  const m = chunk.match(SPOT_END);
  if (!m) throw new Error('Spotlight loop missing from lights_fragment_begin');
  return chunk.replace(m[0], `${m[0]}\n${LOOP}`);
}

let patched = false;

/** Patch three.js's lighting and its built-in lit materials' uniforms; must run before any material compiles. */
function patch(): void {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.lights_pars_begin = `${THREE.ShaderChunk.lights_pars_begin}\n${PARS}`;
  THREE.ShaderChunk.lights_fragment_begin = localChunk(THREE.ShaderChunk.lights_fragment_begin);
  for (const name of ['standard', 'physical', 'lambert', 'phong', 'toon'] as const) Object.assign(THREE.ShaderLib[name].uniforms, UNIFORMS);
}
patch();

/**
 * The atlas's shadow, drawn by three.js's shadow renderer as one viewport per
 * tile, each with a spotlight's camera of its own.
 */
class AtlasShadow extends THREE.LightShadow<THREE.PerspectiveCamera> {
  readonly cameras: THREE.PerspectiveCamera[] = [];
  readonly frustums: THREE.Frustum[] = [];
  readonly matrices: THREE.Matrix4[] = [];
  private readonly viewports: THREE.Vector4[] = [];
  private readonly extents = new THREE.Vector2(COLS, ROWS);
  /** Tiles to draw this frame. */
  count = 0;

  constructor() {
    super(new THREE.PerspectiveCamera(50, 1, 0.2, 30));
    this.mapSize.set(TILE, TILE);
    for (let i = 0; i < TILES; i++) {
      this.viewports.push(tileRect(i));
      this.cameras.push(new THREE.PerspectiveCamera(50, 1, 0.2, 30));
      this.frustums.push(new THREE.Frustum());
      this.matrices.push(new THREE.Matrix4());
    }
    this.map = atlasTarget;
    this.autoUpdate = true;
  }

  override getViewportCount(): number {
    return this.count;
  }

  override getViewport(i: number): THREE.Vector4 {
    return this.viewports[i];
  }

  override getFrameExtents(): THREE.Vector2 {
    return this.extents;
  }

  override getCamera(i = 0): THREE.PerspectiveCamera {
    return this.cameras[i];
  }

  override getFrustum(i = 0): THREE.Frustum {
    return this.frustums[i];
  }

  /** The cameras are placed by LocalLights. */
  override updateMatrices(): void {}

  /** Aim tile i's camera as the light, and work out its frustum and its matrix into [0, 1] across and in depth. */
  place(i: number, l: LocalLight): void {
    const cam = this.cameras[i];
    const fov = THREE.MathUtils.radToDeg(l.angle) * 2 * 1.05;
    const far = l.range;
    if (cam.fov !== fov || cam.far !== far) {
      cam.fov = fov;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    cam.position.set(l.x, l.y, l.z);
    // Straight down would leave lookAt no way to tell which way is up.
    cam.up.set(Math.abs(l.dy) > 0.99 ? 1 : 0, Math.abs(l.dy) > 0.99 ? 0 : 1, 0);
    cam.lookAt(l.x + l.dx, l.y + l.dy, l.z + l.dz);
    cam.updateMatrixWorld();
    const m = this.matrices[i];
    m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustums[i].setFromProjectionMatrix(m, cam.coordinateSystem);
    m.premultiply(TO_UNIT);
  }
}

/** Clip space to [0, 1] each way. */
const TO_UNIT = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/** A light only in name, carrying the atlas's shadow. */
class Holder extends THREE.Light {
  readonly shadow: AtlasShadow;

  constructor(shadow: AtlasShadow) {
    super();
    this.shadow = shadow;
    this.castShadow = true;
    this.name = 'local lights';
  }
}

/** The lights for this frame, gathered from the lamps and flashlights, then handed to the materials. */
export class LocalLights {
  private readonly lights: LocalLight[] = [];
  private readonly pool: LocalLight[] = [];
  private readonly shadow = new AtlasShadow();
  /**
   * Carries the atlas's shadow into three.js's shadow pass, which draws it as
   * the scene is drawn. A light of no kind three.js knows, so it lights
   * nothing and no material makes room for its shadow.
   */
  private readonly holder = new Holder(this.shadow);
  private ready = false;

  /** Shadow tiles a frame may draw, nearest first; fewer on a slow machine. */
  tiles = TILES;

  /** Start this frame's list. */
  begin(): void {
    for (const l of this.lights) this.pool.push(l);
    this.lights.length = 0;
  }

  /** A light for this frame; fill it in. */
  add(): LocalLight {
    const l = this.pool.pop() ?? {
      x: 0, y: 0, z: 0, dx: 0, dy: -1, dz: 0, color: new THREE.Color(), intensity: 0, range: 1, decay: 1, angle: 0.5, penumbra: 0, shadow: false, near: 0,
    };
    this.lights.push(l);
    return l;
  }

  /** How many lights light the world this frame, and how many cast shadows. */
  get counts(): { lights: number; shadows: number } {
    return { lights: info[0], shadows: this.shadow.count };
  }

  /** Set the texture up before anything reads it. */
  prepare(renderer: THREE.WebGLRenderer): void {
    if (this.ready) return;
    this.ready = true;
    renderer.initRenderTarget(atlasTarget);
  }

  /**
   * Hand this frame's lights, nearest first, to the materials, and aim the
   * shadow tiles of the nearest that cast them, drawn as `scene` next is.
   */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.prepare(renderer);
    if (this.holder.parent !== scene) scene.add(this.holder);
    const lights = this.lights.sort((a, b) => a.near - b.near);
    const n = Math.min(lights.length, MAX_LIGHTS);
    // Each fades as it nears the first light past a budget, so where two swap places neither jumps.
    const cut = lights.length > MAX_LIGHTS ? lights[MAX_LIGHTS].near : Infinity;
    const fullCut = lights.length > FULL ? lights[FULL].near : Infinity;
    let tiles = 0;
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      const o = i * 16;
      const intensity = l.intensity * Math.min((cut - l.near) / FADE, 1);
      data[o] = l.x;
      data[o + 1] = l.y;
      data[o + 2] = l.z;
      data[o + 3] = l.range;
      data[o + 4] = l.dx;
      data[o + 5] = l.dy;
      data[o + 6] = l.dz;
      data[o + 7] = Math.cos(l.angle);
      data[o + 8] = l.color.r * intensity;
      data[o + 9] = l.color.g * intensity;
      data[o + 10] = l.color.b * intensity;
      data[o + 11] = Math.cos(l.angle * (1 - l.penumbra));
      data[o + 12] = l.decay;
      data[o + 13] = -1;
      data[o + 14] = i < FULL ? Math.min((fullCut - l.near) / FADE, 1) : 0;
      if (l.shadow && intensity > 0 && tiles < Math.min(this.tiles, TILES)) {
        this.shadow.place(tiles, l);
        this.shadow.matrices[tiles].toArray(shadowMatrices, tiles * 16);
        data[o + 13] = tiles++;
      }
    }
    info[0] = n;
    this.shadow.count = tiles;
  }

  /**
   * Light a picture drawn apart from the world, such as the gun in your
   * hands, as if its view space were `camera`'s; `restore` undoes it.
   */
  apart(camera: THREE.Camera): void {
    camera.matrixWorldInverse.toArray(view);
    info[1] = 1;
  }

  restore(): void {
    info[1] = 0;
  }
}

/** The one list every material reads. */
export const localLights = new LocalLights();
