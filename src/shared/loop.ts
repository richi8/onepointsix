/**
 * Runs `step` at a fixed rate regardless of how irregularly `advance` is
 * called. Wall-clock hiccups are absorbed up to `maxSteps` per call; beyond
 * that the loop drops time rather than spiralling.
 */
export class FixedLoop {
  readonly dt: number;
  private readonly step: () => void;
  private readonly maxSteps: number;
  private acc = 0;
  private last = -1;

  constructor(dt: number, step: () => void, maxSteps = 5) {
    this.dt = dt;
    this.step = step;
    this.maxSteps = maxSteps;
  }

  /** Feed the current time in seconds; returns how many steps ran. */
  advance(now: number): number {
    if (this.last < 0) this.last = now;
    this.acc += now - this.last;
    this.last = now;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      this.step();
      this.acc -= this.dt;
      n++;
    }
    if (n === this.maxSteps) this.acc = Math.min(this.acc, this.dt);
    return n;
  }

  /** Fraction of a step accumulated but not yet simulated, in [0, 1). */
  get alpha(): number {
    return this.acc / this.dt;
  }
}

/** Drive a FixedLoop from a timer. Works in browsers, Workers and Node. */
export function runLoop(loop: FixedLoop): () => void {
  const timer = setInterval(() => loop.advance(performance.now() / 1000), (loop.dt * 1000) / 2);
  return () => clearInterval(timer);
}
