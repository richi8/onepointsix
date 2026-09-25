import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { NavGrid } from '../src/server/nav.ts';
import {
  Btn, CMD_DT, CMDS_PER_TICK, EYE_HEIGHT, GRENADE_FUSE, GRENADES, PANEL_HP, PANEL_REPAIR, SERVER_DT, SERVER_TICK_RATE,
} from '../src/shared/constants.ts';
import { launchGrenade, stepGrenade } from '../src/shared/grenade.ts';
import { hitboxes } from '../src/shared/hitbox.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { applyCmd, spawnState, type PlayerState } from '../src/shared/sim.ts';
import { BOLT } from '../src/shared/weapons.ts';
import { World, type Box } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const w = new World(1);

/** A 3 m outpost wall along x, with room on both sides. */
function tallWall(world: World): Box {
  return world.walls.find((b) => {
    if (b.maxZ - b.minZ > 1 || b.maxX - b.minX < 5) return false;
    const o = world.outposts.find((a) => Math.abs(b.maxY - a.y - 3) < 1e-6);
    if (!o) return false;
    const x = (b.minX + b.maxX) / 2;
    return world.fits(x, o.y, b.maxZ + 1, 1.8) && world.fits(x, o.y, b.minZ - 1, 1.8) && world.fits(x, o.y, b.maxZ + 6, 1.8);
  })!;
}

/** The panels of a wall at x, bottom first. */
function column(world: World, wall: Box, x: number): number[] {
  return world.panels
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.kind === 'wall' && p.box.minX <= x && p.box.maxX >= x && p.box.minZ >= wall.minZ - 1e-6 && p.box.maxZ <= wall.maxZ + 1e-6)
    .sort((a, b) => a.p.box.minY - b.p.box.minY)
    .map(({ i }) => i);
}

describe('breakable panels', () => {
  it('builds walls from columns of panels, the top row resting on the bottom', () => {
    const wall = tallWall(w);
    const x = (wall.minX + wall.maxX) / 2;
    const [bottom, top] = column(w, wall, x);
    expect(w.panels[top].restsOn).toEqual([bottom]);
    expect(w.panels[bottom].carries).toEqual([top]);
    const width = w.panels[bottom].box.maxX - w.panels[bottom].box.minX;
    expect(width).toBeGreaterThan(1.2);
    expect(width).toBeLessThan(2.2);
    expect(w.panels.every((p) => w.props[p.prop].box === p.box && p.box.panel === w.panels.indexOf(p))).toBe(true);
  });

  it('places fences and crates as panels, the same for the same seed', () => {
    expect(w.panels.filter((p) => p.kind === 'fence').length).toBeGreaterThan(40);
    expect(w.panels.some((p) => p.kind === 'crate' && p.restsOn.length === 1)).toBe(true);
    const shape = (world: World) => world.panels.map(({ box: { minX, minY, minZ, maxX, maxY, maxZ }, kind }) => [kind, minX, minY, minZ, maxX, maxY, maxZ]);
    expect(shape(new World(1))).toEqual(shape(w));
  });

  it('breaks a panel along with what rests on it, and rays and bodies pass the hole', () => {
    const world = new World(1);
    const wall = tallWall(world);
    const x = (wall.minX + wall.maxX) / 2;
    const [bottom, top] = column(world, wall, x);
    const y = world.panels[top].box.maxY - 3;
    const z = wall.maxZ + 1;
    expect(world.raycastPanel(x, y + 1, z, 0, 0, -1, 5)).toEqual({ t: expect.closeTo(z - wall.maxZ, 6), panel: bottom });

    expect(world.breakPanel(bottom)).toEqual([bottom, top]);
    expect(world.breakPanel(bottom)).toEqual([]);
    expect(world.raycast(x, y + 1, z, 0, 0, -1, 5)).toBe(Infinity);
    expect(world.brokenPanels()).toEqual([bottom, top]);

    const p = spawnState(x, world.groundHeight(x, z, y), z);
    for (let i = 0; i < 60; i++) applyCmd(world, p, { seq: i, buttons: Btn.Forward, yaw: 0, pitch: 0 }, CMD_DT);
    expect(p.z).toBeLessThan(wall.minZ);

    expect(world.supported(top)).toBe(false);
    world.syncPanels([top]);
    expect(world.brokenPanels()).toEqual([top]);
    expect(world.supported(top)).toBe(true);
  });

  it('lets bots path through a hole once it opens', () => {
    const world = new World(1);
    const nav = new NavGrid(world);
    const wall = tallWall(world);
    const x = (wall.minX + wall.maxX) / 2;
    const a = nav.nearestWalkable(x, wall.maxZ + 1.5, 1)!;
    const b = nav.nearestWalkable(x, wall.minZ - 1.5, 1)!;
    expect(nav.lineWalkable(a.x, a.z, b.x, b.z)).toBe(false);
    const [bottom] = column(world, wall, x);
    for (const i of world.breakPanel(bottom)) nav.refresh(world.panels[i].box);
    expect(nav.lineWalkable(a.x, a.z, b.x, b.z)).toBe(true);
  });
});

describe('grenade flight', () => {
  it('bounces to a stop on the ground', () => {
    const o = w.outposts[0];
    const g = launchGrenade(1, 1, { seq: 0, x: o.x, y: o.y + 1.5, z: o.z + 8, vx: 0, vy: 3, vz: 6 }, 10);
    let maxY = -Infinity;
    for (let i = 0; i < 5 * SERVER_TICK_RATE; i++) {
      stepGrenade(w, g, SERVER_DT);
      maxY = Math.max(maxY, g.y);
    }
    expect(g.rest).toBe(true);
    expect(g.y).toBeCloseTo(w.groundHeight(g.x, g.z, g.y) + 0.06, 1);
    expect(maxY).toBeGreaterThan(o.y + 1.5);
  });

  it('does not fly through a wall', () => {
    const wall = tallWall(w);
    const x = (wall.minX + wall.maxX) / 2;
    const y = wall.maxY - 3;
    const g = launchGrenade(1, 1, { seq: 0, x, y: y + 1, z: wall.maxZ + 3, vx: 0, vy: 1, vz: -20 }, 10);
    for (let i = 0; i < 3 * SERVER_TICK_RATE; i++) stepGrenade(w, g, SERVER_DT);
    expect(g.z).toBeGreaterThan(wall.maxZ);
  });
});

// ------------------------------------------------------------------ server

function client(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `p${id}`, world: DEFAULT_WORLD, mode: 'offline' });
  let seq = 0;
  let yaw = 0;
  let pitch = 0;
  let weapon = 0;
  const snapshot = () => {
    const s = inbox.filter((m) => m.t === 'snapshot').at(-1);
    if (s?.t !== 'snapshot') throw new Error('no snapshot yet');
    return s;
  };
  return {
    id,
    inbox,
    events: (): GameEvent[] => inbox.flatMap((m) => (m.t === 'events' ? m.events : [])),
    me: (): PlayerState => snapshot().you,
    send(buttons: number) {
      const cmds = [];
      for (let i = 0; i < CMDS_PER_TICK; i++) cmds.push({ seq: ++seq, buttons, yaw, pitch, weapon });
      server.receive(id, { t: 'input', cmds });
    },
    lookAt(x: number, y: number, z: number) {
      const me = snapshot().you;
      const dx = x - me.x;
      const dz = z - me.z;
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(y - (me.y + EYE_HEIGHT), Math.hypot(dx, dz));
    },
    wield(w: number) {
      weapon = w;
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

function body(server: GameServer, id: number): PlayerState & { protection: number } {
  return (server as unknown as { players: Map<number, PlayerState & { protection: number }> }).players.get(id)!;
}

/** A shooter 6 m in front of a tall wall and a second player standing just behind it. */
function atWall(server: GameServer) {
  const world = server.world;
  const wall = tallWall(world);
  const x = (wall.minX + wall.maxX) / 2;
  const put = (s: PlayerState, z: number) => {
    s.x = x;
    s.z = z;
    s.y = world.groundHeight(x, z, world.terrainHeight(x, z));
    s.vx = s.vz = 0;
  };
  const c = client(server);
  const target = client(server).id;
  put(body(server, target), wall.minZ - 2);
  put(body(server, c.id), wall.maxZ + 6);
  body(server, c.id).protection = body(server, target).protection = 0;
  tick(server, [c], 1);
  return { wall, x, target, c };
}

describe('cover on the server', () => {
  it('blows a hole in a wall with a grenade, then shoots through it', () => {
    const server = new GameServer(1);
    const { wall, x, target, c } = atWall(server);
    const y = wall.maxY - 3;
    const [bottom, top] = column(server.world, wall, x);
    c.wield(BOLT);
    tick(server, [c], SERVER_TICK_RATE, Btn.Aim);

    const aim = () => {
      const h = hitboxes(body(server, target));
      c.lookAt(h.headX, h.headY, h.headZ);
    };
    aim();
    tick(server, [c], 1, Btn.Aim | Btn.Fire);
    expect(c.events().filter((e) => e.k === 'hit')).toEqual([]);

    server.grenades.push(launchGrenade(99, c.id, { seq: 0, x, y: y + 0.1, z: wall.maxZ + 0.1, vx: 0, vy: 0, vz: 0 }, 0.2));
    tick(server, [c], 10, Btn.Aim);
    expect(server.grenades).toEqual([]);
    const events = c.events();
    expect(events.some((e) => e.k === 'boom')).toBe(true);
    const broke = events.find((e) => e.k === 'break');
    expect(broke?.k === 'break' && broke.panels).toEqual(expect.arrayContaining([bottom, top]));
    expect(server.world.panels[bottom].box.gone).toBe(true);
    // The wall shielded the target from the blast.
    expect(body(server, target).hp).toBe(100);

    tick(server, [c], SERVER_TICK_RATE * 2, Btn.Aim);
    aim();
    tick(server, [c], 1, Btn.Aim | Btn.Fire);
    expect(c.events().filter((e) => e.k === 'hit' && e.target === target)).toEqual([
      expect.objectContaining({ zone: 'head', killed: true }),
    ]);
  });

  it('wears a panel down with rounds until it breaks', () => {
    const server = new GameServer(1);
    const { wall, x, c } = atWall(server);
    const [bottom] = column(server.world, wall, x);
    c.wield(BOLT);
    c.lookAt(x, wall.maxY - 3 + 0.5, wall.maxZ);
    const shots = Math.ceil(PANEL_HP.wall / 105);
    for (let i = 0; i < shots; i++) {
      expect(server.cover.health(bottom)).toBeGreaterThan(0);
      tick(server, [c], SERVER_TICK_RATE * 1.5, Btn.Aim);
      tick(server, [c], 1, Btn.Aim | Btn.Fire);
    }
    expect(server.cover.health(bottom)).toBe(0);
    expect(c.events().some((e) => e.k === 'break' && e.panels[0] === bottom)).toBe(true);
  });

  it('throws grenades on a fresh press, which hurt bodies in sight', () => {
    const server = new GameServer(1);
    const c = client(server);
    tick(server, [c], 1);
    // Out on the flat ground of an outpost, where it won't roll away.
    const o = server.world.outposts[0];
    const me = body(server, c.id);
    me.protection = 0;
    me.x = o.x + 8;
    me.z = o.z + 2;
    me.y = server.world.groundHeight(me.x, me.z, o.y + 0.5);
    tick(server, [c], 1);
    c.lookAt(me.x, me.y - 5, me.z - 0.5);
    tick(server, [c], 3, Btn.Throw);
    expect(server.grenades.length).toBe(1);
    tick(server, [c], 1);
    expect(c.me().grenades).toBe(GRENADES - 1);
    expect(c.me().draw).toBeGreaterThan(0);

    tick(server, [c], Math.ceil(GRENADE_FUSE * SERVER_TICK_RATE));
    expect(Math.hypot(me.x - (o.x + 8), me.z - (o.z + 2))).toBeLessThan(0.1);
    expect(server.grenades).toEqual([]);
    expect(c.events().some((e) => e.k === 'boom')).toBe(true);
    expect(c.events().some((e) => e.k === 'hurt')).toBe(true);
    expect(body(server, c.id).hp).toBeLessThan(100);
  });

  it('spills a smashed crate into a bag', () => {
    const server = new GameServer(1);
    const crate = server.containers.crates()[0];
    const items = [...crate.items];
    const x = (crate.minX + crate.maxX) / 2;
    const z = (crate.minZ + crate.maxZ) / 2;
    server.grenades.push(launchGrenade(99, 1, { seq: 0, x, y: crate.maxY + 0.1, z, vx: 0, vy: 0, vz: 0 }, 0.1));
    for (let i = 0; i < 5; i++) server.step();
    expect(server.world.panels[crate.panel].box.gone).toBe(true);
    expect(crate.broken).toBe(true);
    // Facing where it stood finds the bag it left, not the crate.
    expect(server.containers.facing(x, crate.minY, z + 1, 0)?.kind).toBe('bag');
    const bag = server.containers.bags().find((b) => Math.hypot(b.x - x, b.z - z) < 1)!;
    expect(server.containers.get(bag.id)!.items.sort()).toEqual(items.sort());
  });

  it('rebuilds broken panels after a while, bottom first, and tells everyone', () => {
    const server = new GameServer(1);
    const { wall, x, c } = atWall(server);
    const [bottom, top] = column(server.world, wall, x);
    server.grenades.push(launchGrenade(99, c.id, { seq: 0, x, y: wall.maxY - 3 + 0.1, z: wall.maxZ + 0.1, vx: 0, vy: 0, vz: 0 }, 0.1));
    tick(server, [c], 5);
    expect(server.world.panels[top].box.gone).toBe(true);

    const late = client(server);
    server.step();
    expect(late.inbox[0]).toEqual(expect.objectContaining({ t: 'welcome', broken: expect.arrayContaining([bottom, top]) }));

    tick(server, [c, late], (PANEL_REPAIR + 3) * SERVER_TICK_RATE);
    expect(server.world.panels[bottom].box.gone).toBe(false);
    expect(server.world.panels[top].box.gone).toBe(false);
    expect(server.cover.health(bottom)).toBe(PANEL_HP.wall);
    expect(c.events().some((e) => e.k === 'repair' && e.panels.includes(bottom) && e.panels.includes(top))).toBe(true);
  });
});
