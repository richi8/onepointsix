import * as THREE from 'three';
import { CMD_DT, PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/constants.ts';
import { FixedLoop } from '../shared/loop.ts';
import type { PlayerSnap } from '../shared/protocol.ts';
import { World } from '../shared/world.ts';
import { DEFAULT_WORLD, parseWorldParam } from '../shared/worldconfig.ts';
import { Connection } from './connection.ts';
import { Input } from './input.ts';
import { NetPanel } from './netpanel.ts';
import { WorldView } from './worldview.ts';
import './style.css';

const MENU_ORBIT_RADIUS = 360;
const MENU_ORBIT_SPEED = 0.025;

const config = parseWorldParam(new URLSearchParams(location.search).get('world'));
const world = new World(config.seed);
const view = new WorldView(world);
const scene = view.scene;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ menu

const menu = document.getElementById('menu')!;
const hint = document.getElementById('hint')!;
const playButton = document.getElementById('play') as HTMLButtonElement;
document.getElementById('world-label')!.textContent =
  config.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${config.seed}`;

let conn: Connection | null = null;
let panel: NetPanel | null = null;
const input = new Input(window);

// Sample input at the fixed command rate, independent of frame rate.
const inputLoop = new FixedLoop(CMD_DT, () => conn?.sendCmd(input.buttons, 0, 0), 8);

function play(): void {
  if (conn) return;
  menu.hidden = true;
  hint.hidden = false;
  conn = new Connection(config);
  panel = new NetPanel(conn);
}

playButton.onclick = play;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !conn) play();
});
playButton.focus();

// ---------------------------------------------------------------- players

const boxGeo = new THREE.BoxGeometry(PLAYER_RADIUS * 2, PLAYER_HEIGHT, PLAYER_RADIUS * 2).translate(0, PLAYER_HEIGHT / 2, 0);
const boxes = new Map<number, THREE.Mesh>();

function boxFor(id: number, mine: boolean): THREE.Mesh {
  let box = boxes.get(id);
  if (!box) {
    box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: mine ? 0xd9822b : 0x5c7cfa }));
    box.castShadow = true;
    boxes.set(id, box);
    scene.add(box);
  }
  return box;
}

// ------------------------------------------------------------------ frame

const focus = new THREE.Vector3();
const start = performance.now() / 1000;
let last = start;

function orbitCamera(now: number): void {
  const a = (now - start) * MENU_ORBIT_SPEED + 0.6;
  camera.position.set(Math.sin(a) * MENU_ORBIT_RADIUS, world.maxHeight + 90, Math.cos(a) * MENU_ORBIT_RADIUS);
  camera.lookAt(0, 0, 0);
  focus.set(0, 0, 0);
  view.update(camera, focus, world.half);
}

function followCamera(x: number, y: number, z: number): void {
  const cx = x;
  const cz = z + 10;
  const cy = Math.max(y + 6, world.floorHeight(cx, cz) + 2);
  camera.position.set(cx, cy, cz);
  camera.lookAt(x, y + 1.2, z);
  focus.set(x, y, z);
  view.update(camera, focus, 70);
}

renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  const dt = now - last;
  last = now;

  const players = conn ? (conn.update(dt), inputLoop.advance(now), conn.interpolated()) : [];
  const seen = new Set<number>();
  let me: PlayerSnap | undefined;
  for (const p of players) {
    seen.add(p.id);
    const box = boxFor(p.id, p.id === conn!.id);
    box.position.set(p.x, p.y, p.z);
    box.rotation.y = p.yaw;
    if (p.id === conn!.id) me = p;
  }
  for (const [id, box] of boxes) {
    if (seen.has(id)) continue;
    scene.remove(box);
    boxes.delete(id);
  }

  if (me) followCamera(me.x, me.y, me.z);
  else orbitCamera(now);

  panel?.update(me);
  renderer.render(scene, camera);
});
