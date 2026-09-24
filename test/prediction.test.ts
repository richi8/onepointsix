import { describe, expect, it } from 'vitest';
import { Predictor } from '../src/client/prediction.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMDS_PER_TICK } from '../src/shared/constants.ts';
import type { InputCmd, ServerMsg } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

/**
 * A client and server exchanging messages through a pipe with a fixed delay in
 * server ticks and optional loss of unreliable messages, mirroring what
 * Connection does with the commands and snapshots.
 */
function session(delayTicks: number, loss: number) {
  const server = new GameServer(DEFAULT_WORLD.seed);
  const predictor = new Predictor(server.world);
  const rand = mulberry32(7);
  const toClient: { at: number; msg: ServerMsg }[] = [];
  const toServer: { at: number; cmds: InputCmd[] }[] = [];
  const id = server.connect((msg) => toClient.push({ at: server.tick + delayTicks, msg }));
  server.receive(id, { t: 'hello', name: 'test', world: DEFAULT_WORLD, mode: 'range' });

  let unacked: InputCmd[] = [];
  let ack = 0;
  let seq = 0;
  let buttons = 0;
  let yaw = 0;
  let weapon = 0;

  const tick = (driveInput: boolean) => {
    if (driveInput) {
      for (let i = 0; i < CMDS_PER_TICK; i++) {
        if (rand() < 0.1) buttons = Math.floor(rand() * 4096);
        if (rand() < 0.01) weapon = Math.floor(rand() * 3);
        yaw += (rand() - 0.5) * 0.2;
        const cmd = { seq: ++seq, buttons, yaw, pitch: 0, weapon, view: server.tick - delayTicks - 3 };
        unacked.push(cmd);
        predictor.predict(cmd);
        if (rand() >= loss) toServer.push({ at: server.tick + delayTicks, cmds: unacked.slice(-8) });
      }
    }
    while (toServer.length && toServer[0].at <= server.tick) server.receive(id, { t: 'input', cmds: toServer.shift()!.cmds });
    server.step();
    while (toClient.length && toClient[0].at <= server.tick) {
      const msg = toClient.shift()!.msg;
      if (msg.t !== 'snapshot' || (loss > 0 && rand() < loss)) continue;
      if (msg.ack > ack) {
        ack = msg.ack;
        unacked = unacked.filter((c) => c.seq > ack);
      }
      predictor.reconcile(msg.you, unacked);
    }
  };

  return { server, predictor, tick, unacked: () => unacked };
}

describe('client prediction', () => {
  it('never mispredicts with latency when nothing is lost', () => {
    const s = session(3, 0);
    for (let i = 0; i < 300; i++) s.tick(true);
    for (let i = 0; i < 10; i++) s.tick(false);
    expect(s.predictor.state).not.toBeNull();
    expect(s.predictor.corrections).toBe(0);
    expect(s.unacked()).toHaveLength(0);
  });

  it('stays exact when input and snapshot packets are lost', () => {
    const s = session(3, 0.2);
    for (let i = 0; i < 300; i++) s.tick(true);
    for (let i = 0; i < 10; i++) s.tick(false);
    expect(s.predictor.corrections).toBe(0);
  });

  it('moves the local player the moment input is pressed', () => {
    const s = session(5, 0);
    for (let i = 0; i < 10; i++) s.tick(false);
    const before = { ...s.predictor.state! };
    s.predictor.predict({ seq: 1, buttons: Btn.Forward, yaw: 0, pitch: 0 });
    expect(s.predictor.state!.vz).toBeLessThan(0);
    expect(s.predictor.state!.z).toBeLessThan(before.z);
  });

  it('snaps to the server after a large correction and smooths small ones', () => {
    const s = session(0, 0);
    for (let i = 0; i < 5; i++) s.tick(false);
    const auth = { ...s.predictor.state! };
    s.predictor.reconcile({ ...auth, x: auth.x + 0.5 }, []);
    expect(s.predictor.corrections).toBe(1);
    expect(s.predictor.error.x).toBeCloseTo(-0.5);
    const drawn = s.predictor.render(1)!;
    expect(drawn.x).toBeCloseTo(auth.x);
    s.predictor.update(1);
    expect(Math.abs(s.predictor.error.x)).toBeLessThan(1e-3);

    s.predictor.reconcile({ ...auth, x: auth.x + 50 }, []);
    expect(s.predictor.error.x).toBe(0);
    expect(s.predictor.render(1)!.x).toBe(auth.x + 50);
  });
});
