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
- Poly Haven for PBR textures and HDRIs, Mixamo for animations, glTF for models
- Budget for small downloads: compressed textures and level of detail (LOD)

## Implementation Roadmap

Each chunk ends in something you can play or test. **Chunks 0–6 are the proof of concept.**
Everything runs locally in the browser; there is no backend.

| # | Chunk | Scope | Done when |
|---|---|---|---|
| 0 | **Foundations** | Vite + TS setup, `shared/server/client` layout, local server in a Worker, message protocol types, fixed tick loop, fake-lag/loss toggle | A box moves when you press keys, driven by the server |
| 1 | **World and menu** | Seeded island terrain, outposts, props, trees and rocks; renderer, sky, fog; collision; **default world**; main menu with **Play** over the rendered island; `?world=` param | Load the page, press Play, and you're on the default island; the same seed gives the same island |
| 2 | **Movement** | Pointer lock, CS-like movement, sprint, crouch, jump; client prediction and reconciliation against the Worker server | Movement feels tight even with 100 ms fake lag |
| 3 | **Advanced movement** | Slide, mantle, lean, stamina, carry-weight hooks | You can mantle a crate and slide into cover |
| 4 | **Gunplay** | The 3 weapons (assault rifle, pistol, bolt-action), weapon switching, hitscan, recoil and spread, hitboxes, ammo and reload, damage and death, HUD, hit markers; lag-compensation scaffolding | You can shoot target dummies with a satisfying feel |
| 5 | **Bots** | Navigation grid, perception (sight and hearing), state machine (patrol, investigate, engage, cover, flank), difficulty levels; **guards** at outposts and **fill-bot operators** that play runs like a player | Guards defend outposts; operator bots loot and extract |
| 6 | **Run loop** | Quick join through the local "game directory" (first game not full, capped at 12 operators), PvE and Mixed modes, drop-in insertion, run clock and MIA, loot containers, inventory and weight, extraction points opening and closing, call-and-hold extraction, results screen and score | **The full PvE and Mixed loop is playable. First real playtest.** |
| 7 | **Destructible cover** | Panel-based walls, fences and crates with HP, debris, collision updates, destruction events, grenades | You can blow a hole in a wall and shoot through it |
| 8 | **Contracts and noise** | Objectives per run (intel, cache, commander), noise events that attract bots, suppressors | Runs feel different from each other |
| 9 | **Look and sound** | Realistic assets (glTF, PBR, animations), positional audio, footsteps, muzzle flash, performance pass | It looks and sounds like a real game |
| 10 | **Shareable worlds** | World config and sharer name + score in the URL, per-world local leaderboard, share button, static hosting, death cam from recorded inputs | You send a link and a friend gets the same island with your score to beat |

### Phase 2: polish and depth (still local only)

Chunks 11–18 finish the single-browser game. Multiplayer stays in **Future**, and none of these
chunks may break the rules that keep multiplayer easy to add later. Each chunk also resolves
the Known Issues named in its scope.

| # | Chunk | Scope | Done when |
|---|---|---|---|
| 11 | **Ship and load** | Verify GitHub Pages end to end (the live site, share links, `?world=`); a loading screen with progress instead of the flat-colour swap; KTX2 textures and meshopt glTF; code splitting so the first bundle is under 500 kB; build the texture arrays off the main thread (`createImageBitmap` / a Worker); replace the Mixamo soldier with a CC0 character (e.g. Quaternius); generate the texture layer list from one source | A stranger opens the live link on a mid-range laptop and is playing within about 5 s on a warm cache; no licensing doubts left |
| 12 | **Playtest and tuning** | A local run-stats log (length, cause of death, extraction used, contracts done, loot value) with a debug panel to read it; tune the operator cap, guard count, bot difficulty, weapon damage and recoil, extraction timings and loot values from playtests; fix what playtests find; mode-less links; the menu at small window sizes | Several full runs by other people; the average run lands in 3–10 minutes, and no single strategy dominates |
| 13 | **Animation** | Death animation with a simple ragdoll that doesn't sink into ground or walls; third-person crouch-walk, slide, mantle, jump and fall clips; third-person reload, weapon switch and grenade throw; suppressors on third-person guns; first-person arms with animated reloads; a distinct look for commanders and each side; hit flash only where the round landed; the body lean matches the lean hitbox | Watching another operator, you can tell what they are doing: crouching, sliding, reloading, throwing |
| 14 | **Sound** | Recorded CC0 samples replace synthesized ones (a new source, e.g. Freesound CC0, checked per file); occlusion and simple reverb from walls and buildings; ambient wind, sea, birds and distant fighting; footstep surfaces read from the painted terrain; a sliding scrape; pooled panner nodes | With eyes closed you can tell the direction, distance and whether a wall is in between |
| 15 | **World detail** | Buildings with doors, windows and simple interiors built from breakable panels; ground cover (grass, bushes, small rocks) near the player; tree LOD, impostors and sway; water with waves, shoreline foam and an underwater effect; debris textured like its panel; cascaded shadows; terrain LOD; adaptive resolution checked on slow hardware | Outposts can be fought through room by room, and the island looks alive at 60 fps on a mid-range laptop |
| 16 | **Day/night and weather** | Time of day and weather become part of the world config (and so the link); lighting, sky and fog follow them; night brings more and tougher guards but better loot; flashlights (visible to bots, so a noise-like trade-off); rain and fog shorten sight and mask noise in bot perception; leaderboards are kept per condition | The same island plays differently at noon, at night and in fog, and a link reproduces the exact conditions |
| 17 | **Full-run replays** | Record the whole run as inputs plus periodic keyframes (extending the death cam tape); keep cover-state history so replays show panels breaking at the right time; a replay viewer with scrubbing, speed control and a free camera; export and import a compact replay file (no backend, so it's shared as a file); a HUD in the death cam | You finish a run, save the replay, send the file, and a friend watches it exactly as it happened |
| 18 | **Squads (with bots)** | A PvE option to drop in with 1–3 bot squadmates; a downed state and revive for both you and them; simple squad commands (follow, hold, regroup); squadmates share the run and the score. Humans taking those slots stays Future | A downed player gets revived by a bot squadmate under fire, and the squad extracts together |

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
  other guard.
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
- **Assets are uncompressed** (9): JPEG textures instead of KTX2, and glTF without Draco or
  meshopt. The soldier is 2 MB and the sky 1.4 MB, about 6 MB in total.
- **Building the texture arrays can stall the page** (9). It uses canvas `getImageData` on the
  main thread at startup.
- **The JavaScript bundle is over 500 kB** (9), with no code splitting. The build warns about
  it.
- **The terrain is one full-resolution mesh**, with no LOD.
- **Adaptive resolution is untested on slow hardware** (9) and could flip back and forth.
- **Every positional sound creates its own panner node** (9), released on a timer. Heavy
  fights create a lot of them.

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

### Code and testing
- **The texture layer list is duplicated** (9) in `scripts/fetch-assets.mjs` and
  `src/client/assets.ts`, and must be kept in step by hand.
- **The client's rendering, animation and audio have no automated tests** (9). They were checked
  by screenshots only, and nobody has listened to the audio.
- **The death cam, menu, leaderboard UI and share button have no automated tests** (10). The
  tape replay, share links and leaderboard storage are tested; the rest was checked by
  screenshots in a headless browser only.
- **The menu's layout is only checked at desktop size** (10). It now scrolls when the window is
  too short, but it wasn't tried at small sizes.
- **Gun fitting uses hand-measured fractions** (9) in `src/client/guns.ts`, so a new model needs
  measuring again.

## Future
- **Multiplayer**
  - Node server that reuses `server/`, with WebSocket first
  - Snapshot deltas, interpolation and lag compensation
  - Real matchmaking: the first instance that isn't full, or a new one, for each world
  - Bot fill that shrinks as humans join
  - Anonymous identity, basic anti-cheat, deployment
- **Transport upgrade:** WebTransport or WebRTC DataChannels (UDP-like), server-side visibility
  culling, server leaderboards
- **Squads with humans:** friends take the bot squadmate slots from chunk 18
- **Replay links:** shareable through the server instead of as files (chunk 17 covers local
  replays)
- Global leaderboards and seasonal featured islands

## Decisions
- **Weapons for the proof of concept:** assault rifle, pistol and bolt-action rifle
- **Capacity:** 12 operators and about 24 guards per game (tunable constant)
- **Backend:** none for now; the game is local only. Multiplayer is a future feature.
- **After the proof of concept:** chunks 11–18 polish and deepen the local game. Multiplayer
  stays in Future and comes after them.
- **Platform:** desktop only (keyboard and mouse) in current Chrome, Firefox and Safari. Target
  is 60 fps on a mid-range laptop. No touch or mobile support for now.
- **Assets:** simple placeholder shapes until chunk 9. After that, only CC0 assets (Poly Haven,
  ambientCG, Quaternius) plus Mixamo animations.
- **Share links carry the sharer's score.** With no backend, leaderboards live in each browser,
  so the link encodes the world config plus the sharer's name and score as the target to beat.
- **Hosting:** a static site (e.g. GitHub Pages or Cloudflare Pages) is needed in chunk 10 so
  that links can be shared. It serves files only; there is still no game server.
- **Existing scaffold:** the uncommitted setup and `src/shared` world generator get reused and
  reviewed in chunks 0 and 1.
- **Testing:** Vitest for the shared simulation (determinism, movement, collision).
