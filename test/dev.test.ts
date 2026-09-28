import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { DEATHCAM_AFTER, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { ITEMS, lootValue } from '../src/shared/loot.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// The shortcuts browser tests use to end a run or set up the rivals HUD on demand.

const GOLD = ITEMS.findIndex((i) => i.name === 'Gold bar');

type Body = PlayerState & { run: { items: number[] } | null };

function game(): { server: GameServer; id: number; events: () => GameEvent[]; me: () => Body } {
  const server = new GameServer(DEFAULT_WORLD.seed, { mode: 'offline', operators: 3 });
  const sent: ServerMsg[] = [];
  const id = server.connect((m) => sent.push(m));
  server.receive(id, { t: 'hello', name: 'me', world: DEFAULT_WORLD, mode: 'offline' });
  server.step();
  const events = () => sent.flatMap((m) => (m.t === 'events' ? m.events : []));
  const me = () => (server as unknown as { players: Map<number, Body> }).players.get(id)!;
  return { server, id, events, me };
}

describe('dev shortcuts', () => {
  it('end a run as extracted, scoring what was carried', () => {
    const { server, id, events } = game();
    server.receive(id, { t: 'dev', cmd: { act: 'give', items: [GOLD] } });
    server.receive(id, { t: 'dev', cmd: { act: 'end', outcome: 'extracted' } });
    server.step();
    expect(events().find((e) => e.k === 'runEnd')).toMatchObject({ outcome: 'extracted', value: lootValue([GOLD]) });
  });

  it('end a run killed by the nearest operator bot, with a death cam after', () => {
    const { server, id, events, me } = game();
    // Straight away, through spawn protection.
    server.receive(id, { t: 'dev', cmd: { act: 'end', outcome: 'killed' } });
    expect(me().dead).toBe(true);
    server.step();
    const end = events().find((e) => e.k === 'runEnd');
    const rival = server.bots().find((b) => b.name === (end?.k === 'runEnd' ? end.killer : ''));
    expect(rival?.team).toBe('operator');
    for (let i = 0; i < (DEATHCAM_AFTER + 0.5) * SERVER_TICK_RATE; i++) server.step();
    expect(events().find((e) => e.k === 'deathcam')).toMatchObject({ killer: rival!.id });
  });

  it('bring the rival in front, load it with loot and kill it', () => {
    const { server, id, events, me } = game();
    server.receive(id, { t: 'dev', cmd: { act: 'rival' } });
    const rival = server.bots()
      .filter((b) => b.team === 'operator')
      .sort((a, b) => Math.hypot(a.state.x - me().x, a.state.z - me().z) - Math.hypot(b.state.x - me().x, b.state.z - me().z))[0];
    expect(Math.hypot(rival.state.x - me().x, rival.state.z - me().z)).toBeCloseTo(8, 3);
    server.receive(id, { t: 'dev', cmd: { act: 'give', items: [GOLD, GOLD], rival: true } });
    server.step();
    expect(events().filter((e) => e.k === 'bounty').at(-1)).toMatchObject({ id: rival.id });
    server.receive(id, { t: 'dev', cmd: { act: 'kill' } });
    server.step();
    expect(events().find((e) => e.k === 'kill')).toMatchObject({ killer: id, victim: rival.id, bounty: true });
  });
});
