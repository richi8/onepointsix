import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { arenaPoint } from '../src/server/population.ts';
import { GameServer } from '../src/server/server.ts';
import { NavGrid } from '../src/server/nav.ts';
import { DEATHMATCH_CAPACITY, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { CALABIANCA_2 } from '../src/shared/maps/calabianca2.ts';
import { mapFor } from '../src/shared/maps/index.ts';
import { isDeathmatch, parseMode, type GameEvent, type ServerMsg, type Side } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// Team Deathmatch: Deathmatch on the map after Dust 2 in two sides of 6, Red and Blue, who can't hurt their own.

type Snapshot = Extract<ServerMsg, { t: 'snapshot' }>;
type Board = Extract<GameEvent, { k: 'board' }>;

function join(server: GameServer, name: string) {
  const sent: ServerMsg[] = [];
  const id = server.connect((m) => sent.push(m));
  server.receive(id, { t: 'hello', name, world: DEFAULT_WORLD, mode: 'team', player: `player-${name}` });
  server.step();
  const events = (): GameEvent[] => sent.flatMap((m) => (m.t === 'events' ? m.events : []));
  const snap = (): Snapshot => sent.filter((m): m is Snapshot => m.t === 'snapshot').at(-1)!;
  const board = () => events().filter((e): e is Board => e.k === 'board').at(-1)!;
  const side = () => board().rows.find((r) => r.id === id)?.side;
  return { id, events, snap, board, side };
}

function game(): GameServer {
  return new GameServer(DEFAULT_WORLD.seed, MODES.team.options);
}

function steps(server: GameServer, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * SERVER_TICK_RATE); i++) server.step();
}

/** How many operators, players and bots, each side has, as the board lists them. */
function sides(board: Board): Record<Side, number> {
  const n = { red: 0, blue: 0 };
  for (const r of board.rows) if (r.side) n[r.side]++;
  return n;
}

describe('team deathmatch', () => {
  it('is played on the map after Dust 2, Deathmatch on the old town, and old links and settings find them', () => {
    expect(mapFor('team')).toBe(CALABIANCA_2);
    expect(mapFor('deathmatch')?.id).toBe('calabianca');
    expect(isDeathmatch('team')).toBe(true);
    expect(parseMode('team')).toBe('team');
    expect(parseMode('calabianca')).toBe('deathmatch');
  });

  it('puts 6 bots a side on, and a player in a bot’s place on one, keeping them even', () => {
    const server = game();
    expect(server.bots().length).toBe(DEATHMATCH_CAPACITY);
    expect(server.bots().filter((b) => b.side === 'red').length).toBe(DEATHMATCH_CAPACITY / 2);
    expect(server.bots().filter((b) => b.side === 'blue').length).toBe(DEATHMATCH_CAPACITY / 2);
    const me = join(server, 'me');
    expect(me.side()).toBeDefined();
    expect(server.bots().length).toBe(DEATHMATCH_CAPACITY - 1);
    expect(sides(me.board())).toEqual({ red: 6, blue: 6 });
    expect(me.board().teams).toEqual({ red: 0, blue: 0 });
    // Everyone's side goes out with them.
    expect(me.snap().players.every((p) => p.side === 'red' || p.side === 'blue')).toBe(true);
  });

  it('spreads players over both sides', () => {
    const server = game();
    const a = join(server, 'a');
    const b = join(server, 'b');
    expect(a.side()).not.toBe(b.side());
    expect(sides(b.board())).toEqual({ red: 6, blue: 6 });
  });

  it('scores a kill for the killer’s side, and tells everyone the sides in the feed', () => {
    const server = game();
    const me = join(server, 'me');
    const mine = me.side()!;
    server.receive(me.id, { t: 'dev', cmd: { act: 'rival' } });
    server.receive(me.id, { t: 'dev', cmd: { act: 'kill' } });
    server.step();
    const kill = me.events().find((e) => e.k === 'kill');
    expect(kill).toMatchObject({ killer: me.id, killerSide: mine, victimSide: mine === 'red' ? 'blue' : 'red' });
    expect(me.board().teams![mine]).toBe(1);
    expect(me.board().rows.find((r) => r.id === me.id)).toMatchObject({ kills: 1, side: mine });
  });

  it('lets nobody hurt their own side, nor the bots take them for enemies', () => {
    const server = game();
    const me = join(server, 'me');
    steps(server, 0.2);
    const friend = server.bots().find((b) => b.side === me.side())!;
    const hp = friend.state.hp;
    // Shot point-blank by a friend: a round stops in them, unfelt.
    const hurt = (server as unknown as { damage(v: unknown, a: unknown, n: number, ...rest: unknown[]): void });
    const players = (server as unknown as { players: Map<number, unknown> }).players;
    hurt.damage(players.get(friend.id), players.get(me.id), 100, 'head', 0, 0, 0, 0);
    expect(friend.state.hp).toBe(hp);
    expect(friend.state.dead).toBe(false);
    expect(me.board().teams).toEqual({ red: 0, blue: 0 });
    // The bots on a side never hold their friends as contacts to shoot.
    steps(server, 10);
    for (const b of server.bots()) {
      const contacts = (b.bot as unknown as { contacts: Map<number, unknown> }).contacts;
      for (const id of contacts.keys()) expect(server.bots().find((o) => o.id === id)?.side ?? me.side()).not.toBe(b.side);
    }
  });

  it('spawns a side on its own half while that’s clear', () => {
    const world = new World(1, CALABIANCA_2);
    const nav = new NavGrid(world);
    const bases = world.map!.bases!;
    const rand = mulberry32(3);
    for (const side of ['red', 'blue'] as const) {
      const other = side === 'red' ? 'blue' : 'red';
      for (let i = 0; i < 10; i++) {
        const at = arenaPoint(world, nav, rand, [], [], side);
        expect(Math.hypot(at.x - bases[side].x, at.z - bases[side].z)).toBeLessThan(Math.hypot(at.x - bases[other].x, at.z - bases[other].z));
      }
    }
  });
});
