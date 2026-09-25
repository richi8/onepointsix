// Messages that cross the client/server boundary. Today that boundary is a Web
// Worker; later it is a WebSocket. Everything here must survive structured
// cloning and JSON, so only plain data.

import type { Zone } from './hitbox.ts';
import type { PlayerState } from './sim.ts';
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

/** How a game is played: runs against bots and other operators, runs against guards alone, or practice on the range. */
export type Mode = 'mixed' | 'pve' | 'range';

/** Operators are players and fill bots, each on their own side; guards defend outposts together; dummies stand on the range. */
export type Team = 'operator' | 'guard' | 'dummy';

export interface PlayerSnap {
  id: number;
  team: Team;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 0 standing to 1 crouched. */
  duck: number;
  /** -1 leaning left to 1 leaning right. */
  lean: number;
  dead: boolean;
  /** Weapon in hand. */
  weapon: number;
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

/** Something that happened during a server tick, sent reliably to whoever should hear. */
export type GameEvent =
  // To the shooter: their round hit `target` for `damage` at (x, y, z).
  | { k: 'hit'; target: number; zone: Zone; damage: number; killed: boolean; x: number; y: number; z: number }
  // To the victim: they took `damage` from a shooter at (x, z).
  | { k: 'hurt'; damage: number; x: number; z: number }
  // To everyone.
  | { k: 'kill'; killer: number; victim: number; killerName: string; victimName: string; weapon: number; head: boolean }
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
    }
  // To the player: one of their contracts, by index, was done or failed.
  | { k: 'contract'; index: number; state: 'done' | 'failed' }
  // To everyone: panels broke, knocked from around (x, y, z).
  | { k: 'break'; panels: number[]; x: number; y: number; z: number }
  // To everyone: broken panels were rebuilt.
  | { k: 'repair'; panels: number[] }
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
  | { t: 'ping'; time: number };

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
}

export type ServerMsg =
  // `broken` lists the panels down right now; the client's world starts from it.
  | { t: 'welcome'; id: number; seed: number; tick: number; tickRate: number; mode: Mode; broken: number[] }
  // `ack` is the highest command seq the server has simulated for the recipient,
  // and `you` its full movement state right after that command, which the
  // client replays its unacknowledged commands on top of.
  // `run` is null outside runs, such as on the range.
  | {
      t: 'snapshot'; tick: number; ack: number; you: PlayerState; players: PlayerSnap[];
      run: RunView | null; extracts: ExtractView[]; bags: BagSnap[]; grenades: GrenadeSnap[];
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
