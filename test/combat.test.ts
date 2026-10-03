import { describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.ts';
import {
  BODY_TIME, Btn, CMDS_PER_TICK, DEATHCAM_AFTER, DEATHCAM_BEFORE, EYE_HEIGHT, MAX_HP, PLAYER_HEIGHT, SERVER_TICK_RATE,
} from '../src/shared/constants.ts';
import { hitboxes, type Pose } from '../src/shared/hitbox.ts';
import type { GameEvent, PlayerSnap, ServerMsg } from '../src/shared/protocol.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import type { PlayerState } from '../src/shared/sim.ts';
import { TapePlayer } from '../src/shared/tape.ts';
import { BOLT, WEAPONS } from '../src/shared/weapons.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

/** A connected client that can hold buttons and aim at points. */
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

/** Stand a body on the ground at (x, z), still and unprotected. */
function put(server: GameServer, id: number, x: number, z: number, yaw = 0) {
  const s = body(server, id) as PlayerState & { protection: number };
  const world = server.world;
  Object.assign(s, { x, z, y: world.groundHeight(x, z, world.terrainHeight(x, z)), vx: 0, vy: 0, vz: 0, yaw, protection: 0 });
}

/**
 * A shooter and a second player `dist` metres in front of it, in the open
 * with a clear line between them, away from the outposts and their commanders.
 */
function lane(server: GameServer, dist: number) {
  const world = server.world;
  const rand = mulberry32(7);
  const shooter = client(server);
  const target = client(server);
  for (;;) {
    const o = world.randomLandPoint(rand);
    const yaw = rand() * Math.PI * 2;
    const x = o.x - Math.sin(yaw) * dist;
    const z = o.z - Math.cos(yaw) * dist;
    const y = world.groundHeight(x, z, world.terrainHeight(x, z));
    if (world.outposts.some((p) => Math.hypot(p.x - o.x, p.z - o.z) < 120)) continue;
    if (!world.fits(o.x, o.y, o.z, PLAYER_HEIGHT) || !world.fits(x, y, z, PLAYER_HEIGHT)) continue;
    if (!world.hasLineOfSight(o.x, o.y + EYE_HEIGHT, o.z, x, y + 1.2, z)) continue;
    put(server, shooter.id, o.x, o.z, yaw);
    put(server, target.id, x, z, yaw + Math.PI);
    tick(server, [shooter, target], 1);
    return { shooter, target };
  }
}

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

describe('hits', () => {
  it('damages by zone and reports the hit to the shooter', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const { shooter: c, target } = lane(server, 15);
    readyBolt(server, c);
    fireAt(server, c, c.other(target.id), 'torso');
    const hit = c.events().find((e) => e.k === 'hit');
    expect(hit).toMatchObject({ k: 'hit', target: target.id, zone: 'torso', damage: WEAPONS[BOLT].damage >= MAX_HP ? MAX_HP : WEAPONS[BOLT].damage });
  });

  it('kills with a headshot, tells everyone, and ends the victim\'s run', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const { shooter: c, target } = lane(server, 22);
    readyBolt(server, c);
    fireAt(server, c, c.other(target.id), 'head');
    expect(c.events()).toContainEqual(expect.objectContaining({ k: 'hit', target: target.id, zone: 'head', killed: true }));
    expect(c.events()).toContainEqual(
      expect.objectContaining({ k: 'kill', killer: c.id, victim: target.id, head: true, weapon: BOLT }),
    );
    expect(c.other(target.id).dead).toBe(true);
    // Where the body fell from and which way the round went, to the centimetre, for the ragdoll.
    const kill = c.events().find((e) => e.k === 'kill')!;
    const dead = c.other(target.id);
    if (kill.k !== 'kill') throw new Error('no kill');
    expect(kill.pose.slice(0, 3)).toEqual([dead.x, dead.y, dead.z].map((v) => Math.round(v * 100) / 100));
    expect(kill.at[1]).toBeGreaterThan(dead.y + 1.4);
    expect(Math.hypot(...kill.dir)).toBeCloseTo(1, 1);
    const me = c.me();
    expect(kill.dir[0] * (dead.x - me.x) + kill.dir[2] * (dead.z - me.z)).toBeGreaterThan(0);
    for (const v of [...kill.pose, ...kill.at, ...kill.dir]) expect(Math.round(v * 100) / 100).toBe(v);
    expect(target.events()).toContainEqual(expect.objectContaining({ k: 'runEnd', outcome: 'killed' }));
    tick(server, [c], BODY_TIME * SERVER_TICK_RATE + 1);
    expect(c.other(target.id)).toBeUndefined();
    expect(server.humans()).toBe(1);
  });

  it('is stopped by walls', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const c = client(server);
    const target = client(server);
    const world = server.world;
    const wall = world.walls.find((b) => world.outposts.some((o) => Math.abs(b.maxY - o.y - 3) < 1e-6) && b.maxX - b.minX > 5)!;
    const x = (wall.minX + wall.maxX) / 2;
    put(server, target.id, x, wall.minZ - 2);
    put(server, c.id, x, wall.maxZ + 2);
    tick(server, [c], 1);
    readyBolt(server, c);
    fireAt(server, c, c.other(target.id), 'head');
    expect(c.events().filter((e) => e.k === 'hit')).toEqual([]);
    expect(body(server, target.id).hp).toBe(MAX_HP);
  });

  /** A target strafing across the shooter's view, and where the shooter saw it before it moved on. */
  function strafe(server: GameServer, ticks: number) {
    const { shooter: c, target } = lane(server, 15);
    readyBolt(server, c);
    const seen = { ...c.other(target.id) };
    const seenTick = server.tick;
    for (let i = 0; i < ticks; i++) {
      c.send(Btn.Aim);
      target.send(Btn.Left);
      server.step();
    }
    return { c, target, seen, seenTick };
  }

  it('judges shots against where the shooter saw a moving target', () => {
    const shoot = (rewind: boolean) => {
      const server = new GameServer(DEFAULT_WORLD.seed);
      const { c, target, seen, seenTick } = strafe(server, 6);
      const moved = Math.hypot(c.other(target.id).x - seen.x, c.other(target.id).z - seen.z);
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
    const { c, seen, seenTick } = strafe(server, SERVER_TICK_RATE);
    fireAt(server, c, seen, 'torso', seenTick);
    expect(c.events().some((e) => e.k === 'hit')).toBe(false);
  });
});

describe('player versus player', () => {
  it('protects fresh spawns, then kills and freezes the victim', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
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

    expect(b.events()).toContainEqual(expect.objectContaining({ k: 'runEnd', outcome: 'killed' }));
  });

  it('sends the victim a death cam that replays the killer exactly', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const { shooter: a, target: b } = lane(server, 12);
    body(server, b.id).hp = 1;
    a.wield(BOLT);
    // Walk about first, side by side, so there's movement to replay.
    tick(server, [a, b], 150, Btn.Left);
    tick(server, [a, b], 30, Btn.Aim);
    fireAt(server, a, a.other(b.id), 'torso');
    expect(b.me().dead).toBe(true);
    const kill = server.time;
    const killer = { ...a.me() };
    expect(b.events().some((e) => e.k === 'deathcam')).toBe(false);

    tick(server, [a, b], DEATHCAM_AFTER * SERVER_TICK_RATE + 1, Btn.Aim);
    const cam = b.events().find((e) => e.k === 'deathcam');
    if (cam?.k !== 'deathcam') throw new Error('no death cam');
    expect(cam).toMatchObject({ killer: a.id, name: `p${a.id}`, time: kill });

    const player = new TapePlayer(server.world, cam.clip);
    expect(player.start).toBeLessThanOrEqual(kill - DEATHCAM_BEFORE);
    let shots = 0;
    player.seek(kill - 1e-6, (fx) => void (fx.k === 'shot' && shots++));
    expect(shots).toBe(1);
    expect([player.state.x, player.state.y, player.state.z, player.state.yaw]).toEqual([killer.x, killer.y, killer.z, killer.yaw]);
  });

  it('sends other players the tracer of every shot', () => {
    const server = new GameServer(DEFAULT_WORLD.seed);
    const a = client(server);
    const b = client(server);
    tick(server, [a, b], 1);
    a.send(Btn.Fire);
    server.step();
    expect(b.events().filter((e) => e.k === 'shot')).toHaveLength(1);
    expect(a.events().filter((e) => e.k === 'shot')).toHaveLength(0);
  });
});
