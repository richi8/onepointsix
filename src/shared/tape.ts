import { CMD_DT, SERVER_DT } from './constants.ts';
import { angleDiff, lerp } from './geom.ts';
import type { InputCmd } from './protocol.ts';
import { applyCmd, copyState, copyStateInto, sameState, type PlayerState } from './sim.ts';
import type { WeaponFx } from './weapons.ts';
import type { World } from './world.ts';

/** Seconds of a player's recent past a tape keeps, unless told to keep more. */
export const TAPE_TIME = 7;
/** Seconds between the full states a tape stores; the commands in between rebuild the rest. */
const KEY_EVERY = 0.5;
/** Times closer than this are the same moment; tick times carry rounding error. */
const EPS = 1e-6;
/** Seeking further ahead than this starts again from the last key before, rather than playing every command in between. */
const JUMP_AHEAD = 2;

/** A command, and the server time in seconds just after it was simulated. */
export interface TapedCmd {
  at: number;
  cmd: InputCmd;
}

/** A player's full state at server time `at`, before the commands after it. */
export interface TapeKey {
  at: number;
  state: PlayerState;
  /**
   * Written because the server changed the player outside their commands (health, ammo, loot,
   * a respawn), so it can't be rebuilt from the key before. The others are only there to seek by.
   */
  changed?: true;
}

/**
 * Part of a player's past, as their state every so often and every command in
 * between. Because applyCmd is deterministic, the first key and the commands
 * are enough to rebuild exactly how they moved, looked and fired; the keys
 * marked `changed` catch what the server did outside the commands, such as a
 * respawn, damage or the weight of loot picked up. It crosses the wire, so
 * only plain data.
 */
export interface TapeClip {
  keys: TapeKey[];
  cmds: TapedCmd[];
}

/**
 * Records a player as inputs: a full state every KEY_EVERY seconds and
 * whenever the server changed them outside their commands, and each command
 * simulated since, for the last `keep` seconds.
 */
export class Tape {
  private readonly keys: TapeKey[] = [];
  private readonly cmds: TapedCmd[] = [];
  private readonly keep: number;
  private tickCmds = 0;
  private tickStart = -1;
  /** The player as of the last command or key recorded, to tell what the server changed since. */
  private after: PlayerState | null = null;

  /** `keep` is how many seconds of the past to hold on to. */
  constructor(keep = TAPE_TIME) {
    this.keep = keep;
  }

  /** Call at the start of each server tick, before the player's commands, with the time it starts from. */
  beginTick(p: PlayerState, time: number): void {
    this.tickStart = time;
    this.tickCmds = 0;
    const last = this.keys[this.keys.length - 1];
    if (!last || time - last.at >= KEY_EVERY - EPS) this.key(p, time, false);
    else this.sync(p);
    const old = time - this.keep;
    // Keep one key at or before the oldest time kept, so all of it can be rebuilt.
    while (this.keys.length > 1 && this.keys[1].at <= old) this.keys.shift();
    while (this.cmds.length && this.cmds[0].at < this.keys[0].at + EPS) this.cmds.shift();
  }

  /**
   * Call before simulating each command: if the server changed the player since
   * the last one (a search handing over loot between two commands), key it.
   */
  sync(p: PlayerState): void {
    if (this.after && !sameState(this.after, p)) this.key(p, this.tickStart + Math.min(this.tickCmds * CMD_DT, SERVER_DT), true);
  }

  /** Call after simulating each command, with the player it moved. Commands in one tick are spread CMD_DT apart. */
  record(cmd: InputCmd, p: PlayerState): void {
    this.cmds.push({ at: this.tickStart + Math.min(++this.tickCmds * CMD_DT, SERVER_DT), cmd });
    if (this.after) copyStateInto(this.after, p);
    else this.after = copyState(p);
  }

  /** The recording from `from` onwards, starting at the last key at or before it. */
  clip(from: number): TapeClip | null {
    let i = this.keys.length - 1;
    while (i > 0 && this.keys[i].at > from) i--;
    const first = this.keys[i];
    if (!first) return null;
    return {
      keys: this.keys.slice(i).map((k) => ({ ...k, state: copyState(k.state) })),
      cmds: this.cmds.filter((c) => c.at > first.at + EPS),
    };
  }

  private key(p: PlayerState, at: number, changed: boolean): void {
    changed ||= !!this.after && !sameState(this.after, p);
    // Two keys at one moment: the later one holds.
    const last = this.keys.at(-1);
    if (last && Math.abs(last.at - at) < EPS) {
      changed ||= !!last.changed;
      this.keys.pop();
    }
    const key: TapeKey = { at, state: copyState(p) };
    if (changed) key.changed = true;
    this.keys.push(key);
    this.after = copyState(p);
  }
}

/** A player rebuilt from a clip, drawn between command steps. */
export interface Played {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  duck: number;
  lean: number;
  aim: number;
  recoilPitch: number;
  recoilYaw: number;
}

/**
 * Plays a clip back through the shared simulation. Seek to a time and it
 * applies every command up to then; their shots come out of `onFx` as they
 * happen, just as they did live.
 */
export class TapePlayer {
  readonly clip: TapeClip;
  state: PlayerState;
  private prev: PlayerState;
  private prevAt: number;
  /** Time of the state: of the last command or key applied. */
  private atTime: number;
  /** Next command and next key to apply. */
  private next = 0;
  private key = 1;
  private readonly world: World;

  constructor(world: World, clip: TapeClip) {
    this.world = world;
    this.clip = clip;
    this.state = copyState(clip.keys[0].state);
    this.prev = copyState(this.state);
    this.prevAt = this.atTime = this.start;
  }

  /** Server time the clip starts at. */
  get start(): number {
    return this.clip.keys[0].at;
  }

  /** Server time of the last command or key in the clip. */
  get end(): number {
    return Math.max(this.clip.cmds.at(-1)?.at ?? this.start, this.clip.keys.at(-1)!.at);
  }

  /** Time of the last command or key applied, or the start. */
  get at(): number {
    return this.atTime;
  }

  /**
   * Apply every command up to `time`, and the one just after it so render()
   * has a step to blend toward. Going back, or far ahead with nobody listening
   * for effects, starts again from the last key before `time` and plays on
   * from there silently.
   */
  seek(time: number, onFx?: (fx: WeaponFx) => void): void {
    const until = time + CMD_DT;
    const { cmds, keys } = this.clip;
    if (until < this.atTime - EPS || (!onFx && time > this.atTime + JUMP_AHEAD)) {
      const k = this.keyBefore(Math.max(time, this.start));
      if (k >= this.key || until < this.atTime - EPS) {
        this.jump(k);
        onFx = undefined;
      }
    }
    for (;;) {
      const c = cmds[this.next];
      const k = keys[this.key];
      // A key at a command's time was taken before it.
      if (k && k.at <= until + EPS && (!c || k.at < c.at - EPS)) {
        this.prevAt = this.atTime;
        // A respawn isn't blended across.
        this.prev = k.state.life !== this.state.life ? copyState(k.state) : this.state;
        this.state = copyState(k.state);
        this.atTime = k.at;
        this.key++;
      } else if (c && c.at <= until + EPS) {
        this.prevAt = this.atTime;
        this.prev = copyState(this.state);
        applyCmd(this.world, this.state, c.cmd, CMD_DT, onFx);
        this.atTime = c.at;
        this.next++;
      } else break;
    }
  }

  /** Where to draw them at `time`, blended between the last two steps applied. */
  render(time: number): Played {
    const s = this.state;
    const p = this.prev;
    const span = this.atTime - this.prevAt;
    const f = span > 0 ? Math.min(Math.max((time - this.prevAt) / span, 0), 1) : 1;
    return {
      x: lerp(p.x, s.x, f),
      y: lerp(p.y, s.y, f),
      z: lerp(p.z, s.z, f),
      yaw: p.yaw + angleDiff(s.yaw, p.yaw) * f,
      pitch: lerp(p.pitch, s.pitch, f),
      duck: lerp(p.duck, s.duck, f),
      lean: lerp(p.lean, s.lean, f),
      aim: lerp(p.aim, s.aim, f),
      recoilPitch: lerp(p.recoilPitch, s.recoilPitch, f),
      recoilYaw: lerp(p.recoilYaw, s.recoilYaw, f),
    };
  }

  /** Index of the last key at or before `time`, or the first. */
  private keyBefore(time: number): number {
    const keys = this.clip.keys;
    let lo = 0;
    let hi = keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (keys[mid].at <= time + EPS) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Start again from key `i`, with the commands after it still to come. */
  private jump(i: number): void {
    const k = this.clip.keys[i];
    const cmds = this.clip.cmds;
    this.state = copyState(k.state);
    this.prev = copyState(k.state);
    this.prevAt = this.atTime = k.at;
    this.key = i + 1;
    let lo = 0;
    let hi = cmds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmds[mid].at > k.at + EPS) hi = mid;
      else lo = mid + 1;
    }
    this.next = lo;
  }
}
