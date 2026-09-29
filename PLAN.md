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
- **Trees are procedural** (9), because Poly Haven's tree models are hundreds of MB each. They
  have no LOD or impostors, and they don't sway.
  **Resolved in part** (15): trees are split into 100 m tiles. Tiles within 170–190 m of the
  camera draw every tree in full, and their crowns sway in one wind. Farther tiles draw each tree
  as an impostor: a card facing the camera, with a picture of the tree baked at startup. In the
  shadow pass the card faces the sun, so far trees still cast shadows. The trees are still
  procedural.
- **Water is a flat, see-through plane** (9), with no waves, reflections, shoreline foam or
  underwater effect.
  **Resolved in part** (15): a 240 m grid round the camera rolls with four wave trains, inside a
  flat ring out to the horizon. The sea's depth comes from a height map of the island: shallow
  water is clear and pale, deep water dark, waves die down toward the shore and foam laps along
  it in bands. Below the surface the fog turns murky green. It reflects the sky through the
  environment map, but not the island (see below).
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
- **The animation was checked by still screenshots** (13) of chosen moments in the new pose viewer
  (`dev/pose.html`), plus one screenshot of a real game in first person. Nobody has watched it
  moving at full speed in play, and its cost per frame with many bodies near wasn't measured.
  Each near body now also runs leg IK when crouched, sliding, airborne or leaning, and hand
  orientation and finger curl every update.
  **Resolved in part** (19, 21): the benchmark measures it (see "Chunk 21's cost"). The new clips
  were again checked by still screenshots in the pose viewer (now also showing landings, hits,
  shots, the bolt being worked and each gun's reload); nobody has watched them in play.
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
  **Resolved in part** (27): grass is now placed tuft by tuft in `shared/vegetation.ts`, the same
  tufts the client draws, and a sight line loses up to 85% to each tuft it crosses, by how low and
  how near its middle it passes (thick to half height, thinning to nothing at the top). A lone
  tuft hides a little and a gap hides nothing. Bots hide in bushes tall enough to cover a crouched
  head (1.15 m and up): as cover from a threat, and to wait in while camping, hunting or watching
  a fight. Someone inside a bush sees out of it as if it weren't there. Still open: nothing
  collides with grass or bushes and bullets pass through them (both accepted), and a crouched
  chest is still mostly above the grass.
- **Shadows end at 230 m** (15), and bodies cast them only within 60 m. The cascade patch changes
  three.js's lighting chunk for every scene: any scene with exactly two shadow-casting directional
  lights is taken as cascades. It matches the chunk's text, and fails loudly if a three.js update
  changes it.
  **Resolved in part** (24): a third cascade covers the whole island (2048 px over 1,130 m, so
  about half a metre a texel). It stands still, so it's drawn only when the sun moves, once the
  textures and impostors are in, and at most every 2 s after walls break, and costs nothing on
  other frames. Each lit pixel now reads only the maps it needs. A unit test pins the text of
  three.js's loop the patch replaces, the getShadow call and the uniforms it reads, so a three.js
  update that changes them fails there. Still open: bodies cast shadows only within 60 m, the
  island's map doesn't sway or follow doors, and a scene with exactly three shadow-casting
  directional lights is taken as cascades.
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
  Still there (23): the streaks look like the corrugated metal texture's ridges seen from below,
  catching the sky's reflection, rather than shadow acne; with the light volume they're dimmer
  but still bright against a dark room.
- **The climb is still a pose** (21). The free set of Quaternius's animation library has no
  climbing clip, so a mantle holds the same leg pose, forward bend and hand on the ledge as in
  chunk 13.
- **The crouch-walk is a slow sneak played fast** (21). The library's clip moves at 0.57 m/s and
  crouched bodies move at up to 2.4 m/s, so its strides are lengthened up to 1.8× and it plays up to
  3× faster. At full crouch speed the legs may look hurried.
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
- **Bots never go upstairs** (23). The nav grid is one layer over the ground, so a two-storey
  building's upper floor and stairs don't exist for bots: they path about the ground floor under
  it and never climb to the lookout, and a player up there is only shot at through the windows.
  Loot crates are kept on the ground floor for that reason.
- **Some of the new buildings can't break** (23): a two-storey building's upper floor, stairs and
  ground-floor corner posts, and a hut's concrete floor. The upper storey's walls stand on the
  walls below and fall once everything under them has gone, but its floor stays hanging on the
  posts.
- **Bots only ever open doors** (23), and only by walking into them; they never shut one or use
  a door to block a chase, so an island's doors end up open as bots pass through. A door that
  someone is standing in the way of just doesn't move, with nothing said to the player.
- **Doors swing only on screen** (23). The leaf's collider jumps between shut and open at once;
  its picture swings over 0.35 s. Pressing F waits for the server, so a door opens a round trip
  after the press.
- **The light volume is rough** (23). Cells about 0.5 m across leave a little light leaking at the
  foot of walls; only sky light is counted (no light bounced off the floor, no colour), and only
  what the building itself hides: hills, trees and other buildings outside don't darken a room.
  Materials look only at the four buildings nearest the camera, so a far building's inside, seen
  through its doorway, is lit like the outdoors. Floors under the hemisphere light still look
  brighter than the walls round them. The first-person gun reads the cell it's in, eased over a
  quarter of a second. Tuned (30% floor, 2.6 gain) by screenshots only.
- **Bodies take shadows only near buildings** (23), within 1.5 m of one, as receiving them
  everywhere cost 1–3 ms a frame with 24 near bodies. Out in the open, a soldier in a tree's or a
  wall's shadow is lit as before.
- **The reflection is partial** (24): it holds the terrain, trees, props, rocks, flags and the sky,
  not bodies, bags, grass, bushes, debris, rain, effects or the sea itself, so a soldier wading
  has no reflection. It's a third of the screen's resolution and redrawn every frame the camera
  is above water, whether or not any sea is in view, reusing the last frame's shadow maps. The
  ripples bend it by a fixed share of the screen, whatever the distance. The glass in windows
  still reflects nothing.

### Sound
- **Some recordings aren't what they stand for** (14). The suppressed shot sounds synthesized,
  the rifle and pistol reloads are mixes of other recordings, the bolt-action's shot is a .405
  Winchester lever-action, and concrete footsteps reuse the stone ones played 10% faster. Every
  gun shares the one suppressed shot, pitched per gun, and the bolt-action reloads with the rifle's
  magazine sound.
  **Resolved in part** (26): each gun has a real suppressed shot (a suppressed SIG P226 for the
  pistol, a MacMillan Tac-50 for the bolt-action, and for the rifle a suppressed sniper rifle from
  a US government video, the nearest real one found); the bolt-action fires a Sauer 404 (a
  bolt-action rifle), and reloads with a Mauser K98's bolt going back, rounds pressed in from a
  clip and the bolt going home, cut from one recording by its loudness envelope; concrete has its
  own footsteps. All CC0 previews, checked on their pages by the script. Still stand-ins: the rifle
  and pistol magazine reloads (mixes of other recordings), and the rifle's suppressed shot is a
  sniper rifle's. The Tac-50 recording stays loud for two seconds after the shot (echo or wind on
  a phone microphone, going by the envelope), so only its first 0.9 s is used.
- **The reverb is one generated room** (14), the same everywhere, only louder when walled in.
  It isn't placed in 3D, and a place with no roof yet (every building so far) rings like a room
  when its walls are close.
  **Improved** (15): the outposts' buildings have roofs, so inside them the reverb is right. The
  walled yards around them still ring like a room.
  **Improved** (23): a place with nothing within 12 m overhead counts as only 30% as enclosed, so a
  walled yard echoes a little instead of ringing like a room; the wind and crickets come through
  there as in the open. It's one ray straight up, so an overhang or a tree above counts as a
  roof. Reverb per space is still chunk 26's.
  **Resolved in part** (26): three reverbs, each its own generated impulse: a room (dense early
  reflections, a second's tail), a walled yard (a few distinct slaps 45–170 ms in, a thinner tail)
  and the open (a faint, dark wash dying over nearly 3 s). Where the listener stands is split
  between them by how walled in it is and whether it's roofed; a sound out in the world rings half
  with the listener's space and half with its own (6 rays round it and one up). Your own sounds and
  footsteps ring with the listener's. The returns still aren't placed in 3D, and a roof is still
  one ray straight up.
- **The loading screen waits for most of the sound** (20). The early bank is 150 of the 160
  seconds, because the ambience beds are long: 700 kB of the 4.3 MB the loading screen waits
  for. Loading locally took no longer (1.22 s against 1.26 s), but on a slow connection it adds
  to the wait. Moving the ambience to the late bank would halve it, at the cost of the ambience
  fading in a moment after Play.
- **Sound round corners is worked out on a flat grid** (26). The grid is at ground level, so
  upstairs, on a roof or up a watchtower, routes are worked out as if on the ground below; the
  legs are checked in 3D, so a wrong route is dropped rather than heard, but a right one upstairs
  can be missed. Sound can't go round through an open window, only straight through its gap, and
  goes round only within 48 m; past that it's straight through or over. The losses per material
  and per bend were picked, not measured or heard.

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
  production build loads in 1.1 s cold and 0.4 s warm (3 MB transferred). The new build isn't on
  the live site until it's pushed.

### Sharing and leaderboards
- **The single-file build is checked by hand only** (single file). `npm run build:single` makes
  `dist-single/onepointsix.html`, the whole game in one 8.3 MB page that plays when opened from
  disk: one inline script, workers and `public/` packed in base64 and served to `fetch()` and
  `new Worker` by a small shim in the page. It was checked by opening it from `file://` in headless
  Chromium, Firefox and WebKit (loaded, textured, a run started). No Playwright test covers it,
  since the suite runs on the dev server. The shim covers only `fetch()` and `Worker`, so a new
  loader that uses `XMLHttpRequest`, an `<img src>` or a module worker with imports would break it.

### Day, night and weather
- **Flashlights cast no shadows** (16), so a beam lights the far side of a wall and the room
  behind it. Shadows would need a shadow map per light, drawn every frame.
  **Resolved in part** (25): your own light casts shadows from a 1024 px map, drawn only while
  it's on. Others' lights still don't (see below).
- **Only the two nearest other flashlights light the world** (16). Farther ones show only a faint
  beam and a glare when pointed your way. Three spotlights (yours and two others) are always in the
  scene at dusk and night so switching one on never recompiles a material.
  **Resolved in part** (25): the four nearest now do. With 24 soldiers close up, all lit, in rain
  at night, the benchmark frame costs about 0.5 ms more than the same crowd by day (M3 Pro, a
  noisy run: both about 14 ms with the machine loaded). Past four, still beams and glares only.
- **The look was tuned by screenshots only** (16), on an M3 Pro through headless Chrome. The cost
  of up to 24 beams and glares, three spotlights and the rain on a mid-range laptop wasn't
  measured. The lighting presets, rain, flashlights and menu pickers have no automated tests; the
  config, link, bot senses, night guards and loot do.
- **Night tuning comes from bots only** (16). In a bot playtest (4 islands × 15 min each),
  operator bots got out of 18% of runs on a clear day, 22% in rain, 26% in fog, 12% on a clear
  night, 19% on a rainy night and 24% on a foggy night. So night is the hardest and fog the
  easiest, as intended, but none of the numbers (sight multiples, one extra guard per outpost,
  loot boost, flashlight reach) have been checked by humans.
- **Others' flashlights cast no shadows** (25), nor light the rain: only your own beam makes
  drops glint and throws shadows.
- **Only terrain, props and rocks get wet** (25). Trees, grass, bushes, bodies and debris look as
  they do dry. Puddles are painted by noise on near-flat ground, not where water would gather,
  and don't ripple. The roof map reaches 32 m round the camera; beyond it everything is wet, so
  a far building's floor seen through a door would be too.
- **Outpost lamps cast no shadows** (lamps, after chunk 29). Two or three lamps on poles stand
  against each outpost's walls, lit at dusk and night, but only the four nearest the camera
  really light the world (handed from lamp to lamp as you move, fading over 20 m first; gone past
  150 m, where only the glare shows). With no shadow maps their light goes through walls: a strip
  of ground outside the wall behind a lamp is lit, as can be a building's floor under its roof,
  though lamps stand 9 m clear of the outpost's building. Soldiers cast no shadow under them, and
  the gun in your hands isn't lit by them. The four lights cost no more than the benchmark's noise
  on the rainy night (median 15.1 to 15.6 ms a frame against 15.1 ms without, Chromium, M3 Pro).
- **Lamplight for bots is a disc** (lamps): anyone within 9 m of the spot a standing lamp points
  at, below it and in its line of sight, is seen from as far as by day (as in a bot's own beam).
  Crouching helps only as much as by day. Operator bots don't avoid lamplight, and nobody shoots
  lamps out on purpose; only the player's and stray rounds or blasts do. A shot lamp comes back with the
  other broken panels. Checked by unit tests and screenshots only; nobody has played it.
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

### Rivals
- **Campers may wait where they can't see the extraction point** (18). A spot that can see into it
  from a crouch is preferred, but if none of 16 tries finds one, any dry spot 25–45 m off will do.
  **Resolved in part** (27): a camper first looks for a big bush 25 m out to the range that sees
  into the extraction point, then for any spot that does. A blind camp is looked at again every
  20 s, 10 m farther out each time up to 85 m, and swapped for a spot that sees. In the day
  playtest 19% of first camps were blind and 22 of those 50 later moved to one that could see; the
  rest ran out of range or time. Campers still settle for a blind spot while they look.

### Code and testing
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
- **The browser tests don't run in CI** (19). The deploy workflow still runs only Vitest. The
  tests want a GPU to draw the game at speed; on Linux Chromium is told to use OpenGL
  (`--use-angle=gl`), which hasn't been tried, and neither have Firefox and WebKit on Linux.
- **The screenshots come from one machine** (19): Chromium on an M3 Pro through Metal, at
  640 × 360, kept in `e2e/screenshots/darwin/`. Another machine makes its own on its first run
  (which reports each as a failure once), so they only catch changes on the machine that made
  them. A change to fewer than 1% of the pixels passes. Firefox and WebKit draw the same spots in
  no comparison, only in the UI tests.
- **The scripts' CI job hasn't run on GitHub yet** (20). `.github/workflows/scripts.yml` runs
  both scripts on Ubuntu when they or their lists change, and the unit tests on what they make.
  It was run as-is in a Linux x86-64 container (about 8 minutes under emulation), not on GitHub,
  since it isn't pushed. It downloads from Poly Haven, Freesound and poly.pizza every time, so
  a change or a rate limit there fails it. The transcoder's build script isn't in it (it needs
  Docker or Emscripten).
- **Soldiers are expensive to draw** (19). In the benchmark, 24 soldiers 4 to 25 m off take a
  Chromium frame from 3.1 to 10.6 ms (Firefox 7 to 16, WebKit 4 to 11). Posing them is only 2.4 ms
  of it: the rest is drawing, about 43 draw calls each with their shadows (1,113 against 86) and
  1.1 million triangles against 0.42 million. Worth merging a soldier's meshes in chunk 21.

### Playtest and tuning
- **Bot runs can't check run length** (12). An operator bot searches only 1–3 crates and leaves,
  so even its extracted runs last about 1:20. The bot playtest (`npm run playtest`) is good for
  comparing ways of playing and how often operators meet, not for how long a human run lasts.
  **Resolved in part** (29): `npm run playtest -- 30 12 1 --thorough` has one operator bot at a
  time loot 6–10 crates and carry 30–40 kg, as a person tends to, and keep to every crate it
  planned. Such bots die within a minute like the rest, so they can't be killed: guards' rounds
  hit them for nothing and they don't notice (else they'd stand fighting a guard they can't see
  forever), and they're given ammo when out. Over 12 islands their 46 runs lasted 5:56 at the
  median, 6:09 for the 87% that got out; the other 13% ran out the clock stuck in a fight. So a
  run that isn't cut short by death lands inside 3–10 minutes, but it's a bot's route and fights,
  not a person's.
- **Operator bots still die in most runs** (12). Over 6 islands × 30 min, 19% of their runs
  extract (up from 8%), 81% are killed, and guards do about two thirds of the killing, mostly
  sentries and outpost guards at 40–120 m. Making guards weaker helped bots but would also make
  PvE easier for humans, so guards were left alone until humans have played.
  Still true after chunk 29 (see Rivals): 84% of their runs end in death by day, 82% at night in
  rain.
- **Guards were too deadly for a person** (30). The first human run log (84 runs by the
  developer on seed 1, about half of them tries with no aim to get out) had 88% of runs end in
  death, 77% of those to guards, a median 0:30 into the run, and 42% of guard kills were
  headshots; extracted runs lasted a median 2:30. Two or three guards firing at once was the
  usual way to die. Most guard hits land at 50–100 m, often from towers, and 18% of rounds a
  guard aimed at the body still struck the head, so removing aimed headshots alone changed
  nothing: one head hit (70) and one body hit (28) kill.
  **Resolved in part** (30): guards now take their grade's skill through `guardSkill`
  (`server/skill.ts`): no aimed headshots, aim nearer the hips (so a burst climbs into the chest),
  3× the sway, 30% more aim error and reaction time, 40% slower settling and bursts 40% shorter.
  Their head hits do 0.6 of a headshot's damage (`GUARD_HEAD_SHARE`, 42 instead of 70), a rule
  that applies to guards only; operators, bots and people alike, are unchanged. In the bot
  playtest (6 islands × 20 min) guards kill 127 operators an hour instead of 155 by day and
  136 instead of 146 at night in rain, with 21% and 11% of those kills in the head (38% and 33%
  before); operator bots extract from 19% and 21% of runs (17% and 20%). Those playtests are
  noisy (runs that should come out equal differ by up to 20%), and bots die charging guards, so
  it waits on people playing to say whether it's enough. A limit on how many guards may shoot at
  one person at once was tried and dropped at the user's request.
  **Changed further** (30): guards have 50 health (`GUARD_HP`) instead of 100, so two rifle
  rounds to the body drop one instead of four. Bots now read health as a share of their full
  health (wounded below 60%, ducking into cover when shot at below 70%), so guards don't turn
  timid at half the health. In the bot playtest (6 islands × 20 min) operators kill 181–186
  guards an hour by day instead of 127 and 129 instead of 77 at night in rain, guards kill
  126–146 operators an hour instead of 147–153, and operator bot extraction barely moves (3–5%
  by day, 9% at night in rain): since the extraction fee, what kills bots is the longer search,
  not the guards. For a person, who picks their fights, it should matter far more; not yet
  played.
- **Most of the listed tuning wasn't changed** (12): guard count, bot skill numbers, weapon damage
  and recoil, extraction timings and loot values. In the bot playtest the rifle and bolt-action
  came out even (about 210 and 190 points per run), as did light and heavy carrying, so there was
  nothing to fix there without human data. Only the operator cap and operator bot behaviour were
  tuned.
- **The new buildings were tried by bots only** (23). Two bot playtests of 6 islands × 20 minutes
  each, before and after, came out the same: operator bots got out of 12% of runs before and
  12.5% after (13% → 11% on seeds 1–6, 11% → 14% on seeds 7–12), with the same kill rates. Over
  30 minutes of bot games bots opened 10 doors and broke 5 panes; no roof came down. Nothing
  was tuned, as nothing moved. Nobody has fought through the new buildings.
- **Bot stealth was tried by bots only** (27). Two 6-island × 30-minute bot playtests, by day and
  at night in rain: operator bots got out of 15% and 17% of runs (12% just before the chunk);
  rats 24% and 36%, hunters 6% and 9%. The playtest now prints how often bots take a bush for
  cover and to wait in, how far off their guesses at fights are and how often camps are blind
  (counted in `tally`, a module-level counter in `server/bot.ts`). Nobody has played against bots
  that hide in bushes, and whether they're too hard to find there is untested.
- **Bots don't sneak through grass or bushes** (27). They hide in bushes only to take cover or to
  wait, never pick a route through cover, and rats don't hide on hearing a fight nearby.
- **The thorough playtest isn't a person** (29). Its bots can't be killed, play alone, don't
  notice being shot and never run dry, so it reads how long a full search and its fights take,
  not how often a person survives one. 13% of its runs still end stuck in a fight at 10:00.
- **Extracted runs were short** (30): 2:30 at the median in the first human run log, below
  the 3–10 minute goal; getting in and out with a couple of crates paid.
  **Changed** (30): a pickup now costs 5,000 (`EXTRACT_FEE`), paid from the loot on
  extraction: carrying less, you can't call a pickup or hold a walk-in point, and the HUD says
  so (the pack shows "$X of $5,000", the zone "A pickup costs $5,000 — you carry $X", the pause
  menu how far short you are). Operator bots plan 12 spare crates past their own stops and
  search them, carrying up to 50 kg, until they can pay, even when hurt or short of time. That
  hit them hard: in the bot playtest (6 islands × 20 min) 3% of their runs extract by day (19%
  just before) and 10% at night in rain (21%), their extracted runs last 3:45 and 3:06, and 97%
  and 90% end in death; left as it is for now. Scores kept on leaderboards and in share links
  from before don't pay the fee, so they're 5,000 higher than the same run would score now. The
  dev shortcut that ends a run as extracted skips the check, so the loot's part of a score is
  never below zero.
  **Lowered** (30) to 2,000 after a second tester's log: both of their extractions (on the
  build before the fee) carried under 5,000 (4,900 and 3,250), and none of their 7 runs on the
  current build got out. In the bot playtest operator bots now extract from 9% of runs by day
  (3% at 5,000, 19% before the fee) and 15% at night in rain (9%, 21%), with extracted runs of
  2:19 and 2:16. The HUD texts above follow the constant.

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
  rest of the sound and the death cam load behind the menu. Sounds are Opus,
  with AAC for browsers that can't decode it; textures go through our own ETC1S-only transcoder.
- **Replays removed** (2026-09-28): whole-run replays (chunks 17 and 28: files, a list kept in
  the browser, a viewer with scrubbing and a free camera, and the game run again exactly from its
  log) were dropped. They were a lot of code to keep working: every change to the simulation had
  to keep the re-run exact, tests broke over unrelated changes, and making old replays play on a
  new build would have needed the old simulation kept around. Players mostly want to see how
  they died, which the death cam still shows. Replays may come back from a multiplayer server.
- **The sky light stays as tuned** (20): measured, it's 24% brighter than the original sky
  would give, but the lighting was tuned by eye on it, so it wasn't scaled down to match.
- **Testing:** Vitest for the shared simulation (determinism, movement, collision), and from
  chunk 19 Playwright for the game in the browser (`npm run test:browser`: Chromium, Firefox and
  WebKit on the Vite dev server, whose development build has the hooks the tests use).
