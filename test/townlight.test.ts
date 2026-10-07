import { describe, expect, it } from 'vitest';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { CALABIANCA_2 } from '../src/shared/maps/calabianca2.ts';
import { area, standIn } from './calabianca.ts';
import { World } from '../src/shared/world.ts';
import { BAKE_CELL, bake, bakeInput, SKY_RANGE, SUN_RANGE, type BakeInput, type Baked } from '../src/client/townbake.ts';

// The light baked over a map's town (townbake.ts): a little scene of its own
// to check what it should show, then the town itself.

/** The faces of the ambient cube, as stored. */
const PX = 0;
const NX = 1;
const PY = 2;
const NZ = 5;

/** The sky's share and the sun's bounced on face `face` (+x, -x, +y, -y, +z, -z) of the cell at a point. */
function read(input: BakeInput, b: Baked, x: number, y: number, z: number, face: number): { sky: number; sun: number; open: boolean } {
  const i = Math.floor((x - input.x0) / BAKE_CELL);
  const j = Math.floor((y - input.y0) / BAKE_CELL);
  const k = Math.floor((z - input.z0) / BAKE_CELL);
  const c = ((k * input.ny + j) * input.nx + i) * 4;
  const sky = [b.skySides[c], b.skySides[c + 1], b.skyUpDown[c], b.skyUpDown[c + 1], b.skySides[c + 2], b.skySides[c + 3]][face];
  const sun = [b.sunSides[c], b.sunSides[c + 1], b.skyUpDown[c + 2], b.skyUpDown[c + 3], b.sunSides[c + 2], b.sunSides[c + 3]][face];
  return { sky: (sky / 255) ** 2 * SKY_RANGE, sun: (sun / 255) ** 2 * SUN_RANGE, open: b.tint[c + 3] > 0 };
}

/**
 * 20 × 20 m of flat ground at y = 1 holding: a room (x 6–14, z 6–14, 3 m
 * high) with a window to the south and a doorway to the west; a lone wall
 * 6 m tall facing the sun (x 30–30.3); and a low wall 3 m east of it facing
 * it, in its shadow, and another as low out in the open.
 */
function scene(): BakeInput {
  const boxes: number[][] = [];
  const wall = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => boxes.push([x0, y0, z0, x1, y1, z1]);
  // The room's walls: the south one round a window, the west one round a doorway.
  wall(6, 1, 6, 14, 4, 6.3);
  wall(13.7, 1, 6, 14, 4, 14);
  wall(6, 1, 13.7, 9, 4, 14);
  wall(11, 1, 13.7, 14, 4, 14);
  wall(9, 1, 13.7, 11, 2, 14);
  wall(9, 3, 13.7, 11, 4, 14);
  wall(6, 1, 6, 6.3, 4, 9);
  wall(6, 1, 11, 6.3, 4, 14);
  wall(6, 3.2, 9, 6.3, 4, 11);
  wall(6, 4, 6, 14, 4.2, 14);
  // The wall in the sun, and the low walls facing it and facing the open.
  wall(30, 1, 4, 30.3, 7, 36);
  wall(33.3, 1, 12, 33.6, 2.5, 28);
  wall(38, 1, 12, 38.3, 2.5, 28);
  const nx = 84;
  const ny = 20;
  const nz = 80;
  const ground = new Float32Array((2 * nx + 1) * (2 * nz + 1)).fill(1);
  const plaster = [0.7, 0.62, 0.5];
  const sun: [number, number, number] = [0.6, 0.75, 0.28];
  const l = Math.hypot(...sun);
  return {
    x0: 0, y0: 0, z0: 0, nx, ny, nz,
    boxes: new Float32Array(boxes.flat()),
    albedo: new Float32Array(boxes.flatMap(() => plaster)),
    ground,
    groundAlbedo: [0.3, 0.28, 0.25],
    sun: [sun[0] / l, sun[1] / l, sun[2] / l],
    horizon: new Float32Array(64),
  };
}

describe('the town\'s baked light', () => {
  const input = scene();
  const baked = bake(input);
  const at = (x: number, y: number, z: number, face: number) => read(input, baked, x, y, z, face);

  it('lights the open ground as the open ground', () => {
    expect(at(22, 1.25, 30, PY).sky).toBeGreaterThan(0.85);
    expect(at(22, 1.25, 30, PY).sky).toBeLessThan(1.15);
  });

  it('keeps a room darker than the street, and darkest away from its window and doorway', () => {
    const outside = at(10, 2.25, 17, PY).sky;
    const middle = at(10, 2.25, 10, PY).sky;
    const byWindow = at(10, 2.25, 13, PY).sky;
    expect(middle).toBeLessThan(outside * 0.25);
    expect(byWindow).toBeGreaterThan(middle);
  });

  it('darkens the ground at a wall\'s foot', () => {
    // The ground east of the room, beside its wall and 3 m off.
    expect(at(14.25, 1.25, 10, PY).sky).toBeLessThan(at(17.25, 1.25, 10, PY).sky - 0.1);
  });

  it('gives each face of a wall the light on its own side', () => {
    // The cell holding the room's east wall: facing east it reads the street, facing west the room.
    const wall = at(13.85, 2.25, 10, PX);
    expect(wall.open).toBe(false);
    expect(wall.sky).toBeCloseTo(at(14.25, 2.25, 10, PX).sky, 2);
    expect(at(13.85, 2.25, 10, NX).sky).toBeCloseTo(at(13.25, 2.25, 10, NX).sky, 2);
    expect(at(13.85, 2.25, 10, PX).sky).toBeGreaterThan(at(13.85, 2.25, 10, NX).sky * 3);
  });

  it('lights a face in shade from a wall in the sun facing it', () => {
    // The low walls' west faces: one facing the wall in the sun, one the open.
    const facing = at(33.15, 1.75, 20, NX).sun;
    const open = at(37.85, 1.75, 20, NX).sun;
    expect(facing).toBeGreaterThan(open * 1.2);
  });

  it('shades under a roof from the sky but not from light off the floor', () => {
    // The room's ceiling sees the floor; its roof's top sees the sky.
    expect(at(10, 4.4, 10, PY).sky).toBeGreaterThan(0.8);
    expect(at(10, 3.75, 10, NZ).sky).toBeLessThan(0.2);
  });
});

describe('Calabianca\'s baked light', () => {
  it('bakes the town, its rooms darker than its streets', () => {
    const world = new World(1, CALABIANCA);
    const input = bakeInput(world, () => 0xd8cfc0, [-0.23, 0.75, 0.62])!;
    const baked = bake(input);
    // Each building's middle, a metre and a half over each storey's floor, against the street outside it.
    let inside = 0;
    let rooms = 0;
    for (const b of world.buildings) {
      const x = (b.minX + b.maxX) / 2;
      const z = (b.minZ + b.maxZ) / 2;
      const r = read(input, baked, x, b.floor + 1.5, z, PY);
      if (!r.open) continue;
      inside += r.sky;
      rooms++;
    }
    let outside = 0;
    let streets = 0;
    const bounds = world.bounds;
    for (let x = bounds.minX + 1; x < bounds.maxX; x += 3) {
      for (let z = bounds.minZ + 1; z < bounds.maxZ; z += 3) {
        if (world.buildings.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) continue;
        const r = read(input, baked, x, world.floorHeight(x, z) + 1.5, z, PY);
        if (!r.open) continue;
        outside += r.sky;
        streets++;
      }
    }
    expect(rooms).toBeGreaterThan(30);
    expect(inside / rooms).toBeLessThan((outside / streets) * 0.25);
  });

  it('bakes a map with no buildings up to its blocks\' tops, its tunnels darker than its lanes', () => {
    const world = new World(1, CALABIANCA_2);
    const input = bakeInput(world, () => 0xd8cfc0, [-0.23, 0.75, 0.62])!;
    expect(input.y0 + input.ny * BAKE_CELL).toBeGreaterThan(Math.max(...CALABIANCA_2.walls.map((w) => w.y1)));
    const baked = bake(input);
    const sky = (name: string) => {
      const p = standIn(world, area(name))!;
      return read(input, baked, p.x, p.y + 1.5, p.z, PY).sky;
    };
    expect(sky('lower tunnels')).toBeLessThan(sky('long A') * 0.25);
  });
});
