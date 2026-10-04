import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { heatPicture } from '../src/server/heatmap.ts';
import { NavGrid, reached } from '../src/server/nav.ts';
import { arenaPoint, FIGHT_CLEAR } from '../src/server/population.ts';
import { GameServer } from '../src/server/server.ts';
import { vantageOver, vantages } from '../src/server/vantage.ts';
import { EYE_HEIGHT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { angleDiff, yawToward } from '../src/shared/geom.ts';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { inBuilding, World } from '../src/shared/world.ts';

// How Deathmatch plays on its town: the places bots watch the streets from,
// spawns kept away from a fight, and the heat map the simulation draws.

const town = new World(1, CALABIANCA);
const nav = new NavGrid(town);
const posts = vantages(town);

describe('The town\'s flow', () => {
  it('finds windows and roof edges to watch from, each on a floor bots reach, over a drop, looking out', () => {
    const windows = posts.filter((v) => v.kind === 'window');
    const roofs = posts.filter((v) => v.kind === 'roof');
    expect(windows.length).toBeGreaterThan(150);
    expect(roofs.length).toBeGreaterThan(80);
    for (const v of posts) {
      const at = `${v.kind} at ${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
      expect(town.inBounds(v.x, v.z), at).toBe(true);
      // Two metres out the way it looks, the ground or a roof is at least two metres down.
      const ox = v.x - Math.sin(v.yaw) * 2.5;
      const oz = v.z - Math.cos(v.yaw) * 2.5;
      expect(v.y - town.groundHeight(ox, oz, v.y), at).toBeGreaterThanOrEqual(2);
      if (v.kind === 'window') expect(town.buildings.some((b) => inBuilding(b, v.x, v.z)), at).toBe(true);
    }
    const from = town.spawns[0];
    for (const v of posts.filter((_, i) => i % 25 === 0)) {
      const path = nav.findPath(from.x, from.z, v.x, v.z, from.y, v.y);
      const end = path?.at(-1);
      expect(end && reached(end, v.x, v.y, v.z), `${v.kind} at ${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`).toBe(true);
    }
  });

  it('picks a post over a fight that sees it, within the range asked', () => {
    const rand = mulberry32(3);
    let found = 0;
    for (const s of town.spawns) {
      const at = { x: s.x, y: s.y, z: s.z };
      const v = vantageOver(town, posts, at, at, [10, 40], [], rand);
      if (!v) continue;
      found++;
      const d = Math.hypot(v.x - at.x, v.z - at.z);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(40);
      expect(Math.abs(angleDiff(yawToward(v.x, v.z, at.x, at.z), v.yaw))).toBeLessThanOrEqual(1.3);
      expect(town.hasLineOfSight(v.x, v.y + EYE_HEIGHT, v.z, at.x, at.y + 1, at.z)).toBe(true);
    }
    expect(found).toBeGreaterThan(town.spawns.length / 2);
  });

  it('spawns nobody near shots fired lately while a spawn point away from them is clear', () => {
    const rand = mulberry32(5);
    // Shots by half the spawn zones' points.
    const fights = town.spawns.slice(0, 16).map((s) => ({ x: s.x + 3, y: s.y, z: s.z }));
    for (let i = 0; i < 10; i++) {
      const p = arenaPoint(town, nav, rand, [], fights);
      expect(Math.min(...fights.map((f) => Math.hypot(f.x - p.x, f.z - p.z)))).toBeGreaterThanOrEqual(FIGHT_CLEAR);
    }
  });

  it('sends bots up to watch from windows and roofs', { timeout: 60_000 }, () => {
    const server = new GameServer(1, MODES.deathmatch.options);
    let up = 0;
    let all = 0;
    for (let t = 0; t < 90 * SERVER_TICK_RATE; t++) {
      server.step();
      for (const b of server.bots()) {
        if (b.state.dead) continue;
        all++;
        const house = server.world.buildings.find((h) => inBuilding(h, b.state.x, b.state.z));
        if (house && b.state.y > house.floor + 1) up++;
      }
    }
    expect(up / all).toBeGreaterThan(0.08);
  });

  it('draws the heat map as a PNG of the town', async () => {
    const png = await heatPicture(town, [{ kx: 0, ky: 9, kz: 260, vx: 10, vz: 300, where: 'roofs' }]);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const v = new DataView(png.buffer, png.byteOffset);
    const b = town.bounds;
    expect(v.getUint32(16)).toBe(Math.ceil((b.maxX - b.minX + 8) * 4));
    expect(v.getUint32(20)).toBe(Math.ceil((b.maxZ - b.minZ + 8) * 4));
  });
});
