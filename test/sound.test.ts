import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WATER_LEVEL } from '../src/shared/constants.ts';
import { World } from '../src/shared/world.ts';
import { GROUND_LAYERS, groundLayerAt, groundWeights, terrainNormalsY } from '../src/client/ground.ts';
import { enclosure, nearestWater, occlusion, woodland } from '../src/client/hearing.ts';
import { Layer } from '../src/client/layers.ts';
import { SOUNDS, type SoundBank } from '../src/client/soundlist.ts';
import packed from '../public/assets/sounds.json';
import { Surfaces } from '../src/client/surface.ts';
import { VoicePool } from '../src/client/voices.ts';

const world = new World(1);
const n = world.res + 1;

describe('ground paint', () => {
  it('works out vertex normals the way three.js does for the terrain mesh', () => {
    // Built the way WorldView builds it.
    const pos = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      pos[i * 3] = -world.half + (i % n) * world.cell;
      pos[i * 3 + 1] = world.heights[i];
      pos[i * 3 + 2] = -world.half + Math.floor(i / n) * world.cell;
    }
    const index: number[] = [];
    for (let iz = 0; iz < world.res; iz++) {
      for (let ix = 0; ix < world.res; ix++) {
        const a = iz * n + ix;
        index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const ours = terrainNormalsY(world);
    const theirs = geo.getAttribute('normal');
    let worst = 0;
    for (let i = 0; i < n * n; i++) worst = Math.max(worst, Math.abs(ours[i] - theirs.getY(i)));
    expect(worst).toBeLessThan(1e-4);
  });

  it('sounds like the layer painted strongest at each vertex', () => {
    const W = groundWeights(world);
    for (let i = 0; i < n * n; i += 97) {
      const w = Array.from(W.subarray(i * GROUND_LAYERS, (i + 1) * GROUND_LAYERS));
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
      const x = -world.half + (i % n) * world.cell;
      const z = -world.half + Math.floor(i / n) * world.cell;
      if (x >= world.half || z >= world.half) continue;
      expect(w[groundLayerAt(world, x, z)]).toBe(Math.max(...w));
    }
  });

  it('gives dirt in outposts, sand on beaches and water in the sea', () => {
    const surfaces = new Surfaces(world);
    const o = world.outposts[0];
    // The middle of an outpost, on the ground rather than a prop.
    const y = world.terrainHeight(o.x, o.z);
    expect(groundLayerAt(world, o.x, o.z)).toBe(Layer.dirt);
    expect(['dirt', 'wood', 'concrete', 'metal']).toContain(surfaces.at(o.x, y, o.z));

    let beach = 0;
    let sandy = 0;
    let sea = 0;
    for (let x = -world.half; x < world.half; x += 7) {
      for (let z = -world.half; z < world.half; z += 7) {
        const h = world.terrainHeight(x, z);
        if (h < WATER_LEVEL - 0.5) {
          expect(surfaces.at(x, world.floorHeight(x, z), z)).toBe('water');
          sea++;
        } else if (h > 0.2 && h < 0.6) {
          // Mostly sand, except where a cliff comes down to the sea and is painted rock.
          if (surfaces.at(x, h, z) === 'sand') sandy++;
          beach++;
        }
      }
    }
    expect(beach).toBeGreaterThan(20);
    expect(sandy / beach).toBeGreaterThan(0.7);
    expect(sea).toBeGreaterThan(20);
  });
});

describe('hearing', () => {
  it('is muffled by a wall between, and clear without one', () => {
    const wall = world.walls[0];
    const cx = (wall.minX + wall.maxX) / 2;
    const cz = (wall.minZ + wall.maxZ) / 2;
    const y = (wall.minY + wall.maxY) / 2;
    // Either side of the wall, across its thin axis.
    const alongX = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    const a = alongX ? { x: cx, y, z: wall.minZ - 3 } : { x: wall.minX - 3, y, z: cz };
    const b = alongX ? { x: cx, y, z: wall.maxZ + 3 } : { x: wall.maxX + 3, y, z: cz };
    expect(occlusion(world, a, b)).toBeGreaterThan(0);
    expect(occlusion(world, a, a)).toBe(0);
    // Straight out to sea from a point well above it, nothing is in the way.
    const up = { x: 0, y: world.maxHeight + 20, z: 0 };
    expect(occlusion(world, up, { x: 10, y: world.maxHeight + 20, z: 10 })).toBe(0);
  });

  it('rings more beside a wall than out at sea', () => {
    const wall = world.walls[0];
    const beside = { x: wall.minX - 1, y: wall.minY + 1.6, z: (wall.minZ + wall.maxZ) / 2 };
    const sea = { x: -world.half + 5, y: WATER_LEVEL + 1.6, z: -world.half + 5 };
    expect(enclosure(world, sea)).toBe(0);
    expect(enclosure(world, beside)).toBeGreaterThan(0.05);
  });

  it('finds the sea nearby from the shore, and further from inland', () => {
    const sea = nearestWater(world, -world.half + 5, -world.half + 5);
    expect(sea?.dist).toBe(0);
    const o = world.outposts[0];
    const inland = nearestWater(world, o.x, o.z);
    expect(inland === null || inland.dist > 0).toBe(true);
  });

  it('hears birds among the trees', () => {
    const t = world.trees[0];
    expect(woodland(world, t.x, t.z)).toBeGreaterThan(0);
    expect(woodland(world, -world.half + 5, -world.half + 5)).toBe(0);
  });
});

describe('voice pool', () => {
  it('uses free voices first, then cuts off the quietest', () => {
    const pool = new VoicePool(['a', 'b']);
    expect(pool.take(0, 1, 0.5)).toEqual({ voice: 'a', stolen: false });
    expect(pool.take(0.1, 2, 0.2)).toEqual({ voice: 'b', stolen: false });
    expect(pool.busy(0.5)).toBe(2);
    // Quieter than both: not played.
    expect(pool.take(0.5, 3, 0.1)).toBeNull();
    expect(pool.take(0.5, 3, 0.9)).toEqual({ voice: 'b', stolen: true });
    // 'a' ends at 1, so it's free again after.
    expect(pool.take(1.5, 4, 0.1)).toEqual({ voice: 'a', stolen: false });
  });
});

describe('sound bank', () => {
  const bank = packed as unknown as SoundBank;

  it('holds every listed sound, with its variations', () => {
    for (const s of SOUNDS) {
      const clips = bank.clips[s.name];
      expect(clips, s.name).toBeDefined();
      expect(clips.length).toBe(s.kind === 'steps' ? s.count : 1);
    }
    expect(Object.keys(bank.clips).length).toBe(SOUNDS.length);
  });

  it('keeps the clips apart in the packed file', () => {
    const all = Object.values(bank.clips).flat().sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < all.length; i++) expect(all[i][0]).toBeGreaterThan(all[i - 1][0] + all[i - 1][1]);
  });
});
