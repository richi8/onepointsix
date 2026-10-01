import * as THREE from 'three';
import { RAGDOLL_STEP, type Solid, Tumbler, type Verlet } from './ragdoll.ts';
import { Soak, type Shelter } from './rain.ts';

// Empty magazines dropped in reloads, by everyone, near or far. Each falls,
// bounces and comes to rest as three balls held rigid (see ragdoll.ts),
// stepped on its own fixed clock, onto the ground, the bodies and guns lying
// on it and each other, and lies where it fell for the rest of the game,
// unless too many have fallen since. Each kind is drawn at once, in one
// instanced mesh. Each stays as wet as whoever dropped it, drying under a
// roof.

/** How many lie about at most, the oldest going first. */
const MOST = 400;
/** Half a magazine's thickness. */
const RADIUS = 0.012;

/** One kind of magazine: every one of it lying about, in one draw. */
interface Pile {
  mesh: THREE.InstancedMesh;
  soak: THREE.InstancedBufferAttribute;
  /** What lies in each slot, in order. */
  pieces: Piece[];
}

interface Piece {
  pile: Pile;
  soak: Soak;
  tumbler: Tumbler;
  /** Where it's drawn. */
  matrix: THREE.Matrix4;
  /** The balls' frame when dropped, inverted, and the matrix then. */
  from: THREE.Matrix4;
  start: THREE.Matrix4;
  age: number;
  steps: number;
}

export class Litter {
  private readonly piles = new Map<THREE.BufferGeometry, Pile>();
  /** Every piece, oldest first. */
  private pieces: Piece[] = [];
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Make ready to drop `geometry`, drawn in `material`, made for an instanced
   * soak (see wetMaterial): as a game loads, so its shader compiles then.
   */
  prepare(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    if (this.piles.has(geometry)) return;
    const own = geometry.clone();
    const soak = new THREE.InstancedBufferAttribute(new Float32Array(MOST), 1);
    soak.setUsage(THREE.DynamicDrawUsage);
    own.setAttribute('soakAt', soak);
    const mesh = new THREE.InstancedMesh(own, material, MOST);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    // Strewn all over the island: culled as a whole, it would never be.
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.piles.set(geometry, { mesh, soak, pieces: [] });
  }

  /**
   * Drop `geometry` (made ready by prepare) where `matrix` puts it in the
   * world, at `velocity`, as wet as `wet`, 0 to 1. `points` are three points
   * on it, in the geometry's own space, far enough apart to tell how it
   * turns: its balls.
   */
  drop(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, points: THREE.Vector3[], velocity: THREE.Vector3, wet: number): void {
    const pile = this.piles.get(geometry);
    if (!pile) return;
    if (this.pieces.length >= MOST) this.remove(this.pieces[0]);
    const soak = new Soak();
    soak.begin(wet);
    const now = points.flatMap((p) => p.clone().applyMatrix4(matrix).toArray());
    const before = now.map((v, i) => v - velocity.getComponent(i % 3) * RAGDOLL_STEP);
    const tumbler = new Tumbler(now, before, RADIUS);
    const from = frameOf(tumbler, new THREE.Matrix4()).invert();
    const piece: Piece = { pile, soak, tumbler, matrix: matrix.clone(), from, start: matrix.clone(), age: 0, steps: 0 };
    this.pieces.push(piece);
    pile.pieces.push(piece);
    pile.mesh.count = pile.pieces.length;
    this.draw(piece, pile.pieces.length - 1);
  }

  /**
   * Step what's falling up to now, onto `ground`, the bodies and guns in
   * `lying` and each other; wet or dry as `shelter` says.
   */
  update(dt: number, ground: Solid, lying: readonly Verlet[], shelter: Shelter | null): void {
    const under = this.pieces.some((p) => !p.tumbler.asleep) ? [...lying, ...this.falls] : lying;
    for (const pile of this.piles.values()) {
      pile.pieces.forEach((p, slot) => {
        p.age += dt;
        const e = p.matrix.elements;
        const was = p.soak.level.value;
        p.soak.update(shelter, e[12], e[13] + 0.05, e[14], dt);
        if (p.soak.level.value !== was) {
          pile.soak.setX(slot, p.soak.level.value);
          pile.soak.needsUpdate = true;
        }
        const due = Math.floor(p.age / RAGDOLL_STEP);
        if (p.tumbler.asleep) {
          p.steps = due;
          return;
        }
        for (; p.steps < due; p.steps++) p.tumbler.step(ground, under);
        frameOf(p.tumbler, p.matrix).multiply(p.from).multiply(p.start);
        this.draw(p, slot);
      });
    }
  }

  /** Wake what lies within `reach` of (x, y, z), as when the body under it goes or a blast shakes it. */
  wake(x: number, y: number, z: number, reach: number): void {
    for (const p of this.pieces) {
      const b = p.tumbler.bounds;
      if (p.tumbler.asleep && Math.hypot(b.x - x, b.y - y, b.z - z) < reach + b.r) p.tumbler.wake();
    }
  }

  /** Everything gone, as for a new game. */
  clear(): void {
    for (const pile of this.piles.values()) {
      pile.pieces = [];
      pile.mesh.count = 0;
    }
    this.pieces = [];
  }

  /** Every piece's balls, to throw or wake. */
  get falls(): Tumbler[] {
    return this.pieces.map((p) => p.tumbler);
  }

  /** How many lie about: for tests. */
  get count(): number {
    return this.pieces.length;
  }

  /** Into its slot in its pile's mesh. */
  private draw(p: Piece, slot: number): void {
    p.pile.mesh.setMatrixAt(slot, p.matrix);
    p.pile.mesh.instanceMatrix.needsUpdate = true;
    p.pile.soak.setX(slot, p.soak.level.value);
    p.pile.soak.needsUpdate = true;
  }

  /** Gone: the last of its pile takes its slot. */
  private remove(p: Piece): void {
    this.pieces.splice(this.pieces.indexOf(p), 1);
    const { pieces, mesh } = p.pile;
    const slot = pieces.indexOf(p);
    const last = pieces.pop()!;
    if (last !== p) {
      pieces[slot] = last;
      this.draw(last, slot);
    }
    mesh.count = pieces.length;
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
