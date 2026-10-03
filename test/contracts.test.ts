import { describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/server/bot.ts';
import { planContracts, type Contract } from '../src/server/contracts.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CONTRACT_REWARD, EXTRACT_FEE, EXTRACT_TIME, INTEL_TIME, SEARCH_TIME, SUPPRESSED_NOISE } from '../src/shared/constants.ts';
import { yawToward } from '../src/shared/geom.ts';
import { ITEMS } from '../src/shared/loot.ts';

const GOLD = ITEMS.findIndex((i) => i.name === 'Gold bar');
import type { GameEvent, ServerMsg } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { RIFLE, WEAPONS } from '../src/shared/weapons.ts';
import { watchtower, World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const SUPPRESSOR = ITEMS.findIndex((i) => i.use === 'suppressor');

interface RunState {
  items: number[];
  contracts: Contract[];
}
type Body = PlayerState & { id: number; run: RunState; protection: number; name: string; recall: number };

function body(server: GameServer, id: number): Body {
  return (server as unknown as { players: Map<number, Body> }).players.get(id)!;
}

function internals(server: GameServer) {
  return server as unknown as {
    damage: (victim: Body, attacker: Body, amount: number, zone: string, weapon: number, x: number, y: number, z: number) => void;
    panelsBroke: (panels: number[], x: number, y: number, z: number, by: Body | undefined) => void;
  };
}

function human(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `h${id}`, world: DEFAULT_WORLD, mode: 'extraction' });
  let seq = 0;
  return {
    id,
    events: (): GameEvent[] => inbox.flatMap((m) => (m.t === 'events' ? m.events : [])),
    snap: () => [...inbox].reverse().find((m) => m.t === 'snapshot') as Extract<ServerMsg, { t: 'snapshot' }>,
    /** Hold `buttons` for this many commands, two per tick. */
    hold(buttons: number, commands: number, yaw: number, pitch = -0.3) {
      for (let i = 0; i < commands; i += 2) {
        server.receive(id, { t: 'input', cmds: [0, 1].map(() => ({ seq: ++seq, buttons, yaw, pitch })) });
        server.step();
      }
    },
  };
}

const runsServer = (guards = false) => new GameServer(DEFAULT_WORLD.seed, { mode: 'extraction', guards });

/** A contract of `kind`, from the first seed that plans one. */
function contractOf(world: World, kind: Contract['kind']): Contract {
  for (let seed = 1; seed < 200; seed++) {
    const c = planContracts(world, mulberry32(seed)).find((k) => k.kind === kind);
    if (c) return c;
  }
  throw new Error(`no ${kind} contract`);
}

describe('contracts', () => {
  it('plans one or two of different kinds at different outposts, the same from the same seed', () => {
    const world = new World(DEFAULT_WORLD.seed);
    expect(planContracts(world, mulberry32(4))).toEqual(planContracts(world, mulberry32(4)));
    const counts = new Set<number>();
    for (let seed = 1; seed < 60; seed++) {
      const cs = planContracts(world, mulberry32(seed));
      counts.add(cs.length);
      expect(new Set(cs.map((c) => c.kind)).size).toBe(cs.length);
      expect(new Set(cs.map((c) => c.outpost)).size).toBe(cs.length);
      for (const c of cs) {
        expect(c).toMatchObject({ state: 'open', reward: CONTRACT_REWARD[c.kind] });
        const o = world.outposts[c.outpost];
        if (c.kind === 'intel') expect(c.y).toBe(watchtower(o).y);
        if (c.kind === 'cache') {
          const p = world.panels[c.panel];
          expect(p.kind).toBe('crate');
          expect(Math.hypot(c.x - o.x, c.z - o.z)).toBeLessThan(16);
        }
      }
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('are handed to a human for the run, with a commander put on the island for its contract', () => {
    const server = runsServer();
    let h = human(server);
    for (let i = 0; i < 20 && !body(server, h.id).run.contracts.some((c) => c.kind === 'commander'); i++) h = human(server);
    const run = body(server, h.id).run;
    const c = run.contracts.find((k) => k.kind === 'commander')!;
    expect(c).toBeDefined();
    const commander = server.bots().find((b) => b.id === c.bot)!;
    expect(commander.name).toMatch(/^Commander /);
    expect(c.name).toBe(commander.name);
    expect(commander.team).toBe('guard');
    const o = server.world.outposts[c.outpost];
    expect(Math.hypot(commander.state.x - o.x, commander.state.z - o.z)).toBeLessThan(25);
    server.step();
    expect(h.snap().run?.contracts).toHaveLength(run.contracts.length);
  });

  it('pays for eliminating your commander, and fails when someone else does', () => {
    const server = runsServer();
    const humans = Array.from({ length: 20 }, () => human(server));
    const holders = humans.filter((h) => body(server, h.id).run.contracts.some((c) => c.kind === 'commander'));
    expect(holders.length).toBeGreaterThanOrEqual(2);
    const [a, b] = holders;
    const index = (h: typeof a) => body(server, h.id).run.contracts.findIndex((c) => c.kind === 'commander');
    const target = (h: typeof a) => body(server, body(server, h.id).run.contracts[index(h)].bot);

    internals(server).damage(target(a), body(server, a.id), 500, 'head', RIFLE, 0, 0, 0);
    internals(server).damage(target(b), body(server, a.id), 500, 'head', RIFLE, 0, 0, 0);
    server.step();
    expect(a.events()).toContainEqual({ k: 'contract', index: index(a), state: 'done' });
    expect(b.events()).toContainEqual({ k: 'contract', index: index(b), state: 'failed' });
  });

  it('calls a commander away when its run ends', () => {
    const server = runsServer();
    let h = human(server);
    for (let i = 0; i < 20 && !body(server, h.id).run.contracts.some((c) => c.kind === 'commander'); i++) h = human(server);
    const bot = body(server, h.id).run.contracts.find((c) => c.kind === 'commander')!.bot;
    server.step();
    server.disconnect(h.id);
    server.step();
    server.step();
    expect(server.bots().some((b) => b.id === bot)).toBe(false);
  });

  it('grabs the intel while F is held on it, and pays it on extraction', () => {
    const server = runsServer();
    const h = human(server);
    const me = body(server, h.id);
    const intel = contractOf(server.world, 'intel');
    me.run.contracts = [intel];
    me.run.items = [GOLD, GOLD];
    const t = watchtower(server.world.outposts[intel.outpost]);
    Object.assign(me, { x: t.x, y: t.y, z: t.z, vx: 0, vz: 0 });
    const face = yawToward(t.x, t.z, intel.x, intel.z);
    h.hold(0, 2, face);
    expect(h.snap().run).toMatchObject({ intel: 0, loot: null });

    h.hold(Btn.Interact, Math.round(INTEL_TIME * 60) - 20, face);
    expect(h.snap().run!.contracts[0].progress).toBeGreaterThan(0.8);
    expect(h.snap().run!.contracts[0].state).toBe('open');
    // Letting go starts it over.
    h.hold(0, 2, face);
    expect(h.snap().run!.contracts[0].progress).toBe(0);
    h.hold(Btn.Interact, Math.round(INTEL_TIME * 60) + 4, face);
    expect(h.events()).toContainEqual({ k: 'contract', index: 0, state: 'done' });
    expect(h.snap().run).toMatchObject({ intel: -1, contracts: [{ state: 'done' }] });

    const e = server.extracts.points[0];
    Object.assign(e, { open: true, next: Infinity });
    Object.assign(me, { x: e.x, z: e.z, y: server.world.groundHeight(e.x, e.z, server.world.floorHeight(e.x, e.z) + 0.5) });
    h.hold(0, Math.round(EXTRACT_TIME * 60) + 10, 0);
    expect(h.events()).toContainEqual(expect.objectContaining({
      k: 'runEnd', outcome: 'extracted', score: 2 * ITEMS[GOLD].value - EXTRACT_FEE + CONTRACT_REWARD.intel, contracts: [expect.objectContaining({ kind: 'intel', state: 'done' })],
    }));
  });

  it('counts a supply cache only for the one who holds the contract and breaks it', () => {
    const server = runsServer();
    const a = human(server);
    const b = human(server);
    const cache = contractOf(server.world, 'cache');
    body(server, a.id).run.contracts = [{ ...cache }];
    body(server, b.id).run.contracts = [{ ...cache }];
    const broke = server.cover.damage(cache.panel, 1e6, server.time);
    expect(broke).toContain(cache.panel);
    internals(server).panelsBroke(broke, cache.x, cache.y, cache.z, body(server, a.id));
    server.step();
    expect(a.events()).toContainEqual({ k: 'contract', index: 0, state: 'done' });
    expect(b.events().some((e) => e.k === 'contract')).toBe(false);
    expect(body(server, b.id).run.contracts[0].state).toBe('open');
  });
});

describe('suppressors', () => {
  it('are fitted to the weapon in hand when taken from a crate, and make its shots quiet', () => {
    const server = runsServer();
    const h = human(server);
    const other = human(server);
    const me = body(server, h.id);
    const crate = server.containers.crates()[0];
    crate.items = [SUPPRESSOR];
    const cx = (crate.minX + crate.maxX) / 2;
    const cz = (crate.minZ + crate.maxZ) / 2;
    const x = crate.maxX + 0.6;
    Object.assign(me, { x, z: cz, y: server.world.groundHeight(x, cz, crate.minY + 0.5), vx: 0, vz: 0 });
    const face = yawToward(x, cz, cx, cz);
    h.hold(Btn.Interact, Math.round(SEARCH_TIME * 60) + 4, face);
    h.hold(0, 4, face);
    h.hold(Btn.Interact, 4, face);
    expect(h.events()).toContainEqual({ k: 'took', item: SUPPRESSOR });
    expect(me.run.items).toEqual([]);
    expect(me.suppressed).toEqual([true, false, false]);
    expect(h.snap().you.suppressed).toEqual([true, false, false]);

    h.hold(Btn.Fire, 2, face, 1.2);
    expect(other.events()).toContainEqual(expect.objectContaining({ k: 'shot', id: h.id, quiet: true }));
  });
});

describe('noise', () => {
  /** A guard, and a spy on what it hears, with a human standing `d` metres from it. */
  function guardAndHuman(d: number) {
    const server = runsServer(true);
    const h = human(server);
    const g = server.bots().find((b) => b.team === 'guard' && b.name.endsWith('guard'))!;
    const me = body(server, h.id);
    const x = g.state.x + d;
    Object.assign(me, { x, z: g.state.z, y: server.world.groundHeight(x, g.state.z, 200), vx: 0, vz: 0, protection: Infinity });
    const hear = vi.spyOn(g.bot as Bot, 'hear');
    return { server, h, me, g, hear };
  }

  const gun = WEAPONS[RIFLE].noise;
  const between = (gun + gun * SUPPRESSED_NOISE) / 2;

  it('carries a shot as far as its weapon is loud', () => {
    const { h, hear } = guardAndHuman(between);
    h.hold(Btn.Fire, 2, 0, 1.2);
    expect(hear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ radius: gun, source: h.id }), expect.any(Number));
  });

  it('carries a suppressed shot a much shorter way', () => {
    const { h, me, hear } = guardAndHuman(between);
    me.suppressed[RIFLE] = true;
    h.hold(Btn.Fire, 2, 0, 1.2);
    expect(hear).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: h.id }), expect.any(Number));
  });

  it('is made by breaking cover, heard by guards around', () => {
    const { server, g, me, hear } = guardAndHuman(0);
    const wall = server.world.panels.findIndex((p) => {
      const b = p.box;
      return p.kind === 'wall' && !p.restsOn.length && Math.hypot((b.minX + b.maxX) / 2 - g.state.x, (b.minZ + b.maxZ) / 2 - g.state.z) < 60;
    });
    expect(wall).toBeGreaterThanOrEqual(0);
    const broke = server.cover.damage(wall, 1e6, server.time);
    internals(server).panelsBroke(broke, 0, 0, 0, me);
    expect(hear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ radius: 140, source: me.id }), expect.any(Number));
  });
});
