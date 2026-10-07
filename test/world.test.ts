import { describe, expect, it } from 'vitest';
import { Btn, CMD_DT, PLAYER_RADIUS } from '../src/shared/constants.ts';
import { rayAabb, rayCylinder, rayTiltedBox } from '../src/shared/geom.ts';
import { rayRock, rockNormal, ROCK_SQUASH } from '../src/shared/rock.ts';
import { mulberry32 } from '../src/shared/rng.ts';
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
          ? c.rock
            ? rayRock(w1.rockShape, c.rock, o.x, oy, o.z, dx, dy, dz)
            : rayCylinder(o.x, oy, o.z, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1)
          : rayAabb(o.x, oy, o.z, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
        best = Math.min(best, t);
      }
      const got = w1.raycast(o.x, oy, o.z, dx, dy, dz, maxT);
      // Within range, no collider is missed; terrain can only bring the hit nearer.
      if (best <= maxT && got > best) throw new Error(`missed a collider at ${best}, got ${got}`);
    }
  });

  it('stops rounds and sight at a boulder\'s faces as drawn', () => {
    // The drawn rock, a corner at a time, as the renderer places it.
    const corner = (k: { x: number; y: number; z: number; r: number; h: number; rot: number }, i: number): number[] => {
      const [lx, ly, lz] = [w1.rockShape[i], w1.rockShape[i + 1], w1.rockShape[i + 2]];
      const c = Math.cos(k.rot);
      const s = Math.sin(k.rot);
      return [k.x + (lx * c + lz * s) * k.r, k.y + ly * k.h * ROCK_SQUASH, k.z + (-lx * s + lz * c) * k.r];
    };
    const rand = mulberry32(11);
    for (const k of w1.rocks.slice(0, 40)) {
      for (let n = 0; n < 20; n++) {
        // A point on a face above the ground, aimed at from outside along its normal.
        const f = Math.floor(rand() * 80) * 9;
        let u = rand();
        let v = rand();
        if (u + v > 1) (u = 1 - u), (v = 1 - v);
        const [a, b, c] = [corner(k, f), corner(k, f + 3), corner(k, f + 6)];
        const p = [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * u + (c[j] - a[j]) * v);
        if (p[1] < w1.terrainHeight(p[0], p[2]) + 0.05) continue;
        const nrm = rockNormal(w1.rockShape, k, p[0], p[1], p[2]);
        const o = p.map((q, j) => q + nrm[j] * 3);
        const t = rayRock(w1.rockShape, k, o[0], o[1], o[2], -nrm[0], -nrm[1], -nrm[2]);
        expect(t).toBeCloseTo(3, 3);
        // Just outside the face, a ray grazing past it along the face misses, unless another lump stands in the way.
        const out = p.map((q, j) => q + nrm[j] * 0.01);
        expect(w1.surfaceNormal(p[0], p[1], p[2]).map((q) => Math.round(q * 1e4))).toEqual(nrm.map((q) => Math.round(q * 1e4)));
        expect(rayRock(w1.rockShape, k, out[0], out[1], out[2], nrm[0], nrm[1], nrm[2])).toBe(Infinity);
        // And from inside, it's in.
        const inside = p.map((q, j) => q - nrm[j] * 0.01);
        expect(rayRock(w1.rockShape, k, inside[0], inside[1], inside[2], nrm[0], nrm[1], nrm[2])).toBe(0);
      }
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

  it('counts a crate under a player just off its edge, but not under a foot there', () => {
    const crate = w1.props.find((p) => p.style === 'crate')!.box;
    const x = crate.maxX + 0.1;
    const z = (crate.minZ + crate.maxZ) / 2;
    expect(w1.groundHeight(x, z, crate.maxY)).toBe(crate.maxY);
    expect(w1.groundHeight(x, z, crate.maxY, 0.05)).toBeLessThan(crate.maxY);
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


describe('a box with a sloping top', () => {
  // 4 m along x, its top rising 0.25 a metre toward +x from 1 m to 2 m.
  const box = [0, 0, 0, 4, 2, 1] as const;
  const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => rayTiltedBox(ox, oy, oz, dx, dy, dz, ...box, 0.25, 0);

  it('meets a ray coming down on its top where the slope is', () => {
    expect(ray(0.5, 5, 0.5, 0, -1, 0)).toBeCloseTo(5 - 1.125, 6);
    expect(ray(3.5, 5, 0.5, 0, -1, 0)).toBeCloseTo(5 - 1.875, 6);
  });

  it('lets a ray pass over its low end that a flat box as high would stop', () => {
    expect(ray(-1, 1.5, 0.5, 1, 0, 0)).toBeCloseTo(3, 6);
    expect(rayAabb(-1, 1.5, 0.5, 1, 0, 0, ...box)).toBeCloseTo(1, 6);
  });

  it('misses a ray over it all', () => {
    expect(ray(-1, 2.5, 0.5, 1, 0, 0)).toBe(Infinity);
  });
});
