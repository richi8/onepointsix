import * as THREE from 'three';
import { loadAssets } from '../src/client/assets.ts';
import { Bodies } from '../src/client/bodies.ts';
import { GroundCover } from '../src/client/groundcover.ts';
import { WorldView } from '../src/client/worldview.ts';
import { DEFAULT_CONDITIONS } from '../src/shared/conditions.ts';
import type { PlayerSnap } from '../src/shared/protocol.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// A frame-cost benchmark on the default island, run by the browser tests
// (e2e/bench.e2e.ts) or by hand at /dev/bench.html on the dev server:
//
// - A frame with nobody about, then with `n` soldiers (24 by default) close
//   up, each walking, running, reloading, leaning or throwing, so every one
//   is posed with its arm IK and fingers. Each frame is timed from posing the
//   bodies to the GPU having drawn it (a one-pixel read waits for it).
// - The ground cover's rebuild as the eye crosses its cells: first visits,
//   which scatter the cells, and a second pass over cells already scattered.
//
// It sets window.bench to the results and document.title to "done".

const q = new URLSearchParams(location.search);
const N = Number(q.get('n') ?? 24);
const WARMUP = 60;
const FRAMES = Number(q.get('frames') ?? 240);

const world = new World(DEFAULT_WORLD.seed);
const view = new WorldView(world, DEFAULT_CONDITIONS);
view.preview = false;
const scene = view.scene;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = view.lit.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;
document.body.append(renderer.domElement);
view.prepare(renderer);

// On the ground by the quarry, looking into it.
const post = world.outposts[2];
const eyeX = post.x + 24;
const eyeZ = post.z + 18;
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 2000);
camera.position.set(eyeX, world.floorHeight(eyeX, eyeZ) + 1.6, eyeZ);
camera.lookAt(post.x, post.y + 1, post.z);
camera.updateMatrixWorld();
const focus = new THREE.Vector3(eyeX, camera.position.y - 1.6, eyeZ);
const forward = new THREE.Vector3();
camera.getWorldDirection(forward);

const bodies = new Bodies(scene, world);
const assets = await loadAssets(renderer);
view.applyAssets(assets);
bodies.setModel(assets.soldier, assets.guns);

const STATES = ['walk', 'run', 'crouchwalk', 'reload', 'lean', 'aimup', 'throw', 'stand'] as const;

/** Soldier i at `t` seconds: in a fan 4 to 25 m in front, the movers circling their spot. */
function snap(i: number, t: number): PlayerSnap {
  const state = STATES[i % STATES.length];
  const d = 4 + (21 * i) / Math.max(N - 1, 1);
  const side = ((i % 5) - 2) * 0.35 * d * 0.4;
  let x = eyeX + forward.x * d - forward.z * side;
  let z = eyeZ + forward.z * d + forward.x * side;
  const speed = state === 'walk' ? 1.5 : state === 'run' ? 5.5 : state === 'crouchwalk' ? 2.2 : 0;
  let yaw = Math.atan2(forward.x, forward.z) + (i * 0.7);
  if (speed) {
    const a = (t * speed) / 2 + i;
    x += Math.sin(a) * 2;
    z += Math.cos(a) * 2;
    yaw = a + Math.PI / 2 + Math.PI;
  }
  const cycle = (t * 0.5 + i * 0.13) % 1;
  return {
    id: i + 1, team: i % 3 === 0 ? 'guard' : 'operator', x, y: world.floorHeight(x, z), z, yaw,
    pitch: state === 'aimup' ? 0.5 : 0, duck: state === 'crouchwalk' ? 1 : 0, lean: state === 'lean' ? (i % 2 ? 1 : -1) : 0,
    dead: false, weapon: i % 3, quiet: i % 4 === 0, motion: 'ground',
    act: state === 'reload' || state === 'throw' ? state : 'none', actT: cycle, commander: false, light: false,
  };
}

const gl = renderer.getContext();
const pixel = new Uint8Array(4);
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

interface Phase {
  /** Posing the bodies, ms per frame. */
  bodies: number[];
  /** Posing, the world's update and drawing until the GPU is done, ms per frame. */
  frame: number[];
  calls: number;
  triangles: number;
}

async function measure(n: number): Promise<Phase> {
  const out: Phase = { bodies: [], frame: [], calls: 0, triangles: 0 };
  let t = 0;
  const dt = 1 / 60;
  for (let f = 0; f < WARMUP + FRAMES; f++) {
    await frame();
    t += dt;
    const players = Array.from({ length: n }, (_, i) => snap(i, t));
    const t0 = performance.now();
    bodies.update(players, dt, camera);
    const t1 = performance.now();
    view.update(camera, focus, 32, 230, t);
    renderer.clear();
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const t2 = performance.now();
    if (f < WARMUP) continue;
    out.bodies.push(t1 - t0);
    out.frame.push(t2 - t0);
    out.calls = renderer.info.render.calls;
    out.triangles = renderer.info.render.triangles;
  }
  return out;
}

/** The ground cover crossing `steps` cells eastward from (x, z), twice over. */
function groundCover(x: number, z: number, steps: number): { first: number[]; again: number[] } {
  const cover = new GroundCover(world);
  const eye = new THREE.Vector3();
  const pass = (): number[] => {
    const times: number[] = [];
    for (let i = 0; i < steps; i++) {
      eye.set(x + i * 8, 0, z);
      eye.y = world.floorHeight(eye.x, eye.z) + 1.6;
      const t0 = performance.now();
      cover.update(eye);
      times.push(performance.now() - t0);
    }
    return times;
  };
  const first = pass();
  return { first, again: pass() };
}

await renderer.compileAsync(scene, camera);
const empty = await measure(0);
const crowd = await measure(N);
const cover = groundCover(-200, 40, 40);

const stats = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(Math.floor(p * s.length), s.length - 1)];
  const r = (x: number) => Math.round(x * 100) / 100;
  return { median: r(at(0.5)), p95: r(at(0.95)), max: r(s[s.length - 1]) };
};

const bench = {
  gpu: (() => {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  })(),
  size: `${innerWidth}x${innerHeight}`,
  bodies: N,
  empty: { frame: stats(empty.frame), calls: empty.calls, triangles: empty.triangles },
  crowd: { bodies: stats(crowd.bodies), frame: stats(crowd.frame), calls: crowd.calls, triangles: crowd.triangles },
  groundCover: { first: stats(cover.first), again: stats(cover.again) },
};
Object.assign(window, { bench });
document.title = 'done';
