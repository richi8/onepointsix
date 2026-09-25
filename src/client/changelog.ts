// What's new, written for players rather than developers: how the game plays
// differently after each update. Newest first. Every change that players can
// notice gets an entry here, in the same commit.

export interface ChangelogEntry {
  /** Day it came out, as YYYY-MM-DD. */
  date: string;
  title: string;
  notes: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-09-25',
    title: 'Share your island',
    notes: [
      'Death cam: when someone kills you, watch your last seconds through their eyes, down to where they aimed and every shot they fired. Click or press Space to skip, or watch it again from the results.',
      'Set your name on the menu. It goes on your scores and the links you share.',
      'Every island keeps a leaderboard of your best runs in each mode, shown on the menu.',
      'Challenge a friend from the results screen: it copies a link to the same island with your score to beat. Whoever opens it sees your score on the menu and finds out at the end whether they beat it.',
      'Share link on the menu copies a link to the island you’re on, with your best score there.',
      'New island takes you to a fresh random island.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Look and sound',
    notes: [
      'The island has real textures now: grass, dry meadow, dirt around the outposts, rock on the slopes and sand on the beaches, lit by a real sky.',
      'Walls are concrete, crates and fences are wooden planks and containers are corrugated metal. The watchtowers are timber.',
      'New trees: ragged firs with drooping branches instead of green cones.',
      'Operators and guards are soldiers now. They walk and run, crouch, lean and aim where they look, with their guns in their hands. Guards wear olive.',
      'Your guns are proper models: a carbine with a red dot, a pistol and a scoped hunting rifle. Everyone else carries them too.',
      'You can see other people’s muzzle flashes, and their tracers start at their guns.',
      'Sound is 3D. Gunfire, explosions and breaking cover come from where they happen, so you can tell where a fight is by ear.',
      'Footsteps: yours and everyone else’s, and they sound different on grass, sand, rock, concrete, wood, metal and in the water. Sprinting is loud, and crouching is nearly silent. Landing from a big drop thuds.',
      'On slower computers the game now lowers its resolution a little to keep the frame rate up. F3 shows the frame rate.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Contracts and suppressors',
    notes: [
      'Every run now comes with one or two contracts: grab the intel from an outpost’s watchtower, destroy an outpost’s supply cache, or eliminate a commander. They’re listed top right and marked on screen.',
      'Contracts pay on top of your loot, but only if you get off the island.',
      'The intel is in a radio case on the watchtower: hold F on it to grab it. The supply cache is the crate with red straps, so shoot it apart or blow it up.',
      'A commander is a tough guard who walks their outpost for as long as your run lasts. If someone else kills yours first, the contract is lost.',
      'Suppressors turn up in crates. Taking one fits it to the gun in your hands, or to the next one without. Suppressed shots carry much less far and have no muzzle flash, so guards find it harder to spot you.',
      'Guards now hear walls, fences and crates breaking, and come to look.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'Things break',
    notes: [
      'Walls, fences and crates can now be destroyed. Shoot them apart or blow them open, and whatever stood on top comes down too.',
      'Knock out the bottom of a wall and you get a hole you can walk and shoot through. Cover you hide behind isn’t safe forever.',
      'Wooden fences now run across the fields. They give you somewhere to hide, but they don’t stop much.',
      'Grenades: press G to throw one. You carry two, and ammo boxes refill them. They bounce, roll and go off after about three seconds.',
      'Smash a loot crate and its contents spill out onto the ground in a bag.',
      'Guards hear explosions from far away, and they get out of the way of a grenade landing at their feet.',
      'Broken cover is rebuilt after a few minutes.',
      'Drop your last item with X now. G throws grenades.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'Runs',
    notes: [
      'Pick a mode before you play. Mixed puts you on the island with eleven other operators, PvE is you against the guards, and Range is target practice.',
      'Every run has a 10-minute clock. Get off the island before it runs out or you’re missing in action.',
      'Search crates with F for cash, valuables, ammo and medkits. Heavy loot slows you down.',
      'Extraction points open and close over time. Beaches are walk-in, but at a landing zone you call in a pickup and hold out while guards come for you.',
      'Your score is the loot you get out with, plus kills. Die and you drop everything in a bag for someone else to find.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'You’re not alone',
    notes: [
      'Every outpost has guards and a sentry in its watchtower, and patrols walk between them.',
      'Other operators drop in to loot and extract, just like you.',
      'Guards see and hear you. They investigate gunfire, call out to each other, take cover and try to flank you.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'Guns',
    notes: [
      'Three weapons: an assault rifle, a pistol and a bolt-action rifle. Switch between them with 1, 2 and 3 or the mouse wheel.',
      'Each gun has its own recoil. You’re more accurate aiming down the sights, standing still and crouching.',
      'Headshots do extra damage. Hit markers and damage numbers show every hit.',
      'Practise on target dummies at the range.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'Move like a soldier',
    notes: [
      'Sprint and then crouch to slide into cover.',
      'Jump at a crate or a low wall while moving forward to climb over it.',
      'Lean around corners with Q and E.',
      'Sprinting and jumping use stamina, and a heavy load wears you out faster.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'On foot',
    notes: [
      'Walk the island in first person. You can sprint, crouch and jump, and strafe through the air.',
    ],
  },
  {
    date: '2026-09-24',
    title: 'The island',
    notes: [
      'A whole island to explore, with six outposts, forests, rocks and beaches.',
      'Press Play to jump straight in.',
      'Every island comes from a seed, and the same seed always builds the same island, so a link shows your friends exactly where you played.',
    ],
  },
];
