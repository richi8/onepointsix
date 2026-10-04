import { DISTRICT_COLOURS, type RouteKind, type Sketch, type SketchRect } from './townsketch.ts';

// Draws the sketch (dev/townsketch.ts) on a 2D canvas: for dev/sketch.html in
// full, and over the built map in dev/map.html?sketch as outlines.

export const ROUTE_COLOURS: Record<RouteKind, string> = {
  open: '#ffb020',
  tight: '#ff4fa0',
  through: '#3fc4ff',
  roof: '#b98cff',
};

export type Layer = 'ground' | 'buildings' | 'props' | 'routes' | 'views' | 'spawns' | 'labels';

export interface SketchCanvas {
  g: CanvasRenderingContext2D;
  /** Canvas pixels for a sketch x or z. */
  px: (x: number) => number;
  pz: (z: number) => number;
  scale: number;
  layers: Set<Layer>;
  /** Only outlines, to lie over the built map. */
  outline?: boolean;
}

/** The ground's shade for a height: the sea's 0 dark, the top's 15 light. */
export function groundShade(y: number): string {
  // From a deep blue-green at the quay through olive and khaki to pale sand at the top.
  const stops: [number, number, number, number][] = [[3, 52, 92, 88], [6, 86, 112, 70], [9, 128, 132, 78], [12, 168, 152, 100], [15, 206, 192, 150]];
  if (y <= stops[0][0]) return `rgb(${stops[0].slice(1).join(',')})`;
  for (let i = 1; i < stops.length; i++) {
    const [y1, ...c1] = stops[i];
    const [y0, ...c0] = stops[i - 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')})`;
    }
  }
  return `rgb(${stops[stops.length - 1].slice(1).join(',')})`;
}

export function drawSketch(s: Sketch, c: SketchCanvas): void {
  const { g, px, pz, scale, layers, outline } = c;
  const rect = (q: SketchRect) => [px(q.x0), pz(q.z0), (q.x1 - q.x0) * scale, (q.z1 - q.z0) * scale] as const;
  g.save();
  g.lineJoin = 'round';

  if (layers.has('ground') && !outline) {
    for (const q of s.ground) {
      if (q.y2 === undefined) {
        g.fillStyle = groundShade(q.y);
      } else {
        const grad = q.along === 'x' ? g.createLinearGradient(px(q.x0), 0, px(q.x1), 0) : g.createLinearGradient(0, pz(q.z0), 0, pz(q.z1));
        grad.addColorStop(0, groundShade(q.y));
        grad.addColorStop(1, groundShade(q.y2));
        g.fillStyle = grad;
      }
      g.fillRect(...rect(q));
    }
    // The stairs, a line a step, the arrow up them.
    for (const st of s.stairs) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(...rect(st));
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 1;
      const alongZ = st.up === '-z' || st.up === '+z';
      const run = alongZ ? st.z1 - st.z0 : st.x1 - st.x0;
      const steps = Math.max(2, Math.round(run / 0.6));
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (alongZ) {
          const z = st.z0 + (st.z1 - st.z0) * t;
          g.moveTo(px(st.x0), pz(z));
          g.lineTo(px(st.x1), pz(z));
        } else {
          const x = st.x0 + (st.x1 - st.x0) * t;
          g.moveTo(px(x), pz(st.z0));
          g.lineTo(px(x), pz(st.z1));
        }
      }
      g.stroke();
      const cx = (st.x0 + st.x1) / 2;
      const cz = (st.z0 + st.z1) / 2;
      const [dx, dz] = st.up === '-z' ? [0, -1] : st.up === '+z' ? [0, 1] : st.up === '-x' ? [-1, 0] : [1, 0];
      arrow(g, px(cx - dx * run * 0.35), pz(cz - dz * run * 0.35), px(cx + dx * run * 0.35), pz(cz + dz * run * 0.35), '#fff', 1.5);
    }
  }

  if (layers.has('buildings')) {
    for (const bd of s.buildings) {
      const [x, z, w, h] = rect(bd);
      if (outline) {
        g.strokeStyle = 'rgba(255,90,200,0.9)';
        g.lineWidth = 1.5;
        g.strokeRect(x, z, w, h);
        continue;
      }
      g.fillStyle = DISTRICT_COLOURS[bd.district];
      g.fillRect(x, z, w, h);
      if (bd.roof === 'pitched') {
        // A ridge along the longer side, and the tiles' slope as hatching.
        g.strokeStyle = 'rgba(120,50,30,0.45)';
        g.lineWidth = 1;
        g.beginPath();
        const along = bd.x1 - bd.x0 >= bd.z1 - bd.z0;
        const step = 1.2 * scale;
        if (along) for (let xx = x + step / 2; xx < x + w; xx += step) { g.moveTo(xx, z); g.lineTo(xx, z + h); }
        else for (let zz = z + step / 2; zz < z + h; zz += step) { g.moveTo(x, zz); g.lineTo(x + w, zz); }
        g.stroke();
        g.strokeStyle = 'rgba(110,40,20,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        if (along) { g.moveTo(x, z + h / 2); g.lineTo(x + w, z + h / 2); } else { g.moveTo(x + w / 2, z); g.lineTo(x + w / 2, z + h); }
        g.stroke();
      }
      // Flat roofs get a heavy edge: their parapet.
      g.strokeStyle = '#2b2b2b';
      g.lineWidth = bd.roof === 'flat' ? 3 : 1.2;
      g.strokeRect(x, z, w, h);
      if (bd.court) {
        g.fillStyle = groundShade(bd.floor);
        g.fillRect(...rect(bd.court));
        g.lineWidth = 1.2;
        g.strokeRect(...rect(bd.court));
      }
      g.setLineDash([4, 3]);
      g.strokeStyle = '#2b2b2b';
      g.lineWidth = 1.2;
      for (const a of bd.arches ?? []) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(...rect(a));
        g.strokeRect(...rect(a));
      }
      if (bd.arcade) {
        // Pillars along the open side.
        g.setLineDash([]);
        g.fillStyle = '#2b2b2b';
        const alongX = bd.arcade === 'z0' || bd.arcade === 'z1';
        const len = alongX ? bd.x1 - bd.x0 : bd.z1 - bd.z0;
        const inset = 1.5;
        for (let t = 1.5; t < len; t += 3) {
          const ppx = alongX ? bd.x0 + t : bd.arcade === 'x0' ? bd.x0 + inset : bd.x1 - inset;
          const ppz = alongX ? (bd.arcade === 'z0' ? bd.z0 + inset : bd.z1 - inset) : bd.z0 + t;
          g.fillRect(px(ppx) - 2, pz(ppz) - 2, 4, 4);
        }
        g.setLineDash([4, 3]);
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.beginPath();
        if (bd.arcade === 'x0') { g.moveTo(px(bd.x0 + 3), pz(bd.z0)); g.lineTo(px(bd.x0 + 3), pz(bd.z1)); }
        if (bd.arcade === 'x1') { g.moveTo(px(bd.x1 - 3), pz(bd.z0)); g.lineTo(px(bd.x1 - 3), pz(bd.z1)); }
        if (bd.arcade === 'z0') { g.moveTo(px(bd.x0), pz(bd.z0 + 3)); g.lineTo(px(bd.x1), pz(bd.z0 + 3)); }
        if (bd.arcade === 'z1') { g.moveTo(px(bd.x0), pz(bd.z1 - 3)); g.lineTo(px(bd.x1), pz(bd.z1 - 3)); }
        g.stroke();
      }
      g.setLineDash([]);
      // Storeys, and the height its roof stands at.
      const top = bd.floor + bd.storeys * (bd.tall ? 6 : 3);
      g.fillStyle = '#222';
      g.textAlign = 'center';
      g.font = `bold ${Math.max(9, Math.min(13, scale * 1.6))}px system-ui, sans-serif`;
      const cx = x + w / 2;
      const cz = bd.court ? z + h * 0.18 : z + h / 2;
      g.fillText(`${bd.storeys}${bd.tall ? ' tall' : ''}`, cx, cz + 4);
      g.font = `${Math.max(8, Math.min(10, scale * 1.2))}px system-ui, sans-serif`;
      g.fillStyle = '#444';
      g.fillText(`↑${Math.round(top)}`, cx, cz + 15);
      g.textAlign = 'left';
    }
    for (const br of s.bridges) {
      if (outline) continue;
      g.fillStyle = DISTRICT_COLOURS[br.district];
      g.globalAlpha = 0.75;
      g.fillRect(...rect(br));
      g.globalAlpha = 1;
      g.setLineDash([3, 2]);
      g.strokeStyle = '#2b2b2b';
      g.lineWidth = 1.5;
      g.strokeRect(...rect(br));
      g.setLineDash([]);
    }
  }

  if (layers.has('props') && !outline) {
    for (const p of s.props) {
      if (p.round) {
        g.fillStyle = p.label === 'plane' ? 'rgba(40,90,40,0.8)' : 'rgba(60,110,50,0.85)';
        g.beginPath();
        g.arc(px((p.x0 + p.x1) / 2), pz((p.z0 + p.z1) / 2), ((p.x1 - p.x0) / 2) * scale, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.fillStyle = p.label === 'water tower' ? '#7d6a5a' : p.label === 'wall' ? '#8c8170' : p.label === 'fountain' ? '#6fa8c8' : p.label === 'memorial' || p.label === 'kiosk' ? '#7a7a86' : '#9a6a3a';
      g.fillRect(...rect(p));
      g.strokeStyle = '#3a2a1a';
      g.lineWidth = 1;
      g.strokeRect(...rect(p));
    }
  }

  if (layers.has('views')) {
    g.setLineDash([2, 5]);
    g.lineWidth = 1.5;
    g.font = '10px system-ui, sans-serif';
    for (const v of s.views) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(px(v.from[0]), pz(v.from[1]));
      g.lineTo(px(v.to[0]), pz(v.to[1]));
      g.stroke();
      const len = Math.hypot(v.to[0] - v.from[0], v.to[1] - v.from[1]);
      const mx = px((v.from[0] + v.to[0]) / 2);
      const mz = pz((v.from[1] + v.to[1]) / 2);
      label(g, `${Math.round(len)} m`, mx + 3, mz - 3, '#fff', 'rgba(0,0,0,0.55)');
    }
    g.setLineDash([]);
  }

  if (layers.has('routes')) {
    // Each kind a little aside from the others, so ways along the same street both show.
    const offset: Record<RouteKind, number> = { open: 0, tight: 0.9, through: -0.9, roof: 0 };
    for (const route of s.routes) {
      g.strokeStyle = ROUTE_COLOURS[route.kind];
      g.globalAlpha = outline ? 0.6 : 0.85;
      g.lineWidth = route.kind === 'roof' ? 2 : 3;
      if (route.kind === 'roof') g.setLineDash([6, 4]);
      g.beginPath();
      route.points.forEach(([x, z], i) => {
        const o = offset[route.kind];
        if (i) g.lineTo(px(x + o), pz(z + o));
        else g.moveTo(px(x + o), pz(z + o));
      });
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  if (layers.has('spawns')) {
    for (const sp of s.spawns) {
      g.strokeStyle = '#3cff8c';
      g.fillStyle = 'rgba(60,255,140,0.18)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px(sp.x), pz(sp.z), sp.r * scale, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!outline) label(g, `spawn ×4`, px(sp.x) - 22, pz(sp.z) + 4, '#062', 'rgba(220,255,230,0.85)');
    }
  }

  if (layers.has('labels') && !outline) {
    for (const p of s.places) {
      if (p.hub) {
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(px(p.x), pz(p.z), 4 * scale, 0, Math.PI * 2);
        g.stroke();
        g.font = 'bold 14px system-ui, sans-serif';
        label(g, p.name, px(p.x) - g.measureText(p.name).width / 2, pz(p.z) - 4 * scale - 6, '#fff', 'rgba(0,0,0,0.7)');
      } else {
        g.font = 'italic 11px system-ui, sans-serif';
        label(g, p.name, px(p.x) - g.measureText(p.name).width / 2, pz(p.z), '#111', 'rgba(255,255,255,0.75)');
      }
    }
    g.font = '10px system-ui, sans-serif';
    for (const bd of s.buildings) {
      if (!bd.name) continue;
      label(g, bd.name, px(bd.x0) + 3, pz(bd.z0) + 11, '#111', 'rgba(255,255,255,0.6)');
    }
  }
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, z: number, fg: string, bg: string): void {
  const w = g.measureText(text).width;
  const h = parseInt(g.font.match(/(\d+)px/)?.[1] ?? '10', 10);
  g.fillStyle = bg;
  g.fillRect(x - 2, z - h, w + 4, h + 3);
  g.fillStyle = fg;
  g.fillText(text, x, z);
}

function arrow(g: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number, colour: string, width: number): void {
  const a = Math.atan2(z1 - z0, x1 - x0);
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, z0);
  g.lineTo(x1, z1);
  g.moveTo(x1, z1);
  g.lineTo(x1 - 5 * Math.cos(a - 0.5), z1 - 5 * Math.sin(a - 0.5));
  g.moveTo(x1, z1);
  g.lineTo(x1 - 5 * Math.cos(a + 0.5), z1 - 5 * Math.sin(a + 0.5));
  g.stroke();
}
