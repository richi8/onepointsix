import * as THREE from 'three';
import { RAGDOLL_STEP, type Solid, Tumbler } from './ragdoll.ts';
import { Soak, type Shelter } from './rain.ts';

// Empty magazines dropped in reloads. Each falls, bounces and comes to rest
// as three balls held rigid (see ragdoll.ts), stepped on its own fixed clock,
// and lies where it fell for a while. They're only for show: nobody else
// sees them where you do, and they don't land on bodies. Each stays as wet
// as whoever dropped it, drying under a roof.

/** How many lie about at most, the oldest going first, and how long each lies. */
const MOST = 40;
const LIFE = 90;
/** Half a magazine's thickness. */
const RADIUS = 0.012;

interface Piece {
  mesh: THREE.Mesh;
  soak: Soak;
  tumbler: Tumbler;
  /** The balls' frame when dropped, inverted, and the mesh's matrix then. */
  from: THREE.Matrix4;
  start: THREE.Matrix4;
  age: number;
  steps: number;
}

export class Litter {
  private readonly pieces: Piece[] = [];
  private readonly scene: THREE.Scene;
  /** One gone piece's material, never freed, so the shader they share isn't compiled again for the next. */
  private kept: THREE.Material | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Drop `geometry`, drawn in a `material` of its own, where `matrix` puts it
   * in the world, at `velocity`, as wet as `wet`, 0 to 1. `points` are three
   * points on it, in the geometry's own space, far enough apart to tell how
   * it turns: its balls.
   */
  drop(
    geometry: THREE.BufferGeometry, material: (soak: { value: number }) => THREE.Material, matrix: THREE.Matrix4,
    points: THREE.Vector3[], velocity: THREE.Vector3, wet: number,
  ): void {
    const soak = new Soak();
    soak.begin(wet);
    const mesh = new THREE.Mesh(geometry, material(soak.level));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    const now = points.flatMap((p) => p.clone().applyMatrix4(matrix).toArray());
    const before = now.map((v, i) => v - velocity.getComponent(i % 3) * RAGDOLL_STEP);
    const tumbler = new Tumbler(now, before, RADIUS);
    const from = frameOf(tumbler, new THREE.Matrix4()).invert();
    this.pieces.push({ mesh, soak, tumbler, from, start: matrix.clone(), age: 0, steps: 0 });
    if (this.pieces.length > MOST) this.remove(0);
  }

  /** Step what's falling up to now, onto `ground`, and clear what has lain long enough; wet or dry as `shelter` says. */
  update(dt: number, ground: Solid, shelter: Shelter | null): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      if (p.age > LIFE) {
        this.remove(i);
        continue;
      }
      const e = p.mesh.matrix.elements;
      p.soak.update(shelter, e[12], e[13] + 0.05, e[14], dt);
      if (p.tumbler.asleep) continue;
      const due = Math.floor(p.age / RAGDOLL_STEP);
      for (; p.steps < due; p.steps++) p.tumbler.step(ground, []);
      frameOf(p.tumbler, p.mesh.matrix).multiply(p.from).multiply(p.start);
      p.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /** Everything gone, as for a new game. */
  clear(): void {
    while (this.pieces.length) this.remove(0);
  }

  private remove(i: number): void {
    const { mesh } = this.pieces[i];
    this.scene.remove(mesh);
    if (!this.kept) this.kept = mesh.material as THREE.Material;
    else (mesh.material as THREE.Material).dispose();
    this.pieces.splice(i, 1);
  }
}

/** The frame of a tumbler's three balls: at the first, along the second, turned up toward the third. */
function frameOf(t: Tumbler, out: THREE.Matrix4): THREE.Matrix4 {
  const p = t.pos;
  const x = V_A.set(p[3] - p[0], p[4] - p[1], p[5] - p[2]).normalize();
  const toward = V_B.set(p[6] - p[0], p[7] - p[1], p[8] - p[2]);
  const z = V_C.crossVectors(x, toward).normalize();
  const y = toward.crossVectors(z, x);
  return out.makeBasis(x, y, z).setPosition(p[0], p[1], p[2]);
}

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
