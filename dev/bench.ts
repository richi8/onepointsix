import * as THREE from 'three';
import { loadAssets } from '../src/client/assets.ts';
import { Bodies } from '../src/client/bodies.ts';
import { GroundCover } from '../src/client/groundcover.ts';
import { Resolution } from '../src/client/resolution.ts';
import { WorldView } from '../src/client/worldview.ts';
import { DEFAULT_CONDITIONS, type Conditions } from '../src/shared/conditions.ts';
import { Flashlights } from '../src/client/flashlights.ts';
import type { PlayerSnap } from '../src/shared/protocol.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

// A frame-cost benchmark on the default island, run by `npm run bench`
// (e2e/bench.e2e.ts) or by hand at /dev/bench.html on the dev server:
//
// - A frame with nobody about, then with `n` soldiers (24 by default) close
//   up, each walking, running, reloading, leaning or throwing, so every one
//   is posed with its arm IK and fingers. Each frame is timed from posing the
//   bodies to the GPU having drawn it (a one-pixel read waits for it).
// - The same soldiers 100 to 400 m away, where they're posed less often and
//   without the fine work, those within 230 m casting shadows.
// - The ground cover's rebuild as the eye crosses its cells: first visits,
//   which scatter the cells, and a second pass over cells already scattered.
// - The close-up soldiers again on a rainy night, every one's flashlight on
//   and yours too: the lights that reach the world, your light's shadow, the
//   beams, the rain and the wet ground.
//
// It sets window.bench to the results and document.title to "done".
//
// With `?adaptive=<seconds>` it instead checks the adaptive resolution on a
// slow GPU: an extra pass over every pixel, weighed so that the full
// resolution runs at about 38 fps, slows the frames, and the game's own
// Resolution runs for that long. It sets window.adaptive.

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
await view.prepare(renderer);

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
const flashlights = new Flashlights(scene);
/** Whether everyone's flashlight is on, in the phase being measured. */
let lit = false;
const assets = await loadAssets(renderer);
view.applyAssets(assets);
bodies.setModel(assets.soldier, assets.guns);
bodies.sun.copy(view.lit.sunDir);

const STATES = ['walk', 'run', 'crouchwalk', 'reload', 'lean', 'aimup', 'throw', 'stand'] as const;

/** Soldier i at `t` seconds: in a fan 4 to 25 m in front (or 100 to 400 m), the movers circling their spot. */
function snap(i: number, t: number, far = false): PlayerSnap {
  const state = STATES[i % STATES.length];
  const d = far ? 100 + (300 * i) / Math.max(N - 1, 1) : 4 + (21 * i) / Math.max(N - 1, 1);
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
    act: state === 'reload' || state === 'throw' ? state : 'none', actT: cycle, commander: false, light: lit,
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

async function measure(n: number, far = false): Promise<Phase> {
  const out: Phase = { bodies: [], frame: [], calls: 0, triangles: 0 };
  let t = 0;
  const dt = 1 / 60;
  for (let f = 0; f < WARMUP + FRAMES; f++) {
    await frame();
    t += dt;
    const players = Array.from({ length: n }, (_, i) => snap(i, t, far));
    const t0 = performance.now();
    bodies.update(players, dt, camera);
    const t1 = performance.now();
    flashlights.update(camera, lit, players, (id, at, dir) => bodies.torch(id, at, dir));
    view.update(camera, focus, 32, 230, t);
    view.reflect(renderer, camera);
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

/** A pass over every pixel that costs about `iterations` steps of work each. */
function load(): { scene: THREE.Scene; camera: THREE.Camera; iterations: { value: number }; material: THREE.ShaderMaterial } {
  const iterations = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { iterations },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform int iterations;
      void main() {
        float a = gl_FragCoord.x * 0.001 + gl_FragCoord.y * 0.0007;
        for (int i = 0; i < 20000; i++) {
          if (i >= iterations) break;
          a = fract(sin(a * 1.37 + float(i)) * 43758.5);
        }
        // Too faint to see, but added as it is, so the work can't be skipped.
        gl_FragColor = vec4(a * 1e-6);
      }`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const loadScene = new THREE.Scene();
  const mesh = new THREE.Mesh(tri, material);
  mesh.frustumCulled = false;
  loadScene.add(mesh);
  return { scene: loadScene, camera: new THREE.Camera(), iterations, material };
}

/** One frame of the island, and the load pass, until the GPU is done. */
function draw(t: number, extra: ReturnType<typeof load>): void {
  view.update(camera, focus, 32, 230, t);
  view.reflect(renderer, camera);
  renderer.clear();
  renderer.render(scene, camera);
  // three.js uploads a changed uniform only when told to.
  extra.material.uniformsNeedUpdate = true;
  renderer.render(extra.scene, extra.camera);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

/**
 * Weigh the load pass so a frame at full resolution takes about `target` ms,
 * then let the game's Resolution run for `seconds` and see where it settles.
 */
async function adaptive(seconds: number, target = 26) {
  const extra = load();
  const timed = async (n: number) => {
    const times: number[] = [];
    for (let f = 0; f < n; f++) {
      await frame();
      const t0 = performance.now();
      draw(f / 60, extra);
      times.push(performance.now() - t0);
    }
    return times.sort((a, b) => a - b)[n >> 1];
  };
  await timed(30);
  // Double, then halve the step, until a frame costs about the target.
  let lo = 0;
  let hi = 64;
  extra.iterations.value = hi;
  while ((await timed(20)) < target && hi < 20000) {
    lo = hi;
    hi *= 2;
    extra.iterations.value = hi;
  }
  for (let k = 0; k < 8; k++) {
    extra.iterations.value = Math.round((lo + hi) / 2);
    if ((await timed(20)) < target) lo = extra.iterations.value;
    else hi = extra.iterations.value;
  }
  const full = await timed(40);

  const resolution = new Resolution(renderer);
  const log: { t: number; share: number }[] = [];
  const frames: { t: number; ms: number }[] = [];
  const start = performance.now();
  let last = start;
  let share = resolution.share;
  while (performance.now() - start < seconds * 1000) {
    await frame();
    const now = performance.now();
    resolution.update((now - last) / 1000);
    last = now;
    draw((now - start) / 1000, extra);
    frames.push({ t: (now - start) / 1000, ms: performance.now() - now });
    if (resolution.share !== share) log.push({ t: Math.round((now - start) / 100) / 10, share: (share = resolution.share) });
  }
  const tail = frames.filter((f) => f.t > seconds - 10).map((f) => f.ms).sort((a, b) => a - b);
  renderer.setPixelRatio(1);
  return {
    iterations: extra.iterations.value,
    full: Math.round(full * 10) / 10,
    changes: resolution.changes,
    log,
    share: Math.round(resolution.share * 100) / 100,
    /** The median frame over the last 10 s, ms. */
    settled: Math.round(tail[tail.length >> 1] * 10) / 10,
  };
}

await renderer.compileAsync(scene, camera);
if (q.has('adaptive')) Object.assign(window, { adaptive: await adaptive(Number(q.get('adaptive')) || 25) });
else Object.assign(window, { bench: await frameCost() });
document.title = 'done';

/** The frame-cost phases described at the top. */
async function frameCost() {
  const empty = await measure(0);
  const crowd = await measure(N);
  const distant = await measure(N, true);
  const cover = groundCover(-200, 40, 40);
  const night = await atNight({ time: 'night', weather: 'rain' });

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
    distant: { bodies: stats(distant.bodies), frame: stats(distant.frame), calls: distant.calls },
    groundCover: { first: stats(cover.first), again: stats(cover.again) },
    night: { frame: stats(night.frame), calls: night.calls, triangles: night.triangles },
  };
  return bench;
}

/** The close-up crowd in `conditions`, everyone's light on. */
async function atNight(conditions: Conditions): Promise<Phase> {
  view.setConditions(conditions);
  const l = view.lit;
  flashlights.setConditions(true, l.fogNear, l.fogFar);
  renderer.toneMappingExposure = l.exposure;
  lit = true;
  await renderer.compileAsync(scene, camera);
  return measure(N);
}
