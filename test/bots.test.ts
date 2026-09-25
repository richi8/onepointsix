import { describe, expect, it } from 'vitest';
import { Bot, hostile, type Agent, type BotContext, type Role } from '../src/server/bot.ts';
import { NavGrid } from '../src/server/nav.ts';
import { GameServer } from '../src/server/server.ts';
import { SKILLS } from '../src/server/skill.ts';
import { GUARD_RESPAWN, OPERATOR_REFILL, SERVER_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { DEFAULT_CONDITIONS, sensesOf, type Senses } from '../src/shared/conditions.ts';
import { yawToward } from '../src/shared/geom.ts';
import type { GameEvent, ServerMsg, Team } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { spawnState, type PlayerState } from '../src/shared/sim.ts';
import { RIFLE } from '../src/shared/weapons.ts';
import { watchtower, World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const world = new World(DEFAULT_WORLD.seed);
const nav = new NavGrid(world);

function agent(id: number, team: Team, x: number, z: number): Agent {
  return { ...spawnState(x, world.groundHeight(x, z, world.floorHeight(x, z)), z), id, team };
}

/** A clear stretch of open ground: a spot and another `dist` metres away in plain sight. */
function openGround(dist: number): { ax: number; az: number; bx: number; bz: number } {
  const rand = mulberry32(3);
  for (;;) {
    const a = world.randomLandPoint(rand);
    const yaw = rand() * Math.PI * 2;
    const bx = a.x - Math.sin(yaw) * dist;
    const bz = a.z - Math.cos(yaw) * dist;
    const by = world.groundHeight(bx, bz, world.floorHeight(bx, bz));
    if (!nav.dry(a.x, a.z) || !nav.dry(bx, bz)) continue;
    if (!world.hasLineOfSight(a.x, a.y + 1.6, a.z, bx, by + 1.0, bz)) continue;
    if (!world.hasLineOfSight(a.x, a.y + 1.6, a.z, bx, by + 1.6, bz)) continue;
    return { ax: a.x, az: a.z, bx, bz };
  }
}

/** A sentry at `self` facing `yaw`, or a bot in `role`, thinking for `seconds` about the agents given. */
function watch(
  self: Agent, others: Agent[], yaw: number, seconds: number, before?: (bot: Bot, ctx: BotContext) => void,
  role: Role = { kind: 'sentry', post: { x: self.x, y: self.y, z: self.z, yaw } },
  senses: Senses = sensesOf(DEFAULT_CONDITIONS),
) {
  const bot = new Bot(role, SKILLS.normal, RIFLE, yaw, mulberry32(1));
  const all = [self, ...others];
  const ctx: BotContext = {
    world, nav, time: 0, agents: all, agent: (id) => all.find((a) => a.id === id), pathBudget: 10, callout: () => {},
    extracts: [], lootView: () => null, senses, bounty: 0, bags: () => [],
  };
  before?.(bot, ctx);
  for (let t = 0; t < seconds; t += 0.1) {
    ctx.time = t;
    bot.think(ctx, self, 0.1);
  }
  return bot;
}

describe('bot perception', () => {
  const g = openGround(30);

  it('spots an enemy in plain view ahead', () => {
    const self = agent(1, 'guard', g.ax, g.az);
    const enemy = agent(2, 'operator', g.bx, g.bz);
    const bot = watch(self, [enemy], yawToward(g.ax, g.az, g.bx, g.bz), 2);
    expect(bot.awareness(2)).toBe(1);
    expect(bot.state).toBe('engage');
    expect(bot.target).toBe(2);
  });

  it('does not see a still enemy behind it', () => {
    const self = agent(1, 'guard', g.ax, g.az);
    const enemy = agent(2, 'operator', g.bx, g.bz);
    const bot = watch(self, [enemy], yawToward(g.bx, g.bz, g.ax, g.az), 3);
    expect(bot.awareness(2)).toBe(0);
    expect(bot.state).toBe('patrol');
  });

  it('leaves a guard some way off alone as an operator, until it shoots', () => {
    const far = openGround(60);
    const self = agent(1, 'operator', far.ax, far.az);
    const guard = agent(2, 'guard', far.bx, far.bz);
    const role: Role = { kind: 'operator', loot: [], greed: 20 };
    const yaw = yawToward(far.ax, far.az, far.bx, far.bz);
    const calm = watch(self, [guard], yaw, 3, undefined, role);
    expect(calm.awareness(2)).toBe(1);
    expect(calm.state).toBe('extract');
    const shot = watch(self, [guard], yaw, 3, (bot) => bot.hurt(guard, 0), role);
    expect(shot.target).toBe(2);
    expect(['engage', 'cover']).toContain(shot.state);
  });

  it('ignores friends', () => {
    const self = agent(1, 'guard', g.ax, g.az);
    const bot = watch(self, [agent(2, 'guard', g.bx, g.bz)], yawToward(g.ax, g.az, g.bx, g.bz), 2);
    expect(bot.awareness(2)).toBe(0);
  });

  it('knows who is hostile', () => {
    const [op, op2, guard, guard2] = [agent(1, 'operator', 0, 0), agent(2, 'operator', 0, 0), agent(3, 'guard', 0, 0), agent(4, 'guard', 0, 0)];
    expect(hostile(op, op2)).toBe(true);
    expect(hostile(op, guard)).toBe(true);
    expect(hostile(guard, op)).toBe(true);
    expect(hostile(guard, guard2)).toBe(false);
    expect(hostile(op, op)).toBe(false);
  });

  it('does not see through a wall', () => {
    const wall = world.walls.find((b) => world.outposts.some((o) => Math.abs(b.maxY - o.y - 3) < 1e-6) && b.maxX - b.minX > 5)!;
    const x = (wall.minX + wall.maxX) / 2;
    const self = agent(1, 'guard', x, wall.maxZ + 3);
    const enemy = agent(2, 'operator', x, wall.minZ - 3);
    const bot = watch(self, [enemy], 0, 3);
    expect(bot.awareness(2)).toBe(0);
  });

  it('turns to investigate a gunshot', () => {
    const self = agent(1, 'guard', g.ax, g.az);
    const bot = watch(self, [], 0, 0.5, (b, ctx) => b.hear(self, { x: g.bx, y: 0, z: g.bz, radius: 180, source: 9 }, ctx.time));
    expect(bot.state).toBe('investigate');
  });

  it('sees less far at night and in fog, except someone with a light on', () => {
    const far = openGround(60);
    const yaw = yawToward(far.ax, far.az, far.bx, far.bz);
    const sentry: Role = { kind: 'sentry', post: { x: far.ax, y: 0, z: far.az, yaw } };
    const spots = (senses: Senses, light: boolean): number => {
      const enemy = { ...agent(2, 'operator', far.bx, far.bz), light };
      return watch(agent(1, 'guard', far.ax, far.az), [enemy], yaw, 3, undefined, sentry, senses).awareness(2);
    };
    const night = sensesOf({ time: 'night', weather: 'clear' });
    const fog = sensesOf({ time: 'day', weather: 'fog' });
    expect(spots(night, false)).toBe(0);
    expect(spots(night, true)).toBe(1);
    expect(spots(fog, false)).toBe(0);
    // A light doesn't cut through fog.
    expect(spots(fog, true)).toBe(0);
    expect(spots(sensesOf({ time: 'day', weather: 'rain' }), false)).toBe(1);
  });

  it('sees someone crouching in the dark only in its own beam', () => {
    const near = openGround(35);
    const yaw = yawToward(near.ax, near.az, near.bx, near.bz);
    const sentry: Role = { kind: 'sentry', post: { x: near.ax, y: 0, z: near.az, yaw } };
    const night = sensesOf({ time: 'night', weather: 'clear' });
    const spots = (light: boolean): number => {
      const self = { ...agent(1, 'guard', near.ax, near.az), light };
      const enemy = { ...agent(2, 'operator', near.bx, near.bz), crouched: true, duck: 1 };
      return watch(self, [enemy], yaw, 3, undefined, sentry, night).awareness(2);
    };
    expect(spots(false)).toBe(0);
    expect(spots(true)).toBe(1);
  });

  it('knows where a shooter it cannot see is once hit', () => {
    const self = agent(1, 'guard', g.ax, g.az);
    const enemy = agent(2, 'operator', g.bx, g.bz);
    const bot = watch(self, [enemy], yawToward(g.bx, g.bz, g.ax, g.az), 0.3, (b, ctx) => b.hurt(enemy, ctx.time));
    expect(bot.awareness(2)).toBe(1);
    expect(bot.target).toBe(2);
  });
});

/** Server internals, for putting bodies where a test needs them. */
function body(server: GameServer, id: number): PlayerState {
  return (server as unknown as { players: Map<number, PlayerState> }).players.get(id)!;
}

function human(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: 'human', world: DEFAULT_WORLD, mode: 'offline' });
  return { id, events: (): GameEvent[] => inbox.flatMap((m) => (m.t === 'events' ? m.events : [])) };
}

describe('guards', () => {
  it('man every outpost and patrol between them', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { guards: true });
    const bots = server.bots();
    expect(bots.every((b) => b.team === 'guard')).toBe(true);
    expect(bots.filter((b) => b.bot.role.kind === 'sentry')).toHaveLength(world.outposts.length);
    expect(bots.length).toBeGreaterThanOrEqual(20);
    expect(bots.filter((b) => b.bot.role.kind === 'guard' && b.bot.role.leader)).not.toHaveLength(0);
  });

  it('defend their outpost against an intruder', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { guards: true });
    const h = human(server);
    const o = server.world.outposts[0];
    // Out in the open, where the sentry in the watchtower can see.
    const tower = watchtower(o);
    const spot = [...Array(40).keys()]
      .map((i) => server.nav.nearestWalkable(o.x + Math.sin(i) * (3 + i / 8), o.z + Math.cos(i) * (3 + i / 8))!)
      .find((p) => p && server.world.hasLineOfSight(tower.x, tower.y + 1.6, tower.z, p.x, o.y + 1.2, p.z))!;
    for (let t = 0; t < SERVER_TICK_RATE * 20; t++) {
      const me = body(server, h.id);
      if (t === 0) Object.assign(me, { x: spot.x, z: spot.z, y: server.world.groundHeight(spot.x, spot.z, o.y) });
      server.step();
      if (me.dead) break;
    }
    const kill = h.events().find((e) => e.k === 'kill' && e.victim === h.id);
    expect(kill).toBeDefined();
    expect(server.bots().find((b) => kill?.k === 'kill' && b.id === kill.killer)?.team).toBe('guard');
  });

  it('are more and tougher at night, and carry their flashlights lit', () => {
    const day = new GameServer(DEFAULT_WORLD.seed, { guards: true });
    const night = new GameServer(DEFAULT_WORLD.seed, { guards: true, conditions: { time: 'night', weather: 'clear' } });
    expect(night.bots().length).toBeGreaterThan(day.bots().length);
    const easy = (s: GameServer) => s.bots().filter((b) => b.bot.skill.name === 'easy').length;
    expect(easy(day)).toBeGreaterThan(0);
    expect(easy(night)).toBe(0);
    const lit = (s: GameServer) => {
      const h = human(s);
      for (let t = 0; t < 3; t++) s.step();
      const players = (s as unknown as { players: Map<number, { light: boolean }> }).players;
      return s.bots().filter((b) => players.get(b.id)!.light).length + (players.get(h.id)!.light ? 100 : 0);
    };
    expect(lit(day)).toBe(0);
    expect(lit(night)).toBe(night.bots().length);
  });

  it('come back to their post after being killed', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { guards: true });
    const sentry = server.bots().find((b) => b.bot.role.kind === 'sentry')!;
    Object.assign(body(server, sentry.id), { dead: true });
    (server as unknown as { players: Map<number, { respawn: number }> }).players.get(sentry.id)!.respawn = GUARD_RESPAWN;
    for (let t = 0; t < GUARD_RESPAWN * SERVER_TICK_RATE + 2; t++) server.step();
    const after = server.bots().find((b) => b.id === sentry.id)!;
    expect(after.state.dead).toBe(false);
    expect(after.bot).not.toBe(sentry.bot);
  });
});

describe('operator bots', () => {
  it('fill the empty operator slots', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { operators: 5 });
    expect(server.bots().filter((b) => b.team === 'operator')).toHaveLength(5);
    const names = server.bots().map((b) => b.name);
    expect(new Set(names).size).toBe(5);
  });

  it('loot, extract and are replaced by a new bot', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { operators: 1, personality: 'looter' });
    const [op] = server.bots();
    expect(op.bot.role.kind === 'operator' && op.bot.role.loot.length).toBeGreaterThan(0);
    let extract: GameEvent | undefined;
    server.onEvent = (e) => (extract ??= e.k === 'extract' ? e : undefined);
    for (let t = 0; t < SERVER_TICK_RATE * 300 && !extract; t++) server.step();
    expect(extract).toMatchObject({ k: 'extract', id: op.id });
    expect(extract?.k === 'extract' && extract.value).toBeGreaterThan(0);
    const operators = () => server.bots().filter((b) => b.team === 'operator');
    expect(operators()).toHaveLength(0);
    for (let t = 0; t < SERVER_TICK_RATE * OPERATOR_REFILL + 1; t++) server.step();
    expect(operators()).toHaveLength(1);
    expect(operators()[0].id).not.toBe(op.id);
  });
});

describe('bots in play', () => {
  it('act only through commands, so the same seed plays out the same', () => {
    const run = () => {
      const server = new GameServer(DEFAULT_WORLD.seed, { guards: true, operators: 12 });
      const kills: string[] = [];
      server.onEvent = (e) => e.k === 'kill' && kills.push(`${server.tick}:${e.killer}>${e.victim}`);
      for (let t = 0; t < SERVER_TICK_RATE * 30; t++) server.step();
      return { kills, states: server.bots().map((b) => [b.id, b.state.x, b.state.z, b.state.hp, b.bot.state]) };
    };
    const a = run();
    expect(a.kills.length).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });

  it('keep well within the tick budget with the full population', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { guards: true, operators: 12 });
    const start = performance.now();
    const ticks = SERVER_TICK_RATE * 60;
    for (let t = 0; t < ticks; t++) server.step();
    expect((performance.now() - start) / ticks).toBeLessThan(SERVER_DT * 1000 * 0.25);
  });
});
