import { describe, expect, it } from 'vitest';
import { Directory, MODES } from '../src/server/directory.ts';
import { ARENA_CLEAR } from '../src/server/population.ts';
import { GameServer } from '../src/server/server.ts';
import {
  DEATHCAM_AFTER, DEATHMATCH_BOT_RESPAWN, DEATHMATCH_CAPACITY, DEATHMATCH_RESPAWN_WAIT, SERVER_TICK_RATE,
} from '../src/shared/constants.ts';
import { ITEMS, rollItems } from '../src/shared/loot.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// Deathmatch: 20 operators and no guards, everyone against everyone, respawning, kills and deaths only.

type Snapshot = Extract<ServerMsg, { t: 'snapshot' }>;

function join(server: GameServer, name: string) {
  const sent: ServerMsg[] = [];
  const id = server.connect((m) => sent.push(m));
  server.receive(id, { t: 'hello', name, world: DEFAULT_WORLD, mode: 'deathmatch', player: `player-${name}` });
  server.step();
  const events = (): GameEvent[] => sent.flatMap((m) => (m.t === 'events' ? m.events : []));
  const snap = (): Snapshot => sent.filter((m): m is Snapshot => m.t === 'snapshot').at(-1)!;
  return { id, events, snap, board: () => events().filter((e) => e.k === 'board').at(-1)?.rows };
}

function game(): GameServer {
  return new GameServer(DEFAULT_WORLD.seed, MODES.deathmatch.options);
}

function steps(server: GameServer, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * SERVER_TICK_RATE); i++) server.step();
}

describe('deathmatch', () => {
  it('puts 20 operators on the island and no guards, a player taking a bot’s place', () => {
    const server = game();
    expect(server.bots().length).toBe(DEATHMATCH_CAPACITY);
    expect(server.bots().every((b) => b.team === 'operator')).toBe(true);
    const me = join(server, 'me');
    expect(server.bots().length).toBe(DEATHMATCH_CAPACITY - 1);
    // No extraction points or contracts.
    expect(me.snap().extracts).toEqual([]);
    expect(me.snap().run?.contracts).toEqual([]);
  });

  it('stocks crates with ammo and medkits only', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      for (const item of rollItems(rand, i % 2 === 0, true)) expect(['ammo', 'heal']).toContain(ITEMS[item].use);
    }
  });

  it('respawns a player when they skip the death cam, with no run ending', () => {
    const server = game();
    const me = join(server, 'me');
    const life = me.snap().you.life;
    server.receive(me.id, { t: 'dev', cmd: { act: 'rival' } });
    server.receive(me.id, { t: 'dev', cmd: { act: 'end', outcome: 'killed' } });
    steps(server, DEATHCAM_AFTER + 0.2);
    expect(me.snap().you.dead).toBe(true);
    expect(me.events().some((e) => e.k === 'deathcam')).toBe(true);
    expect(me.events().some((e) => e.k === 'runEnd')).toBe(false);
    server.receive(me.id, { t: 'respawn' });
    server.step();
    expect(me.snap().you).toMatchObject({ dead: false, life: life + 1 });
  });

  it('brings a player back anyway if they never say', () => {
    const server = game();
    const me = join(server, 'me');
    server.receive(me.id, { t: 'dev', cmd: { act: 'end', outcome: 'killed', self: true } });
    steps(server, DEATHMATCH_RESPAWN_WAIT - 1);
    expect(me.snap().you.dead).toBe(true);
    steps(server, 1.2);
    expect(me.snap().you.dead).toBe(false);
  });

  it('brings a dead bot back after a death cam’s length, in the same slot', () => {
    const server = game();
    const me = join(server, 'me');
    server.receive(me.id, { t: 'dev', cmd: { act: 'rival' } });
    server.receive(me.id, { t: 'dev', cmd: { act: 'kill' } });
    const kill = me.events().concat((server.step(), me.events())).find((e) => e.k === 'kill');
    const victim = kill?.k === 'kill' ? kill.victim : 0;
    const bot = () => server.bots().find((b) => b.id === victim);
    expect(bot()?.state.dead).toBe(true);
    steps(server, DEATHMATCH_BOT_RESPAWN + 0.2);
    expect(bot()?.state.dead).toBe(false);
    expect(server.bots().length).toBe(DEATHMATCH_CAPACITY - 1);
  });

  it('respawns nobody within reach of another operator', () => {
    const server = game();
    const me = join(server, 'me');
    for (let i = 0; i < 5; i++) {
      server.receive(me.id, { t: 'dev', cmd: { act: 'end', outcome: 'killed', self: true } });
      server.step();
      server.receive(me.id, { t: 'respawn' });
      server.step();
      const you = me.snap().you;
      const others = me.snap().players.filter((p) => p.id !== me.id && !p.dead);
      expect(Math.min(...others.map((p) => Math.hypot(p.x - you.x, p.z - you.z)))).toBeGreaterThanOrEqual(ARENA_CLEAR);
    }
  });

  it('lists every operator on the board, bots too, most kills first', () => {
    const server = game();
    const me = join(server, 'me');
    expect(me.board()?.length).toBe(DEATHMATCH_CAPACITY);
    server.receive(me.id, { t: 'dev', cmd: { act: 'rival' } });
    server.receive(me.id, { t: 'dev', cmd: { act: 'kill' } });
    server.step();
    const rows = me.board()!;
    expect(rows[0]).toMatchObject({ id: me.id, kills: 1, deaths: 0 });
    expect(rows.filter((r) => r.deaths === 1).length).toBe(1);
  });

  it('sends a bot short of ammo to a crate', () => {
    const server = game();
    for (const b of server.bots()) b.state.reserve = b.state.reserve.map(() => 0);
    steps(server, 0.5);
    // Those not already in a fight.
    const calm = server.bots().filter((b) => ['hunt', 'loot'].includes(b.bot.state));
    expect(calm.length).toBeGreaterThan(DEATHMATCH_CAPACITY / 2);
    expect(calm.every((b) => b.bot.state === 'loot')).toBe(true);
  });

  it('closes a game as soon as its last player leaves', () => {
    const directory = new Directory();
    const server = directory.quickJoin(DEFAULT_WORLD, 'deathmatch');
    const id = server.connect(() => {});
    directory.step();
    expect(directory.count).toBe(1);
    server.disconnect(id);
    directory.step();
    expect(directory.count).toBe(0);
  });
});
