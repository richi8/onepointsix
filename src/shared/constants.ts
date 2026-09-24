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
export const STEP_HEIGHT = 0.55;
export const MAX_PITCH = 1.5;

// Movement (Quake/GoldSrc style acceleration, so air strafing works)
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 9.5;
export const WATER_SPEED_MUL = 0.55;
export const GROUND_ACCEL = 10;
export const AIR_ACCEL = 10;
export const AIR_WISH_CAP = 0.8;
export const FRICTION = 6;
export const STOP_SPEED = 2;
export const GRAVITY = 20;
export const JUMP_SPEED = 7.5;
export const MAX_HORIZONTAL_SPEED = 20;

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
} as const;
