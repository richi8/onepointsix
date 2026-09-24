import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD, parseWorldParam, worldParam } from '../src/shared/worldconfig.ts';

describe('world param', () => {
  it('falls back to the default world', () => {
    expect(parseWorldParam(null)).toEqual(DEFAULT_WORLD);
    expect(parseWorldParam('  ')).toEqual(DEFAULT_WORLD);
  });

  it('uses numbers as seeds and round-trips them', () => {
    expect(parseWorldParam('12345')).toEqual({ seed: 12345 });
    expect(parseWorldParam(worldParam({ seed: 4000000000 }))).toEqual({ seed: 4000000000 });
  });

  it('hashes any other text to a stable seed', () => {
    const a = parseWorldParam('banana');
    expect(a).toEqual(parseWorldParam('banana'));
    expect(a).not.toEqual(parseWorldParam('bananas'));
    expect(parseWorldParam('99999999999').seed).toBeLessThanOrEqual(0xffffffff);
  });
});
