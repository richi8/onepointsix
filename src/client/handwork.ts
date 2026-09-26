import * as THREE from 'three';
import { smoothstep } from '../shared/geom.ts';
import { BOLT, PISTOL } from '../shared/weapons.ts';

// What the hands do while reloading or working a bolt, the same for bodies in
// the world and for your own arms. Each gun has its own reload: the rifle
// swaps its magazine; the pistol tips, drops its magazine, takes a small one
// from the belt and racks the slide; the bolt-action opens its bolt, thumbs
// rounds into the port one by one and closes it. The bolt-action also works
// its bolt after every shot. Points on the gun are in its own space (see
// guns.ts); the belt pouch is wherever the caller keeps it.

/** A gun's marked points, in its own space. */
export interface GunPoints {
  grip: THREE.Vector3;
  support: THREE.Vector3;
  magazine: THREE.Vector3;
  bolt: THREE.Vector3;
}

/** Where each hand goes, in the world, and whether the left one holds a fresh magazine or a round. */
export interface HandWork {
  left: THREE.Vector3;
  right: THREE.Vector3;
  /** 0 at rest to 1 away from its hold: how far the right hand has left the grip. */
  rightAway: number;
  holding: 'magazine' | 'round' | null;
}

type Key = [t: number, where: THREE.Vector3];

/** A point moving through keyframes [time, where], eased between them. */
export function path(t: number, keys: Key[]): THREE.Vector3 {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i];
    if (t > t1) continue;
    const [t0, p0] = keys[i - 1];
    return p0.clone().lerp(p1, smoothstep(t0, t1, t));
  }
  return keys[keys.length - 1][1];
}

/** How many rounds the bolt-action's reload thumbs in, whatever the count: the hand's trips are for show. */
const ROUNDS = 3;

/**
 * The hands `t` (0 to 1) through a reload of `weapon`. `toWorld` takes a
 * point in the gun's space to the world; `rest` holds where each hand is
 * when it's on the gun, `pouch` the belt, and `up`, `back` are the gun's own
 * up and rearward directions in the world, for small movements about a part.
 */
export function reloadHands(
  weapon: number, t: number, gun: GunPoints, toWorld: (p: THREE.Vector3) => THREE.Vector3,
  rest: { left: THREE.Vector3; right: THREE.Vector3 }, pouch: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3,
): HandWork {
  const at = (p: THREE.Vector3, dUp = 0, dBack = 0): THREE.Vector3 =>
    toWorld(p.clone()).addScaledVector(up, dUp).addScaledVector(back, dBack);
  if (weapon === PISTOL) {
    // Under the grip, the magazine drops; a fresh one from the belt goes up into it; then the slide.
    const base = at(gun.magazine, -0.04);
    const seated = at(gun.magazine, 0.01);
    const slide = at(gun.bolt, 0.02);
    const left = path(t, [
      [0, rest.left], [0.12, base], [0.3, pouch], [0.4, pouch], [0.58, base], [0.66, seated],
      [0.76, slide], [0.82, slide.clone().addScaledVector(back, 0.06)], [0.86, slide.clone().addScaledVector(back, 0.06)], [1, rest.left],
    ]);
    return { left, right: rest.right, rightAway: 0, holding: t > 0.32 && t < 0.64 ? 'magazine' : null };
  }
  if (weapon === BOLT) {
    // The right hand opens the bolt and holds it back; the left thumbs the rounds in; then the bolt closes.
    const handle = at(gun.bolt);
    const lifted = at(gun.bolt, 0.035);
    const open = at(gun.bolt, 0.035, 0.09);
    const right = path(t, [
      [0, rest.right], [0.08, handle], [0.12, lifted], [0.18, open], [0.8, open], [0.86, lifted], [0.9, handle], [1, rest.right],
    ]);
    const port = at(gun.magazine, 0.03);
    const pressed = at(gun.magazine, -0.01);
    const keys: Key[] = [[0, rest.left], [0.18, rest.left]];
    const trip = 0.52 / ROUNDS;
    for (let i = 0; i < ROUNDS; i++) {
      const s = 0.2 + i * trip;
      keys.push([s + trip * 0.3, pouch], [s + trip * 0.4, pouch], [s + trip * 0.75, port], [s + trip * 0.95, pressed]);
    }
    keys.push([0.82, rest.left]);
    const left = path(t, keys);
    // A round in the fingers from the pouch to the port.
    const into = (t - 0.2) % trip / trip;
    const holding = t > 0.2 && t < 0.72 && into > 0.35 && into < 0.9 ? 'round' : null;
    return { left, right, rightAway: smoothstep(0, 0.08, t) * (1 - smoothstep(0.9, 1, t)), holding };
  }
  // The rifle: under the magazine well, down to a pouch on the belt, and back with a full one.
  const well = at(gun.magazine, -0.02);
  const seated = at(gun.magazine, 0.03);
  const left = path(t, [[0, rest.left], [0.15, well], [0.35, pouch], [0.5, pouch], [0.68, well], [0.76, seated], [0.95, rest.left]]);
  return { left, right: rest.right, rightAway: 0, holding: t > 0.37 && t < 0.74 ? 'magazine' : null };
}

/** Seconds after a bolt-action shot that the bolt is worked, and how long it takes. */
export const BOLT_START = 0.3;
export const BOLT_TIME = 0.6;

/**
 * The right hand working the bolt after a shot, `c` (0 to 1) of the way
 * through: to the handle, up, back, forward, down and back to the grip.
 * Returns how far away from the grip it is as well.
 */
export function boltHand(
  c: number, gun: GunPoints, toWorld: (p: THREE.Vector3) => THREE.Vector3,
  grip: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3,
): { at: THREE.Vector3; away: number } {
  const handle = toWorld(gun.bolt.clone());
  const lifted = handle.clone().addScaledVector(up, 0.035);
  const open = lifted.clone().addScaledVector(back, 0.09);
  const at = path(c, [[0, grip], [0.2, handle], [0.32, lifted], [0.5, open], [0.66, lifted], [0.76, handle], [1, grip]]);
  return { at, away: smoothstep(0, 0.2, c) * (1 - smoothstep(0.76, 1, c)) };
}
