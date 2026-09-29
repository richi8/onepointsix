import * as THREE from 'three';
import { CMD_DT, DOOR_REACH, OPERATOR_CAPACITY, SERVER_DT, THROW_TIME, WALK_SPEED } from '../shared/constants.ts';
import { sensesOf, TIME_NAMES, TIMES, WEATHER_NAMES, WEATHERS, type Conditions, type TimeOfDay, type Weather } from '../shared/conditions.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { rayBody } from '../shared/hitbox.ts';
import { FixedLoop } from '../shared/loop.ts';
import { extractName } from '../shared/loot.ts';
import { isReliable, parseMode, type ClientMsg, type CoverState, type DevCmd, type GameEvent, type Mode, type PlayerSnap, type ServerMsg } from '../shared/protocol.ts';
import { runRecord } from '../shared/runstats.ts';
import { eyePosition, type PlayerState } from '../shared/sim.ts';
import { cleanName, parseShareLink, shareQuery, type Challenge } from '../shared/share.ts';
import { BOLT, spreadOf, WEAPONS, type Shot, type WeaponFx } from '../shared/weapons.ts';
import { LagTransport } from '../shared/transport.ts';
import { World } from '../shared/world.ts';
import { DEFAULT_WORLD, type WorldConfig } from '../shared/worldconfig.ts';
import type { Assets } from './assets.ts';
import { Sfx } from './audio.ts';
import { Bags } from './bags.ts';
import { Bodies, strideLength } from './bodies.ts';
import { BUILD } from './build.ts';
import { CHANGELOG } from './changelog.ts';
import { ContractProps } from './contractprops.ts';
import { Connection, WorkerTransport, type Recording, type RecordedEvent } from './connection.ts';
import type { Deathcam, DeathcamEvent } from './deathcam.ts';
import { Effects, type Struck } from './effects.ts';
import { Flashlights } from './flashlights.ts';
import { Grenades } from './grenades.ts';
import { bearing, Hud } from './hud.ts';
import { Input } from './input.ts';
import { dropOldBoards, Leaderboard, localStore } from './leaderboard.ts';
import type { Rendered } from './prediction.ts';
import { Resolution } from './resolution.ts';
import { treeFade } from './trees.ts';
import { wobble } from './water.ts';
import { RunLog } from './runlog.ts';
import { exportRuns, renderStats } from './stats.ts';
import { RivalHud } from './rivalhud.ts';
import { contractTitle, RunHud, type RunEnd } from './runhud.ts';
import { Surfaces } from './surface.ts';
import { surfaceMaterial } from './surfaces.ts';
import { ViewModel } from './viewmodel.ts';
import { WorldView } from './worldview.ts';
import { FAR_SHADOWS } from './cascades.ts';
import './style.css';

const MENU_ORBIT_RADIUS = 360;
const MENU_ORBIT_SPEED = 0.025;
const MENU_FOV = 60;
/** Metres the sharp shadows reach from the player (the coarse ones reach FAR_SHADOWS), and the sharp ones round the menu's island. */
const NEAR_SHADOWS = 32;
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

/** The link the page came in on, or the island opened since, which carries no challenge. */
let link = parseShareLink(location.search);
/** The island from the link, in the conditions picked on the menu. */
let config = link.world;
let world = new World(config.seed);
let view = new WorldView(world, config);
/** Drawn into by every island in turn. */
const scene = view.scene;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
/** The lazily loaded parts of the island. */
let prepared = view.prepare(renderer).catch((err: unknown) => console.warn('Part of the island failed to load.', err));
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
let runHud = new RunHud(world);
let rivalHud = new RivalHud(world);
const contractProps = new ContractProps(scene, world);
const sfx = new Sfx(world);
sfx.conditions = config;
view.onThunder = (distance) => sfx.thunder(distance);

let surfaces = new Surfaces(world);
bodies.onStep = (x, y, z, speed, crouched) => sfx.step(surfaces.at(x, y, z), speed, crouched, { x, y, z });
let extractNames = world.extracts.map((_, i) => extractName(world, i));
/** Nothing broken, and every door as the island starts with it. */
let noCover: CoverState = { broken: [], open: world.openDoors() };

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
  void loadPlayback().catch((err: unknown) => console.warn('The death cam failed to load.', err));
}

loadingSkip.onclick = () => {
  skipped = true;
  finishLoading();
};
setTimeout(() => (loadingSkip.hidden = false), SKIP_LOADING_AFTER * 1000);

/** The textures and models, once loaded, for another island opened later. */
let dressed: Assets | null = null;

function dress(assets: Assets): void {
  dressed = assets;
  view.applyAssets(assets);
  effects.setDebrisMaterial(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85 }, 1, { local: true, indoor: true }));
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
dropOldBoards(store);
// Replays were dropped: the ones kept in this browser, and its id they carried, go too.
try {
  store?.removeItem('browserId');
  indexedDB.deleteDatabase('onepointsix');
} catch {
  // Storage blocked: nothing was kept.
}
const board = new Leaderboard(store);
const runLog = new RunLog(store);
function showIsland(): void {
  document.getElementById('world-label')!.textContent = config.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${config.seed}`;
}
showIsland();

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

/**
 * Share a link to this page with `query`: through the system's share sheet
 * where there is one, else copied, or failing that, shown to copy by hand.
 */
async function shareLink(query: string, text: string): Promise<void> {
  const url = new URL(query, location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'onepointsix', text, url });
      return;
    } catch (err) {
      // Closed without sharing, and that's all; anything else falls back to copying.
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
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
  // The best score goes out in the conditions it was set in.
  const at = best?.time && best.weather ? { ...config, time: best.time, weather: best.weather } : config;
  void shareLink(shareQuery(at, mode, best ?? undefined), challengeText(best));
}

/** What goes with a shared link: the score to beat on it, if any. */
function challengeText(score: { score: number } | null | undefined): string {
  return score ? `Beat my ${score.score.toLocaleString('en-US')} on this island.` : 'Play this island with me.';
}

document.getElementById('share-island')!.onclick = shareIsland;
document.getElementById('new-island')!.onclick = () => openIsland({ ...config, seed: 1 + Math.floor(Math.random() * NEW_ISLAND_SEEDS) });

/**
 * Open another island in place of this one, without reloading the page: it's
 * built and drawn afresh in the same scene, and the menu, the board and the
 * address follow it, in the conditions `next` has. Only from the menu.
 */
function openIsland(next: WorldConfig): void {
  if (next.seed >>> 0 === config.seed >>> 0) {
    setConditions(next);
    return;
  }
  view.dispose();
  world = new World(next.seed);
  view = new WorldView(world, next, scene);
  view.onThunder = (distance) => sfx.thunder(distance);
  view.preview = !menu.hidden;
  prepared = view.prepare(renderer).catch((err: unknown) => console.warn('Part of the island failed to load.', err));
  if (dressed) view.applyAssets(dressed);
  if (!Number.isNaN(still)) view.light3d.finishAll();
  bodies.forget();
  bodies.update([], 0);
  bodies.ground = world;
  bags.update([]);
  grenades.update([]);
  effects.clear();
  contractProps.setWorld(world);
  sfx.setWorld(world);
  surfaces = new Surfaces(world);
  runHud = new RunHud(world);
  rivalHud = new RivalHud(world);
  extractNames = world.extracts.map((_, i) => extractName(world, i));
  noCover = { broken: [], open: world.openDoors() };
  // The link's challenge was for the island it came with.
  link = { world: next, mode: null, challenge: null };
  config = { ...next };
  history.replaceState(null, '', `${location.pathname}${shareQuery(next)}${location.hash}`);
  setConditions(next);
  showIsland();
  showBoard();
}

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
  const rows: { name: string; score: number; note: string; when: string; rival: boolean }[] = board.entries(config.seed, mode)
    .map((e) => ({ name: e.name, score: e.score, note: shortDate(e.date), when: e.time && e.weather ? whenLabel(e.time, e.weather) : '', rival: false }));
  if (c) {
    const at = rows.findIndex((r) => r.score < c.score);
    rows.splice(at < 0 ? rows.length : at, 0, { name: c.name, score: c.score, note: 'to beat', when: whenLabel(link.world.time, link.world.weather), rival: true });
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
    const when = document.createElement('em');
    when.textContent = r.when;
    const note = document.createElement('small');
    note.textContent = r.note;
    li.append(rank, name, when, score, note);
    return li;
  }), ...open);
  const empty = boardEl.querySelector('.empty') as HTMLElement;
  empty.hidden = rows.length > 0;
  boardEl.classList.toggle('none', rows.length === 0);
  empty.textContent = 'No scores yet. Get off the island with loot to post one.';
}

/** The conditions a score was set in, short enough for a row of the board: "Night · Rain", "Day". */
function whenLabel(time: TimeOfDay, weather: Weather): string {
  return [TIME_NAMES[time], ...(weather === 'clear' ? [] : [WEATHER_NAMES[weather]])].join(' · ');
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
  bodies.forget();
  conn = new Connection(config, world, mode, playerName(), transport);
  conn.onFx = (fx) => weaponFx(fx, () => conn?.interpolated() ?? []);
  conn.onEvents = (events) => events.forEach((e) => onEvent(e));
  conn.onWelcome = (cover) => showCover(cover);
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
  if (conn || !loaded) return;
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
  hud.killerKind = e.death?.kind ?? null;
  sfx.runEnd(e.outcome === 'extracted');
  runLog.add(runRecord(e, config, mode, (i) => extractNames[i]));
  const standing: string[] = [];
  const place = board.add(config.seed, mode, { name: playerName(), score: e.score, date: today(), time: config.time, weather: config.weather });
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
    const at = e.score <= 0 && best?.time && best.weather ? { ...config, time: best.time, weather: best.weather } : config;
    void shareLink(shareQuery(at, mode, score), challengeText(score));
  };
  showLastResults = () => {
    (document.getElementById('watch-deathcam') as HTMLButtonElement).hidden = !killedBy;
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
/** The death cam shows our own grenade killing us, through our own eyes. */
let ownDeath = false;

/** Replay how we died, then show the results; straight to them if the death cam can't load. */
function playDeathcam(): void {
  if (!killedBy) return;
  if (!playback) {
    void loadPlayback().then(playDeathcam, () => showLastResults?.());
    return;
  }
  deathcam = new playback.Deathcam(world, killedBy.e, killedBy.recording, conn?.cover ?? noCover);
  ownDeath = killedBy.e.killer === conn?.id;
  showCover(deathcam.cover);
  // Start the bodies afresh, as they were then.
  bodies.update([], 0);
  runHud.hideResults();
  // The killer's health, ammo and hits.
  hudEl.hidden = false;
  hudEl.classList.add('watching');
  const kind = killedBy.e.kind ? `, a ${killedBy.e.kind}` : '';
  deathcamEl.querySelector('.banner span')!.textContent = ownDeath ? 'Killed by your own grenade' : `Killed by ${deathcam.name}${kind}`;
  deathcamEl.hidden = false;
}

/** The death cam ended or was skipped: on to the results, unless leaving anyway. */
function stopDeathcam(results = true): void {
  if (!deathcam) return;
  deathcam = null;
  deathcamEl.hidden = true;
  hudEl.hidden = true;
  hudEl.classList.remove('watching');
  showCover(conn?.cover ?? noCover);
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
document.getElementById('watch-deathcam')!.onclick = playDeathcam;

/** Put the panels and doors in the world as `cover` says, for a death cam's moment or back to now. */
function showCover(cover: CoverState): void {
  world.syncPanels(cover.broken);
  world.syncDoors(cover.open);
  view.syncPanels();
  sfx.changed();
}

/** Share of the sky's light where the first-person camera is. */
let indoors = 1;

/** The death cam, once loaded. */
let playback: typeof import('./playback.ts') | null = null;
let playbackLoading: Promise<typeof import('./playback.ts')> | null = null;

/** The death cam's code, loaded once and kept. */
function loadPlayback(): Promise<typeof import('./playback.ts')> {
  playbackLoading ??= import('./playback.ts').then((m) => (playback = m));
  // A failed load can be tried again.
  playbackLoading.catch(() => (playbackLoading = null));
  return playbackLoading;
}

// ------------------------------------------------------------------ stats

// The run log, summed up, and a file of it to send.
const statsEl = document.getElementById('stats')!;

function showStats(open: boolean): void {
  statsEl.hidden = !open;
  if (!open) {
    (document.getElementById('stats-open') as HTMLButtonElement).focus();
    return;
  }
  renderStats(statsEl, runLog.records());
  (statsEl.querySelector('.export') as HTMLButtonElement).onclick = () => {
    exportRuns(runLog.records(), BUILD);
    toast('Runs exported. Send the file to the developer.');
  };
  (document.getElementById('stats-close') as HTMLButtonElement).focus();
}

document.getElementById('stats-open')!.onclick = () => showStats(true);
document.getElementById('stats-close')!.onclick = () => showStats(false);
statsEl.onclick = (e) => {
  if (e.target === statsEl) showStats(false);
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !statsEl.hidden) showStats(false);
});

function toMenu(): void {
  stopDeathcam(false);
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
  if (e.code === 'Enter' && !conn && news.hidden && statsEl.hidden && (!(active instanceof HTMLButtonElement) || active === playButton)) play();
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
  const { ox, oy, oz, dx, dy, dz } = shot;
  viewModel.fire(shot.weapon);
  sfx.shot(shot.weapon, undefined, shot.quiet);
  const range = WEAPONS[shot.weapon].range;
  // Glass breaks and lets the round on, so the impact is past it.
  let t = world.raycast(ox, oy, oz, dx, dy, dz, range, true);
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
 * `replayed` is set for events played back in a death cam. While one shows,
 * live events only keep the books: the world is shown as it was then.
 */
function onEvent(e: GameEvent, replayed = false): void {
  if (deathcam && !replayed && e.k !== 'deathcam' && e.k !== 'runEnd') return;
  // Whose eyes we see through: our own, or the killer's in a death cam.
  const me = deathcam?.state ?? conn?.predictor.state;
  const meYaw = input.yaw;
  switch (e.k) {
    case 'hit':
      feedEvent(e);
      sfx.hit(e.zone === 'head', e.killed);
      bodies.flash(e.target, e.x, e.y, e.z);
      break;
    case 'hurt':
      if (me) hud.hurtFrom(e.damage, bearing(me.x, me.z, meYaw, e.x, e.z));
      sfx.hurt();
      break;
    case 'kill':
      bodies.killed(e);
      feedEvent(e);
      break;
    case 'extract':
    case 'bounty':
      feedEvent(e);
      break;
    case 'call':
      feedEvent(e);
      sfx.call();
      break;
    case 'took':
      sfx.pickup();
      break;
    case 'contract':
      feedEvent(e);
      if (e.state === 'done') sfx.pickup();
      break;
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
      bodies.shake(e.x, e.y, e.z, 4);
      for (const id of e.panels) sfx.changed(world.panels[id].box);
      eventSound(e);
      break;
    }
    case 'repair':
      for (const id of e.panels) {
        world.setPanel(id, true);
        view.updatePanel(id);
        sfx.changed(world.panels[id].box);
      }
      break;
    case 'door':
      for (const id of e.doors) {
        world.setDoor(id, e.open);
        view.updateDoor(id);
      }
      sfx.doorsChanged(e.doors);
      eventSound(e);
      break;
    case 'boom': {
      const d = me ? Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z) : Infinity;
      effects.explosion(to.set(e.x, e.y, e.z));
      eventSound(e);
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
      eventSound(e);
      break;
    }
  }
}

/** What an event puts over the view: a row in the feed, or a hit number. */
function feedEvent(e: GameEvent): void {
  const meId = conn?.id ?? 0;
  switch (e.k) {
    case 'hit':
      hud.hit(e.zone, e.killed, e.damage, e.x, e.y, e.z);
      break;
    case 'kill':
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
      break;
    case 'contract': {
      const c = conn?.run?.contracts[e.index];
      if (c) hud.contract(contractTitle(c), e.state);
      break;
    }
  }
}

/** What an event out in the world sounds like: a shot, a blast, cover breaking or a door. */
function eventSound(e: GameEvent): void {
  switch (e.k) {
    case 'shot':
      sfx.shot(e.weapon, { x: e.ox, y: e.oy, z: e.oz }, e.quiet);
      break;
    case 'boom':
      sfx.boom(e);
      break;
    case 'door':
      sfx.door(e.open, e);
      break;
    case 'break': {
      const first = world.panels[e.panels[0]];
      if (!first) break;
      const b = first.box;
      sfx.crumble(first.kind, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 });
      break;
    }
  }
}

// ------------------------------------------------------------------ frame

const focus = new THREE.Vector3();
/** Which way the camera looks, reused each frame. */
const V_LOOK = new THREE.Vector3();
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
// And the light inside every building is worked out at once, rather than a little each frame.
if (!Number.isNaN(still)) view.light3d.finishAll();

/**
 * In development, `?stand=x,z,yaw;x,z,yaw…` stands soldiers on the floor at
 * those spots while the menu is up (operators, bar every third a guard), for
 * screenshots of how they're lit, shadowed and reflected.
 */
const devStanding: PlayerSnap[] = (import.meta.env.DEV ? new URLSearchParams(location.search).get('stand') ?? '' : '')
  .split(';').filter(Boolean).map((spot, i) => {
    const [x, z, yaw = 0] = spot.split(',').map(Number);
    return {
      id: 1000 + i, team: i % 3 === 2 ? 'guard' : 'operator', x, y: world.floorHeight(x, z), z, yaw, pitch: 0, duck: 0, lean: 0,
      dead: false, weapon: 0, quiet: false, motion: 'ground', act: 'none', actT: 0, commander: false, light: false,
    };
  });

/** In development, `?torch` lights your own flashlight on the menu camera too, for screenshots of its beam. */
const devTorch = import.meta.env.DEV && new URLSearchParams(location.search).has('torch');

/** Seconds for the wind, waves and rain. */
function sceneTime(): number {
  return Number.isNaN(still) ? performance.now() / 1000 : still;
}

function orbitCamera(now: number): void {
  if (devCam) {
    // Seen as someone standing there would, not through the menu's thinned fog.
    view.preview = false;
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
  // The gun in your hands is lit like the room you're in, easing as you go in or out.
  indoors = lerp(indoors, view.light3d.at(camera.position.x, camera.position.y, camera.position.z), Math.min(dt * 4, 1));
  viewModel.shade(indoors);

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
  Object.assign(window, {
    THREE,
    game: {
      treeFade, camera, scene, renderer, bodies, effects, sfx, viewModel, input, resolution, flashlights, dev,
      get view() { return view; }, get world() { return world; }, get conn() { return conn; }, get deathcam() { return deathcam; },
    },
  });
}

/** The frame rate in the corner, counted over half a second. */
const fpsEl = document.getElementById('fps')!;
let fpsFrames = 0;
let fpsSince = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  if (Number.isNaN(still)) resolution.update(now - last);
  fpsFrames++;
  if (now - fpsSince >= 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / (now - fpsSince))} fps`;
    fpsFrames = 0;
    fpsSince = now;
  }
  const dt = Math.min(now - last, 0.1);
  last = now;

  if (conn) {
    conn.update(dt);
    inputLoop.advance(now);
  }
  const cam = deathcam;
  // Bodies move on the time shown: slowed round the kill in a death cam.
  const before = cam?.time ?? 0;
  cam?.update(dt, (fx) => weaponFx(fx, () => cam.others()), (e: RecordedEvent) => onEvent(e, true), (kill) => ownDeath || hud.mark(false, kill));
  // Soldiers stood on the menu's island hold still for screenshots with time stopped.
  const bodyDt = cam ? Math.max(cam.time - before, 0) : !conn && !Number.isNaN(still) ? 0 : dt;
  hud.age(bodyDt);
  const players = cam ? cam.others() : (conn?.interpolated() ?? devStanding);
  bodies.sun.copy(view.lit.sunDir);
  bodies.update(players, bodyDt, camera);
  bags.update(conn?.bags ?? []);
  grenades.update(cam ? cam.grenades() : (conn?.grenades() ?? []));
  if (conn) view.setExtracts(conn.extracts, now);

  const me = conn?.predictor.render(inputLoop.alpha);
  /** Whose view is shown: the killer's in a death cam, else ours. */
  const state = cam ? cam.state : (conn?.predictor.state ?? null);
  const eye = cam?.view();
  if (eye && cam) eyeCamera(eye, eye.yaw, eye.pitch, cam.state, dt);
  else if (me && state) {
    eyeCamera(me, input.yaw, input.pitch, state, dt);
    footsteps(state);
  } else orbitCamera(now);
  camera.updateMatrixWorld();
  // In a death cam, the killer's own light lights their view.
  const torch = cam ? cam.lit : state ? !state.dead && input.light : devTorch;
  flashlights.update(camera, torch, players, (id, out, dir) => bodies.torch(id, out, dir));
  view.torch(torch && flashlights.dark, camera.position, camera.getWorldDirection(V_LOOK));
  viewModel.torchOn = torch;
  sfx.underwater = view.underwater;
  sfx.update(camera, dt);
  effects.update(dt);

  if (cam || conn) {
    const aim = eye ? eye.aim : (me?.aim ?? 0);
    const spread = state ? spreadOf(state) : 0;
    const spreadPx = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2);
    // No death notice over a killer's view.
    hud.update(dt, state, aim, clamp(spreadPx, 0, innerHeight / 3), !!state && sprinting(state), camera, !cam);
  }
  if (cam) runHud.update(null, [], 0, 0, 0, camera);
  else if (conn) {
    if (me && !conn.over) runHud.update(conn.run, conn.extracts, me.x, me.z, input.yaw, camera, world.doorFacing(me.x, me.y, me.z, input.yaw, DOOR_REACH));
    else runHud.update(null, [], 0, 0, 0, camera);
    if (!paused.hidden) runHud.updatePause(conn.run, pauseStanding());
  }
  if (conn && !cam && me && !conn.over) rivalHud.update(conn.bags, conn.bounty, conn.id, camera.position, conn.lastTick * SERVER_DT, camera);
  else rivalHud.update([], null, 0, null, 0, camera);
  const contracts = conn && !conn.over && !cam ? (conn.run?.contracts ?? []) : [];
  contractProps.update(contracts);

  if (cam?.done) stopDeathcam();
  if (holdFrame) return;
  view.reflect(renderer, camera);
  const wobbling = view.underwater;
  if (wobbling) wobble(camera, now);
  renderer.clear();
  renderer.render(scene, camera);
  if (wobbling) camera.updateProjectionMatrix();
  if (state) {
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
