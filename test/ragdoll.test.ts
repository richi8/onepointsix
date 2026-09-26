import { describe, expect, it } from 'vitest';
import { JOINT, JOINTS, RAGDOLL_STEP, Ragdoll, type Solid, Tumbler } from '../src/client/ragdoll.ts';
import { World } from '../src/shared/world.ts';
import slump from './slump.json' with { type: 'json' };

// The soldier's death clip where the ragdoll takes over, standing at the
// origin facing -z (falling back toward +z), as ragrig.ts works it out.

interface Box { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

/** Ground rising `slope` per metre toward -z (so falling back goes downhill), and some boxes. */
function solid(slope = 0, boxes: Box[] = []): Solid {
  return {
    floorHeight: (_x, z) => -z * slope,
    sphereOut(x, y, z, r, out) {
      out.x = out.y = out.z = 0;
      for (const b of boxes) {
        const cx = Math.min(Math.max(x, b.minX), b.maxX);
        const cy = Math.min(Math.max(y, b.minY), b.maxY);
        const cz = Math.min(Math.max(z, b.minZ), b.maxZ);
        const d = Math.hypot(x - cx, y - cy, z - cz);
        if (d >= r || d < 1e-9) continue;
        out.x += ((x - cx) / d) * (r - d);
        out.y += ((y - cy) / d) * (r - d);
        out.z += ((z - cz) / d) * (r - d);
      }
      return out.x !== 0 || out.y !== 0 || out.z !== 0;
    },
  };
}

/** The slump moved by (dx, dy, dz). */
function body(dx = 0, dy = 0, dz = 0, pack = true): Ragdoll {
  const move = (a: number[]) => a.map((v, i) => v + [dx, dy, dz][i % 3]);
  return new Ragdoll(move(slump.now), move(slump.before), pack);
}

function rest(rag: Ragdoll | Tumbler, on: Solid, others: Ragdoll[] = []): void {
  while (!rag.asleep) rag.step(on, others);
}

function joint(rag: Ragdoll, i: number): [number, number, number] {
  return [rag.pos[i * 3], rag.pos[i * 3 + 1], rag.pos[i * 3 + 2]];
}

describe('Ragdoll', () => {
  it('falls and comes to rest on the ground, nothing under it, within a few seconds', () => {
    const rag = body();
    rest(rag, solid());
    expect(rag.steps * RAGDOLL_STEP).toBeLessThan(6);
    for (let i = 0; i < rag.n; i++) expect(rag.pos[i * 3 + 1]).toBeGreaterThan(rag.radius[i] - 0.01);
    // Lying down: the head as low as the hips, well back from where it stood.
    expect(joint(rag, JOINT.head)[1]).toBeLessThan(0.45);
    expect(joint(rag, JOINT.head)[2]).toBeGreaterThan(1.2);
  });

  it('falls the same way every time', () => {
    const a = body();
    const b = body();
    a.push(JOINT.chest, 0.5, 0, 1);
    b.push(JOINT.chest, 0.5, 0, 1);
    rest(a, solid());
    rest(b, solid());
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
  });

  it('keeps its bones their length', () => {
    const rag = body();
    const before = rag.links.filter((l) => l.stiffness === 1 && !l.min).map((l) => l.length);
    rest(rag, solid());
    rag.links.filter((l) => l.stiffness === 1 && !l.min).forEach((l, k) => expect(rag.distance(l.a, l.b)).toBeCloseTo(before[k], 1));
  });

  it('slumps against a wall behind it instead of passing through', () => {
    const wall: Box = { minX: -2, minY: 0, minZ: 0.8, maxX: 2, maxY: 2, maxZ: 1 };
    const rag = body();
    // How far into the wall it ever got, less its thickness.
    let deepest = -Infinity;
    while (!rag.asleep) {
      rag.step(solid(0, [wall]), []);
      for (let i = 0; i < rag.n; i++) deepest = Math.max(deepest, rag.pos[i * 3 + 2] + rag.radius[i] - wall.minZ);
    }
    expect(deepest).toBeGreaterThan(-0.01);
    expect(deepest).toBeLessThan(0.03);
  });

  it('lands on a body already lying there, not through it', () => {
    const under = body();
    rest(under, solid());
    const over = body(0, 0.6, 0.3);
    // The closest any two of their joints come, less their thickness, over the whole fall.
    let closest = Infinity;
    while (!over.asleep) {
      over.step(solid(), [under]);
      for (let i = 0; i < over.n; i++) {
        for (let k = 0; k < under.n; k++) {
          const d = Math.hypot(...([0, 1, 2].map((c) => over.pos[i * 3 + c] - under.pos[k * 3 + c]) as [number, number, number]));
          closest = Math.min(closest, d - over.radius[i] - under.radius[k]);
        }
      }
    }
    expect(closest).toBeLessThan(0.01);
    expect(closest).toBeGreaterThan(-0.03);
  });

  it('stops on a gentle slope and slides down a steep one', () => {
    const flat = body();
    rest(flat, solid());
    const gentle = body();
    rest(gentle, solid(Math.tan(0.26)));
    expect(joint(gentle, JOINT.pelvis)[2] - joint(flat, JOINT.pelvis)[2]).toBeLessThan(1);
    const steep = body();
    for (let s = 0; s < 300; s++) steep.step(solid(Math.tan(0.8)), []);
    expect(joint(steep, JOINT.pelvis)[2] - joint(flat, JOINT.pelvis)[2]).toBeGreaterThan(3);
  });

  it('is thrown by a push the way it goes', () => {
    const still = body();
    const shoved = body();
    for (let i = 0; i < shoved.n; i++) shoved.push(i, 3, 1.5, 0);
    rest(still, solid());
    rest(shoved, solid());
    expect(joint(shoved, JOINT.pelvis)[0] - joint(still, JOINT.pelvis)[0]).toBeGreaterThan(0.5);
  });

  it('leaves the pack out when there is none', () => {
    expect(body(0, 0, 0, false).n).toBe(JOINTS.length - 1);
  });
});

describe('Tumbler', () => {
  it('drops a gun that comes to rest on its side', () => {
    const at = [0, 1.2, 0, 0, 1.25, -0.8, 0, 1.08, -0.3];
    const gun = new Tumbler(at, at.map((v, i) => (i % 3 === 0 ? v - 0.01 : v)));
    rest(gun, solid());
    for (let i = 0; i < 3; i++) expect(gun.pos[i * 3 + 1]).toBeCloseTo(gun.radius[i], 2);
  });
});

describe('World.sphereOut', () => {
  const world = new World(1);
  // Colliders with nothing else within a metre, so only they push.
  const alone = (c: (typeof world.colliders)[number]): boolean => {
    const [x0, z0, x1, z1] = c.kind === 'box' ? [c.minX, c.minZ, c.maxX, c.maxZ] : [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
    return world.colliders.every((o) => {
      if (o === c) return true;
      const [a0, b0, a1, b1] = o.kind === 'box' ? [o.minX, o.minZ, o.maxX, o.maxZ] : [o.x - o.r, o.z - o.r, o.x + o.r, o.z + o.r];
      return a0 > x1 + 1 || a1 < x0 - 1 || b0 > z1 + 1 || b1 < z0 - 1;
    });
  };
  const box = world.colliders.find((c) => c.kind === 'box' && c.maxY - c.minY > 0.5 && c.maxX - c.minX > 0.3 && alone(c))!;
  const cyl = world.colliders.find((c) => c.kind === 'cyl' && alone(c))!;
  const out = { x: 0, y: 0, z: 0 };

  it('pushes a ball out of a box face, and out of its middle through the nearest face', () => {
    if (box.kind !== 'box') throw new Error('no box');
    const y = (box.minY + box.maxY) / 2;
    const z = (box.minZ + box.maxZ) / 2;
    expect(world.sphereOut(box.maxX + 0.05, y, z, 0.1, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.05, 5);
    expect(world.sphereOut(box.maxX + 0.2, y, z, 0.1, out)).toBe(false);
    expect(world.sphereOut(box.maxX - 0.01, y, z, 0.1, out)).toBe(true);
    expect(out.x).toBeGreaterThan(0.1);
  });

  it('pushes a ball off a trunk sideways, and up off its top', () => {
    if (cyl.kind !== 'cyl') throw new Error('no cylinder');
    const y = (cyl.y0 + cyl.y1) / 2;
    world.sphereOut(cyl.x + cyl.r + 0.05, y, cyl.z, 0.1, out);
    expect(out.x).toBeCloseTo(0.05, 5);
    world.sphereOut(cyl.x, cyl.y1 + 0.05, cyl.z, 0.1, out);
    expect(out.y).toBeCloseTo(0.05, 5);
  });
});
