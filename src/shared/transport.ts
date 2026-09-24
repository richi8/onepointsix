/** A bidirectional message pipe. Worker today, WebSocket tomorrow. */
export interface Transport<Out, In> {
  send(msg: Out): void;
  onMessage: ((msg: In) => void) | null;
}

/** Simulated network conditions, applied independently in each direction. */
export interface NetConditions {
  /** One-way delay in ms; round trip is twice this. */
  latency: number;
  /** Extra random one-way delay in ms, uniform in [0, jitter]. */
  jitter: number;
  /** Chance in [0, 1] that an unreliable message is dropped. */
  loss: number;
}

export const PERFECT_NET: NetConditions = { latency: 0, jitter: 0, loss: 0 };

/**
 * Wraps a transport with fake latency, jitter and packet loss so netcode bugs
 * show up while playing offline. Unreliable messages can be dropped and
 * reordered; reliable ones are always delivered, in order.
 */
export class LagTransport<Out, In> implements Transport<Out, In> {
  onMessage: ((msg: In) => void) | null = null;
  readonly net: NetConditions = { ...PERFECT_NET };
  private readonly inner: Transport<Out, In>;
  private readonly isReliable: (msg: Out | In) => boolean;
  private readonly rand: () => number;
  private reliableOut = 0;
  private reliableIn = 0;

  constructor(inner: Transport<Out, In>, isReliable: (msg: Out | In) => boolean, rand = Math.random) {
    this.inner = inner;
    this.isReliable = isReliable;
    this.rand = rand;
    inner.onMessage = (msg) => {
      this.reliableIn = this.schedule(msg, this.reliableIn, (m) => this.onMessage?.(m));
    };
  }

  send(msg: Out): void {
    this.reliableOut = this.schedule(msg, this.reliableOut, (m) => this.inner.send(m));
  }

  /** Returns the updated delivery time of the last reliable message. */
  private schedule<M extends Out | In>(msg: M, lastReliable: number, deliver: (m: M) => void): number {
    const { latency, jitter, loss } = this.net;
    const reliable = this.isReliable(msg);
    if (!reliable && loss > 0 && this.rand() < loss) return lastReliable;
    const now = performance.now();
    let at = now + latency + this.rand() * jitter;
    if (reliable) at = Math.max(at, lastReliable);
    if (at <= now) deliver(msg);
    else setTimeout(() => deliver(msg), at - now);
    return reliable ? at : lastReliable;
  }
}
