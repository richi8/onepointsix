import { describe, expect, it } from 'vitest';
import {
  Btn,
  CARRY_HEAVY,
  CARRY_MAX,
  CARRY_SLOWDOWN,
  CMD_DT,
  CROUCH_SPEED,
  EYE_HEIGHT,
  JUMP_STAMINA,
  LEAN_OFFSET,
  LEAN_SPEED_MUL,
  MANTLE_FORWARD_SPEED,
  MANTLE_PRESS_HEIGHT,
  MANTLE_REACH,
  MANTLE_RISE_SPEED,
  PLAYER_RADIUS,
  SPRINT_DRAIN,
  SPRINT_SPEED,
  STAMINA_RECOVER,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  WALK_SPEED,
} from '../src/shared/constants.ts';
import { applyCmd, eyePosition, spawnState, type PlayerState } from '../src/shared/sim.ts';
import { World, type Box } from '../src/shared/world.ts';

const w = new World(1);
const o = w.outposts[0];

/** Open ground next to the first outpost, clear along +z (see movement.test.ts). */
function openGround(): PlayerState {
  const p = spawnState(o.x + 18, 0, o.z - 10);
  p.y = w.groundHeight(p.x, p.z, w.terrainHeight(p.x, p.z));
  return p;
}

/** Yaw that faces +z, along the open strip. */
const SOUTH = Math.PI;

function run(p: PlayerState, buttons: number, steps: number, yaw = SOUTH): void {
  for (let i = 0; i < steps; i++) applyCmd(w, p, { seq: i, buttons, yaw, pitch: 0 }, CMD_DT);
}

const speed = (p: PlayerState) => Math.hypot(p.vx, p.vz);
const seconds = (s: number) => Math.round(s / CMD_DT);
const SPRINT = Btn.Forward | Btn.Sprint;

const stacked = (a: Box, b: Box) =>
  Math.abs(b.minY - a.maxY) < 1e-6 && b.minX < a.maxX && b.maxX > a.minX && b.minZ < a.maxZ && b.maxZ > a.minZ;
const hasOnTop = (a: Box) => w.props.some((r) => r.box !== a && stacked(a, r.box));

/** An outpost crate `height` tall, with or without another crate on top. */
function crate(height: number, topped: boolean): Box {
  return w.props.find(
    (q) =>
      q.style === 'crate' &&
      w.outposts.some((op) => Math.abs(q.box.maxY - op.y - height) < 1e-6) &&
      hasOnTop(q.box) === topped,
  )!.box;
}

/** An outpost perimeter wall along x, `height` tall, that you can walk up to from +z. */
function wall(height: number): Box {
  return w.walls.find((b) => {
    if (b.maxZ - b.minZ > 1 || b.maxX - b.minX < 3) return false;
    const op = w.outposts.find((a) => Math.abs(b.maxY - a.y - height) < 1e-6);
    if (!op) return false;
    const x = (b.minX + b.maxX) / 2;
    return w.fits(x, op.y, b.maxZ + 0.6, 1.8) && w.fits(x, op.y, b.minZ - 1.5, 1.8);
  })!;
}

/** Standing `gap` metres in front of the +z face of `box`, facing it. */
function facing(box: Box, gap: number): PlayerState {
  const x = (box.minX + box.maxX) / 2;
  const z = box.maxZ + PLAYER_RADIUS + gap;
  return spawnState(x, w.groundHeight(x, z, box.minY + 0.5), z);
}

/** Hold jump and forward toward -z until the mantle finishes; returns steps taken. */
function mantle(p: PlayerState): number {
  let steps = 0;
  run(p, Btn.Forward | Btn.Jump, 1, 0);
  while (p.mantling && steps < 120) {
    run(p, Btn.Forward | Btn.Jump, 1, 0);
    steps++;
  }
  return steps;
}

describe('mantle', () => {
  it('climbs onto a waist-high crate quickly and stays on it', () => {
    const box = crate(1.2, false);
    const p = facing(box, 0.2);
    run(p, Btn.Forward | Btn.Jump, 1, 0);
    expect(p.mantling).toBe(true);
    expect(mantle(p) * CMD_DT).toBeLessThan(0.6);
    run(p, 0, 60, 0);
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(box.maxY, 6);
    expect(p.z).toBeLessThan(box.maxZ);
    expect(p.z).toBeGreaterThan(box.minZ);
  });

  it('pulls up to the hips straight, then presses up and over hunched, as long as before', () => {
    const box = crate(1.6, false);
    const p = facing(box, 0.1);
    const z0 = p.z;
    const height = box.maxY - p.y;
    run(p, Btn.Forward | Btn.Jump, 1, 0);
    let steps = 1;
    let overAt = Infinity;
    let duck = 0;
    while (p.mantling) {
      // Not over the edge until the hips are at it, nor on top before it's over.
      if (p.z !== z0) overAt = Math.min(overAt, p.y);
      if (p.y < box.maxY - MANTLE_PRESS_HEIGHT - 1e-6) expect(p.z).toBe(z0);
      duck = Math.max(duck, p.duck);
      run(p, Btn.Forward | Btn.Jump, 1, 0);
      steps++;
    }
    expect(overAt).toBeLessThan(box.maxY - 0.5);
    expect(duck).toBe(1);
    // Rising all the way and then moving over at their speeds.
    const reach = PLAYER_RADIUS + MANTLE_REACH + 0.35;
    expect(steps * CMD_DT).toBeCloseTo(height / MANTLE_RISE_SPEED + reach / MANTLE_FORWARD_SPEED, 1);
    run(p, 0, 30, 0);
    expect(p.y).toBeCloseTo(box.maxY, 6);
    expect(p.duck).toBe(0);
  });

  it('climbs a chest-high wall and drops over the other side', () => {
    const box = wall(1.2);
    const p = facing(box, 0.1);
    mantle(p);
    expect(p.y).toBeCloseTo(box.maxY, 6);
    run(p, Btn.Forward, 40, 0);
    expect(p.z).toBeLessThan(box.minZ - PLAYER_RADIUS);
    expect(p.onGround).toBe(true);
    expect(p.y).toBeLessThan(box.maxY - 1);
  });

  it('cannot get over a 3 m wall, even from a jump', () => {
    const box = wall(3);
    const p = facing(box, 0.1);
    let top = p.y;
    for (let i = 0; i < 120; i++) {
      run(p, Btn.Forward | Btn.Jump, 1, 0);
      expect(p.mantling).toBe(false);
      top = Math.max(top, p.y);
    }
    expect(top).toBeLessThan(box.maxY - 1);
    expect(p.z).toBeGreaterThan(box.maxZ);
  });

  it('can catch a ledge in the air after a jump', () => {
    const box = crate(1.6, false);
    const p = facing(box, 0.1);
    run(p, Btn.Jump, 1, 0);
    run(p, 0, 6, 0);
    expect(p.onGround).toBe(false);
    run(p, Btn.Forward | Btn.Jump, 1, 0);
    expect(p.mantling).toBe(true);
  });

  it('will not climb into a gap too small to crouch in', () => {
    const box = crate(1.6, true);
    const p = facing(box, 0.1);
    run(p, Btn.Forward | Btn.Jump, 1, 0);
    expect(p.mantling).toBe(false);
  });

  it('is impossible when carrying a heavy load', () => {
    const box = crate(1.2, false);
    const p = facing(box, 0.1);
    p.carry = CARRY_HEAVY;
    run(p, Btn.Forward | Btn.Jump, 60, 0);
    expect(p.y).toBeLessThan(box.maxY);
  });
});

describe('crouching from a sprint', () => {
  it('just slows to crouch speed: there is no slide', () => {
    const p = openGround();
    run(p, SPRINT, 60);
    run(p, SPRINT | Btn.Crouch, 1);
    expect(p.crouched).toBe(true);
    expect(speed(p)).toBeLessThanOrEqual(SPRINT_SPEED + 1e-6);
    run(p, SPRINT | Btn.Crouch, 60);
    expect(speed(p)).toBeCloseTo(CROUCH_SPEED, 2);
  });
});

describe('stamina', () => {
  it('drains while sprinting, winds you, then recovers', () => {
    const p = openGround();
    run(p, SPRINT, 60);
    expect(p.stamina).toBeCloseTo(1 - SPRINT_DRAIN, 1);
    // The open strip is too short to run dry on, so start nearly empty.
    p.stamina = 0.05;
    run(p, SPRINT, 30);
    expect(p.winded).toBe(true);
    run(p, SPRINT, 60);
    expect(speed(p)).toBeCloseTo(WALK_SPEED, 2);
    run(p, 0, seconds(STAMINA_REGEN_DELAY + STAMINA_RECOVER / STAMINA_REGEN) + 2);
    expect(p.winded).toBe(false);
  });

  it('is spent by jumping and refills after a pause', () => {
    const p = openGround();
    run(p, Btn.Jump, 1);
    expect(p.stamina).toBeCloseTo(1 - JUMP_STAMINA, 9);
    run(p, 0, seconds(STAMINA_REGEN_DELAY + 1));
    expect(p.stamina).toBe(1);
  });

  it('drains faster under load', () => {
    const light = openGround();
    const heavy = openGround();
    heavy.carry = CARRY_MAX;
    run(light, SPRINT, 60);
    run(heavy, SPRINT, 60);
    expect(1 - heavy.stamina).toBeGreaterThan((1 - light.stamina) * 1.8);
  });
});

describe('carry weight', () => {
  it('slows you down only past the free allowance', () => {
    const free = openGround();
    free.carry = 10;
    run(free, Btn.Forward, 60);
    expect(speed(free)).toBeCloseTo(WALK_SPEED, 2);
    const full = openGround();
    full.carry = CARRY_MAX;
    run(full, Btn.Forward, 60);
    expect(speed(full)).toBeCloseTo(WALK_SPEED * (1 - CARRY_SLOWDOWN), 2);
  });
});

describe('lean', () => {
  it('eases in and out and slows you down', () => {
    const p = openGround();
    run(p, Btn.LeanLeft, 15);
    expect(p.lean).toBe(-1);
    run(p, Btn.Forward | Btn.LeanRight, 60);
    expect(p.lean).toBe(1);
    expect(speed(p)).toBeCloseTo(WALK_SPEED * LEAN_SPEED_MUL, 2);
    run(p, 0, 15);
    expect(p.lean).toBe(0);
  });

  it('is cancelled by sprinting', () => {
    const p = openGround();
    run(p, Btn.LeanRight, 15);
    run(p, SPRINT | Btn.LeanRight, 15);
    expect(p.lean).toBe(0);
    expect(speed(p)).toBeGreaterThan(WALK_SPEED);
  });

  it('moves the eye sideways but not into a wall', () => {
    const p = openGround();
    const open = eyePosition(w, p.x, p.y, p.z, 0, 0, 1);
    expect(open.x).toBeCloseTo(p.x + LEAN_OFFSET, 6);
    expect(open.y).toBeCloseTo(p.y + EYE_HEIGHT, 6);
    expect(open.roll).toBeLessThan(0);

    // Face -x with the wall's +z face on the right, touching it.
    const box = wall(3);
    const x = (box.minX + box.maxX) / 2;
    const z = box.maxZ + PLAYER_RADIUS;
    const y = w.groundHeight(x, z, box.minY + 0.5);
    const eye = eyePosition(w, x, y, z, Math.PI / 2, 0, 1);
    expect(eye.z).toBeLessThan(z);
    expect(eye.z).toBeGreaterThan(box.maxZ);
  });
});
