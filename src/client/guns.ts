import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

// The gun models come in their own sizes and poses. Each is fitted the same
// way: barrel along -z, the sight line on y = 0 and the grip at z = 0. Where
// the hands go comes from points marked on each model (see GUNS in
// scripts/fetch-assets.mjs): empty nodes named Grip, Support, Muzzle, Sight,
// Magazine and Bolt.

interface Fit {
  /** Metres from butt to muzzle. */
  length: number;
  /** Metres the eye sits above the Sight mark, for an added optic. */
  raise: number;
}

/** In WEAPONS order. */
const FITS: Fit[] = [
  // A flat-top carbine: a red dot goes on the rail.
  { length: 0.85, raise: 0.033 },
  // Sized for the fist rather than to a real pistol's length: the model's grip is short for its slide.
  { length: 0.27, raise: 0 },
  // Scoped: the eye looks down the scope.
  { length: 1.1, raise: 0 },
];

export interface FittedGun {
  object: THREE.Object3D;
  muzzle: THREE.Vector3;
  /** Where the palms close: the right hand's, and the left's. */
  grip: THREE.Vector3;
  support: THREE.Vector3;
  /** The base of the magazine (the loading port on the bolt-action), and the part worked to chamber a round. */
  magazine: THREE.Vector3;
  bolt: THREE.Vector3;
}

const MARKS = ['Grip', 'Support', 'Muzzle', 'Sight', 'Magazine', 'Bolt'] as const;

export function fitGun(gltf: GLTF, weapon: number): FittedGun {
  const fit = FITS[weapon];
  const model = gltf.scene.clone();
  model.updateMatrixWorld(true);
  const marks = {} as Record<(typeof MARKS)[number], THREE.Vector3>;
  for (const name of MARKS) {
    const node = model.getObjectByName(name);
    if (!node) throw new Error(`Gun ${weapon} has no ${name} mark`);
    marks[name] = node.getWorldPosition(new THREE.Vector3());
  }
  const box = new THREE.Box3();
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
  });
  const size = box.getSize(new THREE.Vector3());
  const k = fit.length / size.x;
  // Model space: +x runs butt to muzzle, +y up. Fitted: -z runs to the muzzle, and the grip and sight sit on the axes.
  const origin = new THREE.Vector3(marks.Grip.x, marks.Sight.y, (box.min.z + box.max.z) / 2);
  const at = (p: THREE.Vector3): THREE.Vector3 =>
    new THREE.Vector3((p.z - origin.z) * k, (p.y - origin.y) * k - fit.raise, -(p.x - origin.x) * k);

  const inner = new THREE.Group();
  inner.add(model);
  model.scale.multiplyScalar(k);
  model.position.copy(origin).multiplyScalar(-k);
  inner.position.y = -fit.raise;
  inner.rotation.y = Math.PI / 2;
  const object = new THREE.Group();
  object.add(inner);
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const m = mesh.material as THREE.MeshStandardMaterial;
    m.roughness = 0.55;
    m.metalness = 0.35;
  });
  return {
    object, muzzle: at(marks.Muzzle), grip: at(marks.Grip), support: at(marks.Support),
    magazine: at(marks.Magazine), bolt: at(marks.Bolt),
  };
}
