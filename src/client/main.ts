import * as THREE from 'three';
import { CMD_DT, WALK_SPEED } from '../shared/constants.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { rayBody } from '../shared/hitbox.ts';
import { FixedLoop } from '../shared/loop.ts';
import { extractName } from '../shared/loot.ts';
import { isReliable, type ClientMsg, type GameEvent, type Mode, type PlayerSnap, type ServerMsg } from '../shared/protocol.ts';
import { eyePosition, type PlayerState } from '../shared/sim.ts';
import { cleanName, parseShareLink, shareQuery, type Challenge } from '../shared/share.ts';
import { BOLT, spreadOf, WEAPONS, type Shot, type WeaponFx } from '../shared/weapons.ts';
import { LagTransport } from '../shared/transport.ts';
import { World } from '../shared/world.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';
import { loadAssets } from './assets.ts';
import { Sfx } from './audio.ts';
import { Bags } from './bags.ts';
import { Bodies, strideLength } from './bodies.ts';
import { CHANGELOG } from './changelog.ts';
import { ContractProps } from './contractprops.ts';
import { Connection, WorkerTransport, type Recording, type ReplayEvent } from './connection.ts';
import { Deathcam, type DeathcamEvent } from './deathcam.ts';
import { Effects, type Struck } from './effects.ts';
import { Grenades } from './grenades.ts';
import { bearing, Hud } from './hud.ts';
import { Input } from './input.ts';
import { Leaderboard, localStore } from './leaderboard.ts';
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
const MODE_NAMES: Record<Mode, string> = { mixed: 'Mixed', pve: 'PvE', range: 'Range' };
/** Leaderboard rows shown on the menu. */
const BOARD_SHOWN = 5;
/** Islands from "New island" get seeds up to this, so their numbers stay short. */
const NEW_ISLAND_SEEDS = 999_999;
const MODE_NOTES: Record<Mode, string> = {
  mixed: 'Loot and get out, against guards and eleven other operators.',
  pve: 'Loot and get out. Just you against the guards.',
  range: 'Target practice. No clock, and you respawn.',
};

const link = parseShareLink(location.search);
const config = link.world;
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
const store = localStore();
const board = new Leaderboard(store);
document.getElementById('world-label')!.textContent =
  config.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${config.seed}`;

// ------------------------------------------------------------------ name

const nameInput = document.getElementById('name') as HTMLInputElement;
nameInput.value = cleanName(store?.getItem('name') ?? '') || `Operator ${100 + Math.floor(Math.random() * 900)}`;
function saveName(): void {
  nameInput.value = playerName();
  try {
    store?.setItem('name', nameInput.value);
  } catch {
    // Not remembered, that's all.
  }
}
nameInput.onchange = saveName;
saveName();

function playerName(): string {
  return cleanName(nameInput.value) || 'Operator';
}

// ------------------------------------------------------------------ sharing

const toastEl = document.getElementById('toast')!;
let toastTimer = 0;

function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2500);
}

/** Copy a link to this page with `query`, or failing that, show it to copy by hand. */
async function copyLink(query: string): Promise<void> {
  const url = new URL(query, location.href).href;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Send it to a friend.');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

/** The score to beat from the link we came in on, if it's for `m`. */
function challengeFor(m: Mode): Challenge | null {
  return link.challenge && (link.mode ?? 'mixed') === m ? link.challenge : null;
}

/** Share the island in the current mode, with your best score on it to beat. */
function shareIsland(): void {
  const best = mode === 'range' ? null : board.best(config.seed, mode);
  void copyLink(shareQuery(config, mode, best ?? undefined));
}

document.getElementById('share-island')!.onclick = shareIsland;
document.getElementById('new-island')!.onclick = () => {
  location.search = shareQuery({ seed: 1 + Math.floor(Math.random() * NEW_ISLAND_SEEDS) }, mode);
};

const challengeEl = document.getElementById('challenge')!;
const boardEl = document.getElementById('board')!;

/** The menu's leaderboard for the chosen mode, with the challenge from the link in its place. */
function showBoard(): void {
  const c = challengeFor(mode);
  challengeEl.hidden = !c;
  if (c) challengeEl.textContent = `${c.name} scored ${c.score.toLocaleString('en-US')} on this island in ${MODE_NAMES[mode]}. Beat it.`;
  boardEl.hidden = mode === 'range';
  if (mode === 'range') return;
  boardEl.querySelector('h3')!.textContent = `Your best here · ${MODE_NAMES[mode]}`;
  const rows: { name: string; score: number; note: string; rival: boolean }[] = board.entries(config.seed, mode)
    .map((e) => ({ name: e.name, score: e.score, note: shortDate(e.date), rival: false }));
  if (c) {
    const at = rows.findIndex((r) => r.score < c.score);
    rows.splice(at < 0 ? rows.length : at, 0, { name: c.name, score: c.score, note: 'to beat', rival: true });
  }
  // Keep the challenge in view even below the rows shown.
  const shown = rows.slice(0, BOARD_SHOWN);
  const rival = rows.findIndex((r) => r.rival);
  if (rival >= BOARD_SHOWN) shown[BOARD_SHOWN - 1] = rows[rival];
  boardEl.querySelector('ol')!.replaceChildren(...shown.map((r) => {
    const li = document.createElement('li');
    li.classList.toggle('rival', r.rival);
    const rank = document.createElement('i');
    rank.textContent = `${rows.indexOf(r) + 1}.`;
    const name = document.createElement('span');
    name.textContent = r.name;
    const score = document.createElement('b');
    score.textContent = r.score.toLocaleString('en-US');
    const note = document.createElement('small');
    note.textContent = r.note;
    li.append(rank, name, score, note);
    return li;
  }));
  const empty = boardEl.querySelector('.empty') as HTMLElement;
  empty.hidden = rows.length > 0;
  empty.textContent = 'No scores yet. Get off the island with loot to post one.';
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
// A link's mode wins, so a challenge is played the way it was set.
if (link.mode) mode = link.mode;

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
  showBoard();
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
  stopDeathcam(false);
  killedBy = null;
  conn = new Connection(config, world, mode, playerName(), transport);
  conn.onFx = (fx) => weaponFx(fx, () => conn?.interpolated() ?? []);
  conn.onEvents = (events) => events.forEach((e) => onEvent(e));
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

/** Sounds and effects of our own weapon, or of the killer's in a death cam; `players` are the bodies a round can hit. */
function weaponFx(fx: WeaponFx, players: () => PlayerSnap[]): void {
  if (fx.k === 'shot') ownShot(fx.shot, players());
  else if (fx.k === 'throw') sfx.toss();
  else if (fx.k === 'dry') sfx.dry();
  else if (fx.k === 'reload') sfx.reload(fx.weapon);
  else if (fx.k === 'reloaded') sfx.reloaded();
  else sfx.draw();
}

/** The results of the last run, shown again after watching the death cam. */
let showLastResults: (() => void) | null = null;

/**
 * The run ended: post the score, let the death camera and then the death cam
 * play out, and show the results.
 */
function endRun(e: RunEnd): void {
  if (!conn) return;
  conn.over = true;
  sfx.runEnd(e.outcome === 'extracted');
  const standing: string[] = [];
  const place = board.add(config.seed, mode, { name: playerName(), score: e.score, date: today() });
  if (place === 1) standing.push('New best on this island!');
  else if (place > 1) standing.push(`#${place} of your runs on this island.`);
  const c = challengeFor(mode);
  if (c) {
    const target = `${c.name}’s ${c.score.toLocaleString('en-US')}`;
    standing.push(e.score > c.score ? `You beat ${target}!` : `${target} still stands.`);
  }
  const best = board.best(config.seed, mode);
  const shareButton = document.getElementById('share-run') as HTMLButtonElement;
  shareButton.textContent = e.score > 0 ? 'Challenge a friend' : best ? 'Share your best' : 'Share island';
  shareButton.onclick = () => {
    const score = e.score > 0 ? { name: playerName(), score: e.score } : best ?? undefined;
    void copyLink(shareQuery(config, mode, score));
  };
  showLastResults = () => {
    (document.getElementById('replay') as HTMLButtonElement).hidden = !killedBy;
    runHud.showResults(e, standing.join(' '));
  };
  const shown = conn;
  setTimeout(() => {
    if (conn !== shown) return;
    document.exitPointerLock();
    paused.hidden = true;
    if (e.outcome === 'killed' && killedBy) playDeathcam();
    else showLastResults?.();
  }, e.outcome === 'killed' ? RESULTS_DELAY_DEAD * 1000 : 300);
}

// --------------------------------------------------------------- death cam

const deathcamEl = document.getElementById('deathcam')!;
const deathcamScope = deathcamEl.querySelector('.scope') as HTMLElement;
/** The killer's inputs from the server, and what we saw around then. */
let killedBy: { e: DeathcamEvent; recording: Recording } | null = null;
let deathcam: Deathcam | null = null;

/** Replay how we died, then show the results. */
function playDeathcam(): void {
  if (!killedBy) return;
  deathcam = new Deathcam(world, killedBy.e, killedBy.recording);
  // Start the bodies afresh, as they were then.
  bodies.update([], 0);
  runHud.hideResults();
  document.getElementById('hud')!.hidden = true;
  deathcamEl.querySelector('.banner span')!.textContent = `Killed by ${deathcam.name}`;
  deathcamEl.hidden = false;
}

/** The death cam ended or was skipped: on to the results, unless leaving anyway. */
function stopDeathcam(results = true): void {
  if (!deathcam) return;
  deathcam = null;
  deathcamEl.hidden = true;
  bodies.update([], 0);
  if (results) showLastResults?.();
}

deathcamEl.onclick = () => stopDeathcam();
window.addEventListener('keydown', (e) => {
  if (deathcam && (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter')) {
    e.preventDefault();
    stopDeathcam();
  }
});
document.getElementById('replay')!.onclick = playDeathcam;

function toMenu(): void {
  stopDeathcam(false);
  conn?.leave();
  conn = null;
  showBoard();
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
  // Enter plays from anywhere on the menu but its other buttons.
  const active = document.activeElement;
  if (e.code === 'Enter' && !conn && news.hidden && (!(active instanceof HTMLButtonElement) || active === playButton)) play();
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
function ownShot(shot: Shot, players: readonly PlayerSnap[]): void {
  viewModel.fire(shot.weapon);
  sfx.shot(shot.weapon, undefined, shot.quiet);
  const { ox, oy, oz, dx, dy, dz } = shot;
  const range = WEAPONS[shot.weapon].range;
  let t = world.raycast(ox, oy, oz, dx, dy, dz, range);
  let struck: Struck = t <= range ? 'world' : 'none';
  t = Math.min(t, range);
  for (const p of players) {
    if (p.dead) continue;
    const hit = rayBody(p, ox, oy, oz, dx, dy, dz, t);
    if (hit && hit.t < t) (t = hit.t), (struck = 'body');
  }
  from.copy(viewModel.muzzleOffset()).applyQuaternion(camera.quaternion).add(camera.position);
  to.set(ox + dx * t, oy + dy * t, oz + dz * t);
  showRound(struck, dx, dy, dz, shot.quiet);
}

/** `replay` is set for events replayed in the death cam; live rounds and blasts aren't drawn over it. */
function onEvent(e: GameEvent, replay = false): void {
  const me = conn?.predictor.state;
  if (deathcam && !replay && (e.k === 'shot' || e.k === 'boom')) return;
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
    case 'deathcam':
      if (conn) killedBy = { e, recording: conn.recorded() };
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

/**
 * First-person camera and weapon, looking `yaw` and `pitch`. Our own look uses
 * the live mouse, not the last command, so aiming has no latency.
 */
function eyeCamera(me: Rendered, yaw: number, pitch: number, s: PlayerState, dt: number): void {
  const w = WEAPONS[s.weapon];
  const aim = smoothstep(0, 1, me.aim);
  const zoom = lerp(1, w.zoom, aim);
  const fov = (2 * Math.atan(Math.tan((PLAY_FOV * Math.PI) / 360) / zoom) * 180) / Math.PI;
  if (Math.abs(camera.fov - fov) > 1e-3) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  input.lookScale = 1 / zoom;

  const eye = eyePosition(world, me.x, me.y, me.z, yaw, me.duck, me.lean);
  deadFor = s.dead ? deadFor + dt : 0;
  const down = smoothstep(0, DEATH_FALL, deadFor);
  camera.position.set(eye.x, lerp(eye.y, me.y + 0.3, down), eye.z);
  camera.rotation.set(pitch + me.recoilPitch, yaw + me.recoilYaw, eye.roll + down * 0.5);
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
  const lookDx = angleDiff(lastYaw, yaw) * 600;
  const lookDy = (lastPitch - pitch) * 600;
  lastYaw = yaw;
  lastPitch = pitch;
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
  Object.assign(window, { THREE, game: { camera, scene, renderer, view, bodies, sfx, world, viewModel, input, get conn() { return conn; }, get deathcam() { return deathcam; } } });
}

renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  resolution.update(now - last);
  const dt = Math.min(now - last, 0.1);
  last = now;

  if (conn) {
    conn.update(dt);
    inputLoop.advance(now);
  }
  const cam = deathcam;
  cam?.update(dt, (fx) => weaponFx(fx, () => cam.others()), (e: ReplayEvent) => onEvent(e, true));
  const players = cam ? cam.others() : (conn?.interpolated() ?? []);
  bodies.update(players, dt, camera);
  bags.update(conn?.bags ?? []);
  grenades.update(cam ? cam.grenades() : (conn?.grenades() ?? []));
  if (conn) view.setExtracts(conn.extracts, now);

  const me = conn?.predictor.render(inputLoop.alpha);
  const state = cam ? cam.state : (conn?.predictor.state ?? null);
  if (cam) {
    const killer = cam.view();
    eyeCamera(killer, killer.yaw, killer.pitch, cam.state, dt);
    deathcamScope.style.opacity = cam.state.weapon === BOLT ? String(Math.max((killer.aim - 0.8) / 0.2, 0)) : '0';
  } else if (me && state) {
    eyeCamera(me, input.yaw, input.pitch, state, dt);
    footsteps(state);
  } else orbitCamera(now);
  camera.updateMatrixWorld();
  sfx.listen(camera);
  effects.update(dt);

  if (conn && !cam) {
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

  if (cam?.done) stopDeathcam();
  renderer.info.reset();
  renderer.clear();
  renderer.render(scene, camera);
  if (state) {
    renderer.clearDepth();
    renderer.render(viewModel.scene, viewModel.camera);
  }
});
