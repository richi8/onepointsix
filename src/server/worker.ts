/// <reference lib="webworker" />
// The local game server. Runs in a Web Worker so the page talks to it only
// through messages, exactly as it will talk to a remote server later.

import { SERVER_DT } from '../shared/constants.ts';
import { FixedLoop, runLoop } from '../shared/loop.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { GameServer } from './server.ts';

declare const self: DedicatedWorkerGlobalScope;

// There is one local game, created for whichever world the first hello asks
// for. Chunk 6 replaces this with a game directory that quick join searches.
let server: GameServer | null = null;
let id = 0;

self.onmessage = (e: MessageEvent<ClientMsg>) => {
  const msg = e.data;
  if (!server) {
    if (msg.t !== 'hello') return;
    const game = new GameServer(msg.world.seed);
    id = game.connect((m: ServerMsg) => self.postMessage(m));
    runLoop(new FixedLoop(SERVER_DT, () => game.step()));
    server = game;
  }
  server.receive(id, msg);
};
