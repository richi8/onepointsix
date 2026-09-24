import { describe, expect, it } from 'vitest';
import { Btn, CMD_DT, PLAYER_RADIUS } from '../src/shared/constants.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { World } from '../src/shared/world.ts';

const w1 = new World(1);

describe('World', () => {
  it('is identical for the same seed', () => {
    const again = new World(1);
    expect(again.heights).toEqual(w1.heights);
    expect(again.outposts).toEqual(w1.outposts);
    expect(again.props).toEqual(w1.props);
    expect(again.trees).toEqual(w1.trees);
    expect(again.rocks).toEqual(w1.rocks);
  });

  it('differs for another seed', () => {
    const other = new World(2);
    expect(other.heights).not.toEqual(w1.heights);
    expect(other.outposts).not.toEqual(w1.outposts);
  });

  it('places six outposts on land for a range of seeds', () => {
    for (const seed of [1, 2, 3, 42, 1234, 0xffffffff]) {
      const w = new World(seed);
      expect(w.outposts).toHaveLength(6);
      for (const o of w.outposts) expect(w.terrainHeight(o.x, o.z)).toBeGreaterThan(2);
    }
  });

  it('is an island: the edges are sea', () => {
    const h = w1.half - 5;
    for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h], [0, h], [h, 0]]) {
      expect(w1.terrainHeight(x, z)).toBeLessThan(0);
    }
  });

  it('samples terrain exactly at grid vertices', () => {
    const n = w1.res + 1;
    for (const [ix, iz] of [[10, 20], [100, 100], [150, 37]]) {
      const x = -w1.half + ix * w1.cell;
      const z = -w1.half + iz * w1.cell;
      expect(w1.terrainHeight(x, z)).toBeCloseTo(w1.heights[iz * n + ix], 4);
    }
  });

  it('finds the ground under a player standing on a crate', () => {
    const crate = w1.props.find((p) => p.style === 'crate')!.box;
    const x = (crate.minX + crate.maxX) / 2;
    const z = (crate.minZ + crate.maxZ) / 2;
    expect(w1.groundHeight(x, z, crate.maxY)).toBe(crate.maxY);
  });
});

describe('applyCmd with collision', () => {
  it('cannot walk through a tall wall', () => {
    const wall = w1.props.find((p) => p.style === 'wall' && p.box.maxY - p.box.minY > 2.5 && p.box.maxX - p.box.minX > 3)!.box;
    const x = (wall.minX + wall.maxX) / 2;
    const z = wall.maxZ + 2;
    const p = spawnState(x, w1.groundHeight(x, z, w1.terrainHeight(x, z)), z);
    for (let i = 0; i < 120; i++) applyCmd(w1, p, { seq: i, buttons: Btn.Forward, yaw: 0, pitch: 0 }, CMD_DT);
    expect(p.z).toBeGreaterThanOrEqual(wall.maxZ + PLAYER_RADIUS - 1e-6);
  });

  it('follows the terrain while walking', () => {
    const { x, z } = w1.outposts[0];
    const p = spawnState(x + 60, 0, z + 60);
    p.y = w1.groundHeight(p.x, p.z, w1.terrainHeight(p.x, p.z));
    for (let i = 0; i < 60; i++) {
      applyCmd(w1, p, { seq: i, buttons: Btn.Right, yaw: 0, pitch: 0 }, CMD_DT);
      expect(p.y).toBeGreaterThanOrEqual(w1.floorHeight(p.x, p.z) - 1e-6);
    }
  });
});
