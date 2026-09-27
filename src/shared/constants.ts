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
export const STAMINA_REGEN = 1 / 4;
export const STAMINA_REGEN_DELAY = 0.8;
/** After running dry, sprinting waits until the bar refills this far. */
export const STAMINA_RECOVER = 0.3;

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
// CARRY_HEAVY you can no longer mantle.
export const CARRY_FREE = 10;
export const CARRY_HEAVY = 30;
export const CARRY_MAX = 50;
/** Speed lost at CARRY_MAX, as a fraction. */
export const CARRY_SLOWDOWN = 0.35;
/** Extra stamina drain at CARRY_MAX, as a multiple. */
export const CARRY_DRAIN = 1;

// Combat
export const MAX_HP = 100;
/** Seconds after spawning during which a player takes no damage. */
export const SPAWN_PROTECTION = 1.5;
export const HEADSHOT_MUL = 2.5;
export const LEGS_MUL = 0.7;
/** Spread multiple while crouched. */
export const CROUCH_SPREAD_MUL = 0.7;
/** Recoil starts recovering this long after the last shot. */
export const RECOIL_RECOVER_DELAY = 0.12;
/** Recoil recovery, as an exponential rate per second. */
export const RECOIL_RECOVER_RATE = 7;
/** A burst (which drives the recoil pattern) ends this long after the last shot. */
export const BURST_RESET = 0.3;
/** How far back the server rewinds other players to where a shooter saw them. */
export const MAX_REWIND = 0.5;

// Population. Operators are players plus the bots that fill the empty slots.
export const OPERATOR_CAPACITY = 8;
/** Ground guards per outpost, besides the sentry in its watchtower. */
export const GUARDS_PER_OUTPOST = 2;
/** Pairs of guards walking routes between outposts. */
export const GUARD_PATROLS = 3;
/** Seconds before a dead guard is replaced at its post. */
export const GUARD_RESPAWN = 60;
/** Seconds a fallen operator bot lies there before it leaves the game. */
export const BODY_TIME = 5;
/** The death cam replays the killer's view from this many seconds before the kill... */
export const DEATHCAM_BEFORE = 5;
/** ...until this many after it. */
export const DEATHCAM_AFTER = 1;
/** Seconds before an empty operator slot is filled by a new bot dropping in. */
export const OPERATOR_REFILL = 12;

// Runs. Every operator plays one: drop in, loot, extract before the clock runs out.
/** Seconds before a run ends missing in action. */
export const RUN_TIME = 600;
/** How far from a container's edge it can be searched, metres. */
export const INTERACT_REACH = 1.6;
/** Seconds of holding Interact to search a crate. */
export const SEARCH_TIME = 2.5;
/** Seconds after a crate is searched before it is stocked again. */
export const CRATE_RESTOCK = 300;
/** Seconds a dropped bag or a body's bag stays on the ground. */
export const BAG_TIME = 300;
/** A bag in sight this close shows what it's worth, to players and bots alike. */
export const BAG_SIGHT = 40;
/** Standing within this of an extraction point counts as being in it, metres. */
export const EXTRACT_RADIUS = 6;
/** Seconds to stay in an open walk-in extraction. */
export const EXTRACT_TIME = 8;
/** Seconds from calling an extraction to the pickup. */
export const CALL_TIME = 20;
/** Guards sent toward a called extraction. */
export const RESPONSE_SQUAD = 3;
/** Seconds an extraction stays open, and closed, between changes. */
export const EXTRACT_OPEN: [number, number] = [70, 160];
export const EXTRACT_CLOSED: [number, number] = [40, 110];
/** Score for each operator and guard killed, on top of the loot's value, if you get out. */
export const KILL_SCORE_OPERATOR = 500;
export const KILL_SCORE_GUARD = 150;

// Destructible cover. Walls, fences and crates are made of panels that break
// once their health runs out, taking whatever rests on them down too. Glass
// goes with any hit; a roof section comes down once nothing holds it up.
export const PANEL_HP = { wall: 500, fence: 60, crate: 150, door: 120, glass: 1, roof: 400 } as const;
/** Seconds before a broken panel is rebuilt, once nothing is in the way. */
export const PANEL_REPAIR = 180;

// Grenades, thrown with a fresh press of Throw.
export const GRENADES = 2;
/** Seconds the weapon is down for a throw. */
export const THROW_TIME = 0.7;
export const THROW_SPEED = 16;
/** Throws go this much above the aim, in radians. */
export const THROW_LOFT = 0.15;
/** Seconds from the throw to the blast. */
export const GRENADE_FUSE = 3.2;
/** Share of the speed kept off a bounce, along the surface normal. */
export const GRENADE_BOUNCE = 0.35;
/** Share of the speed kept along the surface on each bounce. */
export const GRENADE_FRICTION = 0.7;
/** Damage to a body at the centre of the blast, falling off to nothing at GRENADE_RADIUS. */
export const GRENADE_DAMAGE = 200;
export const GRENADE_RADIUS = 8;
/** Damage to a panel touching the blast, falling off to nothing GRENADE_PANEL_RADIUS from it. */
export const GRENADE_PANEL_DAMAGE = 700;
export const GRENADE_PANEL_RADIUS = 2.2;
/** How far away a blast can be heard, in metres. */
export const GRENADE_NOISE = 320;

// Noise. Bots hear what happens within its radius and come to look.
/** Share of a gun's noise radius left with a suppressor fitted. */
export const SUPPRESSED_NOISE = 0.3;
/** How far away breaking a panel can be heard, metres. */
export const BREAK_NOISE = { wall: 140, fence: 50, crate: 70, door: 70, glass: 60, roof: 140 } as const;
/** How far away a door opening or shutting can be heard, metres. */
export const DOOR_NOISE = 22;
/** How far from a doorway, in metres, a door can be opened or shut. */
export const DOOR_REACH = 1.9;

// Contracts: objectives handed out with each run, paid only if you get out.
/** Contracts per run, fewest and most. */
export const CONTRACTS: [number, number] = [1, 2];
export const CONTRACT_REWARD = { intel: 1500, cache: 1200, commander: 2500 } as const;
/** Seconds of holding Interact to grab the intel. */
export const INTEL_TIME = 4;

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
  Aim: 2048,
  /** Search a crate, take an item, or call an extraction. */
  Interact: 4096,
  /** Drop the last item taken. */
  Drop: 8192,
  /** Throw a grenade. */
  Throw: 16384,
  /** Held while the flashlight is on; the client keeps the toggle. It only lights anything after dark. */
  Light: 32768,
} as const;

// The bounty: the operator carrying the most loot is hunted.
/** Loot worth at least this much makes its carrier the bounty. */
export const BOUNTY_MIN = 3000;
/** Seconds between calls of roughly where the bounty is. */
export const BOUNTY_PING = 20;
/** How far off the called spot can be from where the bounty really is, metres. */
export const BOUNTY_FUZZ = 15;
