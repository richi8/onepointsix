import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMDS_PER_TICK, EYE_HEIGHT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { inBuilding, type World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

function client(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `p${id}`, world: DEFAULT_WORLD, mode: 'offline' });
  let seq = 0;
  let yaw = 0;
  let pitch = 0;
  return {
    id,
    events: (): GameEvent[] => inbox.flatMap((m) => (m.t === 'events' ? m.events : [])),
    send(buttons: number) {
      const cmds = [];
      for (let i = 0; i < CMDS_PER_TICK; i++) cmds.push({ seq: ++seq, buttons, yaw, pitch, weapon: 0 });
      server.receive(id, { t: 'input', cmds });
    },
    look(y: number, p = 0) {
      yaw = y;
      pitch = p;
    },
  };
}

type Client = ReturnType<typeof client>;

function tick(server: GameServer, clients: Client[], ticks: number, buttons = 0) {
  for (let i = 0; i < ticks; i++) {
    for (const c of clients) c.send(buttons);
    server.step();
  }
}

type Body = PlayerState & { protection: number };

function body(server: GameServer, id: number): Body {
  return (server as unknown as { players: Map<number, Body> }).players.get(id)!;
}

function put(server: GameServer, id: number, x: number, z: number): void {
  const b = body(server, id);
  b.x = x;
  b.z = z;
  b.y = server.world.groundHeight(x, z, server.world.terrainHeight(x, z) + 0.5);
  b.vx = b.vy = b.vz = 0;
  b.protection = 0;
}

/** An outpost's outside doorway: its first leaf, the middle of the doorway, and the way in. */
function doorway(world: World) {
  for (const b of world.buildings.filter((h) => h.outpost >= 0)) {
    for (let i = 0; i < world.doors.length; i++) {
      const d = world.doors[i];
      if (!inBuilding(b, d.x, d.z, 0.01) || d.pair < i) continue;
      const x = (d.x + world.doors[d.pair].x) / 2;
      const z = (d.z + world.doors[d.pair].z) / 2;
      if (inBuilding(b, x - d.openX * 2, z - d.openZ * 2)) continue;
      return { i, d, x, z, inX: d.openX, inZ: d.openZ, building: b };
    }
  }
  throw new Error('no outside doorway');
}

describe('doors', () => {
  it('open and shut with Interact, for everyone to see and bots to hear', () => {
    const server = new GameServer(1);
    const world = server.world;
    const { i, d, x, z, inX, inZ } = doorway(world);
    world.setDoor(i, false);
    world.setDoor(d.pair, false);
    const c = client(server);
    const other = client(server);
    tick(server, [c, other], 2);
    put(server, c.id, x - inX * 1.2, z - inZ * 1.2);
    put(server, other.id, x - inX * 6, z - inZ * 6);
    c.look(Math.atan2(-inX, -inZ));
    tick(server, [c, other], 2);

    /** Press Interact once, and let the commands play out. */
    const press = () => {
      other.send(0);
      tick(server, [c], 1, Btn.Interact);
      tick(server, [c, other], 5);
    };
    press();
    expect(d.open).toBe(true);
    expect(world.doors[d.pair].open).toBe(true);
    const opened = other.events().find((e) => e.k === 'door');
    expect(opened).toEqual(expect.objectContaining({ k: 'door', open: true, doors: expect.arrayContaining([i, d.pair]) }));

    // Someone standing in the doorway, where the leaves would swing back to, holds it open.
    put(server, other.id, x, z);
    tick(server, [c, other], 5);
    press();
    expect(d.open).toBe(true);

    put(server, other.id, x - inX * 6, z - inZ * 6);
    tick(server, [c, other], 5);
    press();
    expect(d.open).toBe(false);
    // A late joiner is told which doors stand open.
    const late: ServerMsg[] = [];
    server.receive(server.connect((m) => late.push(m)), { t: 'hello', name: 'late', world: DEFAULT_WORLD, mode: 'offline' });
    server.step();
    const welcome = late.find((m) => m.t === 'welcome');
    expect(welcome?.t === 'welcome' && welcome.open).toEqual(world.openDoors());
    expect(welcome?.t === 'welcome' && welcome.open).not.toContain(i);
  });

  it('are opened by bots going through', () => {
    const server = new GameServer(1, { guards: true });
    const world = server.world;
    const { i, d, x, z, inX, inZ } = doorway(world);
    world.setDoor(i, false);
    world.setDoor(d.pair, false);
    const heard: GameEvent[] = [];
    server.onEvent = (e) => heard.push(e);
    // One that walks about: a sentry keeps to its post.
    const guard = server.bots().find((b) => b.team === 'guard' && (b.bot as unknown as { role: { kind: string } }).role.kind !== 'sentry')!;
    put(server, guard.id, x - inX * 3, z - inZ * 3);
    // Something inside the building, for it to go and look at.
    const ix = x + inX * 3;
    const iz = z + inZ * 3;
    guard.bot.hear({ ...guard.state, id: guard.id, team: guard.team }, { x: ix, y: world.groundHeight(ix, iz, d.y0 + 0.5), z: iz, radius: 50, source: 9999 }, server.time);
    for (let t = 0; t < 12 * SERVER_TICK_RATE && !d.open; t++) {
      server.step();
    }
    expect(d.open).toBe(true);
    expect(heard.some((e) => e.k === 'door' && e.open && e.doors.includes(i))).toBe(true);
  });
});

describe('window glass', () => {
  it('breaks when shot, and the round goes on through', () => {
    const server = new GameServer(1);
    const world = server.world;
    const b = world.buildings[0];
    const glass = world.panels.findIndex((p) => p.kind === 'glass' && inBuilding(b, (p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2));
    const box = world.panels[glass].box;
    const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    // Outside the pane, looking in through it.
    const out = inBuilding(b, cx + (alongX ? 0 : 1), cz + (alongX ? 1 : 0)) ? -1 : 1;
    const [sx, sz] = alongX ? [cx, cz + out * 3] : [cx + out * 3, cz];
    const c = client(server);
    tick(server, [c], 2);
    put(server, c.id, sx, sz);
    tick(server, [c], 2);
    const me = body(server, c.id);
    const cy = (box.minY + box.maxY) / 2;
    c.look(Math.atan2(-(cx - sx), -(cz - sz)), Math.atan2(cy - (me.y + EYE_HEIGHT), 3));
    tick(server, [c], SERVER_TICK_RATE);
    tick(server, [c], 1, Btn.Fire);
    tick(server, [c], 2);
    expect(box.gone).toBe(true);
    expect(c.events().some((e) => e.k === 'break' && e.panels.includes(glass))).toBe(true);
  });
});
