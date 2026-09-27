import { ByteReader, ByteWriter } from '../shared/bytes.ts';
import { CMD_RATE, SERVER_TICK_RATE } from '../shared/constants.ts';
import { readLog, writeLog, type GameLog, LOOK_STEP, quantizeLook } from '../shared/gamelog.ts';
import { wrapAngle } from '../shared/geom.ts';
import type {
  Action, BagSnap, BountyView, CoverState, ExtractView, GameEvent, GrenadeSnap, InputCmd, Mode, Motion, PlayerSnap, RunView,
} from '../shared/protocol.ts';
import { copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import type { TapeClip, TapeKey } from '../shared/tape.ts';
import type { WorldConfig } from '../shared/worldconfig.ts';
import type { Snapshot } from './connection.ts';

/** What a replay file says it is, and the layout it's in. */
const FORMAT = 'onepointsix-replay';
/** The first bytes of a replay file, once unpacked. Files before version 3 were JSON. */
const MAGIC = [0x4f, 0x50, 0x53, 0x36];
/**
 * 2 since chunk 23: the buildings changed, and door leaves open and shut.
 * 3 since chunk 28: packed as bytes, with the game's log and the bounty.
 */
const VERSION = 3;
/** Seconds between the frames of everyone else kept; snapshots in between are dropped. */
const FRAME_DT = 1 / 10;
/** Bodies farther than this from the player are kept only every FAR_EVERY frames, unless something about them changed. */
const NEAR = 80;
const FAR_EVERY = 5;

export { quantizeLook };

export type RunEnd = Extract<GameEvent, { k: 'runEnd' }>;

/** Something that happened, and the server time it reached the player. */
export type Timed<T> = [at: number, value: T];

/** A whole run as its player saw it, to watch again. It's saved as packed bytes, gzipped. */
export interface ReplayData {
  world: WorldConfig;
  mode: Mode;
  /** The player, and their id in the game. */
  name: string;
  id: number;
  /** The browser it was played in, as a random id, so it's "you" there and the player's name anywhere else. */
  owner: string;
  /** When it was played, as an ISO date and time. */
  date: string;
  /** The build of the game it was played on, as a hash of the simulation's code. */
  build: string;
  /** How the run ended. */
  end: RunEnd;
  /** Server seconds the replay runs from and to. */
  from: number;
  to: number;
  /** Panels down and door leaves open at the start. */
  broken: number[];
  open: number[];
  /** The player's own inputs, rebuilt exactly through the simulation. */
  tape: TapeClip;
  /** Everyone else, and grenades, packed by FramePacker. */
  frames: number[];
  /** The player's run, the extraction points and the bags on the ground, each whenever it changed. */
  runs: Timed<RunView>[];
  extracts: Timed<ExtractView[]>[];
  bags: Timed<BagSnap[]>[];
  /** Who carried the bounty and where they were called, whenever it changed. */
  bounty: Timed<BountyView | null>[];
  /** Every event the player was sent, but for the run's end and the replays. */
  events: Timed<GameEvent>[];
  /** The whole game from its start, to run it again and show everyone exactly; missing if it had run too long before. */
  log?: GameLog;
}

/**
 * Records a run as the client sees it, for a replay: every event, the
 * snapshots of everyone else, and at the end the player's own inputs and the
 * game's log from the server. It packs as it goes, so a ten-minute run stays small.
 */
export class RunRecorder {
  private readonly world: WorldConfig;
  private readonly mode: Mode;
  private readonly name: string;
  private readonly owner: string;
  private readonly build: string;
  private readonly date = new Date().toISOString();
  private id = 0;
  private cover: CoverState = { broken: [], open: [] };
  private readonly frames = new FramePacker();
  private lastFrame = -Infinity;
  private readonly runs: Timed<RunView>[] = [];
  private readonly extracts: Timed<ExtractView[]>[] = [];
  private readonly bags: Timed<BagSnap[]>[] = [];
  private readonly bounty: Timed<BountyView | null>[] = [];
  private readonly events: Timed<GameEvent>[] = [];
  private shown = { run: '', extracts: '', bags: '', bounty: '' };
  private tape: TapeClip | null = null;
  private log: GameLog | undefined;
  private end: RunEnd | null = null;
  private endAt = 0;
  private lastAt = 0;

  constructor(world: WorldConfig, mode: Mode, name: string, owner: string, build: string) {
    this.world = world;
    this.mode = mode;
    this.name = name;
    this.owner = owner;
    this.build = build;
  }

  /** Joined as `id`, with the cover standing as it does. */
  welcome(id: number, cover: CoverState): void {
    this.id = id;
    this.cover = { broken: [...cover.broken], open: [...cover.open] };
  }

  snapshot(
    time: number, players: readonly PlayerSnap[], grenades: readonly GrenadeSnap[], run: RunView | null, extracts: readonly ExtractView[],
    bags: readonly BagSnap[], bounty: BountyView | null = null,
  ): void {
    this.lastAt = time;
    if (time - this.lastFrame >= FRAME_DT - 1e-6) {
      this.lastFrame = time;
      const me = players.find((p) => p.id === this.id);
      this.frames.push(time, players, grenades, me ? (p) => Math.hypot(p.x - me.x, p.z - me.z) <= NEAR : () => true);
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
    if (e.k === 'tape') {
      this.tape = e.clip;
      this.log = e.log;
    } else if (e.k === 'runEnd') {
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
    const data: ReplayData = {
      world: { ...this.world }, mode: this.mode, name: this.name, id: this.id, owner: this.owner, date: this.date, build: this.build,
      end: this.end, from, to, broken: [...this.cover.broken], open: [...this.cover.open], tape: this.tape, frames: this.frames.data(),
      runs: [...this.runs], extracts: [...this.extracts], bags: [...this.bags], bounty: [...this.bounty], events: this.events.filter(([at]) => at <= to),
    };
    if (this.log) data.log = this.log;
    return data;
  }
}

// ------------------------------------------------------------------ frames

const MOTIONS: readonly Motion[] = ['ground', 'air', 'mantle'];
const ACTIONS: readonly Action[] = ['none', 'reload', 'draw', 'throw'];
/** Whole numbers stored for each player in a frame: centimetres, milliradians, hundredths, and flags. */
export const FIELDS = 9;
/** Where the flags are among them. */
const FLAGS = 8;
/** A turn in milliradians, as yaw is stored. */
const TURN = Math.round(2 * Math.PI * 1000);

/** A player's snapshot as FIELDS whole numbers. */
export function quantize(p: PlayerSnap, out: number[]): void {
  out[0] = Math.round(p.x * 100);
  out[1] = Math.round(p.y * 100);
  out[2] = Math.round(p.z * 100);
  out[3] = Math.round(wrapAngle(p.yaw) * 1000);
  out[4] = Math.round(p.pitch * 1000);
  out[5] = Math.round(p.duck * 100);
  out[6] = Math.round(p.lean * 100);
  out[7] = Math.round(p.actT * 100);
  out[FLAGS] = (p.team === 'guard' ? 1 : 0) | (+p.dead << 1) | (+p.quiet << 2) | (+p.commander << 3) | (+p.light << 4) |
    (MOTIONS.indexOf(p.motion) << 5) | (ACTIONS.indexOf(p.act) << 7) | (p.weapon << 9);
}

function unquantize(id: number, q: ArrayLike<number>, at: number): PlayerSnap {
  const f = q[at + FLAGS];
  return {
    id, team: f & 1 ? 'guard' : 'operator',
    x: q[at] / 100, y: q[at + 1] / 100, z: q[at + 2] / 100, yaw: q[at + 3] / 1000, pitch: q[at + 4] / 1000,
    duck: q[at + 5] / 100, lean: q[at + 6] / 100, actT: q[at + 7] / 100,
    dead: !!(f & 2), quiet: !!(f & 4), commander: !!(f & 8), light: !!(f & 16),
    motion: MOTIONS[(f >> 5) & 3] ?? 'ground', act: ACTIONS[(f >> 7) & 3], weapon: f >> 9,
  };
}

/**
 * Packs frames of everyone into whole numbers. A frame is: ticks since the
 * last; who came (their ids) and who went since; then the players sampled in
 * it, each as its id, a mask of the fields changed since its last sample and
 * those changes; then the grenades, each its id and position in cm. Bodies
 * near the player are sampled every frame, those far off only every few,
 * unless their flags changed (they died, fired, switched guns); anyone not
 * sampled is filled in between their samples when read.
 */
export class FramePacker {
  private readonly out: number[] = [];
  private readonly last = new Map<number, number[]>();
  /** Frames since each player was last sampled. */
  private readonly since = new Map<number, number>();
  private present: number[] = [];
  private tick = 0;
  private readonly q: number[] = [];

  push(time: number, players: readonly PlayerSnap[], grenades: readonly GrenadeSnap[], near: (p: PlayerSnap) => boolean = () => true): void {
    const tick = Math.round(time * SERVER_TICK_RATE);
    const out = this.out;
    out.push(tick - this.tick);
    this.tick = tick;
    const ids = new Set(players.map((p) => p.id));
    const was = new Set(this.present);
    const came = players.filter((p) => !was.has(p.id)).map((p) => p.id);
    const went = this.present.filter((id) => !ids.has(id));
    out.push(came.length, ...came, went.length, ...went);
    for (const id of went) {
      this.last.delete(id);
      this.since.delete(id);
    }
    this.present = players.map((p) => p.id);
    const countAt = out.length;
    out.push(0);
    let count = 0;
    for (const p of players) {
      quantize(p, this.q);
      let before = this.last.get(p.id);
      const since = (this.since.get(p.id) ?? FAR_EVERY) + 1;
      if (before && since < FAR_EVERY && before[FLAGS] === this.q[FLAGS] && !near(p)) {
        this.since.set(p.id, since);
        continue;
      }
      this.since.set(p.id, 0);
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
      count++;
    }
    out[countAt] = count;
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
  /** Each frame's players that were really sampled, not filled in. */
  private readonly sampledIds: number[][] = [];
  private readonly grenades: GrenadeSnap[][] = [];
  private readonly cache = new Map<number, Snapshot>();

  constructor(packed: readonly number[]) {
    /** Each frame's players in order, and each player's samples as [frame, fields]. */
    const present: number[][] = [];
    const samples = new Map<number, { frame: number[]; q: number[][] }>();
    const last = new Map<number, number[]>();
    let ids: number[] = [];
    let tick = 0;
    let i = 0;
    while (i < packed.length) {
      const frame = this.times.length;
      tick += packed[i++];
      this.times.push(tick / SERVER_TICK_RATE);
      const came = packed.slice(i + 1, i + 1 + packed[i]);
      i += 1 + came.length;
      const went = new Set(packed.slice(i + 1, i + 1 + packed[i]));
      i += 1 + went.size;
      for (const id of went) last.delete(id);
      ids = [...ids.filter((id) => !went.has(id)), ...came];
      present.push(ids);
      const sampled: number[] = [];
      for (let n = packed[i++]; n > 0; n--) {
        const id = packed[i++];
        const mask = packed[i++];
        let q = last.get(id);
        if (!q) last.set(id, (q = new Array<number>(FIELDS).fill(0)));
        for (let f = 0; f < FIELDS; f++) if (mask & (1 << f)) q[f] += packed[i++];
        let s = samples.get(id);
        if (!s) samples.set(id, (s = { frame: [], q: [] }));
        s.frame.push(frame);
        s.q.push([...q]);
        sampled.push(id);
      }
      this.sampledIds.push(sampled);
      const g: GrenadeSnap[] = [];
      const ng = packed[i++];
      for (let k = 0; k < ng; k++, i += 4) g.push({ id: packed[i], x: packed[i + 1] / 100, y: packed[i + 2] / 100, z: packed[i + 3] / 100 });
      this.grenades.push(g);
    }
    // Everyone in every frame, filled in between samples where they weren't sampled.
    const all: number[] = [];
    const next = new Map<number, number>();
    const q = new Array<number>(FIELDS);
    present.forEach((ids, frame) => {
      this.starts.push(all.length);
      this.counts.push(ids.length);
      for (const id of ids) {
        const s = samples.get(id)!;
        let k = next.get(id) ?? 0;
        while (k + 1 < s.frame.length && s.frame[k + 1] <= frame) k++;
        next.set(id, k);
        const a = s.q[k];
        const b = s.q[k + 1];
        if (s.frame[k] === frame || !b) all.push(id, ...a);
        else {
          const f = (this.times[frame] - this.times[s.frame[k]]) / (this.times[s.frame[k + 1]] - this.times[s.frame[k]]);
          for (let n = 0; n < FIELDS; n++) q[n] = Math.round(a[n] + (b[n] - a[n]) * f);
          let turn = b[3] - a[3];
          if (turn > TURN / 2) turn -= TURN;
          if (turn < -TURN / 2) turn += TURN;
          q[3] = Math.round(a[3] + turn * f);
          q[FLAGS] = a[FLAGS];
          all.push(id, ...q);
        }
      }
    });
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

  /** Frame `i`'s players as FIELDS whole numbers each, by id, and which of them were really sampled. */
  quantized(i: number): { ids: number[]; sampled: number[]; q: Map<number, number[]> } {
    const q = new Map<number, number[]>();
    const ids: number[] = [];
    for (let k = 0, at = this.starts[i]; k < this.counts[i]; k++, at += FIELDS + 1) {
      ids.push(this.players[at]);
      q.set(this.players[at], Array.from(this.players.subarray(at + 1, at + 1 + FIELDS)));
    }
    return { ids, sampled: this.sampledIds[i], q };
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

/** PlayerState's fields in a fixed order, with the length of those that are lists. */
const STATE_FIELDS = Object.entries(copyState(spawnState(0, 0, 0))).map(([k, v]) => [k, Array.isArray(v) ? v.length : -1] as const);

/** A number kept exactly: a whole one as a small integer, anything else as a float. */
function writeNumber(w: ByteWriter, v: number): void {
  if (Number.isSafeInteger(v) && Math.abs(v) < 2 ** 40) w.uint(1 + (v < 0 ? -2 * v - 1 : 2 * v));
  else {
    w.uint(0);
    w.float(v);
  }
}

function readNumber(r: ByteReader): number {
  const tag = r.uint();
  if (tag === 0) return r.float();
  const u = tag - 1;
  return u % 2 ? -(u + 1) / 2 : u / 2;
}

function writeKey(w: ByteWriter, k: TapeKey): void {
  w.uint(Math.round(k.at * CMD_RATE));
  w.uint(k.changed ? 1 : 0);
  const s = k.state as unknown as Record<string, number | boolean | (number | boolean)[]>;
  for (const [name] of STATE_FIELDS) {
    const v = s[name];
    for (const e of Array.isArray(v) ? v : [v]) writeNumber(w, typeof e === 'boolean' ? +e : e);
  }
}

function readKey(r: ByteReader): TapeKey {
  const like = spawnState(0, 0, 0) as unknown as Record<string, unknown>;
  const at = r.uint() / CMD_RATE;
  const changed = r.uint() === 1;
  const state: Record<string, unknown> = {};
  const one = (v: number, kind: unknown) => (typeof kind === 'boolean' ? v !== 0 : v);
  for (const [name, len] of STATE_FIELDS) {
    const kind = like[name];
    if (len < 0) state[name] = one(readNumber(r), kind);
    else state[name] = Array.from({ length: len }, (_, j) => one(readNumber(r), (kind as unknown[])[j]));
  }
  const key: TapeKey = { at, state: state as unknown as PlayerState };
  if (changed) key.changed = true;
  return key;
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

/**
 * The player's tape: only the keys the server changed them at and one every
 * few seconds to seek by; each command as changes from the one before, look
 * in whole LOOK_STEPs, or as floats if any wasn't a whole step.
 */
function writeTape(w: ByteWriter, clip: TapeClip): void {
  const keys = thinKeys(clip.keys);
  w.uint(keys.length);
  for (const k of keys) writeKey(w, k);
  const cmds = clip.cmds;
  const exact = cmds.every(({ cmd }) => quantizeLook(cmd.yaw) === cmd.yaw && quantizeLook(cmd.pitch) === cmd.pitch);
  const deltas = (values: number[]) => values.map((v, i) => v - (values[i - 1] ?? 0));
  const times = cmds.map((c) => Math.round(c.at * CMD_RATE));
  w.ints(deltas(times));
  w.ints(deltas(cmds.map((c) => c.cmd.seq)));
  w.ints(cmds.map((c) => c.cmd.buttons));
  w.ints(cmds.map((c) => c.cmd.weapon ?? -1));
  w.uint(exact ? 1 : 0);
  if (exact) {
    w.ints(deltas(cmds.map((c) => Math.round(c.cmd.yaw / LOOK_STEP))));
    w.ints(deltas(cmds.map((c) => Math.round(c.cmd.pitch / LOOK_STEP))));
  } else {
    w.floats(cmds.map((c) => c.cmd.yaw));
    w.floats(cmds.map((c) => c.cmd.pitch));
  }
}

function readTape(r: ByteReader): TapeClip {
  const keys: TapeKey[] = [];
  for (let n = r.uint(); n > 0; n--) keys.push(readKey(r));
  const sum = (values: readonly number[]) => {
    let acc = 0;
    return values.map((v) => (acc += v));
  };
  const at = sum(r.ints());
  const seq = sum(r.ints());
  const buttons = r.ints();
  const weapon = r.ints();
  const exact = r.uint() === 1;
  const yaw = exact ? sum(r.ints()).map((v) => v * LOOK_STEP) : r.floats();
  const pitch = exact ? sum(r.ints()).map((v) => v * LOOK_STEP) : r.floats();
  return {
    keys,
    cmds: at.map((t, i) => {
      const cmd: InputCmd = { seq: seq[i], buttons: buttons[i], yaw: yaw[i], pitch: pitch[i] };
      if (weapon[i] >= 0) cmd.weapon = weapon[i];
      return { at: t / CMD_RATE, cmd };
    }),
  };
}

// -------------------------------------------------------------------- file

/** Fractions rounded to the centimetre and hundredth, deep, so events and views pack small. */
function rounded<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x: unknown) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 100) / 100 : x)));
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, through: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A replay as a file: the magic bytes and version, what's small as JSON, then
 * the frames, the player's tape and the game's log packed as bytes, all gzipped.
 */
export async function encodeReplay(r: ReplayData): Promise<Uint8Array<ArrayBuffer>> {
  const w = new ByteWriter();
  w.bytes(Uint8Array.from(MAGIC));
  w.uint(VERSION);
  const { tape, frames, log, ...meta } = r;
  w.text(JSON.stringify(meta));
  w.ints(frames);
  writeTape(w, tape);
  w.uint(log ? 1 : 0);
  // The player's own commands are on their tape already.
  if (log) writeLog(w, log, { id: r.id, cmds: tape.cmds.map((c) => c.cmd) });
  return pipe(w.data(), new CompressionStream('gzip'));
}

const NOT_A_REPLAY = 'That file isn’t a replay.';
const OTHER_VERSION = 'That replay is from another version of the game and can’t be played.';

/** A replay back from its file; throws with a message for the player if it isn't one. */
export async function decodeReplay(bytes: Uint8Array<ArrayBuffer>): Promise<ReplayData> {
  let raw: Uint8Array;
  try {
    // A gzip file starts 1f 8b; one unpacked is taken too.
    raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  } catch {
    throw new Error(NOT_A_REPLAY);
  }
  if (!MAGIC.every((b, i) => raw[i] === b)) {
    // Files before version 3 were JSON.
    let old: { format?: string } | null = null;
    try {
      old = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      // Neither.
    }
    throw new Error(old?.format === FORMAT ? OTHER_VERSION : NOT_A_REPLAY);
  }
  try {
    const r = new ByteReader(raw.subarray(MAGIC.length));
    if (r.uint() !== VERSION) throw new Error(OTHER_VERSION);
    const meta = JSON.parse(r.text()) as Omit<ReplayData, 'tape' | 'frames' | 'log'>;
    const frames = r.ints();
    const tape = readTape(r);
    const data: ReplayData = { ...meta, frames, tape };
    if (r.uint() === 1) data.log = readLog(r, { id: data.id, cmds: tape.cmds.map((c) => c.cmd) });
    return data;
  } catch (err) {
    throw err instanceof Error && err.message === OTHER_VERSION ? err : new Error(NOT_A_REPLAY);
  }
}
