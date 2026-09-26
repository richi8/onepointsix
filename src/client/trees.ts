import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import type { Impostors } from './impostors.ts';
import { groundEye, onTiles } from './terrain.ts';
import { Layer } from '../shared/layers.ts';
import { surfaceMaterial } from './surfaces.ts';
import { WIND_GLSL, wind } from './wind.ts';

// Firs: a trunk, a dark core of cones and whorls of branch cards with needles
// drawn on them, which give the ragged outline. Near trees are drawn in full,
// swaying in the wind, and far ones as impostors (see impostors.ts), which
// load lazily; until they're in, every tree is drawn in full. Between the two
// each tree dissolves into its impostor pixel by pixel, so none pops. Trees
// are split into tiles, and only tiles that reach into the full trees' range
// draw them. Every tree stands on the ground as its terrain tile is drawn.

/** Metres across a tile of trees. */
const TILE = 100;
/** A unit tree is this tall, matching the collider height in World.placeTrees. */
export const TREE_HEIGHT = 7;
const HEIGHT = TREE_HEIGHT;
const WHORLS = 13;
/** How far the wind leans a crown's top, per unit of the wind's push. */
export const SWAY = 0.35;
/** Metres from the camera over which a tree dissolves from full into its impostor. */
export const FADE_START = 110;
export const FADE_END = 140;
/** A tile draws its full trees while its nearest edge is within this of the camera, a little past FADE_END. */
const TILE_REACH = FADE_END + 5;

interface Tile {
  x: number;
  z: number;
  near: boolean;
  meshes: THREE.InstancedMesh[];
}

/**
 * Where each tree is between full (0) and impostor (1), with `vTreeFade`, and
 * a screen-space dither the two share, so their pixels add up to one tree.
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

export class Trees {
  readonly group = new THREE.Group();
  private readonly tiles: Tile[] = [];
  private readonly world: World;
  /** Each tree's needles' colour, for its impostor. */
  private readonly colors: THREE.Color[];
  /** One tree at the origin, still and in plain materials, for baking the impostors' pictures. */
  private readonly unit: TreeParts;
  private impostors: Impostors | null = null;

  constructor(world: World) {
    this.world = world;
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.3, HEIGHT - 0.8, 7).translate(0, (HEIGHT - 0.8) / 2, 0);
    const coreGeo = core(mulberry32(world.seed + 19));
    const cardGeo = branches(mulberry32(world.seed + 21));
    const trunkMat = full(new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), world);
    const coreMat = full(swaying(new THREE.MeshStandardMaterial({ roughness: 0.95 })), world);
    const branchMap = branchTexture();
    const cardMat = full(swaying(new THREE.MeshStandardMaterial({ map: branchMap, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 })), world);
    // Shadows sway with the crowns, and hand over to the impostors' halfway through the fade.
    const depth = (map?: THREE.Texture) => full(swaying(new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, ...(map ? { map, alphaTest: 0.45 } : {}),
    })), world, true);
    const trunkDepth = full(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), world, true);
    const coreDepth = depth();
    const cardDepth = depth(branchMap);

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

    const rand = mulberry32(world.seed + 17);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    // Every tree's look is drawn in world order, so tiling doesn't change them.
    const looks = world.trees.map(() => ({ turn: rand() * Math.PI * 2, hue: rand(), light: rand() }));
    const cardColor = (look: { hue: number; light: number }) =>
      c.setHSL(0.22 + look.hue * 0.08, 0.35 + look.light * 0.2, 0.7 + look.light * 0.15, THREE.SRGBColorSpace);
    for (const [key, ids] of byTile) {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, ids.length);
      const cores = new THREE.InstancedMesh(coreGeo, coreMat, ids.length);
      const cards = new THREE.InstancedMesh(cardGeo, cardMat, ids.length);
      ids.forEach((id, i) => {
        const t = world.trees[id];
        const look = looks[id];
        q.setFromAxisAngle(up, look.turn);
        m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        trunks.setMatrixAt(i, m);
        cores.setMatrixAt(i, m);
        cards.setMatrixAt(i, m);
        cards.setColorAt(i, cardColor(look));
        cores.setColorAt(i, c.setHSL(0.27 + look.hue * 0.05, 0.45, 0.14 + look.light * 0.05, THREE.SRGBColorSpace));
      });
      const meshes = [trunks, cores, cards];
      trunks.customDepthMaterial = trunkDepth;
      cores.customDepthMaterial = coreDepth;
      cards.customDepthMaterial = cardDepth;
      for (const mesh of meshes) {
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
      const tx = key % n;
      const tz = Math.floor(key / n);
      this.tiles.push({ x: -world.half + (tx + 0.5) * TILE, z: -world.half + (tz + 0.5) * TILE, near: true, meshes });
    }

    this.unit = {
      trunk: trunkGeo, core: coreGeo, cards: cardGeo, map: branchMap,
      coreColor: new THREE.Color().setHSL(0.28, 0.45, 0.16, THREE.SRGBColorSpace),
      trunkColor: new THREE.Color(0x4a3526),
    };
    this.colors = looks.map((look) => cardColor(look).clone());
  }

  applyAssets(assets: Assets): void {
    const bark = full(surfaceMaterial(assets, { kind: 'fixed', layer: Layer.bark }, { roughness: 0.95 }, 1.5), this.world);
    for (const t of this.tiles) t.meshes[0].material = bark;
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

  /** Draw full trees only in the tiles that reach into their range from `eye`. */
  update(eye: THREE.Vector3): void {
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
  trunk: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
  cards: THREE.BufferGeometry;
  /** The branch cards' picture. */
  map: THREE.Texture;
  coreColor: THREE.Color;
  trunkColor: THREE.Color;
}

/**
 * A full tree's material: stood on its terrain tile, and dissolving pixel by
 * pixel as it fades into its impostor. In the shadow pass (`shadow`) a tree
 * hands its shadow over whole, halfway through the fade.
 */
function full<M extends THREE.Material>(material: M, world: World, shadow = false): M {
  onTiles(material, world);
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.treeEye = groundEye;
    shader.uniforms.treeFade = treeFade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${treeFadeGlsl(!shadow)}`)
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vTreeFade = smoothstep(treeFade.x, treeFade.y, distance(instanceMatrix[3].xz, treeEye.xz));
        #else
          vTreeFade = 0.0;
        #endif`)
      // Gone altogether: every vertex off screen, so it draws no pixels.
      .replace('#include <project_vertex>', /* glsl */ `
        #include <project_vertex>
        if (vTreeFade >= ${shadow ? '0.5' : '1.0'}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    if (!shadow) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${treeFadeGlsl()}`)
        .replace('#include <clipping_planes_fragment>', /* glsl */ `
          if (treeDither(gl_FragCoord.xy) < vTreeFade) discard;
          #include <clipping_planes_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `${key}-full-tree-${shadow}`;
  return material;
}

/** Crowns lean with the wind, more toward the top. */
function swaying<M extends THREE.MeshStandardMaterial | THREE.MeshDepthMaterial>(material: M): M {
  material.onBeforeCompile = (shader) => {
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
  material.customProgramCacheKey = () => `tree-sway-${material.map ? 'cards' : 'core'}`;
  return material;
}

/** Dark cones filling the middle of the crown, so it doesn't look hollow between the cards. */
function core(rand: () => number): THREE.BufferGeometry {
  const tiers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    const r = 1.35 - f * 0.9;
    const h = 2.4 - f * 0.8;
    const tier = new THREE.ConeGeometry(r, h, 9, 1, true).translate(0, 2.2 + f * 3.4 + h / 2, 0);
    tier.rotateY(rand() * Math.PI);
    tiers.push(tier.toNonIndexed());
  }
  const geo = mergeGeometries(tiers);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Whorls of branch cards, longest at the bottom, drooping and rolled at random.
 * Normals point out from the crown's middle, so it lights as one soft mass.
 */
function branches(rand: () => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const corner = new THREE.Vector3();
  const centre = new THREE.Vector3();
  for (let w = 0; w < WHORLS; w++) {
    const f = w / (WHORLS - 1);
    const y = 1.9 + f * (HEIGHT - 2.3);
    const length = 2.3 * (1 - f) + 0.55;
    const count = f > 0.8 ? 4 : 7 + Math.floor(rand() * 2);
    const turn = rand() * Math.PI * 2;
    for (let b = 0; b < count; b++) {
      const a = turn + (b / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const droop = 0.25 + rand() * 0.3 + (1 - f) * 0.15;
      dir.set(Math.cos(a), -droop, Math.sin(a)).normalize();
      side.crossVectors(dir, up).normalize().applyAxisAngle(dir, (rand() - 0.5) * 2);
      const width = length * 0.9;
      const base = pos.length / 3;
      centre.set(0, y - length * 0.2, 0);
      for (const [along, across] of [[0, -1], [0, 1], [1, -1], [1, 1]] as const) {
        corner.copy(dir).multiplyScalar(along * length).addScaledVector(side, (across * width) / 2);
        corner.y += y;
        pos.push(corner.x, corner.y, corner.z);
        const out = corner.clone().sub(centre).normalize();
        nrm.push(out.x, out.y, out.z);
        uv.push(along, (across + 1) / 2);
      }
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** A fir branch seen from above: a stem, side twigs and dense needles, on transparent. */
function branchTexture(): THREE.Texture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const rand = mulberry32(7);
  const needle = (x: number, y: number, angle: number, len: number): void => {
    g.strokeStyle = `hsl(${95 + rand() * 25}, ${35 + rand() * 20}%, ${24 + rand() * 16}%)`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    g.stroke();
  };
  const twig = (x0: number, y0: number, angle: number, len: number, width: number): void => {
    g.lineWidth = width;
    g.strokeStyle = '#3b2f22';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len);
    g.stroke();
    g.lineWidth = 1.6;
    for (let s = 0; s < len; s += 1.6) {
      const x = x0 + Math.cos(angle) * s;
      const y = y0 + Math.sin(angle) * s;
      // Needles shorten toward the tip.
      const n = 9 * (1 - (s / len) * 0.5);
      needle(x, y, angle - 1.0 - rand() * 0.4, n * (0.7 + rand() * 0.5));
      needle(x, y, angle + 1.0 + rand() * 0.4, n * (0.7 + rand() * 0.5));
    }
  };
  g.lineCap = 'round';
  // The stem runs along u from the trunk to the tip; twigs taper the outline.
  for (let s = 12; s < w - 30; s += 14 + rand() * 8) {
    const room = (h / 2) * (1 - s / w) * 0.85;
    twig(s, h / 2, -0.55 - rand() * 0.3, room * (0.8 + rand() * 0.4), 1.4);
    twig(s, h / 2, 0.55 + rand() * 0.3, room * (0.8 + rand() * 0.4), 1.4);
  }
  twig(0, h / 2, 0, w - 8, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
