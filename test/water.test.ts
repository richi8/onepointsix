import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Water } from '../src/client/water.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// The sea's reflection is drawn only on frames with some sea in view.

const world = new World(DEFAULT_WORLD.seed);
const water = new Water(world);

/** A camera at (x, y, z) looking at (tx, ty, tz), as in play. */
function eye(x: number, y: number, z: number, tx: number, ty: number, tz: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 2000);
  camera.position.set(x, y, z);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld();
  return camera;
}

describe('the sea in view', () => {
  it('is found looking out from a beach', () => {
    expect(water.seaInView(eye(20, 4, 305, 0, 0, 340), 750)).toBe(true);
  });

  it('is not found looking into the quarry from its rim', () => {
    const post = world.outposts[2];
    const x = post.x + 24;
    const z = post.z + 18;
    expect(water.seaInView(eye(x, world.floorHeight(x, z) + 1.6, z, post.x, post.y + 1, post.z), 750)).toBe(false);
  });

  it('is not found looking at the sky', () => {
    expect(water.seaInView(eye(20, 4, 305, 20, 100, 306), 750)).toBe(false);
  });

  it('is not found past the fog', () => {
    expect(water.seaInView(eye(20, 4, 305, 0, 0, 340), 5)).toBe(false);
  });
});
