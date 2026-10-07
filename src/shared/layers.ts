// The surface texture layers, the one list both the game and
// scripts/fetch-assets.mjs read: the script stacks the Poly Haven textures
// into array textures in this order, and the game samples them by index.
// No imports, so plain Node can load it.

export const LAYERS = [
  // `scale` is the metres one repeat covers; `tint` corrects a layer's colour.
  { name: 'grass', polyHaven: 'grass_ground', scale: 3.5, tint: [1, 1, 1] },
  // Pale on its own.
  { name: 'dryGrass', polyHaven: 'withered_grass', scale: 3, tint: [0.72, 0.74, 0.55] },
  { name: 'dirt', polyHaven: 'dirt', scale: 3, tint: [1, 1, 1] },
  { name: 'rock', polyHaven: 'aerial_rocks_02', scale: 7, tint: [1, 1, 1] },
  // Bright on its own.
  { name: 'sand', polyHaven: 'coast_sand_01', scale: 4, tint: [0.9, 0.88, 0.82] },
  { name: 'planks', polyHaven: 'weathered_planks', scale: 1.6, tint: [1, 1, 1] },
  { name: 'concrete', polyHaven: 'concrete_wall_004', scale: 3, tint: [1, 1, 1] },
  { name: 'metal', polyHaven: 'corrugated_iron', scale: 2.2, tint: [1, 1, 1] },
  { name: 'boards', polyHaven: 'wood_plank_wall', scale: 2, tint: [1, 1, 1] },
  { name: 'bark', polyHaven: 'bark_brown_02', scale: 2.5, tint: [1, 1, 1] },
  // A map town's: whitewashed walls, cut stone, the lanes' flagstones, the squares' cobbles, roof tiles and terracotta floors.
  { name: 'plaster', polyHaven: 'plastered_wall', scale: 2, tint: [1, 1, 1] },
  { name: 'ashlar', polyHaven: 'sandstone_blocks_08', scale: 3, tint: [1, 1, 1] },
  { name: 'flagstones', polyHaven: 'stone_tiles_02', scale: 2, tint: [0.88, 0.86, 0.82] },
  { name: 'cobbles', polyHaven: 'cobblestone_floor_08', scale: 2, tint: [0.78, 0.76, 0.72] },
  { name: 'rooftiles', polyHaven: 'clay_roof_tiles_02', scale: 2.5, tint: [1, 1, 1] },
  { name: 'cotto', polyHaven: 'terracotta_floor_tiles', scale: 2.08, tint: [1, 1, 1] },
] as const;

/** How many layers are the island's: the rest, a map town's, are in the full textures only. */
export const ISLAND_LAYERS = 10;

type LayerName = (typeof LAYERS)[number]['name'];

/** Each layer's index by name. */
export const Layer = Object.fromEntries(LAYERS.map((l, i) => [l.name, i])) as Record<LayerName, number>;
