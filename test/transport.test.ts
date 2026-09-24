import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LagTransport, type Transport } from '../src/shared/transport.ts';

type Msg = { reliable: boolean; n: number };

function pipe() {
  const sent: Msg[] = [];
  const inner: Transport<Msg, Msg> = { send: (m) => sent.push(m), onMessage: null };
  const received: Msg[] = [];
  let r = 0;
  const rolls = [0.9, 0.1, 0.5, 0.0, 0.7];
  const lag = new LagTransport<Msg, Msg>(inner, (m) => m.reliable, () => rolls[r++ % rolls.length]);
  lag.onMessage = (m) => received.push(m);
  return { lag, inner, sent, received };
}

describe('LagTransport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes messages straight through with perfect conditions', () => {
    const { lag, inner, sent, received } = pipe();
    lag.send({ reliable: false, n: 1 });
    inner.onMessage!({ reliable: false, n: 2 });
    expect(sent.map((m) => m.n)).toEqual([1]);
    expect(received.map((m) => m.n)).toEqual([2]);
  });

  it('delays delivery by the configured latency', () => {
    const { lag, sent } = pipe();
    lag.net.latency = 50;
    lag.send({ reliable: true, n: 1 });
    vi.advanceTimersByTime(49);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
  });

  it('drops only unreliable messages', () => {
    const { lag, sent } = pipe();
    lag.net.loss = 1;
    lag.send({ reliable: false, n: 1 });
    lag.send({ reliable: true, n: 2 });
    expect(sent.map((m) => m.n)).toEqual([2]);
  });

  it('keeps reliable messages in order despite jitter', () => {
    const { lag, sent } = pipe();
    lag.net.latency = 10;
    lag.net.jitter = 100;
    for (let n = 0; n < 5; n++) lag.send({ reliable: true, n });
    vi.advanceTimersByTime(200);
    expect(sent.map((m) => m.n)).toEqual([0, 1, 2, 3, 4]);
  });
});
