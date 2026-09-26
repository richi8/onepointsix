import * as THREE from 'three';
import { loadAssets } from '../src/client/assets.ts';
import { Bodies } from '../src/client/bodies.ts';
import { ViewModel } from '../src/client/viewmodel.ts';
import { hitboxes, HEAD_RADIUS } from '../src/shared/hitbox.ts';
import type { PlayerSnap } from '../src/shared/protocol.ts';
import { GRENADE } from '../src/shared/weapons.ts';

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
// gives that body weapon w. For land, hit, hithead, shoot and cycle (a
// bolt-action shot and the bolt worked after it), t is the seconds since. `view` is side,
// front, back or fp. Also: `weapon`, `quiet` (suppressor), `aim` (fp), `hb`
// (hitbox heads), `wall=x` (a wall to fall against), `slope=k` (ground
// rising k per metre along x), `d` (camera distance), `eye=x,y,z` and
// `at=x,y,z` (camera by hand) and `nogun` (fp arms alone) and `hit` (a round
// just landed in the first body's chest). The dead are killed by a round from
// in front, or from yaw `from`, in the head with `headshot`, or by a grenade
// with `grenade`; `dead:t` has been dead for 2t seconds. The page sets
// document.title to "ready" once the frame is drawn, for screenshots.

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

const floor = (x: number): number => Math.max(0, x * slope);
const ground = {
  buildings: [],
  groundHeight: floor,
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
const spacing = 1.6;
const width = (show.length - 1) * spacing;
const distance = Number(q.get('d') ?? 3 + show.length * 2.2);
camera.position.set(width / 2, 1.1, distance);
camera.lookAt(width / 2, 0.8, 0);
// `eye` and `at` place the camera by hand, as x,y,z.
if (q.has('eye')) camera.position.fromArray(q.get('eye')!.split(',').map(Number));
if (q.has('at')) camera.lookAt(new THREE.Vector3().fromArray(q.get('at')!.split(',').map(Number)));

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
    light: q.has('light'),
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
    case 'jump': base.motion = 'air'; move(3); base.y = 0.6 + (end - s) * -3; break;
    case 'fall': base.motion = 'air'; move(3); base.y = 0.6 + (end - s) * 5; break;
    case 'mantle': base.motion = 'mantle'; base.y = 0.3 + (s - end) * 2; break;
    // Coming down for half a second, landing t seconds ago.
    case 'land': if (s < end - t) (base.motion = 'air'), (base.y = (end - t - s) * 4); break;
    case 'cycle': base.weapon = 2; break;
    case 'reload': case 'draw': case 'throw': base.act = name; base.actT = t; break;
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
bodies.setModel(assets.soldier, assets.guns);
viewModel.setGuns(assets.guns, assets.environment);
viewModel.setArms(assets.soldier);

if (view === 'fp') {
  viewModel.resize(innerWidth / innerHeight);
  const t = T;
  const reload = q.get('act') === 'reload' ? t : 0;
  const draw = q.get('act') === 'draw' ? 1 - t : q.get('act') === 'throw' ? 1 : 0;
  viewModel.scene.background = new THREE.Color(0x8fa3b3);
  for (let i = 0; i < 30; i++) {
    viewModel.update(1 / 30, {
      weapon, aim: Number(q.get('aim') ?? 0), reload, draw, speed: 0, onGround: true, sprinting: false,
      suppressed: q.has('quiet'), throwing: q.get('act') === 'throw' ? t : -1,
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
      if (name === 'hit' || name === 'hithead') bodies.flash(p.id, p.x, p.y + (name === 'hit' ? 1.2 : 1.6), p.z);
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
