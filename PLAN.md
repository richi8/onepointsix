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
- The world config (the seed) is encoded in the URL. The weather follows from the seed and the
  game's clock (chunk 44), so it isn't in the link.
- Each island has its own leaderboard, whatever the weather: stored locally first, on the server
  once there is multiplayer.
- No share buttons for now (2026-10-02): sharing comes back with multiplayer (see Future).
  Links made before still open their island with the score to beat.

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
- Poly Haven for PBR textures and HDRIs, Quaternius for guns and animation clips, Microsoft
  Rocketbox for soldiers from Phase 5, glTF for models
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
| 39 | **Trees and grass** | Trees from CC0 models, or better generated ones, small enough to download, with impostors baked from them to match; grass that shows blades up close instead of three flat cards, fading to the current tufts farther off; the sight model's cover checked against the new grass; within the benchmark's frame budget | Close up, a tree and a patch of grass look real in a screenshot, and the benchmark holds its frame time | **Done** (generated spruces in two levels of detail, the impostors baked from the plainer one, and blades within 12 m, checked by screenshots; a unit test holds the blades' cover to the sight model's; in runs alternating with the code before on an M3 Pro, the benchmark's frames came out within its noise, the trees costing about 1.1 ms of the 24-body frame before and after. Nobody has looked at it in play) |
| 40 | **Human pass II** | What needs people and hardware: a mid-range laptop for the 5 s load, 60 fps and the adaptive resolution; runs by other people with the stats export; watching the animation, ragdolls, swaying and waves in play; listening to the recordings, reverbs and corners; fighting through the buildings and against bots hiding in bushes; tuning from what they show (guards, weapons, extraction timings and fee, loot, night) | The Playtest and tuning goals are met with human data, and every Known Issue is Resolved, Moot or listed below as left for later | **Done** (checked by hand by the developer and another tester on 2026-10-01; accepted as it looks for now) |

Known Issues that Phase 4 leaves alone:
- **Waiting on multiplayer or a backend**, **accepted as they are** and **decided against**: as
  in Phase 3.
- **Left for a later phase**: a more realistic soldier model ("One stylized soldier model for
  every side"; see Future), the rifle's suppressed shot until a CC0 recording turns up, and
  Firefox and Safari (tested again before release).

### Phase 5: new soldiers (still local only, Chrome only)

The stylized SWAT model gives way to realistic people from Microsoft's Rocketbox library (115
rigged avatars, MIT; see Decisions). Operators are its SWAT officers, guards its soldiers in
camouflage, and commanders its soldiers in caps, so the sides differ by shape, not tint. Picked
on 2026-10-01 after comparing, in the pose viewer's light, Quaternius's Universal Base
Characters (only bodybuilder proportions free, no clothes), MakeHuman bodies dressed in
community clothes (37k–156k triangles and 30–70 MB each as exported, the SWAT pieces CC‑BY) and
Rocketbox, whose avatars came to 10–15k triangles in uniform, share one rig with fingers, bind
in a T-pose and took the Universal Animation Library's clips with only a table of bone names.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 41 | **New soldier pipeline** | A committed script that turns Rocketbox's FBX avatars into the game's glTF (Blender headless, fetched into a cache like the Linux tools; the FBX files and textures shrunk to 1k kept in `scripts/originals`): facial bones, the guns and knives baked into some avatars and unused bones dropped, the meshes merged, textures at 512 px in KTX2; the Universal Animation Library's clips retargeted onto the `Bip01` rig (both bind in a T-pose), replacing the SWAT's own clips; `rig.ts`, hands, leg IK (the feet hang off the shins now, not the root), first-person arms (from the SWAT avatar), the ragdoll rig and hitboxes moved to the new bones; one avatar for every side to begin with | The pose viewer shows every pose and clip on the new body with nothing stretched, and the benchmark's 24-body frame is within chunk 39's | **Done** (`Police_Male_02` for everyone, 9,765 triangles, `soldier.glb` 0.56 MB against the old 0.60 MB; every pose-viewer screenshot re-recorded and looked over; in four runs each alternating with the code before on an M3 Pro, the 24-body frame took 9.1–10.0 ms against 9.6–10.5 ms, in the same 272 draw calls. The thighs were moved onto the pelvis and the collarbones onto the chest; the textures are packed into one 1024 px image each, not kept apart. Nobody has watched it in play) |
| 42 | **Avatars per side** | Operators as SWAT (`Police_Male_02`, `Police_Female_01`); guards as soldiers in helmets (`Military_Male_01`, `_03`, `_04`, `Military_Female_01`, `_02`); commanders as soldiers in caps (`Military_Male_02`, `_05`, `_06`) with the radio; each body's avatar picked from the seed, so the same island looks the same; the code-built kit (packs, webbing, helmet band) dropped where the avatars carry their own, keeping the operators' pack and the commanders' radio; the side tints dropped or kept subtle; Microsoft credited in `CREDITS.md` with the MIT text; level of detail for far bodies if the benchmark needs it | At 30 m an operator, a guard and a commander can be told apart by shape alone, and the download grows by no more than about 3 MB | **Done** (all ten avatars, picked for each body by the island's seed in turn, so an outpost's guards differ; the soldiers in helmets thinned from 13–15k to 10k triangles, the normal maps halved to 256 px a part; the first avatar carries the clips and the others' bones are turned to play them, which saved about 1 MB of clips; the ten come to 3.60 MB against the one's 0.64 MB, 2.96 MB more. All the code-built kit went (the operators' pack, the commanders' helmet band, radio and mast), the ragdoll's pack joint giving way to one inside the back of the ribs that braces the chest as the pack did, and there were no side tints left. At 30 m, at the game's field of view, operators stand out in black; guards and commanders differ by helmet and vest against cap and bare face. Afterwards, at the developer's wish, the clothes were recoloured to suit the island in `scripts/rocketbox.py`, by a gradient map on brightness that leaves skin alone: operators' black a little olive, guards green and commanders brown, which sets the last two apart from any side. In four runs each alternating with the code before on an M3 Pro, the 24-body frame took 8.8–9.9 ms against 8.5–10.1 ms, in the same 272 draw calls, so no level of detail; preparing the ten at load takes about 90 ms against 25. The ragdoll's unit tests now run for every avatar's fall: a body falling into someone standing slides off their side as often as it stops short, and one pile sinks 3.8 cm, so those two checks were loosened. Nobody has watched it in play) |

### Phase 6: day only, changing weather (still local only, Chrome only)

Decided on 2026-10-02: nearly everyone prefers playing by day, so dusk and night go, along with
everything that only served the dark (see Decisions for what was removed and how to bring it
back). In their place the weather changes during a game: clear, rain and fog follow each other
at random, a whole cycle averaging 10 minutes, so most 3–10 minute runs see the sky turn at
least once. One rolling sky for everyone also means matchmaking no longer splits players by
conditions. Players get warning before the weather turns, and every change blends over a
transition rather than switching. The core loop stays as it is.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 43 | **Night out** | Dusk and night removed entirely, with everything that only served them: flashlights (the torch models on the guns, beams and their shadows, beams lighting the rain, bots noticing beams and holders, the key, the killer's flashlight in the death cam, the range's flashlight routine), the outpost lamps (their light and shadows, lamplight for bots, operator bots keeping out of it, shooting lamps out), night's extra and tougher guards and better loot, the night sky, the dusk and night lighting presets and the menu's time picker; the light volume and anything else day still uses kept; old links and scores with a time of day still open and read as day; the browser tests and benchmark cases for night replaced by day ones; the last commit with night in it recorded in Decisions | Nothing in the code mentions dusk, night, flashlights or lamps, every test passes, and the bot playtest by day stays at 15% ± 3 | **Done** (all of it removed, with the crickets that only sang after dark, which took the ambience sounds from 589 to 455 KB; old links and scores with a time of day open by day in their weather, and the leaderboard now shows each score's weather, "Clear" where it said "Day". The dusk, night and lamp screenshots gave way to an inside corner, the outpost on a clear day and an outpost's yard dry and wet by day; the benchmark's rainy night to the crowd in the rain, 13.2 ms, its baseline re-recorded. The bot playtest by day: 14% extracted. Old "What's new" entries still tell of night, as the record of past updates, and tests pass old links with a time of day on purpose) |
| 44 | **The weather cycle** | Weather becomes a function of the island's seed and the game's clock, worked out in shared code so the server, bots, the client and the death cam agree: the next weather picked at random from the other two, each phase's length at random, clear lasting longest (about 5 min clear, 3 min rain and 2 min fog on average, so 10 min a cycle), with a blend factor across each transition; bots' sight and hearing read the blended weather every tick; the link and the menu lose the weather (old links still open, their weather ignored); leaderboards drop each score's conditions and the results show the weather at extraction | Unit tests show the same seed and clock giving the same weather on server and client, a run sees the weather change, and a death cam plays in the weather its kill happened in | **Done** (`src/shared/weather.ts`: phases 60–140% of their average, changes 30–60 s; every game opens clear, a random way into its first spell, so the menu shows a clear island; any 10-minute stretch sees a change, checked over 100 islands. The unit tests run a server and a client's connection side by side through a change, and a death cam made just before one plays in the weather before it while the game has turned. On screen and in sound the weather switches halfway through each change, chunk 45's to blend; a run's results show the weather it ended in, and the run log keeps it. Screenshot tests hold a weather with `?sky=` in development builds. Seen in the browser on island 359, turning from clear to rain at 2 min. The bot playtest: 15% extracted with the weather changing, 14% held clear) |
| 45 | **Transitions and warnings** | Each change blends over 30–60 s: fog density, sky, sun and ambient light, rain streaks, splashes and the rain bed, the sound muffling, fog banks drifting in and thinning out; surfaces wetting as rain starts, drying slowly after, and puddles filling and draining; about a minute's warning before a change (clouds thickening, the wind rising and far thunder before rain, mist gathering in hollows before fog); a benchmark case for the crossover, when rain and fog both run | Screenshot tests mid-transition look right, a player can tell rain or fog is coming before it arrives, and the benchmark's crossover frame holds the budget | **Done** (`src/client/outlook.ts`, from the forecast and the clock of the moment shown: the clouds turn first, the air's reach blends by ratio, rain comes in as fewer streaks, splashes and ripples and a quieter bed, and the wind sways trees and grass harder or softer and sounds it. Signs start 75 s ahead: before rain the sky greys 60% of the way, the wind nearly doubles, birds hush and thunder rolls 3–4.5 km off, once or twice; before fog, mist gathers by the sea and in valleys and the banks spread from their deepest. The ground soaks in 30 s and dries over 3 min, the puddles fill over 90 s and drain over 6, and soldiers dry in the open once it stops. `Forecast.next` gives the coming change, `Forecast.held` and `?sky=from,to,x` hold any moment for screenshots and the benchmark; six screenshot tests part way through changes. Seen in a game in the browser fed a change 70 s ahead, at 60 fps. The benchmark's rain-to-fog crossover: 11.8 to 14.7 ms a frame over four runs, within 0.4 ms of the rain frame each time and under 16.7 ms at the 95th percentile; runs alternated with the last commit's matched it within the noise, and the baseline was kept from one run. Bots don't use the signs: chunk 46) |
| 46 | **Playing the weather** | Operator bots use the weather: rats and looters move in fog, hunters push under rain's cover, campers hold as sight shortens; the bot playtest run over the cycle instead of fixed day and rainy-night runs; the changelog, Features and Vision updated; a human pass on how the changes feel in play | The bot playtest stays at 15% ± 3 with the cycle running, and a tester notices and uses the weather turning | |

## Known Issues

Shortcomings of what has been built so far, to improve later. Every chunk adds the gaps it
leaves here. Each item notes the chunk it came from. Items still open, or only resolved in part,
stay here; once an item is fully **Resolved** (or **Moot**), it moves with how it was resolved to
[KNOWN_ISSUES_HISTORY.md](KNOWN_ISSUES_HISTORY.md).

### Look and animation
Nothing open: the last was resolved on 2026-10-02 (see the history).

### Sound
Nothing open: the last was resolved on 2026-10-02 (see the history).

### Day, night and weather
- **The mist lies by the ground at either end of a view** (2026-10-03): how high the mist stands is
  taken as changing evenly from the ground under the camera to the ground at what's seen, so a
  ridge or a hollow between the two doesn't count, only its ends.
- **The mist ahead of a fog rides in the fog's near distance** (45): three.js sends a linear fog
  only its near and far, so the mist level is packed into the near distance's multiples of 4096
  m (`mistNear` in `fogbanks.ts`). Anything else that reads `scene.fog.near` gets the packed
  number; only the sea's underwater fog does, saving and restoring it whole.
- **Puddles in the sun after rain look pale** (45): once the ground has dried round them, the
  puddles left mirror a bright sky and read as light patches more than water.
- **Nothing warns that the weather is clearing** (45): before rain or fog lifts, the clouds only
  brighten a little; the plan asked for warnings of rain and fog only.
- **The menu's weather stands still** (44): back on the menu, the island keeps the weather it was
  last shown in, while the game kept for two minutes behind it goes on turning; joining that game
  again switches to its weather at once.

### Code and testing
Nothing open: the last was resolved on 2026-10-02 (see the history).

### Playtest and tuning
Nothing open: the last was resolved on 2026-10-02 (see the history, and the bot extraction
baseline in Decisions).

## Future
- **Multiplayer**
  - Node server that reuses `server/`, with WebSocket first
  - Snapshot deltas, interpolation and lag compensation
  - Real matchmaking: islands are always randomly generated (no picking one on the menu), and
    **Play** throws you into the first game that isn't full, on whatever island it runs, or
    starts one on a new random island (conditions no longer split players: always day, with the
    weather changing during a game, from Phase 6)
  - Bot fill that shrinks as humans join
  - **Sharing comes back:** the menu's Share link and the results' share button were removed on
    2026-10-02 until then. The plan for it: Share link makes a fresh, randomly seeded private
    island that only players with the link join, so friends take its bots' slots and quick join
    never fills it with strangers (built once and reverted, commit 5ea65d8)
  - **Scoreboard on Tab:** held during a run, it shows every operator in the game who is a
    player, bots left out, with their kills and deaths, best run score and cumulative score. Esc
    stays the pause screen it is now
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
- **A more realistic soldier model** to replace Quaternius's stylized one: planned as Phase 5

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
  19–30 clear the Known Issues, and chunks 31–40 the rest of them. Chunks 41–42 replace the
  soldiers. Multiplayer stays in Future and comes after them.
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
- **Rocketbox soldiers under MIT** (2026-10-01): the soldiers come from Microsoft's Rocketbox
  avatars, which are MIT, not CC0; MIT asks only that the licence text and Microsoft's
  copyright go with them, in `CREDITS.md`. The user also allowed CC‑BY for soldiers' clothes
  that day, for the MakeHuman route Rocketbox replaced; nothing CC‑BY is used now. Everything
  else stays CC0.
- **Bot extraction baseline** (2026-09-30): operator bots extracting from 15% ± 3 of their runs by
  day in the bot playtest (`npm run playtest`, 6 islands × 30 min, seeds 1–6) is where the user
  wants it; at night in rain it was about 20% until night was removed (Phase 6). Changes to bots, guards, loot or the island keep it
  within that band, and a change that moves it out says so.
- **Leaderboards are universal across conditions** (16): one board per island and mode, whatever
  the time of day or weather. The plan had them per condition; the user asked to keep them
  universal. A link carried its conditions, so a challenge was played as it was set, until the
  weather began changing during a game (chunk 44): links and scores carry no weather now, and the
  results show the weather the run ended in.
- **Conditions are fixed presets** (16): day, dusk or night, and clear, rain or fog, fixed for a
  game. The time doesn't pass and the weather doesn't change during a run. Replaced on 2026-10-02
  by Phase 6: always day, with the weather changing on a random cycle.
- **Day only, weather changes** (2026-10-02, Phase 6): nearly every tester preferred day, so dusk
  and night are removed entirely, not left switched off. Clear, rain and fog follow each other at
  random (never the same twice running), a cycle averaging 10 minutes with clear lasting longest,
  worked out from the seed and the game's clock, with a warning and a blend at each change. Every
  game opens clear, a random way into its first clear spell (chunk 44, chosen while building it
  and open to change): the island first shows itself in the open, behind the menu too, and a game's first
  change still comes at a different time on each island.
- **Night removed, kept in history** (2026-10-02, chunk 43): the night systems can be brought back
  from version control if wanted. What went: dusk and night lighting and the night sky
  (`lighting.ts`); flashlights (`flashlights.ts`, `torch.ts`, beams and their shadows in
  `locallights.ts`, beams in the rain, bots seeing beams in `bot.ts`, the death cam's flashlight);
  the outpost lamps (`lamps.ts`, lamplight for bots and paths round it in `nav.ts`, shooting lamps
  out); night's extra and tougher guards and better loot (`isNight` in `conditions.ts`,
  `population.ts`, `containers.ts`, `loot.ts`); the range's flashlight routines, the menu's time
  picker and the crickets that sang after dark (Freesound 175020). Built in chunks 16, 25 and 36.
  The last commit with all of it is `7120c80`, the one before chunk 43.
- **Phase 3 choices** (settled before it started): no prone stance; the bounty stays unpaid, since
  the carrier's loot is the reward; scores show their conditions but aren't adjusted for night;
  Freesound's free CC0 previews are good enough, so no API key or original files; a new soldier
  model waits for a later phase.
- **Operator bots' personalities are picked at random** (18), a quarter each, and a test or a
  playtest can fix them with the server's `personality` option. The bounty has no score of its
  own; killing its carrier gets you their loot.
- **No "New island" button** (2026-10-02): removed at the user's request. Islands are to be
  randomly generated and picked by matchmaking (see Future), not by the player; until then the
  menu shows the default island or a linked one.
- **No sharing until multiplayer** (2026-10-02, at the user's request): the menu's Share link
  and the results' share button are gone, and the menu no longer says "Default island". Old links
  still open their island with their score to beat; sharing returns as private islands (see
  Future).
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
