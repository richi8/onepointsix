import { describe, expect, it } from 'vitest';
import { parseShareLink } from '../src/shared/share.ts';
import { DEFAULT_WORLD, parseWorldParam, sameWorld, worldParams } from '../src/shared/worldconfig.ts';

describe('world param', () => {
  it('falls back to the default world', () => {
    expect(parseWorldParam(null)).toEqual(DEFAULT_WORLD);
    expect(parseWorldParam('  ')).toEqual(DEFAULT_WORLD);
  });

  it('uses numbers as seeds and round-trips them', () => {
    expect(parseWorldParam('12345')).toEqual({ seed: 12345 });
    const q = worldParams({ seed: 4000000000 });
    expect(q).toEqual({ world: '4000000000' });
    expect(parseWorldParam(q.world)).toEqual({ seed: 4000000000 });
  });

  it('hashes any other text to a stable seed', () => {
    const a = parseWorldParam('banana');
    expect(a).toEqual(parseWorldParam('banana'));
    expect(a).not.toEqual(parseWorldParam('bananas'));
    expect(parseWorldParam('99999999999').seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('opens an old link with weather, or a time of day too, as the island alone', () => {
    expect(parseShareLink('?world=7&weather=rain').world).toEqual({ seed: 7 });
    expect(parseShareLink('?world=7&time=night&weather=fog').world).toEqual({ seed: 7 });
    expect(worldParams({ seed: 7 })).toEqual({ world: '7' });
  });

  it('tells worlds apart by island', () => {
    expect(sameWorld({ seed: 7 }, { seed: 7 })).toBe(true);
    expect(sameWorld({ seed: 7 }, { seed: 8 })).toBe(false);
  });
});
