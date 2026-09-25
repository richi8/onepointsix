import { describe, expect, it } from 'vitest';
import { cleanName, NAME_MAX, parseShareLink, shareQuery } from '../src/shared/share.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

describe('share links', () => {
  it('round-trips the island, mode and score to beat', () => {
    const q = shareQuery({ seed: 4242, time: 'night', weather: 'rain' }, 'offline', { name: 'Ana Nováková', score: 5400 });
    expect(q).toContain('time=night&weather=rain');
    expect(parseShareLink(q)).toEqual({
      world: { seed: 4242, time: 'night', weather: 'rain' }, mode: 'offline', challenge: { name: 'Ana Nováková', score: 5400 },
    });
  });

  it('is the plain default world without parameters', () => {
    expect(parseShareLink('')).toEqual({ world: DEFAULT_WORLD, mode: null, challenge: null });
  });

  it('shares just the island when there is no score', () => {
    expect(shareQuery({ seed: 7, time: 'day', weather: 'clear' }, 'online', { name: 'x', score: 0 })).toBe('?world=7&mode=online');
    expect(parseShareLink('?world=7&by=x').challenge).toBeNull();
  });

  it('ignores nonsense', () => {
    for (const q of ['?by=x&score=-5', '?by=x&score=1e9', '?by=x&score=12abc', '?by=%20&score=10', '?by=%20&score=10&mode=online']) {
      expect(parseShareLink(q).challenge).toBeNull();
    }
    expect(parseShareLink('?mode=deathmatch').mode).toBeNull();
    expect(parseShareLink('?mode=range').mode).toBeNull();
  });

  it('reads old Mixed links as Online', () => {
    expect(parseShareLink('?mode=mixed').mode).toBe('online');
  });

  it('keeps names short and printable', () => {
    expect(cleanName('  a\u0000b \n\t c  ')).toBe('ab c');
    expect(cleanName('x'.repeat(40))).toHaveLength(NAME_MAX);
    expect(parseShareLink(`?by=${'y'.repeat(40)}&score=1`).challenge?.name).toHaveLength(NAME_MAX);
  });
});
