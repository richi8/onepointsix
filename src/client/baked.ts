import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Many parts drawn as one. Meshes merged into one geometry each keep their own
// colour, roughness and metalness in its vertices, and a material patched by
// vertexSurfaces reads them from there, so a soldier or a gun costs one draw
// call in each pass rather than one a part.

/** A part: its geometry, already placed, and the look it had as a mesh of its own. */
export interface Part {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  roughness: number;
  metalness: number;
}

/**
 * Merge `parts` into one geometry with each one's look in its vertices
 * (`color` and `surface`: roughness and metalness). Only the position, the
 * normal and the attributes named in `keep` are kept, and those must be of
 * the same type in every part.
 */
export function mergeParts(parts: readonly Part[], keep: readonly string[] = []): THREE.BufferGeometry {
  const pieces = parts.map((p) => {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', ...keep]) {
      const a = p.geometry.getAttribute(name);
      if (!a) throw new Error(`Part has no ${name}`);
      g.setAttribute(name, a);
    }
    const n = g.getAttribute('position').count;
    const index = p.geometry.getIndex();
    g.setIndex(index ? Array.from(index.array) : Array.from({ length: n }, (_, i) => i));
    const color = new Float32Array(n * 3);
    const surface = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      p.color.toArray(color, i * 3);
      surface[i * 2] = p.roughness;
      surface[i * 2 + 1] = p.metalness;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('surface', new THREE.BufferAttribute(surface, 2));
    return g;
  });
  const merged = mergeGeometries(pieces);
  if (!merged) throw new Error('Parts could not be merged');
  merged.computeBoundingSphere();
  return merged;
}

/**
 * A mesh's geometry placed by `matrix`, with its material's look. Its
 * position and normal are made plain floats first: models may store them as
 * quantized integers, which neither move nor merge with other parts.
 */
export function partOf(mesh: THREE.Mesh, matrix: THREE.Matrix4): Part {
  const m = mesh.material as THREE.MeshStandardMaterial;
  const geometry = mesh.geometry.clone();
  for (const name of ['position', 'normal']) geometry.setAttribute(name, floats(geometry.getAttribute(name)));
  return { geometry: geometry.applyMatrix4(matrix), color: m.color.clone(), roughness: m.roughness, metalness: m.metalness };
}

/** An attribute's values as plain floats, whatever it stores them as. */
export function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, a.itemSize);
}

/** A part made in code: `hex` is an sRGB colour, as materials take them. */
export function part(geometry: THREE.BufferGeometry, hex: number, roughness: number, metalness = 0): Part {
  return { geometry, color: new THREE.Color(hex), roughness, metalness };
}

/**
 * Patch `material` to take its colour, roughness and metalness from the
 * vertices of a merged geometry, on top of whatever patch it already has.
 */
export function vertexSurfaces<M extends THREE.MeshStandardMaterial>(material: M): M {
  material.vertexColors = true;
  material.color.setRGB(1, 1, 1);
  material.roughness = 1;
  material.metalness = 1;
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 surface;\nvarying vec2 vSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = surface;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSurface;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vSurface.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vSurface.y;');
  };
  material.customProgramCacheKey = () => `${key()}-surfaces`;
  return material;
}
