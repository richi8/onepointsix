import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { levelAt, levelHeight, Terrain } from '../src/client/terrain.ts';
import { waveHeight } from '../src/client/water.ts';
import { WATER_LEVEL } from '../src/shared/constants.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { World } from '../src/shared/world.ts';

const world = new World(3);
const terrain = new Terrain(world);
const tiles = terrain.group.children as THREE.LOD[];

/** Height of a level's surface at (x, z), from its own triangles, or null if (x, z) isn't over it. */
function drawnHeight(lod: THREE.LOD, level: number, x: number, z: number): number | null {
  const geo = (lod.levels[level].object as THREE.Mesh).geometry;
  const pos = geo.getAttribute('position');
  const index = geo.getIndex()!;
  const lx = x - lod.position.x;
  const lz = z - lod.position.z;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const bary = new THREE.Vector3();
  const p = new THREE.Vector3(lx, 0, lz);
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1));
    c.fromBufferAttribute(pos, index.getX(i + 2));
    const ys = [a.y, b.y, c.y];
    a.y = b.y = c.y = 0;
    tri.set(a, b, c);
    if (tri.getArea() < 1e-6 || !tri.containsPoint(p)) continue;
    tri.getBarycoord(p, bary);
    return ys[0] * bary.x + ys[1] * bary.y + ys[2] * bary.z;
  }
  return null;
}

describe('terrain tiles', () => {
  it('cover the island in tiles with three levels each', () => {
    expect(tiles).toHaveLength(25);
    for (const t of tiles) expect(t.levels.map((l) => l.distance)).toEqual([0, 230, 460]);
  });

  it('draw the nearest level exactly where the ground is for collisions', () => {
    const rand = mulberry32(5);
    for (let k = 0; k < 150; k++) {
      const x = (rand() - 0.5) * world.size * 0.98;
      const z = (rand() - 0.5) * world.size * 0.98;
      const lod = tiles.find((t) => Math.abs(t.position.x - x) < 80 && Math.abs(t.position.z - z) < 80)!;
      const h = drawnHeight(lod, 0, x, z);
      expect(h).not.toBeNull();
      expect(h!).toBeCloseTo(world.terrainHeight(x, z), 3);
    }
  });

  it('hang a skirt below every edge, at every level', () => {
    for (const t of tiles.slice(0, 3)) {
      t.levels.forEach((level, i) => {
        const pos = (level.object as THREE.Mesh).geometry.getAttribute('position');
        const m = 40 / [1, 2, 4][i] + 1;
        expect(pos.count).toBe(m * m + 4 * m);
        // Each skirt vertex sits 4 m under the matching edge vertex.
        for (let k = 0; k < m; k++) expect(pos.getY(m * m + k)).toBeCloseTo(pos.getY(k) - 4, 5);
      });
    }
  });
});

describe('what stands on the ground', () => {
  it('finds the height each level draws, so far tiles carry it', () => {
    const rand = mulberry32(8);
    for (let k = 0; k < 60; k++) {
      const x = (rand() - 0.5) * world.size * 0.98;
      const z = (rand() - 0.5) * world.size * 0.98;
      const lod = tiles.find((t) => Math.abs(t.position.x - x) < 80 && Math.abs(t.position.z - z) < 80)!;
      [1, 2, 4].forEach((step, level) => expect(levelHeight(world, x, z, step)).toBeCloseTo(drawnHeight(lod, level, x, z)!, 3));
    }
    // A step of 1 is the exact ground.
    expect(levelHeight(world, 12.3, -45.6, 1)).toBeCloseTo(world.terrainHeight(12.3, -45.6), 6);
  });

  it('picks the level three.js picks for the tile underneath', () => {
    const camera = new THREE.PerspectiveCamera();
    const rand = mulberry32(9);
    for (let k = 0; k < 40; k++) {
      camera.position.set((rand() - 0.5) * 1200, rand() * 80, (rand() - 0.5) * 1200);
      camera.updateMatrixWorld();
      const x = (rand() - 0.5) * world.size * 0.98;
      const z = (rand() - 0.5) * world.size * 0.98;
      const lod = tiles.find((t) => Math.abs(t.position.x - x) <= 80 && Math.abs(t.position.z - z) <= 80)!;
      lod.updateMatrixWorld();
      lod.update(camera);
      expect(levelAt(world, x, z, camera.position)).toBe(lod.getCurrentLevel());
    }
  });
});

describe('waves', () => {
  it('die down on the shore and stay small out at sea', () => {
    for (let t = 0; t < 20; t += 0.7) {
      expect(waveHeight(10, 20, t, 0)).toBe(WATER_LEVEL);
      // Every train at its crest together, the swell included.
      expect(Math.abs(waveHeight(10 * t, -5 * t, t, 30) - WATER_LEVEL)).toBeLessThan(0.31);
    }
    // At wading depth the sea never climbs a crouched player's eye, 1 m over a bed 0.9 m down.
    for (let t = 0; t < 20; t += 0.13) expect(waveHeight(3 * t, t, t, 0.9)).toBeLessThan(0.1);
  });
});
