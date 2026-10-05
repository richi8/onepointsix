import * as THREE from 'three';
import type { World } from '../shared/world.ts';

// Edges rounded in the shader, not in the geometry: a box's faces bend their
// normals toward the face round the corner over the last few centimetres
// before an edge, so the edge catches the light as a rounded one does. Each
// instance says how round (in millimetres) and which of its twelve edges
// (one bit each), as `round` = bits + 4096 × millimetres; an edge where two
// boxes meet, as a wall's storeys do, is left sharp, or the seam would show.
// Each part of a shape (see props.ts) is rounded as a box of its own, from
// its half-size and which corner of it each vertex is (roundHalf*, roundSign).

/** Every edge of a box. */
export const ALL_EDGES = 4095;

/** The code for edges `bits` rounded `radius` metres. */
export function roundCode(bits: number, radius: number): number {
  return bits ? bits + 4096 * Math.round(radius * 1000) : 0;
}

/**
 * The bit of the edge between the face of local axis `i` (on its side `si`)
 * and that of axis `j` (on `sj`): edges run along the third axis k, four to
 * each, by the sides of the other two in order.
 */
export function edgeBit(i: number, si: number, j: number, sj: number): number {
  const k = 3 - i - j;
  const [sa, sb] = i < j ? [si, sj] : [sj, si];
  return 1 << (k * 4 + (sa > 0 ? 1 : 0) + (sb > 0 ? 2 : 0));
}

/** How far out from each face, and in along it from the edge, a point is tested for open air. */
const OUT = 0.06;
const IN = 0.04;

/**
 * Which edges of the box drawn by `m` (a unit box's matrix: its middle,
 * turn and size) stand in the open, as bits: those where the air just
 * beyond each of its two faces, and past the corner, is clear of the ground
 * and of everything built, all along it.
 */
export function openEdges(world: World, m: THREE.Matrix4): number {
  const c = new THREE.Vector3().setFromMatrixPosition(m);
  const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  m.extractBasis(axes[0], axes[1], axes[2]);
  const half = axes.map((a) => a.length() / 2);
  for (const a of axes) a.normalize();
  const p = new THREE.Vector3();
  const open = (v: THREE.Vector3) => v.y > world.terrainHeight(v.x, v.z) && world.clearAsBuilt(v.x, v.y - 0.005, v.z, 0.01, 0);
  let bits = 0;
  for (let k = 0; k < 3; k++) {
    const [a, b] = [0, 1, 2].filter((x) => x !== k);
    // Too short to round, or too thin to say.
    if (half[k] < 0.03) continue;
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        let clear = true;
        for (const t of [-0.85, 0, 0.85]) {
          // Kept a little in from its ends.
          const s = t * Math.max(half[k] - 0.05, 0);
          const edge = c.clone().addScaledVector(axes[k], s).addScaledVector(axes[a], sa * half[a]).addScaledVector(axes[b], sb * half[b]);
          const tests = [
            p.copy(edge).addScaledVector(axes[a], sa * OUT).addScaledVector(axes[b], -sb * Math.min(IN, half[b])).clone(),
            p.copy(edge).addScaledVector(axes[b], sb * OUT).addScaledVector(axes[a], -sa * Math.min(IN, half[a])).clone(),
            p.copy(edge).addScaledVector(axes[a], sa * IN).addScaledVector(axes[b], sb * IN).clone(),
          ];
          if (!tests.every(open)) {
            clear = false;
            break;
          }
        }
        if (clear) bits |= edgeBit(a, sa, b, sb);
      }
    }
  }
  return bits;
}

/**
 * Give a geometry of plain unit boxes, centred on the origin (as
 * BoxGeometry(1, 1, 1)), what it needs to be rounded as one box.
 */
export function roundable(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const sign = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) sign[i * 3 + k] = pos.getComponent(i, k) < 0 ? -1 : 1;
  g.setAttribute('roundSign', new THREE.BufferAttribute(sign, 3));
  g.setAttribute('roundHalfF', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
  g.setAttribute('roundHalfM', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  return g;
}

/** GLSL for the vertex shader's declarations. */
export const ROUND_VERTEX_HEAD = /* glsl */ `
  attribute vec3 roundSign;
  attribute vec3 roundHalfF;
  attribute vec3 roundHalfM;
  attribute float round;
  varying vec3 vRoundAt;
  varying vec3 vRoundHalf;
  varying vec3 vRoundN;
  varying vec3 vRoundX;
  varying vec3 vRoundY;
  varying vec3 vRoundZ;
  varying float vRound;
`;

/** GLSL for the vertex shader's body: where on its part the vertex is, in metres, and the instance's axes. */
export const ROUND_VERTEX = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    vec3 sc = max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), vec3(1e-4));
    vec3 hs = abs(roundHalfF * sc + roundHalfM);
    vRoundHalf = hs;
    vRoundAt = roundSign * hs;
    vRoundN = objectNormal;
    mat3 frame = mat3(modelMatrix) * mat3(instanceMatrix[0].xyz / sc.x, instanceMatrix[1].xyz / sc.y, instanceMatrix[2].xyz / sc.z);
    vRoundX = frame[0];
    vRoundY = frame[1];
    vRoundZ = frame[2];
    vRound = round;
  }
  #else
    vRound = 0.0;
  #endif
`;

/** GLSL for the fragment shader's declarations. */
export const ROUND_FRAGMENT_HEAD = /* glsl */ `
  varying vec3 vRoundAt;
  varying vec3 vRoundHalf;
  varying vec3 vRoundN;
  varying vec3 vRoundX;
  varying vec3 vRoundY;
  varying vec3 vRoundZ;
  varying float vRound;

  // The world normal \`wn\` of a box's face bent toward its rounded edges:
  // \`px\` is how many metres a pixel covers, so an edge never rounds over
  // less than a pixel and a half, though no more strongly for it.
  vec3 roundedNormal(vec3 wn, float px) {
    float code = floor(vRound + 0.5);
    float r = floor(code / 4096.0) * 0.001;
    if (r <= 0.0) return wn;
    int bits = int(code - floor(code / 4096.0) * 4096.0);
    vec3 n = vRoundN;
    vec3 an = abs(n);
    int i = an.x > an.y && an.x > an.z ? 0 : an.y > an.z ? 1 : 2;
    float si = n[i] > 0.0 ? 1.0 : -1.0;
    vec3 bent = vec3(0.0);
    float side = 0.0;
    for (int j = 0; j < 3; j++) {
      if (j == i) continue;
      float sj = vRoundAt[j] > 0.0 ? 1.0 : -1.0;
      int k = 3 - i - j;
      float sa = i < j ? si : sj;
      float sb = i < j ? sj : si;
      int bit = k * 4 + (sa > 0.0 ? 1 : 0) + (sb > 0.0 ? 2 : 0);
      if (((bits >> bit) & 1) == 0) continue;
      float rj = min(r, 0.5 * vRoundHalf[j]);
      float re = max(rj, 1.5 * px);
      float d = vRoundHalf[j] - abs(vRoundAt[j]);
      float t = clamp(1.0 - d / re, 0.0, 1.0) * (rj / re);
      bent[j] = sj * t;
      side += t * t;
    }
    if (side <= 0.0) return wn;
    bent[i] = si * sqrt(max(1.0 - side, 0.0));
    return normalize(mat3(vRoundX, vRoundY, vRoundZ) * bent);
  }
`;
