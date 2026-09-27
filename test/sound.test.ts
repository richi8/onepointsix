import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WATER_LEVEL } from '../src/shared/constants.ts';
import { World } from '../src/shared/world.ts';
import { GROUND_LAYERS, groundLayerAt, groundWeights, terrainNormalsY } from '../src/shared/ground.ts';
import { enclosure, hear, nearestWater, occlusion, space, through, woodland } from '../src/client/hearing.ts';
import { SoundField } from '../src/client/soundfield.ts';
import { Layer } from '../src/shared/layers.ts';
import { bankLead, EARLY, SOUNDS, type SoundBanks } from '../src/client/soundlist.ts';
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

describe('hearing II', () => {
  // A one-room building on island 1 with a double door in its east wall at x = -180.8, z -93.3 to -91.1.
  const door = world.doors[0];
  const house = world.buildings.find((b) => b.plan === 'one' && door.x > b.minX && door.x < b.maxX + 0.5)!;
  const floor = house.floor;
  // Below the window sills, so the wall is in the way.
  const inside = { x: -183.5, y: floor + 0.7, z: -95.5 };
  const outside = { x: -178.5, y: floor + 0.8, z: -95.8 };

  it('finds the house the tests expect', () => {
    expect(house).toBeDefined();
    expect(door.pair).toBe(1);
  });

  it('lets less through a wall than a tree trunk', () => {
    const t = world.trees[0];
    const y = Math.max(world.terrainHeight(t.x - 3, t.z), world.terrainHeight(t.x + 3, t.z), world.terrainHeight(t.x, t.z)) + 1.5;
    const trunk = through(world, t.x - 3, y, t.z, t.x + 3, y, t.z);
    expect(trunk).toBeGreaterThan(0.05);
    expect(trunk).toBeLessThan(0.4);
    const wall = world.walls[0];
    const cx = (wall.minX + wall.maxX) / 2;
    const cz = (wall.minZ + wall.maxZ) / 2;
    const wy = (wall.minY + wall.maxY) / 2;
    const alongX = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    const [a, b] = alongX ? [[cx, cz - 3], [cx, cz + 3]] : [[wall.minX - 3, cz], [wall.maxX + 3, cz]];
    expect(through(world, a[0], wy, a[1], b[0], wy, b[1])).toBeGreaterThan(0.8);
  });

  it('comes round through an open doorway, and not through a shut one', () => {
    const field = new SoundField(world);
    for (const id of [0, 1]) world.setDoor(id, true);
    field.reset();
    const open = hear(world, field, outside, inside);
    const straight = through(world, outside.x, outside.y, outside.z, inside.x, inside.y, inside.z);
    expect(straight).toBeGreaterThan(0.8);
    expect(open.occ).toBeLessThan(straight);
    // It seems to come from the doorway, and travels further than the straight line.
    expect(Math.hypot(open.x - door.x, open.z - (door.z - door.length))).toBeLessThan(2.5);
    expect(open.d).toBeGreaterThan(Math.hypot(outside.x - inside.x, outside.z - inside.z));

    for (const id of [0, 1]) world.setDoor(id, false);
    field.door(0);
    field.door(1);
    const shut = hear(world, field, outside, inside);
    expect(shut.occ).toBeGreaterThan(open.occ);
    expect(shut.x).toBe(inside.x);
    for (const id of [0, 1]) world.setDoor(id, true);
  });

  it('floods again only once the ear moves a couple of cells, or the world changes', () => {
    const field = new SoundField(world);
    field.route(outside.x, outside.z, inside.x, inside.z);
    field.route(outside.x + 1, outside.z, inside.x, inside.z);
    expect(field.floods).toBe(1);
    field.route(outside.x + 2, outside.z, inside.x, inside.z);
    expect(field.floods).toBe(2);
    field.door(0);
    field.route(outside.x + 2, outside.z, inside.x, inside.z);
    expect(field.floods).toBe(3);
  });

  it('floods the whole reach round the ear within a couple of milliseconds', () => {
    const field = new SoundField(world);
    // Warm the tiles, then time floods from fresh cells.
    field.route(outside.x, outside.z, inside.x, inside.z);
    // The best of three batches, so other tests running alongside don't fail it.
    let best = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const t0 = performance.now();
      for (let i = 1; i <= 10; i++) field.route(outside.x + (batch * 10 + i) * 2, outside.z, inside.x, inside.z);
      best = Math.min(best, (performance.now() - t0) / 10);
    }
    expect(best).toBeLessThan(4);
  });

  it('rings like a room inside, and like the open at sea', () => {
    const room = space(world, { x: (house.minX + house.maxX) / 2, y: floor + 1.6, z: (house.minZ + house.maxZ) / 2 });
    expect(room.room).toBeGreaterThan(0.5);
    expect(room.yard).toBe(0);
    const sea = space(world, { x: -world.half + 5, y: WATER_LEVEL + 1.6, z: -world.half + 5 });
    expect(sea).toEqual({ room: 0, yard: 0, open: 1, walls: 0 });
  });

  it('places the sea on the water from a narrow point, not inland between two shores', () => {
    // A spit of land 8 m wide running north to south.
    const spit = { terrainHeight: (x: number) => (Math.abs(x) < 4 ? 2 : -5) } as unknown as World;
    const sea = nearestWater(spit, 0, 0)!;
    expect(sea.dist).toBe(6);
    expect(Math.abs(sea.x)).toBeGreaterThan(4);
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

describe('sound banks', () => {
  const list = packed as unknown as SoundBanks;
  const clips = Object.assign({}, ...list.banks.map((b) => b.clips)) as SoundBanks['banks'][number]['clips'];

  it('hold every listed sound once, with its variations', () => {
    for (const s of SOUNDS) {
      expect(clips[s.name], s.name).toBeDefined();
      expect(clips[s.name].length).toBe(s.kind === 'steps' ? s.count : 1);
    }
    expect(list.banks.reduce((n, b) => n + Object.keys(b.clips).length, 0)).toBe(SOUNDS.length);
  });

  it('put the early sounds in the early bank', () => {
    const [early, late] = list.banks;
    expect(early.name).toBe('early');
    expect(Object.keys(early.clips).sort()).toEqual([...EARLY].sort());
    expect(Object.keys(late.clips).some((k) => EARLY.has(k))).toBe(false);
    // Your own gun and the ambience are there from the start.
    for (const k of ['rifle', 'pistol', 'bolt', 'wind', 'sea']) expect(early.clips[k], k).toBeDefined();
  });

  it('keep the clips apart in each packed file', () => {
    for (const bank of list.banks) {
      const all = Object.values(bank.clips).flat().sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < all.length; i++) expect(all[i][0]).toBeGreaterThan(all[i - 1][0] + all[i - 1][1]);
      expect(bank.length).toBeGreaterThanOrEqual(Math.max(...all.map(([a, d]) => a + d)));
    }
  });

  it('come as Opus first, then AAC', () => {
    expect(list.formats.map((f) => f.ext)).toEqual(['ogg', 'm4a']);
    // Opus's pre-skip of 312 samples at 48 kHz, and ffmpeg's AAC priming of 1024 at 44.1 kHz.
    expect(list.formats[0].priming).toBeCloseTo(312 / 48000, 4);
    expect(list.formats[1].priming).toBeCloseTo(1024 / 44100, 4);
  });

  it('move the clips past the priming only where the browser left it in', () => {
    const { length } = list.banks[0];
    const priming = 1024 / 44100;
    // Trimmed to the length, as the file says; or every 1024-sample frame, priming and all.
    expect(bankLead(length, priming, length)).toBe(0);
    const frames = Math.ceil((length * 44100 + 1024) / 1024);
    expect(bankLead(length, priming, (frames * 1024) / 44100)).toBe(priming);
    expect(bankLead(length, 0, length + 1)).toBe(0);
  });
});
