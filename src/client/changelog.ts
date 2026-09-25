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
    title: 'A steadier main menu',
    notes: [
      'The F3 frame-rate panel and the F4 run log panel are gone. Your runs are still logged in this browser.',
      'In rain or fog the island behind the main menu now shows through the weather, instead of vanishing into grey.',
      'What the chosen mode, time of day and weather mean is spelled out in one box, a line each, and the menu no longer jumps about as you switch between them.',
      'The leaderboard keeps its size, with open places down to fifth, and a challenge from a link stays put when you switch modes, faded in the other one.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Online and Offline',
    notes: [
      'The modes are now Online and Offline. Both put you on the island with the guards and 7 other operators.',
      'Online: the other operators start as bots, and anyone who joins your island takes a bot’s place.',
      'Offline: the same run, but the other operators are always bots and nobody else joins. It replaces PvE, so you’re no longer alone with the guards.',
      'The shooting range is gone.',
      'Your best scores from Mixed carry over to Online.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Day, night and weather',
    notes: [
      'Pick the time of day (day, dusk or night) and the weather (clear, rain or fog) on the main menu. They go into the island’s link, so a friend plays it in exactly the same conditions.',
      'At night the island is lit only by the moon and stars. Outposts have more guards, and tougher ones, but every crate holds an extra item and valuables turn up more often.',
      'Press T for a flashlight at dusk and at night. It lights your way, but anyone can see it from far off, and guards spot you much sooner. Guards carry theirs lit all night, so you can see them coming. Operators light their way across the open island and go dark near outposts.',
      'Rain shortens how far everyone sees and drowns out footsteps and far-off shots, so it’s easier to sneak up on someone. In fog nobody sees far, you included.',
      'The sound follows the weather and the hour: rain drums down, and crickets take over from the birds after dark.',
      'Leaderboards stay the same across all conditions: your best on an island counts whatever the weather.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Run dashboard',
    notes: [
      'Esc shows your run so far (the game carries on behind it): what you’d score if you got out now, your loot, kills and contracts, the time left and your best on this island. Click anywhere to carry on, or leave the game for the main menu.',
      'You can buy me a coffee from the main menu if you enjoy the game.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Hide in the bushes',
    notes: [
      'Guards and operators can no longer see through bushes. Crouch behind a big one and they’ll walk past; stand up and they’ll spot you. Firing an unsuppressed gun still gives you away. Grass blocks their view too, though it’s short, so it only hides you when they look along the ground, such as over the brow of a hill.',
      'Bushes come in more sizes, some big enough to crouch behind, and you can see them much farther off.',
      'The island is less washed out: stronger sunlight, richer colours, darker and clearer shadows and less haze.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Buildings, grass and waves',
    notes: [
      'Every outpost now has a concrete building with two rooms, doorways at the front, the end and between the rooms, and windows you can shoot through. Fight through it room by room, blow holes in its walls, and search the guarded crates inside.',
      'Outposts have been rearranged to make room, so an island from an older link looks a little different inside its walls.',
      'Grass, low bushes and pebbles cover the ground around you, and the grass and trees sway in the wind.',
      'The sea has waves, clear pale water over the sand, darker water farther out and foam lapping along the shore. Sink below the surface and everything turns murky green.',
      'Shadows reach much farther out and stay sharp close by, and rooms under a roof are dim.',
      'Debris from broken cover looks like what it came from: concrete, planks or boards.',
      'Distant hills and trees are drawn more simply, so the game runs smoother.',
      'On slower computers the picture no longer keeps switching between sharp and blurry.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'No more sliding',
    notes: [
      'Sliding is gone. Crouching while you sprint now just crouches.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Real sound',
    notes: [
      'Guns, grenades, reloads, footsteps and breaking cover are now real recordings instead of synthesized beeps and hiss.',
      'Distant gunfire sounds distant: it’s duller, arrives after you see the muzzle flash (about a second per 340 m), and a far-off fight rolls across the island like the real thing.',
      'Walls and hills muffle what’s behind them. A wall you could shoot over still lets the sound over the top; a hill or a building doesn’t.',
      'Shots ring off the walls when you’re inside an outpost, and sound open out in the fields.',
      'You can hear the wind, the sea getting louder toward the shore and coming from its direction, and birds among the trees, which go quiet for a while after shooting nearby.',
      'Footsteps now match exactly what you see underfoot: grass, dirt, sand, rock, concrete, wood, metal or water.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Soldiers that show what they’re doing',
    notes: [
      'You can now see what other soldiers are up to: crouch-walking, sliding, jumping, falling and climbing onto ledges each look different, and so do reloading, switching weapons and throwing a grenade. A running soldier carries their gun low.',
      'Soldiers fall down dead instead of toppling over stiffly. They fall away from whoever shot them, turn aside rather than fall into a wall, lie along the slope of the ground, and drop their gun beside them.',
      'Your own arms now hold your gun in first person, and your left hand fetches a fresh magazine when you reload and throws your grenades.',
      'Hands close around the gun, and suppressors show on other soldiers’ guns.',
      'Operators carry packs, guards wear brown webbing, and commanders have a red band on their helmet and a radio mast on their back, so you can spot the one you’re hunting.',
      'A hit now flashes only where the round landed, and a leaning soldier’s head is exactly where you have to aim to hit it.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Playtest tuning',
    notes: [
      'Mixed games now hold 8 operators instead of 12, so you run into another operator every minute or two rather than every few seconds.',
      'You drop in farther from the outposts and from other operators.',
      'Other operators play smarter: they skirt around outposts, creep when close to one, and slip away from guards instead of fighting the whole outpost. They leave you alone at long range unless you shoot at them.',
      'Your runs are logged in this browser. Press F4 to see how long they last, how they end and what killed you, and copy the log to send it in.',
      'A shared link without a mode now challenges you in whichever mode you pick.',
      'The menu fits small and short windows.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Faster loading',
    notes: [
      'The game downloads less than half as much as before, so it starts sooner, and it uses less graphics memory once loaded.',
      'A loading screen with a progress bar now shows while the island loads, instead of the island in flat colours changing in front of you. On a slow connection you can skip it and play right away.',
      'New soldier models for everyone. Operators wear blue, guards olive and range dummies orange. Crouching soldiers now kneel with their feet on the ground.',
    ],
  },
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
