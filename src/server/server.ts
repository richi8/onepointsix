import {
  BODY_TIME,
  BOUNTY_FUZZ,
  BOUNTY_MIN,
  BOUNTY_PING,
  BREAK_NOISE,
  Btn,
  CMD_DT,
  DEATHCAM_AFTER,
  DEATHCAM_BEFORE,
  DOOR_NOISE,
  DOOR_REACH,
  EYE_HEIGHT,
  EXTRACT_FEE,
  EXTRACT_TIME,
  SHOOTERS_WINDOW,
  GRENADE_DAMAGE,
  GRENADE_FUSE,
  GRENADE_NOISE,
  GRENADE_RADIUS,
  GRENADES,
  GUARD_HEAD_SHARE,
  GUARD_HP,
  GUARD_RESPAWN,
  INTEL_TIME,
  MAX_CMDS_PER_TICK,
  MAX_HP,
  MAX_REWIND,
  OPERATOR_REFILL,
  PANEL_HP,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RESPONSE_SQUAD,
  RESPAWN_CLEAR,
  RESPAWN_RETRY,
  RESPAWN_SIGHT,
  RUN_TIME,
  SEARCH_TIME,
  SERVER_DT,
  SERVER_TICK_RATE,
  SPAWN_PROTECTION,
  SUPPRESSED_NOISE,
  THROW_TIME,
} from '../shared/constants.ts';
import { DEFAULT_CONDITIONS, isNight, sensesOf, type Conditions } from '../shared/conditions.ts';
import { angleDiff, clamp, lerp, wrapAngle, yawToward } from '../shared/geom.ts';
import { launchGrenade, stepGrenade, type Grenade } from '../shared/grenade.ts';
import { hitboxes, rayBody, type Pose, type Zone } from '../shared/hitbox.ts';
import { ITEMS, lootMass, lootValue, MEDKIT_HEAL, runScore } from '../shared/loot.ts';
import type {
  Action, BagSnap, BountyView, ClientMsg, Death, DevCmd, ExtractView, GameEvent, GrenadeSnap, InputCmd, LootView, Mode, PlayerSnap, RunView, ServerMsg, Team,
} from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { RunEndEvent } from '../shared/runstats.ts';
import { applyCmd, copyState, motionOf, spawnState, type PlayerState } from '../shared/sim.ts';
import { Tape } from '../shared/tape.ts';
import { damageAt, GRENADE, spawnWeapons, WEAPONS, type Shot, type Toss } from '../shared/weapons.ts';
import { vegetationOf } from '../shared/vegetation.ts';
import { leafRect, World, type Box, type Point } from '../shared/world.ts';
import { beamSpot, Bot, hostile, type Agent, type BotContext, type Noise, type Post } from './bot.ts';
import { Containers } from './containers.ts';
import { contractReward, contractView, planContracts, reachesIntel, type Contract } from './contracts.ts';
import { Cover } from './cover.ts';
import { Extracts } from './extracts.ts';
import { NavGrid } from './nav.ts';
import { insertionPoint, planCommander, planGuards, planOperator, planResponse, type BotPlan } from './population.ts';
import type { Personality } from './personality.ts';
import { guardSkill, SKILLS } from './skill.ts';

/** Commands buffered beyond this are dropped; the client is too far ahead. */
const MAX_QUEUED_CMDS = MAX_CMDS_PER_TICK * 4;
const HISTORY_TICKS = Math.ceil(MAX_REWIND * SERVER_TICK_RATE) + 2;
/** Bots think every this many ticks, staggered so only some think each tick. */
const THINK_TICKS = 3;
/** Path searches all bots together may start per tick. */
const PATH_BUDGET = 6;
/** How far ahead of a walking bot a shut door is opened. */
const BOT_DOOR_REACH = 0.7;
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
  /** How they died, once dead. */
  death: Death | null;
  /** Objectives paid on extraction; only humans get them. */
  contracts: Contract[];
  /** When each enemy last hit them, and from which side. */
  hitBy: Map<number, { at: number; team: Team }>;
  /** Damage taken from guards and from other operators. */
  taken: { guards: number; operators: number };
}

/** Whether they carry enough loot to pay for extraction. */
function paid(run: Run): boolean {
  return lootValue(run.items) >= EXTRACT_FEE;
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
  /** The weapon is down for a grenade throw, not a switch. */
  threw: boolean;
  /** Their flashlight is on; only ever after dark. */
  light: boolean;
}

interface PoseRecord extends Pose {
  id: number;
  dead: boolean;
  life: number;
}

export interface ServerOptions {
  /** How the game is played, as told to clients (default 'offline'). */
  mode?: Mode;
  /** Post guards at the outposts and send patrols between them (default false). */
  guards?: boolean;
  /** The time of day and the weather (default a clear day). */
  conditions?: Conditions;
  /** Operator slots, filled by bots where no player takes them (default 0, no operator bots). */
  operators?: number;
  /** Every operator bot plays this way, for tests (default a personality at random for each). */
  personality?: Personality;
  /**
   * Operator bots loot as thoroughly as a person and can't be killed, so the
   * playtest can read how long a run lasts that isn't cut short by death.
   */
  thorough?: boolean;
}

/**
 * The authoritative game. It knows nothing about Workers or sockets: a host
 * calls connect/receive/disconnect and drives tick() at SERVER_TICK_RATE.
 */
export class GameServer {
  readonly seed: number;
  readonly mode: Mode;
  readonly conditions: Conditions;
  readonly world: World;
  readonly nav: NavGrid;
  readonly containers: Containers;
  readonly extracts: Extracts;
  readonly cover: Cover;
  /** Grenades in flight or on the ground. */
  readonly grenades: Grenade[] = [];
  tick = 0;
  /** Hears everything sent to everyone: kills, calls and extractions. */
  onEvent: ((e: GameEvent) => void) | null = null;
  /** Hears every operator's run ending, bots' too; `plan` is the bot's, or null for a human. */
  onRunEnd: ((e: RunEndEvent, plan: BotPlan | null) => void) | null = null;
  private readonly players = new Map<number, Player>();
  private readonly spawnRng: () => number;
  private readonly botRng: () => number;
  private readonly contractRng: () => number;
  private readonly bountyRng: () => number;
  private readonly operatorSlots: number;
  private readonly personality: Personality | undefined;
  /** Who carries the bounty, and where and when they were last called; null while nobody does. */
  private bounty: { id: number; x: number; y: number; z: number; at: number } | null = null;
  /** This tick's bags, for bots, made when first asked for. */
  private bagList: BagSnap[] | null = null;
  /** Where each lit flashlight lands this tick, for bots, worked out when first asked for. */
  private readonly beams = new Map<number, Point | null>();
  /** Who stands in a lamp's light this tick, for bots, worked out when first asked for. */
  private readonly lamplit = new Map<number, boolean>();
  /** When each operator slot emptied by a bot leaving gets filled again, soonest first. */
  private readonly refills: number[] = [];
  private readonly ctx: BotContext;
  /** Where everyone stood at the end of each recent tick, oldest first, for rewinding shots. */
  private readonly history: { tick: number; poses: PoseRecord[] }[] = [];
  private nextId = 1;
  private nextGrenade = 1;
  /** How it was set up. */
  private readonly options: ServerOptions;

  constructor(seed: number, options: ServerOptions = {}) {
    this.seed = seed >>> 0;
    this.options = options;
    this.mode = options.mode ?? 'offline';
    this.conditions = options.conditions ?? DEFAULT_CONDITIONS;
    const night = isNight(this.conditions);
    this.world = new World(this.seed);
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
    this.botRng = mulberry32(this.seed ^ 0x68e31da4);
    this.contractRng = mulberry32(this.seed ^ 0x3c6ef372);
    this.bountyRng = mulberry32(this.seed ^ 0x2545f491);
    this.nav = new NavGrid(this.world);
    // Paint the ground now rather than on the first bot's first look.
    vegetationOf(this.world);
    this.containers = new Containers(this.world, mulberry32(this.seed ^ 0x27d4eb2f), night);
    this.extracts = new Extracts(this.world, mulberry32(this.seed ^ 0x165667b1));
    this.cover = new Cover(this.world);
    this.operatorSlots = options.operators ?? 0;
    this.personality = options.personality;
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
      senses: sensesOf(this.conditions),
      bounty: 0,
      bags: () => (this.bagList ??= this.containers.bags()),
      beam: (a) => {
        let spot = this.beams.get(a.id);
        if (spot === undefined) this.beams.set(a.id, (spot = beamSpot(this.world, a)));
        return spot;
      },
      carried: (a) => {
        const run = players.get(a.id)?.run;
        return run ? lootValue(run.items) : 0;
      },
      lamplit: (a) => {
        let lit = this.lamplit.get(a.id);
        if (lit === undefined) this.lamplit.set(a.id, (lit = this.world.inLamplight(a.x, a.y + 1.2, a.z)));
        return lit;
      },
    };
    if (options.guards) {
      const plans = planGuards(this.world, this.nav, this.botRng, night);
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
    p.run = newRun(this.time);
    this.spawn(p);
    this.assignContracts(p);
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
    if (!p) return;
    this.leave(p);
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
          broken: this.world.brokenPanels(), open: this.world.openDoors(),
        });
        break;
      case 'ping':
        p.send({ t: 'pong', time: msg.time });
        break;
      case 'input': {
        if (!p.joined) break;
        for (const cmd of msg.cmds) {
          if (cmd.seq <= p.lastRecv) continue;
          p.lastRecv = cmd.seq;
          p.queue.push(cmd);
        }
        if (p.queue.length > MAX_QUEUED_CMDS) p.queue.splice(0, p.queue.length - MAX_QUEUED_CMDS);
        break;
      }
      case 'leave':
        this.leave(p);
        break;
      case 'dev':
        this.dev(p, msg.cmd);
        break;
    }
  }

  /** A development shortcut; see DevCmd. The host decides whether to pass them on. */
  private dev(p: Player, cmd: DevCmd): void {
    let rival: Player | null = null;
    let nearest = Infinity;
    for (const o of this.players.values()) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (o.bot && o.team === 'operator' && !o.dead && d < nearest) (rival = o), (nearest = d);
    }
    switch (cmd.act) {
      case 'end':
        if (!p.run || p.dead) return;
        if (cmd.outcome !== 'killed') this.endRun(p, cmd.outcome);
        else {
          const by = (!cmd.self && rival) || p;
          p.protection = 0;
          if (by === p) this.damage(p, p, p.hp, 'torso', GRENADE, p.x, p.y + 1.2, p.z, { x: p.x, y: p.y, z: p.z });
          else this.damage(p, by, p.hp, 'head', by.weapon, p.x, p.y + 1.6, p.z);
        }
        break;
      case 'give': {
        const to = cmd.rival ? rival : p;
        if (!to?.run || to.dead) return;
        to.run.items.push(...cmd.items);
        to.carry = lootMass(to.run.items);
        break;
      }
      case 'rival':
        if (!rival) return;
        rival.x = p.x - Math.sin(p.yaw) * 8;
        rival.z = p.z - Math.cos(p.yaw) * 8;
        rival.y = this.world.floorHeight(rival.x, rival.z);
        rival.vx = rival.vy = rival.vz = 0;
        rival.yaw = wrapAngle(p.yaw + Math.PI);
        rival.tape.sync(rival);
        break;
      case 'kill':
        if (!rival) return;
        rival.protection = 0;
        this.damage(rival, p, rival.hp, 'head', p.weapon, rival.x, rival.y + 1.6, rival.z);
        break;
    }
  }

  /** Bots in the game, for tests and debugging. */
  bots(): { id: number; name: string; team: Team; bot: Bot; state: PlayerState }[] {
    return [...this.players.values()].filter((p) => p.bot).map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot!, state: p }));
  }

  /** Operator bots partway through a run. */
  runsGoing(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.plan && p.run && !p.dead) n++;
    return n;
  }

  /** Humans in the game. */
  humans(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.plan) n++;
    return n;
  }

  step(): void {
    this.tick++;
    const ctx = this.ctx;
    const now = (ctx.time = this.time);
    ctx.pathBudget = PATH_BUDGET;
    this.bagList = null;
    this.beams.clear();
    this.lamplit.clear();
    for (const p of this.players.values()) {
      if (p.bot && !p.dead) {
        if ((this.tick + p.id) % THINK_TICKS === 0) p.bot.think(ctx, p, THINK_TICKS * SERVER_DT);
        p.queue.push(...p.bot.commands(ctx, p, p.lastSim));
      }
      const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
      p.tape.beginTick(p, now - SERVER_DT);
      for (let i = 0; i < n; i++) {
        const cmd = p.queue[i];
        p.tape.sync(p);
        applyCmd(this.world, p, cmd, CMD_DT, (fx) => {
          if (fx.k === 'shot') this.fire(p, fx.shot, cmd.view);
          else if (fx.k === 'throw') {
            this.toss(p, fx.toss);
            p.threw = true;
          } else if (fx.k === 'draw') p.threw = false;
        });
        p.tape.record(cmd, p);
        p.light = this.ctx.senses.dark && !p.dead && (cmd.buttons & Btn.Light) !== 0;
        if (p.run && !p.dead) this.use(p, cmd.buttons);
        if (p.bot && !p.dead) this.botDoors(p, cmd.buttons, cmd.yaw);
        p.lastSim = cmd.seq;
      }
      p.queue.splice(0, n);
      if (p.draw <= 0) p.threw = false;
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
      // A fallen operator's run is over, as is a response guard's job; a guard is replaced at its
      // post, but not in front of an operator: it waits until nobody is close to the post or sees it.
      if (p.run || p.plan?.temporary) this.leave(p);
      else if (p.plan && this.watched(p.plan.spawn)) p.respawn = RESPAWN_RETRY;
      else this.spawn(p);
    }
    this.stepBounty(now);
    while (this.refills.length && now >= this.refills[0]) {
      this.refills.shift();
      if (this.operatorCount() < this.operatorSlots) this.addOperatorBot();
    }

    this.history.push({ tick: this.tick, poses: [...this.players.values()].map(poseOf) });
    if (this.history.length > HISTORY_TICKS) this.history.shift();

    const joined = [...this.players.values()].filter((p) => p.joined);
    const players = joined.map(snapOf);
    let extracts: ExtractView[] | null = null;
    let bags: BagSnap[] | null = null;
    const bounty = this.bountyView();
    const grenades: GrenadeSnap[] = this.grenades.map(({ id, x, y, z }) => ({ id, x, y, z }));
    for (const p of joined) {
      // Bots see the game directly.
      if (p.plan) {
        p.events = [];
        continue;
      }
      extracts ??= this.extracts.views(now);
      bags ??= this.containers.bags();
      p.send({
        t: 'snapshot', tick: this.tick, ack: p.lastSim, you: copyState(p), players, run: this.runView(p), extracts, bags, grenades, bounty,
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
    if (zone >= 0 && paid(run) && this.extracts.call(zone, this.time)) {
      this.called(p, zone);
      return;
    }
    const door = this.world.doorFacing(p.x, p.y, p.z, p.yaw, DOOR_REACH);
    if (door >= 0) this.useDoor(door, !this.world.doors[door].open, p);
  }

  /**
   * Open or shut a doorway's leaves, unless someone other than `by` stands
   * where they'd swing to. Everyone sees it and bots near enough hear it.
   * Returns whether it moved.
   */
  private useDoor(id: number, open: boolean, by: Player): boolean {
    const w = this.world;
    const d = w.doors[id];
    const leaves = [id, d.pair].filter((i) => i >= 0 && !w.panels[w.doors[i].panel].box.gone && w.doors[i].open !== open);
    if (!leaves.length) return false;
    const r = PLAYER_RADIUS;
    for (const i of leaves) {
      const leaf = w.doors[i];
      const [x0, z0, x1, z1] = leafRect(leaf, open);
      for (const p of this.players.values()) {
        if (p === by || p.dead) continue;
        if (p.x > x0 - r && p.x < x1 + r && p.z > z0 - r && p.z < z1 + r && p.y < leaf.y1 && p.y + PLAYER_HEIGHT > leaf.y0) return false;
      }
    }
    for (const i of leaves) w.setDoor(i, open);
    const [x0, z0, x1, z1] = leafRect(d, false);
    const x = d.pair >= 0 ? (d.x + w.doors[d.pair].x) / 2 : (x0 + x1) / 2;
    const z = d.pair >= 0 ? (d.z + w.doors[d.pair].z) / 2 : (z0 + z1) / 2;
    this.broadcast({ k: 'door', doors: leaves, open, x, y: d.y0, z });
    this.noise(x, d.y0, z, DOOR_NOISE, by.id);
    return true;
  }

  /**
   * A bot walking into a shut door opens it: its paths go through doorways
   * as if they were open. `buttons` and `yaw` are the command it just played.
   */
  private botDoors(p: Player, buttons: number, yaw: number): void {
    const fwd = ((buttons & Btn.Forward) !== 0 ? 1 : 0) - ((buttons & Btn.Back) !== 0 ? 1 : 0);
    const side = ((buttons & Btn.Right) !== 0 ? 1 : 0) - ((buttons & Btn.Left) !== 0 ? 1 : 0);
    const len = Math.hypot(fwd, side);
    if (!len) return;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = p.x + ((-sin * fwd + cos * side) / len) * BOT_DOOR_REACH;
    const z = p.z + ((-cos * fwd - sin * side) / len) * BOT_DOOR_REACH;
    const w = this.world;
    for (let i = 0; i < w.doors.length; i++) {
      const d = w.doors[i];
      if (d.open || p.y > d.y1 || p.y + PLAYER_HEIGHT < d.y0 || w.panels[d.panel].box.gone) continue;
      const [x0, z0, x1, z1] = leafRect(d, false);
      if (x > x0 - PLAYER_RADIUS && x < x1 + PLAYER_RADIUS && z > z0 - PLAYER_RADIUS && z < z1 + PLAYER_RADIUS) {
        this.useDoor(i, true, p);
        return;
      }
    }
  }

  /** Someone called in a pickup: guards around hear it, and a response squad sets off toward it. */
  private called(p: Player, index: number): void {
    const at = this.extracts.points[index];
    this.broadcast({ k: 'call', id: p.id, index, name: p.name });
    this.noise(at.x, at.y, at.z, CALL_NOISE, p.id, (g) => g.team === 'guard');
    for (const plan of planResponse(this.world, this.nav, this.botRng, at, RESPONSE_SQUAD, isNight(this.conditions))) {
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
      if (landed.includes(zone) && paid(run)) this.endRun(p, 'extracted');
    } else if (e.open && paid(run)) {
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
    const end: RunEndEvent = {
      k: 'runEnd', outcome, score, value, items: [...run.items], kills: run.kills, guardKills: run.guardKills,
      contracts, time: this.time - run.start, killer: run.killer, extract: outcome === 'extracted' ? run.zone : -1,
      death: outcome === 'killed' ? run.death : null, taken: { ...run.taken },
    };
    p.events.push(end);
    this.onRunEnd?.(end, p.plan);
    this.dismiss(run);
    if (outcome === 'extracted') this.broadcast({ k: 'extract', id: p.id, name: p.name, value });
    if (outcome === 'killed') this.containers.drop(p.x, p.y, p.z, run.items, this.time, kindOf(p));
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
    const kind = kindOf(killer);
    if (clip) p.events.push({ k: 'deathcam', killer: killer.id, name: killer.name, time, clip, ...(kind ? { kind } : {}) });
  }

  // -------------------------------------------------------------- bounty

  /**
   * The operator carrying the most loot, at least BOUNTY_MIN, is the bounty:
   * everyone is told who, and every BOUNTY_PING seconds roughly where. Bots
   * that want them go after them. The one carrying it keeps it on a tie.
   */
  private stepBounty(now: number): void {
    let holder: Player | null = null;
    let most = BOUNTY_MIN - 1;
    const current = this.bounty ? this.players.get(this.bounty.id) : undefined;
    for (const p of this.players.values()) {
      if (!p.run || p.dead) continue;
      const v = lootValue(p.run.items);
      if (v > most || (v === most && p === current)) (holder = p), (most = v);
    }
    if (!holder) {
      if (this.bounty) {
        this.broadcast({ k: 'bounty', id: 0, name: '', value: 0 });
        this.tellBounty(0);
      }
      this.bounty = null;
      this.ctx.bounty = 0;
      return;
    }
    if (holder !== current) {
      this.bounty = { id: holder.id, x: 0, y: 0, z: 0, at: -Infinity };
      this.ctx.bounty = holder.id;
      this.broadcast({ k: 'bounty', id: holder.id, name: holder.name, value: most });
      this.tellBounty(holder.id);
    }
    const b = this.bounty!;
    if (now - b.at < BOUNTY_PING) return;
    const a = this.bountyRng() * Math.PI * 2;
    const r = Math.sqrt(this.bountyRng()) * BOUNTY_FUZZ;
    Object.assign(b, { x: holder.x + Math.sin(a) * r, y: holder.y, z: holder.z + Math.cos(a) * r, at: now });
    for (const p of this.players.values()) {
      if (p.bot && !p.dead && p.team === 'operator') p.bot.bountyCalled(p, holder.id, b, now);
    }
  }

  /** The operator bots hear who carries the bounty now, as players read it in the feed. Guards aren't told. */
  private tellBounty(id: number): void {
    for (const p of this.players.values()) if (p.bot && p.team === 'operator') p.bot.bountyTold(id);
  }

  private bountyView(): BountyView | null {
    const b = this.bounty;
    const p = b && this.players.get(b.id);
    if (!b || !p?.run) return null;
    return { id: b.id, name: p.name, value: lootValue(p.run.items), x: b.x, z: b.z, at: b.at };
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
      respawn: 0, protection: 0, events: [], plan: null, bot: null, run: null, recall: 0,
      tape: new Tape(), deathcam: null, threw: false, light: false,
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
    this.addBot(planOperator(this.world, this.nav, this.botRng, others, taken, this.personality, this.options.thorough), 'operator');
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

  /** (Re)spawn a player with full health and ammo: bots at their post, humans at an insertion point. */
  private spawn(p: Player): void {
    let post: Post;
    if (p.plan) post = p.plan.spawn;
    else {
      const others = [...this.players.values()].filter((o) => o !== p && o.team === 'operator' && !o.dead);
      const at = insertionPoint(this.world, this.nav, this.spawnRng, others);
      post = { ...at, yaw: yawToward(at.x, at.z, 0, 0) };
    }
    const carry = p.run ? lootMass(p.run.items) : 0;
    Object.assign(p, spawnState(post.x, post.y, post.z), { yaw: post.yaw, pitch: 0, carry, life: p.life + 1 });
    if (p.team === 'guard') p.hp = GUARD_HP;
    p.respawn = 0;
    p.protection = p.plan ? 0 : SPAWN_PROTECTION;
    p.queue = [];
    if (p.plan) {
      const { role, skill, primary } = p.plan;
      p.bot = new Bot(role, role.kind === 'operator' ? SKILLS[skill] : guardSkill(SKILLS[skill]), primary, post.yaw, mulberry32((this.seed ^ Math.imul(p.id, 0x9e3779b1) ^ p.life) >>> 0));
      p.weapon = primary;
    }
  }

  /** Whether a living operator is near `at`, or can see it. */
  private watched(at: Point): boolean {
    for (const o of this.players.values()) {
      if (o.team !== 'operator' || o.dead) continue;
      const d = Math.hypot(o.x - at.x, o.y - at.y, o.z - at.z);
      if (d < RESPAWN_CLEAR) return true;
      if (d < RESPAWN_SIGHT && this.world.hasLineOfSight(o.x, o.y + EYE_HEIGHT, o.z, at.x, at.y + EYE_HEIGHT, at.z)) return true;
    }
    return false;
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
  private noise(x: number, y: number, z: number, radius: number, source: number, who?: (p: Player) => boolean, gunfire = false): void {
    // Rain drowns sounds out.
    radius *= this.ctx.senses.hearing;
    const n: Noise = { x, y, z, radius, source, gunfire };
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
    // Glass doesn't stop a round: it's looked through here, and broken below.
    const { t: wall, panel } = this.world.raycastPanel(ox, oy, oz, dx, dy, dz, w.range, true);
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

    for (let k = 0; k < 4; k++) {
      const pane = this.world.raycastPanel(ox, oy, oz, dx, dy, dz, t);
      if (pane.panel < 0 || pane.t >= t - 1e-6 || this.world.panels[pane.panel].kind !== 'glass') break;
      this.panelsBroke(this.cover.damage(pane.panel, PANEL_HP.glass, this.time), ox, oy, oz, shooter);
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
    this.noise(ox, oy, oz, w.noise * (shot.quiet ? SUPPRESSED_NOISE : 1), shooter.id, undefined, true);
    if (victim) {
      const amount = damageAt(shot.weapon, t, zone) * (shooter.team === 'guard' && zone === 'head' ? GUARD_HEAD_SHARE : 1);
      this.damage(victim, shooter, Math.round(amount), zone, shot.weapon, ex, ey, ez);
    } else if (panel >= 0) this.panelsBroke(this.cover.damage(panel, damageAt(shot.weapon, t, 'torso'), now), ox, oy, oz, shooter);
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
        if (amount > 0) this.damage(p, owner ?? p, amount, 'torso', GRENADE, h.torsoX, chest, h.torsoZ, { x, y, z });
      }
    }
    this.noise(x, y, z, GRENADE_NOISE, g.owner, undefined, true);
    this.panelsBroke(this.cover.blast(x, y, z, now), x, y, z, owner);
  }

  /** `from` is where the damage came from, if not the attacker, such as a grenade. */
  private damage(
    victim: Player, attacker: Player, amount: number, zone: Zone, weapon: number, x: number, y: number, z: number,
    from: { x: number; y: number; z: number } = { x: attacker.x, y: attacker.y + EYE_HEIGHT, z: attacker.z },
  ): void {
    // Thorough operator bots, for the playtest, are never hurt, and don't notice being shot.
    const unhurt = !!this.options.thorough && !!victim.plan && victim.team === 'operator';
    if (victim.protection > 0 || unhurt) amount = 0;
    amount = Math.min(amount, victim.hp);
    victim.hp -= amount;
    if (victim.run && attacker !== victim && amount > 0) {
      victim.run.hitBy.set(attacker.id, { at: this.time, team: attacker.team });
      victim.run.taken[attacker.team === 'guard' ? 'guards' : 'operators'] += amount;
    }
    const killed = victim.hp <= 0;
    attacker.events.push({ k: 'hit', target: victim.id, zone, damage: amount, killed, x, y, z });
    victim.events.push({ k: 'hurt', damage: amount, x: from.x, z: from.z });
    if (attacker !== victim && !unhurt) victim.bot?.hurt(attacker, this.time);
    if (!killed) return;
    victim.dead = true;
    victim.respawn = victim.team === 'guard' && !victim.plan?.temporary ? GUARD_RESPAWN : BODY_TIME;
    victim.vx = victim.vy = victim.vz = 0;
    if (attacker.run && attacker !== victim) {
      if (victim.team === 'operator') attacker.run.kills++;
      else if (victim.team === 'guard') attacker.run.guardKills++;
    }
    const victimKind = kindOf(victim);
    this.broadcast({
      k: 'kill', killer: attacker.id, victim: victim.id, killerName: attacker.name, victimName: victim.name,
      weapon, head: zone === 'head', bounty: victim.id === this.bounty?.id, ...(victimKind ? { victimKind } : {}),
      ...deathPose(victim, x, y, z, from),
    });
    if (victim.plan?.temporary) this.commanderDown(victim, attacker);
    // Killed by their own grenade, they watch it through their own eyes.
    if (!victim.plan) victim.deathcam = { killer: attacker, time: this.time };
    if (victim.run) {
      victim.run.killer = attacker === victim ? '' : attacker.name;
      const kind = attacker === victim ? undefined : kindOf(attacker);
      const death: Death = { by: attacker === victim ? 'self' : attacker.team, weapon, head: zone === 'head', ...(kind ? { kind } : {}) };
      if (attacker !== victim) {
        death.distance = Math.round(Math.hypot(attacker.x - victim.x, attacker.y - victim.y, attacker.z - victim.z));
        const recent = [...victim.run.hitBy.values()].filter((h) => this.time - h.at <= SHOOTERS_WINDOW);
        death.shooters = { guards: recent.filter((h) => h.team === 'guard').length, operators: recent.filter((h) => h.team !== 'guard').length };
      }
      victim.run.death = death;
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

/** An operator bot's personality, or undefined for anyone else. */
function kindOf(p: Player): Personality | undefined {
  return p.plan?.role.kind === 'operator' ? p.plan.role.personality : undefined;
}

function newRun(start: number): Run {
  return {
    start, items: [], kills: 0, guardKills: 0, search: null, useHeld: false, dropHeld: false, zone: -1, hold: 0, killer: '', death: null,
    contracts: [], hitBy: new Map(), taken: { guards: 0, operators: 0 },
  };
}

function poseOf(p: Player): PoseRecord {
  return { id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, duck: p.duck, lean: p.lean, dead: p.dead, life: p.life };
}

/** How everyone else sees a player. */
function snapOf(p: Player): PlayerSnap {
  const { id, team, x, y, z, yaw, pitch, duck, lean, dead, weapon } = p;
  let act: Action = 'none';
  let actT = 0;
  let rounds: number | undefined;
  if (p.reload > 0) {
    act = 'reload';
    actT = 1 - p.reload / WEAPONS[weapon].reloadTime;
    rounds = Math.min(WEAPONS[weapon].magSize - p.mag[weapon], p.reserve[weapon]);
  } else if (p.draw > 0) {
    act = p.threw ? 'throw' : 'draw';
    actT = 1 - p.draw / (p.threw ? THROW_TIME : WEAPONS[weapon].drawTime);
  }
  return {
    id, team, x, y, z, yaw, pitch, duck, lean, dead, weapon,
    quiet: p.suppressed[weapon], motion: motionOf(p), act, actT: clamp(actT, 0, 1), commander: !!p.plan?.commander,
    light: p.light && !dead,
    ...(rounds !== undefined && { rounds }),
  };
}

/**
 * What a kill event says about the fall: where the victim stood, where the
 * killing round or blast struck and the way it went, rounded to the
 * centimetre, so everyone's bodies fall alike.
 */
function deathPose(
  victim: Player, x: number, y: number, z: number, from: { x: number; y: number; z: number },
): Pick<Extract<GameEvent, { k: 'kill' }>, 'pose' | 'at' | 'dir'> {
  // Plus zero, so -0 never reaches atan2, which tells them apart.
  const cm = (v: number) => Math.round(v * 100) / 100 + 0;
  let dx = x - from.x;
  let dy = y - from.y;
  let dz = z - from.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-6) (dx /= d), (dy /= d), (dz /= d);
  else (dx = -Math.sin(victim.yaw)), (dy = 0), (dz = -Math.cos(victim.yaw));
  return {
    pose: [cm(victim.x), cm(victim.y), cm(victim.z), cm(wrapAngle(victim.yaw)), cm(victim.duck)],
    at: [cm(x), cm(y), cm(z)],
    dir: [cm(dx), cm(dy), cm(dz)],
  };
}
