import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/shared/loop.ts';

describe('FixedLoop', () => {
  it('runs one step per dt of elapsed time', () => {
    let steps = 0;
    const loop = new FixedLoop(0.1, () => steps++);
    loop.advance(0);
    loop.advance(0.25);
    expect(steps).toBe(2);
    loop.advance(0.36);
    expect(steps).toBe(3);
  });

  it('caps steps after a stall instead of spiralling', () => {
    let steps = 0;
    const loop = new FixedLoop(0.1, () => steps++, 5);
    loop.advance(0);
    loop.advance(10);
    expect(steps).toBe(5);
    loop.advance(10.1);
    expect(steps).toBeLessThanOrEqual(7);
  });
});
