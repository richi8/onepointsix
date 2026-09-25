import type * as THREE from 'three';
import { BOLT, PISTOL } from '../shared/weapons.ts';
import type { Surface } from './surface.ts';

// Every sound is synthesized from noise and oscillators, so there is nothing
// to load. Sounds out in the world are placed in 3D around the listener, who
// hears with the camera: they pan and muffle with distance, like the real thing.

/** Where a sound comes from; omitted for your own sounds, which play in your head. */
export interface At {
  x: number;
  y: number;
  z: number;
}

interface ShotVoice {
  /** Low-pass cutoff at the crack, in Hz. */
  cutoff: number;
  /** Seconds for the crack to fade. */
  decay: number;
  /** Strength of the low thump under it. */
  thump: number;
  /** Seconds of the echo tail rolling off the island. */
  tail: number;
  gain: number;
}

const VOICES: ShotVoice[] = [
  { cutoff: 5200, decay: 0.16, thump: 0.8, tail: 0.5, gain: 0.55 },
  { cutoff: 6500, decay: 0.1, thump: 0.5, tail: 0.3, gain: 0.45 },
  { cutoff: 3800, decay: 0.3, thump: 1.2, tail: 1.2, gain: 0.8 },
];
/** A suppressed shot fades out over this share of the distance. */
const SUPPRESSED_REACH = 0.3;
/** Metres over which a distant shot drops to half volume. */
const HALF_DISTANCE = 40;
/** Footsteps further off than this aren't worth playing. */
const STEP_RANGE = 45;

interface StepVoice {
  /** Filtered noise: its cutoff in Hz, whether band-passed, and how long it lasts. */
  cutoff: number;
  band: boolean;
  decay: number;
  gain: number;
  /** A low knock under it, in Hz, or 0. */
  knock: number;
}

const STEPS: Record<Surface, StepVoice> = {
  grass: { cutoff: 900, band: false, decay: 0.09, gain: 0.3, knock: 0 },
  dirt: { cutoff: 1600, band: true, decay: 0.08, gain: 0.32, knock: 90 },
  sand: { cutoff: 2400, band: true, decay: 0.12, gain: 0.22, knock: 0 },
  rock: { cutoff: 3200, band: true, decay: 0.05, gain: 0.3, knock: 140 },
  concrete: { cutoff: 2800, band: true, decay: 0.04, gain: 0.32, knock: 120 },
  wood: { cutoff: 1300, band: true, decay: 0.06, gain: 0.28, knock: 170 },
  metal: { cutoff: 4200, band: true, decay: 0.16, gain: 0.2, knock: 220 },
  water: { cutoff: 1800, band: false, decay: 0.22, gain: 0.35, knock: 0 },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Where the listener is, for how far sounds are. */
  private readonly ear = { x: 0, y: 0, z: 0 };

  /** Must be called from a user gesture; browsers keep audio muted until then. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Hear from the camera from now on. */
  listen(camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const e = camera.matrixWorld.elements;
    this.ear.x = e[12];
    this.ear.y = e[13];
    this.ear.z = e[14];
    const l = ctx.listener;
    const t = ctx.currentTime;
    // Forward is the camera's -z, up its +y.
    if (l.positionX) {
      l.positionX.setValueAtTime(e[12], t);
      l.positionY.setValueAtTime(e[13], t);
      l.positionZ.setValueAtTime(e[14], t);
      l.forwardX.setValueAtTime(-e[8], t);
      l.forwardY.setValueAtTime(-e[9], t);
      l.forwardZ.setValueAtTime(-e[10], t);
      l.upX.setValueAtTime(e[4], t);
      l.upY.setValueAtTime(e[5], t);
      l.upZ.setValueAtTime(e[6], t);
    } else {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  /** A gunshot, from `at` or your own; `quiet` through a suppressor. */
  shot(weapon: number, at?: At, quiet = false): void {
    const v = VOICES[weapon] ?? VOICES[0];
    const distance = this.distance(at);
    const far = distance / (distance + HALF_DISTANCE * (quiet ? SUPPRESSED_REACH : 1));
    const gain = v.gain * (1 - far * 0.85) * (quiet ? 0.4 : 1);
    const cutoff = v.cutoff * (1 - far * 0.75) * (quiet ? 0.35 : 1);
    const out = this.out(at);
    this.burst(cutoff, v.decay * (quiet ? 0.6 : 1), gain, 0, out);
    if (!quiet) {
      this.thump(110, 40, 0.12, gain * v.thump, out);
      // A quieter, darker echo tail, off the whole island rather than one spot.
      this.burst(cutoff * 0.25, v.tail, gain * 0.18, 0.04);
    }
    if (weapon === BOLT && !at) {
      // Work the bolt.
      this.click(2400, 0.5, 0.35);
      this.click(1800, 0.62, 0.35);
    }
  }

  hit(head: boolean, killed: boolean): void {
    this.tone(head ? 2600 : 1700, 0.05, 0.25, 'square');
    if (head) this.tone(3900, 0.25, 0.12, 'sine', 0.01);
    if (killed) {
      this.tone(880, 0.12, 0.2, 'triangle', 0.06);
      this.tone(1320, 0.18, 0.2, 'triangle', 0.14);
    }
  }

  hurt(): void {
    this.thump(160, 50, 0.2, 1);
    this.burst(900, 0.12, 0.25, 0);
  }

  dry(): void {
    this.click(3200, 0, 0.3);
  }

  reload(weapon: number): void {
    this.click(1500, 0.05, 0.3);
    this.click(1100, weapon === PISTOL ? 0.3 : 0.45, 0.35);
  }

  reloaded(): void {
    this.click(2000, 0, 0.35);
    this.click(2600, 0.08, 0.3);
  }

  draw(): void {
    this.click(1300, 0, 0.2);
    this.click(2200, 0.12, 0.2);
  }

  /** A grenade leaving the hand: the pin, then a whoosh. */
  toss(): void {
    this.click(3000, 0, 0.3);
    this.burst(1400, 0.2, 0.15, 0.12);
  }

  /** A grenade going off: a deep blast, then rumble rolling around. */
  boom(at: At): void {
    const distance = this.distance(at);
    const far = distance / (distance + HALF_DISTANCE * 2);
    const gain = 1 - far * 0.8;
    const out = this.out(at);
    this.thump(90, 28, 0.6, gain * 1.6, out);
    this.burst(2600 * (1 - far * 0.7), 0.35, gain * 0.9, 0, out);
    this.burst(500, 1.6, gain * 0.35, 0.05);
  }

  /** Cover breaking: wood splinters, masonry crumbles. */
  crumble(wood: boolean, at: At): void {
    const gain = 1 - (this.distance(at) / (this.distance(at) + HALF_DISTANCE)) * 0.85;
    const out = this.out(at);
    if (wood) {
      this.click(1800, 0, 0.3 * gain, out);
      this.burst(3200, 0.18, 0.35 * gain, 0.01, out);
      this.click(1100, 0.07, 0.25 * gain, out);
    } else {
      this.thump(140, 45, 0.3, 0.6 * gain, out);
      this.burst(1200, 0.6, 0.4 * gain, 0, out);
    }
  }

  /**
   * A footfall on `surface`, from `at` or your own. Faster is louder; crouched
   * steps are soft. Bodies too far off make no sound at all.
   */
  step(surface: Surface, speed: number, crouched: boolean, at?: At): void {
    const distance = this.distance(at);
    if (distance > STEP_RANGE) return;
    const v = STEPS[surface];
    const pace = Math.min(0.35 + speed / 8, 1.3) * (crouched ? 0.35 : 1);
    const gain = v.gain * pace * (1 - distance / STEP_RANGE) * (at ? 1 : 0.55) * (0.85 + Math.random() * 0.3);
    const cutoff = v.cutoff * (0.85 + Math.random() * 0.3) * (1 - (distance / STEP_RANGE) * 0.5);
    const out = this.out(at);
    if (v.band) this.click(cutoff, 0, gain, out, v.decay, 1.5);
    else this.burst(cutoff, v.decay, gain, 0, out);
    if (v.knock) this.thump(v.knock, v.knock * 0.5, 0.06, gain * 1.4, out);
    // Splashes and scuffs trail off a moment later.
    if (surface === 'water') this.burst(900, 0.3, gain * 0.5, 0.05, out);
  }

  /** Coming down hard from a jump or a fall. */
  land(surface: Surface, force: number): void {
    const v = STEPS[surface];
    const gain = Math.min(force / 10, 1) * 0.5;
    this.thump(v.knock || 110, 45, 0.12, gain);
    this.burst(v.cutoff, v.decay * 1.6, gain * 0.7, 0);
  }

  /** An item taken from a container. */
  pickup(): void {
    this.click(900, 0, 0.3);
    this.burst(2500, 0.08, 0.12, 0.03);
  }

  /** A pickup was called in. */
  call(): void {
    this.tone(660, 0.18, 0.18, 'square');
    this.tone(990, 0.3, 0.18, 'square', 0.2);
  }

  /** The run ended: rising if out safely, falling otherwise. */
  runEnd(good: boolean): void {
    const notes = good ? [523, 659, 784] : [392, 311, 262];
    notes.forEach((f, i) => this.tone(f, 0.4, 0.2, 'triangle', i * 0.14));
  }

  private get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private distance(at?: At): number {
    return at ? Math.hypot(at.x - this.ear.x, at.y - this.ear.y, at.z - this.ear.z) : 0;
  }

  /**
   * Where a sound's voices go: through a panner placed at `at`, or straight
   * out for your own. Loudness over distance is worked out by each sound, so
   * the panner only places it.
   */
  private out(at?: At): AudioNode {
    if (!at || !this.ready) return this.master!;
    const ctx = this.ctx!;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0,
      positionX: at.x, positionY: at.y, positionZ: at.z,
    });
    panner.connect(this.master!);
    // Let go once the longest voice has rung out.
    setTimeout(() => panner.disconnect(), 3000);
    return panner;
  }

  /** Filtered noise with an instant attack and exponential fade. */
  private burst(cutoff: number, decay: number, gain: number, delay: number, out: AudioNode = this.master!): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.15, 60), t + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(env).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  /** A sine dropping in pitch: the body of a shot or an impact. */
  private thump(from: number, to: number, decay: number, gain: number, out: AudioNode = this.master!): void {
    if (!this.ready || gain <= 0) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain * 0.6, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  private tone(freq: number, decay: number, gain: number, type: OscillatorType, delay = 0): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(env).connect(this.master!);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** A short band-passed tick of noise: mechanical clicks, and footfalls on hard ground. */
  private click(freq: number, delay: number, gain: number, out: AudioNode = this.master!, decay = 0.04, q = 4): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(env).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }
}
