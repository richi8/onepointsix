import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import type { Impostors } from './impostors.ts';
import { groundEye, onTiles } from './terrain.ts';
import { Layer } from '../shared/layers.ts';
import { surfaceMaterial } from './surfaces.ts';
import { WIND_GLSL, wind } from './wind.ts';
import { filled } from './cardtexture.ts';
import { wetMaterial, type WetOptions } from './rain.ts';

// Spruces: a trunk, whorls of limbs and sprays of needles along them (see
// fir()), generated here rather than loaded, as real tree models are far too
// big to download. Trees near the camera are drawn in full detail, farther
// ones as a plainer version of the same tree, both swaying in the wind, and
// far ones as impostors (see impostors.ts), which load lazily; until they're
// in, the plainer trees reach all the way out. From one to the next each tree
// dissolves pixel by pixel, so none pops. The plainer trees are split into
// tiles, and only tiles that reach into their range draw them; the detailed
// ones are gathered round the camera as it moves. Every tree stands on the
// ground as its terrain tile is drawn.

/** Metres across a tile of trees. */
const TILE = 100;
/** A unit tree is this tall, matching the collider height in World.placeTrees. */
export const TREE_HEIGHT = 7;
const HEIGHT = TREE_HEIGHT;
const WHORLS = 16;
/** The bark's colour before its texture loads. */
const TRUNK = 0x4a3526;
/** How far the wind leans a crown's top, per unit of the wind's push. */
export const SWAY = 0.35;
/** Metres from the camera over which a tree dissolves from full into its impostor. */
export const FADE_START = 110;
export const FADE_END = 140;
/** A tile draws its full trees while its nearest edge is within this of the camera, a little past FADE_END. */
const TILE_REACH = FADE_END + 5;
/**
 * Metres from the camera over which a tree hands over from its full detail to
 * the plainer version drawn farther off (see fir()).
 */
export const NEAR_START = 30;
export const NEAR_END = 40;
/** The near trees are gathered again once the camera has moved this far, from this much past NEAR_END. */
const NEAR_SLACK = 5;

interface Tile {
  x: number;
  z: number;
  near: boolean;
  meshes: THREE.InstancedMesh[];
}

/**
 * Where each tree is between full (0) and impostor (1), with `vTreeFade`, and
 * a screen-space dither they share, so their pixels add up to one tree.
 * `treeEye` is where the camera is, also in the shadow pass, which only needs
 * the fade in its vertex shader (`varying` false).
 */
export function treeFadeGlsl(varying = true): string {
  return /* glsl */ `
    uniform vec3 treeEye;
    uniform vec2 treeFade;
    ${varying ? 'varying ' : ''}float vTreeFade;
    float treeDither(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }
  `;
}
/** The range over which trees fade into impostors: none until the impostors are in. */
export const treeFade = { value: new THREE.Vector2(1e6, 1e6 + 1) };

type Lod = 'near' | 'far';

/** The two sets of materials a level of detail draws with, and casts its shadows with. */
interface Materials {
  wood: THREE.Material;
  foliage: THREE.Material;
  woodDepth: THREE.MeshDepthMaterial;
  foliageDepth: THREE.MeshDepthMaterial;
}

export class Trees {
  readonly group = new THREE.Group();
  private readonly tiles: Tile[] = [];
  private readonly world: World;
  /** Each tree's needles' colour, for its impostor. */
  private readonly colors: THREE.Color[];
  /** Each tree's placing, 16 floats each, and its needles' colour, 3 each. */
  private readonly matrices: Float32Array;
  private readonly tints: Float32Array;
  /** The trees near the camera, in full detail: its wood and its foliage. */
  private readonly near: THREE.InstancedMesh[];
  /** Where the near trees were last gathered round. */
  private readonly nearAt = new THREE.Vector2(Infinity, Infinity);
  /** One tree at the origin, still and in plain materials, for baking the impostors' pictures. */
  private readonly unit: TreeParts;
  private readonly map: THREE.Texture;
  private impostors: Impostors | null = null;

  constructor(world: World) {
    this.world = world;
    this.map = sprayTexture();
    const near = fir(world.seed + 21, true);
    const far = fir(world.seed + 21, false);

    const rand = mulberry32(world.seed + 17);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    // Every tree's look is drawn in world order, so tiling doesn't change them.
    const looks = world.trees.map(() => ({ turn: rand() * Math.PI * 2, hue: rand(), light: rand() }));
    // A tint over the needles' own colours: some trees bluer, some yellower, some darker.
    const sprayColor = (look: { hue: number; light: number }) =>
      c.setHSL(0.2 + look.hue * 0.12, 0.3 + look.light * 0.2, 0.74 + look.light * 0.2, THREE.SRGBColorSpace);
    this.matrices = new Float32Array(world.trees.length * 16);
    this.tints = new Float32Array(world.trees.length * 3);
    world.trees.forEach((t, i) => {
      q.setFromAxisAngle(up, looks[i].turn);
      m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s, t.s)).toArray(this.matrices, i * 16);
      sprayColor(looks[i]).toArray(this.tints, i * 3);
    });
    this.colors = looks.map((look) => sprayColor(look).clone());

    // Far trees are drawn by the tile, near ones gathered round the camera as it moves.
    const farMats = this.materials('far', null);
    const byTile = new Map<number, number[]>();
    const n = Math.ceil(world.size / TILE);
    world.trees.forEach((t, i) => {
      const tx = Math.min(Math.floor((t.x + world.half) / TILE), n - 1);
      const tz = Math.min(Math.floor((t.z + world.half) / TILE), n - 1);
      const key = tz * n + tx;
      const list = byTile.get(key) ?? [];
      list.push(i);
      byTile.set(key, list);
    });
    for (const [key, ids] of byTile) {
      const meshes = this.meshes(far, farMats, ids.length);
      ids.forEach((id, i) => {
        meshes[0].instanceMatrix.array.set(this.matrices.subarray(id * 16, id * 16 + 16), i * 16);
        meshes[1].instanceMatrix.array.set(this.matrices.subarray(id * 16, id * 16 + 16), i * 16);
        meshes[1].instanceColor!.array.set(this.tints.subarray(id * 3, id * 3 + 3), i * 3);
      });
      for (const mesh of meshes) mesh.computeBoundingSphere();
      const tx = key % n;
      const tz = Math.floor(key / n);
      this.tiles.push({ x: -world.half + (tx + 0.5) * TILE, z: -world.half + (tz + 0.5) * TILE, near: true, meshes });
    }
    this.near = this.meshes(near, this.materials('near', null), world.trees.length);
    for (const mesh of this.near) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }

    this.unit = { wood: far.wood, foliage: far.foliage, map: this.map, woodColor: new THREE.Color(TRUNK) };
  }

  /** A tree's wood and foliage as instanced meshes, room for `count`, in the group. */
  private meshes(parts: { wood: THREE.BufferGeometry; foliage: THREE.BufferGeometry }, mats: Materials, count: number): THREE.InstancedMesh[] {
    const wood = new THREE.InstancedMesh(parts.wood, mats.wood, count);
    const foliage = new THREE.InstancedMesh(parts.foliage, mats.foliage, count);
    foliage.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    wood.customDepthMaterial = mats.woodDepth;
    foliage.customDepthMaterial = mats.foliageDepth;
    for (const mesh of [wood, foliage]) {
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return [wood, foliage];
  }

  /** What a level of detail draws with: plain bark until `assets` are in. */
  private materials(lod: Lod, assets: Assets | null): Materials {
    const world = this.world;
    // Bark and needles darken and shine a little in the rain.
    const wood = assets
      ? full(swaying(surfaceMaterial(assets, { kind: 'fixed', layer: Layer.bark }, { roughness: 0.95 }, 1.5, { wet: true })), world, lod)
      : wetMaterial(full(swaying(new THREE.MeshStandardMaterial({ color: TRUNK, roughness: 1 })), world, lod), { gloss: 0.6, sheltered: false });
    const foliage = wetMaterial(full(swaying(needles(thickened(new THREE.MeshStandardMaterial({
      map: this.map, vertexColors: true, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, envMapIntensity: 0.55,
    })))), world, lod), NEEDLES_WET);
    // Shadows sway with the crowns, and hand over whole halfway through each fade.
    const depth = (map?: THREE.Texture) => full(swaying(new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, ...(map ? { map, alphaTest: 0.4 } : {}),
    })), world, lod, true);
    return { wood, foliage, woodDepth: depth(), foliageDepth: depth(this.map) };
  }

  applyAssets(assets: Assets): void {
    const far = this.materials('far', assets).wood;
    for (const t of this.tiles) t.meshes[0].material = far;
    this.near[0].material = this.materials('near', assets).wood;
  }

  /** Load the impostors and bake their pictures of a tree. */
  async bake(renderer: THREE.WebGLRenderer): Promise<void> {
    const { Impostors } = await import('./impostors.ts');
    const impostors = new Impostors(this.world, this.colors);
    impostors.bake(renderer, this.unit);
    this.group.add(impostors.mesh);
    this.impostors = impostors;
    treeFade.value.set(FADE_START, FADE_END);
  }

  /**
   * Gather the trees near `eye` to draw in full detail, once it has moved a
   * little, and draw far trees only in the tiles that reach into their range.
   */
  update(eye: THREE.Vector3): void {
    if (Math.hypot(eye.x - this.nearAt.x, eye.z - this.nearAt.y) > NEAR_SLACK) {
      this.nearAt.set(eye.x, eye.z);
      const [wood, foliage] = this.near;
      let count = 0;
      this.world.trees.forEach((t, i) => {
        if (Math.hypot(t.x - eye.x, t.z - eye.z) > NEAR_END + NEAR_SLACK) return;
        const at = this.matrices.subarray(i * 16, i * 16 + 16);
        wood.instanceMatrix.array.set(at, count * 16);
        foliage.instanceMatrix.array.set(at, count * 16);
        foliage.instanceColor!.array.set(this.tints.subarray(i * 3, i * 3 + 3), count * 3);
        count++;
      });
      for (const mesh of this.near) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
      foliage.instanceColor!.needsUpdate = true;
    }
    if (!this.impostors) return;
    for (const t of this.tiles) {
      const dx = Math.max(Math.abs(t.x - eye.x) - TILE / 2, 0);
      const dz = Math.max(Math.abs(t.z - eye.z) - TILE / 2, 0);
      const near = Math.hypot(dx, dz) < TILE_REACH;
      if (near === t.near) continue;
      t.near = near;
      for (const mesh of t.meshes) mesh.visible = near;
    }
  }
}

/** A unit tree's shapes and colours, for baking. */
export interface TreeParts {
  /** The trunk, limbs and twigs. */
  wood: THREE.BufferGeometry;
  /** The sprays of needles, shaded by their vertex colours. */
  foliage: THREE.BufferGeometry;
  /** The sprays' picture. */
  map: THREE.Texture;
  woodColor: THREE.Color;
}

/**
 * A full tree's material: stood on its terrain tile, and dissolving pixel by
 * pixel from one level of detail into the next, near into far between
 * NEAR_START and NEAR_END and far into the impostor over `treeFade`. The
 * three share one dither, so each pixel of a tree is drawn by exactly one of
 * them. In the shadow pass (`shadow`) a tree hands its shadow over whole,
 * halfway through each fade.
 */
function full<M extends THREE.Material>(material: M, world: World, lod: Lod, shadow = false): M {
  onTiles(material, world);
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const varying = shadow ? '' : 'varying ';
  const half = shadow ? '0.5' : '1.0';
  // Gone altogether: every vertex off screen, so it draws no pixels.
  const gone = lod === 'near' ? `vTreeNear >= ${half}` : `vTreeFade >= ${half} || vTreeNear ${shadow ? '< 0.5' : '<= 0.0'}`;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.treeEye = groundEye;
    shader.uniforms.treeFade = treeFade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${treeFadeGlsl(!shadow)}\n${varying}float vTreeNear;`)
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float treeDistance = distance(instanceMatrix[3].xz, treeEye.xz);
          vTreeFade = smoothstep(treeFade.x, treeFade.y, treeDistance);
          vTreeNear = smoothstep(${NEAR_START.toFixed(1)}, ${NEAR_END.toFixed(1)}, treeDistance);
        #else
          vTreeFade = 0.0;
          vTreeNear = 0.0;
        #endif`)
      .replace('#include <project_vertex>', /* glsl */ `
        #include <project_vertex>
        if (${gone}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    if (!shadow) {
      // Of the dither's range, the impostor takes the lowest vTreeFade, near trees all from vTreeNear up and far ones what's between.
      const hidden = lod === 'near' ? 'd < vTreeNear' : 'd < vTreeFade || d >= vTreeNear';
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${treeFadeGlsl()}\nvarying float vTreeNear;`)
        .replace('#include <clipping_planes_fragment>', /* glsl */ `
          {
            float d = treeDither(gl_FragCoord.xy);
            if (${hidden}) discard;
          }
          #include <clipping_planes_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `${key}-full-tree-${lod}-${shadow}`;
  return material;
}

/** Crowns lean with the wind, more toward the top. */
function swaying<M extends THREE.MeshStandardMaterial | THREE.MeshDepthMaterial>(material: M): M {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.windTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          {
            // Wind blows the same way everywhere: turn it into the tree's own frame.
            float s = length(instanceMatrix[0].xyz);
            vec3 base = instanceMatrix[3].xyz;
            float h = max(position.y - 1.2, 0.0) / ${(HEIGHT - 1.2).toFixed(1)};
            vec3 push = windPush(base, windTime) * h * h * ${SWAY.toFixed(2)};
            transformed += transpose(mat3(instanceMatrix)) * push / (s * s);
          }
        #endif`);
  };
  material.customProgramCacheKey = () => `${key}-tree-sway`;
  return material;
}

/**
 * Needles are finer than a pixel from a little way off, so smaller mips average
 * them into the gaps and fall under the alpha test, hollowing a crown out;
 * thicken the alpha by `boost` a mip level to make up for it.
 */
export function thickened<M extends THREE.MeshStandardMaterial>(material: M, boost = 0.35): M {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    if (!shader.fragmentShader.includes('#include <alphatest_fragment>')) throw new Error('Shader anchor #include <alphatest_fragment> is missing');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', /* glsl */ `
      {
        vec2 texel = vMapUv * vec2(textureSize(map, 0));
        float mip = max(0.0, 0.5 * log2(max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));
        diffuseColor.a *= 1.0 + mip * ${boost.toFixed(2)};
      }
      #include <alphatest_fragment>`);
  };
  material.customProgramCacheKey = () => `${key}-thick-${boost}`;
  return material;
}

/**
 * How needles get wet, the same on the full trees and their impostors: a
 * little of the sun's gloss given back, which `needles` takes away dry, and
 * less of the sky's reflection, which turned them grey.
 */
export const NEEDLES_WET: WetOptions = { gloss: 0.5, sheltered: false, sky: 0.5, glint: 0.4 };

/**
 * Shaded as a mass of needles rather than as the cards they're drawn on. Both
 * sides of a card keep its normal pointing out of the crown, as the impostors'
 * bake does, rather than flipping it on the back, which shaded the full trees
 * darker and bluer than their impostors. And no sheen: a card seen edge on
 * against the sun caught a pale glare, as a mass of needles doesn't. The
 * impostors take their normals from their pictures, so only the sheen
 * (`normals` false).
 */
export function needles<M extends THREE.MeshStandardMaterial>(material: M, normals = true): M {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    for (const [anchor, code] of [
      ...(normals ? [['#include <normal_fragment_begin>', 'normal = normalize(vNormal);']] : []),
      ['#include <lights_fragment_end>', 'reflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular *= 0.3;'],
    ]) {
      if (!shader.fragmentShader.includes(anchor)) throw new Error(`Shader anchor ${anchor} is missing`);
      shader.fragmentShader = shader.fragmentShader.replace(anchor, `${anchor}\n${code}`);
    }
  };
  material.customProgramCacheKey = () => `${key}-needles-${normals}`;
  return material;
}

/** Where the crown's lowest living whorl starts, and how far its longest limbs reach, in unit-tree metres. */
const CROWN_BASE = 1.3;
const REACH = 2.35;

/**
 * A unit spruce: its wood (a trunk flaring at the foot, limbs and a few bare
 * twigs low down, as one shape) and its foliage, sprays of needles along each
 * limb, flat nearer the trunk and drooping at the tips, with a few hanging
 * under the limbs as a spruce's do. Whorls of limbs, longest at the bottom,
 * with smaller ones between them. The foliage's colour darkens toward the
 * trunk and the crown's foot, where little light gets in, and its normals
 * point out from the crown, so it lights as one soft mass.
 *
 * `near` is the tree seen close up, in full. Otherwise it's the same tree from
 * the same `seed`, limb for limb, but with no limbs drawn, a plainer trunk and
 * a few large sprays along each limb instead of many small ones: about a
 * tenth of the triangles, for farther off and for the impostors' pictures.
 */
export function fir(seed: number, near: boolean): { wood: THREE.BufferGeometry; foliage: THREE.BufferGeometry } {
  // The tree's layout; each limb's detail draws from a stream of its own, so both kinds share the layout.
  const rand = mulberry32(seed);
  const wood = { pos: [] as number[], nrm: [] as number[], index: [] as number[] };
  const leaf = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], color: [] as number[], index: [] as number[] };
  const up = new THREE.Vector3(0, 1, 0);

  // The trunk: a flared foot, narrowing to the leader's tip.
  const trunk: THREE.Vector3[] = [];
  const radii: number[] = [];
  // Farther off, the trunk stops inside the crown, where its core hides the end.
  const rings = near ? 7 : 3;
  const top = near ? HEIGHT : HEIGHT * 0.65;
  for (let k = 0; k <= rings; k++) {
    const y = (k / rings) * top;
    const f = y / HEIGHT;
    trunk.push(new THREE.Vector3(0, y, 0));
    radii.push(0.26 * (1 - f) ** 1.1 + 0.015 + (near ? 0.12 * Math.max(0, 1 - y / 0.7) ** 2 : 0));
  }
  tube(wood, trunk, radii, near ? 9 : 6);

  /** Horizontal reach of the limbs at height `y`: a spruce's narrow cone, rounded at the foot. */
  const reachAt = (y: number) => {
    const f = Math.min(Math.max((y - CROWN_BASE) / (HEIGHT - 0.2 - CROWN_BASE), 0), 1);
    return REACH * (1 - f) ** 0.95 * (0.82 + 0.18 * Math.min(1, f * 6)) + 0.2;
  };
  /**
   * A spray of needles, one of the picture's two, from `base` along `dir`,
   * its tip drooping by `droop`. With `shade`, it's that dark all over and
   * faces the way it's turned, as the core does: a normal out of the crown's
   * axis is straight up along the core's middle, and caught the sky's sheen.
   */
  const spray = (twig: () => number, base: THREE.Vector3, dir: THREE.Vector3, len: number, width: number, droop: number, roll: number, shade?: number): void => {
    const side = new THREE.Vector3().crossVectors(dir, up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize().applyAxisAngle(dir, roll);
    const row = twig() < 0.5 ? 0 : 0.5;
    // Up close, bent along its length and arched across; farther off, flat.
    const along = near ? [0, 0.5, 1] : [0, 1];
    const across = near ? [0, 0.5, 1] : [0, 1];
    const first = leaf.pos.length / 3;
    for (const u of along) {
      for (const w of across) {
        const p = base.clone().addScaledVector(dir, len * u).addScaledVector(side, (w - 0.5) * width);
        // Its sides hang lower than its stem.
        p.y -= droop * len * u * u + (near && w !== 0.5 ? width * 0.22 : 0);
        leaf.pos.push(p.x, p.y, p.z);
        // Out from the crown's axis, a little up.
        const n = shade === undefined ? new THREE.Vector3(p.x, 0.45, p.z).normalize() : new THREE.Vector3().crossVectors(side, dir).normalize();
        leaf.nrm.push(n.x, n.y, n.z);
        leaf.uv.push(u, row + w * 0.5);
        // Shaded deep in the crown and near its foot.
        const deep = Math.min(1, Math.hypot(p.x, p.z) / reachAt(p.y) + Math.max(0, p.y - (HEIGHT - 1.6)) / 1.2);
        const dark = shade ?? (0.3 + 0.7 * deep ** 1.3) * (0.75 + 0.25 * Math.min(1, (p.y - CROWN_BASE) / 2.5));
        leaf.color.push(dark, dark, dark);
      }
    }
    const cols = across.length;
    for (let r = 0; r < along.length - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = first + r * cols + c;
        leaf.index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
  };
  const limb = (y: number, angle: number, length: number, f: number, bare: boolean): void => {
    // Lower limbs start level and sag, upper ones rise; every tip turns up a little.
    const rise = -0.12 + f * 0.55 + (rand() - 0.5) * 0.15;
    const twig = mulberry32(Math.floor(rand() * 2 ** 31));
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const sag = (1 - f) * 0.3 + 0.08;
    const at = (t: number) => out.clone().multiplyScalar(length * t).setY(y + length * (rise * t - sag * t * t + 0.12 * t * t * t));
    if (near && length > 0.7) {
      const r = 0.012 + 0.03 * length / REACH;
      tube(wood, [at(0), at(0.5), at(1)], [r, r * 0.6, 0.006], 3);
    }
    if (bare) return;
    if (!near) {
      // A few large sprays covering the limb, rolled so some face a camera
      // level with them, and one hanging under it.
      const sprays = Math.max(1, Math.round(length / 1.1));
      for (let k = 0; k < sprays; k++) {
        const t0 = 0.08 + (0.92 * k) / sprays;
        const t1 = 0.08 + (0.92 * (k + 1)) / sprays;
        const dir = at(t1 + 0.12).sub(at(t0)).normalize();
        const len = length * (t1 - t0 + 0.12) * 1.1;
        spray(twig, at(t0), dir, len, Math.min(len * 0.95, 0.35 + length * 0.4), 0, (twig() < 0.5 ? -1 : 1) * (0.3 + twig() * 0.6));
      }
      if (f < 0.8 && length > 1.2) {
        const hang = at(0.6).sub(at(0.3)).normalize().multiplyScalar(0.4).add(new THREE.Vector3(0, -1, 0)).normalize();
        spray(twig, at(0.45), hang, length * 0.45, length * 0.4, 0, (twig() - 0.5) * 1.5);
      }
      return;
    }
    const sprays = Math.max(2, Math.round(length / 0.3));
    for (let k = 0; k < sprays; k++) {
      const t = 0.12 + (0.88 * (k + 1)) / sprays;
      const tip = k === sprays - 1;
      const base = at(t - 0.18);
      // Along the limb, turned aside at random, alternating sides.
      const along = at(t).sub(at(t - 0.05)).normalize();
      const aside = (tip ? 0 : k % 2 ? 0.55 : -0.55) + (twig() - 0.5) * 0.5;
      const dir = along.applyAxisAngle(up, aside);
      dir.y -= 0.1 + twig() * 0.15;
      dir.normalize();
      const len = (0.55 + twig() * 0.3) * Math.min(1, 0.45 + length / REACH);
      spray(twig, base, dir, len, len * 0.85, tip ? 0.35 : 0.15, (twig() - 0.5) * 0.9);
      // Curtains of shoots hanging under the middle of the crown.
      if (!tip && f < 0.7 && twig() < 0.35) {
        const hang = dir.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
        spray(twig, at(t), hang, len * 0.7, len * 0.45, 0.05, (twig() - 0.5) * 1.5);
      }
    }
  };

  // Whorls up the crown, with smaller limbs between them.
  for (let w = 0; w < WHORLS; w++) {
    const f = w / (WHORLS - 1);
    const y = CROWN_BASE + f * (HEIGHT - 0.55 - CROWN_BASE);
    const count = f > 0.85 ? 3 : 5 + Math.floor(rand() * 2);
    const turn = rand() * Math.PI * 2;
    for (let b = 0; b < count; b++) {
      const a = turn + (b / count) * Math.PI * 2 + (rand() - 0.5) * 0.6;
      limb(y, a, reachAt(y) * (0.8 + rand() * 0.25), f, false);
    }
    if (f < 0.85) {
      const gap = (HEIGHT - 0.55 - CROWN_BASE) / (WHORLS - 1);
      const ym = y + gap * 0.5;
      for (let b = 0; b < 2; b++) limb(ym, rand() * Math.PI * 2, reachAt(ym) * (0.45 + rand() * 0.2), f, false);
    }
  }
  // A dark core: sprays standing up round the trunk, the picture's leaf shape
  // roughly the crown's, so it looks dense where no limb covers.
  const core = mulberry32(seed + 1);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    spray(core, new THREE.Vector3(0, CROWN_BASE - 0.2, 0), up, HEIGHT - CROWN_BASE - 0.3, REACH * 1.2, 0, a, 0.3);
  }
  // The leader: a few short shoots round the tip, pointing up.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rand();
    const dir = new THREE.Vector3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize();
    spray(rand, new THREE.Vector3(0, HEIGHT - 0.75, 0), dir, 0.7, 0.35, 0, a);
  }
  // Dead twigs below the crown, bare.
  for (let k = 0; k < 6; k++) {
    const y = 0.7 + rand() * (CROWN_BASE - 0.7);
    limb(y, rand() * Math.PI * 2, 0.3 + rand() * 0.5, 0, true);
  }

  const woodGeo = new THREE.BufferGeometry();
  woodGeo.setAttribute('position', new THREE.Float32BufferAttribute(wood.pos, 3));
  woodGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wood.nrm, 3));
  woodGeo.setIndex(wood.index);
  const foliage = new THREE.BufferGeometry();
  foliage.setAttribute('position', new THREE.Float32BufferAttribute(leaf.pos, 3));
  foliage.setAttribute('normal', new THREE.Float32BufferAttribute(leaf.nrm, 3));
  foliage.setAttribute('uv', new THREE.Float32BufferAttribute(leaf.uv, 2));
  foliage.setAttribute('color', new THREE.Float32BufferAttribute(leaf.color, 3));
  foliage.setIndex(leaf.index);
  return { wood: woodGeo, foliage };
}

/** A tube of `sides` round the path through `points`, `radii` thick at each, into `out`. */
function tube(out: { pos: number[]; nrm: number[]; index: number[] }, points: THREE.Vector3[], radii: number[], sides: number): void {
  const first = out.pos.length / 3;
  const along = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  points.forEach((p, i) => {
    along.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    a.set(0, 1, 0).cross(along);
    if (a.lengthSq() < 1e-4) a.set(1, 0, 0).cross(along);
    a.normalize();
    b.crossVectors(along, a);
    for (let s = 0; s < sides; s++) {
      const t = (s / sides) * Math.PI * 2;
      n.copy(a).multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t));
      out.pos.push(p.x + n.x * radii[i], p.y + n.y * radii[i], p.z + n.z * radii[i]);
      out.nrm.push(n.x, n.y, n.z);
    }
  });
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const p0 = first + i * sides + s;
      const p1 = first + i * sides + ((s + 1) % sides);
      out.index.push(p0, p1, p0 + sides, p1, p1 + sides, p0 + sides);
    }
  }
}

/**
 * Two sprays of spruce needles seen from above, one over the other, each a
 * stem from the limb (left) to the tip (right) with side shoots, all thick
 * with short needles, darker and bluer at the base and fresher toward the tips.
 */
function sprayTexture(): THREE.Texture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const rand = mulberry32(7);
  g.lineCap = 'round';
  /** Needles along a shoot from (x0, y0) at `angle`, `len` long, with a twig under them. */
  const shoot = (x0: number, y0: number, angle: number, len: number, needle: number, fresh: number): void => {
    g.lineWidth = Math.max(1, needle * 0.18);
    g.strokeStyle = '#4a3624';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len);
    g.stroke();
    g.lineWidth = 1.2;
    for (let s = 0; s < len; s += 1.1) {
      const x = x0 + Math.cos(angle) * s;
      const y = y0 + Math.sin(angle) * s;
      const tip = s / len;
      // Newer growth toward the tips is lighter and yellower.
      const young = Math.min(1, Math.max(0, (tip - 0.55) * 2.5)) * fresh;
      for (const side of [-1, 1]) {
        const a = angle + side * (0.7 + rand() * 0.6);
        const l = needle * (0.65 + rand() * 0.45) * (1 - tip * 0.35);
        const hue = 116 - young * 22 + (rand() - 0.5) * 14;
        const light = 17 + young * 12 + rand() * 13;
        g.strokeStyle = `hsl(${hue}, ${30 + young * 14 + rand() * 12}%, ${light}%)`;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }
  };
  for (const [top, seed] of [[0, 0], [h / 2, 1]] as const) {
    const mid = top + h / 4;
    const fresh = seed ? 0.6 : 1;
    // Side shoots, longest past the middle of the stem, so the spray is
    // leaf-shaped, each with a few shoots of its own.
    for (let s = 10; s < w - 30; s += 11 + rand() * 9) {
      const f = s / w;
      const room = (h / 4) * Math.sin(Math.PI * Math.min(1, 0.12 + f * 1.05)) * 0.92;
      for (const side of [-1, 1]) {
        if (rand() < 0.08) continue;
        const a = side * (0.55 + rand() * 0.35);
        const len = (room / Math.sin(Math.abs(a))) * (0.75 + rand() * 0.25);
        if (len > 30 && rand() < 0.6) {
          const t = 0.35 + rand() * 0.3;
          shoot(s + Math.cos(a) * len * t, mid + Math.sin(a) * len * t, a + side * (0.5 + rand() * 0.3), len * 0.35, 9, fresh);
        }
        shoot(s, mid, a, len, 12, fresh);
      }
    }
    shoot(0, mid, (rand() - 0.5) * 0.05, w - 10, 14, fresh);
  }
  const tex = filled(canvas);
  tex.anisotropy = 4;
  return tex;
}
