import { Btn, SPRINT_SPEED, WALK_SPEED, WORLD_SIZE } from './constants.ts';
import { clamp } from './geom.ts';
import type { InputCmd } from './protocol.ts';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Advance a player by one command. Shared by server and (from chunk 2) client
 * prediction, so it must be deterministic: same state + same cmd = same result.
 *
 * Placeholder kinematic movement on a flat plane; real movement arrives in
 * chunk 2. Yaw 0 faces -z, matching Three.js cameras.
 */
export function applyCmd(p: PlayerState, cmd: InputCmd, dt: number): void {
  p.yaw = cmd.yaw;
  let fwd = 0;
  let side = 0;
  if (cmd.buttons & Btn.Forward) fwd += 1;
  if (cmd.buttons & Btn.Back) fwd -= 1;
  if (cmd.buttons & Btn.Right) side += 1;
  if (cmd.buttons & Btn.Left) side -= 1;
  const len = Math.hypot(fwd, side);
  if (len === 0) return;

  const speed = cmd.buttons & Btn.Sprint ? SPRINT_SPEED : WALK_SPEED;
  const step = (speed * dt) / len;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const half = WORLD_SIZE / 2;
  p.x = clamp(p.x + (-sin * fwd + cos * side) * step, -half, half);
  p.z = clamp(p.z + (-cos * fwd - sin * side) * step, -half, half);
}
