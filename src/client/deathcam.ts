import { DEATHCAM_AFTER, DEATHCAM_BEFORE } from '../shared/constants.ts';
import type { CoverState, GameEvent, GrenadeSnap, PlayerSnap } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { TapePlayer, type Played } from '../shared/tape.ts';
import type { WeaponFx } from '../shared/weapons.ts';
import type { World } from '../shared/world.ts';
import { grenadesAt, playersAt, type Recording, type RecordedEvent } from './connection.ts';

export type DeathcamEvent = Extract<GameEvent, { k: 'deathcam' }>;

/** Around the kill the death cam slows to this speed... */
const SLOW_RATE = 0.35;
/** ...from this many seconds before it to this many after. */
const SLOW_BEFORE = 0.3;
const SLOW_AFTER = 0.4;

/**
 * The last seconds before you died, seen through your killer's eyes. The
 * killer is rebuilt from their recorded inputs through the shared
 * simulation, so their aim, recoil and shots are exactly what the server
 * judged. Everyone else is drawn from the snapshots this client received,
 * and the panels are put back as they stood then.
 */
export class Deathcam {
  readonly killer: number;
  readonly name: string;
  /** Server time being shown. */
  time: number;
  readonly end: number;
  /** The cover when it starts. */
  readonly cover: CoverState;
  private readonly kill: number;
  private readonly player: TapePlayer;
  private readonly recording: Recording;
  private nextEvent = 0;

  /** `cover` is how the cover stands now. */
  constructor(world: World, e: DeathcamEvent, recording: Recording, cover: CoverState) {
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
    this.cover = coverBefore(cover, recording.events, this.time);
    while (this.nextEvent < recording.events.length && recording.events[this.nextEvent].time <= this.time) this.nextEvent++;
  }

  get done(): boolean {
    return this.time >= this.end;
  }

  /**
   * Play on by `dt` real seconds. The killer's own effects go to `onFx`, other
   * people's shots, blasts and breaking panels to `onEvent`, and the killer's
   * hits to `onMark`, `kill` set for the one that killed.
   */
  update(dt: number, onFx: (fx: WeaponFx) => void, onEvent: (e: RecordedEvent, time: number) => void, onMark: (kill: boolean) => void): void {
    const near = this.time > this.kill - SLOW_BEFORE && this.time < this.kill + SLOW_AFTER;
    const before = this.time;
    this.time = Math.min(this.time + dt * (near ? SLOW_RATE : 1), this.end);
    this.player.seek(this.time, onFx);
    const events = this.recording.events;
    while (this.nextEvent < events.length && events[this.nextEvent].time <= this.time) {
      const { e, time } = events[this.nextEvent++];
      // The killer's rounds come from the death cam itself; only whether they hit is taken.
      if (e.k !== 'shot' || e.id !== this.killer) onEvent(e, time);
      else if (e.struck === 'body' && time < this.kill) onMark(false);
    }
    if (before < this.kill && this.time >= this.kill) onMark(true);
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

  /** Everyone, the killer and whoever died too, as this client saw them at `time`. */
  everyoneAt(time: number): PlayerSnap[] {
    return playersAt(this.recording.snapshots, time);
  }

  grenades(): GrenadeSnap[] {
    return grenadesAt(this.recording.snapshots, this.time);
  }
}

/**
 * The cover at `from`, rebuilt from how it stands now by undoing the breaks,
 * rebuilds and doors used since, latest first.
 */
function coverBefore(now: CoverState, events: readonly { time: number; e: GameEvent }[], from: number): CoverState {
  const down = new Set(now.broken);
  const open = new Set(now.open);
  for (let i = events.length - 1; i >= 0 && events[i].time > from; i--) {
    const e = events[i].e;
    if (e.k === 'break') for (const p of e.panels) down.delete(p);
    if (e.k === 'repair') for (const p of e.panels) down.add(p);
    if (e.k === 'door') for (const d of e.doors) (e.open ? open.delete(d) : open.add(d));
  }
  return { broken: [...down], open: [...open] };
}
