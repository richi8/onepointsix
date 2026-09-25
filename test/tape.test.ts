import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { Tape, TAPE_TIME, TapePlayer } from '../src/shared/tape.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

describe('tape', () => {
  const world = new World(DEFAULT_WORLD.seed);

  /** Walk a player about for `ticks` ticks, recording it; returns where it was after each tick. */
  function record(ticks: number) {
    const tape = new Tape();
    const x = 30;
    const z = 30;
    const p = spawnState(x, world.groundHeight(x, z, world.terrainHeight(x, z) + 1), z);
    const truth: { time: number; x: number; z: number; yaw: number }[] = [];
    let seq = 0;
    for (let t = 1; t <= ticks; t++) {
      tape.beginTick(p, (t - 1) / SERVER_TICK_RATE);
      for (let i = 0; i < 2; i++) {
        const buttons = (t % 90 < 45 ? Btn.Forward : Btn.Right) | (t % 20 === 0 ? Btn.Jump : 0);
        const cmd = { seq: ++seq, buttons, yaw: t * 0.01, pitch: 0 };
        applyCmd(world, p, cmd, CMD_DT);
        tape.record(cmd);
      }
      truth.push({ time: t / SERVER_TICK_RATE, x: p.x, z: p.z, yaw: p.yaw });
    }
    return { tape, truth, p };
  }

  it('rebuilds a player from any point of its recent past', () => {
    const { tape, truth } = record(SERVER_TICK_RATE * 12);
    const from = truth.at(-1)!.time - 5;
    const player = new TapePlayer(world, tape.clip(from)!);
    expect(player.start).toBeLessThanOrEqual(from);
    for (const at of truth.filter((s) => s.time >= from)) {
      player.seek(at.time - CMD_DT);
      expect([player.state.x, player.state.z, player.state.yaw]).toEqual([at.x, at.z, at.yaw]);
    }
  });

  it('forgets what is older than it keeps', () => {
    const { tape, truth } = record(SERVER_TICK_RATE * 20);
    const clip = tape.clip(0)!;
    expect(clip.keys[0].at).toBeGreaterThanOrEqual(truth.at(-1)!.time - TAPE_TIME - 1);
    expect(clip.cmds.length).toBeLessThanOrEqual((TAPE_TIME + 1) * 60);
  });

  it('blends between commands and rewinds when seeking back', () => {
    const { tape, truth } = record(SERVER_TICK_RATE * 3);
    const player = new TapePlayer(world, tape.clip(0)!);
    const a = truth[40];
    const b = truth[41];
    player.seek((a.time + b.time) / 2);
    const mid = player.render((a.time + b.time) / 2);
    expect(mid.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - 1e-9);
    expect(mid.x).toBeLessThanOrEqual(Math.max(a.x, b.x) + 1e-9);
    player.seek(truth[10].time - CMD_DT);
    expect(player.state.x).toBe(truth[10].x);
  });

  it('replays bots on the server exactly', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { dummies: false, guards: true, operators: 4, runs: true });
    for (let i = 0; i < SERVER_TICK_RATE * 20; i++) server.step();
    let compared = 0;
    for (const b of server.bots()) {
      const tape = (b.state as unknown as { tape: Tape }).tape;
      const player = new TapePlayer(server.world, tape.clip(server.time - 5)!);
      player.seek(server.time);
      if (b.state.dead) continue;
      expect([player.state.x, player.state.y, player.state.z, player.state.yaw]).toEqual([b.state.x, b.state.y, b.state.z, b.state.yaw]);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });
});
