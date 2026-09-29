import * as THREE from 'three';
import { loadAssets } from '../src/client/assets.ts';
import { fitGun, pieces } from '../src/client/guns.ts';
import { actionMatrix, magazineMatrix } from '../src/client/handwork.ts';

// A dev page for looking at the gun models side on, fitted as the game fits
// them: each connected piece in its own colour, numbered in the console with
// its bounds, and the marked points as red dots. Open /dev/guns.html; `gun`
// picks one (in WEAPONS order), `flat` draws them in their own colours, and
// `side` is right, left or top. `parts` draws the gun as the game splits it
// instead (frame grey, magazine orange, slide or bolt handle blue), posed
// by `mag` (metres out), `back` (metres) and `lift` (0 to 1).

const q = new URLSearchParams(location.search);
const which = Number(q.get('gun') ?? 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa3b3);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
const assets = await loadAssets(renderer);
const gun = fitGun(assets.guns[which], which);
gun.object.updateMatrixWorld(true);
const found: string[] = [];
let n = 0;
if (q.has('parts')) {
  const paint = (part: THREE.Object3D | null, color: number): void =>
    part?.traverse((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material = new THREE.MeshLambertMaterial({ color })));
  paint(gun.frame, 0x999999);
  paint(gun.magazinePart, 0xe08030);
  paint(gun.actionPart, 0x3070e0);
  const parts = { mag: Number(q.get('mag') ?? 0), back: Number(q.get('back') ?? 0), lift: Number(q.get('lift') ?? 0) };
  for (const [part, m] of [[gun.magazinePart, magazineMatrix(gun, parts.mag, new THREE.Matrix4())], [gun.actionPart, actionMatrix(gun, parts, new THREE.Matrix4())]] as const) {
    if (!part) continue;
    part.matrixAutoUpdate = false;
    part.matrix.copy(m);
  }
  scene.add(gun.object);
}
gun.object.traverse((o) => {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || q.has('parts')) return;
  const geometry = mesh.geometry.clone();
  const packed = geometry.getAttribute('position');
  const position = new THREE.Float32BufferAttribute(packed.count * 3, 3);
  for (let i = 0; i < packed.count; i++) position.setXYZ(i, packed.getX(i), packed.getY(i), packed.getZ(i));
  geometry.setAttribute('position', position);
  geometry.applyMatrix4(mesh.matrixWorld);
  const index = geometry.getIndex()!;
  for (const tris of pieces(geometry)) {
    const box = new THREE.Box3();
    const kept: number[] = [];
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = index.getX(t + k);
      kept.push(v);
      box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, v));
    }
    const g = geometry.clone();
    g.setIndex(kept);
    const color = q.has('flat') ? (mesh.material as THREE.MeshStandardMaterial).color : new THREE.Color().setHSL((n * 0.618) % 1, 0.7, 0.5);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color })));
    const f = (v: THREE.Vector3): string => [v.x, v.y, v.z].map((x) => x.toFixed(3)).join(',');
    found.push(`${n} #${color.getHexString()} ${(mesh.material as THREE.Material).name} tris ${tris.length / 3} min ${f(box.min)} max ${f(box.max)}`);
    n++;
  }
});
console.log(found.join('\n'));
for (const [name, p] of Object.entries(gun)) {
  if (!(p instanceof THREE.Vector3) || name === 'well') continue;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004), new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }));
  dot.position.copy(p);
  dot.renderOrder = 1;
  scene.add(dot);
  console.log(name, p.toArray().map((x) => x.toFixed(3)).join(','));
}
// Side on, from the gun's right, framed on its length.
const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
const mid = box.getCenter(new THREE.Vector3());
const half = Math.max(size.z / 2, (size.y / 2) * innerWidth / innerHeight) * 1.1;
const camera = new THREE.OrthographicCamera(-half, half, half * innerHeight / innerWidth, -half * innerHeight / innerWidth, 0.01, 10);
const side = q.get('side') ?? 'right';
camera.position.copy(mid).add(side === 'top' ? new THREE.Vector3(0, 2, 0) : new THREE.Vector3(side === 'left' ? -2 : 2, 0, 0));
if (side === 'top') camera.up.set(1, 0, 0);
camera.lookAt(mid);
renderer.render(scene, camera);
document.title = 'ready';
