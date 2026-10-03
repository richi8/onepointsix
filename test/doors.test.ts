import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMDS_PER_TICK, EYE_HEIGHT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { DOOR_SWING, inBuilding, leafRect, World, type Plan } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

function client(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `p${id}`, world: DEFAULT_WORLD, mode: 'online' });
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

/** An outpost's outside doorway, in a building of plan `plan` if given: its first leaf, the middle of the doorway, and the way in. */
function doorway(world: World, plan?: Plan) {
  for (const b of world.buildings.filter((h) => h.outpost >= 0 && (!plan || h.plan === plan))) {
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

/** A guard walking outpost `outpost`. */
function homeGuard(server: GameServer, outpost: number) {
  const home = server.world.outposts[outpost];
  return server.bots().find((b) => {
    const role = (b.bot as unknown as { role: { kind: string; home?: unknown } }).role;
    return role.kind === 'guard' && role.home === home;
  })!;
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
    server.receive(server.connect((m) => late.push(m)), { t: 'hello', name: 'late', world: DEFAULT_WORLD, mode: 'online' });
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

  it('are shut by guards behind them, now and then', () => {
    const server = new GameServer(1, { guards: true });
    const world = server.world;
    const { i, d, x, z, inX, inZ, building } = doorway(world);
    const guard = homeGuard(server, building.outpost);
    const heard: GameEvent[] = [];
    server.onEvent = (e) => heard.push(e);
    let shut = 0;
    // In and out again, a few times over: a guard shuts the door behind it more often than not.
    for (let trip = 0; trip < 6; trip++) {
      const into = trip % 2 === 0 ? 1 : -1;
      world.setDoor(i, true);
      world.setDoor(d.pair, true);
      put(server, guard.id, x - inX * 3 * into, z - inZ * 3 * into);
      const tx = x + inX * 3.5 * into;
      const tz = z + inZ * 3.5 * into;
      guard.bot.hear({ ...guard.state, id: guard.id, team: guard.team }, { x: tx, y: world.groundHeight(tx, tz, d.y0 + 0.5), z: tz, radius: 50, source: 9999 }, server.time);
      for (let t = 0; t < 8 * SERVER_TICK_RATE && d.open; t++) server.step();
      if (!d.open) shut++;
    }
    expect(shut).toBeGreaterThanOrEqual(2);
    expect(heard.some((e) => e.k === 'door' && !e.open && e.doors.includes(i))).toBe(true);
  });

  it('let guards go upstairs to look into a noise there', () => {
    const server = new GameServer(1, { guards: true });
    const world = server.world;
    const { d, x, z, inX, inZ, building } = doorway(world, 'tall');
    const upper = building.upper!;
    const guard = homeGuard(server, building.outpost);
    put(server, guard.id, x - inX * 3, z - inZ * 3);
    const spot = server.nav.nearestWalkable((building.minX + building.maxX) / 2, (building.minZ + building.maxZ) / 2, 4, upper)!;
    expect(spot.y).toBeCloseTo(upper, 3);
    // A shot heard from someone's eye upstairs.
    guard.bot.hear({ ...guard.state, id: guard.id, team: guard.team }, { x: spot.x, y: upper + 1.6, z: spot.z, radius: 80, source: 9999, gunfire: true }, server.time);
    let up = false;
    for (let t = 0; t < 30 * SERVER_TICK_RATE && !up; t++) {
      server.step();
      up = Math.abs(guard.state.y - upper) < 0.2 && Math.hypot(guard.state.x - spot.x, guard.state.z - spot.z) < 3;
    }
    expect(up, `guard at ${guard.state.x.toFixed(1)}, ${guard.state.y.toFixed(1)}, ${guard.state.z.toFixed(1)}; door ${d.open}`).toBe(true);
  });
});

describe('door leaves swinging', () => {
  it('take DOOR_SWING seconds, and stand at a slant on the way for bodies and rounds', () => {
    const world = new World(1);
    const i = world.doors.findIndex((d) => !d.open);
    const d = world.doors[i];
    const box = world.panels[d.panel].box;
    world.swingDoor(i, true);
    expect(d.open).toBe(true);
    expect(d.swing).toBe(0);
    world.stepDoors(DOOR_SWING / 2);
    expect(d.swing).toBeCloseTo(0.5, 6);
    expect(box.turn).toBeDefined();
    // Halfway, the leaf points out at 45°: a ray along that line from past its end comes back to its end.
    const ux = (d.shutX + d.openX) / Math.SQRT2;
    const uz = (d.shutZ + d.openZ) / Math.SQRT2;
    const mid = (d.y0 + d.y1) / 2;
    const ex = d.x + ux * (d.length + 1);
    const ez = d.z + uz * (d.length + 1);
    expect(world.raycast(ex, mid, ez, -ux, 0, -uz, 3)).toBeCloseTo(1, 3);
    // Square across it, a ray meets its face half a leaf's thickness from the middle.
    const nx = -uz;
    const nz = ux;
    const cx = d.x + ux * d.length * 0.5;
    const cz = d.z + uz * d.length * 0.5;
    const t = world.raycast(cx + nx, mid, cz + nz, -nx, 0, -nz, 2);
    expect(t).toBeGreaterThan(0.95);
    expect(t).toBeLessThan(1);
    // Where it was shut, and where it will be open, is clear now.
    for (const [x, z] of [[d.x + d.shutX * d.length * 0.7, d.z + d.shutZ * d.length * 0.7], [d.x + d.openX * d.length * 0.7, d.z + d.openZ * d.length * 0.7]]) {
      expect(world.clear(x, d.y0, z, 1.8, 0.05)).toBe(true);
    }
    // A body standing on the slanted leaf is pushed off it, square to its face.
    const b = { x: cx + nx * 0.1, y: d.y0, z: cz + nz * 0.1, vx: 0, vz: 0 };
    world.collide(b);
    expect((b.x - cx) * nx + (b.z - cz) * nz).toBeCloseTo(0.4 + 0.03, 2);
    world.stepDoors(DOOR_SWING);
    expect(d.swing).toBe(1);
    expect(box.turn).toBeUndefined();
    expect([box.minX, box.minZ, box.maxX, box.maxZ]).toEqual(leafRect(d, true));
  });

  it('won\'t swing through someone standing in the way, and tell whoever tried', () => {
    const server = new GameServer(1);
    const world = server.world;
    const { i, d, x, z, inX, inZ } = doorway(world);
    world.setDoor(i, true);
    world.setDoor(d.pair, true);
    const c = client(server);
    const other = client(server);
    tick(server, [c, other], 2);
    put(server, c.id, x - inX * 1.2, z - inZ * 1.2);
    // Just inside, beside the doorway, where a leaf swings shut through.
    put(server, other.id, x + inX * 0.6 + d.shutX * -0.7, z + inZ * 0.6 + d.shutZ * -0.7);
    c.look(Math.atan2(-inX, -inZ));
    tick(server, [c, other], 2);
    other.send(0);
    tick(server, [c], 1, Btn.Interact);
    tick(server, [c, other], 2);
    expect(d.open).toBe(true);
    expect(c.events()).toContainEqual({ k: 'doorStuck', doors: expect.arrayContaining([i, d.pair]) });
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
