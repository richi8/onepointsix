import { describe, expect, it } from 'vitest';
import { CALABIANCA_2, PLACES } from '../src/shared/maps/calabianca2.ts';
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
// The plan's metres are moved 44 m west and 208 m south onto the island.

const world = new World(1, CALABIANCA_2);
const [DX, DZ] = [-44, 208];
const place = (name: string) => {
  const i = PLACES.findIndex((p) => p.name === name);
  const p = PLACES[i];
  return { x: (p.minX + p.maxX) / 2 + DX, z: (p.minZ + p.maxZ) / 2 + DZ, y: p.y, ceiling: p.ceiling };
};

describe('the new Calabianca\'s look', () => {
  it('plasters its blocks by part of the map, and keeps the parapet along the sea and the cover in stone', () => {
    const blocks = dressedBlocks(world);
    const sea = 83 + DZ;
    const houses = blocks.filter((b) => b.y1 - b.y0 > 4 && b.minZ < sea);
    expect(houses.length).toBeGreaterThan(50);
    for (const b of houses) expect(b.colour, `${b.minX}, ${b.minZ}`).toBeDefined();
    expect(blocks.filter((b) => b.minZ >= sea).every((b) => b.colour === undefined)).toBe(true);
    expect(new Set(houses.map((b) => b.colour)).size).toBe(5);
    // Its plaster reaches the props, which are textured as plaster.
    const plastered = world.props.map((_, i) => i).filter((i) => world.props[i].colour !== undefined);
    expect(plastered.length).toBeGreaterThan(50);
    for (const i of plastered) expect(townLayer(world, i)).toBe(Layer.plaster);
  });

  it('paves its lanes in flagstones, its squares and sites in cobbles, the pit in earth', () => {
    const at = (name: string) => {
      const p = place(name);
      return pavingAt(CALABIANCA_2, p.x, p.z);
    };
    expect(at('long A')).toBe('flagstones');
    expect(at('mid')).toBe('flagstones');
    expect(at('T spawn')).toBe('cobbles');
    expect(at('CT spawn')).toBe('cobbles');
    expect(at('B site')).toBe('cobbles');
    expect(at('A back')).toBe('cobbles');
    expect(pavingAt(CALABIANCA_2, 68 + DX, 52 + DZ)).toBe('earth');
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
      const near = blocks.some((b) =>
        at.x - size.x / 2 < b.maxX + 0.2 && at.x + size.x / 2 > b.minX - 0.2 && at.z - size.z / 2 < b.maxZ + 0.2 && at.z + size.z / 2 > b.minZ - 0.2);
      if (!near) stray++;
    }
    expect(stray).toBe(0);
  });

  it('dresses a map with no buildings', () => {
    expect(Dressing.build(world)).not.toBeNull();
  });

  it('hangs lamps in its tunnels, out of everyone\'s way', () => {
    const lamps = coveredLamps(world);
    for (const name of ['upper tunnels', 'lower tunnels', 'tunnel stairs']) {
      const p = place(name);
      const i = PLACES.findIndex((q) => q.name === name);
      const r = PLACES[i];
      const inside = lamps.filter(([x, , z]) => x > r.minX + DX && x < r.maxX + DX && z > r.minZ + DZ && z < r.maxZ + DZ);
      expect(inside.length, name).toBeGreaterThan(0);
      for (const [x, y, z] of inside) expect(y - 0.2 - world.groundHeight(x, z, p.y + 0.3), name).toBeGreaterThan(2);
    }
    for (const [x, y, z] of lamps) expect(world.ceilingHeight(x, z, y)).toBeLessThan(y + 1);
  });

  it('lights its lower tunnels by their lamps', () => {
    const input = bakeInput(world, () => 0xd8cfc0, [-0.23, 0.75, 0.62])!;
    const dark = bake({ ...input, lamps: new Float32Array() });
    const lit = bake(input);
    const p = place('lower tunnels');
    const c = (Math.floor((p.z - input.z0) / BAKE_CELL) * input.ny + Math.floor((p.y + 1.5 - input.y0) / BAKE_CELL)) * input.nx + Math.floor((p.x - input.x0) / BAKE_CELL);
    // The sun's bounced on a face looking up, the floor's.
    const up = (b: typeof lit) => (b.skyUpDown[c * 4 + 2] / 255) ** 2 * SUN_RANGE;
    expect(up(lit)).toBeGreaterThan(up(dark) * 4);
  });

  it('lets the attackers\' end see the sea over its parapet', () => {
    const spawns = world.spawns.filter((s) => s.z > 77 + DZ && s.y > 8.5);
    expect(spawns.length).toBeGreaterThan(1);
    for (const s of spawns) {
      // Looking south, a little down: over the parapet, the sea within 200 m.
      const eye = s.y + 1.6;
      const d = [0, -Math.sin(0.08), Math.cos(0.08)];
      const t = world.raycast(s.x, eye, s.z, d[0], d[1], d[2], 200);
      expect(eye + d[1] * t, `${s.x}, ${s.z}`).toBeLessThan(1);
    }
  });
});
