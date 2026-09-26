import * as THREE from 'three';
import type { World } from '../shared/world.ts';
import { TREE_HEIGHT } from './trees.ts';

// Far trees as impostors: one card per tree facing the camera, with a picture
// of a full tree baked when they load. They turn to face the sun in the
// shadow pass, so far trees still cast shadows. Loaded lazily by Trees.

/** Half the width of the card, in unit-tree metres: the widest whorl's reach. */
const CARD_HALF = 3.2;
/** The baked picture of a tree, in pixels. */
const BAKE_W = 256;
const BAKE_H = 512;
/**
 * The card faces the sun more squarely than a real crown, which shades
 * itself, so it's darkened to match the full trees beside it.
 */
const IMPOSTOR_SHADE = new THREE.Color(0.4, 0.4, 0.4);

export class Impostors {
  readonly mesh: THREE.InstancedMesh;
  /** Per tree, 1 while its tile is drawn in full and the impostor must hide. */
  readonly hidden: THREE.InstancedBufferAttribute;

  /** A card per tree, standing on its base, tinted with `colors`, the tree's needles'. */
  constructor(world: World, colors: readonly THREE.Color[]) {
    this.hidden = new THREE.InstancedBufferAttribute(new Float32Array(world.trees.length).fill(1), 1);
    const card = new THREE.PlaneGeometry(CARD_HALF * 2, TREE_HEIGHT).translate(0, TREE_HEIGHT / 2, 0);
    card.setAttribute('hidden', this.hidden);
    this.mesh = new THREE.InstancedMesh(card, new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 1, color: IMPOSTOR_SHADE }), world.trees.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    world.trees.forEach((t, i) => {
      this.mesh.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s, t.s)));
      this.mesh.setColorAt(i, colors[i]);
    });
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Bake the picture of `unit`, a tree at the origin, from the side, lit evenly so the scene's own lights can shade the card. */
  bake(renderer: THREE.WebGLRenderer, unit: THREE.Object3D): void {
    const target = new THREE.WebGLRenderTarget(BAKE_W, BAKE_H, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const scene = new THREE.Scene();
    // An ambient light of π gives back each surface's own colour.
    scene.add(unit, new THREE.AmbientLight(0xffffff, Math.PI));
    const camera = new THREE.OrthographicCamera(-CARD_HALF, CARD_HALF, TREE_HEIGHT, 0, -20, 20);
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
    scene.remove(unit);

    const material = this.mesh.material as THREE.MeshStandardMaterial;
    material.map = target.texture;
    material.onBeforeCompile = (shader) => billboard(shader, true);
    material.customProgramCacheKey = () => 'tree-impostor';
    material.needsUpdate = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: target.texture, alphaTest: 0.5 });
    depth.onBeforeCompile = (shader) => billboard(shader, false);
    depth.customProgramCacheKey = () => 'tree-impostor-depth';
    this.mesh.customDepthMaterial = depth;
  }
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
