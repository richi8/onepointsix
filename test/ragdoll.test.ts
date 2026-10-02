import { describe, expect, it } from 'vitest';
import { JOINT, JOINTS, type Living, RAGDOLL_STEP, Ragdoll, type Solid, stepAll, Tumbler } from '../src/client/ragdoll.ts';
import { World } from '../src/shared/world.ts';
import slump from './slump.json' with { type: 'json' };

// The death clip where the ragdoll takes over, standing at the origin facing
// -z (sunk to its knees, falling forward toward -z), as ragrig.ts works it
// out for the soldier (written by scripts/slump.ts).

interface Box { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

/** Ground rising `slope` per metre toward +z (so falling forward goes downhill), and some boxes. */
function solid(slope = 0, boxes: Box[] = []): Solid {
  return {
    floorHeight: (_x, z) => z * slope,
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
    // Lying down: the head as low as the hips, well ahead of where it knelt.
    expect(joint(rag, JOINT.head)[1]).toBeLessThan(0.45);
    expect(joint(rag, JOINT.head)[2]).toBeLessThan(-0.5);
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
    const before = rag.links.filter((l) => l.stiffness === 1 && !l.min && !l.max).map((l) => l.length);
    rest(rag, solid());
    rag.links.filter((l) => l.stiffness === 1 && !l.min && !l.max).forEach((l, k) => expect(rag.distance(l.a, l.b)).toBeCloseTo(before[k], 1));
  });

  it('slumps against a wall in front of it instead of passing through', () => {
    const wall: Box = { minX: -2, minY: 0, minZ: -0.65, maxX: 2, maxY: 2, maxZ: -0.45 };
    const rag = body();
    // How far into the wall it ever got, less its thickness.
    let deepest = -Infinity;
    while (!rag.asleep) {
      rag.step(solid(0, [wall]), []);
      for (let i = 0; i < rag.n; i++) deepest = Math.max(deepest, wall.maxZ - rag.pos[i * 3 + 2] + rag.radius[i]);
    }
    expect(deepest).toBeGreaterThan(-0.01);
    expect(deepest).toBeLessThan(0.03);
  });

  it('lands on a body already lying there, not through it', () => {
    const under = body();
    rest(under, solid());
    const over = body(0, 0.6, -0.3);
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
    expect(joint(flat, JOINT.pelvis)[2] - joint(gentle, JOINT.pelvis)[2]).toBeLessThan(1);
    const steep = body();
    for (let s = 0; s < 300; s++) steep.step(solid(Math.tan(0.8)), []);
    expect(joint(flat, JOINT.pelvis)[2] - joint(steep, JOINT.pelvis)[2]).toBeGreaterThan(3);
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

  it('never bends a knee or an elbow backward, however it is thrown', () => {
    for (let k = 0; k < 8; k++) {
      const rag = body();
      const a = (k * Math.PI) / 4;
      for (let i = 0; i < rag.n; i++) rag.push(i, Math.sin(a) * 3, 1, Math.cos(a) * 3);
      rag.push(JOINT.lHand, -Math.cos(a) * 6, 2, Math.sin(a) * 6);
      rag.push(JOINT.rAnkle, Math.cos(a) * 6, 2, -Math.sin(a) * 6);
      const elbows = [0, 1].map((s) => elbowBack(rag, s));
      // An elbow can be forced a little the wrong way for a few steps as it lands (see PLAN.md's Known Issues).
      const check = (elbowGive: number): void => {
        for (const s of [0, 1]) {
          expect(kneeAhead(rag, s)).toBeGreaterThan(-0.02);
          expect(elbowBack(rag, s)).toBeGreaterThan(Math.min(elbows[s], 0) - elbowGive);
        }
      };
      while (!rag.asleep) {
        rag.step(solid(), []);
        check(0.07);
      }
      check(0.02);
    }
  });

  it('turns the feet at the ankle, within its range', () => {
    const rag = body();
    const start = [0, 1].map((s) => ankleAngle(rag, s));
    let turned = 0;
    for (let i = 0; i < rag.n; i++) rag.push(i, 0, 0, -2);
    // A foot can be forced a little past its range for a few steps as it lands (see PLAN.md's Known Issues).
    const check = (give: number): void => {
      for (const s of [0, 1]) {
        const angle = ankleAngle(rag, s);
        turned = Math.max(turned, Math.abs(angle - start[s]));
        expect(angle).toBeGreaterThan(Math.min(1.2, start[s]) - give);
        expect(angle).toBeLessThan(Math.max(2.6, start[s]) + give);
      }
    };
    while (!rag.asleep) {
      rag.step(solid(Math.tan(0.3)), []);
      check(0.25);
    }
    check(0.1);
    expect(turned).toBeGreaterThan(0.1);
  });

  it('falls against someone standing in front of it, not through them', () => {
    const them: Living = { x: 0, z: -0.6, bottom: 0.25, top: 1.45, r: 0.25 };
    const rag = body();
    let deepest = -Infinity;
    while (!rag.asleep) {
      rag.step(solid(), [], [them]);
      for (let i = 0; i < rag.n; i++) {
        const cy = Math.min(Math.max(rag.pos[i * 3 + 1], them.bottom), them.top);
        const d = Math.hypot(rag.pos[i * 3] - them.x, rag.pos[i * 3 + 1] - cy, rag.pos[i * 3 + 2] - them.z);
        deepest = Math.max(deepest, them.r + rag.radius[i] - d);
      }
    }
    expect(deepest).toBeLessThan(0.03);
    // Stopped short of where it would have lain.
    const free = body();
    rest(free, solid());
    expect(joint(rag, JOINT.head)[2]).toBeGreaterThan(joint(free, JOINT.head)[2] + 0.3);
  });

  it('lands two bodies on each other the same however the frames fall', () => {
    const run = (frames: number[]): number[] => {
      const under = body();
      const over = body(0.2, 0.5, -0.4);
      over.start = 7;
      const falls = [under, over];
      let due = 0;
      for (const n of frames) stepAll(falls, (due += n), solid(), falls);
      return [...under.pos, ...over.pos];
    };
    const even = run(Array(300).fill(1));
    const uneven = run(Array.from({ length: 300 }, (_, i) => [3, 1, 2, 5, 0][i % 5]).slice(0, 110).concat([300 - 242]));
    expect(uneven).toEqual(even);
  });
});

/** Which way the hips face, as ragdoll.ts works it out. */
function facing(rag: Ragdoll): number[] {
  const r = sub(joint(rag, JOINT.rHip), joint(rag, JOINT.lHip));
  const u = sub(joint(rag, JOINT.chest), joint(rag, JOINT.pelvis));
  return unit([u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]]);
}

/** How far joint b stands out from the line a to c, along `dir` made square to it. */
function standsOut(rag: Ragdoll, a: number, b: number, c: number, dir: number[]): number {
  const line = unit(sub(joint(rag, c), joint(rag, a)));
  const d = unit(sub(dir, line.map((v) => v * dot(dir, line))));
  const mid = joint(rag, a).map((v, i) => (v + joint(rag, c)[i]) / 2);
  return dot(sub(joint(rag, b), mid), d);
}

function kneeAhead(rag: Ragdoll, side: number): number {
  const [hip, knee, ankle] = side ? [JOINT.rHip, JOINT.rKnee, JOINT.rAnkle] : [JOINT.lHip, JOINT.lKnee, JOINT.lAnkle];
  const dir = facing(rag);
  // Skipped along the leg, as ragdoll.ts does.
  const line = unit(sub(joint(rag, ankle), joint(rag, hip)));
  if (Math.hypot(...sub(dir, line.map((v) => v * dot(dir, line)))) < 0.2) return Infinity;
  return standsOut(rag, hip, knee, ankle, dir);
}

function elbowBack(rag: Ragdoll, side: number): number {
  const [shoulder, elbow, hand] = side ? [JOINT.rShoulder, JOINT.rElbow, JOINT.rHand] : [JOINT.lShoulder, JOINT.lElbow, JOINT.lHand];
  const up = unit(sub(joint(rag, JOINT.chest), joint(rag, JOINT.pelvis)));
  const dir = facing(rag).map((v, i) => v + up[i] * 0.5);
  // Skipped along the arm, as ragdoll.ts does.
  const line = unit(sub(joint(rag, hand), joint(rag, shoulder)));
  if (Math.hypot(...sub(dir, line.map((v) => v * dot(dir, line)))) < 0.2) return Infinity;
  return -standsOut(rag, shoulder, elbow, hand, dir);
}

/** The angle at the ankle between the shin and the foot. */
function ankleAngle(rag: Ragdoll, side: number): number {
  const [knee, ankle, toe] = side ? [JOINT.rKnee, JOINT.rAnkle, JOINT.rToe] : [JOINT.lKnee, JOINT.lAnkle, JOINT.lToe];
  return Math.acos(dot(unit(sub(joint(rag, knee), joint(rag, ankle))), unit(sub(joint(rag, toe), joint(rag, ankle)))));
}

function sub(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function unit(a: number[]): number[] {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
}

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
