# onepointsix — Game Plan

A realistic, browser-based **extraction shooter** on shareable islands. Click a link and you're
playing in seconds: no install, no account. Written fully in TypeScript.

## Vision

- **Genre:** extraction shooter with 3–10 minute runs.
- **Tone:** grounded realistic, with PBR materials and real-world weapons feel. Think Arma
  Reforger at low settings, not photoreal.
- **Instant access:** open the page, press **Play**, and you're in. No account; identity is an
  anonymous token.
- **Default world:** there is always a default island. **Play** drops you into the first game on
  it that isn't full.
- **Shareable worlds:** a world is fully described by its config (seed and settings), so a link
  *is* the world. "Beat my score on this island."
- **Fresh start every run:** no persistent progression. Each run is scored on its own.
- **Local first:** the game runs entirely in the browser with no backend. Multiplayer is a future
  feature, but the architecture is ready for it from day one.

## Entry Flow

1. Load the page and see the main menu with a **Play** button. The default world renders behind
   it.
2. **Play** starts a quick join into the first game on the default world that isn't full.
   - **Now (local):** there is only one local game, so it starts immediately.
   - **Future (multiplayer):** matchmaking picks the first instance with a free slot and creates a
     new instance if all are full.
3. A world link (`?world=...`) skips the default world and joins that world instead.

## Game Modes

| Mode | Description |
|---|---|
| **Online** | 8 operator slots, every one starting as a bot. Each player who joins takes a bot's slot, and a bot fills it again when they leave. Until there is a multiplayer server, the game runs locally and nobody else can join. |
| **Offline** | Plays the same way as Online, but the other 7 operators are always bots and nobody else joins. |

Mixed was renamed Online, and old `mode=mixed` links and scores count as Online. PvE and the
shooting range were removed after chunk 16: PvE became Offline, which has 7 bot operators, and the
range with its target dummies is gone. Every game is a run.

### World capacity

The island is 800 × 800 m, with 6 outposts.

| Kind | Count | Notes |
|---|---|---|
| **Operators** (players and fill bots) | **8** per game | Every slot starts as a bot. Online: joining players replace them. Offline: only you and bots. |
| **Guards** (world AI) | ~24 | About 3 per outpost, plus patrols. Present in both modes. |

**Why 8:** that's roughly 80,000 m² per operator, which is about a 280 m square each. Runs are
3–10 minutes, and the aim is to meet another operator every 1–3 minutes, while guards fill the
time in between. The plan started at 12, but chunk 12's bot playtest found that at 12 an operator
spotted another every 42 s, 8 every 57 s and 6 every 97 s, so 8 is the middle ground until human
playtests say otherwise. The cap is a single constant (`OPERATOR_CAPACITY`).

## Core Loop

1. **Drop in** at any time at an insertion point on the island. Your personal run clock starts.
2. **Receive contracts.** You get 1–2 objectives per run, for example: grab intel from the radio
   tower, destroy a supply cache, eliminate a bot commander.
3. **Loot, fight, sneak.** Search containers, fight AI patrols (and players in Mixed mode), and
   manage noise and weight.
4. **Extract.** Reach an extraction point that is currently open. Some extraction points need you
   to call and hold for about 20 seconds while bots converge on you.
5. **Score.** The extracted loot value, kills and completed contracts make your run score. It
   goes on the world's leaderboard.
   - **Die = score 0.**
   - **Run clock hits 10:00 = MIA = score 0.**

## Features & Design Pillars

### Movement (grounded, no grapple)
- Sprint with stamina, crouch, jump
- Mantle over walls and crates
- Lean left and right (Q/E), which pairs with destructible cover
- **Carry weight.** Heavy loot slows you down and disables mantling, so loot and movement
  work against each other.

### Gunplay
- **Proof of concept roster (3 weapons):**
  - **Assault rifle:** all-rounder, full-auto
  - **Pistol:** sidearm, always carried
  - **Bolt-action rifle:** long range for the open island, high damage, slow
- Hitscan with recoil patterns, spread (depending on movement and stance) and hitboxes (headshots)
- Ammo and reloading, suppressors as loot
- Grenades

### Destructible cover
- Walls, fences and crates are built from a few **breakable panels**, each with its own HP. No
  voxels.
- Breaking a panel is a small network event ("panel 812 broke"), so it's cheap to sync.
- Debris and collision update in real time.

### Noise system
- Gunfire, explosions, sprinting and breaking cover make noise events that bots hear and
  investigate.
- You choose between stealth and going loud. Suppressors reduce the noise radius.

### Extraction pressure
- A personal run clock for each player, which fits drop-in play
- Extraction points open and close at random
- Call-and-hold extractions draw in bots

### Bots (AI operators)
- They send the **same input commands as players**, so bot fill in Mixed mode comes for free.
- States: patrol, investigate, engage, take cover, flank
- Perception through sight and hearing (the noise system)
- Difficulty levels, and special "commander" bots used as contract targets
- Operator bot personalities (chunk 18): the rat, hunter, camper and looter, each with its own
  numbers in `src/server/personality.ts`
- The bounty (chunk 18): the operator carrying the most loot is called out to everyone

### Shareable worlds and leaderboards
- The world config (seed, time of day and weather) is encoded in the URL.
- Each island has its own leaderboard, shared by every time of day and weather: stored locally
  first, on the server once there is multiplayer.
- A share button on the results screen.

### Replays (cheap because the simulation is deterministic)
- The simulation runs on inputs, so a run can be recorded as its inputs.
- Death cam first, then whole runs saved as replay files (chunk 17); shareable replay links later.

## Technical Architecture

**Stack:** TypeScript, Vite, Three.js (client), Web Worker (local game server). No backend for
now. In future multiplayer, the same server code runs in Node.

```
src/
  shared/   deterministic simulation: world gen, collision, movement, weapons, protocol types
  server/   authoritative game server: tick loop, bots, loot, contracts, extraction, scoring
  client/   rendering, input, prediction/reconciliation, interpolation, HUD, audio
```

### Rules that keep multiplayer easy to add later
1. **Server-authoritative from day one.** The server runs in a **Web Worker**. Only serializable
   messages cross the worker boundary, which acts as the network. Later the same server code runs
   in Node unchanged.
2. **Shared simulation.** Movement, weapons and collision are identical on client and server. The
   client predicts; the server corrects.
3. **Bots are just players without a keyboard.** They produce input commands the same way players
   do.
4. **The local transport can simulate lag and packet loss,** so netcode bugs show up while
   playing offline.
5. **A world is its config.** Only the seed and settings travel over the network; every peer
   generates the same world.
6. **Fixed-timestep, deterministic simulation.** This makes prediction, lag compensation and
   replays possible.

### Assets
- Poly Haven for PBR textures and HDRIs, Quaternius for animated characters and guns, glTF for
  models
- Budget for small downloads: KTX2 textures, meshopt-compressed glTF and level of detail (LOD)

## Implementation Roadmap

Each chunk ends in something you can play or test. **Chunks 0–6 are the proof of concept.**
Everything runs locally in the browser; there is no backend. The **Status** column says whether
a chunk is **Done** (committed), **Partly done** (committed, with part of its goal waiting on
something outside the code) or **Not started**.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 0 | **Foundations** | Vite + TS setup, `shared/server/client` layout, local server in a Worker, message protocol types, fixed tick loop, fake-lag/loss toggle | A box moves when you press keys, driven by the server | **Done** |
| 1 | **World and menu** | Seeded island terrain, outposts, props, trees and rocks; renderer, sky, fog; collision; **default world**; main menu with **Play** over the rendered island; `?world=` param | Load the page, press Play, and you're on the default island; the same seed gives the same island | **Done** |
| 2 | **Movement** | Pointer lock, CS-like movement, sprint, crouch, jump; client prediction and reconciliation against the Worker server | Movement feels tight even with 100 ms fake lag | **Done** |
| 3 | **Advanced movement** | Slide, mantle, lean, stamina, carry-weight hooks | You can mantle a crate and slide into cover | **Done** (the slide was removed after chunk 14) |
| 4 | **Gunplay** | The 3 weapons (assault rifle, pistol, bolt-action), weapon switching, hitscan, recoil and spread, hitboxes, ammo and reload, damage and death, HUD, hit markers; lag-compensation scaffolding | You can shoot target dummies with a satisfying feel | **Done** |
| 5 | **Bots** | Navigation grid, perception (sight and hearing), state machine (patrol, investigate, engage, cover, flank), difficulty levels; **guards** at outposts and **fill-bot operators** that play runs like a player | Guards defend outposts; operator bots loot and extract | **Done** |
| 6 | **Run loop** | Quick join through the local "game directory" (first game not full, capped at 12 operators), PvE and Mixed modes, drop-in insertion, run clock and MIA, loot containers, inventory and weight, extraction points opening and closing, call-and-hold extraction, results screen and score | **The full PvE and Mixed loop is playable. First real playtest.** | **Done** |
| 7 | **Destructible cover** | Panel-based walls, fences and crates with HP, debris, collision updates, destruction events, grenades | You can blow a hole in a wall and shoot through it | **Done** |
| 8 | **Contracts and noise** | Objectives per run (intel, cache, commander), noise events that attract bots, suppressors | Runs feel different from each other | **Done** |
| 9 | **Look and sound** | Realistic assets (glTF, PBR, animations), positional audio, footsteps, muzzle flash, performance pass | It looks and sounds like a real game | **Done** |
| 10 | **Shareable worlds** | World config and sharer name + score in the URL, per-world local leaderboard, share button, static hosting, death cam from recorded inputs | You send a link and a friend gets the same island with your score to beat | **Done** |

### Phase 2: polish and depth (still local only)

Chunks 11–18 finish the single-browser game. Multiplayer stays in **Future**, and none of these
chunks may break the rules that keep multiplayer easy to add later. Each chunk also resolves
the Known Issues named in its scope.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 11 | **Ship and load** | Verify GitHub Pages end to end (the live site, share links, `?world=`); a loading screen with progress instead of the flat-colour swap; KTX2 textures and meshopt glTF; code splitting so the first bundle is under 500 kB; build the texture arrays off the main thread (`createImageBitmap` / a Worker); replace the Mixamo soldier with a CC0 character (e.g. Quaternius); generate the texture layer list from one source | A stranger opens the live link on a mid-range laptop and is playing within about 5 s on a warm cache; no licensing doubts left | **Done** |
| 12 | **Playtest and tuning** | A local run-stats log (length, cause of death, extraction used, contracts done, loot value) with a debug panel to read it; tune the operator cap, guard count, bot difficulty, weapon damage and recoil, extraction timings and loot values from playtests; fix what playtests find; mode-less links; the menu at small window sizes | Several full runs by other people; the average run lands in 3–10 minutes, and no single strategy dominates | **Partly done**: the run log, bot playtest, bot and cap tuning, mode-less links and small-window menu are in; runs by other people haven't happened yet |
| 13 | **Animation** | Death animation with a simple ragdoll that doesn't sink into ground or walls; third-person crouch-walk, slide, mantle, jump and fall clips; third-person reload, weapon switch and grenade throw; suppressors on third-person guns; first-person arms with animated reloads; a distinct look for commanders and each side; hit flash only where the round landed; the body lean matches the lean hitbox | Watching another operator, you can tell what they are doing: crouching, sliding, reloading, throwing | **Done** |
| 14 | **Sound** | Recorded CC0 samples replace synthesized ones (a new source, e.g. Freesound CC0, checked per file); occlusion and simple reverb from walls and buildings; ambient wind, sea, birds and distant fighting; footstep surfaces read from the painted terrain; a sliding scrape; pooled panner nodes | With eyes closed you can tell the direction, distance and whether a wall is in between | **Done** |
| 15 | **World detail** | Buildings with doors, windows and simple interiors built from breakable panels; ground cover (grass, bushes, small rocks) near the player; tree LOD, impostors and sway; water with waves, shoreline foam and an underwater effect; debris textured like its panel; cascaded shadows; terrain LOD; adaptive resolution checked on slow hardware | Outposts can be fought through room by room, and the island looks alive at 60 fps on a mid-range laptop | **Done** (60 fps checked on an M3 Pro only, and slow hardware only simulated) |
| 16 | **Day/night and weather** | Time of day and weather become part of the world config (and so the link); lighting, sky and fog follow them; night brings more and tougher guards but better loot; flashlights (visible to bots, so a noise-like trade-off); rain and fog shorten sight and mask noise in bot perception; leaderboards stay universal, one per island and mode whatever the conditions (changed from "per condition" at the user's request) | The same island plays differently at noon, at night and in fog, and a link reproduces the exact conditions | **Done** |
| 17 | **Full-run replays** | Record the whole run as inputs plus periodic keyframes (extending the death cam tape); keep cover-state history so replays show panels breaking at the right time; a replay viewer with scrubbing, speed control and a free camera; export and import a compact replay file (no backend, so it's shared as a file); a HUD in the death cam | You finish a run, save the replay, send the file, and a friend watches it exactly as it happened | **Done** (the Save and Watch buttons after a real run were checked in the browser with a simulated run end only) |
| 18 | **Rivals** | Operator bot personalities: the *rat* (sneaks, loots, avoids fights), the *hunter* (follows gunfire to find wounded operators), the *camper* (waits near extraction points) and the *looter* (goes for high-value crates); third-partying, so operators are drawn to fights between others; a bounty on the operator carrying the most value, who is marked or heard more easily; a kill feed; bags left by bodies show their value before you open them. Personalities carry over as fill bots in future multiplayer | In Mixed mode, meeting another operator plays out differently depending on who they are, and a big haul makes you feel hunted | **Done** (checked by bot playtests and a headless screenshot with a faked bounty; nobody has played against the personalities yet) |

### Phase 3: clearing the Known Issues (still local only)

Chunks 19–30 work through the open Known Issues. The same rules apply: no backend, and nothing
may break the rules that keep multiplayer easy to add later. Each chunk resolves the Known Issues
named in its scope and marks them **Resolved** (or **Resolved in part**, saying what's left). The
browser tests come first so every later chunk can be checked by more than a screenshot, and the
human pass comes last so people play the finished result.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 19 | **Browser tests and benchmarks** | A browser test runner in the repo (Playwright: Chromium, Firefox and WebKit) with a dev-only hook to end a run on demand; tests for the menu, leaderboard UI, share button, loading screen, death cam and its HUD, replay viewer, file picker and dropped files, handover between islands, rivals HUD (bounty, "you carry the bounty", feed rows) and the results buttons; screenshot comparisons for the water, ground cover, impostors, cascades, indoor light and the pose viewer's poses; AAC offsets checked in Firefox and WebKit; a frame-time benchmark with many near bodies (posing, IK, fingers) and the ground cover's rebuild; the pose viewer run by the tests | `npm run test:browser` covers every UI named in Code and testing, runs in all three engines, and prints a frame-cost report | **Done** (93 tests in about 3 minutes on an M3 Pro; the screenshots are Chromium's only, and the tests don't run in CI) |
| 20 | **Lean loading and portable tooling** | Sounds on the loading bar (the ambience and your own gun before Play, the rest after); the loading bar counts the script download and uncompressed sizes; skipping the loading screen fades the assets in instead of swapping; the entry chunk split so ground cover, impostors, replays and the death cam load lazily; a smaller Basis transcoder (an ETC1S-only build) or a measured case against it; KTX2 and the prefiltered sky compared to the originals by number, not only by eye; smaller sounds (Opus where supported, AAC fallback); the sound and asset scripts run on Linux and Intel Macs (ffmpeg instead of `afconvert`, any-platform KTX tools); a click soon after Esc resumes at once or says why it can't | Total JavaScript at start is down by a measured amount, the first sound plays with the first shot, and both scripts run in CI on Linux | **Done** (JavaScript and wasm before the menu down from 1,550 kB to 1,227 kB, 544 kB to 396 kB gzipped, almost all of it the transcoder; the scripts' CI job was only run in a Linux container, since it isn't pushed yet) |
| 21 | **Animation clips and hands** | Real clips from a CC0 animation library (e.g. Quaternius's Universal Animation Library) retargeted to the soldier: crouch-walk, jump, fall, climb, shooting and hit reactions; walk and run speeds measured from the clips' foot contacts, with foot locking; a reload per gun (the bolt-action works its bolt and loads rounds, the pistol swaps a small magazine); a grenade model; hand grips placed from marked points on each gun model instead of hand-measured fractions, and the pistol sized for the fist; first-person arms that reach without stretching (longer bones or a dedicated arms model); the leaning and crouched head matched to its hitbox; distant bodies at a higher rate if the chunk 19 benchmark allows it (a new, more realistic soldier model is left for a later phase) | Watching someone jump, climb, reload a bolt-action or take a hit shows a real motion, and the benchmark shows no frame cost over chunk 19's | **Done** (crouch, jump, fall, landing, shooting and hit clips; climb still a pose, as the free library has no climb clip; checked by still pictures in the pose viewer, nobody has watched it in play) |
| 22 | **Ragdolls** | A light verlet ragdoll that takes over from the death clip partway through, colliding with terrain, props, fences and other bodies, sliding on slopes and pushed by the killing round; every dead body drops its gun, including those that die out of sight, and the gun collides as it falls; replays and the death cam get the same result (the ragdoll runs from recorded data so it plays back the same) | Bodies fall against walls, down slopes and over each other without passing through, and a replay shows the same fall | **Done** (a replay falls bit for bit the same in each engine; walls, slopes and pile-ups checked by unit tests and pose viewer screenshots, not watched in play) |
| 23 | **Buildings II** | Door leaves that open and shut (noise when used, bots open them, cover state and replays keep them); glass in windows that breaks; a breakable roof (panels that drop when their posts go); more building plans (one room, L-shaped, two storeys with stairs) and small buildings outside the outposts; indoor light that comes in through doors and windows (a light volume per building) and dims soldiers and debris inside; walled yards stop ringing like rooms (see chunk 26); bot and tuning playtest with the new buildings | Two outposts on one island look and fight differently inside, and a room is lit from its window | **Not started** |
| 24 | **Landscape rendering** | Tree impostors from several angles with normals, lit like the full trees, cross-faded at the switch, and swaying crowns with swaying shadows; the sea reflects the island (a low-resolution reflection pass) and far waves roll; underwater muffles sound and wobbles the view; a third shadow cascade or a baked far-terrain shadow past 230 m; far terrain tiles move what stands on them to the tile's height; distant bushes lose the blue-grey cast; the cascade patch pinned by a test against three.js's chunk; the adaptive-resolution check repeated with chunk 19's benchmark | Screenshots at 200–600 m show no pop, floating trees or pale sea, and the frame budget from chunk 15 still holds | **Not started** |
| 25 | **Night and weather II** | A shadow for your own flashlight; more flashlights lighting the world within the budget (checked with the chunk 19 benchmark); a torch model on each gun, the beam from it, and the killer's flashlight in the death cam; bots notice a beam where it lands, not only its holder; rain stops under roofs (a roof height map) and gains splashes, wet surfaces, puddles, thunder and thicker streaks; fog banks and thicker fog in hollows; rain dulls far sound for the player as well as for bots; a night sky for night reflections; leaderboards show each score's conditions next to it (they stay universal, with no night adjustment); sound downloads kept small (see chunk 20) | A night run in rain looks and sounds wet, only outdoors, and a beam over a wall gives its holder away | **Not started** |
| 26 | **Sound II** | Occlusion that goes round corners and through doorways (a path over the nav grid), counts thickness and lets a tree trunk muffle less than a building; reverb per space (a room, a walled yard, the open) instead of one room; the sea placed by the nearest stretch of water, not an average; far fights mixed into one distant-battle bed so they stop filling the voice pool; better recordings where the current ones stand in (a real suppressed shot per gun, a bolt-action shot and reload, concrete footsteps), still CC0 Freesound previews fetched without a key; replay sound rebuilt when seeking, and thinned at 4× | A shot round a corner sounds round the corner, and a long far firefight never cuts off a nearby footstep | **Not started** |
| 27 | **Bot senses and stealth** | Grass hides by the tufts actually placed, so a lone tuft hides a little and a gap in a field doesn't; bots look for bushes to hide in; bots know a bag's value only after seeing it, and a bot joining a fight goes for a guess round where the shots came from; bots get the bounty's advantage only once told of it; bag tags are hidden by bushes and grass too; campers keep trying for a spot that can see the extraction point; a self-kill with a grenade gets a death cam (no prone stance, as decided) | A bot playtest shows bots hiding in bushes and searching for shooters instead of walking straight to them, with extraction rates within 5 points of chunk 18's | **Not started** |
| 28 | **Replays II** | Replays as the seed plus every input, where the simulation allows it, so everyone is replayed exactly, with frames as the fallback; smaller files (binary, compressed with `CompressionStream`, far bodies at a lower rate); the last few replays kept in the browser (IndexedDB) with a list on the menu; the version is the build's hash, not the newest changelog date; another island opens without a reload; the free camera stops at walls, rocks and trees; seeking rebuilds the kill feed, bodies already lying and the hit numbers; the feed names the player when a friend watches, and fades by replay time; Offline pauses the live game while its replay is watched; the bounty added to the replay format's version | A replay saved yesterday can be picked from the menu and watched, with every body exactly where it was, in a file half the size of chunk 17's | **Not started** |
| 29 | **Rivals and results** | A dead operator's personality shown on the results screen, in the feed after they die and on their bag; operator bot extraction back near chunk 12's 19% without undoing the personalities; a stats page on the menu that reads the run log, with export to a file; the playtest counts unfinished runs, measures how often drop-in falls back to anywhere, and has a bot mode that searches like a human so run length can be read; the share button opens the system share sheet where there is one; PvE's old board removed from storage | You can tell who killed you and what kind of rival they were, and anyone can send their run stats as a file | **Not started** |
| 30 | **Human pass** | The chunks that need people and hardware this machine can't give: several full runs by other people (using chunk 29's stats export), a listening pass on the mix, reverb and ambience, a mid-range laptop for the 60 fps and 5 s load targets, Firefox and Safari by hand, and tuning from what they show (guards, weapons, extraction timings, loot, night, buildings, how far operator bots engage) | The Playtest and tuning goals from chunk 12 are met with human data, and every item in Known Issues is Resolved, Moot or listed below as left for later | **Not started** |

Known Issues that Phase 3 leaves alone:
- **Waiting on multiplayer or a backend** (Future): scores in links can be faked, leaderboards
  stay in one browser, Online and Offline play the same, names aren't filtered, the server
  doesn't check conditions, packing snapshots and death cam clips, the server keeping a human's
  whole run, and taping every player's inputs (which the server needs for death cams).
- **Accepted as they are**: "New island" seeds up to 999,999, outposts rearranged in chunk 15
  (old links point at the old layout), look angles rounded in commands, bullets passing through
  bushes, the kill feed coming with the run loop, and the death cam's small drift with more than
  two commands in one tick.
- **Left for a later phase**: a more realistic soldier model ("The soldier is stylized"; see
  Future).
- **Decided against**: a prone stance (so grass alone rarely hides a crouched body), a bounty
  bonus, a night score adjustment and the original Freesound files (see Decisions).

## Known Issues

Shortcomings of what has been built so far, to improve later. Every chunk adds the gaps it
leaves here. Each item notes the chunk it came from. Fixed items stay in the list: they are
marked **Resolved** with the chunk or commit that fixed them and how.

### Look and animation
- **No death animation or ragdoll** (9). Bodies topple backward stiffly around their feet and
  can sink into the ground or walls.
  **Resolved** (13): the soldier's death clip plays, and the body lies down away from its killer.
  Before it falls, rays at knee and waist height check for room, and for the flung arms either
  side. If there isn't enough room it turns up to 180° and slides back off a wall. Once down, it
  tilts to the slope under it and lifts until its head, chest, hips, hands, feet, knees and pack
  clear the ground. It isn't a physics ragdoll (see below).
- **Third-person movement has no animations beyond idle, walk and run** (9). Crouch-walking is
  a bent walk posed in code. Sliding, mantling, jumping and falling still play the walk or run
  clip.
  **Resolved** (13): snapshots now say whether a body is on the ground, in the air, sliding or
  mantling. Each state has its own stance posed in code: foot targets reached with leg IK and a
  bend at the waist, blended in and out at 12 per second. There are still no clips for them
  (see below).
- **Actions aren't animated in third person** (9). Reloading, switching weapons and throwing
  grenades don't show on other players.
  **Resolved** (13): snapshots carry the action (reload, draw, throw) and how far through it is.
  A reload tips the gun while the left hand goes down to a belt pouch and back to the magazine
  well; a switch brings the gun up from low; a throw lowers the gun while the left hand cocks a
  grenade over the shoulder and throws. The server tells a throw from a switch with a flag of
  its own, since both only set `draw`.
- **Third-person guns don't show suppressors** (9), although the viewmodel does.
  **Resolved** (13): snapshots carry whether the weapon in hand is suppressed. The can is drawn,
  and muzzle flashes and tracers start from its end.
- **Distant bodies animate at 12 Hz and skip hand IK** (9), beyond 90 m. It's cheaper, but
  scoped players may notice the stutter.
  **Resolved in part** (21): they animate at 20 Hz, each on its own turn rather than all in the
  same frame, which cost 3 ms every few frames for 24 bodies. The benchmark's new far case poses
  24 bodies 100–400 m off in 0.7 ms a frame (median). They still skip hand and leg IK.
- **One soldier model for every side, told apart only by tint** (9). Commanders look like any
  other guard. Since chunk 11 only the uniform is recoloured, not the whole body.
  **Resolved in part** (13): it's still one model, but the sides now differ in kit as well as
  uniform. Operators carry a pack and bedroll with black webbing, and guards wear brown webbing.
  Commanders (flagged in snapshots) wear a paler uniform, a red band round the helmet and a radio
  with a mast on their back.
- **The hit flash lights the whole body** (9), not just where the round landed.
  **Resolved** (13): the soldier's materials glow round the point the round landed, fading out
  over 30 cm. The point is kept in the body's own space, so the glow moves with it.
- **The body lean is only an approximation of the lean hitbox** (9). The head ends up roughly
  over its hit sphere, but not exactly.
  **Resolved** (13): a lean now shifts the hips 14 cm out over planted feet, then rolls the upper
  body by a Newton step until the middle of the head is exactly as far to the side as the head
  hitbox. Checked by drawing the hitbox over the body. The head still sits a few centimetres
  lower than its hitbox at full lean (see below).
- **First-person hands are boxes** (9), with no arms or animated reload.
  **Resolved** (13): first person now draws the soldier's own arms, cut from the model by skin
  weights, and reaches both hands to the gun with IK and closed fingers. The left hand goes down
  for a magazine on a reload and throws the grenades.
- **Buildings are still boxes** (9): the walls, watchtowers, containers and crates are textured,
  but the geometry is primitive. There are no doors, windows or interiors.
  **Resolved in part** (15): every outpost has a two-room concrete building (see below). Its walls
  are breakable panels with doorways and window openings, and lintels over each opening rest on
  the columns either side. Corner posts hold up an unbreakable roof, and there's a table and a
  guarded crate in each room. Everything is still built from boxes, and the watchtowers and
  containers are unchanged.
- **Trees are procedural** (9), because Poly Haven's tree models are hundreds of MB each. They
  have no LOD or impostors, and they don't sway.
  **Resolved in part** (15): trees are split into 100 m tiles. Tiles within 170–190 m of the
  camera draw every tree in full, and their crowns sway in one wind. Farther tiles draw each tree
  as an impostor: a card facing the camera, with a picture of the tree baked at startup. In the
  shadow pass the card faces the sun, so far trees still cast shadows. The trees are still
  procedural.
- **There is no ground cover** (9): no grass blades, bushes or small rocks near the player.
  **Resolved** (15): grass clumps (to 42 m), low bushes (to 75 m) and pebbles (to 35 m) are
  scattered round the camera. Each 8 m cell scatters them the same way every time, thickest where
  the ground is painted grass, and never on props, under roofs or in the sea. They shrink away
  toward the edge of their range, and the grass and bushes sway.
- **Water is a flat, see-through plane** (9), with no waves, reflections, shoreline foam or
  underwater effect.
  **Resolved in part** (15): a 240 m grid round the camera rolls with four wave trains, inside a
  flat ring out to the horizon. The sea's depth comes from a height map of the island: shallow
  water is clear and pale, deep water dark, waves die down toward the shore and foam laps along
  it in bands. Below the surface the fog turns murky green. It reflects the sky through the
  environment map, but not the island (see below).
- **Debris is coloured with each layer's average** (9), not textured like the panel it came
  from.
  **Resolved** (15): debris uses the panel's texture layer and tint. Each chunk is textured in its
  own frame, so the texture tumbles with it instead of sliding through a world-space projection.
- **Shadows use one fixed 2048 px map** (9), with no cascades, so distant shadows are coarse or
  missing.
  **Resolved** (15): two cascades of 2048 px each, 32 m and 230 m round the player, blending over
  the near one's edge. three.js's CSM addon would have taken over every material's
  onBeforeCompile, so `src/client/cascades.ts` patches the stock lighting chunk instead: the
  second sun gives no light and only lends its shadow map. Bodies now cast shadows only within
  60 m. Before, every soldier on screen was drawn into the shadow map however far away it was.
- **The soldier is stylized, not realistic** (11). Quaternius's low-poly SWAT character was the
  best rigged and animated CC0 soldier available, but it doesn't match the grounded tone. Its
  helmet hides the face, and its hands stay open instead of gripping the gun.
  **Resolved in part** (13): the fingers now close round the grip and fore-end. The model is still
  stylized, and its helmet still hides the face.
- **Walk and run speeds are estimated** (11). The clips' natural speeds (1.3 and 3.2 m/s) were
  worked out from how far the feet travel, not watched in motion, so feet may slide a little.
  Sprinting plays the run clip up to 1.8× faster.
  **Resolved** (21): the speeds are measured when the model loads, from how fast each foot slides
  back while it's down (`gaitSpeed` in `src/client/clips.ts`): walk 1.32 m/s, run 2.95 m/s and
  crouch-walk 0.57 m/s. Within 90 m a foot that's down is also held where it landed (the clip's
  foot is moved back onto that spot and the leg reaches for it) until the clip lifts it, or until
  it's 30 cm out, as when turning on the spot. Sprinting still plays the run up to 1.8× faster.
- **Crouch-walking looks like lunging** (11). The crouch drops the body and bends each leg with IK
  to where the walk clip puts the feet, and those feet are placed for standing height.
  **Resolved** (13): crouched, the feet the walk clip places are pulled in under the hips (strides
  45% shorter, lifted half as high and a little wider apart), so the legs stay folded under the
  body.
- **The soldier's other clips were dropped** (11) to save download size: death, shooting, hit
  reactions and rolls. Chunk 13 can bring back the death clip from the source file.
  **Resolved in part** (13): the death clip is back (4.5 kB). Shooting, hit reactions and rolls
  are still left out.
  **Resolved** (21): the shooting clip and both hit reactions are back and played over the upper
  body (see "The new stances are poses"). Rolls stay out: nothing in the game rolls.

- **Deaths aren't a physics ragdoll** (13). Every body plays the same death clip, laid on the
  ground as above. Limbs can still pass through props, fences and other bodies, and a body never
  slides down a slope or reacts to a round beyond which way it falls. It only falls away from
  its killer if the kill event arrives before the snapshot that shows it dead, which it normally
  does.
  **Resolved** (22): 0.35 s into the death clip a verlet ragdoll takes over from the clip's pose
  there (`src/client/ragdoll.ts`, with the bones laid over it by `src/client/ragrig.ts`): 17 balls
  (18 with an operator's pack) held by rods, a spine that bends a little, knees that only bend
  forward and limbs kept from folding through the body. It collides with the ground, every collider
  (walls, fences, crates, props, trees) and other dead bodies, grips with friction 1 (it stops on
  slopes up to about 30° and slides down steeper ones), and is shoved by the killing round at the
  joint it struck (a grenade throws the whole body). The kill event now carries the victim's pose,
  where the round struck and which way it went, rounded to the centimetre on the server, and the
  fall is worked out from that alone on a fixed 60 Hz step, so replays and the death cam fall the
  same (checked bit for bit by `e2e/ragdoll.e2e.ts` in all three engines). A body seen dead before
  its kill event waits up to 0.25 s for it. The old tilt-and-lift settling is gone.
- **Ragdolls have gaps** (22). Bodies don't collide with living soldiers, only with the dead and
  the world. Elbows bend either way, fingers keep the grip of a body that died out of sight, and
  the feet only follow the shins. A grenade doesn't move bodies already down, though a panel
  breaking next to one wakes it to fall further. Two bodies landing on each other at the same
  moment can come out a little differently in a replay, as their steps needn't line up. Falls
  match only within one browser engine: the engines' `Math` functions can differ in the last
  digit, and a fall magnifies it (as the rest of a replay would). Replays saved before chunk 22
  have no fall data in their kill events and fall as if unseen. Operators' bodies still go after
  5 s, so most never come to rest in view. It was checked with pose viewer screenshots, unit tests
  and the replay test; nobody has watched it in play.
- **The new stances are poses, not animations** (13). A slide, jump, fall and climb each hold a
  single pose of the legs, and a crouch-walk is the walk clip squashed. A hop shorter than about
  0.1 s barely shows. The source model has no clips for any of them.
  The slide pose went with the slide (after 14).
  **Resolved in part** (21): crouching, crouch-walking, jumping, falling and landing are clips from
  Quaternius's CC0 Universal Animation Library, moved onto the soldier by
  `scripts/retarget.mjs` when the assets are fetched: each bone takes the turn its counterpart
  makes from its bind pose (both rigs are bound in a T-pose), the hips' movement is scaled by hip
  height, and the feet follow the library's feet. A jump plays from the moment its feet leave the
  ground, the in-air loop takes over as the body falls, and after more than 0.2 s in the air a
  landing plays over the rest for 0.8 s. The soldier's own shooting clip is laid over the spine
  and head at each shot, and its two hit reactions at each hit: a doubling-up for the body and a
  snap back for the head. The climb is still a pose: the free set of the library has no climb.
- **Every gun reloads the same way** (13), with a magazine change, even the bolt-action. The hand
  paths are keyframes and don't depend on the gun's model.
  **Resolved** (21): each gun has its own reload, the same in first and third person
  (`src/client/handwork.ts`), with the hands going to points marked on the gun's model. The rifle
  swaps its magazine; the pistol tips, its magazine is taken out from under the grip, a small one
  comes from the belt and the slide is racked; the bolt-action's right hand opens the bolt and
  holds it back while the left thumbs three rounds into the port, then closes it. The left hand
  carries a magazine or a round between the belt and the gun. The bolt-action's bolt is also
  worked after every shot. Every shot kicks the gun (the pistol and bolt-action harder).
- **Hand grips were fitted by eye** (13), in a pose viewer, for the rifle and the pistol. The
  bolt-action uses the rifle's. The directions for the fingers and thumb are guesses tuned by
  screenshot.
  **Improved** (13, follow-up): the fingers curled so far that they came back over the top of
  the fore-end and showed above the gun. The curl is now gentler, the support hand sits under
  the fore-end with its fingers angled forward round the far side, the grip hand's thumb folds
  in, and the hands are drawn at 80%, since the model's gloves are oversized next to real guns.
  Checked from both sides and in first person for all three guns. The pistol still looks a
  little small in the fist.
  **Resolved** (21): the grips come from points marked on each gun's model (`GUNS` in
  `scripts/fetch-assets.mjs`, written into the files as empty nodes and read by `fitGun`): where
  each palm closes, the muzzle, the sight line, the magazine's base and the bolt. They were marked
  by eye on side views of the models. The pistol is fitted at 0.27 m instead of 0.22 m, larger than
  a real one, so its grip fills the fist.
- **First-person arms are stretched to reach** (13). The soldier's arms are too short for where the
  viewmodel holds the guns, so they're drawn 1.15× larger from shoulders placed where no real
  shoulder is (the left one far forward). Aiming the pistol, the forearms fill the bottom of the
  screen. The reload's hand movement mostly happens below the screen, so you mainly see the gun dip.
  **Resolved** (21): the arms are drawn at their own size, from shoulders below and either side
  of the eye, and their bones are lengthened instead: the forearm by 1.3 and the upper arm as far
  as the left hand needs to reach the farthest fore-end with the elbow a little bent (about 2×).
  The skin is moved with the bones as if they had been that long when it was bound, so the arms
  stretch smoothly at the elbow and don't thicken.
- **The grenade in hand is a plain sphere** (13), not a grenade model.
  **Resolved** (21): a fragmentation grenade built from shapes (`src/client/grenade.ts`): an
  olive body, the fuse, the spoon and the pin's ring. Thrown grenades use it too, instead of a
  cylinder.
- **Only bodies that die on screen drop their gun** (13). A body that dies out of sight is drawn
  without one. The gun falls straight to the ground height where it lands, with no collision.
  **Resolved** (22): every dead soldier drops their gun, seen or not, as three linked balls (grip,
  muzzle, magazine) that tumble, collide like a ragdoll and come to rest on their side. It starts
  from where the event says the hands were, drawn easing from where it really was over 0.3 s. It
  doesn't collide with its own body.
- **A leaning head sits a little low** (13). Side to side it's exactly over its hitbox, but at
  full lean it's a few centimetres below it, and a crouched head is a few centimetres off too.
  **Resolved** (21): within 90 m every body's head is put on its hitbox whatever the clips do. The
  hips move up to 12 cm and the waist bends to bring the head over the feet (within 4 cm, which the
  15 cm hitbox easily covers), the upper body rolls it out as far as a lean puts the hitbox, and the
  body is raised or lowered, eased so a stride's bob stays, to put it at eye height. The crouch
  clip had the head 25 cm in front of its hitbox. Beyond 90 m only the lean is matched.
- **The animation was checked by still screenshots** (13) of chosen moments in the new pose viewer
  (`dev/pose.html`), plus one screenshot of a real game in first person. Nobody has watched it
  moving at full speed in play, and its cost per frame with many bodies near wasn't measured.
  Each near body now also runs leg IK when crouched, sliding, airborne or leaning, and hand
  orientation and finger curl every update.
  **Resolved in part** (19, 21): the benchmark measures it (see "Chunk 21's cost"). The new clips
  were again checked by still screenshots in the pose viewer (now also showing landings, hits,
  shots, the bolt being worked and each gun's reload); nobody has watched them in play.

- **Doors are open doorways** (15). There are no door leaves to open or shut. Doorways are 2.2 m
  wide so a bot's path always fits through the 1 m nav grid. Windows are open holes with no glass.
- **One building plan for every outpost** (15): two rooms, a front door, an end door and a door
  between them. It varies only in size, the placement of its openings and which of four corners
  and turns it takes. There are no buildings outside the outposts.
- **Outposts were rearranged** (15). The building takes a corner, so the containers and crates
  landed elsewhere on every island. An older link or leaderboard score is for the old layout of
  the same island. Only the outposts' insides changed; terrain, trees, rocks, fences and
  extraction points didn't move.
- **The roof can't be broken** (15), though every wall can. With all the walls blown out, a
  roof is left standing on its four corner posts.
- **Indoor light is a flat cut** (15). Surfaces inside a building's walls and under its roof get
  30% of the sky's light, with a hard edge at the doorway. Light through doors and windows isn't
  modelled, and soldiers and debris inside aren't dimmed.
- **Ground cover is only for looks** (15). Nothing collides with grass, bushes or pebbles, and bots
  see straight through them, so bushes are kept under 0.9 m and grass under 0.6 m. Near the
  coast grass can stand on sand, because each tuft reads the paint at the nearest terrain vertex.
  **Resolved** (15, follow-up): bots can't see through bushes or thick grass. Bushes are
  scattered in `src/shared/vegetation.ts`, identically on the server and every client, and are now
  0.5–1.3 m and drawn to 120 m (bot sight reaches 120 m), so crouching behind a big one hides you
  while standing doesn't. Grass is modelled as a layer up to 0.6 m deep that a sight line loses 55%
  to per metre through thick grass, so it hides a body only where the line skims the ground near it.
  A bot sees someone if at least 30% of their chest or head shows; less than full view slows
  spotting, and an unsuppressed muzzle flash shows through leaves. Still open: grass isn't placed
  blade by blade for sight, so a lone tuft doesn't hide you and a gap in a field does; nothing
  collides with them; bullets go straight through; bots don't look for bushes to hide in. With no
  prone stance, a crouched chest (0.7 m) is above the tallest grass, so grass alone rarely hides
  anyone.
- **The tree impostors are rough** (15). There's one picture from the side, lit evenly and then
  darkened by a hand-set 0.4 to match the full trees. Trees switch between full and impostor at
  170–190 m with no cross-fade. A sun-facing card only approximates a crown's shadow, and
  swaying crowns cast still shadows.
- **The sea reflects only the sky** (15), through the environment map. There are no reflections
  of the island. Out past the rolling grid the waves are only in the normals. Far off, the sea
  looks pale, reflecting the bright horizon. The underwater effect is only fog: no muffling and no
  distortion. It can only be seen when the death camera sinks into the sea.
- **Shadows end at 230 m** (15), and bodies cast them only within 60 m. The cascade patch changes
  three.js's lighting chunk for every scene: any scene with exactly two shadow-casting directional
  lights is taken as cascades. It matches the chunk's text, and fails loudly if a three.js update
  changes it.
- **Far terrain doesn't carry what stands on it** (15). Trees, rocks and props sit on the exact
  ground, so on a coarse far tile they can float or sink a little.
- **The textured island looks washed out** (noticed in 15, from 11). The strong sky light
  (environment intensity 1.7) flattens the ground's colours and makes the sun's shadows faint.
  Checked against the build before chunk 15: it looked the same.
  **Resolved** (15, follow-up): the sun is up from 2.6 to 3.3 and the sky light down to 1.0
  (hemisphere 0.3), so the sunlit side outweighs the shade and shadows read; tone mapping is
  Khronos PBR Neutral at 0.9 exposure instead of ACES, which bleached greens toward yellow-grey;
  fog starts at 120 m instead of 60 m. Alpha-tested grass and bush cards had their alpha boosted
  by mip level, since distant ones were thinning into pale hollow outlines. Distant bushes still
  look a little blue-grey from the sky light on their up-facing normals.
- **World detail was checked by screenshots on one machine** (15). Headless Chrome on an M3 Pro
  holds 60 fps (median 16.7 ms, 95th percentile 18.2 ms) at 1280 × 720 in a Mixed game.
  Draw calls fell from 348 to 239 at the same spawn, and triangles rose from 639k to 736k. A
  mid-range laptop wasn't tried, nobody has watched the swaying and waves in motion, and the
  ground cover's rebuild, when the camera crosses an 8 m cell, wasn't timed.
  **Resolved in part** (19): the benchmark times the rebuild at about 1 ms a cell crossed in all
  three engines (see "The ground cover's first fill"), and the screenshots are now compared by
  the tests. The mid-range laptop and watching it move are left for chunk 30.
- **Building ceilings show shadow acne** (19): the indoor screenshots show streaks across the
  underside of the roof, dark by day and orange at dusk. Seen only now that a test looks inside.

- **The climb is still a pose** (21). The free set of Quaternius's animation library has no
  climbing clip, so a mantle holds the same leg pose, forward bend and hand on the ledge as in
  chunk 13.
- **The crouch-walk is a slow sneak played fast** (21). The library's clip moves at 0.57 m/s and
  crouched bodies move at up to 2.4 m/s, so its strides are lengthened up to 1.8× and it plays up to
  3× faster. At full crouch speed the legs may look hurried.
- **Retargeted legs rely on the leg IK** (21). The library's legs are shorter for their hips than
  the soldier's, so its shins, turned the same way, leave the ankle about 10 cm from where the feet
  are placed. Within 90 m the legs reach the feet every frame. Beyond 90 m there's no leg IK, so a
  crouching or landing body's shins and feet don't quite meet.
- **Feet don't follow the ground** (21, from 9). A planted foot is held where it landed, but at
  the height the clip gives it above the body's own height. On a slope or a step the feet float
  or sink a little.
- **Reactions don't depend on where the round came from** (21). A hit doubles the body up or snaps
  the head back, the same from any side. Every gun uses the same shooting clip, only kicking
  harder for the pistol and bolt-action.
- **Only the hands reload** (21). Each gun is one mesh, so the bolt handle, slide and magazine
  don't move with the hands; a fresh magazine is a box in the hand and the old one never drops.
  The bolt-action always thumbs in three rounds, however many it needs. The points on the guns
  were marked by eye on side views, not snapped to the geometry.
- **The head leaves its hitbox for a moment on landing** (21). Moving the body up or down to
  put the head at eye height is eased and limited to 30 cm, so the landing's deep dip shows.
  Deep in a crouch the upper body leans back a little to bring the head over the feet.
- **The first-person arms are about twice as long in the upper arm** (21). Only the forearms and
  hands show, so it can't be seen, but the elbows sit where no real elbow would. Watched only in
  still pictures.
  **Improved** (21, follow-up): aiming the pistol, the arms, long enough for the rifle's fore-end,
  folded up with their elbows right in front of the eye, and the left hand held the grip like the
  right one with its thumb sticking out sideways (seen in play). Now a shoulder slides back behind
  the eye whenever its hand is near, until the arm is nearly straight (90% of its length), and on
  the pistol the left hand wraps round the right hand's fingers with its thumb forward along the
  frame, in first and third person. A test picture of the aimed pistol was added.
  Still wrong in play: the aimed pistol sat 0.42 m from the eye, so the straightened arms passed
  just under the camera and filled the screen, and the wrists bent up to 70° from their forearms,
  folding the skin between sleeve and glove into a strip on the left and a block on the right. The
  aimed pistol is now held 0.6 m out, at arm's length (so it looks smaller on screen, as a real one
  would), and while aiming it no wrist bends more than 40° from the line from its shoulder to its
  hand: the hand is turned back toward that line before the wrist is placed, so the palm stays on
  the grip. The limit eases in with the aim. From the hip, and for the other guns, nothing changed:
  moving the hip stance out and limiting every wrist too looked worse (the user preferred the
  previous hip view). Third person has no such limit.
  Still wrong: the aimed pistol's left wrist was twisted 142° about its forearm (the hand is turned
  half over to wrap the right), so its skin wrung into a thin strip. While aiming the pistol the left
  forearm now rolls with the hand, leaving the wrist at most 23° of twist; the hand stays exactly
  where it was. The right hand (46°) is left as it was.
- **The soldier download grew by 78 kB** (21), 33 kB gzipped, to 599 kB: the new clips' keys
  aren't compressed (meshopt only quantizes the meshes), though they're sampled at 20 per second
  and resampling drops the keys a straight line would give.
- **Chunk 21's cost** (21): on an M3 Pro in Chromium, posing 24 near bodies takes 2.4 ms a frame
  (median) against 2.5 ms for chunk 20's code on the same machine under the same load, measured
  back to back. The new clips, foot holds and head matching cost more, and the rig's helpers were
  made cheaper to pay for them: they read bones' world matrices as they stand instead of
  rebuilding them up the whole chain on each call, and the head is matched with one turn at the
  waist, worked out from how the head moves per radian, instead of two probing turns each way.
  In the browser tests' benchmark, posing them took 2.2 ms in Chromium (2.4 in the kept
  baseline), 2 ms in Firefox (was 3) and 2 ms in WebKit (was 2). Whole frames came out slower than
  the baseline in Chromium (13.7 against 10.6 ms) and WebKit, but so did the empty frame with no
  bodies at all (4.5 against 3.1 ms), so the machine was busier than when the baseline was kept;
  it wasn't replaced.
- **Working the bolt fills a corner of the screen** (21). In first person the right hand comes
  back to the bolt near the eye, and the forearm covers the bottom right while it does.
### Sound
- **Every sound is still synthesized** (9), not recorded. The plan's CC0 asset sources have no
  audio, so recorded samples need a new source.
  **Resolved** (14): guns, the grenade, reloads, footsteps, breaking cover, landing, being
  hit and the ambience are 28 CC0 recordings from Freesound, listed in `src/client/soundlist.ts`.
  `scripts/fetch-sounds.mjs` checks each one's page says CC0, cuts it and packs them all into
  `sounds.m4a` (AAC, 105 s, 854 kB) with `sounds.json` saying where each sits. Footsteps are four
  footfalls per surface cut from walking recordings by loudness. The interface's beeps (hit marker,
  pickup, call, run end) are still synthesized on purpose.
- **Sound ignores walls** (9): there's no occlusion and no reverb, and footsteps can be heard
  through walls.
  **Resolved** (14): every sound out in the world casts a ray from the ear. If it's blocked it
  casts another 2.5 m higher at both ends: when that one's clear the sound is half muffled (it
  gets over a wall), and otherwise fully (a building or a hill). Muffled sounds are quieter and
  low-passed. A reverb from a generated impulse rings louder the more the listener is walled in,
  measured by 12 rays round the horizon out to 30 m. Distant sounds send more to it.
- **There's no ambient sound** (9): no wind, sea, birds or distant fighting.
  **Resolved** (14): wind grows with height and in the open. The sea is placed at the nearest
  water found in 16 directions out to 220 m and grows toward the shore. Birds grow with the trees
  within 40 m and go quiet for 20 s after a shot or blast nearby. Distant fighting is the real
  fighting: every shot on the island is heard, dulled by distance, delayed at the speed of sound,
  and past 60 m blended into a recording made at long range.
- **Surface detection for footsteps is rough** (9). It uses thresholds on height, slope and
  distance to an outpost, and doesn't match the painted terrain exactly.
  **Resolved** (14): `src/client/ground.ts` works out each terrain vertex's layer weights once,
  and both the renderer's paint and the footsteps use them. A footstep takes the strongest layer
  after blending the three vertices of the triangle underfoot. Tests check the normals match
  three.js's and the chosen layer is the strongest at each vertex.
- **No sliding scrape** (9). Slides are silent.
  **Resolved** (14): a gravel slide played for your own slides and other bodies' ones.
  **Moot** (after 14): sliding was removed from the game, and its sound with it.

- **Nobody has listened to the new sound** (14). This machine has no way to hear it. The
  recordings were chosen by title, description, rating and waveform, the cuts were placed from
  loudness envelopes, and the levels were set by rendering each sound offline in headless Chrome
  and measuring its peak and RMS. Mix, reverb amount and ambience levels need a listening pass.
- **The recordings are Freesound's previews** (14), 128 kbps MP3, not the original files, which
  need a Freesound account or API key to download. They're re-encoded once more to 64 kbps AAC.
  Since chunk 20 that's Opus at 40 kbps (AAC where Opus won't decode), still unheard.
- **Some recordings aren't what they stand for** (14). The suppressed shot sounds synthesized,
  the rifle and pistol reloads are mixes of other recordings, the bolt-action's shot is a .405
  Winchester lever-action, and concrete footsteps reuse the stone ones played 10% faster. Every
  gun shares the one suppressed shot, pitched per gun, and the bolt-action reloads with the rifle's
  magazine sound.
- **Only real fights make distant fighting** (14). In PvE the guards only fight you, so the
  island is quiet apart from your own fights.
  **Resolved** (modes change): PvE is gone. Offline has 7 operator bots, and they fight the guards
  and each other across the island.
- **Occlusion is three steps and only along lines** (14): clear, over the top or blocked. It
  doesn't bend round corners, the thickness of what's in between doesn't count, and a tree trunk
  exactly on the line muffles a sound as much as a building does.
- **The reverb is one generated room** (14), the same everywhere, only louder when walled in.
  It isn't placed in 3D, and a place with no roof yet (every building so far) rings like a room
  when its walls are close.
  **Improved** (15): the outposts' buildings have roofs, so inside them the reverb is right. The
  walled yards around them still ring like a room.
- **The sea's bearing is an average** (14) of the directions that found water at the nearest
  radius, so on a narrow point with sea on both sides it can seem to come from inland.
- **Far fights fill the voice pool** (14). A distant shot holds a voice through its delay and its
  2 s tail, so a long firefight far off keeps most of the 24 voices busy. When all are busy, the
  quietest sound is cut off (or the new one isn't played), so near sounds still win.
- **A slide from someone else always scrapes for the slide's full 0.9 s**, even if it ends early.
  **Moot** (after 14): sliding was removed.
- **Sounds arrive after the game starts** (14). The 854 kB file downloads in the background and
  isn't on the loading bar, and nothing plays until it's decoded (the game is playable
  meanwhile). If it fails, the game is silent apart from the beeps.
  **Resolved** (20): the sounds are packed in two files. The early one (your own guns, steps and
  landing, and the ambience: 150 s, 700 kB as Opus) is on the loading bar and decoded before
  the menu shows, so the first shot is heard. The late one (other people's doings: far shots,
  blasts, breaking cover, being hit; 10 s, 47 kB) loads behind the menu. A browser test checks
  your own sounds are in when the loading screen goes.
- **AAC playback was only checked in Chrome** (14): the packed offsets depend on the browser
  trimming the encoder's priming samples, which Chrome does exactly. Safari should (it's Apple's
  format) and Firefox should, but neither was tried.
  **Resolved** (19): a browser test decodes the bank in each engine and checks every shot gets
  loud within its first few milliseconds. WebKit trims exactly like Chrome. Firefox didn't: it
  decodes every AAC frame, priming and end padding included (159.52 s instead of 159.46 s), so
  every sound there played 48 ms late and lost 48 ms off its end. `sounds.json` now says how long
  the packed sound is and how much priming the encoder added (2112 samples), and the game moves
  every clip by the priming when the decoded file is longer by at least that much
  (`bankLead` in `soundlist.ts`). The sound script writes both numbers.
- **The sound script needs a Mac** (14): it uses `afconvert` to decode and encode.
  **Resolved** (20): it uses ffmpeg (with libopus) on any platform, and its output is bit-exact,
  so running it again makes the same files. It ran in a Linux x86-64 container from a clean
  checkout.

- **The loading screen waits for most of the sound** (20). The early bank is 150 of the 160
  seconds, because the ambience beds are long: 700 kB of the 4.3 MB the loading screen waits
  for. Loading locally took no longer (1.22 s against 1.26 s), but on a slow connection it adds
  to the wait. Moving the ambience to the late bank would halve it, at the cost of the ambience
  fading in a moment after Play.
- **The AAC fallback is ffmpeg's own encoder** (20), not Apple's: 1.43 MB for the two banks
  against the old file's 1.30 MB at the same 64 kbps, and likely a little worse. It's only for
  browsers that can't decode Opus. Playwright's WebKit decodes Ogg Opus, so the fallback was
  tested by blocking the Opus files; which real Safari versions need it wasn't checked.
- **The sounds are decoded at 48 kHz before audio is unlocked** (20), in an
  OfflineAudioContext, so a device running at 44.1 kHz resamples them as they play.

### Performance and loading
- **There's no loading indicator** (9). Until the assets arrive, the island quietly shows flat
  colours, and the swap is visible.
  **Resolved** (11): a loading screen in `index.html` shows before any script runs, with a progress bar over the
  downloads, and stays up until the assets are applied and their shaders compiled. After 8 s it
  offers to play in flat colours.
- **Assets are uncompressed** (9): JPEG textures instead of KTX2, and glTF without Draco or
  meshopt. The soldier is 2 MB and the sky 1.4 MB, about 6 MB in total.
  **Resolved** (11): the textures are two KTX2 array textures in Basis ETC1S (0.5 MB colour, 0.8 MB
  two-channel normals) that stay compressed on the GPU. The models are meshopt-compressed and
  quantized (soldier 0.5 MB, guns about 30 kB each), and the sky is halved to 512 × 256 (0.4 MB).
  That's about 2.3 MB in total.
- **Building the texture arrays can stall the page** (9). It uses canvas `getImageData` on the
  main thread at startup.
  **Resolved** (11): KTX2Loader transcodes the array textures in a Worker, and there's no canvas step
  any more.
- **The JavaScript bundle is over 500 kB** (9), with no code splitting. The build warns about
  it.
  **Resolved** (11): three.js is split into two chunks of its own (core 265 kB, WebGL renderer
  352 kB). The game's entry chunk is 120 kB, and the asset loaders (133 kB) load lazily. No chunk
  is over 500 kB, but the total loaded at start barely changed (see below).
- **The terrain is one full-resolution mesh**, with no LOD.
  **Resolved** (15): 5 × 5 tiles of 160 m, each with three levels (every vertex, every second
  and every fourth) switching at 230 m and 460 m from the tile's middle. The nearest level is
  exactly the collision triangles. Coarser tiles hang a 4 m skirt to hide cracks, and every
  level takes its normals and paint from the full-detail vertices. In the orbiting menu view the
  island draws 289k triangles instead of 689k.
- **Adaptive resolution is untested on slow hardware** (9) and could flip back and forth.
  **Resolved in part** (15): it did flip. A test with a simulated GPU that is too slow at full
  resolution and comfortably fast one step down saw 121 switches in 10 minutes. Now a step up
  that turns slow within 10 s isn't tried again for 30 s, then 60 s, and so on up to 10 minutes;
  the same test sees fewer than 12. It still hasn't run on real slow hardware.
- **Every positional sound creates its own panner node** (9), released on a timer. Heavy
  fights create a lot of them.
  **Resolved** (14): sounds out in the world take turns on a pool of 24 voices (gain, low-pass,
  HRTF panner and reverb send) built once when audio unlocks. Only the buffer source is new for
  each sound, as the Web Audio API requires.
- **The total JavaScript loaded at start barely changed** (11): about 740 kB minified (200 kB
  gzipped), now in four chunks that load in parallel. Splitting keeps three.js cached across
  game updates, but it doesn't shrink the download.
  **Resolved in part** (20): measured on the production build, the JavaScript and wasm fetched
  before the menu shows fell from 1,550 kB to 1,227 kB (544 kB to 396 kB gzipped), almost all of
  it the smaller transcoder. The JavaScript alone barely moved (1,023 kB to 1,015 kB): the entry
  chunk is 197 kB instead of 212 kB, but the ground cover and impostors, split off, still load
  while the loading screen is up. Only the death cam and replay viewer wait until after it.
- **The Basis transcoder costs 527 kB** (11), or 249 kB gzipped. That eats much of what KTX2
  saves on the download. The real gains are GPU memory and no main-thread stall.
  **Resolved** (20): `scripts/build-transcoder.mjs` builds the same Basis version three.js ships
  (1.50) with only what ETC1S needs: no UASTC, UASTC HDR, Zstandard, ASTC, PVRTC or BC7. It's
  212 kB (102 kB gzipped). The game tells KTX2Loader the GPU has no BC7 or PVRTC, so it picks
  ETC, BC1/BC3 or plain RGBA. three.js's own transcoder is left out of the build.
- **KTX2 textures are lossier than the JPEGs** (11): ETC1S, with two-channel normal maps. They
  were only compared by screenshot.
  **Resolved** (20): measured by `dev/assets.html` (run by `e2e/assets.e2e.ts`) against the 1k
  originals scaled to 512 px, as the GPU sees each layer. Colours come out at 29 to 39.5 dB PSNR
  (withered grass, rocks and bark lowest, near 29 dB), normals 2.2° to 10.5° off on average
  (withered grass the worst, 22° at the 95th percentile). Transcoded to ETC, as Chromium on
  this Mac does, they're exactly the ETC1S. BC7 and BC1 lose up to 0.4 and 0.5 dB more, and BC7
  beats BC1 by 0.4 dB at most (on concrete it's worse), which is why the transcoder leaves it
  out. The test fails below 28 dB or
  above 12° on average.
- **The sky is prefiltered through a 256 px cube** (11). Prefiltered straight from the halved
  image, it lit the island noticeably brighter, so it's first drawn into a cube the size the
  full image gave. The match was checked by screenshot only.
  **Measured** (20), and it isn't a match: spheres lit only by the sky come out 24% brighter
  with the game's sky than with the full-size original prefiltered directly (8% for a mirror).
  Prefiltered straight from the halved image it was 46%. Against the light the original's pixels
  really cast (worked out on the CPU, six ways), the full original's prefilter is right on
  average (0.99) and the game's 13% over. The halved file keeps exactly the original's energy;
  three.js's prefilter just gives more light from a blurrier sun, and scaling the half-size sky
  back up doesn't help. Left as it is: the sky light's strength per time of day was tuned by eye
  on this sky, and matching the original would mean scaling it by about 0.8. The test keeps it
  within 30% of the original.
- **The loading bar is approximate** (11). It leaves out the script download (it sits at 0 until
  the scripts run), it guesses sizes that aren't known yet, and gzipped files count as done
  early, because their size is the compressed one.
  **Resolved** (20): the build puts every file the loading screen waits for in the page with its
  uncompressed size (the scripts, the transcoder, textures, models, sky and early sounds). A
  small script in `index.html`, running before the modules, counts each file as it lands and
  takes the game's reports of those still coming in. The dev server's scripts aren't listed, so
  there the bar counts only the files.
- **The 5 s load target wasn't measured on a mid-range laptop** (11). Locally on an M3 Pro, the
  production build loads in 1.1 s cold and 0.4 s warm (3 MB transferred). The new build isn't on
  the live site until it's pushed.
- **Skipping the loading screen brings back the flat-colour swap** (11), which then shows
  mid-game when the assets land.
  **Resolved** (20): a picture of the last flat-coloured frame covers the view while the
  textures go on and their shaders compile, then fades away over 0.8 s. The game goes on
  underneath, so the view stands still for as long as the compile takes.
- **The game's entry chunk grew to 141 kB** (13), from 120 kB, with the body posing and the
  first-person arms. The soldier model grew by 4.5 kB for the death clip.
- **The entry chunk grew again, to 172 kB** (15), with the terrain tiles, water, ground cover,
  impostors and cascades. It all ships in the entry chunk rather than loading lazily.
  **Resolved in part** (20): it had reached 212 kB by chunk 19. The ground cover (9 kB), the
  impostors (3 kB) and the death cam with the replay viewer (6 kB) are chunks of their own now,
  and the entry is 197 kB. The terrain, water and cascades stay in it.
- **The lazy chunks mostly still load at start** (20). The ground cover and impostors are
  wanted as soon as the island shows, so they load alongside the assets while the loading screen
  is up; splitting them off shrinks the entry chunk but not the start. Only the death cam and
  replay viewer (6 kB) wait, until the menu is up. If one fails to load, a replay or death cam
  says so (or goes straight to the results) and can be tried again.
- **The committed transcoder is a binary** (20), built with Emscripten 4.0.10 in Docker. When
  three.js updates KTX2Loader, its calls must still match the wrapper of Basis 1.50; only the
  browser test that loads the textures would notice. A phone GPU with PVRTC but not ETC (old
  iPhones) now gets plain RGBA, four times the memory; the game is desktop only.
- **The fade-in stands the view still** (20). While the textures go on and their shaders
  compile, the picture of the last flat-coloured frame covers a game that keeps going, so a
  player moving then sees a still frame for that long (a few hundred milliseconds here).
- **The Buy Me a Coffee button blocks the page while it loads** (pause menu commit). Its
  script writes the button in place with `document.writeln`, so it has to be a plain blocking
  script in `index.html`. A slow buymeacoffee.com CDN holds up the rest of the page, and ad
  blockers that block it leave no button. A plain styled link would avoid both.
  **Resolved** (pause dashboard commit): the widget is replaced by a plain link styled like it,
  with no script and no class names that ad blockers match.
- **Esc can't always close the run dashboard straight back into the game** (run dashboard
  commit). Browsers don't count Esc as a user gesture, and Chrome refuses to re-lock the mouse
  for about a second after Esc freed it, so a refused lock left a "Click to resume" prompt anyway.
  **Resolved** (by removal): Esc no longer closes the dashboard; clicking anywhere does. Holding
  the dashboard on Tab, or claiming Esc with Keyboard Lock in fullscreen, would bring it back.
- **A click on the run dashboard within about a second of Esc resumes late** (dashboard retry
  commit). Chrome refuses to re-lock the mouse that soon, so the click keeps retrying for up to
  2 s and the game resumes once it's let through. Untested: headless Chrome never grants pointer
  lock, and whether a retry still counts as the click's gesture depends on the browser.
  Still untested after chunk 19: none of the three test browsers grants the lock headless.
  **Resolved in part** (20): while it retries, the card says why ("Your browser holds the mouse
  for a moment after Esc…", or "Taking the mouse back…" long after Esc), and if the browser
  still refuses, "Your browser didn't give the mouse back. Click again to resume." A lock request
  a browser never answers now counts as refused after 1 s instead of hanging. Chromium and
  Firefox do grant the lock on a test's real click (see Code and testing), so resuming is tested
  there, but a key pressed by a test doesn't free it the way Esc does, so Chrome's hold itself
  still hasn't been seen by a test; the messages were checked in WebKit, which refuses every
  lock, with the time since Esc faked.

### Sharing and leaderboards
- **Scores in links can be faked** (10). With no backend, a link's `by` and `score` are plain
  query parameters, so anyone can edit them. They're a friendly challenge, not a record.
- **Leaderboards only hold your own runs, in one browser** (10). They're lost when site data is
  cleared, and they don't follow you to another device.
- **A link without a mode is taken as Mixed** (10), so an old `?world=` link with a score in it
  and no `mode` compares against Mixed runs.
  **Resolved** (12): a link without a mode keeps the mode you last played, and its score is the one
  to beat in whichever mode you pick (except the range). The menu then doesn't name a mode.
- **Online and Offline play the same until there is a multiplayer server** (modes change). Both
  run in the local Worker, so nobody can join an Online game yet. The only difference today is
  that Offline never takes a second human.
- **PvE scores were left behind** (modes change). Offline has 7 bot operators where PvE had none,
  so its scores don't compare, and PvE's board is still in storage but never shown.
- **Names aren't filtered** (10). Locally only you and the bots see yours, but multiplayer will
  need filtering and length checks on the server.
- **"New island" only picks seeds up to 999,999** (10), to keep the numbers short. Typed
  `?world=` values still reach every seed.
- **The share button copies the link, and doesn't open the system share sheet** (10). Where the
  clipboard is blocked it falls back to a `prompt()` with the link.
- **GitHub Pages hosting isn't verified from here** (10). The deploy workflow has existed since
  chunk 0, but nobody has checked that Pages is enabled and that the live site's links work.
  **Resolved** (11): checked with a headless browser against
  https://richi8.github.io/onepointsix/. It served the latest pushed build (chunk 10's bundle
  hash) and the assets, and a `?world=4242&mode=pve&by=Tester&score=1234` link opened island
  #4242 in PvE with the challenge shown. Pages gzips `.hdr` and `.glb` and caches for 10 minutes.

### Day, night and weather
- **Flashlights cast no shadows** (16), so a beam lights the far side of a wall and the room
  behind it. Shadows would need a shadow map per light, drawn every frame.
- **Only the two nearest other flashlights light the world** (16). Farther ones show only a faint
  beam and a glare when pointed your way. Three spotlights (yours and two others) are always in the
  scene at dusk and night so switching one on never recompiles a material.
- **Others' flashlights shine from their gun's muzzle** (16). There's no torch model on the gun,
  and the death cam doesn't light your view from the killer's flashlight.
- **Bots see a light only when they can see its holder** (16). A beam sweeping over a wall from
  someone hidden behind it gives nothing away, and a light is judged by where its holder stands,
  not where it points.
- **Rain falls indoors** (16), through roofs. There are no splashes, wet surfaces, puddles or
  thunder, and the streaks are 1-pixel lines.
- **Fog is plain distance fog** (16), the same everywhere, with no banks drifting or thicker
  patches in hollows.
- **Rain only muffles noise for bots** (16). For the player, far-off shots and footsteps are as
  loud as ever; the rain loop just plays over them.
- **Night reflections are the day sky, dimmed** (16). The image-based light comes from the one
  daytime HDRI turned down to 2%, so shiny things still reflect a faint blue daytime sky.
- **Conditions aren't checked by the server** (16) beyond parsing the link. Every combination is a
  separate game in the directory, so in multiplayer nine conditions per island would split the
  players unless the server picks them.
- **Night scores beat day scores** (16). Night crates hold an extra item and more valuables,
  and the leaderboards are shared across conditions, so the best scores on a board will tend to
  be night runs.
- **The look was tuned by screenshots only** (16), on an M3 Pro through headless Chrome. The cost
  of up to 24 beams and glares, three spotlights and the rain on a mid-range laptop wasn't
  measured. The lighting presets, rain, flashlights and menu pickers have no automated tests; the
  config, link, bot senses, night guards and loot do.
- **The sounds grew to 1.3 MB** (16) with the rain and cricket loops, still downloaded behind the
  menu (see Sound).
- **Night tuning comes from bots only** (16). In a bot playtest (4 islands × 15 min each),
  operator bots got out of 18% of runs on a clear day, 22% in rain, 26% in fog, 12% on a clear
  night, 19% on a rainy night and 24% on a foggy night. So night is the hardest and fog the
  easiest, as intended, but none of the numbers (sight multiples, one extra guard per outpost,
  loot boost, flashlight reach) have been checked by humans.

### Death cam
- **Only the killer is replayed from inputs** (10). Everyone else is drawn from the snapshots the
  victim's client received, so they're a little behind, and bots out of sight may pop in.
- **The replay uses today's cover** (10). Panels that broke or were rebuilt during those seconds
  are drawn and collided as they are now, so a replayed killer can walk or shoot differently
  around them.
  **Resolved** (17): the client keeps the breaks and rebuilds of the last seconds with the rest of
  the recording. The death cam undoes those since its start to put the panels back as they stood
  then, plays them forward as they happened, and sets the panels back to now when it ends. Live
  breaks during the death cam are only noted, and shown once it's over.
- **The killer's state can drift between keyframes** (10). The server changes a few things
  outside the commands (health, ammo from loot, dying). The replay re-syncs to a full state
  every 0.5 s, so errors are small and short-lived, but they're there.
  **Improved** (15): a new carry weight now writes a keyframe at once, since it changes how fast
  the player moves. Chunk 15's new outpost layouts had a bot take loot just before the end of
  the tape test, and its replay drifted 3 cm. Health and ammo still wait for the next key.
  **Resolved** (17): the tape keeps a copy of the player after each command and writes a key
  (marked `changed`) whenever the server changed anything since: damage, ammo, loot, a death or
  respawn. It checks at the start of every tick and before every command, so a replay picks up a
  change from the next command on. One gap is left: with more than two commands in one tick, they
  share a time, so a change between two of them may be keyed after them. The checks cost about
  10–15% of a server step with 31 bots.
- **No HUD in the death cam** (10): there's no hit marker, killer health or ammo. The bolt
  scope overlay is the only thing shown besides the banner.
  **Resolved** (17): the normal HUD shows the killer's health, ammo, crosshair, stamina and scope,
  with no key hints and no death notice. A hit marker flashes for each of the killer's rounds that
  struck a body, and a kill marker at the kill. There are no damage numbers, since the victim's
  client isn't told the killer's damage to others, and the markers count any body struck, not only
  yours.
- **Death cam clips are big** (10): about 6 s of commands and keyframes as plain JSON, some tens
  of kB per death. That's fine through the Worker, but multiplayer should pack it.
- **Every player's inputs are taped all the time** (10), including guards far from anyone, just
  in case they kill someone. It's cheap, but it isn't free.
- **Deaths on the range get no death cam**, and neither does a self-kill with a grenade.
  Replays can't be shared yet either (see Future).
  **Resolved** (17) for sharing: whole runs are saved and opened as replay files.
  **Resolved** for the range only (modes change): the range was removed. A self-kill with a
  grenade still gets no death cam.

### Replays
- **Only the player is replayed exactly** (17). Their inputs rebuild them through the simulation;
  everyone else is drawn from the snapshots their client got, 15 a second (every other one),
  rounded to the centimetre and milliradian. Others' recoil, exact aim and footing aren't theirs,
  and a body dying between two frames snaps to the next one.
- **Replays are tied to the game's version** (17). A change to the simulation, the weapons or
  the island generator makes an older replay play back differently; the player would walk
  through a moved wall. A replay from another version only gets a warning, and versions are told
  apart by the date of the newest "What's new" entry, so two updates on one day look the same.
  The file format has its own version, and a replay in another format is refused.
- **A ten-minute replay is about 900 kB** (17), most of it the other 30-odd bodies. A 45-second
  test run is about 70 kB. Frames at 10 a second, or leaving out bodies far from the player,
  would halve it.
- **A replay lasts only until the next run** (17). Watch replay and Save replay act on the last
  run; nothing is kept in the browser, so an unsaved replay is gone once you play again or leave.
- **Opening a replay of another island reloads the page** (17). The file is handed over through
  the tab's session storage and opened paused, since sound needs a click first. If it doesn't fit
  there (a few MB), you're told to open that island and then the replay. Its conditions replace
  the ones chosen on the menu.
- **The free camera flies through everything** (17). It stays above the ground and near the
  island, but walls, rocks and trees don't stop it.
- **Seeking starts the scene afresh** (17): the kill feed, hit numbers and the death notice are
  cleared, tracers and debris already flying stay, and the dead fall again from standing. What
  happened before the new moment isn't rebuilt, only the panels.
  **Resolved in part** (22): the dead no longer fall again. The kill events before the new moment
  are handed to the bodies, and a body first seen dead falls to rest at once, exactly where it
  fell in play. Bodies also move on the replay's time: faster at 2× and 4×, still while paused, and
  slowed round the kill in the death cam.
- **The kill feed says "You" for the replay's player** (17), even when a friend watches it, since
  it's shown as the player saw it. Feed rows fade by real time, not replay time.
- **Sounds in replays aren't rebuilt when seeking** (17), and the player's own footsteps only
  play through their eyes. At 4× everything plays four times as often.
- **The live game goes on unseen behind a replay** (17). Watching your run from the results
  keeps the connection; live events are dropped but for keeping the books, and the panels are set
  back to how they stand now when the replay closes.
- **Look angles are rounded** (17). Commands carry yaw and pitch in whole 0.00001 rad steps, so
  the replay stores them as small whole numbers and still replays exactly. It's far below a
  pixel, but it is a change to what the server simulates.
- **The server keeps a human's whole run** (17): every command and a key every 0.5 s, about
  36,000 commands for ten minutes. Fine locally; a multiplayer server should keep it packed.
- **Replays were checked in a headless browser only** (17). The recorder, file, player, frames
  and cover history are tested against a real server run in Node. The viewer, free camera, file
  picker, dropping a file, the handover between islands and the death cam HUD were checked by
  screenshots in headless Chrome, the results-screen buttons and the death cam HUD with a run end
  faked in the page, since a run can't be ended on demand in the browser. Dropping a file was only
  wired, not tried.
  **Resolved** (19): a dev-only message to the local host (`game.dev({ act: 'end', ... })`) ends
  a real run on demand, extracted, killed by the nearest operator bot or missing. The browser
  tests then use every results button (Play again, Menu, the share button, Watch and Save
  replay), the viewer (pausing, speeds by button and key, the timeline, switching to the free
  camera and back, Esc), the file picker, dropping a file on the menu, a file that isn't a replay,
  and the handover to another island, which opens paused, in all three engines. Flying the free
  camera about isn't tested.

### Rivals
- **You can't tell a bot's personality except by how it plays** (18). Names, the kill feed and
  the results screen don't say whether it was a rat, hunter, camper or looter.
- **Operator bots get out less often** (18). In a 30-minute, 6-island bot playtest 13% of their
  runs extract, down from 20% before the personalities: rats 20%, looters 14%, campers 11%,
  hunters 7%. Hunters and campers stay on the island longer by design (up to 4 and 5 minutes into
  the run, or until below 60 health), and guards still do most of the killing. It was tuned from
  hunters at 0%: they now watch fights from 40 m off, 90 m if guards are in it, and 135 m from the
  middle of an outpost, and drop out of hunting when hurt.
- **The kill feed was already there** (18). It came with the run loop; this chunk only marks the
  bounty being killed, and adds a row when someone takes the bounty.
- **Bots know more than they should** (18). They know what every bag within 50 m holds without
  seeing it, and a bot joining a fight goes for exactly where the shots came from, not a guess.
  Everyone is spotted faster and heard farther while carrying the bounty, whether or not the bot
  was told about it.
- **Killing the bounty pays nothing extra** (18). The reward is their loot, left in their bag. The
  bounty goes to whoever carries the most (at least $3,000), keeps to its carrier on a tie, and is
  called every 20 s within 15 m of where they are. It shows in the HUD for 8 s after each call.
- **Bag values show through bushes and grass** (18): the tags only check that walls and terrain
  don't hide the bag, up to 40 m.
- **Campers may wait where they can't see the extraction point** (18). A spot that can see into it
  from a crouch is preferred, but if none of 16 tries finds one, any dry spot 25–45 m off will do.
- **Replays gained the bounty without a new file version** (18). It's an optional part of the file,
  so older replays still play, with no bounty and no bag values.
- **Snapshots are bigger** (18): each carries the bounty, and each bag its value.
- **The rivals HUD was checked by one screenshot** (18): the bounty marker, the line under the
  clock and a bag's value, with the bounty and the bag faked in the page in headless Chrome. The
  "you carry the bounty" line and the feed rows were not seen. The bots' personalities, the bounty
  and bag values on the server are covered by tests.
  **Resolved** (19): the browser tests take the bounty by carrying the most (the line and its feed
  row, with no marker of your own), then give a rival more, find its marker by looking where it
  was called, kill it (a feed row marked bounty) and read its bag's value off the tag, all with a
  real game in each engine.

### Licensing
- **The Mixamo soldier's terms need checking** (9). Mixamo allows royalty-free use in games, but
  shipping the raw `soldier.glb` in a public repository and site may count as redistributing the
  asset itself. Replace it with a CC0 character (e.g. Quaternius) if in doubt.
  **Resolved** (11): replaced with Quaternius's CC0 "SWAT" character. Every shipped asset is now
  CC0.

### Code and testing
- **The texture layer list is duplicated** (9) in `scripts/fetch-assets.mjs` and
  `src/client/assets.ts`, and must be kept in step by hand.
  **Resolved** (11): `src/client/layers.ts` is now the one list (name, Poly Haven id, scale, tint).
  The game and the script both import it; Node strips the TypeScript types.
- **The client's rendering, animation and audio have no automated tests** (9). They were checked
  by screenshots only, and nobody has listened to the audio.
  Still true of the rendering and animation after chunk 13; the new snapshot fields they draw from
  (motion, action, suppressor, commander) are tested.
  After chunk 14, the ground paint, occlusion, enclosure, finding the sea, the voice pool and the
  packed sound list are tested. The audio engine itself was only checked in headless Chrome by a
  script outside the repo (offline renders of each sound, and a Mixed game checking the recordings
  decode and the ambience comes up), and still nobody has listened to it.
  **Resolved in part** (19): the browser tests compare screenshots of the island (water, ground
  cover, impostors, cascades, indoor light by day and night) and of the pose viewer's soldiers,
  and decode the sound bank in all three engines to check each shot starts on time. The
  animation is still only checked in still pictures, and still nobody has listened to the audio.
- **The death cam, menu, leaderboard UI and share button have no automated tests** (10). The
  tape replay, share links and leaderboard storage are tested; the rest was checked by
  screenshots in a headless browser only.
  **Resolved** (19): `npm run test:browser` plays the real game in Chromium, Firefox and WebKit
  and tests each of them: the menu (mode, name, conditions in the address, What's new, New island,
  Enter), the board (order, open places, a challenge among your scores and kept in view), the
  share button (the copied link, and the prompt where copying is refused) and the death cam (the
  killer's name and HUD, skipping it, ending by itself, watching it again).
- **The menu's layout is only checked at desktop size** (10). It now scrolls when the window is
  too short, but it wasn't tried at small sizes.
  **Resolved** (12): screenshotted at 800 × 450, 640 × 400, 420 × 600 and 340 × 520. The title
  now shrinks with the window width, the menu keeps a side margin, and windows under 600 px tall
  get a tighter layout. Everything fits down to 800 × 450; at 640 × 400 only "What's new" is below
  the fold. It was checked on a static copy of the menu in headless Chrome, not the running game,
  because headless Chrome renders the game too slowly to screenshot.
- **Gun fitting uses hand-measured fractions** (9) in `src/client/guns.ts`, so a new model needs
  measuring again.
- **The asset script needs an Apple Silicon Mac** (11). It uses `sips` and `pkgutil`, and it
  downloads the arm64 build of the KTX tools unless `ktx` is on the PATH.
  **Resolved** (20): ffmpeg resizes the textures, and the script fetches Khronos's KTX tools for
  macOS (Apple Silicon or Intel) or Linux (x86-64 or Arm). It ran in a Linux x86-64 container
  from a clean checkout; the models and sky came out byte for byte the same. It keeps the
  downloaded originals in `node_modules/.cache/fetch-assets/originals` for the comparison test.
- **The loading screen and asset pipeline have no automated tests** (11). They were checked in
  a headless browser with software and Metal rendering, by screenshot and by timing.
  **Resolved in part** (19): the browser tests check the loading screen gives way to the menu,
  offers to play in flat colours when a download hangs, and says so when one fails. The asset
  pipeline's output (KTX2 against the originals) still isn't compared by number; that's chunk 20.
  **Resolved** (20): `e2e/assets.e2e.ts` measures the textures and the sky against the originals
  (see Performance and loading) and checks the textures load through the new transcoder in all
  three engines. The loading test checks the bar counts everything but a held-back file, and
  that the textures fade in when they arrive after skipping.

- **Snapshots are bigger** (13): each player carries five more fields (motion, action and its
  progress, suppressor, commander). That's fine through the Worker, but multiplayer should pack
  them.
- **The pose viewer isn't part of the build or the tests** (13). `dev/pose.html` runs on the dev
  server only, and its screenshots were read by eye.
  **Resolved** (19): the browser tests open it and compare four pictures: moving (standing to
  climbing), the hands (reloads, a draw, a throw, leaning, aiming up, dead), each gun with a
  suppressor with a commander and a guard, and the first-person arms mid-reload. It stays out of
  the build, as a dev page.
- **The world's new rendering has few automated tests** (15). The terrain tiles (exact heights
  up close, skirts), the wave height, adaptive resolution and the buildings (placement, bot paths
  into both rooms, walking through doorways, lintels falling, crates) are tested. The water
  shader, ground cover, impostors, cascades and indoor light were checked by screenshots only.
  In development, `?cam=x,y,z,tx,ty,tz` (or `?cam=o<outpost>,...` relative to an outpost) holds
  the menu camera for such screenshots.
  **Resolved** (19): the browser tests compare pictures of each at a fixed spot, with the wind,
  waves and rain stood still by the new dev-only `?still=<seconds>`, which also holds the
  resolution.
- **Two tests had leaned on the old outpost layout** (15): the guard test put the intruder at a
  fixed spot, which now sits between two containers, and the mantle test picked a crate that now
  has another stacked on it. They now pick a spot the sentry can see, and an unstacked crate.
- **The browser tests don't run in CI** (19). The deploy workflow still runs only Vitest. The
  tests want a GPU to draw the game at speed; on Linux Chromium is told to use OpenGL
  (`--use-angle=gl`), which hasn't been tried, and neither have Firefox and WebKit on Linux.
- **The screenshots come from one machine** (19): Chromium on an M3 Pro through Metal, at
  640 × 360, kept in `e2e/screenshots/darwin/`. Another machine makes its own on its first run
  (which reports each as a failure once), so they only catch changes on the machine that made
  them. A change to fewer than 1% of the pixels passes. Firefox and WebKit draw the same spots in
  no comparison, only in the UI tests.
- **Pointer lock is never granted in the test browsers** (19), so every test plays with the
  "Click anywhere to resume" card up, and the lock itself and resuming stay untested. Nothing in
  the tests moves or shoots with the mouse and keys; runs are ended with the dev shortcut.
  **Corrected** (20): that was wrong for Chromium and Firefox, which grant the lock on a test's
  real click (Play); only WebKit refuses it. A key pressed by a test doesn't free the lock, so
  Esc can't be tested; freeing it from script and clicking the card resumes (tested).
- **The dev shortcut is a new client message** (19): `{ t: 'dev', cmd }` ends your run, gives
  you or the nearest operator bot loot, brings that bot 8 m in front of you or has you kill it.
  Only the Worker host of a development build passes it on; a multiplayer server must drop it.
- **The benchmark reports and doesn't judge** (19). `dev/bench.html` times each frame until the
  GPU is done with it (a one-pixel read), so it's one frame's whole cost, not the throughput of
  frames overlapping. Firefox and WebKit round timers to 1 ms. The report shows each number
  next to the one kept in `e2e/bench-baseline.json` (an M3 Pro, chunk 19), but nothing fails on a
  slower frame. It runs last, alone, as the teardown of the setup project, so running a single
  engine's tests runs it too, unless `--no-deps` is given.
- **The committed textures weren't remade by the new script** (20). The KTX2 files are still the
  ones `sips` scaled; the script now scales with ffmpeg's Lanczos, and its textures differ a
  little: 0.1 to 0.5 dB lower on colour, slightly better normals. The next run of the script
  replaces them.
- **The texture comparison mixes in the resize** (20). The originals are scaled by the
  browser's own resize, not the one the textures were made with, so part of the measured error
  is that difference. The comparison needs the originals in `node_modules/.cache`, so it's
  skipped on a fresh checkout until `scripts/fetch-assets.mjs` has run.
- **The scripts' CI job hasn't run on GitHub yet** (20). `.github/workflows/scripts.yml` runs
  both scripts on Ubuntu when they or their lists change, and the unit tests on what they make.
  It was run as-is in a Linux x86-64 container (about 8 minutes under emulation), not on GitHub,
  since it isn't pushed. It downloads from Poly Haven, Freesound and poly.pizza every time, so
  a change or a rate limit there fails it. The transcoder's build script isn't in it (it needs
  Docker or Emscripten).
- **A replay test failed in WebKit in full runs** (20): after scrubbing to the start, the
  replay's time had moved on. The test's run is only a few seconds long, and with four workers
  busy the replay could reach its end before the test pressed Space to pause it, which starts
  an ended replay again instead. **Resolved** (20): the test pauses only if it's still playing,
  and waits for the paused state.
- **Soldiers are expensive to draw** (19). In the benchmark, 24 soldiers 4 to 25 m off take a
  Chromium frame from 3.1 to 10.6 ms (Firefox 7 to 16, WebKit 4 to 11). Posing them is only 2.4 ms
  of it: the rest is drawing, about 43 draw calls each with their shadows (1,113 against 86) and
  1.1 million triangles against 0.42 million. Worth merging a soldier's meshes in chunk 21.
- **The ground cover's first fill takes about 21 ms** (19), when every cell in range is scattered
  at once. Crossing into a new cell after that takes about 1 ms (1.7 ms at the 95th percentile in
  Chromium), and into cells seen before about the same, so the copying costs as much as the
  scattering.
### Playtest and tuning
- **Nobody else has played it yet** (12). The chunk's goal, several full runs by other people with
  the average run between 3 and 10 minutes, still waits on real playtesters. Everything tuned so
  far comes from bots.
- **The run log stays in one browser** (12). There's no backend, and since the F4 panel was
  removed there's no way in the game to see or copy it; it's only in localStorage (`runlog`). It
  keeps the last 200 runs.
- **Bot runs can't check run length** (12). An operator bot searches only 1–3 crates and leaves,
  so even its extracted runs last about 1:20. The bot playtest (`npm run playtest`) is good for
  comparing ways of playing and how often operators meet, not for how long a human run lasts.
- **Operator bots still die in most runs** (12). Over 6 islands × 30 min, 19% of their runs
  extract (up from 8%), 81% are killed, and guards do about two thirds of the killing, mostly
  sentries and outpost guards at 40–120 m. Making guards weaker helped bots but would also make
  PvE easier for humans, so guards were left alone until humans have played.
- **Most of the listed tuning wasn't changed** (12): guard count, bot skill numbers, weapon damage
  and recoil, extraction timings and loot values. In the bot playtest the rifle and bolt-action
  came out even (about 210 and 190 points per run), as did light and heavy carrying, so there was
  nothing to fix there without human data. Only the operator cap and operator bot behaviour were
  tuned.
- **The buildings haven't been tuned for** (15). In a 10-minute, 6-island bot playtest, operator
  bots got out of 19% of runs, against 18% before the buildings. The bolt-action's rate fell from
  22% to 11%, but on only about 70 runs each.
- **Operator bots now leave far-off enemies alone** (12). They fight guards only within 40 m, and
  other operators only within their gun's effective range, unless shot at in the last 10 s. That
  applies to human players too, so a bot you spot at long range won't open fire first.
- **The bot playtest leaves out runs still going when it stops** (12), so long runs are slightly
  undercounted. Bots get no contracts, so "contracts done" is always 0% there.
- **Wider drop-in spacing may fall back to anywhere** (12). Insertion points now keep 130 m from
  outposts and 100 m from other operators. When 60 random tries find nothing, the operator drops
  in at any land point, possibly next to an outpost. How often that happens wasn't measured.
- **The run log panel has no automated tests** (12). The records, summary and storage are tested;
  the F4 panel was only checked by typecheck. Resolved: the F4 panel (and the F3 net panel with
  its fake-lag sliders) were removed.

## Future
- **Multiplayer**
  - Node server that reuses `server/`, with WebSocket first
  - Snapshot deltas, interpolation and lag compensation
  - Real matchmaking: the first instance that isn't full, or a new one, for each world
  - Bot fill that shrinks as humans join
  - Anonymous identity, basic anti-cheat, deployment
- **Transport upgrade:** WebTransport or WebRTC DataChannels (UDP-like), server-side visibility
  culling, server leaderboards
- **Replay links:** shareable through the server instead of as files (chunk 17 covers local
  replays)
- Global leaderboards and seasonal featured islands
- **A more realistic soldier model** to replace Quaternius's stylized one (after Phase 3)

### Future game ideas
Layers on top of the core loop, which stays as it is: die = score 0, scores stay comparable, and
extraction stays as hard as it is.
- **Push on:** after extracting, bank the score or drop straight onto the next island of a fixed
  chain (3–5 islands, built from the seed), keeping what you carry. Dying anywhere in the chain
  scores 0. Each chain length has its own board, and the chain goes in the link
  (e.g. `?world=4242&chain=3`).
- **Daily island:** the island and conditions are built from the date, so everyone plays the
  same run that day, and "today's score" links compare fairly.
- **Race:** a minigame inside the normal run, in the existing modes, with its own leaderboard
  of fastest times per island. Every outpost has a race box with a design of its own. Each
  player has their own item in each box: anyone can take theirs, and it never runs out or
  disappears. Taking the first item starts the race and its clock: a speedrun panel with split
  times appears, with a short note explaining the race, since players may start it by accident.
  From then on you can only extract carrying 3 items, from any 3 outposts. Looting goes on as
  normal (ammo, medkits, loot). Extraction windows don't change, dying means no time, and there's
  no bounty on items. Times show their conditions, like scores.
  - The clock starts at the first item, not at drop-in, so random drop-in points don't decide
    times. The walk to the first box isn't timed, and you choose which box to start from.
  - Opening a race box has no confirmation: starting the race by accident is part of the
    friction, and how players discover it.
  - A race run still counts on the score board: extracting scores the loot as normal, and the
    time goes on the race board.
  - Calling extraction without 3 items shows a message saying why ("2/3 race items") and what
    the race needs.
  - Replays already cover proof, as files. The replay viewer and death cam draw the race panel
    and its splits.

## Decisions
- **No slide:** removed after chunk 14 at the user's request. Crouching while sprinting just
  crouches; `Motion` no longer has `'slide'`.
- **Weapons for the proof of concept:** assault rifle, pistol and bolt-action rifle
- **Capacity:** 8 operators (12 until chunk 12's playtest) and about 24 guards per game (tunable constant)
- **Backend:** none for now; the game is local only. Multiplayer is a future feature.
- **After the proof of concept:** chunks 11–18 polish and deepen the local game, and chunks
  19–30 clear the Known Issues. Multiplayer stays in Future and comes after them.
- **No squads:** operators play free-for-all. Squads were dropped because the game's pitch
  ("beat my score") is a solo challenge, and revive would soften "die = score 0".
- **Platform:** desktop only (keyboard and mouse) in current Chrome, Firefox and Safari. Target
  is 60 fps on a mid-range laptop. No touch or mobile support for now.
- **Assets:** simple placeholder shapes until chunk 9. After that, only CC0 assets (Poly Haven,
  ambientCG, Quaternius). Chunk 9 also used a Mixamo soldier, which chunk 11 replaced to leave
  no licensing doubts.
- **Leaderboards are universal across conditions** (16): one board per island and mode, whatever
  the time of day or weather. The plan had them per condition; the user asked to keep them
  universal. A link still carries its conditions, so a challenge is played as it was set.
- **Conditions are fixed presets** (16): day, dusk or night, and clear, rain or fog, fixed for a
  game. The time doesn't pass and the weather doesn't change during a run.
- **Phase 3 choices** (settled before it started): no prone stance; the bounty stays unpaid, since
  the carrier's loot is the reward; scores show their conditions but aren't adjusted for night;
  Freesound's free CC0 previews are good enough, so no API key or original files; a new soldier
  model waits for a later phase.
- **Operator bots' personalities are picked at random** (18), a quarter each, and a test or a
  playtest can fix them with the server's `personality` option. The bounty has no score of its
  own; killing its carrier gets you their loot.
- **Share links carry the sharer's score.** With no backend, leaderboards live in each browser,
  so the link encodes the world config plus the sharer's name and score as the target to beat.
- **Hosting:** a static site (e.g. GitHub Pages or Cloudflare Pages) is needed in chunk 10 so
  that links can be shared. It serves files only; there is still no game server.
- **Existing scaffold:** the uncommitted setup and `src/shared` world generator get reused and
  reviewed in chunks 0 and 1.
- **Loading** (20): the loading screen waits for the early sounds (your own guns and steps, and
  the ambience) as well as the textures and models, so a run is never silent at the start. The
  rest of the sound, the death cam and the replay viewer load behind the menu. Sounds are Opus,
  with AAC for browsers that can't decode it; textures go through our own ETC1S-only transcoder.
- **The sky light stays as tuned** (20): measured, it's 24% brighter than the original sky
  would give, but the lighting was tuned by eye on it, so it wasn't scaled down to match.
- **Testing:** Vitest for the shared simulation (determinism, movement, collision), and from
  chunk 19 Playwright for the game in the browser (`npm run test:browser`: Chromium, Firefox and
  WebKit on the Vite dev server, whose development build has the hooks the tests use).
