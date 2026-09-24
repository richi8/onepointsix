import { describe, expect, it } from 'vitest';
import { Btn, CMD_DT, HEADSHOT_MUL, LEGS_MUL, WALK_SPEED } from '../src/shared/constants.ts';
import { rayBody } from '../src/shared/hitbox.ts';
import type { InputCmd } from '../src/shared/protocol.ts';
import { applyCmd, spawnState, type PlayerState } from '../src/shared/sim.ts';
import {
  BOLT, damageAt, PISTOL, RIFLE, shotDirection, spreadOf, WEAPONS, type Shot, type WeaponFx,
} from '../src/shared/weapons.ts';
import { World } from '../src/shared/world.ts';

const w = new World(1);
const o = w.outposts[0];

/** Open ground next to the first outpost (see movement.test.ts). */
function openGround(): PlayerState {
  const p = spawnState(o.x + 18, 0, o.z - 10);
  p.y = w.groundHeight(p.x, p.z, w.terrainHeight(p.x, p.z));
  return p;
}

const SOUTH = Math.PI;
const seconds = (s: number) => Math.round(s / CMD_DT);
let seq = 0;

/** Run `steps` commands and collect the effects they produce. */
function run(p: PlayerState, buttons: number, steps: number, extra: Partial<InputCmd> = {}): WeaponFx[] {
  const fx: WeaponFx[] = [];
  for (let i = 0; i < steps; i++) {
    applyCmd(w, p, { seq: ++seq, buttons, yaw: SOUTH, pitch: 0, ...extra }, CMD_DT, (f) => fx.push(f));
  }
  return fx;
}

const shots = (fx: WeaponFx[]) => fx.filter((f) => f.k === 'shot').length;

/** Press and release `presses` times, one command each way. */
function tap(p: PlayerState, presses: number, extra: Partial<InputCmd> = {}): WeaponFx[] {
  const fx: WeaponFx[] = [];
  for (let i = 0; i < presses; i++) fx.push(...run(p, Btn.Fire, 1, extra), ...run(p, 0, 1, extra));
  return fx;
}

describe('firing', () => {
  it('fires the assault rifle at 600 rounds per minute while held', () => {
    const p = openGround();
    expect(shots(run(p, Btn.Fire, seconds(1)))).toBe(10);
    expect(p.mag[RIFLE]).toBe(WEAPONS[RIFLE].magSize - 10);
  });

  it('fires the pistol once per trigger pull', () => {
    const p = openGround();
    run(p, 0, 1, { weapon: PISTOL });
    run(p, 0, seconds(WEAPONS[PISTOL].drawTime) + 1);
    expect(shots(run(p, Btn.Fire, seconds(1)))).toBe(1);
    run(p, 0, 1);
    // A pull every 2 commands is faster than the pistol cycles; it fires on each pull that finds it ready.
    const fired = shots(tap(p, 30));
    expect(fired).toBeGreaterThan(5);
    expect(fired).toBeLessThanOrEqual(Math.ceil(60 * CMD_DT / WEAPONS[PISTOL].interval) + 1);
  });

  it('cycles the bolt-action slowly', () => {
    const p = openGround();
    run(p, 0, seconds(1), { weapon: BOLT });
    expect(shots(tap(p, 90, { weapon: BOLT }))).toBe(Math.floor(3 / WEAPONS[BOLT].interval) + 1);
  });

  it('fires from the eye along the view', () => {
    const p = openGround();
    const fx = run(p, Btn.Fire | Btn.Aim, 1);
    const shot = (fx.find((f) => f.k === 'shot') as { shot: Shot }).shot;
    expect(shot.ox).toBeCloseTo(p.x);
    expect(shot.oy).toBeCloseTo(p.y + 1.6);
    expect(shot.dz).toBeGreaterThan(0.99);
  });

  it('cannot fire while sprinting, and holding fire stops a sprint', () => {
    const p = openGround();
    run(p, Btn.Forward | Btn.Sprint, seconds(1));
    const fx = run(p, Btn.Forward | Btn.Sprint | Btn.Fire, seconds(1));
    expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(WALK_SPEED + 1e-6);
    expect(shots(fx)).toBeGreaterThan(0);
  });

  it('cannot fire while mantling', () => {
    const crate = w.props.find((q) => q.style === 'crate' && Math.abs(q.box.maxY - o.y - 1.2) < 1e-6)!.box;
    const p = spawnState((crate.minX + crate.maxX) / 2, 0, crate.maxZ + 0.6);
    p.y = w.groundHeight(p.x, p.z, o.y + 0.5);
    run(p, Btn.Forward | Btn.Jump, 1, { yaw: 0 });
    expect(p.mantling).toBe(true);
    expect(shots(run(p, Btn.Fire, 5, { yaw: 0 }))).toBe(0);
  });
});

describe('ammo and reloading', () => {
  it('reloads automatically when the trigger is pulled on an empty magazine', () => {
    const p = openGround();
    run(p, Btn.Fire, seconds(3.1));
    expect(p.mag[RIFLE]).toBe(0);
    run(p, 0, 1);
    const fx = run(p, Btn.Fire, 1);
    expect(fx.map((f) => f.k)).toEqual(['reload']);
    expect(shots(run(p, Btn.Fire, seconds(WEAPONS[RIFLE].reloadTime) - 2))).toBe(0);
    run(p, 0, 3);
    expect(p.mag[RIFLE]).toBe(30);
    expect(p.reserve[RIFLE]).toBe(WEAPONS[RIFLE].reserve - 30);
  });

  it('tops up a partial magazine on R, taking only what is missing', () => {
    const p = openGround();
    run(p, Btn.Fire, seconds(0.5));
    const left = p.mag[RIFLE];
    run(p, Btn.Reload, 1);
    run(p, 0, seconds(WEAPONS[RIFLE].reloadTime) + 1);
    expect(p.mag[RIFLE]).toBe(30);
    expect(p.reserve[RIFLE]).toBe(WEAPONS[RIFLE].reserve - (30 - left));
  });

  it('clicks dry with nothing left to load', () => {
    const p = openGround();
    p.mag[RIFLE] = 0;
    p.reserve[RIFLE] = 0;
    expect(run(p, Btn.Fire, 1).map((f) => f.k)).toEqual(['dry']);
    expect(run(p, Btn.Reload, 1)).toEqual([]);
  });

  it('keeps separate ammo per weapon', () => {
    const p = openGround();
    run(p, Btn.Fire, seconds(0.5));
    run(p, 0, seconds(1), { weapon: PISTOL });
    expect(p.mag[PISTOL]).toBe(WEAPONS[PISTOL].magSize);
    expect(p.mag[RIFLE]).toBeLessThan(30);
  });
});

describe('switching', () => {
  it('takes the draw time before the new weapon fires', () => {
    const p = openGround();
    run(p, 0, seconds(1), { weapon: PISTOL });
    const fx = run(p, Btn.Fire, seconds(WEAPONS[RIFLE].drawTime) - 1, { weapon: RIFLE });
    expect(fx.map((f) => f.k)).toEqual(['draw']);
    expect(shots(run(p, Btn.Fire, 3, { weapon: RIFLE }))).toBe(1);
  });

  it('cancels a reload', () => {
    const p = openGround();
    run(p, Btn.Fire, seconds(0.5));
    const left = p.mag[RIFLE];
    run(p, Btn.Reload, 1);
    run(p, 0, seconds(0.5), { weapon: PISTOL });
    run(p, 0, seconds(3), { weapon: RIFLE });
    expect(p.mag[RIFLE]).toBe(left);
    expect(p.reload).toBe(0);
  });

  it('ignores weapon indices that do not exist', () => {
    const p = openGround();
    run(p, 0, 1, { weapon: 7 });
    run(p, 0, 1, { weapon: -1 });
    expect(p.weapon).toBe(RIFLE);
  });
});

describe('aiming, spread and recoil', () => {
  it('eases down the sights, narrowing spread and slowing movement', () => {
    const hip = openGround();
    const aimed = openGround();
    run(hip, Btn.Forward, seconds(1));
    run(aimed, Btn.Forward | Btn.Aim, seconds(1));
    expect(aimed.aim).toBe(1);
    expect(Math.hypot(aimed.vx, aimed.vz)).toBeCloseTo(WALK_SPEED * WEAPONS[RIFLE].aimSpeed, 1);
    expect(spreadOf(aimed)).toBeLessThan(spreadOf(hip));
  });

  it('spreads more moving, in the air and less crouched', () => {
    const still = openGround();
    const moving = openGround();
    const crouched = openGround();
    run(moving, Btn.Forward, seconds(1));
    run(crouched, Btn.Crouch, seconds(1));
    expect(spreadOf(moving)).toBeGreaterThan(spreadOf(still));
    expect(spreadOf(crouched)).toBeLessThan(spreadOf(still));
    run(still, Btn.Jump, 5);
    expect(spreadOf(still)).toBeGreaterThan(spreadOf(moving));
  });

  it('scatters rounds within the cone, the same way for the same seq', () => {
    const spread = 0.05;
    for (let s = 0; s < 200; s++) {
      const [x, y, z] = shotDirection(0.3, 0.2, spread, s);
      const [fx, fy, fz] = shotDirection(0.3, 0.2, 0, s);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1);
      expect(Math.acos(Math.min(x * fx + y * fy + z * fz, 1))).toBeLessThanOrEqual(spread + 1e-9);
      expect(shotDirection(0.3, 0.2, spread, s)).toEqual([x, y, z]);
    }
    expect(shotDirection(0.3, 0.2, spread, 1)).not.toEqual(shotDirection(0.3, 0.2, spread, 2));
  });

  it('climbs during a burst and recovers after it', () => {
    const p = openGround();
    run(p, Btn.Fire, seconds(0.5));
    const early = p.recoilPitch;
    run(p, Btn.Fire, seconds(1));
    expect(early).toBeGreaterThan(0.03);
    expect(p.recoilPitch).toBeGreaterThan(early);
    run(p, 0, seconds(1.5));
    expect(p.recoilPitch).toBe(0);
    expect(p.recoilYaw).toBe(0);
    expect(p.burst).toBe(0);
  });

  it('aims the next round with the recoil', () => {
    const p = openGround();
    run(p, Btn.Fire | Btn.Aim, seconds(0.5));
    const fx = run(p, Btn.Fire | Btn.Aim, seconds(0.1));
    const shot = (fx.find((f) => f.k === 'shot') as { shot: Shot }).shot;
    expect(shot.dy).toBeGreaterThan(Math.sin(p.recoilPitch) * 0.5);
  });
});

describe('death', () => {
  it('ignores all input while dead', () => {
    const p = openGround();
    p.dead = true;
    const before = { x: p.x, z: p.z, mag: p.mag[RIFLE] };
    expect(run(p, Btn.Forward | Btn.Fire | Btn.Jump, seconds(1))).toEqual([]);
    expect({ x: p.x, z: p.z, mag: p.mag[RIFLE] }).toEqual(before);
  });
});

describe('damage', () => {
  it('multiplies by zone and falls off with range', () => {
    expect(damageAt(RIFLE, 10, 'torso')).toBe(WEAPONS[RIFLE].damage);
    expect(damageAt(RIFLE, 10, 'head')).toBe(Math.round(WEAPONS[RIFLE].damage * HEADSHOT_MUL));
    expect(damageAt(RIFLE, 10, 'legs')).toBe(Math.round(WEAPONS[RIFLE].damage * LEGS_MUL));
    expect(damageAt(RIFLE, 400, 'torso')).toBe(Math.round(WEAPONS[RIFLE].damage * WEAPONS[RIFLE].falloffMin));
    expect(damageAt(BOLT, 900, 'torso')).toBeGreaterThanOrEqual(100);
    expect(damageAt(PISTOL, 5, 'head')).toBeLessThan(100);
  });
});

describe('hitboxes', () => {
  const body = { x: 0, y: 0, z: 0, yaw: 0, duck: 0, lean: 0 };
  /** Where a horizontal ray fired along -z at height y (and sideways x) hits. */
  const at = (pose: typeof body, y: number, x = 0) => rayBody(pose, x, y, 10, 0, 0, -1, 100)?.zone ?? null;

  it('has a head, a torso and legs', () => {
    expect(at(body, 1.62)).toBe('head');
    expect(at(body, 1.2)).toBe('torso');
    expect(at(body, 0.5)).toBe('legs');
    expect(at(body, 1.9)).toBeNull();
    expect(at(body, 1.2, 0.4)).toBeNull();
  });

  it('lowers the head when crouched', () => {
    const crouched = { ...body, duck: 1 };
    expect(at(crouched, 1.62)).toBeNull();
    expect(at(crouched, 1.0)).toBe('head');
  });

  it('moves the head with a lean', () => {
    const leaning = { ...body, lean: 1 };
    expect(at(leaning, 1.62)).toBeNull();
    expect(at(leaning, 1.62, 0.45)).toBe('head');
  });

  it('reports the nearest zone first', () => {
    // Straight down onto the head reaches it before the torso below.
    expect(rayBody(body, 0, 5, 0, 0, -1, 0, 100)?.zone).toBe('head');
  });
});
