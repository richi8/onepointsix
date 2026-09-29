import * as THREE from 'three';
import { PISTOL } from '../shared/weapons.ts';
import { part, type Part } from './baked.ts';

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

const COLOR = 0x121314;
const ROUGHNESS = 0.75;
const METALNESS = 0.2;

/** The torch's material, for the gun in your hands. */
export function torchMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: COLOR, roughness: ROUGHNESS, metalness: METALNESS });
}

/** The torch's body at `mount`, to merge into a gun. */
export function torchPart(mount: THREE.Vector3): Part {
  return part(BODY_GEO.clone().translate(mount.x, mount.y, mount.z), COLOR, ROUGHNESS, METALNESS);
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

/** A torch in `material`, or only its lens without one, for a gun its body is merged into. */
export function makeTorch(material: THREE.MeshStandardMaterial | null): Torch {
  const object = new THREE.Group();
  const lens = new THREE.Mesh(LENS_GEO, LENS_ON);
  lens.position.z = -LENGTH / 2 - 0.001;
  lens.visible = false;
  object.add(lens);
  if (material) object.add(new THREE.Mesh(BODY_GEO, material));
  return { object, lens };
}

/** Place a torch at its mount on a gun. */
export function mountTorch(torch: Torch, mount: THREE.Vector3): void {
  torch.object.position.copy(mount);
}

export function lightTorch(torch: Torch, on: boolean): void {
  torch.lens.visible = on;
}
