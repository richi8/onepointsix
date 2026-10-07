import {
  BAG_SIGHT,
  Btn,
  CMD_DT,
  CMDS_PER_TICK,
  CROUCH_EYE_HEIGHT,
  CARRY_MAX,
  CRATE_RESTOCK,
  CROUCH_SPEED,
  EXTRACT_FEE,
  EXTRACT_RADIUS,
  EYE_HEIGHT,
  GUARD_HP,
  MAX_HP,
  RUN_TIME,
  WALK_SPEED,
} from '../shared/constants.ts';
import { angleDiff, clamp, yawToward } from '../shared/geom.ts';
import { hitboxes, rayBody } from '../shared/hitbox.ts';
import { ITEMS } from '../shared/loot.ts';
import { CHANGE_MAX, coverOf, type Coming, type Senses, type Weather } from '../shared/weather.ts';
import type { BagSnap, InputCmd, LootView, Side, Team } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { PISTOL, spawnWeapons, WEAPONS, BOLT } from '../shared/weapons.ts';
import { type Bush, CONCEALED, VEG_CELL, bagShows, vegetationOf } from '../shared/vegetation.ts';
import { type Point, type Rect, type World } from '../shared/world.ts';
import type { ExtractPoint } from './extracts.ts';
import { reached, type NavGrid, type Waypoint } from './nav.ts';
import { TEMPERS, type Personality, type Temper } from './personality.ts';
import type { Skill } from './skill.ts';
import type { ActorSpec } from './range.ts';
import { vantageOver, vantages } from './vantage.ts';

// A bot is a player without a keyboard. It perceives the world through the
// same senses for everyone (sight limited by range, view cone, cover and the
// weather; hearing of footsteps, gunfire and rounds passing close),
// decides what to do
// with a small state machine, and acts only by producing input commands that
// the server simulates exactly like a human's.

/** Anyone in the game, as a bot sees them. */
export interface Agent extends PlayerState {
  readonly id: number;
  team: Team;
  /** In Team Deathmatch, the side it's on. */
  side?: Side;
}

export interface Post extends Point {
  yaw: number;
}

/** What a bot does when nothing is happening. */
export type Role =
  // Holds a spot, such as a watchtower, and looks around.
  | { kind: 'sentry'; post: Post }
  // Walks a loop of points, pausing to look around, or follows a leader who
  // does. Never strays more than `leash` from home, or without a home, from
  // where it was when called away.
  | { kind: 'guard'; route: Point[]; leash: number; home?: Point; leader?: number }
  // Plays a run: search the crate at each of the first `planned` loot spots,
  // taking what it can carry up to `greed` kg, and the spots after them too
  // until it can pay for extraction; then leave at the nearest open extraction
  // point. Its personality decides what else it does along the way. In
  // Deathmatch, with `supplies`, it never leaves: it hunts, going to the
  // nearest of those crates whenever it runs short of health or ammo.
  | { kind: 'operator'; loot: LootSpot[]; planned: number; greed: number; personality?: Personality; thorough?: boolean; supplies?: LootSpot[] }
  // Doesn't think: plays one routine over and over on the range.
  | { kind: 'actor'; spec: ActorSpec };

export interface LootSpot extends Point {
  /** What to look at while searching, such as the crate. */
  look: Point;
  /** Set for a bag on the ground, by id. */
  bag?: number;
}

export type BotState =
  | 'patrol' | 'loot' | 'extract' | 'investigate' | 'engage' | 'cover' | 'flank'
  // Operators by personality: roaming for a fight, waiting by an extraction point, closing in on a fight or the bounty,
  // and lying low while one goes on nearby.
  | 'hunt' | 'camp' | 'stalk' | 'hide';

/** Something heard: a shot, a friend's callout, footsteps. */
export interface Noise extends Point {
  radius: number;
  /** Who made it. */
  source: number;
  /** A gunshot or a blast: a fight. */
  gunfire?: boolean;
}

/** The game as bots see it, rebuilt each tick by the server. */
export interface BotContext {
  world: World;
  nav: NavGrid;
  /** Server time in seconds. */
  time: number;
  agents: Iterable<Agent>;
  agent(id: number): Agent | undefined;
  /** Path searches left this tick; bots wait for a later tick once it runs out. */
  pathBudget: number;
  /** A guard spotted an enemy at a point and tells the guards around. */
  callout(from: Agent, at: Point): void;
  /** The island's extraction points and whether they're open. */
  extracts: readonly ExtractPoint[];
  /** The container an agent faces within reach, as a player would see it. */
  lootView(self: Agent): LootView | null;
  /** How far the weather lets everyone see and hear, read afresh every tick. */
  senses: Senses;
  /** The next change of weather, which anyone outside can see coming about a minute ahead. */
  coming?: Coming;
  /** Who carries the bounty, or 0. */
  bounty: number;
  /** Bags on the ground and what's in them. */
  bags(): readonly BagSnap[];
  /** What the loot someone carries is worth. */
  carried?(a: Agent): number;
}

/** Someone's health as a share of their full health; guards have less than operators. */
function health(a: Agent | undefined): number {
  return a ? a.hp / (a.team === 'guard' ? GUARD_HP : MAX_HP) : 1;
}

/** Whether a would shoot b. Operators are each on their own side, but in Team Deathmatch's two; guards stick together. */
export function hostile(a: Agent, b: Agent): boolean {
  if (a === b) return false;
  if (a.side && a.side === b.side) return false;
  return a.team === 'operator' || a.team !== b.team;
}

/** Seconds a target can be out of sight before an engaged bot goes looking. */
const LOST_TIME = 1.6;
/** A target this close is noticed even outside the view cone. */
const TOUCH_RANGE = 3;
/** Sight range multiple for crouched targets. */
const CROUCH_SIGHT = 0.65;
/** Awareness lost per second by a half-noticed target out of sight. */
const AWARENESS_DECAY = 0.25;
/** Footstep hearing ranges: sprinting and walking. Crouch-walking is silent. */
const STEPS_SPRINT = 22;
const STEPS_WALK = 9;
/**
 * How far operators and guards go out of their way to check on a noise. Operators
 * mostly keep clear of other people's fights; only what is right next to them draws them in.
 */
const OPERATOR_CURIOSITY = 25;
const GUARD_CURIOSITY = 110;
/** Operators leave guards alone beyond this range: a fight at an outpost brings the whole outpost down on them. */
const OPERATOR_GUARD_RANGE = 40;
/** Operators shot at by a guard shoot back out to this far; farther off they get away instead. */
const GUARD_FIGHT_BACK = 60;
/** Seconds a shooter stays a threat to be fought back. */
const THREAT_TIME = 10;
/** Operators going about their run walk rather than sprint this close to an outpost, and sneak closer in. */
const OUTPOST_WALK = 110;
const OUTPOST_SNEAK = 55;
/** An operator that has seen a guard this close keeps low for this many seconds after. */
const GUARD_WARY = 110;
const WARY_TIME = 10;
/** Operators route around outposts they aren't going to, this far out. */
const OUTPOST_BERTH = 95;
/** The bounty is spotted in this much of the time, and its footsteps heard this much farther. */
const BOUNTY_SPOT = 0.7;
const BOUNTY_LOUD = 1.6;
/** Operators pick fights with the bounty this much farther out. */
const BOUNTY_REACH = 1.5;
/** Operators carrying loot worth this much start no fights with anyone not right on top of them (hunters excepted). */
const LOADED = 500;
/** Hunters count anyone with less than this share of their full health as wounded. */
const WOUNDED = 0.6;
/** Shot at with less than this share of its full health, a bot ducks into cover. */
const HURT = 0.7;
/** An operator shot by a guard gives up on crates this close to it. */
const GUARDED_CRATE = 100;
/** Operators would rather not get out within this many metres of an outpost; one that close counts as this much farther. */
const GUARDED_EXIT = 150;
/** Metres off a fight's gunfire is guessed to be, per metre away it's heard from. */
const FIGHT_GUESS = 0.12;
/** Seconds gunfire is remembered for telling where a fight is, and how far apart two sides' shots can be to be one fight. */
const FIGHT_MEMORY = 8;
const FIGHT_SPREAD = 70;
/** Gunfire closer than this isn't someone else's fight to join: it's ours. */
const FIGHT_NEAR = 30;
/** Bots joining a fight stop this far short of it and watch, and give up after this many seconds. */
const STALK_STANDOFF = 40;
const GUARD_STANDOFF = 90;
/** A fight at an outpost is watched from this far from its middle, out of the sentry's sight. */
const OUTPOST_WATCH = 135;
const STALK_TIME = 70;
/** Bags this close are worth a detour. */
const BAG_RANGE = 50;
/** Hunters roam to points this far off, and campers wait this far from their extraction point. */
const HUNT_RANGE = 150;
const CAMP_RANGE: [number, number] = [25, 45];
/** A camper finding no spot that sees into its extraction point looks again this much farther out, up to CAMP_FARTHEST, then gives up camping. */
const CAMP_WIDEN = 10;
const CAMP_FARTHEST = 85;
/** Spots tried at random around an extraction point for a camp, at each range. */
const CAMP_TRIES = 24;
/**
 * A bot that hides from a fight heard this close goes to a bush or out of its
 * sight within HIDE_SEARCH, and lies low there for HIDE_TIME seconds.
 */
const HIDE_RANGE = 90;
const HIDE_SEARCH = 25;
const HIDE_TIME: [number, number] = [10, 20];
/**
 * An operator shot at by at least OUTGUNNED people within OUTGUNNED_MEMORY
 * seconds, or by anyone once badly hurt, is outgunned: it takes cover from
 * them all and gets away, fighting only what shoots at it, for RETREAT_TIME.
 */
const OUTGUNNED = 2;
const OUTGUNNED_MEMORY = 5;
const BADLY_HURT = 0.4;
const RETREAT_TIME = 20;
/** Seconds after a round comes close that an operator ducks into cover from its shooter. */
const PINNED = 0.8;
/** How long an operator stays in cover from someone it's getting away from, rather than fighting. */
const SLIP_TIME: [number, number] = [3, 6];
/** Seconds an operator runs for cover in sight of someone before it turns to fight instead. */
const COVER_RUN = 2;
/**
 * Getting away from guards onto it, or from a fight it's outgunned in, an
 * operator runs this far off, away from them, out of their sight if it can;
 * it turns to fight only someone this close.
 */
const FLEE_RANGE: [number, number] = [40, 70];
const FLEE_FIGHT = 20;
/** Threats that cover has to hide from, nearest first. */
const COVER_THREATS = 4;
/** Bushes at least this tall hide someone crouched in them, head and all. */
const HIDING_BUSH = 1.15;
/** How far a bot goes to hide in a bush: taking cover, and settling down to wait or watch. */
const BUSH_COVER = 12;
const BUSH_WAIT = 15;
/** Close enough to a bush's middle to be in it. */
const IN_BUSH = 0.3;
/** Operators head out with at least this many seconds of the run clock left, whatever their personality. */
const LEAVE_BY = 150;
/** Rounds passing this close to a bot's chest put it under fire. */
const NEAR_MISS = 2.5;
const COVER_COOLDOWN = 6;
const COVER_TIME: [number, number] = [1.5, 3];
const FLANK_TIME = 14;
const INVESTIGATE_TIME = 25;
const LOOK_AROUND: [number, number] = [4, 7];
/** Seconds spent at a crate before moving on regardless. */
const LOOT_TIMEOUT = 15;
const PATROL_WAIT: [number, number] = [2, 6];
/** Distance a follower keeps behind its leader. */
const FOLLOW_GAP = 3;
const ARRIVE = 1.2;
/** A replacement guard stops running in this close to the outpost it's sent to. */
const INBOUND_ARRIVE = 25;
/** A place more than this far above or below is farther by that much: upstairs, or on the way. */
const OTHER_FLOOR = 0.6;
const REPATH_DELAY = 0.5;
/** Seconds of no progress before jumping, before searching a new path, and before giving up on a goal. */
const STUCK_JUMP = 0.7;
const STUCK_REPATH = 2;
const STUCK_GIVE_UP = 5;
/** Range each weapon likes to fight at; farther than this bots close in. */
const EFFECTIVE_RANGE = [90, 35, 250];
/** Bots with a bolt-action draw the pistol inside this range. */
const BOLT_MIN_RANGE = 20;
/** Aim down the sights at targets farther than this. */
const ADS_RANGE = 12;
const TOO_CLOSE = 4;
/** Half-width of the target used for when to fire, metres. */
const TARGET_WIDTH = 0.35;
const IDLE_PITCH = -0.06;
/** How much of the remaining turn is taken each command, before the turn-rate cap. */
const TURN_GAIN = 0.35;
/** The weather's cover counts once it's at least this much in: from about halfway through a change. */
const IN_COVER = 0.5;
/** Bots see a change of weather coming this many seconds off at most, as its signs show: a rat lies low for fog until it's in. */
const SIGNS_AHEAD = 75;
/** Longest a rat waits for fog, from when it's coming. */
const FOG_WAIT = 150;
/** Rats and looters crossing the island in fog sneak and walk this much nearer outposts than they would. */
const FOG_BOLDNESS = 0.4;
/** A fog lifting, a rat or a looter gives up the crate it took on for it unless it's this close to it. */
const FOG_LIFTING_KEEP = 30;
/**
 * On a map: a fight is closed in on to this far, and watched from a window
 * or a roof's edge that sees it, this near to this far from it, as often as
 * this; or from the street beside something to keep behind. A hunter roams
 * to such a window or roof this often.
 */
const MAP_STANDOFF = 20;
const MAP_WATCH: [number, number] = [10, 40];
/** Gunfire this near the fight being closed in on is the same fight. */
const SAME_FIGHT = 15;
const WATCH_HIGH = 0.5;
/** Making for a post or at it, a bot checks only on noises this close. */
const POST_NOTICE = 10;
/** A hunter roams to a post this near, if there's one. */
const ROAM_POST = 50;
/** A bot at a post ducks this many seconds before each new look. */
const POST_DUCK = 1;
/** Close enough to a post to watch from it. */
const POST_ARRIVE = 0.6;
const ROAM_HIGH = 0.4;
/** A spot in the street to wait at is looked for this far round where it's wanted, and has something solid this close beside it. */
const STREET_SEARCH = 6;
const BESIDE = 1.2;
/** A flank on a map goes this near to this far from where the target was, to a spot that sees it from the side. */
const MAP_FLANK: [number, number] = [10, 30];
/** Seconds longer a hunter stays on to hunt while rain is coming or in. */
const RAIN_LINGER = 120;
/** Kg more a looter carries off in fog. */
const FOG_GREED = 6;
/** A hunter closing in on a fight under rain stops this much nearer, runs until this close, and goes this much farther to a noise. */
const RAIN_STANDOFF = 0.5;
const RAIN_SPRINT = 45;
const RAIN_CURIOSITY = 2;
/** A camper with sight this much shorter waits this much nearer its extraction point, and no closer than CAMP_NEAREST. */
const CAMP_RESIGHT = 0.15;
const CAMP_NEAREST = 12;
/** Campers ignore noises once sight is this short, and stay on this many seconds longer for each share of sight lost. */
const CAMP_HOLD = 0.85;
const CAMP_LINGER = 150;

/** What bots have been up to, summed over every bot, for the playtest. */
export const tally = {
  /** Places taken to hide from a threat, and of those in a bush. */
  covers: 0,
  bushCovers: 0,
  /** Places settled at to wait or watch (camping, hunting, watching a fight), and of those in a bush. */
  waits: 0,
  bushWaits: 0,
  /** Fights between others gone to, and how far off the real shooter the guess was, summed. */
  joins: 0,
  guessOff: 0,
  /** Camps looked for, and of those given up as no spot out to CAMP_FARTHEST sees into the extraction point. */
  camps: 0,
  campless: 0,
  /** Times a bot hid from a fight nearby, and of those in a bush. */
  hides: 0,
  bushHides: 0,
  /** Paths looked for through bushes and tall grass. */
  hiddenPaths: 0,
  /** Times an operator got well away rather than taking cover nearby. */
  flights: 0,
  /** Times an operator took cover from someone shooting at it without fighting back, and found itself outgunned. */
  pinned: 0,
  outgunned: 0,
  /** Thinks spent up on a floor off the ground: upstairs or on a watchtower, sentries left out. */
  upThinks: 0,
  /** Rats lying low for fog seen coming, and crates searched past the plan in fog by rats and looters. */
  fogWaits: 0,
  fogCrates: 0,
  /** Of those, crates given up as the fog was seen lifting. */
  fogLifts: 0,
  /** Hunters turned back from heading out to hunt as rain was seen coming. */
  rainHunts: 0,
  /** Fights a hunter closed in on under rain. */
  rainStalks: 0,
  /** Camps moved nearer an extraction point as sight shortened. */
  campsCloser: 0,
  /** On a map: places taken to watch from at a window or a roof's edge, and in the street beside cover. */
  posts: 0,
  streetSpots: 0,
  /** Of the posts, those got to. */
  postsHeld: 0,
};

/**
 * A place to go to, and whether it's in a bush, where it has to be reached
 * more exactly, or a post at a window or a roof's edge, which is watched from
 * standing and has to be reached at its height.
 */
type Spot = Point & { bush?: boolean; post?: boolean };

interface Contact {
  /** 0 unnoticed to 1 spotted. */
  level: number;
  visible: boolean;
  /** Only the head shows, e.g. over a wall. */
  headOnly: boolean;
  /** Last known feet position. */
  x: number;
  y: number;
  z: number;
  /** When last seen or otherwise pinpointed. */
  seenAt: number;
  /** When it last came into view. */
  since: number;
  /** When it last shot at or hit us. */
  threatAt: number;
  /** It's a guard. */
  guard?: boolean;
}

export class Bot {
  readonly role: Role;
  readonly skill: Skill;
  /** Weapon it prefers; the pistol is the fallback. */
  readonly primary: number;
  state: BotState;
  /** Id of the agent being fought, or 0. */
  target = 0;
  /** Set once an operator has nowhere left to go; the server removes it. */
  done = false;
  private readonly rand: () => number;
  /** Server time as of the last think. */
  private now = 0;
  private stateAt = 0;
  private readonly contacts = new Map<number, Contact>();

  // Looking and aiming.
  private yaw: number;
  private pitch = IDLE_PITCH;
  private lookYaw: number;
  private lookPitch = IDLE_PITCH;
  /** A point to keep looking at, such as a noise or a lost target. */
  private focus: Point | null = null;
  /** Looking around rather than where it walks. */
  private idleLook = false;
  private glanceUntil = 0;
  /** No shooting before this: the reaction to a new or reappearing target. */
  private reactAt = 0;
  private errYaw = 0;
  private errPitch = 0;
  private aimHead = false;
  private readonly wobblePhase: number;

  // Firing.
  private weapon: number;
  private burstEnd = 0;
  private pauseUntil = 0;
  private nextTap = 0;
  /** No friend stands in the line of fire. */
  private clearShot = true;
  private reloadWanted = false;

  // Moving.
  private goal: Waypoint | null = null;
  private path: Waypoint[] = [];
  private pathGoal: Waypoint | null = null;
  private pathAt = -Infinity;
  private pace: 'walk' | 'sprint' | 'sneak' = 'walk';
  private crouch = false;
  /** Sidestep direction while fighting: -1 left, 1 right. */
  private strafe = 0;
  private strafeUntil = 0;
  private stuck = 0;
  /** The last path search found no way to the goal. */
  private noPath = false;
  private jump = false;
  /** Interact this command: held down, or pressed again and again. */
  private use: 'hold' | 'tap' | null = null;

  // Plans.
  private step = 0;
  private waitUntil = 0;
  private spot: Spot | null = null;
  /** The life it last roamed in, to tell its first roam after spawning. */
  private roamedLife = -1;
  /** The way a post's window or roof's edge looks out, or null. */
  private spotYaw: number | null = null;
  /** It fired from its post, so the post is given up for another when the fight's over. */
  private postFired = false;
  private spotUntil = 0;
  private heard: (Point & { at: number }) | null = null;
  private hurtAt = -Infinity;
  private hurtHandled = true;
  private lastCover = -Infinity;
  /** Where it last was during its routine; guards without a home stay leashed to it. */
  private anchor: Point | null = null;
  /** Sent to replace fallen guards: it runs to this point before taking up its routine. */
  inbound: Point | null = null;
  /** Extraction point it's heading for, and those it couldn't reach. */
  private exit = -1;
  private readonly unreachable = new Set<number>();

  // An operator's run, by its personality.
  readonly personality: Personality | null;
  private readonly temper: Temper | null;
  /** Its own copy of the crates to search, which bags it comes across are added to. */
  private readonly loot: LootSpot[];
  private readonly bagsTried = new Set<number>();
  /** Server time its run started: its first think. */
  private born = -1;
  /** Share of its full health as of the last think: badly hurt, it gives up on hunting and camping. */
  private health = 1;
  /** Crates it means to search whatever it finds; those after them only until it can pay for extraction. */
  private planned: number;
  /** Whether it carries enough to pay for extraction. */
  private paid = false;
  /** Whether it carries enough to lose that it would rather not start a fight. */
  private loaded = false;
  /** Gunfire heard lately, for telling where a fight is. */
  private gunfire: (Point & { source: number; at: number })[] = [];
  /** Where the bounty was last called, if it's worth going after. */
  private lure: (Point & { at: number }) | null = null;
  /** Time of the latest gunfire or call acted on, so each is followed once. */
  private stalkAt = -Infinity;
  /** Where the fight or the bounty being closed in on is. */
  private fightAt: Point | null = null;
  /** Where a camper waits and for which extraction point; set once it gives up camping. */
  private camp: Spot | null = null;
  private campFor = -1;
  private campDone = false;
  /** A fight heard nearby that it hid from; when it last hid. */
  private alarm: (Point & { at: number }) | null = null;
  private hideAt = -Infinity;
  /** Until when it's getting away from a fight it's outgunned in. */
  private retreatUntil = -Infinity;
  /** Whether its path goes through bushes and tall grass. */
  private pathHidden = false;
  /** Its cover is far off, got away to rather than hidden in. */
  private fleeing = false;
  /** When an operator last saw a guard close enough to keep low for. */
  private guardSeenAt = -Infinity;
  /** What it has seen bags to be worth, by id. */
  private readonly bagValues = new Map<number, number>();
  /** Who it has been told carries the bounty, or 0. */
  private bountyKnown = 0;
  /** The weather's cover and how far it lets it see, as of the last think. */
  private fog = 0;
  private rain = 0;
  private sight = 1;
  /** Whether it has taken a crate more for the fog that's in, and the change of weather it last lay low for, by when it comes. */
  private fogCrate = false;
  /** Whether that crate is one more than it meant to search. */
  private fogExtra = false;
  /** The next change of weather, as of the last think. */
  private coming: Coming | undefined;
  private bidedFor = -Infinity;
  /** Lying low for fog to come in. */
  private biding = false;
  /** How far it could see when it picked its camp. */
  private campSight = 1;
  /** In Deathmatch: every crate it may go to for supplies, and when it last set off for each. Null elsewhere. */
  private readonly supplies: readonly LootSpot[] | null;
  private readonly suppliedAt = new Map<LootSpot, number>();
  /** In Deathmatch, short of health or ammo as of the last think. */
  private short = false;

  constructor(role: Role, skill: Skill, primary: number, yaw: number, rand: () => number) {
    this.role = role;
    this.skill = skill;
    this.primary = primary;
    this.weapon = primary;
    this.yaw = this.lookYaw = yaw;
    this.rand = rand;
    this.wobblePhase = rand() * 100;
    this.personality = role.kind === 'operator' ? (role.personality ?? null) : null;
    this.temper = this.personality ? TEMPERS[this.personality] : null;
    this.loot = role.kind === 'operator' ? [...role.loot] : [];
    this.planned = role.kind === 'operator' ? role.planned : 0;
    this.supplies = role.kind === 'operator' ? (role.supplies ?? null) : null;
    this.state = this.routine();
  }

  /** Crates an operator still means to search. */
  lootLeft(): number {
    return this.loot.length - this.step;
  }

  /** What this bot currently knows about another agent: 0 unaware to 1 spotted. */
  awareness(id: number): number {
    return this.contacts.get(id)?.level ?? 0;
  }

  // -------------------------------------------------------------- senses

  /** A sound reached the bot. The server checks the range. */
  hear(self: Agent, noise: Noise, now: number): void {
    if (noise.source === self.id) return;
    // The farther away, the vaguer the sense of where it came from.
    const d = Math.hypot(noise.x - self.x, noise.z - self.z);
    if (noise.gunfire && this.temper?.thirdParty) {
      this.gunfire = this.gunfire.filter((g) => now - g.at < FIGHT_MEMORY);
      const guess = d * FIGHT_GUESS;
      this.gunfire.push({
        x: noise.x + (this.rand() - 0.5) * 2 * guess,
        y: noise.y,
        z: noise.z + (this.rand() - 0.5) * 2 * guess,
        source: noise.source,
        at: now,
      });
    }
    const fuzz = d * 0.08;
    if (noise.gunfire && this.temper?.hides && d < HIDE_RANGE) {
      this.alarm = { x: noise.x + (this.rand() - 0.5) * 2 * fuzz, y: noise.y, z: noise.z + (this.rand() - 0.5) * 2 * fuzz, at: now };
    }
    this.heard = {
      x: noise.x + (this.rand() - 0.5) * 2 * fuzz,
      y: noise.y,
      z: noise.z + (this.rand() - 0.5) * 2 * fuzz,
      at: now,
    };
  }

  /** Told who carries the bounty now, or 0 for nobody. */
  bountyTold(holder: number): void {
    this.bountyKnown = holder;
  }

  /** Roughly where the bounty, `holder`, is now. Those who want it go after it. */
  bountyCalled(self: Agent, holder: number, at: Point, now: number): void {
    this.bountyKnown = holder;
    const range = this.temper?.bountyRange ?? 0;
    if (holder === self.id || Math.hypot(at.x - self.x, at.z - self.z) > range) return;
    this.lure = { x: at.x, y: at.y, z: at.z, at: now };
  }

  /** A round from `shooter` passed close or hit nearby. */
  underFire(shooter: Agent, now: number): void {
    const c = this.contact(shooter.id, shooter);
    c.level = Math.max(c.level, 0.7);
    c.threatAt = now;
    this.heard = { x: shooter.x, y: shooter.y, z: shooter.z, at: now };
    this.avoid(shooter);
  }

  /** Took a hit from `attacker`: now it knows exactly where they are. */
  hurt(attacker: Agent, now: number): void {
    const c = this.contact(attacker.id, attacker);
    c.level = 1;
    c.x = attacker.x;
    c.y = attacker.y;
    c.z = attacker.z;
    c.seenAt = now;
    c.threatAt = now;
    this.hurtAt = now;
    this.hurtHandled = false;
    this.avoid(attacker);
  }

  /** Shot at by a guard on the way: crates it watches over aren't worth it, unless searching them all. */
  private avoid(attacker: Agent): void {
    if (attacker.team === 'guard' && this.role.kind === 'operator' && !this.role.thorough) {
      while (this.step < this.loot.length && Math.hypot(this.loot[this.step].x - attacker.x, this.loot[this.step].z - attacker.z) < GUARDED_CRATE) this.step++;
    }
  }

  /** Whether a round from (ox, oy, oz) along (dx, dy, dz) for `t` metres passed close to `self`. */
  static nearMiss(self: Agent, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: number): boolean {
    const cy = self.y + 1.2;
    const k = clamp((self.x - ox) * dx + (cy - oy) * dy + (self.z - oz) * dz, 0, t);
    return Math.hypot(ox + dx * k - self.x, oy + dy * k - cy, oz + dz * k - self.z) < NEAR_MISS;
  }

  // -------------------------------------------------------------- thinking

  /** Look and listen, then decide. Called every few ticks with the seconds since the last call. */
  think(ctx: BotContext, self: Agent, dt: number): void {
    this.now = ctx.time;
    if (this.born < 0) this.born = ctx.time;
    this.health = health(self);
    this.paid = (ctx.carried?.(self) ?? Infinity) >= EXTRACT_FEE;
    this.loaded = (ctx.carried?.(self) ?? 0) >= LOADED;
    this.resupply(self);
    this.weather(ctx, self);
    if (this.isRoutine(this.state)) this.anchor = { x: self.x, y: self.y, z: self.z };
    this.perceive(ctx, self, dt);
    this.decide(ctx, self);
    this.behave(ctx, self);
    this.checkStuck(self, dt);
    if (this.role.kind !== 'sentry' && self.y > ctx.world.floorHeight(self.x, self.z) + 2) tally.upThinks++;
  }

  /**
   * In Deathmatch, running short of health or ammo, it sets off for the
   * nearest crate it hasn't been to since it was last restocked.
   */
  private resupply(self: Agent): void {
    if (!this.supplies) return;
    const gun = WEAPONS[this.primary];
    this.short = this.health < WOUNDED || self.reserve[this.primary] < gun.magSize;
    if (!this.short || this.step < this.loot.length) return;
    let best: LootSpot | null = null;
    let bestD = Infinity;
    for (const s of this.supplies) {
      if (this.now - (this.suppliedAt.get(s) ?? -Infinity) < CRATE_RESTOCK) continue;
      const d = away(s, self);
      if (d < bestD) (best = s), (bestD = d);
    }
    if (!best) return;
    this.suppliedAt.set(best, this.now);
    this.loot.length = 0;
    this.loot.push(best);
    this.step = 0;
  }

  /**
   * Reads the weather and the signs of the next change. Fog setting in, a rat
   * or a looter takes a crate more than it meant to while it hides them, and
   * seeing the fog lift, gives it up again if it isn't nearly there. A hunter
   * heading out turns back to hunt on seeing rain coming.
   */
  private weather(ctx: BotContext, self: Agent): void {
    const cover = coverOf(ctx.senses);
    this.fog = cover.fog;
    this.rain = cover.rain;
    this.sight = ctx.senses.sight;
    this.coming = ctx.coming;
    if (this.role.kind !== 'operator' || this.role.thorough) return;
    if (this.personality === 'hunter' && this.state === 'extract' && this.routine() === 'hunt' && !this.waiting(ctx, self)) {
      tally.rainHunts++;
      this.enter('hunt');
    }
    if (!this.fogMoves()) {
      this.fogCrate = this.fogExtra = false;
      return;
    }
    if (!this.fogCrate) {
      this.fogCrate = true;
      if (this.step < this.planned && this.planned < this.loot.length && this.health >= WOUNDED) {
        this.planned++;
        this.fogExtra = true;
        tally.fogCrates++;
      }
    }
    if (!this.fogExtra || !this.seesComing('fog', false)) return;
    const extra = this.loot[this.planned - 1];
    if (this.step > this.planned - 1 || (this.step === this.planned - 1 && away(extra, self) < FOG_LIFTING_KEEP)) return;
    this.planned--;
    this.fogExtra = false;
    tally.fogLifts++;
    if (this.state === 'loot' && this.routine() !== 'loot') this.enter(this.routine());
  }

  /** Whether it sees a change to (or with `to` false, away from) `w` coming, by its signs. */
  private seesComing(w: Weather, to = true): boolean {
    const c = this.coming;
    return !!c && c.in <= SIGNS_AHEAD && (c.weather === w) === to;
  }

  /** Whether fog is in, and it's a rat or a looter, who make the most of it. */
  private fogMoves(): boolean {
    return this.fog >= IN_COVER && (this.personality === 'rat' || this.personality === 'looter');
  }

  /** Whether rain is in, and it's a hunter, who closes in on fights under it. */
  private pushes(): boolean {
    return this.rain >= IN_COVER && this.personality === 'hunter';
  }

  /**
   * A rat sees fog coming as the mist gathers: rather than cross open ground
   * in the clear, it lies low near where it is until the fog is in. Not in
   * the extraction zone, or when waiting would leave too little time to get out.
   */
  private bidesForFog(ctx: BotContext, self: Agent): boolean {
    const c = ctx.coming;
    if (this.personality !== 'rat' || !c || c.weather !== 'fog' || c.in > SIGNS_AHEAD || this.fog >= IN_COVER) return false;
    if (this.role.kind !== 'operator' || this.role.thorough || this.waiting(ctx, self)) return false;
    const comes = this.now + c.in;
    if (Math.abs(comes - this.bidedFor) < 1 || this.now - this.born + c.in + CHANGE_MAX > RUN_TIME - LEAVE_BY) return false;
    this.bidedFor = comes;
    tally.fogWaits++;
    this.enter('hide');
    this.biding = true;
    this.fightAt = null;
    this.spot = this.waitSpot(ctx, self);
    this.spotUntil = this.now + FOG_WAIT;
    return true;
  }

  private perceive(ctx: BotContext, self: Agent, dt: number): void {
    const now = ctx.time;
    const eye = hitboxes(self);
    const s = this.skill;
    for (const a of ctx.agents) {
      if (a.dead || !hostile(self, a)) continue;
      const d = Math.hypot(a.x - self.x, a.z - self.z);
      const flash = a.sinceShot < 1 && !a.suppressed[a.weapon];
      const senses = ctx.senses;
      const range = s.sight * senses.sight * (a.duck > 0.5 ? CROUCH_SIGHT : 1);
      let c = this.contacts.get(a.id);
      let visible = false;
      let headOnly = false;
      let off = 0;
      // How much of them shows through bushes and grass, 0..1.
      let shows = 0;
      if (d <= range) {
        off = Math.abs(angleDiff(yawToward(self.x, self.z, a.x, a.z), this.yaw));
        if (off <= s.fov / 2 || d < TOUCH_RANGE) {
          const h = hitboxes(a);
          const chest = (h.hipY + h.neckY) / 2;
          const through = (x: number, y: number, z: number): number =>
            ctx.world.hasLineOfSight(eye.headX, eye.headY, eye.headZ, x, y, z) ? vegetationOf(ctx.world).seeThrough(eye.headX, eye.headY, eye.headZ, x, y, z) : 0;
          const body = through(h.torsoX, chest, h.torsoZ);
          const head = body >= CONCEALED ? 0 : through(h.headX, h.headY, h.headZ);
          shows = Math.max(body, head);
          // A muzzle flash shows through leaves, unless the shot's suppressed.
          // So does anyone close enough to touch.
          if (shows >= CONCEALED || (shows > 0 && (flash || d < TOUCH_RANGE))) {
            visible = true;
            headOnly = body < CONCEALED && head >= CONCEALED;
          }
        }
      }
      const speed = Math.hypot(a.vx, a.vz);
      if (visible) {
        c ??= this.contact(a.id, a);
        let time = s.spotTime + (d / 100) * s.spotPerDistance;
        // Half hidden in the bushes takes longer to make out.
        time /= Math.max(shows, CONCEALED);
        if (a.duck > 0.5) time *= 1.6;
        if (speed > WALK_SPEED + 0.5) time *= 0.6;
        // A muzzle flash gives a shooter away, unless it's suppressed.
        if (flash) time *= 0.3;
        if (off > s.fov * 0.3) time *= 1.5;
        // Everyone who has been told is looking out for the bounty.
        if (this.isBounty(ctx, a.id)) time *= BOUNTY_SPOT;
        const was = c.level;
        c.level = Math.min(c.level + dt / time, 1);
        if (a.team === 'guard' && c.level >= 0.5 && d < GUARD_WARY) this.guardSeenAt = now;
        if (!c.visible) c.since = now;
        c.visible = true;
        c.headOnly = headOnly;
        if (c.level >= 1) {
          c.x = a.x;
          c.y = a.y;
          c.z = a.z;
          c.seenAt = now;
          if (was < 1 && self.team === 'guard') ctx.callout(self, a);
        } else if (c.level > 0.4) {
          // Something moved over there: turn to look.
          this.heard = { x: a.x, y: a.y, z: a.z, at: now };
        }
        continue;
      }
      if (c) {
        c.visible = false;
        if (c.level < 1) {
          c.level -= dt * AWARENESS_DECAY;
          if (c.level <= 0) this.contacts.delete(a.id);
        } else if (now - c.seenAt > s.memory) this.contacts.delete(a.id);
      }
      // Footsteps, when not in sight.
      const loud = (!a.onGround ? 0 : speed > WALK_SPEED + 0.5 ? STEPS_SPRINT : speed > CROUCH_SPEED + 0.3 ? STEPS_WALK : 0) *
        (this.isBounty(ctx, a.id) ? BOUNTY_LOUD : 1);
      if (d < loud * senses.hearing) this.heard = { x: a.x, y: a.y, z: a.z, at: now };
    }
    for (const id of this.contacts.keys()) {
      const a = ctx.agent(id);
      if (!a || a.dead) this.contacts.delete(id);
    }
    this.seeBags(ctx, self, eye.headX, eye.headY, eye.headZ);
  }

  /** What the bags in sight are worth, as a player reads it off their tags. Only those who pick bags up look. */
  private seeBags(ctx: BotContext, self: Agent, ex: number, ey: number, ez: number): void {
    if (!this.temper || this.temper.bagValue === Infinity) return;
    for (const b of ctx.bags()) {
      if (b.value === undefined || this.bagsTried.has(b.id)) continue;
      const d = Math.hypot(b.x - self.x, b.z - self.z);
      if (d > BAG_SIGHT) continue;
      if (d > TOUCH_RANGE && Math.abs(angleDiff(yawToward(self.x, self.z, b.x, b.z), this.yaw)) > this.skill.fov / 2) continue;
      if (bagShows(ctx.world, ex, ey, ez, b.x, b.y, b.z)) this.bagValues.set(b.id, b.value);
    }
  }

  /** Whether `id` carries the bounty and this bot has been told so. */
  private isBounty(ctx: BotContext, id: number): boolean {
    return id !== 0 && id === ctx.bounty && id === this.bountyKnown;
  }


  private decide(ctx: BotContext, self: Agent): void {
    const now = ctx.time;
    let best: [number, Contact] | null = null;
    let bestScore = Infinity;
    let known: [number, Contact] | null = null;
    for (const entry of this.contacts) {
      const [id, c] = entry;
      if (c.level < 1 || !this.picksFight(ctx, self, id, c, now)) continue;
      if (!known || c.seenAt > known[1].seenAt) known = entry;
      if (!c.visible) continue;
      const score = Math.hypot(c.x - self.x, c.z - self.z) - (id === this.target ? 15 : 0) - this.appeal(ctx, id);
      if (score < bestScore) (best = entry), (bestScore = score);
    }
    const hurt = !this.hurtHandled && now - this.hurtAt < 0.6;
    this.hurtHandled = true;

    if (best) {
      const [id, c] = best;
      const d = Math.hypot(c.x - self.x, c.z - self.z);
      if (id !== this.target) this.acquire(id, d, now);
      else if (c.since === now) this.reactAt = Math.max(this.reactAt, now + this.skill.reaction * 0.5);
      // In cover it stays down, unless it can see someone from there, or is still on its way after a while: then the cover has failed.
      if (this.state === 'cover' && now < this.spotUntil && !this.coverFailed(self, c, now)) return;
      const empty = self.mag[self.weapon] === 0 && self.reserve[self.weapon] > 0 && d > 10;
      // Operators always break off from guards once hurt: there are more where that one came from.
      const duck = this.slipsAway(ctx, id) || this.rand() < this.skill.coverChance;
      // An operator shot at by someone it would rather get away from, or outgunned, ducks out of sight at once;
      // a lone guard close by it fights.
      const outgunned = this.outgunned(self, now);
      const close = ctx.agent(id)?.team === 'guard' && d <= OPERATOR_GUARD_RANGE;
      const pinned = this.dodges() && now - c.threatAt < PINNED && (outgunned || (this.slipsAway(ctx, id) && !close));
      const wantCover = (empty || (hurt && health(self) < HURT && duck) || pinned) && now - this.lastCover > COVER_COOLDOWN;
      if (wantCover && this.takeCover(ctx, self, c, pinned)) {
        if (pinned) tally.pinned++;
        return;
      }
      this.enter('engage');
      return;
    }

    // Shot at by someone it isn't fighting, such as a guard far off: an operator gets out of their sight.
    if (this.dodges() && this.state !== 'cover' && now - this.lastCover > COVER_COOLDOWN) {
      const shooter = [...this.contacts.values()].find((c) => now - c.threatAt < PINNED);
      if (shooter) this.outgunned(self, now);
      if (shooter && this.takeCover(ctx, self, shooter, true)) {
        tally.pinned++;
        this.heard = null;
        return;
      }
    }

    if (this.target) {
      const c = this.contacts.get(this.target);
      if (c && !this.picksFight(ctx, self, this.target, c, now)) {
        // An operator lets a guard go once it's no longer in the way.
        this.target = 0;
        if (!this.isRoutine(this.state)) this.enter(this.routine());
      } else if (!c) {
        this.target = 0;
        if (!this.isRoutine(this.state) && this.state !== 'investigate') this.enter(this.routine());
      } else if (this.state === 'engage' && now - c.seenAt > LOST_TIME) {
        if (!this.flank(ctx, self, c)) this.investigate(ctx, c);
        return;
      } else if (this.state === 'engage' || this.state === 'cover' || this.state === 'flank') return;
    }

    // Shot by someone out of sight, or a friend called out a contact. Operators don't go looking for guards.
    if (known && known[1].seenAt >= this.stateAt && this.state !== 'flank' && !this.slipsAway(ctx, known[0])) {
      this.target = known[0];
      if (hurt && this.rand() < this.skill.coverChance && now - this.lastCover > COVER_COOLDOWN && this.takeCover(ctx, self, known[1])) return;
      this.investigate(ctx, known[1]);
      return;
    }

    // Someone else's fight, or the bounty called nearby: go and see who's left. Not once heading out or hurt.
    // Making for a post to watch from, or at it, it keeps to it.
    const posted = this.state === 'stalk' && !!this.spot?.post;
    if ((this.isRoutine(this.state) && this.state !== 'extract') || (this.state === 'stalk' && !posted)) {
      const lure = health(self) >= WOUNDED ? this.lured(ctx, self) : null;
      if (lure) {
        this.stalk(ctx, self, lure);
        return;
      }
    }
    // A fight broke out nearby: a rat lies low until it's over.
    if (this.alarm && this.alarm.at > this.hideAt && (this.isRoutine(this.state) || this.state === 'hide') && !this.waiting(ctx, self)) {
      this.hide(ctx, self, this.alarm);
      return;
    }
    if (this.isRoutine(this.state) && this.bidesForFog(ctx, self)) return;
    if (this.isRoutine(this.state) && this.pickUpBag(ctx, self)) return;

    if (this.heard && this.heard.at >= this.stateAt && this.state !== 'engage') {
      const h = this.heard;
      this.heard = null;
      const d = Math.hypot(h.x - self.x, h.z - self.z);
      if (d > (posted || this.spot?.post && this.state === 'hunt' ? POST_NOTICE : this.curiosity())) return;
      this.investigate(ctx, h);
    }
  }

  /** How far it goes to check on a noise: a hunter farther under rain, which hides its coming; a camper holds its spot once sight shortens. */
  private curiosity(): number {
    const c = this.temper?.curiosity ?? (this.role.kind === 'operator' ? OPERATOR_CURIOSITY : GUARD_CURIOSITY);
    if (this.pushes()) return c * RAIN_CURIOSITY;
    if (this.personality === 'camper' && this.sight < CAMP_HOLD) return 0;
    return c;
  }

  /**
   * Whether an operator is outgunned: shot at lately by more people than it
   * can take on, or by anyone once badly hurt. If so it gets away for a while.
   */
  private outgunned(self: Agent, now: number): boolean {
    if (!this.dodges()) return false;
    let shooters = 0;
    for (const c of this.contacts.values()) if (c.level >= 1 && now - c.threatAt < OUTGUNNED_MEMORY) shooters++;
    if (shooters < OUTGUNNED && !(shooters > 0 && health(self) < BADLY_HURT)) return false;
    if (now >= this.retreatUntil) tally.outgunned++;
    this.retreatUntil = now + RETREAT_TIME;
    return true;
  }

  /** Whether cover it's in or going to no longer hides it from `c`, whom it can see. */
  private coverFailed(self: Agent, c: Contact, now: number): boolean {
    if (this.role.kind !== 'operator' || !c.visible || !this.spot) return false;
    const there = Math.hypot(this.spot.x - self.x, this.spot.z - self.z) <= arrival(this.spot, ARRIVE);
    // Getting away, it runs on unless caught up with.
    if (this.fleeing) return there || Math.hypot(c.x - self.x, c.z - self.z) < FLEE_FIGHT;
    return there || now - this.stateAt > COVER_RUN;
  }

  /** An operator ducks out of sight of shooters, unless it's a thorough one, which can't be killed and doesn't notice being shot. */
  private dodges(): boolean {
    return this.role.kind === 'operator' && !this.role.thorough;
  }

  /** Whether it's in the extraction zone it's heading for, waiting to get out. */
  private waiting(ctx: BotContext, self: Agent): boolean {
    const e = this.state === 'extract' ? ctx.extracts[this.exit] : undefined;
    return !!e && Math.hypot(e.x - self.x, e.z - self.z) < EXTRACT_RADIUS;
  }

  /**
   * Lie low while a fight goes on nearby: in a bush that hides it from the
   * fight, or else somewhere out of the fight's sight, not toward it; or just
   * where it is. Hearing more of it keeps it there longer.
   */
  private hide(ctx: BotContext, self: Agent, fight: Point & { at: number }): void {
    this.hideAt = fight.at;
    // Where the shooter stands, as a shot is heard from their gun.
    const w = ctx.world;
    this.fightAt = { x: fight.x, y: w.groundHeight(fight.x, fight.z, w.floorHeight(fight.x, fight.z)), z: fight.z };
    const until = this.now + this.between(HIDE_TIME);
    if (this.state === 'hide') {
      this.spotUntil = Math.max(this.spotUntil, until);
      return;
    }
    tally.hides++;
    const spot = this.coverFrom(ctx, self, [this.fightAt], HIDE_SEARCH);
    if (spot?.bush) tally.bushHides++;
    this.enter('hide');
    this.spot = spot ?? { x: self.x, y: self.y, z: self.z };
    this.spotUntil = until;
  }

  /** How much more a target is worth fighting, in metres nearer: the bounty, and for a hunter, the wounded. */
  private appeal(ctx: BotContext, id: number): number {
    if (!this.temper) return 0;
    const a = ctx.agent(id);
    if (!a) return 0;
    return (this.isBounty(ctx, id) && !this.temper.shy ? 20 : 0) + (this.personality === 'hunter' ? (1 - health(a)) * 40 : 0);
  }

  /**
   * A fight between others it wants to join, or the bounty, not followed yet:
   * gunfire from two sides close together, or for a hunter any gunfire.
   */
  private lured(ctx: BotContext, self: Agent): (Point & { at: number; guards?: boolean; source?: number }) | null {
    const t = this.temper;
    if (!t) return null;
    let best: (Point & { at: number; guards?: boolean; source?: number }) | null = null;
    let bestD = Infinity;
    for (const g of this.gunfire) {
      if (g.at <= this.stalkAt || this.now - g.at >= FIGHT_MEMORY) continue;
      const d = Math.hypot(g.x - self.x, g.z - self.z);
      if (d > t.thirdParty || d < FIGHT_NEAR || d >= bestD) continue;
      const fight = t.anyGunfire || this.gunfire.some((o) =>
        o.source !== g.source && this.now - o.at < FIGHT_MEMORY && Math.hypot(o.x - g.x, o.z - g.z) < FIGHT_SPREAD);
      if (!fight) continue;
      // Guards in it bring more guards: that one is watched from farther off.
      const guards = this.gunfire.some((o) => Math.hypot(o.x - g.x, o.z - g.z) < FIGHT_SPREAD && ctx.agent(o.source)?.team === 'guard');
      best = { ...g, guards };
      bestD = d;
    }
    if (!best && this.lure && this.lure.at > this.stalkAt) best = this.lure;
    return best;
  }

  /**
   * Close in on a fight or the bounty: stop short, then watch. A fight at an
   * outpost is watched from outside it, for whoever comes out.
   */
  private stalk(ctx: BotContext, self: Agent, at: Point & { at: number; guards?: boolean; source?: number }): void {
    this.stalkAt = at.at;
    const d = Math.hypot(at.x - self.x, at.z - self.z);
    // A hunter under rain stops nearer, unheard.
    const map = !!ctx.world.map;
    const standoff = (map ? MAP_STANDOFF : at.guards ? GUARD_STANDOFF : STALK_STANDOFF) * (this.pushes() ? RAIN_STANDOFF : 1);
    if (d < standoff) return;
    // In a town: from a window or a roof that sees it, or from the street beside something solid.
    if (map) {
      const w = ctx.world;
      // Still the same fight: keep to the place picked to watch it.
      if (this.state === 'stalk' && this.fightAt && Math.hypot(at.x - this.fightAt.x, at.z - this.fightAt.z) < SAME_FIGHT) return;
      const fight = { x: at.x, y: w.groundHeight(at.x, at.z, at.y + 0.5), z: at.z };
      const post = this.rand() < WATCH_HIGH ? vantageOver(w, vantages(w), fight, self, MAP_WATCH, [], this.rand) : null;
      let spot: Spot | null = post ? { x: post.x, y: post.y, z: post.z, post: true } : null;
      if (!spot) {
        const k = (d - standoff) / d;
        const p = ctx.nav.nearestWalkable(self.x + (at.x - self.x) * k, self.z + (at.z - self.z) * k, 10);
        if (!p) return;
        spot = this.streetSpot(ctx, { x: p.x, y: w.groundHeight(p.x, p.z, w.floorHeight(p.x, p.z)), z: p.z }, fight);
      }
      if (post) tally.posts++;
      const shooter = at.source !== undefined ? ctx.agent(at.source) : undefined;
      if (shooter && this.state !== 'stalk') {
        tally.joins++;
        tally.guessOff += Math.hypot(shooter.x - at.x, shooter.z - at.z);
      }
      this.enter('stalk', true);
      this.spot = spot;
      this.spotYaw = post?.yaw ?? null;
      this.fightAt = fight;
      return;
    }
    let k = (d - standoff) / d;
    const o = this.supplies ? null : ctx.world.nearestOutpost(at.x, at.z);
    if (o && o.dist < OUTPOST_BERTH) {
      const out = o.outpost;
      const from = Math.hypot(self.x - out.x, self.z - out.z);
      if (from < OUTPOST_WATCH) return;
      k = 1 - OUTPOST_WATCH / from;
      at = { x: out.x, y: at.y, z: out.z, at: at.at };
    }
    const p = ctx.nav.nearestWalkable(self.x + (at.x - self.x) * k, self.z + (at.z - self.z) * k, 10);
    if (!p) return;
    const shooter = at.source !== undefined ? ctx.agent(at.source) : undefined;
    if (shooter && this.state !== 'stalk') {
      tally.joins++;
      tally.guessOff += Math.hypot(shooter.x - at.x, shooter.z - at.z);
    }
    if (this.pushes() && this.state !== 'stalk') tally.rainStalks++;
    this.enter('stalk', true);
    // Watch from a bush nearby, if there's one that can see that way.
    this.spot = this.waitSpot(ctx, { x: p.x, y: at.y, z: p.z }, at);
    this.fightAt = { x: at.x, y: at.y, z: at.z };
  }

  /** A bag worth the detour lies nearby: go through it next. */
  private pickUpBag(ctx: BotContext, self: Agent): boolean {
    const t = this.temper;
    if (!t || t.bagValue === Infinity || this.role.kind !== 'operator' || self.carry >= this.carryLimit()) return false;
    for (const b of ctx.bags()) {
      if (this.bagsTried.has(b.id) || (this.bagValues.get(b.id) ?? 0) < t.bagValue) continue;
      const d = Math.hypot(b.x - self.x, b.z - self.z);
      if (d > BAG_RANGE) continue;
      this.bagsTried.add(b.id);
      // Stand just short of it, on the near side.
      const k = Math.max(d - 0.8, 0) / (d || 1);
      const p = ctx.nav.nearestWalkable(self.x + (b.x - self.x) * k, self.z + (b.z - self.z) * k, 3);
      if (!p) continue;
      const y = ctx.world.groundHeight(p.x, p.z, ctx.world.floorHeight(p.x, p.z));
      if (this.step < this.planned) this.planned++;
      this.loot.splice(Math.min(this.step, this.loot.length), 0, { x: p.x, y, z: p.z, look: { x: b.x, y: b.y, z: b.z }, bag: b.id });
      this.enter('loot', true);
      return true;
    }
    return false;
  }

  /** Set up behaviour for the current state: where to go, how, and what to look at. */
  private behave(ctx: BotContext, self: Agent): void {
    const now = ctx.time;
    this.crouch = false;
    this.pace = 'walk';
    this.focus = null;
    this.idleLook = false;
    this.use = null;
    const role = this.role;
    const sentry = role.kind === 'sentry';

    switch (this.state) {
      case 'patrol': {
        if (this.inbound) {
          if (Math.hypot(this.inbound.x - self.x, this.inbound.z - self.z) > INBOUND_ARRIVE) this.pace = 'sprint';
          else this.inbound = null;
        }
        if (role.kind === 'sentry') {
          const far = Math.hypot(role.post.x - self.x, role.post.z - self.z) > ARRIVE;
          this.goTo(far ? role.post : null);
          if (!far) this.lookAround(now, role.post.yaw);
          break;
        }
        if (role.kind !== 'guard') break;
        const leader = role.leader ? ctx.agent(role.leader) : undefined;
        if (leader && !leader.dead) {
          const gx = leader.x + Math.sin(leader.yaw) * FOLLOW_GAP;
          const gz = leader.z + Math.cos(leader.yaw) * FOLLOW_GAP;
          const far = Math.hypot(gx - self.x, gz - self.z);
          this.goTo(far > ARRIVE ? { x: gx, z: gz } : null);
          if (far > 12) this.pace = 'sprint';
          if (far <= ARRIVE) this.lookAround(now, leader.yaw);
          break;
        }
        const p = role.route[this.step % role.route.length];
        if (Math.hypot(p.x - self.x, p.z - self.z) > ARRIVE) {
          this.goTo(p);
          break;
        }
        this.goTo(null);
        if (this.waitUntil === 0) this.waitUntil = now + this.between(PATROL_WAIT);
        this.lookAround(now, this.yaw);
        if (now >= this.waitUntil) {
          this.step++;
          this.waitUntil = 0;
        }
        break;
      }

      case 'loot': {
        if (role.kind !== 'operator') break;
        const spot = this.loot[this.step];
        // Done, or short of time with enough to get out.
        if (!spot || (now - this.born >= RUN_TIME - LEAVE_BY && this.paid)) {
          this.enter(this.routine());
          break;
        }
        const d = away(spot, self);
        if (d > ARRIVE) {
          this.goTo(this.around(ctx, self, spot));
          this.travel(ctx, self, d);
          break;
        }
        this.goTo(null);
        this.crouch = true;
        this.focus = spot.look;
        if (this.waitUntil === 0) this.waitUntil = now + LOOT_TIMEOUT;
        // Search it, then take supplies and whatever else it can carry.
        const view = ctx.lootView(self);
        const next = view?.items[0];
        if (now >= this.waitUntil) this.nextStop();
        // The bag was emptied, or someone else got to it.
        else if (spot.bag !== undefined && view?.id !== spot.bag) this.nextStop();
        else if (!view || !view.searched) this.use = 'hold';
        else if (next !== undefined && (ITEMS[next].use || self.carry + ITEMS[next].mass <= this.carryLimit())) this.use = 'tap';
        else this.nextStop();
        break;
      }

      case 'extract': {
        if (role.kind !== 'operator') break;
        const e = this.chooseExit(ctx, self);
        if (!e) {
          this.done = true;
          break;
        }
        const d = Math.hypot(e.x - self.x, e.z - self.z);
        if (d > EXTRACT_RADIUS / 2) {
          this.goTo(this.around(ctx, self, e));
          this.travel(ctx, self, d);
          break;
        }
        // In the zone: keep low and wait for it to open, or call the pickup.
        this.goTo(null);
        this.crouch = true;
        this.lookAround(now, this.yaw);
        if (e.kind === 'call' && e.open && e.pickup < 0) this.use = 'tap';
        break;
      }

      case 'hunt': {
        if (this.routine() !== 'hunt') {
          this.enter(this.routine());
          break;
        }
        // Roam between places people pass, stopping to listen, until a fight is heard.
        if (!this.spot || this.postFired || (this.waitUntil > 0 && now >= this.waitUntil)) {
          this.spot = this.roamPoint(ctx, self);
          this.waitUntil = 0;
          this.postFired = false;
        }
        const d = this.spot ? spotAway(this.spot, self) : 0;
        if (this.spot && d > arrival(this.spot, ARRIVE * 2)) {
          this.goTo(this.around(ctx, self, this.spot));
          this.travel(ctx, self, d);
          break;
        }
        this.goTo(null);
        this.crouch = this.spot?.post ? this.ducksBetweenLooks(now) : true;
        if (this.waitUntil === 0 && this.spot?.post) tally.postsHeld++;
        if (this.waitUntil === 0) this.waitUntil = now + this.between(LOOK_AROUND) * 1.5;
        this.lookAround(now, this.spot?.post && this.spotYaw !== null ? this.spotYaw : this.yaw);
        break;
      }

      case 'camp': {
        if (this.routine() !== 'camp') {
          this.enter(this.routine());
          break;
        }
        // Wait near the extraction point it'll use, low, watching whoever comes.
        const e = this.chooseExit(ctx, self);
        if (!e) {
          this.enter('extract');
          break;
        }
        // As sight shortens it moves in nearer, so as still to see whoever comes; out again as it clears.
        const resight = Math.abs(this.sight - this.campSight) > CAMP_RESIGHT;
        if (this.campFor !== this.exit || resight) {
          if (this.campFor === this.exit && this.sight < this.campSight) tally.campsCloser++;
          this.camp = this.pickCamp(ctx, e);
          this.campFor = this.exit;
        }
        // Nowhere to camp that sees into it: just leave.
        if (!this.camp) {
          this.campDone = true;
          this.enter('extract');
          break;
        }
        const d = Math.hypot(this.camp.x - self.x, this.camp.z - self.z);
        if (d > arrival(this.camp, ARRIVE)) {
          this.goTo(this.around(ctx, self, this.camp));
          this.travel(ctx, self, d);
          break;
        }
        this.goTo(null);
        this.crouch = true;
        this.lookAround(now, yawToward(self.x, self.z, e.x, e.z));
        break;
      }

      case 'hide': {
        const spot = this.spot!;
        const fight = this.fightAt ?? spot;
        const d = Math.hypot(spot.x - self.x, spot.z - self.z);
        if (d > arrival(spot, ARRIVE)) {
          this.goTo(spot);
          this.pace = 'sneak';
        } else {
          this.goTo(null);
          this.crouch = true;
          this.lookAround(now, yawToward(self.x, self.z, fight.x, fight.z));
        }
        // Lying low for fog, it sets off once the fog is in.
        if (now >= this.spotUntil || (this.biding && this.fog >= IN_COVER)) this.enter(this.routine());
        break;
      }

      case 'stalk': {
        const spot = this.spot!;
        const d = spotAway(spot, self);
        const fight = this.fightAt ?? spot;
        const toFight = Math.hypot(fight.x - self.x, fight.z - self.z);
        if (d > arrival(spot, ARRIVE * 2) && this.waitUntil === 0) {
          this.goTo(spot);
          // Run while far off, then close in carefully, watching where the shots came from; under rain, which
          // drowns out footsteps, a hunter runs in closer.
          const push = this.pushes();
          if (toFight > (push ? RAIN_SPRINT : 90) && self.stamina > 0.3 && !this.temper?.sneaky) this.pace = 'sprint';
          else if (toFight < (push ? RAIN_SPRINT / 2 : 50)) {
            this.pace = this.skill.name === 'easy' ? 'walk' : 'sneak';
            this.focus = { x: fight.x, y: fight.y + EYE_HEIGHT, z: fight.z };
          }
        } else {
          this.goTo(null);
          this.crouch = spot.post ? this.ducksBetweenLooks(now) : true;
          if (this.waitUntil === 0 && spot.post) tally.postsHeld++;
          if (this.waitUntil === 0) this.waitUntil = now + this.between(LOOK_AROUND) * 2;
          this.lookAround(now, yawToward(self.x, self.z, fight.x, fight.z));
          if (now >= this.waitUntil) this.enter(this.routine());
        }
        if (now - this.stateAt > STALK_TIME) this.enter(this.routine());
        break;
      }

      case 'investigate': {
        const spot = this.spot!;
        const d = away(spot, self);
        this.focus = { x: spot.x, y: spot.y + EYE_HEIGHT, z: spot.z };
        if (sentry || d <= ARRIVE * 2 || this.waitUntil > 0) {
          // There, or can't leave: watch the spot a while, then look around.
          this.goTo(null);
          if (this.waitUntil === 0) this.waitUntil = now + this.between(LOOK_AROUND);
          if (d < 8 || now > this.waitUntil - 2) this.lookAround(now, yawToward(self.x, self.z, spot.x, spot.z));
          if (now >= this.waitUntil) this.enter(this.routine());
        } else {
          this.goTo(spot);
          // Look where we're going until close, then at the spot.
          if (d > 25) this.focus = null;
          else if (this.skill.name === 'hard') this.pace = 'sneak';
        }
        if (now - this.stateAt > INVESTIGATE_TIME) this.enter(this.routine());
        break;
      }

      case 'engage': {
        const a = ctx.agent(this.target);
        const c = this.contacts.get(this.target);
        if (!a || !c) {
          this.enter(this.routine());
          break;
        }
        const d = Math.hypot(a.x - self.x, a.z - self.z);
        this.chooseWeapon(self, d);
        this.clearShot = this.lineClear(ctx, self, a, d);
        if (!c.visible) {
          // Hold and aim where they were last seen.
          this.goTo(null);
          this.focus = { x: c.x, y: c.y + EYE_HEIGHT, z: c.z };
          break;
        }
        if (sentry) {
          this.goTo(null);
          this.crouch = self.reload > 0;
          break;
        }
        if (d > EFFECTIVE_RANGE[this.weapon]) {
          this.goTo(this.leashed(ctx, { x: a.x, y: a.y, z: a.z }));
          break;
        }
        this.goTo(null);
        if (this.spot?.post && spotAway(this.spot, self) <= arrival(this.spot, ARRIVE)) this.postFired = true;
        if (now >= this.strafeUntil) {
          const r = this.rand();
          this.strafe = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
          this.strafeUntil = now + 0.6 + this.rand() * 1;
          // Operators, who can't count on friends, keep low more of the time.
          const low = role.kind === 'operator' ? [15, 0.6] : [25, 0.35];
          this.crouch = this.skill.name !== 'easy' && d > low[0] && this.rand() < low[1];
        }
        if (d < TOO_CLOSE) this.strafe = 2;
        break;
      }

      case 'cover': {
        const spot = this.spot!;
        const c = this.contacts.get(this.target);
        if (c) this.focus = { x: c.x, y: c.y + EYE_HEIGHT, z: c.z };
        if (Math.hypot(spot.x - self.x, spot.z - self.z) > arrival(spot, ARRIVE)) {
          this.goTo(spot);
          this.pace = 'sprint';
          this.focus = null;
        } else {
          this.goTo(null);
          this.crouch = true;
          if (self.mag[self.weapon] < WEAPONS[self.weapon].magSize && self.reserve[self.weapon] > 0) this.reloadWanted = true;
        }
        // Stay until reloaded and settled, then peek, or for an operator hiding from a guard, slip away.
        if ((now >= this.spotUntil && self.reload <= 0 && self.mag[self.weapon] > 0) || now - this.stateAt > FLANK_TIME) {
          if (this.slipsAway(ctx, this.target) && !c?.visible) {
            this.target = 0;
            this.enter(this.routine());
          } else this.enter('engage');
        }
        break;
      }

      case 'flank': {
        const spot = this.spot!;
        const c = this.contacts.get(this.target);
        const d = spotAway(spot, self);
        this.goTo(d > ARRIVE ? spot : null);
        this.pace = d > 15 ? 'sprint' : 'walk';
        if (c && Math.hypot(c.x - self.x, c.z - self.z) < 20) this.focus = { x: c.x, y: c.y + EYE_HEIGHT, z: c.z };
        if (d <= ARRIVE || now - this.stateAt > FLANK_TIME) {
          if (c) this.investigate(ctx, c);
          else this.enter(this.routine());
        }
        break;
      }
    }
    if (this.state !== 'engage' && this.state !== 'cover') {
      // Top up between fights; guards also restock.
      if (self.mag[self.weapon] < WEAPONS[self.weapon].magSize * 0.6) this.reloadWanted = true;
      if (this.state === 'patrol' && self.team === 'guard') self.reserve = spawnWeapons().reserve;
      // So do thorough operators, which can't die and so never run out of fights.
      if (role.kind === 'operator' && role.thorough && self.reserve[this.primary] === 0) self.reserve = spawnWeapons().reserve;
      if (this.weapon !== this.primary && self.mag[this.primary] + self.reserve[this.primary] > 0) this.weapon = this.primary;
    }
  }

  /**
   * Where to head for on the way to `goal` so as to keep clear of the outposts
   * it isn't going to: the goal itself, or a point off to the side of the
   * first outpost the straight line would pass close to.
   */
  private around(ctx: BotContext, self: Agent, goal: Point): Point {
    const dx = goal.x - self.x;
    const dz = goal.z - self.z;
    const len = Math.hypot(dx, dz);
    // In Deathmatch nobody guards the outposts.
    if (len < 1 || this.supplies) return goal;
    let best: Point | null = null;
    let bestAlong = Infinity;
    for (const o of ctx.world.outposts) {
      // Going there, or already there: nothing to go around.
      if (Math.hypot(o.x - goal.x, o.z - goal.z) < OUTPOST_BERTH || Math.hypot(o.x - self.x, o.z - self.z) < OUTPOST_BERTH) continue;
      const along = ((o.x - self.x) * dx + (o.z - self.z) * dz) / len;
      if (along <= 0 || along >= len) continue;
      // Which side of the line the outpost is on; pass it on the other.
      const side = (dx * (o.z - self.z) - dz * (o.x - self.x)) / len;
      if (Math.abs(side) >= OUTPOST_BERTH || along >= bestAlong) continue;
      const nx = (dz / len) * Math.sign(side || 1);
      const nz = (-dx / len) * Math.sign(side || 1);
      const p = ctx.nav.nearestWalkable(o.x + nx * OUTPOST_BERTH * 1.15, o.z + nz * OUTPOST_BERTH * 1.15, 20);
      if (!p) continue;
      best = { x: p.x, y: goal.y, z: p.z };
      bestAlong = along;
    }
    return best ?? goal;
  }

  /**
   * How an operator crosses the island `d` metres from where it's going: fast
   * in the open, quietly near outposts and guards. In fog, rats and looters
   * hurry on, a rat running too, and keep low only nearer outposts.
   */
  private travel(ctx: BotContext, self: Agent, d: number): void {
    const near = this.supplies ? Infinity : (ctx.world.nearestOutpost(self.x, self.z)?.dist ?? Infinity);
    const bold = this.fogMoves() ? FOG_BOLDNESS : 1;
    const sneaky = !!this.temper?.sneaky && bold === 1;
    // Near an outpost, or with a guard seen about lately, it keeps low.
    const wary = this.now - this.guardSeenAt < WARY_TIME;
    if ((near < (sneaky ? OUTPOST_WALK : OUTPOST_SNEAK) * bold || wary) && d > ARRIVE * 3) this.pace = 'sneak';
    else if (d > 30 && self.stamina > 0.4 && near > OUTPOST_WALK * bold && !sneaky) this.pace = 'sprint';
  }

  /** Somewhere for a hunter to go looking: an extraction point, or a random spot within reach. */
  private roamPoint(ctx: BotContext, self: Agent): Spot | null {
    this.spotYaw = null;
    const w = ctx.world;
    if (w.map) {
      // In a town: a window or a roof's edge near it, or a spot in the street beside something solid, anywhere;
      // just in, it sets off along the street rather than holing up by its spawn point.
      const fresh = self.life !== this.roamedLife;
      this.roamedLife = self.life;
      const posts = fresh ? [] : vantages(w).filter((v) => Math.hypot(v.x - self.x, v.z - self.z) < ROAM_POST);
      if (posts.length && this.rand() < ROAM_HIGH) {
        const post = posts[Math.floor(this.rand() * posts.length)];
        tally.posts++;
        this.spotYaw = post.yaw;
        return { x: post.x, y: post.y, z: post.z, post: true };
      }
      for (let i = 0; i < 6; i++) {
        const [x, z] = within(w.bounds, this.rand(), this.rand());
        const p = ctx.nav.nearestWalkable(x, z, 15);
        if (!p || p.y !== undefined || !ctx.nav.dry(p.x, p.z)) continue;
        return this.streetSpot(ctx, { x: p.x, y: w.groundHeight(p.x, p.z, w.floorHeight(p.x, p.z)), z: p.z });
      }
      return null;
    }
    const exits = ctx.extracts.filter((e) => Math.hypot(e.x - self.x, e.z - self.z) < HUNT_RANGE * 2);
    if (exits.length && this.rand() < 0.4) {
      const e = exits[Math.floor(this.rand() * exits.length)];
      const p = this.campSpot(ctx, e, CAMP_RANGE[1]);
      if (p) return p;
    }
    for (let i = 0; i < 6; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = HUNT_RANGE * (0.4 + this.rand() * 0.6);
      const [x, z] = [self.x + Math.sin(a) * r, self.z + Math.cos(a) * r];
      const p = ctx.nav.nearestWalkable(x, z, 15);
      if (!p || !ctx.nav.dry(p.x, p.z)) continue;
      const near = ctx.world.nearestOutpost(p.x, p.z)?.dist ?? Infinity;
      if (near < OUTPOST_BERTH && !this.supplies) continue;
      return this.waitSpot(ctx, { x: p.x, y: ctx.world.groundHeight(p.x, p.z, ctx.world.floorHeight(p.x, p.z)), z: p.z });
    }
    return null;
  }

  /**
   * A camp for extraction point `e` that sees into it, looking farther out
   * until CAMP_FARTHEST; null if there's none.
   */
  private pickCamp(ctx: BotContext, e: ExtractPoint): Spot | null {
    tally.camps++;
    this.campSight = this.sight;
    const k = Math.max(Math.min(this.sight, 1), CAMP_NEAREST / CAMP_RANGE[0]);
    const ring: [number, number] = [CAMP_RANGE[0] * k, CAMP_RANGE[1] * k];
    for (let far = ring[1]; far <= CAMP_FARTHEST; far += CAMP_WIDEN) {
      const found = this.campSpot(ctx, e, far, ring);
      if (found) return found;
    }
    tally.campless++;
    return null;
  }

  /**
   * A dry spot a little way off an extraction point, out to `far`, that can
   * see into it from a crouch: in a bush if one will do, nearest the middle
   * of `ring`. Null if none of those tried can.
   */
  private campSpot(ctx: BotContext, e: Point, far: number, ring = CAMP_RANGE): Spot | null {
    const w = ctx.world;
    const sees = (x: number, y: number, z: number): boolean => w.hasLineOfSight(x, y + CROUCH_EYE_HEIGHT, z, e.x, e.y + 1, e.z);
    const clear = (x: number, z: number): boolean => ctx.nav.dry(x, z) && (w.nearestOutpost(x, z)?.dist ?? Infinity) >= OUTPOST_BERTH;
    let best: Spot | null = null;
    let bestD = Infinity;
    for (const b of hidingBushes(ctx.world, e.x, e.z, far)) {
      const d = Math.hypot(b.x - e.x, b.z - e.z);
      if (d < ring[0] || !clear(b.x, b.z) || !sees(b.x, b.y, b.z)) continue;
      // Nearest the middle of the range.
      const off = Math.abs(d - (ring[0] + ring[1]) / 2);
      if (off < bestD) (best = { x: b.x, y: b.y, z: b.z, bush: true }), (bestD = off);
    }
    if (best) return best;
    const turn = this.rand() * Math.PI * 2;
    for (let i = 0; i < CAMP_TRIES; i++) {
      const a = turn + (i / CAMP_TRIES) * Math.PI * 2;
      const r = ring[0] + this.rand() * (far - ring[0]);
      const x = e.x + Math.sin(a) * r;
      const z = e.z + Math.cos(a) * r;
      if (!clear(x, z)) continue;
      const y = w.groundHeight(x, z, w.floorHeight(x, z));
      if (sees(x, y, z)) return { x, y, z };
    }
    return null;
  }

  /**
   * Somewhere to settle down near `near`: in a bush that hides a crouched body
   * within BUSH_WAIT of it, one that can see `watch` if given, or else `near` itself.
   */
  private waitSpot(ctx: BotContext, near: Point, watch?: Point): Spot {
    tally.waits++;
    let best: Spot | null = null;
    let bestD = Infinity;
    for (const b of hidingBushes(ctx.world, near.x, near.z, BUSH_WAIT)) {
      const d = Math.hypot(b.x - near.x, b.z - near.z);
      if (d >= bestD || !ctx.nav.dry(b.x, b.z)) continue;
      if (watch && !ctx.world.hasLineOfSight(b.x, b.y + CROUCH_EYE_HEIGHT, b.z, watch.x, watch.y + 1, watch.z)) continue;
      best = { x: b.x, y: b.y, z: b.z, bush: true };
      bestD = d;
    }
    if (!best) return near;
    tally.bushWaits++;
    return best;
  }

  /**
   * Somewhere in a town's street near `near` to wait at, keeping close to
   * something solid (a wall, a corner, a truck) rather than out in the open:
   * the spot within STREET_SEARCH with the most beside it, nearest `near`, of
   * those that see `watch` if given; or `near` itself.
   */
  private streetSpot(ctx: BotContext, near: Point, watch?: Point): Spot {
    const w = ctx.world;
    let best: Spot = near;
    let bestScore = Infinity;
    const turn = this.rand() * Math.PI * 2;
    for (let i = 0; i < 13; i++) {
      const a = turn + i * 2.4;
      const r = i === 0 ? 0 : 1.5 + (i % 3) * ((STREET_SEARCH - 1.5) / 2);
      const p = ctx.nav.nearestWalkable(near.x + Math.sin(a) * r, near.z + Math.cos(a) * r, 1.5);
      if (!p || p.y !== undefined || !ctx.nav.dry(p.x, p.z)) continue;
      const y = w.groundHeight(p.x, p.z, w.floorHeight(p.x, p.z));
      if (Math.abs(y - near.y) > 2) continue;
      if (watch && !w.hasLineOfSight(p.x, y + EYE_HEIGHT, p.z, watch.x, watch.y + 1, watch.z)) continue;
      let beside = 0;
      for (let k = 0; k < 8; k++) {
        const b = (k / 8) * Math.PI * 2;
        if (!w.hasLineOfSight(p.x, y + CROUCH_EYE_HEIGHT, p.z, p.x + Math.sin(b) * BESIDE, y + CROUCH_EYE_HEIGHT, p.z + Math.cos(b) * BESIDE)) beside++;
      }
      const score = Math.hypot(p.x - near.x, p.z - near.z) * 0.4 - Math.min(beside, 3) * 2;
      if (score < bestScore) (best = { x: p.x, y, z: p.z }), (bestScore = score);
    }
    if (best !== near) tally.streetSpots++;
    return best;
  }

  /** How much it's willing to carry, kg: more while it can't yet pay for extraction, and for a looter, in fog. */
  private carryLimit(): number {
    if (this.role.kind !== 'operator') return 0;
    if (!this.paid) return CARRY_MAX;
    return this.role.greed + (this.personality === 'looter' && this.fogMoves() ? FOG_GREED : 0);
  }

  private nextStop(): void {
    this.step++;
    this.waitUntil = 0;
    this.enter(this.routine(), true);
  }

  /** The nearest open extraction point it can reach, or the nearest shut one to wait at. */
  private chooseExit(ctx: BotContext, self: Agent): ExtractPoint | null {
    const current = ctx.extracts[this.exit];
    let best = -1;
    let bestD = Infinity;
    ctx.extracts.forEach((e, i) => {
      if (this.unreachable.has(i)) return;
      // Prefer open ones by counting shut ones as much farther away; stick with the current one a little.
      // Those in sight of an outpost count as farther too.
      const guarded = (ctx.world.nearestOutpost(e.x, e.z)?.dist ?? Infinity) < GUARDED_EXIT ? GUARDED_EXIT : 0;
      const d = Math.hypot(e.x - self.x, e.z - self.z) + (e.open ? 0 : 400) + guarded - (i === this.exit ? 20 : 0);
      if (d < bestD) (best = i), (bestD = d);
    });
    if (best !== this.exit && current) {
      this.path = [];
      this.pathGoal = null;
    }
    this.exit = best;
    return ctx.extracts[best] ?? null;
  }

  /** Start fighting a new target: the first shot waits for a reaction, and the aim starts off. */
  private acquire(id: number, dist: number, now: number): void {
    const s = this.skill;
    this.target = id;
    this.aimHead = this.rand() < s.headChance;
    this.reactAt = now + s.reaction * (0.8 + this.rand() * 0.4);
    const a = this.rand() * Math.PI * 2;
    const err = s.aimError * (0.6 + this.rand() * 0.8) * (dist < 10 ? 0.6 : 1);
    this.errYaw = Math.cos(a) * err;
    this.errPitch = Math.sin(a) * err * 0.6;
    this.burstEnd = 0;
  }

  /** Switch state; `again` restarts the current one. */
  private enter(state: BotState, again = false): void {
    if (state === this.state && !again) return;
    this.state = state;
    this.stateAt = this.now;
    this.waitUntil = 0;
    this.biding = false;
    this.path = [];
    this.pathGoal = null;
  }

  /**
   * Whether to fight a spotted enemy. Guards always do. Operators fight guards
   * only up close, a little farther when shot at, and get away from the rest;
   * other operators they fight back when shot at, and otherwise only within
   * their gun's range, and not at all once carrying loot worth keeping.
   */
  private picksFight(ctx: BotContext, self: Agent, id: number, c: Contact, now: number): boolean {
    if (this.role.kind !== 'operator') return true;
    const d = Math.hypot(c.x - self.x, c.z - self.z);
    const threat = now - c.threatAt < THREAT_TIME;
    // Getting away from a fight it's outgunned in, heading out with enough to pay, or carrying loot
    // worth keeping, it starts none; a hunter still takes what comes, and anyone fights what's right on top of it.
    const wary = (this.loaded || (this.paid && this.state === 'extract')) && this.personality !== 'hunter';
    if (!threat && (now < this.retreatUntil || wary) && d > TOUCH_RANGE * 2) return false;
    // A guard shooting from far off is got away from, not fought.
    if (ctx.agent(id)?.team === 'guard') return d <= (threat ? GUARD_FIGHT_BACK : OPERATOR_GUARD_RANGE);
    if (threat) return true;
    let range = EFFECTIVE_RANGE[this.primary] * (this.temper?.fightRange ?? 1);
    if (this.isBounty(ctx, id)) range *= BOUNTY_REACH;
    // A hunter goes after the wounded from farther.
    else if (this.personality === 'hunter' && health(ctx.agent(id)) < WOUNDED) range *= BOUNTY_REACH;
    return d <= range;
  }

  /** An operator facing a guard, a shy one facing anyone, or one outgunned: it would rather get away than win. */
  private slipsAway(ctx: BotContext, id: number): boolean {
    return this.role.kind === 'operator' && (ctx.agent(id)?.team === 'guard' || !!this.temper?.shy || this.now < this.retreatUntil);
  }

  private isRoutine(state: BotState): boolean {
    return state === 'patrol' || state === 'loot' || state === 'extract' || state === 'hunt' || state === 'camp';
  }

  private routine(): BotState {
    if (this.role.kind !== 'operator') return 'patrol';
    // In Deathmatch there's no getting out: it hunts, and fetches supplies when short.
    if (this.supplies) return this.short && this.step < this.loot.length ? 'loot' : 'hunt';
    const run = this.born < 0 ? 0 : this.now - this.born;
    // Badly hurt or short of time, it leaves what it hasn't searched yet, unless it can't yet pay to get out.
    if (this.step < this.loot.length && !this.paid) return 'loot';
    if (this.step < this.planned && this.health >= WOUNDED && run < RUN_TIME - LEAVE_BY) return 'loot';
    // Hunters and campers stay on a while once done looting, but leave in time.
    const t = this.temper;
    // A camper stays on longer while sight is short; a hunter while rain is coming or in, to hunt under it.
    const rainy = this.personality === 'hunter' && (this.rain >= IN_COVER || this.seesComing('rain'));
    const linger = t ? t.linger + (this.personality === 'camper' ? CAMP_LINGER * (1 - this.sight) : 0) + (rainy ? RAIN_LINGER : 0) : 0;
    if (t && run < Math.min(linger, RUN_TIME - LEAVE_BY) && this.health >= WOUNDED) {
      if (this.personality === 'hunter') return 'hunt';
      if (this.personality === 'camper' && !this.campDone) return 'camp';
    }
    return 'extract';
  }

  private investigate(ctx: BotContext, at: Point): void {
    this.enter('investigate', true);
    const p = this.leashed(ctx, at);
    this.spot = standing(ctx, { x: p.x, y: at.y, z: p.z });
  }

  /**
   * Find a spot nearby that the threat, and anyone else lately shooting at or
   * seen by it, can't see into while crouched, and go there. `slip` is for an
   * operator getting away rather than fighting: it stays down longer.
   */
  private takeCover(ctx: BotContext, self: Agent, threat: Contact, slip = false): boolean {
    const now = ctx.time;
    this.lastCover = now;
    if (this.role.kind === 'sentry') {
      this.enter('cover', true);
      this.spot = { x: self.x, y: self.y, z: self.z };
      this.spotUntil = now + this.between(COVER_TIME);
      return true;
    }
    const threats: Contact[] = [threat];
    for (const c of this.contacts.values()) {
      if (c === threat || c.level < 1 || (now - c.seenAt > OUTGUNNED_MEMORY && now - c.threatAt > OUTGUNNED_MEMORY)) continue;
      threats.push(c);
    }
    threats.sort((a, b) => Math.hypot(a.x - self.x, a.z - self.z) - Math.hypot(b.x - self.x, b.z - self.z));
    const near = threats.slice(0, COVER_THREATS);
    // Guards bring more guards, and a fight it's outgunned in won't stay put: better get well away.
    const far = slip && (now < this.retreatUntil || near.some((t) => t.guard)) ? this.escapeFrom(ctx, self, near) : null;
    const best = far ?? this.coverFrom(ctx, self, near, BUSH_COVER);
    tally.covers++;
    if (!best) return false;
    if (best.bush) tally.bushCovers++;
    if (far) tally.flights++;
    this.enter('cover', true);
    this.spot = best;
    this.fleeing = !!far;
    const run = far ? Math.hypot(far.x - self.x, far.z - self.z) / WALK_SPEED : 0;
    this.spotUntil = now + run + this.between(slip ? SLIP_TIME : COVER_TIME);
    return true;
  }

  /**
   * Somewhere FLEE_RANGE off, away from `threats`, that none of them can see
   * into from where they are if there is one, and not toward an outpost.
   */
  private escapeFrom(ctx: BotContext, self: Agent, threats: Point[]): Spot | null {
    const w = ctx.world;
    let cx = 0;
    let cz = 0;
    for (const t of threats) (cx += t.x / threats.length), (cz += t.z / threats.length);
    const away = Math.atan2(self.x - cx, self.z - cz);
    const outpost = (x: number, z: number): number => (this.supplies ? OUTPOST_BERTH : Math.min(w.nearestOutpost(x, z)?.dist ?? Infinity, OUTPOST_BERTH));
    const from = outpost(self.x, self.z);
    let best: Spot | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 12; i++) {
      const a = away + (this.rand() - 0.5) * 2.4;
      const r = this.between(FLEE_RANGE);
      const p = ctx.nav.nearestWalkable(self.x + Math.sin(a) * r, self.z + Math.cos(a) * r, 8);
      if (!p || p.y !== undefined || !ctx.nav.dry(p.x, p.z)) continue;
      const y = w.groundHeight(p.x, p.z, w.floorHeight(p.x, p.z));
      const seen = threats.some((t) => w.hasLineOfSight(t.x, t.y + EYE_HEIGHT, t.z, p.x, y + CROUCH_EYE_HEIGHT, p.z));
      // Out of sight first, then away from the outposts and the threats.
      const score = (seen ? 100 : 0) + Math.max(0, from - outpost(p.x, p.z)) - Math.min(...threats.map((t) => Math.hypot(t.x - p.x, t.z - p.z))) * 0.3;
      if (score < bestScore) (best = { x: p.x, y, z: p.z }), (bestScore = score);
    }
    return best;
  }

  /**
   * The nearest spot, out to about `reach`, that none of `threats` can see
   * into while crouched, not much nearer the first of them: open ground behind
   * something solid, or a bush that hides a crouched body. Null if none.
   */
  private coverFrom(ctx: BotContext, self: Agent, threats: Point[], reach: number): Spot | null {
    const w = ctx.world;
    const veg = vegetationOf(w);
    const threat = threats[0];
    const away = Math.hypot(threat.x - self.x, threat.z - self.z);
    const hidden = (x: number, y: number, z: number, bush: boolean): boolean => {
      const h = bush ? hitboxes({ x, y, z, yaw: 0, duck: 1, lean: 0 }) : null;
      return threats.every((t) => {
        const ty = t.y + EYE_HEIGHT;
        if (Math.hypot(t.x - x, t.z - z) < 6) return false;
        if (!h) return !w.hasLineOfSight(t.x, ty, t.z, x, y + CROUCH_EYE_HEIGHT, z);
        const shows = (py: number): number => w.hasLineOfSight(t.x, ty, t.z, x, py, z) ? veg.seeThrough(t.x, ty, t.z, x, py, z) : 0;
        return shows(h.headY) < CONCEALED && shows((h.hipY + h.neckY) / 2) < CONCEALED;
      });
    };
    let best: Spot | null = null;
    let bestScore = Infinity;
    const turn = this.rand() * Math.PI * 2;
    const rings = Math.max(3, Math.round(reach / 4));
    for (let i = 0; i < 6 * rings; i++) {
      const a = turn + (i / (6 * rings)) * Math.PI * 2;
      const r = 2.5 + (i % rings) * ((reach - 2.5) / rings);
      const x = self.x + Math.sin(a) * r;
      const z = self.z + Math.cos(a) * r;
      if (!ctx.nav.dry(x, z)) continue;
      const score = r + Math.max(0, away - Math.hypot(threat.x - x, threat.z - z));
      if (score >= bestScore) continue;
      const y = w.groundHeight(x, z, w.floorHeight(x, z));
      if (!hidden(x, y, z, false)) continue;
      best = { x, y, z };
      bestScore = score;
    }
    for (const b of hidingBushes(w, self.x, self.z, reach)) {
      const score = Math.hypot(b.x - self.x, b.z - self.z) + Math.max(0, away - Math.hypot(threat.x - b.x, threat.z - b.z));
      if (score >= bestScore || !ctx.nav.dry(b.x, b.z) || !hidden(b.x, b.y, b.z, true)) continue;
      best = { x: b.x, y: b.y, z: b.z, bush: true };
      bestScore = score;
    }
    return best;
  }

  /** Circle around to where a lost target was last seen, from the side. */
  private flank(ctx: BotContext, self: Agent, c: Contact): boolean {
    if (this.role.kind === 'sentry' || this.rand() >= this.skill.flankChance) return false;
    const dx = self.x - c.x;
    const dz = self.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 10) return false;
    if (ctx.world.map) return this.flankInTown(ctx, self, c, d);
    const turn = (this.rand() < 0.5 ? -1 : 1) * (1 + this.rand() * 0.5);
    const r = clamp(d * 0.8, 12, 40);
    const x = c.x + ((dx * Math.cos(turn) - dz * Math.sin(turn)) / d) * r;
    const z = c.z + ((dx * Math.sin(turn) + dz * Math.cos(turn)) / d) * r;
    const p = ctx.nav.nearestWalkable(x, z);
    if (!p) return false;
    const spot = this.leashed(ctx, { x: p.x, y: c.y, z: p.z });
    this.enter('flank', true);
    this.spot = spot;
    return true;
  }

  /**
   * In a town, circling round means another street, or up: a spot off to
   * one side of the way it's looking now, near enough the target's last
   * known place, that sees it; sometimes a window or a roof over it.
   */
  private flankInTown(ctx: BotContext, self: Agent, c: Contact, d: number): boolean {
    const w = ctx.world;
    const at = { x: c.x, y: c.y, z: c.z };
    const post = this.rand() < WATCH_HIGH ? vantageOver(w, vantages(w), at, self, MAP_FLANK, [], this.rand) : null;
    let spot: Spot | null = post && Math.abs(angleDiff(yawToward(c.x, c.z, post.x, post.z), yawToward(c.x, c.z, self.x, self.z))) > 0.6
      ? { x: post.x, y: post.y, z: post.z, post: true } : null;
    for (let i = 0; i < 8 && !spot; i++) {
      const turn = (this.rand() < 0.5 ? -1 : 1) * (0.8 + this.rand() * 0.9);
      const r = MAP_FLANK[0] + this.rand() * (Math.min(d, MAP_FLANK[1]) - MAP_FLANK[0]);
      const a = yawToward(c.x, c.z, self.x, self.z) + turn;
      const p = ctx.nav.nearestWalkable(c.x - Math.sin(a) * r, c.z - Math.cos(a) * r, 4);
      if (!p || p.y !== undefined) continue;
      const y = w.groundHeight(p.x, p.z, w.floorHeight(p.x, p.z));
      if (!w.hasLineOfSight(p.x, y + EYE_HEIGHT, p.z, c.x, c.y + 1, c.z)) continue;
      spot = { x: p.x, y, z: p.z };
    }
    if (!spot) return false;
    if (post && spot.post) tally.posts++;
    this.enter('flank', true);
    this.spot = spot;
    return true;
  }

  /** A point pulled back to within a guard's leash. */
  private leashed(ctx: BotContext, p: Point): Point {
    const role = this.role;
    if (role.kind === 'operator' || role.kind === 'actor') return p;
    if (role.kind === 'sentry') return role.post;
    const anchor = role.home ?? this.anchor ?? role.route[0];
    const d = Math.hypot(p.x - anchor.x, p.z - anchor.z);
    if (d <= role.leash) return p;
    const x = anchor.x + ((p.x - anchor.x) / d) * role.leash;
    const z = anchor.z + ((p.z - anchor.z) / d) * role.leash;
    const w = ctx.nav.nearestWalkable(x, z);
    return w ? { x: w.x, y: p.y, z: w.z } : anchor;
  }

  private chooseWeapon(self: Agent, dist: number): void {
    const has = (w: number) => self.mag[w] + self.reserve[w] > 0;
    let w = this.primary;
    if (!has(w) || (w === BOLT && dist < BOLT_MIN_RANGE)) w = PISTOL;
    if (!has(w)) w = this.primary;
    this.weapon = w;
  }

  /** No friendly body between us and the target. */
  private lineClear(ctx: BotContext, self: Agent, target: Agent, dist: number): boolean {
    const eye = hitboxes(self);
    const h = hitboxes(target);
    const ty = (h.hipY + h.neckY) / 2;
    const dx = h.torsoX - eye.headX;
    const dy = ty - eye.headY;
    const dz = h.torsoZ - eye.headZ;
    const len = Math.hypot(dx, dy, dz) || 1;
    for (const a of ctx.agents) {
      if (a === self || a === target || a.dead || hostile(self, a)) continue;
      if (Math.abs(a.x - self.x) > dist + 1 || Math.abs(a.z - self.z) > dist + 1) continue;
      if (rayBody(a, eye.headX, eye.headY, eye.headZ, dx / len, dy / len, dz / len, len)) return false;
    }
    return true;
  }

  /** Glance about in the general direction `around`. */
  /** At a post a bot stands to look and drops below the sill for the last second before it looks elsewhere. */
  private ducksBetweenLooks(now: number): boolean {
    return this.glanceUntil - now < POST_DUCK;
  }

  private lookAround(now: number, around: number): void {
    if (now >= this.glanceUntil) {
      this.lookYaw = around + (this.rand() - 0.5) * 2.4;
      this.lookPitch = IDLE_PITCH + (this.rand() - 0.5) * 0.1;
      this.glanceUntil = now + 1.5 + this.rand() * 3;
    }
    this.focus = null;
    this.idleLook = true;
  }

  /** Head for `p`, on the floor at its height if it has one. */
  private goTo(p: Waypoint | null): void {
    this.goal = p ? (p.y === undefined ? { x: p.x, z: p.z } : { x: p.x, y: p.y, z: p.z }) : null;
    if (!p) {
      this.path = [];
      this.noPath = false;
    }
  }

  private checkStuck(self: Agent, dt: number): void {
    const moving = this.goal !== null || (this.state === 'engage' && this.strafe !== 0);
    if (!moving || self.mantling || (!this.noPath && Math.hypot(self.vx, self.vz) > 0.8)) {
      this.stuck = 0;
      return;
    }
    const before = this.stuck;
    this.stuck += dt;
    if (before < STUCK_JUMP && this.stuck >= STUCK_JUMP) this.jump = true;
    if (before < STUCK_REPATH && this.stuck >= STUCK_REPATH) {
      this.path = [];
      this.pathGoal = null;
      this.strafe = this.rand() < 0.5 ? -1 : 1;
    }
    if (this.stuck >= STUCK_GIVE_UP) {
      this.stuck = 0;
      this.giveUp();
    }
  }

  /** The current goal can't be reached: move on to the next thing. */
  private giveUp(): void {
    this.goTo(null);
    this.pathGoal = null;
    if (this.state === 'extract') {
      if (this.exit >= 0) this.unreachable.add(this.exit);
      this.exit = -1;
    } else if (this.state === 'camp') {
      // Look for another spot; after a few, just leave.
      this.campFor = -1;
      if (this.rand() < 0.4) this.campDone = true;
      this.enter(this.routine(), true);
    } else if (this.state === 'hunt') {
      this.spot = null;
    } else if (this.isRoutine(this.state)) {
      this.step++;
      this.waitUntil = 0;
      this.enter(this.routine());
    } else this.enter(this.routine());
  }

  // -------------------------------------------------------------- acting

  /** This tick's input commands, numbered on from `seq`. */
  commands(ctx: BotContext, self: Agent, seq: number): InputCmd[] {
    const cmds: InputCmd[] = [];
    for (let i = 0; i < CMDS_PER_TICK; i++) cmds.push(this.command(ctx, self, seq + i + 1, ctx.time + i * CMD_DT));
    return cmds;
  }

  private command(ctx: BotContext, self: Agent, seq: number, now: number): InputCmd {
    const s = this.skill;
    const a = this.target ? ctx.agent(this.target) : undefined;
    const c = this.target ? this.contacts.get(this.target) : undefined;
    const fighting = !!a && !!c && c.visible && !a.dead && this.state === 'engage';
    let buttons = 0;

    // Where to look: the target, a point of interest, the way ahead, or around.
    const dir = this.moveDir(ctx, self, a);
    const eye = hitboxes(self);
    let wantYaw = this.yaw;
    let wantPitch = IDLE_PITCH;
    let dist = 0;
    let aimYaw = 0;
    let aimPitch = 0;
    if (fighting) {
      const lag = s.trackLag;
      const h = hitboxes({ x: a.x - a.vx * lag, y: a.y, z: a.z - a.vz * lag, yaw: a.yaw, duck: a.duck, lean: a.lean });
      const head = this.aimHead || c.headOnly;
      const tx = head ? h.headX : h.torsoX;
      // Low on the torso, so that recoil climbs through it rather than over it.
      const ty = head ? h.headY : h.hipY + (h.neckY - h.hipY) * s.aimHeight;
      const tz = head ? h.headZ : h.torsoZ;
      dist = Math.hypot(tx - eye.headX, tz - eye.headZ);
      aimYaw = yawToward(eye.headX, eye.headZ, tx, tz);
      aimPitch = Math.atan2(ty - eye.headY, dist);
      const decay = Math.exp(-s.settle * CMD_DT);
      this.errYaw *= decay;
      this.errPitch *= decay;
      const t = now + this.wobblePhase;
      wantYaw = aimYaw + this.errYaw + (Math.sin(t * 1.7) + Math.sin(t * 3.1) * 0.5) * s.wobble - self.recoilYaw * s.recoilControl;
      wantPitch = aimPitch + this.errPitch + Math.sin(t * 2.3) * s.wobble - self.recoilPitch * s.recoilControl;
    } else if (this.focus) {
      wantYaw = yawToward(eye.headX, eye.headZ, this.focus.x, this.focus.z);
      wantPitch = Math.atan2(this.focus.y - eye.headY, Math.hypot(this.focus.x - eye.headX, this.focus.z - eye.headZ));
    } else if (dir && !this.idleLook) {
      wantYaw = Math.atan2(-dir.x, -dir.z);
    } else {
      wantYaw = this.lookYaw;
      wantPitch = this.lookPitch;
    }
    const turn = s.turnRate * CMD_DT;
    this.yaw += clamp(angleDiff(wantYaw, this.yaw) * TURN_GAIN, -turn, turn);
    this.pitch += clamp((wantPitch - this.pitch) * TURN_GAIN, -turn, turn);

    // Move with whichever keys point closest to the way we want to go.
    let sprint = false;
    if (dir) {
      const fwd = -Math.sin(this.yaw) * dir.x - Math.cos(this.yaw) * dir.z;
      const side = Math.cos(this.yaw) * dir.x - Math.sin(this.yaw) * dir.z;
      if (fwd > 0.38) buttons |= Btn.Forward;
      if (fwd < -0.38) buttons |= Btn.Back;
      if (side > 0.38) buttons |= Btn.Right;
      if (side < -0.38) buttons |= Btn.Left;
      sprint = this.pace === 'sprint' && !fighting && fwd > 0.7;
    }
    if (sprint) buttons |= Btn.Sprint;
    if (this.crouch || this.pace === 'sneak') buttons |= Btn.Crouch;
    if (this.jump) {
      this.jump = false;
      buttons |= Btn.Jump | Btn.Forward;
    }
    // Tapping presses for four commands and lets go for four.
    if (this.use === 'hold' || (this.use === 'tap' && (seq & 4) === 0)) buttons |= Btn.Interact;

    // Shooting.
    const w = WEAPONS[self.weapon];
    const ready = self.draw <= 0 && self.reload <= 0;
    if (fighting && ready && this.clearShot && now >= this.reactAt) {
      if (dist > ADS_RANGE) buttons |= Btn.Aim;
      const tol = Math.max(Math.atan(TARGET_WIDTH / Math.max(dist, 0.5)) * s.looseness, 0.004);
      const offYaw = angleDiff(this.yaw + self.recoilYaw, aimYaw);
      const offPitch = this.pitch + self.recoilPitch - aimPitch;
      const aligned = Math.hypot(offYaw, offPitch) < tol;
      if (w.auto) {
        if (this.burstEnd > 0 && now >= this.burstEnd) {
          this.burstEnd = 0;
          this.pauseUntil = now + this.between(s.burstPause) * (dist > 60 ? 1.6 : 1);
        }
        if (this.burstEnd === 0 && aligned && now >= this.pauseUntil) {
          const [lo, hi] = s.burst;
          const rounds = dist > 60 ? Math.min(lo, 3) : lo + Math.floor(this.rand() * (hi - lo + 1));
          this.burstEnd = now + (rounds - 0.5) * w.interval;
        }
        if (this.burstEnd > 0) buttons |= Btn.Fire;
      } else if (aligned && now >= this.nextTap && !self.triggerHeld && (self.weapon !== BOLT || self.aim > 0.85)) {
        buttons |= Btn.Fire;
        this.nextTap = now + w.interval + s.tapDelay * (0.6 + this.rand() * 0.8);
      }
    } else if (fighting && ready && dist > ADS_RANGE) {
      buttons |= Btn.Aim;
    } else {
      this.burstEnd = 0;
    }
    if (self.mag[self.weapon] === 0 && self.reserve[self.weapon] > 0) buttons |= Btn.Reload;
    if (this.reloadWanted && !fighting) {
      buttons |= Btn.Reload;
      this.reloadWanted = false;
    }
    // Firing or aiming stops a sprint in the simulation; don't also hold it.
    if (buttons & (Btn.Fire | Btn.Aim)) buttons &= ~Btn.Sprint;

    return { seq, buttons, yaw: this.yaw, pitch: this.pitch, weapon: this.weapon };
  }

  /** Unit direction to move in this command, or null to stand still. */
  private moveDir(ctx: BotContext, self: Agent, target: Agent | undefined): Waypoint | null {
    if (this.goal) {
      const g = this.goal;
      const pg = this.pathGoal;
      const now = ctx.time;
      // Sneaking, or a sneaky operator going about its run, keeps to bushes and tall grass; in fog it needn't.
      const hidden = this.pace === 'sneak' || (!!this.temper?.sneaky && this.isRoutine(this.state) && !this.fogMoves());
      const stale = !pg || Math.hypot(pg.x - g.x, pg.z - g.z) > 1.5 || Math.abs((pg.y ?? 0) - (g.y ?? 0)) > 1.5 || this.path.length === 0 ||
        hidden !== this.pathHidden;
      if (stale && now - this.pathAt >= REPATH_DELAY && ctx.pathBudget > 0) {
        ctx.pathBudget--;
        this.pathAt = now;
        this.pathGoal = g;
        this.pathHidden = hidden;
        if (hidden) tally.hiddenPaths++;
        this.path = ctx.nav.findPath(self.x, self.z, g.x, g.z, self.y, g.y, hidden) ?? [];
        this.noPath = this.path.length === 0;
      }
      while (this.path.length > 1 && reached(this.path[0], self.x, self.y, self.z)) this.path.shift();
      const next = this.path[0];
      if (!next) return null;
      const dx = next.x - self.x;
      const dz = next.z - self.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) return null;
      return { x: dx / d, z: dz / d };
    }
    if (this.state === 'engage' && target && this.strafe !== 0) {
      const dx = target.x - self.x;
      const dz = target.z - self.z;
      const d = Math.hypot(dx, dz) || 1;
      // Back away when too close, else sidestep across the line of fire.
      if (this.strafe === 2) return { x: -dx / d, z: -dz / d };
      const sx = (-dz / d) * this.strafe;
      const sz = (dx / d) * this.strafe;
      if (!ctx.nav.dry(self.x + sx * 1.5, self.z + sz * 1.5)) {
        this.strafe = -this.strafe;
        return null;
      }
      return { x: sx, z: sz };
    }
    return null;
  }

  private contact(id: number, a: Agent): Contact {
    let c = this.contacts.get(id);
    if (!c) {
      c = { level: 0, visible: false, headOnly: false, x: a.x, y: a.y, z: a.z, seenAt: -Infinity, since: 0, threatAt: -Infinity, guard: a.team === 'guard' };
      this.contacts.set(id, c);
    }
    return c;
  }

  private between([lo, hi]: [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }
}

/** How far a spot is to get to: up or down too, for a post. */
function spotAway(spot: Spot, self: Agent): number {
  return spot.post ? away(spot, self) : Math.hypot(spot.x - self.x, spot.z - self.z);
}

/** How close to a spot counts as there: in a bush or at a post, near its middle. */
function arrival(spot: Spot, near: number): number {
  return spot.bush ? IN_BUSH : spot.post ? POST_ARRIVE : near;
}

/**
 * Where someone would stand to be at `p`, such as where a shot was heard
 * from at the shooter's eye: on the floor it's over, upstairs or down.
 */
function standing(ctx: BotContext, p: Point): Point {
  const w = ctx.nav.nearestWalkable(p.x, p.z, 3, p.y);
  if (!w) return p;
  return { x: w.x, y: w.y ?? ctx.world.groundHeight(w.x, w.z, ctx.world.floorHeight(w.x, w.z)), z: w.z };
}

/** The point `u` of the way across `b` along x and `v` along z. */
function within(b: Rect, u: number, v: number): [number, number] {
  return [b.minX + (b.maxX - b.minX) * u, b.minZ + (b.maxZ - b.minZ) * v];
}

/** How far a place is to get to, across the ground, and up or down if it's on another floor. */
function away(p: Point, self: Agent): number {
  const d = Math.hypot(p.x - self.x, p.z - self.z);
  const up = Math.abs(p.y - self.y);
  return up > OTHER_FLOOR ? d + up : d;
}

/** Bushes within `r` of (x, z) tall enough to hide someone crouched in them. */
function hidingBushes(world: World, x: number, z: number, r: number): Bush[] {
  const veg = vegetationOf(world);
  const out: Bush[] = [];
  for (let iz = Math.floor((z - r) / VEG_CELL); iz <= Math.floor((z + r) / VEG_CELL); iz++) {
    for (let ix = Math.floor((x - r) / VEG_CELL); ix <= Math.floor((x + r) / VEG_CELL); ix++) {
      for (const b of veg.bushes(ix, iz)) if (b.height >= HIDING_BUSH && Math.hypot(b.x - x, b.z - z) <= r) out.push(b);
    }
  }
  return out;
}
