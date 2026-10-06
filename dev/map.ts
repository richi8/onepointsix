import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { CALABIANCA_2 } from '../src/shared/maps/calabianca2.ts';
import type { GameMap } from '../src/shared/maps/index.ts';
import { KIT_YARD } from '../src/shared/maps/kityard.ts';
import { TEST_STREET } from '../src/shared/maps/teststreet.ts';
import { World } from '../src/shared/world.ts';
import { drawSketch } from './sketchdraw.ts';
import { SKETCH } from './townsketch.ts';

// A dev page drawing a map from straight above, to check its layout against
// a sketch: the ground and everything built on it shaded by height (the
// higher, the lighter), floors walked on edged in blue, the lanes and streets
// as lines, the spawn points numbered with the way they face, and the bounds
// dashed. Open /dev/map.html for Deathmatch's map; `map=old` picks the old
// town, `map=test-street` the test street, `px` sets the pixels to a metre,
// and `sketch` draws the map's plan over it: the old town's sketch (see
// dev/townsketch.ts), its buildings' outlines, ways and spawn zones, or the
// named places a map without buildings is planned as.

const q = new URLSearchParams(location.search);
const MAPS: Record<string, GameMap> = { calabianca: CALABIANCA_2, old: CALABIANCA, 'test-street': TEST_STREET, 'kit-yard': KIT_YARD };
const map = MAPS[q.get('map') ?? 'calabianca'] ?? CALABIANCA_2;
const world = new World(1, map);
const b = world.bounds;
const MARGIN = 8;
const scale = Number(q.get('px') ?? Math.min((innerWidth - 40) / (b.maxX - b.minX + 2 * MARGIN), (innerHeight - 40) / (b.maxZ - b.minZ + 2 * MARGIN)));
const x0 = b.minX - MARGIN;
const z0 = b.minZ - MARGIN;
const W = Math.ceil((b.maxX - b.minX + 2 * MARGIN) * scale);
const H = Math.ceil((b.maxZ - b.minZ + 2 * MARGIN) * scale);

const canvas = document.createElement('canvas');
canvas.width = W;
canvas.height = H;
canvas.style.margin = '20px';
document.body.appendChild(canvas);
const g = canvas.getContext('2d')!;
const px = (x: number) => (x - x0) * scale;
const pz = (z: number) => (z - z0) * scale;

// Heights from the sea to the highest roof, as greys.
let top = 0;
for (const p of world.props) if (world.inBounds((p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2, -2)) top = Math.max(top, p.box.maxY);
const shade = (y: number, light = 0) => {
  const v = Math.round(40 + 190 * Math.min(1, Math.max(0, y / top)) + light);
  return `rgb(${v},${v},${Math.min(255, v + 8)})`;
};

// The ground, a metre at a time; the sea blue.
for (let x = x0; x < x0 + W / scale; x += 1) {
  for (let z = z0; z < z0 + H / scale; z += 1) {
    const h = world.terrainHeight(x + 0.5, z + 0.5);
    g.fillStyle = h < 0 ? '#24435c' : shade(h, -20);
    g.fillRect(px(x), pz(z), scale + 1, scale + 1);
  }
}

// Everything built, lowest first so higher things cover it.
const props = world.props.filter((p) => p.box.maxX > x0 && p.box.minX < x0 + W / scale && p.box.maxZ > z0 && p.box.minZ < z0 + H / scale);
props.sort((p, q2) => p.box.maxY - q2.box.maxY);
for (const { box } of props) {
  g.fillStyle = box.part === 'glass' ? '#7fb6d6' : box.part === 'crate' || box.part === 'container' ? '#b07a3a' : shade(box.maxY, box.part === 'wall' ? -12 : 0);
  g.fillRect(px(box.minX), pz(box.minZ), (box.maxX - box.minX) * scale, (box.maxZ - box.minZ) * scale);
  if (box.walk && box.maxX - box.minX > 1 && box.maxZ - box.minZ > 1) {
    g.strokeStyle = 'rgba(80,150,255,0.35)';
    g.strokeRect(px(box.minX), pz(box.minZ), (box.maxX - box.minX) * scale, (box.maxZ - box.minZ) * scale);
  }
}

// The bounds.
g.setLineDash([6, 4]);
g.strokeStyle = '#ff5050';
g.lineWidth = 1.5;
g.strokeRect(px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
g.setLineDash([]);

// The sketch over the town, where its outlines should match.
if (q.has('sketch') && map === CALABIANCA) {
  const at = SKETCH.at;
  drawSketch(SKETCH, { g, px: (x) => px(x + at.x), pz: (z) => pz(z + at.z), scale, layers: new Set(['buildings', 'routes', 'spawns']), outline: true });
}
if (q.has('sketch') && map.areas) {
  g.lineWidth = 1;
  g.font = '11px system-ui, sans-serif';
  for (const a of map.areas) {
    g.strokeStyle = 'rgba(255,120,200,0.8)';
    g.strokeRect(px(a.minX), pz(a.minZ), (a.maxX - a.minX) * scale, (a.maxZ - a.minZ) * scale);
    g.fillStyle = '#ffd0ee';
    g.fillText(a.name, px(a.minX) + 3, pz(a.minZ) + 12);
  }
}

// The lanes and streets.
g.lineWidth = 3;
g.font = 'bold 12px system-ui, sans-serif';
for (const lane of map.lanes ?? []) {
  g.strokeStyle = 'rgba(255,200,40,0.55)';
  g.beginPath();
  lane.points.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
  g.stroke();
  const [lx, lz] = lane.points[0];
  g.fillStyle = '#ffd860';
  g.fillText(lane.name, px(lx) + 4, pz(lz) - 4);
}

// The spawn points, numbered, each with the way it faces.
g.lineWidth = 2;
world.spawns.forEach((s, i) => {
  const [x, z] = [px(s.x), pz(s.z)];
  // yawToward(): yaw 0 faces -z, turning toward -x.
  const [dx, dz] = [-Math.sin(s.yaw), -Math.cos(s.yaw)];
  g.strokeStyle = '#3cff8c';
  g.beginPath();
  g.moveTo(x, z);
  g.lineTo(x + dx * 3 * scale, z + dz * 3 * scale);
  g.stroke();
  g.fillStyle = '#3cff8c';
  g.beginPath();
  g.arc(x, z, Math.max(4, 0.8 * scale), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#062';
  g.font = 'bold 10px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(String(i), x, z + 3.5);
  g.textAlign = 'left';
});

// A 10 m scale bar and what's shown.
g.fillStyle = '#fff';
g.fillRect(10, H - 14, 10 * scale, 3);
g.font = '12px system-ui, sans-serif';
g.fillText(`10 m · ${map.name}: ${world.buildings.length} buildings, ${world.spawns.length} spawn points, ${(b.maxX - b.minX).toFixed(0)} × ${(b.maxZ - b.minZ).toFixed(0)} m · lighter is higher, up to ${top.toFixed(0)} m`, 10, H - 20);
document.title = 'ready';
