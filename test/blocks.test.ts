import { describe, expect, it } from 'vitest';
import { CALABIANCA_2, onIsland } from '../src/shared/maps/calabianca2.ts';
import { area, standIn } from './calabianca.ts';
import { pavingAt } from '../src/shared/maps/index.ts';
import { World } from '../src/shared/world.ts';
import { doorProps, dressBlocks, dressedBlocks } from '../src/client/blocks.ts';
import { Dressing } from '../src/client/dressing.ts';
import { replacedProps } from '../src/client/features.ts';
import { BAKE_CELL, bake, bakeInput, coveredLamps, SUN_RANGE } from '../src/client/townbake.ts';
import { townLayer } from '../src/client/townlook.ts';
import { Layer } from '../src/shared/layers.ts';
import { Boxes } from '../src/client/townparts.ts';
import * as THREE from 'three';

// The new Calabianca's look (chunk 68): its blocks plastered by part of the
// map and dressed in stone, its doors drawn as wooden leaves, its ground
// paved, its tunnels lit by lamps, and the sea in sight over the parapet.

const world = new World(1, CALABIANCA_2);
const middle = (name: string) => {
  const a = area(name);
  return [(a.minX + a.maxX) / 2, (a.minZ + a.maxZ) / 2] as const;
};

describe('the new Calabianca\'s look', () => {
  it('plasters its blocks by part of the map, and keeps the parapet along the sea and the cover in stone', () => {
    const blocks = dressedBlocks(world);
    const houses = blocks.filter((b) => b.colour !== undefined);
    expect(houses.length).toBeGreaterThan(150);
    expect(new Set(houses.map((b) => b.colour)).size).toBe(5);
    // The rest, stone: low, the parapet along the south edge and the cover.
    const stone = blocks.filter((b) => b.colour === undefined);
    expect(stone.length).toBeGreaterThan(10);
    for (const b of stone) expect(b.y1 - world.terrainHeight((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2), `${b.minX}, ${b.minZ}`).toBeLessThan(12);
    expect(stone.filter((b) => b.minZ > onIsland(0, 960)[1]).length).toBeGreaterThan(5);
    // Its plaster reaches the props, which are textured as plaster.
    const plastered = world.props.map((_, i) => i).filter((i) => world.props[i].colour !== undefined);
    expect(plastered.length).toBeGreaterThan(50);
    for (const i of plastered) expect(townLayer(world, i)).toBe(Layer.plaster);
  });

  it('paves its lanes in flagstones, its squares and sites in cobbles, the pit in earth', () => {
    const at = (name: string) => pavingAt(CALABIANCA_2, ...middle(name));
    expect(at('long A')).toBe('flagstones');
    expect(at('mid')).toBe('flagstones');
    expect(at('T spawn')).toBe('cobbles');
    expect(at('CT spawn')).toBe('cobbles');
    expect(at('B site')).toBe('cobbles');
    expect(at('A site')).toBe('cobbles');
    expect(at('pit')).toBe('earth');
    for (const lane of CALABIANCA_2.lanes!) {
      for (const [x, z] of lane.points) expect(pavingAt(CALABIANCA_2, x, z), lane.name).not.toBeNull();
    }
  });

  it('draws its four pairs of double doors as wooden leaves in place of their boxes, uncapped', () => {
    const doors = doorProps(world);
    expect(doors.size).toBe(8);
    const replaced = replacedProps(world);
    for (const i of doors) expect(replaced.has(i)).toBe(true);
  });

  it('keeps its dressing to the blocks\' faces, but for the lanterns hung from the tunnels\' ceilings', () => {
    const boxes = new Boxes();
    dressBlocks(world, boxes);
    const lamps = coveredLamps(world);
    const blocks = dressedBlocks(world);
    expect(boxes.matrices.length).toBeGreaterThan(2000);
    const at = new THREE.Vector3();
    const size = new THREE.Vector3();
    let stray = 0;
    for (const m of boxes.matrices) {
      at.setFromMatrixPosition(m);
      size.setFromMatrixScale(m);
      if (lamps.some(([x, y, z]) => Math.hypot(at.x - x, at.z - z) < 0.3 && Math.abs(at.y - y) < 0.7)) continue;
      // A turned box's size is its own, not the world's: measured round its middle.
      const reach = Math.hypot(size.x, size.z) / 2;
      const near = blocks.some((b) =>
        at.x - size.x / 2 < b.maxX + 0.2 && at.x + size.x / 2 > b.minX - 0.2 && at.z - size.z / 2 < b.maxZ + 0.2 && at.z + size.z / 2 > b.minZ - 0.2)
        // Or a straightened diagonal wall, or a box drawn as it stands.
        || (CALABIANCA_2.facades ?? []).some((f) => {
          const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
          const t = Math.max(0, Math.min(len, ((at.x - f.x0) * (f.x1 - f.x0) + (at.z - f.z0) * (f.z1 - f.z0)) / len));
          return Math.hypot(at.x - f.x0 - ((f.x1 - f.x0) * t) / len, at.z - f.z0 - ((f.z1 - f.z0) * t) / len) < f.out + f.depth + 0.5;
        })
        || (CALABIANCA_2.stones ?? []).some((t) => Math.hypot(at.x - t.x, at.z - t.z) < Math.hypot(t.width, t.depth) / 2 + 0.2 && reach < Math.hypot(t.width, t.depth));
      if (!near) stray++;
    }
    expect(stray).toBe(0);
  });

  it('dresses a map with no buildings', () => {
    expect(Dressing.build(world)).not.toBeNull();
  });

  it('hangs lamps in its tunnels, out of everyone\'s way', () => {
    const lamps = coveredLamps(world);
    for (const name of ['upper tunnels', 'lower tunnels', 'B tunnels']) {
      const r = area(name);
      const inside = lamps.filter(([x, , z]) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
      expect(inside.length, name).toBeGreaterThan(0);
    }
    for (const [x, y, z] of lamps) {
      // Over a floor with room under it, and hung from a ceiling.
      const floor = Math.max(...world.floorTops(x, z, 0.01).filter((f) => f < y));
      expect(y - 0.2 - floor, `${x}, ${z}`).toBeGreaterThan(2);
      expect(world.ceilingHeight(x, z, y)).toBeLessThan(y + 1);
    }
  });

  it('lights its lower tunnels by their lamps', () => {
    // Baked over 30 m round them alone, as the whole map takes long; with and without the lamps.
    const full = bakeInput(world, () => 0xd8cfc0, [-0.23, 0.75, 0.62])!;
    const p = standIn(world, area('lower tunnels'))!;
    const [i0, k0] = [Math.floor((p.x - 15 - full.x0) / BAKE_CELL), Math.floor((p.z - 15 - full.z0) / BAKE_CELL)];
    const n = Math.round(30 / BAKE_CELL);
    const gw = 2 * full.nx + 1;
    const ground = new Float32Array((2 * n + 1) * (2 * n + 1));
    for (let k = 0; k <= 2 * n; k++) for (let i = 0; i <= 2 * n; i++) ground[k * (2 * n + 1) + i] = full.ground[(2 * k0 + k) * gw + 2 * i0 + i];
    const input = { ...full, x0: full.x0 + i0 * BAKE_CELL, z0: full.z0 + k0 * BAKE_CELL, nx: n, nz: n, ground };
    const dark = bake({ ...input, lamps: new Float32Array() });
    const lit = bake(input);
    const c = (Math.floor((p.z - input.z0) / BAKE_CELL) * input.ny + Math.floor((p.y + 1.5 - input.y0) / BAKE_CELL)) * input.nx + Math.floor((p.x - input.x0) / BAKE_CELL);
    // The sun's bounced on a face looking up, the floor's.
    const up = (b: typeof lit) => (b.skyUpDown[c * 4 + 2] / 255) ** 2 * SUN_RANGE;
    expect(up(lit)).toBeGreaterThan(up(dark) * 4);
  });

  it('lets the attackers\' end see the sea over its parapet', () => {
    // From across the attackers' end, 3 m back from the parapet, looking out.
    for (const u of [150, 250, 350]) {
      const [x, z0] = onIsland(u, 900);
      let z = z0;
      while (world.floorTops(x, z + 0.25, 0.01).length) z += 0.25;
      z -= 3;
      const eye = Math.max(...world.floorTops(x, z, 0.01)) + 1.6;
      // A little down: over the parapet to the sea.
      const d = [0, -Math.sin(0.06), Math.cos(0.06)];
      const t = world.raycast(x, eye, z, d[0], d[1], d[2], 400);
      expect(eye + d[1] * t, `${x}, ${z}`).toBeLessThan(1);
    }
  });
});
