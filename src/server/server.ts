import { CARRY_MAX, CMD_DT, MAX_CMDS_PER_TICK, SERVER_TICK_RATE } from '../shared/constants.ts';
import { clamp } from '../shared/geom.ts';
import type { ClientMsg, InputCmd, ServerMsg } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { applyCmd, copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import { World } from '../shared/world.ts';

/** Commands buffered beyond this are dropped; the client is too far ahead. */
const MAX_QUEUED_CMDS = MAX_CMDS_PER_TICK * 4;

interface Player extends PlayerState {
  id: number;
  send: (msg: ServerMsg) => void;
  /** Set once the client says hello; until then it gets no snapshots. */
  joined: boolean;
  queue: InputCmd[];
  /** Highest seq received, to discard redundant resends. */
  lastRecv: number;
  /** Highest seq simulated, echoed back as the snapshot ack. */
  lastSim: number;
}

/**
 * The authoritative game. It knows nothing about Workers or sockets: a host
 * calls connect/receive/disconnect and drives tick() at SERVER_TICK_RATE.
 */
export class GameServer {
  readonly seed: number;
  readonly world: World;
  tick = 0;
  private readonly players = new Map<number, Player>();
  private readonly spawnRng: () => number;
  private nextId = 1;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.world = new World(this.seed);
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
  }

  connect(send: (msg: ServerMsg) => void): number {
    const id = this.nextId++;
    const { x, y, z } = this.world.randomLandPoint(this.spawnRng);
    this.players.set(id, { ...spawnState(x, y, z), id, send, joined: false, queue: [], lastRecv: 0, lastSim: 0 });
    return id;
  }

  disconnect(id: number): void {
    this.players.delete(id);
  }

  receive(id: number, msg: ClientMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'hello':
        p.joined = true;
        p.send({ t: 'welcome', id, seed: this.seed, tick: this.tick, tickRate: SERVER_TICK_RATE });
        break;
      case 'ping':
        p.send({ t: 'pong', time: msg.time });
        break;
      case 'input':
        if (!p.joined) break;
        for (const cmd of msg.cmds) {
          if (cmd.seq <= p.lastRecv) continue;
          p.lastRecv = cmd.seq;
          p.queue.push(cmd);
        }
        if (p.queue.length > MAX_QUEUED_CMDS) p.queue.splice(0, p.queue.length - MAX_QUEUED_CMDS);
        break;
      case 'debug':
        p.carry = clamp(msg.carry, 0, CARRY_MAX) || 0;
        break;
    }
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
      for (let i = 0; i < n; i++) {
        const cmd = p.queue[i];
        applyCmd(this.world, p, cmd, CMD_DT);
        p.lastSim = cmd.seq;
      }
      p.queue.splice(0, n);
    }

    const joined = [...this.players.values()].filter((p) => p.joined);
    const players = joined.map(({ id, x, y, z, yaw, duck, lean }) => ({ id, x, y, z, yaw, duck, lean }));
    for (const p of joined) {
      p.send({ t: 'snapshot', tick: this.tick, ack: p.lastSim, you: copyState(p), players });
    }
  }
}
