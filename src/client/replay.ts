import type { BagSnap, BountyView, CoverState, ExtractView, GameEvent, GrenadeSnap, PlayerSnap, RunView } from '../shared/protocol.ts';
import { motionOf, type PlayerState } from '../shared/sim.ts';
import { TapePlayer, type Played } from '../shared/tape.ts';
import type { WeaponFx } from '../shared/weapons.ts';
import type { World } from '../shared/world.ts';
import { grenadesAt, playersAt, type Snapshot } from './connection.ts';
import { ExactTrack, type ExactJob, type ExactNews } from './exactrun.ts';
import { Frames, type ReplayData, type Timed } from './replayfile.ts';

/** Speeds a replay can play at. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** A moment worth finding on the timeline: a kill by the player, their death or their extraction. */
export interface Mark {
  at: number;
  kind: 'kill' | 'death' | 'extract';
}

/**
 * A whole run played back. The player is rebuilt from their inputs through
 * the shared simulation, so their view, aim and shots are exactly what the
 * server judged. Everyone else is drawn exactly too, from the game run again
 * from its log in a worker, as far as that has got and matched the file;
 * anywhere else, from what the player's client was sent. The run around
 * them is what the client was sent.
 */
export class Replay {
  readonly data: ReplayData;
  /** Server time being shown. */
  time: number;
  speed = 1;
  playing = true;
  private readonly player: TapePlayer;
  private readonly frames: Frames;
  /** Everyone else from the game run again, checked. */
  readonly exact = new ExactTrack();
  private worker: Worker | null = null;
  private nextEvent = 0;

  /** With `rerun` (where there are Workers), the game is run again from its log to show everyone exactly. */
  constructor(world: World, data: ReplayData, rerun = typeof Worker !== 'undefined') {
    this.data = data;
    this.player = new TapePlayer(world, data.tape);
    this.frames = new Frames(data.frames);
    this.time = data.from;
    this.seek(data.from);
    if (rerun && data.log) {
      const job: ExactJob = { log: data.log, watch: data.id, frames: data.frames, from: data.from, to: data.to };
      const worker = (this.worker = new Worker(new URL('./rerun.worker.ts', import.meta.url), { type: 'module' }));
      worker.onmessage = (e: MessageEvent<ExactNews>) => this.hear(e.data);
      worker.onerror = () => this.stopRerun();
      worker.postMessage(job);
    }
  }

  /** News from the game being run again. */
  hear(news: ExactNews): void {
    if (news.k === 'batch') this.exact.add(news.batch);
    else {
      if (news.k === 'diverged') this.exact.divergedAt = news.at;
      this.exact.done = true;
      this.stopRerun();
    }
  }

  /** Stop running the game again; done with, or closed. */
  stopRerun(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  /** Whether everyone else is shown exactly at the time shown, rather than as the client saw them. */
  get exactNow(): boolean {
    return !!this.exact.around(this.time);
  }

  /** Everyone at the time shown: exact where the game run again has got to, else the frames. */
  private around(): Snapshot[] {
    return this.exact.around(this.time) ?? this.frames.around(this.time);
  }

  get start(): number {
    return this.data.from;
  }

  get end(): number {
    return this.data.to;
  }

  /** Server time the run ended: the end of the player's inputs. */
  get runOver(): number {
    return this.player.end;
  }

  /** The player's id in the game. */
  get id(): number {
    return this.data.id;
  }

  /** Play on by `dt` real seconds; the player's own weapon goes to `onFx`, and whatever else happened to `onEvent`. */
  update(dt: number, onFx: (fx: WeaponFx) => void, onEvent: (e: GameEvent) => void): void {
    if (!this.playing) return;
    this.time = Math.min(this.time + dt * this.speed, this.end);
    this.player.seek(this.time, onFx);
    const events = this.data.events;
    while (this.nextEvent < events.length && events[this.nextEvent][0] <= this.time) onEvent(events[this.nextEvent++][1]);
    if (this.time >= this.end) this.playing = false;
  }

  /** Jump to server time `t` without playing what's in between; the caller sets the cover right from coverAt(). */
  seek(t: number): void {
    this.time = Math.min(Math.max(t, this.start), this.end);
    this.player.seek(this.time);
    this.nextEvent = after(this.data.events, this.time);
  }

  /** The events of the last `seconds` up to now, oldest first, with how long ago each was. */
  recent(seconds: number): { ago: number; e: GameEvent }[] {
    const out: { ago: number; e: GameEvent }[] = [];
    const events = this.data.events;
    for (let i = this.nextEvent - 1; i >= 0 && events[i][0] > this.time - seconds; i--) out.push({ ago: this.time - events[i][0], e: events[i][1] });
    return out.reverse();
  }

  /** The kill events up to now, oldest first, so bodies already dead after a seek lie as they fell. */
  killsBefore(): Extract<GameEvent, { k: 'kill' }>[] {
    return this.data.events.slice(0, this.nextEvent).flatMap(([, e]) => (e.k === 'kill' ? [e] : []));
  }

  /** The player, where to draw their view now. */
  view(): Played {
    return this.player.render(this.time);
  }

  /** The player's full state as of the last command replayed. */
  get state(): PlayerState {
    return this.player.state;
  }

  /** Everyone but the player, as their client saw them then. */
  others(): PlayerSnap[] {
    return playersAt(this.around(), this.time).filter((p) => p.id !== this.id);
  }

  /** The player's own body, seen from outside: where the replay puts them, doing what their client saw. */
  self(): PlayerSnap {
    const seen = playersAt(this.frames.around(this.time), this.time).find((p) => p.id === this.id);
    const v = this.view();
    const s = this.state;
    return {
      id: this.id, team: 'operator', weapon: s.weapon, quiet: s.suppressed[s.weapon], motion: motionOf(s),
      act: 'none', actT: 0, commander: false, light: false, ...seen,
      x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, duck: v.duck, lean: v.lean, dead: s.dead,
    };
  }

  grenades(): GrenadeSnap[] {
    return grenadesAt(this.around(), this.time);
  }

  /** The player's run then, its clock counting down since it was sent. */
  run(): RunView | null {
    const r = latest(this.data.runs, this.time);
    return r && { ...r[1], time: Math.max(r[1].time - (this.time - r[0]), 0) };
  }

  /** The extraction points then, their countdowns running on. */
  extracts(): ExtractView[] {
    const r = latest(this.data.extracts, this.time);
    if (!r) return [];
    const gone = this.time - r[0];
    return r[1].map((v) => ({ open: v.open, next: Math.max(v.next - gone, 0), call: v.call >= 0 ? Math.max(v.call - gone, 0) : -1 }));
  }

  bags(): BagSnap[] {
    return latest(this.data.bags, this.time)?.[1] ?? [];
  }

  bounty(): BountyView | null {
    return latest(this.data.bounty ?? [], this.time)?.[1] ?? null;
  }

  /** Panels down and door leaves open at the time shown. */
  coverAt(): CoverState {
    const down = new Set(this.data.broken);
    const open = new Set(this.data.open);
    for (const [at, e] of this.data.events) {
      if (at > this.time) break;
      if (e.k === 'break') for (const i of e.panels) down.add(i);
      if (e.k === 'repair') for (const i of e.panels) down.delete(i);
      if (e.k === 'door') for (const i of e.doors) (e.open ? open.add(i) : open.delete(i));
    }
    return { broken: [...down], open: [...open] };
  }

  /** Kills by the player, and how the run ended, for the timeline. */
  marks(): Mark[] {
    const out: Mark[] = [];
    for (const [at, e] of this.data.events) {
      if (e.k === 'kill' && e.killer === this.id && e.victim !== this.id) out.push({ at, kind: 'kill' });
    }
    const { end } = this.data;
    const endAt = this.data.tape.keys.at(-1)!.at;
    if (end.outcome === 'killed') out.push({ at: endAt, kind: 'death' });
    if (end.outcome === 'extracted') out.push({ at: endAt, kind: 'extract' });
    return out;
  }
}

/** Index of the first entry after time `t`. */
function after<T>(track: readonly Timed<T>[], t: number): number {
  let lo = 0;
  let hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The last entry at or before time `t`. */
function latest<T>(track: readonly Timed<T>[], t: number): Timed<T> | null {
  return track[after(track, t) - 1] ?? null;
}

/**
 * The cover at `from`, rebuilt from how it stands now by undoing the breaks,
 * rebuilds and doors used since, latest first.
 */
export function coverBefore(now: CoverState, events: readonly { time: number; e: GameEvent }[], from: number): CoverState {
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
