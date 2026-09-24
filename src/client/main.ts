import * as THREE from 'three';
import { CMD_DT, CROUCH_HEIGHT, LEAN_ROLL, PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/constants.ts';
import { lerp } from '../shared/geom.ts';
import { FixedLoop } from '../shared/loop.ts';
import { eyePosition } from '../shared/sim.ts';
import { World } from '../shared/world.ts';
import { DEFAULT_WORLD, parseWorldParam } from '../shared/worldconfig.ts';
import { Connection } from './connection.ts';
import { Input } from './input.ts';
import { NetPanel } from './netpanel.ts';
import { WorldView } from './worldview.ts';
import './style.css';

const MENU_ORBIT_RADIUS = 360;
const MENU_ORBIT_SPEED = 0.025;
const MENU_FOV = 60;
const PLAY_FOV = 75;

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

const camera = new THREE.PerspectiveCamera(MENU_FOV, 1, 0.05, 2000);
camera.rotation.order = 'YXZ';

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
const crosshair = document.getElementById('crosshair')!;
const paused = document.getElementById('paused')!;
const stamina = document.getElementById('stamina')!;
const staminaFill = stamina.firstElementChild as HTMLElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
document.getElementById('world-label')!.textContent =
  config.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${config.seed}`;

let conn: Connection | null = null;
let panel: NetPanel | null = null;
const input = new Input(window, renderer.domElement);

// Sample input at the fixed command rate, independent of frame rate.
const inputLoop = new FixedLoop(CMD_DT, () => conn?.sendCmd(input.buttons, input.yaw, input.pitch), 8);

function play(): void {
  if (conn) return;
  menu.hidden = true;
  hint.hidden = false;
  crosshair.hidden = false;
  camera.fov = PLAY_FOV;
  camera.updateProjectionMatrix();
  conn = new Connection(config, world);
  panel = new NetPanel(conn);
  // Shown until the lock succeeds, so a refused lock still leaves a way in.
  paused.hidden = false;
  input.lock();
}

input.onLockChange = (locked) => {
  if (conn) paused.hidden = locked;
};
paused.onclick = () => input.lock();

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

function eyeCamera(x: number, y: number, z: number, duck: number, lean: number): void {
  // Look uses the live mouse, not the last command, so aiming has no latency.
  const eye = eyePosition(world, x, y, z, input.yaw, duck, lean);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.set(input.pitch, input.yaw, eye.roll);
  focus.set(x, y, z);
  view.update(camera, focus, 70);
}

renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  const dt = now - last;
  last = now;

  const players = conn ? (conn.update(dt), inputLoop.advance(now), conn.interpolated()) : [];
  const seen = new Set<number>();
  for (const p of players) {
    seen.add(p.id);
    const box = boxFor(p.id, false);
    box.position.set(p.x, p.y, p.z);
    box.rotation.set(0, p.yaw, -p.lean * LEAN_ROLL, 'YXZ');
    box.scale.y = lerp(1, CROUCH_HEIGHT / PLAYER_HEIGHT, p.duck);
  }
  for (const [id, box] of boxes) {
    if (seen.has(id)) continue;
    scene.remove(box);
    boxes.delete(id);
  }

  const me = conn?.predictor.render(inputLoop.alpha);
  if (me) eyeCamera(me.x, me.y, me.z, me.duck, me.lean);
  else orbitCamera(now);

  const state = conn?.predictor.state;
  stamina.hidden = !state || (state.stamina >= 1 && !state.winded);
  if (state) {
    staminaFill.style.width = `${state.stamina * 100}%`;
    stamina.classList.toggle('winded', state.winded);
  }

  panel?.update();
  renderer.render(scene, camera);
});
