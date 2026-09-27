import type { GameLog } from '../shared/gamelog.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { GameServer, type ServerOptions } from './server.ts';

/**
 * A game run again from its log: a new server on the same seed and options,
 * told everything its humans did at the tick it heard it. The server is
 * deterministic, so it plays out exactly as it did, bots and all, as long as
 * this runs the same code in an engine that works out the maths the same.
 * What the server sends one of the humans, `watch`, goes to `onMsg`.
 */
export class Rerun {
  readonly server: GameServer;
  /** Cleared if the game went differently from the log: a human given another id than they had. */
  ok = true;
  private readonly log: GameLog;
  private readonly watch: number;
  private readonly onMsg: (msg: ServerMsg) => void;
  private next = 0;

  constructor(log: GameLog, watch: number, onMsg: (msg: ServerMsg) => void) {
    this.log = log;
    this.watch = watch;
    this.onMsg = onMsg;
    this.server = new GameServer(log.seed, log.options as ServerOptions);
  }

  /** Server time reached. */
  get time(): number {
    return this.server.time;
  }

  /** Run on one tick: what the humans did before it, then the tick. */
  step(): void {
    const { entries } = this.log;
    const server = this.server;
    while (this.next < entries.length && entries[this.next].tick <= server.tick) {
      const { id, msg } = entries[this.next++];
      if (msg.t === 'join') {
        let got = -1;
        got = server.connect((m) => {
          if (got === this.watch) this.onMsg(m);
        });
        if (got !== id) this.ok = false;
      } else if (msg.t === 'drop') server.disconnect(id);
      else server.receive(id, msg);
    }
    server.step();
  }
}
