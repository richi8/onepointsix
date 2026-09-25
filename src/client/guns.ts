import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

// The gun models come in their own sizes and poses. Each is fitted the same
// way: barrel along -z, the sight line on y = 0 and the grip at z = 0. Points
// on a model are given as fractions of its bounding box, side-on, measured
// from the stock end and from the bottom.

interface Fit {
  /** Metres from butt to muzzle. */
  length: number;
  /** Where the eye lines up; `raise` lifts it above that, in metres, for an added optic. */
  sight: number;
  raise: number;
  muzzle: number;
  grip: [along: number, up: number];
  support: [along: number, up: number];
}

/** In WEAPONS order. */
const FITS: Fit[] = [
  // A flat-top carbine: a red dot goes on the rail.
  { length: 0.85, sight: 0.93, raise: 0.033, muzzle: 0.76, grip: [0.3, 0.5], support: [0.62, 0.72] },
  { length: 0.22, sight: 1, raise: 0, muzzle: 0.85, grip: [0.14, 0.15], support: [0.16, 0.1] },
  // Scoped: the eye looks down the scope.
  { length: 1.1, sight: 0.89, raise: 0, muzzle: 0.71, grip: [0.3, 0.55], support: [0.55, 0.62] },
];

export interface FittedGun {
  object: THREE.Object3D;
  muzzle: THREE.Vector3;
  /** Where the hands go. */
  grip: THREE.Vector3;
  support: THREE.Vector3;
}

export function fitGun(gltf: GLTF, weapon: number): FittedGun {
  const fit = FITS[weapon];
  const model = gltf.scene.clone();
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const k = fit.length / size.x;
  const height = size.y * k;
  // Model space: +x runs butt to muzzle. Fitted: -z does.
  const at = (along: number, up: number): THREE.Vector3 =>
    new THREE.Vector3(0, (up - fit.sight) * height - fit.raise, -(along - fit.grip[0]) * fit.length);

  const inner = new THREE.Group();
  inner.add(model);
  model.scale.multiplyScalar(k);
  model.position.set(-box.min.x * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
  const object = new THREE.Group();
  object.add(inner);
  inner.rotation.y = Math.PI / 2;
  // After the turn, the butt is at z = 0 and the bottom at y = 0.
  inner.position.set(0, -fit.sight * height - fit.raise, fit.grip[0] * fit.length);
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const m = mesh.material as THREE.MeshStandardMaterial;
    m.roughness = 0.55;
    m.metalness = 0.35;
  });
  return { object, muzzle: at(1, fit.muzzle), grip: at(...fit.grip), support: at(...fit.support) };
}
