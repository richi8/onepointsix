import { describe, expect, it } from 'vitest';
import {
  Btn,
  CMD_DT,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
} from '../src/shared/constants.ts';
import { applyCmd, spawnState, type PlayerState } from '../src/shared/sim.ts';
import { World } from '../src/shared/world.ts';

const w = new World(1);

/**
 * A spot on an outpost's flattened plateau, outside its walls. Trees, rocks
 * and scattered cover are kept away from outposts, so running +z is clear.
 */
function openGround(): PlayerState {
  const o = w.outposts[0];
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

describe('ground movement', () => {
  it('accelerates quickly to walk speed and no further', () => {
    const p = openGround();
    run(p, Btn.Forward, 12);
    expect(speed(p)).toBeGreaterThan(WALK_SPEED * 0.95);
    run(p, Btn.Forward, 60);
    expect(speed(p)).toBeCloseTo(WALK_SPEED, 2);
    expect(p.vz).toBeGreaterThan(0);
    expect(p.onGround).toBe(true);
  });

  it('sprints only when moving forward', () => {
    const p = openGround();
    run(p, Btn.Forward | Btn.Sprint, 60);
    expect(speed(p)).toBeCloseTo(SPRINT_SPEED, 2);
    const q = openGround();
    run(q, Btn.Back | Btn.Sprint, 60, 0);
    expect(speed(q)).toBeCloseTo(WALK_SPEED, 2);
  });

  it('does not go faster diagonally', () => {
    const p = openGround();
    run(p, Btn.Forward | Btn.Right, 60);
    expect(speed(p)).toBeCloseTo(WALK_SPEED, 2);
  });

  it('stops from a sprint within half a second', () => {
    const p = openGround();
    run(p, Btn.Forward | Btn.Sprint, 60);
    run(p, 0, 30);
    expect(speed(p)).toBe(0);
  });

  it('moves slowly and lowers the eye while crouched, and stands back up', () => {
    const p = openGround();
    run(p, Btn.Forward | Btn.Crouch | Btn.Sprint, 60);
    expect(p.crouched).toBe(true);
    expect(p.duck).toBe(1);
    expect(speed(p)).toBeCloseTo(CROUCH_SPEED, 2);
    run(p, 0, 30);
    expect(p.crouched).toBe(false);
    expect(p.duck).toBe(0);
  });
});

describe('jumping', () => {
  it('follows a ballistic arc and lands where it started', () => {
    const p = openGround();
    const y0 = p.y;
    let peak = y0;
    let air = 0;
    run(p, Btn.Jump, 1);
    expect(p.onGround).toBe(false);
    while (!p.onGround && air < 120) {
      run(p, 0, 1);
      peak = Math.max(peak, p.y);
      air++;
    }
    const ideal = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(peak - y0).toBeGreaterThan(ideal - 0.15);
    expect(peak - y0).toBeLessThan(ideal + 0.05);
    expect(air * CMD_DT).toBeCloseTo((2 * JUMP_SPEED) / GRAVITY, 1);
    expect(p.y).toBeCloseTo(y0, 6);
  });

  it('needs a fresh press to jump again', () => {
    const p = openGround();
    run(p, Btn.Jump, 120);
    expect(p.onGround).toBe(true);
    run(p, Btn.Jump, 1);
    expect(p.onGround).toBe(true);
    run(p, 0, 1);
    run(p, Btn.Jump, 1);
    expect(p.onGround).toBe(false);
  });

  it('cannot gain speed in the air by holding forward', () => {
    const p = openGround();
    run(p, Btn.Forward | Btn.Sprint, 60);
    run(p, Btn.Forward | Btn.Sprint | Btn.Jump, 1);
    run(p, Btn.Forward | Btn.Sprint, 30);
    expect(p.onGround).toBe(false);
    expect(speed(p)).toBeLessThanOrEqual(SPRINT_SPEED + 1e-9);
  });

  it('can strafe sideways in the air, but only a little', () => {
    const p = openGround();
    run(p, Btn.Forward, 60);
    run(p, Btn.Forward | Btn.Jump, 1);
    run(p, Btn.Right, 30);
    expect(p.onGround).toBe(false);
    // Right of +z-facing is -x.
    expect(p.vx).toBeLessThan(-0.5);
    expect(p.vz).toBeCloseTo(WALK_SPEED, 0);
  });
});
