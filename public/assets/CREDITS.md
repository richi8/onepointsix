# Asset credits

Everything here is CC0 (public domain). `scripts/fetch-assets.mjs` downloads it and packs it for
the web.

- **Textures and sky** from [Poly Haven](https://polyhaven.com), CC0: grass_ground,
  withered_grass, dirt, aerial_rocks_02, coast_sand_01, weathered_planks, concrete_wall_004,
  corrugated_iron, wood_plank_wall, bark_brown_02, and the kloofendal_48d_partly_cloudy_puresky
  HDRI. The textures are resized to 512 px and stacked into the KTX2 array textures in
  `textures/`. The sky is halved to 512 × 256.
- **Soldier** (`soldier.glb`): the "SWAT" character by [Quaternius](https://quaternius.com),
  public domain (CC0), via [Poly Pizza](https://poly.pizza/m/Btfn3G5Xv4). Only its idle, walk
  and run clips are kept.
- **Guns** (`guns/`) by [Quaternius](https://quaternius.com), public domain (CC0), via
  [Poly Pizza](https://poly.pizza): Assault Rifle, Pistol and Sniper Rifle.
- **Sounds** (`sounds.m4a`) from [Freesound](https://freesound.org), each one CC0, checked on its
  page by `scripts/fetch-sounds.mjs`. Cut from Freesound's previews and packed into one file;
  `sounds.json` says where each sits. By sound: AR15 rifle shot, 9mm pistol shot (michorvath);
  405Win.wav (Jon285); gun shot.aif (trip2000); Silenced Gunshot 3.wav (morganpurkis); 22 Bolt.wav
  (Danwardvs); A rifle being dry fired once (serøutōnin--deprivəd); Rifle-or-shotgun-reload.wav,
  PistolReloadSound.wav (MaximBomba); 1911 Reload (nioczkus); Whoosh (qubodup); Explosion_01.wav
  (tommccann); Smash.ogg (egomassive); Concrete Breaks Several Denoised (loganzsound);
  VisceralBulletImpacts.wav (u1769092); Human Impact on Ground (alegemaate); footsteps
  grass.wav (Yuval); Footsteps Dirt Gravel (PotatokingXII);
  Foot_Step_grit_Sand.wav (savataivanov); Footsteps - Stone, Rock, Concrete, Cement (SecureSubset);
  footsteps on wood (Mydo1); Metal Steps (Phil25); puddlewalk.wav (j1987); wind.ogg (sleepCircle);
  Ocean Waves.wav (Noted451); sfx_amb_forest_spring_afternoon-01.wav (bajko); Rain Slowly Passing
  TREATED LOOP_Edgewater_06192020.wav (speakwithanimals); AMBIENCE NIGHT FIELD CRICKET 01.wav
  (sengjinn). The Freesound ids are in `src/client/soundlist.ts`.
