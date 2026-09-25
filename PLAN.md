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
| **PvE (solo)** | You versus AI on your own island. Played just for fun. |
| **Mixed** | Other operators share the island with you. Locally they are all bots. In future multiplayer, bots fill empty slots and are removed as humans join. |

### World capacity

The island is 800 × 800 m, with 6 outposts.

| Kind | Count | Notes |
|---|---|---|
| **Operators** (players and fill bots) | **12** per game | Mixed mode: every slot starts as a bot, and humans replace them in the future. PvE: only you. |
| **Guards** (world AI) | ~24 | About 3 per outpost, plus patrols. Present in both modes. |

**Why 12:** that's roughly 50,000 m² per operator, which is about a 230 m square each. Runs are
3–10 minutes, so you meet another operator every 1–3 minutes, while guards fill the time in
between. At 16 or more, the island feels like a deathmatch and extraction points get camped. At 8
or fewer, it feels empty. The cap is a single constant, to be tuned during playtests.

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
- Slide
- Mantle over walls and crates
- Lean left and right (Q/E), which pairs with destructible cover
- **Carry weight.** Heavy loot slows you down and disables slide and mantle, so loot and movement
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

### Shareable worlds and leaderboards
- The world config (seed and settings) is encoded in the URL.
- Each world has its own leaderboard: stored locally first, on the server once there is
  multiplayer.
- A share button on the results screen.

### Replays (cheap because the simulation is deterministic)
- The simulation runs on inputs, so a run can be recorded as its inputs.
- Death cam first, shareable replay links later.

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
a chunk is **Done** (committed) or **Not started**.

| # | Chunk | Scope | Done when | Status |
|---|---|---|---|---|
| 0 | **Foundations** | Vite + TS setup, `shared/server/client` layout, local server in a Worker, message protocol types, fixed tick loop, fake-lag/loss toggle | A box moves when you press keys, driven by the server | **Done** |
| 1 | **World and menu** | Seeded island terrain, outposts, props, trees and rocks; renderer, sky, fog; collision; **default world**; main menu with **Play** over the rendered island; `?world=` param | Load the page, press Play, and you're on the default island; the same seed gives the same island | **Done** |
| 2 | **Movement** | Pointer lock, CS-like movement, sprint, crouch, jump; client prediction and reconciliation against the Worker server | Movement feels tight even with 100 ms fake lag | **Done** |
| 3 | **Advanced movement** | Slide, mantle, lean, stamina, carry-weight hooks | You can mantle a crate and slide into cover | **Done** |
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
| 12 | **Playtest and tuning** | A local run-stats log (length, cause of death, extraction used, contracts done, loot value) with a debug panel to read it; tune the operator cap, guard count, bot difficulty, weapon damage and recoil, extraction timings and loot values from playtests; fix what playtests find; mode-less links; the menu at small window sizes | Several full runs by other people; the average run lands in 3–10 minutes, and no single strategy dominates | Not started |
| 13 | **Animation** | Death animation with a simple ragdoll that doesn't sink into ground or walls; third-person crouch-walk, slide, mantle, jump and fall clips; third-person reload, weapon switch and grenade throw; suppressors on third-person guns; first-person arms with animated reloads; a distinct look for commanders and each side; hit flash only where the round landed; the body lean matches the lean hitbox | Watching another operator, you can tell what they are doing: crouching, sliding, reloading, throwing | Not started |
| 14 | **Sound** | Recorded CC0 samples replace synthesized ones (a new source, e.g. Freesound CC0, checked per file); occlusion and simple reverb from walls and buildings; ambient wind, sea, birds and distant fighting; footstep surfaces read from the painted terrain; a sliding scrape; pooled panner nodes | With eyes closed you can tell the direction, distance and whether a wall is in between | Not started |
| 15 | **World detail** | Buildings with doors, windows and simple interiors built from breakable panels; ground cover (grass, bushes, small rocks) near the player; tree LOD, impostors and sway; water with waves, shoreline foam and an underwater effect; debris textured like its panel; cascaded shadows; terrain LOD; adaptive resolution checked on slow hardware | Outposts can be fought through room by room, and the island looks alive at 60 fps on a mid-range laptop | Not started |
| 16 | **Day/night and weather** | Time of day and weather become part of the world config (and so the link); lighting, sky and fog follow them; night brings more and tougher guards but better loot; flashlights (visible to bots, so a noise-like trade-off); rain and fog shorten sight and mask noise in bot perception; leaderboards are kept per condition | The same island plays differently at noon, at night and in fog, and a link reproduces the exact conditions | Not started |
| 17 | **Full-run replays** | Record the whole run as inputs plus periodic keyframes (extending the death cam tape); keep cover-state history so replays show panels breaking at the right time; a replay viewer with scrubbing, speed control and a free camera; export and import a compact replay file (no backend, so it's shared as a file); a HUD in the death cam | You finish a run, save the replay, send the file, and a friend watches it exactly as it happened | Not started |
| 18 | **Rivals** | Operator bot personalities: the *rat* (sneaks, loots, avoids fights), the *hunter* (follows gunfire to find wounded operators), the *camper* (waits near extraction points) and the *looter* (goes for high-value crates); third-partying, so operators are drawn to fights between others; a bounty on the operator carrying the most value, who is marked or heard more easily; a kill feed; bags left by bodies show their value before you open them. Personalities carry over as fill bots in future multiplayer | In Mixed mode, meeting another operator plays out differently depending on who they are, and a big haul makes you feel hunted | Not started |

## Known Issues

Shortcomings of what has been built so far, to improve later. Every chunk adds the gaps it
leaves here. Each item notes the chunk it came from. Fixed items stay in the list: they are
marked **Resolved** with the chunk or commit that fixed them and how.

### Look and animation
- **No death animation or ragdoll** (9). Bodies topple backward stiffly around their feet and
  can sink into the ground or walls.
- **Third-person movement has no animations beyond idle, walk and run** (9). Crouch-walking is
  a bent walk posed in code. Sliding, mantling, jumping and falling still play the walk or run
  clip.
- **Actions aren't animated in third person** (9). Reloading, switching weapons and throwing
  grenades don't show on other players.
- **Third-person guns don't show suppressors** (9), although the viewmodel does.
- **Distant bodies animate at 12 Hz and skip hand IK** (9), beyond 90 m. It's cheaper, but
  scoped players may notice the stutter.
- **One soldier model for every side, told apart only by tint** (9). Commanders look like any
  other guard. Since chunk 11 only the uniform is recoloured, not the whole body.
- **The hit flash lights the whole body** (9), not just where the round landed.
- **The body lean is only an approximation of the lean hitbox** (9). The head ends up roughly
  over its hit sphere, but not exactly.
- **First-person hands are boxes** (9), with no arms or animated reload.
- **Buildings are still boxes** (9): the walls, watchtowers, containers and crates are textured,
  but the geometry is primitive. There are no doors, windows or interiors.
- **Trees are procedural** (9), because Poly Haven's tree models are hundreds of MB each. They
  have no LOD or impostors, and they don't sway.
- **There is no ground cover** (9): no grass blades, bushes or small rocks near the player.
- **Water is a flat, see-through plane** (9), with no waves, reflections, shoreline foam or
  underwater effect.
- **Debris is coloured with each layer's average** (9), not textured like the panel it came
  from.
- **Shadows use one fixed 2048 px map** (9), with no cascades, so distant shadows are coarse or
  missing.
- **The soldier is stylized, not realistic** (11). Quaternius's low-poly SWAT character was the
  best rigged and animated CC0 soldier available, but it doesn't match the grounded tone. Its
  helmet hides the face, and its hands stay open instead of gripping the gun.
- **Walk and run speeds are estimated** (11). The clips' natural speeds (1.3 and 3.2 m/s) were
  worked out from how far the feet travel, not watched in motion, so feet may slide a little.
  Sprinting plays the run clip up to 1.8× faster.
- **Crouch-walking looks like lunging** (11). The crouch drops the body and bends each leg with IK
  to where the walk clip puts the feet, and those feet are placed for standing height.
- **The soldier's other clips were dropped** (11) to save download size: death, shooting, hit
  reactions and rolls. Chunk 13 can bring back the death clip from the source file.

### Sound
- **Every sound is still synthesized** (9), not recorded. The plan's CC0 asset sources have no
  audio, so recorded samples need a new source.
- **Sound ignores walls** (9): there's no occlusion and no reverb, and footsteps can be heard
  through walls.
- **There's no ambient sound** (9): no wind, sea, birds or distant fighting.
- **Surface detection for footsteps is rough** (9). It uses thresholds on height, slope and
  distance to an outpost, and doesn't match the painted terrain exactly.
- **No sliding scrape** (9). Slides are silent.

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
- **Adaptive resolution is untested on slow hardware** (9) and could flip back and forth.
- **Every positional sound creates its own panner node** (9), released on a timer. Heavy
  fights create a lot of them.
- **The total JavaScript loaded at start barely changed** (11): about 740 kB minified (200 kB
  gzipped), now in four chunks that load in parallel. Splitting keeps three.js cached across
  game updates, but it doesn't shrink the download.
- **The Basis transcoder costs 527 kB** (11), or 249 kB gzipped. That eats much of what KTX2
  saves on the download. The real gains are GPU memory and no main-thread stall.
- **KTX2 textures are lossier than the JPEGs** (11): ETC1S, with two-channel normal maps. They
  were only compared by screenshot.
- **The sky is prefiltered through a 256 px cube** (11). Prefiltered straight from the halved
  image, it lit the island noticeably brighter, so it's first drawn into a cube the size the
  full image gave. The match was checked by screenshot only.
- **The loading bar is approximate** (11). It leaves out the script download (it sits at 0 until
  the scripts run), it guesses sizes that aren't known yet, and gzipped files count as done
  early, because their size is the compressed one.
- **The 5 s load target wasn't measured on a mid-range laptop** (11). Locally on an M3 Pro, the
  production build loads in 1.1 s cold and 0.4 s warm (3 MB transferred). The new build isn't on
  the live site until it's pushed.
- **Skipping the loading screen brings back the flat-colour swap** (11), which then shows
  mid-game when the assets land.

### Sharing and leaderboards
- **Scores in links can be faked** (10). With no backend, a link's `by` and `score` are plain
  query parameters, so anyone can edit them. They're a friendly challenge, not a record.
- **Leaderboards only hold your own runs, in one browser** (10). They're lost when site data is
  cleared, and they don't follow you to another device.
- **A link without a mode is taken as Mixed** (10), so an old `?world=` link with a score in it
  and no `mode` compares against Mixed runs.
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

### Death cam
- **Only the killer is replayed from inputs** (10). Everyone else is drawn from the snapshots the
  victim's client received, so they're a little behind, and bots out of sight may pop in.
- **The replay uses today's cover** (10). Panels that broke or were rebuilt during those seconds
  are drawn and collided as they are now, so a replayed killer can walk or shoot differently
  around them.
- **The killer's state can drift between keyframes** (10). The server changes a few things
  outside the commands (health, ammo from loot, dying). The replay re-syncs to a full state
  every 0.5 s, so errors are small and short-lived, but they're there.
- **No HUD in the death cam** (10): there's no hit marker, killer health or ammo. The bolt
  scope overlay is the only thing shown besides the banner.
- **Death cam clips are big** (10): about 6 s of commands and keyframes as plain JSON, some tens
  of kB per death. That's fine through the Worker, but multiplayer should pack it.
- **Every player's inputs are taped all the time** (10), including guards far from anyone, just
  in case they kill someone. It's cheap, but it isn't free.
- **Deaths on the range get no death cam**, and neither does a self-kill with a grenade.
  Replays can't be shared yet either (see Future).

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
- **The death cam, menu, leaderboard UI and share button have no automated tests** (10). The
  tape replay, share links and leaderboard storage are tested; the rest was checked by
  screenshots in a headless browser only.
- **The menu's layout is only checked at desktop size** (10). It now scrolls when the window is
  too short, but it wasn't tried at small sizes.
- **Gun fitting uses hand-measured fractions** (9) in `src/client/guns.ts`, so a new model needs
  measuring again.
- **The asset script needs an Apple Silicon Mac** (11). It uses `sips` and `pkgutil`, and it
  downloads the arm64 build of the KTX tools unless `ktx` is on the PATH.
- **The loading screen and asset pipeline have no automated tests** (11). They were checked in
  a headless browser with software and Metal rendering, by screenshot and by timing.

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

## Decisions
- **Weapons for the proof of concept:** assault rifle, pistol and bolt-action rifle
- **Capacity:** 12 operators and about 24 guards per game (tunable constant)
- **Backend:** none for now; the game is local only. Multiplayer is a future feature.
- **After the proof of concept:** chunks 11–18 polish and deepen the local game. Multiplayer
  stays in Future and comes after them.
- **No squads:** operators play free-for-all. Squads were dropped because the game's pitch
  ("beat my score") is a solo challenge, and revive would soften "die = score 0".
- **Platform:** desktop only (keyboard and mouse) in current Chrome, Firefox and Safari. Target
  is 60 fps on a mid-range laptop. No touch or mobile support for now.
- **Assets:** simple placeholder shapes until chunk 9. After that, only CC0 assets (Poly Haven,
  ambientCG, Quaternius). Chunk 9 also used a Mixamo soldier, which chunk 11 replaced to leave
  no licensing doubts.
- **Share links carry the sharer's score.** With no backend, leaderboards live in each browser,
  so the link encodes the world config plus the sharer's name and score as the target to beat.
- **Hosting:** a static site (e.g. GitHub Pages or Cloudflare Pages) is needed in chunk 10 so
  that links can be shared. It serves files only; there is still no game server.
- **Existing scaffold:** the uncommitted setup and `src/shared` world generator get reused and
  reviewed in chunks 0 and 1.
- **Testing:** Vitest for the shared simulation (determinism, movement, collision).
