import { WATER_LEVEL } from '../shared/constants.ts';
import type { PropStyle, World } from '../shared/world.ts';
import { groundLayerAt } from '../shared/ground.ts';
import { Layer } from '../shared/layers.ts';

// What a body is standing on, for how its footsteps sound: a prop's top, the
// water, or whichever ground layer is painted strongest underfoot.

export type Surface = 'grass' | 'dirt' | 'sand' | 'rock' | 'concrete' | 'wood' | 'metal' | 'water';

const PROP_SURFACE: Record<PropStyle, Surface> = {
  crate: 'wood', wall: 'concrete', wood: 'wood', metal: 'metal', fence: 'wood', roof: 'metal', door: 'wood', glass: 'concrete',
};
/** The sound of each ground layer, by Layer index. */
const GROUND_SURFACE: Surface[] = [];
GROUND_SURFACE[Layer.grass] = 'grass';
GROUND_SURFACE[Layer.dryGrass] = 'grass';
GROUND_SURFACE[Layer.dirt] = 'dirt';
GROUND_SURFACE[Layer.rock] = 'rock';
GROUND_SURFACE[Layer.sand] = 'sand';
/** Metres across a cell of the prop lookup. */
const CELL = 8;

export class Surfaces {
  private readonly world: World;
  /** Standing props by cell, so the one underfoot is quick to find. */
  private readonly cells = new Map<number, number[]>();

  constructor(world: World) {
    this.world = world;
    world.props.forEach(({ box }, i) => {
      for (let cx = Math.floor(box.minX / CELL); cx <= Math.floor(box.maxX / CELL); cx++) {
        for (let cz = Math.floor(box.minZ / CELL); cz <= Math.floor(box.maxZ / CELL); cz++) {
          const key = cellKey(cx, cz);
          const list = this.cells.get(key) ?? [];
          list.push(i);
          this.cells.set(key, list);
        }
      }
    });
  }

  /** The surface under feet at (x, y, z). */
  at(x: number, y: number, z: number): Surface {
    const w = this.world;
    const terrain = w.terrainHeight(x, z);
    if (y > w.floorHeight(x, z) + 0.2) {
      for (const i of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
        const { box, style } = w.props[i];
        if (box.gone || Math.abs(box.maxY - y) > 0.25) continue;
        if (x >= box.minX - 0.3 && x <= box.maxX + 0.3 && z >= box.minZ - 0.3 && z <= box.maxZ + 0.3) return PROP_SURFACE[style];
      }
    }
    if (terrain < WATER_LEVEL - 0.1) return 'water';
    return GROUND_SURFACE[groundLayerAt(w, x, z)] ?? 'grass';
  }
}

function cellKey(cx: number, cz: number): number {
  return (cx + 1000) * 2000 + (cz + 1000);
}
