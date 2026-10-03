import { describe, expect, it } from 'vitest';
import { GameServer, type ServerOptions } from '../src/server/server.ts';
import { ITEMS } from '../src/shared/loot.ts';
import type { BoardRow, GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// The scoreboard on Tab: players' kills, deaths and scores over a game, across their runs.

const GOLD = ITEMS.findIndex((i) => i.name === 'Gold bar');

/** A player joining `server` as `name` for a run, and what they've been sent. */
function join(server: GameServer, name: string): { id: number; events: () => GameEvent[]; board: () => BoardRow[] | undefined } {
  const sent: ServerMsg[] = [];
  const id = server.connect((m) => sent.push(m));
  server.receive(id, { t: 'hello', name, world: DEFAULT_WORLD, mode: 'online' });
  server.step();
  const events = () => sent.flatMap((m) => (m.t === 'events' ? m.events : []));
  const board = () => events().filter((e) => e.k === 'board').at(-1)?.rows;
  return { id, events, board };
}

function server(options: ServerOptions = { mode: 'online', operators: 3 }): GameServer {
  return new GameServer(DEFAULT_WORLD.seed, options);
}

describe('scoreboard', () => {
  it('lists the players in the game, bots left out', () => {
    const game = server();
    const me = join(game, 'me');
    expect(me.board()).toEqual([{ id: me.id, name: 'me', kills: 0, deaths: 0, best: 0, total: 0 }]);
    const friend = join(game, 'friend');
    game.step();
    expect(me.board()?.map((r) => r.name).sort()).toEqual(['friend', 'me']);
    // Gone from it once they leave.
    game.receive(friend.id, { t: 'leave' });
    game.step();
    expect(me.board()?.map((r) => r.name)).toEqual(['me']);
  });

  it('counts kills and deaths as they happen, and scores when extracting', () => {
    const game = server();
    const me = join(game, 'me');
    game.receive(me.id, { t: 'dev', cmd: { act: 'rival' } });
    game.receive(me.id, { t: 'dev', cmd: { act: 'kill' } });
    game.step();
    expect(me.board()?.[0]).toMatchObject({ kills: 1, deaths: 0, total: 0 });
    game.receive(me.id, { t: 'dev', cmd: { act: 'give', items: [GOLD] } });
    game.receive(me.id, { t: 'dev', cmd: { act: 'end', outcome: 'extracted' } });
    game.step();
    const end = me.events().find((e) => e.k === 'runEnd');
    const score = end?.k === 'runEnd' ? end.score : 0;
    expect(score).toBeGreaterThan(0);

    // The next run in the same game, under the same name, carries the record on.
    const again = join(game, 'me');
    expect(again.board()?.[0]).toMatchObject({ id: again.id, kills: 1, deaths: 0, best: score, total: score });
    game.receive(again.id, { t: 'dev', cmd: { act: 'end', outcome: 'killed', self: true } });
    game.step();
    expect(again.board()?.[0]).toMatchObject({ kills: 1, deaths: 1, best: score, total: score });

    // Someone else starts afresh.
    const other = join(game, 'other');
    expect(other.board()?.find((r) => r.name === 'other')).toMatchObject({ kills: 0, deaths: 0, total: 0 });
  });

  it('counts nothing on the range', () => {
    const game = server({ mode: 'range', range: true });
    const me = join(game, 'me');
    game.receive(me.id, { t: 'dev', cmd: { act: 'end', outcome: 'killed', self: true } });
    game.step();
    expect(me.board()?.[0]).toMatchObject({ kills: 0, deaths: 0 });
  });
});
