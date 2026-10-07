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
- **Weather to play:** always day, with clear, rain and fog turning during a game and showing
  their coming about a minute ahead; fog hides you from sight and rain drowns out your steps,
  and the bots make use of both, so when to move is part of the run.
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
| **Extraction** | The core loop below. 8 operator slots, every one starting as a bot, and the guards. Each player who joins takes a bot's slot, and a bot fills it again when they leave. Until there is a multiplayer server, the game runs locally and nobody else can join. |
| **Deathmatch** | Everyone against everyone: 16 operator slots, filled the same way, and no guards or commanders. Played on a fixed map of its own, the same whatever the world link's seed: Calabianca, a whitewashed town on a hillside above the sea (see Phase 8 and the town under Features). No contracts, extraction points, run clock, bag value or score; crates hold only ammo and medkits. Leaving a game with a kill posts its kills and deaths to the menu's board for the map, best by kills, then fewest deaths. A dead player watches the death cam and respawns when it ends, or at once on skipping it (Space); a bot after as long as a death cam plays. Everyone respawns with the starting loadout at one of the map's 32 spawn points: one taken at random that nobody living is within 30 m of or sees from within 200 m, and no shot was fired within 25 m of in the last 6 s, or else the one farthest from them. Tab shows every operator's kills and deaths, bots included. The weather turns as in Extraction. A game has no time or kill limit; it closes as soon as its last player leaves. Operator bots are all hunters: they roam, follow fights by sight and sound, and go for the nearest crate when short of health or ammo. |
| **Range** | For trying things out by hand: round the island's first outpost, with no guards and no operator bots, about 48 actors each play one routine over and over, between them every way a body moves (walking, running, sprinting and sneaking in circles, crouching, leaning, jumping, aiming, each gun's firing and reload, switching guns, grenades, the flashlight, the watchtower's stairs, climbing onto a crate), and victims are shot from the front, behind and the side, running, or blown up, and get up again after a few seconds. Nothing hurts the player, the run's clock stands still, there are no contracts and nothing counts toward the leaderboard or the run log. |

Online was renamed Extraction on 2026-10-03 (chunk 48): old `mode=online`, `mixed` and `offline`
links, the saved menu choice and Online's scores count as Extraction. Mixed was renamed Online,
and old `mode=mixed` links and scores count as Online. PvE and the
shooting range were removed after chunk 16: PvE became Offline, which has 7 bot operators, and the
range with its target dummies is gone. Offline was removed on 2026-10-03: it played exactly as
Online, and with a multiplayer server a game alone with bots is still just an Online game nobody
else has joined. Old `mode=offline` links count as Online, and Offline's scores joined Online's
board. The range came back after chunk 35 as a place to watch
every animation (see `src/server/range.ts`), with actors instead of dummies.

### World capacity

The island is 800 × 800 m, with 6 outposts. Deathmatch is played on a fixed map instead (since
chunk 52): the town of Calabianca, 135 × 111 m of play inside its walls (since chunk 57; see
Phase 8), set on the south coast of an island of its own as a backdrop that nobody reaches.

| Kind | Count | Notes |
|---|---|---|
| **Operators** (players and fill bots) | **8** per game, **16** in Deathmatch | Every slot starts as a bot. Joining players replace them. |
| **Guards** (world AI) | ~24 | About 3 per outpost, plus patrols. Not in the range or Deathmatch. |

**Why 8:** that's roughly 80,000 m² per operator, which is about a 280 m square each. Runs are
3–10 minutes, and the aim is to meet another operator every 1–3 minutes, while guards fill the
time in between. The plan started at 12, but chunk 12's bot playtest found that at 12 an operator
spotted another every 42 s, 8 every 57 s and 6 every 97 s, so 8 is the middle ground until human
playtests say otherwise. The cap is a single constant (`OPERATOR_CAPACITY`). Deathmatch's 16
(`DEATHMATCH_CAPACITY`) on the town's 135 × 111 m is about 940 m² each, a 31 m square, as on
the proven maps it's modelled on: a fight round every corner, more with its upper floors and
roofs.

## Core Loop

Extraction's; Deathmatch keeps only the fighting (see Game Modes).

1. **Drop in** at any time at an insertion point on the island. Your personal run clock starts.
2. **Receive contracts.** You get 1–2 objectives per run, for example: grab intel from the radio
   tower, destroy a supply cache, eliminate a bot commander.
3. **Loot, fight, sneak.** Search containers, fight AI patrols and other operators, and
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
- Lean left and right (Q/E) round corners and cover
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
- Fence sections, crates, window glass and tables are **breakable panels**, each
  with its own HP, rebuilt a few minutes after they break. No voxels.
- Walls, roofs, floors and stairs are solid and never break (since chunk 49): cover that stays,
  and roofs that can be stood on.
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

### Weather (Phase 6)
- Clear, rain and fog follow each other at random over a game, about 10 minutes a cycle, from the
  island's seed and the game's clock, the same for everyone (chunk 44)
- Every change blends over 30–60 s, with about a minute's signs before it: the sky greying, wind
  and far thunder before rain, mist gathering in hollows before fog (chunk 45)
- Fog shortens everyone's sight and rain both shortens it and muffles noise, for players and bots
  alike; operator bots play it by their kind (chunk 46), reading the signs as players can: rats
  lie low for fog they see coming and then hurry through it, rats and looters take a crate more
  in fog and give it up seeing the fog lift, hunters stay on to hunt while rain is coming or in
  and close in on fights under it, and campers move in nearer their extraction point as sight
  shortens and stay on

### The town (Deathmatch's map, Phase 8)
- Calabianca: a whitewashed town falling from a high street to a harbour, its fights round three
  hubs (the market, the piazza and the palazzo's courtyard), each pair joined by an open way, a
  tight one and one through a building, and districts that play their own way (chunks 55–57)
- Houses entered by their doorways (open: there are no doors since chunk 65), stairs to their upper floors and onto their flat roofs, windows
  to shoot from; bots use the windows and roofs as posts (chunk 58)
- Cover in the streets: the crashed lorry and the stalls in the market, carts, crates, containers
  on the quay, two parked cars and sandbags across the longest views, rubble by the ruined chapel
  (chunks 54–58, 64)
- Its look: plastered and dressed by district, light baked indoors and out, weathered, façades
  with surrounds, shutters, signs and life, Mediterranean trees and a hillside of terraced
  groves round it (chunks 59–63), drawn within the island's frame time (chunk 64)

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
- Operator bots play the weather by their kind (chunk 46; see Weather above)

### Shareable worlds and leaderboards
- The world config (the seed) is encoded in the URL. The weather follows from the seed and the
  game's clock (chunk 44), so it isn't in the link.
- Each island has its own leaderboard, whatever the weather: stored locally first, on the server
  once there is multiplayer. A mode on a fixed map (Deathmatch) keeps its board by the map, whatever
  the seed.
- No share buttons for now (2026-10-02): sharing comes back with multiplayer (see Future).
  Links made before still open their island with the score to beat.
- Holding Tab in a run shows the scoreboard (chunk 47): the players in the game, bots left out,
  with each one's kills, deaths, best run and total score over the game.

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
  stay in one browser, Online and Offline played the same (Offline since removed), names aren't filtered, the server
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
| 46 | **Playing the weather** | Operator bots use the weather: rats and looters move in fog, hunters push under rain's cover, campers hold as sight shortens; the bot playtest run over the cycle instead of fixed day and rainy-night runs; the changelog, Features and Vision updated; a human pass on how the changes feel in play | The bot playtest stays at 15% ± 3 with the cycle running, and a tester notices and uses the weather turning | **Done** (`coverOf` in `src/shared/weather.ts` reads fog's and rain's cover from the senses, so it blends with each change; bots are given `Forecast.next`, as anyone outside sees the signs. Rats seeing fog under 75 s off lie low in a bush near where they are until it's halfway in, unless that would leave too little time to get out; in fog rats and looters plan a crate more, a looter carries 6 kg more, and both keep low only 40% as far from outposts, a rat sprinting and leaving the bushes for straight paths. A hunter under rain stops half as far from a fight, runs in to 45 m rather than 90 and goes twice as far to a noise. A camper moves its camp nearer as sight shortens (the ring scaled by sight, down to 12–22 m in fog), picks again when sight changes by a quarter, ignores noises below 85% of clear sight, and stays up to 90 s longer in fog. The playtest now runs over the cycle by default (since chunk 44) and splits runs by the weather they ended in and by kind and weather. Bot playtest, seeds 1–6: 13% extracted against 15% at the last commit; seeds 7–12: 21% against 18%, so over both, 17% against 16.5%: within the noise. In seeds 1–6, 53 rats lay low for fog, 87 crates were planned more in fog, hunters closed in under rain 47 times, and camps moved nearer 20 times. Four unit tests. Afterwards the bots came to read the other signs too: a hunter stays on 120 s longer to hunt while rain is coming or in, turning back from heading out if it has to, and a rat or a looter seeing a fog lift gives up the crate it took on for it unless within 30 m of it; seeds 1–6 then came to 15% (seeds 7–12: 19%), with 68 of 86 fog crates given up as the fog lifted. The human pass: the developer played it, found it hard to judge but fine, and accepted it) |

### Phase 7: ready for other players (still local only, Chrome only)

Pieces of Future's multiplayer that can be built and tested locally first, so they are in place
when a multiplayer server arrives. Started on 2026-10-03 with the scoreboard. Deathmatch was added on
2026-10-03 as a second way to play for when others join: a plain fight among operators beside
Extraction's runs. The same rules
apply: no backend, and nothing that breaks the rules that keep multiplayer easy to add later.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 47 | **Scoreboard on Tab** | Held during a run, Tab shows every operator in the game who is a player, bots left out, with their kills, deaths, best run score and cumulative score; the server keeps each player's record over the game, across their runs in it, and sends it to every player as an event whenever it changes; Esc stays the pause screen | Holding Tab in a run shows your line, and a kill, a death or an extraction shows on it, carried on to your next run on the same island | **Done** (`src/client/scoreboard.ts`; the records are kept in `GameServer` by a random id each browser keeps and sends in its hello, not by name; kills count guards and operators alike; nothing counts on the range; checked by unit tests with two players in one game and a browser test; locally the board only ever lists you) |
| 48 | **Extraction and Deathmatch** | Online renamed **Extraction** (`mode=extraction`; old `mode=online`, `mixed` and `offline` links, scores and the menu choice count as Extraction, and its leaderboard keeps Online's scores); a new **Deathmatch** mode, everyone against everyone: 20 operator slots, every one starting as a bot and taken by players as they join (a bot fills it again when they leave), no guards or commanders, no contracts, extraction points, run clock, MIA, bag value, score or leaderboard; crates hold only medkits and ammo; a dead player respawns when the death cam ends, or at once if they skip it (a bot after the death cam's length), at a spot away from the others, with the starting loadout; operator bots fight every other operator (no personalities' extraction goals: they roam, loot crates for ammo and medkits, and hunt by sight and noise); the Tab scoreboard shows only kills and deaths, for every operator in the game, bots included; the menu's mode picker gets Deathmatch with its own description; the directory caps Deathmatch games at 20; the weather cycle runs as in Extraction; a game has no time or kill limit and runs until its last player leaves, when the island closes; the changelog, Game Modes, World capacity and Features updated | From the menu you pick Deathmatch, land among 19 bots and no guards, kill and get killed, respawn, and Tab shows everyone's kills and deaths; Extraction plays exactly as Online did, and old Online links and scores still work | **Done** (`MODES.deathmatch` in `src/server/directory.ts`; the server's `deathmatch` option and its bots' `supplies` in `bot.ts`; `npm run sim:deathmatch [seconds] [seeds]` plays games of bots headless and sums them up; checked by `test/deathmatch.test.ts` and `e2e/deathmatch.e2e.ts`; locally the board lists you and 19 bots) |

### Phase 8: a town map for Deathmatch (still local only, Chrome only)

Deathmatch moves off the island to a fixed, hand-made map: a whitewashed Mediterranean town on a
hillside above the sea, flat-roofed, in the spirit of Call of Duty 4's Crash and Call of Duty 2's
Toujane. Proven maps work because every sightline, choke and corner is placed and tuned by hand,
which a generated town can't do. Flat roofs fit what the game already builds well, and make the
rooftops part of the fight; a coastal town keeps the weather believable. Extraction keeps its
generated island. Planned on 2026-10-03.

Chunk 49 (solid walls) stays: it serves every mode. Chunks 50 (town sites on Deathmatch's own
island) and 51 (a town generator) were built on 2026-10-03 and then dropped the same day for this
map, after the user found the generated towns couldn't be made to play or look like a real one
(their commits are `a719a0b` and `0afe4ee`; chunk 52 removes their code). The chunks after 49
were renumbered.

Replanned on 2026-10-04, after the blockout (chunk 54): it played linear and looked the same
everywhere. Four rows of near-identical houses on four full-width terraces, with lanes and cross
streets running straight through, made a grid with no places to tell apart. The town is
rebuilt round three hubs and distinct districts, taking from Crash and Strike (hubs joined by
an open street, a tight alley and a way through a building), Inferno and Mirage (streets that
bend or tee every 20–40 m, named places with a feel of their own, fights inside apartments
over the street), Toujane (a road through, alleys winding beside it, roofs reached but
exposed) and Ascent (a landmark staircase, courtyards, arcades). The new chunks 55–57 come
before the flow, look and dressing, renumbered 58–60.

Extended on 2026-10-04, after the look (chunk 59): it had the right materials in flat light,
the screenshots reading as a game, not a town. Four chunks come before the dressing and speed
(now 64): baked light (60), weathering (61), façade detail (62), and the plants and backdrop
(63), aiming at Inferno's level of realism within the frame budget. Nothing in the town breaks
but windows, crates, fences and door leaves (chunk 49), so its light can be baked.

**The map, as aimed for** (the blockout settles the numbers):
- **Size and players:** about 140 × 120 m of play for **16 operators** (`DEATHMATCH_CAPACITY`
  down from 20), every slot starting as a bot as now. Free-for-all, so no sides: loops
  everywhere and few dead ends.
- **Shape:** the town falls from a high street at the back to a harbour front at the sea. Fights
  turn round three hubs: the **market** low in the middle (a crashed truck, stalls, an arcaded
  loggia), the **piazza** above it in front of the church and its bell tower, joined to the
  market by a grand stair, and the **palazzo**'s courtyard to the east, overlooked by its
  floors and balconies. Each pair of hubs is joined by an open way, a tight one and one through
  a building. Round them, districts that play and look different: **west**, steep stepped alleys
  with arches and rooms bridging them, close fights; **east**, a road climbing in hairpins with
  middling views along each leg, an olive garden between them; the **quay** along the sea,
  split by a warehouse, with a boat yard at its west end and a fish market at its east; the
  **cemetery** with a ruined tower at the top west, and a villa and water tower at the top east.
  Each district climbs its own way (many short flights, the grand stair, the road's ramps), not
  on terraces across the whole town. No street runs straight through: each bends, tees or meets
  a building within about 40 m; the quay and the high street, the longest, are broken by cover
  and a jog.
- **Buildings:** about 35–45, from 6 × 8 m cottages to the 24 × 24 m palazzo, one to four
  storeys, many sharing walls along a street. Some roofs are flat behind parapets and walked;
  others pitched and tiled, out of reach, so the roofs make a fourth lane in chosen places, not
  everywhere, open to shots from below and from higher roofs. Most buildings can be entered,
  some go through from one street to the next, arches and rooms carry over lanes, and there
  are courtyards and arcades. Each district has its own plaster colour even before the look.
- **Edges:** the sea at the front (seen, not played), and the hillside, a cemetery wall and
  tall buildings round the rest, so nobody meets an invisible wall. Beyond, the same kind of
  ground and backdrop as the island's, drawn but not reached.
- **Weather:** the cycle runs as in Extraction: rain on the roofs and in the lanes, puddles in
  the square, night.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 49 | **Solid walls** | Walls, lintels, posts, roofs, upper floors and stairs stop breaking, in every mode: built as a few solid boxes instead of 1.6 m columns in two rows, with what only served them gone (resting and holding for walls and roofs, an upper storey falling with its posts, the light volume and roof map redone for a broken wall or roof, bots' cover going with a wall); windows, crates, fences and door leaves still break and are rebuilt as now; the outposts' perimeter walls and the ruined walls in the fields solid too; Destructible cover in Features updated | No shot or grenade breaks a wall or roof, windows, crates, fences and doors still break and come back, every test passes, and the bot playtest stays at 15% ± 3 | **Done** (each wall stretch, sill, lintel, post, roof, floor slab and stair is one plain prop, and every box says what it is (`Box.part`); panels are only fence sections, crates, door leaves, glass and tables (`timber` became `table`), and only crates rest on crates. A building's roof is one box, or two for an L. Gone with the breaking: resting, holding and `falls`, the roof map and the island map worked out again for a fallen roof, puddles on a floor left open to the sky, and the crumbling-masonry sound (its recording and credit too). Sound through a wall, sill, roof or floor is dulled as through masonry, as before. Unit tests now check walls stop rounds and grenades, and crate stacks, fences and the rebuild in place of walls; the screenshots matched as they were. Bot playtest: seeds 1–6, 18% extracted; 7–12, 19%; the last commit gave 18% and 20% on the same seeds, so no change, though both sit at the top of 15% ± 3) |
| 52 | **A fixed map for Deathmatch** | Remove the towns: Deathmatch's island, `Layout`, `towns.ts`, the town sites, roads, greens, `?cam=t`, the town tests and screenshots, and their changelog's promise (a new entry says what replaced them); their Known Issues move to the history as Moot. Keep what serves every mode (`botDoors`' look-up near the bot, palettes' extra colours if used). A map format: one typed file per map (`src/shared/maps/`) giving the ground (a coarse height grid shaped by hand, with the backdrop round it), the play area's bounds, the buildings (by the kit's data, below), walls, stairs, props and the spawn points; `World` is built from it for Deathmatch, the same on server and client, and from the seed as now for every other mode. `DEATHMATCH_CAPACITY` 16; respawns at the map's spawn points (the farthest clear ones from the living, as now from random spots); the menu's orbit over the map; Deathmatch's board started afresh under the map's name; the weather's seed kept from the game's. A first test map: one street with two plain buildings | Picking Deathmatch loads the test map, 16 bots fight on it and respawn at its spawn points, the server and client build the same world from it, and Extraction's island hashes exactly as before | **Done** (`src/shared/maps/`: `index.ts` holds the format and `mapFor(mode)`, `teststreet.ts` the test map; `new World(seed, map)` builds the map's world, the same whatever the game's seed, with the map's own seed giving the island round it as the backdrop, its trees and rocks kept off the map's ground and that ground bare. A map's buildings are the island's plans, sized by hand, until the kit. `World.bounds` keeps players in (the island's whole square elsewhere) and the nav grid blocks the cells beyond it; hunters roam anywhere on a map. The town tests and screenshots gave way to `test/maps.test.ts`, which also checks Extraction's islands hash as chunk 49 left them, and two screenshots of the test street. Its board is kept under `board:test-street:deathmatch`. On the test street the 16 bots fight at once and no spawn point is ever clear: `sim:deathmatch` over 300 s had 85 kills a minute and 409 of 416 deaths within 15 s of spawning, left for the blockout) |
| 53 | **Building kit** | Buildings for the map from data, not the four plans: any footprint of one or more rectangles, one to three storeys, each wall's doors and windows placed where wanted (and archways right through), shared walls with the next building, stairs inside between floors, a way onto the roof (a stair to a roof hatch, or an outside stair along a wall), parapets round flat roofs, balconies; a door and its leaves, windows and glass as now. Its parts are props as now, so collision, shots, sound and the rain carry over. A test street built from it in the test map | Every room, floor and roof of the test street is reached by a bot's path and walked by a player; shots and grenades stop at its walls; the rain stays off its floors | **Done** (`src/shared/kit.ts` works a map's buildings out as boxes; the format is in `maps/index.ts`: a building is a ground floor and blocks, rectangles on their walls' middle lines of 1–3 storeys of 3 m, optionally open below a storey as a passage, each with doors, windows and arches by side, storey and distance along, and balconies; flights of stairs inside go to the next storey or through a hatch onto the roof, the floor above holed over them and railed along their open side up to their last two steps, so a flight can be stepped off at its end or its side; crates are placed by storey. Walls from every map building are merged along each line and storey, so blocks side by side, of one building or two, share one wall with either one's openings cut through it, a door's leaves swinging into the block that asked for it. Roofs are flat and walked by bots; each roof edge gets a 1 m parapet over a drop, a flush strip over the wall into a roof as high, and nothing against a wall going on up; an outside stair coming up beside a roof opens its parapet round its top steps. The island's plans stay for Extraction, whose islands hash as before. The nav grid takes up to 8 floors over a cell (3 before), as a three-storey house's stacked flights put 7 in one; Extraction's islands have cells with 4, but the bot playtest gave 18% extracted on seeds 1–6 and 19% on 7–12, as at chunk 49. The light inside: an island cell can now point to two buildings' grids, for buildings sharing a wall, and a building taller than its grid's 8 m takes taller cells. The test street has five buildings: a north row sharing walls (two storeys with a balcony and a hatch, three storeys with a room over a passage through to the yard, one storey reached from that room's door onto its roof) and a south row (two rooms with the outside stair, two storeys with a balcony over the street and an arched way through, a hatch from the room over it). `test/maps.test.ts` drives a player along a bot's path from a spawn point into every storey of every block and onto every roof, checks the rain map and something solid over every floor, rounds through every wall stretch and a grenade at each front. `sim:deathmatch` now says where bots spend their time: on the test street, 100% on the ground) |
| 54 | **Blockout** | The whole town in the map file, plain-textured: the levels, the three lanes, the cross streets, the square and its landmark, the harbour front, the ways up to the roofs, the edges, and 24–32 spawn points spread round it. A dev view from straight above, with the lanes and spawn points drawn, to check it against a sketch | 16 bots play ten minutes on it with no one stuck and no spawn in sight of a living operator; a human walks every street, house and roof | **Done** (`src/shared/maps/calabianca.ts`: Calabianca, 136 × 111 m inside its edges, laid out round (0, 0) and moved by `moved()` 240 m south onto island 4's south coast, so the sea lies in front and the island's hills behind. Four levels 3 m apart: the harbour (3 m), the lower street (6), the square's street (9) and the high street (12). Each row of houses stands on one level with its back dug into the next, so its first storey opens onto the street above and a one-storey house's roof carries on from it; the ground falls a level under a walked terrace box 4 m deep (`MapBox.walk`), as the terrain's 4 m grid can't make a sharp step, and the kit runs a roof's edge flush into a terrace as high instead of railing it. 33 houses of one to three storeys from a `house()` template (stairs along the back and east walls, a hatch, an outside stair or the street above onto the roof), three lanes and an alley along each edge with stairs at every terrace, a room over the middle lane at the quay and one over the west lane, the church (one storey, its roof on the high street's level) with a solid bell tower and a fountain on the square, which carries on over the roofs of the two one-storey houses below it. Its edges are the walls along x ±68, the high street's houses' backs and a sea wall, with the bounds a body's width inside them. 32 spawn points. `dev/map.html` draws a map from above, heights shaded, with its lanes (`GameMap.lanes`), spawn points and bounds. On a map, `arenaPoint` wants nobody within 30 m (`MAP_CLEAR`) and nobody seeing the spot, then takes the farthest that nobody sees. The nav grid walks the ground cell to cell except under floors standing on the ground (stairs, terraces), not under every roof, and puts no floor node where an open door leaf stands: searches for such nodes, which no walk reaches, took up to 2.5 s each. `sim:deathmatch` now reports stuck bots (going somewhere and not 2 m on in 30 s) and when the worst tick came. Tests: every room, floor and roof of the town reached by a bot's path and walked by a player, every spawn point reached, rain cover, rounds at every wall, all in `test/maps.test.ts` for both maps; the test street's screenshots gave way to three of the town. `sim:deathmatch -- 600 1,2,3`: 286–308 respawns a game, none in anyone's sight, 30–37% of deaths within 15 s of spawning (90% on the test street), one bot stuck once in three games (in a doorway's corner behind an open leaf), 92–93% of bots' time on the ground. Bot playtest: 18% extracted on seeds 1–6 as before; 21% on 7–12, 19% with the old nav, so the nav change moved those islands 2 points. A human walk of the town is the user's) |
| 55 | **Sketch** | The rebuilt town drawn from above before anything is built, in the map's own coordinates (`dev/sketch.ts`, drawn by `dev/sketch.html` and over the built map by `dev/map.html?sketch`): the ground's height across it, every building's footprint with its storeys, roof (flat and walked, or pitched) and district colour, the hubs, the ways between them by kind (open, tight, through a building, over roofs), stairs and ramps, the long views meant to be there with their lengths, and the spawn zones | The user approves the sketch | **Done** (taken as approved when the user started chunk 56 on 2026-10-04; 42 buildings, 8 spawn zones of 4; `sketchProblems()` finds buildings overlapping each other or a stair, ground ways running into a building other than through its arches, courtyard or arcade, and holes in the ground, and finds none) |
| 56 | **Kit additions** | What the sketch needs that the kit can't build: pitched roofs (solid, not walked, shedding rain), a block round a courtyard, arcades (a ground storey open between pillars), rooms over a lane at any height, ramps for the road (the ground shaped by hand finer than 4 m where it climbs, or walked sloping boxes), a colour per building, and taller rooms for the church; the bell tower entered, if the sketch climbs it | The test street (or a test map of its own) has each of them, walked by a bot's path and a player, rain kept off below them, and the tests pass | **Done** (in the map format, `maps/index.ts`: a block's `roof: 'pitched'` with its `ridge`; its `court`, a rectangle left open inside it, its courtyard walls' openings given with `court` set; its `arcade`, a side of its ground storey opened as `bays` archways between pillars; its own `floor`, with `from` a room over a lane at any height; a building's `storey` height (6 m for a church) and its plaster `colour`; and the map's `ramps`. The kit (`kit.ts`) first places the blocks (`placeBlocks`): a courtyard's block split into four ranges round it, the north and south ones the whole width, its openings and balconies each given to the range whose wall it's in, and a 2.4 m archway at each inside corner on every storey, so the rooms go round; an arcade made its archways. A pitched roof is the flat slab, not walked, under layers stepping in toward the ridge, each 0.6–1.2 m high (more than a step), of a new part, `tiles`, which shelters from the rain, dulls sound and is never a ledge to mantle onto; the client draws it as two slopes reaching 0.25 m past the walls and a gable at each end in the building's plaster, in `structures.ts`, in place of the layers. Flat roofs beside a pitched one take its ridge as its height. A ramp is steps of at most 0.25 m, filled down to the ground, walked by bots as a stair. Walls of a building with a colour are plastered it (`Prop.colour`), flat and as a tint over the concrete, and stretches of differently plastered buildings only meeting at a corner are kept apart; a ground floor raised more than a step above the ground at its middle, as on a terrace, is walked by bots. The test map, `maps/kityard.ts` (Kit Yard, on dev/map.html and behind the menu with the dev-only `?map=kit-yard`): a two-storey house and a cottage under pitched roofs, rooms round a courtyard entered through an arch, rooms behind a five-bay arcade, a hall 6 m tall under a pitched roof, and a house joined by a room over a lane to one on a terrace reached by a ramp, each plastered its own colour. `test/maps.test.ts` walks a bot's path and a player into every room and onto every flat roof of it as of the other two maps, keeps the rain off every floor, and checks each piece: rounds stopped by the slopes, no ledge or floor over them, the courtyard open to the rain and reached from the street, the rooms round it joined upstairs, rounds through the arcade's bays and stopped by its pillars, the hall's ceiling 5 m over its floor, the lane walked under the bridge, a player up the ramp, the plaster. Two screenshots of the yard. The bell tower isn't entered: the sketch doesn't climb it. Extraction's islands, the test street and Calabianca build exactly as before) |
| 57 | **Blockout, take two** | Calabianca rebuilt from the sketch, plain-textured, each district's buildings drawn by hand or from templates of their own, not one house over and over; the spawn points in the sketch's zones; the old layout's Known Issues it moots moved to the history | It matches the sketch drawn over it; 16 bots play ten minutes with no one stuck and no spawn in sight of a living operator; the tests walk every room, floor and roof; a human walks it and finds the districts tell apart | **Done** (`src/shared/maps/calabianca.ts`, 41 buildings in six districts, each plastered its own colour and built by hand from a few helpers: flights along a wall (`along()`), windows set along every wall that isn't shared, buried or on the edge at the district's spacing and width; the bell tower is a solid box. The ground is drawn as levels, rectangles a metre at a time (`maps/levels.ts`): the terrain's points take the lowest level round them, are pushed down under buildings dug in lower, and walked terrace boxes top it up wherever it falls short, so levels step sharply anywhere, not only on the 4 m grid. The road's legs are the kit's ramps; stairs climb in notches cut between houses. 32 spawn points, four in each of the sketch's eight zones. Two changes from the sketch, drawn into it: the caffè runs west to the west's houses (a lane beside it ended at the piazza's face), and the road's first leg climbs west, so its legs make hairpins. Three new tests in `test/maps.test.ts`: the town follows its sketch (every building within 2 m of where it's drawn, as tall and roofed, the rooms over the lanes, four spawn points per zone); nowhere to stand is out of bots' reach (`NavGrid.unreached`), as a search for such a spot looks through the whole town first (the first draft had five balconies without doors, corners by hatches, and a whole storey cut off by a door leaf); and no open door leaf leaves a slot beside it a body is caught in. Crates near a room's walls stand flush against them. The kit's ground floor is walked when it stands over ground lower anywhere under it, not only at its middle. Nav: inside a large floor standing on the ground (a terrace, a ground floor) its top is the cell's ground, walked across the grid (no such floors on the islands); `refresh` drops only the links of cells next to what changed, not of the whole 32 m tiles round them (2.1 M link walks in a 5-minute game went to 0.39 M); and a bot caught somewhere no path goes, as behind a door leaf, starts its path from the nearest spot it walks to in a straight line, which it walks to first. `sim:deathmatch` now also reports the worst tick after the opening. `sim:deathmatch -- 600 1,2,3`: nobody stuck and nobody spawned in sight (likewise seeds 4–6), 27–33% of deaths within 15 s of spawning, 24–43% of respawns finding no spot clear, bots on the ground 92–96% of the time, upstairs 4–7% and on the roofs 1%; worst tick 0.17–0.34 s after the first 10 s, 0.65–1.6 s in them. Ten minutes simulate in 18–23 s, against 30 s for the old town. Bot playtest: 16% extracted on seeds 1–6 (18% at the last commit), 22% on 7–12 (21%). Four screenshots of the town. A human walk of the town is the user's) |
| 58 | **Flow** | `sim:deathmatch` sums where kills and deaths happen (a heat map written to a picture) and which spots kill most from afar; bots use what the town has: upper floors and windows, the roofs and their stairs, the lanes' cover, flanking along cross streets; the map tuned until no spot dominates: windows that see too far given a wall, lanes broken by a cart or an arch, extra ways into houses that get held; respawn spots tuned the same way | The heat map shows fights over the whole town, not one lane; no window or roof gets more than a tenth of the kills; a tester finds it plays like a proven map | **Done** (`sim:deathmatch` on a map now notes where each killer stood and where the victim fell, and lists the places that killed most and most from 30 m or more (a building's storey or roof by the map's name for it, `MapBuilding.name`, or 6 m of street by its nearest lane), the window or roof that killed most, kills from the ground, upstairs and the roofs and from how far, and the spawn points whose operators died soonest; and draws each game's heat map to `test-results/deathmatch-<seed>.png` (`heatmap.ts`): the town from above, deaths as a glow, killers as dots by where they stood, kills from 40 m as lines. Bots on a map (`vantage.ts`): 418 posts, just inside every upper window over a 2 m drop and every 5 m along a walked roof's edge over one, found from the world's panes and roofs where a body stands; a bot closing in on a fight stops 20 m off (40 on the island) and half the time watches it standing from a post 10–40 m from it that looks its way and sees it, otherwise from the street; a hunter roams to a post within 50 m 40% of the time, but not the first time after spawning; ground spots to wait at are taken beside something solid (`streetSpot`: the most of eight directions blocked within 1.2 m); losing a target, a bot flanks to a spot 10–30 m from it, off the line it was looking along, that sees it, half the time a post. Going to a post or at one, a bot keeps to it: it joins no other fight and checks only on noises within 10 m. The map: the hotel's arches no longer line up (the east one 4.5 m south), so the way through bends; a cart in the yard at the road's hairpin and a crate where the quay steps come up, two carts along the high street, and a stack of crates across the quay outside the boat shed's east arch. On a map a spawn point within 25 m of a shot fired in the last 6 s counts as no clearer than one with an operator that near (`arenaPoint`'s `fights`). `test/flow.test.ts`: the posts stand over a drop, looking out, reached by a bot's path; a post picked over a fight sees it; spawns keep away from shots; bots spend more than 8% of 90 s upstairs or on the roofs; the heat map is a PNG. `sim:deathmatch -- 600 1,2,3,4,5,6`: bots on the ground 80–86% of the time (92–96% before), upstairs 10–15% (4–7%), on the roofs 3–5% (1%); 5–12% of kills from windows and roofs, 3–6% from 40 m or more, median 12–14 m; the most from one window or roof 1–5% (the quay house's upper floor, a way through from the market, at 4–10 m); no place on the ground over 3%; nobody stuck. 26–32% of deaths within 15 s of spawning (27–33% before) and 2–6% within 5 s. Worst tick after the first 10 s 0.19–0.61 s. Bot playtest: 17% extracted on seeds 1–6. Whether it plays like a proven map is the user's playtest) |
| 59 | **The town's look** | Whitewashed and ochre plaster, stone at the corners and plinths, painted shutters and doors, window and door frames, cornices and parapet caps, tiled or stone steps, paved lanes and a cobbled square in place of the terrain's grass and dirt, awnings, pots and climbing plants, the church and its tower, the harbour's quay, boats and nets, the backdrop's hills and sea; detail drawn as meshes over the same boxes, so play doesn't change. CC0 textures as now | Screenshots at street level and from the roofs read as a real Mediterranean town, by day, in rain and at night | **Done** (six CC0 Poly Haven textures join the layers (`layers.ts`): plaster (`plastered_wall`), ashlar (`sandstone_blocks_08`), flagstones (`stone_tiles_02`), cobbles (`cobblestone_floor_08`), roof tiles (`clay_roof_tiles_02`) and terracotta floors (`terracotta_floor_tiles`), the arrays going from 10 layers to 16 (1.35 MB to 2.12 MB). A map's paving (`GameMap.paving`, `pavingAt()`): its area in flagstones but where a patch says cobbles, grass or bare earth; Calabianca's squares, courtyards and road cobbled, the olive garden and cemetery grass, the boat yard bare. The terrain's material reads it from a texture over the area at 0.5 m (`townPaint`) and lays the paving over its own layers, the grass's tint divided back out of the stone; footsteps on it sound of stone (`surface.ts`), as on the town's stairs, flat roofs and terraces, and grass in the garden; no pebbles lie on it. How the town's props are textured (`townlook.ts`): walls plastered, floors and flat roofs terracotta over plastered ceilings, stairs, terraces and freestanding walls ashlar, topped by the paving round them; doors painted one of four colours. A layer per instance or vertex can now say a layer on top and another on the sides (`faces()`), none (`UNTEXTURED`), or one laid by the vertices' metres (`UV`), so the pitched roofs' tiles run down their slopes. The dressing (`dressing.ts`), drawn only, as one instanced mesh of boxes: every storey of every wall (`World.facades`, the kit's walls) is walked every 0.25 m for where it looks outdoors and whose it is, and gets a stone plinth along its building's ground storey, a cornice under its roof, string courses and quoins where its building has them (`MapTrim`, by district), stone surrounds round its windows, doors and arches (a keystone over an arch), louvred shutters folded back beside its windows, window boxes of flowers on upper storeys, creepers in bloom and striped awnings by its street doors; parapets, balconies' railings and freestanding walls are capped. The features (`features.ts`): a map's boxes say what they are (`MapBox.look`), and the truck, stalls, carts, fountain, plane trees, olives, memorial, kiosk, hauled-out boats, water tank and tombs are drawn in place of their boxes (`replacedProps`), the bell tower gets string courses, an open belfry, a clock and a tiled pyramid roof, the church a rose window, and the quay bollards, heaps of nets and six boats moored off it. Each district is plastered paler than the sketch's colours. Two old bugs found on the way: the shader warm-up drew a map's empty watchtower mesh past its buffer (the 'Vertex buffer is not big enough' warnings in the town), and the kit yard never took its textures (`Structures.applyAssets` failed with no containers to colour). Tests: `test/townlook.test.ts` (the paving, its sounds, the props' layers, no trim inside a room, each feature in place of its box); the town's four screenshots redone and four added: the market in rain, the roofs, the harbour, the cemetery. Extraction's islands, the test street and Calabianca build exactly as before, and the island's screenshots match. Warm loads 2.0 s for the island and the town, as before. No night to show: the game has been day only since Phase 6, so fog was looked at instead. Whether it reads as a real Mediterranean town is the user's) |
| 60 | **Light** | Ambient occlusion and bounce light baked for the town's static parts (walls, floors, roofs, stairs, terraces, the dressing and features; only windows, crates, fences and door leaves break, so nothing else goes stale): dark where wall meets ground, under eaves and cornices, in reveals and at the back of lanes, the shady side of a street lit warm by the plaster facing it, and rooms inside lit from their doors and windows, so every building is lit inside, not only the 16 the indoor light keeps grids for; baked when the build runs (or at load if that's quick enough), stored small, and redone in a test when the map changes; a CC0 sky photograph (Poly Haven HDRI) for the sky and its light by day, with clouds, the generated sky kept for night and rain where it serves better; colour grading (a look-up table, the tone mapping compared with AgX), and the screenshots' sun set so shadows model the buildings | Side-by-side screenshots against chunk 59's (piazza, alley, roofs, market, by day, in rain and at night) read as lit by a real sun and sky, rooms inside are darker than the street, and the benchmark holds its frame time | **Done** (baked at load, not when the build runs: the whole volume, 286 × 42 × 238 cells of 0.5 m with six faces each, came to 16 MB gzipped (4 MB brotli at 6 bits), so it's baked in a worker as the town is built, about 3 s from opening the page on an M3 Pro (1.8 s after the loading screen), and fades in; nothing is stored, so nothing goes stale, and `test/townlight.test.ts` bakes the town every run. `townbake.ts`: cells solid where a box fills much of one or runs through it as a slab (so a 0.3 m wall always shuts it) or the ground fills half; panels (glass, door leaves, crates, fences, tables) left out, doors baked open. The light is carried by sweeps, layer by layer along 40 directions over the sky and 48 all round, not by rays from each cell: one sweep toward the sun, then the sky's share, then light bounced once off what each cell sees (the sky's on a face, and the sun's where the cell in front of it is sunlit), each summed into an ambient cube of six faces; a solid cell takes each face's light from the open cell on that side, so a wall's two faces each read their own side with plain trilinear filtering. Stored as four RGBA volumes stacked in one 3D texture (materials had run out of texture units at 17): the sky's share, the sun's bounced on each face, and its colour. `townlight.ts` reads it in `indoorSky` for every material that dims indoors, now the trim, the features and the pitched roofs too, and for the bodies and the gun in your hands; the town's buildings take no indoor grids. The share is shown as its power 0.45 over a floor of 0.12, standing in for light bounced many times and the eye getting used to the dark (single-bounce rooms came out at 1% of the street, unplayably black), and the sun's bounce counts 4×. The sky: Poly Haven's tonemapped picture of `kloofendal_48d_partly_cloudy_puresky`, cropped to 8° below the horizon, 4096 × 1116 (`public/assets/sky.jpg`, 245 KB, made by `fetch-assets.mjs sky`), drawn by day on the island and the town, turned so its sun lies the sun's way, melting into the horizon's colour (now the photo's, `#9a9ead`) near the horizon and gone at half grey. The sky's light (`sky.hdr`) turned out to carry the sun: 68% of its light from above, unshadowed, which lit every shaded face from the sun's way and made the town flat; in a map it's clipped at a luminance of 3 at load, its sky light kept at the island's, and under cloud the flat light takes back what the hidden sun gave (not the picture, which puddles mirrored bright blue). The island keeps its sky light and balance as they were; its sun moved up 1.8° to the photo's sun. A map can set its sun's bearing (`GameMap.sun`): Calabianca's comes from the south-west at 110°, over the sea, raking across the church and the market; 20° and 60° were tried. Grading (`grading.ts`) in the tone mapping, as a formula, not a look-up table (no texture unit to spare): Neutral, then shadows a little blue, highlights a little gold, more contrast round mid-grey and a little more colour, in a map only. AgX was tried and left the plaster and sky pastel. Tests: `test/townlight.test.ts` (open ground reads as open, a room darker than the street and darkest away from its window, the ground darker at a wall's foot, each face of a wall reading its own side, a face in shade lit by a sunlit wall facing it, a ceiling seeing the floor; Calabianca's rooms under a quarter of its streets' share). Every island screenshot showing sky re-recorded, all the town's and the kit yard's. GPU time a frame, best of three rounds against chunk 59 on an M3 Pro: the market 4.69 to 5.26 ms, the town from above 4.53 to 5.67, the alley 4.88 to 4.60, an outpost's yard 5.07 to 4.59, so up to 1 ms more in the town and nothing on the island; the benchmark, alternating twice with chunk 59's code, took 13.2–13.4 ms for the 24-body frame against 12.7–14.4 and 13.1–14.1 in the rain against 14.2, within the noise. No night to show: the game is day only. Whether it reads as lit by a real sun and sky is the user's) |
| 61 | **Age** | The town weathered in its shaders, with no new textures: rising damp and dirt at a wall's foot, streaks under sills, cornices and balconies, plaster fallen away to the stone beneath in patches, faded and uneven paint, each wall's tint varied a little; the paving's repeat broken (samples offset and turned by world position, large-scale variation over it), worn paths darker and smoother; roughness varied, so rain wets the stone unevenly and pools in the cobbles' joints | No two walls look alike, no repeat in the paving can be seen from the roofs or a lane's end, and the town looks lived in for centuries, not built yesterday | **Done** (all in the shaders, from noise over where each surface stands, with no new textures or texture units (`age.ts`, read by `surfaces.ts` through its `age` option, given only in a map, so the island is drawn exactly as before and its screenshots match). The buildings, their trim and the pitched roofs (`ageBuilt`, by each box's texture layer): each face of a building a shade and hue of its own, seeded by the plane it lies in, so every piece of one façade agrees; plaster and doors' paint bleached paler and greyer in broad patches and darker in others, stone and tiles stained and bleached; rising damp from the ground (the terrain's height, read through the `groundHeights` the props already had for `onTiles`) up to a ragged line 0.5–1.8 m up, past the plinths, with a tide mark at it, dirt splashed along the foot and grime over the lower storey; streaks down from the top of each box the walls are built of, so under every sill, string course, cornice and floor; plaster fallen away in patches to rubble stone beneath (the cut stone's texture at a smaller scale), likelier where it's damp and out of doors; lichen on the roofs. Outdoors or not by the rain's roof map, so rooms keep their walls clean of streaks and fallen plaster. The paving (`pavedLayer`, `agePaving`): its repeat broken by patches about 3 m across, each taking the texture shifted and turned a quarter its own way, the darker of two winning where they meet; its tone varied over the town; worn darker and smoother along the map's lanes (`MapLane`, drawn for the dev view and now this), round doorways on the ground and at the stairs' feet, carried in the spare alpha of the paving's texture (`townPaint`). Rain runs down the streaks, soaks the stone unevenly and stands glossy in the joints, found as what's darker than the stone's average (its smallest mip). Tests: `test/age.test.ts` (the paving worn along a lane, less a step aside, most at a doorway and a stair's foot, and most of the town unworn); the town's eight screenshots and the kit yard's two re-recorded; the island's all match. GPU time a frame against chunk 60, best of three rounds alternating on an M3 Pro at 1280 × 720: the town from above 3.77–3.91 to 4.55–4.72 ms, the market 2.76–3.98 to 3.84–4.25, the piazza 3.21–3.60 to 3.85–4.26, the alley 3.60 to 4.03, so up to 0.8 ms more, nearly all of it the buildings' noise (the paving's is lost in the noise); the benchmark draws the island, which is unchanged. Whether the town looks lived in for centuries is the user's) |
| 62 | **Façades** | Windows and doors set 20–30 cm into their walls, with sills; eaves overhanging pitched roofs, ridge tiles, gutters and drainpipes down the walls, drains through the parapets; iron railings on balconies, wall lamps (lit at night), power and phone cables strung across lanes, washing lines, AC units, aerials, shop signs and painted lettering on the market and quay; edges and steps slightly rounded; the details now drawn as boxes (creepers, window boxes, crowns, wheelhouses) given real shapes; drawn over the same boxes, so play doesn't change | Close up in a lane, nothing reads as a box, and the buildings look like ones people live in | **Done** (all drawn only, in the dressing (`dressing.ts`), so the world, its props and Extraction's islands build exactly as before. Edges rounded in the shader, not the geometry (`rounding.ts`): each instance carries which of its twelve edges to round and how far (`round`, bits + 4096 × mm), and a face bends its normal toward the face round the corner over its last few centimetres, never over less than a pixel and a half; each part of a prop's shape (props.ts' slices) rounds as a box of its own. A prop's edge is rounded only where the air just beyond both its faces and past the corner is clear all along it (`openEdges`, about 0.1 s for the town at load), so where one storey of wall stands on the next, or a wall meets a lintel, the seam stays sharp: walls, terraces and floors 3 cm, steps and sills 2 cm, doors, crates and fences 1 cm all round, window frames 6 mm, the dressing's stone, wood and metal 1.2 cm; a surface option (`round`), given only in a map. Windows and doors 23 cm in: their surrounds stand 8 cm proud with a drip moulding over the head, the glass and leaves in the wall's middle as before, and a stone sill 14 cm proud under each window. The pitched roofs (`roofs.ts`): half-round ridge tiles, a row of tile ends along each eave that looks out over open air, verge tiles, rafters and boards under the overhang, a gutter on brackets and a downpipe from one end (both on a roof over 9 m) down the wall to the ground or the roof below, with its swan neck, brackets and shoe; none past a gable or along an eave where another building stands. Balconies (`balconies.ts`): their railings' props are drawn as wrought iron, bars between a top and a bottom rail with a band of rings (`railProps` hides the boxes, which still collide; the kit's balconies now come from `kitBalconies`), the slab with a moulded stone edge and stepped stone brackets under it. What people have put up (`life.ts`): lanterns on curled brackets by the street (unlit: the game is day only), air conditioners beside some upper windows, cables clipped along under the tops of walls, and from wall anchors, cables (to 15 m) and washing lines on pulleys (to 7.5 m) strung across to the facing wall where a level ray finds one, at least 2.4 m over the lane at their sag, hung with shirts, trousers and towels; aerials on some pitched roofs' ridges and in a corner of some flat roofs, satellite dishes, and a terracotta spout through each parapet over a drop. Signs (`signs.ts`, `MapBuilding.signs`): painted boards over the shops' doors round the market and the quay, the names of the warehouse, the boat yard, the fish market and the market hall painted on their walls, worn, the hotel's blade sign and the tobacconist's and chemist's, their letters drawn into one 2048² canvas at load. Real shapes for the boxes: window boxes are tapered troughs on braced brackets with leaves (folded leaf cards, `Shapes.leaf`) and geranium clusters on stalks; creepers a branching stem with leaves and flowers as leaf cards, thicker; the fishing boats' wheelhouses lean in, with a band of windows and frames, an oval roof, a mast and light and a lifebuoy, and tyres hang along the hulls; clothes are shaped. The trees' crowns are left to chunk 63, which redoes the plane trees and olives. Tests: `test/facades.test.ts` (each edge its own bit; outer corners and terraces rounded, stacked storeys and buried feet not; a window 20–30 cm behind its surround over a sill standing further out; every balcony's railings drawn in iron and still stopping rounds; cables and lines level, wall to wall, 2.4 m over the lane; nothing drawn in a room; every sign finds its wall). Screenshots: the alley, market, roofs and harbour re-recorded, the Albergo's front and a window in the west added; the island's all match. GPU time a frame against chunk 61, best of three rounds alternating on an M3 Pro: the market 11.25 against about 10.4, the alley 11.27 against 10.44, the piazza 11.81 against 10.70, the town from above 13.51 against 13.17, so 0.8–1.1 ms more in the streets, none of it the rounding (the same with it off): about 570 k vertices of shapes, drawn into the shadows too. Warm loads of the town 2.0–2.4 s against 1.7–2.0. No gameplay changed, so no bot playtest was run. Whether the buildings look lived in is the user's) |
| 63 | **Greenery and backdrop** | Mediterranean plants in the town: cypresses, umbrella pines, plane trees and olives that aren't lumpy balls, bougainvillea and vines on walls, agaves, potted geraniums and lemon trees; the hills round the town as southern Italy, not the island: terraced olive groves behind dry-stone walls, maquis, rock outcrops, sun-bleached ochre grass; chunk 39's trees and impostors used where they fit | From the roofs the town sits in its own landscape, and no plant in it looks stylized | **Done** (chunk 39's trees made general (`trees.ts`): a `Species` is a kind of tree (its near and far shapes, the picture on its cards, its size, sway and near range) and a `Stand` the trees of one kind, each with its own tiles, near trees and impostors; the island's spruces are one species, built as before, and its screenshots match. The kinds' sizes and sway reach their shaders as uniforms, so every kind shares one set of programs. The impostors now turn with their trees, as their shader meant them to. Six kinds generated in `species.ts`: olives (two or three stems twisting apart, an open grey-green crown), plane trees (a pale trunk forking at 4.4 m under a dome of five-lobed leaves), cypresses (a column of dark sprays tapering to a flame), umbrella pines (a bare, leaning trunk under a crown pressed flat), holm oaks and the maquis's shrubs; each grows a skeleton of boughs level by level from a seed and carries cards at its last branches' tips, their pictures drawn on a canvas at load (`dev/plants.html` shows them). What a map plants (`greenery.ts`): the town's two planes and six olives over the trunks they collide as (the blobs in `features.ts` gone); `GameMap.plants`, Calabianca's cypresses round the cemetery's walls and pines over the villa and the shore; the island's trees as holm oaks and pines (35%); olives in rows along terraces, each moved halfway up its own, behind dry-stone walls traced along the ground's contours every 2.2 m (one merged shape with ragged tops, rock-textured); cypresses in short rows along the slope and alone; the maquis in patches; outcrops of pale rock. Which ground is grove or maquis (`shared/hillside.ts`) is read by the ground's paint too, which beyond the town's bounds turns the grass dry and the groves' ground to earth; inside them it's as before, so the grass the bots see through hasn't changed. A map's ground and grass tinted straw and ochre, its bushes the maquis's grey-green (client only). By the town's doors and along its ground floors (`plants.ts`, `MapTrim.pots`, `bougainvillea`, `vines`): terracotta pots of geraniums, agaves and lemon trees, bougainvillea up a door's side and over its head, vines on a wire along a wall, each from a stream of its own so the rest of the dressing is chosen as before. About 1,000 olives, 1,700 shrubs, 370 oaks, 220 pines and 29 cypresses, and 6,700 stretches of terrace wall. Tests: `test/greenery.test.ts` (each kind the same near and far, the far five times cheaper; the town's trees on their trunks and nothing else inside the bounds; the map's plants placed; olives halfway up their terraces and the walls on their contours; outcrops beyond the walls; the island and the ground inside the walls untouched). Screenshots: the town's and the kit yard's re-recorded, the hillside and the olive garden added; the island's all match. GPU time a frame against chunk 62 on an M3 Pro at 1280 × 720, best of three alternating rounds while the machine warmed (the old code's own times drifted from 4.3 to 9.8 ms over the session): 1.3–1.8 ms more in the market and from above, 2.4–4 ms in the alley and the piazza, 4.7–5 ms looking at the hillside, most of it the trees (hiding them saves 2.4–3.7 ms), and of them most the far tiles; cuts to the near detail and ranges made little difference, so it's left for chunk 64 (see Known Issues). Warm loads of the town 2.7–2.8 s against 2.4. No gameplay changed, so no bot playtest was run. Whether the town sits in its own landscape and no plant looks stylized is the user's) |
| 64 | **Dressing and speed** | Cover and clutter in the streets (market stalls, carts, a car or two, crates, rubble, sandbags where the flow wants them), the benchmark and a cold first load on the map with chunks 59–63's look, cut back where they don't hold; the changelog, Game Modes, World capacity and Features updated | The benchmark holds its frame time in the town, a cold load is no slower than the island's, and the testers prefer it to the island for Deathmatch | **Done** (cover where `sim:deathmatch` drew its longest kill lines: two old saloons, rounded, on four wheels, one on the high street and one on the road's first leg where Via del Porto looks along it, leaning with the ramp it stands on; sandbags in staggered rows along the market's south side and in Via del Porto past the hotel's door; rubble fallen from the ruined chapel by its door and its arch, chunks of stone and plaster on a bed of grit with a beam across it (`MapLook` `car`, `sandbags`, `rubble`, drawn in place of their boxes). The market's stalls and the carts were already there and were left as they were. Sim, seeds 1–3: nobody stuck, deaths within 15 s of spawning 76/65/61 (81/81/68 before), kills from 40 m or more 4–6% (3–6%). `npm run bench` measures the town too (`dev/bench.html?town`): seven of the screenshots' spots, empty and with 16 soldiers, with the GPU's and the CPU's time; the baseline re-recorded with it. The speed: the dressing split into 32 m tiles, each tile's coarse boxes and shapes first and its fine ones after (`isFine`: under a quarter of a metre across but along its length), the fine left out of the far and still shadow maps and the sea's reflection by cutting the draw count in `onBeforeShadow` and `onBeforeRender` (`fineAfter`); olives, oaks and shrubs fade into their impostors from 60, 70 and 40 m (`Species.fadeRange`); the sea's reflection drawn only for the part of the mirror's view the sea shows in, from a grid of rays, its camera narrowed to it and drawing into as much of its target's corner (`Water.seaRect`). Against chunk 63, alternating runs: 25–55% fewer triangles a frame, the GPU's time 0.2–2.2 ms less where the sea or the hillside is in view and about the same in the streets, the CPU's 0.3–0.5 ms more for about 100 more draw calls. The town with 16 soldiers takes 12.2–14.6 ms a frame against 13.2 for the island's 24 (empty, 10–11.6 against 6.1: see Known Issues). The island's own phases matched chunk 63's in alternating runs. Cold first loads from a production build with the Metal shader cache cleared: island and town both about 12 s, before and after, warm 0.9 s. The bots' paths: each tick on a map spends about 4 ms working links out ahead (`NavGrid.warm`), all done after about 26 s of play; the worst tick after a game's first 10 s fell from 0.27–0.6 s to 0.11–0.17 s, the games playing out exactly as before. Tests: the dressing's tiles, fine split and draw cuts (`test/townlook.test.ts`), and a warmed grid finding the same paths as a cold one (`test/nav.test.ts`). Screenshots: `town-car` and `town-sandbags` added; the cemetery, the hillside and the kit yard re-recorded (the rubble, the olives' impostors). Game Modes, World capacity and Features updated for the town. Only Deathmatch's map changed how it plays, so no bot playtest was run. Whether the testers prefer it to the island is theirs) |

### Phase 9: simpler (still local only, Chrome only)

Features that cost more than they give are taken out, to make the game simpler and clear the
Known Issues they cause, and the small Known Issues are cleared along the way.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 65 | **No doors** | Door leaves removed in every mode, the doorways left as plain openings: the leaves, their swing, slanted colliders and the door paint; F opening and shutting them, the prediction, the prompt, the stuck toast and the sounds; bots opening, shutting and slamming them and the nav grid keeping off their swing; doors in the cover state, the welcome and the death cam; the Range's door routine; their tests. Extraction's islands otherwise exactly as they were | No door code is left, every island matches the old one prop for prop less its leaves, the bot playtest stays in the extraction baseline, and Deathmatch's sim has nobody stuck | **Done** (`World` has no `doors`, `Door`, `Turn` or slanted boxes; a doorway is a gap under its lintel. Islands keep drawing one number for each doorway from their buildings' stream, as the leaves' open or shut once did, so seeds 1–7 match chunk 64's islands in every prop, tree, rock, building and height, the leaves aside (the fingerprints in `test/maps.test.ts` re-recorded). The paving's wear round doorways is found from the façades' openings. The two door sounds came out of the late sound bank, re-encoded alone (the other two banks are as they were). `test/doors.test.ts`, `e2e/doors.e2e.ts` and the bots' door tests went; a new test walks every building on islands 1–6 from outside and finds every spot on its floors reached (chunk 64's code left spots unreached in 7 of 66 buildings, two of them one-room houses cut off by the table and an open leaf). The sound tests hear through doorways that can't be shut, and the reverb test smashes a crate in place of a slam. The bush-waits test counts over two islands, as on one the leaves' going left none in its first four minutes. Bot playtest, 30 min an island: 16% extracted on seeds 1–6 (chunk 64's code in the same session: 16%), 22% on 7–12 (21% at chunk 57). `sim:deathmatch -- 600 1,2,3`: nobody stuck, nobody spawned in sight, 63/79/78 deaths within 15 s of spawning (76/65/61 before). One screenshot re-recorded: `town-sandbags`, where the hotel's shut door is now a doorway. Whether rooms without doors play better is the testers') |
| 66 | **Small fixes** | The Known Issues small enough to do at once: bots' search spots for crates in corners, the dev view of a test map played on that map, the rubble's and the cars' colliders, a pitched roof's overhang into a taller neighbour. The cars were removed instead, at the user's word that they didn't look good | Every crate in the islands' buildings is searched by bots, a game from `?map=kit-yard` is played on the kit yard, the rubble collides as drawn, no slope reaches into another building's room | **Done** (Search spots: where none of the ring 0.9 m out is open, the nearest place every 10 cm where a body fits on the crate's floor in a cell bots walk, within reach and in sight of it (`nearSpot` in `population.ts`); the other 92 of islands 1–6's 102 crates keep their spots, and a test walks to every one of them from outside. Test maps: named in `maps/dev.ts`, sent in the hello in development only and played as Deathmatch; production builds leave them out; a browser test plays one. A map's box can list the boxes it collides as (`MapBox.collides`); the rubble heaps collide as three tiers. The cars, their drawing and the `town-car` screenshot went; nothing took their place. Roofs: each slope stops at the middle of the wall its gable shares with a building it stands against (`freeGables`, judged per slope), and a test checks no slope reaches into another building's room. Bot playtest, 30 min an island: 19% extracted on seeds 1–6 (16% in chunk 65), 25% on 7–12 (22%), bots reaching the crates they used to skip; 19% is a point over the baseline's band, as accepted on 2026-10-03. `sim:deathmatch -- 600 1,2,3` without the cars: nobody stuck, kills from 40 m or more 3/4/4% (5/2/7% with them in chunk 65's run), 74/98/72 deaths within 15 s of spawning (63/79/78). No screenshot moved beyond tolerance) |

### Phase 10: Calabianca rebuilt after Dust 2 (still local only, Chrome only)

Calabianca is rebuilt, keeping its name, as a map laid out after Counter-Strike's Dust 2 in the
town's style: whitewashed and ochre plaster, stone and the sea, with almost no clutter. The old
layout and everything only it needed go. Dust 2's three lanes
(long A, mid, the B tunnels) and the few ways joining them make fights easy to read, and its
deathmatch servers are among the most played in Counter-Strike. It's mostly walls and passages
walked on the ground: no upper storeys, walked roofs or window posts, which is what this game
builds well. A smaller, plainer map draws faster, bakes its light sooner, and lets the kit,
bots and tests drop most of what Calabianca needed. Planned on 2026-10-06.

- **Layout:** Dust 2's plan followed exactly, at 1:1, its units taken as 2.54 cm, as its
  players are 72 tall and ours 1.8 m (the user's choice on 2026-10-07, over the 1.905 cm first
  planned), so about 114 m a side. It's made from the original's navigation mesh, every patch of
  floor with its height (see `scripts/calabianca.mjs`), so its heights and joins are the
  original's: long A's slope, the catwalk up from mid, the steps up to B, the ramp at A, the walk
  from short to A over the way out of the defenders' end. The movement speeds will be changed
  later to suit it, so until then a walk from one spawn to the other won't take as long as in
  Counter-Strike. Its double doors at mid, B and long are fixed walls with a gap between them to
  see and shoot through, as there are no doors.
- **Its own:** Calabianca's name and look, not Valve's; nothing of Dust 2's textures, models or
  name. The sea along one edge in place of desert, the hills behind as now.
- **Players:** **12 operators** (`DEATHMATCH_CAPACITY` 12), spawn points spread round the whole
  map rather than at two ends, as free-for-all wants.
- **Clutter:** only the cover the layout has (Dust 2's crates and boxes, as stone and crates
  here); no stalls, carts, pots, washing or trees in the streets.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 67 | **Blockout after Dust 2** | The new Calabianca in its own map file, beside the old one until 69, plain-textured: Dust 2's plan drawn as a top-down sketch in the map's coordinates and built over it (walls and blocks, the few covered passages, the levels and ramps, the gaps at mid and B), at 1:1 in metres, 20–24 spawn points spread round it; `DEATHMATCH_CAPACITY` 12; `mapFor('deathmatch')` returns it, so the old layout goes unused (deleted in 69); still named Calabianca, but its board started afresh under a new id (`calabianca-2`), as the old scores were set on another map | It matches the sketch drawn over it; 12 bots play ten minutes on it with nobody stuck and nobody spawned in sight; no spot takes more than 3% of kills; the tests walk every place to stand; a human walks it and finds it plays like Dust 2 | **Done, but for the 3% and the human walk** (`src/shared/maps/calabianca2.ts`, `CALABIANCA_2`. The plan was traced from the original's overview picture, 1024 px over 4505 units, about 86 m a side, and its colours, which grade by height, read as four heights over the lowest: 0.3, 1.8, 3.8 and 5 m. It's written as 62 places, rectangles on whole metres at one of those heights (`PLACES`, named as players name them: long A, the pit, short, mid doors, the upper and lower tunnels…), with 8 flights of stairs and 7 ramps between them; every metre of the 88 m square that isn't one is solid, merged into blocks 6 m over the highest ground within 4 m, but a parapet 1.1 m high along the sea behind the attackers' end. The tunnels and doorways are places with a ceiling, the block carried over them. The four pairs of double doors are fixed leaves with a 1.4 m gap. Cover from the overview's boxes as 26 stone boxes and 7 crates. The ground is the levels' (`levelGround`), the terrain flat at the lowest and walked terraces topping it up. 24 spawn points, at least four in each quarter. The map format gained `areas`, named places, which `sim:deathmatch` names its spots by and `dev/map.html?sketch` draws over the built map (the dev view shows the new map by default, `map=old` the old). A spawn now stands on the highest walked floor under it, where it used to take the bare terrain. The baked light's volume reaches a map's blocks' tops when it has no buildings, and a mesh with no instances no longer stops the textures loading. The old town is a dev test map (`?map=old-calabianca`) for its 14 screenshots until chunk 69, which still match. New tests in `test/maps.test.ts`: every place roomy enough to stand in stands at its height, every metre outside the plan is solid and too high to climb from beside it, a bot's path reaches every place from the first spawn and a player walks it, the spawn points are spread and reached, and each pair of doors is seen through at its gap and not its leaves; and in `test/townlight.test.ts`, the light baked on a map with no buildings, its tunnels darker than its lanes. `sim:deathmatch -- 600 1,2,3`: nobody stuck; one respawn of 951 in sight (seed 2, when no point was out of everyone's sight); the busiest 6 m squares take 5–7% of kills (the lower tunnels' end at mid, mid by its doors, the upper tunnels), over the 3% asked, left to chunk 70's tuning; 53–63% of deaths within 15 s of spawning; kills from 30 m or more 1–2%. Whether it plays like the original is the user's to walk) **Redone on 2026-10-07** at the user's word that it was far from the original (A different, no way under the walk to A, too small): made from the original's navigation mesh by `scripts/calabianca.mjs` into `calabianca2grid.ts`, at 2.54 cm a unit, 114 m a side. Floors on a 25 cm grid at the mesh's heights (smoothed, then on 25 cm steps), widened by the 0.41 m the mesh keeps off walls; decks where the walk from short to A runs over the way out of the defenders' end; houses 6 m over the highest floor within 6 m wherever there's no floor; the original's boxes in stone, which bots go round (their paths drop no more than 1.2 m, so a box's top was a trap), five square ones as crates for ammunition; the tunnels and the doorways roofed; the open door leaves the mesh keeps off cleared, and fixed leaves set across each doorway with a 1.6 m gap; the parapet along the sea; 24 spawn points spread by farthest-point over the floor bots walk both ways. Its places named from the overview (`areas`), its plaster, paving and lanes re-placed. Crates on a map of blocks now stand on the walked floor (they were set on the terrain under it) and count as loot there. Tests rewritten (`test/maps.test.ts`, `test/blocks.test.ts`, the helper `test/calabianca.ts`): room to stand in every place, the original's heights (the pit lowest, A over long, the attackers' end over the defenders'), the deck with room under it, the tunnels roofed, the houses too high to climb, a bot's path to every place walked by a player, 24 spawn points in every quarter, the doors' gaps. `sim:deathmatch -- 600 1,2,3`: nobody stuck, none spawned in sight, 54–63% of deaths within 15 s of spawning, kills from 30 m or more 5–13%, the busiest 6 m squares outside long and at long's doors with 4–6% of kills. Nine screenshots, `calabianca-*`. Bench with 12 soldiers: 10.4–16.8 ms a frame against the island's 13.4 with 24. Cold first load 14.1–14.5 s against the island's 13.1–13.6) Then, at the user's word that its roads and houses were stepped (2026-10-07): the floors' tops are planes sloping as the original's roads do (`Box.tilt`, a box whose top slopes, met by collision, rays, the nav, the bake and the rain), fitted within 3 cm; real steps only where the original is steeper than 24°; the ground drawn as one surface over them; the houses one height a plot; diagonal and wandering walls straightened (126) and box-shaped boxes drawn as they stand, turned (31). `sim:deathmatch`: nobody stuck, none spawned in sight, 53–55% of deaths within 15 s of spawning.) |
| 68 | **Its look** | The old layout's look carried over where it fits: plaster by area, stone at corners and plinths, frames, cornices and parapet caps, paving, ageing, baked light, the sea and hillside backdrop; a few shutters and signs at most; no pots, plants, washing, cables or trees in the streets | From the spawns it reads as a whitewashed town by the sea, not a desert; the benchmark's frame on the map is no slower than the island's, and a cold first load no slower either | **Done, but for the cold load** (Each block is plastered by its part of the map (`MapBox.colour`, carried to its props as a building's plaster): whitewash round B and the tunnels, cream through mid and the corridor, ochre round A, rose along long A and the pit, pale blue on the attackers' side; the parapet along the sea and the cover stay stone. A new dressing pass, `client/blocks.ts`, dresses every block face that looks outdoors: a stone plinth following the ground, a cornice under the top, quoins at outside corners while the corner turns outdoors, a stone lintel over every tunnel mouth and doorway, about half the places high on a house wall a window framed in stone with its shutters shut, and a stone cap along the low blocks; the buildings' dressing pass now runs for a map with no buildings. The fixed door leaves are drawn as old painted planks with battens and iron straps (look `doors`), uncapped. Paving: cobbles at both ends and the sites, earth in the pit, flagstones elsewhere, worn along six `lanes`. The ageing, the baked light, the sea and the hillside came with the map. Two things the look needed beyond the list: the tunnels were near black under one bounce of sky light, so lamps now hang down the middle of every covered stretch of 10 m² or more, 5 m apart (`coveredLamps`), baked in as warm light and drawn as iron lanterns; and the parapet along the sea, 5 m deep, hid the sea from the spawns, so it's a metre thick now with a ledge along the shore behind it, out of bounds. No shutters open, no signs, plants, washing or trees. Tests: `test/blocks.test.ts` (plaster, paving, doors, dressing kept to the faces, lamps out of the way and lighting the lower tunnels, the sea seen from the top spawns); seven new screenshots, `calabianca-*`. Bench, 1280 × 720 on an M3 Pro: the town's bench now runs on the new map at those spots with 12 soldiers, 11–13.6 ms median a frame against the island's 13.6 with 24 (the sea spot swung 12.5–16 ms between runs); the town's baseline re-recorded. Cold first load: 13.0–13.4 s against the island's 12.7–13.0, the same as chunk 67's map measured alternately with this (13.0–13.7 s), so the half second over the island is chunk 67's, left to chunk 70. `sim:deathmatch -- 600 1,2,3`: nobody stuck, none spawned in sight, 1–2% of kills from 30 m or more) |
| 69 | **The old layout removed** | The old Calabianca, its sketch and sketch tools, its tests and screenshots; what only it used, in the kit (pitched roofs and their tiles, courtyards, arcades, balconies, rooms over lanes, outside stairs and hatches if unused), the dressing (plants, washing, cables, aerials, signs not kept), the features' looks no longer placed (lorry, stalls, carts, boats, tombs, the bell tower and the rest), the town greenery inside the bounds, and the bots' window and roof posts if the new map has none; its Known Issues moved to the history as Moot; the changelog | No code is left that only the old layout used; every test passes; the island's screenshots and fingerprints match | **On hold** (2026-10-07: at the user's word both maps stay for now, two modes on the menu, Calabianca DM on the old town (mode `calabianca`, `mapFor` gives it `CALABIANCA`) and Dust DM on the new (mode `deathmatch`); `isDeathmatch` tells both apart from the rest; each keeps its board under its map's id, the old town's the one it had) |
| 70 | **Tuning and the docs** | The heat map's spots and sightlines tuned (mid and long A most of all, against the bolt-action rifle), spawn points moved where deaths come soon, the benchmark and a cold load measured, the bot playtest run; Game Modes, World capacity, Features and the town's chapter rewritten for the new map | No spot over 3% of kills and none killing mostly from afar; deaths within 15 s of spawning no worse than the old layout's; the testers prefer it to the old layout | Planned |

## Known Issues

Shortcomings of what has been built so far, to improve later. Every chunk adds the gaps it
leaves here. Each item notes the chunk it came from. Items still open, or only resolved in part,
stay here; once an item is fully **Resolved** (or **Moot**), it moves with how it was resolved to
[KNOWN_ISSUES_HISTORY.md](KNOWN_ISSUES_HISTORY.md).

### Look and animation
- **The town's age is noise, not where water runs** (chunk 61): streaks run down from the top
  of each box the walls are built of, so a streak starts sharp where a sill's box ends and none
  falls from the drawn-only trim (balconies, window boxes, awnings); damp rises from the
  terrain, so a wall on a terrace, a ramp or a lower roof has none at its foot; fallen plaster
  lies flat in rounded blobs anywhere on a wall rather than at its corners and edges; two
  buildings' fronts in one plane share a shade. Shapes that aren't boxes (wheels, crowns,
  hulls, the bell tower's roof), the lorry and the containers aren't aged.
- **The town's paving is worn by hand-drawn lanes** (chunk 61): along the dev view's lines,
  round doorways and at stairs' feet, not where players and bots actually walk (the
  `sim:deathmatch` heat map could say). Where two of its patches meet, their joints may show
  doubled for a hand's breadth, and a dark stone counts as a joint and holds water in rain.
- **The town's age costs up to 0.8 ms a frame** (chunk 61), most from above, where the
  buildings' boxes, drawn in no order, shade the same pixel many times over.
- **The town's dressing is only drawn** (chunk 59): shutters, window boxes, creepers, awnings,
  stall canopies, the trees' crowns, the pots, the obelisk and the crosses neither stop rounds nor hide
  anyone from bots, as the island's bushes don't. A player on a roof under a plane tree's crown
  looks hidden and isn't.
- **Some features collide where nothing is drawn** (chunk 59): they're drawn over their boxes,
  which are solid all through: the 0.3 m over the lorry's cab, the corners of the hauled-out
  boats' boxes beside their hulls, the space under a cart's bed, a stall's under its counter's
  edge. (Chunk 64's cars, whose boxes filled out past their bodies, were removed in chunk 66,
  and its rubble heaps collide as three tiers, as drawn: their tiers' corners stand square.)
- **The town's details are boxes** (chunk 59), **Resolved in part** (chunks 62, 63): leaves,
  flowers, window boxes and wheelhouses have real shapes, and the trees are real trees (chunk
  63), but the stalls, carts and the lorry's body are still boxes, and the ruined chapel is
  drawn whole.
- **Balconies' railings are drawn as iron but collide as plaster** (chunk 62): rounds stop at
  the whole railing and bots can't see through it, though it's drawn as bars a player sees
  between, so shooting at legs behind a balcony's railing hits nothing.
- **The façades' details cost about 1 ms a frame in the streets** (chunk 62), **resolved in
  part** (chunk 64): about 570 k vertices of shapes (leaves, tiles, cables, rings, flowers)
  and 14,000 boxes. Since chunk 64 they're split into 32 m tiles, so each pass draws only the
  tiles it sees, and what's fine (see below) casts only into the near shadows; but building
  them, the signs and the rounded edges on the main thread still adds about 0.3 s to the
  town's load, and the tiles cost about 100 more draw calls a frame, 0.3–0.5 ms of the CPU's.
- **Small things on the walls cast no shadow past 32 m** (chunk 64): what's under a quarter of
  a metre across but along its length (sills, cables, string courses, flowers, leaves, a
  shape's rings and rods) is drawn into the near shadow map alone, and left out of the far and
  the still ones and out of the sea's reflection. A long cornice's shadow along a façade is
  lost past 32 m, and a balcony's railing reflects without its bars.
- **Rounded edges are only shading** (chunk 62): the silhouettes and shadows stay square, and an
  edge open only part of its length (a wall's end beside a window, between sill and lintel)
  stays sharp all along.
- **Things drawn on the walls are walked through** (chunk 62): window surrounds 8 cm proud,
  air conditioners, lanterns, downpipes, flat roofs' aerials and dishes and the signs standing
  out don't collide, so a body brushing a wall sinks into them. Downpipes run through
  cornices and string courses rather than round them.
- **Cables and washing lines are strung by a straight look** (chunk 62): from anchors picked
  at random, across to whatever wall a level ray meets, so a line may run from beside a
  window to a blank wall or cross another; nothing sways.
- **Signs are drawn with the machine's own fonts** (chunk 62), Georgia and Arial where it has
  them, so their letters differ from machine to machine; they don't weather or get wet as the
  walls do. The lanterns are never lit, as the game is day only.
- **The greenery costs 2–5 ms a frame** (chunk 63) on an M3 Pro at 1280 × 720: least in the
  market and from above, most looking at the hillside. Most of it is the trees' far tiles,
  which draw the plainer trees out to 145 m past a tile's edge (about 1,000 olives and 1,700
  shrubs round the town) and cast them into the shadows; the leaf cards' overdraw counts too.
  Cutting the near detail and the near range changed little. **Resolved in part** (chunk 64):
  the small and the many hand over to their impostors sooner (`Species.fadeRange`): shrubs
  from 40 to 55 m, olives 60 to 80, oaks 70 to 90, the rest still 110 to 140, and their tiles
  are drawn only that far out; the hillside's frame took 1.4 ms less of the GPU's time and
  from 3.1 to 1.4 million triangles. Their impostors are flat cards, so from a roof the near
  groves read a little flatter than before. Drawing the leaf pictures and baking six kinds'
  impostors adds about 0.35 s to a warm load.
- **The terraces aren't cut into the ground** (chunk 63): the terrain is 4 m a cell, too coarse
  for a level terrace, so each dry-stone wall stands on the hillside's even slope, 0.8 m over
  its contour on both sides, rather than holding up a level step. From the town they read as
  terraces; up close it's a low wall on a slope.
- **The hillside's trees aren't the world's** (chunk 63): a map's world still places the
  island's trees as spruce-shaped colliders, drawn as oaks and pines but left out in the groves
  and near the town, where they stand invisible; the olives, cypresses, shrubs, walls and rocks
  out there collide with nothing. All beyond the bounds, so nobody meets them, but a round
  flying out of the town passes through what's drawn and may stop on what isn't.
- **The town's pots and plants are walked through** (chunk 63): pots, lemon trees, agaves,
  bougainvillea and vines are drawn only, as the rest of the dressing; a lemon tree by a door
  looks like something to crouch behind and hides nobody.
- **The trees are cards close up** (chunk 63): seen from under or beside a crown, its leaf
  cards show flat and some edge on; the olives' nearest crowns read a little brushy, and a
  plane's pale bark looks grey in its own crown's shade. The leaf pictures are drawn on a
  canvas, not taken from photographs. Every map gets the same hillside, the kit yard too.
- **The town's light is baked at every load** (chunk 60): about 3 s in a worker on an M3 Pro,
  longer on slower machines, with about 250 MB in use while it runs; until it's done the town
  is lit as if all of it were out in the open, then the light fades in over a second. It
  isn't kept between visits.
- **The town's baked light doesn't change** (chunk 60): it's baked without crates, glass or
  fences, so a broken window or a stack of crates leaves the light as it was. The trim and the features don't shade anything either, as
  they're drawn only, and a cornice or a window's reveal, narrower than the light's half-metre
  cells, isn't darkened beneath or within.
- **Rooms in the town take the sky's blue** (chunk 60): the sky's light bounced off walls and
  floors is counted only in brightness, so a room lit by its windows is bluish grey; only the
  sun's light bounced takes the colour of what it's bounced off.
- **The town's narrowest lanes may be too dark** (chunk 60): the stair in the west's alleys,
  in shade at its foot, is nearly black at the screenshots' size. Left for a playtest.
- **The island's sky light still holds the sun** (chunk 60): only a map's town has it taken
  out, so on the island the shade is still lit from the sun's way, as before, and outposts
  read flatter than the town. Taking it out there too would darken the island's rooms and
  shade, which the testers know.
- **The sky's photograph is soft close up** (chunk 60): 4096 pixels round, about 11 a degree
  against about 18 on screen, and the same sky in every game.

### Sound
Nothing open: the last was resolved on 2026-10-02 (see the history).

### Day, night and weather
Nothing open: the last was resolved on 2026-10-03 (see the history).

### Code and testing
- **Browser tests can stall under load** (found in chunk 63): in one of three full runs the
  textures' test timed out, passing alone; a dev server left running through a long session of
  edits made the death cam's test fail every time, until restarted. (The doors test that failed
  the same way went with the doors in chunk 65.)
- **Island buildings still draw a number for each doorway** (chunk 65): the leaves were found
  open or shut from the buildings' stream, and dropping the draw would move everything placed
  after it on every island; so `addFacade` still draws it and throws it away.

- **A bot's first path through part of the town costs a hitch** (chunk 54), **resolved in part**
  (chunk 57): the nav grid works out whether a body gets between floor nodes the first time a
  search needs it, and the town is mostly floors (roofs, upper storeys, terraces). A broken
  window or a door no longer throws away the links of whole tiles, and a test keeps every spot
  in reach (a search for one out of reach looks through the whole town), so the worst tick
  after a game's first 10 s is 0.17–0.34 s; but in those first seconds, as all 16 bots plan
  their first paths at once, some cold searches up into the town take 0.5–0.7 s each, and the
  first second costs 1–3 s of the server's time: the bots stand still that long (the server
  runs in a worker, so the player's frames don't stall). Warming every link takes 3.8 s. Bots
  climbing to windows and roofs since chunk 58 meet more cold links all game: the worst tick
  after the first 10 s is 0.19–0.61 s, and a bot's first roam after spawning is kept on the
  street, as heading straight for a window from every spawn doubled the first second's cost.
  **Resolved in part** (chunk 64): on a map, each tick spends about 4 ms after its work working
  out the links ahead (`NavGrid.warm`), cell by cell across the town, done after about 26 s
  of play; what searches find is the same, only sooner. The worst tick after the first 10 s
  is now 0.12–0.17 s. The first second still costs 0.5–1.6 s, as the warm-up can't get ahead
  of every bot planning at once; a server already running when the player joins, as a real one
  will be, would hide it.

### Playtest and tuning
Nothing open: the last was accepted on 2026-10-03 (see the history, and the bot extraction
baseline in Decisions).

### Scoreboard
Nothing open: the last were resolved or accepted on 2026-10-03 (see the history).

### Deathmatch
- **Picking Deathmatch on the menu reloads the page** (chunk 50): its world differs from the
  other modes' (a fixed map since chunk 52), and the client builds one world per page load, so switching into or out of Deathmatch loads the page again, with its
  loading screen and, on a cold cache, the shaders compiled again. Building the new world in
  place would need everything made from it (the view, bodies, sound, HUDs) rebuilt with it.
- **Respawns are still often near a fight** (chunk 54), **resolved in part** (chunk 58): with 16
  in the town, no spawn point is 30 m from everyone and out of sight in 24–43% of respawns, so
  the farthest out of sight is taken, and 27–33% of deaths come within 15 s of spawning (chunk
  57, six 10-minute games, none spawned in anyone's sight). A spawn point within 25 m of a shot
  fired in the last 6 s now counts as near someone, which took deaths within 15 s from 323 to
  295 and within 5 s from 47 to 43 over four games; over six, 26–32% within 15 s and 2–6% within
  5 s. With bots living a median 22–25 s, much of the 15 s count is the pace of the game rather
  than where they come in. The corner points (the fish market's, the boat yard's) are taken 20–40
  times a game, as the farthest from everyone, against 4–10 for most.
- **Bots seldom reach the window or roof they set off for** (chunk 58): of 260–325 posts a game
  picked to watch from, 32–49 are got to; the rest are given up for someone seen on the way, a
  shot from somewhere else or a death. So bots are upstairs 10–15% of the time and on the roofs
  3–5%, not more.
- **Bots at a window stand in it** (chunk 58): a post is watched standing, as the sill hides
  anyone crouched; a bot doesn't duck between looks or change window after firing from one, but
  holds it until its wait is up or it's drawn into a fight.
- **The heat map counts a room fought through as a window held** (chunk 58): kills from upstairs
  are summed by the building's storey or roof, so the quay house's upper floor, a way from the
  market down to the quay, tops the list every game (1–5% of kills, from 4–10 m) as if held from
  a window; only the median range tells them apart. Where a window sees far shows only as the
  lines of kills from 40 m.
- **The yard where the quay steps come up by the hotel is the busiest place** (chunk 58): the
  steps, Via del Porto, the road's hairpin and the hotel's way through meet there, and a cart and
  a crate didn't move it off the top of the list, at 2–3% of kills. No place has more than 3%.
- **A spawn zone's points see each other** (chunk 57): the town's spawn points stand four to a
  zone, as the sketch has them, so one operator in a zone spoils all four; as a game starts,
  with 15 bots spread over the eight zones, nearly every point is seen, and a player joining
  then can come in seen.
- **The edge can be met on top of a wall** (chunk 54): the bounds stand a body's width inside the
  edge walls, the houses' backs and the sea wall, so walking into them meets the wall itself;
  but the sea wall is low enough to mantle, and a player trying to climb onto it is held back
  by the bound, not the wall.
- **The kit trusts its map** (chunk 53): blocks that overlap, openings running past a wall's
  end or into a corner, and flights of stairs with no room at their foot or top are built as
  given; only the test that walks a bot's path into every room finds them, and anywhere bots
  can't reach; crates standing in a narrow gap were found and moved by hand (chunk 57). The
  door leaves' slots (chunk 57) went with the doors (chunk 65).
- **Pitched roofs collide as steps** (chunk 56): each is layers 0.6–1.2 m high stepping in
  toward the ridge under the slopes drawn over it, so a round can stop up to half a layer off
  the drawn slope, either way. Nobody walks up them or mantles onto them, but a jump (1.4 m at
  its height) carries a player up a layer where one can be reached, and someone dropping onto
  one from higher stands on it. The town keeps pitched roofs out of reach by placing them.
- **Joined pitched roofs aren't mitred** (chunk 56): each block's roof is its own, so two
  pitched blocks of an L or round a courtyard cross each other's slopes and gables at the
  corner instead of meeting in a valley or a hip.
- **A wall between two buildings is plastered as one of them** (chunk 56): a shared wall is
  one box, so it takes the colour of whichever building's stretch comes first along it, on
  both faces.
- **A courtyard's rooms are joined only at its corners** (chunk 56): the kit cuts a 2.4 m
  archway at each of its four inside corners on every storey, whether wanted or not, and no
  other way between its ranges unless the map adds one; an arcade is only on a ground storey,
  its bays all one width.
- **Bots don't fit through a doorway or arch under 2.4 m centred on a whole metre** (chunk 56):
  the nav grid's cells are 1 m with 0.55 m kept clear round a body, so a 2 m arch at x = 0 has
  no cell open in it, though a player walks through. A 2.2 m door has a cell open in it only
  where it's centred on a whole metre, as the maps have them so far; the kit's corner
  archways are 2.4 m for it.
- **Every mode loads the town's textures** (chunk 59): the six new layers are stacked into the
  same arrays as the island's, 2.12 MB against 1.35 MB, transcoded on every first visit though
  only Deathmatch uses them. Warm loads didn't change (2.0 s locally, island and town); a slow
  connection and a cold load pay for the 0.77 MB. An array of the town's own, loaded for
  Deathmatch only, would spare the others.
- **The town is heavier to draw than the island with nobody about** (chunk 64): the benchmark's
  empty frame takes 10–11.6 ms at the town's seven spots against 6.1 on the island, about
  6.5–8.6 ms of it the GPU's; with 16 soldiers 12.2–14.6 ms, against 13.2 for the island's 24.
  The town's surfaces are shaded with more (baked light, age, rounded edges, rain), and it
  stands 1.4–2.5 million triangles a frame against the island's 0.9. From above, where the sea
  fills half the view, its reflection still draws most of the town. The benchmark's GPU times
  come from timer queries, which on ANGLE's Metal disagree from run to run; only alternating
  runs of old and new code told a change apart.
- **The new cover is placed by the simulation, not playtested** (chunk 64): the sandbags
  stand across the longest views `sim:deathmatch` drew (Via del Porto into the road, along the
  market's south side); whether they read as cover where a player wants it is the testers'.
  The two cars that stood across the high street and the road's first leg were removed in
  chunk 66, as they didn't look good, and nothing took their place. No more stalls or carts
  were added: the market's four and the three carts already break its views.

- **Kills gather at the new map's chokes** (chunk 67, redone 2026-10-07): over three 10-minute
  games, the 6 m squares outside long and at long's doors take 4–6% of kills each, against the
  3% the chunk asked. That's the original's chokes doing what they do; chunk 70 tunes them.
- **Respawns on the new map come soon after death** (chunk 67, redone): 12 operators on 114 m
  leave no spawn point 30 m from everyone and out of sight in 39–53% of respawns, so the
  farthest is taken (none was seen); 54–63% of deaths come within 15 s of spawning, against the
  old town's 27–33%. Chunk 70 moves the points.
- **The new map's frames cost more and weren't measured cleanly** (chunk 67, redone): two runs
  of the town bench with 12 soldiers on 2026-10-07, with the sloping floors and the ground drawn
  as one surface with the terrain's material, gave 10.4–21.3 ms and 11.8–20.4 ms at the same
  spots, the GPU 7–17 ms, swinging by half between runs, against the island's 13.4 with 24. A
  cold first load was 14.1–14.5 s against the island's 13.1–13.6 before the slopes. Chunk 70
  measures it alternately with the island's.
- **The sea is hidden from the attackers' end but toward the horizon** (chunk 67, redone): the
  parapet stands 1.1 m over the floor behind it, a body's eye 1.6, so from a spawn the near sea
  is under it and only the far sea shows over it.
- **The new map is made from another game's navigation mesh** (chunk 67, redone 2026-10-07):
  its floors and heights come from Dust 2's mesh as the analysis library awpy (MIT) publishes it
  for its tests, fetched by `scripts/calabianca.mjs` from a pinned commit and not committed
  here; only the boxes made from it are. The layout is followed exactly, as the plan asks; none
  of the original's textures, models or name are used. Whether following a layout this closely
  is fine for a released game is a licensing question left open.
- **The new map's walls are where the mesh leaves off, its roofs by eye** (chunk 67, redone):
  the mesh keeps 0.41 m off every wall, so the floors are widened by that much, to the nearest
  25 cm; a wall thinner than about 0.5 m between two floors at one height can close up, and
  slots of floor a cell or two wide are filled. Which ways are roofed (the upper and lower
  tunnels, the way out to B, the way in from outside the tunnels) is read off screenshots and
  memory, not the mesh, which says nothing of ceilings; the B window isn't roofed. The houses'
  heights are the plan's own (6 m over the highest floor within 6 m of an 8 m plot, on whole
  metres, one height a plot), not the original's.
- **The new map's diagonal walls and boxes are drawn straight over corners that collide**
  (2026-10-07): its houses and boxes collide as 25 cm cells, so a diagonal wall is a stair of
  corners; each wall that steps (126) is drawn as one straight plastered face at its corners'
  outermost, and each box that fills most of the least rectangle round it at any angle (31) as
  a stone box turned as it stands, the corners behind them still what bodies and rounds meet. A
  body pressed into a wall's notch stands up to 30 cm into its drawn face; a round may stop up
  to that far behind it. Stacked boxes, and boxes against a wall, are still drawn as their
  cells.
- **The new map's ground floats a few centimetres over its floors** (2026-10-07): the floors
  are boxes whose tops are planes fitted within 3 cm of the original's ground, so two meet at a
  seam up to 6 cm out of true; the ground is drawn as one surface over them (`groundSurface` in
  terrain.ts), the mean of the tops meeting at each point, lifted 3.5 cm so no box's side shows
  through it, so feet stand up to about 6 cm into it. Walked floors' lips up to 10 cm count as
  underfoot on a map (`World.lip`), as the seams would otherwise stop bodies fitting. Where the
  original is steeper than 24°, its floor is a flight of 25 cm steps, as its stairs are.
- **A sloping box is drawn sheared** (2026-10-07): a box with a sloping top (`Box.tilt`) is
  drawn by shearing its instance, which tilts its sides' and top's normals wrongly; the map's
  sloping floors' tops aren't drawn as boxes (the ground surface is), so it shows only on their
  sides, a few centimetres high.
- **The new map's doors were read off the overview by eye** (chunk 67, redone): the original's
  leaves stand open, and the mesh keeps off them, so the floor is carried over where they swing
  (0.6 m round each leaf as drawn on the overview) and our fixed leaves are set across each
  doorway's narrowest part, measured along the line between its hinges, with a 1.6 m gap. Small
  nubs of wall are left where a leaf met its frame.
- **Only five of the original's boxes are crates** (chunk 67, redone): a box top the mesh walks
  on, 0.75 m over the floor round it at least, square and 0.9–1.7 m a side, is a crate; the rest
  (larger, oblong, stacked) are stone, walked on. Bots resupply at the five.
- **Crates stand on the floors only on a map of blocks** (chunk 67, redone): a map's crates
  used to be set on the terrain under any terrace, so two of the old town's are buried 0.7–1.9 m
  in theirs; on the new map they stand on the floor (`World.buildMap`), but the old town is
  left as it was, as setting them on its terraces leaves spots bots can't reach, until it goes
  in chunk 69. Likewise `lootCrates` counts a crate on a walked floor as loot only on a map
  without buildings.
- **The new map's tunnels are lit by lamps that aren't there to the sound or the bots** (chunk
  68): the lamps' light is baked as the sun's bounced light, warm, and their lanterns are drawn
  only; they cast no shadows of their own, players and bodies under them are lit by the bake
  like everything else, and nothing lights the tunnels more at night (the map is day only). The
  lower tunnels' floor stays dim between lamps; how dark a tunnel should be to play is the
  testers'.
- **The new map's windows are blind** (chunk 68): its houses are solid blocks, so their windows
  are drawn with their shutters shut, and nothing is behind them; no shutters stand open, no
  signs are put up, as the plan asked for few.
- **The new map's cold load is half a second over the island's** (chunk 68): 13.0–13.4 s
  against 12.7–13.0 on an M3 Pro, as at chunk 67, so not its look's; chunk 70 measures again.
- **The plinth steps up the ramps** (chunk 68): along a block beside a ramp it's cut every
  25 cm at the ground's height there, a stair of stone rather than a slope.
- **Production builds carry the old town until it's removed** (chunk 67): the server worker
  imports the dev test maps for `?map`, and the old Calabianca works its ground out as its
  module loads, so a build can't leave it out as it does the kit yard; it was in the worker
  before too, as Deathmatch's map. Chunk 69 removes it. Since 2026-10-07 it's played again, as
  Calabianca DM, so the client carries it too, until the user picks one map.

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
  - **Scoreboard on Tab:** built locally in chunk 47; with a server it lists everyone playing in
    the game. Records are kept by a random id each browser keeps, which anonymous identity can
    take over
  - Anonymous identity, basic anti-cheat, deployment
  - Left from the local build (see "Moved to Future" in `KNOWN_ISSUES_HISTORY.md`): scores and
    leaderboards kept by the server instead of in links and one browser; every run's stats sent to
    the server; Extraction and Deathmatch taking other players; names filtered and length-checked; conditions picked by
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
- **Deathmatch on a fixed, hand-made map** (2026-10-03): a flat-roofed Mediterranean town in
  the spirit of CoD4's Crash and CoD2's Toujane, for 16 operators, off the island, which stays
  Extraction's. Generated towns (chunks 50–51) were tried and dropped: they couldn't be made to
  play or look like a designed map. Dust 2 and Carentan were weighed first; Dust 2 is built for
  5v5 attack and defence, and Carentan's pitched roofs and ruins need more art than flat roofs,
  which also put the rooftops into play. Its own layout, not a copy of either.
  **Changed** (2026-10-06): Calabianca is rebuilt, under its name, after Dust 2's layout in the
  town's style, for 12 operators, with almost no clutter (Phase 10); its old layout is removed
  entirely. It turned out complex to build, draw and keep (roofs, upper floors, windows bots post at, the
  dressing) and slow to draw, and Dust 2 plays well as a deathmatch map in Counter-Strike. Its
  heights are kept. Its plan is followed, but nothing of Valve's name or art is used.
- **No doors** (2026-10-06): door leaves were removed in every mode (chunk 65) at the user's
  request: they added little to play (one more F press before a room) and caused Known Issues
  (bots caught by leaves, tables cutting rooms off, the door paint, a flaky browser test, light
  and sound that change as doors swing). Doorways are plain openings.
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
- **Calabianca is the original three-lane map at its players' scale** (2026-10-07): its units
  are taken as 2.54 cm, so a player there (72 tall) is ours (1.8 m), making the map 114 m a
  side, not the 1.905 cm a unit (86 m) first planned; and its layout is made from the
  original's navigation mesh rather than traced by eye, at the user's word that the traced one
  was far from the original. Spawn points stay spread round the whole map for now.
- **The sky light stays as tuned** (20): measured, it's 24% brighter than the original sky
  would give, but the lighting was tuned by eye on it, so it wasn't scaled down to match.
- **Testing:** Vitest for the shared simulation (determinism, movement, collision), and from
  chunk 19 Playwright for the game in the browser (`npm run test:browser`, and `npm run bench`
  for the frame-cost benchmark: Chromium on the Vite dev server, whose development build has the
  hooks the tests use; Firefox and WebKit until 2026-09-29).
