import * as THREE from 'three';
import { clamp, smoothstep } from '../shared/geom.ts';
import { BOLT, PISTOL } from '../shared/weapons.ts';

// What the hands and the gun's moving parts do while reloading or working a
// bolt, the same for bodies in the world and for your own arms. Each gun has
// its own reload: the rifle's left hand strips the magazine and lets it fall,
// then seats a full one from the belt; the pistol's magazine drops free, a
// fresh one goes up the grip and the left hand racks the slide; the
// bolt-action's bolt is lifted and drawn back, the left hand thumbs in as
// many rounds as it needs one by one, and the bolt is closed. The
// bolt-action also works its bolt after every shot, and the pistol's slide
// kicks back with each. Points on the gun are in its own space (see guns.ts);
// the belt pouch is wherever the caller keeps it. A hand working a part is
// put where that part is, so it never lets go of it.

/** A gun's marked points, in its own space. */
export interface GunPoints {
  grip: THREE.Vector3;
  support: THREE.Vector3;
  /** The base of the magazine (the loading port on the bolt-action). */
  magazine: THREE.Vector3;
  /** The end of the bolt handle, or where the hand takes the slide. */
  bolt: THREE.Vector3;
  /** What the bolt handle turns about, on the bore. */
  pivot: THREE.Vector3;
  /** The way the magazine leaves its well. */
  well: THREE.Vector3;
}

/**
 * Where a gun's moving parts are: the magazine in the gun, `number` metres
 * out down its well, in the left hand, or gone; the slide or bolt drawn back
 * `back` metres; and the bolt handle turned up, 0 to 1.
 */
export interface Parts {
  mag: number | 'hand' | 'gone';
  back: number;
  lift: number;
}

export const AT_REST: Readonly<Parts> = { mag: 0, back: 0, lift: 0 };

/** Where each hand goes, in the world, and whether the left one holds a fresh magazine or a round. */
export interface HandWork {
  left: THREE.Vector3;
  right: THREE.Vector3;
  /** 0 at rest to 1 away from its hold: how far the right hand has left the grip. */
  rightAway: number;
  holding: 'magazine' | 'round' | null;
  parts: Parts;
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

/** How far the bolt handle turns up, in radians, and how far the bolt and the pistol's slide travel back. */
const BOLT_LIFT = 1.2;
const BOLT_TRAVEL = 0.075;
const SLIDE_TRAVEL = 0.035;
/** Most rounds the bolt-action's reload thumbs in, and how many when nobody says. */
const MOST_ROUNDS = 5;
export const SOME_ROUNDS = 3;

/** Where the moving part is, as a matrix taking it from rest to where `parts` puts it, in the gun's space. */
export function actionMatrix(gun: GunPoints, parts: Parts, out: THREE.Matrix4): THREE.Matrix4 {
  out.makeTranslation(gun.pivot.x, gun.pivot.y, gun.pivot.z + parts.back);
  if (parts.lift > 0) out.multiply(M_A.makeRotationZ(parts.lift * BOLT_LIFT));
  return out.multiply(M_A.makeTranslation(-gun.pivot.x, -gun.pivot.y, -gun.pivot.z));
}

/** The magazine `out` metres down its well, as a matrix from where it sits in the gun. */
export function magazineMatrix(gun: GunPoints, out: number, m: THREE.Matrix4): THREE.Matrix4 {
  return m.makeTranslation(gun.well.x * out, gun.well.y * out, gun.well.z * out);
}

/** Where the magazine is `t` (0 to 1) through a reload of `weapon`: the bolt-action's never moves. */
export function reloadMagazine(weapon: number, t: number): Parts['mag'] {
  if (weapon === PISTOL) return t < 0.06 ? 0 : t < 0.3 ? 'gone' : t < 0.56 ? 'hand' : 0.07 * (1 - smoothstep(0.56, 0.64, t));
  if (weapon === BOLT) return 0;
  return t < 0.13 ? 0 : t < 0.22 ? 0.1 * smoothstep(0.13, 0.2, t) : t < 0.44 ? 'gone' : t < 0.64 ? 'hand' : 0.08 * (1 - smoothstep(0.64, 0.74, t));
}

/** The pistol's slide `firedFor` seconds after a shot: back and home again in a blink. */
export function shotParts(weapon: number, firedFor: number): Parts {
  if (weapon !== PISTOL || firedFor > 0.07) return AT_REST;
  return { mag: 0, back: SLIDE_TRAVEL * Math.sin(Math.PI * clamp(firedFor / 0.07, 0, 1)), lift: 0 };
}

/**
 * The hands `t` (0 to 1) through a reload of `weapon`, loading `rounds`
 * (for the bolt-action, which loads a round at a time). `toWorld` takes a
 * point in the gun's space to the world; `rest` holds where each hand is when
 * it's on the gun, `pouch` the belt, and `back` is the gun's rearward
 * direction in the world.
 */
export function reloadHands(
  weapon: number, t: number, rounds: number, gun: GunPoints, toWorld: (p: THREE.Vector3) => THREE.Vector3,
  rest: { left: THREE.Vector3; right: THREE.Vector3 }, pouch: THREE.Vector3, back: THREE.Vector3,
): HandWork {
  // The magazine's base `d` metres down its well.
  const out = (d: number): THREE.Vector3 => toWorld(gun.magazine.clone().addScaledVector(gun.well, d));
  if (weapon === PISTOL) {
    // The magazine drops free; a fresh one from the belt goes up the grip; then the left hand racks the slide.
    const grab = toWorld(gun.bolt.clone());
    const racked = grab.clone().addScaledVector(back, SLIDE_TRAVEL);
    const left = path(t, [
      [0, rest.left], [0.1, rest.left], [0.28, pouch], [0.38, pouch], [0.56, out(0.07)], [0.64, out(0)], [0.66, out(0)],
      [0.74, grab], [0.8, racked], [0.83, racked], [1, rest.left],
    ]);
    const mag = reloadMagazine(weapon, t);
    const slide = SLIDE_TRAVEL * smoothstep(0.74, 0.8, t) * (1 - smoothstep(0.83, 0.85, t));
    return { left, right: rest.right, rightAway: 0, holding: mag === 'hand' ? 'magazine' : null, parts: { mag, back: slide, lift: 0 } };
  }
  if (weapon === BOLT) {
    // The right hand lifts the bolt and draws it back; the left thumbs the rounds in; then the bolt closes.
    const lift = smoothstep(0.08, 0.12, t) * (1 - smoothstep(0.86, 0.9, t));
    const drawn = smoothstep(0.12, 0.18, t) * (1 - smoothstep(0.8, 0.86, t));
    const parts: Parts = { mag: 0, back: drawn * BOLT_TRAVEL, lift };
    const handle = toWorld(gun.bolt.clone().applyMatrix4(actionMatrix(gun, parts, M_B)));
    const right = t < 0.08 ? rest.right.clone().lerp(handle, smoothstep(0, 0.08, t))
      : t > 0.9 ? handle.lerp(rest.right, smoothstep(0.9, 1, t)) : handle;
    const port = toWorld(gun.magazine.clone().setY(gun.magazine.y + 0.02));
    const pressed = toWorld(gun.magazine.clone().setY(gun.magazine.y - 0.01));
    const n = clamp(Math.round(rounds), 1, MOST_ROUNDS);
    const keys: Key[] = [[0, rest.left], [0.18, rest.left]];
    const trip = 0.52 / n;
    for (let i = 0; i < n; i++) {
      const s = 0.2 + i * trip;
      keys.push([s + trip * 0.3, pouch], [s + trip * 0.4, pouch], [s + trip * 0.75, port], [s + trip * 0.95, pressed]);
    }
    keys.push([0.82, rest.left]);
    const left = path(t, keys);
    // A round in the fingers from the pouch to the port.
    const into = ((t - 0.2) % trip) / trip;
    const holding = t > 0.2 && t < 0.72 && into > 0.35 && into < 0.9 ? 'round' : null;
    return { left, right, rightAway: smoothstep(0, 0.08, t) * (1 - smoothstep(0.9, 1, t)), holding, parts };
  }
  // The rifle: the left hand strips the magazine and lets it fall, then brings a full one from the belt.
  const left = path(t, [
    [0, rest.left], [0.13, out(0)], [0.2, out(0.1)], [0.23, out(0.1)], [0.38, pouch], [0.46, pouch],
    [0.64, out(0.08)], [0.74, out(0)], [0.78, out(0)], [0.95, rest.left],
  ]);
  const mag = reloadMagazine(weapon, t);
  return { left, right: rest.right, rightAway: 0, holding: mag === 'hand' ? 'magazine' : null, parts: { mag, back: 0, lift: 0 } };
}

/** Seconds after a bolt-action shot that the bolt is worked, and how long it takes. */
export const BOLT_START = 0.3;
export const BOLT_TIME = 0.6;

/**
 * The right hand working the bolt after a shot, `c` (0 to 1) of the way
 * through: to the handle, which it lifts, draws back, pushes home and turns
 * down, and back to the grip. Returns how far away from the grip it is, and
 * where the bolt is.
 */
export function boltHand(
  c: number, gun: GunPoints, toWorld: (p: THREE.Vector3) => THREE.Vector3, grip: THREE.Vector3,
): { at: THREE.Vector3; away: number; parts: Parts } {
  const lift = smoothstep(0.2, 0.32, c) * (1 - smoothstep(0.66, 0.76, c));
  const drawn = smoothstep(0.32, 0.5, c) * (1 - smoothstep(0.5, 0.66, c));
  const parts: Parts = { mag: 0, back: drawn * BOLT_TRAVEL, lift };
  const handle = toWorld(gun.bolt.clone().applyMatrix4(actionMatrix(gun, parts, M_B)));
  const at = c < 0.2 ? grip.clone().lerp(handle, smoothstep(0, 0.2, c)) : c > 0.76 ? handle.lerp(grip, smoothstep(0.76, 1, c)) : handle;
  return { at, away: smoothstep(0, 0.2, c) * (1 - smoothstep(0.76, 1, c)), parts };
}

const M_A = new THREE.Matrix4();
const M_B = new THREE.Matrix4();
