import {
  AIR_ACCEL,
  AIR_WISH_CAP,
  Btn,
  CARRY_DRAIN,
  CARRY_FREE,
  CARRY_HEAVY,
  CARRY_MAX,
  CARRY_SLOWDOWN,
  CROUCH_EYE_HEIGHT,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  DUCK_RATE,
  EYE_HEIGHT,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_SPEED,
  JUMP_STAMINA,
  LEAN_OFFSET,
  LEAN_RATE,
  LEAN_ROLL,
  LEAN_SPEED_MUL,
  MAX_HP,
  MANTLE_AIR_HEIGHT,
  MANTLE_EXIT_SPEED,
  MANTLE_FORWARD_SPEED,
  MANTLE_MAX_HEIGHT,
  MANTLE_REACH,
  MANTLE_RISE_SPEED,
  MAX_FALL_SPEED,
  MAX_HORIZONTAL_SPEED,
  MAX_PITCH,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SLIDE_BOOST,
  SLIDE_COOLDOWN,
  SLIDE_DURATION,
  SLIDE_END_SPEED,
  SLIDE_FRICTION,
  SLIDE_MAX_SPEED,
  SLIDE_MIN_SPEED,
  SLIDE_STAMINA,
  SPRINT_DRAIN,
  SPRINT_SPEED,
  STAMINA_RECOVER,
  STAMINA_REGEN,
  STAMINA_REGEN_DELAY,
  STEP_HEIGHT,
  STOP_SPEED,
  WALK_SPEED,
  WATER_LEVEL,
  WATER_SPEED_MUL,
} from './constants.ts';
import { clamp, lerp } from './geom.ts';
import type { InputCmd } from './protocol.ts';
import { blocksSprint, spawnWeapons, stepWeapon, WEAPONS, type WeaponFx, type WeaponState } from './weapons.ts';
import type { Body, World } from './world.ts';

/** Feet this far below the surface count as wading. */
const WADE_DEPTH = 0.4;
/** How much further onto a deep ledge a mantle lands than the grab point. */
const MANTLE_LAND_DEPTH = 0.35;
/** Gap kept between a leaning eye and the wall it leans against. */
const LEAN_MARGIN = 0.15;

/**
 * Everything applyCmd reads or writes. The server sends it back to the owning
 * client so prediction can restart from exactly the authoritative state.
 */
export interface PlayerState extends Body, WeaponState {
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
  /** Crouch was held last command; sliding needs a fresh press. */
  crouchHeld: boolean;
  /** 0 empty to 1 full. */
  stamina: number;
  /** Seconds until stamina starts refilling. */
  staminaDelay: number;
  /** Ran dry; no sprinting until stamina recovers to STAMINA_RECOVER. */
  winded: boolean;
  /** Seconds of slide left; sliding while above 0. */
  slide: number;
  /** Seconds until another slide may start. */
  slideCooldown: number;
  /** Climbing onto a ledge at (mantleX, mantleY, mantleZ); input is ignored meanwhile. */
  mantling: boolean;
  mantleX: number;
  mantleY: number;
  mantleZ: number;
  /** -1 leaning left to 1 leaning right, eased. */
  lean: number;
  /** Carried weight in kg. Set by the server; inventory arrives in chunk 6. */
  carry: number;
  /** Health, set by the server. */
  hp: number;
  /** Dead players ignore input until the server respawns them. */
  dead: boolean;
  /** Counts spawns, so the client can tell when it has been respawned. */
  life: number;
}

export function spawnState(x: number, y: number, z: number): PlayerState {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true,
    crouched: false, duck: 0, jumpHeld: false, crouchHeld: false,
    stamina: 1, staminaDelay: 0, winded: false, slide: 0, slideCooldown: 0,
    mantling: false, mantleX: 0, mantleY: 0, mantleZ: 0, lean: 0, carry: 0,
    hp: MAX_HP, dead: false, life: 0, ...spawnWeapons(),
  };
}

/** A plain copy of just the player state fields, safe to send or snapshot. */
export function copyState(p: PlayerState): PlayerState {
  const {
    x, y, z, vx, vy, vz, yaw, pitch, onGround, crouched, duck, jumpHeld, crouchHeld,
    stamina, staminaDelay, winded, slide, slideCooldown, mantling, mantleX, mantleY, mantleZ, lean, carry,
    hp, dead, life, weapon, mag, reserve, cooldown, reload, draw, triggerHeld, aim,
    recoilPitch, recoilYaw, burst, sinceShot,
  } = p;
  return {
    x, y, z, vx, vy, vz, yaw, pitch, onGround, crouched, duck, jumpHeld, crouchHeld,
    stamina, staminaDelay, winded, slide, slideCooldown, mantling, mantleX, mantleY, mantleZ, lean, carry,
    hp, dead, life, weapon, mag: [...mag], reserve: [...reserve], cooldown, reload, draw, triggerHeld, aim,
    recoilPitch, recoilYaw, burst, sinceShot,
  };
}

export function bodyHeight(p: PlayerState): number {
  return p.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT;
}

/** 0 at or below CARRY_FREE, 1 at CARRY_MAX. */
function loadFactor(carry: number): number {
  return clamp((carry - CARRY_FREE) / (CARRY_MAX - CARRY_FREE), 0, 1);
}

/** Too loaded to slide or mantle. */
export function overweight(p: PlayerState): boolean {
  return p.carry >= CARRY_HEAVY;
}

/**
 * Advance a player by one command. Shared by the server and client prediction,
 * so it must be deterministic: same state + same cmd = same result.
 *
 * Quake/GoldSrc-style movement: ground friction and acceleration toward the
 * wished velocity, and weak capped air acceleration so air strafing works.
 * On top of that: stamina, sliding, mantling, leaning and carry weight, and
 * then the weapon (see stepWeapon), whose shots and effects go to `onFx`.
 * Yaw 0 faces -z, matching Three.js cameras.
 */
export function applyCmd(world: World, p: PlayerState, cmd: InputCmd, dt: number, onFx?: (fx: WeaponFx) => void): void {
  const b = cmd.buttons;
  p.yaw = cmd.yaw;
  p.pitch = clamp(cmd.pitch, -MAX_PITCH, MAX_PITCH);
  if (p.dead) {
    p.vx = p.vy = p.vz = 0;
    return;
  }
  const eye = () => eyePosition(world, p.x, p.y, p.z, p.yaw, p.duck, p.lean);
  p.slideCooldown = Math.max(p.slideCooldown - dt, 0);

  const jump = (b & Btn.Jump) !== 0;
  const crouch = (b & Btn.Crouch) !== 0;
  const jumpPressed = jump && !p.jumpHeld;
  const crouchPressed = crouch && !p.crouchHeld;
  p.jumpHeld = jump;
  p.crouchHeld = crouch;

  let fwd = 0;
  let side = 0;
  if (b & Btn.Forward) fwd += 1;
  if (b & Btn.Back) fwd -= 1;
  if (b & Btn.Right) side += 1;
  if (b & Btn.Left) side -= 1;

  const heavy = overweight(p);
  if (!p.mantling && jump && fwd > 0 && !heavy) startMantle(world, p);
  if (p.mantling) {
    mantleStep(p, dt);
    ease(p, 0, dt);
    regenStamina(p, dt);
    // Both hands are on the ledge: the weapon can't fire or aim.
    stepWeapon(p, cmd, dt, true, eye, onFx);
    return;
  }

  // Slide: sprinting on the ground plus a fresh crouch press.
  let speed = Math.hypot(p.vx, p.vz);
  if (
    crouchPressed && p.onGround && p.slide <= 0 && p.slideCooldown <= 0 && !heavy &&
    (b & Btn.Sprint) !== 0 && fwd > 0 && speed >= SLIDE_MIN_SPEED && p.stamina >= SLIDE_STAMINA
  ) {
    const boosted = Math.min(speed + SLIDE_BOOST, Math.max(speed, SLIDE_MAX_SPEED));
    p.vx *= boosted / speed;
    p.vz *= boosted / speed;
    speed = boosted;
    p.slide = SLIDE_DURATION;
    spendStamina(p, SLIDE_STAMINA);
  }

  // Crouch is instant going down; standing up needs headroom.
  if (crouch || p.slide > 0) p.crouched = true;
  else if (p.crouched && world.ceilingHeight(p.x, p.z, p.y + CROUCH_HEIGHT) >= p.y + PLAYER_HEIGHT) p.crouched = false;

  let jumped = false;
  if (jumpPressed && p.onGround) {
    p.vy = JUMP_SPEED;
    p.onGround = false;
    jumped = true;
    spendStamina(p, JUMP_STAMINA);
  }

  if (p.slide > 0) {
    p.slide -= dt;
    if (p.slide <= 0 || jumped || !crouch || !p.onGround || speed < SLIDE_END_SPEED) {
      p.slide = 0;
      p.slideCooldown = SLIDE_COOLDOWN;
    }
  }
  const sliding = p.slide > 0;

  if (p.onGround && !jumped) friction(p, sliding ? SLIDE_FRICTION : FRICTION, dt);

  const load = loadFactor(p.carry);
  const len = Math.hypot(fwd, side);
  const sprint = (b & Btn.Sprint) !== 0 && fwd > 0 && !p.crouched && !p.winded && len > 0 && !blocksSprint(b);
  const leanTarget = sprint || sliding ? 0 : ((b & Btn.LeanRight) !== 0 ? 1 : 0) - ((b & Btn.LeanLeft) !== 0 ? 1 : 0);
  ease(p, leanTarget, dt);

  if (len > 0 && !sliding) {
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const wx = (-sin * fwd + cos * side) / len;
    const wz = (-cos * fwd - sin * side) / len;
    let wishSpeed = sprint ? SPRINT_SPEED : WALK_SPEED;
    wishSpeed += (CROUCH_SPEED - wishSpeed) * p.duck;
    wishSpeed *= lerp(1, LEAN_SPEED_MUL, Math.abs(p.lean));
    wishSpeed *= lerp(1, WEAPONS[p.weapon].aimSpeed, p.aim);
    wishSpeed *= 1 - CARRY_SLOWDOWN * load;
    if (p.y < WATER_LEVEL - WADE_DEPTH) wishSpeed *= WATER_SPEED_MUL;
    if (p.onGround) accelerate(p, wx, wz, wishSpeed, wishSpeed, GROUND_ACCEL, dt);
    else accelerate(p, wx, wz, Math.min(wishSpeed, AIR_WISH_CAP), wishSpeed, AIR_ACCEL, dt);
  }

  if (sprint && p.onGround) spendStamina(p, SPRINT_DRAIN * (1 + CARRY_DRAIN * load) * dt);
  else regenStamina(p, dt);

  speed = Math.hypot(p.vx, p.vz);
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

  stepWeapon(p, cmd, dt, sprint, eye, onFx);
}

/**
 * Start climbing if there is a ledge within reach straight ahead with room to
 * stand (or at least crouch) on top, and room to rise up to it.
 */
function startMantle(world: World, p: PlayerState): void {
  const dx = -Math.sin(p.yaw);
  const dz = -Math.cos(p.yaw);
  const reach = PLAYER_RADIUS + MANTLE_REACH;
  let tx = p.x + dx * reach;
  let tz = p.z + dz * reach;
  const top = world.ledgeHeight(tx, tz, p.y + STEP_HEIGHT, p.y + (p.onGround ? MANTLE_MAX_HEIGHT : MANTLE_AIR_HEIGHT));
  if (top === -Infinity) return;
  if (world.ceilingHeight(p.x, p.z, p.y + bodyHeight(p)) < top + CROUCH_HEIGHT) return;
  // Land well onto the ledge if it is deep enough, else just over its edge.
  const fx = tx + dx * MANTLE_LAND_DEPTH;
  const fz = tz + dz * MANTLE_LAND_DEPTH;
  if (world.ledgeHeight(fx, fz, top - 1e-6, top) === top && world.fits(fx, top, fz, CROUCH_HEIGHT)) {
    tx = fx;
    tz = fz;
  } else if (!world.fits(tx, top, tz, CROUCH_HEIGHT)) return;
  if (!world.fits(tx, top, tz, PLAYER_HEIGHT)) p.crouched = true;
  p.mantling = true;
  p.mantleX = tx;
  p.mantleY = top;
  p.mantleZ = tz;
  p.vx = p.vy = p.vz = 0;
  p.onGround = false;
  p.slide = 0;
}

/** Rise straight up to the ledge, then move over onto it. */
function mantleStep(p: PlayerState, dt: number): void {
  if (p.y < p.mantleY) {
    p.y = Math.min(p.y + MANTLE_RISE_SPEED * dt, p.mantleY);
    return;
  }
  const dx = p.mantleX - p.x;
  const dz = p.mantleZ - p.z;
  const d = Math.hypot(dx, dz);
  const step = MANTLE_FORWARD_SPEED * dt;
  if (d > step) {
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return;
  }
  p.x = p.mantleX;
  p.z = p.mantleZ;
  p.mantling = false;
  p.onGround = true;
  if (d > 1e-6) {
    p.vx = (dx / d) * MANTLE_EXIT_SPEED;
    p.vz = (dz / d) * MANTLE_EXIT_SPEED;
  }
}

/** Ease duck toward the crouch state and lean toward `leanTarget`. */
function ease(p: PlayerState, leanTarget: number, dt: number): void {
  const duckTarget = p.crouched ? 1 : 0;
  p.duck += clamp(duckTarget - p.duck, -DUCK_RATE * dt, DUCK_RATE * dt);
  p.lean += clamp(leanTarget - p.lean, -LEAN_RATE * dt, LEAN_RATE * dt);
}

function spendStamina(p: PlayerState, amount: number): void {
  p.stamina = Math.max(p.stamina - amount, 0);
  p.staminaDelay = STAMINA_REGEN_DELAY;
  if (p.stamina === 0) p.winded = true;
}

function regenStamina(p: PlayerState, dt: number): void {
  if (p.staminaDelay > 0) p.staminaDelay = Math.max(p.staminaDelay - dt, 0);
  else p.stamina = Math.min(p.stamina + STAMINA_REGEN * dt, 1);
  if (p.winded && p.stamina >= STAMINA_RECOVER) p.winded = false;
}

function friction(p: PlayerState, amount: number, dt: number): void {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < 1e-4) {
    p.vx = 0;
    p.vz = 0;
    return;
  }
  const drop = Math.max(speed, STOP_SPEED) * amount * dt;
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

export interface Eye {
  x: number;
  y: number;
  z: number;
  /** Camera roll from leaning, in radians. */
  roll: number;
}

/**
 * Where a player's eye is: at eye height for their crouch, shifted sideways by
 * their lean but never into a wall. Rendering uses it today; shooting will too.
 */
export function eyePosition(
  world: World, x: number, y: number, z: number, yaw: number, duck: number, lean: number,
): Eye {
  const eyeY = y + lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, duck);
  const amount = Math.abs(lean);
  if (amount < 1e-4) return { x, y: eyeY, z, roll: 0 };
  const s = Math.sign(lean);
  const rx = Math.cos(yaw) * s;
  const rz = -Math.sin(yaw) * s;
  const want = amount * LEAN_OFFSET;
  const free = world.raycast(x, eyeY, z, rx, 0, rz, want + LEAN_MARGIN) - LEAN_MARGIN;
  const d = clamp(free, 0, want);
  return { x: x + rx * d, y: eyeY, z: z + rz * d, roll: -lean * LEAN_ROLL };
}
