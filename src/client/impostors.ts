import * as THREE from 'three';
import type { World } from '../shared/world.ts';
import { addGroundDrop, groundEye } from './terrain.ts';
import { fadeOf, needles, NEEDLES_WET, swayOf, thickened, treeFadeGlsl, type Planting, type Species } from './trees.ts';
import { WIND_GLSL, wind, windStrength } from './wind.ts';
import { wetMaterial } from './rain.ts';

// Far trees as impostors: one card per tree facing the camera, showing a
// picture of a full tree of its kind, baked when they load. The tree is baked from eight
// sides, its colours in one picture and its surface's facing in another, so
// the card shows the side the camera sees, blended between the two nearest,
// and the scene's lights shade it as they shade the full trees. The crown
// sways as the full trees' do. In the shadow pass the card faces the sun, so
// far trees still cast shadows. Loaded lazily by Trees.

/** Half the width of a spruce's card, in unit-tree metres: the widest whorl's reach. */
export const CARD_HALF = 3.2;
/** Sides the tree is baked from, evenly round it. */
const VIEWS = 8;

export class Impostors {
  readonly mesh: THREE.InstancedMesh;
  private readonly world: World;
  private readonly species: Species;

  /** A card per tree, standing on its base, turned its way and tinted its foliage's colour. */
  constructor(world: World, species: Species, plants: readonly Planting[]) {
    this.world = world;
    this.species = species;
    const card = new THREE.PlaneGeometry(species.half * 2, species.height).translate(0, species.height / 2, 0);
    this.mesh = new THREE.InstancedMesh(card, new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 0.9, envMapIntensity: 0.55 }), Math.max(plants.length, 1));
    this.mesh.count = plants.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    plants.forEach((t, i) => {
      this.mesh.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, t.turn), new THREE.Vector3(t.s, t.s, t.s)));
      this.mesh.setColorAt(i, t.color);
    });
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /**
   * Bake the pictures of the plainer unit tree from each side: its colours,
   * lit evenly so the scene's own lights can shade the card, and its normals.
   */
  bake(renderer: THREE.WebGLRenderer): void {
    const sp = this.species;
    const [BAKE_W, BAKE_H] = sp.bake;
    const unit = { ...sp.far, map: sp.map, woodColor: sp.woodColor };
    const size = { w: BAKE_W * VIEWS, h: BAKE_H };
    const mips = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter } as const;
    const albedo = new THREE.WebGLRenderTarget(size.w, size.h, { type: THREE.HalfFloatType, ...mips });
    const normals = new THREE.WebGLRenderTarget(size.w, size.h, mips);

    const colour = new THREE.Scene();
    // An ambient light of π gives back each surface's own colour.
    colour.add(new THREE.AmbientLight(0xffffff, Math.PI));
    colour.add(
      new THREE.Mesh(unit.wood, opaque(new THREE.MeshStandardMaterial({ color: unit.woodColor, roughness: 1 }))),
      new THREE.Mesh(unit.foliage, opaque(thickened(new THREE.MeshStandardMaterial({
        map: unit.map, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1,
      })))),
    );
    const facing = new THREE.Scene();
    facing.add(new THREE.Mesh(unit.wood, normalMaterial()), new THREE.Mesh(unit.foliage, normalMaterial(unit.map)));

    const reach = Math.max(sp.half, sp.height) * 2 + 6;
    const camera = new THREE.OrthographicCamera(-sp.half, sp.half, sp.height, 0, 0.1, reach * 2);
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    const was = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    // Cleared to what reads as nothing once filtered with the tree's edge: no
    // colour, and a normal of zero length, so both pictures are premultiplied.
    const none = new THREE.Color(0, 0, 0);
    const flat = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace);
    for (const [target, scene, background] of [[albedo, colour, none], [normals, facing, flat]] as const) {
      renderer.setClearColor(background, 0);
      target.scissorTest = true;
      for (let k = 0; k < VIEWS; k++) {
        // View k looks at the tree from angle k round it, as the card's shader picks it.
        const a = (k / VIEWS) * Math.PI * 2;
        camera.position.set(Math.sin(a) * reach, 0, Math.cos(a) * reach);
        camera.lookAt(0, 0, 0);
        target.viewport.set(k * BAKE_W, 0, BAKE_W, BAKE_H);
        target.scissor.copy(target.viewport);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      }
      target.scissorTest = false;
    }
    renderer.setRenderTarget(was);
    renderer.setClearColor(clear, alpha);
    renderer.autoClear = autoClear;
    for (const scene of [colour, facing]) {
      scene.traverse((o) => o instanceof THREE.Mesh && (o.material as THREE.Material).dispose());
    }

    const uniforms = {
      impostorAlbedo: { value: albedo.texture },
      impostorNormal: { value: normals.texture },
      treeEye: groundEye,
      treeFade: fadeOf(sp),
      windTime: wind,
      windStrength,
      treeSway: { value: swayOf(sp) },
      cardSize: { value: new THREE.Vector2(sp.half * 2, sp.height) },
    };
    const material = this.mesh.material as THREE.MeshStandardMaterial;
    material.onBeforeCompile = (shader) => card(shader, uniforms, this.world, true);
    material.customProgramCacheKey = () => 'tree-impostor';
    wetMaterial(needles(material, false), NEEDLES_WET);
    material.needsUpdate = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5 });
    depth.onBeforeCompile = (shader) => card(shader, uniforms, this.world, false);
    depth.customProgramCacheKey = () => 'tree-impostor-depth';
    this.mesh.customDepthMaterial = depth;
  }
}

/** Writes its colour as fully opaque, whatever its alpha, so the baked edges filter as premultiplied. */
function opaque(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = patch(shader.fragmentShader, [['#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a = 1.0;']]);
  };
  return material;
}

/**
 * Writes each surface's normal, in the tree's own frame, as colour. Branch
 * cards keep their normals pointing out from the crown on both sides: from
 * afar the crown should light as one soft mass, where flipping them toward a
 * camera level with the tree darkened the undersides of every whorl.
 */
function normalMaterial(map?: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map ?? null } },
    defines: map ? { USE_CARD_MAP: '' } : {},
    side: map ? THREE.DoubleSide : THREE.FrontSide,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      #ifdef USE_CARD_MAP
        varying vec2 vUv;
      #endif
      void main() {
        vN = normal;
        #ifdef USE_CARD_MAP
          vUv = uv;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec3 vN;
      #ifdef USE_CARD_MAP
        varying vec2 vUv;
      #endif
      void main() {
        #ifdef USE_CARD_MAP
          // Thickened as the colours' picture is (see thickened in trees.ts).
          vec2 texel = vUv * vec2(textureSize(map, 0));
          float mip = max(0.0, 0.5 * log2(max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));
          if (texture2D(map, vUv).a * (1.0 + mip * 0.35) < 0.4) discard;
        #endif
        vec3 n = normalize(vN);
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }`,
  });
}

/**
 * Turns an instanced card on its base to face the camera round the vertical
 * (the sun's shadow camera, in the shadow pass) and picks the two baked views
 * nearest the side it's seen from. It stands on its terrain tile, sways with
 * the full trees, and shows only as far as the full tree has faded into it.
 * With `lit`, it takes its colour and normals from the pictures; otherwise
 * only its outline.
 */
function card(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>, world: World, lit: boolean): void {
  Object.assign(shader.uniforms, uniforms);
  addGroundDrop(shader, world);
  const views = VIEWS.toFixed(1);
  // The shadow pass reads only the outline, so the tree's turn and fade stay in its vertex shader.
  const common = /* glsl */ `
    uniform sampler2D impostorAlbedo;
    uniform sampler2D impostorNormal;
    uniform vec3 treeSway;
    uniform vec2 cardSize;
    varying vec2 vViewUv0;
    varying vec2 vViewUv1;
    varying float vViewMix;
    ${lit ? 'varying ' : ''}vec2 vTreeTurn;
    ${treeFadeGlsl(lit)}
  `;
  const vertex: [string, string][] = [
    ['#include <common>', /* glsl */ `
      #include <common>
      ${common}
      ${WIND_GLSL}
      // Level from the card's base toward the eye.
      vec3 cardFacing(vec3 base) {
        vec3 e = cameraPosition - base;
        e.y = 0.0;
        return length(e) > 1e-4 ? normalize(e) : vec3(0.0, 0.0, 1.0);
      }`],
    ['#include <begin_vertex>', /* glsl */ `
      float cardScale = length(instanceMatrix[0].xyz);
      vec3 cardBase = instanceMatrix[3].xyz;
      cardBase.y += groundDrop(cardBase.xz);
      vTreeFade = smoothstep(treeFade.x, treeFade.y, distance(cardBase.xz, treeEye.xz));
      vec3 toEye = cardFacing(cardBase);
      vec3 cardRight = vec3(toEye.z, 0.0, -toEye.x);
      vec3 transformed = cardBase + (cardRight * position.x + vec3(0.0, position.y, 0.0)) * cardScale;
      // The crown leans as the full tree's does (see trees.ts).
      float h = max(position.y - treeSway.x, 0.0) / treeSway.y;
      transformed += windPush(cardBase, windTime) * h * h * treeSway.z / cardScale;
      // The side seen, in the tree's own frame: its turn undone.
      vTreeTurn = vec2(instanceMatrix[0].x, -instanceMatrix[0].z) / cardScale;
      vec2 local = vec2(vTreeTurn.x * toEye.x - vTreeTurn.y * toEye.z, vTreeTurn.y * toEye.x + vTreeTurn.x * toEye.z);
      float side = mod(atan(local.x, local.y) / ${(2 * Math.PI).toFixed(6)} * ${views} + ${views}, ${views});
      float view0 = floor(side);
      vViewMix = side - view0;
      vec2 cardUv = vec2(position.x / cardSize.x + 0.5, position.y / cardSize.y);
      vViewUv0 = vec2((view0 + cardUv.x) / ${views}, cardUv.y);
      vViewUv1 = vec2((mod(view0 + 1.0, ${views}) + cardUv.x) / ${views}, cardUv.y);`],
    ['#include <project_vertex>', /* glsl */ `
      vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      // Still a full tree here: every vertex off screen.
      if (vTreeFade <= ${lit ? '0.0' : '0.5'}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`],
  ];
  if (lit) {
    vertex.push(
      ['#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize((viewMatrix * vec4(cardFacing(instanceMatrix[3].xyz), 0.0)).xyz);'],
      ['#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);'],
    );
  }
  shader.vertexShader = patch(shader.vertexShader, vertex);
  shader.fragmentShader = patch(shader.fragmentShader, [
    ['#include <common>', `#include <common>\n${common}`],
    ...(lit ? [['#include <clipping_planes_fragment>', /* glsl */ `
      if (treeDither(gl_FragCoord.xy) >= vTreeFade) discard;
      #include <clipping_planes_fragment>`] as [string, string]] : []),
    // The two views blended, each weighted by how much of it is there.
    ['#include <map_fragment>', /* glsl */ `
      vec4 view0 = texture2D(impostorAlbedo, vViewUv0);
      vec4 view1 = texture2D(impostorAlbedo, vViewUv1);
      float cardAlpha = mix(view0.a, view1.a, vViewMix);
      ${lit ? 'diffuseColor.rgb *= mix(view0.rgb, view1.rgb, vViewMix) / max(cardAlpha, 1e-3);' : ''}
      diffuseColor.a = cardAlpha;`],
    ...(lit ? [['#include <normal_fragment_maps>', /* glsl */ `
      {
        vec3 n0 = texture2D(impostorNormal, vViewUv0).xyz * 2.0 - 1.0;
        vec3 n1 = texture2D(impostorNormal, vViewUv1).xyz * 2.0 - 1.0;
        vec3 n = mix(n0, n1, vViewMix);
        n = length(n) > 1e-3 ? normalize(n) : vec3(0.0, 1.0, 0.0);
        // From the tree's frame into the world's, then the view's.
        vec3 world = vec3(vTreeTurn.x * n.x + vTreeTurn.y * n.z, n.y, -vTreeTurn.y * n.x + vTreeTurn.x * n.z);
        normal = normalize((viewMatrix * vec4(world, 0.0)).xyz);
      }`] as [string, string]] : []),
  ]);
}

function patch(source: string, edits: [string, string][]): string {
  for (const [anchor, code] of edits) {
    if (!source.includes(anchor)) throw new Error(`Shader anchor ${anchor} is missing`);
    source = source.replace(anchor, code);
  }
  return source;
}
