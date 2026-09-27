import type * as THREE from 'three';
import { DEFAULT_CONDITIONS, type Conditions, type TimeOfDay } from '../shared/conditions.ts';
import { WATER_LEVEL } from '../shared/constants.ts';
import { clamp, smoothstep } from '../shared/geom.ts';
import { BOLT, PISTOL } from '../shared/weapons.ts';
import type { PanelKind, World } from '../shared/world.ts';
import { enclosure, hear, nearestWater, sourceSpace, space, woodland, type Heard, type Space } from './hearing.ts';
import { download, swap } from './loading.ts';
import { SoundField } from './soundfield.ts';
import { bankLead, type SoundBanks, type SoundFormat } from './soundlist.ts';
import type { Surface } from './surface.ts';
import { VoicePool } from './voices.ts';

// Recorded CC0 sounds (see soundlist.ts), packed in two files: the ones
// wanted from a run's first moment load behind the loading bar, the rest
// behind the menu, each as Opus or, where that won't decode, AAC. Sounds out
// in the world are placed in 3D around the listener, who hears with the
// camera: they pan, dull and fade with distance, arrive late from far off,
// and come through, over or round what's in between (see hearing.ts). Each
// rings with the space it's in and the one the listener is in: a room, a
// walled yard or the open. Far fights blend into one distant-battle bed of
// their own, so they never take voices from near sounds. Wind, the sea and
// birds play under it all. The interface's own beeps are still synthesized.

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
  /** The suppressed shot and how loud it is. */
  quiet: string;
  quietGain: number;
}

/** In WEAPONS order. */
const SHOTS: ShotVoice[] = [
  { clip: 'rifle', gain: 0.8, rate: 1, quiet: 'quietRifle', quietGain: 0.5 },
  { clip: 'pistol', gain: 0.65, rate: 1, quiet: 'quietPistol', quietGain: 0.45 },
  { clip: 'bolt', gain: 1, rate: 1, quiet: 'quietBolt', quietGain: 0.55 },
];
/** Metres over which a shot drops to half volume. */
const HALF_DISTANCE = 40;
/** A suppressed shot carries this share of the distance. */
const SUPPRESSED_REACH = 0.3;
/** Metres per second. Far-off shots and blasts are heard after they're seen. */
const SPEED_OF_SOUND = 343;
/** Footsteps further off than this aren't worth playing. */
const STEP_RANGE = 45;
/** Doors opening and shutting are heard this far off, metres. */
const DOOR_RANGE = 40;
/** Shots and blasts this close send the birds quiet. */
const SCARE_RANGE = 150;
/** Seconds the birds stay quiet after a scare, then take to come back. */
const SCARED_FOR = 20;
const CALMING = 10;
/**
 * Rain hisses over far sounds: from RAIN_NEAR metres off they fade, until past
 * RAIN_FAR they're this much quieter and duller, much as bots hear them.
 */
const RAIN_NEAR = 10;
const RAIN_FAR = 120;
const RAIN_QUIET = 0.45;
const RAIN_DULL = 0.55;
/** Voices shared by sounds out in the world. */
const VOICES = 24;
/**
 * Shots and blasts further off than this, metres, go to the distant-battle
 * bed: its own few voices, placed only by compass direction, through one dull
 * filter, so a long far fight never takes a voice from a near sound.
 */
const BED_RANGE = 150;
const BED_VOICES = 10;
/** Compass directions the bed is placed in, and how far out, metres. */
const BED_BEARINGS = 8;
const BED_OUT = 100;
const BED_CUTOFF = 2500;
/** A replay jumping plays on what would still be sounding from this many seconds before. */
export const REBUILD = 3;
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
  concrete: { clip: 'concrete', gain: 0.8, rate: 1 },
  wood: { clip: 'wood', gain: 0.9, rate: 1 },
  metal: { clip: 'metal', gain: 0.7, rate: 1 },
  water: { clip: 'water', gain: 0.9, rate: 1 },
};

interface Voice {
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
  /** How much goes to each space's reverb, in SPACES order. */
  sends: GainNode[];
  source: AudioBufferSourceNode | null;
}

/** A voice of the distant-battle bed. */
interface BedVoice {
  source: AudioBufferSourceNode | null;
}

/** The spaces sounds ring in, each with its own reverb, and how loud it comes back. */
const SPACES = ['room', 'yard', 'open'] as const;
const RETURNS = { room: 1.2, yard: 0.9, open: 0.3 };
const OPEN: Space = { room: 0, yard: 0, open: 1, walls: 0 };

/** A recording, or one variation of it, in the decoded bank it's packed in. */
export interface Clip {
  buffer: AudioBuffer;
  start: number;
  duration: number;
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
  /** The space round the sound, which rings with it as well as the listener's. */
  space?: Space;
  /** Played on the distant-battle bed rather than a voice of its own. */
  bed?: boolean;
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

/** The master volume, and the cut-off of everything heard in air and under water, Hz. */
const MASTER = 0.7;
const OPEN_AIR = 20000;
const UNDERWATER = 450;

export class Sfx {
  private readonly world: World;
  /** The ways round walls near the listener. */
  readonly field: SoundField;
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  /** Where each space's reverb is fed. */
  private reverbs: Record<(typeof SPACES)[number], GainNode> | null = null;
  /** Your own sounds' reverb send, split between the spaces as the listener's is. */
  private ownSend: GainNode | null = null;
  private ownSends: GainNode[] = [];
  private pool: VoicePool<Voice> | null = null;
  /** The distant-battle bed: a bus per compass direction, and its voices. */
  private bed: GainNode[] = [];
  private bedPanners: PannerNode[] = [];
  private bedPool: VoicePool<BedVoice> | null = null;
  /** Your own sounds playing, to cut off when a replay jumps. */
  private readonly own = new Set<AudioBufferSourceNode>();
  private noise: AudioBuffer | null = null;
  /** Each recording's variations, once their bank is decoded. */
  readonly clips: Record<string, Clip[]> = {};
  /** The list of banks, the format they're being loaded in, and each bank's loading. */
  private list: Promise<SoundBanks> | null = null;
  format: SoundFormat | null = null;
  private early: Promise<void> | null = null;
  private late: Promise<void> | null = null;
  /** Decodes the banks before audio is unlocked, which needs a click. */
  private decoder: BaseAudioContext | null = null;
  private ambience: Ambience | null = null;
  private ambienceIn = 0;
  /** How closed in the listener is, 0 to 1, and the space round them. */
  private enclosed = 0;
  private around = OPEN;
  /**
   * How fast time runs for what's heard: a replay's speed. Sound takes that
   * much less time to arrive, and footsteps, doors and far shots are thinned
   * to match, so 4× doesn't pile four times the sounds on top of each other.
   */
  pace = 1;
  /**
   * Seconds ago the sounds now being played happened, while a replay that
   * jumped plays on what would still be sounding: they start part way through.
   */
  ago = 0;
  /** When the birds last took fright, on the audio clock. */
  private scaredAt = -Infinity;
  /** Where the listener is, for how far sounds are. */
  private readonly ear = { x: 0, y: 0, z: 0 };
  /** The time of day and weather, for the ambience. */
  conditions: Conditions = DEFAULT_CONDITIONS;
  /** Everything heard passes through this, which muffles it while the listener is under water. */
  private muffle: BiquadFilterNode | null = null;
  private submerged = false;

  constructor(world: World) {
    this.world = world;
    this.field = new SoundField(world);
  }

  /**
   * Download and decode the sounds wanted from a run's first moment, for the
   * loading bar to wait on. A failure leaves the game silent but playable.
   */
  loadEarly(): Promise<void> {
    this.early ??= this.loadBank('early').catch((e) => console.warn('Sounds failed to load', e));
    return this.early;
  }

  /** Then the rest, behind the menu. */
  loadLate(): Promise<void> {
    this.late ??= this.loadEarly().then(() => this.loadBank('late')).catch((e) => console.warn('Sounds failed to load', e));
    return this.late;
  }

  /** Resolves once every sound that will load has. */
  async loaded(): Promise<void> {
    await this.loadLate();
  }

  private async loadBank(name: string): Promise<void> {
    this.list ??= fetch(`${BASE}sounds.json`).then((r) => r.json() as Promise<SoundBanks>);
    const list = await this.list;
    const bank = list.banks.find((b) => b.name === name);
    if (!bank) return;
    // Whatever the browser says it can play, then the rest, in case it's wrong.
    const audio = document.createElement('audio');
    const formats = this.format ? [this.format] : [
      ...list.formats.filter((f) => audio.canPlayType(f.type)),
      ...list.formats.filter((f) => !audio.canPlayType(f.type)),
    ];
    const url = (f: SoundFormat) => `${BASE}sounds-${name}.${f.ext}`;
    for (const [i, f] of formats.entries()) {
      try {
        // The loading bar counts the first format listed until told otherwise.
        if (f !== list.formats[0]) swap(url(list.formats[0]), url(f));
        const decoder = this.ctx ?? (this.decoder ??= new OfflineAudioContext(1, 1, 48000));
        const buffer = await decoder.decodeAudioData(await download(url(f)));
        this.format = f;
        const lead = bankLead(bank.length, f.priming, buffer.duration);
        for (const [k, v] of Object.entries(bank.clips)) this.clips[k] = v.map(([start, duration]) => ({ buffer, start: start + lead, duration }));
        if (this.ctx && !this.ambience) this.startAmbience();
        return;
      } catch (e) {
        if (i === formats.length - 1) throw e;
      }
    }
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
    this.master.gain.value = MASTER;
    const comp = ctx.createDynamicsCompressor();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = OPEN_AIR;
    this.master.connect(this.muffle).connect(comp).connect(ctx.destination);
    this.submerged = false;

    const reverb = (kind: (typeof SPACES)[number]): GainNode => {
      const convolver = ctx.createConvolver();
      convolver.buffer = impulse(ctx, kind);
      const input = ctx.createGain();
      const back = ctx.createGain();
      back.gain.value = RETURNS[kind];
      input.connect(convolver).connect(back).connect(this.master!);
      return input;
    };
    this.reverbs = { room: reverb('room'), yard: reverb('yard'), open: reverb('open') };
    const reverbs = this.reverbs;
    this.ownSend = ctx.createGain();
    this.ownSends = SPACES.map((k) => {
      const g = ctx.createGain();
      g.gain.value = k === 'open' ? 1 : 0;
      this.ownSend!.connect(g).connect(reverbs[k]);
      return g;
    });

    const voices: Voice[] = [];
    for (let i = 0; i < VOICES; i++) {
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0 });
      gain.connect(filter).connect(panner).connect(this.master);
      const sends = SPACES.map((k) => {
        const send = ctx.createGain();
        filter.connect(send).connect(reverbs[k]);
        return send;
      });
      voices.push({ gain, filter, panner, sends, source: null });
    }
    this.pool = new VoicePool(voices);

    // The distant-battle bed: dull, placed only roughly, ringing in the open.
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = BED_CUTOFF;
    bedFilter.connect(this.master);
    const bedSend = ctx.createGain();
    bedSend.gain.value = 0.6;
    bedFilter.connect(bedSend).connect(reverbs.open);
    this.bed = [];
    this.bedPanners = [];
    for (let i = 0; i < BED_BEARINGS; i++) {
      const bus = ctx.createGain();
      const panner = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'linear', rolloffFactor: 0 });
      bus.connect(panner).connect(bedFilter);
      this.bed.push(bus);
      this.bedPanners.push(panner);
    }
    this.bedPool = new VoicePool(Array.from({ length: BED_VOICES }, () => ({ source: null })));

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Usually in by now: the loading screen waits for them.
    if (this.clips.wind) this.startAmbience();
    else void this.loadEarly();
    void this.loadLate();
  }

  /** Under water everything sounds dull and a little quieter; it clears on surfacing. */
  set underwater(on: boolean) {
    if (on === this.submerged || !this.ctx || !this.muffle || !this.master) return;
    this.submerged = on;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(on ? UNDERWATER : OPEN_AIR, t, 0.05);
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? MASTER * 0.6 : MASTER, t, 0.05);
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
    // The bed's compass directions stay put round the listener.
    for (let i = 0; i < this.bedPanners.length; i++) {
      const p = this.bedPanners[i];
      const a = (i / BED_BEARINGS) * Math.PI * 2;
      p.positionX.setValueAtTime(e[12] + Math.sin(a) * BED_OUT, t);
      p.positionY.setValueAtTime(e[13], t);
      p.positionZ.setValueAtTime(e[14] + Math.cos(a) * BED_OUT, t);
    }
    this.ambienceIn -= dt;
    if (this.ambienceIn <= 0) {
      this.ambienceIn = AMBIENCE_EVERY;
      this.surroundings();
    }
  }

  /**
   * A gunshot, from `at` or your own; `quiet` through a suppressor. Far off,
   * a recording made at range takes over from the close one, and further
   * still both go to the distant-battle bed.
   */
  shot(weapon: number, at?: At, quiet = false): void {
    const v = SHOTS[weapon] ?? SHOTS[0];
    const clip = quiet ? v.quiet : v.clip;
    const rate = (quiet ? 1 : v.rate) * jitter(0.03);
    if (!at) {
      this.play(clip, { gain: quiet ? v.quietGain : v.gain, rate, send: quiet ? 0.1 : 0.3 });
      if (weapon === BOLT) this.play('cycle', { gain: 0.5, delay: 0.5 });
      if (!quiet) this.scare();
      return;
    }
    const straight = this.distance(at);
    if (quiet && straight / SUPPRESSED_REACH > 400) return;
    const bed = !quiet && straight > BED_RANGE;
    if (bed && !this.thinned()) return;
    const h = bed ? this.far(at) : this.hear(at);
    const d = h.d;
    const occ = h.occ;
    const reach = d / (quiet ? SUPPRESSED_REACH : 1);
    const gain = (quiet ? v.quietGain : v.gain) * (HALF_DISTANCE / (HALF_DISTANCE + reach)) * (1 - occ * 0.5) * this.drowned(d);
    const far = quiet ? 0 : smoothstep(60, 300, d);
    const place = { at: h, rate, delay: d / SPEED_OF_SOUND, cutoff: this.cutoff(reach, occ, d), bed, space: bed ? undefined : sourceSpace(this.world, at) };
    this.play(clip, { ...place, gain: gain * (1 - far), send: 0.2 + far * 0.4 + occ * 0.2 });
    if (far > 0) this.play('far', { ...place, gain: gain * far * 1.2, rate: rate * (weapon === PISTOL ? 1.15 : 1), send: 0.6 });
    if (!quiet && straight < SCARE_RANGE) this.scare();
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

  /** The magazine out and a fresh one in; for the bolt-action, the bolt back and rounds pressed in. */
  reload(weapon: number): void {
    if (weapon === BOLT) {
      this.play('boltOpen', { gain: 0.5 });
      this.play('boltLoad', { gain: 0.5, delay: 0.7 });
      return;
    }
    this.play(weapon === PISTOL ? 'magPistol' : 'magRifle', { gain: 0.5 });
  }

  /** Chambering a round at the end of a reload. */
  reloaded(weapon: number): void {
    const clip = weapon === PISTOL ? 'chargePistol' : weapon === BOLT ? 'boltClose' : 'chargeRifle';
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
    const straight = this.distance(at);
    const bed = straight > BED_RANGE;
    const h = bed ? this.far(at) : this.hear(at);
    const d = h.d;
    const gain = 1.2 * (HALF_DISTANCE * 2 / (HALF_DISTANCE * 2 + d)) * (1 - h.occ * 0.4) * this.drowned(d);
    this.play('boom', {
      at: h, gain, rate: jitter(0.05), delay: d / SPEED_OF_SOUND, cutoff: this.cutoff(d * 0.5, h.occ, d),
      send: 0.4 + smoothstep(40, 300, d) * 0.4, bed, space: bed ? undefined : sourceSpace(this.world, at),
    });
    if (straight < SCARE_RANGE * 2) this.scare();
  }

  /** Cover breaking: wood splinters, masonry crumbles and glass smashes. */
  crumble(kind: PanelKind, at: At): void {
    const h = this.hear(at);
    const d = h.d;
    const gain = (kind === 'glass' ? 0.6 : 0.7) * (HALF_DISTANCE / (HALF_DISTANCE + d)) * (1 - h.occ * 0.5) * this.drowned(d);
    const clip = kind === 'wall' || kind === 'roof' ? 'crumble' : kind === 'glass' ? 'glass' : 'splinter';
    this.play(clip, { at: h, gain, rate: jitter(0.08), delay: d / SPEED_OF_SOUND, cutoff: this.cutoff(d, h.occ, d), send: 0.3, space: sourceSpace(this.world, at) });
  }

  /** A door swinging open or banging shut. */
  door(open: boolean, at: At): void {
    if (this.distance(at) > DOOR_RANGE || !this.thinned()) return;
    const h = this.hear(at);
    const d = Math.min(h.d, DOOR_RANGE);
    const falloff = 1 - d / DOOR_RANGE;
    const gain = (open ? 0.6 : 0.8) * falloff * falloff * (1 - h.occ * 0.6) * this.drowned(d);
    this.play(open ? 'doorOpen' : 'doorShut', { at: h, gain, rate: jitter(0.05), cutoff: this.cutoff(d * 2, h.occ, d), send: 0.2, space: sourceSpace(this.world, at) });
  }

  /**
   * A footfall on `surface`, from `at` or your own. Faster is louder; crouched
   * steps are soft. Bodies too far off make no sound at all.
   */
  step(surface: Surface, speed: number, crouched: boolean, at?: At): void {
    if (!this.thinned() || (at && this.distance(at) > STEP_RANGE)) return;
    const v = STEPS[surface];
    const pace = Math.min(0.35 + speed / 8, 1.3) * (crouched ? 0.35 : 1);
    if (!at) {
      this.play(v.clip, { gain: v.gain * pace * 0.7 * jitter(0.15), rate: v.rate * jitter(0.06), send: 0.1 });
      return;
    }
    const h = this.hear(at);
    const d = Math.min(h.d, STEP_RANGE);
    const falloff = 1 - d / STEP_RANGE;
    const gain = v.gain * pace * falloff * falloff * (1 - h.occ * 0.6) * this.drowned(d) * jitter(0.15);
    this.play(v.clip, { at: h, gain, rate: v.rate * jitter(0.06), cutoff: this.cutoff(d * 4, h.occ, d), send: 0.1 });
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

  /** Lightning struck `distance` metres off: its thunder rolls in once the sound gets here, deeper and duller from far. */
  thunder(distance: number): void {
    const near = 1 - smoothstep(600, 4500, distance);
    const a = Math.random() * Math.PI * 2;
    const at = { x: this.ear.x + Math.cos(a) * 300, y: this.ear.y + 150, z: this.ear.z + Math.sin(a) * 300 };
    this.play('thunder', {
      at, gain: (0.3 + 0.6 * near) * (1 - this.enclosed * 0.3), rate: (0.8 + 0.2 * near) * jitter(0.04),
      delay: distance / SPEED_OF_SOUND, cutoff: 500 + 9000 * near * near, send: 0.3, space: OPEN,
    });
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

  /** How a sound at `at` reaches the ear: through, over or round what's between. */
  private hear(at: At): Heard {
    return hear(this.world, this.field, this.ear, at);
  }

  /** A sound for the distant-battle bed: through or over what's in between, but not round it; it's placed only by its bearing. */
  private far(at: At): Heard {
    return hear(this.world, null, this.ear, at);
  }

  /** Whether a sound that's thinned at a replay's speed plays this time: always at normal speed, one in four at 4×. */
  private thinned(): boolean {
    return this.pace <= 1 || Math.random() < 1 / this.pace;
  }

  /**
   * The world changed round (x0, z0)–(x1, z1), such as cover breaking: the
   * ways round walls are looked at again there. Without a box, everywhere.
   */
  changed(box?: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    if (box) this.field.changed(box.minX, box.minZ, box.maxX, box.maxZ);
    else this.field.reset();
  }

  /** Doors swung open or shut. */
  doorsChanged(ids: readonly number[]): void {
    for (const id of ids) this.field.door(id);
  }

  /** Cut off everything playing and waiting to play, as when a replay jumps. The ambience goes on. */
  hush(): void {
    for (const src of this.own) stop(src);
    this.own.clear();
    this.pool?.each((v) => {
      stop(v.source);
      v.source = null;
    });
    this.bedPool?.each((v) => {
      stop(v.source);
      v.source = null;
    });
    this.pool?.clear();
    this.bedPool?.clear();
  }

  /** How bright a sound still is after `reach` metres of air and `occ` of walls, from `d` metres off in the rain. */
  private cutoff(reach: number, occ: number, d: number): number {
    return 18000 * (1 - smoothstep(0, 600, reach) * 0.85) * (1 - occ * 0.8) * (1 - this.rained(d) * RAIN_DULL);
  }

  /** How much of the rain's hiss lies between here and `d` metres off, 0 to 1: none when dry. */
  private rained(d: number): number {
    return this.conditions.weather === 'rain' ? smoothstep(RAIN_NEAR, RAIN_FAR, d) : 0;
  }

  /** What's left of a sound's volume from `d` metres off under the rain. */
  private drowned(d: number): number {
    return 1 - this.rained(d) * RAIN_QUIET;
  }

  private scare(): void {
    if (this.ctx) this.scaredAt = this.ctx.currentTime;
  }

  /**
   * Play one of the recordings, picking among its variations at random: out
   * in the world at `at` on a pooled voice, on the distant-battle bed, or in
   * your head. While a replay plays on after jumping, it starts `ago` seconds in.
   */
  private play(name: string, o: PlayOptions = {}): void {
    const variants = this.clips[name];
    if (!this.ready || !variants?.length || (o.gain ?? 1) < MIN_GAIN) return;
    const ctx = this.ctx!;
    const { buffer, start, duration } = variants[Math.floor(Math.random() * variants.length)];
    const rate = o.rate ?? 1;
    const now = ctx.currentTime;
    let t = now + (o.delay ?? 0) / this.pace - this.ago;
    // Already under way: into the clip by as much as it's late.
    const late = Math.max(now - t, 0) * rate;
    if (late >= duration) return;
    t = Math.max(t, now);
    const length = (duration - late) / rate;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const level = o.gain ?? 1;
    let gain: GainNode;
    if (o.at && o.bed) {
      const taken = this.bedPool!.take(now, t + length + 0.05, level);
      if (!taken) return;
      if (taken.stolen) stop(taken.voice.source);
      taken.voice.source = src;
      gain = ctx.createGain();
      gain.connect(this.bed[bearingOf(o.at.x - this.ear.x, o.at.z - this.ear.z)]);
      src.onended = () => gain.disconnect();
    } else if (o.at) {
      const taken = this.pool!.take(now, t + length + 0.05, level);
      if (!taken) return;
      const voice = taken.voice;
      if (taken.stolen) stop(voice.source);
      voice.source = src;
      gain = voice.gain;
      voice.panner.positionX.value = o.at.x;
      voice.panner.positionY.value = o.at.y;
      voice.panner.positionZ.value = o.at.z;
      set(voice.filter.frequency, o.cutoff ?? 18000);
      // Half the ringing from the space round the sound, half from the listener's.
      const send = o.send ?? 0.2;
      const here = this.around;
      const there = o.space ?? here;
      SPACES.forEach((k, i) => set(voice.sends[i].gain, send * (there[k] + here[k]) * 0.5));
    } else {
      gain = ctx.createGain();
      gain.connect(this.master!);
      const send = ctx.createGain();
      send.gain.value = o.send ?? 0.1;
      gain.connect(send).connect(this.ownSend!);
      this.own.add(src);
      src.onended = () => {
        gain.disconnect();
        this.own.delete(src);
      };
    }
    set(gain.gain, level);
    src.connect(gain);
    src.start(t, start + late, duration - late);
  }

  /** Wind, the sea, birds or crickets and rain, looping from the moment the recordings are in. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const loop = (name: string, out: AudioNode): GainNode => {
      const { buffer, start, duration } = this.clips[name][0];
      const src = ctx.createBufferSource();
      src.buffer = buffer;
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
    this.around = space(w, ear);
    this.enclosed = enclosure(w, ear, this.around);
    SPACES.forEach((k, i) => this.ownSends[i].gain.setTargetAtTime(this.around[k], now, 0.4));
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

/** Where a sound lies, as the nearest of the bed's compass directions. */
function bearingOf(dx: number, dz: number): number {
  const a = Math.atan2(dx, dz);
  return ((Math.round((a / (Math.PI * 2)) * BED_BEARINGS) % BED_BEARINGS) + BED_BEARINGS) % BED_BEARINGS;
}

/**
 * Each space's reverb impulse, a little different in each ear. A room: dense
 * early reflections off near walls, then a tail dying over about a second. A
 * walled yard: a few distinct slaps off walls further off and a thinner tail.
 * The open: no early reflections, only a faint, dark wash off hills and trees
 * that dies slowly.
 */
function impulse(ctx: BaseAudioContext, kind: (typeof SPACES)[number]): AudioBuffer {
  const rate = ctx.sampleRate;
  const shape = {
    room: { length: 1.6, decay: 0.35, level: 0.5, dark: 0, reflections: [[0.013, 0.5], [0.029, 0.35], [0.047, 0.3], [0.071, 0.2]] },
    yard: { length: 1.8, decay: 0.4, level: 0.25, dark: 0.5, reflections: [[0.045, 0.45], [0.083, 0.35], [0.121, 0.25], [0.17, 0.15]] },
    open: { length: 2.8, decay: 0.8, level: 0.2, dark: 0.9, reflections: [] },
  }[kind];
  const length = Math.floor(rate * shape.length);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    // One-pole low-passed noise: the darker, the more of the last sample it keeps.
    let last = 0;
    const norm = Math.sqrt((1 + shape.dark) / (1 - shape.dark));
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      last = last * shape.dark + (Math.random() * 2 - 1) * (1 - shape.dark);
      d[i] = last * norm * Math.exp(-t / shape.decay) * smoothstep(0, 0.02, t) * shape.level;
    }
    for (const [time, level] of shape.reflections) d[Math.floor((time + ch * 0.004) * rate)] += level;
  }
  return buffer;
}
