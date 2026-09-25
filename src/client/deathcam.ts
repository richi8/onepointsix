import { DEATHCAM_AFTER, DEATHCAM_BEFORE } from '../shared/constants.ts';
import type { GameEvent, GrenadeSnap, PlayerSnap } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { TapePlayer, type Played } from '../shared/tape.ts';
import type { WeaponFx } from '../shared/weapons.ts';
import type { World } from '../shared/world.ts';
import { grenadesAt, playersAt, type Recording, type ReplayEvent } from './connection.ts';

export type DeathcamEvent = Extract<GameEvent, { k: 'deathcam' }>;

/** Around the kill the replay slows to this speed... */
const SLOW_RATE = 0.35;
/** ...from this many seconds before it to this many after. */
const SLOW_BEFORE = 0.3;
const SLOW_AFTER = 0.4;

/**
 * The last seconds before you died, seen through your killer's eyes. The
 * killer is rebuilt from their recorded inputs through the shared
 * simulation, so their aim, recoil and shots are exactly what the server
 * judged. Everyone else is drawn from the snapshots this client received.
 */
export class Deathcam {
  readonly killer: number;
  readonly name: string;
  /** Server time being shown. */
  time: number;
  readonly end: number;
  private readonly kill: number;
  private readonly player: TapePlayer;
  private readonly recording: Recording;
  private nextEvent = 0;

  constructor(world: World, e: DeathcamEvent, recording: Recording) {
    this.killer = e.killer;
    this.name = e.name;
    this.kill = e.time;
    this.player = new TapePlayer(world, e.clip);
    this.recording = recording;
    const first = recording.snapshots[0]?.time ?? e.time;
    this.time = Math.max(e.time - DEATHCAM_BEFORE, this.player.start, first);
    this.end = Math.max(Math.min(e.time + DEATHCAM_AFTER, this.player.end), this.time);
    // Catch up silently to where it starts, and skip what happened before.
    this.player.seek(this.time);
    while (this.nextEvent < recording.events.length && recording.events[this.nextEvent].time <= this.time) this.nextEvent++;
  }

  get done(): boolean {
    return this.time >= this.end;
  }

  /** Play on by `dt` real seconds; the killer's own effects go to `onFx`, and other people's shots and blasts to `onEvent`. */
  update(dt: number, onFx: (fx: WeaponFx) => void, onEvent: (e: ReplayEvent) => void): void {
    const near = this.time > this.kill - SLOW_BEFORE && this.time < this.kill + SLOW_AFTER;
    this.time = Math.min(this.time + dt * (near ? SLOW_RATE : 1), this.end);
    this.player.seek(this.time, onFx);
    const events = this.recording.events;
    while (this.nextEvent < events.length && events[this.nextEvent].time <= this.time) {
      const { e } = events[this.nextEvent++];
      // The killer's rounds come from the replay itself.
      if (e.k !== 'shot' || e.id !== this.killer) onEvent(e);
    }
  }

  /** The killer, where to draw them now. */
  view(): Played {
    return this.player.render(this.time);
  }

  /** The killer's full state as of the last command replayed. */
  get state(): PlayerState {
    return this.player.state;
  }

  /** Everyone but the killer, as this client saw them then. */
  others(): PlayerSnap[] {
    return playersAt(this.recording.snapshots, this.time).filter((p) => p.id !== this.killer);
  }

  grenades(): GrenadeSnap[] {
    return grenadesAt(this.recording.snapshots, this.time);
  }
}
