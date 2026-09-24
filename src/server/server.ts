import {
  BODY_TIME,
  Btn,
  CMD_DT,
  EXTRACT_TIME,
  GUARD_RESPAWN,
  MAX_CMDS_PER_TICK,
  MAX_HP,
  MAX_REWIND,
  OPERATOR_REFILL,
  PLAYER_HEIGHT,
  RESPAWN_TIME,
  RESPONSE_SQUAD,
  RUN_TIME,
  SEARCH_TIME,
  SERVER_DT,
  SERVER_TICK_RATE,
  SPAWN_PROTECTION,
} from '../shared/constants.ts';
import { angleDiff, clamp, lerp, yawToward } from '../shared/geom.ts';
import { rayBody, type Pose, type Zone } from '../shared/hitbox.ts';
import { ITEMS, lootMass, lootValue, MEDKIT_HEAL, runScore } from '../shared/loot.ts';
import type {
  BagSnap, ClientMsg, ExtractView, GameEvent, InputCmd, LootView, Mode, PlayerSnap, RunView, ServerMsg, Team,
} from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { applyCmd, copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import { damageAt, spawnWeapons, WEAPONS, type Shot } from '../shared/weapons.ts';
import { World, type Point } from '../shared/world.ts';
import { Bot, hostile, type Agent, type BotContext, type Noise } from './bot.ts';
import { Containers } from './containers.ts';
import { Extracts } from './extracts.ts';
import { NavGrid } from './nav.ts';
import { insertionPoint, planGuards, planOperator, planResponse, type BotPlan } from './population.ts';
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
/** Guards this close to a called extraction hear the call. */
const CALL_NOISE = 180;
/** Seconds after a pickup lands before its response squad is recalled. */
const RESPONSE_STAY = 60;

/** An operator's run: from dropping in to extracting, dying or running out of time. */
interface Run {
  /** Server time it started. */
  start: number;
  /** Loot carried, in the order taken. */
  items: number[];
  kills: number;
  guardKills: number;
  /** The crate being searched and for how long, while Interact is held on it. */
  search: { id: number; time: number } | null;
  /** Buttons held last command, to tell fresh presses. */
  useHeld: boolean;
  dropHeld: boolean;
  /** Extraction point stood in, or -1, and seconds held there. */
  zone: number;
  hold: number;
  /** Who killed them, once dead. */
  killer: string;
}

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
  /** Set for operators playing a run. */
  run: Run | null;
  /** Set for a response squad: when it's recalled. */
  recall: number;
}

interface PoseRecord extends Pose {
  id: number;
  dead: boolean;
  life: number;
}

export interface ServerOptions {
  /** How the game is played, as told to clients (default 'range'). */
  mode?: Mode;
  /** Populate the shooting range with target dummies (default true). */
  dummies?: boolean;
  /** Post guards at the outposts and send patrols between them (default false). */
  guards?: boolean;
  /** Operator slots, filled by bots where no player takes them (default 0, no operator bots). */
  operators?: number;
  /**
   * Humans play runs: they drop in, loot, and extract or die, with no
   * respawn (default false: they respawn at the range). Operator bots always do.
   */
  runs?: boolean;
}

/**
 * The authoritative game. It knows nothing about Workers or sockets: a host
 * calls connect/receive/disconnect and drives tick() at SERVER_TICK_RATE.
 */
export class GameServer {
  readonly seed: number;
  readonly mode: Mode;
  readonly world: World;
  readonly range: RangeLayout;
  readonly nav: NavGrid;
  readonly containers: Containers;
  readonly extracts: Extracts;
  tick = 0;
  /** Hears everything sent to everyone: kills, calls and extractions. */
  onEvent: ((e: GameEvent) => void) | null = null;
  private readonly players = new Map<number, Player>();
  private readonly spawnRng: () => number;
  private readonly botRng: () => number;
  private readonly operatorSlots: number;
  private readonly runs: boolean;
  /** When each operator slot emptied by a bot leaving gets filled again, soonest first. */
  private readonly refills: number[] = [];
  private readonly ctx: BotContext;
  /** Where everyone stood at the end of each recent tick, oldest first, for rewinding shots. */
  private readonly history: { tick: number; poses: PoseRecord[] }[] = [];
  private nextId = 1;

  constructor(seed: number, options: ServerOptions = {}) {
    this.seed = seed >>> 0;
    this.mode = options.mode ?? 'range';
    this.world = new World(this.seed);
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
    this.botRng = mulberry32(this.seed ^ 0x68e31da4);
    this.range = layoutRange(this.world, mulberry32(this.seed ^ 0x2545f491));
    this.nav = new NavGrid(this.world);
    this.containers = new Containers(this.world, mulberry32(this.seed ^ 0x27d4eb2f));
    this.extracts = new Extracts(this.world, mulberry32(this.seed ^ 0x165667b1));
    this.operatorSlots = options.operators ?? 0;
    this.runs = options.runs ?? false;
    const players = this.players;
    this.ctx = {
      world: this.world,
      nav: this.nav,
      time: 0,
      agents: { [Symbol.iterator]: () => players.values() },
      agent: (id) => players.get(id),
      pathBudget: 0,
      callout: (from, at) => this.callout(from, at),
      extracts: this.extracts.points,
      lootView: (a) => {
        const p = players.get(a.id);
        return p ? this.lootView(p) : null;
      },
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

  get time(): number {
    return this.tick * SERVER_DT;
  }

  connect(send: (msg: ServerMsg) => void): number {
    const p = this.add('player', 'operator', send);
    if (this.runs) p.run = newRun(this.time);
    this.spawn(p);
    // A human takes an operator slot from a bot: the one farthest from anyone.
    while (this.operatorSlots > 0 && this.operatorCount() > this.operatorSlots) {
      const bots = [...this.players.values()].filter((b) => b.team === 'operator' && b.plan);
      if (!bots.length) break;
      const humans = [...this.players.values()].filter((h) => h.team === 'operator' && !h.plan);
      const away = (b: Player) => Math.min(...humans.map((h) => Math.hypot(h.x - b.x, h.z - b.z)));
      this.players.delete(bots.reduce((a, b) => (away(b) > away(a) ? b : a)).id);
    }
    return p.id;
  }

  /** A client left: their slot opens up for a bot. */
  disconnect(id: number): void {
    const p = this.players.get(id);
    if (p) this.leave(p);
  }

  receive(id: number, msg: ClientMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'hello':
        p.joined = true;
        p.name = msg.name.slice(0, 24) || 'player';
        p.send({ t: 'welcome', id, seed: this.seed, tick: this.tick, tickRate: SERVER_TICK_RATE, mode: this.mode });
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
      case 'leave':
        this.disconnect(id);
        break;
    }
  }

  /** Bots in the game, for tests and debugging. */
  bots(): { id: number; name: string; team: Team; bot: Bot; state: PlayerState }[] {
    return [...this.players.values()].filter((p) => p.bot).map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot!, state: p }));
  }

  /** Humans in the game. */
  humans(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.plan && !p.dummy) n++;
    return n;
  }

  step(): void {
    this.tick++;
    const ctx = this.ctx;
    const now = (ctx.time = this.time);
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
        if (p.run && !p.dead) this.use(p, cmd.buttons);
        p.lastSim = cmd.seq;
      }
      p.queue.splice(0, n);
    }

    this.containers.step(now);
    const landed = this.extracts.step(now);
    for (const p of [...this.players.values()]) {
      p.protection = Math.max(p.protection - SERVER_DT, 0);
      if (p.bot?.done || (p.recall > 0 && now >= p.recall && !p.dead)) {
        this.leave(p);
        continue;
      }
      if (p.run && !p.dead) this.runStep(p, landed);
      if (!p.dead || !this.players.has(p.id)) continue;
      p.respawn -= SERVER_DT;
      if (p.respawn > 0) continue;
      // A fallen operator's run is over, as is a response guard's job; a guard is replaced at its post.
      if (p.run || p.plan?.temporary) this.leave(p);
      else this.spawn(p);
    }
    while (this.refills.length && now >= this.refills[0]) {
      this.refills.shift();
      if (this.operatorCount() < this.operatorSlots) this.addOperatorBot();
    }

    this.history.push({ tick: this.tick, poses: [...this.players.values()].map(poseOf) });
    if (this.history.length > HISTORY_TICKS) this.history.shift();

    const joined = [...this.players.values()].filter((p) => p.joined);
    const players: PlayerSnap[] = joined.map(({ id, team, x, y, z, yaw, duck, lean, dead, weapon }) => (
      { id, team, x, y, z, yaw, duck, lean, dead, weapon }
    ));
    let extracts: ExtractView[] | null = null;
    let bags: BagSnap[] | null = null;
    for (const p of joined) {
      // Bots and dummies see the game directly.
      if (p.plan || p.dummy) {
        p.events = [];
        continue;
      }
      extracts ??= this.extracts.views(now);
      bags ??= this.containers.bags();
      p.send({ t: 'snapshot', tick: this.tick, ack: p.lastSim, you: copyState(p), players, run: this.runView(p), extracts, bags });
      if (p.events.length) p.send({ t: 'events', tick: this.tick, events: p.events });
      p.events = [];
    }
  }

  // -------------------------------------------------------------- runs

  /**
   * One command's worth of Interact and Drop: search the crate faced while
   * holding Interact, take an item from an opened one with each press, or
   * call in a pickup at a landing zone; drop the last item taken.
   */
  private use(p: Player, buttons: number): void {
    const run = p.run!;
    const interact = (buttons & Btn.Interact) !== 0;
    const pressed = interact && !run.useHeld;
    run.useHeld = interact;
    const drop = (buttons & Btn.Drop) !== 0;
    if (drop && !run.dropHeld && run.items.length) {
      this.containers.drop(p.x, p.y, p.z, [run.items.pop()!], this.time);
      p.carry = lootMass(run.items);
    }
    run.dropHeld = drop;
    if (!interact) {
      run.search = null;
      return;
    }

    const c = this.containers.facing(p.x, p.y, p.z, p.yaw);
    if (c && !c.searched) {
      if (run.search?.id !== c.id) run.search = { id: c.id, time: 0 };
      run.search.time += CMD_DT;
      if (run.search.time >= SEARCH_TIME - 1e-9) {
        this.containers.searched(c, this.time);
        run.search = null;
      }
      return;
    }
    run.search = null;
    if (!pressed) return;
    if (c) {
      const item = this.containers.take(c);
      if (item === undefined) return;
      const def = ITEMS[item];
      if (def.use === 'ammo') p.reserve = spawnWeapons().reserve;
      else if (def.use === 'heal') p.hp = Math.min(p.hp + MEDKIT_HEAL, MAX_HP);
      else {
        run.items.push(item);
        p.carry = lootMass(run.items);
      }
      p.events.push({ k: 'took', item });
      return;
    }
    const zone = this.extracts.at(p);
    if (zone >= 0 && this.extracts.call(zone, this.time)) this.called(p, zone);
  }

  /** Someone called in a pickup: guards around hear it, and a response squad sets off toward it. */
  private called(p: Player, index: number): void {
    const at = this.extracts.points[index];
    this.broadcast({ k: 'call', id: p.id, index, name: p.name });
    const now = this.time;
    for (const g of this.players.values()) {
      if (g.team !== 'guard' || g.dead || !g.bot || Math.hypot(g.x - at.x, g.z - at.z) > CALL_NOISE) continue;
      g.bot.hear(g, { x: at.x, y: at.y, z: at.z, radius: CALL_NOISE, source: p.id }, now);
    }
    for (const plan of planResponse(this.world, this.nav, this.botRng, at, RESPONSE_SQUAD)) {
      const g = this.addBot(plan, 'guard');
      g.recall = at.pickup + RESPONSE_STAY;
    }
  }

  /** The clock, and standing in an extraction point. */
  private runStep(p: Player, landed: number[]): void {
    const run = p.run!;
    if (this.time - run.start >= RUN_TIME) {
      this.endRun(p, 'mia');
      return;
    }
    const zone = this.extracts.at(p);
    if (zone !== run.zone) run.hold = 0;
    run.zone = zone;
    if (zone < 0) return;
    const e = this.extracts.points[zone];
    if (e.kind === 'call') {
      run.hold = e.pickup >= 0 ? run.hold + SERVER_DT : 0;
      if (landed.includes(zone)) this.endRun(p, 'extracted');
    } else if (e.open) {
      run.hold += SERVER_DT;
      if (run.hold >= EXTRACT_TIME - 1e-9) this.endRun(p, 'extracted');
    } else run.hold = 0;
  }

  /**
   * The run is over. Getting out scores the loot and kills; dying leaves the
   * loot in a bag on the body, and running out of time loses it.
   */
  private endRun(p: Player, outcome: 'extracted' | 'killed' | 'mia'): void {
    const run = p.run!;
    const value = lootValue(run.items);
    const score = outcome === 'extracted' ? runScore(value, run.kills, run.guardKills) : 0;
    p.events.push({
      k: 'runEnd', outcome, score, value, items: [...run.items], kills: run.kills, guardKills: run.guardKills,
      time: this.time - run.start, killer: run.killer,
    });
    if (outcome === 'extracted') this.broadcast({ k: 'extract', id: p.id, name: p.name, value });
    if (outcome === 'killed') this.containers.drop(p.x, p.y, p.z, run.items, this.time);
    run.items = [];
    p.carry = 0;
    if (outcome !== 'killed') this.leave(p);
  }

  private lootView(p: Player): LootView | null {
    const c = this.containers.facing(p.x, p.y, p.z, p.yaw);
    if (!c) return null;
    const search = p.run?.search;
    const progress = c.searched ? 1 : search?.id === c.id ? Math.min(search.time / SEARCH_TIME, 1) : 0;
    return { id: c.id, kind: c.kind, searched: c.searched, progress, items: c.searched ? [...c.items] : [] };
  }

  private runView(p: Player): RunView | null {
    const run = p.run;
    if (!run) return null;
    return {
      time: Math.max(RUN_TIME - (this.time - run.start), 0),
      items: [...run.items],
      kills: run.kills,
      guardKills: run.guardKills,
      loot: p.dead ? null : this.lootView(p),
      zone: run.zone,
      hold: run.hold,
    };
  }

  // -------------------------------------------------------------- population

  private add(name: string, team: Team, send: (msg: ServerMsg) => void): Player {
    const p: Player = {
      ...spawnState(0, 0, 0), id: this.nextId++, name, team, send, joined: false, queue: [], lastRecv: 0, lastSim: 0,
      respawn: 0, protection: 0, events: [], dummy: null, plan: null, bot: null, run: null, recall: 0,
    };
    this.players.set(p.id, p);
    return p;
  }

  private addBot(plan: BotPlan, team: Team): Player {
    const p = this.add(plan.name, team, () => {});
    p.joined = true;
    p.plan = plan;
    if (team === 'operator') p.run = newRun(this.time);
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

  /** Someone leaves the game; an operator's slot opens up for a new bot after a while. */
  private leave(p: Player): void {
    if (!this.players.delete(p.id)) return;
    // Whatever happened this tick still reaches them, such as how their run ended.
    if (p.events.length) p.send({ t: 'events', tick: this.tick, events: p.events });
    p.events = [];
    if (p.team === 'operator') this.refills.push(this.time + OPERATOR_REFILL);
  }

  /** (Re)spawn a player with full health and ammo: bots at their post, runs at an insertion point, others at the range. */
  private spawn(p: Player): void {
    let post: Post & { pitch?: number };
    if (p.dummy) post = p.dummy;
    else if (p.plan) post = p.plan.spawn;
    else if (p.run) {
      const others = [...this.players.values()].filter((o) => o !== p && o.team === 'operator' && !o.dead);
      const at = insertionPoint(this.world, this.nav, this.spawnRng, others);
      post = { ...at, yaw: yawToward(at.x, at.z, 0, 0) };
    } else {
      const o = this.range.origin;
      const side = (this.spawnRng() * 2 - 1) * SPAWN_SPREAD;
      const x = o.x + Math.cos(o.yaw) * side;
      const z = o.z - Math.sin(o.yaw) * side;
      const y = this.world.groundHeight(x, z, o.y + 1);
      post = this.world.fits(x, y, z, PLAYER_HEIGHT) ? { x, y, z, yaw: o.yaw, pitch: o.pitch } : o;
    }
    const carry = p.run ? lootMass(p.run.items) : 0;
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
      if (Math.hypot(p.x - from.x, p.z - from.z) <= CALLOUT_RANGE) p.bot.hear(p, noise, this.time);
    }
  }

  private broadcast(e: GameEvent): void {
    for (const p of this.players.values()) p.events.push(e);
    this.onEvent?.(e);
  }

  // -------------------------------------------------------------- combat

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
    const now = this.time;
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
    victim.bot?.hurt(attacker, this.time);
    if (!killed) return;
    victim.dead = true;
    victim.respawn = victim.run || victim.plan?.temporary ? BODY_TIME : victim.team === 'guard' ? GUARD_RESPAWN : RESPAWN_TIME;
    victim.vx = victim.vy = victim.vz = 0;
    if (attacker.run && attacker !== victim) {
      if (victim.team === 'operator') attacker.run.kills++;
      else if (victim.team === 'guard') attacker.run.guardKills++;
    }
    this.broadcast({
      k: 'kill', killer: attacker.id, victim: victim.id, killerName: attacker.name, victimName: victim.name,
      weapon, head: zone === 'head',
    });
    if (victim.run) {
      victim.run.killer = attacker === victim ? '' : attacker.name;
      this.endRun(victim, 'killed');
    }
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

function newRun(start: number): Run {
  return { start, items: [], kills: 0, guardKills: 0, search: null, useHeld: false, dropHeld: false, zone: -1, hold: 0, killer: '' };
}

function poseOf(p: Player): PoseRecord {
  return { id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, duck: p.duck, lean: p.lean, dead: p.dead, life: p.life };
}
