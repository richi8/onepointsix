import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { Layer } from './layers.ts';
import { surfaceMaterial } from './surfaces.ts';
import { WIND_GLSL, wind } from './wind.ts';

// Firs: a trunk, a dark core of cones and whorls of branch cards with needles
// drawn on them, which give the ragged outline. Trees are split into tiles;
// near tiles draw every tree in full, swaying in the wind, and far ones hand
// over to impostors: one card per tree facing the camera, with a picture of
// the full tree baked at startup. Impostors turn to face the sun in the
// shadow pass, so far trees still cast shadows.

/** Metres across a tile of trees. */
const TILE = 100;
/** A unit tree is this tall, matching the collider height in World.placeTrees. */
const HEIGHT = 7;
const WHORLS = 13;
/** A tile's middle within this of the camera draws its trees in full; beyond FAR, as impostors. The gap stops flicker. */
const NEAR = 170;
const FAR = 190;
/** Half the width of the impostor card, in unit-tree metres: the widest whorl's reach. */
const CARD_HALF = 3.2;
/** The baked picture of a tree, in pixels. */
const BAKE_W = 256;
const BAKE_H = 512;
/**
 * The card faces the sun more squarely than a real crown, which shades
 * itself, so it's darkened to match the full trees beside it.
 */
const IMPOSTOR_SHADE = new THREE.Color(0.4, 0.4, 0.4);

interface Tile {
  x: number;
  z: number;
  near: boolean;
  /** The trees in it, by world index. */
  ids: number[];
  meshes: THREE.InstancedMesh[];
}

export class Trees {
  readonly group = new THREE.Group();
  private readonly tiles: Tile[] = [];
  private readonly trunkMat: THREE.MeshStandardMaterial;
  private readonly impostors: THREE.InstancedMesh;
  /** Per tree, 1 while its tile is drawn in full and the impostor must hide. */
  private readonly hidden: THREE.InstancedBufferAttribute;
  private readonly unit: THREE.Group;
  private baked = false;

  constructor(world: World) {
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.3, HEIGHT - 0.8, 7).translate(0, (HEIGHT - 0.8) / 2, 0);
    const coreGeo = core(mulberry32(world.seed + 19));
    const cardGeo = branches(mulberry32(world.seed + 21));
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 });
    const coreMat = swaying(new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    const branchMap = branchTexture();
    const cardMat = swaying(new THREE.MeshStandardMaterial({ map: branchMap, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }));

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
      const trunks = new THREE.InstancedMesh(trunkGeo, this.trunkMat, ids.length);
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
      for (const mesh of meshes) {
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
      const tx = key % n;
      const tz = Math.floor(key / n);
      this.tiles.push({
        x: -world.half + (tx + 0.5) * TILE, z: -world.half + (tz + 0.5) * TILE, near: true, ids, meshes,
      });
    }

    // One of each part at the origin, for baking the impostor's picture.
    this.unit = new THREE.Group();
    const white = new THREE.Color(0xffffff);
    const unitCore = new THREE.InstancedMesh(coreGeo, coreMat, 1);
    const unitCards = new THREE.InstancedMesh(cardGeo, cardMat, 1);
    for (const mesh of [unitCore, unitCards]) mesh.setMatrixAt(0, m.identity());
    unitCore.setColorAt(0, c.setHSL(0.28, 0.45, 0.16, THREE.SRGBColorSpace));
    unitCards.setColorAt(0, white);
    this.unit.add(new THREE.Mesh(trunkGeo, this.trunkMat), unitCore, unitCards);

    // Impostors: a card per tree, standing on its base, tinted like the tree's needles.
    this.hidden = new THREE.InstancedBufferAttribute(new Float32Array(world.trees.length).fill(1), 1);
    const card = new THREE.PlaneGeometry(CARD_HALF * 2, HEIGHT).translate(0, HEIGHT / 2, 0);
    card.setAttribute('hidden', this.hidden);
    this.impostors = new THREE.InstancedMesh(card, new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 1, color: IMPOSTOR_SHADE }), world.trees.length);
    world.trees.forEach((t, i) => {
      this.impostors.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q.identity(), new THREE.Vector3(t.s, t.s, t.s)));
      this.impostors.setColorAt(i, cardColor(looks[i]));
    });
    this.impostors.frustumCulled = false;
    this.impostors.castShadow = true;
    this.impostors.receiveShadow = true;
    this.impostors.visible = false;
    this.group.add(this.impostors);
  }

  applyAssets(assets: Assets): void {
    const bark = surfaceMaterial(assets, { kind: 'fixed', layer: Layer.bark }, { roughness: 0.95 }, 1.5);
    for (const t of this.tiles) t.meshes[0].material = bark;
  }

  /**
   * Bake the impostors' picture of a tree from the side, lit evenly so the
   * scene's own lights can shade the card. Until this runs every tree is
   * drawn in full.
   */
  bake(renderer: THREE.WebGLRenderer): void {
    const target = new THREE.WebGLRenderTarget(BAKE_W, BAKE_H, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const scene = new THREE.Scene();
    // An ambient light of π gives back each surface's own colour.
    scene.add(this.unit, new THREE.AmbientLight(0xffffff, Math.PI));
    const camera = new THREE.OrthographicCamera(-CARD_HALF, CARD_HALF, HEIGHT, 0, -20, 20);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    const was = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x2c3a22, 0);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.setRenderTarget(was);
    renderer.setClearColor(clear, alpha);
    renderer.autoClear = autoClear;
    scene.remove(this.unit);

    const material = this.impostors.material as THREE.MeshStandardMaterial;
    material.map = target.texture;
    material.onBeforeCompile = (shader) => billboard(shader, true);
    material.customProgramCacheKey = () => 'tree-impostor';
    material.needsUpdate = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: target.texture, alphaTest: 0.5 });
    depth.onBeforeCompile = (shader) => billboard(shader, false);
    depth.customProgramCacheKey = () => 'tree-impostor-depth';
    this.impostors.customDepthMaterial = depth;
    this.impostors.visible = true;
    this.baked = true;
  }

  /** Draw near tiles in full and far ones as impostors, as seen from `eye`. */
  update(eye: THREE.Vector3): void {
    if (!this.baked) return;
    let changed = false;
    for (const t of this.tiles) {
      const d = Math.hypot(t.x - eye.x, t.z - eye.z);
      const near = t.near ? d < FAR : d < NEAR;
      if (near === t.near) continue;
      t.near = near;
      changed = true;
      for (const mesh of t.meshes) mesh.visible = near;
      for (const id of t.ids) this.hidden.setX(id, near ? 1 : 0);
    }
    if (changed) this.hidden.needsUpdate = true;
  }
}

/** Crowns lean with the wind, more toward the top. Shadows keep still. */
function swaying(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
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
            vec3 push = windPush(base, windTime) * h * h * 0.35;
            transformed += transpose(mat3(instanceMatrix)) * push / (s * s);
          }
        #endif`);
  };
  material.customProgramCacheKey = () => `tree-sway-${material.map ? 'cards' : 'core'}`;
  return material;
}

/**
 * Turns an instanced card on its base to face the camera round the vertical
 * (the sun's shadow camera, in the shadow pass), hiding it while its tile is
 * drawn in full. With `lit`, its normal leans toward the camera and up, so the
 * sun lights the crown as one mass.
 */
function billboard(shader: THREE.WebGLProgramParametersWithUniforms, lit: boolean): void {
  const edits: [string, string][] = [
    ['#include <common>', /* glsl */ `
      #include <common>
      attribute float hidden;
      // Level from the card's base toward the eye.
      vec3 cardFacing(vec3 base) {
        vec3 e = cameraPosition - base;
        e.y = 0.0;
        return length(e) > 1e-4 ? normalize(e) : vec3(0.0, 0.0, 1.0);
      }`],
    ['#include <begin_vertex>', /* glsl */ `
      float cardScale = length(instanceMatrix[0].xyz) * (1.0 - hidden);
      vec3 cardBase = instanceMatrix[3].xyz;
      vec3 toEye = cardFacing(cardBase);
      vec3 cardRight = vec3(toEye.z, 0.0, -toEye.x);
      vec3 transformed = cardBase + (cardRight * position.x + vec3(0.0, position.y, 0.0)) * cardScale;`],
    ['#include <project_vertex>', /* glsl */ `
      vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
      gl_Position = projectionMatrix * mvPosition;`],
  ];
  if (lit) {
    edits.push(
      ['#include <defaultnormal_vertex>', /* glsl */ `
        vec3 transformedNormal = normalize((viewMatrix * vec4(normalize(cardFacing(instanceMatrix[3].xyz) * 0.6 + vec3(0.0, 1.0, 0.0)), 0.0)).xyz);`],
      ['#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);'],
    );
  }
  for (const [anchor, code] of edits) {
    if (!shader.vertexShader.includes(anchor)) throw new Error(`Shader anchor ${anchor} is missing`);
    shader.vertexShader = shader.vertexShader.replace(anchor, code);
  }
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
