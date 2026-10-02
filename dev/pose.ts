import * as THREE from 'three';
import { loadAssets } from '../src/client/assets.ts';
import { Bodies } from '../src/client/bodies.ts';
import { AVATAR_NAMES, AVATARS } from '../src/shared/avatars.ts';
import { ViewModel } from '../src/client/viewmodel.ts';
import { hitboxes, HEAD_RADIUS } from '../src/shared/hitbox.ts';
import { DUCK_RATE, MANTLE_PRESS_HEIGHT } from '../src/shared/constants.ts';
import type { PlayerSnap } from '../src/shared/protocol.ts';
import { mantleStep, spawnState } from '../src/shared/sim.ts';
import { GRENADE, WEAPONS } from '../src/shared/weapons.ts';

// A dev page for looking at the soldier's poses without playing: a row of
// bodies, each frozen in one state, or the first-person arms. Run `npm run dev`
// and open it:
//
//   /dev/pose.html?show=stand,crouchwalk,jump&view=side
//   /dev/pose.html?show=reload:0.1,reload:0.4,throw:0.2&view=front
//   /dev/pose.html?view=fp&weapon=0&act=reload&t=0.3
//
// `show` lists the states (see snap below); `name:t` sets how far through an
// action or a death that body is, and `t` sets it for all; `name:t:w` also
// gives that body weapon w. A reload plays up to t, so what it drops falls.
// For land, hit, hithead, hitleg, shoot and cycle (a bolt-action shot and the
// bolt worked after it), t is the seconds since. Hits come from yaw `from`
// (in front by default), `side` metres right of the middle. `view` is side,
// front, back or fp. Also: `weapon`, `quiet` (suppressor), `aim` (fp), `hb`
// (hitbox heads), `wall=x` (a wall to fall against), `slope=k` (ground
// rising k per metre along x), `rounds` (a reload's), `d` (camera distance),
// `eye=x,y,z` and `at=x,y,z` (camera by hand) and `nogun` (fp arms alone) and
// `hit` (a round just landed in the first body's chest), `climb:t` (t seconds into a climb onto `ledge`,
// a ledge that high in front of everyone in the front view). The dead are killed
// by a round from in front, or from yaw `from`, in the head with `headshot`,
// or by a grenade with `grenade`; `dead:t` has been dead for 2t seconds.
// `spacing=k` stands the bodies k metres apart (1.6 by default), so the dead
// fall on each other or against the living, and `blast=t` sets off a grenade
// t seconds before the end at `blastat=x,z` (the middle of the row, a little
// in front, by default). Each body wears its side's first avatar (see
// src/shared/avatars.ts), or `avatar=<name>` for everyone, `avatar=each` for
// each in turn, or `avatar=<seed>` as that island picks them; `guard` and
// `commander` stand as one. The page sets document.title to "ready" once the
// frame is drawn, for screenshots.

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'side';
const T = Number(q.get('t') ?? 0.4);
const weapon = Number(q.get('weapon') ?? 0);
const show = (q.get('show') ?? 'stand,walk,run,crouch,crouchwalk,jump,fall,mantle,reload,draw,throw,lean,dead').split(',');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa3b3);
scene.add(new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.2));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(5, 10, 8);
scene.add(sun);
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f7a5a }));
scene.add(floorMesh);
const wallX = q.has('wall') ? Number(q.get('wall')) : null;
if (wallX !== null) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 4), new THREE.MeshStandardMaterial({ color: 0x9a8f80 }));
  wall.position.set(wallX, 1, 0);
  scene.add(wall);
}
const slope = Number(q.get('slope') ?? 0);
// A ledge `ledge` metres high in front of everyone, facing the front view, for climbs.
const ledge = Number(q.get('ledge') ?? 1.2);
const LEDGE_Z = 0.5;
if (q.has('ledge')) {
  // From just left of the first body, so a camera off to its left sees the ledge side on.
  const block = new THREE.Mesh(new THREE.BoxGeometry(30, ledge, 3), new THREE.MeshStandardMaterial({ color: 0x9a8f80 }));
  block.position.set(14.4, ledge / 2, LEDGE_Z + 1.5);
  scene.add(block);
}

const floor = (x: number): number => x * slope;
const ground = {
  buildings: [],
  groundHeight: (x: number, z: number, feetY: number): number =>
    q.has('ledge') && z > LEDGE_Z && ledge <= feetY + 0.55 ? Math.max(ledge, floor(x)) : floor(x),
  ledgeHeight: (_x: number, z: number, minY: number, maxY: number): number =>
    q.has('ledge') && z > LEDGE_Z && ledge > minY && ledge <= maxY ? ledge : -Infinity,
  floorHeight: floor,
  // The wall is a box 0.2 thick, 2 high and 4 long.
  sphereOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
    out.x = out.y = out.z = 0;
    if (wallX === null) return false;
    const cx = Math.max(wallX - 0.1, Math.min(x, wallX + 0.1));
    const cy = Math.max(0, Math.min(y, 2));
    const cz = Math.max(-2, Math.min(z, 2));
    const d = Math.hypot(x - cx, y - cy, z - cz);
    if (d >= r) return false;
    if (d < 1e-9) {
      out.x = (x < wallX ? -1 : 1) * (r + 0.1 - Math.abs(x - wallX));
      return true;
    }
    out.x = ((x - cx) / d) * (r - d);
    out.y = ((y - cy) / d) * (r - d);
    out.z = ((z - cz) / d) * (r - d);
    return true;
  },
  raycast(ox: number, _oy: number, _oz: number, dx: number, _dy: number, _dz: number, maxT: number): number {
    if (wallX === null || Math.abs(dx) < 1e-6) return maxT + 1;
    const t = (wallX - Math.sign(dx) * 0.1 - ox) / dx;
    return t >= 0 && t < maxT ? t : maxT + 1;
  },
};
if (slope) floorMesh.rotation.z = Math.atan(slope);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 200);
const spacing = Number(q.get('spacing') ?? 1.6);
const width = (show.length - 1) * spacing;
const distance = Number(q.get('d') ?? 3 + show.length * 2.2);
camera.position.set(width / 2, 1.1, distance);
camera.lookAt(width / 2, 0.8, 0);
// `eye` and `at` place the camera by hand, as x,y,z.
if (q.has('eye')) camera.position.fromArray(q.get('eye')!.split(',').map(Number));
if (q.has('at')) camera.lookAt(new THREE.Vector3().fromArray(q.get('at')!.split(',').map(Number)));
// Bodies are culled by it before it's first drawn.
camera.updateMatrixWorld();

/** Each state as a snapshot at time `s` seconds in; movers move along their facing. */
function snap(entry: string, i: number, s: number, end: number): PlayerSnap {
  // `name:t` overrides t for one body, and `name:t:w` its weapon.
  const [name, own, gun] = entry.split(':');
  const t = own ? Number(own) : T;
  // Side view: facing -x (yaw pi/2), so the camera sees their left side. Front: facing the camera.
  const yaw = view === 'side' ? Math.PI / 2 : view === 'back' ? 0 : Math.PI;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const base: PlayerSnap = {
    id: i + 1, team: name === 'commander' || name === 'guard' ? 'guard' : 'operator', x: i * spacing, y: 0, z: 0, yaw, pitch: 0, duck: 0, lean: 0,
    dead: false, weapon: gun ? Number(gun) : weapon, quiet: q.has('quiet'), motion: 'ground', act: 'none', actT: 0, commander: name === 'commander',
  };
  const move = (speed: number): void => {
    base.x += fx * speed * (s - end);
    base.z += fz * speed * (s - end);
  };
  switch (name) {
    case 'walk': move(1.5); break;
    case 'run': move(5.5); break;
    case 'crouch': base.duck = 1; break;
    case 'crouchwalk': base.duck = 1; move(2.2); break;
    case 'crouchrun': base.duck = 1; move(2.4); break;
    case 'sneak': base.duck = 1; move(0.8); break;
    case 'jump': base.motion = 'air'; move(3); base.y = 0.6 + (end - s) * -3; break;
    case 'fall': base.motion = 'air'; move(3); base.y = 0.6 + (end - s) * 5; break;
    case 'mantle': base.motion = 'mantle'; base.y = 0.3 + (s - end) * 2; break;
    // Onto the ledge, as the game climbs; t seconds in.
    case 'climb': {
      const into = s - (end - t);
      if (into < 0) break;
      // Grabbed 0.85 m ahead and landed 0.35 m further on, as on a deep ledge.
      const c = spawnState(base.x, base.y, base.z);
      Object.assign(c, { mantling: true, mantleX: base.x, mantleY: ledge, mantleZ: base.z + 1.2 });
      // Hunched pressing up over the ledge, then standing on it, as applyCmd eases it.
      for (let k = 0; k < into * 60; k++) {
        if (c.mantling) mantleStep(c, 1 / 60);
        const hunch = c.mantling && c.y >= ledge - MANTLE_PRESS_HEIGHT;
        c.duck = Math.min(Math.max(c.duck + (hunch ? 1 : -1) * DUCK_RATE / 60, 0), 1);
      }
      base.y = c.y;
      base.z = c.z;
      base.duck = c.duck;
      base.motion = c.mantling ? 'mantle' : 'ground';
      break;
    }
    // Coming down for half a second, landing t seconds ago.
    case 'land': if (s < end - t) (base.motion = 'air'), (base.y = (end - t - s) * 4); break;
    case 'cycle': base.weapon = 2; break;
    // A reload plays up to t, taking its gun's time, so what it lets go of falls.
    case 'reload': base.act = name; base.actT = Math.max(t - (end - s) / WEAPONS[base.weapon].reloadTime, 0); if (q.has('rounds')) base.rounds = Number(q.get('rounds')); break;
    case 'draw': case 'throw': base.act = name; base.actT = t; break;
    case 'lean': base.lean = 1; break;
    case 'leanl': base.lean = -1; break;
    case 'aimup': base.pitch = 0.6; break;
    case 'dead': base.dead = s > end - t * 2; break;
    case 'pistol': base.weapon = 1; break;
    case 'bolt': base.weapon = 2; break;
  }
  // On a slope, standing on it.
  base.y += floor(base.x);
  return base;
}

const bodies = new Bodies(scene, ground);
Object.assign(window, { bodies });
const viewModel = new ViewModel();
const assets = await loadAssets(renderer);
scene.environment = assets.environment;
scene.environmentIntensity = 0.6;
bodies.setModel(assets.soldiers, assets.guns);
viewModel.setGuns(assets.guns, assets.environment);
viewModel.setArms(assets.soldiers[0]);
// Each side's first avatar by default, or one for everyone, each in turn, or as an island's seed picks them.
const wear = q.get('avatar');
if (wear === 'each') bodies.pick = (id) => (id - 1) % AVATAR_NAMES.length;
else if (wear !== null && AVATAR_NAMES.includes(wear)) bodies.pick = () => AVATAR_NAMES.indexOf(wear);
else if (wear !== null) bodies.seed = Number(wear);
else bodies.pick = (_id, side) => AVATAR_NAMES.indexOf(AVATARS[side][0]);

if (view === 'fp') {
  viewModel.resize(innerWidth / innerHeight);
  const t = T;
  const reload = q.get('act') === 'reload' ? t : 0;
  const draw = q.get('act') === 'draw' ? 1 - t : q.get('act') === 'throw' ? 1 : 0;
  viewModel.scene.background = new THREE.Color(0x8fa3b3);
  for (let i = 0; i < 30; i++) {
    viewModel.update(1 / 30, {
      weapon, aim: Number(q.get('aim') ?? 0), reload, draw, speed: 0, onGround: true, sprinting: false,
      suppressed: q.has('quiet'), rounds: Number(q.get('rounds') ?? 3), throwing: q.get('act') === 'throw' ? t : -1,
    }, 0, 0);
  }
  if (q.has('nogun')) viewModel.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && !(o as THREE.Mesh).geometry.type.startsWith('Sphere')) o.visible = false;
  });
  renderer.render(viewModel.scene, viewModel.camera);
} else {
  // Long enough for the longest death asked for.
  const end = Math.max(3, ...show.map((e) => (e.startsWith('dead') ? Number(e.split(':')[1] ?? T) * 2 + 0.1 : 0)));
  const dt = 1 / 60;
  let prev: boolean[] = [];
  for (let s = 0; s <= end + 1e-6; s += dt) {
    const snaps = show.map((name, i) => snap(name, i, s, end));
    // Shots and hits land t seconds before the end.
    show.forEach((entry, i) => {
      const [name, own] = entry.split(':');
      const at = end - (own ? Number(own) : T);
      if (s < at || s - dt >= at) return;
      const p = snaps[i];
      if (name === 'shoot' || name === 'cycle') bodies.fire(p.id, false);
      if (name === 'hit' || name === 'hithead' || name === 'hitleg') {
        // From `from`, a yaw the round comes from, or in front; `side` moves the point struck to its right.
        const from = q.has('from') ? Number(q.get('from')) : p.yaw;
        const side = Number(q.get('side') ?? 0);
        const x = p.x + Math.cos(p.yaw) * side;
        const z = p.z - Math.sin(p.yaw) * side;
        const y = p.y + (name === 'hit' ? 1.2 : name === 'hitleg' ? 0.5 : 1.6);
        bodies.flash(p.id, x, y, z, new THREE.Vector3(x - Math.sin(from) * 10, y, z - Math.cos(from) * 10));
      }
    });
    // The dead are shot from in front (or `from`, a yaw the round comes from) just before they're seen dead.
    snaps.forEach((p, i) => {
      if (!p.dead || prev[i]) return;
      const from = q.has('from') ? Number(q.get('from')) : p.yaw;
      const dir: [number, number, number] = [Math.sin(from), 0, Math.cos(from)];
      const head = q.has('headshot');
      const y = p.y + (head ? 1.6 : 1.25);
      bodies.killed({
        victim: p.id, weapon: q.has('grenade') ? GRENADE : p.weapon, head,
        pose: [p.x, p.y, p.z, p.yaw, p.duck], at: [p.x, y, p.z], dir,
      });
    });
    prev = snaps.map((p) => p.dead);
    if (q.has('blast')) {
      const at = end - Number(q.get('blast'));
      const [bx, bz] = q.has('blastat') ? q.get('blastat')!.split(',').map(Number) : [width / 2, 0.6];
      if (s >= at && s - dt < at) bodies.blast(bx, floor(bx) + 0.1, bz);
    }
    bodies.update(snaps, dt, camera);
  }
  if (q.has('hit')) {
    // A round lands in the first body's chest, just now.
    const p = snap(show[0], 0, end, end);
    bodies.flash(p.id, p.x, p.y + 1.3, p.z);
    bodies.update(show.map((name, i) => snap(name, i, end, end)), 0.01, camera);
  }
  if (q.has('hb')) {
    for (const [i, name] of show.entries()) {
      const p = snap(name, i, end, end);
      if (p.dead) continue;
      const h = hitboxes(p);
      const m = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true }));
      m.position.set(h.headX, h.headY, h.headZ);
      scene.add(m);
    }
  }
  renderer.render(scene, camera);
}

document.title = 'ready';
