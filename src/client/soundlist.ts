// The recorded sounds, the one list both the game and
// scripts/fetch-sounds.mjs read. Every one is a CC0 recording on Freesound;
// the script downloads its preview, cuts the part named here, and packs them
// all into one file. No imports, so plain Node can load it.

export interface SoundSource {
  /** What the game plays it as. */
  name: string;
  /** Freesound's id for the recording. */
  freesound: number;
  author: string;
  title: string;
  /** Seconds into the recording to cut from and to. */
  from: number;
  to: number;
  /**
   * `shot`: one sound, starting where it first gets loud. `steps`: the
   * loudest separate footfalls in the range, each its own variation.
   * `loop`: faded into its own start so it repeats seamlessly.
   */
  kind: 'shot' | 'steps' | 'loop';
  /** For steps: how many to keep, and how long each lasts. */
  count?: number;
  length?: number;
}

const step = (name: string, freesound: number, author: string, title: string, from: number, to: number, length = 0.32): SoundSource =>
  ({ name, freesound, author, title, from, to, kind: 'steps', count: 4, length });

export const SOUNDS: SoundSource[] = [
  // Guns. The long-range shot is heard far off, under the near one fading out.
  { name: 'rifle', freesound: 427596, author: 'michorvath', title: 'AR15 rifle shot', from: 0, to: 1.3, kind: 'shot' },
  { name: 'pistol', freesound: 427592, author: 'michorvath', title: '9mm pistol shot', from: 0, to: 1.0, kind: 'shot' },
  { name: 'bolt', freesound: 49513, author: 'Jon285', title: '405Win.wav', from: 0, to: 1.6, kind: 'shot' },
  { name: 'far', freesound: 52357, author: 'trip2000', title: 'gun shot.aif', from: 0, to: 2.0, kind: 'shot' },
  { name: 'quiet', freesound: 384685, author: 'morganpurkis', title: 'Silenced Gunshot 3.wav', from: 0, to: 0.3, kind: 'shot' },
  { name: 'cycle', freesound: 204204, author: 'Danwardvs', title: '22 Bolt.wav', from: 0.2, to: 0.9, kind: 'shot' },
  { name: 'dry', freesound: 725402, author: 'serøutōnin--deprivəd', title: 'A rifle being dry fired once', from: 0, to: 0.3, kind: 'shot' },
  // Reloads: the magazine out and in at the start, the charging handle at the end.
  { name: 'magRifle', freesound: 432141, author: 'MaximBomba', title: 'Rifle-or-shotgun-reload.wav', from: 0, to: 1.0, kind: 'shot' },
  { name: 'chargeRifle', freesound: 432141, author: 'MaximBomba', title: 'Rifle-or-shotgun-reload.wav', from: 1.35, to: 2.0, kind: 'shot' },
  { name: 'magPistol', freesound: 432139, author: 'MaximBomba', title: 'PistolReloadSound.wav', from: 0, to: 1.0, kind: 'shot' },
  { name: 'chargePistol', freesound: 432139, author: 'MaximBomba', title: 'PistolReloadSound.wav', from: 1.25, to: 1.6, kind: 'shot' },
  { name: 'draw', freesound: 396331, author: 'nioczkus', title: '1911 Reload', from: 0.26, to: 0.6, kind: 'shot' },
  { name: 'whoosh', freesound: 60013, author: 'qubodup', title: 'Whoosh', from: 0, to: 0.43, kind: 'shot' },
  { name: 'boom', freesound: 235968, author: 'tommccann', title: 'Explosion_01.wav', from: 0, to: 5.0, kind: 'shot' },
  // Cover breaking.
  { name: 'splinter', freesound: 536777, author: 'egomassive', title: 'Smash.ogg', from: 0, to: 1.05, kind: 'shot' },
  { name: 'crumble', freesound: 843339, author: 'loganzsound', title: 'Concrete Breaks Several Denoised', from: 6.0, to: 7.5, kind: 'shot' },
  // Bodies.
  { name: 'hurt', freesound: 423301, author: 'u1769092', title: 'VisceralBulletImpacts.wav', from: 0.1, to: 0.45, kind: 'shot' },
  { name: 'land', freesound: 364690, author: 'alegemaate', title: 'Human Impact on Ground', from: 0.06, to: 0.6, kind: 'shot' },
  // Footsteps, by surface.
  step('grass', 206030, 'Yuval', 'footsteps grass.wav', 0, 35),
  step('dirt', 352870, 'PotatokingXII', 'Footsteps Dirt Gravel', 4, 35),
  step('sand', 384082, 'savataivanov', 'Foot_Step_grit_Sand.wav', 0, 15.4),
  step('rock', 813622, 'SecureSubset', 'Footsteps - Stone, Rock, Concrete, Cement', 0, 6.7),
  step('wood', 198962, 'Mydo1', 'footsteps on wood', 0, 17),
  step('metal', 208101, 'Phil25', 'Metal Steps', 8, 18),
  step('water', 106395, 'j1987', 'puddlewalk.wav', 0, 7, 0.45),
  // Ambience, looped.
  { name: 'wind', freesound: 22331, author: 'sleepCircle', title: 'wind.ogg', from: 6, to: 30, kind: 'loop' },
  { name: 'sea', freesound: 531015, author: 'Noted451', title: 'Ocean Waves.wav', from: 48, to: 70, kind: 'loop' },
  { name: 'birds', freesound: 385280, author: 'bajko', title: 'sfx_amb_forest_spring_afternoon-01.wav', from: 60, to: 95, kind: 'loop' },
];

/** Where each sound's variations sit in the packed file, in seconds: written by the script. */
export interface SoundBank {
  clips: Record<string, [start: number, duration: number][]>;
}
