import { GRAVITY, GRENADE_BOUNCE, GRENADE_FRICTION, MAX_FALL_SPEED } from './constants.ts';
import { clamp } from './geom.ts';
import type { Toss } from './weapons.ts';
import type { World } from './world.ts';

/** How far the grenade's centre keeps from surfaces. */
export const GRENADE_SIZE = 0.06;
/** Slower than this on a floor, it stops rolling. */
const REST_SPEED = 1.5;
/** Surfaces facing up at least this much count as floors. */
const FLOOR_NORMAL = 0.7;
/** Rolling along a floor loses speed at this exponential rate per second. */
const ROLL_DRAG = 3;

/** A live grenade in flight or lying on the ground. */
export interface Grenade {
  id: number;
  /** Who threw it. */
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds until it goes off. */
  fuse: number;
  /** Lying still on a floor. */
  rest: boolean;
}

export function launchGrenade(id: number, owner: number, toss: Toss, fuse: number): Grenade {
  const { x, y, z, vx, vy, vz } = toss;
  return { id, owner, x, y, z, vx, vy, vz, fuse, rest: false };
}

/**
 * Advance a grenade: fall, fly, and bounce off whatever it meets, losing
 * speed each time, until it settles on a floor. One that settled starts
 * falling again if the floor under it breaks.
 */
export function stepGrenade(world: World, g: Grenade, dt: number): void {
  g.fuse -= dt;
  if (g.rest) {
    if (world.raycast(g.x, g.y, g.z, 0, -1, 0, GRENADE_SIZE * 2) <= GRENADE_SIZE * 2) return;
    g.rest = false;
  }
  g.vy = Math.max(g.vy - GRAVITY * dt, -MAX_FALL_SPEED);
  const speed = Math.hypot(g.vx, g.vy, g.vz);
  if (speed < 1e-6) return;
  const dx = g.vx / speed;
  const dy = g.vy / speed;
  const dz = g.vz / speed;
  const step = speed * dt;
  const t = world.raycast(g.x, g.y, g.z, dx, dy, dz, step + GRENADE_SIZE);
  if (t > step + GRENADE_SIZE) {
    g.x += dx * step;
    g.y += dy * step;
    g.z += dz * step;
  } else {
    const hx = g.x + dx * t;
    const hy = g.y + dy * t;
    const hz = g.z + dz * t;
    const [nx, ny, nz] = world.surfaceNormal(hx, hy, hz);
    g.x = hx + nx * GRENADE_SIZE;
    g.y = hy + ny * GRENADE_SIZE;
    g.z = hz + nz * GRENADE_SIZE;
    const vn = g.vx * nx + g.vy * ny + g.vz * nz;
    if (vn < 0) {
      // Reflect the part into the surface, damped, and scrub the rest.
      g.vx = (g.vx - vn * nx) * GRENADE_FRICTION - vn * nx * GRENADE_BOUNCE;
      g.vy = (g.vy - vn * ny) * GRENADE_FRICTION - vn * ny * GRENADE_BOUNCE;
      g.vz = (g.vz - vn * nz) * GRENADE_FRICTION - vn * nz * GRENADE_BOUNCE;
    }
    if (ny >= FLOOR_NORMAL) roll(g, dt);
  }
  g.x = clamp(g.x, -world.half, world.half);
  g.z = clamp(g.z, -world.half, world.half);
  const floor = world.terrainHeight(g.x, g.z) + GRENADE_SIZE;
  if (g.y < floor) {
    g.y = floor;
    if (g.vy < 0) g.vy = 0;
    roll(g, dt);
  }
}

/** On a floor: drag, and come to rest once slow enough. */
function roll(g: Grenade, dt: number): void {
  const k = Math.exp(-ROLL_DRAG * dt);
  g.vx *= k;
  g.vz *= k;
  if (Math.hypot(g.vx, g.vy, g.vz) < REST_SPEED) {
    g.vx = g.vy = g.vz = 0;
    g.rest = true;
  }
}
