import {
  Btn,
  CMD_DT,
  CMDS_PER_TICK,
  CROUCH_EYE_HEIGHT,
  CROUCH_SPEED,
  EXTRACT_RADIUS,
  EYE_HEIGHT,
  WALK_SPEED,
} from '../shared/constants.ts';
import { angleDiff, clamp, yawToward } from '../shared/geom.ts';
import { hitboxes, rayBody } from '../shared/hitbox.ts';
import { ITEMS } from '../shared/loot.ts';
import type { Senses } from '../shared/conditions.ts';
import type { InputCmd, LootView, Team } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { PISTOL, spawnWeapons, WEAPONS, BOLT } from '../shared/weapons.ts';
import { vegetationOf } from '../shared/vegetation.ts';
import type { Point, World } from '../shared/world.ts';
import type { ExtractPoint } from './extracts.ts';
import type { NavGrid, Waypoint } from './nav.ts';
import type { Skill } from './skill.ts';

// A bot is a player without a keyboard. It perceives the world through the
// same senses for everyone (sight limited by range, view cone, cover, the dark
// and the weather; hearing of footsteps, gunfire and rounds passing close),
// decides what to do
// with a small state machine, and acts only by producing input commands that
// the server simulates exactly like a human's.

/** Anyone in the game, as a bot sees them. */
export interface Agent extends PlayerState {
  readonly id: number;
  team: Team;
  /** Their flashlight is on. */
  light?: boolean;
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
  // Plays a run: search the crate at each loot spot, taking what it can carry
  // up to `greed` kg, then leave at the nearest open extraction point.
  | { kind: 'operator'; loot: LootSpot[]; greed: number };

export interface LootSpot extends Point {
  /** What to look at while searching, such as the crate. */
  look: Point;
}

export type BotState = 'patrol' | 'loot' | 'extract' | 'investigate' | 'engage' | 'cover' | 'flank';

/** Something heard: a shot, a friend's callout, footsteps. */
export interface Noise extends Point {
  radius: number;
  /** Who made it. */
  source: number;
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
  /** How far the time of day and the weather let everyone see and hear. */
  senses: Senses;
}

/** Whether a would shoot b. Operators are each on their own side; guards stick together. */
export function hostile(a: Agent, b: Agent): boolean {
  if (a === b) return false;
  return a.team === 'operator' || a.team !== b.team;
}

/** Seconds a target can be out of sight before an engaged bot goes looking. */
const LOST_TIME = 1.6;
/** A target this close is noticed even outside the view cone. */
const TOUCH_RANGE = 3;
/** Below this much showing through bushes and grass, a target is hidden. */
const CONCEALED = 0.3;
/** Sight range multiple for crouched targets. */
const CROUCH_SIGHT = 0.65;
/** Awareness lost per second by a half-noticed target out of sight. */
const AWARENESS_DECAY = 0.25;
/**
 * In the dark a lit flashlight shows from this many times the sight range for
 * someone unlit, up to the range the weather allows; a muzzle flash does too.
 * Someone in a bot's own beam this close is seen as if by day.
 */
const LIGHT_REACH = 2.5;
const BEAM_RANGE = 40;
/** Half-angle of a flashlight's beam, radians. */
export const BEAM_ANGLE = 0.3;
/** Operator bots switch their flashlight off this close to an outpost, and whenever they aren't just going about their run. */
const OPERATOR_DARK = 110;
/** Footstep hearing ranges: sprinting and walking. Crouch-walking is silent. */
const STEPS_SPRINT = 22;
const STEPS_WALK = 9;
/**
 * How far operators and guards go out of their way to check on a noise. Operators
 * mostly keep clear of other people's fights; only what is right next to them draws them in.
 */
const OPERATOR_CURIOSITY = 25;
const GUARD_CURIOSITY = 110;
/**
 * Operators leave guards alone beyond this range unless the guard has shot at
 * them lately: a fight at an outpost brings the whole outpost down on them.
 */
const OPERATOR_GUARD_RANGE = 40;
/** Seconds a shooter stays a threat to be fought back. */
const THREAT_TIME = 10;
/** Operators going about their run walk rather than sprint this close to an outpost, and sneak closer in. */
const OUTPOST_WALK = 110;
const OUTPOST_SNEAK = 55;
/** Operators route around outposts they aren't going to, this far out. */
const OUTPOST_BERTH = 95;
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
const WAYPOINT_REACHED = 0.6;
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
  private spot: Point | null = null;
  private spotUntil = 0;
  private heard: (Point & { at: number }) | null = null;
  private hurtAt = -Infinity;
  private hurtHandled = true;
  private lastCover = -Infinity;
  /** Where it last was during its routine; guards without a home stay leashed to it. */
  private anchor: Point | null = null;
  /** Extraction point it's heading for, and those it couldn't reach. */
  private exit = -1;
  private readonly unreachable = new Set<number>();

  constructor(role: Role, skill: Skill, primary: number, yaw: number, rand: () => number) {
    this.role = role;
    this.skill = skill;
    this.primary = primary;
    this.weapon = primary;
    this.yaw = this.lookYaw = yaw;
    this.rand = rand;
    this.wobblePhase = rand() * 100;
    this.state = this.routine();
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
    const fuzz = d * 0.08;
    this.heard = {
      x: noise.x + (this.rand() - 0.5) * 2 * fuzz,
      y: noise.y,
      z: noise.z + (this.rand() - 0.5) * 2 * fuzz,
      at: now,
    };
  }

  /** A round from `shooter` passed close or hit nearby. */
  underFire(shooter: Agent, now: number): void {
    const c = this.contact(shooter.id, shooter);
    c.level = Math.max(c.level, 0.7);
    c.threatAt = now;
    this.heard = { x: shooter.x, y: shooter.y, z: shooter.z, at: now };
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
    if (this.isRoutine(this.state)) this.anchor = { x: self.x, y: self.y, z: self.z };
    this.perceive(ctx, self, dt);
    this.decide(ctx, self);
    this.behave(ctx, self);
    this.checkStuck(self, dt);
  }

  private perceive(ctx: BotContext, self: Agent, dt: number): void {
    const now = ctx.time;
    const eye = hitboxes(self);
    const s = this.skill;
    for (const a of ctx.agents) {
      if (a.dead || !hostile(self, a)) continue;
      const d = Math.hypot(a.x - self.x, a.z - self.z);
      // In the dark, a light or a muzzle flash gives someone away from far off,
      // and anyone in a bot's own beam is as plain as by day.
      const flash = a.sinceShot < 1 && !a.suppressed[a.weapon];
      const senses = ctx.senses;
      const lit = senses.dark && (a.light || flash);
      const beamed = senses.dark && !!self.light && d < BEAM_RANGE &&
        Math.abs(angleDiff(yawToward(self.x, self.z, a.x, a.z), this.yaw)) < BEAM_ANGLE;
      const range = lit
        ? s.sight * Math.min(senses.sight * LIGHT_REACH, senses.haze)
        : s.sight * (beamed ? senses.haze : senses.sight) * (a.duck > 0.5 ? CROUCH_SIGHT : 1);
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
          // A muzzle flash or a flashlight shows through leaves, unless the shot's suppressed.
          // So does anyone close enough to touch.
          if (shows >= CONCEALED || (shows > 0 && (flash || lit || d < TOUCH_RANGE))) {
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
        // A muzzle flash gives a shooter away, unless it's suppressed; so does a light in the dark.
        if (flash) time *= 0.3;
        else if (lit) time *= 0.5;
        if (off > s.fov * 0.3) time *= 1.5;
        const was = c.level;
        c.level = Math.min(c.level + dt / time, 1);
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
      const loud = !a.onGround ? 0 : speed > WALK_SPEED + 0.5 ? STEPS_SPRINT : speed > CROUCH_SPEED + 0.3 ? STEPS_WALK : 0;
      if (d < loud * senses.hearing) this.heard = { x: a.x, y: a.y, z: a.z, at: now };
    }
    for (const id of this.contacts.keys()) {
      const a = ctx.agent(id);
      if (!a || a.dead) this.contacts.delete(id);
    }
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
      const score = Math.hypot(c.x - self.x, c.z - self.z) - (id === this.target ? 15 : 0);
      if (score < bestScore) (best = entry), (bestScore = score);
    }
    const hurt = !this.hurtHandled && now - this.hurtAt < 0.6;
    this.hurtHandled = true;

    if (best) {
      const [id, c] = best;
      const d = Math.hypot(c.x - self.x, c.z - self.z);
      if (id !== this.target) this.acquire(id, d, now);
      else if (c.since === now) this.reactAt = Math.max(this.reactAt, now + this.skill.reaction * 0.5);
      if (this.state === 'cover' && now < this.spotUntil) return;
      const empty = self.mag[self.weapon] === 0 && self.reserve[self.weapon] > 0 && d > 10;
      // Operators always break off from guards once hurt: there are more where that one came from.
      const duck = this.slipsAway(ctx, id) || this.rand() < this.skill.coverChance;
      const wantCover = (empty || (hurt && self.hp < 70 && duck)) && now - this.lastCover > COVER_COOLDOWN;
      if (wantCover && this.takeCover(ctx, self, c)) return;
      this.enter('engage');
      return;
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

    if (this.heard && this.heard.at >= this.stateAt && this.state !== 'engage') {
      const h = this.heard;
      this.heard = null;
      const d = Math.hypot(h.x - self.x, h.z - self.z);
      if (d > (this.role.kind === 'operator' ? OPERATOR_CURIOSITY : GUARD_CURIOSITY)) return;
      this.investigate(ctx, h);
    }
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
        if (role.kind === 'sentry') {
          this.goTo(null);
          this.lookAround(now, role.post.yaw);
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
        const spot = role.loot[this.step];
        if (!spot) {
          this.enter('extract');
          break;
        }
        const d = Math.hypot(spot.x - self.x, spot.z - self.z);
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
        else if (!view || !view.searched) this.use = 'hold';
        else if (next !== undefined && (ITEMS[next].use || self.carry + ITEMS[next].mass <= role.greed)) this.use = 'tap';
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

      case 'investigate': {
        const spot = this.spot!;
        const d = Math.hypot(spot.x - self.x, spot.z - self.z);
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
        if (now >= this.strafeUntil) {
          const r = this.rand();
          this.strafe = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
          this.strafeUntil = now + 0.6 + this.rand() * 1;
          this.crouch = this.skill.name !== 'easy' && d > 25 && this.rand() < 0.35;
        }
        if (d < TOO_CLOSE) this.strafe = 2;
        break;
      }

      case 'cover': {
        const spot = this.spot!;
        const c = this.contacts.get(this.target);
        if (c) this.focus = { x: c.x, y: c.y + EYE_HEIGHT, z: c.z };
        if (Math.hypot(spot.x - self.x, spot.z - self.z) > ARRIVE) {
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
        const d = Math.hypot(spot.x - self.x, spot.z - self.z);
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
    if (len < 1) return goal;
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

  /** How an operator crosses the island `d` metres from where it's going: fast in the open, quietly near outposts. */
  private travel(ctx: BotContext, self: Agent, d: number): void {
    const near = ctx.world.nearestOutpost(self.x, self.z)?.dist ?? Infinity;
    if (near < OUTPOST_SNEAK && d > ARRIVE * 3) this.pace = 'sneak';
    else if (d > 30 && self.stamina > 0.4 && near > OUTPOST_WALK) this.pace = 'sprint';
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
      const d = Math.hypot(e.x - self.x, e.z - self.z) + (e.open ? 0 : 400) - (i === this.exit ? 20 : 0);
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
    this.path = [];
    this.pathGoal = null;
  }

  /**
   * Whether to fight a spotted enemy. Guards always do. Operators fight back
   * when shot at, and otherwise only pick fights they can win quickly: other
   * operators within their gun's range, and guards up close.
   */
  private picksFight(ctx: BotContext, self: Agent, id: number, c: Contact, now: number): boolean {
    if (this.role.kind !== 'operator' || now - c.threatAt < THREAT_TIME) return true;
    const range = ctx.agent(id)?.team === 'guard' ? OPERATOR_GUARD_RANGE : EFFECTIVE_RANGE[this.primary];
    return Math.hypot(c.x - self.x, c.z - self.z) <= range;
  }

  /** An operator facing a guard: it would rather get away than win. */
  private slipsAway(ctx: BotContext, id: number): boolean {
    return this.role.kind === 'operator' && ctx.agent(id)?.team === 'guard';
  }

  /**
   * Guards keep their flashlights on all night; at dusk it's still light enough to go without. Operators light their way
   * across the open island but go dark near outposts and once anything happens.
   */
  private wantsLight(ctx: BotContext, self: Agent): boolean {
    if (!ctx.senses.night) return false;
    if (this.role.kind !== 'operator') return true;
    if (!this.isRoutine(this.state)) return false;
    return ctx.world.outposts.every((o) => Math.hypot(o.x - self.x, o.z - self.z) > OPERATOR_DARK);
  }

  private isRoutine(state: BotState): boolean {
    return state === 'patrol' || state === 'loot' || state === 'extract';
  }

  private routine(): BotState {
    if (this.role.kind !== 'operator') return 'patrol';
    return this.step < this.role.loot.length ? 'loot' : 'extract';
  }

  private investigate(ctx: BotContext, at: Point): void {
    this.enter('investigate', true);
    const p = this.leashed(ctx, at);
    this.spot = { x: p.x, y: at.y, z: p.z };
  }

  /** Find a spot nearby that the threat can't see into while crouched, and go there. */
  private takeCover(ctx: BotContext, self: Agent, threat: Point): boolean {
    const now = ctx.time;
    this.lastCover = now;
    if (this.role.kind === 'sentry') {
      this.enter('cover', true);
      this.spot = { x: self.x, y: self.y, z: self.z };
      this.spotUntil = now + this.between(COVER_TIME);
      return true;
    }
    const w = ctx.world;
    const eyeY = threat.y + EYE_HEIGHT;
    const away = Math.hypot(threat.x - self.x, threat.z - self.z);
    let best: Point | null = null;
    let bestScore = Infinity;
    const turn = this.rand() * Math.PI * 2;
    for (let i = 0; i < 18; i++) {
      const a = turn + (i / 18) * Math.PI * 2;
      const r = 2.5 + (i % 3) * 3.5;
      const x = self.x + Math.sin(a) * r;
      const z = self.z + Math.cos(a) * r;
      if (!ctx.nav.dry(x, z)) continue;
      const dT = Math.hypot(threat.x - x, threat.z - z);
      if (dT < 6) continue;
      const y = w.groundHeight(x, z, w.floorHeight(x, z));
      if (w.hasLineOfSight(threat.x, eyeY, threat.z, x, y + CROUCH_EYE_HEIGHT, z)) continue;
      const score = r + Math.max(0, away - dT);
      if (score < bestScore) (best = { x, y, z }), (bestScore = score);
    }
    if (!best) return false;
    this.enter('cover', true);
    this.spot = best;
    this.spotUntil = now + this.between(COVER_TIME);
    return true;
  }

  /** Circle around to where a lost target was last seen, from the side. */
  private flank(ctx: BotContext, self: Agent, c: Contact): boolean {
    if (this.role.kind === 'sentry' || this.rand() >= this.skill.flankChance) return false;
    const dx = self.x - c.x;
    const dz = self.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 10) return false;
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

  /** A point pulled back to within a guard's leash. */
  private leashed(ctx: BotContext, p: Point): Point {
    const role = this.role;
    if (role.kind === 'operator') return p;
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
  private lookAround(now: number, around: number): void {
    if (now >= this.glanceUntil) {
      this.lookYaw = around + (this.rand() - 0.5) * 2.4;
      this.lookPitch = IDLE_PITCH + (this.rand() - 0.5) * 0.1;
      this.glanceUntil = now + 1.5 + this.rand() * 3;
    }
    this.focus = null;
    this.idleLook = true;
  }

  private goTo(p: Waypoint | null): void {
    this.goal = p ? { x: p.x, z: p.z } : null;
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
      const ty = head ? h.headY : h.hipY + (h.neckY - h.hipY) * 0.35;
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
    if (this.wantsLight(ctx, self)) buttons |= Btn.Light;

    return { seq, buttons, yaw: this.yaw, pitch: this.pitch, weapon: this.weapon };
  }

  /** Unit direction to move in this command, or null to stand still. */
  private moveDir(ctx: BotContext, self: Agent, target: Agent | undefined): Waypoint | null {
    if (this.goal) {
      const g = this.goal;
      const pg = this.pathGoal;
      const now = ctx.time;
      const stale = !pg || Math.hypot(pg.x - g.x, pg.z - g.z) > 1.5 || this.path.length === 0;
      if (stale && now - this.pathAt >= REPATH_DELAY && ctx.pathBudget > 0) {
        ctx.pathBudget--;
        this.pathAt = now;
        this.pathGoal = g;
        this.path = ctx.nav.findPath(self.x, self.z, g.x, g.z) ?? [];
        this.noPath = this.path.length === 0;
      }
      while (this.path.length > 1 && Math.hypot(this.path[0].x - self.x, this.path[0].z - self.z) < WAYPOINT_REACHED) this.path.shift();
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

  private contact(id: number, a: Point): Contact {
    let c = this.contacts.get(id);
    if (!c) {
      c = { level: 0, visible: false, headOnly: false, x: a.x, y: a.y, z: a.z, seenAt: -Infinity, since: 0, threatAt: -Infinity };
      this.contacts.set(id, c);
    }
    return c;
  }

  private between([lo, hi]: [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }
}
