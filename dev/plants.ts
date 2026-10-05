import * as THREE from 'three';
import { KINDS, species, type Kind } from '../src/client/species.ts';
import { needles, thickened } from '../src/client/trees.ts';

// The generated trees and shrubs (see src/client/species.ts) side by side on
// a flat ground, in sun and sky light: each kind near and, behind it, far.
// `?kind=olive` shows one kind alone, close; `?far` puts the far shapes in
// front; `?eye=x,y,z&at=x,y,z` moves the camera; `?pictures` shows the leaf
// pictures flat. Sets document.title to
// "ready" once drawn.

const q = new URLSearchParams(location.search);
const only = q.get('kind') as Kind | null;
const kinds = only ? [only] : KINDS;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ab4d0);
scene.add(new THREE.HemisphereLight(0xcfdcea, 0x6a5a40, 1.3));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
sun.position.set(-30, 40, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 150 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa08c60, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

let x = 0;
const spacing: Record<Kind, number> = { olive: 9, plane: 16, cypress: 5, pine: 15, oak: 10, shrub: 5 };
for (const kind of kinds) {
  const sp = species(kind, 7);
  x += spacing[kind] / 2;
  for (const [shape, z] of q.has('far') ? [[sp.far, 0], [sp.near, -20]] as const : [[sp.near, 0], [sp.far, -20]] as const) {
    const wood = new THREE.Mesh(shape.wood, new THREE.MeshStandardMaterial({ color: sp.woodColor.clone().lerp(sp.bark, 0.3), roughness: 1 }));
    const foliage = new THREE.Mesh(shape.foliage, needles(thickened(new THREE.MeshStandardMaterial({
      map: sp.map, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9,
    }))));
    for (const m of [wood, foliage]) {
      m.position.set(x, 0, z);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }
  x += spacing[kind] / 2;
}

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
const num = (s: string | null) => (s ? s.split(',').map(Number) : null);
const eye = num(q.get('eye')) ?? (only ? [x / 2 + 6, 4, 14] : [x / 2, 9, 34]);
const at = num(q.get('at')) ?? (only ? [x / 2, 3.5, 0] : [x / 2, 5, 0]);
camera.position.set(eye[0], eye[1], eye[2]);
camera.lookAt(at[0], at[1], at[2]);
if (q.has('pictures')) pictures();
else {
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
    document.title = 'ready';
  });
}

// `?pictures`: each kind's leaf picture, flat, over a pale ground.
function pictures(): void {
  scene.clear();
  scene.background = new THREE.Color(0xd8d4c8);
  KINDS.filter((k) => k !== 'shrub').forEach((kind, i) => {
    const map = species(kind, 7).map;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial({ map, alphaTest: 0.4, side: THREE.DoubleSide }));
    card.position.set((i % 2) * 2.1 - 1.05, 1.6 - Math.floor(i / 2) * 1.05, 0);
    scene.add(card);
  });
  const ortho = new THREE.OrthographicCamera(-2.2, 2.2, 2.2, -1.2, 0.1, 10);
  ortho.position.z = 5;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(scene, ortho);
  document.title = 'ready';
}
