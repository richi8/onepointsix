import { CMD_RATE, SERVER_TICK_RATE } from '../shared/constants.ts';
import { wrapAngle } from '../shared/geom.ts';
import type {
  Action, BagSnap, BountyView, ExtractView, GameEvent, GrenadeSnap, InputCmd, Mode, Motion, PlayerSnap, RunView,
} from '../shared/protocol.ts';
import { copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import type { TapeClip, TapeKey } from '../shared/tape.ts';
import type { WorldConfig } from '../shared/worldconfig.ts';
import type { Snapshot } from './connection.ts';

/** What a replay file says it is, and the layout it's in. */
const FORMAT = 'onepointsix-replay';
const VERSION = 1;
/** Seconds between the frames of everyone else kept; snapshots in between are dropped. */
const FRAME_DT = 1 / 15;

export type RunEnd = Extract<GameEvent, { k: 'runEnd' }>;

/** Something that happened, and the server time it reached the player. */
export type Timed<T> = [at: number, value: T];

/** A whole run as its player saw it, to watch again. It's plain data, saved as gzipped JSON. */
export interface ReplayData {
  world: WorldConfig;
  mode: Mode;
  /** The player, and their id in the game. */
  name: string;
  id: number;
  /** When it was played, as an ISO date and time. */
  date: string;
  /** The update of the game it was played on, as the date of the latest "What's new" entry. */
  build: string;
  /** How the run ended. */
  end: RunEnd;
  /** Server seconds the replay runs from and to. */
  from: number;
  to: number;
  /** Panels down at the start. */
  broken: number[];
  /** The player's own inputs, rebuilt exactly through the simulation. */
  tape: TapeClip;
  /** Everyone else, and grenades, FRAME_DT apart, packed by FramePacker. */
  frames: number[];
  /** The player's run, the extraction points and the bags on the ground, each whenever it changed. */
  runs: Timed<RunView>[];
  extracts: Timed<ExtractView[]>[];
  bags: Timed<BagSnap[]>[];
  /** Who carried the bounty and where they were called, whenever it changed; missing in replays from before the bounty. */
  bounty?: Timed<BountyView | null>[];
  /** Every event the player was sent, but for the run's end and the replays. */
  events: Timed<GameEvent>[];
}

/**
 * Records a run as the client sees it, for a replay: every event, the
 * snapshots of everyone else, and at the end the player's own inputs from
 * the server. It packs as it goes, so a ten-minute run stays a few MB.
 */
export class RunRecorder {
  private readonly world: WorldConfig;
  private readonly mode: Mode;
  private readonly name: string;
  private readonly build: string;
  private readonly date = new Date().toISOString();
  private id = 0;
  private broken: number[] = [];
  private readonly frames = new FramePacker();
  private lastFrame = -Infinity;
  private readonly runs: Timed<RunView>[] = [];
  private readonly extracts: Timed<ExtractView[]>[] = [];
  private readonly bags: Timed<BagSnap[]>[] = [];
  private readonly bounty: Timed<BountyView | null>[] = [];
  private readonly events: Timed<GameEvent>[] = [];
  private shown = { run: '', extracts: '', bags: '', bounty: '' };
  private tape: TapeClip | null = null;
  private end: RunEnd | null = null;
  private endAt = 0;
  private lastAt = 0;

  constructor(world: WorldConfig, mode: Mode, name: string, build: string) {
    this.world = world;
    this.mode = mode;
    this.name = name;
    this.build = build;
  }

  /** Joined as `id`, with these panels down. */
  welcome(id: number, broken: readonly number[]): void {
    this.id = id;
    this.broken = [...broken];
  }

  snapshot(
    time: number, players: readonly PlayerSnap[], grenades: readonly GrenadeSnap[], run: RunView | null, extracts: readonly ExtractView[],
    bags: readonly BagSnap[], bounty: BountyView | null = null,
  ): void {
    this.lastAt = time;
    if (time - this.lastFrame >= FRAME_DT - 1e-6) {
      this.lastFrame = time;
      this.frames.push(time, players, grenades);
    }
    if (run) {
      const key = JSON.stringify({ ...run, time: 0 });
      if (key !== this.shown.run) {
        this.shown.run = key;
        this.runs.push([time, rounded(run)]);
      }
    }
    // A countdown changes every tick; only a point opening, closing or being called is kept.
    const ex = extracts.map((v) => `${v.open}${v.call >= 0}`).join();
    if (ex !== this.shown.extracts) {
      this.shown.extracts = ex;
      this.extracts.push([time, rounded([...extracts])]);
    }
    const b = JSON.stringify(bags);
    if (b !== this.shown.bags) {
      this.shown.bags = b;
      this.bags.push([time, rounded([...bags])]);
    }
    const k = bounty ? `${bounty.id}|${bounty.at}|${bounty.value}` : '';
    if (k !== this.shown.bounty) {
      this.shown.bounty = k;
      this.bounty.push([time, bounty && rounded(bounty)]);
    }
  }

  event(time: number, e: GameEvent): void {
    if (e.k === 'tape') this.tape = e.clip;
    else if (e.k === 'runEnd') {
      this.end = e;
      this.endAt = time;
    } else if (e.k !== 'deathcam') this.events.push([time, rounded(e)]);
  }

  /** Whether the run is over and its replay can be made. */
  get ready(): boolean {
    return !!this.tape && !!this.end;
  }

  /** The replay, up to `after` seconds past the run's end, or null before it has ended. */
  finish(after: number): ReplayData | null {
    if (!this.tape || !this.end) return null;
    const from = this.tape.keys[0].at;
    const to = Math.max(Math.min(this.endAt + after, this.lastAt), from);
    return {
      world: { ...this.world }, mode: this.mode, name: this.name, id: this.id, date: this.date, build: this.build,
      end: this.end, from, to, broken: [...this.broken], tape: this.tape, frames: this.frames.data(),
      runs: [...this.runs], extracts: [...this.extracts], bags: [...this.bags], bounty: [...this.bounty], events: this.events.filter(([at]) => at <= to),
    };
  }
}

// ------------------------------------------------------------------ frames

const MOTIONS: readonly Motion[] = ['ground', 'air', 'mantle'];
const ACTIONS: readonly Action[] = ['none', 'reload', 'draw', 'throw'];
/** Whole numbers stored for each player in a frame: centimetres, milliradians, hundredths, and flags. */
const FIELDS = 9;

/** A player's snapshot as FIELDS whole numbers. */
function quantize(p: PlayerSnap, out: number[]): void {
  out[0] = Math.round(p.x * 100);
  out[1] = Math.round(p.y * 100);
  out[2] = Math.round(p.z * 100);
  out[3] = Math.round(wrapAngle(p.yaw) * 1000);
  out[4] = Math.round(p.pitch * 1000);
  out[5] = Math.round(p.duck * 100);
  out[6] = Math.round(p.lean * 100);
  out[7] = Math.round(p.actT * 100);
  out[8] = (p.team === 'guard' ? 1 : 0) | (+p.dead << 1) | (+p.quiet << 2) | (+p.commander << 3) | (+p.light << 4) |
    (MOTIONS.indexOf(p.motion) << 5) | (ACTIONS.indexOf(p.act) << 7) | (p.weapon << 9);
}

function unquantize(id: number, q: ArrayLike<number>, at: number): PlayerSnap {
  const f = q[at + 8];
  return {
    id, team: f & 1 ? 'guard' : 'operator',
    x: q[at] / 100, y: q[at + 1] / 100, z: q[at + 2] / 100, yaw: q[at + 3] / 1000, pitch: q[at + 4] / 1000,
    duck: q[at + 5] / 100, lean: q[at + 6] / 100, actT: q[at + 7] / 100,
    dead: !!(f & 2), quiet: !!(f & 4), commander: !!(f & 8), light: !!(f & 16),
    motion: MOTIONS[(f >> 5) & 3] ?? 'ground', act: ACTIONS[(f >> 7) & 3], weapon: f >> 9,
  };
}

/**
 * Packs frames of everyone into whole numbers, each player as the change from
 * their last frame and only in the fields that changed, so someone standing
 * still costs two numbers. A frame is: ticks since the last, the number of
 * players, then for each its id, a mask of the fields changed and those
 * changes; then the number of grenades and each one's id and position in cm.
 */
export class FramePacker {
  private readonly out: number[] = [];
  private readonly last = new Map<number, number[]>();
  private tick = 0;
  private readonly q: number[] = [];

  push(time: number, players: readonly PlayerSnap[], grenades: readonly GrenadeSnap[]): void {
    const tick = Math.round(time * SERVER_TICK_RATE);
    const out = this.out;
    out.push(tick - this.tick, players.length);
    this.tick = tick;
    for (const p of players) {
      quantize(p, this.q);
      let before = this.last.get(p.id);
      if (!before) this.last.set(p.id, (before = new Array<number>(FIELDS).fill(0)));
      out.push(p.id, 0);
      const maskAt = out.length - 1;
      let mask = 0;
      for (let f = 0; f < FIELDS; f++) {
        const d = this.q[f] - before[f];
        if (d === 0) continue;
        mask |= 1 << f;
        out.push(d);
        before[f] = this.q[f];
      }
      out[maskAt] = mask;
    }
    out.push(grenades.length);
    for (const g of grenades) out.push(g.id, Math.round(g.x * 100), Math.round(g.y * 100), Math.round(g.z * 100));
  }

  data(): number[] {
    return [...this.out];
  }
}

/** Frames unpacked for playing back, with snapshots made from them as they're needed. */
export class Frames {
  /** Server time of each frame. */
  readonly times: number[] = [];
  /** Where each frame's players start in `players` and how many there are; each is an id then FIELDS numbers. */
  private readonly starts: number[] = [];
  private readonly counts: number[] = [];
  private readonly players: Int32Array;
  private readonly grenades: GrenadeSnap[][] = [];
  private readonly cache = new Map<number, Snapshot>();

  constructor(packed: readonly number[]) {
    const all: number[] = [];
    const last = new Map<number, number[]>();
    let tick = 0;
    let i = 0;
    while (i < packed.length) {
      tick += packed[i++];
      const n = packed[i++];
      this.times.push(tick / SERVER_TICK_RATE);
      this.starts.push(all.length);
      this.counts.push(n);
      for (let k = 0; k < n; k++) {
        const id = packed[i++];
        const mask = packed[i++];
        let q = last.get(id);
        if (!q) last.set(id, (q = new Array<number>(FIELDS).fill(0)));
        for (let f = 0; f < FIELDS; f++) if (mask & (1 << f)) q[f] += packed[i++];
        all.push(id, ...q);
      }
      const g: GrenadeSnap[] = [];
      const ng = packed[i++];
      for (let k = 0; k < ng; k++, i += 4) g.push({ id: packed[i], x: packed[i + 1] / 100, y: packed[i + 2] / 100, z: packed[i + 3] / 100 });
      this.grenades.push(g);
    }
    this.players = Int32Array.from(all);
  }

  get length(): number {
    return this.times.length;
  }

  /** Frame `i` as a snapshot. */
  at(i: number): Snapshot {
    let s = this.cache.get(i);
    if (s) return s;
    const players: PlayerSnap[] = [];
    for (let k = 0, at = this.starts[i]; k < this.counts[i]; k++, at += FIELDS + 1) {
      players.push(unquantize(this.players[at], this.players, at + 1));
    }
    s = { time: this.times[i], players, grenades: this.grenades[i] };
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(i, s);
    return s;
  }

  /** The frames either side of server time `t`, oldest first, to blend between. */
  around(t: number): Snapshot[] {
    const times = this.times;
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    const out: Snapshot[] = [];
    if (lo > 0) out.push(this.at(lo - 1));
    if (lo < times.length) out.push(this.at(lo));
    return out;
  }
}

// -------------------------------------------------------------------- tape

/** Look angles in commands are whole steps of this many radians, so the tape stores them as small whole numbers. */
export const LOOK_STEP = 1e-5;

/** A look angle rounded to LOOK_STEP, as the client sends it. */
export function quantizeLook(a: number): number {
  return Math.round(a / LOOK_STEP) * LOOK_STEP;
}

/** PlayerState's fields in a fixed order, with the length of those that are lists. */
const STATE_FIELDS = Object.entries(copyState(spawnState(0, 0, 0))).map(([k, v]) => [k, Array.isArray(v) ? v.length : -1] as const);

interface PackedTape {
  /** Per key: its time in command steps, 1 if the server changed the player there, then the state's fields in order. */
  keys: number[][];
  /** Per command, each as the change from the one before: its time in command steps, and its seq. */
  at: number[];
  seq: number[];
  buttons: number[];
  /** Look in whole LOOK_STEPs, as changes, or as they are if any wasn't a whole step. */
  yaw: number[];
  pitch: number[];
  exact: boolean;
  /** The weapon wanted, or -1 for none. */
  weapon: number[];
}

function packKey(k: TapeKey): number[] {
  const out = [Math.round(k.at * CMD_RATE), k.changed ? 1 : 0];
  const s = k.state as unknown as Record<string, number | boolean | (number | boolean)[]>;
  for (const [name] of STATE_FIELDS) {
    const v = s[name];
    for (const e of Array.isArray(v) ? v : [v]) out.push(typeof e === 'boolean' ? +e : e);
  }
  return out;
}

function unpackKey(n: readonly number[]): TapeKey {
  const bools = spawnState(0, 0, 0) as unknown as Record<string, unknown>;
  const state: Record<string, unknown> = {};
  let i = 2;
  for (const [name, len] of STATE_FIELDS) {
    const kind = bools[name];
    const one = (v: number, like: unknown) => (typeof like === 'boolean' ? v !== 0 : v);
    if (len < 0) state[name] = one(n[i++], kind);
    else {
      state[name] = Array.from({ length: len }, (_, j) => one(n[i + j], (kind as unknown[])[j]));
      i += len;
    }
  }
  const key: TapeKey = { at: n[0] / CMD_RATE, state: state as unknown as PlayerState };
  if (n[1]) key.changed = true;
  return key;
}

function packTape(clip: TapeClip): PackedTape {
  const cmds = clip.cmds;
  const exact = cmds.every(({ cmd }) => quantizeLook(cmd.yaw) === cmd.yaw && quantizeLook(cmd.pitch) === cmd.pitch);
  const look = (v: number) => (exact ? Math.round(v / LOOK_STEP) : v);
  const deltas = (values: number[]) => (exact ? values.map((v, i) => v - (values[i - 1] ?? 0)) : values);
  const times = cmds.map((c) => Math.round(c.at * CMD_RATE));
  const seqs = cmds.map((c) => c.cmd.seq);
  return {
    // Only the keys the server changed the player at, and one every few seconds to seek by.
    keys: thinKeys(clip.keys).map(packKey),
    at: times.map((t, i) => t - (times[i - 1] ?? 0)),
    seq: seqs.map((s, i) => s - (seqs[i - 1] ?? 0)),
    buttons: cmds.map((c) => c.cmd.buttons),
    yaw: deltas(cmds.map((c) => look(c.cmd.yaw))),
    pitch: deltas(cmds.map((c) => look(c.cmd.pitch))),
    exact,
    weapon: cmds.map((c) => c.cmd.weapon ?? -1),
  };
}

/** Seconds between the keys kept that the server didn't change the player at. */
const SEEK_KEYS = 5;

function thinKeys(keys: readonly TapeKey[]): TapeKey[] {
  let last = -Infinity;
  return keys.filter((k, i) => {
    const keep = i === 0 || k.changed || k.at - last >= SEEK_KEYS;
    if (keep) last = k.at;
    return keep;
  });
}

function unpackTape(p: PackedTape): TapeClip {
  const sum = (values: readonly number[]) => {
    let acc = 0;
    return values.map((v) => (acc += v));
  };
  const at = sum(p.at);
  const seq = sum(p.seq);
  const yaw = p.exact ? sum(p.yaw).map((v) => v * LOOK_STEP) : p.yaw;
  const pitch = p.exact ? sum(p.pitch).map((v) => v * LOOK_STEP) : p.pitch;
  return {
    keys: p.keys.map(unpackKey),
    cmds: at.map((t, i) => {
      const cmd: InputCmd = { seq: seq[i], buttons: p.buttons[i], yaw: yaw[i], pitch: pitch[i] };
      if (p.weapon[i] >= 0) cmd.weapon = p.weapon[i];
      return { at: t / CMD_RATE, cmd };
    }),
  };
}

// -------------------------------------------------------------------- file

/** Fractions rounded to the centimetre and hundredth, deep, so events and views pack small. */
function rounded<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x: unknown) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 100) / 100 : x)));
}

/** A replay as a gzipped file. */
export async function encodeReplay(r: ReplayData): Promise<Uint8Array<ArrayBuffer>> {
  const text = JSON.stringify({ format: FORMAT, v: VERSION, ...r, tape: packTape(r.tape) });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A replay back from its file; throws with a message for the player if it isn't one. */
export async function decodeReplay(bytes: Uint8Array<ArrayBuffer>): Promise<ReplayData> {
  let text: string;
  try {
    // A gzip file starts 1f 8b; plain JSON is taken too.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else text = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('That file isn’t a replay.');
  }
  let raw: { format?: string; v?: number; tape?: PackedTape } & Omit<ReplayData, 'tape'>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a replay.');
  }
  if (raw.format !== FORMAT) throw new Error('That file isn’t a replay.');
  if (raw.v !== VERSION || !raw.tape) throw new Error('That replay is from another version of the game and can’t be played.');
  const { format: _f, v: _v, tape, ...rest } = raw;
  return { ...rest, tape: unpackTape(tape) };
}
