# Asset credits

Everything here is CC0 (public domain). The originals are kept in `scripts/originals`, and
`scripts/fetch-assets.mjs` packs them for the web. The one exception is `basis/`, the Basis Universal transcoder built from Binomial's source
by `scripts/build-transcoder.mjs`, under the Apache License 2.0, as three.js ships it.

- **Textures and sky** from [Poly Haven](https://polyhaven.com), CC0: grass_ground,
  withered_grass, dirt, aerial_rocks_02, coast_sand_01, weathered_planks, concrete_wall_004,
  corrugated_iron, wood_plank_wall, bark_brown_02, and the kloofendal_48d_partly_cloudy_puresky
  HDRI. The textures are resized to 512 px and stacked into the KTX2 array textures in
  `textures/`. The sky is halved to 512 × 256.
- **Soldier** (`soldier.glb`): the "SWAT" character by [Quaternius](https://quaternius.com),
  public domain (CC0), via [Poly Pizza](https://poly.pizza/m/Btfn3G5Xv4). Only its idle, walk,
  run, death, shooting and two hit-reaction clips are kept. Its crouch (still and walking), jump,
  in-air and landing clips come from Quaternius's
  [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), CC0,
  the free set as mirrored in glTF on
  [GitHub](https://github.com/J-Ponzo/gltf-universal-animation-library), moved onto the soldier's
  rig by `scripts/retarget.mjs`.
- **Guns** (`guns/`) by [Quaternius](https://quaternius.com), public domain (CC0), via
  [Poly Pizza](https://poly.pizza): Assault Rifle, Pistol and Sniper Rifle. Each has points marked
  on it (where the hands close, the muzzle, the sight, the magazine and the bolt) as empty nodes.
- **Sounds** (`sounds-early.ogg`, `sounds-ambience.ogg`, `sounds-late.ogg`) from
  [Freesound](https://freesound.org), each one CC0, checked on its page by
  `scripts/fetch-sounds.mjs`. Cut from Freesound's previews and packed into three files as Opus;
  `sounds.json` says where each sits. By sound: AR15 rifle shot, 9mm pistol shot (michorvath);
  Sauer 404 close shot.wav (moosegravy); gun shot.aif (trip2000); Silenced Sniper Rifle.flac,
  Whoosh (qubodup); SIG Sauer P226 (Suppressed), MacMillan Tac-50A1-R2 Suppressed (areniporgen);
  22 Bolt.wav (Danwardvs); A rifle being dry fired once (serøutōnin--deprivəd); AR15 M4 Gun
  Hardware Magazine Movement Sounds, Glock 19 Handgun Pistol Slide Cocking Sounds
  (jackthemurray); Handgun / Pistol Removing Mag and Inserting Mag Foley (e9118586020); Bolt
  Action Rifle Reload (AugustSandberg); 1911 Reload (nioczkus); Explosion_01.wav (tommccann);
  Smash.ogg (egomassive); Glass Break (unfa); door - open 01.wav (Anthousai); Wood Door Slam.wav
  (MootMcnoodles); Concrete Breaks Several Denoised (loganzsound); VisceralBulletImpacts.wav
  (u1769092); Human Impact on Ground (alegemaate); footsteps grass.wav (Yuval); Footsteps Dirt
  Gravel (PotatokingXII); Foot_Step_grit_Sand.wav (savataivanov); Footsteps - Stone, Rock,
  Concrete, Cement (SecureSubset); Footsteps on concrete (florianreichelt); footsteps on wood
  (Mydo1); Metal Steps (Phil25); puddlewalk.wav (j1987); wind.ogg (sleepCircle); Ocean Waves.wav
  (Noted451); sfx_amb_forest_spring_afternoon-01.wav (bajko); Rain Slowly Passing TREATED
  LOOP_Edgewater_06192020.wav (speakwithanimals); AMBIENCE NIGHT FIELD CRICKET 01.wav (sengjinn);
  Heavy Thunder Strike - no Rain - QUADRO.wav (BlueDelta). The Freesound ids are in
  `src/client/soundlist.ts`.
