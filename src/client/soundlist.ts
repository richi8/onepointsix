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
  /** For a shot: seconds its end fades out over, if longer than the usual quarter second. */
  fade?: number;
}

const step = (name: string, freesound: number, author: string, title: string, from: number, to: number, length = 0.32): SoundSource =>
  ({ name, freesound, author, title, from, to, kind: 'steps', count: 4, length });

export const SOUNDS: SoundSource[] = [
  // Guns. The long-range shot is heard far off, under the near one fading out.
  { name: 'rifle', freesound: 427596, author: 'michorvath', title: 'AR15 rifle shot', from: 0, to: 1.3, kind: 'shot' },
  { name: 'pistol', freesound: 427592, author: 'michorvath', title: '9mm pistol shot', from: 0, to: 1.0, kind: 'shot' },
  { name: 'bolt', freesound: 431834, author: 'moosegravy', title: 'Sauer 404 close shot.wav', from: 0.45, to: 2.3, kind: 'shot', fade: 0.8 },
  { name: 'far', freesound: 52357, author: 'trip2000', title: 'gun shot.aif', from: 0, to: 2.0, kind: 'shot' },
  // Suppressed shots, one per gun: a sniper rifle for the rifle, a suppressed 9 mm and a .50 bolt-action.
  { name: 'quietRifle', freesound: 182815, author: 'qubodup', title: 'Silenced Sniper Rifle.flac', from: 0.98, to: 1.95, kind: 'shot', fade: 0.5 },
  { name: 'quietPistol', freesound: 828790, author: 'areniporgen', title: 'SIG Sauer P226 (Suppressed)', from: 0, to: 0.7, kind: 'shot', fade: 0.4 },
  { name: 'quietBolt', freesound: 737570, author: 'areniporgen', title: 'MacMillan Tac-50A1-R2 Suppressed', from: 0, to: 0.9, kind: 'shot', fade: 0.5 },
  { name: 'cycle', freesound: 204204, author: 'Danwardvs', title: '22 Bolt.wav', from: 0.2, to: 0.9, kind: 'shot' },
  { name: 'dry', freesound: 725402, author: 'serøutōnin--deprivəd', title: 'A rifle being dry fired once', from: 0, to: 0.3, kind: 'shot' },
  // Reloads: the magazine out, a fresh one in, and at the end the charging
  // handle or the slide. The rifle's are an AR15 being handled, the pistol's
  // magazine a pistol's, its slide a Glock 19's.
  { name: 'magOutRifle', freesound: 393732, author: 'jackthemurray', title: 'AR15 M4 Gun Hardware Magazine Movement Sounds', from: 18.0, to: 18.7, kind: 'shot', fade: 0.2 },
  { name: 'magInRifle', freesound: 393732, author: 'jackthemurray', title: 'AR15 M4 Gun Hardware Magazine Movement Sounds', from: 16.1, to: 17.0, kind: 'shot', fade: 0.2 },
  { name: 'chargeRifle', freesound: 393732, author: 'jackthemurray', title: 'AR15 M4 Gun Hardware Magazine Movement Sounds', from: 1.0, to: 1.8, kind: 'shot', fade: 0.2 },
  { name: 'magOutPistol', freesound: 456195, author: 'e9118586020', title: 'Handgun / Pistol Removing Mag and Inserting Mag Foley', from: 11.0, to: 11.6, kind: 'shot', fade: 0.2 },
  { name: 'magInPistol', freesound: 456195, author: 'e9118586020', title: 'Handgun / Pistol Removing Mag and Inserting Mag Foley', from: 12.2, to: 12.8, kind: 'shot', fade: 0.2 },
  { name: 'chargePistol', freesound: 393734, author: 'jackthemurray', title: 'Glock 19 Handgun Pistol Slide Cocking Sounds', from: 20.85, to: 21.5, kind: 'shot', fade: 0.2 },
  // The bolt-action's reload: the bolt up and back, rounds pressed in from a clip, the bolt home.
  { name: 'boltOpen', freesound: 508747, author: 'AugustSandberg', title: 'Bolt Action Rifle Reload', from: 2.9, to: 3.8, kind: 'shot', fade: 0.15 },
  { name: 'boltLoad', freesound: 508747, author: 'AugustSandberg', title: 'Bolt Action Rifle Reload', from: 7.7, to: 9.7, kind: 'shot', fade: 0.2 },
  { name: 'boltClose', freesound: 508747, author: 'AugustSandberg', title: 'Bolt Action Rifle Reload', from: 19.95, to: 20.8, kind: 'shot', fade: 0.15 },
  { name: 'draw', freesound: 396331, author: 'nioczkus', title: '1911 Reload', from: 0.26, to: 0.6, kind: 'shot' },
  { name: 'whoosh', freesound: 60013, author: 'qubodup', title: 'Whoosh', from: 0, to: 0.43, kind: 'shot' },
  { name: 'boom', freesound: 235968, author: 'tommccann', title: 'Explosion_01.wav', from: 0, to: 5.0, kind: 'shot' },
  // Cover breaking.
  { name: 'splinter', freesound: 536777, author: 'egomassive', title: 'Smash.ogg', from: 0, to: 1.05, kind: 'shot' },
  { name: 'glass', freesound: 221528, author: 'unfa', title: 'Glass Break', from: 0.25, to: 1.4, kind: 'shot', fade: 0.4 },
  // Doors.
  { name: 'doorOpen', freesound: 398750, author: 'Anthousai', title: 'door - open 01.wav', from: 0, to: 1.2, kind: 'shot', fade: 0.4 },
  { name: 'doorShut', freesound: 444409, author: 'MootMcnoodles', title: 'Wood Door Slam.wav', from: 0, to: 0.93, kind: 'shot', fade: 0.4 },
  { name: 'crumble', freesound: 843339, author: 'loganzsound', title: 'Concrete Breaks Several Denoised', from: 6.0, to: 7.5, kind: 'shot' },
  // Bodies.
  { name: 'hurt', freesound: 423301, author: 'u1769092', title: 'VisceralBulletImpacts.wav', from: 0.1, to: 0.45, kind: 'shot' },
  { name: 'land', freesound: 364690, author: 'alegemaate', title: 'Human Impact on Ground', from: 0.06, to: 0.6, kind: 'shot' },
  // Footsteps, by surface.
  step('grass', 206030, 'Yuval', 'footsteps grass.wav', 0, 35),
  step('dirt', 352870, 'PotatokingXII', 'Footsteps Dirt Gravel', 4, 35),
  step('sand', 384082, 'savataivanov', 'Foot_Step_grit_Sand.wav', 0, 15.4),
  step('rock', 813622, 'SecureSubset', 'Footsteps - Stone, Rock, Concrete, Cement', 0, 6.7),
  step('concrete', 459964, 'florianreichelt', 'Footsteps on concrete', 0, 19.8),
  step('wood', 198962, 'Mydo1', 'footsteps on wood', 0, 17),
  step('metal', 208101, 'Phil25', 'Metal Steps', 8, 18),
  step('water', 106395, 'j1987', 'puddlewalk.wav', 0, 7, 0.45),
  // Ambience, looped.
  { name: 'wind', freesound: 22331, author: 'sleepCircle', title: 'wind.ogg', from: 6, to: 30, kind: 'loop' },
  { name: 'sea', freesound: 531015, author: 'Noted451', title: 'Ocean Waves.wav', from: 48, to: 70, kind: 'loop' },
  { name: 'birds', freesound: 385280, author: 'bajko', title: 'sfx_amb_forest_spring_afternoon-01.wav', from: 60, to: 95, kind: 'loop' },
  { name: 'rain', freesound: 525046, author: 'speakwithanimals', title: 'Rain Slowly Passing TREATED LOOP_Edgewater_06192020.wav', from: 100, to: 128, kind: 'loop' },
  { name: 'crickets', freesound: 175020, author: 'sengjinn', title: 'AMBIENCE NIGHT FIELD CRICKET 01.wav', from: 8, to: 38, kind: 'loop' },
  // Weather: a strike and its rumble, heard nearer or farther off.
  { name: 'thunder', freesound: 446753, author: 'BlueDelta', title: 'Heavy Thunder Strike - no Rain - QUADRO.wav', from: 0.8, to: 10, kind: 'shot', fade: 3 },
];

/**
 * Sounds wanted from the first moment of a run, packed in a file of their
 * own that loads behind the loading bar: your own guns, steps and landing.
 * The ambience beds, long loops, come next in a file of their own, behind
 * the menu, and fade in once they're in. The rest, other people's doings
 * heard later, load after them.
 */
export const EARLY: ReadonlySet<string> = new Set([
  'rifle', 'pistol', 'bolt', 'quietRifle', 'quietPistol', 'quietBolt', 'cycle', 'dry', 'magOutRifle', 'magInRifle', 'chargeRifle',
  'magOutPistol', 'magInPistol', 'chargePistol', 'boltOpen', 'boltLoad', 'boltClose', 'draw',
  'land', 'grass', 'dirt', 'sand', 'rock', 'concrete', 'wood', 'metal', 'water',
]);
export const AMBIENCE: ReadonlySet<string> = new Set(['wind', 'sea', 'birds', 'rain', 'crickets']);

/** The banks in the order they load, and which sounds each packs. */
export const BANKS: readonly { name: string; has: (sound: string) => boolean }[] = [
  { name: 'early', has: (s) => EARLY.has(s) },
  { name: 'ambience', has: (s) => AMBIENCE.has(s) },
  { name: 'late', has: (s) => !EARLY.has(s) && !AMBIENCE.has(s) },
];

/** One packed file: where each sound's variations sit in it, in seconds, and how long it is. */
export interface PackedBank {
  name: string;
  length: number;
  clips: Record<string, [start: number, duration: number][]>;
}

/** An encoding each bank comes in, and the silence its encoder put in front, in seconds. */
export interface SoundFormat {
  ext: string;
  /** For canPlayType. */
  type: string;
  priming: number;
}

/** What the script writes to sounds.json. */
export interface SoundBanks {
  banks: PackedBank[];
  /** Best first. */
  formats: SoundFormat[];
}

/**
 * Seconds to add to every clip's start in a bank that decoded `decoded`
 * seconds long. Chrome and Safari trim the encoder's priming and padding as
 * the file says; Firefox didn't for AAC, so there the whole file is late by
 * the priming and a little longer.
 */
export function bankLead(length: number, priming: number, decoded: number): number {
  return priming && decoded - length > priming - 1e-3 ? priming : 0;
}
