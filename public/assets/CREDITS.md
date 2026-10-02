# Asset credits

Everything here is CC0 (public domain) but two things. The originals are kept in
`scripts/originals`, and `scripts/fetch-assets.mjs` packs them for the web. The exceptions are
the soldiers, from Microsoft's Rocketbox avatars under the MIT License (its text is below), and
`basis/`, the Basis Universal transcoder built from Binomial's source by
`scripts/build-transcoder.mjs`, under the Apache License 2.0, as three.js ships it.

- **Textures and sky** from [Poly Haven](https://polyhaven.com), CC0: grass_ground,
  withered_grass, dirt, aerial_rocks_02, coast_sand_01, weathered_planks, concrete_wall_004,
  corrugated_iron, wood_plank_wall, bark_brown_02, and the kloofendal_48d_partly_cloudy_puresky
  HDRI. The textures are resized to 512 px and stacked into the KTX2 array textures in
  `textures/`. The sky is halved to 512 × 256.
- **Soldiers** (`soldiers/`): avatars from Microsoft's
  [Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) library, Copyright (c) 2020
  Microsoft, under the MIT License below: `Police_Male_02` and `Police_Female_01` (operators),
  `Military_Male_01`, `_03`, `_04`, `Military_Female_01` and `_02` (guards), and
  `Military_Male_02`, `_05` and `_06` (commanders). Converted by `scripts/rocketbox.py` in
  Blender: the face's bones, the guns and knives some carry and their goggle lenses taken out,
  the soldiers in helmets thinned to 10,000 triangles, their clothes recoloured (operators a
  little olive, guards green, commanders brown), and their textures packed into one KTX2
  image each for colour (512 px a part) and normals (256 px a part). Their clips (idle, walk,
  run, death, shooting, two hit reactions, crouching still and walking, jump, in the air and
  landing) come from Quaternius's
  [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), CC0,
  the free set as mirrored in glTF on
  [GitHub](https://github.com/J-Ponzo/gltf-universal-animation-library), moved onto the first
  avatar's rig by `scripts/retarget.mjs`, which turns the others' bones to play them too.
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

## Microsoft Rocketbox: MIT License

MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
