import { BOLT, PISTOL } from '../shared/weapons.ts';

// Placeholder sound until chunk 9 brings recorded, positional audio: every
// sound is synthesized from noise and oscillators, so there is nothing to load.

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

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

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

  /** A gunshot, `distance` metres away (0 for your own); `quiet` through a suppressor. */
  shot(weapon: number, distance = 0, quiet = false): void {
    const v = VOICES[weapon] ?? VOICES[0];
    const far = distance / (distance + HALF_DISTANCE * (quiet ? SUPPRESSED_REACH : 1));
    const gain = v.gain * (1 - far * 0.85) * (quiet ? 0.4 : 1);
    const cutoff = v.cutoff * (1 - far * 0.75) * (quiet ? 0.35 : 1);
    this.burst(cutoff, v.decay * (quiet ? 0.6 : 1), gain, 0);
    if (!quiet) {
      this.thump(110, 40, 0.12, gain * v.thump);
      // A quieter, darker echo tail.
      this.burst(cutoff * 0.25, v.tail, gain * 0.18, 0.04);
    }
    if (weapon === BOLT && distance === 0) {
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

  /** A grenade going off `distance` metres away: a deep blast, then rumble. */
  boom(distance: number): void {
    const far = distance / (distance + HALF_DISTANCE * 2);
    const gain = 1 - far * 0.8;
    this.thump(90, 28, 0.6, gain * 1.6);
    this.burst(2600 * (1 - far * 0.7), 0.35, gain * 0.9, 0);
    this.burst(500, 1.6, gain * 0.35, 0.05);
  }

  /** Cover breaking `distance` metres away: wood splinters, masonry crumbles. */
  crumble(wood: boolean, distance: number): void {
    const gain = 1 - (distance / (distance + HALF_DISTANCE)) * 0.85;
    if (wood) {
      this.click(1800, 0, 0.3 * gain);
      this.burst(3200, 0.18, 0.35 * gain, 0.01);
      this.click(1100, 0.07, 0.25 * gain);
    } else {
      this.thump(140, 45, 0.3, 0.6 * gain);
      this.burst(1200, 0.6, 0.4 * gain, 0);
    }
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

  /** Filtered noise with an instant attack and exponential fade. */
  private burst(cutoff: number, decay: number, gain: number, delay: number): void {
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
    src.connect(filter).connect(env).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  /** A sine dropping in pitch: the body of a shot or an impact. */
  private thump(from: number, to: number, decay: number, gain: number): void {
    if (!this.ready || gain <= 0) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain * 0.6, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(env).connect(this.master!);
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

  /** A short band-passed tick of noise: mechanical clicks. */
  private click(freq: number, delay: number, gain: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(filter).connect(env).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.06);
  }
}
