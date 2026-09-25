import type * as THREE from 'three';

// Keeps the frame rate up on slower machines by rendering fewer pixels while
// frames run long, and more again once there's headroom. The HUD is HTML, so
// it stays sharp either way. A step up that turns out too slow is remembered,
// and not tried again for a while, longer each time, so a machine that sits
// between two steps settles instead of switching back and forth.

/** Frame times, in ms, that count as too slow and as comfortably fast. */
const SLOW = 1000 / 50;
const FAST = 1000 / 70;
/** Seconds a frame rate must hold before the resolution changes. */
const HOLD_SLOW = 1.5;
const HOLD_FAST = 6;
const STEP = 0.15;
/** Lowest share of the device's pixel ratio to render at. */
const MIN_SCALE = 0.5;
const MAX_RATIO = 2;
/** A step up that turns slow within this many seconds was one step too far. */
const TOO_FAR = 10;
/** Seconds before trying a step that was too far again, doubling each time, up to BACKOFF_MAX. */
const BACKOFF = 30;
const BACKOFF_MAX = 600;

export class Resolution {
  /** Smoothed frame time, in ms. */
  frameMs = 16.7;
  private readonly renderer: THREE.WebGLRenderer;
  private scale = 1;
  private slowFor = 0;
  private fastFor = 0;
  /** Seconds of frames seen, for timing the back-off. */
  private time = 0;
  private raisedAt = -Infinity;
  /** The lowest scale found too slow lately, and until when it's off limits. */
  private ceiling = Infinity;
  private ceilingUntil = 0;
  private backoff = BACKOFF;
  /** How many times the scale has changed, for tests and the debug panel. */
  changes = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.setPixelRatio(this.ratio);
  }

  /** How much of the device's resolution is being drawn, 0 to 1. */
  get share(): number {
    return this.ratio / Math.min(devicePixelRatio, MAX_RATIO);
  }

  /** Called once a frame with the seconds it took. */
  update(dt: number): void {
    // Long gaps are the tab being hidden or a hitch, not the steady rate.
    if (dt <= 0 || dt > 0.25) return;
    this.time += dt;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.slowFor = this.frameMs > SLOW ? this.slowFor + dt : 0;
    this.fastFor = this.frameMs < FAST ? this.fastFor + dt : 0;
    if (this.slowFor > HOLD_SLOW && this.scale > MIN_SCALE) {
      if (this.time - this.raisedAt < TOO_FAR) {
        this.ceiling = this.scale;
        this.ceilingUntil = this.time + this.backoff;
        this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX);
      }
      this.set(this.scale - STEP);
    } else if (this.fastFor > HOLD_FAST && this.scale < 1) {
      const next = Math.min(this.scale + STEP, 1);
      if (next >= this.ceiling - 1e-6 && this.time < this.ceilingUntil) return;
      this.raisedAt = this.time;
      this.set(next);
    }
  }

  private get ratio(): number {
    return Math.max(Math.min(devicePixelRatio, MAX_RATIO) * this.scale, 0.5);
  }

  private set(scale: number): void {
    this.scale = Math.min(Math.max(scale, MIN_SCALE), 1);
    this.slowFor = this.fastFor = 0;
    this.changes++;
    this.renderer.setPixelRatio(this.ratio);
  }
}
