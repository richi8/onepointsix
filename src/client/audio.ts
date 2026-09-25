import type * as THREE from 'three';
import { DEFAULT_CONDITIONS, type Conditions, type TimeOfDay } from '../shared/conditions.ts';
import { WATER_LEVEL } from '../shared/constants.ts';
import { clamp, smoothstep } from '../shared/geom.ts';
import { BOLT, PISTOL } from '../shared/weapons.ts';
import type { World } from '../shared/world.ts';
import { enclosure, nearestWater, occlusion, woodland } from './hearing.ts';
import type { SoundBank } from './soundlist.ts';
import type { Surface } from './surface.ts';
import { VoicePool } from './voices.ts';

// Recorded CC0 sounds (see soundlist.ts), all packed in one file that loads
// behind the menu. Sounds out in the world are placed in 3D around the
// listener, who hears with the camera: they pan, dull and fade with distance,
// arrive late from far off, and are muffled by walls and hills in between.
// Walls round the listener make everything ring. Wind, the sea and birds play
// under it all. The interface's own beeps are still synthesized.

const BASE = `${import.meta.env.BASE_URL}assets/`;

/** Where a sound comes from; omitted for your own sounds, which play in your head. */
export interface At {
  x: number;
  y: number;
  z: number;
}

interface ShotVoice {
  clip: string;
  gain: number;
  rate: number;
  /** Rate for the suppressed shot, which is one recording for every gun. */
  quietRate: number;
}

/** In WEAPONS order. */
const SHOTS: ShotVoice[] = [
  { clip: 'rifle', gain: 0.8, rate: 1, quietRate: 1 },
  { clip: 'pistol', gain: 0.65, rate: 1, quietRate: 1.15 },
  { clip: 'bolt', gain: 1, rate: 0.95, quietRate: 0.85 },
];
/** Metres over which a shot drops to half volume. */
const HALF_DISTANCE = 40;
/** A suppressed shot carries this share of the distance. */
const SUPPRESSED_REACH = 0.3;
/** Metres per second. Far-off shots and blasts are heard after they're seen. */
const SPEED_OF_SOUND = 343;
/** Footsteps further off than this aren't worth playing. */
const STEP_RANGE = 45;
/** Shots and blasts this close send the birds quiet. */
const SCARE_RANGE = 150;
/** Seconds the birds stay quiet after a scare, then take to come back. */
const SCARED_FOR = 20;
const CALMING = 10;
/** Voices shared by sounds out in the world. */
const VOICES = 24;
/** Sounds quieter than this aren't played. */
const MIN_GAIN = 0.005;
/** Seconds between updates of the ambience and the room's ring. */
const AMBIENCE_EVERY = 0.25;

interface StepVoice {
  clip: string;
  gain: number;
  rate: number;
}

const STEPS: Record<Surface, StepVoice> = {
  grass: { clip: 'grass', gain: 0.9, rate: 1 },
  dirt: { clip: 'dirt', gain: 0.9, rate: 1 },
  sand: { clip: 'sand', gain: 0.8, rate: 1 },
  rock: { clip: 'rock', gain: 0.8, rate: 0.92 },
  // The same stone recording, a little brighter.
  concrete: { clip: 'rock', gain: 0.8, rate: 1.1 },
  wood: { clip: 'wood', gain: 0.9, rate: 1 },
  metal: { clip: 'metal', gain: 0.7, rate: 1 },
  water: { clip: 'water', gain: 0.9, rate: 1 },
};

interface Voice {
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
  /** How much goes to the reverb. */
  send: GainNode;
  source: AudioBufferSourceNode | null;
}

interface PlayOptions {
  at?: At;
  gain?: number;
  rate?: number;
  /** Seconds before it starts. */
  delay?: number;
  /** Low-pass cutoff in Hz, for distance and walls. */
  cutoff?: number;
  /** Share sent to the reverb. */
  send?: number;
}

interface Ambience {
  wind: GainNode;
  sea: GainNode;
  seaPanner: PannerNode;
  birds: GainNode;
  rain: GainNode;
  crickets: GainNode;
}

/** How loud the birds sing and the crickets chirp at each time of day. */
const BIRDS: Record<TimeOfDay, number> = { day: 1, dusk: 0.45, night: 0 };
const CRICKETS: Record<TimeOfDay, number> = { day: 0, dusk: 0.35, night: 1 };

export class Sfx {
  private readonly world: World;
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  /** Where the reverb is fed, and how loud it comes back. */
  private reverb: GainNode | null = null;
  private reverbReturn: GainNode | null = null;
  private pool: VoicePool<Voice> | null = null;
  private noise: AudioBuffer | null = null;
  /** The packed recordings once decoded, and where each one is in them. */
  private bank: AudioBuffer | null = null;
  private clips: SoundBank['clips'] | null = null;
  private download: Promise<[SoundBank, ArrayBuffer]> | null = null;
  private ambience: Ambience | null = null;
  private ambienceIn = 0;
  /** How closed in the listener is, 0 to 1. */
  private enclosed = 0;
  /** When the birds last took fright, on the audio clock. */
  private scaredAt = -Infinity;
  /** Where the listener is, for how far sounds are. */
  private readonly ear = { x: 0, y: 0, z: 0 };
  /** The time of day and weather, for the ambience. */
  conditions: Conditions = DEFAULT_CONDITIONS;

  constructor(world: World) {
    this.world = world;
  }

  /** Start downloading the recordings; they're decoded once audio is unlocked. */
  load(): void {
    this.download ??= Promise.all([
      fetch(`${BASE}sounds.json`).then((r) => r.json() as Promise<SoundBank>),
      fetch(`${BASE}sounds.m4a`).then((r) => r.arrayBuffer()),
    ]);
    // A failed download leaves the game silent but playable.
    this.download.catch((e) => console.warn('Sounds failed to load', e));
  }

  /**
   * Must be called from a user gesture; browsers keep audio muted until then.
   * Tests pass an OfflineAudioContext to render into.
   */
  unlock(context?: BaseAudioContext): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext) void this.ctx.resume();
      return;
    }
    const ctx = context ?? new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx);
    this.reverb = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.3;
    this.reverb.connect(convolver).connect(this.reverbReturn).connect(this.master);

    const voices: Voice[] = [];
    for (let i = 0; i < VOICES; i++) {
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0 });
      const send = ctx.createGain();
      gain.connect(filter).connect(panner).connect(this.master);
      filter.connect(send).connect(this.reverb);
      voices.push({ gain, filter, panner, send, source: null });
    }
    this.pool = new VoicePool(voices);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.load();
    void this.decode();
  }

  /** Resolves once the recordings can play. */
  async decode(): Promise<void> {
    if (this.bank || !this.ctx || !this.download) return;
    const [bank, data] = await this.download;
    // decodeAudioData detaches the buffer, so decode a copy in case it's asked again.
    this.bank ??= await this.ctx.decodeAudioData(data.slice(0));
    this.clips = bank.clips;
    this.startAmbience();
  }

  /** Hear from the camera from now on, and let the surroundings change what's heard. */
  update(camera: THREE.Camera, dt: number): void {
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
    this.ambienceIn -= dt;
    if (this.ambienceIn <= 0) {
      this.ambienceIn = AMBIENCE_EVERY;
      this.surroundings();
    }
  }

  /**
   * A gunshot, from `at` or your own; `quiet` through a suppressor. Far off,
   * a recording made at range takes over from the close one.
   */
  shot(weapon: number, at?: At, quiet = false): void {
    const v = SHOTS[weapon] ?? SHOTS[0];
    const clip = quiet ? 'quiet' : v.clip;
    const rate = (quiet ? v.quietRate : v.rate) * jitter(0.03);
    if (!at) {
      this.play(clip, { gain: quiet ? 0.5 : v.gain, rate, send: quiet ? 0.1 : 0.2 + this.enclosed * 0.5 });
      if (weapon === BOLT) this.play('cycle', { gain: 0.5, delay: 0.5 });
      if (!quiet) this.scare();
      return;
    }
    const d = this.distance(at);
    const reach = d / (quiet ? SUPPRESSED_REACH : 1);
    if (quiet && reach > 400) return;
    const occ = this.occlusion(at);
    const gain = v.gain * (HALF_DISTANCE / (HALF_DISTANCE + reach)) * (1 - occ * 0.5);
    const far = quiet ? 0 : smoothstep(60, 300, d);
    const place = { at, rate, delay: d / SPEED_OF_SOUND, cutoff: this.cutoff(reach, occ) };
    this.play(clip, { ...place, gain: gain * (1 - far), send: 0.2 + far * 0.4 + occ * 0.2 });
    if (far > 0) this.play('far', { ...place, gain: gain * far * 1.2, rate: rate * (weapon === PISTOL ? 1.15 : 1), send: 0.6 });
    if (!quiet && d < SCARE_RANGE) this.scare();
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
    this.play('hurt', { gain: 0.7, rate: jitter(0.05) });
  }

  dry(): void {
    this.play('dry', { gain: 0.5 });
  }

  /** The magazine out and a fresh one in. */
  reload(weapon: number): void {
    this.play(weapon === PISTOL ? 'magPistol' : 'magRifle', { gain: 0.5 });
  }

  /** Chambering a round at the end of a reload. */
  reloaded(weapon: number): void {
    const clip = weapon === PISTOL ? 'chargePistol' : weapon === BOLT ? 'cycle' : 'chargeRifle';
    this.play(clip, { gain: 0.5 });
  }

  draw(): void {
    this.play('draw', { gain: 0.35, rate: jitter(0.05) });
  }

  /** A grenade leaving the hand: the pin, then a whoosh. */
  toss(): void {
    this.click(3000, 0, 0.3);
    this.play('whoosh', { gain: 0.35, delay: 0.12 });
  }

  /** A grenade going off. */
  boom(at: At): void {
    const d = this.distance(at);
    const occ = this.occlusion(at);
    const gain = 1.2 * (HALF_DISTANCE * 2 / (HALF_DISTANCE * 2 + d)) * (1 - occ * 0.4);
    this.play('boom', { at, gain, rate: jitter(0.05), delay: d / SPEED_OF_SOUND, cutoff: this.cutoff(d * 0.5, occ), send: 0.4 + smoothstep(40, 300, d) * 0.4 });
    if (d < SCARE_RANGE * 2) this.scare();
  }

  /** Cover breaking: wood splinters, masonry crumbles. */
  crumble(wood: boolean, at: At): void {
    const d = this.distance(at);
    const occ = this.occlusion(at);
    const gain = 0.7 * (HALF_DISTANCE / (HALF_DISTANCE + d)) * (1 - occ * 0.5);
    this.play(wood ? 'splinter' : 'crumble', { at, gain, rate: jitter(0.08), delay: d / SPEED_OF_SOUND, cutoff: this.cutoff(d, occ), send: 0.3 });
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
    const falloff = 1 - distance / STEP_RANGE;
    const occ = at ? this.occlusion(at) : 0;
    const gain = v.gain * pace * falloff * falloff * (at ? 1 : 0.7) * (1 - occ * 0.6) * jitter(0.15);
    this.play(v.clip, { at, gain, rate: v.rate * jitter(0.06), cutoff: at ? this.cutoff(distance * 4, occ) : undefined, send: 0.1 });
  }

  /** Coming down hard from a jump or a fall. */
  land(surface: Surface, force: number): void {
    const gain = Math.min(force / 10, 1);
    this.play('land', { gain: gain * 0.6, rate: jitter(0.05) });
    this.play(STEPS[surface].clip, { gain: gain * 0.5, rate: STEPS[surface].rate * 0.9 });
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
    const ctx = this.ctx;
    return ctx !== null && (ctx.state === 'running' || !(ctx instanceof AudioContext));
  }

  private distance(at?: At): number {
    return at ? Math.hypot(at.x - this.ear.x, at.y - this.ear.y, at.z - this.ear.z) : 0;
  }

  private occlusion(at: At): number {
    return occlusion(this.world, this.ear, at);
  }

  /** How bright a sound still is after `reach` metres of air and `occ` of walls. */
  private cutoff(reach: number, occ: number): number {
    return 18000 * (1 - smoothstep(0, 600, reach) * 0.85) * (1 - occ * 0.8);
  }

  private scare(): void {
    if (this.ctx) this.scaredAt = this.ctx.currentTime;
  }

  /**
   * Play one of the recordings, picking among its variations at random: out
   * in the world at `at` on a pooled voice, or in your head.
   */
  private play(name: string, o: PlayOptions = {}): void {
    const variants = this.clips?.[name];
    if (!this.ready || !this.bank || !variants?.length || (o.gain ?? 1) < MIN_GAIN) return;
    const ctx = this.ctx!;
    const [start, duration] = variants[Math.floor(Math.random() * variants.length)];
    const rate = o.rate ?? 1;
    const now = ctx.currentTime;
    const t = now + (o.delay ?? 0);
    const length = duration / rate;
    const src = ctx.createBufferSource();
    src.buffer = this.bank;
    src.playbackRate.value = rate;

    const level = o.gain ?? 1;
    let gain: GainNode;
    let voice: Voice | null = null;
    if (o.at) {
      const taken = this.pool!.take(now, t + length + 0.05, level);
      if (!taken) return;
      voice = taken.voice;
      if (taken.stolen) stop(voice.source);
      voice.source = src;
      gain = voice.gain;
      voice.panner.positionX.value = o.at.x;
      voice.panner.positionY.value = o.at.y;
      voice.panner.positionZ.value = o.at.z;
      set(voice.filter.frequency, o.cutoff ?? 18000);
      set(voice.send.gain, o.send ?? 0.2);
    } else {
      gain = ctx.createGain();
      gain.connect(this.master!);
      const send = ctx.createGain();
      send.gain.value = o.send ?? 0.1;
      gain.connect(send).connect(this.reverb!);
    }
    if (!voice) src.onended = () => gain.disconnect();
    set(gain.gain, level);
    src.connect(gain);
    src.start(t, start, duration);
  }

  /** Wind, the sea, birds or crickets and rain, looping from the moment the recordings are in. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const loop = (name: string, out: AudioNode): GainNode => {
      const [start, duration] = this.clips![name][0];
      const src = ctx.createBufferSource();
      src.buffer = this.bank;
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = start + duration;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(out);
      // Each starts somewhere in its loop, so they don't swell together.
      src.start(ctx.currentTime, start + Math.random() * duration);
      return gain;
    };
    const seaPanner = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'linear', rolloffFactor: 0 });
    seaPanner.connect(this.master!);
    this.ambience = {
      wind: loop('wind', this.master!),
      sea: loop('sea', seaPanner),
      seaPanner,
      birds: loop('birds', this.master!),
      rain: loop('rain', this.master!),
      crickets: loop('crickets', this.master!),
    };
    this.ambienceIn = 0;
  }

  /** How closed in the listener is, and what they can hear around them. */
  private surroundings(): void {
    const ctx = this.ctx!;
    const w = this.world;
    const ear = this.ear;
    const now = ctx.currentTime;
    this.enclosed = enclosure(w, ear);
    this.reverbReturn!.gain.setTargetAtTime(0.3 + this.enclosed * 1.2, now, 0.4);
    const amb = this.ambience;
    if (!amb) return;
    const open = 1 - this.enclosed;
    const height = ear.y - Math.max(w.terrainHeight(ear.x, ear.z), WATER_LEVEL);
    amb.wind.gain.setTargetAtTime((0.1 + 0.25 * smoothstep(0, 60, ear.y) + 0.1 * smoothstep(2, 30, height)) * (0.4 + 0.6 * open), now, 1);
    const water = nearestWater(w, ear.x, ear.z);
    amb.sea.gain.setTargetAtTime(water ? 0.6 * (1 - smoothstep(0, 220, water.dist)) : 0, now, 1);
    if (water) {
      amb.seaPanner.positionX.setTargetAtTime(water.x, now, 0.5);
      amb.seaPanner.positionY.setTargetAtTime(WATER_LEVEL, now, 0.5);
      amb.seaPanner.positionZ.setTargetAtTime(water.z, now, 0.5);
    }
    const calm = clamp((now - this.scaredAt - SCARED_FOR) / CALMING, 0, 1);
    const trees = woodland(w, ear.x, ear.z);
    const { time, weather } = this.conditions;
    const raining = weather === 'rain';
    const low = 1 - smoothstep(40, 90, ear.y);
    // Birds and crickets hush in the rain, and for a while after a shot.
    const hush = raining ? 0.25 : 1;
    amb.birds.gain.setTargetAtTime(0.45 * BIRDS[time] * hush * (0.25 + 0.75 * trees) * low * calm, now, calm < 1 ? 0.3 : 2);
    amb.crickets.gain.setTargetAtTime(0.3 * CRICKETS[time] * hush * (0.6 + 0.4 * open) * low * calm, now, calm < 1 ? 0.3 : 2);
    // Under a roof the rain drums on it rather than all around.
    amb.rain.gain.setTargetAtTime(raining ? 0.55 * (0.45 + 0.55 * open) : 0, now, 1);
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

  /** A short band-passed tick of noise. */
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

/** Randomly within ±`amount` of 1, so repeats don't sound identical. */
function jitter(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

/** Set a parameter now, dropping anything scheduled on it before. */
function set(param: AudioParam, value: number): void {
  param.cancelScheduledValues(0);
  param.value = value;
}

function stop(src: AudioBufferSourceNode | null): void {
  try {
    src?.stop();
  } catch {
    // Never started or already stopped.
  }
}

/**
 * The reverb's impulse: a few early reflections off nearby walls, then a
 * diffuse tail dying away over about a second and a half, a little different
 * in each ear.
 */
function impulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 1.6);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.35) * smoothstep(0, 0.02, t) * 0.5;
    }
    for (const [time, level] of [[0.013, 0.5], [0.029, 0.35], [0.047, 0.3], [0.071, 0.2]]) {
      d[Math.floor((time + ch * 0.004) * rate)] += level;
    }
  }
  return buffer;
}
