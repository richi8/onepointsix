import type * as THREE from 'three';

// Keeps the frame rate up on slower machines by rendering fewer pixels while
// frames run long, and more again once there's headroom. The HUD is HTML, so
// it stays sharp either way.

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

export class Resolution {
  /** Smoothed frame time, in ms. */
  frameMs = 16.7;
  private readonly renderer: THREE.WebGLRenderer;
  private scale = 1;
  private slowFor = 0;
  private fastFor = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.setPixelRatio(this.ratio);
  }

  get fps(): number {
    return 1000 / this.frameMs;
  }

  /** How much of the device's resolution is being drawn, 0 to 1. */
  get share(): number {
    return this.ratio / Math.min(devicePixelRatio, MAX_RATIO);
  }

  /** Called once a frame with the seconds it took. */
  update(dt: number): void {
    // Long gaps are the tab being hidden or a hitch, not the steady rate.
    if (dt <= 0 || dt > 0.25) return;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.slowFor = this.frameMs > SLOW ? this.slowFor + dt : 0;
    this.fastFor = this.frameMs < FAST ? this.fastFor + dt : 0;
    if (this.slowFor > HOLD_SLOW && this.scale > MIN_SCALE) this.set(this.scale - STEP);
    else if (this.fastFor > HOLD_FAST && this.scale < 1) this.set(this.scale + STEP);
  }

  private get ratio(): number {
    return Math.max(Math.min(devicePixelRatio, MAX_RATIO) * this.scale, 0.5);
  }

  private set(scale: number): void {
    this.scale = Math.min(Math.max(scale, MIN_SCALE), 1);
    this.slowFor = this.fastFor = 0;
    this.renderer.setPixelRatio(this.ratio);
  }
}
