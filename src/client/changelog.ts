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
    date: '2026-10-02',
    title: 'Private islands',
    notes: [
      'Share link on the menu now makes a fresh island of your own and takes you there. Only players with its link can join its games, so friends you send it to take the bots\' places beside you and no strangers turn up. Shared from Offline, it opens in Online, since Offline takes nobody.',
      'On a private island the menu says so, and Share link sends that same island again, with your best score on it to beat.',
      'The menu no longer says "Default island".',
    ],
  },
  {
    date: '2026-10-02',
    title: 'The weather turns',
    notes: [
      'The weather changes during a game now. A game opens on a clear day, then clear, rain and fog follow each other at random, never the same twice running: clear for about 5 minutes, rain about 3 and fog about 2, so most runs see the sky turn at least once.',
      'Guards and operator bots see and hear by the weather of the moment: their sight shortens as the fog comes in and lengthens as it lifts, and rain covers footsteps and far-off shots while it falls.',
      'For now the island looks and sounds the new weather all at once, halfway through each change; a gradual change, with warning before it, is coming next.',
      'The menu no longer picks the weather and links no longer carry it: an old link with weather opens its island in whatever the game\'s weather is. The leaderboard no longer shows weather either, and the results show the weather you got out in, or died in. A death cam plays in the weather of the moment you died.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'A snappier weapon switch',
    notes: [
      'Switching weapons sounds right on the draw now: the faint click before the slide is cut, so the sound no longer lags a hair behind.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'Always day',
    notes: [
      'The island is played by day only: dusk and night are gone, and the menu picks just the weather. Soon the weather will turn during a game instead, from clear to rain or fog and back.',
      'With the dark gone, so are the flashlights (no more T), the outposts\' lamps, and night\'s extra, tougher guards and richer crates. The crickets went with the night.',
      'Old links and scores that came from dusk or night still work: they open by day, in their weather.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'No more New island',
    notes: [
      'The menu\'s New island button is gone. Islands will be picked for you: soon Play will put you in the first open game in your time of day and weather, on a freshly made island. Shared links still open their island.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'A truer suppressed rifle',
    notes: [
      'The suppressed rifle sounds like a suppressed automatic now, recorded outdoors, instead of a sniper rifle: shorter, with no long ring after the shot.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'Every side looks its own',
    notes: [
      'Operators are SWAT officers in black with an olive cast, men and women. Guards are soldiers in green camouflage, helmets and loaded vests. Commanders are soldiers in brown camouflage and caps, easy to tell from their guards even far off.',
      'Each side has several faces: two operators, five guards and three commanders, so an outpost\'s guards don\'t all look alike. The same island always dresses its people the same way.',
      'The operators\' pack and bedroll are gone, and so are the commanders\' red helmet band and the radio with its mast: their brown uniforms and caps pick them out.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'Outposts send for help',
    notes: [
      'Clearing an outpost no longer buys you all the time you want: 15 seconds after its last guard falls, a fresh squad sets off from out of sight and runs back to retake it.',
      'Guards are never replaced on the spot any more: every replacement starts well away from the outpost, where no operator is, and you can meet them on their way in.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'Falls that hold together',
    notes: [
      'A body thrown hard or landing face down no longer bends an elbow or knee the wrong way, or turns a foot too far, for a moment as it hits the ground.',
    ],
  },
  {
    date: '2026-10-02',
    title: 'Smoother uniforms',
    notes: [
      'The folds and seams on the soldiers\' uniforms and vests are drawn smoothly, without the blocky patches up close.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Realistic soldiers',
    notes: [
      'Everyone is now a realistic SWAT officer in black, with a helmet, goggles, a balaclava and a loaded vest, in place of the cartoon soldier.',
      'Your own arms in first person are the same officer\'s sleeves and fingerless gloves.',
      'For now every side wears the same uniform: operators still carry a pack, and commanders a red helmet band and a radio. Guards and commanders get uniforms of their own next.',
      'New moves for standing, walking, running, dying and flinching when hit.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Crates, fences and doors with real shape',
    notes: [
      'Crates have battens along their edges and a brace across each side.',
      'Fences are boards nailed between posts, with gaps you can glimpse through.',
      'Doors are panelled, with a handle on each side; tables stand on four legs.',
      'Stairs have treads with a lip, and the outpost lamps a proper sloped housing.',
      'Windows have frames round the glass and a sill standing out from the wall.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Light bouncing round rooms',
    notes: [
      'Light inside buildings bounces off the floor, walls and crates: walls beside a window or a doorway are brighter, deep corners darker, and wooden rooms a little warmer than concrete ones.',
      'Breaking a building open now lets more sky into the rooms of the buildings beside it.',
      'The gun in your hands is lit from the side of the nearest window or doorway, in the colour of the room.',
      'Sunlight falling through a window onto the floor or a wall now lights the room round it, and so does sunny ground outside a doorway.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Fuller reflections',
    notes: [
      "The sea's ripples no longer tear apart what stands at the water's edge: a soldier wading or a tree on the shore mirrors clearly, while the sky and the far island still ripple.",
      'Bushes, tracers, smoke, explosions and flashlight beams now show in the sea.',
      'Windows mirror the sky, more at a glancing angle.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Moving reflections',
    notes: [
      "Soldiers seen only in the sea's reflection, out of sight above the top of the screen, now show there and move.",
      'A thin strip of sea glimpsed between hills now reflects the island too, instead of only the sky.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Climbing like a person',
    notes: [
      'Climbing onto a ledge pulls up until your hips are at it, then a knee goes onto it and you press up and over hunched, standing once on top. It takes as long as before.',
      "Other soldiers' hands stay on the ledge's edge while they press up, and let go as their feet get onto it.",
    ],
  },
  {
    date: '2026-10-01',
    title: 'Magazines that stay',
    notes: [
      "Every soldier's empty magazines fall where they reload, however far off or out of sight, and lie there for the rest of the game.",
      'Magazines land on bodies, guns and each other, fall when a body is cleared away, and are thrown about by grenades.',
      "The rifle's reload ends with the charging handle drawn back and let go, as you hear it.",
      "The pistol's magazine is shaped like one, with a round showing at the top of a full one.",
    ],
  },
  {
    date: '2026-10-01',
    title: 'A real crouched run',
    notes: [
      'Soldiers running crouched bend forward over short, quick strides that keep their feet low, rather than playing the upright run squashed down.',
      'A foot over the edge of a step or crate goes down to the ground rather than standing on air.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Side-on behind the rifle',
    notes: [
      'Soldiers holding a rifle or bolt-action stand side-on behind it, left shoulder forward, and hold it out by the fore-end rather than by the magazine.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Tucked-in crouch',
    notes: [
      "Soldiers crouching still tuck their back foot in under them, rather than leaving it trailing behind where it can't be hit.",
    ],
  },
  {
    date: '2026-10-01',
    title: 'Wet through',
    notes: [
      'Coming in out of the rain, soldiers, bodies and bags stay wet and dry off slowly, rather than the moment they step under a roof.',
      'Floors left open to the rain when a roof comes down gather puddles.',
      'Floors inside far buildings stay dry right up to the walls.',
      'Wet grass looks soaked and deep green rather than greyish.',
      "Soldiers' guns and dropped magazines stay wet indoors too, and so does the rubble of a broken roof.",
      'Wet trees and bushes look soaked rather than greyish.',
      'The gun and sleeves in your hands get wet in the rain too, and dry off slowly indoors.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Faster first load',
    notes: [
      'The first time you open the game, or after an update, it loads in about half the time it did.',
      'Switching the menu to dusk or night no longer freezes the game for a few seconds.',
      'The first game after loading no longer freezes as it starts, nor does the first window you break.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Walls hold back every light',
    notes: [
      'With many lamps and flashlights about, the farther ones no longer shine through walls.',
      'Far lights fade gently in and out as you move, rather than switching on and off.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Lamplight in your hands',
    notes: [
      "The outposts' lamps and other people's flashlights now light the gun in your hands, unless a wall is in the way.",
    ],
  },
  {
    date: '2026-09-30',
    title: 'Solid corners',
    notes: [
      'Sunlight no longer shows through a building in a thin line where two walls meet inside.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Real-looking trees and grass',
    notes: [
      'The trees are now spruces grown limb by limb, thick with sprays of needles and dark inside the crown, instead of cones hung with flat branches. They keep their shape from up close out to the horizon.',
      'Grass near you is made of single blades swaying in the wind, turning into the old tufts a dozen metres off.',
      'Grass hides you from guards and bots exactly as before, and the trees stand where they did.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Rivals with something to lose',
    notes: [
      'Bot operators carrying any real loot stop picking fights. They let you pass unless you come right up to them or shoot first, and then they fight back as before. Hunters are the exception: they still come for you.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'More ways out',
    notes: [
      'Every island now has six extraction points, one for each outpost, instead of four. The four you know are where they were.',
      'Each extraction point has low walls and boulders around it to crouch behind while you wait.',
      'Guards are slower to swing their aim onto you, slower to steady it and less accurate at first. Walking into their sight is still a fight, but you have a moment longer to answer it.',
      'Every island has changed, so best scores set before were set on slightly different ground.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Cover on the approaches',
    notes: [
      'The ground round every outpost, from about 45 to 130 m out, has more to hide behind: clusters of boulders you can crouch behind, far more bushes and grass grown up to waist height. Guards and bots see through it no better than you do.',
      'Every island’s outskirts have changed, so best scores set before were set on slightly different ground.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Smarter rivals',
    notes: [
      'Bot operators live longer. Shot at by guards, or by two people at once, they duck out of sight straight away and get well clear, rather than trading shots in the open. If their cover doesn’t hide them, they fight back from it instead of waiting there to be shot.',
      'Bot operators keep low for a while after spotting a guard, and one heading out with enough to pay for a pickup leaves you alone unless you start it (hunters excepted).',
      'Sneaking bots keep to bushes and tall grass where they can, and a rat that hears a fight nearby goes to ground until it’s over.',
      'A camper only waits where it can see into the extraction point. If there’s nowhere like that, it doesn’t camp.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Sound through the floors',
    notes: [
      'A shot upstairs is heard coming down the stairs, not muffled through the floor, and a fight on the ground is heard up the stairwell. Sound finds its way over roofs, off watchtowers and out of upstairs windows too.',
      'Once a window’s glass is broken, sound comes round through it as through an open door.',
      'Indoors, a fight well past 50 m away is heard coming in through the doorway it would reach you by.',
      'A sound’s echo comes back from its own side: a door slammed on your right rings on your right. Standing under the eaves or an overhang no longer sounds like being indoors.',
      'Reloads sound like real guns: the rifle’s and pistol’s magazines come out and go in, and the pistol’s slide is racked, each as the hands do it. Switching guns mid-reload cuts its sounds short.',
      'The game loads faster: the wind, sea, birds, rain and crickets load behind the menu and fade in, rather than holding up the loading screen.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Lamps, lights and the wet',
    notes: [
      'The outposts’ lamps and other people’s flashlights cast shadows: a wall between you and a lamp keeps you in the dark, and someone standing under a lamp throws a shadow. Every lamp in an outpost lights the ground now, not only the few nearest you, and so does every flashlight in view.',
      'Other people’s flashlight beams light up the rain they shine through, as yours does.',
      'A lamp lights up only the ground its light falls on, a cone in front of it, not a ring all round it. Guards see you plainly only in that cone, and not behind a wall or a crate that shades you from it.',
      'At night, bot operators keep to the dark round an outpost’s lamps, and shoot out a lamp that lights a crate they mean to search.',
      'Trees, grass, bushes, soldiers, dropped bags and debris get wet in the rain. Puddles gather in hollows and on level ground, where water would, and ripple in the rain. Floors under a roof stay dry however far off they are.',
      'Rooms facing a hill or a stand of trees are darker than rooms facing open sky, every building is lit inside as it should be, however far off, and floors indoors are no longer brighter than the walls round them.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Guns held properly',
    notes: [
      'Soldiers hold their pistol with both hands round the grip, rather than reaching for it just short of it.',
      'A rifle’s stock rests against the front of the shoulder instead of passing through the chest. Soldiers with a long gun hold it further forward, their left hand nearer the magazine.',
      'Crouching soldiers keep a natural hunch, sitting back on their heels, instead of arching their back with their head hanging forward. Standing soldiers no longer lean back.',
      'Soldiers moving crouched keep their feet low, instead of kicking a foot up behind them as high as their hips.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'The range is back',
    notes: [
      'Pick Range on the menu to try things out round the island’s first outpost. Soldiers there go through every move over and over: walking, running, sprinting and sneaking in circles, crouching, leaning, jumping, aiming, shooting and reloading each gun, throwing grenades, shining a light, climbing the watchtower, climbing onto a crate and going through a door.',
      'Some of them are shot now and then, from the front, from behind, from the side and while running, and a knot of three is blown up by a grenade, so you can watch them fall. They get up again a few seconds later.',
      'Nothing can hurt you on the range, the clock stands still, and nothing there counts toward your scores.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Upstairs and through the doors',
    notes: [
      'Guards and operators take the stairs: they come up to the upper floor of a two-storey building after you, and climb the watchtowers.',
      'One of the two crates in a two-storey building is now upstairs.',
      'Every part of a building can break: the corner posts, the floors, the stairs and the tables. Knock out the four posts of a two-storey building and its whole upper storey comes down.',
      'Doors swing open the moment you press F, and a door stops you while it swings, not only once it’s shut.',
      'A door someone is standing in the way of tells you so.',
      'Bots shut doors behind them now and then, and one running from you may slam a door in your face.',
      'Guards no longer go to look every time another guard opens a door.',
      'The watchtowers are built of posts, cross braces, a plank deck, a boarded parapet and proper stairs, and the shipping containers have ribbed steel walls and doors with locking bars.',
      'The ceilings inside buildings are plain, without the bright stripes across them.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Bodies that stay down',
    notes: [
      'Bodies fall against soldiers standing near instead of through them.',
      'Knees and elbows no longer bend the wrong way, and feet turn at the ankle.',
      'A grenade throws bodies and guns already lying near it.',
      'A soldier killed out of sight lets go of the gun.',
      'A fallen operator’s body stays for about half a minute after they are back in the game, instead of vanishing after 5 seconds.',
      'The death cam shows every body falling exactly as it did, even two landing on each other.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Hands on the gun',
    notes: [
      'Reloads move the gun’s parts: magazines slide out and fall to the ground, where they lie for a while, fresh ones go in from the hand, the pistol’s slide is racked, and the bolt-action’s bolt is lifted and drawn back.',
      'The bolt-action’s reload thumbs in as many rounds as it needs, one by one, so topping up one round is quick to watch.',
      'Your own arms in first person have a more natural elbow, and your sleeves reach your gloves.',
      'Soldiers stand with their feet on the ground on slopes and steps, and roll their ankles to fit.',
      'A hit knocks a soldier the way the round went: back from the front, forward from behind, turned from the side, and down at the knees when struck in the legs.',
      'Each gun kicks the shooter its own way, the bolt-action hardest, and the pistol’s slide jumps with each shot.',
      'Soldiers sneaking fast run low and bent over instead of scurrying.',
      'Climbing onto a ledge now shows a hand on the edge and a knee coming up onto it.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Soldiers in the shade',
    notes: [
      'Soldiers are cheaper to draw, so crowds and firefights run smoother.',
      'Soldiers now darken in the shade of trees, walls and rocks out in the open, not only in and around buildings, so someone standing under a tree is harder to spot.',
      'Soldiers cast shadows out to 230 m, up from 60 m, and a soldier just out of view can give themselves away by their shadow.',
      'The sea mirrors soldiers, bags and debris as well as the island.',
      'Far-off shadows follow doors as they open and shut.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Chrome first',
    notes: [
      'The game is made and tested in Chrome for now; Firefox and Safari will be checked again before release.',
      'Sounds now come in one format only, so Safari needs macOS 15.4 or later to play them.',
    ],
  },
  {
    date: '2026-09-28',
    title: 'Replays removed',
    notes: [
      'Replays are gone: the results no longer offer Watch replay or Save replay, the menu has no Replays list, and replay files can’t be opened. Replays kept in your browser are cleared.',
      'The death cam stays: you still see how you died through your killer’s eyes, and can watch it again from the results.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Pickups cost, contracts pay',
    notes: [
      'Guards have half the health they had: two rounds from the rifle to the body drop one.',
      'Getting off the island now costs $2,000, paid from the loot you carry. Until you carry that much you can’t call a pickup or leave from a beach; your pack shows how close you are.',
      'Contracts pay five times as much: $7,500 for the intel, $6,000 for a supply cache and $12,500 for a commander.',
      'Other operators know about the fee too, so they stay out looting longer.',
      'Your run stats now remember how far off your killer was and how many enemies had been hitting you, for the stats you export.',
      'A guard you killed no longer comes back at its post while you’re near it or can see it, so taking out a sentry and then climbing its tower for the intel is safe from a guard appearing next to you.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Guards shoot less well',
    notes: [
      'Guards no longer aim for your head, sway more on a far target, take a moment longer to open fire and fire shorter bursts, so running into two or three of them at once is no longer over in a second.',
      'A guard’s round in the head still hurts, but no longer takes most of your health: one head hit and one more no longer kill you. Other operators shoot exactly as before.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'More natural grass',
    notes: [
      'Grass now grows out of the ground it stands on, taking the earth’s colour at its roots, and fields vary in patches of drier and greener grass.',
      'Tufts are shaded like clumps, glow when the sun is behind them, and have softer edges.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Lamps in the outposts',
    notes: [
      'Every outpost has lamps on poles along its walls. At dusk and at night they light the yard, and you can see an outpost’s lamps glowing from across the island.',
      'Anyone standing in lamplight is as easy to spot as by day, for guards, other operators and you alike. Keep to the shadows, or shoot a lamp out: one hit puts it out, with a crash of glass the guards may hear, for a few minutes until it’s fixed.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Wet ground',
    notes: [
      'In the rain, the ground no longer shines like polished metal. Soaked earth turns darker and richer, with only a faint sheen on the flattest spots; puddles still mirror the sky.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Frame rate and replay shots',
    notes: [
      'The key hints in the top left corner now start with your frame rate.',
      'Watching a replay with the free camera, the player’s shots now come from their gun, not from the camera, and sound from where they fired.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Know your rivals',
    notes: [
      'Killed by another operator, you’re told what kind of rival they were, a rat, hunter, camper or looter, and what that kind does: in the death cam, as you fall and on the results.',
      'Once an operator dies, the kill feed says what kind they were, and so does the tag on the bag they leave.',
      'Other operators get out more often. They break off from guards shooting at them from far off rather than trading shots, give up crates a guard has them pinned at, head out once badly hurt, and would rather leave by an extraction point away from the outposts.',
      'Stats on the menu sums up every run you’ve played in this browser: how often you get out, how long runs last, what kills you. Export your runs to send them as a file.',
      'Sharing a link opens your system’s share sheet where there is one, with your score to beat in the message. Elsewhere it’s copied as before.',
      'Old PvE scores, no longer shown anywhere, are cleared from your browser.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Replays you can keep',
    notes: [
      'Your last 5 runs are kept in your browser. Open Replays on the menu to watch one again or save it as a file, even days later.',
      'Replays show everyone exactly as they were, every guard and operator, not just you: the whole game is played again from what everyone did.',
      'Replay files are about half the size they were. Replays saved before this update can’t be opened any more.',
      'A replay from another island opens that island straight away, with no reload. So does New island.',
      'Jumping about a replay brings back the kill feed and the hit numbers as they stood then. The feed fades on the replay’s clock, so pausing holds it.',
      'A friend watching your replay sees your name in the feed, where you see “You”.',
      'The free camera stops at walls, rocks and trees instead of flying through them.',
      'In Offline, the game waits while you watch your replay from the results.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Hiding in the grass',
    notes: [
      'Grass hides you tuft by tuft, exactly as you see it: a lone tuft hides a little, a thick patch hides a lot, and a bare gap in a field hides nothing. Someone crouched inside a big bush can see out, but can’t be seen in.',
      'Guards and other operators take cover in bushes too, and operators settle into them to watch a fight or camp an extraction point. Check the big bushes.',
      'Campers keep looking for a spot that can see their extraction point, rather than settling for one that can’t.',
      'Operators only go for a bag they have seen, and know what it’s worth only by reading its tag as you do. Bag tags no longer show through bushes and grass.',
      'Operators drawn to a far fight head for a guess of where the shots came from, not the shooter’s exact spot, and watch from short of it.',
      'Only other operators hunt the bounty harder, and only once they’ve been told who carries it. Guards don’t care who carries what.',
      'Killed by your own grenade, you get a death cam of it, through your own eyes.',
    ],
  },
  {
    date: '2026-09-27',
    title: 'Hearing round corners',
    notes: [
      'Sound finds its way round walls: a shot inside a house is heard from its open door, and seems to come from there, while a shut door or a solid wall muffles it far more. Doors open and shut with a real latch and slam.',
      'What stands between you and a sound matters by what it is: a tree trunk barely dulls it, a fence or a door a little, glass more, and a brick wall or a hill a lot. A sound inside a building no longer carries out over its roof.',
      'Rooms, walled yards and the open each sound different: a close, quick ring indoors, sharp echoes off yard walls, and a faint, long wash out in the country.',
      'A long firefight far across the island rumbles on as a distant battle without drowning out the steps and shots close to you.',
      'Suppressed shots are real recordings, a different one for each gun. The bolt-action has a new shot, and reloads by working its bolt and pressing in rounds. Concrete has its own footsteps, and breaking glass sounds like glass.',
      'The sea is always heard from the water, even on a narrow point with sea on both sides.',
      'In replays, jumping to a moment brings in what was still sounding then, and at 2× and 4× the sounds no longer pile on top of each other.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'Storms and flashlights',
    notes: [
      'Every gun carries a flashlight you can see on it, and its beam comes from there. Your own light now casts shadows, so it no longer lights the far side of a wall. Up to four other people’s lights light the ground round you, where only two did.',
      'Guards and other operators notice the patch your beam lights on the ground or a wall, even when they can’t see you, and come looking where it came from. Keep it low, or off, near an outpost.',
      'In a death cam, you see by your killer’s flashlight if they had it on.',
      'Rain stays outdoors: none falls under a roof, and floors under one stay dry. Outside, the rain splashes where it lands, the ground and walls turn dark and shiny, and puddles gather on flat ground. Streaks are thicker, and drops glint in your flashlight’s beam.',
      'Storms bring lightning that lights up the sky, and thunder that rolls in after it: sooner and louder the nearer the strike.',
      'The rain drowns out far-off sounds for you too, not only for bots: distant shots, steps and doors are quieter and duller in the rain.',
      'Fog lies thicker on low ground and by the sea, in banks deeper in some places than others, so a hilltop can rise clear of it.',
      'At dusk and at night, shiny things and puddles reflect the sky as it is, dark with the moon in it, instead of a faint daytime sky. Stars no longer show through rain clouds or fog.',
      'Your best scores show the time of day and weather each was set in. Sharing your best sends it in the conditions it was set in.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'The island from afar',
    notes: [
      'The sea mirrors the island: hills, trees and buildings show in the water, rippled by the waves, and most strongly when you look across it at a low angle.',
      'Long swells roll in from far out to sea, and the distant water no longer shimmers in rings.',
      'Distant trees look like the trees near you, from whichever side you see them, lit by the sun the same way, and swaying in the wind. They dissolve into the full trees as you walk closer instead of popping in a patch at a time, and the shadows of nearby trees sway too.',
      'Hills, trees and buildings far across the island cast shadows again, where before shadows stopped a couple of hundred metres out.',
      'Trees, rocks and buildings far away no longer float a little above the ground or sink into it.',
      'Bushes in the distance are green instead of a blue-grey smudge.',
      'Under water, everything sounds muffled and the view sways, and the water stays murky even if the light changes while you’re under.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'Doors, glass and new buildings',
    notes: [
      'Doorways have doors. Press F facing one to open or shut it, and anyone nearby hears it. Guards and other operators open doors on their way through. A door can be shot or blown off its hinges, and it won’t shut on someone standing in the doorway.',
      'Windows are glazed. You can see through the glass, but not walk or climb through it until it’s broken, and any shot or blast smashes it. A round goes through a pane and on to whatever is behind it.',
      'Roofs can come down: each section falls once every wall and post under it has been blown out.',
      'Outposts no longer all have the same building. There are one-room huts, two-room houses, L-shaped buildings round a small yard, and two-storey buildings with stairs up to a lookout with a window on every side. The first four outposts on an island each get a different one.',
      'Small huts stand out in the country too, each with a crate inside.',
      'Rooms are lit by what comes in through their doors, windows and any holes blown in them: brighter by a window or an open door, darker in the far corners, and lighter once a wall or the roof is gone. Soldiers, debris and the gun in your hands are lit the same way.',
      'A yard with walls round it but open sky above no longer echoes like a closed room.',
      'Inside the outposts, the containers and crates have moved round the new buildings; the rest of each island is as it was. Replays saved before this update can’t be watched any more.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'Bodies that fall',
    notes: [
      'Soldiers who die now go limp partway through falling and drop like real bodies: against walls, down slopes, over crates and on top of each other, without passing through them. A steep slope sends a body sliding.',
      'The round that kills someone shoves them the way it was going, and a grenade throws them.',
      'Every dead soldier drops their gun, even if they died out of sight, and it tumbles and comes to rest on the ground.',
      'Replays and the death cam show every body falling exactly as it fell in the game, and skipping about a replay leaves the dead lying where they fell instead of falling again. Replays saved before this update show bodies falling a little differently.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'Soldiers that move like soldiers',
    notes: [
      'Other soldiers crouch-walk, jump, fall and land with real animations instead of stiff poses, and their feet stay planted instead of sliding as they walk and run.',
      'They flinch when hit, snapping the head back from a headshot, and every shot kicks the gun and shoulders.',
      'Each gun reloads its own way, in your hands and in theirs: the rifle swaps its magazine, the pistol drops a small one, takes a fresh one from the belt and racks the slide, and the bolt-action opens its bolt and thumbs rounds in one by one. The bolt-action’s bolt is also worked after every shot.',
      'Hands grip each gun where its grip and fore-end really are, and the pistol is a little bigger in the hand.',
      'Your arms in first person are no longer drawn oversized to reach the gun: they are the soldier’s own, just long enough. Aiming the pistol, you hold it out at arm’s length with both arms reaching straight to it and the left hand wrapped round the right, and the wrists no longer bend back on themselves or twist thin.',
      'Grenades look like grenades, in the hand and in the air.',
      'A crouching or leaning soldier’s head is now exactly where it can be hit. Distant soldiers move more smoothly.',
    ],
  },
  {
    date: '2026-09-26',
    title: 'Quicker to load, sound from the first shot',
    notes: [
      'The game downloads about a fifth less before the menu shows, and its sounds are little more than half the size in browsers that play Opus (Chrome, Firefox, and Safari where it can).',
      'Your own gun, your footsteps and the sounds of the island load before the menu shows, so the first shot of a run is heard. Everyone else’s sounds follow behind the menu.',
      'The loading bar now counts everything it waits for, by size, from the first moment, instead of sitting empty while the game’s code downloads.',
      'If you play before the textures are in, they fade in when they arrive instead of the island swapping at once.',
      'Clicking to resume just after Esc: your browser holds on to the mouse for a moment after Esc, and the pause card now says so and resumes as soon as it lets go, or asks you to click again.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Sounds on time in Firefox',
    notes: [
      'In Firefox every recorded sound played about a twentieth of a second late and lost as much off its end. Shots, footsteps and reloads now play on time there, as they already did in Chrome and Safari.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Rivals',
    notes: [
      'The other operators each play their own way. Rats sneak about, loot and keep out of fights. Hunters follow gunfire to finish off whoever is left, and go after the wounded. Campers wait near an extraction point for whoever comes to leave. Looters raid the outposts’ crates and pick over the bags fights leave behind.',
      'Gunfire draws operators in: a fight between two others brings a third to see who is left, watching from a distance, and a fight at an outpost is watched from outside it.',
      'The bounty: whoever carries the most loot, at least $3,000, carries the bounty. Everyone is told who, and every 20 seconds roughly where they are, shown by a marker for a few seconds. They are also spotted and heard more easily, and other operators pick fights with them from farther away. The line under the clock says who has it, or that you do.',
      'Bags on the ground show what they hold from up to 40 m away, when you can see them. The kill feed marks the bounty being killed.',
    ],
  },
  {
    date: '2026-09-25',
    title: 'Replays',
    notes: [
      'Every run is recorded. When it ends, Watch replay plays the whole run back through your own eyes, exactly as you played it, with your HUD.',
      'Save replay downloads the run as a small file (under 1 MB even for a full ten minutes). Send it to a friend: Watch a replay on the main menu, or dropping the file on the menu, opens it on the right island in the right conditions.',
      'In a replay: pause with Space, drag the timeline or skip 5 seconds with the arrow keys, and play it from quarter speed to four times as fast. Kills and how the run ended are marked on the timeline.',
      'Press V, drag the view or start moving for a free camera: WASD to fly, Q and E down and up, Shift to go faster, and you can watch yourself from outside.',
      'Walls and crates break and are rebuilt in replays at the moment they did, so what you see matches what happened. The death cam does the same, instead of showing the walls as they are now.',
      'The death cam shows your killer’s health and ammo, and a hit marker whenever one of their rounds hits.',
    ],
  },
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
