// Runs the game server in Node with a scripted client, to prove the server has
// no browser dependencies. Usage: npm run sim

import { Btn, CMDS_PER_TICK, SERVER_TICK_RATE } from '../shared/constants.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';
import { GameServer } from './server.ts';

const SECONDS = 5;
const server = new GameServer(DEFAULT_WORLD.seed);
let last: ServerMsg | null = null;
const id = server.connect((msg) => (last = msg));
server.receive(id, { t: 'hello', name: 'headless', world: DEFAULT_WORLD });

let seq = 0;
const ticks = SECONDS * SERVER_TICK_RATE;
for (let tick = 0; tick < ticks; tick++) {
  const cmds = [];
  for (let i = 0; i < CMDS_PER_TICK; i++) {
    const turning = tick > ticks / 2;
    cmds.push({ seq: ++seq, buttons: Btn.Forward | (turning ? Btn.Right : 0), yaw: 0, pitch: 0 });
  }
  server.receive(id, { t: 'input', cmds });
  server.step();
}

console.log(`simulated ${server.tick} ticks`);
console.log(JSON.stringify(last));
