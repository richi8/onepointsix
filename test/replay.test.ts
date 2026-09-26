import { describe, expect, it } from 'vitest';
import { coverBefore, Replay } from '../src/client/replay.ts';
import { decodeReplay, encodeReplay, FramePacker, Frames, quantizeLook, RunRecorder } from '../src/client/replayfile.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT, SERVER_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { angleDiff } from '../src/shared/geom.ts';
import type { GameEvent, PlayerSnap, ServerMsg } from '../src/shared/protocol.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

type Snapshot = Extract<ServerMsg, { t: 'snapshot' }>;

/** Server internals a test reaches into. */
interface Inside {
  players: Map<number, PlayerState & { protection: number; run: { start: number } | null }>;
  damage(victim: unknown, attacker: unknown, amount: number, zone: string, weapon: number, x: number, y: number, z: number): void;
}

function snap(id: number, x: number, over: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    id, team: 'operator', x, y: 1.234, z: -x, yaw: 3.1, pitch: -0.2, duck: 0.5, lean: -1, dead: false, weapon: 2,
    quiet: true, motion: 'air', act: 'reload', actT: 0.37, commander: false, light: true, ...over,
  };
}

/**
 * A human playing on a server with guards and bots, recorded the way the
 * client records it. They walk about, get hurt, and at the end are killed.
 * Returns the replay and the truth: the server's copy of them after every tick.
 */
function playRun(seconds: number) {
  const server = new GameServer(DEFAULT_WORLD.seed, { mode: 'offline', guards: true, operators: 8 });
  const inside = server as unknown as Inside;
  const recorder = new RunRecorder(DEFAULT_WORLD, 'offline', 'Tester', 'test');
  const snapshots: Snapshot[] = [];
  let ended = false;
  const id = server.connect((m) => {
    if (m.t === 'welcome') recorder.welcome(m.id, { broken: m.broken, open: m.open });
    if (m.t === 'snapshot') {
      snapshots.push(m);
      recorder.snapshot(m.tick * SERVER_DT, m.players, m.grenades, m.run, m.extracts, m.bags);
    }
    if (m.t === 'events') {
      for (const e of m.events) {
        recorder.event(m.tick * SERVER_DT, e);
        if (e.k === 'runEnd') ended = true;
      }
    }
  });
  server.receive(id, { t: 'hello', name: 'Tester', world: DEFAULT_WORLD, mode: 'offline' });
  const me = inside.players.get(id)!;
  const truth: { time: number; state: PlayerState }[] = [];
  let seq = 0;
  let yaw = 0;
  const ticks = seconds * SERVER_TICK_RATE; // a multiple of 250, to die at the end
  for (let t = 1; !ended && t <= ticks + SERVER_TICK_RATE * 3; t++) {
    if (t <= ticks) {
      const cmds = [0, 1].map((i) => {
        yaw += Math.sin(t * 0.05) * 0.013;
        const buttons = (t % 150 < 100 ? Btn.Forward : Btn.Left) | (t % 90 === 0 ? Btn.Jump : 0) | (t % 200 < 20 ? Btn.Fire | Btn.Aim : 0) |
          (t % 300 > 280 ? Btn.Sprint : 0);
        return { seq: ++seq, buttons, yaw: quantizeLook(yaw), pitch: quantizeLook(Math.sin(t * 0.01) * 0.3), weapon: t > 400 && i ? 1 : undefined };
      });
      server.receive(id, { t: 'input', cmds });
    }
    // Only the test hurts them: the guards shoot blanks.
    me.protection = 99;
    server.step();
    // Hurt now and then from outside their commands, and killed at the end.
    const other = server.bots()[0];
    if (t % 250 === 0 && !me.dead) {
      me.protection = 0;
      inside.damage(me, inside.players.get(other.id), t === ticks ? 500 : 12, 'torso', 0, me.x, me.y + 1, me.z);
    }
    if (!me.dead || !truth.at(-1)?.state.dead) truth.push({ time: server.time, state: { ...me, mag: [...me.mag], reserve: [...me.reserve] } });
  }
  // The body lies there a moment more, still recorded.
  for (let t = 0; t < SERVER_TICK_RATE * 3; t++) server.step();
  return { recorder, truth, snapshots, id, server };
}

describe('replays', () => {
  const run = playRun(250 / 6);

  it('rebuilds the player exactly at any moment, in any order, after a trip through the file', async () => {
    const data = run.recorder.finish(2)!;
    expect(data).not.toBeNull();
    expect(data.end.outcome).toBe('killed');
    const bytes = await encodeReplay(data);
    const back = await decodeReplay(bytes);
    const replay = new Replay(run.server.world, back);
    // Some changed keys were written for the damage done outside the commands.
    expect(data.tape.keys.filter((k) => k.changed).length).toBeGreaterThanOrEqual(4);
    const moments = run.truth.filter((s) => s.time >= replay.start && s.time <= replay.runOver + 1e-6);
    expect(moments.length).toBeGreaterThan(SERVER_TICK_RATE * 35);
    // In order, then shuffled so it jumps back and far ahead.
    const shuffled = [...moments].sort((a, b) => Math.sin(a.time * 977) - Math.sin(b.time * 977));
    for (const m of [...moments, ...shuffled.slice(0, 200)]) {
      replay.seek(m.time - CMD_DT);
      const s = replay.state;
      expect([m.time, s.x, s.y, s.z, s.yaw, s.pitch, s.hp, s.dead, s.weapon, s.mag[s.weapon]])
        .toEqual([m.time, m.state.x, m.state.y, m.state.z, m.state.yaw, m.state.pitch, m.state.hp, m.state.dead, m.state.weapon, m.state.mag[m.state.weapon]]);
    }
    replay.seek(replay.end);
    expect(replay.state.dead).toBe(true);
  });

  it('shows everyone else as the client was sent them, to the centimetre', async () => {
    const data = run.recorder.finish(2)!;
    const replay = new Replay(run.server.world, await decodeReplay(await encodeReplay(data)));
    const frames = new Frames(data.frames);
    expect(frames.length).toBeGreaterThan(15 * 40);
    let compared = 0;
    frames.times.forEach((time, i) => {
      const sent = run.snapshots.find((m) => Math.abs(m.tick * SERVER_DT - time) < 1e-6)!;
      const kept = frames.at(i).players;
      expect(kept.map((p) => p.id)).toEqual(sent.players.map((p) => p.id));
      kept.forEach((p, j) => {
        const q = sent.players[j];
        expect(Math.abs(p.x - q.x)).toBeLessThan(0.006);
        expect(Math.abs(p.y - q.y)).toBeLessThan(0.006);
        expect(Math.abs(p.z - q.z)).toBeLessThan(0.006);
        expect(Math.abs(angleDiff(p.yaw, q.yaw))).toBeLessThan(0.001);
        expect([p.team, p.dead, p.weapon, p.motion, p.act, p.quiet, p.light, p.commander])
          .toEqual([q.team, q.dead, q.weapon, q.motion, q.act, q.quiet, q.light, q.commander]);
        compared++;
      });
      // The replay draws everyone but its player from them, until it ends.
      if (time > replay.end) return;
      replay.seek(time);
      const shown = replay.others();
      expect(shown.some((p) => p.id === run.id)).toBe(false);
      expect(shown.length).toBeGreaterThanOrEqual(kept.length - 3);
      for (const p of shown) {
        const q = kept.find((o) => o.id === p.id);
        // Someone dying by the next frame is drawn as they are then, not slid across.
        if (q && q.dead === p.dead) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(1e-9);
      }
    });
    expect(compared).toBeGreaterThan(1000);
  });

  it('keeps the run, the extraction points and the events, and plays them in order', async () => {
    const data = run.recorder.finish(2)!;
    const replay = new Replay(run.server.world, data);
    expect(data.runs.length).toBeGreaterThan(0);
    expect(data.extracts.length).toBeGreaterThan(0);
    replay.seek(replay.start + 10);
    const clock = replay.run()!.time;
    replay.seek(replay.start + 12);
    expect(clock - replay.run()!.time).toBeCloseTo(2, 1);
    expect(replay.extracts().length).toBe(run.server.world.extracts.length);

    replay.seek(replay.start);
    const seen: GameEvent[] = [];
    while (replay.playing) replay.update(0.1, () => {}, (e) => seen.push(e));
    expect(seen.length).toBe(data.events.length);
    expect(seen.some((e) => e.k === 'hurt')).toBe(true);
    expect(seen.some((e) => e.k === 'kill' && e.victim === run.id)).toBe(true);
    expect(replay.marks()).toContainEqual(expect.objectContaining({ kind: 'death' }));
  });

  it('stays small', async () => {
    const bytes = await encodeReplay(run.recorder.finish(2)!);
    // About 45 s of play with 30-odd bodies on the island.
    expect(bytes.length).toBeLessThan(150_000);
  });

  it('turns away what isn’t a replay', async () => {
    await expect(decodeReplay(new TextEncoder().encode('hello'))).rejects.toThrow('isn’t a replay');
    await expect(decodeReplay(new TextEncoder().encode('{"format":"onepointsix-replay","v":99}'))).rejects.toThrow('another version');
  });
});

describe('frames', () => {
  it('pack everyone to the centimetre, with players coming and going', () => {
    const packer = new FramePacker();
    const input = [
      { time: 1, players: [snap(1, 10), snap(2, 20, { team: 'guard', dead: true, act: 'throw', motion: 'mantle' })] },
      { time: 1 + 2 / 30, players: [snap(1, 10)] },
      { time: 1 + 4 / 30, players: [snap(2, 21.004, { commander: true }), snap(1, -300.2, { yaw: -3.1 })] },
    ];
    for (const f of input) packer.push(f.time, f.players, [{ id: 7, x: 1.111, y: 2, z: -3 }]);
    const frames = new Frames(packer.data());
    expect(frames.length).toBe(3);
    input.forEach((f, i) => {
      const s = frames.at(i);
      expect(s.time).toBeCloseTo(f.time, 9);
      expect(s.grenades).toEqual([{ id: 7, x: 1.11, y: 2, z: -3 }]);
      expect(s.players.map((p) => p.id)).toEqual(f.players.map((p) => p.id));
      s.players.forEach((p, j) => {
        const q = f.players[j];
        expect(p.x).toBeCloseTo(q.x, 2);
        expect(p.z).toBeCloseTo(q.z, 2);
        expect(p.actT).toBeCloseTo(q.actT, 2);
        expect({ ...p, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, duck: 0, lean: 0, actT: 0 })
          .toEqual({ ...q, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, duck: 0, lean: 0, actT: 0 });
      });
    });
  });

  it('cost two numbers for someone standing still', () => {
    const packer = new FramePacker();
    packer.push(0, [snap(1, 5)], []);
    const before = packer.data().length;
    packer.push(1 / 15, [snap(1, 5)], []);
    // Ticks, count, then id and an empty mask, then no grenades.
    expect(packer.data().length - before).toBe(5);
  });
});

describe('cover history', () => {
  it('rebuilds the panels down and the doors open at an earlier time', () => {
    const events = [
      { time: 1, e: { k: 'break', panels: [3, 4], x: 0, y: 0, z: 0 } as GameEvent },
      { time: 2, e: { k: 'repair', panels: [9] } as GameEvent },
      { time: 2.2, e: { k: 'door', doors: [0, 1], open: true, x: 0, y: 0, z: 0 } as GameEvent },
      { time: 3, e: { k: 'break', panels: [5], x: 0, y: 0, z: 0 } as GameEvent },
      { time: 3.5, e: { k: 'door', doors: [6], open: false, x: 0, y: 0, z: 0 } as GameEvent },
    ];
    // Down now: 3, 4, 5 and 7; 9 was rebuilt at 2. Open now: 0, 1 and 2; 6 was shut at 3.5.
    const now = { broken: [3, 4, 5, 7], open: [0, 1, 2] };
    const early = coverBefore(now, events, 0.5);
    expect(early.broken.sort()).toEqual([7, 9]);
    expect(early.open.sort()).toEqual([2, 6]);
    const later = coverBefore(now, events, 2.5);
    expect(later.broken.sort()).toEqual([3, 4, 7]);
    expect(later.open.sort()).toEqual([0, 1, 2, 6]);
  });
});
