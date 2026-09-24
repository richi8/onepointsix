import * as THREE from 'three';
import { CMD_DT, PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/constants.ts';
import { FixedLoop } from '../shared/loop.ts';
import { Connection } from './connection.ts';
import { Input } from './input.ts';
import { NetPanel } from './netpanel.ts';
import './style.css';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8cc);
scene.add(new THREE.HemisphereLight(0xdde8f0, 0x4a4a3a, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(30, 50, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x6b7a4f }),
);
scene.add(ground);
const grid = new THREE.GridHelper(200, 100, 0x3d4a2c, 0x56663f);
grid.position.y = 0.01;
scene.add(grid);

// Landmarks so movement is visible under the follow camera.
const pillarGeo = new THREE.BoxGeometry(0.5, 3, 0.5).translate(0, 1.5, 0);
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8a8a80 });
for (let x = -60; x <= 60; x += 20) {
  for (let z = -60; z <= 60; z += 20) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(x, 0, z);
    scene.add(pillar);
  }
}

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const boxGeo = new THREE.BoxGeometry(PLAYER_RADIUS * 2, PLAYER_HEIGHT, PLAYER_RADIUS * 2).translate(0, PLAYER_HEIGHT / 2, 0);
const boxes = new Map<number, THREE.Mesh>();

function boxFor(id: number, mine: boolean): THREE.Mesh {
  let box = boxes.get(id);
  if (!box) {
    box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: mine ? 0xd9822b : 0x5c7cfa }));
    boxes.set(id, box);
    scene.add(box);
  }
  return box;
}

const conn = new Connection();
const input = new Input(window);
const panel = new NetPanel(conn);

// Sample input at the fixed command rate, independent of frame rate.
const inputLoop = new FixedLoop(CMD_DT, () => conn.sendCmd(input.buttons, 0, 0), 8);

let last = performance.now() / 1000;
renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  conn.update(now - last);
  last = now;
  inputLoop.advance(now);

  const seen = new Set<number>();
  const players = conn.interpolated();
  for (const p of players) {
    seen.add(p.id);
    const box = boxFor(p.id, p.id === conn.id);
    box.position.set(p.x, p.y, p.z);
    box.rotation.y = p.yaw;
    if (p.id === conn.id) {
      camera.position.set(p.x, p.y + 8, p.z + 12);
      camera.lookAt(p.x, p.y + 1, p.z);
    }
  }
  for (const [id, box] of boxes) {
    if (seen.has(id)) continue;
    scene.remove(box);
    boxes.delete(id);
  }

  panel.update(players.find((p) => p.id === conn.id));
  renderer.render(scene, camera);
});
