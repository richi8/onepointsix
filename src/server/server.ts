import {
  BODY_TIME,
  BREAK_NOISE,
  Btn,
  CMD_DT,
  DEATHCAM_AFTER,
  DEATHCAM_BEFORE,
  EXTRACT_TIME,
  GRENADE_DAMAGE,
  GRENADE_FUSE,
  GRENADE_NOISE,
  GRENADE_RADIUS,
  GRENADES,
  GUARD_RESPAWN,
  INTEL_TIME,
  MAX_CMDS_PER_TICK,
  MAX_HP,
  MAX_REWIND,
  OPERATOR_REFILL,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RESPAWN_TIME,
  RESPONSE_SQUAD,
  RUN_TIME,
  SEARCH_TIME,
  SERVER_DT,
  SERVER_TICK_RATE,
  SPAWN_PROTECTION,
  SUPPRESSED_NOISE,
} from '../shared/constants.ts';
import { angleDiff, clamp, lerp, yawToward } from '../shared/geom.ts';
import { launchGrenade, stepGrenade, type Grenade } from '../shared/grenade.ts';
import { hitboxes, rayBody, type Pose, type Zone } from '../shared/hitbox.ts';
import { ITEMS, lootMass, lootValue, MEDKIT_HEAL, runScore } from '../shared/loot.ts';
import type {
  BagSnap, ClientMsg, ExtractView, GameEvent, GrenadeSnap, InputCmd, LootView, Mode, PlayerSnap, RunView, ServerMsg, Team,
} from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { applyCmd, copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import { Tape } from '../shared/tape.ts';
import { damageAt, GRENADE, spawnWeapons, WEAPONS, type Shot, type Toss } from '../shared/weapons.ts';
import { World, type Box, type Point } from '../shared/world.ts';
import { Bot, hostile, type Agent, type BotContext, type Noise } from './bot.ts';
import { Containers } from './containers.ts';
import { contractReward, contractView, planContracts, reachesIntel, type Contract } from './contracts.ts';
import { Cover } from './cover.ts';
import { Extracts } from './extracts.ts';
import { NavGrid } from './nav.ts';
import { insertionPoint, planCommander, planGuards, planOperator, planResponse, type BotPlan } from './population.ts';
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
/** Bots this close to where a hostile grenade settles take it as incoming fire. */
const GRENADE_SCARE = 8;

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
  /** Objectives paid on extraction; only humans get them. */
  contracts: Contract[];
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
  /** Their recent inputs, for replaying them in a death cam. */
  tape: Tape;
  /** Set for a human killed by someone else: who, and when, until the death cam is sent. */
  deathcam: { killer: Player; time: number } | null;
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
  readonly cover: Cover;
  /** Grenades in flight or on the ground. */
  readonly grenades: Grenade[] = [];
  tick = 0;
  /** Hears everything sent to everyone: kills, calls and extractions. */
  onEvent: ((e: GameEvent) => void) | null = null;
  private readonly players = new Map<number, Player>();
  private readonly spawnRng: () => number;
  private readonly botRng: () => number;
  private readonly contractRng: () => number;
  private readonly operatorSlots: number;
  private readonly runs: boolean;
  /** When each operator slot emptied by a bot leaving gets filled again, soonest first. */
  private readonly refills: number[] = [];
  private readonly ctx: BotContext;
  /** Where everyone stood at the end of each recent tick, oldest first, for rewinding shots. */
  private readonly history: { tick: number; poses: PoseRecord[] }[] = [];
  private nextId = 1;
  private nextGrenade = 1;

  constructor(seed: number, options: ServerOptions = {}) {
    this.seed = seed >>> 0;
    this.mode = options.mode ?? 'range';
    this.world = new World(this.seed);
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
    this.botRng = mulberry32(this.seed ^ 0x68e31da4);
    this.contractRng = mulberry32(this.seed ^ 0x3c6ef372);
    this.range = layoutRange(this.world, mulberry32(this.seed ^ 0x2545f491));
    this.nav = new NavGrid(this.world);
    this.containers = new Containers(this.world, mulberry32(this.seed ^ 0x27d4eb2f));
    this.extracts = new Extracts(this.world, mulberry32(this.seed ^ 0x165667b1));
    this.cover = new Cover(this.world);
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
    if (p.run) this.assignContracts(p);
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
        p.send({
          t: 'welcome', id, seed: this.seed, tick: this.tick, tickRate: SERVER_TICK_RATE, mode: this.mode,
          broken: this.world.brokenPanels(),
        });
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
      p.tape.beginTick(p, now - SERVER_DT);
      for (let i = 0; i < n; i++) {
        const cmd = p.queue[i];
        applyCmd(this.world, p, cmd, CMD_DT, (fx) => {
          if (fx.k === 'shot') this.fire(p, fx.shot, cmd.view);
          else if (fx.k === 'throw') this.toss(p, fx.toss);
        });
        p.tape.record(cmd);
        if (p.run && !p.dead) this.use(p, cmd.buttons);
        p.lastSim = cmd.seq;
      }
      p.queue.splice(0, n);
    }

    this.stepGrenades();
    const rebuilt = this.cover.repair(now, (box) => this.inTheWay(box));
    if (rebuilt.length) {
      for (const i of rebuilt) {
        this.nav.refresh(this.world.panels[i].box);
        this.containers.repaired(i);
      }
      this.broadcast({ k: 'repair', panels: rebuilt });
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
      if (p.deathcam && now >= p.deathcam.time + DEATHCAM_AFTER) this.sendDeathcam(p);
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
    const players: PlayerSnap[] = joined.map(({ id, team, x, y, z, yaw, pitch, duck, lean, dead, weapon }) => (
      { id, team, x, y, z, yaw, pitch, duck, lean, dead, weapon }
    ));
    let extracts: ExtractView[] | null = null;
    let bags: BagSnap[] | null = null;
    const grenades: GrenadeSnap[] = this.grenades.map(({ id, x, y, z }) => ({ id, x, y, z }));
    for (const p of joined) {
      // Bots and dummies see the game directly.
      if (p.plan || p.dummy) {
        p.events = [];
        continue;
      }
      extracts ??= this.extracts.views(now);
      bags ??= this.containers.bags();
      p.send({
        t: 'snapshot', tick: this.tick, ack: p.lastSim, you: copyState(p), players, run: this.runView(p), extracts, bags, grenades,
      });
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
      for (const k of run.contracts) k.held = 0;
      return;
    }

    const intel = run.contracts.findIndex((k) => reachesIntel(k, p.x, p.y, p.z, p.yaw));
    if (intel >= 0) {
      run.search = null;
      const k = run.contracts[intel];
      k.held += CMD_DT;
      if (k.held >= INTEL_TIME - 1e-9) this.settle(p, intel, 'done');
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
      if (def.use === 'ammo') {
        p.reserve = spawnWeapons().reserve;
        p.grenades = Math.max(p.grenades, GRENADES);
      }
      else if (def.use === 'heal') p.hp = Math.min(p.hp + MEDKIT_HEAL, MAX_HP);
      else if (def.use === 'suppressor') {
        const w = p.suppressed[p.weapon] ? p.suppressed.indexOf(false) : p.weapon;
        if (w >= 0) p.suppressed[w] = true;
      } else {
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
    this.noise(at.x, at.y, at.z, CALL_NOISE, p.id, (g) => g.team === 'guard');
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
    const contracts = run.contracts.map(contractView);
    const score = outcome === 'extracted' ? runScore(value, run.kills, run.guardKills, contractReward(contracts)) : 0;
    p.events.push({
      k: 'runEnd', outcome, score, value, items: [...run.items], kills: run.kills, guardKills: run.guardKills,
      contracts, time: this.time - run.start, killer: run.killer,
    });
    this.dismiss(run);
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
      contracts: run.contracts.map(contractView),
      intel: p.dead ? -1 : run.contracts.findIndex((k) => reachesIntel(k, p.x, p.y, p.z, p.yaw)),
    };
  }

  /** Send a killed player their killer's inputs from just before the kill until now. */
  private sendDeathcam(p: Player): void {
    const { killer, time } = p.deathcam!;
    p.deathcam = null;
    const clip = killer.tape.clip(time - DEATHCAM_BEFORE);
    if (clip) p.events.push({ k: 'deathcam', killer: killer.id, name: killer.name, time, clip });
  }

  // -------------------------------------------------------------- contracts

  /** A human's run gets its contracts, and the commanders among them are put on the island. */
  private assignContracts(p: Player): void {
    const run = p.run!;
    run.contracts = planContracts(this.world, this.contractRng);
    for (const c of run.contracts) {
      if (c.kind !== 'commander') continue;
      const taken = new Set([...this.players.values()].map((q) => q.name));
      const plan = planCommander(this.world, this.nav, this.contractRng, this.world.outposts[c.outpost], taken);
      if (!plan) {
        c.state = 'failed';
        continue;
      }
      const g = this.addBot(plan, 'guard');
      c.bot = g.id;
      c.name = g.name;
    }
  }

  /** A contract was done, or failed because someone else got there first. */
  private settle(p: Player, index: number, state: 'done' | 'failed'): void {
    const c = p.run!.contracts[index];
    if (c.state !== 'open') return;
    c.state = state;
    c.held = 0;
    p.events.push({ k: 'contract', index, state });
  }

  /** A run is over: its commanders still on the island are called away. */
  private dismiss(run: Run): void {
    for (const c of run.contracts) {
      const g = c.bot ? this.players.get(c.bot) : undefined;
      if (g && !g.dead) g.recall = Math.max(this.time, SERVER_DT);
    }
  }

  /** Someone died: a commander's contract is done if its holder killed it, and failed otherwise. */
  private commanderDown(victim: Player, attacker: Player): void {
    for (const p of this.players.values()) {
      const i = p.run?.contracts.findIndex((c) => c.bot === victim.id) ?? -1;
      if (i >= 0) this.settle(p, i, attacker === p ? 'done' : 'failed');
    }
  }

  // -------------------------------------------------------------- population

  private add(name: string, team: Team, send: (msg: ServerMsg) => void): Player {
    const p: Player = {
      ...spawnState(0, 0, 0), id: this.nextId++, name, team, send, joined: false, queue: [], lastRecv: 0, lastSim: 0,
      respawn: 0, protection: 0, events: [], dummy: null, plan: null, bot: null, run: null, recall: 0,
      tape: new Tape(), deathcam: null,
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
    if (p.run) this.dismiss(p.run);
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

  /**
   * A sound at (x, y, z) that carries `radius` metres, made by `source`: every
   * bot within it hears it, or only those `who` picks.
   */
  private noise(x: number, y: number, z: number, radius: number, source: number, who?: (p: Player) => boolean): void {
    const n: Noise = { x, y, z, radius, source };
    for (const p of this.players.values()) {
      if (!p.bot || p.dead || (who && !who(p)) || Math.hypot(p.x - x, p.z - z) > radius) continue;
      p.bot.hear(p, n, this.time);
    }
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
    const { t: wall, panel } = this.world.raycastPanel(ox, oy, oz, dx, dy, dz, w.range);
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
      if (p !== shooter) p.events.push({ k: 'shot', id: shooter.id, weapon: shot.weapon, ox, oy, oz, ex, ey, ez, struck, quiet: shot.quiet });
      // Bots feel rounds that pass close, suppressed or not.
      if (!p.bot || p.dead || p === shooter || p === victim || !hostile(p, shooter)) continue;
      if (Bot.nearMiss(p, ox, oy, oz, dx, dy, dz, t)) p.bot.underFire(shooter, now);
    }
    this.noise(ox, oy, oz, w.noise * (shot.quiet ? SUPPRESSED_NOISE : 1), shooter.id);
    if (victim) this.damage(victim, shooter, damageAt(shot.weapon, t, zone), zone, shot.weapon, ex, ey, ez);
    else if (panel >= 0) this.panelsBroke(this.cover.damage(panel, damageAt(shot.weapon, t, 'torso'), now), ox, oy, oz, shooter);
  }

  /**
   * Panels broke, knocked from (x, y, z) by `by`: everyone sees them come
   * down, bots hear it and path around the change, crates spill their loot,
   * and a supply cache counts for whoever had the contract on it if they broke it.
   */
  private panelsBroke(panels: number[], x: number, y: number, z: number, by: Player | undefined): void {
    if (!panels.length) return;
    let loudest = 0;
    for (const i of panels) {
      this.nav.refresh(this.world.panels[i].box);
      this.containers.broke(i, this.time);
      const n = BREAK_NOISE[this.world.panels[i].kind];
      if (n > loudest) loudest = n;
    }
    this.broadcast({ k: 'break', panels, x, y, z });
    const b = this.world.panels[panels[0]].box;
    this.noise((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, loudest, by?.id ?? 0);
    if (!by?.run) return;
    by.run.contracts.forEach((c, i) => {
      if (c.kind === 'cache' && panels.includes(c.panel)) this.settle(by, i, 'done');
    });
  }

  /** Whether rebuilding a panel here would trap someone or bury a bag. */
  private inTheWay(box: Box): boolean {
    const r = PLAYER_RADIUS;
    for (const p of this.players.values()) {
      if (p.x > box.minX - r && p.x < box.maxX + r && p.z > box.minZ - r && p.z < box.maxZ + r
        && p.y < box.maxY && p.y + PLAYER_HEIGHT > box.minY) return true;
    }
    for (const g of this.grenades) {
      if (g.x > box.minX && g.x < box.maxX && g.z > box.minZ && g.z < box.maxZ && g.y > box.minY && g.y < box.maxY) return true;
    }
    return this.containers.bagIn(box.minX, box.minZ, box.maxX, box.maxZ);
  }

  // -------------------------------------------------------------- grenades

  private toss(p: Player, toss: Toss): void {
    p.protection = 0;
    this.grenades.push(launchGrenade(this.nextGrenade++, p.id, toss, GRENADE_FUSE));
  }

  private stepGrenades(): void {
    const now = this.time;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      const resting = g.rest;
      stepGrenade(this.world, g, SERVER_DT);
      if (g.fuse <= 0) {
        this.grenades.splice(i, 1);
        this.explode(g);
        continue;
      }
      if (resting || !g.rest) continue;
      // It settled: bots nearby see it and get away from whoever threw it.
      const owner = this.players.get(g.owner);
      if (!owner) continue;
      for (const p of this.players.values()) {
        if (!p.bot || p.dead || !hostile(p, owner) || Math.hypot(p.x - g.x, p.z - g.z) > GRENADE_SCARE) continue;
        p.bot.underFire(owner, now);
      }
    }
  }

  /**
   * A grenade goes off: it hurts every body it can see, falling off with
   * distance, breaks the panels around it and is heard far away.
   */
  private explode(g: Grenade): void {
    const { x, y, z } = g;
    const now = this.time;
    const owner = this.players.get(g.owner);
    this.broadcast({ k: 'boom', x, y, z });
    for (const p of [...this.players.values()]) {
      if (p.dead) continue;
      const h = hitboxes(p);
      const chest = (h.hipY + h.neckY) / 2;
      const d = Math.hypot(h.torsoX - x, chest - y, h.torsoZ - z);
      if (d < GRENADE_RADIUS && (
        this.world.hasLineOfSight(x, y + 0.1, z, h.torsoX, chest, h.torsoZ) ||
        this.world.hasLineOfSight(x, y + 0.1, z, h.headX, h.headY, h.headZ) ||
        this.world.hasLineOfSight(x, y + 0.1, z, p.x, p.y + 0.3, p.z)
      )) {
        const f = 1 - d / GRENADE_RADIUS;
        const amount = Math.round(GRENADE_DAMAGE * f * f);
        if (amount > 0) this.damage(p, owner ?? p, amount, 'torso', GRENADE, h.torsoX, chest, h.torsoZ, { x, z });
      }
    }
    this.noise(x, y, z, GRENADE_NOISE, g.owner);
    this.panelsBroke(this.cover.blast(x, y, z, now), x, y, z, owner);
  }

  /** `from` is where the damage came from, if not the attacker, such as a grenade. */
  private damage(
    victim: Player, attacker: Player, amount: number, zone: Zone, weapon: number, x: number, y: number, z: number,
    from: { x: number; z: number } = attacker,
  ): void {
    if (victim.protection > 0) amount = 0;
    amount = Math.min(amount, victim.hp);
    victim.hp -= amount;
    const killed = victim.hp <= 0;
    attacker.events.push({ k: 'hit', target: victim.id, zone, damage: amount, killed, x, y, z });
    victim.events.push({ k: 'hurt', damage: amount, x: from.x, z: from.z });
    if (attacker !== victim) victim.bot?.hurt(attacker, this.time);
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
    if (victim.plan?.temporary) this.commanderDown(victim, attacker);
    if (!victim.plan && !victim.dummy && attacker !== victim) victim.deathcam = { killer: attacker, time: this.time };
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
  return {
    start, items: [], kills: 0, guardKills: 0, search: null, useHeld: false, dropHeld: false, zone: -1, hold: 0, killer: '', contracts: [],
  };
}

function poseOf(p: Player): PoseRecord {
  return { id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, duck: p.duck, lean: p.lean, dead: p.dead, life: p.life };
}
