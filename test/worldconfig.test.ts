import { describe, expect, it } from 'vitest';
import { parseShareLink } from '../src/shared/share.ts';
import { DEFAULT_WORLD, parseWorldParam, sameWorld, worldParams } from '../src/shared/worldconfig.ts';

const clear = { weather: 'clear' } as const;

describe('world param', () => {
  it('falls back to the default world', () => {
    expect(parseWorldParam(null)).toEqual(DEFAULT_WORLD);
    expect(parseWorldParam('  ')).toEqual(DEFAULT_WORLD);
  });

  it('uses numbers as seeds and round-trips them', () => {
    expect(parseWorldParam('12345')).toEqual({ seed: 12345, ...clear });
    const q = worldParams({ seed: 4000000000, ...clear });
    expect(q).toEqual({ world: '4000000000' });
    expect(parseWorldParam(q.world)).toEqual({ seed: 4000000000, ...clear });
  });

  it('hashes any other text to a stable seed', () => {
    const a = parseWorldParam('banana');
    expect(a).toEqual(parseWorldParam('banana'));
    expect(a).not.toEqual(parseWorldParam('bananas'));
    expect(parseWorldParam('99999999999').seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('carries the weather, clear by default', () => {
    const q = worldParams({ seed: 7, weather: 'fog' });
    expect(q).toEqual({ world: '7', weather: 'fog' });
    expect(parseWorldParam(q.world, q.weather)).toEqual({ seed: 7, weather: 'fog' });
    expect(parseWorldParam('7', 'snow')).toEqual({ seed: 7, ...clear });
  });

  it('opens an old link with a time of day by day, in its weather', () => {
    expect(parseShareLink('?world=7&time=night&weather=rain').world).toEqual({ seed: 7, weather: 'rain' });
    expect(parseShareLink('?world=7&time=dusk').world).toEqual({ seed: 7, ...clear });
  });

  it('tells worlds apart by island and conditions', () => {
    expect(sameWorld({ seed: 7, ...clear }, { seed: 7, ...clear })).toBe(true);
    expect(sameWorld({ seed: 7, ...clear }, { seed: 7, weather: 'fog' })).toBe(false);
    expect(sameWorld({ seed: 7, ...clear }, { seed: 8, ...clear })).toBe(false);
  });
});
