import * as THREE from 'three';
import { CMD_DT, WALK_SPEED } from '../shared/constants.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { rayBody } from '../shared/hitbox.ts';
import { FixedLoop } from '../shared/loop.ts';
import { extractName } from '../shared/loot.ts';
import { isReliable, type ClientMsg, type GameEvent, type Mode, type ServerMsg } from '../shared/protocol.ts';
import { eyePosition, type PlayerState } from '../shared/sim.ts';
import { BOLT, spreadOf, WEAPONS, type Shot } from '../shared/weapons.ts';
import { LagTransport } from '../shared/transport.ts';
import { World } from '../shared/world.ts';
import { DEFAULT_WORLD, parseWorldParam } from '../shared/worldconfig.ts';
import { loadAssets } from './assets.ts';
import { Sfx } from './audio.ts';
import { Bags } from './bags.ts';
import { Bodies, strideLength } from './bodies.ts';
import { CHANGELOG } from './changelog.ts';
import { ContractProps } from './contractprops.ts';
import { Connection, WorkerTransport } from './connection.ts';
import { Effects, type Struck } from './effects.ts';
import { Grenades } from './grenades.ts';
import { bearing, Hud } from './hud.ts';
import { Input } from './input.ts';
import { NetPanel } from './netpanel.ts';
import type { Rendered } from './prediction.ts';
import { Resolution } from './resolution.ts';
import { contractTitle, RunHud, type RunEnd } from './runhud.ts';
import { Surfaces } from './surface.ts';
import { ViewModel } from './viewmodel.ts';
import { WorldView } from './worldview.ts';
import './style.css';

const MENU_ORBIT_RADIUS = 360;
const MENU_ORBIT_SPEED = 0.025;
const MENU_FOV = 60;
const PLAY_FOV = 75;
/** How far other players' tracers start in front of their eye, roughly at the muzzle. */
const MUZZLE_REACH = 0.7;
/** Seconds for the death camera to sink to the ground. */
const DEATH_FALL = 0.6;
/** Seconds of the death camera before the results come up. */
const RESULTS_DELAY_DEAD = 2.2;
/** Camera shake from a blast this close, fading out to nothing at SHAKE_RANGE. */
const SHAKE_RANGE = 30;
const SHAKE_DECAY = 5;
const MODE_NOTES: Record<Mode, string> = {
  mixed: 'Loot and get out, against guards and eleven other operators.',
  pve: 'Loot and get out. Just you against the guards.',
  range: 'Target practice. No clock, and you respawn.',
};

const config = parseWorldParam(new URLSearchParams(location.search).get('world'));
const world = new World(config.seed);
const view = new WorldView(world);
const scene = view.scene;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const resolution = new Resolution(renderer);
// Two passes a frame; count both.
renderer.info.autoReset = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The viewmodel draws in a second pass over a cleared depth buffer.
renderer.autoClear = false;
document.body.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(MENU_FOV, 1, 0.05, 2000);
camera.rotation.order = 'YXZ';
const viewModel = new ViewModel();

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  viewModel.resize(camera.aspect);
}
window.addEventListener('resize', resize);
resize();

const effects = new Effects(scene, (x, z) => world.floorHeight(x, z));
const grenades = new Grenades(scene);
const bodies = new Bodies(scene);
const bags = new Bags(scene);
const hud = new Hud();
const runHud = new RunHud(world);
const contractProps = new ContractProps(scene, world);
const sfx = new Sfx();
const surfaces = new Surfaces(world);
bodies.onStep = (x, y, z, speed, crouched) => sfx.step(surfaces.at(x, y, z), speed, crouched, { x, y, z });
const extractNames = world.extracts.map((_, i) => extractName(world, i));

loadAssets(renderer).then((assets) => {
  view.applyAssets(assets);
  bodies.setModel(assets.soldier, assets.guns);
  viewModel.setGuns(assets.guns, assets.environment);
  if (import.meta.env.DEV) Object.assign(window, { assets });
}, (err: unknown) => console.warn('Assets failed to load; staying with flat colours.', err));

// ------------------------------------------------------------------ menu

const menu = document.getElementById('menu')!;
const paused = document.getElementById('paused')!;
const playButton = document.getElementById('play') as HTMLButtonElement;
document.getElementById('world-label')!.textContent =
  config.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${config.seed}`;

let conn: Connection | null = null;
let panel: NetPanel | null = null;
/** One pipe to the local game host for the whole session; each run joins through it. */
let transport: LagTransport<ClientMsg, ServerMsg> | null = null;
const input = new Input(window, renderer.domElement);

// Sample input at the fixed command rate, independent of frame rate.
const inputLoop = new FixedLoop(CMD_DT, () => conn?.sendCmd(input.sample(), input.yaw, input.pitch, input.weapon), 8);

// ------------------------------------------------------------------ modes

const modeNote = document.getElementById('mode-note')!;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('#modes button')];
let mode: Mode = 'mixed';
try {
  const saved = localStorage.getItem('mode');
  if (saved === 'mixed' || saved === 'pve' || saved === 'range') mode = saved;
} catch {
  // Storage may be blocked; the default will do.
}

function selectMode(m: Mode): void {
  mode = m;
  for (const b of modeButtons) {
    const on = b.dataset.mode === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  modeNote.textContent = MODE_NOTES[m];
  try {
    localStorage.setItem('mode', m);
  } catch {
    // Not remembered, that's all.
  }
}
for (const b of modeButtons) b.onclick = () => selectMode(b.dataset.mode as Mode);
selectMode(mode);

// ------------------------------------------------------------- what's new

const news = document.getElementById('news')!;
const newsOpen = document.getElementById('news-open') as HTMLButtonElement;
const newsDot = newsOpen.querySelector('.dot') as HTMLElement;
/** Updates seen are remembered by how many there were, so a new one lights the dot. */
let seenUpdates = CHANGELOG.length;
try {
  const saved = localStorage.getItem('seenUpdates');
  seenUpdates = saved === null ? 0 : Number(saved) || 0;
} catch {
  // Storage may be blocked; no dot then.
}
newsDot.hidden = seenUpdates >= CHANGELOG.length;

news.querySelector('.entries')!.replaceChildren(...CHANGELOG.map((entry) => {
  const section = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = entry.title;
  const date = document.createElement('time');
  date.dateTime = entry.date;
  date.textContent = new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const list = document.createElement('ul');
  list.append(...entry.notes.map((note) => {
    const li = document.createElement('li');
    li.textContent = note;
    return li;
  }));
  section.append(title, date, list);
  return section;
}));

function showNews(open: boolean): void {
  news.hidden = !open;
  if (open) {
    newsDot.hidden = true;
    try {
      localStorage.setItem('seenUpdates', String(CHANGELOG.length));
    } catch {
      // Not remembered, that's all.
    }
    (document.getElementById('news-close') as HTMLButtonElement).focus();
  } else newsOpen.focus();
}
newsOpen.onclick = () => showNews(true);
document.getElementById('news-close')!.onclick = () => showNews(false);
news.onclick = (e) => {
  if (e.target === news) showNews(false);
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !news.hidden) showNews(false);
});

// ------------------------------------------------------------------ runs

/** Quick join: a new connection, and so a new run, through the shared transport. */
function join(): void {
  transport ??= new LagTransport(new WorkerTransport(), isReliable);
  panel ??= new NetPanel(transport);
  conn = new Connection(config, world, mode, transport);
  conn.onFx = (fx) => {
    if (fx.k === 'shot') ownShot(fx.shot);
    else if (fx.k === 'throw') sfx.toss();
    else if (fx.k === 'dry') sfx.dry();
    else if (fx.k === 'reload') sfx.reload(fx.weapon);
    else if (fx.k === 'reloaded') sfx.reloaded();
    else sfx.draw();
  };
  conn.onEvents = (events) => events.forEach(onEvent);
  conn.onWelcome = (broken) => {
    world.syncPanels(broken);
    view.syncPanels();
  };
  conn.onSpawn = (s) => {
    input.yaw = s.yaw;
    input.pitch = s.pitch;
  };
  panel.conn = conn;
  hud.runs = mode !== 'range';
  hud.reset();
  hud.show();
  runHud.hideResults();
  // Shown until the lock succeeds, so a refused lock still leaves a way in.
  paused.hidden = false;
  input.lock();
}

function play(): void {
  if (conn) return;
  sfx.unlock();
  menu.hidden = true;
  join();
}

/** The run ended: let the death camera play out, then show the results. */
function endRun(e: RunEnd): void {
  if (!conn) return;
  conn.over = true;
  sfx.runEnd(e.outcome === 'extracted');
  const shown = conn;
  setTimeout(() => {
    if (conn !== shown) return;
    document.exitPointerLock();
    paused.hidden = true;
    runHud.showResults(e);
  }, e.outcome === 'killed' ? RESULTS_DELAY_DEAD * 1000 : 300);
}

function toMenu(): void {
  conn?.leave();
  conn = null;
  if (panel) panel.conn = null;
  runHud.hideResults();
  document.getElementById('hud')!.hidden = true;
  paused.hidden = true;
  menu.hidden = false;
  bodies.update([], 0);
  bags.update([]);
  grenades.update([]);
  playButton.focus();
}

document.getElementById('again')!.onclick = () => {
  conn?.leave();
  join();
};
document.getElementById('to-menu')!.onclick = toMenu;

input.onLockChange = (locked) => {
  if (conn && !conn.over) paused.hidden = locked;
};
paused.onclick = () => input.lock();

playButton.onclick = play;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !conn && news.hidden && document.activeElement !== newsOpen) play();
});
playButton.focus();

// --------------------------------------------------------------- shooting

const from = new THREE.Vector3();
const to = new THREE.Vector3();
const normal = new THREE.Vector3();

/** Show where a round stopped: tracer from `from` to `to`, and the impact there; a suppressed one has no flash. */
function showRound(struck: Struck, dx: number, dy: number, dz: number, quiet: boolean): void {
  effects.tracer(from, to);
  if (struck === 'world') normal.fromArray(world.surfaceNormal(to.x, to.y, to.z));
  else normal.set(-dx, -dy, -dz);
  effects.impact(to, struck, normal);
  if (!quiet) effects.muzzleLight(from);
}

/**
 * Our own round, predicted the moment it's fired: the same world raycast and
 * body tests as the server, against the bodies as we see them. Damage waits
 * for the server to confirm.
 */
function ownShot(shot: Shot): void {
  viewModel.fire(shot.weapon);
  sfx.shot(shot.weapon, undefined, shot.quiet);
  const { ox, oy, oz, dx, dy, dz } = shot;
  const range = WEAPONS[shot.weapon].range;
  let t = world.raycast(ox, oy, oz, dx, dy, dz, range);
  let struck: Struck = t <= range ? 'world' : 'none';
  t = Math.min(t, range);
  for (const p of conn?.interpolated() ?? []) {
    if (p.dead) continue;
    const hit = rayBody(p, ox, oy, oz, dx, dy, dz, t);
    if (hit && hit.t < t) (t = hit.t), (struck = 'body');
  }
  from.copy(viewModel.muzzleOffset()).applyQuaternion(camera.quaternion).add(camera.position);
  to.set(ox + dx * t, oy + dy * t, oz + dz * t);
  showRound(struck, dx, dy, dz, shot.quiet);
}

function onEvent(e: GameEvent): void {
  const me = conn?.predictor.state;
  switch (e.k) {
    case 'hit':
      hud.hit(e.zone, e.killed, e.damage, e.x, e.y, e.z);
      sfx.hit(e.zone === 'head', e.killed);
      bodies.flash(e.target);
      break;
    case 'hurt':
      if (me) hud.hurtFrom(e.damage, bearing(me.x, me.z, input.yaw, e.x, e.z));
      sfx.hurt();
      break;
    case 'kill':
      hud.kill(e, conn!.id);
      break;
    case 'extract':
      hud.extract(e, conn!.id);
      break;
    case 'call':
      hud.call(e, extractNames[e.index], conn!.id);
      sfx.call();
      break;
    case 'took':
      sfx.pickup();
      break;
    case 'contract': {
      const c = conn?.run?.contracts[e.index];
      if (c) hud.contract(contractTitle(c), e.state);
      if (e.state === 'done') sfx.pickup();
      break;
    }
    case 'runEnd':
      endRun(e);
      break;
    case 'break': {
      const color = new THREE.Color();
      for (const id of e.panels) {
        world.setPanel(id, false);
        view.updatePanel(id);
        effects.shatter(world.panels[id].box, view.panelColor(id, color), e.x, e.y, e.z);
      }
      const first = world.panels[e.panels[0]];
      if (first) {
        const b = first.box;
        sfx.crumble(first.kind !== 'wall', { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 });
      }
      break;
    }
    case 'repair':
      for (const id of e.panels) {
        world.setPanel(id, true);
        view.updatePanel(id);
      }
      break;
    case 'boom': {
      const d = me ? Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z) : Infinity;
      effects.explosion(to.set(e.x, e.y, e.z));
      sfx.boom(e);
      shake = Math.max(shake, clamp(1 - d / SHAKE_RANGE, 0, 1));
      break;
    }
    case 'shot': {
      const d = Math.hypot(e.ex - e.ox, e.ey - e.oy, e.ez - e.oz) || 1;
      const dx = (e.ex - e.ox) / d;
      const dy = (e.ey - e.oy) / d;
      const dz = (e.ez - e.oz) / d;
      // From the shooter's muzzle as drawn, unless it's somewhere else entirely.
      bodies.fire(e.id, e.quiet);
      const muzzle = bodies.muzzle(e.id, from);
      if (!muzzle || muzzle.distanceToSquared(to.set(e.ox, e.oy, e.oz)) > 9) {
        from.set(e.ox + dx * MUZZLE_REACH, e.oy - 0.1, e.oz + dz * MUZZLE_REACH);
      }
      to.set(e.ex, e.ey, e.ez);
      showRound(e.struck, dx, dy, dz, e.quiet);
      sfx.shot(e.weapon, { x: e.ox, y: e.oy, z: e.oz }, e.quiet);
      break;
    }
  }
}

// ------------------------------------------------------------------ frame

const focus = new THREE.Vector3();
const start = performance.now() / 1000;
let last = start;
let lastYaw = 0;
let lastPitch = 0;
let deadFor = 0;
/** Camera shake, 0 to 1, decaying. */
let shake = 0;
/** Our own footfalls: where we were, distance since the last step, and how we were falling. */
const own = { x: 0, z: 0, stride: 0, air: false, fall: 0 };

function orbitCamera(now: number): void {
  const a = (now - start) * MENU_ORBIT_SPEED + 0.6;
  camera.position.set(Math.sin(a) * MENU_ORBIT_RADIUS, world.maxHeight + 90, Math.cos(a) * MENU_ORBIT_RADIUS);
  camera.lookAt(0, 0, 0);
  focus.set(0, 0, 0);
  view.update(camera, focus, world.half);
}

/** First-person camera and weapon. Look uses the live mouse, not the last command, so aiming has no latency. */
function eyeCamera(me: Rendered, s: PlayerState, dt: number): void {
  const w = WEAPONS[s.weapon];
  const aim = smoothstep(0, 1, me.aim);
  const zoom = lerp(1, w.zoom, aim);
  const fov = (2 * Math.atan(Math.tan((PLAY_FOV * Math.PI) / 360) / zoom) * 180) / Math.PI;
  if (Math.abs(camera.fov - fov) > 1e-3) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  input.lookScale = 1 / zoom;

  const eye = eyePosition(world, me.x, me.y, me.z, input.yaw, me.duck, me.lean);
  deadFor = s.dead ? deadFor + dt : 0;
  const down = smoothstep(0, DEATH_FALL, deadFor);
  camera.position.set(eye.x, lerp(eye.y, me.y + 0.3, down), eye.z);
  camera.rotation.set(input.pitch + me.recoilPitch, input.yaw + me.recoilYaw, eye.roll + down * 0.5);
  shake = Math.max(shake - SHAKE_DECAY * dt * shake - dt * 0.2, 0);
  if (shake > 0) {
    const k = shake * shake * 0.05;
    camera.rotation.x += (Math.random() - 0.5) * k;
    camera.rotation.y += (Math.random() - 0.5) * k;
    camera.rotation.z += (Math.random() - 0.5) * k * 0.5;
  }
  focus.set(me.x, me.y, me.z);
  view.update(camera, focus, 70);

  const speed = Math.hypot(s.vx, s.vz);
  const lookDx = angleDiff(lastYaw, input.yaw) * 600;
  const lookDy = (lastPitch - input.pitch) * 600;
  lastYaw = input.yaw;
  lastPitch = input.pitch;
  viewModel.update(dt, {
    weapon: s.weapon,
    aim: me.aim,
    reload: s.reload > 0 ? 1 - s.reload / w.reloadTime : 0,
    draw: Math.min(s.draw / w.drawTime, 1),
    speed,
    onGround: s.onGround,
    sprinting: sprinting(s),
    suppressed: s.suppressed[s.weapon],
  }, lookDx, lookDy);
  viewModel.hidden = s.dead || (s.weapon === BOLT && me.aim > 0.9);
}

/** Our own footsteps and landings, from the predicted state. */
function footsteps(s: PlayerState): void {
  const moved = Math.hypot(s.x - own.x, s.z - own.z);
  own.x = s.x;
  own.z = s.z;
  if (s.dead || moved > 3) {
    own.stride = 0;
    return;
  }
  if (!s.onGround) {
    own.air = true;
    own.fall = Math.max(own.fall, -s.vy);
    return;
  }
  const surface = surfaces.at(s.x, s.y, s.z);
  if (own.air) {
    if (own.fall > 4) sfx.land(surface, own.fall);
    own.air = false;
    own.fall = 0;
    own.stride = 0;
  }
  // A slide scrapes along rather than stepping.
  if (s.slide > 0) return;
  own.stride += moved;
  const speed = Math.hypot(s.vx, s.vz);
  if (own.stride >= strideLength(speed)) {
    own.stride = 0;
    sfx.step(surface, speed, s.crouched);
  }
}

function sprinting(s: PlayerState): boolean {
  return s.onGround && !s.crouched && s.slide <= 0 && Math.hypot(s.vx, s.vz) > WALK_SPEED + 0.3;
}

if (import.meta.env.DEV) {
  // For poking at the game from the console or a test browser.
  Object.assign(window, { THREE, game: { camera, scene, renderer, view, bodies, sfx, world, viewModel, get conn() { return conn; } } });
}

renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  resolution.update(now - last);
  const dt = Math.min(now - last, 0.1);
  last = now;

  const players = conn ? (conn.update(dt), inputLoop.advance(now), conn.interpolated()) : [];
  bodies.update(players, dt, camera);
  bags.update(conn?.bags ?? []);
  grenades.update(conn?.grenades() ?? []);
  if (conn) view.setExtracts(conn.extracts, now);

  const me = conn?.predictor.render(inputLoop.alpha);
  const state = conn?.predictor.state ?? null;
  if (me && state) {
    eyeCamera(me, state, dt);
    footsteps(state);
  } else orbitCamera(now);
  camera.updateMatrixWorld();
  sfx.listen(camera);
  effects.update(dt);

  if (conn) {
    const spread = state ? spreadOf(state) : 0;
    const spreadPx = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2);
    hud.update(dt, state, me?.aim ?? 0, clamp(spreadPx, 0, innerHeight / 3), !!state && sprinting(state), camera);
    if (me && !conn.over) runHud.update(conn.run, conn.extracts, me.x, me.z, input.yaw, camera);
    else runHud.update(null, [], 0, 0, 0, camera);
  }
  contractProps.update(conn && !conn.over ? (conn.run?.contracts ?? []) : []);
  panel?.update(
    `${resolution.fps.toFixed(0)} fps  ${resolution.frameMs.toFixed(1)} ms  ` +
    `res ${(resolution.share * 100).toFixed(0)}%  draws ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k`,
  );

  renderer.info.reset();
  renderer.clear();
  renderer.render(scene, camera);
  if (state) {
    renderer.clearDepth();
    renderer.render(viewModel.scene, viewModel.camera);
  }
});
