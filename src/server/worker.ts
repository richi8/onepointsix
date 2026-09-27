/// <reference lib="webworker" />
// The local game host. Runs in a Web Worker so the page talks to it only
// through messages, exactly as it will talk to a remote server later.

import { SERVER_DT } from '../shared/constants.ts';
import { FixedLoop, runLoop } from '../shared/loop.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { Directory } from './directory.ts';
import type { GameServer } from './server.ts';

declare const self: DedicatedWorkerGlobalScope;

const directory = new Directory();
runLoop(new FixedLoop(SERVER_DT, () => directory.step()));

/** The game the page is playing in, and its player there. */
let current: { game: GameServer; id: number } | null = null;

self.onmessage = (e: MessageEvent<ClientMsg>) => {
  const msg = e.data;
  if (msg.t === 'pause') {
    if (current) directory.pause(current.game, msg.on);
    return;
  }
  // Leaving or starting another run lets a game held still go on.
  if (current && (msg.t === 'hello' || msg.t === 'leave')) directory.pause(current.game, false);
  if (msg.t === 'hello') {
    // Each hello is a quick join for a new run; leave the last game first.
    if (current) current.game.disconnect(current.id);
    const game = directory.quickJoin(msg.world, msg.mode);
    current = { game, id: game.connect((m: ServerMsg) => self.postMessage(m)) };
  }
  if (!current) return;
  // Shortcuts for browser tests, never in a build players get.
  if (msg.t === 'dev' && !import.meta.env.DEV) return;
  current.game.receive(current.id, msg);
  if (msg.t === 'leave') current = null;
};
