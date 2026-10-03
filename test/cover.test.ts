import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { NavGrid } from '../src/server/nav.ts';
import {
  BAG_TIME, Btn, CMD_DT, CMDS_PER_TICK, DEATHCAM_AFTER, EYE_HEIGHT, GRENADE_FUSE, GRENADES, PANEL_HP, PANEL_REPAIR, SERVER_DT, SERVER_TICK_RATE,
} from '../src/shared/constants.ts';
import { launchGrenade, stepGrenade } from '../src/shared/grenade.ts';
import { hitboxes } from '../src/shared/hitbox.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { applyCmd, spawnState, type PlayerState } from '../src/shared/sim.ts';
import { BOLT } from '../src/shared/weapons.ts';
import { inBuilding, World, type Box } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const w = new World(1);

/** A 3 m outpost wall along x, with room on both sides. */
function tallWall(world: World): Box {
  return world.walls.find((b) => {
    if (b.maxZ - b.minZ > 1 || b.maxX - b.minX < 5) return false;
    const o = world.outposts.find((a) => Math.abs(b.maxY - a.y - 3) < 1e-6);
    if (!o) return false;
    const x = (b.minX + b.maxX) / 2;
    // Nothing near behind it either, such as a building.
    if (world.buildings.some((h) => inBuilding(h, x, (b.minZ + b.maxZ) / 2, 6))) return false;
    return world.fits(x, o.y, b.maxZ + 1, 1.8) && world.fits(x, o.y, b.minZ - 1, 1.8) && world.fits(x, o.y, b.maxZ + 6, 1.8);
  })!;
}

/** A crate with another stacked on it, out in an outpost: [bottom, top]. */
function stack(world: World): [number, number] {
  const top = world.panels.findIndex((p) => p.kind === 'crate' && p.restsOn.length === 1);
  return [world.panels[top].restsOn[0], top];
}

/** A run of fence with open ground either side of its middle section. */
function fence(world: World): { ids: number[]; box: Box } {
  const runs = world.panels.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'fence');
  for (const { p } of runs) {
    const b = p.box;
    if (b.maxZ - b.minZ > 0.5) continue;
    const x = (b.minX + b.maxX) / 2;
    const y = world.terrainHeight(x, b.minZ);
    if (!world.fits(x, y, b.maxZ + 1.5, 1.8) || !world.fits(x, y, b.minZ - 1.5, 1.8)) continue;
    // It and its neighbours along the run, so the gap is wide enough wherever the grid's cells fall.
    const ids = runs.filter(({ p: q }) => Math.abs(q.box.minZ - b.minZ) < 1e-6 && Math.abs((q.box.minX + q.box.maxX) / 2 - x) < 2.5).map(({ i: k }) => k);
    if (ids.length === 3) return { ids, box: b };
  }
  throw new Error('no fence');
}

describe('breakable panels', () => {
  it('builds walls solid: a round stops at one without breaking anything', () => {
    const wall = tallWall(w);
    const x = (wall.minX + wall.maxX) / 2;
    const z = wall.maxZ + 1;
    expect(w.raycastPanel(x, wall.maxY - 2, z, 0, 0, -1, 5)).toEqual({ t: expect.closeTo(z - wall.maxZ, 6), panel: -1 });
    expect(w.panels.every((p) => w.props[p.prop].box === p.box && p.box.panel === w.panels.indexOf(p))).toBe(true);
  });

  it('places fences and crates as panels, the same for the same seed', () => {
    expect(w.panels.filter((p) => p.kind === 'fence').length).toBeGreaterThan(40);
    expect(w.panels.some((p) => p.kind === 'crate' && p.restsOn.length === 1)).toBe(true);
    const shape = (world: World) => world.panels.map(({ box: { minX, minY, minZ, maxX, maxY, maxZ }, kind }) => [kind, minX, minY, minZ, maxX, maxY, maxZ]);
    expect(shape(new World(1))).toEqual(shape(w));
  });

  it('breaks a panel along with what rests on it, and rays pass where it stood', () => {
    const world = new World(1);
    const [bottom, top] = stack(world);
    const b = world.panels[top].box;
    const x = (b.minX + b.maxX) / 2;
    const y = (b.minY + b.maxY) / 2;
    const z = b.maxZ + 1;
    expect(world.raycastPanel(x, y, z, 0, 0, -1, 1.5)).toEqual({ t: expect.closeTo(z - b.maxZ, 6), panel: top });

    expect(world.breakPanel(bottom)).toEqual([bottom, top]);
    expect(world.breakPanel(bottom)).toEqual([]);
    expect(world.raycast(x, y, z, 0, 0, -1, 1.5)).toBe(Infinity);
    expect(world.brokenPanels()).toEqual([bottom, top].sort((p, q) => p - q));

    expect(world.supported(top)).toBe(false);
    world.syncPanels([top]);
    expect(world.brokenPanels()).toEqual([top]);
    expect(world.supported(top)).toBe(true);
  });

  it('lets bodies and bots through a fence once it breaks', () => {
    const world = new World(1);
    const nav = new NavGrid(world);
    const { ids, box } = fence(world);
    const x = (box.minX + box.maxX) / 2;
    const a = nav.nearestWalkable(x, box.maxZ + 1.5, 1)!;
    const b = nav.nearestWalkable(x, box.minZ - 1.5, 1)!;
    expect(nav.lineWalkable(a.x, a.z, b.x, b.z)).toBe(false);
    for (const id of ids) for (const i of world.breakPanel(id)) nav.refresh(world.panels[i].box);
    expect(nav.lineWalkable(a.x, a.z, b.x, b.z)).toBe(true);

    const z = box.maxZ + 1.5;
    const p = spawnState(x, world.groundHeight(x, z, world.terrainHeight(x, z)), z);
    for (let i = 0; i < 60; i++) applyCmd(world, p, { seq: i, buttons: Btn.Forward, yaw: 0, pitch: 0 }, CMD_DT);
    expect(p.z).toBeLessThan(box.minZ);
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
  server.receive(id, { t: 'hello', name: `p${id}`, world: DEFAULT_WORLD, mode: 'extraction' });
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

/** A shooter 5 m from a crate standing alone on the ground, with a clear shot at it. */
function atCrate(server: GameServer) {
  const world = server.world;
  for (const [id, p] of world.panels.entries()) {
    const b = p.box;
    if (p.kind !== 'crate' || p.restsOn.length || p.carries.length) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (let k = 0; k < 8; k++) {
      const x = cx + Math.sin((k * Math.PI) / 4) * 5;
      const z = cz + Math.cos((k * Math.PI) / 4) * 5;
      const y = world.groundHeight(x, z, b.maxY);
      if (y > b.maxY - 0.5 || !world.fits(x, y, z, 1.8)) continue;
      const [dx, dy, dz] = [cx - x, cy - y - EYE_HEIGHT, cz - z];
      const len = Math.hypot(dx, dy, dz);
      if (world.raycastPanel(x, y + EYE_HEIGHT, z, dx / len, dy / len, dz / len, 6).panel !== id) continue;
      const c = client(server);
      const s = body(server, c.id);
      Object.assign(s, { x, y, z, vx: 0, vz: 0 });
      tick(server, [c], 1);
      return { id, c, at: [cx, cy, cz] as const };
    }
  }
  throw new Error('no crate in the open');
}

describe('cover on the server', () => {
  it('stands a wall up to a grenade and rounds, sheltering whoever is behind it', () => {
    const server = new GameServer(1);
    const { wall, x, target, c } = atWall(server);
    const y = wall.maxY - 3;
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
    expect(events.some((e) => e.k === 'break')).toBe(false);
    // The wall shielded the target from the blast.
    expect(body(server, target).hp).toBe(100);

    for (let i = 0; i < 5; i++) {
      tick(server, [c], SERVER_TICK_RATE * 1.5, Btn.Aim);
      aim();
      tick(server, [c], 1, Btn.Aim | Btn.Fire);
    }
    expect(c.events().filter((e) => (e.k === 'hit' && e.target === target) || e.k === 'break')).toEqual([]);
  });

  it('wears a crate down with rounds until it breaks', () => {
    const server = new GameServer(1);
    const { id, c, at } = atCrate(server);
    c.wield(BOLT);
    c.lookAt(...at);
    const shots = Math.ceil(PANEL_HP.crate / 105);
    for (let i = 0; i < shots; i++) {
      expect(server.cover.health(id)).toBeGreaterThan(0);
      tick(server, [c], SERVER_TICK_RATE * 1.5, Btn.Aim);
      tick(server, [c], 1, Btn.Aim | Btn.Fire);
    }
    expect(server.cover.health(id)).toBe(0);
    expect(c.events().some((e) => e.k === 'break' && e.panels[0] === id)).toBe(true);
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

  it('gives a death cam through their own eyes to someone killed by their own grenade', () => {
    const server = new GameServer(1);
    const c = client(server);
    tick(server, [c], 1);
    const o = server.world.outposts[0];
    const me = body(server, c.id);
    me.protection = 0;
    me.x = o.x + 8;
    me.z = o.z + 2;
    me.y = server.world.groundHeight(me.x, me.z, o.y + 0.5);
    tick(server, [c], 1);
    c.lookAt(me.x, me.y - 5, me.z - 0.5);
    tick(server, [c], 3, Btn.Throw);
    me.hp = 1;
    tick(server, [c], Math.ceil((GRENADE_FUSE + DEATHCAM_AFTER) * SERVER_TICK_RATE) + 2);
    expect(c.events()).toContainEqual(expect.objectContaining({ k: 'runEnd', outcome: 'killed', killer: '' }));
    expect(c.events()).toContainEqual(expect.objectContaining({ k: 'deathcam', killer: c.id }));
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
    const c = client(server);
    tick(server, [c], 1);
    const [bottom, top] = stack(server.world);
    const b = server.world.panels[bottom].box;
    server.grenades.push(launchGrenade(99, c.id, { seq: 0, x: (b.minX + b.maxX) / 2, y: b.minY + 0.3, z: b.maxZ + 0.1, vx: 0, vy: 0, vz: 0 }, 0.1));
    tick(server, [c], 5);
    expect(server.world.panels[bottom].box.gone).toBe(true);
    expect(server.world.panels[top].box.gone).toBe(true);

    // Told to everyone, whoever is still alive by then.
    const heard: GameEvent[] = [];
    server.onEvent = (e) => heard.push(e);
    const late = client(server);
    server.step();
    expect(late.inbox[0]).toEqual(expect.objectContaining({ t: 'welcome', broken: expect.arrayContaining([bottom, top]) }));

    // Not while the bag the crates spilled lies where they stood.
    tick(server, [c, late], (PANEL_REPAIR + 3) * SERVER_TICK_RATE);
    expect(server.world.panels[bottom].box.gone).toBe(true);
    tick(server, [c, late], (BAG_TIME - PANEL_REPAIR) * SERVER_TICK_RATE);
    expect(server.world.panels[bottom].box.gone).toBe(false);
    expect(server.world.panels[top].box.gone).toBe(false);
    expect(server.cover.health(bottom)).toBe(PANEL_HP.crate);
    const told = (id: number) => heard.findIndex((e) => e.k === 'repair' && e.panels.includes(id));
    expect(told(bottom)).toBeGreaterThanOrEqual(0);
    expect(told(top)).toBeGreaterThanOrEqual(told(bottom));
  });
});
