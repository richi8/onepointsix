import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { applyCmd, copyState, copyStateInto, sameState, spawnState, type PlayerState } from '../src/shared/sim.ts';
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
        tape.record(cmd, p);
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

  it('tells apart and copies every field of a player', () => {
    const base = copyState(spawnState(1, 2, 3));
    for (const [k, v] of Object.entries(base)) {
      const changed = copyState(base) as unknown as Record<string, unknown>;
      if (Array.isArray(v)) changed[k] = v.map((e) => (typeof e === 'boolean' ? !e : e + 1));
      else changed[k] = typeof v === 'boolean' ? !v : (v as number) + 1;
      expect(sameState(base, changed as unknown as PlayerState), k).toBe(false);
      const out = copyState(base);
      copyStateInto(out, changed as unknown as PlayerState);
      expect(out, k).toEqual(changed);
    }
    expect(sameState(base, copyState(base))).toBe(true);
  });

  it('keys what the server changes between commands, and replays across it exactly', () => {
    const tape = new Tape();
    const p = spawnState(30, world.groundHeight(30, 30, world.terrainHeight(30, 30) + 1), 30);
    const truth: { time: number; x: number; hp: number; carry: number }[] = [];
    let seq = 0;
    for (let t = 1; t <= 90; t++) {
      tape.beginTick(p, (t - 1) / SERVER_TICK_RATE);
      for (let i = 0; i < 2; i++) {
        tape.sync(p);
        const cmd = { seq: ++seq, buttons: Btn.Forward, yaw: 0.3, pitch: 0 };
        applyCmd(world, p, cmd, CMD_DT);
        tape.record(cmd, p);
        // Loot handed over between two commands slows them from the next one on.
        if (t === 20 && i === 0) p.carry = 45;
      }
      if (t === 40) p.hp = 55;
      truth.push({ time: t / SERVER_TICK_RATE, x: p.x, hp: p.hp, carry: p.carry });
    }
    const clip = tape.clip(0)!;
    expect(clip.keys.filter((k) => k.changed).map((k) => [k.state.carry, k.state.hp])).toEqual([[45, 100], [45, 55]]);
    const player = new TapePlayer(world, clip);
    for (const at of truth) {
      player.seek(at.time - CMD_DT);
      expect([player.state.x, player.state.hp, player.state.carry]).toEqual([at.x, at.hp, at.carry]);
    }
  });

  it('replays bots on the server exactly', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { guards: true, operators: 4 });
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
