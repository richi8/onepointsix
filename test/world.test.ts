import { describe, expect, it } from 'vitest';
import { Btn, CMD_DT, PLAYER_RADIUS } from '../src/shared/constants.ts';
import { rayAabb, rayCylinder } from '../src/shared/geom.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { LAMP_SEEN, lampShine, World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

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

  it('raycasts exactly like testing every collider', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const o = w1.randomLandPoint(rand);
      const oy = o.y + 1 + rand() * 3;
      let dx = rand() - 0.5;
      let dy = (rand() - 0.5) * 0.3;
      let dz = rand() - 0.5;
      const len = Math.hypot(dx, dy, dz);
      (dx /= len), (dy /= len), (dz /= len);
      const maxT = 5 + rand() * 300;
      let best = Infinity;
      for (const c of w1.colliders) {
        const t = c.kind === 'cyl'
          ? rayCylinder(o.x, oy, o.z, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1)
          : rayAabb(o.x, oy, o.z, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
        best = Math.min(best, t);
      }
      const got = w1.raycast(o.x, oy, o.z, dx, dy, dz, maxT);
      // Within range, no collider is missed; terrain can only bring the hit nearer.
      if (best <= maxT && got > best) throw new Error(`missed a collider at ${best}, got ${got}`);
    }
  });

  it('places extraction points on dry land, spread apart and away from outposts', () => {
    for (const seed of [1, 2, 3, 42]) {
      const w = new World(seed);
      expect(w.extracts.length).toBeGreaterThanOrEqual(3);
      for (const e of w.extracts) {
        expect(w.terrainHeight(e.x, e.z)).toBeGreaterThan(1.5);
        expect(w.fits(e.x, e.y, e.z, 1.8)).toBe(true);
        for (const o of w.outposts) expect(Math.hypot(o.x - e.x, o.z - e.z)).toBeGreaterThan(80);
        for (const f of w.extracts) if (f !== e) expect(Math.hypot(f.x - e.x, f.z - e.z)).toBeGreaterThan(100);
      }
    }
    expect(new World(1).extracts).toEqual(w1.extracts);
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
    const wall = w1.walls.find((b) => b.maxY - b.minY > 2.5 && b.maxX - b.minX > 3)!;
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

describe('lamps', () => {
  const world = new World(DEFAULT_WORLD.seed);

  it('stand in every outpost, inside its walls, lighting the ground in front of them', () => {
    for (const [i, o] of world.outposts.entries()) {
      const lamps = world.lamps.filter((l) => l.outpost === i);
      expect(lamps.length).toBeGreaterThanOrEqual(2);
      for (const l of lamps) {
        expect(Math.max(Math.abs(l.x - o.x), Math.abs(l.z - o.z))).toBeLessThan(14);
        expect(world.panels[l.panel].kind).toBe('lamp');
        // Aimed inward.
        expect((o.x - l.x) * l.dx + (o.z - l.z) * l.dz).toBeGreaterThan(0);
      }
    }
    const l = world.lamps.find((l) => world.inLamplight(l.hx + l.dx * 3, l.y + 1.2, l.hz + l.dz * 3))!;
    expect(l).toBeDefined();
    expect(world.inLamplight(l.hx + l.dx * 30, l.y + 1.2, l.hz + l.dz * 30)).toBe(false);
  });

  it('light the cone they point along, as drawn, not behind them or far to the side', () => {
    const world = new World(DEFAULT_WORLD.seed);
    const l = world.lamps[0];
    const at = (along: number, side: number) => {
      const x = l.hx + l.dx * along - l.dz * side;
      const z = l.hz + l.dz * along + l.dx * side;
      return lampShine(l, x, world.floorHeight(x, z) + 1.2, z);
    };
    expect(at(3, 0)).toBeGreaterThan(LAMP_SEEN * 3);
    expect(at(6, 0)).toBeGreaterThan(LAMP_SEEN);
    expect(at(-4, 0)).toBe(0);
    expect(at(3, 9)).toBeLessThan(LAMP_SEEN / 4);
    expect(at(16, 0)).toBeLessThan(LAMP_SEEN / 4);
  });

  it('are hidden by walls: somewhere in a cone, but behind a wall, stays dark', () => {
    const world = new World(DEFAULT_WORLD.seed);
    let hidden = 0;
    for (const l of world.lamps) {
      for (let along = 1; along < 12; along += 0.5) {
        for (let side = -6; side <= 6; side += 0.5) {
          const x = l.hx + l.dx * along - l.dz * side;
          const z = l.hz + l.dz * along + l.dx * side;
          const y = world.floorHeight(x, z) + 1.2;
          if (lampShine(l, x, y, z) < LAMP_SEEN * 2 || world.hasLineOfSight(l.hx, l.hy - 0.2, l.hz, x, y, z)) continue;
          hidden++;
          if (world.lamps.every((o) => o === l || lampShine(o, x, y, z) === 0)) expect(world.inLamplight(x, y, z)).toBe(false);
        }
      }
    }
    expect(hidden).toBeGreaterThan(0);
  });

  it('go out when shot', () => {
    const w = new World(DEFAULT_WORLD.seed);
    const l = w.lamps.find((l) => w.inLamplight(l.hx + l.dx * 3, l.y + 1.2, l.hz + l.dz * 3))!;
    for (const o of w.lamps) if (o.outpost === l.outpost) w.breakPanel(o.panel);
    expect(w.inLamplight(l.hx + l.dx * 3, l.y + 1.2, l.hz + l.dz * 3)).toBe(false);
  });
});
