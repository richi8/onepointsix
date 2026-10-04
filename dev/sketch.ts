import { drawSketch, groundShade, ROUTE_COLOURS, type Layer } from './sketchdraw.ts';
import { DISTRICT_COLOURS, SKETCH, sketchProblems, type District, type RouteKind } from './townsketch.ts';

// A dev page drawing the sketch of the rebuilt Calabianca from above (see
// dev/townsketch.ts), with a legend whose boxes turn its layers on and off.
// Open /dev/sketch.html; `px` sets the pixels to a metre.

const q = new URLSearchParams(location.search);
const s = SKETCH;
const MARGIN = 6;
const spanX = s.bounds.x1 - s.bounds.x0 + 2 * MARGIN;
const spanZ = s.bounds.z1 - s.bounds.z0 + 2 * MARGIN + 6;
const scale = Number(q.get('px') ?? Math.max(4, Math.min((innerWidth - 340) / spanX, (innerHeight - 32) / spanZ)));
const x0 = s.bounds.x0 - MARGIN;
const z0 = s.bounds.z0 - MARGIN;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ratio = devicePixelRatio || 1;
canvas.width = Math.ceil(spanX * scale * ratio);
canvas.height = Math.ceil(spanZ * scale * ratio);
canvas.style.width = `${Math.ceil(spanX * scale)}px`;
canvas.style.height = `${Math.ceil(spanZ * scale)}px`;
const g = canvas.getContext('2d')!;
const px = (x: number) => (x - x0) * scale;
const pz = (z: number) => (z - z0) * scale;

const ALL: Layer[] = ['ground', 'buildings', 'props', 'routes', 'views', 'spawns', 'labels'];
const layers = new Set<Layer>(ALL);

function draw(): void {
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  // The hillside round the town and the sea in front.
  g.fillStyle = '#3d4636';
  g.fillRect(0, 0, spanX * scale, spanZ * scale);
  g.fillStyle = '#24435c';
  g.fillRect(0, pz(s.bounds.z1), spanX * scale, spanZ * scale);
  drawSketch(s, { g, px, pz, scale, layers });
  g.setLineDash([6, 4]);
  g.strokeStyle = '#ff5050';
  g.lineWidth = 1.5;
  g.strokeRect(px(s.bounds.x0), pz(s.bounds.z0), (s.bounds.x1 - s.bounds.x0) * scale, (s.bounds.z1 - s.bounds.z0) * scale);
  g.setLineDash([]);
  g.fillStyle = '#fff';
  g.fillRect(10, spanZ * scale - 12, 10 * scale, 3);
  g.font = '11px system-ui, sans-serif';
  g.fillText('10 m · north is up the hill, the sea south', 14 + 10 * scale, spanZ * scale - 8);
}

const legend = document.getElementById('legend')!;
const problems = sketchProblems();
const DISTRICT_NAMES: Record<District, string> = {
  west: 'west alleys',
  quay: 'quay',
  market: 'market',
  piazza: 'piazza and church',
  east: 'road, garden, palazzo',
  top: 'high street, cemetery, villa',
};
const ROUTE_NAMES: Record<RouteKind, string> = {
  open: 'open way',
  tight: 'tight way',
  through: 'through a building',
  roof: 'over roofs',
};
legend.innerHTML = `
  <h2>Calabianca, rebuilt: sketch</h2>
  <div>${s.buildings.length} buildings, ${s.spawns.length * 4} spawn points in ${s.spawns.length} zones, ${s.bounds.x1 - s.bounds.x0} × ${(s.bounds.z1 - s.bounds.z0).toFixed(0)} m</div>
  <div id="problems">${problems.map((p) => `⚠ ${p}`).join('<br>')}</div>
  <h3>Show</h3>
  ${ALL.map((l) => `<label><input type="checkbox" data-layer="${l}" checked> ${l}</label>`).join('')}
  <h3>Districts</h3>
  ${(Object.keys(DISTRICT_COLOURS) as District[]).map((d) => `<div><span class="sw" style="background:${DISTRICT_COLOURS[d]}"></span>${DISTRICT_NAMES[d]}</div>`).join('')}
  <h3>Buildings</h3>
  <div><span class="sw" style="background:#ccc;border:3px solid #2b2b2b;height:6px;width:10px"></span>flat roof, walked (parapet)</div>
  <div><span class="sw" style="background:repeating-linear-gradient(90deg,#ccc 0 3px,#9a5a40 3px 4px)"></span>pitched roof, out of reach</div>
  <div>big number: storeys · ↑ the roof's height</div>
  <div>dashed: archway or room over a lane · dots: arcade pillars</div>
  <h3>Ways (between the hubs)</h3>
  ${(Object.keys(ROUTE_COLOURS) as RouteKind[]).map((k) => `<div><span class="ln" style="border-color:${ROUTE_COLOURS[k]}${k === 'roof' ? ';border-top-style:dashed' : ''}"></span>${ROUTE_NAMES[k]}</div>`).join('')}
  <div><span class="ln" style="border-color:#fff;border-top-style:dotted;border-top-width:2px"></span>a long view meant to be there</div>
  <h3>Ground</h3>
  ${[3, 6, 9, 12, 15].map((y) => `<div><span class="sw" style="background:${groundShade(y)}"></span>${y} m</div>`).join('')}
  <div>white steps and arrow: stairs, up the arrow</div>
`;
legend.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const layer = box.dataset.layer as Layer;
  if (box.checked) layers.add(layer);
  else layers.delete(layer);
  draw();
});

draw();
document.title = problems.length ? `problems: ${problems.length}` : 'ready';
