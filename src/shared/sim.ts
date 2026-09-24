import { Btn, SPRINT_SPEED, WALK_SPEED } from './constants.ts';
import { clamp } from './geom.ts';
import type { InputCmd } from './protocol.ts';
import type { Body, World } from './world.ts';

export interface PlayerState extends Body {
  yaw: number;
}

/**
 * Advance a player by one command. Shared by server and (from chunk 2) client
 * prediction, so it must be deterministic: same state + same cmd = same result.
 *
 * Placeholder kinematic movement that follows the terrain, steps onto low
 * props and slides along obstacles; real movement arrives in chunk 2.
 * Yaw 0 faces -z, matching Three.js cameras.
 */
export function applyCmd(world: World, p: PlayerState, cmd: InputCmd, dt: number): void {
  p.yaw = cmd.yaw;
  let fwd = 0;
  let side = 0;
  if (cmd.buttons & Btn.Forward) fwd += 1;
  if (cmd.buttons & Btn.Back) fwd -= 1;
  if (cmd.buttons & Btn.Right) side += 1;
  if (cmd.buttons & Btn.Left) side -= 1;
  const len = Math.hypot(fwd, side);
  p.vx = 0;
  p.vz = 0;
  if (len > 0) {
    const speed = (cmd.buttons & Btn.Sprint ? SPRINT_SPEED : WALK_SPEED) / len;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    p.vx = (-sin * fwd + cos * side) * speed;
    p.vz = (-cos * fwd - sin * side) * speed;
    p.x = clamp(p.x + p.vx * dt, -world.half, world.half);
    p.z = clamp(p.z + p.vz * dt, -world.half, world.half);
    world.collide(p);
  }
  p.y = world.groundHeight(p.x, p.z, p.y);
}
