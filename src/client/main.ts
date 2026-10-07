import * as THREE from 'three';
import {
  CMD_DT, DEATHCAM_AFTER, DEATHMATCH_CAPACITY, OPERATOR_CAPACITY, SERVER_DT, THROW_TIME, WALK_SPEED,
} from '../shared/constants.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { rayBody } from '../shared/hitbox.ts';
import { FixedLoop } from '../shared/loop.ts';
import { extractName } from '../shared/loot.ts';
import { isDeathmatch, isReliable, parseMode, validPlayerId, type ClientMsg, type CoverState, type DevCmd, type GameEvent, type Mode, type PlayerSnap, type ServerMsg } from '../shared/protocol.ts';
import { runRecord } from '../shared/runstats.ts';
import { eyePosition, type PlayerState } from '../shared/sim.ts';
import { cleanName, parseShareLink, type Challenge } from '../shared/share.ts';
import { BOLT, spreadOf, WEAPONS, type Shot, type WeaponFx } from '../shared/weapons.ts';
import { LagTransport } from '../shared/transport.ts';
import { Forecast, mainWeather, parseWeather } from '../shared/weather.ts';
import { mapFor } from '../shared/maps/index.ts';
import { World } from '../shared/world.ts';
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
import { outlookAt, Wetting } from './outlook.ts';
import { Soak, wetMaterial } from './rain.ts';
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
import { Scoreboard } from './scoreboard.ts';
import { contractTitle, RunHud, type RunEnd } from './runhud.ts';
import { Surfaces } from './surface.ts';
import { surfaceMaterial } from './surfaces.ts';
import { ViewModel } from './viewmodel.ts';
import { WorldView } from './worldview.ts';
import { gradeTown } from './grading.ts';
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
const MODE_NAMES: Record<Mode, string> = { extraction: 'Extraction', calabianca: 'Calabianca DM', deathmatch: 'Dust DM', range: 'Range' };
/** Milliseconds a click on the run dashboard keeps trying to take the mouse back. */
const RELOCK_RETRY = 2000;
/** Seconds after Esc that Chrome won't give the mouse back, with some to spare. */
const RELOCK_COOLDOWN = 1.5;
/** Leaderboard rows shown on the menu. */
const BOARD_SHOWN = 5;
const MODE_NOTES: Record<Mode, string> = {
  extraction: `Loot and get out, against guards and ${OPERATOR_CAPACITY - 1} other operators. Players who join take a bot's place.`,
  calabianca: `Everyone against everyone in the old town of Calabianca: ${DEATHMATCH_CAPACITY} operators, no guards. Respawn when killed; crates hold ammo and medkits. Players who join take a bot's place.`,
  deathmatch: `Everyone against everyone on the map after Dust 2: ${DEATHMATCH_CAPACITY} operators, no guards. Respawn when killed; crates hold ammo and medkits. Players who join take a bot's place.`,
  range: 'Try things out round the first outpost: soldiers going through every move, and nothing can hurt you. No scores.',
};

/** The link the page came in on. */
const link = parseShareLink(location.search);
/** The island from the link. */
const config = link.world;
let mode: Mode = 'extraction';
try {
  mode = parseMode(localStorage.getItem('mode')) ?? mode;
} catch {
  // Storage may be blocked; the default will do.
}
// A link's mode wins, so a challenge is played the way it was set.
if (link.mode) mode = link.mode;
try {
  // Unless the menu just loaded the page again for the mode picked on it.
  mode = parseMode(sessionStorage.getItem('pickedMode')) ?? mode;
  sessionStorage.removeItem('pickedMode');
} catch {
  // Nothing picked, then.
}
/**
 * In development, `?map=kit-yard` or `?map=test-street` shows that test map
 * (see maps/dev.ts) behind the menu, to look at the building kit, and a game
 * started from it is a Deathmatch on it, whatever the mode picked.
 */
const devMapName = import.meta.env.DEV ? new URLSearchParams(location.search).get('map') : null;
const devMap = devMapName ? (await import('../shared/maps/dev.ts')).TEST_MAPS[devMapName] : undefined;
if (devMap) mode = 'deathmatch';
/** The island from the seed, or the mode's fixed map: Deathmatch's. */
const world = new World(config.seed, devMap ?? mapFor(mode));
/** Its weather over a game, as the server works it out. */
const forecast = new Forecast(config.seed);
/**
 * In development, `?sky=` holds the weather shown whatever the game's, for
 * screenshots: `rain` settled, `clear,rain,0.4` 40% through a change from
 * clear to rain, or `clear,rain,-30` half a minute before it starts.
 */
const heldSky = import.meta.env.DEV ? parseHeldSky(new URLSearchParams(location.search).get('sky')) : null;
/** Behind the menu, the weather a game on the island opens in. */
const view = new WorldView(world, mainWeather(forecast.at(0)));
// A map has no extraction points, on the menu either.
view.showExtracts = !world.map;
/** Drawn into by every island in turn. */
const scene = view.scene;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
/** The lazily loaded parts of the island. */
const prepared = view.prepare(renderer).catch((err: unknown) => console.warn('Part of the island failed to load.', err));
const resolution = new Resolution(renderer);
// Neutral keeps the colours ACES would bleach; the sun outweighs the sky light so shadows read.
renderer.toneMapping = THREE.NeutralToneMapping;
// A map's town is graded too (see grading.ts); every mode loads a page of its own.
if (world.map) gradeTown(renderer);
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
const bodies = new Bodies(scene, world);
bodies.seed = world.seed;
const bags = new Bags(scene);
/** How wet you are, for the magazines you drop. */
let mySoak = new Soak();
bodies.shelter = bags.shelter = effects.shelter = view.shelter;
bags.soakNear = (x, y, z) => bodies.soakNear(x, y, z);
const hud = new Hud();
const runHud = new RunHud(world);
const rivalHud = new RivalHud(world);
const scoreboard = new Scoreboard(window, () => !!conn && !conn.over);
const contractProps = new ContractProps(scene, world);
const sfx = new Sfx(world);
view.onThunder = (distance) => sfx.thunder(distance);

const surfaces = new Surfaces(world);
bodies.onStep = (x, y, z, speed, crouched) => sfx.step(surfaces.at(x, y, z), speed, crouched, { x, y, z });
const extractNames = world.extracts.map((_, i) => extractName(world, i));
/** Nothing broken. */
const noCover: CoverState = { broken: [] };

// ---------------------------------------------------------------- loading

// The loading screen from index.html stays up until the textures, models and
// the early sounds are in and the shaders compiled, so the island never shows
// half-dressed. A slow connection can skip it and play in flat colours
// meanwhile; the textures then fade in when they arrive.
const loadingEl = document.getElementById('loading')!;
const loadingSkip = document.getElementById('loading-skip') as HTMLButtonElement;
let loaded = false;
let skipped = false;
/**
 * Whether frames are drawn. Not behind the loading screen until the island
 * wears its textures, so no shaders are compiled for the flat colours it
 * covers: on a cold shader cache, those cost seconds.
 */
let drawing = false;
/**
 * Set for the frames drawn under the loading screen to prepare the ones
 * after: soldiers of every kind stand in the middle of the island with a bag
 * and a grenade, everything hidden is shown and nothing is culled, and the
 * gun in your hands is drawn too.
 */
let warming = false;
/** While set, the frame isn't drawn: a picture of the last one covers the view as the textures go on. */
let holdFrame = false;
/** Set to take a picture of the next frame drawn. */
let pictureNext: ((shot: HTMLCanvasElement) => void) | null = null;
/** Seconds the picture of the flat-coloured island takes to fade away. */
const FADE_IN = 0.8;

function finishLoading(): void {
  if (loaded) return;
  loaded = true;
  drawing = true;
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

function dress(assets: Assets): void {
  view.applyAssets(assets);
  effects.setDebrisMaterial(wetMaterial(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.85 }, 1, { local: true, indoor: true }), { gloss: 0.5, soak: 'instanced' }));
  bodies.setModel(assets.soldiers, assets.guns);
  // Every avatar's textures on the GPU now, not as each is first seen in play.
  for (const soldier of assets.soldiers) {
    soldier.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      for (const t of [m?.map, m?.normalMap]) if (t) renderer.initTexture(t);
    });
  }
  viewModel.setGuns(assets.guns, assets.environment);
  viewModel.setArms(assets.soldiers[0]);
  // Your own empty magazines fall from where your hands let go of them, into the world.
  viewModel.onDrop = (weapon, matrix) => {
    const s = deathcam ? null : conn?.predictor.state;
    if (!s) return;
    camera.updateMatrixWorld();
    bodies.dropMagazine(weapon, matrix.premultiply(camera.matrixWorld), new THREE.Vector3(s.vx, -0.5, s.vz), mySoak.level.value);
  };
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
  .then(({ loadAssets }) => loadAssets(renderer, !!world.map))
  .then(async (assets) => {
    if (skipped) return fadeIn(assets);
    await Promise.all([earlySounds, prepared]);
    loadingEl.querySelector('p')!.textContent = 'Preparing the island…';
    dress(assets);
    orbitCamera(performance.now() / 1000);
    camera.updateMatrixWorld();
    await renderer.compileAsync(scene, camera);
    // Frames drawn under the loading screen until one has drawn the sea's
    // reflection, whether or not it's in view (it waits for the shadow maps),
    // with everything shown that play shows later (see warming): they compile
    // what can't be ahead, the shadow maps' shaders and, in Chrome on Metal,
    // a pipeline for each material and picture drawn into, which cost
    // seconds on a cold cache, as a game starts or a window first breaks.
    drawing = true;
    warming = true;
    warmEffects();
    for (let i = 0; i < 30 && (i < 2 || !view.reflecting); i++) await nextFrame();
    warming = false;
    bodies.clear();
    effects.clear();
    // Drawing is only asked of the GPU; wait for it to have done it.
    await gpuDone();
  })
  .catch((err: unknown) => {
    console.warn('Assets failed to load; staying with flat colours.', err);
    toast('Textures failed to load. Playing in flat colours.');
  })
  .finally(finishLoading);

/** Resolves once the GPU has done everything asked of it so far, checked once a frame. */
function gpuDone(): Promise<void> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return Promise.resolve();
  gl.flush();
  return new Promise((resolve) => {
    const check = (): void => {
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED || gl.isContextLost()) {
        gl.deleteSync(sync);
        resolve();
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/**
 * Stand-ins drawn while warming: an operator, a guard and a commander, one
 * with each gun, in the air just ahead of the camera, near enough
 * to cast shadows as bodies close by do.
 */
function warmPlayers(): PlayerSnap[] {
  const at = camera.getWorldDirection(V_LOOK).multiplyScalar(12).add(camera.position);
  return (['operator', 'guard', 'guard'] as const).map((team, i) => ({
    id: -1 - i, team, x: at.x + i - 1, y: at.y - 1, z: at.z, yaw: 0, pitch: 0, duck: 0, lean: 0, dead: false, weapon: i, quiet: i === 0,
    motion: 'ground', act: 'none', actT: 0, commander: i === 2,
  }));
}

/**
 * Where the warming frames' effects go: the island's middle, or off a map,
 * so they don't hang over it in screenshots, where time stands still.
 */
const WARM_AT = world.map ? { x: world.bounds.minX - 60, z: world.bounds.minZ - 60 } : { x: 0, z: 0 };

/** A round, a hit and a broken panel with its debris, and a grenade going off, for the warming frames. */
function warmEffects(): void {
  const y = world.floorHeight(WARM_AT.x, WARM_AT.z);
  const at = new THREE.Vector3(WARM_AT.x, y + 1, WARM_AT.z + 2);
  effects.tracer(new THREE.Vector3(WARM_AT.x, y + 1, WARM_AT.z + 10), at);
  effects.impact(at, 'world', new THREE.Vector3(0, 1, 0));
  effects.impact(at, 'body', new THREE.Vector3(0, 1, 0));
  const panel = world.panels[0];
  if (panel) effects.shatter(panel.box, new THREE.Color(1, 1, 1), view.panelLayer(0), at.x, at.y, at.z);
  effects.explosion(at);
}

/** Show everything in `root` but its lights, unculled, and every instanced mesh with room for one at least once; returns the undoing. */
function showAll(root: THREE.Object3D): () => void {
  const undo: (() => void)[] = [];
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) return;
    if (!o.visible) {
      o.visible = true;
      undo.push(() => (o.visible = false));
    }
    if (o.frustumCulled) {
      o.frustumCulled = false;
      undo.push(() => (o.frustumCulled = true));
    }
    const m = o as THREE.InstancedMesh;
    // Not one built with room for none, as a map's watchtowers are: drawing one would read past its buffer.
    if (m.isInstancedMesh && m.count === 0 && m.instanceMatrix.count > 0) {
      m.count = 1;
      undo.push(() => (m.count = 0));
    }
  });
  return () => {
    for (const f of undo) f();
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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

/**
 * This browser's id for the scoreboard, made once and kept, so a player's record follows them
 * from run to run, not their name. With storage blocked it lasts until the page closes.
 */
const playerId = ((): string => {
  let id = '';
  try {
    id = store?.getItem('playerId') ?? '';
  } catch {
    // Made afresh below.
  }
  if (validPlayerId(id)) return id;
  // randomUUID needs a secure context; random bytes work in the single file too.
  id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    store?.setItem('playerId', id);
  } catch {
    // Kept for this page only.
  }
  return id;
})();

// ------------------------------------------------------------------ sharing

const toastEl = document.getElementById('toast')!;
let toastTimer = 0;

function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2500);
}

/** The score to beat from the link we came in on, if it's for `m`; a link without a mode counts for any with scores. */
function challengeFor(m: Mode): Challenge | null {
  return link.challenge && !isDeathmatch(m) && (link.mode ?? m) === m ? link.challenge : null;
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
  const rows: { name: string; score: number; deaths?: number; note: string; rival: boolean }[] = board.entries(config.seed, mode)
    .map((e) => ({ name: e.name, score: e.score, deaths: e.deaths, note: shortDate(e.date), rival: false }));
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
    // A Deathmatch game's kills and deaths.
    score.textContent = isDeathmatch(mode) ? `${r.score} kill${r.score === 1 ? '' : 's'} · ${r.deaths ?? 0} death${r.deaths === 1 ? '' : 's'}` : r.score.toLocaleString('en-US');
    const note = document.createElement('small');
    note.textContent = r.note;
    li.append(rank, name, score, note);
    return li;
  }), ...open);
  const empty = boardEl.querySelector('.empty') as HTMLElement;
  empty.hidden = rows.length > 0;
  boardEl.classList.toggle('none', rows.length === 0);
  empty.textContent = isDeathmatch(mode) ? 'No games yet. Leave a Deathmatch game with a kill to post it.' : 'No scores yet. Get off the island with loot to post one.';
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
const inputLoop = new FixedLoop(CMD_DT, () => {
  const buttons = input.sample();
  conn?.sendCmd(buttons, input.yaw, input.pitch, input.weapon);
}, 8);

// ------------------------------------------------------------------ modes

const briefing = document.getElementById('briefing')!;

/**
 * A line of the menu's briefing on what one choice means. Every option's note
 * sits in the same place, only the chosen one showing, so the longest sets the
 * height and picking another doesn't move the menu about.
 */
function briefingLine<K extends string>(notes: Record<K, string>, names?: Record<K, string>): (chosen: K) => void {
  const line = document.createElement('div');
  line.className = 'line';
  const options = (Object.keys(notes) as K[]).map((k) => {
    const option = document.createElement('p');
    const name = document.createElement('b');
    name.textContent = names?.[k] ?? k;
    option.append(name, notes[k]);
    line.append(option);
    return [k, option] as const;
  });
  briefing.append(line);
  return (chosen) => {
    for (const [k, option] of options) option.classList.toggle('on', k === chosen);
  };
}

const briefMode = briefingLine(MODE_NOTES, MODE_NAMES);
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('#modes button')];

function selectMode(m: Mode): void {
  // On a test map, only Deathmatch.
  if (devMap) m = 'deathmatch';
  if (mapFor(m) !== world.map && !devMap) {
    // Deathmatch is played on a map of its own: the page loads again to build it.
    try {
      localStorage.setItem('mode', m);
      sessionStorage.setItem('pickedMode', m);
    } catch {
      // Then the island stays as it is, and so does the mode.
      return;
    }
    location.reload();
    return;
  }
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

// ---------------------------------------------------------------- weather

/** The clock of the game last left, as it stood when we left it at `at`, performance seconds; null before any. */
let menuWeather: { forecast: Forecast; time: number; at: number } | null = null;

/** How wet the island is, along the clock of the weather shown. */
const wetting = new Wetting();

/** A weather held by `?sky=` (see heldSky), or null for anything else. */
function parseHeldSky(q: string | null): { forecast: Forecast; time: number } | null {
  const [from, to, at] = (q ?? '').split(',');
  const a = parseWeather(from);
  if (!a) return null;
  const b = parseWeather(to) ?? a;
  const change = 45;
  const x = Number(at ?? 1);
  return { forecast: Forecast.held(a, b, change), time: x >= 0 ? x * change : x };
}

/** Light the island and set its sounds for the weather in `f` at `time`, the game's clock. */
function showWeather(f: Forecast, time: number): void {
  if (heldSky) ({ forecast: f, time } = heldSky);
  const o = outlookAt(f, time);
  wetting.update(f, time);
  sfx.outlook = o;
  if (!view.setOutlook(o, wetting.wet, wetting.puddles)) return;
  const lit = view.lit;
  renderer.toneMappingExposure = lit.exposure;
  viewModel.setLight(lit.ambient, lit.sunColor, lit.sunIntensity / 3.3, lit.hemiSky, lit.hemiGround);
}
// Before the outlook first differs from the view's own.
viewModel.setLight(view.lit.ambient, view.lit.sunColor, view.lit.sunIntensity / 3.3, view.lit.hemiSky, view.lit.hemiGround);
showWeather(forecast, 0);

{
  // Links from before the weather changed during a game may carry it, and older ones a time of day: both are dropped.
  const q = new URLSearchParams(location.search);
  q.delete('time');
  q.delete('weather');
  const search = q.size ? `?${q}` : '';
  if (search !== location.search) history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
}

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
  mySoak = new Soak();
  conn = new Connection(config, world, mode, playerName(), transport, playerId, devMap ? devMapName! : undefined);
  conn.onFx = (fx) => weaponFx(fx, () => conn?.interpolated() ?? []);
  conn.onEvents = (events, time) => events.forEach((e) => onEvent(e, time));
  conn.onWelcome = (cover) => showCover(cover);
  conn.onSpawn = (s) => {
    input.yaw = s.yaw;
    input.pitch = s.pitch;
    // Back in, in Deathmatch: whatever death cam was coming is for a life gone by.
    killedBy = null;
    stopDeathcam(false);
  };
  hud.reset();
  hud.respawns = runHud.deathmatch = isDeathmatch(mode);
  view.showExtracts = !isDeathmatch(mode);
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
  // The range is for trying things out: nothing there counts.
  const counts = mode !== 'range';
  if (counts) runLog.add(runRecord(e, config, mode, (i) => extractNames[i]));
  const standing: string[] = [];
  const place = counts ? board.add(config.seed, mode, { name: playerName(), score: e.score, date: today() }) : 0;
  if (place === 1) standing.push('New best on this island!');
  else if (place > 1) standing.push(`#${place} of your runs on this island.`);
  const c = challengeFor(mode);
  if (c) {
    const target = `${c.name}’s ${c.score.toLocaleString('en-US')}`;
    standing.push(e.score > c.score ? `You beat ${target}!` : `${target} still stands.`);
  }
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
    void loadPlayback().then(playDeathcam, afterDeathcam);
    return;
  }
  deathcam = new playback.Deathcam(world, killedBy.e, killedBy.recording, conn?.cover ?? noCover, conn?.forecast ?? forecast);
  ownDeath = killedBy.e.killer === conn?.id;
  showCover(deathcam.cover);
  // Start the bodies afresh, as they were then; the magazines they dropped already lie where they fell.
  bodies.clear();
  bodies.replaying = true;
  runHud.hideResults();
  // The killer's health, ammo and hits.
  hudEl.hidden = false;
  hudEl.classList.add('watching');
  const kind = killedBy.e.kind ? `, a ${killedBy.e.kind}` : '';
  deathcamEl.querySelector('.banner span')!.textContent = ownDeath ? 'Killed by your own grenade' : `Killed by ${deathcam.name}${kind}`;
  // In Deathmatch the mouse stays ours, for playing on straight after.
  deathcamEl.querySelector('.skip')!.textContent = isDeathmatch(conn?.mode) ? 'Press Space to skip and respawn' : 'Click or press Space to skip';
  deathcamEl.hidden = false;
}

/** The death cam is over, or couldn't load: the results, or in Deathmatch back in. */
function afterDeathcam(): void {
  if (isDeathmatch(conn?.mode)) respawn();
  else showLastResults?.();
}

/** In Deathmatch, dead: back in now, once. */
function respawn(): void {
  const s = conn?.predictor.state;
  if (!conn || !isDeathmatch(conn.mode) || !s?.dead || asked === s.life) return;
  asked = s.life;
  killedBy = null;
  conn.respawn();
}
/** The life we last asked to respawn from. */
let asked = -1;

/**
 * In Deathmatch the death cam starts by itself, after the same moment of the
 * death camera as before the results elsewhere, if we're still down by then.
 */
function deathmatchCam(): void {
  const shown = conn;
  const life = conn?.predictor.state?.life;
  setTimeout(() => {
    if (conn !== shown || !conn || deathcam || !conn.predictor.state?.dead || conn.predictor.state?.life !== life) return;
    playDeathcam();
  }, Math.max(RESULTS_DELAY_DEAD - DEATHCAM_AFTER, 0) * 1000);
}

/** The death cam ended or was skipped: on to the results, unless leaving anyway. */
function stopDeathcam(results = true): void {
  if (!deathcam) return;
  deathcam = null;
  deathcamEl.hidden = true;
  // In Deathmatch play goes on.
  hudEl.hidden = !isDeathmatch(conn?.mode);
  hudEl.classList.remove('watching');
  showCover(conn?.cover ?? noCover);
  bodies.clear();
  bodies.replaying = false;
  if (results) afterDeathcam();
}

deathcamEl.onclick = () => stopDeathcam();
window.addEventListener('keydown', (e) => {
  if (deathcam && (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter')) {
    e.preventDefault();
    stopDeathcam();
  } else if (e.code === 'Space' && conn && isDeathmatch(conn.mode) && conn.predictor.state?.dead) respawn();
});
document.getElementById('watch-deathcam')!.onclick = playDeathcam;

/** Put the panels in the world as `cover` says, for a death cam's moment or back to now. */
function showCover(cover: CoverState): void {
  world.syncPanels(cover.broken);
  view.syncPanels();
  sfx.changed();
}

/** The sky's light where the gun in your hands is, and how fast it brightens which way, per metre in the world. */
const indoors = new THREE.Color(1, 1, 1);
const indoorTowards = new THREE.Vector3();
/** And the sun's light bounced to it, as a share of the sun's. */
const indoorBounce = new THREE.Color(0, 0, 0);
/** How far ahead of the eye the gun is, metres, and the probe a step either side of it. */
const GUN_AHEAD = 0.4;
const PROBE = 0.5;
const probe = new THREE.Color();
const probeSun = new THREE.Color();
const gunAt = new THREE.Vector3();
const towards = new THREE.Vector3();
const unturn = new THREE.Quaternion();

/**
 * Light the gun in your hands like the room it's in, from the side of a
 * window or a doorway, easing as you go in or out.
 */
function lightGun(dt: number): void {
  const p = camera.getWorldDirection(gunAt).multiplyScalar(GUN_AHEAD).add(camera.position);
  const bright = (x: number, y: number, z: number): number => {
    view.lightAt(x, y, z, probe, probeSun);
    return 0.2126 * probe.r + 0.7152 * probe.g + 0.0722 * probe.b;
  };
  towards.set(
    bright(p.x + PROBE, p.y, p.z) - bright(p.x - PROBE, p.y, p.z),
    bright(p.x, p.y + PROBE, p.z) - bright(p.x, p.y - PROBE, p.z),
    bright(p.x, p.y, p.z + PROBE) - bright(p.x, p.y, p.z - PROBE),
  ).divideScalar(2 * PROBE);
  const k = Math.min(dt * 4, 1);
  view.lightAt(p.x, p.y, p.z, probe, probeSun);
  indoors.lerp(probe, k);
  indoorTowards.lerp(towards, k);
  indoorBounce.lerp(probeSun, k);
  viewModel.shade(indoors, towards.copy(indoorTowards).applyQuaternion(unturn.copy(camera.quaternion).invert()), indoorBounce);
}

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

/**
 * Leaving a Deathmatch game: post its kills and deaths to this island's board,
 * as Extraction posts a run's score. A game without a kill isn't kept.
 */
function postDeathmatch(): void {
  if (!conn || !isDeathmatch(conn.mode) || conn.over || posted === conn) return;
  posted = conn;
  const row = conn.board.find((r) => r.id === conn!.id);
  if (row) board.add(config.seed, conn.mode, { name: playerName(), score: row.kills, deaths: row.deaths, date: today() });
}
/** The game last posted, so closing the page after leaving doesn't post it again. */
let posted: Connection | null = null;
// Closing the page leaves the game too.
window.addEventListener('pagehide', postDeathmatch);

function toMenu(): void {
  stopDeathcam(false);
  postDeathmatch();
  // The game is kept a while after we leave, its weather turning on: the menu's goes along with it.
  if (conn?.forecast) menuWeather = { forecast: conn.forecast, time: conn.renderTime(), at: performance.now() / 1000 };
  conn?.leave();
  conn = null;
  showBoard();
  runHud.hideResults();
  document.getElementById('hud')!.hidden = true;
  paused.hidden = true;
  menu.hidden = false;
  view.preview = true;
  view.showExtracts = !world.map;
  bodies.clear();
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
/** A game event, from the game's `time` (in seconds), or replayed in a death cam. */
function onEvent(e: GameEvent, time: number, replayed = false): void {
  if (deathcam && !replayed && e.k !== 'deathcam' && e.k !== 'runEnd') return;
  // Whose eyes we see through: our own, or the killer's in a death cam.
  const me = deathcam?.state ?? conn?.predictor.state;
  const meYaw = input.yaw;
  switch (e.k) {
    case 'hit':
      feedEvent(e);
      sfx.hit(e.zone === 'head', e.killed);
      // Hits are told to whoever fired, so the round came from where the camera is.
      bodies.flash(e.target, e.x, e.y, e.z, camera.position);
      break;
    case 'hurt':
      if (me) hud.hurtFrom(e.damage, bearing(me.x, me.z, meYaw, e.x, e.z));
      sfx.hurt();
      break;
    case 'kill':
      bodies.killed(e, time);
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
      if (!conn) break;
      // In Deathmatch, only while still down: once back in, that death is past.
      if (isDeathmatch(conn.mode) && !conn.predictor.state?.dead) break;
      killedBy = { e, recording: conn.recorded() };
      if (isDeathmatch(conn.mode)) deathmatchCam();
      break;
    case 'break': {
      const color = new THREE.Color();
      for (const id of e.panels) {
        world.setPanel(id, false);
        view.updatePanel(id);
        effects.shatter(world.panels[id].box, view.panelColor(id, color), view.panelLayer(id), e.x, e.y, e.z);
      }
      bodies.shake(e.x, e.y, e.z, 4, time);
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
    case 'boom': {
      const d = me ? Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z) : Infinity;
      effects.explosion(to.set(e.x, e.y, e.z));
      bodies.blast(e.x, e.y, e.z, time);
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

/** What an event out in the world sounds like: a shot, a blast or cover breaking. */
function eventSound(e: GameEvent): void {
  switch (e.k) {
    case 'shot':
      sfx.shot(e.weapon, { x: e.ox, y: e.oy, z: e.oz }, e.quiet);
      break;
    case 'boom':
      sfx.boom(e);
      break;
    case 'break': {
      const first = world.panels[e.panels[0]];
      if (!first) break;
      const b = first.box;
      sfx.smash(first.kind, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 });
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
if (!Number.isNaN(still)) view.finishLight();

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
      dead: false, weapon: 0, quiet: false, motion: 'ground', act: 'none', actT: 0, commander: false,
    };
  });

/** Seconds for the wind, waves and rain. */
function sceneTime(): number {
  return Number.isNaN(still) ? performance.now() / 1000 : still;
}

/**
 * What the menu's camera circles, and how far out and how high: the whole
 * island from well above it, or a map from close over its middle.
 */
const menuOrbit = ((): { x: number; z: number; r: number; y: number; lookY: number } => {
  if (!world.map) return { x: 0, z: 0, r: MENU_ORBIT_RADIUS, y: world.maxHeight + 90, lookY: 0 };
  const b = world.bounds;
  const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const ground = world.terrainHeight(x, z);
  const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.8 + 30;
  return { x, z, r, y: ground + r * 0.6, lookY: ground };
})();

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
  const o = menuOrbit;
  camera.position.set(o.x + Math.sin(a) * o.r, o.y, o.z + Math.cos(a) * o.r);
  camera.lookAt(o.x, o.lookY, o.z);
  focus.set(o.x, o.lookY, o.z);
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
  lightGun(dt);

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
    rounds: Math.min(w.magSize - s.mag[s.weapon], s.reserve[s.weapon]),
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
      treeFade, camera, scene, renderer, bodies, effects, sfx, viewModel, input, resolution, dev,
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
  cam?.update(dt, (fx) => weaponFx(fx, () => cam.others()), (e: RecordedEvent, time: number) => onEvent(e, time, true), (kill) => ownDeath || hud.mark(false, kill));
  // Soldiers stood on the menu's island hold still for screenshots with time stopped.
  const bodyDt = cam ? Math.max(cam.time - before, 0) : !conn && !Number.isNaN(still) ? 0 : dt;
  hud.age(bodyDt);
  const players = cam ? cam.others() : (conn?.interpolated() ?? (warming ? warmPlayers() : devStanding));
  bodies.sun.copy(view.lit.sunDir);
  bodies.mirrored = view.reflecting;
  // Bodies fall on the game's clock, against everyone as the server had them.
  const clock = cam
    ? { time: cam.time, at: (t: number) => cam.everyoneAt(t) }
    : conn ? { time: conn.renderTime(), at: (t: number) => conn!.everyoneAt(t) } : undefined;
  bodies.update(players, bodyDt, camera, clock);
  const y0 = world.floorHeight(WARM_AT.x, WARM_AT.z);
  bags.update(conn?.bags ?? (warming ? [{ id: -1, x: WARM_AT.x, y: y0, z: WARM_AT.z + 1 }] : []), bodyDt);
  grenades.update(cam ? cam.grenades() : (conn?.grenades() ?? (warming ? [{ id: -1, x: WARM_AT.x + 1, y: y0 + 0.5, z: WARM_AT.z + 1 }] : [])));
  if (conn) view.setExtracts(conn.extracts, now);
  // The weather of the moment shown: the kill's in a death cam, and on the menu the game last left's, going on as it does.
  if (cam) showWeather(cam.forecast, cam.time);
  else if (conn?.forecast) showWeather(conn.forecast, conn.renderTime());
  else if (!conn && menuWeather && Number.isNaN(still)) showWeather(menuWeather.forecast, menuWeather.time + now - menuWeather.at);

  const me = conn?.predictor.render(inputLoop.alpha);
  if (me && !cam) mySoak.update(view.shelter, me.x, me.y + 1, me.z, dt);
  /** Whose view is shown: the killer's in a death cam, else ours. */
  const state = cam ? cam.state : (conn?.predictor.state ?? null);
  const eye = cam?.view();
  if (eye && cam) eyeCamera(eye, eye.yaw, eye.pitch, cam.state, dt);
  else if (me && state) {
    eyeCamera(me, input.yaw, input.pitch, state, dt);
    footsteps(state);
  } else orbitCamera(now);
  camera.updateMatrixWorld();
  // The gun in hand, yours or the killer's in a death cam, as wet as its holder.
  viewModel.soak.value = cam ? (bodies.soakNear(cam.state.x, cam.state.y, cam.state.z) ?? 0) : mySoak.level.value;
  viewModel.up.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
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
    if (me && !conn.over) runHud.update(conn.run, conn.extracts, me.x, me.z, input.yaw, camera);
    else runHud.update(null, [], 0, 0, 0, camera);
    if (!paused.hidden) runHud.updatePause(isDeathmatch(conn.mode) ? null : conn.run, isDeathmatch(conn.mode) ? '' : pauseStanding());
  }
  if (conn && !cam && me && !conn.over) rivalHud.update(conn.bags, conn.bounty, conn.id, camera.position, conn.lastTick * SERVER_DT, camera);
  else rivalHud.update([], null, 0, null, 0, camera);
  scoreboard.update(conn?.board ?? [], conn?.id ?? 0, !!conn && !conn.over && !cam && !!paused.hidden, isDeathmatch(conn?.mode));
  const contracts = conn && !conn.over && !cam ? (conn.run?.contracts ?? []) : [];
  contractProps.update(contracts);

  if (cam?.done) stopDeathcam();
  if (holdFrame || !drawing) return;
  const shown = warming ? [showAll(scene), showAll(viewModel.scene)] : [];
  view.reflect(renderer, camera, warming);
  const wobbling = view.underwater;
  if (wobbling) wobble(camera, now);
  renderer.clear();
  renderer.render(scene, camera);
  if (wobbling) camera.updateProjectionMatrix();
  view.lookForSea(renderer, camera);
  if (state || warming) {
    renderer.clearDepth();
    renderer.render(viewModel.scene, viewModel.camera);
  }
  for (const undo of shown) undo();
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
