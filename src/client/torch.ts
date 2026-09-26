import * as THREE from 'three';
import { PISTOL } from '../shared/weapons.ts';

// The flashlight on every gun: a short tube clamped to the right of a long
// gun's fore-end, or under a pistol's barrel. Its lens glows while it's lit,
// and the beam comes from there. Too small to cast a shadow worth drawing,
// and its lens is drawn only while lit, so each costs one draw call.

const LENGTH = 0.09;
const RADIUS = 0.015;
const BODY_GEO = new THREE.CylinderGeometry(RADIUS, RADIUS * 1.2, LENGTH, 12).rotateX(-Math.PI / 2);
/** Facing down the barrel, -z. */
const LENS_GEO = new THREE.CircleGeometry(RADIUS * 1.05, 12).rotateY(Math.PI);
const LENS_ON = new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false });

/** The torch's material; bodies in the world and the gun in your hands each have their own. */
export function torchMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.75, metalness: 0.2 });
}

/** Where on a fitted gun (barrel along -z, grip at the origin) its torch's middle sits. */
export function torchMount(weapon: number, muzzle: THREE.Vector3, support: THREE.Vector3): THREE.Vector3 {
  if (weapon === PISTOL) return new THREE.Vector3(0, muzzle.y - 0.04, muzzle.z + LENGTH / 2 + 0.01);
  // Ahead of the left hand, clear of it.
  const z = Math.min(support.z - 0.08, support.z + (muzzle.z - support.z) * 0.35);
  return new THREE.Vector3(muzzle.x + 0.042, muzzle.y - 0.01, z);
}

/** The lens, where the beam leaves the torch, from its mount. */
export function lensOf(mount: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(mount).setZ(mount.z - LENGTH / 2 - 0.003);
}

export interface Torch {
  object: THREE.Group;
  lens: THREE.Mesh;
}

export function makeTorch(material: THREE.MeshStandardMaterial): Torch {
  const object = new THREE.Group();
  const lens = new THREE.Mesh(LENS_GEO, LENS_ON);
  lens.position.z = -LENGTH / 2 - 0.001;
  lens.visible = false;
  object.add(new THREE.Mesh(BODY_GEO, material), lens);
  return { object, lens };
}

/** Place a torch at its mount on a gun. */
export function mountTorch(torch: Torch, mount: THREE.Vector3): void {
  torch.object.position.copy(mount);
}

export function lightTorch(torch: Torch, on: boolean): void {
  torch.lens.visible = on;
}
