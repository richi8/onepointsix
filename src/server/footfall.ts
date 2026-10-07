import type { Footfall, MapPaving } from '../shared/maps/index.ts';

// Where a map's paving is walked, for wearing it (see townlook.ts): the
// Deathmatch simulation counts the ticks each bot stands outdoors on the
// ground over a grid of the paving's area, and the count becomes a footfall
// (see maps/index.ts) written into the map's `<name>-footfall.ts`.

/** Metres a cell of the grid covers, and how far its blur reaches (a standard deviation). */
const CELL = 1;
const BLUR = 1;
/** A cell is fully worn at this share of the busiest of the cells walked, and less in proportion (to a power under one, so a lane walked less still shows). */
const BUSY = 0.85;
const CURVE = 0.8;

export class FootfallCount {
  readonly w: number;
  readonly h: number;
  private readonly count: Float64Array;

  private readonly paving: MapPaving;

  constructor(paving: MapPaving) {
    this.paving = paving;
    this.w = Math.ceil((paving.area.maxX - paving.area.minX) / CELL);
    this.h = Math.ceil((paving.area.maxZ - paving.area.minZ) / CELL);
    this.count = new Float64Array(this.w * this.h);
  }

  /** Count a tick of someone standing at (x, z). */
  step(x: number, z: number): void {
    const i = Math.floor((x - this.paving.area.minX) / CELL);
    const j = Math.floor((z - this.paving.area.minZ) / CELL);
    if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.count[j * this.w + i]++;
  }

  /** The counts as a footfall: blurred, then each cell's wear from how busy it is next to the busy ones. */
  footfall(): Footfall {
    const r = Math.ceil(BLUR * 2.5 / CELL);
    const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * (((i - r) * CELL) / BLUR) ** 2));
    const sum = k.reduce((a, b) => a + b, 0);
    const pass = (from: Float64Array, across: boolean): Float64Array => {
      const to = new Float64Array(from.length);
      for (let j = 0; j < this.h; j++) {
        for (let i = 0; i < this.w; i++) {
          let v = 0;
          for (let d = -r; d <= r; d++) {
            const a = across ? i + d : i;
            const b = across ? j : j + d;
            if (a >= 0 && b >= 0 && a < this.w && b < this.h) v += from[b * this.w + a] * k[d + r];
          }
          to[j * this.w + i] = v / sum;
        }
      }
      return to;
    };
    const blurred = pass(pass(this.count, true), false);
    const walked = [...blurred].filter((v) => v > 0).sort((a, b) => a - b);
    const busy = walked[Math.floor((walked.length - 1) * BUSY)] || 1;
    const bytes = Uint8Array.from(blurred, (v) => Math.round(255 * Math.min(1, (v / busy) ** CURVE)));
    return { cell: CELL, w: this.w, h: this.h, data: btoa(String.fromCharCode(...bytes)) };
  }
}

/** The source of a map's `-footfall.ts`. */
export function footfallSource(f: Footfall): string {
  return `import type { Footfall } from './index.ts';

// Where the bots walk over this map's paving, written by \`npm run sim:deathmatch\`
// with \`footfall\` (see server/footfall.ts), so its wear follows the walking.

export const FOOTFALL: Footfall | undefined = {
  cell: ${f.cell},
  w: ${f.w},
  h: ${f.h},
  data:
    '${f.data}',
};
`;
}
