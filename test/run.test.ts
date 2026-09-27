import { describe, expect, it } from 'vitest';
import { Directory } from '../src/server/directory.ts';
import { Extracts } from '../src/server/extracts.ts';
import { GameServer } from '../src/server/server.ts';
import {
  Btn, CALL_TIME, EXTRACT_FEE, EXTRACT_TIME, OPERATOR_CAPACITY, RESPONSE_SQUAD, RUN_TIME, SEARCH_TIME, SERVER_TICK_RATE,
} from '../src/shared/constants.ts';
import { yawToward } from '../src/shared/geom.ts';
import { ITEMS, lootMass, lootValue, rollItems, runScore, sortForTaking } from '../src/shared/loot.ts';
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const GOLD = ITEMS.findIndex((i) => i.name === 'Gold bar');
const WATCH = ITEMS.findIndex((i) => i.name === 'Wristwatch');

interface RunState {
  start: number;
  items: number[];
}

/** Server internals, for putting bodies where a test needs them. */
function body(server: GameServer, id: number): PlayerState & { run: RunState; protection: number } {
  return (server as unknown as { players: Map<number, PlayerState & { run: RunState; protection: number }> }).players.get(id)!;
}

/** A human playing a run on an island with nobody else on it. */
function human(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `h${id}`, world: DEFAULT_WORLD, mode: 'offline' });
  let seq = 0;
  let yaw = 0;
  return {
    id,
    inbox,
    events: (): GameEvent[] => inbox.flatMap((m) => (m.t === 'events' ? m.events : [])),
    snap: () => [...inbox].reverse().find((m) => m.t === 'snapshot') as Extract<ServerMsg, { t: 'snapshot' }>,
    /** Hold `buttons` for this many commands, two per tick, facing `yaw` (kept for later calls). */
    hold(buttons: number, commands: number, face = yaw) {
      yaw = face;
      for (let i = 0; i < commands; i += 2) {
        const cmds = [0, 1].map(() => ({ seq: ++seq, buttons, yaw, pitch: -0.3 }));
        server.receive(id, { t: 'input', cmds });
        server.step();
      }
    },
    /** One fresh press of `button`. */
    press(button: number) {
      this.hold(button, 2);
      this.hold(0, 2);
    },
  };
}

function place(server: GameServer, id: number, x: number, z: number): void {
  const w = server.world;
  Object.assign(body(server, id), { x, z, y: w.groundHeight(x, z, w.floorHeight(x, z) + 0.5), vx: 0, vz: 0 });
}

/** A spot next to a crate on the ground to search it from, and the way to face it. */
function besideCrate(server: GameServer) {
  for (const c of server.containers.crates()) {
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const reach = (c.maxX - c.minX) / 2 + 0.7;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = cx + Math.sin(a) * reach;
      const z = cz + Math.cos(a) * reach;
      if (!server.nav.dry(x, z)) continue;
      const y = server.world.groundHeight(x, z, server.world.floorHeight(x, z));
      if (server.containers.facing(x, y, z, yawToward(x, z, cx, cz)) !== c) continue;
      return { crate: c, x, z, yaw: yawToward(x, z, cx, cz) };
    }
  }
  throw new Error('no crate to stand at');
}

const runsServer = () => new GameServer(DEFAULT_WORLD.seed, { mode: 'offline' });

describe('loot', () => {
  it('rolls the same crates from the same seed, with more in guarded ones', () => {
    expect(rollItems(mulberry32(5), false)).toEqual(rollItems(mulberry32(5), false));
    const avg = (rich: boolean) => {
      const rand = mulberry32(9);
      let n = 0;
      for (let i = 0; i < 500; i++) n += rollItems(rand, rich).length;
      return n / 500;
    };
    expect(avg(true)).toBeGreaterThan(avg(false) + 1);
  });

  it('is richer at night', () => {
    const worth = (night: boolean) => {
      const rand = mulberry32(9);
      let v = 0;
      for (let i = 0; i < 500; i++) v += lootValue(rollItems(rand, false, night));
      return v / 500;
    };
    expect(worth(true)).toBeGreaterThan(worth(false) * 1.5);
  });

  it('is taken supplies first, then the most valuable', () => {
    const ammo = ITEMS.findIndex((i) => i.use === 'ammo');
    expect(sortForTaking([WATCH, GOLD, ammo])).toEqual([ammo, GOLD, WATCH]);
  });

  it('scores loot and kills', () => {
    expect(runScore(6000, 2, 3)).toBe(6000 - EXTRACT_FEE + 2 * 500 + 3 * 150);
  });
});

describe('a run', () => {
  it('drops a human in away from the outposts with the clock running', () => {
    const server = runsServer();
    const h = human(server);
    server.step();
    const snap = h.snap();
    expect(snap.run?.time).toBeCloseTo(RUN_TIME - 1 / SERVER_TICK_RATE, 3);
    expect(snap.extracts).toHaveLength(server.world.extracts.length);
    const nearest = server.world.nearestOutpost(snap.you.x, snap.you.z)!;
    expect(nearest.dist).toBeGreaterThan(60);
  });

  it('searches a crate while F is held, then takes one item per press', () => {
    const server = runsServer();
    const h = human(server);
    const spot = besideCrate(server);
    place(server, h.id, spot.x, spot.z);
    h.hold(0, 2, spot.yaw);
    expect(h.snap().run?.loot).toMatchObject({ id: spot.crate.id, searched: false, progress: 0 });

    h.hold(Btn.Interact, Math.round(SEARCH_TIME * 30));
    expect(h.snap().run?.loot?.searched).toBe(false);
    h.hold(Btn.Interact, Math.round(SEARCH_TIME * 30));
    const opened = h.snap().run!.loot!;
    expect(opened.searched).toBe(true);
    expect(opened.items.length).toBeGreaterThan(0);
    // Still holding from the search takes nothing; a fresh press takes the first.
    h.hold(0, 2);
    h.press(Btn.Interact);
    const after = h.snap();
    expect(after.run!.loot!.items).toEqual(opened.items.slice(1));
    const first = opened.items[0];
    expect(h.events()).toContainEqual({ k: 'took', item: first });
    expect(after.run!.items).toEqual(ITEMS[first].use ? [] : [first]);
    expect(after.you.carry).toBe(lootMass(after.run!.items));
  });

  it('drops the last item in a bag that someone else can loot', () => {
    const server = runsServer();
    const a = human(server);
    const b = human(server);
    body(server, a.id).run.items = [WATCH, GOLD];
    const spot = server.nav.nearestWalkable(server.world.extracts[0].x + 20, server.world.extracts[0].z)!;
    place(server, a.id, spot.x, spot.z);
    a.press(Btn.Drop);
    expect(body(server, a.id).run.items).toEqual([WATCH]);
    const [bag] = a.snap().bags;
    expect(bag).toBeDefined();

    place(server, b.id, bag.x + 1, bag.z);
    b.hold(0, 2, yawToward(bag.x + 1, bag.z, bag.x, bag.z));
    expect(b.snap().run?.loot).toMatchObject({ kind: 'bag', searched: true, items: [GOLD] });
    b.press(Btn.Interact);
    expect(body(server, b.id).run.items).toEqual([GOLD]);
    expect(b.snap().bags).toEqual([]);
  });

  it('ends extracted after holding an open walk-in point, scoring the loot', () => {
    const server = runsServer();
    const h = human(server);
    const onEvent: GameEvent[] = [];
    server.onEvent = (e) => onEvent.push(e);
    const e = server.extracts.points[0];
    expect(e.kind).toBe('walk');
    Object.assign(e, { open: true, next: Infinity });
    body(server, h.id).run.items = [GOLD, GOLD, WATCH];
    place(server, h.id, e.x, e.z);
    h.hold(0, Math.round(EXTRACT_TIME * 60) - 10);
    expect(h.snap().run).toMatchObject({ zone: 0 });
    expect(h.events().some((ev) => ev.k === 'runEnd')).toBe(false);
    h.hold(0, 20);
    const value = 2 * ITEMS[GOLD].value + ITEMS[WATCH].value;
    expect(h.events()).toContainEqual(expect.objectContaining({
      k: 'runEnd', outcome: 'extracted', score: value - EXTRACT_FEE, value, items: [GOLD, GOLD, WATCH], extract: 0, death: null,
    }));
    expect(onEvent).toContainEqual({ k: 'extract', id: h.id, name: `h${h.id}`, value });
    expect(server.humans()).toBe(0);
  });

  it('does not extract, nor call a pickup, carrying less than the fee', () => {
    const server = runsServer();
    const h = human(server);
    body(server, h.id).run.items = [WATCH];
    const walk = server.extracts.points[0];
    Object.assign(walk, { open: true, next: Infinity });
    place(server, h.id, walk.x, walk.z);
    h.hold(0, Math.round(EXTRACT_TIME * 60) * 2);
    expect(h.events().some((ev) => ev.k === 'runEnd')).toBe(false);
    const call = server.extracts.points[1];
    Object.assign(call, { open: true, next: Infinity });
    place(server, h.id, call.x, call.z);
    body(server, h.id).protection = Infinity;
    h.press(Btn.Interact);
    expect(h.events().some((ev) => ev.k === 'call')).toBe(false);
  });

  it('does not extract at a shut point', () => {
    const server = runsServer();
    const h = human(server);
    const e = server.extracts.points[0];
    Object.assign(e, { open: false, next: Infinity });
    place(server, h.id, e.x, e.z);
    h.hold(0, Math.round(EXTRACT_TIME * 60) * 2);
    expect(h.events().some((ev) => ev.k === 'runEnd')).toBe(false);
  });

  it('calls a pickup at a landing zone, which draws a response squad and lands after the call time', () => {
    const server = runsServer();
    const h = human(server);
    const e = server.extracts.points[1];
    expect(e.kind).toBe('call');
    Object.assign(e, { open: true, next: Infinity });
    body(server, h.id).run.items = [GOLD, GOLD];
    place(server, h.id, e.x, e.z);
    body(server, h.id).protection = Infinity;
    h.press(Btn.Interact);
    expect(h.events()).toContainEqual({ k: 'call', id: h.id, index: 1, name: `h${h.id}` });
    const squad = server.bots().filter((b) => b.name === 'Response');
    expect(squad).toHaveLength(RESPONSE_SQUAD);
    for (const g of squad) expect(Math.hypot(g.state.x - e.x, g.state.z - e.z)).toBeGreaterThan(100);
    // A second press doesn't call again.
    h.press(Btn.Interact);
    expect(h.events().filter((ev) => ev.k === 'call')).toHaveLength(1);
    h.hold(0, (CALL_TIME - 1) * 60);
    expect(h.events().some((ev) => ev.k === 'runEnd')).toBe(false);
    h.hold(0, 2 * 60);
    expect(h.events()).toContainEqual(expect.objectContaining({ k: 'runEnd', outcome: 'extracted' }));
  });

  it('ends with nothing on death, leaving the loot in a bag on the body', () => {
    const server = runsServer();
    const h = human(server);
    const other = human(server);
    body(server, h.id).run.items = [GOLD];
    const me = body(server, h.id);
    me.protection = 0;
    (server as unknown as { damage: (...args: unknown[]) => void }).damage(me, body(server, other.id), 500, 'head', 0, 0, 0, 0);
    server.step();
    expect(h.events()).toContainEqual(expect.objectContaining({
      k: 'runEnd', outcome: 'killed', score: 0, value: ITEMS[GOLD].value, killer: `h${other.id}`, extract: -1,
      death: { by: 'operator', weapon: 0, head: true, distance: expect.any(Number), shooters: { guards: 0, operators: 1 } },
      taken: { guards: 0, operators: 100 },
    }));
    expect(body(server, other.id).run).toMatchObject({ kills: 1 });
    const [bag] = h.snap().bags;
    expect(Math.hypot(bag.x - me.x, bag.z - me.z)).toBeLessThan(0.01);
  });

  it('goes missing in action when the clock runs out', () => {
    const server = runsServer();
    const h = human(server);
    body(server, h.id).run.start = -RUN_TIME + 0.5;
    for (let t = 0; t < SERVER_TICK_RATE; t++) server.step();
    expect(h.events()).toContainEqual(expect.objectContaining({ k: 'runEnd', outcome: 'mia', score: 0 }));
    expect(server.humans()).toBe(0);
  });
});

describe('extraction points', () => {
  it('open and close at random with at least one always open', () => {
    const ex = new Extracts(new World(DEFAULT_WORLD.seed), mulberry32(3));
    let changes = 0;
    let last = ex.points.map((p) => p.open);
    for (let t = 0; t < 3600; t++) {
      ex.step(t);
      expect(ex.points.some((p) => p.open)).toBe(true);
      const now = ex.points.map((p) => p.open);
      changes += now.filter((o, i) => o !== last[i]).length;
      last = now;
    }
    expect(changes).toBeGreaterThan(20);
  });

  it('can only be called at an open landing zone, once at a time', () => {
    const ex = new Extracts(new World(DEFAULT_WORLD.seed), mulberry32(3));
    Object.assign(ex.points[0], { open: true });
    Object.assign(ex.points[1], { open: false });
    expect(ex.call(0, 0)).toBe(false);
    expect(ex.call(1, 0)).toBe(false);
    ex.points[1].open = true;
    expect(ex.call(1, 0)).toBe(true);
    expect(ex.call(1, 1)).toBe(false);
    expect(ex.step(CALL_TIME - 0.1)).toEqual([]);
    expect(ex.step(CALL_TIME)).toEqual([1]);
  });
});

describe('quick join', () => {
  it('puts players in the first game on their island and mode that is not full', () => {
    const dir = new Directory();
    const solo = dir.quickJoin(DEFAULT_WORLD, 'offline');
    expect(dir.quickJoin(DEFAULT_WORLD, 'offline')).toBe(solo);
    solo.connect(() => {});
    // Offline holds one human, so the next gets their own island.
    const solo2 = dir.quickJoin(DEFAULT_WORLD, 'offline');
    expect(solo2).not.toBe(solo);
    expect(dir.quickJoin({ ...DEFAULT_WORLD, seed: 7 }, 'offline')).not.toBe(solo2);
    expect(dir.quickJoin({ ...DEFAULT_WORLD, time: 'night' }, 'offline')).not.toBe(solo2);
    expect(dir.quickJoin(DEFAULT_WORLD, 'online').mode).toBe('online');
    expect(dir.count).toBe(5);
  });

  it.each(['online', 'offline'] as const)('fills %s with operator bots that humans replace', (mode) => {
    const dir = new Directory();
    const game = dir.quickJoin(DEFAULT_WORLD, mode);
    const operators = () => game.bots().filter((b) => b.team === 'operator').length;
    expect(operators()).toBe(OPERATOR_CAPACITY);
    const id = game.connect(() => {});
    expect(operators()).toBe(OPERATOR_CAPACITY - 1);
    if (mode === 'online') expect(dir.quickJoin(DEFAULT_WORLD, mode)).toBe(game);
    else expect(dir.quickJoin(DEFAULT_WORLD, mode)).not.toBe(game);
    game.disconnect(id);
    expect(game.humans()).toBe(0);
  });
});
