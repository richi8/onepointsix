import * as THREE from 'three';
import { loadAssets } from '../src/client/assets.ts';
import { Bodies } from '../src/client/bodies.ts';
import { ViewModel } from '../src/client/viewmodel.ts';
import { hitboxes, HEAD_RADIUS } from '../src/shared/hitbox.ts';
import type { PlayerSnap } from '../src/shared/protocol.ts';

// A dev page for looking at the soldier's poses without playing: a row of
// bodies, each frozen in one state, or the first-person arms. Run `npm run dev`
// and open it:
//
//   /dev/pose.html?show=stand,crouchwalk,slide&view=side
//   /dev/pose.html?show=reload:0.1,reload:0.4,throw:0.2&view=front
//   /dev/pose.html?view=fp&weapon=0&act=reload&t=0.3
//
// `show` lists the states (see snap below); `name:t` sets how far through an
// action or a death that body is, and `t` sets it for all. `view` is side,
// front, back or fp. Also: `weapon`, `quiet` (suppressor), `aim` (fp), `hb`
// (hitbox heads), `wall=x` (a wall to fall against), `slope=k` (ground
// rising k per metre along x), `d` (camera distance), `eye=x,y,z` and
// `at=x,y,z` (camera by hand) and `nogun` (fp arms alone) and `hit` (a round
// just landed in the first body's chest). The page sets
// document.title to "ready" once the frame is drawn, for screenshots.

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'side';
const T = Number(q.get('t') ?? 0.4);
const weapon = Number(q.get('weapon') ?? 0);
const show = (q.get('show') ?? 'stand,walk,run,crouch,crouchwalk,slide,jump,fall,mantle,reload,draw,throw,lean,dead').split(',');

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
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f7a5a }));
scene.add(floor);
const wallX = q.has('wall') ? Number(q.get('wall')) : null;
if (wallX !== null) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 4), new THREE.MeshStandardMaterial({ color: 0x9a8f80 }));
  wall.position.set(wallX, 1, 0);
  scene.add(wall);
}
const slope = Number(q.get('slope') ?? 0);

const ground = {
  groundHeight: (x: number) => Math.max(0, x * slope),
  raycast(ox: number, _oy: number, _oz: number, dx: number, _dy: number, _dz: number, maxT: number): number {
    if (wallX === null || Math.abs(dx) < 1e-6) return maxT + 1;
    const t = (wallX - Math.sign(dx) * 0.1 - ox) / dx;
    return t >= 0 && t < maxT ? t : maxT + 1;
  },
};
if (slope) floor.rotation.z = Math.atan(slope);

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
  // `name:t` overrides t for one body.
  const [name, own] = entry.split(':');
  const t = own ? Number(own) : T;
  // Side view: facing -x (yaw pi/2), so the camera sees their left side. Front: facing the camera.
  const yaw = view === 'side' ? Math.PI / 2 : view === 'back' ? 0 : Math.PI;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const base: PlayerSnap = {
    id: i + 1, team: name === 'commander' || name === 'guard' ? 'guard' : 'operator', x: i * spacing, y: 0, z: 0, yaw, pitch: 0, duck: 0, lean: 0,
    dead: false, weapon, quiet: q.has('quiet'), motion: 'ground', act: 'none', actT: 0, commander: name === 'commander',
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
    case 'slide': base.duck = 1; base.motion = 'slide'; move(8); break;
    case 'jump': base.motion = 'air'; move(3); base.y = 0.6 + (end - s) * -3; break;
    case 'fall': base.motion = 'air'; move(3); base.y = 0.6 + (end - s) * 5; break;
    case 'mantle': base.motion = 'mantle'; base.y = 0.3 + (s - end) * 2; break;
    case 'reload': case 'draw': case 'throw': base.act = name; base.actT = t; break;
    case 'lean': base.lean = 1; break;
    case 'leanl': base.lean = -1; break;
    case 'aimup': base.pitch = 0.6; break;
    case 'dead': base.dead = s > end - t * 2; break;
    case 'pistol': base.weapon = 1; break;
    case 'bolt': base.weapon = 2; break;
  }
  return base;
}

const bodies = new Bodies(scene, ground);
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
  const end = 3;
  const dt = 1 / 60;
  for (let s = 0; s <= end + 1e-6; s += dt) {
    bodies.update(show.map((name, i) => snap(name, i, s, end)), dt, camera);
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
