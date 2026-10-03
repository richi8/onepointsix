import { describe, expect, it } from 'vitest';
import { Connection } from '../src/client/connection.ts';
import { Deathcam, type DeathcamEvent } from '../src/client/deathcam.ts';
import { GameServer } from '../src/server/server.ts';
import { DEATHCAM_AFTER, SERVER_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { isReliable, type ClientMsg, type ServerMsg } from '../src/shared/protocol.ts';
import { LagTransport, type Transport } from '../src/shared/transport.ts';
import {
  CHANGE_MAX, CHANGE_MIN, coverOf, Forecast, mainWeather, MEAN_LENGTH, sensesOf, WEATHERS, type Weather, type WeatherNow,
} from '../src/shared/weather.ts';
import { World } from '../src/shared/world.ts';

/** Every moment the weather with the upper hand turns, over `seconds` of a game from `seed`, a second apart. */
function turns(seed: number, seconds: number): { at: number; from: Weather; to: Weather }[] {
  const f = new Forecast(seed);
  const out = [];
  let was = mainWeather(f.at(0));
  for (let t = 1; t <= seconds; t++) {
    const now = mainWeather(f.at(t));
    if (now !== was) out.push({ at: t, from: was, to: now });
    was = now;
  }
  return out;
}

/** A client's transport straight into `server`, with no lag. */
function pipe(server: GameServer): LagTransport<ClientMsg, ServerMsg> {
  let id = 0;
  const inner: Transport<ClientMsg, ServerMsg> = {
    onMessage: null,
    send(msg) {
      if (msg.t === 'hello') id = server.connect((m) => inner.onMessage?.(m));
      server.receive(id, msg);
    },
  };
  return new LagTransport(inner, isReliable);
}

function steps(server: GameServer, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * SERVER_TICK_RATE); i++) server.step();
}

describe('the weather cycle', () => {
  it('is the same for the same seed and clock, whatever was asked before', () => {
    const a = new Forecast(42);
    const b = new Forecast(42);
    const times = Array.from({ length: 400 }, (_, i) => i * 7.3);
    const forwards = times.map((t) => a.at(t));
    // Asked out of order, and far ahead first.
    b.at(5000);
    const backwards = [...times].reverse().map((t) => b.at(t)).reverse();
    expect(backwards).toEqual(forwards);
    // Another island has other weather.
    expect(times.map((t) => new Forecast(43).at(t))).not.toEqual(forwards);
  });

  it('never repeats a weather, and blends each change over 30 to 60 s', () => {
    // Collected rather than asserted at each step, which takes too long with every test running at once.
    const wrong: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const f = new Forecast(seed);
      let changeStart = -1;
      let last: WeatherNow = f.at(0);
      for (let t = 0; t < 3 * 3600; t += 0.5) {
        const w = f.at(t);
        const at = `seed ${seed} at ${t} s`;
        if (w.blend < 0 || w.blend > 1) wrong.push(`${at}: blend ${w.blend}`);
        const changing = w.from !== w.to;
        if (changing && changeStart < 0) changeStart = t;
        if (!changing && changeStart >= 0) {
          const took = t - changeStart;
          if (took < CHANGE_MIN - 0.5 || took > CHANGE_MAX + 0.5) wrong.push(`${at}: a change took ${took} s`);
          if (w.to !== last.to) wrong.push(`${at}: settled on ${w.to}, not ${last.to}`);
          changeStart = -1;
        }
        if (changing && last.from === w.from && last.to === w.to && w.blend < last.blend) wrong.push(`${at}: blend went back`);
        last = w;
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps clear longest: about 5 min of it, 3 of rain and 2 of fog in every 10', () => {
    const time: Record<Weather, number> = { clear: 0, rain: 0, fog: 0 };
    let changes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const all = turns(seed, 4 * 3600);
      changes += all.length;
      for (const turn of all) expect(turn.to).not.toBe(turn.from);
      const f = new Forecast(seed);
      for (let t = 0; t < 4 * 3600; t += 5) time[mainWeather(f.at(t))] += 5;
    }
    const total = time.clear + time.rain + time.fog;
    for (const w of WEATHERS) expect(time[w] / total).toBeCloseTo(MEAN_LENGTH[w] / 600, 1);
    // A cycle of three is 10 minutes on average.
    expect((40 * 4 * 3600) / changes).toBeGreaterThan(170);
    expect((40 * 4 * 3600) / changes).toBeLessThan(230);
  });

  it('turns at least once in any 10-minute run', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const at = [0, ...turns(seed, 3 * 3600).map((t) => t.at)];
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeLessThan(600);
    }
  });

  it('opens a game on a clear day, turning first at a different time on each island', () => {
    const first = Array.from({ length: 30 }, (_, seed) => turns(seed, 600)[0]);
    for (const turn of first) expect(turn.from).toBe('clear');
    expect(new Set(first.map((t) => t.at)).size).toBeGreaterThan(20);
    expect(new Set(first.map((t) => t.to))).toEqual(new Set(['rain', 'fog']));
  });

  it('blends what bots sense across a change', () => {
    const f = new Forecast(3);
    const turn = turns(3, 3600).find((t) => t.from === 'clear' || t.to === 'clear')!;
    // Halfway through a change from or to clear, sight is between the two.
    const mid = sensesOf(f.at(turn.at - 0.5));
    const ends = [sensesOf({ from: turn.from, to: turn.from, blend: 1 }), sensesOf({ from: turn.to, to: turn.to, blend: 1 })];
    expect(mid.sight).toBeLessThan(Math.max(ends[0].sight, ends[1].sight));
    expect(mid.sight).toBeGreaterThan(Math.min(ends[0].sight, ends[1].sight));
  });
});

describe('the weather’s cover', () => {
  it('is fog’s in fog and rain’s in rain, coming in over a change', () => {
    const at = (from: Weather, to: Weather, blend: number) => coverOf(sensesOf({ from, to, blend }));
    expect(at('clear', 'clear', 1)).toEqual({ fog: 0, rain: 0 });
    expect(at('fog', 'fog', 1)).toEqual({ fog: 1, rain: 0 });
    expect(at('rain', 'rain', 1)).toEqual({ fog: 0, rain: 1 });
    // Rain shortens sight too, but that isn't fog's cover.
    expect(at('rain', 'fog', 0.5).fog).toBeCloseTo(0.5);
    for (const [from, to] of [['clear', 'fog'], ['clear', 'rain'], ['rain', 'fog'], ['fog', 'rain']] as const) {
      let last = -1;
      for (let b = 0; b <= 1; b += 0.1) {
        const c = at(from, to, b)[to as 'fog' | 'rain'];
        expect(c).toBeGreaterThanOrEqual(last);
        last = c;
      }
      expect(last).toBeCloseTo(1);
    }
  });
});

describe('the weather in a game', () => {
  const seed = 5;

  it('is the same on the server, for its bots and on the client', () => {
    const server = new GameServer(seed);
    const conn = new Connection({ seed }, new World(seed), 'offline', 'me', pipe(server));
    server.step();
    const ctx = (server as unknown as { ctx: { senses: { sight: number; hearing: number }; coming: unknown } }).ctx;
    const turn = turns(seed, 3600)[0];
    const seen = new Set<Weather>();
    for (let t = 0; t < (turn.at + 30) * SERVER_TICK_RATE; t++) {
      server.step();
      conn.update(SERVER_DT);
      if (t % 30) continue;
      // The client draws the others a little in the past; its weather is the server's of then.
      const shown = conn.renderTime();
      expect(conn.weather()).toEqual(server.forecast.at(shown));
      expect(conn.forecast!.at(server.time)).toEqual(server.weather);
      // And the bots sense the weather of this very tick.
      expect(ctx.senses).toEqual(sensesOf(server.weather));
      // And see the next change coming, as anyone outside can.
      expect(ctx.coming).toEqual(server.forecast.next(server.time));
      seen.add(mainWeather(conn.weather()!));
    }
    // The run saw it turn.
    expect(seen).toEqual(new Set([turn.from, turn.to]));
    // And ending, it tells which weather it ended in.
    let ended: Weather | null = null;
    conn.onEvents = (events) => events.forEach((e) => e.k === 'runEnd' && (ended = e.weather));
    server.receive(conn.id, { t: 'dev', cmd: { act: 'end', outcome: 'extracted' } });
    server.step();
    expect(ended).toBe(turn.to);
  });

  it('plays a death cam in the weather the kill happened in', () => {
    const server = new GameServer(seed, { mode: 'offline', operators: 1 });
    const turn = turns(seed, 3600)[0];
    // Killed just before the weather turns.
    steps(server, turn.at - DEATHCAM_AFTER - 3);
    const conn = new Connection({ seed }, new World(seed), 'offline', 'me', pipe(server));
    let killedBy: { e: DeathcamEvent; recording: ReturnType<Connection['recorded']> } | null = null;
    let ended: Weather | null = null;
    conn.onEvents = (events) => {
      for (const e of events) {
        if (e.k === 'deathcam') killedBy = { e, recording: conn.recorded() };
        if (e.k === 'runEnd') ended = e.weather;
      }
    };
    server.step();
    server.receive(conn.id, { t: 'dev', cmd: { act: 'end', outcome: 'killed' } });
    for (let t = 0; t < (DEATHCAM_AFTER + 0.5) * SERVER_TICK_RATE; t++) {
      server.step();
      conn.update(SERVER_DT);
    }
    expect(killedBy).not.toBeNull();
    expect(ended).toBe(turn.from);
    // Watched once the weather has turned.
    steps(server, 5);
    conn.update(5);
    expect(mainWeather(server.weather)).toBe(turn.to);
    const { e, recording } = killedBy!;
    const cam = new Deathcam(new World(seed), e, recording, conn.cover, conn.forecast!);
    expect(mainWeather(cam.forecast.at(cam.time))).toBe(turn.from);
    expect(cam.forecast.at(cam.time)).toEqual(server.forecast.at(cam.time));
  });
});
