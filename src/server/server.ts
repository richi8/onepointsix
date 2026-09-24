import {
  BODY_TIME,
  CARRY_MAX,
  CMD_DT,
  GUARD_RESPAWN,
  MAX_CMDS_PER_TICK,
  MAX_REWIND,
  OPERATOR_REFILL,
  PLAYER_HEIGHT,
  RESPAWN_TIME,
  SERVER_DT,
  SERVER_TICK_RATE,
  SPAWN_PROTECTION,
} from '../shared/constants.ts';
import { angleDiff, clamp, lerp } from '../shared/geom.ts';
import { rayBody, type Pose, type Zone } from '../shared/hitbox.ts';
import type { ClientMsg, GameEvent, InputCmd, PlayerSnap, ServerMsg, Team } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { applyCmd, copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import { damageAt, WEAPONS, type Shot } from '../shared/weapons.ts';
import { World, type Point } from '../shared/world.ts';
import { Bot, hostile, type Agent, type BotContext, type Noise } from './bot.ts';
import { NavGrid } from './nav.ts';
import { planGuards, planOperator, type BotPlan } from './population.ts';
import { dummyCmds, layoutRange, type DummyKind, type Post, type RangeLayout } from './range.ts';
import { SKILLS } from './skill.ts';

/** Commands buffered beyond this are dropped; the client is too far ahead. */
const MAX_QUEUED_CMDS = MAX_CMDS_PER_TICK * 4;
const HISTORY_TICKS = Math.ceil(MAX_REWIND * SERVER_TICK_RATE) + 2;
/** Humans spawn spread sideways across the range origin by up to this much. */
const SPAWN_SPREAD = 3;
/** Bots think every this many ticks, staggered so only some think each tick. */
const THINK_TICKS = 3;
/** Path searches all bots together may start per tick. */
const PATH_BUDGET = 6;
/** Guards this close to one who spots an enemy hear the callout. */
const CALLOUT_RANGE = 60;

interface Player extends PlayerState {
  id: number;
  name: string;
  team: Team;
  send: (msg: ServerMsg) => void;
  /** Set once the client says hello; until then it gets no snapshots. */
  joined: boolean;
  queue: InputCmd[];
  /** Highest seq received, to discard redundant resends. */
  lastRecv: number;
  /** Highest seq simulated, echoed back as the snapshot ack. */
  lastSim: number;
  /** Seconds until respawning, while dead. */
  respawn: number;
  /** Seconds of spawn protection left. */
  protection: number;
  /** Events to send this tick. */
  events: GameEvent[];
  /** Set for target dummies: where they stand and how they move. */
  dummy: (Post & { kind: DummyKind; index: number }) | null;
  /** Set for bots: the plan it was made from, and the bot for its current life. */
  plan: BotPlan | null;
  bot: Bot | null;
}

interface PoseRecord extends Pose {
  id: number;
  dead: boolean;
  life: number;
}

export interface ServerOptions {
  /** Populate the shooting range with target dummies (default true). */
  dummies?: boolean;
  /** Post guards at the outposts and send patrols between them (default false). */
  guards?: boolean;
  /** Operator slots, filled by bots where no player takes them (default 0, no operator bots). */
  operators?: number;
}

/**
 * The authoritative game. It knows nothing about Workers or sockets: a host
 * calls connect/receive/disconnect and drives tick() at SERVER_TICK_RATE.
 */
export class GameServer {
  readonly seed: number;
  readonly world: World;
  readonly range: RangeLayout;
  readonly nav: NavGrid;
  tick = 0;
  /** Hears everything sent to everyone: kills and extractions. */
  onEvent: ((e: GameEvent) => void) | null = null;
  private readonly players = new Map<number, Player>();
  private readonly spawnRng: () => number;
  private readonly botRng: () => number;
  private readonly operatorSlots: number;
  /** When each operator slot emptied by a bot leaving gets filled again, soonest first. */
  private readonly refills: number[] = [];
  private readonly ctx: BotContext;
  /** Where everyone stood at the end of each recent tick, oldest first, for rewinding shots. */
  private readonly history: { tick: number; poses: PoseRecord[] }[] = [];
  private nextId = 1;

  constructor(seed: number, options: ServerOptions = {}) {
    this.seed = seed >>> 0;
    this.world = new World(this.seed);
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
    this.botRng = mulberry32(this.seed ^ 0x68e31da4);
    this.range = layoutRange(this.world, mulberry32(this.seed ^ 0x2545f491));
    this.nav = new NavGrid(this.world);
    this.operatorSlots = options.operators ?? 0;
    const players = this.players;
    this.ctx = {
      world: this.world,
      nav: this.nav,
      time: 0,
      agents: { [Symbol.iterator]: () => players.values() },
      agent: (id) => players.get(id),
      pathBudget: 0,
      callout: (from, at) => this.callout(from, at),
    };
    if (options.dummies ?? true) {
      this.range.dummies.forEach((post, index) => {
        const p = this.add(`Dummy ${index + 1}`, 'dummy', () => {});
        p.joined = true;
        p.dummy = { ...post, index };
        this.spawn(p);
      });
    }
    if (options.guards) {
      const plans = planGuards(this.world, this.nav, this.botRng);
      const ids = plans.map((plan) => this.addBot(plan, 'guard').id);
      // Bots share their plan's role, so followers learn their leader's id here.
      for (const plan of plans) if (plan.follows !== undefined && plan.role.kind === 'guard') plan.role.leader = ids[plan.follows];
    }
    while (this.operatorCount() < this.operatorSlots) this.addOperatorBot();
  }

  connect(send: (msg: ServerMsg) => void): number {
    const p = this.add('player', 'operator', send);
    this.spawn(p);
    return p.id;
  }

  disconnect(id: number): void {
    this.players.delete(id);
  }

  receive(id: number, msg: ClientMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'hello':
        p.joined = true;
        p.name = msg.name.slice(0, 24) || 'player';
        p.send({ t: 'welcome', id, seed: this.seed, tick: this.tick, tickRate: SERVER_TICK_RATE });
        break;
      case 'ping':
        p.send({ t: 'pong', time: msg.time });
        break;
      case 'input':
        if (!p.joined) break;
        for (const cmd of msg.cmds) {
          if (cmd.seq <= p.lastRecv) continue;
          p.lastRecv = cmd.seq;
          p.queue.push(cmd);
        }
        if (p.queue.length > MAX_QUEUED_CMDS) p.queue.splice(0, p.queue.length - MAX_QUEUED_CMDS);
        break;
      case 'debug':
        p.carry = clamp(msg.carry, 0, CARRY_MAX) || 0;
        break;
    }
  }

  /** Bots in the game, for tests and debugging. */
  bots(): { id: number; name: string; team: Team; bot: Bot; state: PlayerState }[] {
    return [...this.players.values()].filter((p) => p.bot).map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot!, state: p }));
  }

  step(): void {
    this.tick++;
    const ctx = this.ctx;
    ctx.time = this.tick * SERVER_DT;
    ctx.pathBudget = PATH_BUDGET;
    for (const p of this.players.values()) {
      if (p.bot && !p.dead) {
        if ((this.tick + p.id) % THINK_TICKS === 0) p.bot.think(ctx, p, THINK_TICKS * SERVER_DT);
        p.queue.push(...p.bot.commands(ctx, p, p.lastSim));
      }
      if (p.dummy) p.queue.push(...dummyCmds(p.dummy, p.dummy.index, this.tick, p.lastSim));
      const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
      for (let i = 0; i < n; i++) {
        const cmd = p.queue[i];
        applyCmd(this.world, p, cmd, CMD_DT, (fx) => {
          if (fx.k === 'shot') this.fire(p, fx.shot, cmd.view);
        });
        p.lastSim = cmd.seq;
      }
      p.queue.splice(0, n);
    }

    for (const p of [...this.players.values()]) {
      p.protection = Math.max(p.protection - SERVER_DT, 0);
      if (p.bot?.extracted) {
        this.broadcast({ k: 'extract', id: p.id, name: p.name, carry: Math.round(p.carry) });
        this.leave(p);
        continue;
      }
      if (!p.dead) continue;
      p.respawn -= SERVER_DT;
      if (p.respawn > 0) continue;
      // A fallen operator bot's run is over; a guard is replaced at its post.
      if (p.team === 'operator' && p.plan) this.leave(p);
      else this.spawn(p);
    }
    while (this.refills.length && ctx.time >= this.refills[0]) {
      this.refills.shift();
      if (this.operatorCount() < this.operatorSlots) this.addOperatorBot();
    }

    this.history.push({ tick: this.tick, poses: [...this.players.values()].map(poseOf) });
    if (this.history.length > HISTORY_TICKS) this.history.shift();

    const joined = [...this.players.values()].filter((p) => p.joined);
    const players: PlayerSnap[] = joined.map(({ id, team, x, y, z, yaw, duck, lean, dead, weapon }) => (
      { id, team, x, y, z, yaw, duck, lean, dead, weapon }
    ));
    for (const p of joined) {
      p.send({ t: 'snapshot', tick: this.tick, ack: p.lastSim, you: copyState(p), players });
      if (p.events.length) p.send({ t: 'events', tick: this.tick, events: p.events });
      p.events = [];
    }
  }

  private add(name: string, team: Team, send: (msg: ServerMsg) => void): Player {
    const p: Player = {
      ...spawnState(0, 0, 0), id: this.nextId++, name, team, send, joined: false, queue: [], lastRecv: 0, lastSim: 0,
      respawn: 0, protection: 0, events: [], dummy: null, plan: null, bot: null,
    };
    this.players.set(p.id, p);
    return p;
  }

  private addBot(plan: BotPlan, team: Team): Player {
    const p = this.add(plan.name, team, () => {});
    p.joined = true;
    p.plan = plan;
    this.spawn(p);
    return p;
  }

  /** A new operator bot drops in somewhere quiet. */
  private addOperatorBot(): void {
    const others = [...this.players.values()].filter((p) => p.team === 'operator' && !p.dead);
    const taken = new Set(others.map((p) => p.name));
    const avoid: Point[] = [...others, this.range.origin];
    this.addBot(planOperator(this.world, this.nav, this.botRng, avoid, taken), 'operator');
  }

  /** Players and bots taking operator slots. */
  private operatorCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.team === 'operator') n++;
    return n;
  }

  /** A bot leaves the game; its slot opens up for a new one after a while. */
  private leave(p: Player): void {
    this.players.delete(p.id);
    if (p.team === 'operator') this.refills.push(this.tick * SERVER_DT + OPERATOR_REFILL);
  }

  /** (Re)spawn a player with full health and ammo: dummies and bots at their post, humans at the range. */
  private spawn(p: Player): void {
    let post: Post & { pitch?: number };
    if (p.dummy) post = p.dummy;
    else if (p.plan) post = p.plan.spawn;
    else {
      const o = this.range.origin;
      const side = (this.spawnRng() * 2 - 1) * SPAWN_SPREAD;
      const x = o.x + Math.cos(o.yaw) * side;
      const z = o.z - Math.sin(o.yaw) * side;
      const y = this.world.groundHeight(x, z, o.y + 1);
      post = this.world.fits(x, y, z, PLAYER_HEIGHT) ? { x, y, z, yaw: o.yaw, pitch: o.pitch } : o;
    }
    const carry = p.plan ? 0 : p.carry;
    Object.assign(p, spawnState(post.x, post.y, post.z), { yaw: post.yaw, pitch: post.pitch ?? 0, carry, life: p.life + 1 });
    p.respawn = 0;
    p.protection = p.dummy || p.plan ? 0 : SPAWN_PROTECTION;
    p.queue = [];
    if (p.plan) {
      const { role, skill, primary } = p.plan;
      p.bot = new Bot(role, SKILLS[skill], primary, post.yaw, mulberry32((this.seed ^ Math.imul(p.id, 0x9e3779b1) ^ p.life) >>> 0));
      p.weapon = primary;
    }
  }

  /** Tell the guards near `from` where it saw an enemy. */
  private callout(from: Agent, at: Point): void {
    const noise: Noise = { x: at.x, y: at.y, z: at.z, radius: CALLOUT_RANGE, source: from.id };
    for (const p of this.players.values()) {
      if (p === from || p.team !== 'guard' || p.dead || !p.bot) continue;
      if (Math.hypot(p.x - from.x, p.z - from.z) <= CALLOUT_RANGE) p.bot.hear(p, noise, this.tick * SERVER_DT);
    }
  }

  private broadcast(e: GameEvent): void {
    for (const p of this.players.values()) p.events.push(e);
    this.onEvent?.(e);
  }

  /**
   * Judge a round: rewind everyone else to where the shooter saw them, find
   * the nearest body the round meets before the world stops it, and apply
   * damage. Everyone else gets the shot as a tracer.
   */
  private fire(shooter: Player, shot: Shot, view: number | undefined): void {
    shooter.protection = 0;
    const w = WEAPONS[shot.weapon];
    const { ox, oy, oz, dx, dy, dz } = shot;
    const wall = this.world.raycast(ox, oy, oz, dx, dy, dz, w.range);
    let t = Math.min(wall, w.range);
    let victim: Player | null = null;
    let zone: Zone = 'torso';
    for (const pose of this.posesAt(view)) {
      if (pose.id === shooter.id || pose.dead) continue;
      const target = this.players.get(pose.id);
      // Skip bodies that have died or respawned since the moment being judged.
      if (!target || target.dead || target.life !== pose.life) continue;
      const hit = rayBody(pose, ox, oy, oz, dx, dy, dz, t);
      if (hit && hit.t < t) {
        t = hit.t;
        victim = target;
        zone = hit.zone;
      }
    }

    const ex = ox + dx * t;
    const ey = oy + dy * t;
    const ez = oz + dz * t;
    const struck = victim ? 'body' : wall <= w.range ? 'world' : 'none';
    const now = this.tick * SERVER_DT;
    for (const p of this.players.values()) {
      if (p !== shooter) p.events.push({ k: 'shot', id: shooter.id, weapon: shot.weapon, ox, oy, oz, ex, ey, ez, struck });
      // Bots hear the shot, and feel rounds that pass close.
      if (!p.bot || p.dead || p === shooter) continue;
      const d = Math.hypot(p.x - ox, p.z - oz);
      if (d <= w.noise) p.bot.hear(p, { x: ox, y: oy, z: oz, radius: w.noise, source: shooter.id }, now);
      if (p !== victim && hostile(p, shooter) && Bot.nearMiss(p, ox, oy, oz, dx, dy, dz, t)) p.bot.underFire(shooter, now);
    }
    if (victim) this.damage(victim, shooter, damageAt(shot.weapon, t, zone), zone, shot.weapon, ex, ey, ez);
  }

  private damage(victim: Player, attacker: Player, amount: number, zone: Zone, weapon: number, x: number, y: number, z: number): void {
    if (victim.protection > 0) amount = 0;
    amount = Math.min(amount, victim.hp);
    victim.hp -= amount;
    const killed = victim.hp <= 0;
    attacker.events.push({ k: 'hit', target: victim.id, zone, damage: amount, killed, x, y, z });
    victim.events.push({ k: 'hurt', damage: amount, x: attacker.x, z: attacker.z });
    victim.bot?.hurt(attacker, this.tick * SERVER_DT);
    if (!killed) return;
    victim.dead = true;
    victim.respawn = !victim.plan ? RESPAWN_TIME : victim.team === 'guard' ? GUARD_RESPAWN : BODY_TIME;
    victim.vx = victim.vy = victim.vz = 0;
    this.broadcast({
      k: 'kill', killer: attacker.id, victim: victim.id, killerName: attacker.name, victimName: victim.name,
      weapon, head: zone === 'head',
    });
  }

  /**
   * Everyone's pose at a past, possibly fractional, tick, blended between the
   * recorded ticks around it and clamped to the rewind window. Without a view
   * tick, the latest record.
   */
  private posesAt(view: number | undefined): PoseRecord[] {
    const h = this.history;
    if (h.length === 0) return [...this.players.values()].map(poseOf);
    const latest = h[h.length - 1];
    if (view === undefined) return latest.poses;
    const v = clamp(view, Math.max(h[0].tick, this.tick - MAX_REWIND * SERVER_TICK_RATE), latest.tick);
    let i = h.length - 1;
    while (i > 0 && h[i - 1].tick > v) i--;
    if (i === 0 || h[i].tick <= v) return h[i].poses;
    const a = h[i - 1];
    const b = h[i];
    const f = (v - a.tick) / (b.tick - a.tick);
    return b.poses.map((pb) => {
      const pa = a.poses.find((p) => p.id === pb.id);
      if (!pa || pa.life !== pb.life) return pb;
      const near = f < 0.5 ? pa : pb;
      return {
        id: pb.id,
        x: lerp(pa.x, pb.x, f),
        y: lerp(pa.y, pb.y, f),
        z: lerp(pa.z, pb.z, f),
        yaw: pa.yaw + angleDiff(pb.yaw, pa.yaw) * f,
        duck: lerp(pa.duck, pb.duck, f),
        lean: lerp(pa.lean, pb.lean, f),
        dead: near.dead,
        life: pb.life,
      };
    });
  }
}

function poseOf(p: Player): PoseRecord {
  return { id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, duck: p.duck, lean: p.lean, dead: p.dead, life: p.life };
}
