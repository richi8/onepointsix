import { CROUCH_EYE_HEIGHT, EYE_HEIGHT, LEAN_OFFSET } from './constants.ts';
import { lerp, rayCylinder, raySphere } from './geom.ts';

export type Zone = 'head' | 'torso' | 'legs';

/** What hit detection needs to know about a body; snapshots carry the same fields. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  duck: number;
  lean: number;
}

export const HEAD_RADIUS = 0.15;
export const TORSO_RADIUS = 0.25;
export const LEGS_RADIUS = 0.2;
const HIP_STAND = 0.9;
const HIP_CROUCH = 0.4;
/** How much of the head's lean the torso follows. */
const TORSO_LEAN = 0.5;

/**
 * A body's hit volumes: a head sphere at eye height, a torso cylinder from the
 * hips to the neck and a legs cylinder down to the feet. Crouching lowers the
 * head and hips; leaning shifts the head fully and the torso halfway. The
 * renderer draws bodies from the same numbers, so what you see is what you hit.
 */
export interface Hitboxes {
  headX: number;
  headY: number;
  headZ: number;
  torsoX: number;
  torsoZ: number;
  hipY: number;
  neckY: number;
}

export function hitboxes(p: Pose): Hitboxes {
  const headY = p.y + lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, p.duck);
  const side = p.lean * LEAN_OFFSET;
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  return {
    headX: p.x + rx * side,
    headY,
    headZ: p.z + rz * side,
    torsoX: p.x + rx * side * TORSO_LEAN,
    torsoZ: p.z + rz * side * TORSO_LEAN,
    hipY: p.y + lerp(HIP_STAND, HIP_CROUCH, p.duck),
    neckY: headY - HEAD_RADIUS,
  };
}

/** Nearest zone a normalized ray hits within maxT, or null. */
export function rayBody(
  p: Pose,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxT: number,
): { t: number; zone: Zone } | null {
  const h = hitboxes(p);
  let t = maxT;
  let zone: Zone | null = null;
  const head = raySphere(ox, oy, oz, dx, dy, dz, h.headX, h.headY, h.headZ, HEAD_RADIUS);
  if (head < t) (t = head), (zone = 'head');
  const torso = rayCylinder(ox, oy, oz, dx, dy, dz, h.torsoX, h.torsoZ, TORSO_RADIUS, h.hipY, h.neckY);
  if (torso < t) (t = torso), (zone = 'torso');
  const legs = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, LEGS_RADIUS, p.y, h.hipY);
  if (legs < t) (t = legs), (zone = 'legs');
  return zone ? { t, zone } : null;
}
