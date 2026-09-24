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
