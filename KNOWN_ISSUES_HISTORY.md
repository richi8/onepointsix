# onepointsix — Resolved Known Issues

Known Issues from [PLAN.md](PLAN.md) that have been fully resolved, turned moot or accepted as
they are, kept with how each was resolved. Grouped by the same areas as in the plan; each item
notes the chunk it came from.

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
- **There is no ground cover** (9): no grass blades, bushes or small rocks near the player.
  **Resolved** (15): grass clumps (to 42 m), low bushes (to 75 m) and pebbles (to 35 m) are
  scattered round the camera. Each 8 m cell scatters them the same way every time, thickest where
  the ground is painted grass, and never on props, under roofs or in the sea. They shrink away
  toward the edge of their range, and the grass and bushes sway.
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
- **Doors are open doorways** (15). There are no door leaves to open or shut. Doorways are 2.2 m
  wide so a bot's path always fits through the 1 m nav grid. Windows are open holes with no glass.
  **Resolved** (23): every doorway is hung with a pair of wooden leaves that swing into the room
  (about 40% start open). Interact (F) facing a doorway opens or shuts both, unless someone else
  stands where a leaf would go; everyone is sent a `door` event and bots within 22 m hear it. A
  leaf is a breakable panel (120 HP) whose box moves between its shut and open places; the
  collider grid files it under the cells of both. The nav grid leaves door leaves out, so paths go
  through shut doors, and a bot about to walk into a shut leaf opens it. The open doors are in the
  join message, in replays and the death cam (rebuilt like broken panels). Every window has a
  pane of glass (a 1 HP panel on its sill) that stops bodies and rounds but not sight or light: bots
  and the light volume look through it, and a round breaks it and carries on. The doorways stayed
  2.2 m wide.
- **One building plan for every outpost** (15): two rooms, a front door, an end door and a door
  between them. It varies only in size, the placement of its openings and which of four corners
  and turns it takes. There are no buildings outside the outposts.
  **Resolved** (23): four plans (one room; two rooms; an L of two rooms round a small yard, joined
  by a doorway; two storeys, with stairs up the back wall to an upper floor with a window each
  way). The plans are shuffled per island, so its first four outposts each get a different one.
  Two to six one- or two-room huts stand out in the country, on flat ground away from outposts,
  extraction points and trees, each on a concrete floor with one ordinary crate; they're placed
  last from their own random stream, so nothing else moved.
- **Outposts were rearranged** (15). The building takes a corner, so the containers and crates
  landed elsewhere on every island. An older link or leaderboard score is for the old layout of
  the same island. Only the outposts' insides changed; terrain, trees, rocks, fences and
  extraction points didn't move.
  **Again** (23): with the new plans, the containers and crates inside every outpost moved once
  more (they're now placed from the outpost's own stream). The island's stream is still drawn
  from as it was before and the draws thrown away, so everything outside the outposts stands
  where it did (checked by hashing the terrain, trees, rocks, scattered cover, fences, extraction
  points and outpost walls of six islands before and after).
- **The roof can't be broken** (15), though every wall can. With all the walls blown out, a
  roof is left standing on its four corner posts.
  **Resolved** (23): roofs are sections about 2.4 m wide (400 HP each), each held up by every wall
  panel, lintel and corner post whose top it rests on, and coming down only once all of them have
  gone (a panel's `falls: 'all'`). Corner posts can be broken too. A section can be rebuilt once
  anything under it stands again.
- **Indoor light is a flat cut** (15). Surfaces inside a building's walls and under its roof get
  30% of the sky's light, with a hard edge at the doorway. Light through doors and windows isn't
  modelled, and soldiers and debris inside aren't dimmed.
  **Resolved** (23): each building has a light volume (`indoorlight.ts`): cells about 0.5 m across,
  each holding the share of 40 directions over the sky that leave the building without meeting a
  solid 0.25 m block (walls, shut doors, roof; glass lets light through), marched through a
  voxelized copy of the building. A cell gets 30% of the sky's light plus 2.6 times the share it
  sees, up to all of it. The grids share one 3D texture; terrain, props, debris, soldiers and their
  guns sample it a little off the surface, so a wall's two faces read their own sides, and the
  first-person gun takes the value at the camera. A building's grid is worked out again, a little
  each frame, when its doors or panels change; all ten buildings of the default island take about
  35 ms in Node. Sunlight through windows comes from the shadow maps as before; bodies now take
  the world's shadows in and near buildings, so a room keeps the sun off them.
- **The tree impostors are rough** (15). There's one picture from the side, lit evenly and then
  darkened by a hand-set 0.4 to match the full trees. Trees switch between full and impostor at
  170–190 m with no cross-fade. A sun-facing card only approximates a crown's shadow, and
  swaying crowns cast still shadows.
  **Resolved** (24): the tree is baked from eight sides, its colours in one picture and its
  normals in another, and each card shows the two sides nearest the one it's seen from, blended.
  The scene's lights shade it through the baked normals, so no hand-set darkening is left. Each
  tree dissolves into its impostor pixel by pixel between 110 and 140 m (a screen-space dither the
  two share), not a whole tile at once. The impostors' crowns sway as the full trees' do, and the
  full trees' shadows sway with them. Still open: see "Impostors are baked from the side" below.
- **The sea reflects only the sky** (15), through the environment map. There are no reflections
  of the island. Out past the rolling grid the waves are only in the normals. Far off, the sea
  looks pale, reflecting the bright horizon. The underwater effect is only fog: no muffling and no
  distortion. It can only be seen when the death camera sinks into the sea.
  **Resolved** (24): each frame the island, its trees, props and rocks and the sky are drawn from
  below the surface into a picture a third of the screen's size, which the sea mirrors by
  Fresnel, rippled by the waves. A ring of vertices spreading out with distance carries the
  waves on to 1 km, with a new long swell (48 m) that still rolls there, and every wave fades out
  where it's too fine for the vertices or the pixels, which also ends the rings the far sea
  shimmered in. At a glancing angle the reflection is held to 60% and read a little higher up
  the sky, so the far sea is no longer the horizon's white; what paleness is left is the fog.
  Under water, sound is muffled (a 450 Hz low-pass and a little quieter) and the view sways. It
  can still only be seen from the death cam or a replay's free camera. Still open: see "The
  reflection is partial" below.
- **Far terrain doesn't carry what stands on it** (15). Trees, rocks and props sit on the exact
  ground, so on a coarse far tile they can float or sink a little.
  **Resolved** (24): trees, impostors, rocks, props, window glass and bushes are moved in their
  vertex shaders to the ground as their tile is drawn: the shader works out which level
  three.js's LOD picked for the tile underneath and reads the heights from a texture. Unit tests
  check the heights against the drawn levels and the level against three.js's own pick. Bodies,
  bags, extraction flags, contract props and debris still stand on the exact ground, which
  matters little: they're small, and most are near.
- **The textured island looks washed out** (noticed in 15, from 11). The strong sky light
  (environment intensity 1.7) flattens the ground's colours and makes the sun's shadows faint.
  Checked against the build before chunk 15: it looked the same.
  **Resolved** (15, follow-up): the sun is up from 2.6 to 3.3 and the sky light down to 1.0
  (hemisphere 0.3), so the sunlit side outweighs the shade and shadows read; tone mapping is
  Khronos PBR Neutral at 0.9 exposure instead of ACES, which bleached greens toward yellow-grey;
  fog starts at 120 m instead of 60 m. Alpha-tested grass and bush cards had their alpha boosted
  by mip level, since distant ones were thinning into pale hollow outlines. Distant bushes still
  look a little blue-grey from the sky light on their up-facing normals.
  **Resolved** (24), the bushes: it wasn't the normals. The leaf picture's see-through pixels
  were black (a canvas can't keep a colour where it's fully transparent), and the smaller mips,
  which the alpha boost keeps past the alpha test, averaged that black in; dark leaves under the
  sky light read blue-grey. The see-through pixels now carry the leaves' average colour. Distant
  bushes are green, a little cool.
- **Underwater fog was lost after relighting** (noticed in 24): if the island was lit anew while
  the camera was under water (the textures arriving, or the time or weather changing), the fog
  went back to the air's while the sea still thought it was holding the underwater one, and
  surfacing left the background on a stale copy of the sky's colour.
  **Resolved** (24): the sea keeps the new air fog for surfacing and keeps the underwater fog on,
  and restores the scene's own background.

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
- **Only real fights make distant fighting** (14). In PvE the guards only fight you, so the
  island is quiet apart from your own fights.
  **Resolved** (modes change): PvE is gone. Offline has 7 operator bots, and they fight the guards
  and each other across the island.
- **Occlusion is three steps and only along lines** (14): clear, over the top or blocked. It
  doesn't bend round corners, the thickness of what's in between doesn't count, and a tree trunk
  exactly on the line muffles a sound as much as a building does.
  **Resolved** (26): a sound takes the loudest of three ways. Straight through, where everything
  on the line counts by what it's made of and how thick it is there (per metre: masonry 9, a
  door 6, a fence 4, glass 40, a crate 1.2, a tree trunk 0.5, a rock 2, a metre of hill 0.6, as the
  exponent of what gets through), so a 0.3 m wall lets under a tenth through and a trunk most of
  it. Over the top, as before, but only when neither end has a roof over it (a sound inside a
  house used to get "over" its roof). Or round, within 48 m: `src/client/soundfield.ts` keeps a
  1 m grid of where sound can pass at head height (shut doors block it, open doors and anything
  under 1.2 m don't) and floods it from the listener's cell with Dijkstra, again once the
  listener has moved two cells or a door or panel changed (0.9 ms a flood on an M3 Pro). The way
  is pulled tight into corners; it's heard from the first corner, from the whole way's length, and
  muffled 10% plus up to 25% more per bend by how sharp it is. It's not the nav grid, as planned:
  that one ignores doors (bots open them) and keeps a body's clearance, which closes gaps sound
  gets through.
- **The sea's bearing is an average** (14) of the directions that found water at the nearest
  radius, so on a narrow point with sea on both sides it can seem to come from inland.
  **Resolved** (26): the sea comes from the middle of the widest run of neighbouring directions
  that find water at that radius, so it always lies on the water. With sea on both sides of a
  point, it comes from one side only (the wider); a second sea voice would be needed for both.
- **Far fights fill the voice pool** (14). A distant shot holds a voice through its delay and its
  2 s tail, so a long firefight far off keeps most of the 24 voices busy. When all are busy, the
  quietest sound is cut off (or the new one isn't played), so near sounds still win.
  **Resolved** (26): shots and blasts more than 150 m off go to a distant-battle bed: 10 voices of
  its own, fed into 8 buses placed round the listener by compass bearing, through one 2.5 kHz
  low-pass and into the open reverb. The 24 voices are left for near sounds; a browser test fires
  60 shots from 250 m and checks none of them takes one. Far sounds are still muffled by hills
  straight in between, but not routed round anything.
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
- **Doors and glass borrow sounds** (23): a door is the wooden footstep played slow, and breaking
  glass is the wood splinter played high. Real recordings of both are left for chunk 26's better
  recordings.
  **Resolved** (26): a door opening (a latch and swing) and a wooden door slamming, and a pane
  of glass smashed by a rock, all CC0 recordings.

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
- **Every positional sound creates its own panner node** (9), released on a timer. Heavy
  fights create a lot of them.
  **Resolved** (14): sounds out in the world take turns on a pool of 24 voices (gain, low-pass,
  HRTF panner and reverb send) built once when audio unlocks. Only the buffer source is new for
  each sound, as the Web Audio API requires.
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
- **Skipping the loading screen brings back the flat-colour swap** (11), which then shows
  mid-game when the assets land.
  **Resolved** (20): a picture of the last flat-coloured frame covers the view while the
  textures go on and their shaders compile, then fades away over 0.8 s. The game goes on
  underneath, so the view stands still for as long as the compile takes.
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
- **Bushes and grass once depended on the broken panels** (found in 27). They were scattered the
  first time a cell was needed, avoiding colliders as they stood then, so a cell first needed
  after a wall fell could differ between the server and a client. **Resolved** (27): they're
  scattered against the world as built (`World.clearAsBuilt`).

### Sharing and leaderboards
- **A link without a mode is taken as Mixed** (10), so an old `?world=` link with a score in it
  and no `mode` compares against Mixed runs.
  **Resolved** (12): a link without a mode keeps the mode you last played, and its score is the one
  to beat in whichever mode you pick (except the range). The menu then doesn't name a mode.
- **PvE scores were left behind** (modes change). Offline has 7 bot operators where PvE had none,
  so its scores don't compare, and PvE's board is still in storage but never shown.
  **Resolved** (29): every `board:<seed>:pve` key is removed from localStorage as the page loads.
  Mixed's boards stay, since Online still reads them.
- **The share button copies the link, and doesn't open the system share sheet** (10). Where the
  clipboard is blocked it falls back to a `prompt()` with the link.
  **Resolved** (29): where the browser has `navigator.share` (Safari, Chrome on macOS and
  Windows) the link goes through the share sheet with a line such as "Beat my 9,100 on this
  island."; closing the sheet does nothing more, and any other failure falls back to copying.
  Firefox has no share sheet and copies as before. Only tested with a stubbed share sheet, since
  headless browsers can't show a real one.
- **GitHub Pages hosting isn't verified from here** (10). The deploy workflow has existed since
  chunk 0, but nobody has checked that Pages is enabled and that the live site's links work.
  **Resolved** (11): checked with a headless browser against
  https://richi8.github.io/onepointsix/. It served the latest pushed build (chunk 10's bundle
  hash) and the assets, and a `?world=4242&mode=pve&by=Tester&score=1234` link opened island
  #4242 in PvE with the challenge shown. Pages gzips `.hdr` and `.glb` and caches for 10 minutes.

### Day, night and weather
- **Others' flashlights shine from their gun's muzzle** (16). There's no torch model on the gun,
  and the death cam doesn't light your view from the killer's flashlight.
  **Resolved** (25): every gun, in the world and in your hands, carries a torch (right of a long
  gun's fore-end, under the pistol's barrel) whose lens glows while lit; beams leave its lens along
  the gun. In a death cam the killer's light, as this client last saw it, lights their view.
- **Bots see a light only when they can see its holder** (16). A beam sweeping over a wall from
  someone hidden behind it gives nothing away, and a light is judged by where its holder stands,
  not where it points.
  **Resolved** (25): the server works out once a tick where each lit beam lands (up to 30 m, along
  the holder's aim); a bot that sees that patch in its view cone and range, holder out of sight,
  investigates round the holder, vaguer the longer the beam. A unit test covers it.
- **Rain falls indoors** (16), through roofs. There are no splashes, wet surfaces, puddles or
  thunder, and the streaks are 1-pixel lines.
  **Resolved** (25): a roof map (0.5 m cells, 64 m round the camera, remade as you move or a roof
  breaks) hides drops under roofs and keeps floors under them dry. Streaks are 12 mm quads;
  splashes land on the ground, roofs and the sea; terrain, props and rocks darken and shine when
  wet, and near-flat terrain gathers puddles; lightning flashes the sky, fog and flat light, and a
  recorded thunder (CC0) follows, delayed by distance.
- **Rain only muffles noise for bots** (16). For the player, far-off shots and footsteps are as
  loud as ever; the rain loop just plays over them.
  **Resolved** (25): in rain, shots, blasts, breaking cover, doors and steps from 10 m off fade
  to 45% quieter and 55% duller by 120 m. Not checked by ear.
- **Night reflections are the day sky, dimmed** (16). The image-based light comes from the one
  daytime HDRI turned down to 2%, so shiny things still reflect a faint blue daytime sky.
  **Resolved** (25): at dusk and night the game's own sky (moon or low sun, colours and glow) is
  baked into the environment when the conditions change. It's baked 70% greyer than it looks,
  and the night's strength raised to 7, so the island's brightness and colour stay close to
  chunk 16's (measured on screenshots); reflections are greyer than the sky in view as a result.

### Death cam
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
- **Deaths on the range get no death cam**, and neither does a self-kill with a grenade.
  Replays can't be shared yet either (see Future).
  **Resolved** (17) for sharing: whole runs are saved and opened as replay files.
  **Resolved** for the range only (modes change): the range was removed. A self-kill with a
  grenade still gets no death cam.
  **Resolved** (27): a self-kill gets a death cam through the player's own eyes, headed "Killed by
  your own grenade", with no kill marker.

### Replays
- **Only the player is replayed exactly** (17). Their inputs rebuild them through the simulation;
  everyone else is drawn from the snapshots their client got, 15 a second (every other one),
  rounded to the centimetre and milliradian. Others' recoil, exact aim and footing aren't theirs,
  and a body dying between two frames snaps to the next one.
  **Resolved** (28): the server logs everything its humans do, by the tick it heard it, from the
  game's start (`GameLog`), and sends the log with the run's tape. The server is deterministic, so
  a worker runs the whole game again from its seed and the log (`Rerun`, `ExactRun`) and hands the
  viewer every tick of everyone, exact. Each tick is checked against the frames the file kept: the
  same bodies, and each body sampled to the centimetre. Only checked ticks are used; from the first
  that differs the replay goes on with the frames. A dying body holds its state until the next
  snapshot rather than snapping to it (live too).
- **A ten-minute replay is about 900 kB** (17), most of it the other 30-odd bodies. A 45-second
  test run is about 70 kB. Frames at 10 a second, or leaving out bodies far from the player,
  would halve it.
  **Resolved** (28): the file is packed bytes (variable-length integers, floats only where a
  number isn't whole) gzipped with `CompressionStream`; frames are kept 10 a second for bodies
  within 80 m and 2 a second farther off, unless something about them changes (dying, a gun
  switch), and filled in between when read; the log points at the player's own commands on the
  tape rather than repeating them. The same 42 s run is 23.6 kB against chunk 17's 61.8 kB (38%),
  game log included, and a 5-minute run 144 kB against 381 kB (38%).
- **A replay lasts only until the next run** (17). Watch replay and Save replay act on the last
  run; nothing is kept in the browser, so an unsaved replay is gone once you play again or leave.
  **Resolved** (28): the last 5 runs are kept in IndexedDB (`replaystore.ts`) as their files, on
  the results or on leaving them. **Replays** on the menu lists them (how it went, island,
  conditions, length, when) to watch or save as a file, and opens a file too. Where storage is
  blocked nothing is kept, and the list says so only by being empty.
- **Opening a replay of another island reloads the page** (17). The file is handed over through
  the tab's session storage and opened paused, since sound needs a click first. If it doesn't fit
  there (a few MB), you're told to open that island and then the replay. Its conditions replace
  the ones chosen on the menu.
  **Resolved** (28): the island is opened in place (`openIsland`): the old one is taken out of
  the scene and freed, and the new one built in the same scene, with the bodies, sound, hint
  props and HUDs pointed at it and the address rewritten. **New island** does the same. It's only
  done from the menu; a link's challenge is dropped on leaving its island.
- **The free camera flies through everything** (17). It stays above the ground and near the
  island, but walls, rocks and trees don't stop it.
  **Resolved** (28): it moves in steps of at most 0.2 m, each pushed back out of any collider it
  overlaps (a 0.3 m ball, as ragdoll joints are), so walls, door leaves, rocks and trunks stop it.
  Checked once by a script flying it at 10 m/s into a wall for 2 s in headless Chromium (it
  stopped short of the wall); the browser tests don't fly it.
- **The free camera's own shots came from the camera** (17). The player's rounds were drawn
  as if from the first-person gun, so from the free camera the tracers and muzzle light started
  at the camera, and the shot sounded as the viewer's own.
  **Resolved** (after 29): with the free camera, the player's shots start at their body's muzzle
  (or 0.7 m ahead of the eye if the body isn't drawn near there), flash on the body and sound
  from where they were fired. Not checked by hand in the browser.
- **The kill feed says "You" for the replay's player** (17), even when a friend watches it, since
  it's shown as the player saw it. Feed rows fade by real time, not replay time.
  **Resolved** (28): each browser has a random id, saved in the replays played in it; a replay
  from another browser says the player's name where "You" was. Feed rows and hit numbers age on
  the replay's time: held while paused, faster at 2× and 4×.
- **Sounds in replays aren't rebuilt when seeking** (17), and the player's own footsteps only
  play through their eyes. At 4× everything plays four times as often.
  **Resolved in part** (26): a jump cuts off everything playing, then, once the replay plays and
  the ear is at the new moment, the shots, blasts, breaking cover and doors of the 3 s before it
  play on from where they'd be: a far shot still on its way arrives, a blast's rumble picks up
  part way. At 2× and 4×, sound arrives that much sooner, and footsteps, doors and far shots play
  one time in two or four (chosen at random, so two viewings differ). The player's own shots and
  reloads from their inputs aren't rebuilt, own footsteps still only play through their eyes, and
  pausing doesn't pause sounds already playing.
  **Resolved** (28) for the feed and hit numbers: after a jump the events of the last 6.4 s are
  shown again as they stood, each row and number aged by how long before it happened. Tracers and
  debris already flying still stay.
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
  **Resolved** (29): an operator bot's kind is told once it's dead or has killed you. The kill
  event names the victim's kind (a small tag in the feed row), its bag carries it (the tag reads
  "rat · $1,200"), and the run's end and the death cam name the killer's: the banner, the death
  notice and the results say "Killed by Viper, a hunter", with a line on what hunters do. The
  run log's cause of death names the kind too ("hunter, Assault rifle").
- **Bots know more than they should** (18). They know what every bag within 50 m holds without
  seeing it, and a bot joining a fight goes for exactly where the shots came from, not a guess.
  Everyone is spotted faster and heard farther while carrying the bounty, whether or not the bot
  was told about it.
  **Resolved** (27): a bot learns what a bag holds only on seeing it, within 40 m, in its view and
  not hidden by walls, bushes or grass (as a player reads the tag), and remembers it. Gunfire
  heard for joining a fight is placed up to 12% of its distance off, so a fight 200 m away is
  guessed up to 24 m off in each direction; the bot stops short of the guess and watches. The
  bounty's advantages (spotted sooner, heard farther, fought from farther) go only to operator
  bots told who carries it, when it changes hands or is called; guards are never told.
- **Bag values show through bushes and grass** (18): the tags only check that walls and terrain
  don't hide the bag, up to 40 m.
  **Resolved** (27): a tag shows only when the bag's top (0.3 m up) is in sight and not hidden by
  bushes or grass, the same test bots use (`bagShows`). Before, the check went to where the tag
  floats, 0.8 m up, so a bag behind a low wall showed its value too.
- **Replays gained the bounty without a new file version** (18). It's an optional part of the file,
  so older replays still play, with no bounty and no bag values.
  **Resolved** (28): version 3 files always carry it.
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
- **Pointer lock is never granted in the test browsers** (19), so every test plays with the
  "Click anywhere to resume" card up, and the lock itself and resuming stay untested. Nothing in
  the tests moves or shoots with the mouse and keys; runs are ended with the dev shortcut.
  **Corrected** (20): that was wrong for Chromium and Firefox, which grant the lock on a test's
  real click (Play); only WebKit refuses it. A key pressed by a test doesn't free the lock, so
  Esc can't be tested; freeing it from script and clicking the card resumes (tested).
- **A replay test failed in WebKit in full runs** (20): after scrubbing to the start, the
  replay's time had moved on. The test's run is only a few seconds long, and with four workers
  busy the replay could reach its end before the test pressed Space to pause it, which starts
  an ended replay again instead. **Resolved** (20): the test pauses only if it's still playing,
  and waits for the paused state.

### Playtest and tuning
- **Wider drop-in spacing may fall back to anywhere** (12). Insertion points now keep 130 m from
  outposts and 100 m from other operators. When 60 random tries find nothing, the operator drops
  in at any land point, possibly next to an outpost. How often that happens wasn't measured.
  **Resolved** (29): measured by the playtest (`dropIns` in `server/population.ts`): 2–3% of
  drop-ins in a full game of 8 operators, so it was left as it is.
- **The run log panel has no automated tests** (12). The records, summary and storage are tested;
  the F4 panel was only checked by typecheck. Resolved: the F4 panel (and the F3 net panel with
  its fake-lag sliders) were removed.
- **A guard could respawn on top of the player** (30). Found in a replay the developer sent
  (chunk 17's format, from Sep 25, which the game no longer opens; read as JSON): they shot the
  Pinecrest sentry from 116 m, looted, climbed its watchtower for the intel 60 s later, and the
  sentry came back at its post 2 m away and killed them in 0.3 s. Guards came back after
  `GUARD_RESPAWN` whoever stood there, and the intel always lies on a sentry's platform.
  **Resolved** (30): a dead guard now waits while a living operator (person or bot) is within
  50 m of its post (`RESPAWN_CLEAR`) or can see it from within 150 m (`RESPAWN_SIGHT`), and
  looks again every 3 s. A unit test stands someone on a tower. An operator bot camping near an
  outpost holds its guards off too; in the bot playtest nothing changed beyond the noise.
