import * as THREE from 'three';
import { CMD_DT, MAX_PITCH, OPERATOR_CAPACITY, SERVER_DT, THROW_TIME, WALK_SPEED } from '../shared/constants.ts';
import { conditionsLabel, sensesOf, TIMES, WEATHERS, type Conditions, type TimeOfDay, type Weather } from '../shared/conditions.ts';
import { angleDiff, clamp, lerp, smoothstep, wrapAngle } from '../shared/geom.ts';
import { rayBody } from '../shared/hitbox.ts';
import { FixedLoop } from '../shared/loop.ts';
import { extractName } from '../shared/loot.ts';
import { isReliable, parseMode, type ClientMsg, type DevCmd, type GameEvent, type Mode, type PlayerSnap, type ServerMsg } from '../shared/protocol.ts';
import { runRecord } from '../shared/runstats.ts';
import { eyePosition, type PlayerState } from '../shared/sim.ts';
import { cleanName, parseShareLink, shareQuery, type Challenge } from '../shared/share.ts';
import { BOLT, spreadOf, WEAPONS, type Shot, type WeaponFx } from '../shared/weapons.ts';
import { LagTransport } from '../shared/transport.ts';
import { World } from '../shared/world.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';
import type { Assets } from './assets.ts';
import { Sfx } from './audio.ts';
import { Bags } from './bags.ts';
import { Bodies, strideLength } from './bodies.ts';
import { CHANGELOG } from './changelog.ts';
import { ContractProps } from './contractprops.ts';
import { Connection, WorkerTransport, type Recording, type ReplayEvent } from './connection.ts';
import type { Deathcam, DeathcamEvent } from './deathcam.ts';
import { Effects, type Struck } from './effects.ts';
import { Flashlights } from './flashlights.ts';
import { Grenades } from './grenades.ts';
import { bearing, Hud } from './hud.ts';
import { Input } from './input.ts';
import { Leaderboard, localStore } from './leaderboard.ts';
import type { Rendered } from './prediction.ts';
import { Resolution } from './resolution.ts';
import { RunLog } from './runlog.ts';
import type { Replay } from './replay.ts';
import type { ReplayBar, ReplayCamera } from './replaybar.ts';
import { decodeReplay, encodeReplay, RunRecorder, type ReplayData } from './replayfile.ts';
import { RivalHud } from './rivalhud.ts';
import { contractTitle, RunHud, type RunEnd } from './runhud.ts';
import { Surfaces } from './surface.ts';
import { surfaceMaterial } from './surfaces.ts';
import { ViewModel } from './viewmodel.ts';
import { WorldView } from './worldview.ts';
import './style.css';

const MENU_ORBIT_RADIUS = 360;
const MENU_ORBIT_SPEED = 0.025;
const MENU_FOV = 60;
/** Metres the sharp and the coarse shadows reach from the player, and the sharp ones round the menu's island. */
const NEAR_SHADOWS = 32;
const FAR_SHADOWS = 230;
const MENU_SHADOWS = 140;
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
/** Seconds before the loading screen offers to play without waiting for the textures. */
const SKIP_LOADING_AFTER = 8;
const MODE_NAMES: Record<Mode, string> = { online: 'Online', offline: 'Offline' };
/** Milliseconds a click on the run dashboard keeps trying to take the mouse back. */
const RELOCK_RETRY = 2000;
/** Seconds after Esc that Chrome won't give the mouse back, with some to spare. */
const RELOCK_COOLDOWN = 1.5;
/** Leaderboard rows shown on the menu. */
const BOARD_SHOWN = 5;
/** Islands from "New island" get seeds up to this, so their numbers stay short. */
const NEW_ISLAND_SEEDS = 999_999;
const MODE_NOTES: Record<Mode, string> = {
  online: `Loot and get out, against guards and ${OPERATOR_CAPACITY - 1} other operators. Players who join take a bot's place.`,
  offline: `Loot and get out, against guards and ${OPERATOR_CAPACITY - 1} bot operators. Nobody else joins.`,
};

const TIME_NOTES: Record<TimeOfDay, string> = {
  day: 'Broad daylight: you see them coming, and they see you.',
  dusk: 'The light is going. T for a flashlight.',
  night: 'More and tougher guards, better loot. A flashlight (T) shows you the way, and shows you to them.',
};
const WEATHER_NOTES: Record<Weather, string> = {
  clear: 'Sight and sound carry across the island.',
  rain: 'Shorter sight, and it drowns out footsteps and far-off shots.',
  fog: 'Nobody sees far, you included.',
};

const link = parseShareLink(location.search);
/** The island from the link, in the conditions picked on the menu. */
let config = link.world;
const world = new World(config.seed);
const view = new WorldView(world, config);
const scene = view.scene;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
/** The lazily loaded parts of the island. */
const prepared = view.prepare(renderer).catch((err: unknown) => console.warn('Part of the island failed to load.', err));
const resolution = new Resolution(renderer);
// Neutral keeps the colours ACES would bleach; the sun outweighs the sky light so shadows read.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = view.lit.exposure;
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
const flashlights = new Flashlights(scene);
const bodies = new Bodies(scene, world);
const bags = new Bags(scene);
const hud = new Hud();
const runHud = new RunHud(world);
const rivalHud = new RivalHud(world);
const contractProps = new ContractProps(scene, world);
const sfx = new Sfx(world);
sfx.conditions = config;
const surfaces = new Surfaces(world);
bodies.onStep = (x, y, z, speed, crouched) => sfx.step(surfaces.at(x, y, z), speed, crouched, { x, y, z });
const extractNames = world.extracts.map((_, i) => extractName(world, i));

// ---------------------------------------------------------------- loading

// The loading screen from index.html stays up until the textures, models and
// the early sounds are in and the shaders compiled, so the island never shows
// half-dressed. A slow connection can skip it and play in flat colours
// meanwhile; the textures then fade in when they arrive.
const loadingEl = document.getElementById('loading')!;
const loadingSkip = document.getElementById('loading-skip') as HTMLButtonElement;
let loaded = false;
let skipped = false;
/** While set, the frame isn't drawn: a picture of the last one covers the view as the textures go on. */
let holdFrame = false;
/** Set to take a picture of the next frame drawn. */
let pictureNext: ((shot: HTMLCanvasElement) => void) | null = null;
/** Seconds the picture of the flat-coloured island takes to fade away. */
const FADE_IN = 0.8;

function finishLoading(): void {
  if (loaded) return;
  loaded = true;
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 600);
  playButton.focus();
  void sfx.loadLate();
  void loadPlayback().catch((err: unknown) => console.warn('The death cam and replays failed to load.', err));
  void openHandedReplay();
}

loadingSkip.onclick = () => {
  skipped = true;
  finishLoading();
};
setTimeout(() => (loadingSkip.hidden = false), SKIP_LOADING_AFTER * 1000);

function dress(assets: Assets): void {
  view.applyAssets(assets);
  effects.setDebrisMaterial(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85 }, 1, { local: true }));
  bodies.setModel(assets.soldier, assets.guns);
  viewModel.setGuns(assets.guns, assets.environment);
  viewModel.setArms(assets.soldier);
  if (import.meta.env.DEV) Object.assign(window, { assets });
}

/**
 * Textures that arrive after the loading screen was skipped: a picture of the
 * flat-coloured frame covers the view while they go on and their shaders
 * compile, then fades away, rather than the island swapping at once. The game
 * goes on underneath.
 */
async function fadeIn(assets: Assets): Promise<void> {
  const shot = await new Promise<HTMLCanvasElement>((resolve) => (pictureNext = resolve));
  shot.className = 'fade-in';
  renderer.domElement.after(shot);
  holdFrame = true;
  try {
    dress(assets);
    await renderer.compileAsync(scene, camera);
  } finally {
    holdFrame = false;
  }
  shot.style.transition = `opacity ${FADE_IN}s`;
  requestAnimationFrame(() => requestAnimationFrame(() => (shot.style.opacity = '0')));
  setTimeout(() => shot.remove(), FADE_IN * 1000 + 100);
}

const earlySounds = sfx.loadEarly();
import('./assets.ts')
  .then(({ loadAssets }) => loadAssets(renderer))
  .then(async (assets) => {
    if (skipped) return fadeIn(assets);
    await Promise.all([earlySounds, prepared]);
    loadingEl.querySelector('p')!.textContent = 'Preparing the island…';
    dress(assets);
    orbitCamera(performance.now() / 1000);
    camera.updateMatrixWorld();
    await renderer.compileAsync(scene, camera);
  })
  .catch((err: unknown) => {
    console.warn('Assets failed to load; staying with flat colours.', err);
    toast('Textures failed to load. Playing in flat colours.');
  })
  .finally(finishLoading);

// ------------------------------------------------------------------ menu

const menu = document.getElementById('menu')!;
const paused = document.getElementById('paused')!;
const playButton = document.getElementById('play') as HTMLButtonElement;
const store = localStore();
const board = new Leaderboard(store);
const runLog = new RunLog(store);
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

/** The score to beat from the link we came in on, if it's for `m`; a link without a mode counts for any. */
function challengeFor(m: Mode): Challenge | null {
  return link.challenge && (link.mode ?? m) === m ? link.challenge : null;
}

/** Share the island in the current mode, with your best score on it to beat. */
function shareIsland(): void {
  const best = board.best(config.seed, mode);
  void copyLink(shareQuery(config, mode, best ?? undefined));
}

document.getElementById('share-island')!.onclick = shareIsland;
document.getElementById('new-island')!.onclick = () => {
  location.search = shareQuery({ ...config, seed: 1 + Math.floor(Math.random() * NEW_ISLAND_SEEDS) }, mode);
};

const challengeEl = document.getElementById('challenge')!;
const boardEl = document.getElementById('board')!;

/** The menu's leaderboard for the chosen mode, with the challenge from the link in its place. */
function showBoard(): void {
  const c = challengeFor(mode);
  // Shown in either mode, faded in the other, so switching doesn't move the menu.
  challengeEl.hidden = !link.challenge;
  challengeEl.classList.toggle('off', !c);
  if (link.challenge) {
    const where = link.mode ? ` in ${MODE_NAMES[link.mode]}` : '';
    challengeEl.textContent = `${link.challenge.name} scored ${link.challenge.score.toLocaleString('en-US')} on this island${where}. Beat it.`;
  }
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
  // Open places fill the list out to its full length, so it's the same size however many scores there are.
  const open = Array.from({ length: BOARD_SHOWN - shown.length }, (_, i) => {
    const li = document.createElement('li');
    li.className = 'open';
    const rank = document.createElement('i');
    rank.textContent = `${shown.length + i + 1}.`;
    const name = document.createElement('span');
    name.textContent = '—';
    li.append(rank, name);
    return li;
  });
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
  }), ...open);
  const empty = boardEl.querySelector('.empty') as HTMLElement;
  empty.hidden = rows.length > 0;
  boardEl.classList.toggle('none', rows.length === 0);
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
/** One pipe to the local game host for the whole session; each run joins through it. */
let transport: LagTransport<ClientMsg, ServerMsg> | null = null;
const input = new Input(window, renderer.domElement);

// Sample input at the fixed command rate, independent of frame rate.
const inputLoop = new FixedLoop(CMD_DT, () => conn?.sendCmd(input.sample(), input.yaw, input.pitch, input.weapon), 8);

// ------------------------------------------------------------------ modes

const briefing = document.getElementById('briefing')!;

/**
 * A line of the menu's briefing on what one choice means. Every option's note
 * sits in the same place, only the chosen one showing, so the longest sets the
 * height and picking another doesn't move the menu about.
 */
function briefingLine<K extends string>(notes: Record<K, string>): (chosen: K) => void {
  const line = document.createElement('div');
  line.className = 'line';
  const options = (Object.keys(notes) as K[]).map((k) => {
    const option = document.createElement('p');
    const name = document.createElement('b');
    name.textContent = k;
    option.append(name, notes[k]);
    line.append(option);
    return [k, option] as const;
  });
  briefing.append(line);
  return (chosen) => {
    for (const [k, option] of options) option.classList.toggle('on', k === chosen);
  };
}

const briefMode = briefingLine(MODE_NOTES);
const briefTime = briefingLine(TIME_NOTES);
const briefWeather = briefingLine(WEATHER_NOTES);
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('#modes button')];
let mode: Mode = 'online';
try {
  mode = parseMode(localStorage.getItem('mode')) ?? mode;
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
  briefMode(m);
  try {
    localStorage.setItem('mode', m);
  } catch {
    // Not remembered, that's all.
  }
  showBoard();
}
for (const b of modeButtons) b.onclick = () => selectMode(b.dataset.mode as Mode);
selectMode(mode);

// ------------------------------------------------------------- conditions

const timeButtons = [...document.querySelectorAll<HTMLButtonElement>('#times button')];
const weatherButtons = [...document.querySelectorAll<HTMLButtonElement>('#weathers button')];

/**
 * Play the island at another time of day or in other weather: relit behind
 * the menu, and kept in the address so the page's link reproduces it.
 */
function setConditions(c: Conditions): void {
  config = { ...config, ...c };
  for (const b of timeButtons) {
    const on = b.dataset.time === c.time;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  for (const b of weatherButtons) {
    const on = b.dataset.weather === c.weather;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  briefTime(c.time);
  briefWeather(c.weather);
  view.setConditions(c);
  const lit = view.lit;
  renderer.toneMappingExposure = lit.exposure;
  viewModel.setLight(lit.ambient, lit.sunColor, lit.sunIntensity / 3.3, lit.hemiSky, lit.hemiGround);
  flashlights.setConditions(sensesOf(c).dark, lit.fogNear, lit.fogFar);
  input.lightable = sensesOf(c).dark;
  sfx.conditions = c;
  const q = new URLSearchParams(location.search);
  for (const [k, v] of [['time', c.time], ['weather', c.weather]] as const) {
    if (v === TIMES[0] || v === WEATHERS[0]) q.delete(k);
    else q.set(k, v);
  }
  const search = q.size ? `?${q}` : '';
  if (search !== location.search) history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
}
for (const b of timeButtons) b.onclick = () => setConditions({ time: b.dataset.time as TimeOfDay, weather: config.weather });
for (const b of weatherButtons) b.onclick = () => setConditions({ time: config.time, weather: b.dataset.weather as Weather });
setConditions(config);

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
  stopDeathcam(false);
  killedBy = null;
  conn = new Connection(config, world, mode, playerName(), transport);
  conn.recorder = new RunRecorder(config, mode, playerName(), BUILD);
  ownReplay = null;
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
  hud.reset();
  hud.show();
  runHud.hideResults();
  // Shown until the lock succeeds, so a refused lock still leaves a way in.
  paused.hidden = false;
  input.lock();
}

function play(): void {
  if (conn || !loaded || replay) return;
  sfx.unlock();
  menu.hidden = true;
  view.preview = false;
  join();
}

/** Sounds and effects of our own weapon, or of the killer's in a death cam; `players` are the bodies a round can hit. */
function weaponFx(fx: WeaponFx, players: () => PlayerSnap[]): void {
  switch (fx.k) {
    case 'shot':
      ownShot(fx.shot, players());
      break;
    case 'throw':
      throwing = true;
      sfx.toss();
      break;
    case 'dry':
      sfx.dry();
      break;
    case 'reload':
      sfx.reload(fx.weapon);
      break;
    case 'reloaded':
      sfx.reloaded(fx.weapon);
      break;
    case 'draw':
      throwing = false;
      sfx.draw();
      break;
  }
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
  runLog.add(runRecord(e, config, mode, (i) => extractNames[i]));
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
    const recorded = !!conn?.recorder?.ready;
    (document.getElementById('watch-run') as HTMLButtonElement).hidden = !recorded;
    (document.getElementById('save-run') as HTMLButtonElement).hidden = !recorded;
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
const hudEl = document.getElementById('hud')!;
/** The killer's inputs from the server, and what we saw around then. */
let killedBy: { e: DeathcamEvent; recording: Recording } | null = null;
let deathcam: Deathcam | null = null;

/** Replay how we died, then show the results; straight to them if the death cam can't load. */
function playDeathcam(): void {
  if (!killedBy) return;
  if (!playback) {
    void loadPlayback().then(playDeathcam, () => showLastResults?.());
    return;
  }
  deathcam = new playback.Deathcam(world, killedBy.e, killedBy.recording, conn?.broken ?? []);
  showCover(deathcam.broken);
  // Start the bodies afresh, as they were then.
  bodies.update([], 0);
  runHud.hideResults();
  // The killer's health, ammo and hits.
  hudEl.hidden = false;
  hudEl.classList.add('watching');
  deathcamEl.querySelector('.banner span')!.textContent = `Killed by ${deathcam.name}`;
  deathcamEl.hidden = false;
}

/** The death cam ended or was skipped: on to the results, unless leaving anyway. */
function stopDeathcam(results = true): void {
  if (!deathcam) return;
  deathcam = null;
  deathcamEl.hidden = true;
  hudEl.hidden = true;
  hudEl.classList.remove('watching');
  showCover(conn ? [...conn.broken] : []);
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

/** Put the panels in the world as `broken` says, for a replay's moment or back to now. */
function showCover(broken: readonly number[]): void {
  world.syncPanels(broken);
  view.syncPanels();
}

// ------------------------------------------------------------------ replays

/** The update of the game, saved in replays to tell one from an older version. */
const BUILD = CHANGELOG[0]?.date ?? '';
/** Seconds of a replay after the run ends: the fall, like the death camera's. */
const REPLAY_AFTER = RESULTS_DELAY_DEAD;
/** Seconds a replay skips back or forward with the arrow keys. */
const REPLAY_SKIP = 5;
/** The free camera's speed in metres per second, and with Shift held. */
const FLY_SPEED = 10;
const FLY_FAST = 40;
/** Radians the free camera turns per pixel dragged. */
const FLY_LOOK = 0.004;
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);

/** The death cam and replay viewer, once loaded. */
let playback: typeof import('./playback.ts') | null = null;
let playbackLoading: Promise<typeof import('./playback.ts')> | null = null;
let replayBar: ReplayBar | null = null;
let replay: Replay | null = null;
let replayCam: ReplayCamera = 'eyes';
/** Our last run's replay, once made. */
let ownReplay: ReplayData | null = null;
const fly = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, keys: new Set<string>(), drag: false };

/** Our last run as a replay, if it has ended. */
function lastRun(): ReplayData | null {
  ownReplay ??= conn?.recorder?.finish(REPLAY_AFTER) ?? null;
  return ownReplay;
}

/** Who played a replay, where and how it went, for its title. */
function replayTitle(r: ReplayData): string {
  const island = r.world.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${r.world.seed}`;
  const when = conditionsLabel(r.world) || 'Day';
  const e = r.end;
  const how = e.outcome === 'extracted' ? `Extracted · ${e.score.toLocaleString('en-US')}`
    : e.outcome === 'killed' ? `Killed${e.killer ? ` by ${e.killer}` : ''}` : 'Missing in action';
  return `${r.name} · ${island} · ${when} · ${how}`;
}

/**
 * Watch a replay: ours from the results, or one opened from a file. One of
 * another island loads that island first, so it's handed over through the
 * session and the page reloads.
 */
async function watchReplay(r: ReplayData, unsaved: boolean, bytes?: Uint8Array): Promise<void> {
  if (r.world.seed >>> 0 !== config.seed >>> 0) {
    if (!bytes) return;
    try {
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      sessionStorage.setItem('replay', btoa(bin));
    } catch {
      toast(`This replay is on ${r.world.seed === DEFAULT_WORLD.seed ? 'the default island' : `island #${r.world.seed}`}, and it's too big to take there. Open that island, then the replay.`);
      return;
    }
    location.search = shareQuery(r.world);
    return;
  }
  if (!loaded) return;
  // Unlocked while this is still the click's doing.
  sfx.unlock();
  let Replay: typeof import('./replay.ts').Replay;
  try {
    ({ Replay } = await loadPlayback());
  } catch {
    toast('The replay viewer failed to load. Check your connection and try again.');
    return;
  }
  const bar = replayBar!;
  // Something else started meanwhile.
  if (replay || conn?.over === false) return;
  if (r.build !== BUILD) toast('This replay is from another version of the game, so it may not play back exactly.');
  stopDeathcam(false);
  if (r.world.time !== config.time || r.world.weather !== config.weather) setConditions({ time: r.world.time, weather: r.world.weather });
  document.exitPointerLock();
  menu.hidden = true;
  paused.hidden = true;
  runHud.hideResults();
  view.preview = false;
  replay = new Replay(world, r);
  replayCam = 'eyes';
  hud.reset();
  hud.show();
  hudEl.classList.add('watching', 'replaying');
  hudEl.classList.remove('free');
  bar.show(replayTitle(r), replay.start, replay.end, replay.marks(), unsaved);
  afterSeek();
}

/** Back to the results, or the menu if there's no run to go back to. */
function closeReplay(back = true): void {
  if (!replay) return;
  replay = null;
  replayBar?.hide();
  fly.keys.clear();
  hudEl.hidden = true;
  hudEl.classList.remove('watching', 'replaying', 'free');
  showCover(conn ? [...conn.broken] : []);
  bodies.update([], 0);
  bags.update([]);
  grenades.update([]);
  if (!back) return;
  if (conn && showLastResults) showLastResults();
  else {
    menu.hidden = false;
    view.preview = true;
    showBoard();
    playButton.focus();
  }
}

/** The replay jumped: the panels, bodies and HUD are set right for the new moment. */
function afterSeek(): void {
  if (!replay) return;
  showCover(replay.brokenAt());
  bodies.update([], 0);
  hud.reset();
  deadFor = 0;
}

function seekReplay(t: number): void {
  if (!replay) return;
  replay.seek(t);
  afterSeek();
}

function toggleReplay(): void {
  if (!replay) return;
  sfx.unlock();
  // Played to the end, it starts again.
  if (!replay.playing && replay.time >= replay.end) seekReplay(replay.start);
  replay.playing = !replay.playing;
}

function setReplayCam(cam: ReplayCamera): void {
  if (cam === 'free' && replayCam !== 'free') {
    fly.x = camera.position.x;
    fly.y = camera.position.y;
    fly.z = camera.position.z;
    fly.yaw = camera.rotation.y;
    fly.pitch = clamp(camera.rotation.x, -MAX_PITCH, MAX_PITCH);
  }
  replayCam = cam;
  hudEl.classList.toggle('free', cam === 'free');
}

async function saveReplay(r: ReplayData): Promise<void> {
  const bytes = await encodeReplay(r);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
  const a = document.createElement('a');
  const d = new Date(r.date);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const who = r.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'run';
  a.href = url;
  a.download = `onepointsix-${who}-${stamp}.replay`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Replay saved (${Math.max(Math.round(bytes.length / 1024), 1)} kB). Send the file to a friend.`);
}

async function openReplayFile(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await watchReplay(await decodeReplay(bytes), false, bytes);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'That replay couldn’t be opened.');
  }
}

/** A replay handed over from another island's page: open it paused, since sound needs a click first. */
async function openHandedReplay(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem('replay');
    sessionStorage.removeItem('replay');
  } catch {
    return;
  }
  if (!saved) return;
  try {
    const bytes = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
    await watchReplay(await decodeReplay(bytes), false);
    if (replay) replay.playing = false;
  } catch (err) {
    toast(err instanceof Error ? err.message : 'That replay couldn’t be opened.');
  }
}

/** The death cam and replay viewer's code, loaded once and kept. */
function loadPlayback(): Promise<typeof import('./playback.ts')> {
  playbackLoading ??= import('./playback.ts').then((m) => {
    const bar = new m.ReplayBar();
    bar.onPlay = toggleReplay;
    bar.onSeek = seekReplay;
    bar.onSpeed = (speed) => replay && (replay.speed = speed);
    bar.onCamera = setReplayCam;
    bar.onClose = () => closeReplay();
    bar.onSave = () => {
      if (replay) void saveReplay(replay.data);
    };
    replayBar = bar;
    playback = m;
    return m;
  });
  // A failed load can be tried again.
  playbackLoading.catch(() => (playbackLoading = null));
  return playbackLoading;
}

document.getElementById('watch-run')!.onclick = () => {
  const r = lastRun();
  if (r) void watchReplay(r, true);
};
document.getElementById('save-run')!.onclick = () => {
  const r = lastRun();
  if (r) void saveReplay(r);
};

const replayFile = document.getElementById('replay-file') as HTMLInputElement;
document.getElementById('replay-open')!.onclick = () => replayFile.click();
replayFile.onchange = () => {
  const file = replayFile.files?.[0];
  replayFile.value = '';
  if (file) void openReplayFile(file);
};

// A replay dropped on the menu opens too.
const dropEl = document.getElementById('drop')!;
const canDrop = (e: DragEvent) => !menu.hidden && !conn && !replay && !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragover', (e) => {
  if (!canDrop(e)) return;
  e.preventDefault();
  dropEl.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropEl.hidden = true;
});
window.addEventListener('drop', (e) => {
  dropEl.hidden = true;
  if (!canDrop(e)) return;
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void openReplayFile(file);
});

window.addEventListener('keydown', (e) => {
  if (!replay || (e.target instanceof HTMLInputElement && e.target.type !== 'range')) return;
  if (FLY_KEYS.has(e.code)) {
    // Moving takes the camera off the player's eyes.
    if (replayCam !== 'free' && !e.code.startsWith('Shift')) setReplayCam('free');
    fly.keys.add(e.code);
    return;
  }
  const { SPEEDS } = playback!;
  const speed = SPEEDS.indexOf(replay.speed);
  switch (e.code) {
    case 'Space':
      toggleReplay();
      break;
    case 'ArrowLeft':
      seekReplay(replay.time - REPLAY_SKIP);
      break;
    case 'ArrowRight':
      seekReplay(replay.time + REPLAY_SKIP);
      break;
    case 'BracketLeft':
      replay.speed = SPEEDS[Math.max(speed - 1, 0)];
      break;
    case 'BracketRight':
      replay.speed = SPEEDS[Math.min(speed + 1, SPEEDS.length - 1)];
      break;
    case 'KeyV':
      setReplayCam(replayCam === 'eyes' ? 'free' : 'eyes');
      break;
    case 'Escape':
      closeReplay();
      break;
    default:
      return;
  }
  e.preventDefault();
});
window.addEventListener('keyup', (e) => fly.keys.delete(e.code));
window.addEventListener('blur', () => fly.keys.clear());

// Dragging on the view looks around with the free camera.
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!replay || e.button !== 0) return;
  setReplayCam('free');
  fly.drag = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!replay || !fly.drag) return;
  fly.yaw = wrapAngle(fly.yaw - e.movementX * FLY_LOOK);
  fly.pitch = clamp(fly.pitch - e.movementY * FLY_LOOK, -MAX_PITCH, MAX_PITCH);
});
renderer.domElement.addEventListener('pointerup', () => (fly.drag = false));
renderer.domElement.addEventListener('pointercancel', () => (fly.drag = false));

function toMenu(): void {
  stopDeathcam(false);
  closeReplay(false);
  conn?.leave();
  conn = null;
  showBoard();
  runHud.hideResults();
  document.getElementById('hud')!.hidden = true;
  paused.hidden = true;
  menu.hidden = false;
  view.preview = true;
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

const resumeNote = paused.querySelector('.resume') as HTMLElement;
const RESUME = 'Click anywhere to resume';
input.onLockChange = (locked) => {
  if (conn && !conn.over) paused.hidden = locked;
  if (!resuming) resumeNote.textContent = RESUME;
};
// Clicking anywhere but the Leave button resumes.
paused.onclick = (e) => {
  if (e.target !== leaveButton) void resume();
};
let resuming = false;
/**
 * Chrome refuses to re-lock the mouse for about a second after Esc freed it.
 * A click in that time keeps trying until it's let through, while the click
 * still counts as a gesture, and says why it's waiting; if the browser still
 * won't, it says so and asks for another click.
 */
async function resume(): Promise<void> {
  if (resuming) return;
  resuming = true;
  const now = performance.now();
  const until = now + RELOCK_RETRY;
  const soon = now - input.freedAt < RELOCK_COOLDOWN * 1000;
  let refused = false;
  while (!paused.hidden && !(await input.lock()) && performance.now() < until) {
    if (!refused) resumeNote.textContent = soon ? 'Your browser holds the mouse for a moment after Esc. Resuming as soon as it lets go…' : 'Taking the mouse back…';
    refused = true;
    await new Promise((r) => setTimeout(r, 100));
  }
  resumeNote.textContent = paused.hidden ? RESUME : 'Your browser didn’t give the mouse back. Click again to resume.';
  resuming = false;
}
const leaveButton = document.getElementById('leave')!;
leaveButton.onclick = toMenu;

/** Under the score in the pause menu: the best run on this island and the challenge from the link. */
function pauseStanding(): string {
  const best = board.best(config.seed, mode);
  const c = challengeFor(mode);
  return [
    best ? `Your best here: ${best.score.toLocaleString('en-US')}` : '',
    c ? `${c.name}’s to beat: ${c.score.toLocaleString('en-US')}` : '',
  ].filter(Boolean).join(' · ');
}

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

/**
 * `replayed` is set for events played back in a death cam or replay. While one
 * shows, live events only keep the books: the world is shown as it was then.
 */
function onEvent(e: GameEvent, replayed = false): void {
  if ((deathcam || replay) && !replayed && e.k !== 'deathcam' && e.k !== 'runEnd') return;
  // Whose eyes we see through: our own, or the player of the replay or death cam.
  const me = deathcam?.state ?? replay?.state ?? conn?.predictor.state;
  const meYaw = replay ? replay.view().yaw : input.yaw;
  const meId = replay ? replay.id : (conn?.id ?? 0);
  switch (e.k) {
    case 'hit':
      hud.hit(e.zone, e.killed, e.damage, e.x, e.y, e.z);
      sfx.hit(e.zone === 'head', e.killed);
      bodies.flash(e.target, e.x, e.y, e.z);
      break;
    case 'hurt':
      if (me) hud.hurtFrom(e.damage, bearing(me.x, me.z, meYaw, e.x, e.z));
      sfx.hurt();
      break;
    case 'kill':
      bodies.killed(e.victim, e.killer);
      hud.kill(e, meId);
      break;
    case 'extract':
      hud.extract(e, meId);
      break;
    case 'bounty':
      hud.bounty(e, meId);
      break;
    case 'call':
      hud.call(e, extractNames[e.index], meId);
      sfx.call();
      break;
    case 'took':
      sfx.pickup();
      break;
    case 'contract': {
      const c = (replay ? replay.run() : conn?.run)?.contracts[e.index];
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
        effects.shatter(world.panels[id].box, view.panelColor(id, color), view.panelLayer(id), e.x, e.y, e.z);
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
/** The weapon is down for our own grenade throw, not a switch. */
let throwing = false;
/** Camera shake, 0 to 1, decaying. */
let shake = 0;
/** Our own footfalls: where we were, distance since the last step, and how we were falling. */
const own = { x: 0, z: 0, stride: 0, air: false, fall: 0 };

/**
 * In development, `?cam=x,y,z,tx,ty,tz` holds the menu camera at (x, y, z)
 * looking at (tx, ty, tz), with `o` meaning relative to outpost o, e.g.
 * `?cam=o0,-20,6,-20,0,2,0`. For screenshots of one spot.
 */
const devCam = ((): number[] | null => {
  const v = import.meta.env.DEV ? new URLSearchParams(location.search).get('cam') : null;
  if (!v) return null;
  const parts = v.split(',');
  const at = parts[0].startsWith('o') ? world.outposts[Number(parts.shift()!.slice(1))] : { x: 0, y: 0, z: 0 };
  const n = parts.map(Number);
  return [n[0] + at.x, n[1] + at.y, n[2] + at.z, n[3] + at.x, n[4] + at.y, n[5] + at.z];
})();

/**
 * In development, `?still=<seconds>` stops the wind, waves and rain at that
 * moment and holds the resolution, so screenshots of a spot come out the same
 * every time.
 */
const still = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('still') ?? NaN) : NaN;

/** Seconds for the wind, waves and rain. */
function sceneTime(): number {
  return Number.isNaN(still) ? performance.now() / 1000 : still;
}

function orbitCamera(now: number): void {
  if (devCam) {
    camera.position.set(devCam[0], devCam[1], devCam[2]);
    camera.lookAt(devCam[3], devCam[4], devCam[5]);
    focus.set(devCam[3], devCam[4], devCam[5]);
    view.update(camera, focus, NEAR_SHADOWS, FAR_SHADOWS, sceneTime());
    return;
  }
  const a = (now - start) * MENU_ORBIT_SPEED + 0.6;
  camera.position.set(Math.sin(a) * MENU_ORBIT_RADIUS, world.maxHeight + 90, Math.cos(a) * MENU_ORBIT_RADIUS);
  camera.lookAt(0, 0, 0);
  focus.set(0, 0, 0);
  view.update(camera, focus, MENU_SHADOWS, world.half, sceneTime());
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
  view.update(camera, focus, NEAR_SHADOWS, FAR_SHADOWS, sceneTime());

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
    throwing: throwing && s.draw > 0 ? clamp(1 - s.draw / THROW_TIME, 0, 1) : -1,
  }, lookDx, lookDy);
  viewModel.hidden = s.dead || (s.weapon === BOLT && me.aim > 0.9);
}

/** The replay's free camera: flown with WASD, Q and E, turned by dragging. */
function flyCamera(dt: number): void {
  const k = fly.keys;
  const step = (k.has('ShiftLeft') || k.has('ShiftRight') ? FLY_FAST : FLY_SPEED) * dt;
  const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  const up = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  const cp = Math.cos(fly.pitch);
  fly.x += (-Math.sin(fly.yaw) * cp * fwd + Math.cos(fly.yaw) * side) * step;
  fly.z += (-Math.cos(fly.yaw) * cp * fwd - Math.sin(fly.yaw) * side) * step;
  fly.y += (Math.sin(fly.pitch) * fwd + up) * step;
  const edge = world.half * 1.5;
  fly.x = clamp(fly.x, -edge, edge);
  fly.z = clamp(fly.z, -edge, edge);
  fly.y = clamp(fly.y, world.floorHeight(fly.x, fly.z) + 0.3, world.maxHeight + 200);
  if (Math.abs(camera.fov - PLAY_FOV) > 1e-3) {
    camera.fov = PLAY_FOV;
    camera.updateProjectionMatrix();
  }
  camera.position.set(fly.x, fly.y, fly.z);
  camera.rotation.set(fly.pitch, fly.yaw, 0);
  focus.set(fly.x, world.floorHeight(fly.x, fly.z), fly.z);
  view.update(camera, focus, NEAR_SHADOWS, FAR_SHADOWS, sceneTime());
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
  own.stride += moved;
  const speed = Math.hypot(s.vx, s.vz);
  if (own.stride >= strideLength(speed)) {
    own.stride = 0;
    sfx.step(surface, speed, s.crouched);
  }
}

function sprinting(s: PlayerState): boolean {
  return s.onGround && !s.crouched && Math.hypot(s.vx, s.vz) > WALK_SPEED + 0.3;
}

if (import.meta.env.DEV) {
  // For poking at the game from the console or a test browser. `dev` sends
  // the local host a shortcut, such as ending the run (see DevCmd).
  const dev = (cmd: DevCmd) => conn?.transport.send({ t: 'dev', cmd });
  Object.assign(window, { THREE, game: { camera, scene, renderer, view, bodies, effects, sfx, world, viewModel, input, resolution, dev, get conn() { return conn; }, get deathcam() { return deathcam; }, get replay() { return replay; } } });
}

renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  if (Number.isNaN(still)) resolution.update(now - last);
  const dt = Math.min(now - last, 0.1);
  last = now;

  if (conn) {
    conn.update(dt);
    inputLoop.advance(now);
  }
  const cam = deathcam;
  const rep = replay;
  cam?.update(dt, (fx) => weaponFx(fx, () => cam.others()), (e: ReplayEvent) => onEvent(e, true), (kill) => hud.mark(false, kill));
  rep?.update(dt, (fx) => weaponFx(fx, () => rep.others()), (e) => onEvent(e, true));
  const free = !!rep && replayCam === 'free';
  const players = cam ? cam.others() : rep ? (free ? [...rep.others(), rep.self()] : rep.others()) : (conn?.interpolated() ?? []);
  bodies.update(players, dt, camera);
  bags.update(rep ? rep.bags() : (conn?.bags ?? []));
  grenades.update(cam ? cam.grenades() : rep ? rep.grenades() : (conn?.grenades() ?? []));
  if (rep) view.setExtracts(rep.extracts(), now);
  else if (conn) view.setExtracts(conn.extracts, now);

  const me = conn?.predictor.render(inputLoop.alpha);
  /** Whose view is shown: the killer's in a death cam, the player's in a replay, else ours. */
  const shown = cam ?? rep;
  const state = shown ? shown.state : (conn?.predictor.state ?? null);
  const eye = shown?.view();
  if (free) flyCamera(dt);
  else if (eye && shown) {
    eyeCamera(eye, eye.yaw, eye.pitch, shown.state, dt);
    if (rep?.playing) footsteps(rep.state);
  } else if (me && state) {
    eyeCamera(me, input.yaw, input.pitch, state, dt);
    footsteps(state);
  } else orbitCamera(now);
  camera.updateMatrixWorld();
  const torch = rep ? !free && !rep.state.dead && rep.self().light : !cam && !!state && !state.dead && input.light;
  flashlights.update(camera, torch, players, (id, out) => bodies.muzzle(id, out));
  viewModel.torchOn = torch;
  sfx.update(camera, dt);
  effects.update(dt);

  if (shown || conn) {
    const aim = eye ? eye.aim : (me?.aim ?? 0);
    const spread = state ? spreadOf(state) : 0;
    const spreadPx = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2);
    // No death notice over a killer's view.
    hud.update(dt, state, aim, clamp(spreadPx, 0, innerHeight / 3), !!state && sprinting(state), camera, !cam);
  }
  if (rep && eye) {
    runHud.update(rep.time <= rep.runOver ? rep.run() : null, rep.extracts(), eye.x, eye.z, eye.yaw, camera);
    replayBar?.update(rep, replayCam);
  } else if (cam) runHud.update(null, [], 0, 0, 0, camera);
  else if (conn) {
    if (me && !conn.over) runHud.update(conn.run, conn.extracts, me.x, me.z, input.yaw, camera);
    else runHud.update(null, [], 0, 0, 0, camera);
    if (!paused.hidden) runHud.updatePause(conn.run, pauseStanding());
  }
  if (rep) rivalHud.update(rep.bags(), rep.bounty(), rep.id, free ? null : camera.position, rep.time, camera);
  else if (conn && !cam && me && !conn.over) rivalHud.update(conn.bags, conn.bounty, conn.id, camera.position, conn.lastTick * SERVER_DT, camera);
  else rivalHud.update([], null, 0, null, 0, camera);
  const contracts = rep ? (rep.run()?.contracts ?? []) : conn && !conn.over && !cam ? (conn.run?.contracts ?? []) : [];
  contractProps.update(contracts);

  if (cam?.done) stopDeathcam();
  if (holdFrame) return;
  renderer.clear();
  renderer.render(scene, camera);
  if (state && !free) {
    renderer.clearDepth();
    renderer.render(viewModel.scene, viewModel.camera);
  }
  if (pictureNext) {
    // Straight after drawing, while the frame is still there to copy.
    const shot = document.createElement('canvas');
    shot.width = renderer.domElement.width;
    shot.height = renderer.domElement.height;
    shot.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    pictureNext(shot);
    pictureNext = null;
  }
});
