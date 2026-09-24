import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT, CMDS_PER_TICK } from '../src/shared/constants.ts';
import type { InputCmd, ServerMsg } from '../src/shared/protocol.ts';
import { applyCmd, copyState } from '../src/shared/sim.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

function setup() {
  const server = new GameServer(1);
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: 'test', world: DEFAULT_WORLD, mode: 'range' });
  const lastSnapshot = () => inbox.filter((m) => m.t === 'snapshot').at(-1)!;
  return { server, id, inbox, lastSnapshot };
}

const fwd = (seq: number): InputCmd => ({ seq, buttons: Btn.Forward, yaw: 0, pitch: 0 });

describe('GameServer', () => {
  it('welcomes a client with its id and the world seed', () => {
    const { inbox, id } = setup();
    expect(inbox[0]).toEqual({ t: 'welcome', id, seed: 1, tick: 0, tickRate: 30, mode: 'range' });
  });

  it('spawns players standing on dry land', () => {
    const { server, id, lastSnapshot } = setup();
    server.step();
    const snap = lastSnapshot();
    if (snap.t !== 'snapshot') throw new Error();
    const { x, y, z } = snap.players.find((p) => p.id === id)!;
    expect(server.world.terrainHeight(x, z)).toBeGreaterThan(1);
    expect(y).toBeCloseTo(server.world.groundHeight(x, z, y));
  });

  /** The state the server should reach by applying `cmds` to `before`'s player. */
  function expected(server: GameServer, before: ServerMsg, cmds: InputCmd[]) {
    if (before.t !== 'snapshot') throw new Error();
    const s = copyState(before.you);
    for (const cmd of cmds) applyCmd(server.world, s, cmd, CMD_DT);
    return s;
  }

  it('moves a player by exactly the commands it simulated and acks them', () => {
    const { server, id, lastSnapshot } = setup();
    server.step();
    const before = lastSnapshot();
    server.receive(id, { t: 'input', cmds: [fwd(1), fwd(2)] });
    server.step();
    const snap = lastSnapshot();
    if (snap.t !== 'snapshot' || before.t !== 'snapshot') throw new Error();
    expect(snap.ack).toBe(2);
    expect(snap.you).toEqual(expected(server, before, [fwd(1), fwd(2)]));
    expect(snap.you.z).toBeLessThan(before.you.z);
    expect(snap.players.find((p) => p.id === id)!.z).toBe(snap.you.z);
  });

  it('ignores redundant resends of commands it already has', () => {
    const { server, id, lastSnapshot } = setup();
    server.step();
    const before = lastSnapshot();
    server.receive(id, { t: 'input', cmds: [fwd(1), fwd(2)] });
    server.receive(id, { t: 'input', cmds: [fwd(1), fwd(2), fwd(3)] });
    for (let i = 0; i < 3; i++) server.step();
    const snap = lastSnapshot();
    if (snap.t !== 'snapshot') throw new Error();
    expect(snap.ack).toBe(3);
    expect(snap.you).toEqual(expected(server, before, [fwd(1), fwd(2), fwd(3)]));
  });

  it('is deterministic for the same input stream', () => {
    const run = () => {
      const { server, id, lastSnapshot } = setup();
      let seq = 0;
      for (let tick = 0; tick < 90; tick++) {
        const cmds = [];
        for (let i = 0; i < CMDS_PER_TICK; i++) {
          cmds.push({ seq: ++seq, buttons: (seq * 7919) % 4096, yaw: Math.sin(seq) * 3, pitch: 0, weapon: (seq >> 6) % 3 });
        }
        server.receive(id, { t: 'input', cmds });
        server.step();
      }
      return lastSnapshot();
    };
    expect(run()).toEqual(run());
  });
});

describe('GameServer joining', () => {
  it('sends no snapshots before hello', () => {
    const server = new GameServer(1);
    const inbox: ServerMsg[] = [];
    const id = server.connect((m) => inbox.push(m));
    server.step();
    expect(inbox).toEqual([]);
    server.receive(id, { t: 'hello', name: 'late', world: DEFAULT_WORLD, mode: 'range' });
    server.step();
    expect(inbox.map((m) => m.t)).toEqual(['welcome', 'snapshot']);
  });
});
