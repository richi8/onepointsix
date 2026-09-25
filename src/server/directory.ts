import { OPERATOR_CAPACITY, SERVER_DT } from '../shared/constants.ts';
import type { Mode } from '../shared/protocol.ts';
import { sameWorld, type WorldConfig } from '../shared/worldconfig.ts';
import { GameServer, type ServerOptions } from './server.ts';

/** How each mode sets up a game, and how many humans fit in one. */
export const MODES: Record<Mode, { options: ServerOptions; capacity: number }> = {
  // Every operator slot starts as a bot; humans take them over.
  mixed: { options: { mode: 'mixed', dummies: false, guards: true, operators: OPERATOR_CAPACITY, runs: true }, capacity: OPERATOR_CAPACITY },
  // You against the guards, alone on the island.
  pve: { options: { mode: 'pve', dummies: false, guards: true, operators: 0, runs: true }, capacity: 1 },
  // Target practice: respawning, no runs.
  range: { options: { mode: 'range', dummies: true }, capacity: OPERATOR_CAPACITY },
};

/** Seconds a game with nobody in it is kept, so another run can join the same island state. */
const IDLE_TIME = 120;

interface Entry {
  world: WorldConfig;
  mode: Mode;
  server: GameServer;
  /** Seconds it has had no humans. */
  idle: number;
}

/**
 * Every game this host runs. Quick join puts a player in the first game on
 * their island, in its conditions and mode, that isn't full, or starts a new one. Locally there is
 * one player, so this is one game; a multiplayer host runs many.
 */
export class Directory {
  private readonly games: Entry[] = [];

  quickJoin(world: WorldConfig, mode: Mode): GameServer {
    const { options, capacity } = MODES[mode];
    const found = this.games.find((g) => sameWorld(g.world, world) && g.mode === mode && g.server.humans() < capacity);
    if (found) return found.server;
    const { time, weather } = world;
    const server = new GameServer(world.seed, { ...options, conditions: { time, weather } });
    this.games.push({ world: { seed: server.seed, time, weather }, mode, server, idle: 0 });
    return server;
  }

  /** Step every game once, and close those that have stood empty too long. */
  step(): void {
    for (let i = this.games.length - 1; i >= 0; i--) {
      const g = this.games[i];
      g.server.step();
      g.idle = g.server.humans() > 0 ? 0 : g.idle + SERVER_DT;
      if (g.idle > IDLE_TIME) this.games.splice(i, 1);
    }
  }

  get count(): number {
    return this.games.length;
  }
}
