/// <reference lib="webworker" />
// The local game server. Runs in a Web Worker so the page talks to it only
// through messages, exactly as it will talk to a remote server later.

import { DEFAULT_SEED, SERVER_DT } from '../shared/constants.ts';
import { FixedLoop, runLoop } from '../shared/loop.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { GameServer } from './server.ts';

declare const self: DedicatedWorkerGlobalScope;

const server = new GameServer(DEFAULT_SEED);
const id = server.connect((msg: ServerMsg) => self.postMessage(msg));

self.onmessage = (e: MessageEvent<ClientMsg>) => server.receive(id, e.data);

runLoop(new FixedLoop(SERVER_DT, () => server.step()));
