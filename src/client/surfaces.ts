import * as THREE from 'three';
import type { Assets } from './assets.ts';

// PBR surfaces textured in world space, so nothing needs UVs: the island's
// terrain blends five ground layers painted per vertex, and props, rocks and
// trunks project one layer from all three axes. Built on MeshStandardMaterial,
// so lights, shadows and fog work as usual.

/** Metres one repeat of each layer covers, in Layer order. */
const LAYER_SCALE = [3.5, 3, 3, 7, 4, 1.6, 3, 2.2, 2, 2.5];
/** Each layer's colour correction, in Layer order: the withered grass is pale and the sand bright. */
const LAYER_TINT = [
  [1, 1, 1], [0.72, 0.74, 0.55], [1, 1, 1], [1, 1, 1], [0.9, 0.88, 0.82],
  [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1],
].map(([r, g, b]) => new THREE.Vector3(r, g, b));

/**
 * How a material picks its layers:
 * - terrain: weights per vertex in `splatA` (layers 0 to 3) and `splatB` (layer 4).
 * - instanced: one layer per instance, in the instanced attribute `layer`.
 * - fixed: the one layer given.
 */
export type Mapping = { kind: 'terrain' } | { kind: 'instanced' } | { kind: 'fixed'; layer: number };

export function surfaceMaterial(
  assets: Assets, mapping: Mapping, params: THREE.MeshStandardMaterialParameters = {}, bump = 1,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.surfAlbedo = { value: assets.albedo };
    shader.uniforms.surfNormal = { value: assets.normal };
    shader.uniforms.surfScale = { value: LAYER_SCALE };
    shader.uniforms.surfTint = { value: LAYER_TINT };
    shader.uniforms.surfBump = { value: bump };
    const terrain = mapping.kind === 'terrain';
    const layer = mapping.kind === 'fixed' ? `${mapping.layer}.0` : 'vSurfLayer';

    shader.vertexShader = patch(shader.vertexShader, [
      ['#include <common>', /* glsl */ `

        varying vec3 vSurfPos;
        varying vec3 vSurfNormal;
        ${terrain ? 'attribute vec4 splatA; attribute float splatB; varying vec4 vSplatA; varying float vSplatB;' : ''}
        ${mapping.kind === 'instanced' ? 'attribute float layer; varying float vSurfLayer;' : ''}`],
      ['#include <worldpos_vertex>', /* glsl */ `
        {
          vec4 p = vec4(transformed, 1.0);
          vec3 n = objectNormal;
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
            n = mat3(instanceMatrix) * n;
          #endif
          vSurfPos = (modelMatrix * p).xyz;
          vSurfNormal = normalize(mat3(modelMatrix) * n);
        }
        ${terrain ? 'vSplatA = splatA; vSplatB = splatB;' : ''}
        ${mapping.kind === 'instanced' ? 'vSurfLayer = layer;' : ''}`],
    ]);

    shader.fragmentShader = patch(shader.fragmentShader, [
      ['#include <common>', /* glsl */ `
        uniform sampler2DArray surfAlbedo;
        uniform sampler2DArray surfNormal;
        uniform float surfScale[${LAYER_SCALE.length}];
        uniform vec3 surfTint[${LAYER_SCALE.length}];
        uniform float surfBump;
        varying vec3 vSurfPos;
        varying vec3 vSurfNormal;
        ${terrain ? 'varying vec4 vSplatA; varying float vSplatB;' : ''}
        ${mapping.kind === 'instanced' ? 'varying float vSurfLayer;' : ''}
        ${SURFACE_GLSL}`],
      // Replaces the colour map, which these materials don't use.
      ['#include <map_fragment>', /* glsl */ `
        vec4 surfColor = vec4(0.0);
        vec3 surfN = vec3(0.0);
        vec3 wn = normalize(vSurfNormal);
        ${terrain ? TERRAIN_BLEND : `triplanar(${layer}, 1.0, vSurfPos, wn, surfColor, surfN);`}
        diffuseColor *= vec4(surfColor.rgb, 1.0);`, true],
      ['#include <normal_fragment_maps>', /* glsl */ `
        normal = normalize((viewMatrix * vec4(normalize(surfN), 0.0)).xyz);`],
    ]);
  };
  // Every variant compiles its own program.
  material.customProgramCacheKey = () => `surface-${mapping.kind}-${mapping.kind === 'fixed' ? mapping.layer : ''}-${bump}`;
  return material;
}

/**
 * Adds code after each anchor in a shader, or in its place when the third
 * element is true. Fails loudly if three.js ever renames an anchor.
 */
function patch(source: string, edits: [anchor: string, code: string, replace?: boolean][]): string {
  for (const [anchor, code, replace] of edits) {
    if (!source.includes(anchor)) throw new Error(`Shader anchor ${anchor} is missing`);
    source = source.replace(anchor, replace ? code : `${anchor}\n${code}`);
  }
  return source;
}

const SURFACE_GLSL = /* glsl */ `
  // A tangent-space normal from the map, tilted more or less.
  vec3 surfTangent(vec2 uv, float layer) {
    vec3 t = texture(surfNormal, vec3(uv, layer)).xyz * 2.0 - 1.0;
    t.xy *= surfBump;
    return t;
  }

  // Layer projected straight down, for ground. Whiteout-blended with the surface normal.
  void planar(float layer, float w, vec3 p, vec3 n, inout vec4 color, inout vec3 normal) {
    if (w < 0.004) return;
    vec2 uv = p.xz / surfScale[int(layer + 0.5)];
    color += w * texture(surfAlbedo, vec3(uv, layer)) * vec4(surfTint[int(layer + 0.5)], 1.0);
    vec3 t = surfTangent(uv, layer);
    normal += w * vec3(t.x + n.x, abs(t.z) * n.y, t.y + n.z);
  }

  // Layer projected along all three axes, weighted by how squarely each one faces.
  void triplanar(float layer, float w, vec3 p, vec3 n, inout vec4 color, inout vec3 normal) {
    if (w < 0.004) return;
    vec3 bw = pow(abs(n), vec3(6.0));
    bw /= bw.x + bw.y + bw.z;
    vec3 s = sign(n);
    float scale = surfScale[int(layer + 0.5)];
    vec4 c = vec4(0.0);
    vec3 nn = vec3(0.0);
    if (bw.x > 0.01) {
      vec2 uv = vec2(p.z * s.x, p.y) / scale;
      c += bw.x * texture(surfAlbedo, vec3(uv, layer));
      vec3 t = surfTangent(uv, layer);
      t.x *= s.x;
      nn += bw.x * vec3(abs(t.z) * n.x, t.y + n.y, t.x + n.z);
    }
    if (bw.y > 0.01) {
      vec2 uv = vec2(p.x * s.y, p.z) / scale;
      c += bw.y * texture(surfAlbedo, vec3(uv, layer));
      vec3 t = surfTangent(uv, layer);
      t.x *= s.y;
      nn += bw.y * vec3(t.x + n.x, abs(t.z) * n.y, t.y + n.z);
    }
    if (bw.z > 0.01) {
      vec2 uv = vec2(-p.x * s.z, p.y) / scale;
      c += bw.z * texture(surfAlbedo, vec3(uv, layer));
      vec3 t = surfTangent(uv, layer);
      t.x *= -s.z;
      nn += bw.z * vec3(t.x + n.x, t.y + n.y, abs(t.z) * n.z);
    }
    color += w * c * vec4(surfTint[int(layer + 0.5)], 1.0);
    normal += w * nn;
  }
`;

const TERRAIN_BLEND = /* glsl */ `
  // The painted weights, normalized.
  vec4 wa = vSplatA;
  float wb = vSplatB;
  float total = wa.x + wa.y + wa.z + wa.w + wb;
  wa /= total;
  wb /= total;
  planar(0.0, wa.x, vSurfPos, wn, surfColor, surfN);
  planar(1.0, wa.y, vSurfPos, wn, surfColor, surfN);
  planar(2.0, wa.z, vSurfPos, wn, surfColor, surfN);
  triplanar(3.0, wa.w, vSurfPos, wn, surfColor, surfN);
  planar(4.0, wb, vSurfPos, wn, surfColor, surfN);
`;
