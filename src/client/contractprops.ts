import * as THREE from 'three';
import type { ContractView } from '../shared/protocol.ts';
import type { World } from '../shared/world.ts';

// What your contracts look like on the island: a radio case with the intel on
// the watchtower, and red straps around the supply cache. Only you see yours.

const CASE = new THREE.MeshStandardMaterial({ color: 0x3f4a32, roughness: 0.8 });
const CASE_LID = new THREE.MeshStandardMaterial({ color: 0x2c3324, roughness: 0.6, metalness: 0.2 });
const STRAP = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.7 });
/** How far the straps stand off the crate's sides. */
const STRAP_OUT = 0.02;

export class ContractProps {
  private readonly group = new THREE.Group();
  private world: World;
  /** What's built, so it's only rebuilt on change. */
  private shown = '';

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    scene.add(this.group);
  }

  /** Show another island's contracts from now on. */
  setWorld(world: World): void {
    this.world = world;
    this.update([]);
  }

  /** Call once per frame with the open run's contracts, or none. */
  update(contracts: readonly ContractView[]): void {
    const open = contracts.filter((c) => c.state === 'open' && c.kind !== 'commander');
    const key = open.map((c) => `${c.kind}${c.x},${c.z},${c.panel >= 0 && this.world.panels[c.panel].box.gone}`).join('|');
    if (key === this.shown) return;
    this.shown = key;
    for (const child of this.group.children) (child as THREE.Mesh).geometry?.dispose();
    this.group.clear();
    for (const c of open) {
      if (c.kind === 'intel') this.group.add(...intelCase(c.x, c.y, c.z));
      else if (c.panel >= 0 && !this.world.panels[c.panel].box.gone) this.group.add(...straps(this.world.panels[c.panel].box));
    }
  }
}

function block(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** A field radio case lying on the floor at (x, y, z), with its antenna up. */
function intelCase(x: number, y: number, z: number): THREE.Mesh[] {
  return [
    block(0.5, 0.2, 0.34, CASE, x, y + 0.1, z),
    block(0.52, 0.04, 0.36, CASE_LID, x, y + 0.22, z),
    block(0.015, 0.6, 0.015, CASE_LID, x + 0.2, y + 0.54, z - 0.12),
  ];
}

/** Two straps around a crate, one each way. */
function straps(b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): THREE.Mesh[] {
  const w = b.maxX - b.minX + STRAP_OUT * 2;
  const h = b.maxY - b.minY + STRAP_OUT * 2;
  const d = b.maxZ - b.minZ + STRAP_OUT * 2;
  const x = (b.minX + b.maxX) / 2;
  const y = (b.minY + b.maxY) / 2;
  const z = (b.minZ + b.maxZ) / 2;
  return [block(w, h, 0.08, STRAP, x, y, z), block(0.08, h, d, STRAP, x, y, z)];
}
