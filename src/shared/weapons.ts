import {
  BURST_RESET,
  Btn,
  CROUCH_SPREAD_MUL,
  GRENADES,
  HEADSHOT_MUL,
  LEGS_MUL,
  MAX_PITCH,
  RECOIL_RECOVER_DELAY,
  RECOIL_RECOVER_RATE,
  THROW_LOFT,
  THROW_SPEED,
  THROW_TIME,
  WALK_SPEED,
} from './constants.ts';
import { clamp, lerp } from './geom.ts';
import type { Zone } from './hitbox.ts';
import type { InputCmd } from './protocol.ts';
import { hash2 } from './rng.ts';
import type { PlayerState } from './sim.ts';

export interface WeaponDef {
  name: string;
  /** Keeps firing while the trigger is held; otherwise every shot needs a fresh press. */
  auto: boolean;
  /** Seconds between shots. */
  interval: number;
  /** Torso damage up close. */
  damage: number;
  /** Damage starts falling off at this range and bottoms out at falloffEnd. */
  falloffStart: number;
  falloffEnd: number;
  /** Fraction of the damage left at falloffEnd and beyond. */
  falloffMin: number;
  range: number;
  magSize: number;
  /** Spare rounds carried at spawn. */
  reserve: number;
  reloadTime: number;
  /** Seconds to bring the weapon up after switching to it. */
  drawTime: number;
  /** Seconds to go fully down the sights. */
  aimTime: number;
  /** Field of view divisor when fully aimed. */
  zoom: number;
  /** Movement speed multiple when fully aimed. */
  aimSpeed: number;
  /** Spread cone half-angles in radians: from the hip, aimed, extra at full walk speed, extra in the air. */
  hipSpread: number;
  aimSpread: number;
  moveSpread: number;
  airSpread: number;
  /** Recoil per shot in radians: vertical climb and horizontal wander. */
  kick: number;
  wander: number;
  /** Carried mass in kg, for later when loadouts count toward carry weight. */
  mass: number;
  /** How far away a shot can be heard, in metres. */
  noise: number;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    name: 'Assault rifle',
    auto: true,
    interval: 0.1,
    damage: 28,
    falloffStart: 60,
    falloffEnd: 250,
    falloffMin: 0.7,
    range: 500,
    magSize: 30,
    reserve: 120,
    reloadTime: 2.3,
    drawTime: 0.55,
    aimTime: 0.2,
    zoom: 1.4,
    aimSpeed: 0.7,
    hipSpread: 0.025,
    aimSpread: 0.0015,
    moveSpread: 0.03,
    airSpread: 0.08,
    kick: 0.012,
    wander: 0.006,
    mass: 3.5,
    noise: 180,
  },
  {
    name: 'Pistol',
    auto: false,
    interval: 0.12,
    damage: 24,
    falloffStart: 20,
    falloffEnd: 80,
    falloffMin: 0.6,
    range: 150,
    magSize: 15,
    reserve: 45,
    reloadTime: 1.6,
    drawTime: 0.35,
    aimTime: 0.15,
    zoom: 1.2,
    aimSpeed: 0.8,
    hipSpread: 0.02,
    aimSpread: 0.004,
    moveSpread: 0.02,
    airSpread: 0.06,
    kick: 0.03,
    wander: 0.01,
    mass: 1,
    noise: 110,
  },
  {
    name: 'Bolt-action rifle',
    auto: false,
    interval: 1.25,
    damage: 105,
    falloffStart: 1000,
    falloffEnd: 1000,
    falloffMin: 1,
    range: 1000,
    magSize: 5,
    reserve: 25,
    reloadTime: 3,
    drawTime: 0.65,
    aimTime: 0.3,
    zoom: 4,
    aimSpeed: 0.55,
    hipSpread: 0.05,
    aimSpread: 0,
    moveSpread: 0.04,
    airSpread: 0.1,
    kick: 0.07,
    wander: 0.02,
    mass: 4.5,
    noise: 260,
  },
];

export const RIFLE = 0;
export const PISTOL = 1;
export const BOLT = 2;
/** Not a weapon in hand, but kills are credited to it like one. */
export const GRENADE = WEAPONS.length;

/** What killed someone, for the kill feed. */
export function weaponName(weapon: number): string {
  return weapon === GRENADE ? 'Grenade' : (WEAPONS[weapon]?.name ?? '');
}

/** Timers at or below this count as expired, so float drift can't cost a step. */
const EPS = 1e-6;

/** A fired round: where from, which way, and which command fired it. */
export interface Shot {
  weapon: number;
  seq: number;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  /** Fired through a suppressor. */
  quiet: boolean;
}

/** A thrown grenade: where it left the hand and how fast. */
export interface Toss {
  seq: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Things worth showing or playing when they happen, predicted on the client. */
export type WeaponFx =
  | { k: 'shot'; shot: Shot }
  | { k: 'throw'; toss: Toss }
  | { k: 'dry'; weapon: number }
  | { k: 'reload'; weapon: number }
  | { k: 'reloaded'; weapon: number }
  | { k: 'draw'; weapon: number };

export interface WeaponState {
  /** Index into WEAPONS of the weapon in hand. */
  weapon: number;
  /** Rounds in each weapon's magazine and spare, by weapon index. */
  mag: number[];
  reserve: number[];
  /** Seconds until the next shot may fire. */
  cooldown: number;
  /** Seconds of reload left; reloading while above 0. */
  reload: number;
  /** Seconds until the weapon is up after a switch. */
  draw: number;
  /** Fire was held last command; semi-auto weapons need a fresh press. */
  triggerHeld: boolean;
  /** 0 from the hip to 1 fully aimed down the sights, eased. */
  aim: number;
  /** Recoil added to the view, in radians. */
  recoilPitch: number;
  recoilYaw: number;
  /** Shots in the current burst; drives the recoil pattern. */
  burst: number;
  /** Seconds since the last shot. */
  sinceShot: number;
  /** Grenades left. */
  grenades: number;
  /** Throw was held last command; each throw needs a fresh press. */
  throwHeld: boolean;
  /** Which weapons have a suppressor fitted, by weapon index. */
  suppressed: boolean[];
}

export function spawnWeapons(): WeaponState {
  return {
    weapon: RIFLE,
    mag: WEAPONS.map((w) => w.magSize),
    reserve: WEAPONS.map((w) => w.reserve),
    cooldown: 0, reload: 0, draw: 0, triggerHeld: false, aim: 0,
    recoilPitch: 0, recoilYaw: 0, burst: 0, sinceShot: 1, grenades: GRENADES, throwHeld: false,
    suppressed: WEAPONS.map(() => false),
  };
}

/** Current spread cone half-angle for a player, from stance, movement and aim. */
export function spreadOf(p: PlayerState): number {
  const w = WEAPONS[p.weapon];
  let s = lerp(w.hipSpread, w.aimSpread, p.aim);
  s += w.moveSpread * clamp(Math.hypot(p.vx, p.vz) / WALK_SPEED, 0, 1.5);
  if (!p.onGround && !p.mantling) s += w.airSpread;
  return s * lerp(1, CROUCH_SPREAD_MUL, p.duck);
}

/** The pitch actually aimed at: the view plus recoil. */
export function aimPitch(p: PlayerState): number {
  return clamp(p.pitch + p.recoilPitch, -MAX_PITCH, MAX_PITCH);
}

export function aimYaw(p: PlayerState): number {
  return p.yaw + p.recoilYaw;
}

/**
 * Direction of a round fired along yaw/pitch with a spread cone. The offset
 * comes from the command's seq, so the client predicts the exact same shot.
 */
export function shotDirection(yaw: number, pitch: number, spread: number, seq: number): [number, number, number] {
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  if (spread <= 0) return [fx, fy, fz];
  // Uniform over the cone's disc: radius by sqrt, angle by a second hash.
  const r = Math.tan(spread) * Math.sqrt(hash2(seq, 1, 0x5eed));
  const a = hash2(seq, 2, 0x5eed) * Math.PI * 2;
  const ox = Math.cos(a) * r;
  const oy = Math.sin(a) * r;
  // right = (cos yaw, 0, -sin yaw); up = right x forward.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const dx = fx + rx * ox + ux * oy;
  const dy = fy + uy * oy;
  const dz = fz + rz * ox + uz * oy;
  const len = Math.hypot(dx, dy, dz);
  return [dx / len, dy / len, dz / len];
}

export function zoneMultiplier(zone: Zone): number {
  return zone === 'head' ? HEADSHOT_MUL : zone === 'legs' ? LEGS_MUL : 1;
}

/** Damage a round does at `dist` metres to `zone`, rounded to whole points. */
export function damageAt(weapon: number, dist: number, zone: Zone): number {
  const w = WEAPONS[weapon];
  const f = w.falloffEnd > w.falloffStart ? clamp((dist - w.falloffStart) / (w.falloffEnd - w.falloffStart), 0, 1) : 0;
  return Math.round(w.damage * lerp(1, w.falloffMin, f) * zoneMultiplier(zone));
}

/** Players can't sprint with the trigger or sights in use. */
export function blocksSprint(buttons: number): boolean {
  return (buttons & (Btn.Fire | Btn.Aim)) !== 0;
}

/**
 * Advance a player's weapon by one command: switching, aiming, reloading,
 * firing and recoil. Like movement it must be deterministic, since the client
 * predicts it. `eye` gives the shot origin; `onFx` hears about shots and
 * other moments worth showing, and is left out when replaying commands.
 */
export function stepWeapon(
  p: PlayerState,
  cmd: InputCmd,
  dt: number,
  sprinting: boolean,
  eye: () => { x: number; y: number; z: number },
  onFx?: (fx: WeaponFx) => void,
): void {
  const b = cmd.buttons;
  p.cooldown = Math.max(p.cooldown - dt, 0);
  p.draw = Math.max(p.draw - dt, 0);
  p.sinceShot += dt;

  if (cmd.weapon !== undefined && cmd.weapon !== p.weapon && cmd.weapon >= 0 && cmd.weapon < WEAPONS.length) {
    p.weapon = cmd.weapon;
    p.draw = WEAPONS[p.weapon].drawTime;
    p.reload = 0;
    p.cooldown = 0;
    p.burst = 0;
    onFx?.({ k: 'draw', weapon: p.weapon });
  }
  const w = WEAPONS[p.weapon];
  const i = p.weapon;

  // A throw puts the weapon down for a moment, like switching away and back.
  const toss = (b & Btn.Throw) !== 0;
  if (toss && !p.throwHeld && p.grenades > 0 && p.draw <= EPS && !p.mantling) {
    p.grenades--;
    p.draw = THROW_TIME;
    p.reload = 0;
    p.burst = 0;
    const o = eye();
    const [dx, dy, dz] = shotDirection(p.yaw, clamp(p.pitch + THROW_LOFT, -MAX_PITCH, MAX_PITCH), 0, cmd.seq);
    onFx?.({
      k: 'throw',
      toss: {
        seq: cmd.seq, x: o.x + dx * 0.3, y: o.y + dy * 0.3, z: o.z + dz * 0.3,
        vx: dx * THROW_SPEED + p.vx, vy: dy * THROW_SPEED + Math.max(p.vy, 0), vz: dz * THROW_SPEED + p.vz,
      },
    });
  }
  p.throwHeld = toss;

  const aimWanted = (b & Btn.Aim) !== 0 && !sprinting && p.draw <= EPS;
  p.aim = clamp(p.aim + (aimWanted ? dt : -dt) / w.aimTime, 0, 1);

  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= EPS) {
      p.reload = 0;
      const n = Math.min(w.magSize - p.mag[i], p.reserve[i]);
      p.mag[i] += n;
      p.reserve[i] -= n;
      onFx?.({ k: 'reloaded', weapon: i });
    }
  }

  const fire = (b & Btn.Fire) !== 0;
  const pulled = fire && (w.auto || !p.triggerHeld);
  const firstPull = fire && !p.triggerHeld;
  p.triggerHeld = fire;
  const ready = p.draw <= EPS && p.reload <= 0 && !sprinting;

  const canReload = p.mag[i] < w.magSize && p.reserve[i] > 0;
  if (ready && canReload && ((b & Btn.Reload) !== 0 || (firstPull && p.mag[i] === 0))) {
    p.reload = w.reloadTime;
    p.aim = Math.min(p.aim, 0.5);
    onFx?.({ k: 'reload', weapon: i });
  } else if (ready && pulled && p.cooldown <= EPS) {
    if (p.mag[i] > 0) {
      fireRound(p, w, cmd.seq, eye, onFx);
    } else if (firstPull) {
      onFx?.({ k: 'dry', weapon: i });
    }
  }

  if (p.sinceShot > BURST_RESET) p.burst = 0;
  if (p.sinceShot > RECOIL_RECOVER_DELAY) {
    const k = Math.exp(-RECOIL_RECOVER_RATE * dt);
    p.recoilPitch = Math.abs(p.recoilPitch * k) < 1e-5 ? 0 : p.recoilPitch * k;
    p.recoilYaw = Math.abs(p.recoilYaw * k) < 1e-5 ? 0 : p.recoilYaw * k;
  }
}

function fireRound(
  p: PlayerState,
  w: WeaponDef,
  seq: number,
  eye: () => { x: number; y: number; z: number },
  onFx?: (fx: WeaponFx) => void,
): void {
  p.mag[p.weapon]--;
  p.cooldown += w.interval;
  const [dx, dy, dz] = shotDirection(aimYaw(p), aimPitch(p), spreadOf(p), seq);
  const o = eye();
  onFx?.({ k: 'shot', shot: { weapon: p.weapon, seq, ox: o.x, oy: o.y, oz: o.z, dx, dy, dz, quiet: p.suppressed[p.weapon] } });

  // Recoil climbs hard for the first rounds, then settles while wandering sideways.
  const steady = lerp(1, 0.8, p.aim) * lerp(1, 0.85, p.duck);
  const climb = p.burst < 6 ? 1 : 0.55;
  const wander = Math.sin(p.burst * 0.9 + 0.5) + (hash2(seq, 3, 0x5eed) - 0.5) * 0.8;
  p.recoilPitch = Math.min(p.recoilPitch + w.kick * climb * steady, 0.35);
  p.recoilYaw += w.wander * wander * steady;
  p.burst++;
  p.sinceShot = 0;
}
