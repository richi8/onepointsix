import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMDS_PER_TICK, EYE_HEIGHT, MAX_HP, RESPAWN_TIME, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { hitboxes, type Pose } from '../src/shared/hitbox.ts';
import type { GameEvent, PlayerSnap, ServerMsg } from '../src/shared/protocol.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { BOLT, WEAPONS } from '../src/shared/weapons.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

/** A connected client that can hold buttons and aim at points. */
function client(server: GameServer) {
  const inbox: ServerMsg[] = [];
  const id = server.connect((m) => inbox.push(m));
  server.receive(id, { t: 'hello', name: `p${id}`, world: DEFAULT_WORLD, mode: 'range' });
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
    events: (): GameEvent[] => inbox.flatMap((m) => (m.t === 'events' ? m.events : [])),
    me: (): PlayerState => snapshot().you,
    other: (other: number): PlayerSnap => snapshot().players.find((p) => p.id === other)!,
    /** Queue one tick's worth of commands holding `buttons`. */
    send(buttons: number, view?: number) {
      const cmds = [];
      for (let i = 0; i < CMDS_PER_TICK; i++) cmds.push({ seq: ++seq, buttons, yaw, pitch, weapon, view });
      server.receive(id, { t: 'input', cmds });
    },
    /** Look at a point from the current eye. */
    lookAt(x: number, y: number, z: number) {
      const me = snapshot().you;
      const dx = x - me.x;
      const dy = y - (me.y + EYE_HEIGHT);
      const dz = z - me.z;
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(dy, Math.hypot(dx, dz));
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

/** Server internals, for putting bodies exactly where a test needs them. */
function body(server: GameServer, id: number): PlayerState {
  return (server as unknown as { players: Map<number, PlayerState> }).players.get(id)!;
}

const dummyId = (server: GameServer, kind: string, nth = 0) =>
  server.range.dummies.map((d, i) => ({ ...d, id: i + 1 })).filter((d) => d.kind === kind)[nth].id;

/** Bring up the bolt-action, go down the sights, and settle. */
function readyBolt(server: GameServer, c: Client) {
  c.wield(BOLT);
  tick(server, [c], SERVER_TICK_RATE * 1.5, Btn.Aim);
}

function fireAt(server: GameServer, c: Client, target: Pose, part: 'head' | 'torso', view?: number) {
  const h = hitboxes(target);
  if (part === 'head') c.lookAt(h.headX, h.headY, h.headZ);
  else c.lookAt(h.torsoX, (h.hipY + h.neckY) / 2, h.torsoZ);
  c.send(Btn.Aim | Btn.Fire, view);
  server.step();
}

describe('shooting range', () => {
  it('lays out every dummy in view of the spawn', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    expect(server.range.dummies).toHaveLength(10);
    const c = client(server);
    server.step();
    const me = c.me();
    const o = server.range.origin;
    expect(Math.hypot(me.x - o.x, me.z - o.z)).toBeLessThan(3.5);
    expect(me.yaw).toBeCloseTo(o.yaw);
    for (const d of server.range.dummies) {
      expect(server.world.hasLineOfSight(o.x, o.y + EYE_HEIGHT, o.z, d.x, d.y + 1.2, d.z)).toBe(true);
    }
  });

  it('lets tests turn the dummies off', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { dummies: false });
    const c = client(server);
    tick(server, [c], 1);
    expect(server.range.dummies.length).toBeGreaterThan(0);
    expect(c.other(1)).toBeDefined();
    expect(c.other(2)).toBeUndefined();
  });
});

describe('hits', () => {
  it('damages a dummy by zone and reports the hit to the shooter', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const c = client(server);
    const target = dummyId(server, 'still', 1);
    readyBolt(server, c);
    fireAt(server, c, c.other(target), 'torso');
    const hit = c.events().find((e) => e.k === 'hit');
    expect(hit).toMatchObject({ k: 'hit', target, zone: 'torso', damage: WEAPONS[BOLT].damage >= MAX_HP ? MAX_HP : WEAPONS[BOLT].damage });
  });

  it('kills with a headshot, tells everyone, and respawns the dummy', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const c = client(server);
    const target = dummyId(server, 'still', 2);
    readyBolt(server, c);
    const before = body(server, target).life;
    fireAt(server, c, c.other(target), 'head');
    expect(c.events()).toContainEqual(expect.objectContaining({ k: 'hit', target, zone: 'head', killed: true }));
    expect(c.events()).toContainEqual(
      expect.objectContaining({ k: 'kill', killer: c.id, victim: target, head: true, weapon: BOLT }),
    );
    expect(c.other(target).dead).toBe(true);
    tick(server, [c], RESPAWN_TIME * SERVER_TICK_RATE + 1);
    expect(c.other(target).dead).toBe(false);
    expect(body(server, target).hp).toBe(MAX_HP);
    expect(body(server, target).life).toBe(before + 1);
  });

  it('is stopped by walls', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const c = client(server);
    const target = dummyId(server, 'still');
    const world = server.world;
    const wall = world.walls.find((b) => world.outposts.some((o) => Math.abs(b.maxY - o.y - 3) < 1e-6) && b.maxX - b.minX > 5)!;
    const x = (wall.minX + wall.maxX) / 2;
    const put = (s: PlayerState, z: number) => {
      s.x = x;
      s.z = z;
      s.y = world.groundHeight(x, z, world.terrainHeight(x, z));
    };
    put(body(server, target), wall.minZ - 2);
    put(body(server, c.id), wall.maxZ + 2);
    body(server, c.id).yaw = 0;
    readyBolt(server, c);
    fireAt(server, c, c.other(target), 'head');
    expect(c.events().filter((e) => e.k === 'hit')).toEqual([]);
    expect(body(server, target).hp).toBe(MAX_HP);
  });

  it('judges shots against where the shooter saw a moving target', () => {
    const shoot = (rewind: boolean) => {
      const server = new GameServer(DEFAULT_WORLD.seed);
      const c = client(server);
      const target = dummyId(server, 'strafe');
      readyBolt(server, c);
      const seen = { ...c.other(target) };
      const seenTick = server.tick;
      tick(server, [c], 6, Btn.Aim);
      const moved = Math.hypot(c.other(target).x - seen.x, c.other(target).z - seen.z);
      fireAt(server, c, seen, 'torso', rewind ? seenTick : undefined);
      return { moved, hit: c.events().some((e) => e.k === 'hit') };
    };
    const late = shoot(false);
    const rewound = shoot(true);
    expect(late.moved).toBeGreaterThan(0.6);
    expect(late.hit).toBe(false);
    expect(rewound.hit).toBe(true);
  });

  it('never rewinds further than the limit', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const c = client(server);
    const target = dummyId(server, 'strafe');
    readyBolt(server, c);
    const seen = { ...c.other(target) };
    const seenTick = server.tick;
    tick(server, [c], SERVER_TICK_RATE, Btn.Aim);
    fireAt(server, c, seen, 'torso', seenTick);
    expect(c.events().some((e) => e.k === 'hit')).toBe(false);
  });
});

describe('player versus player', () => {
  it('protects fresh spawns, then kills, freezes and respawns the victim', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { dummies: false });
    const a = client(server);
    const b = client(server);
    // Stand b well in front of a.
    tick(server, [a, b], 1);
    const s = body(server, b.id);
    const me = a.me();
    s.x = me.x - Math.sin(me.yaw) * 12;
    s.z = me.z - Math.cos(me.yaw) * 12;
    s.y = server.world.groundHeight(s.x, s.z, server.world.terrainHeight(s.x, s.z));
    a.wield(BOLT);
    tick(server, [a, b], 25, Btn.Aim);
    fireAt(server, a, a.other(b.id), 'torso');
    expect(a.events()).toContainEqual(expect.objectContaining({ k: 'hit', target: b.id, damage: 0 }));

    tick(server, [a, b], 60, Btn.Aim);
    fireAt(server, a, a.other(b.id), 'head');
    expect(b.events()).toContainEqual(expect.objectContaining({ k: 'hurt', damage: MAX_HP }));
    expect(b.events()).toContainEqual(expect.objectContaining({ k: 'kill', victim: b.id, killerName: `p${a.id}` }));
    expect(b.me().dead).toBe(true);
    expect(b.me().hp).toBe(0);

    const dead = b.me();
    tick(server, [b], 10, Btn.Forward | Btn.Fire);
    expect([b.me().x, b.me().z, b.me().mag[0]]).toEqual([dead.x, dead.z, dead.mag[0]]);

    tick(server, [a, b], RESPAWN_TIME * SERVER_TICK_RATE);
    expect(b.me()).toMatchObject({ dead: false, hp: MAX_HP, life: 2 });
  });

  it('sends other players the tracer of every shot', () => {
    const server = new GameServer(DEFAULT_WORLD.seed, { dummies: false });
    const a = client(server);
    const b = client(server);
    tick(server, [a, b], 1);
    a.send(Btn.Fire);
    server.step();
    expect(b.events().filter((e) => e.k === 'shot')).toHaveLength(1);
    expect(a.events().filter((e) => e.k === 'shot')).toHaveLength(0);
  });
});
