import * as THREE from 'three';
import type { BagSnap } from '../shared/protocol.ts';
import { Soak, wetMaterial, type Shelter } from './rain.ts';
import { REFLECTED } from './water.ts';

// Bags on the ground, left by bodies or dropped: a placeholder duffel until chunk 9.

const geometry = new THREE.BoxGeometry(0.6, 0.35, 0.4).translate(0, 0.175, 0);
const COLOR = 0x3d4a2f;

interface Bag {
  mesh: THREE.Mesh;
  soak: Soak;
}

export class Bags {
  /** Whether it's raining and where a roof keeps it off, for how wet the bags are. */
  shelter: Shelter | null = null;
  /** How wet the body nearest a point is, if one is near: a bag left by a body is as wet as it. */
  soakNear: ((x: number, y: number, z: number) => number | null) | null = null;
  private readonly scene: THREE.Scene;
  private readonly bags = new Map<number, Bag>();
  /** One gone bag's material, never freed, so the shader they share isn't compiled again for the next. */
  private kept: THREE.Material | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(bags: readonly BagSnap[], dt = 0): void {
    const seen = new Set<number>();
    for (const b of bags) {
      seen.add(b.id);
      let bag = this.bags.get(b.id);
      if (!bag) {
        const soak = new Soak();
        const left = this.shelter?.raining ? this.soakNear?.(b.x, b.y, b.z) : null;
        if (left != null) soak.begin(left);
        // Each its own material, for how wet it is; they share one shader.
        const mesh = new THREE.Mesh(geometry, wetMaterial(new THREE.MeshStandardMaterial({ color: COLOR, roughness: 0.9 }), { gloss: 0.55, soak: soak.level }));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.layers.enable(REFLECTED);
        // Each lies at its own angle.
        mesh.rotation.y = (b.id * 2.39996) % (Math.PI * 2);
        bag = { mesh, soak };
        this.bags.set(b.id, bag);
        this.scene.add(mesh);
      }
      bag.mesh.position.set(b.x, b.y, b.z);
      bag.soak.update(this.shelter, b.x, b.y + 0.2, b.z, dt);
    }
    for (const [id, bag] of this.bags) {
      if (seen.has(id)) continue;
      this.scene.remove(bag.mesh);
      if (!this.kept) this.kept = bag.mesh.material as THREE.Material;
      else (bag.mesh.material as THREE.Material).dispose();
      this.bags.delete(id);
    }
  }
}
