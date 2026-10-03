import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/nav.ts';
import { planCommander } from '../src/server/population.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMDS_PER_TICK, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import type { PlayerSnap, ServerMsg } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { PISTOL } from '../src/shared/weapons.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// What others see of a player besides where they are: how they're moving,
// what their hands are doing, a suppressor and a commander's markings.

function client(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `p${id}`, world: DEFAULT_WORLD, mode: 'extraction' });
  let seq = 0;
  let weapon = 0;
  return {
    id,
    /** How this client last saw player `other`. */
    sees(other: number): PlayerSnap {
      const s = inbox.filter((m) => m.t === 'snapshot').at(-1);
      if (s?.t !== 'snapshot') throw new Error('no snapshot yet');
      return s.players.find((p) => p.id === other)!;
    },
    send(buttons: number) {
      const cmds = [];
      // Looking up at the sky, so rounds hit nothing.
      for (let i = 0; i < CMDS_PER_TICK; i++) cmds.push({ seq: ++seq, buttons, yaw: 0, pitch: 1.2, weapon });
      server.receive(id, { t: 'input', cmds });
    },
    wield(w: number) {
      weapon = w;
    },
  };
}

type Client = ReturnType<typeof client>;

function tick(server: GameServer, clients: Client[], ticks: number, buttons: (c: Client) => number = () => 0) {
  for (let i = 0; i < ticks; i++) {
    for (const c of clients) c.send(buttons(c));
    server.step();
  }
}

function body(server: GameServer, id: number): PlayerState {
  return (server as unknown as { players: Map<number, PlayerState> }).players.get(id)!;
}

function setup() {
  const server = new GameServer(DEFAULT_WORLD.seed);
  const watcher = client(server);
  const actor = client(server);
  // Settle onto the ground and let spawn draws finish.
  tick(server, [watcher, actor], SERVER_TICK_RATE);
  return { server, watcher, actor };
}

describe('what others see', () => {
  it('starts standing, hands free, no suppressor', () => {
    const { watcher, actor } = setup();
    expect(watcher.sees(actor.id)).toMatchObject({ motion: 'ground', act: 'none', actT: 0, quiet: false, commander: false });
  });

  it('shows a reload and how far through it is', () => {
    const { server, watcher, actor } = setup();
    tick(server, [watcher, actor], 3, (c) => (c === actor ? Btn.Fire : 0));
    tick(server, [watcher, actor], 1, (c) => (c === actor ? Btn.Reload : 0));
    const early = watcher.sees(actor.id);
    expect(early.act).toBe('reload');
    tick(server, [watcher, actor], SERVER_TICK_RATE);
    const later = watcher.sees(actor.id);
    expect(later.act).toBe('reload');
    expect(later.actT).toBeGreaterThan(early.actT);
    tick(server, [watcher, actor], SERVER_TICK_RATE * 3);
    expect(watcher.sees(actor.id).act).toBe('none');
  });

  it('tells a weapon switch from a grenade throw', () => {
    const { server, watcher, actor } = setup();
    actor.wield(PISTOL);
    tick(server, [watcher, actor], 1);
    expect(watcher.sees(actor.id).act).toBe('draw');
    tick(server, [watcher, actor], SERVER_TICK_RATE);
    expect(watcher.sees(actor.id).act).toBe('none');
    tick(server, [watcher, actor], 1, (c) => (c === actor ? Btn.Throw : 0));
    expect(watcher.sees(actor.id).act).toBe('throw');
    tick(server, [watcher, actor], SERVER_TICK_RATE);
    expect(watcher.sees(actor.id).act).toBe('none');
    // The next switch is a switch again.
    actor.wield(0);
    tick(server, [watcher, actor], 1);
    expect(watcher.sees(actor.id).act).toBe('draw');
  });

  it('shows a jump as in the air', () => {
    const { server, watcher, actor } = setup();
    tick(server, [watcher, actor], 2, (c) => (c === actor ? Btn.Jump : 0));
    expect(watcher.sees(actor.id).motion).toBe('air');
    tick(server, [watcher, actor], SERVER_TICK_RATE * 2);
    expect(watcher.sees(actor.id).motion).toBe('ground');
  });

  it('shows a suppressor on the weapon in hand only', () => {
    const { server, watcher, actor } = setup();
    body(server, actor.id).suppressed[PISTOL] = true;
    tick(server, [watcher, actor], 1);
    expect(watcher.sees(actor.id).quiet).toBe(false);
    actor.wield(PISTOL);
    tick(server, [watcher, actor], 1);
    expect(watcher.sees(actor.id).quiet).toBe(true);
  });

  it('marks commanders', () => {
    const world = new World(DEFAULT_WORLD.seed);
    const nav = new NavGrid(world);
    const plan = planCommander(world, nav, mulberry32(1), world.outposts[0], new Set());
    expect(plan?.commander).toBe(true);
  });
});
