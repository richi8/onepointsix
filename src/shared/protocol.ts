// Messages that cross the client/server boundary. Today that boundary is a Web
// Worker; later it is a WebSocket. Everything here must survive structured
// cloning and JSON, so only plain data.

import type { GameLog } from './gamelog.ts';
import type { Zone } from './hitbox.ts';
import type { PlayerState } from './sim.ts';
import type { TapeClip } from './tape.ts';
import type { WorldConfig } from './worldconfig.ts';

/** One fixed CMD_DT step of player intent. Bots produce these too. */
export interface InputCmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  /** Weapon the player wants in hand, as an index into WEAPONS; omitted keeps the current one. */
  weapon?: number;
  /**
   * The server tick, fractional, that the client was showing other players at
   * when it sampled this command. The server rewinds them to it to judge shots.
   * Omitted means no rewind.
   */
  view?: number;
}

/**
 * How a game is played. Both are runs against guards and 8 operators; Online lets other players
 * take bot operators' places, Offline keeps them all bots.
 */
export type Mode = 'online' | 'offline';

/** A mode named in a link or saved setting; Mixed, from before, is now Online. */
export function parseMode(m: string | null): Mode | null {
  return m === 'online' || m === 'offline' ? m : m === 'mixed' ? 'online' : null;
}

/** Operators are players and fill bots, each on their own side; guards defend outposts together. */
export type Team = 'operator' | 'guard';

/** How a body is moving: on its feet, in the air or climbing onto a ledge. */
export type Motion = 'ground' | 'air' | 'mantle';

/** What a body's hands are busy with, besides holding the gun. */
export type Action = 'none' | 'reload' | 'draw' | 'throw';

export interface PlayerSnap {
  id: number;
  team: Team;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Where they look up or down, for drawing their aim. */
  pitch: number;
  /** 0 standing to 1 crouched. */
  duck: number;
  /** -1 leaning left to 1 leaning right. */
  lean: number;
  dead: boolean;
  /** Weapon in hand. */
  weapon: number;
  /** A suppressor is fitted to it. */
  quiet: boolean;
  motion: Motion;
  /** What the hands are doing, and how far through it, 0 to 1. */
  act: Action;
  actT: number;
  /** A commander, the target of a contract. */
  commander: boolean;
  /** Their flashlight is on. */
  light: boolean;
}

export type ContractKind = 'intel' | 'cache' | 'commander';

/** One of the recipient's contracts. */
export interface ContractView {
  kind: ContractKind;
  /** Index into World.outposts of the outpost it's at. */
  outpost: number;
  /** Where to go: the intel on the watchtower, the top of the cache, or the commander's outpost. */
  x: number;
  y: number;
  z: number;
  /** Added to the score if you get out with it done. */
  reward: number;
  /** Failed when someone else got there first, such as killing your commander. */
  state: 'open' | 'done' | 'failed';
  /** Intel: how far along grabbing it is, 0 to 1. */
  progress: number;
  /** Cache: its panel in the world, or -1. */
  panel: number;
  /** Commander: its name, or ''. */
  name: string;
}

/** The cover as it stands: the panels broken and the door leaves open. */
export interface CoverState {
  broken: number[];
  open: number[];
}

/** Something that happened during a server tick, sent reliably to whoever should hear. */
export type GameEvent =
  // To the shooter: their round hit `target` for `damage` at (x, y, z).
  | { k: 'hit'; target: number; zone: Zone; damage: number; killed: boolean; x: number; y: number; z: number }
  // To the victim: they took `damage` from a shooter at (x, z).
  | { k: 'hurt'; damage: number; x: number; z: number }
  // To everyone.
  | {
      k: 'kill'; killer: number; victim: number; killerName: string; victimName: string; weapon: number; head: boolean;
      /** The victim carried the bounty. */
      bounty?: boolean;
      /**
       * Where the victim stood (feet), faced and how crouched, where the killing
       * round or blast struck, and the way it travelled, all to the centimetre.
       * Bodies fall from these alone, so a replay falls the same.
       */
      pose: [x: number, y: number, z: number, yaw: number, duck: number];
      at: [x: number, y: number, z: number];
      dir: [x: number, y: number, z: number];
    }
  // To everyone: `id` now carries the bounty, loot worth `value`, or with id 0, nobody does.
  | { k: 'bounty'; id: number; name: string; value: number }
  // To everyone: an operator left the island with loot worth `value`.
  | { k: 'extract'; id: number; name: string; value: number }
  // To everyone: someone called in a pickup at extraction point `index`.
  | { k: 'call'; id: number; index: number; name: string }
  // To the taker: they took an item from a container.
  | { k: 'took'; item: number }
  // To the player: their run is over.
  | {
      k: 'runEnd'; outcome: 'extracted' | 'killed' | 'mia';
      /** Zero unless extracted. */
      score: number;
      /** What the loot carried was worth, and the items. */
      value: number; items: number[];
      kills: number; guardKills: number;
      /** How the run's contracts ended up; the done ones are paid if extracted. */
      contracts: ContractView[];
      /** Seconds the run lasted. */
      time: number;
      killer: string;
      /** Extraction point got out at, or -1. */
      extract: number;
      /** How they died, if killed: by whom (their side, or themselves), with what weapon, and whether in the head. */
      death: { by: Team | 'self'; weapon: number; head: boolean } | null;
    }
  // To a player killed by someone else, a moment after: their killer's inputs
  // around the kill at server time `time`, to replay from the killer's eyes.
  | { k: 'deathcam'; killer: number; name: string; time: number; clip: TapeClip }
  // To the player as their run ends: their own inputs for all of it, to replay the run, and
  // the game's log so far to run all of it again, unless the game is too old for that.
  | { k: 'tape'; clip: TapeClip; log?: GameLog }
  // To the player: one of their contracts, by index, was done or failed.
  | { k: 'contract'; index: number; state: 'done' | 'failed' }
  // To everyone: panels broke, knocked from around (x, y, z).
  | { k: 'break'; panels: number[]; x: number; y: number; z: number }
  // To everyone: broken panels were rebuilt.
  | { k: 'repair'; panels: number[] }
  // To everyone: door leaves were opened or shut, in the doorway at (x, y, z).
  | { k: 'door'; doors: number[]; open: boolean; x: number; y: number; z: number }
  // To everyone: a grenade went off.
  | { k: 'boom'; x: number; y: number; z: number }
  // To everyone but the shooter, who predicted it: a round from (ox, oy, oz) that stopped at (ex, ey, ez).
  | {
      k: 'shot'; id: number; weapon: number;
      ox: number; oy: number; oz: number; ex: number; ey: number; ez: number;
      /** What it stopped in: a body, the world, or nothing within range. */
      struck: 'body' | 'world' | 'none';
      /** Fired through a suppressor. */
      quiet: boolean;
    };

export type ClientMsg =
  // `world` is the island the client wants to join; the server may ignore it.
  // Quick join: the client wants to play `mode` on this island. Sent again for another run.
  | { t: 'hello'; name: string; world: WorldConfig; mode: Mode }
  // Back to the menu.
  | { t: 'leave' }
  // Carries the last few unacknowledged commands so a lost packet costs nothing.
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'ping'; time: number }
  // Offline only: hold the game still, as while its player watches their replay. The local host
  // does this, not the game, so it isn't one of the things the game logs.
  | { t: 'pause'; on: boolean }
  // A test or the console changing the run on the spot. Only the local host in a
  // development build passes it on; a real server must drop it.
  | { t: 'dev'; cmd: DevCmd };

/**
 * Development shortcuts for browser tests. The rival is the nearest living
 * operator bot: `rival` brings it a few metres in front of you, `kill` has you
 * kill it, and `give` puts items in your pack or its. `end` ends your run now,
 * `killed` meaning by the rival, or with `self` (or no rival) by your own grenade.
 */
export type DevCmd =
  | { act: 'end'; outcome: 'extracted' | 'killed' | 'mia'; self?: boolean }
  | { act: 'give'; items: number[]; rival?: boolean }
  | { act: 'rival' }
  | { act: 'kill' };

/** An extraction point, as everyone sees it. Where it is comes from the world. */
export interface ExtractView {
  open: boolean;
  /** Seconds until it opens or closes. */
  next: number;
  /** Seconds until a called pickup lands, or -1. */
  call: number;
}

/** A container the player is facing within reach. */
export interface LootView {
  id: number;
  kind: 'crate' | 'bag';
  searched: boolean;
  /** How far along the player's search is, 0 to 1. */
  progress: number;
  /** What's inside, in the order it will be taken; empty until searched. */
  items: number[];
}

/** The recipient's own run. */
export interface RunView {
  /** Seconds left on the run clock. */
  time: number;
  /** Carried loot, in the order taken. */
  items: number[];
  kills: number;
  guardKills: number;
  loot: LootView | null;
  /** Extraction point the player stands in, or -1, and seconds held there. */
  zone: number;
  hold: number;
  contracts: ContractView[];
  /** The intel contract, by index, that the player is facing within reach, or -1. */
  intel: number;
}

/** A live grenade. */
export interface GrenadeSnap {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** A bag on the ground, left by a body or dropped. */
export interface BagSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  /** What the loot in it is worth; missing in replays from before it was sent. */
  value?: number;
}

/** The bounty: who carries the most loot, and roughly where they were last called. */
export interface BountyView {
  id: number;
  name: string;
  /** What they carry now. */
  value: number;
  /** Where they were called, give or take BOUNTY_FUZZ, and the server time of the call. */
  x: number;
  z: number;
  at: number;
}

export type ServerMsg =
  // `broken` lists the panels down right now; the client's world starts from it.
  | { t: 'welcome'; id: number; seed: number; tick: number; tickRate: number; mode: Mode; broken: number[]; open: number[] }
  // `ack` is the highest command seq the server has simulated for the recipient,
  // and `you` its full movement state right after that command, which the
  // client replays its unacknowledged commands on top of.
  // `run` is null until the player's run is set up.
  | {
      t: 'snapshot'; tick: number; ack: number; you: PlayerState; players: PlayerSnap[];
      run: RunView | null; extracts: ExtractView[]; bags: BagSnap[]; grenades: GrenadeSnap[];
      /** Null while nobody carries enough to be the bounty. */
      bounty: BountyView | null;
    }
  | { t: 'events'; tick: number; events: GameEvent[] }
  | { t: 'pong'; time: number };

/**
 * Unreliable messages may be dropped or reordered in transit, like UDP. The
 * protocol is built so that losing them is harmless: inputs are sent
 * redundantly and snapshots are superseded by the next one.
 */
export function isReliable(msg: ClientMsg | ServerMsg): boolean {
  return msg.t !== 'input' && msg.t !== 'snapshot';
}
