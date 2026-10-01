import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Litter } from '../src/client/litter.ts';
import { JOINT, Ragdoll, type Solid } from '../src/client/ragdoll.ts';
import slump from './slump.json' with { type: 'json' };

const FLAT: Solid = {
  floorHeight: () => 0,
  sphereOut: (_x, _y, _z, _r, out) => ((out.x = out.y = out.z = 0), false),
};

const MAG = new THREE.BoxGeometry(0.02, 0.1, 0.06);
const POINTS = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.08, 0), new THREE.Vector3(0, 0, -0.03)];

function litter(): { litter: Litter; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const out = new Litter(scene);
  out.prepare(MAG, new THREE.MeshStandardMaterial());
  return { litter: out, scene };
}

/** Where the piece in `slot` of the only pile is drawn. */
function at(scene: THREE.Scene, slot = 0): THREE.Vector3 {
  const mesh = scene.children[0] as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(slot, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

function settle(l: Litter, lying: Ragdoll[] = []): void {
  for (let i = 0; i < 300; i++) l.update(1 / 60, FLAT, lying, null);
}

describe('dropped magazines', () => {
  it('fall to the ground', () => {
    const { litter: l, scene } = litter();
    l.drop(MAG, new THREE.Matrix4().makeTranslation(0, 1, 0), POINTS, new THREE.Vector3(), 0);
    settle(l);
    expect(at(scene).y).toBeLessThan(0.1);
  });

  it('land on a body lying under them', () => {
    const rag = new Ragdoll(slump.now, slump.before, true);
    while (!rag.asleep) rag.step(FLAT, []);
    // The slump lies on its side: its right shoulder is uppermost.
    const top = JOINT.rShoulder * 3;
    const [x, y, z] = [rag.pos[top], rag.pos[top + 1], rag.pos[top + 2]];
    const { litter: l, scene } = litter();
    // Flat, as one let go of lies in the hand.
    l.drop(MAG, new THREE.Matrix4().makeTranslation(x, y + 0.5, z).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)), POINTS, new THREE.Vector3(), 0);
    settle(l, [rag]);
    expect(at(scene).y).toBeGreaterThan(y);
    // Once the body is cleared away, down it goes.
    l.wake(x, y, z, 1);
    settle(l);
    expect(at(scene).y).toBeLessThan(0.1);
  });

  it('stay all game, the oldest going once there are too many', () => {
    const { litter: l } = litter();
    for (let i = 0; i < 500; i++) l.drop(MAG, new THREE.Matrix4().makeTranslation(i, 1, 0), POINTS, new THREE.Vector3(), 0);
    for (let i = 0; i < 60 * 20; i++) l.update(1, FLAT, [], null);
    expect(l.count).toBe(400);
    l.clear();
    expect(l.count).toBe(0);
  });
});
