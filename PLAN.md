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
| **Range** | For trying things out by hand: round the island's first outpost, with no guards and no operator bots, about 48 actors each play one routine over and over, between them every way a body moves (walking, running, sprinting and sneaking in circles, crouching, leaning, jumping, aiming, each gun's firing and reload, switching guns, grenades, the flashlight, the watchtower's stairs, climbing onto a crate, a door), and victims are shot from the front, behind and the side, running, or blown up, and get up again after a few seconds. Nothing hurts the player, the run's clock stands still, there are no contracts and nothing counts toward the leaderboard or the run log. |

Mixed was renamed Online, and old `mode=mixed` links and scores count as Online. PvE and the
shooting range were removed after chunk 16: PvE became Offline, which has 7 bot operators, and the
range with its target dummies is gone. The range came back after chunk 35 as a place to watch
every animation (see `src/server/range.ts`), with actors instead of dummies.

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
- A bot's kind is told once it dies (the feed, its bag) or kills you (the death cam, the results)
  (chunk 29)

### Shareable worlds and leaderboards
- The world config (seed, time of day and weather) is encoded in the URL.
- Each island has its own leaderboard, shared by every time of day and weather: stored locally
  first, on the server once there is multiplayer.
- A share button on the results screen.

### Death cam (cheap because the simulation is deterministic)
- The simulation runs on inputs, so the killer's last seconds can be sent as their inputs and
  played back exactly through their eyes.
- Whole-run replays (chunks 17 and 28) were removed: see Decisions.

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
   the death cam possible.

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
| 17 | **Full-run replays** | Record the whole run as inputs plus periodic keyframes (extending the death cam tape); keep cover-state history so replays show panels breaking at the right time; a replay viewer with scrubbing, speed control and a free camera; export and import a compact replay file (no backend, so it's shared as a file); a HUD in the death cam | You finish a run, save the replay, send the file, and a friend watches it exactly as it happened | **Done** (the Save and Watch buttons after a real run were checked in the browser with a simulated run end only); **removed** later (see Decisions) |
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
| 23 | **Buildings II** | Door leaves that open and shut (noise when used, bots open them, cover state and replays keep them); glass in windows that breaks; a breakable roof (panels that drop when their posts go); more building plans (one room, L-shaped, two storeys with stairs) and small buildings outside the outposts; indoor light that comes in through doors and windows (a light volume per building) and dims soldiers and debris inside; walled yards stop ringing like rooms (see chunk 26); bot and tuning playtest with the new buildings | Two outposts on one island look and fight differently inside, and a room is lit from its window | **Done** (bots only: nobody has fought through the new buildings; the light volume and glass were checked by screenshots) |
| 24 | **Landscape rendering** | Tree impostors from several angles with normals, lit like the full trees, cross-faded at the switch, and swaying crowns with swaying shadows; the sea reflects the island (a low-resolution reflection pass) and far waves roll; underwater muffles sound and wobbles the view; a third shadow cascade or a baked far-terrain shadow past 230 m; far terrain tiles move what stands on them to the tile's height; distant bushes lose the blue-grey cast; the cascade patch pinned by a test against three.js's chunk; the adaptive-resolution check repeated with chunk 19's benchmark | Screenshots at 200–600 m show no pop, floating trees or pale sea, and the frame budget from chunk 15 still holds | **Done** (checked by screenshots at 200, 400 and 600 m and by the benchmark, which holds 60 fps but comes out 1–2 ms slower than chunk 23 in runs side by side; the far sea still fades into the horizon's haze through the fog; nobody has watched the fade, the swaying or the waves in motion) |
| 25 | **Night and weather II** | A shadow for your own flashlight; more flashlights lighting the world within the budget (checked with the chunk 19 benchmark); a torch model on each gun, the beam from it, and the killer's flashlight in the death cam; bots notice a beam where it lands, not only its holder; rain stops under roofs (a roof height map) and gains splashes, wet surfaces, puddles, thunder and thicker streaks; fog banks and thicker fog in hollows; rain dulls far sound for the player as well as for bots; a night sky for night reflections; leaderboards show each score's conditions next to it (they stay universal, with no night adjustment); sound downloads kept small (see chunk 20) | A night run in rain looks and sounds wet, only outdoors, and a beam over a wall gives its holder away | **Done** (checked by screenshots, the benchmark and unit tests; nobody has played a stormy night; fog banks stand still rather than drift; a bot test covers a beam seen with its holder behind the bot, not literally over a wall) |
| 26 | **Sound II** | Occlusion that goes round corners and through doorways (a path over the nav grid), counts thickness and lets a tree trunk muffle less than a building; reverb per space (a room, a walled yard, the open) instead of one room; the sea placed by the nearest stretch of water, not an average; far fights mixed into one distant-battle bed so they stop filling the voice pool; better recordings where the current ones stand in (a real suppressed shot per gun, a bolt-action shot and reload, concrete footsteps), still CC0 Freesound previews fetched without a key; replay sound rebuilt when seeking, and thinned at 4× | A shot round a corner sounds round the corner, and a long far firefight never cuts off a nearby footstep | **Done** (checked by unit tests and a browser test, not by ear: nobody has listened to the new recordings, reverbs or corners; the round path uses a sound grid of its own rather than the nav grid, which ignores doors) |
| 27 | **Bot senses and stealth** | Grass hides by the tufts actually placed, so a lone tuft hides a little and a gap in a field doesn't; bots look for bushes to hide in; bots know a bag's value only after seeing it, and a bot joining a fight goes for a guess round where the shots came from; bots get the bounty's advantage only once told of it; bag tags are hidden by bushes and grass too; campers keep trying for a spot that can see the extraction point; a self-kill with a grenade gets a death cam (no prone stance, as decided) | A bot playtest shows bots hiding in bushes and searching for shooters instead of walking straight to them, with extraction rates within 5 points of chunk 18's | **Done** (by bot playtests: 15% of operator bot runs extract by day and 17% at night in rain, against 13% in chunk 18 and 12% just before; bots take a bush for 37% of their cover and 35% of their waits; fights joined are guessed 12 m off the shooter on average. Nobody has played against it) |
| 28 | **Replays II** | Replays as the seed plus every input, where the simulation allows it, so everyone is replayed exactly, with frames as the fallback; smaller files (binary, compressed with `CompressionStream`, far bodies at a lower rate); the last few replays kept in the browser (IndexedDB) with a list on the menu; the version is the build's hash, not the newest changelog date; another island opens without a reload; the free camera stops at walls, rocks and trees; seeking rebuilds the kill feed, bodies already lying and the hit numbers; the feed names the player when a friend watches, and fades by replay time; Offline pauses the live game while its replay is watched; the bounty added to the replay format's version | A replay saved yesterday can be picked from the menu and watched, with every body exactly where it was, in a file half the size of chunk 17's | **Done** (a 42 s test run's file is 38% of chunk 17's; the game run again matches every body to the centimetre in unit tests and in the browser tests of each engine, and a file from Chromium ran again exactly in Firefox and WebKit; nobody has watched a replay by hand); **removed**: replays were dropped (see Decisions) |
| 29 | **Rivals and results** | A dead operator's personality shown on the results screen, in the feed after they die and on their bag; operator bot extraction back near chunk 12's 19% without undoing the personalities; a stats page on the menu that reads the run log, with export to a file; the playtest counts unfinished runs, measures how often drop-in falls back to anywhere, and has a bot mode that searches like a human so run length can be read; the share button opens the system share sheet where there is one; PvE's old board removed from storage | You can tell who killed you and what kind of rival they were, and anyone can send their run stats as a file | **Done** (operator bot extraction came back only part of the way: 16% of runs by day over 24 islands, from 14%, and 18% at night in rain, from 16%; the stats page, share sheet and personalities were checked by browser tests, nobody has played with them) |
| 30 | **Human pass** | The chunks that need people and hardware this machine can't give: several full runs by other people (using chunk 29's stats export), a listening pass on the mix, reverb and ambience, a mid-range laptop for the 60 fps and 5 s load targets, Firefox and Safari by hand, and tuning from what they show (guards, weapons, extraction timings, loot, night, buildings, how far operator bots engage) | The Playtest and tuning goals from chunk 12 are met with human data, and every item in Known Issues is Resolved, Moot or listed below as left for later | **Done** (the developer's and a second tester's run logs read, guards softened, contracts paid 5×, an extraction fee, the death record in the export; Safari checked by hand; Firefox by hand and a mid-range laptop weren't tried, and stay in Known Issues for Phase 4) |

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

### Phase 4: clearing the rest of the Known Issues (still local only, Chrome only)

Chunks 31–40 work through the Known Issues Phase 3 left open. The aim is to resolve them, not
to add features: the core loop stays as it is, and the game ideas stay in Future. The same rules
apply: no backend, nothing that breaks the rules that keep multiplayer easy to add later, and
each chunk marks the Known Issues named in its scope **Resolved** (or **Resolved in part**,
saying what's left). The game is built and tested in Chrome only for now (see Decisions), and
the browser tests run on the developer's machine, not in CI (chunk 31). The human pass comes last.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 31 | **Local browser tests** | A browser test for the single-file build opened from `file://`; tests for the lighting presets, rain, flashlights and the menu's condition pickers; the benchmark split out of the default run and its adaptive-resolution check shortened. Rescoped from **Tests in CI** after measuring it: CI's runners have no GPU (see Decisions) | `npm run test:browser` covers the single file and every condition, and runs in about a minute | **Done** (62 tests in 54 s on an M3 Pro, down from about 2.4 min; `npm run bench` 57 s, down from about 1.5 min) |
| 32 | **Cheaper soldiers, full shadows** | Each soldier's meshes merged so it draws in a few calls instead of about 43; the time saved spent on bodies taking shadows everywhere, not only near buildings, and casting them past 60 m; bodies, bags and debris in the sea's reflection, and the reflection skipped when no sea is in view; the island's shadow map following doors, broken walls and swaying crowns; the cascade patch told apart by a flag, not by counting directional lights | The benchmark's 24-body frame is well under chunk 30's, a soldier in a tree's shadow out in the open is shaded, and a wading soldier is reflected | **Done** (24 bodies: 1,151 draw calls to 245 and 14.4–14.9 ms to 10.8–11.2 ms a frame in one session on an M3 Pro, bodies now shaded everywhere; screenshot tests of a soldier in a tree's shade and one wading. The island's map doesn't sway: accepted, see the history) |
| 33 | **Animation III** | Feet placed on the ground under them on slopes and steps; hit reactions that depend on where the round came from, and a shooting motion per gun; the crouch-walk paced to its speed; a real climb (keyframed by hand or from another CC0 set); reloads with moving parts (a bolt handle, a slide and a magazine as their own meshes; the old magazine drops; the bolt-action loads the rounds it needs); first-person arms of the right proportions; the points on the guns snapped to their geometry | In the pose viewer and in play, a body climbs, reloads, takes a hit from the side and stands on a slope like a person | **Done** (in the pose viewer, with screenshot tests of a climb, hits from the side, a slope and dropped magazines; not watched in play. The climb is keyed by hand, the fast crouch is the run clip played low, and the library's pistol shooting clip wasn't moved over, so each gun's kick is keyed instead. Posing 24 near bodies about 2.5 to 2.8–2.9 ms) |
| 34 | **Ragdolls II** | Bodies collide with living soldiers; elbows and knees bend one way only; a body that died out of sight lets go of its grip; the feet turn at the ankle; a grenade pushes bodies already down; two bodies landing on each other at once play back the same in the death cam; operators' bodies stay until they come to rest | A pile of bodies near a grenade shifts, nothing bends backward, and every death cam falls as the game did | **Done** (by unit tests, pose viewer screenshots of a pile before and after a grenade and of a body against someone standing, and a browser test of a fall in play and in the death cam, bit for bit; not watched in play. Bodies left behind stay 30 s, not only until at rest. Posing 24 living bodies costs the same as before, within a noisy session's spread) |
| 35 | **Buildings III** | A nav grid with floors, so bots take the stairs and fight upstairs (loot crates may then go upstairs); every part of a building can break, the upper floor falling once its posts go; door leaves whose colliders swing with the picture and open at once on your own screen; bots shut doors behind them and use them to block a chase; a door that someone stands in the way of says so; watchtowers and containers built with real geometry; the streaks on the ceilings | Bots clear a two-storey building room by room upstairs, and a building can be brought down whole | **Done** (by unit tests: paths walked up to the crate upstairs and back out on every seed with a two-storey building and up every watchtower, a guard going upstairs to a shot heard there, guards shutting doors behind them and an operator slamming one on a chase, four posts bringing an upper storey down whole; a browser test of a door opening at once with 400 ms of lag; screenshots of a watchtower, a container and the plain ceiling. Not watched in play. "Room by room" is a bot looking into what it heard, not a sweep of the rooms. A bot playtest came out as before, 9% of operator bots out by day, and simulated faster, 31 s against 35 s, as boxes now have one shape) |
| 36 | **Lights and wet** | Others' flashlights and the outpost lamps cast shadows, within a budget checked by the benchmark (nearest first); more than four lights light the world, farther ones cheaply; others' beams light the rain; lamplight for bots follows the lamp's cone and is blocked by walls, operator bots keep out of it, and anyone can shoot a lamp out on purpose; the light volume darkened by hills, trees and other buildings, used for far buildings too, with no leak at the foot of walls and floors no brighter than their walls; trees, grass, bushes, bodies and debris get wet; puddles where water gathers, rippling in rain; the roof map reaching far enough that a far floor stays dry | At night a lamp behind a wall leaves the far side dark, a rainy night looks wet on everything, and the benchmark's rainy night holds its frame time | **Done** (screenshot tests outside the wall behind a lamp, now dark, the lamps' shadows over a yard and a yard under a lamp on a rainy night, wet with puddles; unit tests of the lamps' cone and walls for bots, paths round lamplight and a bot's shot meeting a lamp; the benchmark's rainy night 14.6 ms against 14.9 ms for the code before in one session on an M3 Pro. Lights past the 16 nearest and shadows past the six nearest are left out; not watched in play) |
| 37 | **Sound III** | Sound round corners worked out with floors, so upstairs, roofs and towers route properly; sound going round through open windows; rounds past 48 m; reverb returns placed in 3D, and a roof found by several rays, not one; the ambience beds moved off the loading screen's wait (or cut shorter), so the first load is lighter; the last stand-ins replaced (the rifle and pistol magazine reloads, the rifle's suppressed shot) with CC0 recordings, if they can be found | A shot from upstairs is heard from the right place below, and the loading screen waits for well under the 4.3 MB it does now | **Done** (from the ground floor, a shot upstairs comes from the foot of the stairs, muffled 0.47 against 0.97 straight through the floor; the loading screen waits for 3.97 MB, down from 4.55 MB just before: the scripts had grown since the 4.3 MB was measured; the rifle's suppressed shot stays a stand-in, since no real one was found) |
| 38 | **Bots III** | Campers never settle for a spot blind to the extraction point; bots choose routes through bushes and tall grass when sneaking, and rats hide on hearing a fight nearby; operator bots survive more of their runs (smarter fights, better cover, retreating when outgunned) without easing extraction, the fee or the guards | A bot playtest shows operator bots extracting from more runs than chunk 30's 9% by day and 15% at night in rain, with extraction as hard as before | **Done** (by bot playtests of 6 islands × 20 min: 13% by day and 18% at night in rain on seeds 1–6, against 9% and 15% just before, and 13% and 18% against 10% and 17% on seeds 7–12; guards, the fee and extraction unchanged. Campers never wait blind, rats lie low when a fight breaks out nearby, and sneaking bots keep to bushes and tall grass, which cover little of the island. Nobody has played against it) |
| 39 | **Trees and grass** | Trees from CC0 models, or better generated ones, small enough to download, with impostors baked from them to match; grass that shows blades up close instead of three flat cards, fading to the current tufts farther off; the sight model's cover checked against the new grass; within the benchmark's frame budget | Close up, a tree and a patch of grass look real in a screenshot, and the benchmark holds its frame time | Not started |
| 40 | **Human pass II** | What needs people and hardware: a mid-range laptop for the 5 s load, 60 fps and the adaptive resolution; runs by other people with the stats export; watching the animation, ragdolls, swaying and waves in play; listening to the recordings, reverbs and corners; fighting through the buildings and against bots hiding in bushes; tuning from what they show (guards, weapons, extraction timings and fee, loot, night) | The Playtest and tuning goals are met with human data, and every Known Issue is Resolved, Moot or listed below as left for later | Not started |

Known Issues that Phase 4 leaves alone:
- **Waiting on multiplayer or a backend**, **accepted as they are** and **decided against**: as
  in Phase 3.
- **Left for a later phase**: a more realistic soldier model ("One soldier model for every side"
  and "The soldier is stylized"; see Future), and Firefox and Safari (tested again before
  release).

## Known Issues

Shortcomings of what has been built so far, to improve later. Every chunk adds the gaps it
leaves here. Each item notes the chunk it came from. Items still open, or only resolved in part,
stay here; once an item is fully **Resolved** (or **Moot**), it moves with how it was resolved to
[KNOWN_ISSUES_HISTORY.md](KNOWN_ISSUES_HISTORY.md).

### Look and animation
- **One soldier model for every side, told apart only by tint** (9). Commanders look like any
  other guard. Since chunk 11 only the uniform is recoloured, not the whole body.
  **Resolved in part** (13): it's still one model, but the sides now differ in kit as well as
  uniform. Operators carry a pack and bedroll with black webbing, and guards wear brown webbing.
  Commanders (flagged in snapshots) wear a paler uniform, a red band round the helmet and a radio
  with a mast on their back.
- **Buildings are still boxes** (9): the walls, watchtowers, containers and crates are textured,
  but the geometry is primitive. There are no doors, windows or interiors.
  **Resolved in part** (15): every outpost has a two-room concrete building (see below). Its walls
  are breakable panels with doorways and window openings, and lintels over each opening rest on
  the columns either side. Corner posts hold up an unbreakable roof, and there's a table and a
  guarded crate in each room. Everything is still built from boxes, and the watchtowers and
  containers are unchanged.
  **Resolved in part** (35): the watchtowers are drawn from posts, cross braces, a plank deck on
  joists, a boarded parapet and stairs with treads and risers, and the shipping containers from
  corner posts, rails, ribbed steel walls and roof and a pair of doors with locking bars (see
  below for what they collide as). Buildings, crates and walls are still boxes.
- **Trees are procedural** (9), because Poly Haven's tree models are hundreds of MB each. They
  have no LOD or impostors, and they don't sway.
  **Resolved in part** (15): trees are split into 100 m tiles. Tiles within 170–190 m of the
  camera draw every tree in full, and their crowns sway in one wind. Farther tiles draw each tree
  as an impostor: a card facing the camera, with a picture of the tree baked at startup. In the
  shadow pass the card faces the sun, so far trees still cast shadows. The trees are still
  procedural.
- **The soldier is stylized, not realistic** (11). Quaternius's low-poly SWAT character was the
  best rigged and animated CC0 soldier available, but it doesn't match the grounded tone. Its
  helmet hides the face, and its hands stay open instead of gripping the gun.
  **Resolved in part** (13): the fingers now close round the grip and fore-end. The model is still
  stylized, and its helmet still hides the face.
- **Ragdolls have gaps** (22). Bodies don't collide with living soldiers, only with the dead and
  the world. Elbows bend either way, fingers keep the grip of a body that died out of sight, and
  the feet only follow the shins. A grenade doesn't move bodies already down, though a panel
  breaking next to one wakes it to fall further. Two bodies landing on each other at the same
  moment can come out a little differently in a death cam, as their steps needn't line up. Falls
  match only within one browser engine: the engines' `Math` functions can differ in the last
  digit, and a fall magnifies it. Operators' bodies still go after 5 s, so most never come to rest
  in view. It was checked with pose viewer screenshots, unit tests and a browser test; nobody has
  watched it in play.
  **Resolved in part** (34): bodies are pushed off the living, each an upright capsule from feet
  to neck as the server had them at that step; knees bend only forward, elbows only back (and
  down, so an arm held out bends up), and one bent the wrong way when it went limp is kept from
  bending further and let straighten out. The feet turn at the ankle, between drawn up and
  pointed, their toes kept ahead of the shin. A body that died out of sight opens its hands. A
  grenade throws bodies and guns lying within its reach, less with distance, unless a ray from it
  to the body's middle is blocked. Every fall now steps on one clock of the game's time, all
  together in a fixed order, starting on the kill event's step; the living, blasts and breaks
  come in on the step they happened, and the death cam finds each kill by its time (kill events
  aren't replayed), so a death cam falls bit for bit as the game did, pile-ups included (a unit
  test lands two bodies on each other the same however the frames fall; a browser test compares
  a body's fall in play and in the death cam). A body left behind when its player is back in the
  game, or gone, stays until it comes to rest and 30 s after dying, then until it's out of view,
  never more than 60 s, and at most 8 of them. Still: the living aren't moved by a body, and
  their arms and guns don't stop one. Which way a body falls is picked by rays that miss the living and the dead, so it can fall toward someone
  and crumple at their feet. Elbows bend by a guess from the body's front and spine, as the balls
  don't twist, and an arm lying along that guess is left free. Bodies left lying aren't in a death
  cam and are cleared when it starts and ends, and the dropped magazines aren't thrown by a
  blast. Checked with pose viewer screenshots (a pile before and after a grenade, a body against
  someone standing), unit tests and browser tests; nobody has watched it in play.
- **The animation was checked by still screenshots** (13) of chosen moments in the new pose viewer
  (`dev/pose.html`), plus one screenshot of a real game in first person. Nobody has watched it
  moving at full speed in play, and its cost per frame with many bodies near wasn't measured.
  Each near body now also runs leg IK when crouched, sliding, airborne or leaning, and hand
  orientation and finger curl every update.
  **Resolved in part** (19, 21): the benchmark measures it (see "Chunk 21's cost"). The new clips
  were again checked by still screenshots in the pose viewer (now also showing landings, hits,
  shots, the bolt being worked and each gun's reload); nobody has watched them in play.
  Still (33): the climb, hits from each side, the moving gun parts, dropped magazines and feet on
  slopes were checked by still screenshots and unit tests, not watched in play; posing 24 near
  bodies went from about 2.5 to 2.8–2.9 ms in one session on an M3 Pro, the feet asking the
  ground four more times each.
- **World detail was checked by screenshots on one machine** (15). Headless Chrome on an M3 Pro
  holds 60 fps (median 16.7 ms, 95th percentile 18.2 ms) at 1280 × 720 in a Mixed game.
  Draw calls fell from 348 to 239 at the same spawn, and triangles rose from 639k to 736k. A
  mid-range laptop wasn't tried, nobody has watched the swaying and waves in motion, and the
  ground cover's rebuild, when the camera crosses an 8 m cell, wasn't timed.
  **Resolved in part** (19): the benchmark times the rebuild at about 1 ms a cell crossed in all
  three engines (see "The ground cover's first fill"), and the screenshots are now compared by
  the tests. The mid-range laptop and watching it move are left for chunk 30.
- **Bots' floors are only those marked walkable** (35): stairs, a two-storey building's upper
  floor and a watchtower's platform and stairs. Roofs, container tops, crates and wall tops are no
  place for a bot, though a player can mantle onto them, and bots never jump or mantle as part of
  a path. Paths are smoothed only on the ground, so up stairs and across an upper floor a bot
  walks cell to cell. Links between floor nodes are found by a walk along the line between them
  that follows the game's rules closely but not exactly (the edge of the tower's bottom step,
  0.5 m high, isn't counted as an edge). "Clearing a building room by room" is a bot looking into
  what it heard or last saw, which can be upstairs; nothing makes a bot sweep a building's rooms
  in turn. Friends' gunfire is looked into where the friend fired from, so guards now run up the
  watchtower when its sentry shoots.
- **Door leaves count as open for bots' paths** (35): the nav grid keeps clear of every leaf where
  it stands open, and walks through where it stands shut, as bots open doors by walking into
  them. A bot opening a door toward itself is swept back by the leaf, the opener not counting as
  in the way.
- **Doors swing on two clocks** (35): the server swings them each tick and each client each frame,
  so a leaf mid-swing can be a frame apart on the two. A door you swung isn't in the death cam as
  it swung; the death cam shows doors as they stood at its start. Whether someone stands in the
  way is judged from where they stood, not from the leaf's thickness, and on your own screen from
  where you see others, a tenth of a second behind; the server's answer puts it right.
- **Bots slam doors on a chase only rarely** (35): once in two 20-minute bot playtests of six
  islands (in 982 doors shut). It needs a bot getting away from someone seen in the last 6 s,
  within 30 m of the doorway on the side it came from, and a doorway on its way. Nobody has been
  chased through a door by a person, and a shut door only slows a chaser, who opens it.
- **The upper floor rests only on its posts** (35): with every wall under it shot out but the
  posts standing, the upper storey stays up; with the posts gone it falls though the walls stand.
  The landing beside the stairs falls with the posts too. Someone standing on a floor that falls
  just drops. A building's ground storey can't be brought down but a panel at a time, and a
  one-storey building's roof comes down only once everything under it has gone, as before.
- **Towers and containers collide as the boxes they were** (35): drawn from their parts, they
  still stop rounds, sight and bodies as solid boxes, so the finger gaps between a parapet's
  boards, the space between the deck's joists and the underside of the stairs are solid. A
  container's doors don't open. Every watchtower is the same, and the wood is a little darker
  than the boxes were.
- **The light volume is rough** (23). Cells about 0.5 m across leave a little light leaking at the
  foot of walls; only sky light is counted (no light bounced off the floor, no colour), and only
  what the building itself hides: hills, trees and other buildings outside don't darken a room.
  Materials look only at the four buildings nearest the camera, so a far building's inside, seen
  through its doorway, is lit like the outdoors. Floors under the hemisphere light still look
  brighter than the walls round them. The first-person gun reads the cell it's in, eased over a
  quarter of a second. Tuned (30% floor, 2.6 gain) by screenshots only.
  **Resolved in part** (36): each way to the sky counts as much as the sky that way shows outside
  the building, from five spots in it: hills and other buildings (by a ray out to 150 m) hide it,
  and trees' crowns within 45 m (as cones) hide 60% of it. Materials find the building a point is
  in from the island's map, so every building (up to 16; islands have 10 or 11) is lit inside
  however far off. Indoors, a floor gets at most 70% of the sky's light it would facing up, so no
  more than its walls. No leak at the foot of a wall showed in screenshots at dusk, before or
  after; the cells under the floor are filled from the room. Still open: only sky light is
  counted (no bounce, no colour), cells are 0.5 m, what hides the sky outside is worked out once
  per building and not again when another building breaks, and the gun in your hands reads the
  cell it's in.
- **The reflection is partial** (24): it holds the terrain, trees, props, rocks, flags and the sky,
  not bodies, bags, grass, bushes, debris, rain, effects or the sea itself, so a soldier wading
  has no reflection. It's a third of the screen's resolution and redrawn every frame the camera
  is above water, whether or not any sea is in view, reusing the last frame's shadow maps. The
  ripples bend it by a fixed share of the screen, whatever the distance. The glass in windows
  still reflects nothing.
  **Resolved in part** (32): bodies, bags and debris are in it, so a soldier wading is mirrored
  (faintly, as the sea mirrors little when seen from above), and it's drawn only on frames with
  some sea in view. Still open: grass, bushes, rain, effects and the sea itself aren't in it; it's
  a third of the screen's resolution, reuses the last frame's shadow maps, and the ripples bend it
  by a fixed share of the screen; the glass in windows reflects nothing.
- **The sea is looked for by 144 rays** (32): a grid of 16 by 9 across the screen, each marched
  over the terrain to where it meets the surface. Buildings and trees aren't counted, which only
  errs toward drawing the reflection, but a sliver of sea narrower than the grid's spacing (about
  80 px at 1280 wide) between hills can be missed, and there the sea shows the sky's picture
  instead of the island's. It costs about 0.006 ms a frame with no sea in view.
- **Bodies posed only for what's in view** (32): a body is posed while it's on screen, while its
  shadow may fall on screen, or while its flashlight is on within 60 m. One seen only in the
  sea's reflection, above the top of the screen, keeps its last pose there.
- **The climb follows the game's lift, not a person's** (33). The game raises the body straight
  up to the ledge's top in about 0.2 s and then moves it on, so the hand holding the edge can only
  reach it early on; after that the arm points down at it, straight, above it. The ledge's top is
  looked for with the ground's height ahead of the body, which can miss a thin ledge; then it
  guesses 1 m.
- **Dropped magazines are only for show** (33). Each player sees only the ones dropped near them
  and in view (within 90 m), where they saw them fall; they don't land on bodies, go after 90 s,
  and no more than 40 lie about. The rifle's charging handle doesn't move, and the pistol's
  magazine body is a plain box inside the grip.
- **Only the bodies you hit flinch** (33, from 13). Hits are told only to whoever fired, so a body
  struck by someone else doesn't react on your screen, whichever way the round went.
- **The low run is the run clip lowered** (33): the hips tipped and dropped over the run's feet,
  not a crouched run of its own. A foot on a step's edge stands at the step's height, as the
  ground's height counts anything under a player's width.
- **Long guns are held short of the fore-end** (grips, after chunk 35). With the butt against the
  front of the shoulder, the model's short arms can't reach the rifle's or bolt-action's fore-end,
  so the left hand slides back along the gun until it can, as far as the magazine well. The pistol
  is drawn in from 0.5 m until both wrists reach its grip. Checked in the pose viewer, not in play.
- **Bodies step under their head rather than bend to it** (grips, after chunk 35). To put the head
  over its hitbox front to back, the whole body, feet and all, first moves up to 0.3 m, and only
  what's left is taken by the hips and the waist. A crouch keeps the clip's hunch, but its feet
  can stand a little behind the legs' hitbox.

### Sound
- **The rifle's suppressed shot is a stand-in** (14, split out 2026-09-30). It's a suppressed
  sniper rifle from a US government video, the nearest real one found: no CC0 recording of a
  suppressed rifle of its kind turned up (the few suppressed ones on Freesound are made in an
  editor, an air rifle, or a blank-firing BB gun). The rest of the recordings are real (see "Some
  recordings aren't what they stand for" in the history).

### Performance and loading
- **Adaptive resolution is untested on slow hardware** (9) and could flip back and forth.
  **Resolved in part** (15): it did flip. A test with a simulated GPU that is too slow at full
  resolution and comfortably fast one step down saw 121 switches in 10 minutes. Now a step up
  that turns slow within 10 s isn't tried again for 30 s, then 60 s, and so on up to 10 minutes;
  the same test sees fewer than 12. It still hasn't run on real slow hardware.
  **Resolved in part** (24): the benchmark page now slows the GPU on purpose (an extra pass over
  every pixel, weighed so full resolution takes about 25 ms a frame) and runs the game's own
  Resolution on the real renderer for a minute. In Chromium it stepped to 0.85 at 1.8 s and 0.7
  at 3.3 s, then held there at 15.5 ms a frame; a browser test fails if it doesn't settle under
  20 ms within four changes. Only Chromium runs it, and the slowness is simulated, not real
  hardware (chunk 30).
- **The 5 s load target wasn't measured on a mid-range laptop** (11). Locally on an M3 Pro, the
  production build loads in 1.1 s cold and 0.4 s warm (3 MB transferred).
- **The benchmark's empty frame is twice its kept baseline** (32): 5–6.8 ms against 3.1, in runs
  of both the code before chunk 32 and after it in the same session, with the same 95 draw calls
  and 502k triangles as each other. The baseline in `e2e/bench-baseline.json` is older than the
  night case and the far frame, so whether a later chunk made the empty frame dearer or the
  machine was busier wasn't looked into; it wasn't kept as the new baseline.

### Day, night and weather
- **The look was tuned by screenshots only** (16), on an M3 Pro through headless Chrome. The cost
  of up to 24 beams and glares, three spotlights and the rain on a mid-range laptop wasn't
  measured. The lighting presets, rain, flashlights and menu pickers have no automated tests; the
  config, link, bot senses, night guards and loot do.
  **Resolved in part** (31): screenshots outside an outpost at dusk, in rain, in fog, at night
  with your flashlight lit (dev-only `?torch`) and on a rainy night with it; a test that T lights
  the flashlight at night and puts it out, and does nothing by day; the menu's pickers were
  already tested (chunk 19). The dev camera (`?cam=`) now sees the fog a player there would, not
  the menu's thinned fog. The cost on a mid-range laptop still isn't measured.
- **Outpost lamps cast no shadows** (lamps, after chunk 29). Two or three lamps on poles stand
  against each outpost's walls, lit at dusk and night, but only the four nearest the camera
  really light the world (handed from lamp to lamp as you move, fading over 20 m first; gone past
  150 m, where only the glare shows). With no shadow maps their light goes through walls: a strip
  of ground outside the wall behind a lamp is lit, as can be a building's floor under its roof,
  though lamps stand 9 m clear of the outpost's building. Soldiers cast no shadow under them, and
  the gun in your hands isn't lit by them. The four lights cost no more than the benchmark's noise
  on the rainy night (median 15.1 to 15.6 ms a frame against 15.1 ms without, Chromium, M3 Pro).
  **Resolved in part** (36): every lamp within 150 m lights the world and the nearest cast
  shadows (see the flashlights, in the history), so a wall keeps a lamp's light in and soldiers
  and crates throw shadows under them; a screenshot test looks outside the wall behind a lamp,
  where the strip of light used to be. Still open: the gun in your hands isn't lit by them or by
  others' flashlights (it's drawn apart, and the lights are turned off for it).
- **Grass is still crossed cards** (natural grass, after chunk 29). Tufts now take the ground's
  colour at their roots (the terrain's textures, blended by its weights, from a small mip in the
  vertex shader), lean their normals out so a tuft shades like a clump, glow when the sun or a lamp
  is behind them, vary in patches of drier and greener and a finer mottle, and have soft edges by
  alpha-to-coverage. Up close each tuft is still three flat cards; it reads as grass, not as blades.
  Until the textures load the roots keep the blades' own colour. The patches are colour only, so
  what bots see through is unchanged; distant grass looks a touch thinner than before (its alpha is
  thickened by mip level at 0.2 rather than 0.3, which keeps its tops ragged), a little less than
  the sight model's cover. Checked by screenshots only; the frame cost wasn't measured apart from
  the benchmark still passing.
- **Local lights have a budget** (36). At most 16 lamps and others' flashlights light the world,
  ranked by how near the camera they come; past that, the farthest go out at once rather than
  fading. Only the six nearest that cast shadows get a tile of the atlas, 512 px each, all drawn
  every frame; the sea's reflection reuses the last frame's atlas. Shadow offsets were tuned by
  screenshots only. On the benchmark's rainy night (24 lit flashlights near the quarry's lamps)
  the frame held within noise of the code before (14.6 against 14.9 ms median in one session on
  an M3 Pro), with 120 more draw calls; a mid-range laptop wasn't measured.
- **Bots and lamps are unplayed** (36). Only operator bots shoot lamps out, and only one about to
  search a crate or wait in a spot the lamp lights; they do it without a suppressor too, which
  guards may hear. In a bot playtest at night in rain (4 islands × 15 min), they aimed at a lamp
  3 times, and operator bots got out of 16% of runs against 12% for the code before, in the same
  session. Crouching under a lamp still helps only as much as by day.
- **Wet is worked out simply** (36). Bodies, bags and debris dry the moment they're under a roof,
  and are as wet as the ground round them in the open, how much they face up judged from their
  triangles. Puddles form only on the terrain, not on floors or roofs open to the sky. Past 32 m
  from the camera, roofs are known in 2 m cells, so a floor near a far building's wall may be wet.
  Grass and leaves were kept nearly matte when wet, as a gloss turned them grey in screenshots.
  Checked by screenshots only.
- **Sunlight shows down a building's inside corners** (seen in chunk 36): a thin line of sun
  shows where two walls meet inside, a gap in the shadow map at the seam, not in the light volume.

### Code and testing
Nothing open: the last was resolved on 2026-09-30 (see the history).

### Playtest and tuning
Nothing open: everything so far was resolved or accepted on 2026-09-30 (see the history, and the
bot extraction baseline in Decisions).

## Future
- **Multiplayer**
  - Node server that reuses `server/`, with WebSocket first
  - Snapshot deltas, interpolation and lag compensation
  - Real matchmaking: the first instance that isn't full, or a new one, for each world
  - Bot fill that shrinks as humans join
  - Anonymous identity, basic anti-cheat, deployment
  - Left from the local build (see "Moved to Future" in `KNOWN_ISSUES_HISTORY.md`): scores and
    leaderboards kept by the server instead of in links and one browser; every run's stats sent to
    the server; Online taking other players; names filtered and length-checked; conditions picked by
    the server so players don't split nine ways; snapshots and death cam clips packed; death cams
    drawn from everyone's inputs, taped only near someone, and no player sent another's inputs; the
    dev message dropped
- **Transport upgrade:** WebTransport or WebRTC DataChannels (UDP-like), server-side visibility
  culling, server leaderboards
- **Replays** could come back from a multiplayer server, recorded there (whole-run
  replays were built locally in chunks 17 and 28 and removed; see Decisions)
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
  - Proof waits on the server; until then race times are as trustworthy as scores in links. The
    death cam draws the race panel and its splits.

## Decisions
- **No slide:** removed after chunk 14 at the user's request. Crouching while sprinting just
  crouches; `Motion` no longer has `'slide'`.
- **Weapons for the proof of concept:** assault rifle, pistol and bolt-action rifle
- **Capacity:** 8 operators (12 until chunk 12's playtest) and about 24 guards per game (tunable constant)
- **Backend:** none for now; the game is local only. Multiplayer is a future feature.
- **After the proof of concept:** chunks 11–18 polish and deepen the local game, and chunks
  19–30 clear the Known Issues, and chunks 31–40 the rest of them. Multiplayer stays in Future
  and comes after them.
- **No squads:** operators play free-for-all. Squads were dropped because the game's pitch
  ("beat my score") is a solo challenge, and revive would soften "die = score 0".
- **Platform:** desktop only (keyboard and mouse). Target is 60 fps on a mid-range laptop. No
  touch or mobile support for now.
- **Chrome only for now** (2026-09-29): the game is built and tested in Chrome (Chromium in the
  browser tests); the Firefox and WebKit test runs and benchmarks were dropped, and Firefox and
  Safari are tested again before release. Their fixes in the code (the pointer lock's answer in
  Safari, Firefox's late sound start) stay. Sounds come as Opus only, so Safari needs macOS 15.4
  or later; dropping the AAC copies saved 1.6 MB and took the single-file build from 8.3 to
  5.9 MB.
- **Browser tests stay local** (31, 2026-09-29): CI can't draw the game at speed (no GPU on
  GitHub's runners; see "The browser tests don't run in CI" in the history), so
  `npm run test:browser` runs on the developer's machine before pushing, and the deploy is still gated by Vitest only. The
  frame-cost benchmark is out of the default run: `npm run bench`, when rendering cost changes.
- **Assets:** simple placeholder shapes until chunk 9. After that, only CC0 assets (Poly Haven,
  ambientCG, Quaternius). Chunk 9 also used a Mixamo soldier, which chunk 11 replaced to leave
  no licensing doubts.
- **Bot extraction baseline** (2026-09-30): operator bots extracting from 15% ± 3 of their runs by
  day in the bot playtest (`npm run playtest`, 6 islands × 30 min, seeds 1–6) is where the user
  wants it; at night in rain it's about 20%. Changes to bots, guards, loot or the island keep it
  within that band, and a change that moves it out says so.
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
- **Loading** (20): the loading screen waits for the early sounds (your own guns and steps) as
  well as the textures and models, so a run is never silent at the start. The ambience beds
  (from 37), then the rest of the sound and the death cam load behind the menu; the beds fade in
  once they're in. Sounds are Opus (the AAC copies were
  dropped with Chrome only); textures go through our own ETC1S-only transcoder.
- **Replays removed** (2026-09-28): whole-run replays (chunks 17 and 28: files, a list kept in
  the browser, a viewer with scrubbing and a free camera, and the game run again exactly from its
  log) were dropped. They were a lot of code to keep working: every change to the simulation had
  to keep the re-run exact, tests broke over unrelated changes, and making old replays play on a
  new build would have needed the old simulation kept around. Players mostly want to see how
  they died, which the death cam still shows. Replays may come back from a multiplayer server.
- **The sky light stays as tuned** (20): measured, it's 24% brighter than the original sky
  would give, but the lighting was tuned by eye on it, so it wasn't scaled down to match.
- **Testing:** Vitest for the shared simulation (determinism, movement, collision), and from
  chunk 19 Playwright for the game in the browser (`npm run test:browser`, and `npm run bench`
  for the frame-cost benchmark: Chromium on the Vite dev server, whose development build has the
  hooks the tests use; Firefox and WebKit until 2026-09-29).
