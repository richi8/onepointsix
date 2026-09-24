import * as THREE from 'three';
import type { BagSnap } from '../shared/protocol.ts';

// Bags on the ground, left by bodies or dropped: a placeholder duffel until chunk 9.

const geometry = new THREE.BoxGeometry(0.6, 0.35, 0.4).translate(0, 0.175, 0);
const material = new THREE.MeshStandardMaterial({ color: 0x3d4a2f, roughness: 0.9 });

export class Bags {
  private readonly scene: THREE.Scene;
  private readonly meshes = new Map<number, THREE.Mesh>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(bags: readonly BagSnap[]): void {
    const seen = new Set<number>();
    for (const b of bags) {
      seen.add(b.id);
      let mesh = this.meshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = mesh.receiveShadow = true;
        // Each lies at its own angle.
        mesh.rotation.y = (b.id * 2.39996) % (Math.PI * 2);
        this.meshes.set(b.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(b.x, b.y, b.z);
    }
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }
}
