import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { GameServer } from '../src/server/server.ts';
import type { Act } from '../src/server/range.ts';
import { RUN_TIME, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

interface ActorView {
  id: number;
  x: number;
  y: number;
  z: number;
  dead: boolean;
  actor: { spec: { act: Act; name: string; post: { x: number; y: number; z: number } } } | null;
}

describe('the range', () => {
  it('has actors going through every routine, shot only by the ones meant to, and nothing hurts the player', () => {
    for (const seed of [1, 2]) {
      const server = new GameServer(seed, MODES.range.options);
      const players = (server as unknown as { players: Map<number, ActorView> }).players;
      const actors = [...players.values()].filter((p) => p.actor);
      const acts = new Set(actors.map((a) => a.actor!.spec.act));
      for (const act of ['walk', 'sprint', 'crouchWalk', 'crouchSprint', 'strafe', 'lean', 'jump', 'aim', 'rifle', 'pistol', 'bolt', 'reload', 'switch',
        'grenade', 'stairs', 'mantle', 'door', 'shooter', 'victim'] as Act[]) {
        expect(acts, `seed ${seed}: ${act}`).toContain(act);
      }
      const inbox: ServerMsg[] = [];
      const me = server.connect((m) => inbox.push(m));
      server.receive(me, { t: 'hello', name: 'me', world: DEFAULT_WORLD, mode: 'range' });
      const kills: GameEvent[] = [];
      server.onEvent = (e) => e.k === 'kill' && kills.push(e);
      const rise = new Map<number, number>();
      for (let t = 0; t < 20 * SERVER_TICK_RATE; t++) {
        server.step();
        for (const a of actors) rise.set(a.id, Math.max(rise.get(a.id) ?? -Infinity, a.y - a.actor!.spec.post.y));
      }
      const by = (act: Act) => actors.find((a) => a.actor!.spec.act === act)!;
      // Up the watchtower, onto a crate.
      expect(rise.get(by('stairs').id)).toBeCloseTo(4, 1);
      expect(rise.get(by('mantle').id)!).toBeGreaterThan(0.8);
      expect(rise.get(by('jump').id)!).toBeGreaterThan(1);
      // Every victim dies, again and again; nobody else does.
      const victims = kills.map((k) => k.k === 'kill' ? k.victimName : '');
      expect(victims.length).toBeGreaterThan(10);
      for (const v of victims) expect(v, `seed ${seed}`).toMatch(/^Victim/);
      expect(victims.filter((v) => v === 'Victim, blown up').length).toBeGreaterThanOrEqual(3);
      // The player stood among them all along, unhurt, and the run's clock didn't move.
      const snap = [...inbox].reverse().find((m) => m.t === 'snapshot');
      expect(snap?.t === 'snapshot' && snap.you.dead).toBe(false);
      expect(snap?.t === 'snapshot' && snap.run!.time).toBeCloseTo(RUN_TIME, 0);
      expect(snap?.t === 'snapshot' && snap.run!.contracts).toEqual([]);
    }
  });
});
