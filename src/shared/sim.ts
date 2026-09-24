import {
  AIR_ACCEL,
  AIR_WISH_CAP,
  Btn,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  DUCK_RATE,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_SPEED,
  MAX_FALL_SPEED,
  MAX_HORIZONTAL_SPEED,
  MAX_PITCH,
  PLAYER_HEIGHT,
  SPRINT_SPEED,
  STEP_HEIGHT,
  STOP_SPEED,
  WALK_SPEED,
  WATER_LEVEL,
  WATER_SPEED_MUL,
} from './constants.ts';
import { clamp } from './geom.ts';
import type { InputCmd } from './protocol.ts';
import type { Body, World } from './world.ts';

/** Feet this far below the surface count as wading. */
const WADE_DEPTH = 0.4;

/**
 * Everything applyCmd reads or writes. The server sends it back to the owning
 * client so prediction can restart from exactly the authoritative state.
 */
export interface PlayerState extends Body {
  vy: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  /** Collision hull is crouch height. */
  crouched: boolean;
  /** 0 standing to 1 crouched, eased; drives eye height and speed. */
  duck: number;
  /** Jump was held last command; jumping needs a fresh press. */
  jumpHeld: boolean;
}

export function spawnState(x: number, y: number, z: number): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, crouched: false, duck: 0, jumpHeld: false };
}

/** A plain copy of just the movement fields, safe to send or snapshot. */
export function copyState(p: PlayerState): PlayerState {
  const { x, y, z, vx, vy, vz, yaw, pitch, onGround, crouched, duck, jumpHeld } = p;
  return { x, y, z, vx, vy, vz, yaw, pitch, onGround, crouched, duck, jumpHeld };
}

export function bodyHeight(p: PlayerState): number {
  return p.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT;
}

/**
 * Advance a player by one command. Shared by the server and client prediction,
 * so it must be deterministic: same state + same cmd = same result.
 *
 * Quake/GoldSrc-style movement: ground friction and acceleration toward the
 * wished velocity, and weak capped air acceleration so air strafing works.
 * Yaw 0 faces -z, matching Three.js cameras.
 */
export function applyCmd(world: World, p: PlayerState, cmd: InputCmd, dt: number): void {
  const b = cmd.buttons;
  p.yaw = cmd.yaw;
  p.pitch = clamp(cmd.pitch, -MAX_PITCH, MAX_PITCH);

  // Crouch is instant going down; standing up needs headroom.
  if (b & Btn.Crouch) p.crouched = true;
  else if (p.crouched && world.ceilingHeight(p.x, p.z, p.y + CROUCH_HEIGHT) >= p.y + PLAYER_HEIGHT) p.crouched = false;
  const duckTarget = p.crouched ? 1 : 0;
  p.duck += clamp(duckTarget - p.duck, -DUCK_RATE * dt, DUCK_RATE * dt);

  const jump = (b & Btn.Jump) !== 0;
  let jumped = false;
  if (jump && !p.jumpHeld && p.onGround) {
    p.vy = JUMP_SPEED;
    p.onGround = false;
    jumped = true;
  }
  p.jumpHeld = jump;

  if (p.onGround && !jumped) friction(p, dt);

  let fwd = 0;
  let side = 0;
  if (b & Btn.Forward) fwd += 1;
  if (b & Btn.Back) fwd -= 1;
  if (b & Btn.Right) side += 1;
  if (b & Btn.Left) side -= 1;
  const len = Math.hypot(fwd, side);
  if (len > 0) {
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const wx = (-sin * fwd + cos * side) / len;
    const wz = (-cos * fwd - sin * side) / len;
    const sprint = (b & Btn.Sprint) !== 0 && fwd > 0 && !p.crouched;
    let wishSpeed = sprint ? SPRINT_SPEED : WALK_SPEED;
    wishSpeed += (CROUCH_SPEED - wishSpeed) * p.duck;
    if (p.y < WATER_LEVEL - WADE_DEPTH) wishSpeed *= WATER_SPEED_MUL;
    if (p.onGround) accelerate(p, wx, wz, wishSpeed, wishSpeed, GROUND_ACCEL, dt);
    else accelerate(p, wx, wz, Math.min(wishSpeed, AIR_WISH_CAP), wishSpeed, AIR_ACCEL, dt);
  }

  const speed = Math.hypot(p.vx, p.vz);
  if (speed > MAX_HORIZONTAL_SPEED) {
    p.vx *= MAX_HORIZONTAL_SPEED / speed;
    p.vz *= MAX_HORIZONTAL_SPEED / speed;
  }

  const height = bodyHeight(p);
  p.x = clamp(p.x + p.vx * dt, -world.half, world.half);
  p.z = clamp(p.z + p.vz * dt, -world.half, world.half);
  world.collide(p, height);

  const wasOnGround = p.onGround;
  if (!p.onGround) p.vy = Math.max(p.vy - GRAVITY * dt, -MAX_FALL_SPEED);
  const ceil = world.ceilingHeight(p.x, p.z, p.y + height);
  p.y += p.vy * dt;
  if (p.y + height > ceil) {
    p.y = ceil - height;
    if (p.vy > 0) p.vy = 0;
  }

  const ground = world.groundHeight(p.x, p.z, p.y);
  if (p.y <= ground) {
    p.y = ground;
    p.vy = 0;
    p.onGround = true;
  } else if (wasOnGround && p.y - ground <= STEP_HEIGHT) {
    // Stick to the ground walking downhill or down steps instead of skipping.
    p.y = ground;
    p.vy = 0;
  } else {
    p.onGround = false;
  }
}

function friction(p: PlayerState, dt: number): void {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < 1e-4) {
    p.vx = 0;
    p.vz = 0;
    return;
  }
  const drop = Math.max(speed, STOP_SPEED) * FRICTION * dt;
  const k = Math.max(speed - drop, 0) / speed;
  p.vx *= k;
  p.vz *= k;
}

/** Add speed along (wx, wz) until the projected speed reaches `cap`. */
function accelerate(p: PlayerState, wx: number, wz: number, cap: number, wishSpeed: number, accel: number, dt: number): void {
  const add = cap - (p.vx * wx + p.vz * wz);
  if (add <= 0) return;
  const a = Math.min(accel * wishSpeed * dt, add);
  p.vx += a * wx;
  p.vz += a * wz;
}
