import * as THREE from 'three';
import type { GrenadeSnap } from '../shared/protocol.ts';

// Live grenades, drawn where the server last had them: a placeholder shape until chunk 9.

const geometry = new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10);
const material = new THREE.MeshStandardMaterial({ color: 0x3f4a33, roughness: 0.6, metalness: 0.3 });

export class Grenades {
  private readonly scene: THREE.Scene;
  private readonly meshes = new Map<number, THREE.Mesh>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(grenades: readonly GrenadeSnap[]): void {
    const seen = new Set<number>();
    for (const g of grenades) {
      seen.add(g.id);
      let mesh = this.meshes.get(g.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        this.meshes.set(g.id, mesh);
        this.scene.add(mesh);
      }
      // Tumbles while it moves.
      const moved = Math.hypot(g.x - mesh.position.x, g.y - mesh.position.y, g.z - mesh.position.z);
      mesh.rotation.x += Math.min(moved, 1) * 8;
      mesh.position.set(g.x, g.y, g.z);
    }
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }
}
