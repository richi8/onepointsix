import { describe, expect, it } from 'vitest';
import { Bot, tally, type Agent, type BotContext, type Role } from '../src/server/bot.ts';
import { Containers } from '../src/server/containers.ts';
import { Extracts } from '../src/server/extracts.ts';
import { NavGrid } from '../src/server/nav.ts';
import { PERSONALITIES, TEMPERS, type Personality } from '../src/server/personality.ts';
import { planOperator } from '../src/server/population.ts';
import { GameServer } from '../src/server/server.ts';
import { SKILLS } from '../src/server/skill.ts';
import { BOUNTY_MIN, BOUNTY_PING, CROUCH_EYE_HEIGHT, EYE_HEIGHT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { sensesOf, settled, type WeatherNow } from '../src/shared/weather.ts';
import { ITEMS, lootValue } from '../src/shared/loot.ts';
import type { BagSnap, GameEvent, ServerMsg, Team } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { spawnState, type PlayerState } from '../src/shared/sim.ts';
import { bagShows, CONCEALED, vegetationOf } from '../src/shared/vegetation.ts';
import { hitboxes } from '../src/shared/hitbox.ts';
import { yawToward } from '../src/shared/geom.ts';
import { RIFLE } from '../src/shared/weapons.ts';
import { World, type Point } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const world = new World(DEFAULT_WORLD.seed);
const nav = new NavGrid(world);
const GOLD = ITEMS.findIndex((i) => i.name === 'Gold bar');

function agent(id: number, team: Team, x: number, z: number): Agent {
  return { ...spawnState(x, world.groundHeight(x, z, world.floorHeight(x, z)), z), id, team };
}

/** A dry spot at least `far` metres from every outpost. */
function openSpot(far: number, seed = 5): { x: number; z: number } {
  const rand = mulberry32(seed);
  for (;;) {
    const p = world.randomLandPoint(rand);
    if (nav.dry(p.x, p.z) && world.outposts.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > far)) return p;
  }
}

function context(agents: Agent[], bags: BagSnap[] = [], bounty = 0): BotContext {
  return {
    world, nav, time: 0, agents, agent: (id) => agents.find((a) => a.id === id), pathBudget: 10, callout: () => {},
    extracts: new Extracts(world, mulberry32(1)).points, lootView: () => null, senses: sensesOf(settled('clear')), bounty, bags: () => bags,
  };
}

/** An operator bot that has searched every crate, or has `loot` still to go to. */
function operator(personality: Personality, loot: Point[] = []): Bot {
  const role: Role = { kind: 'operator', loot: loot.map((p) => ({ ...p, look: p })), planned: loot.length, greed: 20, personality };
  return new Bot(role, SKILLS.normal, RIFLE, 0, mulberry32(2));
}

function think(bot: Bot, ctx: BotContext, self: Agent, seconds: number, from = 0): void {
  for (let t = from; t < from + seconds; t += 0.1) {
    ctx.time = t;
    bot.think(ctx, self, 0.1);
  }
}

type Body = PlayerState & { run: { items: number[] } | null };
function body(server: GameServer, id: number): Body {
  return (server as unknown as { players: Map<number, Body> }).players.get(id)!;
}

describe('operator personalities', () => {
  it('shape what each operator bot sets out to do', () => {
    const rand = mulberry32(4);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const plan = planOperator(world, nav, rand, [], new Set());
      if (plan.role.kind !== 'operator') throw new Error('not an operator');
      const p = plan.role.personality!;
      seen.add(p);
      const t = TEMPERS[p];
      expect(plan.role.greed).toBeGreaterThanOrEqual(t.greed[0]);
      expect(plan.role.greed).toBeLessThanOrEqual(t.greed[1]);
      expect(plan.role.planned).toBeLessThanOrEqual(t.stops[1]);
      expect(plan.role.loot.length).toBeGreaterThan(plan.role.planned);
    }
    expect([...seen].sort()).toEqual([...PERSONALITIES].sort());
  });

  it('hunter follows gunfire, but a rat stays away', () => {
    const at = openSpot(250);
    const self = agent(1, 'operator', at.x, at.z);
    const shooter = agent(2, 'operator', at.x + 120, at.z);
    for (const [p, want] of [['hunter', 'stalk'], ['rat', 'extract']] as const) {
      const bot = operator(p);
      const ctx = context([self, shooter]);
      think(bot, ctx, self, 0.2);
      bot.hear(self, { x: shooter.x, y: shooter.y, z: shooter.z, radius: 180, source: 2, gunfire: true }, 0.2);
      think(bot, ctx, self, 0.3, 0.2);
      expect(bot.state).toBe(want);
    }
  });

  it('a looter joins a fight between two others, not one side shooting', () => {
    const at = openSpot(250);
    const self = agent(1, 'operator', at.x, at.z);
    const a = agent(2, 'operator', at.x + 90, at.z);
    const b = agent(3, 'operator', at.x + 90, at.z + 30);
    const bot = operator('looter', [{ x: at.x - 150, y: self.y, z: at.z }]);
    const ctx = context([self, a, b]);
    think(bot, ctx, self, 0.2);
    bot.hear(self, { x: a.x, y: a.y, z: a.z, radius: 180, source: 2, gunfire: true }, 0.2);
    think(bot, ctx, self, 0.3, 0.2);
    expect(bot.state).not.toBe('stalk');
    bot.hear(self, { x: b.x, y: b.y, z: b.z, radius: 180, source: 3, gunfire: true }, 0.5);
    think(bot, ctx, self, 0.3, 0.5);
    expect(bot.state).toBe('stalk');
  });

  it('a camper waits near an extraction point before leaving, and a hunter roams', () => {
    const at = openSpot(150);
    const self = agent(1, 'operator', at.x, at.z);
    const camper = operator('camper');
    think(camper, context([self]), self, 1);
    expect(camper.state).toBe('camp');
    const hunter = operator('hunter');
    think(hunter, context([self]), self, 1);
    expect(hunter.state).toBe('hunt');
    // Later in the run they head out.
    const late = context([self]);
    think(camper, late, self, 0.5, TEMPERS.camper.linger + 1);
    expect(camper.state).toBe('extract');
  });

  it('a looter goes through a valuable bag it has seen nearby', () => {
    // Somewhere a bag 12 m ahead (the bot faces -z) shows, and one 12 m behind would too.
    let at = openSpot(150);
    let y = 0;
    for (let seed = 6; ; seed++) {
      y = world.groundHeight(at.x, at.z, world.floorHeight(at.x, at.z));
      const shows = (dz: number) => bagShows(world, at.x, y + EYE_HEIGHT, at.z, at.x, world.terrainHeight(at.x, at.z + dz), at.z + dz);
      if (shows(-12) && shows(12)) break;
      at = openSpot(150, seed);
    }
    const self = agent(1, 'operator', at.x, at.z);
    const bag = (dz: number, value: number): BagSnap => ({ id: 7, x: at.x, y: world.terrainHeight(at.x, at.z + dz), z: at.z + dz, value });
    const bot = operator('looter');
    think(bot, context([self], [bag(-12, 4000)]), self, 0.5);
    expect(bot.state).toBe('loot');
    const cheap = operator('looter');
    think(cheap, context([self], [bag(-12, 100)]), self, 0.5);
    expect(cheap.state).toBe('extract');
    // Behind it, it can't know what the bag holds.
    const unseen = operator('looter');
    think(unseen, context([self], [bag(12, 4000)]), self, 0.5);
    expect(unseen.state).toBe('extract');
  });
});

describe('bot senses and stealth', () => {
  it('a hunter goes for a guess round where far shots came from, not the very spot', () => {
    // Both well away from the outposts, whose fights are watched from outside.
    let at = openSpot(150);
    for (let seed = 6; world.outposts.some((o) => Math.hypot(o.x - at.x - 200, o.z - at.z) < 150) || !nav.dry(at.x + 200, at.z); seed++) at = openSpot(150, seed);
    const self = agent(1, 'operator', at.x, at.z);
    const shooter = agent(2, 'operator', at.x + 200, at.z);
    const offs: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const bot = new Bot({ kind: 'operator', loot: [], planned: 0, greed: 20, personality: 'hunter' }, SKILLS.normal, RIFLE, 0, mulberry32(seed));
      const ctx = context([self, shooter]);
      think(bot, ctx, self, 0.2);
      bot.hear(self, { x: shooter.x, y: shooter.y, z: shooter.z, radius: 300, source: 2, gunfire: true }, 0.2);
      think(bot, ctx, self, 0.3, 0.2);
      expect(bot.state).toBe('stalk');
      const fight = (bot as unknown as { fightAt: Point }).fightAt;
      offs.push(Math.hypot(fight.x - shooter.x, fight.z - shooter.z));
    }
    expect(Math.max(...offs)).toBeGreaterThan(3);
    expect(Math.max(...offs)).toBeLessThan(200 * 0.12 * Math.SQRT2 + 0.01);
  });

  it('a rat hurt by another operator in the open hides in a bush that keeps them out of sight', () => {
    const veg = vegetationOf(world);
    let tried = 0;
    let inBush = 0;
    for (let iz = -50; iz < 50 && tried < 12; iz++) {
      for (let ix = -50; ix < 50 && tried < 12; ix++) {
        for (const b of veg.bushes(ix, iz)) {
          if (tried >= 12) break;
          if (b.height < 1.2 || !nav.dry(b.x, b.z) || world.outposts.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 120)) continue;
          const self = agent(1, 'operator', b.x + 4, b.z + 3);
          const guard = agent(2, 'operator', b.x - 40, b.z);
          if (!nav.dry(self.x, self.z) || !world.hasLineOfSight(self.x, self.y + 1.6, self.z, guard.x, guard.y + 1.2, guard.z)) continue;
          if (veg.seeThrough(self.x, self.y + 1.6, self.z, guard.x, guard.y + 1.2, guard.z) < 0.5) continue;
          tried++;
          self.hp = 50;
          const bot = new Bot({ kind: 'operator', loot: [], planned: 0, greed: 20, personality: 'rat' }, SKILLS.normal, RIFLE, yawToward(self.x, self.z, guard.x, guard.z), mulberry32(1));
          const ctx = context([self, guard]);
          bot.hurt(guard, 0);
          think(bot, ctx, self, 0.1);
          const spot = (bot as unknown as { spot: (Point & { bush?: boolean }) | null }).spot;
          if (bot.state !== 'cover' || !spot?.bush) continue;
          inBush++;
          // Crouched in it, neither chest nor head shows to the guard.
          const h = hitboxes({ x: spot.x, y: spot.y, z: spot.z, yaw: 0, duck: 1, lean: 0 });
          for (const y of [h.headY, (h.hipY + h.neckY) / 2]) {
            expect(veg.seeThrough(guard.x, guard.y + 1.6, guard.z, spot.x, y, spot.z)).toBeLessThan(CONCEALED);
          }
          break;
        }
      }
    }
    expect(tried).toBe(12);
    expect(inBush).toBeGreaterThan(2);
  });

  it('bots settle into bushes to wait and hide over a game', () => {
    const before = { ...tally };
    const server = new GameServer(DEFAULT_WORLD.seed, { operators: 7 });
    for (let t = 0; t < 4 * 60 * SERVER_TICK_RATE; t++) server.step();
    expect(tally.waits - before.waits).toBeGreaterThan(0);
    expect(tally.bushWaits - before.bushWaits).toBeGreaterThan(0);
    expect(tally.covers - before.covers).toBeGreaterThan(0);
  }, 30_000);
});

describe('bags', () => {
  it('say what they hold', () => {
    const c = new Containers(world, mulberry32(1));
    c.drop(0, 0, 0, [GOLD, GOLD], 0);
    expect(c.bags()[0].value).toBe(lootValue([GOLD, GOLD]));
  });
});

describe('telling what kind of rival it was', () => {
  it('names a dead operator bot’s kind in the kill, on its bag, and to whoever it killed', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { operators: 3, personality: 'hunter' });
    const sent: ServerMsg[] = [];
    const id = server.connect((m) => sent.push(m));
    server.receive(id, { t: 'hello', name: 'me', world: DEFAULT_WORLD, mode: 'offline' });
    const events = () => sent.flatMap((m) => (m.t === 'events' ? m.events : []));
    server.step();

    // One rival dies carrying gold: its kind is in the feed's kill and on the bag it leaves.
    server.receive(id, { t: 'dev', cmd: { act: 'give', items: [GOLD], rival: true } });
    server.receive(id, { t: 'dev', cmd: { act: 'kill' } });
    server.step();
    const kill = events().find((e) => e.k === 'kill');
    expect(kill).toMatchObject({ killer: id, victimKind: 'hunter' });
    const snap = [...sent].reverse().find((m) => m.t === 'snapshot');
    expect(snap?.t === 'snapshot' && snap.bags).toEqual([expect.objectContaining({ kind: 'hunter', value: lootValue([GOLD]) })]);

    // The other kills us: we're told what it was as the run ends, and in the death cam.
    server.receive(id, { t: 'dev', cmd: { act: 'end', outcome: 'killed' } });
    for (let t = 0; t < SERVER_TICK_RATE * 3; t++) server.step();
    const end = events().find((e) => e.k === 'runEnd');
    expect(end).toMatchObject({ outcome: 'killed', death: { by: 'operator', kind: 'hunter' } });
    // Our own kill isn't told as a rival's kind: we're no bot.
    expect(events().filter((e) => e.k === 'kill').at(-1)).not.toHaveProperty('victimKind');
    expect(events().find((e) => e.k === 'deathcam')).toMatchObject({ kind: 'hunter' });
  });

  it('keeps a bag’s kind when more is dropped into it, and names none for loot from a crate', () => {
    const c = new Containers(world, mulberry32(1));
    c.drop(0, 0, 0, [GOLD], 0);
    expect(c.bags()[0]).not.toHaveProperty('kind');
    c.drop(0.5, 0, 0, [GOLD], 1, 'rat');
    c.drop(0.2, 0, 0, [GOLD], 2, 'looter');
    expect(c.bags()).toEqual([expect.objectContaining({ kind: 'rat', value: lootValue([GOLD, GOLD, GOLD]) })]);
  });
});

describe('bot senses and stealth III', () => {
  type Inside = { spot: (Point & { bush?: boolean }) | null; camp: Point | null; fleeing: boolean };
  const inside = (bot: Bot) => bot as unknown as Inside;

  it('a camper only ever waits where it can see into the extraction point, or doesn’t camp', () => {
    const extracts = new Extracts(world, mulberry32(1)).points;
    let camped = 0;
    extracts.forEach((e, i) => {
      // Some way off it, so this is the extraction point it picks.
      const rand = mulberry32(20 + i);
      let at: { x: number; z: number } | null = null;
      for (let k = 0; k < 200 && !at; k++) {
        const a = rand() * Math.PI * 2;
        const x = e.x + Math.sin(a) * 60;
        const z = e.z + Math.cos(a) * 60;
        if (nav.dry(x, z)) at = { x, z };
      }
      if (!at) return;
      const self = agent(1, 'operator', at.x, at.z);
      const camper = operator('camper');
      const ctx = { ...context([self]), extracts: [e] };
      think(camper, ctx, self, 0.5);
      const camp = inside(camper).camp;
      if (!camp) {
        expect(camper.state).toBe('extract');
        return;
      }
      camped++;
      expect(camper.state).toBe('camp');
      expect(world.hasLineOfSight(camp.x, camp.y + CROUCH_EYE_HEIGHT, camp.z, e.x, e.y + 1, e.z)).toBe(true);
    });
    expect(camped).toBeGreaterThan(extracts.length / 2);
  });

  it('a rat lies low on hearing a fight nearby, out of its sight, then goes on; a looter doesn’t', () => {
    const at = openSpot(250, 11);
    const self = agent(1, 'operator', at.x, at.z);
    const shooter = agent(2, 'operator', at.x + 60, at.z);
    const crate = { x: at.x - 150, y: self.y, z: at.z };
    const gunfire = (bot: Bot, t: number) =>
      bot.hear(self, { x: shooter.x, y: shooter.y + EYE_HEIGHT, z: shooter.z, radius: 180, source: 2, gunfire: true }, t);
    for (const [p, want] of [['rat', 'hide'], ['looter', 'loot']] as const) {
      const bot = operator(p, [crate]);
      const ctx = context([self]);
      think(bot, ctx, self, 0.2);
      gunfire(bot, 0.2);
      think(bot, ctx, self, 0.3, 0.2);
      expect(bot.state).toBe(want);
      if (p !== 'rat') continue;
      // Somewhere the fight can't see, unless there's nowhere near: then just where it is.
      const spot = inside(bot).spot!;
      const fy = world.groundHeight(shooter.x, shooter.z, world.floorHeight(shooter.x, shooter.z)) + EYE_HEIGHT;
      const hidden = !world.hasLineOfSight(shooter.x, fy, shooter.z, spot.x, spot.y + CROUCH_EYE_HEIGHT, spot.z) ||
        (!!spot.bush && vegetationOf(world).seeThrough(shooter.x, fy, shooter.z, spot.x, spot.y + 0.9, spot.z) < CONCEALED);
      expect(hidden || Math.hypot(spot.x - self.x, spot.z - self.z) < 0.01).toBe(true);
      // There (this body doesn't walk), more shots keep it down; once they stop, it gets on with its run.
      Object.assign(self, { x: spot.x, y: spot.y, z: spot.z });
      const until = () => (bot as unknown as { spotUntil: number }).spotUntil;
      const first = until();
      gunfire(bot, 8);
      think(bot, ctx, self, 1, 8);
      expect(bot.state).toBe('hide');
      expect(until()).toBeGreaterThan(Math.max(first, 18) - 0.01);
      const end = until();
      think(bot, ctx, self, end - 9 - 0.3, 9);
      expect(bot.state).toBe('hide');
      think(bot, ctx, self, 0.6, end - 0.3);
      expect(bot.state).toBe('loot');
    }
  });

  it('an operator shot at by a guard far off gets well away out of its sight, not just behind the next bush', () => {
    let tried = 0;
    let away = 0;
    for (let seed = 1; tried < 8; seed++) {
      const at = openSpot(150, seed);
      const self = agent(1, 'operator', at.x, at.z);
      const guard = agent(2, 'guard', at.x + 90, at.z);
      if (!world.hasLineOfSight(self.x, self.y + EYE_HEIGHT, self.z, guard.x, guard.y + EYE_HEIGHT, guard.z)) continue;
      tried++;
      const bot = operator('looter', [{ x: at.x - 150, y: self.y, z: at.z }]);
      bot.underFire(guard, 0);
      think(bot, context([self, guard]), self, 0.1);
      expect(bot.state).toBe('cover');
      const spot = inside(bot).spot!;
      expect(inside(bot).fleeing).toBe(true);
      // Off and away from the guard.
      expect(Math.hypot(spot.x - self.x, spot.z - self.z)).toBeGreaterThan(30);
      expect(Math.hypot(spot.x - guard.x, spot.z - guard.z)).toBeGreaterThan(90);
      if (!world.hasLineOfSight(guard.x, guard.y + EYE_HEIGHT, guard.z, spot.x, spot.y + CROUCH_EYE_HEIGHT, spot.z)) away++;
    }
    // Mostly out of its sight: open ground doesn't always offer that.
    expect(away).toBeGreaterThan(tried / 2);
  });

  it('an operator shot by two others at once is outgunned and gets away, where one alone it fights', () => {
    const at = openSpot(250, 13);
    const self = agent(1, 'operator', at.x, at.z);
    const a = agent(2, 'operator', at.x, at.z - 30);
    const b = agent(3, 'operator', at.x + 8, at.z - 30);
    const fight = (shooters: Agent[]) => {
      const bot = new Bot({ kind: 'operator', loot: [], planned: 0, greed: 20, personality: 'looter' }, SKILLS.normal, RIFLE, yawToward(self.x, self.z, a.x, a.z), mulberry32(3));
      const ctx = context([self, ...shooters]);
      for (const s of shooters) bot.hurt(s, 0);
      think(bot, ctx, self, 0.3);
      return bot;
    };
    expect(fight([a]).state).toBe('engage');
    const outgunned = fight([a, b]);
    expect(outgunned.state).toBe('cover');
    expect(inside(outgunned).fleeing).toBe(true);
  });
});

describe('playing the weather', () => {
  type Inside = { spot: (Point & { bush?: boolean }) | null; camp: Point | null; planned: number; pace: string };
  const inside = (bot: Bot) => bot as unknown as Inside;
  const fog = sensesOf(settled('fog'));

  it('a rat lies low for fog it sees coming, and sets off once it is in; a looter doesn’t wait', () => {
    const at = openSpot(250);
    for (const [p, coming, want] of [
      ['rat', { weather: 'fog', in: 60 }, 'hide'],
      ['rat', { weather: 'fog', in: 200 }, 'loot'],
      ['rat', { weather: 'rain', in: 60 }, 'loot'],
      ['looter', { weather: 'fog', in: 60 }, 'loot'],
    ] as const) {
      const self = agent(1, 'operator', at.x, at.z);
      const bot = operator(p, [{ x: at.x - 150, y: self.y, z: at.z }]);
      const ctx: BotContext = { ...context([self]), coming };
      think(bot, ctx, self, 0.5);
      expect(bot.state, `${p} with ${coming.weather} ${coming.in} s off`).toBe(want);
      if (want !== 'hide') continue;
      const spot = inside(bot).spot!;
      Object.assign(self, { x: spot.x, y: spot.y, z: spot.z });
      // There (this body doesn't walk), still clear: it stays down; halfway into the fog, it goes on, and doesn't wait for that fog again.
      think(bot, ctx, self, 30, 0.5);
      expect(bot.state).toBe('hide');
      const half: WeatherNow = { from: 'clear', to: 'fog', blend: 0.8 };
      ctx.senses = sensesOf(half);
      ctx.coming = { weather: 'fog', in: 60 - 31 };
      think(bot, ctx, self, 0.5, 31);
      expect(bot.state).toBe('loot');
    }
  });

  it('rats and looters take a crate more than they meant to in fog, and hurry on through it', () => {
    const at = openSpot(250);
    const self = agent(1, 'operator', at.x, at.z);
    const crates = [{ x: at.x - 150, y: self.y, z: at.z }, { x: at.x + 150, y: self.y, z: at.z }];
    for (const [p, more] of [['rat', 1], ['looter', 1], ['camper', 0], ['hunter', 0]] as const) {
      const role: Role = { kind: 'operator', loot: crates.map((c) => ({ ...c, look: c })), planned: 1, greed: 20, personality: p };
      const clear = new Bot(role, SKILLS.normal, RIFLE, 0, mulberry32(2));
      think(clear, context([self]), self, 0.5);
      expect(inside(clear).planned).toBe(1);
      const bot = new Bot(role, SKILLS.normal, RIFLE, 0, mulberry32(2));
      const ctx = { ...context([self]), senses: fog };
      think(bot, ctx, self, 2);
      expect(inside(bot).planned, p).toBe(1 + more);
      // A rat runs across the island in fog, where in the clear it never does.
      if (p === 'rat') {
        expect(inside(clear).pace).toBe('walk');
        expect(inside(bot).pace).toBe('sprint');
      }
    }
  });

  it('a hunter under rain closes in nearer a fight than in the clear', () => {
    const at = openSpot(250);
    const self = agent(1, 'operator', at.x, at.z);
    const shooter = agent(2, 'operator', at.x + 120, at.z);
    const stops = (weather: 'clear' | 'rain') => {
      const bot = operator('hunter');
      const ctx = { ...context([self, shooter]), senses: sensesOf(settled(weather)) };
      think(bot, ctx, self, 0.2);
      bot.hear(self, { x: shooter.x, y: shooter.y, z: shooter.z, radius: 180, source: 2, gunfire: true }, 0.2);
      think(bot, ctx, self, 0.3, 0.2);
      expect(bot.state).toBe('stalk');
      const spot = inside(bot).spot!;
      return Math.hypot(spot.x - shooter.x, spot.z - shooter.z);
    };
    expect(stops('rain')).toBeLessThan(stops('clear') - 10);
  });

  it('a camper moves in nearer its extraction point as fog comes in, ignores noises, and stays on longer', () => {
    const extracts = new Extracts(world, mulberry32(1)).points;
    let moved = 0;
    extracts.forEach((e, i) => {
      const rand = mulberry32(20 + i);
      let at: { x: number; z: number } | null = null;
      for (let k = 0; k < 200 && !at; k++) {
        const a = rand() * Math.PI * 2;
        const x = e.x + Math.sin(a) * 60;
        const z = e.z + Math.cos(a) * 60;
        if (nav.dry(x, z)) at = { x, z };
      }
      if (!at) return;
      const self = agent(1, 'operator', at.x, at.z);
      const camper = operator('camper');
      const ctx = { ...context([self]), extracts: [e] };
      think(camper, ctx, self, 0.5);
      const before = inside(camper).camp;
      if (!before) return;
      ctx.senses = fog;
      think(camper, ctx, self, 0.5, 0.5);
      const after = inside(camper).camp;
      if (!after) return;
      expect(world.hasLineOfSight(after.x, after.y + CROUCH_EYE_HEIGHT, after.z, e.x, e.y + 1, e.z)).toBe(true);
      if (Math.hypot(after.x - e.x, after.z - e.z) < Math.hypot(before.x - e.x, before.z - e.z)) moved++;
    });
    expect(moved).toBeGreaterThan(extracts.length / 2);

    const at = openSpot(150);
    const self = agent(1, 'operator', at.x, at.z);
    const camper = operator('camper');
    const ctx = { ...context([self]), senses: fog };
    think(camper, ctx, self, 1);
    expect(camper.state).toBe('camp');
    camper.hear(self, { x: at.x + 8, y: self.y, z: at.z, radius: 20, source: 2 }, 1);
    think(camper, ctx, self, 0.5, 1);
    expect(camper.state).toBe('camp');
    think(camper, ctx, self, 0.5, TEMPERS.camper.linger + 1);
    expect(camper.state).toBe('camp');
    ctx.senses = sensesOf(settled('clear'));
    think(camper, ctx, self, 0.5, TEMPERS.camper.linger + 2);
    expect(camper.state).toBe('extract');
  });
});

describe('operators and guards', () => {
  it('get away from a guard shooting from far off, and fight back up close', () => {
    const at = openSpot(150, 3);
    const self = agent(1, 'operator', at.x, at.z);
    const fight = (d: number) => {
      const guard = agent(2, 'guard', at.x, at.z - d);
      const bot = operator('looter');
      const ctx = context([self, guard]);
      bot.hurt(guard, 0);
      think(bot, ctx, self, 1);
      return bot.state;
    };
    expect(fight(30)).toBe('engage');
    expect(fight(90)).not.toBe('engage');
  });

  it('give up crates a guard that shot them watches over, and once badly hurt, the rest', () => {
    const at = openSpot(150, 3);
    const self = agent(1, 'operator', at.x, at.z);
    const guard = agent(2, 'guard', at.x + 200, at.z);
    const near = { x: guard.x - 40, y: 0, z: guard.z };
    const far = { x: at.x - 40, y: 0, z: at.z };
    const bot = operator('looter', [near, far]);
    bot.hurt(guard, 0);
    think(bot, context([self]), self, 0.2, 1);
    // On to the crate out of the guard's way.
    expect(bot.state).toBe('loot');
    expect(bot.lootLeft()).toBe(1);
    // Badly hurt in a fight, it heads out once the fight is over.
    const hurt = operator('looter', [{ x: at.x, y: 0, z: at.z + 150 }]);
    const wounded = { ...self, hp: 40 };
    const close = agent(3, 'guard', at.x, at.z - 30);
    const ctx = context([wounded, close]);
    hurt.hurt(close, 0);
    think(hurt, ctx, wounded, 1);
    expect(['engage', 'cover']).toContain(hurt.state);
    close.dead = true;
    think(hurt, ctx, wounded, 20, 1);
    expect(hurt.state).toBe('extract');
    expect(hurt.lootLeft()).toBe(1);
  });

  it('loot like a person when thorough, keeping to every crate planned', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 10; i++) {
      const plan = planOperator(world, nav, rand, [], new Set(), undefined, true);
      if (plan.role.kind !== 'operator') throw new Error('not an operator');
      expect(plan.role.thorough).toBe(true);
      expect(plan.role.loot.length).toBeGreaterThanOrEqual(5);
      expect(plan.role.greed).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('the bounty', () => {
  it('goes to the operator carrying the most, is called every so often, and is gone once they die', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { operators: 3, personality: 'rat' });
    const sent: ServerMsg[] = [];
    const id = server.connect((m) => sent.push(m));
    server.receive(id, { t: 'hello', name: 'me', world: DEFAULT_WORLD, mode: 'offline' });
    const events: GameEvent[] = [];
    server.onEvent = (e) => events.push(e);
    server.step();
    const last = () => [...sent].reverse().find((m) => m.t === 'snapshot');
    expect(last()?.t === 'snapshot' && last()?.bounty).toBeNull();

    const me = body(server, id);
    me.run!.items = [GOLD];
    expect(lootValue(me.run!.items)).toBeGreaterThanOrEqual(BOUNTY_MIN);
    server.step();
    expect(events.find((e) => e.k === 'bounty')).toMatchObject({ k: 'bounty', id, value: lootValue([GOLD]) });
    const first = last();
    if (first?.t !== 'snapshot' || !first.bounty) throw new Error('no bounty');
    expect(Math.hypot(first.bounty.x - me.x, first.bounty.z - me.z)).toBeLessThan(16);

    // Someone else carrying more takes it over.
    const other = server.bots().find((b) => b.team === 'operator')!;
    body(server, other.id).run!.items = [GOLD, GOLD];
    server.step();
    expect(events.filter((e) => e.k === 'bounty').at(-1)).toMatchObject({ id: other.id });

    // It's called again after BOUNTY_PING seconds.
    const at = (m = last()) => (m?.t === 'snapshot' ? m.bounty?.at : undefined);
    const called = at();
    for (let t = 0; t < BOUNTY_PING * SERVER_TICK_RATE; t++) server.step();
    expect(at()).toBeGreaterThan(called!);

    body(server, other.id).run!.items = [];
    me.run!.items = [];
    server.step();
    expect(events.filter((e) => e.k === 'bounty').at(-1)).toMatchObject({ id: 0 });
  });

  it('is spotted sooner than anyone else, by those told who it is', () => {
    let self: Agent;
    let target: Agent;
    for (let seed = 1; ; seed++) {
      const at = openSpot(150, seed);
      self = agent(1, 'guard', at.x, at.z);
      target = agent(2, 'operator', at.x, at.z - 70);
      if (world.hasLineOfSight(self.x, self.y + 1.6, self.z, target.x, target.y + 1.2, target.z)) break;
    }
    const aware = (bounty: number, told: boolean) => {
      const bot = new Bot({ kind: 'sentry', post: { x: self.x, y: self.y, z: self.z, yaw: 0 } }, SKILLS.normal, RIFLE, 0, mulberry32(1));
      if (told) bot.bountyTold(bounty);
      const ctx = context([self, target], [], bounty);
      think(bot, ctx, self, 0.6);
      return bot.awareness(2);
    };
    expect(aware(2, true)).toBeGreaterThan(aware(0, false));
    expect(aware(2, false)).toBe(aware(0, false));
  });
});
