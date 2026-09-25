import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD, parseWorldParam, sameWorld, worldParams } from '../src/shared/worldconfig.ts';

const day = { time: 'day', weather: 'clear' } as const;

describe('world param', () => {
  it('falls back to the default world', () => {
    expect(parseWorldParam(null)).toEqual(DEFAULT_WORLD);
    expect(parseWorldParam('  ')).toEqual(DEFAULT_WORLD);
  });

  it('uses numbers as seeds and round-trips them', () => {
    expect(parseWorldParam('12345')).toEqual({ seed: 12345, ...day });
    const q = worldParams({ seed: 4000000000, ...day });
    expect(q).toEqual({ world: '4000000000' });
    expect(parseWorldParam(q.world)).toEqual({ seed: 4000000000, ...day });
  });

  it('hashes any other text to a stable seed', () => {
    const a = parseWorldParam('banana');
    expect(a).toEqual(parseWorldParam('banana'));
    expect(a).not.toEqual(parseWorldParam('bananas'));
    expect(parseWorldParam('99999999999').seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('carries the time of day and weather, a clear day by default', () => {
    const q = worldParams({ seed: 7, time: 'night', weather: 'fog' });
    expect(q).toEqual({ world: '7', time: 'night', weather: 'fog' });
    expect(parseWorldParam(q.world, q.time, q.weather)).toEqual({ seed: 7, time: 'night', weather: 'fog' });
    expect(parseWorldParam('7', 'midnight', 'snow')).toEqual({ seed: 7, ...day });
    expect(parseWorldParam(null, 'dusk', 'rain')).toEqual({ ...DEFAULT_WORLD, time: 'dusk', weather: 'rain' });
  });

  it('tells worlds apart by island and conditions', () => {
    expect(sameWorld({ seed: 7, ...day }, { seed: 7, ...day })).toBe(true);
    expect(sameWorld({ seed: 7, ...day }, { seed: 7, time: 'night', weather: 'clear' })).toBe(false);
    expect(sameWorld({ seed: 7, ...day }, { seed: 8, ...day })).toBe(false);
  });
});
