import { describe, expect, it } from 'vitest';
import { beamSpot, Bot, hostile, type Agent, type BotContext, type Role } from '../src/server/bot.ts';
import { NavGrid } from '../src/server/nav.ts';
import { GameServer } from '../src/server/server.ts';
import { SKILLS } from '../src/server/skill.ts';
import { GUARD_HP, GUARD_RESPAWN, OPERATOR_REFILL, SERVER_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { DEFAULT_CONDITIONS, sensesOf, type Senses } from '../src/shared/conditions.ts';
import { yawToward } from '../src/shared/geom.ts';
import type { GameEvent, ServerMsg, Team } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { spawnState, type PlayerState } from '../src/shared/sim.ts';
import { RIFLE } from '../src/shared/weapons.ts';
import { inBuilding, watchtower, World } from '../src/shared/world.ts';
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
    const role: Role = { kind: 'operator', loot: [], planned: 0, greed: 20 };
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

  it('sees someone crouching in the dark under a lamp', () => {
    const near = openGround(35);
    const yaw = yawToward(near.ax, near.az, near.bx, near.bz);
    const sentry: Role = { kind: 'sentry', post: { x: near.ax, y: 0, z: near.az, yaw } };
    const spots = (time: 'night' | 'day', lamp: boolean): number => {
      const enemy = { ...agent(2, 'operator', near.bx, near.bz), crouched: true, duck: 1 };
      const lit = (_: unknown, ctx: BotContext) => (ctx.lamplit = (a) => lamp && a.id === 2);
      return watch(agent(1, 'guard', near.ax, near.az), [enemy], yaw, 3, lit, sentry, sensesOf({ time, weather: 'clear' })).awareness(2);
    };
    expect(spots('night', false)).toBe(0);
    expect(spots('night', true)).toBe(1);
  });

  it('turns toward someone out of sight whose beam lands in view', () => {
    // The enemy stands 12 m behind the sentry and shines past it at the ground 8 m ahead.
    const rand = mulberry32(5);
    let g: ReturnType<typeof openGround>, away: number, sx: number, sy: number, sz: number;
    do {
      const a = world.randomLandPoint(rand);
      away = rand() * Math.PI * 2;
      g = { ax: a.x, az: a.z, bx: a.x + Math.sin(away) * 12, bz: a.z + Math.cos(away) * 12 };
      sx = g.ax - Math.sin(away) * 8;
      sz = g.az - Math.cos(away) * 8;
      sy = world.groundHeight(sx, sz, world.floorHeight(sx, sz));
    } while (![[g.ax, g.az], [g.bx, g.bz], [sx, sz]].every(([x, z]) => nav.dry(x, z)) ||
      !world.hasLineOfSight(g.bx, world.terrainHeight(g.bx, g.bz) + 1.6, g.bz, sx, sy + 0.2, sz));
    const night = sensesOf({ time: 'night', weather: 'clear' });
    const think = (light: boolean): Bot => {
      const self = agent(1, 'guard', g.ax, g.az);
      const enemy = { ...agent(2, 'operator', g.bx, g.bz), light, yaw: away };
      enemy.pitch = Math.atan2(sy - (enemy.y + 1.6), 20);
      const spot = beamSpot(world, enemy);
      expect(spot && Math.hypot(spot.x - sx, spot.z - sz)).toBeLessThan(1);
      const post = { x: g.ax, y: self.y, z: g.az, yaw: away };
      return watch(self, [enemy], away, 1, undefined, { kind: 'sentry', post }, night);
    };
    const dark = think(false);
    expect(dark.awareness(2)).toBe(0);
    expect(dark.state).toBe('patrol');
    const lit = think(true);
    expect(lit.awareness(2)).toBe(0);
    expect(lit.state).toBe('investigate');
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
    expect(after.state.hp).toBe(GUARD_HP);
    expect(sentry.state.hp).toBe(GUARD_HP);
  });
});

describe('guard respawns', () => {
  it('wait while an operator stands near the post, and come back once they leave', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { guards: true });
    const sentry = server.bots().find((b) => b.bot.role.kind === 'sentry')!;
    const players = (server as unknown as { players: Map<number, PlayerState & { respawn: number; protection: number; dead: boolean }> }).players;
    const post = players.get(sentry.id)!;
    const { x, y, z } = post;
    Object.assign(post, { dead: true, respawn: 0.1 });
    // Someone on the tower, where the intel lies, whom nothing hurts.
    const op = players.get(human(server).id)!;
    for (let t = 0; t < 10 * SERVER_TICK_RATE; t++) {
      Object.assign(op, { x: x + 2, y, z, vx: 0, vy: 0, vz: 0, protection: Infinity });
      server.step();
    }
    expect(post.dead).toBe(true);
    Object.assign(op, { x: x + 400, z: z + 400 });
    for (let t = 0; t < 4 * SERVER_TICK_RATE; t++) server.step();
    expect(post.dead).toBe(false);
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

describe('bots and doors', () => {
  /** A doorway into an outpost's building from outside: its first leaf, its middle, and the way in. */
  function doorway() {
    for (const b of world.buildings.filter((h) => h.outpost >= 0)) {
      for (let i = 0; i < world.doors.length; i++) {
        const d = world.doors[i];
        if (!inBuilding(b, d.x, d.z, 0.01) || d.pair < i) continue;
        const x = (d.x + world.doors[d.pair].x) / 2;
        const z = (d.z + world.doors[d.pair].z) / 2;
        if (inBuilding(b, x - d.openX * 2, z - d.openZ * 2)) continue;
        return { i, d, x, z, inX: d.openX, inZ: d.openZ };
      }
    }
    throw new Error('no outside doorway');
  }

  /**
   * A bot walked in through the doorway with `others` about, thinking as it
   * goes: an operator, chased by the first of them, or a guard on its rounds.
   * Whether it shut the door.
   */
  function goIn(others: Agent[], chased: boolean, seed = 7): boolean {
    const { i, d, x, z, inX, inZ } = doorway();
    world.setDoor(i, true);
    world.setDoor(d.pair, true);
    const self = agent(1, chased ? 'operator' : 'guard', x - inX * 1, z - inZ * 1);
    const role: Role = chased
      ? { kind: 'operator', loot: [], planned: 0, greed: 10 }
      : { kind: 'guard', route: [{ x: x + inX * 3, y: self.y, z: z + inZ * 3 }], leash: 100 };
    const bot = new Bot(role, SKILLS.normal, RIFLE, yawToward(self.x, self.z, x, z), mulberry32(seed));
    const all = [self, ...others];
    const ctx: BotContext = {
      world, nav, time: 0, agents: all, agent: (id) => all.find((a) => a.id === id), pathBudget: 10, callout: () => {},
      extracts: [], lootView: () => null, senses: sensesOf(DEFAULT_CONDITIONS), bounty: 0, bags: () => [],
    };
    let shut = -1;
    for (let k = 0; k <= 30; k++) {
      // From a metre out to three in, square through the doorway.
      const f = -1 + (k / 30) * 4;
      self.x = x + inX * f;
      self.z = z + inZ * f;
      ctx.time = k * 0.1;
      if (chased) {
        const g = others[0];
        (bot as unknown as { contacts: Map<number, unknown> }).contacts.set(g.id, {
          level: 1, visible: true, headOnly: false, x: g.x, y: g.y, z: g.z, seenAt: ctx.time, since: 0, threatAt: ctx.time,
        });
      }
      bot.think(ctx, self, 0.1);
      if (bot.shut >= 0) shut = bot.shut;
      bot.shut = -1;
    }
    world.setDoor(i, true);
    world.setDoor(d.pair, true);
    return shut === i || shut === d.pair;
  }

  it('slam a door on a guard chasing them', () => {
    const { x, z, inX, inZ } = doorway();
    const guard = agent(2, 'guard', x - inX * 12, z - inZ * 12);
    for (let seed = 1; seed <= 5; seed++) expect(goIn([guard], true, seed), `seed ${seed}`).toBe(true);
  });

  it('shut a door behind them on their rounds now and then, but not on a friend coming through', () => {
    const { x, z, inX, inZ } = doorway();
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].filter((s) => goIn([], false, s));
    // About as often as GUARD_SHUTS says.
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    expect(seeds.length).toBeLessThanOrEqual(7);
    const friend = agent(3, 'guard', x - inX * 2.5, z - inZ * 2.5);
    for (const seed of seeds) expect(goIn([friend], false, seed), `seed ${seed}`).toBe(false);
  });
});
