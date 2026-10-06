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
  DEATHMATCH_BOT_RESPAWN,
  DEATHMATCH_RESPAWN_WAIT,
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
  REINFORCE_DELAY,
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
import { Forecast, mainWeather, sensesOf, type Weather, type WeatherNow } from '../shared/weather.ts';
import { angleDiff, clamp, lerp, wrapAngle, yawToward } from '../shared/geom.ts';
import { launchGrenade, stepGrenade, type Grenade } from '../shared/grenade.ts';
import { hitboxes, rayBody, type Pose, type Zone } from '../shared/hitbox.ts';
import { ITEMS, lootMass, lootValue, MEDKIT_HEAL, runScore } from '../shared/loot.ts';
import type {
  Action, BagSnap, BoardRow, BountyView, ClientMsg, Death, DevCmd, ExtractView, GameEvent, GrenadeSnap, InputCmd, LootView, Mode, PlayerSnap, RunView, ServerMsg, Team,
} from '../shared/protocol.ts';
import { validPlayerId } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { RunEndEvent } from '../shared/runstats.ts';
import { applyCmd, copyState, eyePosition, motionOf, spawnState, type PlayerState } from '../shared/sim.ts';
import { Tape } from '../shared/tape.ts';
import { damageAt, GRENADE, spawnWeapons, WEAPONS, type Shot, type Toss } from '../shared/weapons.ts';
import { bagShows, vegetationOf } from '../shared/vegetation.ts';
import { mapFor, type GameMap } from '../shared/maps/index.ts';
import { World, type Box, type Point } from '../shared/world.ts';
import { Bot, hostile, type Agent, type BotContext, type Noise, type Post } from './bot.ts';
import { Containers } from './containers.ts';
import { contractReward, contractView, planContracts, reachesIntel, type Contract } from './contracts.ts';
import { Cover } from './cover.ts';
import { Extracts } from './extracts.ts';
import { NavGrid } from './nav.ts';
import {
  arenaPoint, insertionPoint, planCommander, planFighter, planGuards, planOperator, planResponse, reinforcementPoint, type BotPlan,
} from './population.ts';
import { ACTOR_RESPAWN, Actor, planRange } from './range.ts';
import type { Personality } from './personality.ts';
import { guardSkill, SKILLS } from './skill.ts';

/** Commands buffered beyond this are dropped; the client is too far ahead. */
const MAX_QUEUED_CMDS = MAX_CMDS_PER_TICK * 4;
const HISTORY_TICKS = Math.ceil(MAX_REWIND * SERVER_TICK_RATE) + 2;
/** Bots think every this many ticks, staggered so only some think each tick. */
const THINK_TICKS = 3;
/** Path searches all bots together may start per tick. */
const PATH_BUDGET = 6;
/** Milliseconds a tick spends working out a map's paths ahead (see NavGrid.warm), until they all are. */
const WARM_MS = 4;
/** Guards this close to one who spots an enemy hear the callout. */
const CALLOUT_RANGE = 60;
/** Guards this close to a called extraction hear the call. */
const CALL_NOISE = 180;
/** Seconds after a pickup lands before its response squad is recalled. */
const RESPONSE_STAY = 60;
/** Bots this close to where a hostile grenade settles take it as incoming fire. */
const GRENADE_SCARE = 8;
/** Seconds a shot fired keeps Deathmatch's spawns on a map away from it. */
const FIGHT_FRESH = 6;

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
  /** Whose record on the scoreboard a human's play counts toward: the id from their hello. */
  player: string;
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
  /** Set for bots: the plan it was made from, and the bot for its current life, or on the range the actor. */
  plan: BotPlan | null;
  bot: Bot | null;
  actor: Actor | null;
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
}

/** A player's kills, deaths and scores over a game; see BoardRow. */
interface Tally {
  kills: number;
  deaths: number;
  best: number;
  total: number;
}

interface PoseRecord extends Pose {
  id: number;
  dead: boolean;
  life: number;
}

export interface ServerOptions {
  /** How the game is played, as told to clients (default 'extraction'). */
  mode?: Mode;
  /**
   * Everyone against everyone: no extraction, run clock or contracts, crates holding only ammo
   * and medkits, and the dead back in at a spot away from the others (default false).
   */
  deathmatch?: boolean;
  /** Post guards at the outposts and send patrols between them (default false). */
  guards?: boolean;
  /** Hold this weather all game, for tests and the playtest (default the island's own, changing). */
  weather?: Weather;
  /** Operator slots, filled by bots where no player takes them (default 0, no operator bots). */
  operators?: number;
  /** Every operator bot plays this way, for tests (default a personality at random for each). */
  personality?: Personality;
  /**
   * Operator bots loot as thoroughly as a person and can't be killed, so the
   * playtest can read how long a run lasts that isn't cut short by death.
   */
  thorough?: boolean;
  /** The range: actors round outpost 0, players unhurt and their run's clock stopped (see range.ts). */
  range?: boolean;
  /** Played on this map in place of the mode's world, as a test map is in development (default the mode's). */
  map?: GameMap;
}

/**
 * The authoritative game. It knows nothing about Workers or sockets: a host
 * calls connect/receive/disconnect and drives tick() at SERVER_TICK_RATE.
 */
export class GameServer {
  readonly seed: number;
  readonly mode: Mode;
  /** The island's weather over the game. */
  readonly forecast: Forecast;
  readonly world: World;
  readonly nav: NavGrid;
  /** Whether a map's paths are all worked out ahead (see NavGrid.warm). */
  private warm = false;
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
  /** When each operator slot emptied by a bot leaving gets filled again, soonest first. */
  private readonly refills: number[] = [];
  /** On the range: where players drop in, and the actors' ids, in the order of their specs. */
  private rangeSpawn: Post | null = null;
  private readonly actorIds: number[] = [];
  private readonly ctx: BotContext;
  /** Where everyone stood at the end of each recent tick, oldest first, for rewinding shots. */
  private readonly history: { tick: number; poses: PoseRecord[] }[] = [];
  /** In Deathmatch on a map: where shots were fired lately, kept FIGHT_FRESH seconds, which nobody is spawned near. */
  private readonly fights: (Point & { at: number })[] = [];
  /**
   * Each player's record over the game, by the id from their hello, kept across their runs for as
   * long as the game goes on, so leaving and joining again carries on where they were.
   */
  private readonly tallies = new Map<string, Tally>();
  /** The scoreboard changed and goes out to every player this tick. */
  private boardChanged = false;
  private nextId = 1;
  private nextGrenade = 1;
  /** How it was set up. */
  private readonly options: ServerOptions;

  constructor(seed: number, options: ServerOptions = {}) {
    this.seed = seed >>> 0;
    this.options = options;
    this.mode = options.mode ?? 'extraction';
    this.forecast = new Forecast(this.seed, options.weather);
    this.world = new World(this.seed, options.map ?? mapFor(this.mode));
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
    this.botRng = mulberry32(this.seed ^ 0x68e31da4);
    this.contractRng = mulberry32(this.seed ^ 0x3c6ef372);
    this.bountyRng = mulberry32(this.seed ^ 0x2545f491);
    this.nav = new NavGrid(this.world);
    // Paint the ground now rather than on the first bot's first look.
    vegetationOf(this.world);
    this.containers = new Containers(this.world, mulberry32(this.seed ^ 0x27d4eb2f), !!options.deathmatch);
    this.extracts = new Extracts(this.world, mulberry32(this.seed ^ 0x165667b1), !!options.deathmatch);
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
      senses: sensesOf(this.forecast.at(0)),
      bounty: 0,
      bags: () => (this.bagList ??= this.containers.bags()),
      carried: (a) => {
        const run = players.get(a.id)?.run;
        return run ? lootValue(run.items) : 0;
      },
    };
    if (options.guards) {
      const plans = planGuards(this.world, this.nav, this.botRng);
      const ids = plans.map((plan) => this.addBot(plan, 'guard').id);
      // Bots share their plan's role, so followers learn their leader's id here.
      for (const plan of plans) if (plan.follows !== undefined && plan.role.kind === 'guard') plan.role.leader = ids[plan.follows];
    }
    while (this.operatorCount() < this.operatorSlots) this.addOperatorBot();
    if (options.range) {
      const { actors, spawn } = planRange(this.world, this.nav);
      this.rangeSpawn = spawn;
      for (const spec of actors) {
        const plan: BotPlan = { name: spec.name, role: { kind: 'actor', spec }, skill: 'normal', primary: spec.weapon, spawn: spec.post, commander: spec.commander };
        this.actorIds.push(this.addBot(plan, spec.team).id);
      }
    }
  }

  get time(): number {
    return this.tick * SERVER_DT;
  }

  /** The weather now. */
  get weather(): WeatherNow {
    return this.forecast.at(this.time);
  }

  connect(send: (msg: ServerMsg) => void): number {
    const p = this.add('player', 'operator', send);
    p.run = newRun(this.time);
    this.spawn(p);
    if (!this.options.range && !this.options.deathmatch) this.assignContracts(p);
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
        // No id, or a bad one, keeps a record for this run alone.
        p.player = validPlayerId(msg.player) ? msg.player : `run-${p.id}`;
        this.boardChanged = true;
        p.send({
          t: 'welcome', id, seed: this.seed, tick: this.tick, tickRate: SERVER_TICK_RATE, mode: this.mode,
          broken: this.world.brokenPanels(),
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
      case 'respawn':
        // Back in at once, at the next tick, the death cam watched or skipped.
        if (this.options.deathmatch && p.dead) p.respawn = 0;
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
      case 'rival': {
        if (!rival) return;
        // 8 m ahead, or the nearest way round it where a bag it dropped would show, not in grass or behind a rock,
        // even a step or two from where it stands, as it may walk on before it's killed.
        const eye = eyePosition(this.world, p.x, p.y, p.z, p.yaw, p.duck, p.lean);
        const shows = (x: number, z: number): boolean => [[0, 0], ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.sin(k * Math.PI / 4) * 1.5, Math.cos(k * Math.PI / 4) * 1.5])]
          .every(([dx, dz]) => bagShows(this.world, eye.x, eye.y, eye.z, x + dx, this.world.floorHeight(x + dx, z + dz), z + dz));
        let at = { x: p.x - Math.sin(p.yaw) * 8, z: p.z - Math.cos(p.yaw) * 8 };
        search: for (const d of [8, 6, 10, 5, 12]) {
          for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
            const x = p.x - Math.sin(p.yaw + turn) * d;
            const z = p.z - Math.cos(p.yaw + turn) * d;
            if (shows(x, z)) {
              at = { x, z };
              break search;
            }
          }
        }
        rival.x = at.x;
        rival.z = at.z;
        rival.y = this.world.floorHeight(rival.x, rival.z);
        rival.vx = rival.vy = rival.vz = 0;
        rival.yaw = Math.atan2(-(p.x - rival.x), -(p.z - rival.z));
        rival.tape.sync(rival);
        break;
      }
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
    ctx.senses = sensesOf(this.forecast.at(now));
    ctx.coming = this.forecast.next(now);
    this.bagList = null;
    for (const p of this.players.values()) {
      if (p.actor && !p.dead) this.act(p, p.actor, now);
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
        if (p.run && !p.dead) this.use(p, cmd.buttons);
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
    // Where each outpost's replacements set off from this tick, and how many have.
    const staging = new Map<number, { at: Point | null; n: number }>();
    for (const p of [...this.players.values()]) {
      p.protection = Math.max(p.protection - SERVER_DT, 0);
      if (p.bot?.done || (p.recall > 0 && now >= p.recall && !p.dead)) {
        this.leave(p);
        continue;
      }
      if (p.run && !p.dead && !this.options.deathmatch) this.runStep(p, landed);
      if (p.deathcam && now >= p.deathcam.time + DEATHCAM_AFTER) this.sendDeathcam(p);
      if (!p.dead || !this.players.has(p.id)) continue;
      p.respawn -= SERVER_DT;
      if (p.respawn > 0) continue;
      // In Deathmatch everyone is back in somewhere away from the others, afresh.
      if (this.options.deathmatch) {
        p.run = newRun(now);
        p.deathcam = null;
        this.spawn(p);
        continue;
      }
      // A fallen operator's run is over, as is a response guard's job. An outpost's guard is replaced
      // by one running in from away; a patrol at its route's start, but not in front of an operator:
      // it waits until nobody is close to it or sees it.
      if (p.run || p.plan?.temporary) this.leave(p);
      else if (p.plan?.outpost !== undefined) this.reinforce(p, p.plan.outpost, staging);
      else if (p.plan && !p.actor && this.watched(p.plan.spawn)) p.respawn = RESPAWN_RETRY;
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
    if (this.boardChanged) {
      this.boardChanged = false;
      const rows = this.board();
      for (const p of joined) if (!p.plan) p.events.push({ k: 'board', rows });
    }
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
    // A map's paths worked out ahead, in what's left of the tick.
    if (!this.warm && this.world.map) this.warm = this.nav.warm(WARM_MS);
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
  }

  /**
   * An actor's tick on the range: back on its post at the start of each loop,
   * its commands, and a shooter's shot that missed made good.
   */
  private act(p: Player, actor: Actor, now: number): void {
    const spec = actor.spec;
    if (actor.due(now)) {
      Object.assign(p, spawnState(spec.post.x, spec.post.y, spec.post.z), { yaw: spec.post.yaw, pitch: 0, life: p.life + 1, hp: p.hp });
      p.hp = p.team === 'guard' ? GUARD_HP : MAX_HP;
      p.weapon = spec.weapon;
      p.carry = spec.carry ?? 0;
      p.queue = [];
      p.tape.sync(p);
      actor.restart(now);
    }
    const target = spec.target !== undefined ? this.players.get(this.actorIds[spec.target]) : undefined;
    p.queue.push(...actor.commands(p, target, now, p.lastSim));
    if (target && !target.dead && actor.madeGood(now)) {
      const h = hitboxes(target);
      this.damage(target, p, target.hp, 'torso', p.weapon, h.torsoX, (h.hipY + h.neckY) / 2, h.torsoZ);
    }
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
    // On the range the clock stands still.
    if (this.options.range) run.start = this.time;
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
      death: outcome === 'killed' ? run.death : null, taken: { ...run.taken }, weather: mainWeather(this.weather),
    };
    p.events.push(end);
    this.onRunEnd?.(end, p.plan);
    const tally = this.tallyOf(p);
    if (tally && outcome === 'extracted') {
      tally.best = Math.max(tally.best, score);
      tally.total += score;
    }
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

  // -------------------------------------------------------------- scoreboard

  /**
   * A player's record, marked as changing; null for bots but in Deathmatch, and on the range,
   * where nothing counts. A record is kept by the player's id, so their next run carries it on,
   * under whatever name.
   */
  private tallyOf(p: Player): Tally | null {
    if ((p.plan && !this.options.deathmatch) || !p.joined || this.options.range) return null;
    let tally = this.tallies.get(p.player);
    if (!tally) this.tallies.set(p.player, (tally = { kills: 0, deaths: 0, best: 0, total: 0 }));
    this.boardChanged = true;
    return tally;
  }

  /**
   * Every player in the game now, bots left out, highest total score first; in Deathmatch every
   * operator, bots too, most kills first.
   */
  private board(): BoardRow[] {
    const rows: BoardRow[] = [];
    const dm = !!this.options.deathmatch;
    for (const p of this.players.values()) {
      if ((p.plan && !(dm && p.team === 'operator')) || !p.joined) continue;
      const t = this.tallies.get(p.player) ?? { kills: 0, deaths: 0, best: 0, total: 0 };
      rows.push({ id: p.id, name: p.name, ...t });
    }
    if (dm) return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    return rows.sort((a, b) => b.total - a.total || b.best - a.best || b.kills - a.kills || a.deaths - b.deaths);
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

  /** One of an outpost's guards died: if none is left standing there, replacements come soon. */
  private outpostDown(outpost: number): void {
    const home = this.world.outposts[outpost];
    const garrison = [...this.players.values()].filter((p) => p.plan?.outpost === outpost);
    const standing = (p: Player) => !p.dead && (p.plan?.outpost === outpost || (p.plan?.commander && p.plan.role.kind === 'guard' && p.plan.role.home === home));
    if ([...this.players.values()].some(standing)) return;
    for (const p of garrison) p.respawn = Math.min(p.respawn, REINFORCE_DELAY);
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
      ...spawnState(0, 0, 0), id: this.nextId++, name, team, send, joined: false, player: '', queue: [], lastRecv: 0, lastSim: 0,
      respawn: 0, protection: 0, events: [], plan: null, bot: null, actor: null, run: null, recall: 0,
      tape: new Tape(), deathcam: null, threw: false,
    };
    this.players.set(p.id, p);
    return p;
  }

  private addBot(plan: BotPlan, team: Team): Player {
    const p = this.add(plan.name, team, () => {});
    p.joined = true;
    p.plan = plan;
    // In Deathmatch a bot has a line on the scoreboard, for as long as it's in the game.
    if (this.options.deathmatch) {
      p.player = `bot-${p.id}`;
      this.boardChanged = true;
    }
    if (team === 'operator' && plan.role.kind !== 'actor') p.run = newRun(this.time);
    this.spawn(p);
    return p;
  }

  /** A new operator bot drops in somewhere quiet. */
  private addOperatorBot(): void {
    const others = [...this.players.values()].filter((p) => p.team === 'operator' && !p.dead);
    const taken = new Set(others.map((p) => p.name));
    if (this.options.deathmatch) this.addBot(planFighter(this.world, this.nav, this.botRng, others, taken), 'operator');
    else this.addBot(planOperator(this.world, this.nav, this.botRng, others, taken, this.personality, this.options.thorough), 'operator');
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
    if (p.joined && (!p.plan || this.options.deathmatch)) this.boardChanged = true;
    if (p.run) this.dismiss(p.run);
    // Whatever happened this tick still reaches them, such as how their run ended.
    if (p.events.length) p.send({ t: 'events', tick: this.tick, events: p.events });
    p.events = [];
    if (p.team === 'operator') this.refills.push(this.time + OPERATOR_REFILL);
  }

  /** (Re)spawn a player with full health and ammo: bots at their post or `at`, humans at an insertion point. */
  private spawn(p: Player, at?: Post): void {
    let post: Post;
    if (at) post = at;
    else if (this.options.deathmatch) {
      // Players and bots alike, anywhere nobody still standing is near or sees: on a map, at its spawn points.
      const others = [...this.players.values()].filter((o) => o !== p && o.team === 'operator' && !o.dead);
      post = arenaPoint(this.world, this.nav, this.spawnRng, others, this.fights.filter((f) => this.time - f.at <= FIGHT_FRESH));
    } else if (p.plan) post = p.plan.spawn;
    else if (this.rangeSpawn) post = this.rangeSpawn;
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
    if (p.plan?.role.kind === 'actor') {
      p.actor = new Actor(p.plan.role.spec, this.world);
      p.actor.restart(this.time);
      p.weapon = p.plan.primary;
      p.carry = p.plan.role.spec.carry ?? 0;
    } else if (p.plan) {
      const { role, skill, primary } = p.plan;
      p.bot = new Bot(role, role.kind === 'operator' ? SKILLS[skill] : guardSkill(SKILLS[skill]), primary, post.yaw, mulberry32((this.seed ^ Math.imul(p.id, 0x9e3779b1) ^ p.life) >>> 0));
      p.weapon = primary;
    }
  }

  /**
   * Replace a fallen outpost guard with one that sets off from somewhere away
   * from the outpost that no operator is near or sees, and runs to it. Those
   * replaced in the same tick set off together.
   */
  private reinforce(p: Player, outpost: number, staging: Map<number, { at: Point | null; n: number }>): void {
    const o = this.world.outposts[outpost];
    let group = staging.get(outpost);
    if (!group) staging.set(outpost, (group = { at: reinforcementPoint(this.world, this.nav, this.botRng, o, (q) => !this.watched(q)), n: 0 }));
    if (!group.at) {
      p.respawn = RESPAWN_RETRY;
      return;
    }
    const k = group.n++;
    const w = this.nav.nearestWalkable(group.at.x + ((k % 3) - 1) * 2, group.at.z + Math.floor(k / 3) * 2, 5) ?? group.at;
    const y = this.world.groundHeight(w.x, w.z, this.world.floorHeight(w.x, w.z));
    this.spawn(p, { x: w.x, y, z: w.z, yaw: yawToward(w.x, w.z, o.x, o.z) });
    p.bot!.inbound = o;
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
   * bot within it hears it, or only those `who` picks. A friend's
   * footsteps are nothing to look into, though their gunfire is.
   */
  private noise(x: number, y: number, z: number, radius: number, source: number, who?: (p: Player) => boolean, gunfire = false): void {
    // Rain drowns sounds out.
    radius *= this.ctx.senses.hearing;
    const n: Noise = { x, y, z, radius, source, gunfire };
    if (gunfire && this.options.deathmatch && this.world.map) {
      while (this.fights.length && this.time - this.fights[0].at > FIGHT_FRESH) this.fights.shift();
      this.fights.push({ x, y, z, at: this.time });
    }
    const from = this.players.get(source);
    for (const p of this.players.values()) {
      if (!p.bot || p.dead || (who && !who(p)) || Math.hypot(p.x - x, p.z - z) > radius) continue;
      if (!gunfire && from && !hostile(p, from)) continue;
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
    // Nor is anyone on the range, but the actors.
    const unhurt = (!!this.options.thorough && !!victim.plan && victim.team === 'operator') || (!!this.options.range && !victim.plan);
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
    if (this.options.deathmatch) victim.respawn = victim.plan ? DEATHMATCH_BOT_RESPAWN : DEATHMATCH_RESPAWN_WAIT;
    else victim.respawn = victim.actor ? ACTOR_RESPAWN : victim.team === 'guard' && !victim.plan?.temporary ? GUARD_RESPAWN : BODY_TIME;
    victim.vx = victim.vy = victim.vz = 0;
    if (attacker.run && attacker !== victim) {
      if (victim.team === 'operator') attacker.run.kills++;
      else if (victim.team === 'guard') attacker.run.guardKills++;
    }
    const tally = attacker === victim ? null : this.tallyOf(attacker);
    if (tally) tally.kills++;
    const dying = this.tallyOf(victim);
    if (dying) dying.deaths++;
    const victimKind = kindOf(victim);
    this.broadcast({
      k: 'kill', killer: attacker.id, victim: victim.id, killerName: attacker.name, victimName: victim.name,
      weapon, head: zone === 'head', bounty: victim.id === this.bounty?.id, ...(victimKind ? { victimKind } : {}),
      ...deathPose(victim, x, y, z, from),
    });
    if (victim.plan?.temporary) this.commanderDown(victim, attacker);
    if (victim.plan?.outpost !== undefined) this.outpostDown(victim.plan.outpost);
    // Killed by their own grenade, they watch it through their own eyes.
    if (!victim.plan) victim.deathcam = { killer: attacker, time: this.time };
    // In Deathmatch there's no run to end: they're back in once respawned.
    if (victim.run && !this.options.deathmatch) {
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

/** An operator bot's personality, or undefined for anyone else, and in Deathmatch, where they all hunt. */
function kindOf(p: Player): Personality | undefined {
  return p.plan?.role.kind === 'operator' && !p.plan.role.supplies ? p.plan.role.personality : undefined;
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
