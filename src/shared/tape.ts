import { CMD_DT, SERVER_DT } from './constants.ts';
import { angleDiff, lerp } from './geom.ts';
import type { InputCmd } from './protocol.ts';
import { applyCmd, copyState, type PlayerState } from './sim.ts';
import type { WeaponFx } from './weapons.ts';
import type { World } from './world.ts';

/** Seconds of a player's recent past a tape keeps. */
export const TAPE_TIME = 7;
/** Seconds between the full states a tape stores; the commands in between rebuild the rest. */
const KEY_EVERY = 0.5;
/** Times closer than this are the same moment; tick times carry rounding error. */
const EPS = 1e-6;

/** A command, and the server time in seconds just after it was simulated. */
export interface TapedCmd {
  at: number;
  cmd: InputCmd;
}

/** A player's full state at server time `at`, before the commands after it. */
export interface TapeKey {
  at: number;
  state: PlayerState;
}

/**
 * Part of a player's past, as their state every so often and every command in
 * between. Because applyCmd is deterministic, the first key and the commands
 * are enough to rebuild exactly how they moved, looked and fired; the later
 * keys catch what the server changed outside the commands, such as a respawn
 * or the weight of loot picked up. It crosses the wire, so only plain data.
 */
export interface TapeClip {
  keys: TapeKey[];
  cmds: TapedCmd[];
}

/**
 * Records a player as inputs: a full state every KEY_EVERY seconds and each
 * command simulated since, for the last TAPE_TIME seconds.
 */
export class Tape {
  private readonly keys: TapeKey[] = [];
  private readonly cmds: TapedCmd[] = [];
  private tickCmds = 0;
  private tickStart = -1;
  private carry = 0;

  /** Call at the start of each server tick, before the player's commands, with the time it starts from. */
  beginTick(p: PlayerState, time: number): void {
    this.tickStart = time;
    this.tickCmds = 0;
    const last = this.keys[this.keys.length - 1];
    // Commands never change the carry weight, so a new one is loot the server handed over, which changes the pace.
    if (!last || time - last.at >= KEY_EVERY - EPS || last.state.life !== p.life || p.carry !== this.carry) {
      this.keys.push({ at: time, state: copyState(p) });
    }
    this.carry = p.carry;
    const old = time - TAPE_TIME;
    // Keep one key at or before the oldest time kept, so all of it can be rebuilt.
    while (this.keys.length > 1 && this.keys[1].at <= old) this.keys.shift();
    while (this.cmds.length && this.cmds[0].at < this.keys[0].at + EPS) this.cmds.shift();
  }

  /** Call after simulating each command. Commands in one tick are spread CMD_DT apart. */
  record(cmd: InputCmd): void {
    this.cmds.push({ at: this.tickStart + Math.min(++this.tickCmds * CMD_DT, SERVER_DT), cmd });
  }

  /** The recording from `from` onwards, starting at the last key at or before it. */
  clip(from: number): TapeClip | null {
    let i = this.keys.length - 1;
    while (i > 0 && this.keys[i].at > from) i--;
    const first = this.keys[i];
    if (!first) return null;
    return {
      keys: this.keys.slice(i).map((k) => ({ at: k.at, state: copyState(k.state) })),
      cmds: this.cmds.filter((c) => c.at > first.at + EPS),
    };
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
  /** Next command and next key to apply. */
  private next = 0;
  private key = 1;
  private readonly world: World;

  constructor(world: World, clip: TapeClip) {
    this.world = world;
    this.clip = clip;
    this.state = copyState(clip.keys[0].state);
    this.prev = copyState(this.state);
    this.prevAt = this.start;
  }

  /** Server time the clip starts at. */
  get start(): number {
    return this.clip.keys[0].at;
  }

  /** Server time of the last command in the clip. */
  get end(): number {
    return this.clip.cmds.at(-1)?.at ?? this.start;
  }

  /** Time of the last command applied, or the start. */
  get at(): number {
    return this.next > 0 ? this.clip.cmds[this.next - 1].at : this.start;
  }

  /**
   * Apply every command up to `time`, and the one just after it so render()
   * has a step to blend toward. Going back rewinds to the start and plays
   * forward again, silently.
   */
  seek(time: number, onFx?: (fx: WeaponFx) => void): void {
    const until = time + CMD_DT;
    if (until < this.at - EPS) {
      this.state = copyState(this.clip.keys[0].state);
      this.prev = copyState(this.state);
      this.prevAt = this.start;
      this.next = 0;
      this.key = 1;
      onFx = undefined;
    }
    const { cmds, keys } = this.clip;
    while (this.next < cmds.length && cmds[this.next].at <= until + EPS) {
      const c = cmds[this.next];
      this.prevAt = this.at;
      this.prev = copyState(this.state);
      // Take up what the server changed outside the commands; a respawn isn't blended across.
      while (this.key < keys.length && keys[this.key].at < c.at - EPS) {
        const k = keys[this.key++].state;
        if (k.life !== this.state.life) this.prev = copyState(k);
        this.state = copyState(k);
      }
      applyCmd(this.world, this.state, c.cmd, CMD_DT, onFx);
      this.next++;
    }
  }

  /** Where to draw them at `time`, blended between the last two commands applied. */
  render(time: number): Played {
    const s = this.state;
    const p = this.prev;
    const span = this.at - this.prevAt;
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
}
