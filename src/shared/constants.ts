// Timing. The server simulates the world at SERVER_TICK_RATE; player input is
// sampled and simulated in fixed CMD_DT steps on both client and server so that
// client-side prediction replays produce exactly the server's result.
export const SERVER_TICK_RATE = 30;
export const SERVER_DT = 1 / SERVER_TICK_RATE;
export const CMD_RATE = 60;
export const CMD_DT = 1 / CMD_RATE;
export const CMDS_PER_TICK = CMD_RATE / SERVER_TICK_RATE;
export const MAX_CMDS_PER_TICK = 8;
export const INTERP_DELAY = 0.1;
export const MAX_REWIND = 0.3;

// World
export const DEFAULT_SEED = 1;
export const WORLD_SIZE = 800;
export const GRID_RES = 200;
export const WATER_LEVEL = 0;
export const WATER_FLOOR_DEPTH = 0.9;

// Player body
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;
export const CROUCH_HEIGHT = 1.2;
export const CROUCH_EYE_HEIGHT = 1.0;
/** Crouch transitions per second, for the eye height and speed blend. */
export const DUCK_RATE = 8;
export const STEP_HEIGHT = 0.55;
export const MAX_PITCH = 1.5;

// Movement (Quake/GoldSrc style acceleration, so air strafing works)
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 9.5;
export const CROUCH_SPEED = 2.4;
export const WATER_SPEED_MUL = 0.55;
export const GROUND_ACCEL = 10;
export const AIR_ACCEL = 10;
export const AIR_WISH_CAP = 0.8;
export const FRICTION = 6;
export const STOP_SPEED = 2;
export const GRAVITY = 20;
export const JUMP_SPEED = 7.5;
export const MAX_HORIZONTAL_SPEED = 20;
/** Must stay below STEP_HEIGHT / CMD_DT so falling bodies can't skip past a ledge. */
export const MAX_FALL_SPEED = 30;

// Stamina, as a fraction of a full bar. Spending it pauses regeneration.
export const SPRINT_DRAIN = 1 / 7;
export const JUMP_STAMINA = 0.08;
export const SLIDE_STAMINA = 0.15;
export const STAMINA_REGEN = 1 / 4;
export const STAMINA_REGEN_DELAY = 0.8;
/** After running dry, sprinting waits until the bar refills this far. */
export const STAMINA_RECOVER = 0.3;

// Slide: a sprint plus a fresh crouch press trades control for momentum.
export const SLIDE_MIN_SPEED = 7;
export const SLIDE_BOOST = 2.5;
export const SLIDE_MAX_SPEED = 12;
export const SLIDE_FRICTION = 1.1;
export const SLIDE_DURATION = 0.9;
export const SLIDE_COOLDOWN = 0.5;
/** A slide ends early once it is slower than this. */
export const SLIDE_END_SPEED = 3.5;

// Mantle: jump + forward at a ledge climbs onto it.
/** Highest ledge above the feet that can be mantled. */
export const MANTLE_MAX_HEIGHT = 2.1;
/**
 * Highest ledge above the feet that can be caught in the air. Keeps a jump's
 * apex from reaching 3 m walls and shipping containers.
 */
export const MANTLE_AIR_HEIGHT = 1;
/** How far past the body's edge a ledge can be grabbed. */
export const MANTLE_REACH = 0.45;
export const MANTLE_RISE_SPEED = 5.5;
export const MANTLE_FORWARD_SPEED = 4;
export const MANTLE_EXIT_SPEED = 3;

// Lean (Q/E): the eye shifts sideways and rolls; blocked by walls.
export const LEAN_OFFSET = 0.45;
export const LEAN_ROLL = 0.22;
export const LEAN_RATE = 6;
export const LEAN_SPEED_MUL = 0.7;

// Carry weight in kg. Heavier loads are slower and tire faster; past
// CARRY_HEAVY you can no longer slide or mantle.
export const CARRY_FREE = 10;
export const CARRY_HEAVY = 30;
export const CARRY_MAX = 50;
/** Speed lost at CARRY_MAX, as a fraction. */
export const CARRY_SLOWDOWN = 0.35;
/** Extra stamina drain at CARRY_MAX, as a multiple. */
export const CARRY_DRAIN = 1;

// Combat
export const MAX_HP = 100;
export const RESPAWN_TIME = 3;
export const SPAWN_PROTECTION = 1.5;
export const WEAPON = {
  damage: 24,
  headshotMultiplier: 2.5,
  fireIntervalTicks: 6, // in CMD_DT steps -> 600 rpm
  magSize: 30,
  reloadTicks: 120,
  range: 400,
  spread: 0.003,
  moveSpread: 0.02,
  airSpread: 0.06,
} as const;

export const BOT_TARGET_COUNT = 12;

export const Btn = {
  Forward: 1,
  Back: 2,
  Left: 4,
  Right: 8,
  Jump: 16,
  Sprint: 32,
  Fire: 64,
  Reload: 128,
  Crouch: 256,
  LeanLeft: 512,
  LeanRight: 1024,
} as const;
