import { describe, expect, it } from 'vitest';
import { coverBefore, Replay } from '../src/client/replay.ts';
import { ExactRun, ExactTrack, type ExactNews } from '../src/client/exactrun.ts';
import { decodeReplay, encodeReplay, FramePacker, Frames, quantizeLook, RunRecorder, type ReplayData } from '../src/client/replayfile.ts';
import { Directory } from '../src/server/directory.ts';
import { ByteReader, ByteWriter } from '../src/shared/bytes.ts';
import { quantizeView, readLog, writeLog, type GameLog } from '../src/shared/gamelog.ts';
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
  const recorder = new RunRecorder(DEFAULT_WORLD, 'offline', 'Tester', 'me', 'test');
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

  it('shows everyone else as the client was sent them: those sampled to the centimetre, the rest filled in between', async () => {
    const data = run.recorder.finish(2)!;
    const replay = new Replay(run.server.world, await decodeReplay(await encodeReplay(data)));
    const frames = new Frames(data.frames);
    expect(frames.length).toBeGreaterThan(10 * 40);
    let compared = 0;
    let filled = 0;
    frames.times.forEach((time, i) => {
      // Recording goes on a little past the replay's end, where a far body's last sample can only be held.
      if (time > data.to) return;
      const sent = run.snapshots.find((m) => Math.abs(m.tick * SERVER_DT - time) < 1e-6)!;
      const kept = frames.at(i).players;
      expect(kept.map((p) => p.id).sort()).toEqual(sent.players.map((p) => p.id).sort());
      const { sampled } = frames.quantized(i);
      kept.forEach((p) => {
        const q = sent.players.find((o) => o.id === p.id)!;
        if (!sampled.includes(p.id)) {
          // Far off and not sampled: somewhere between its samples, and alive or dead as it was.
          expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(3);
          expect(p.dead).toBe(q.dead);
          filled++;
          return;
        }
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
    // Bodies far off are sampled a fifth as often.
    expect(filled).toBeGreaterThan(compared);
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

  it('turns away what isn’t a replay, and those from before chunk 28 as another version', async () => {
    await expect(decodeReplay(new TextEncoder().encode('hello'))).rejects.toThrow('isn’t a replay');
    await expect(decodeReplay(new TextEncoder().encode('{"format":"onepointsix-replay","v":2}'))).rejects.toThrow('another version');
    const bytes = await encodeReplay(run.recorder.finish(2)!);
    await expect(decodeReplay(bytes.slice(0, bytes.length >> 1))).rejects.toThrow('isn’t a replay');
  });
});

/**
 * A human playing on a server with guards and bots after it has run a while,
 * touched by nothing but their commands and a development shortcut to end
 * the run, as in the browser; recorded as the client records it.
 */
function cleanRun(seconds: number, before = 200) {
  const server = new GameServer(DEFAULT_WORLD.seed, { mode: 'offline', guards: true, operators: 8 });
  for (let t = 0; t < before; t++) server.step();
  const recorder = new RunRecorder(DEFAULT_WORLD, 'offline', 'Tester', 'me', 'test');
  const snapshots: Snapshot[] = [];
  const id = server.connect((m) => {
    if (m.t === 'welcome') recorder.welcome(m.id, { broken: m.broken, open: m.open });
    if (m.t === 'snapshot') {
      snapshots.push(m);
      recorder.snapshot(m.tick * SERVER_DT, m.players, m.grenades, m.run, m.extracts, m.bags, m.bounty);
    }
    if (m.t === 'events') for (const e of m.events) recorder.event(m.tick * SERVER_DT, e);
  });
  server.receive(id, { t: 'hello', name: 'Tester', world: DEFAULT_WORLD, mode: 'offline' });
  let seq = 0;
  let yaw = 0;
  for (let t = 1; t <= seconds * SERVER_TICK_RATE; t++) {
    const cmds = [0, 1].map(() => {
      yaw += Math.sin(t * 0.05) * 0.013;
      const buttons = (t % 150 < 100 ? Btn.Forward : Btn.Left) | (t % 200 < 20 ? Btn.Fire | Btn.Aim : 0);
      return { seq: ++seq, buttons, yaw: quantizeLook(yaw), pitch: 0, view: quantizeView(server.tick - 3.3) };
    });
    // Now and then a packet is late, and the next brings both.
    if (t % 7) server.receive(id, { t: 'input', cmds });
    server.step();
  }
  server.receive(id, { t: 'dev', cmd: { act: 'end', outcome: 'mia' } });
  for (let t = 0; t < SERVER_TICK_RATE * 3; t++) server.step();
  return { data: recorder.finish(2)!, snapshots, id, server };
}

/** Run a replay's game again in full, as the worker does, and gather what it sends. */
function runAgain(data: ReplayData): { news: ExactNews[]; track: ExactTrack } {
  const run = new ExactRun({ log: data.log!, watch: data.id, frames: data.frames, from: data.from, to: data.to });
  const track = new ExactTrack();
  const news: ExactNews[] = [];
  for (;;) {
    const n = run.next();
    news.push(n);
    if (n.k === 'batch') track.add(n.batch);
    else break;
  }
  return { news, track };
}

describe('the game run again', () => {
  const run = cleanRun(40);

  it('keeps the game log in the file, exactly', async () => {
    expect(run.data.log).toBeDefined();
    const back = await decodeReplay(await encodeReplay(run.data));
    expect(back.log).toEqual(run.data.log);
    expect(back.log!.entries.some((e) => e.msg.t === 'input' && e.msg.cmds.some((c) => c.view !== undefined))).toBe(true);
  });

  it('shows everyone exactly as they were, every tick, checked against the frames', async () => {
    const data = await decodeReplay(await encodeReplay(run.data));
    const { news, track } = runAgain(data);
    expect(news.at(-1)).toEqual({ k: 'done' });
    const ticks = Math.round((data.to - data.from) * SERVER_TICK_RATE);
    expect(track.size).toBeGreaterThan(ticks - 5);
    const replay = new Replay(run.server.world, data, false);
    for (const n of news) replay.hear(n);
    let compared = 0;
    for (const m of run.snapshots) {
      const t = m.tick * SERVER_DT;
      if (t < data.from || t > data.to - 0.2) continue;
      replay.seek(t);
      expect(replay.exactNow).toBe(true);
      const shown = replay.others();
      const sent = m.players.filter((p) => p.id !== run.id);
      expect(shown.map((p) => p.id).sort()).toEqual(sent.map((p) => p.id).sort());
      for (const p of shown) {
        const q = sent.find((o) => o.id === p.id)!;
        // As exact as 32-bit floats keep them.
        expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.z - q.z)).toBeLessThan(1e-3);
        expect(Math.abs(angleDiff(p.yaw, q.yaw)) + Math.abs(p.pitch - q.pitch)).toBeLessThan(1e-5);
        expect([p.dead, p.weapon, p.act, p.motion]).toEqual([q.dead, q.weapon, q.act, q.motion]);
        compared++;
      }
    }
    // At least 15 s of twenty others: the tester walking about can be shot before the 40 s are up.
    expect(compared).toBeGreaterThan(15 * 30 * 20);
  });

  it('stops at the first tick that differs from the frames, and the replay goes on with them', async () => {
    const data = await decodeReplay(await encodeReplay(run.data));
    // A game set up with one operator fewer goes differently from the start.
    const log: GameLog = { ...data.log!, options: { ...data.log!.options, operators: 7 } };
    const { news, track } = runAgain({ ...data, log });
    expect(news.at(-1)?.k).toBe('diverged');
    const replay = new Replay(run.server.world, { ...data, log }, false);
    for (const n of news) replay.hear(n);
    expect(track.size).toBe(0);
    replay.seek(data.from + 5);
    expect(replay.exactNow).toBe(false);
    expect(replay.others().length).toBeGreaterThan(20);
  });

  it('is half the size of a replay in chunk 17’s file', async () => {
    // Chunk 17's file of this same 42 s run, measured before the change: gzipped JSON, frames at 15 a second.
    const chunk17 = 61_829;
    const r = cleanRun(42, 0);
    const bytes = await encodeReplay(r.data);
    expect(bytes.length).toBeLessThan(chunk17 / 2);
  });
});

describe('the game log', () => {
  it('comes back exactly from its bytes, commands and all, as floats where they aren’t whole steps', () => {
    const log: GameLog = {
      seed: 4242, options: { mode: 'online', guards: true, operators: 8, conditions: { time: 'night', weather: 'rain' } },
      entries: [
        { tick: 0, id: 33, msg: { t: 'join' } },
        { tick: 0, id: 33, msg: { t: 'hello', name: 'Ann', world: { seed: 4242, time: 'night', weather: 'rain' }, mode: 'online' } },
        { tick: 3, id: 33, msg: { t: 'input', cmds: [{ seq: 1, buttons: 5, yaw: quantizeLook(-3.1), pitch: quantizeLook(0.2), view: quantizeView(0.123456) }] } },
        { tick: 4, id: 33, msg: { t: 'input', cmds: [{ seq: 2, buttons: 0, yaw: quantizeLook(3.1), pitch: 0, weapon: 2 }, { seq: 5, buttons: 1 << 12, yaw: 0, pitch: 0, view: 3.5 }] } },
        { tick: 90, id: 33, msg: { t: 'dev', cmd: { act: 'end', outcome: 'killed', self: true } } },
        { tick: 91, id: 33, msg: { t: 'leave' } },
        { tick: 95, id: 34, msg: { t: 'join' } },
        { tick: 99, id: 34, msg: { t: 'drop' } },
      ],
    };
    const pack = (l: GameLog) => {
      const w = new ByteWriter();
      writeLog(w, l);
      return readLog(new ByteReader(w.data()));
    };
    expect(pack(log)).toEqual(log);
    // A look that isn't a whole step still comes back exactly.
    const odd: GameLog = { ...log, entries: [{ tick: 2, id: 1, msg: { t: 'input', cmds: [{ seq: 1, buttons: 0, yaw: Math.PI, pitch: 0.1, view: 1 / 3 }] } }] };
    expect(pack(odd)).toEqual(odd);
  });

  it('bytes: whole numbers of either sign, floats and text come back as they went', () => {
    const w = new ByteWriter();
    const ints = [0, 1, -1, 63, -64, 64, 127, 128, 300, -300, 2 ** 31, -(2 ** 31), 2 ** 50];
    w.ints(ints);
    w.floats([Math.PI, -0, 1e-300, 123.456]);
    w.text('Příliš žluťoučký');
    const r = new ByteReader(w.data());
    expect(r.ints()).toEqual(ints);
    expect(r.floats()).toEqual([Math.PI, -0, 1e-300, 123.456]);
    expect(r.text()).toBe('Příliš žluťoučký');
    expect(r.done).toBe(true);
    expect(() => r.uint()).toThrow();
  });
});

describe('Offline, held still', () => {
  it('stands still while its player watches their replay, and goes on after', () => {
    const directory = new Directory();
    const game = directory.quickJoin(DEFAULT_WORLD, 'offline');
    directory.step();
    const tick = game.tick;
    directory.pause(game, true);
    for (let i = 0; i < 10; i++) directory.step();
    expect(game.tick).toBe(tick);
    directory.pause(game, false);
    directory.step();
    expect(game.tick).toBe(tick + 1);
    // Online never waits: others may be playing.
    const online = directory.quickJoin(DEFAULT_WORLD, 'online');
    directory.pause(online, true);
    directory.step();
    expect(directory.paused(online)).toBe(false);
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
      expect(s.players.map((p) => p.id).sort()).toEqual(f.players.map((p) => p.id).sort());
      s.players.forEach((p) => {
        const q = f.players.find((o) => o.id === p.id)!;
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
    packer.push(1 / 10, [snap(1, 5)], []);
    // Ticks, nobody come or gone, one sampled, its id and an empty mask, then no grenades.
    expect(packer.data().length - before).toBe(7);
  });

  it('sample bodies far off a fifth as often, unless something about them changes, and fill them in between', () => {
    const packer = new FramePacker();
    const near = (p: PlayerSnap) => p.id === 1;
    for (let i = 0; i <= 10; i++) {
      const dead = i >= 7;
      packer.push(i / 10, [snap(1, i), snap(2, 100 + i * 2, { dead })], [], near);
    }
    const frames = new Frames(packer.data());
    expect(frames.length).toBe(11);
    // The far one at 0 and 5 on the clock, then at 7 when it died, then 10 would be next... but it's the last frame.
    expect([...Array(11).keys()].filter((i) => frames.quantized(i).sampled.includes(2))).toEqual([0, 5, 7]);
    expect([...Array(11).keys()].every((i) => frames.quantized(i).sampled.includes(1))).toBe(true);
    // In between, it's where it was on the way.
    expect(frames.at(3).players.find((p) => p.id === 2)!.x).toBeCloseTo(106, 2);
    expect(frames.at(6).players.find((p) => p.id === 2)!.dead).toBe(false);
    expect(frames.at(8).players.find((p) => p.id === 2)!.dead).toBe(true);
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
