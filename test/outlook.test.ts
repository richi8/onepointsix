import { describe, expect, it } from 'vitest';
import { outlookAt, WARNING, Wetting, type Outlook } from '../src/client/outlook.ts';
import { Forecast, WEATHERS, type Weather } from '../src/shared/weather.ts';

/** Every change in the first `seconds` of a game from `seed`: when it starts coming in, and from what to what. */
function changes(f: Forecast, seconds: number): { at: number; from: Weather; to: Weather }[] {
  const out = [];
  for (let t = 0; t < seconds;) {
    const next = f.next(t);
    t += next.in;
    const now = f.at(t + 1);
    out.push({ at: t, from: now.from, to: now.to });
    t += 1;
  }
  return out;
}

/** Each number in an outlook, by name. */
function numbers(o: Outlook): Record<string, number> {
  const out: Record<string, number> = { rainfall: o.rainfall, storm: o.storm, wind: o.wind, mist: o.mist };
  for (const w of WEATHERS) {
    out[`clouds.${w}`] = o.clouds[w];
    out[`air.${w}`] = o.air[w];
  }
  return out;
}

describe('the next change', () => {
  it('is where the weather starts to turn', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const f = new Forecast(seed);
      for (const c of changes(f, 3600)) {
        expect(f.at(c.at - 0.01).from).toBe(f.at(c.at - 0.01).to);
        expect(c.from).not.toBe(c.to);
        expect(f.next(c.at - 5)).toEqual({ weather: c.to, in: expect.closeTo(5, 6) });
      }
    }
  });

  it('never comes when the weather is held', () => {
    expect(new Forecast(1, 'fog').next(100).in).toBe(Infinity);
    expect(Forecast.held('clear', 'rain').next(10).in).toBe(Infinity);
    expect(Forecast.held('clear', 'rain').next(-30)).toEqual({ weather: 'rain', in: 30 });
  });
});

describe('the weather as seen and heard', () => {
  it('turns smoothly, with no jumps from one moment to the next', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const f = new Forecast(seed);
      let was = numbers(outlookAt(f, 0));
      let jump = { by: 0, what: '' };
      for (let t = 0.25; t < 3600; t += 0.25) {
        const now = numbers(outlookAt(f, t));
        for (const k of Object.keys(now)) {
          const by = Math.abs(now[k] - was[k]);
          if (by > jump.by) jump = { by, what: `${k} at ${t} s on island ${seed}` };
        }
        was = now;
      }
      expect(jump.by, jump.what).toBeLessThan(0.03);
    }
  });

  it('warns of rain a minute ahead: clouds, wind and far thunder, but no rain yet', () => {
    const f = new Forecast(2);
    const toRain = changes(f, 7200).filter((c) => c.to === 'rain' && c.from === 'clear');
    expect(toRain.length).toBeGreaterThan(0);
    for (const c of toRain) {
      const calm = outlookAt(f, c.at - WARNING - 5);
      const ahead = outlookAt(f, c.at - 15);
      expect(calm.storm).toBe(0);
      expect(ahead.rainfall).toBe(0);
      expect(ahead.storm).toBeGreaterThan(0.3);
      expect(ahead.clouds.rain).toBeGreaterThan(0.2);
      expect(ahead.wind).toBeGreaterThan(calm.wind + 0.4);
      // The air hasn't thickened yet.
      expect(ahead.air.clear).toBe(1);
    }
  });

  it('gathers mist in the hollows ahead of fog', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const f = new Forecast(seed);
      for (const c of changes(f, 7200).filter((x) => x.to === 'fog')) {
        expect(outlookAt(f, c.at - WARNING - 5).mist).toBe(0);
        expect(outlookAt(f, c.at - 10).mist).toBeGreaterThan(0.5);
        expect(outlookAt(f, c.at - 10).air.fog).toBe(0);
      }
    }
  });

  it('is the weather alone once settled', () => {
    const o = outlookAt(Forecast.held('rain', 'rain'), 0);
    expect(o).toMatchObject({ rainfall: 1, storm: 1, mist: 0, clouds: { rain: 1 }, air: { rain: 1 } });
  });
});

describe('how wet the island is', () => {
  it('soaks within a minute of rain arriving and dries over minutes after', () => {
    const f = Forecast.held('clear', 'rain', 30);
    const w = new Wetting();
    w.update(f, -10);
    expect(w.wet).toBe(0);
    expect(w.puddles).toBe(0);
    for (let t = -10; t <= 60; t += 0.1) w.update(f, t);
    expect(w.wet).toBe(1);
    expect(w.puddles).toBeGreaterThan(0.3);
    expect(w.puddles).toBeLessThan(0.8);

    const after = Forecast.held('rain', 'clear', 30);
    const dry = new Wetting();
    dry.update(after, 90);
    expect(dry.wet).toBeGreaterThan(0.4);
    expect(dry.wet).toBeLessThan(0.9);
    // The puddles outlast the wet ground.
    dry.update(after, 230);
    expect(dry.wet).toBe(0);
    expect(dry.puddles).toBeGreaterThan(0.2);
    dry.update(after, 600);
    expect(dry.puddles).toBe(0);
  });

  it('is the same followed along the clock as worked out after a jump', () => {
    const f = new Forecast(5);
    const along = new Wetting();
    const jumped = new Wetting();
    for (let t = 0; t <= 3000; t += 1 / 30) {
      along.update(f, t);
      if (Math.abs(t - Math.round(t / 250) * 250) < 1 / 60) {
        jumped.update(f, t);
        expect(along.wet).toBeCloseTo(jumped.wet, 1);
        expect(along.puddles).toBeCloseTo(jumped.puddles, 1);
      }
    }
  });
});
