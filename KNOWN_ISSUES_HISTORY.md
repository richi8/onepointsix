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
  **Resolved** (2026-09-29): what was left is accepted: grass and bushes don't collide and bullets
  pass through them, and with no prone stance a crouched chest stays mostly above the grass.
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
  **Resolved** (32): bodies cast shadows as far as the coarse cascade reaches, 230 m, drawn off
  screen too when their shadow may fall in view (a sphere stretched away from the sun), and each
  shadow map culls them by a sphere round the body rather than drawing every one in every map.
  The island's map is drawn again when a door comes to rest, as it is after walls break (at most
  every 2 s). The patch now looks for a flag, the second and third lights being black (they give
  no light and only lend their maps), checked when the shader runs; any other scene with three
  shadow-casting directional lights is lit as three.js lights it, and a unit test pins the flag.
  Accepted as it is: the island's map doesn't sway with the crowns. It's read only past 230 m,
  where a crown's top swings about ±0.2 m, under half a texel (0.55 m) and about a pixel on
  screen, and following it would mean drawing the whole island's map every frame.
- **Bodies take shadows only near buildings** (23), within 1.5 m of one, as receiving them
  everywhere cost 1–3 ms a frame with 24 near bodies. Out in the open, a soldier in a tree's or a
  wall's shadow is lit as before.
  **Resolved** (32): bodies take shadows everywhere. With each soldier drawn in two calls instead
  of about 43, the benchmark's 24 bodies came out cheaper than before with it (below); switched
  off again, the frame was no faster, within the run-to-run noise.
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
  **Resolved** (33): the climb, the last of them, is keyed by hand (see "The climb is still a
  pose" below); a hop shorter than about 0.1 s still barely shows, as a jump clip needs longer.
- **The climb is still a pose** (21). The free set of Quaternius's animation library has no
  climbing clip, so a mantle holds the same leg pose, forward bend and hand on the ledge as in
  chunk 13.
  **Resolved** (33): keyed by hand, by how far up the ledge the body has risen. When a climb
  starts, the ledge's top is found ahead (the snapshots don't carry it) and the left hand takes hold
  of its edge, where it stays in the world while the body rises past it; the right knee comes up
  and the foot onto the top, the left foot pushes off below and follows once on top, and the body
  bends over the edge and straightens. Checked in the pose viewer against a ledge, and a
  screenshot test shows four moments of it.
- **The crouch-walk is a slow sneak played fast** (21). The library's clip moves at 0.57 m/s and
  crouched bodies move at up to 2.4 m/s, so its strides are lengthened up to 1.8× and it plays up to
  3× faster. At full crouch speed the legs may look hurried.
  **Resolved** (33): crouched, the crouch-walk now plays up to about 1 m/s (strides at most 1.3×
  the clip's, at most 2.4× its pace), and from 1 to 1.7 m/s it gives way to the run clip played low:
  the hips tip forward 0.45 rad and drop 0.28 m, moving back 0.22 m so the head stays over the feet
  and on its hitbox, and the legs bend to the run's feet. Far off, the legs are still reached for
  while it runs low, or the boots would hang below the ground.
- **Feet don't follow the ground** (21, from 9). A planted foot is held where it landed, but at
  the height the clip gives it above the body's own height. On a slope or a step the feet float
  or sink a little.
  **Resolved** (33): each foot is raised or lowered onto the ground under it (the world's height
  for a player there, so steps count), within 0.35 m, eased, and turned at the ankle to lie along
  the slope, up to 0.45 rad. A foot still out of the legs' reach brings the hips down to it, by at
  most 0.25 m, and one that can't be reached even so (as a climber's) is kept to the leg's length
  so the boot isn't stretched. A screenshot test stands three bodies on a slope.
- **Reactions don't depend on where the round came from** (21). A hit doubles the body up or snaps
  the head back, the same from any side. Every gun uses the same shooting clip, only kicking
  harder for the pistol and bolt-action.
  **Resolved** (33): the hit knows where the round came from (hits are only told to whoever
  fired, so from the camera). The chest, or the head, is knocked the way the round went: bent
  back from in front, forward from behind, rolled to a side; the body turns about the side
  struck; a round in the legs drops the hips so the knees buckle. The model's own flinch plays
  under it, weaker. Each gun kicks its own way: the rifle a short shove at the shoulder, the
  pistol little in the body (its kick is in the arms), the bolt-action a heavy one that turns the
  right shoulder back; the pistol's slide jumps back with each shot. The library's pistol shooting
  clip wasn't moved onto the soldier: that means fetching the assets again.
- **Only the hands reload** (21). Each gun is one mesh, so the bolt handle, slide and magazine
  don't move with the hands; a fresh magazine is a box in the hand and the old one never drops.
  The bolt-action always thumbs in three rounds, however many it needs. The points on the guns
  were marked by eye on side views, not snapped to the geometry.
  **Resolved** (33): each gun is split where it loads (guns.ts): the connected pieces inside a box
  make its magazine (the rifle's and the pistol's base plate, given a body hidden in the grip) and
  its slide or bolt handle. Normally the gun is still drawn whole, in one call; while a part moves
  it's drawn as its frame and the parts, two calls more. The rifle's left hand strips the
  magazine and lets it fall, then seats a full one; the pistol's drops free, a fresh one goes up
  the grip, and the slide is racked; the bolt-action's handle turns up and draws back with the
  right hand on it. Dropped magazines fall and tumble as three balls (as a dropped gun does) and
  lie for 90 s. The bolt-action thumbs in the rounds the reload loads, from the snapshot for
  others. The points on the guns are snapped onto the geometry near their marks: the muzzle to the
  middle of the barrel's end, the grip to the middle of the grip, the support to the fore-end's
  underside, the magazine to the middle of its base and the bolt to its handle's end or the
  slide's back. A dev page (`dev/guns.html`) shows the pieces and the parts moved.
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
  **Resolved** (33): both halves of each arm are lengthened alike (about 1.5×), so the elbow is
  where a real one would be, and the skin moves by how far along its bone it sits, so the sleeve
  lengthens down to the glove rather than the bare wrist stretching.
- **Building ceilings show shadow acne** (19): the indoor screenshots show streaks across the
  underside of the roof, dark by day and orange at dusk. Seen only now that a test looks inside.
  Still there (23): the streaks look like the corrugated metal texture's ridges seen from below,
  catching the sky's reflection, rather than shadow acne; with the light volume they're dimmer
  but still bright against a dark room.
  **Resolved** (35): it was the texture. A roof's corrugated metal is now only on its top and
  sides; faces looking down draw the concrete layer, a plain ceiling (a roof's instances carry
  their layer as -1 - it, which the props' shader reads). The upstairs screenshot, which showed
  the stripes plainest, now shows a plain ceiling.
- **Bots never go upstairs** (23). The nav grid is one layer over the ground, so a two-storey
  building's upper floor and stairs don't exist for bots: they path about the ground floor under
  it and never climb to the lookout, and a player up there is only shot at through the windows.
  Loot crates are kept on the ground floor for that reason.
  **Resolved** (35): the nav grid has floors. Boxes the world marks as walkable (a two-storey
  building's stairs and upper floor, a watchtower's platform and stairs) give the cells under
  them up to three more nodes, each at a spot in the cell where a body settles at that floor's
  height and fits. Whether a body gets from a node to one next door, or to another in its own
  cell (stairs put two steps in one cell), is found once by walking the line between them as the
  game would (meeting what's ahead before the feet rise, never dropping more than 1.2 m, never
  along an edge with a drop of more than a step to either side), and remembered per tile until
  something near breaks. Paths are searched from the bot's height to the goal's: a height counts
  as the floor it's at most 0.6 m above or 2.5 m below, so a shot heard from someone's eye
  upstairs is looked into upstairs. A waypoint on a floor or a step counts as reached only at its
  height. The stairs are 1.5 m wide now, from 1.2, for a path beside the upper floor's edge. One
  of a two-storey building's two crates is upstairs. Tested by paths walked by the game's own
  movement, up to the crate upstairs and back out on every seed with a two-storey building, and
  up every outpost's watchtower on five seeds; and by a guard going upstairs to look into a shot
  heard there.
- **Some of the new buildings can't break** (23): a two-storey building's upper floor, stairs and
  ground-floor corner posts, and a hut's concrete floor. The upper storey's walls stand on the
  walls below and fall once everything under them has gone, but its floor stays hanging on the
  posts.
  **Resolved** (35): every part of a building is a panel: the posts, the stairs and tables
  (timber, 200), and the floors (a concrete slab, 1,500, two grenades on it). A two-storey
  building's upper floor rests on its four ground-floor posts and comes down with the last of
  them; everything upstairs, the crate and the roof included, stands on it and comes down with
  it. So four posts bring the upper storey down whole, leaving the ground floor. Tested by a unit
  test and looked at in a screenshot of a building before and after.
- **Bots only ever open doors** (23), and only by walking into them; they never shut one or use
  a door to block a chase, so an island's doors end up open as bots pass through. A door that
  someone is standing in the way of just doesn't move, with nothing said to the player.
  **Resolved** (35): once through a doorway and clear of its leaves' sweep, a bot may shut the
  door behind it, unless a friend is within 5 m of it: a guard six times in ten, an operator a
  third of the time, going about its routine or looking into something; always when getting away
  from someone seen in the last 6 s within 30 m of the doorway on the side it came from. Someone
  who tries a door that would sweep through someone standing in its way is told so ("Someone is in
  the way of the door."), and their own screen swings it back. A 20-minute bot playtest on six
  islands shut 264 doors by day and 718 at night in rain; only one was slammed on someone chasing.
- **Doors swing only on screen** (23). The leaf's collider jumps between shut and open at once;
  its picture swings over 0.35 s. Pressing F waits for the server, so a door opens a round trip
  after the press.
  **Resolved** (35): a leaf's swing is the world's, stepped by the server each tick and by the
  client each frame, and its collider swings with it: at a slant, it's collided with, shot and
  seen through as a thin box turned about its hinge. Pressing F on a door swings it on your own
  screen at once, when F means the door (no crate, bag, intel or pickup in reach, as the server
  decides) and nobody you can see stands in its way; the server's word confirms it, a "stuck"
  answer or no answer within 1.5 s swings it back. A browser test with 400 ms of lag each way
  sees the door swinging at once, and fails without the prediction.

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
- **Nobody has listened to the new sound** (14). This machine has no way to hear it. The
  recordings were chosen by title, description, rating and waveform, the cuts were placed from
  loudness envelopes, and the levels were set by rendering each sound offline in headless Chrome
  and measuring its peak and RMS. Mix, reverb amount and ambience levels need a listening pass.
  **Resolved** (30): the user has listened to it in play and it's fine.
- **The loading screen waits for most of the sound** (20). The early bank is 150 of the 160
  seconds, because the ambience beds are long: 700 kB of the 4.3 MB the loading screen waits
  for. Loading locally took no longer (1.22 s against 1.26 s), but on a slow connection it adds
  to the wait. Moving the ambience to the late bank would halve it, at the cost of the ambience
  fading in a moment after Play.
  **Resolved** (37): the ambience beds are a bank of their own (`sounds-ambience.ogg`, 589 kB),
  loaded behind the menu right after the early one and before the rest; they fade in once
  they're in. The early bank is down from 728 kB to 143 kB (29 s of sound), and the loading
  screen waits for 3.97 MB, down from 4.55 MB.

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
  **Resolved** (30): the messages in chunk 20 cover it, and resuming works in play.

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
- **The single-file build is checked by hand only** (single file). `npm run build:single` makes
  `dist-single/onepointsix.html`, the whole game in one 8.3 MB page that plays when opened from
  disk: one inline script, workers and `public/` packed in base64 and served to `fetch()` and
  `new Worker` by a small shim in the page. It was checked by opening it from `file://` in headless
  Chromium, Firefox and WebKit (loaded, textured, a run started). No Playwright test covers it,
  since the suite runs on the dev server. The shim covers only `fetch()` and `Worker`, so a new
  loader that uses `XMLHttpRequest`, an `<img src>` or a module worker with imports would break it.
  **Resolved** (31): `e2e/single.e2e.ts` builds it into a folder of its own (under a second),
  opens it from `file://`, waits for the menu, starts a run and fails on any page error, console
  error, texture failure or request to the disk besides the page itself, so a loader the shim
  doesn't cover should fail it (not tried by breaking the shim). The page is 5.9 MB since the AAC
  copies were dropped.

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

- **Flashlights cast no shadows** (16), so a beam lights the far side of a wall and the room
  behind it. Shadows would need a shadow map per light, drawn every frame.
  **Resolved in part** (25): your own light casts shadows from a 1024 px map, drawn only while
  it's on. Others' lights still don't (see below).
  **Resolved** (36): others' flashlights and the outpost lamps cast shadows too, from one atlas of
  six 512 px tiles drawn in three.js's own shadow pass, so crowns sway and leaf cards cut out in
  them; the nearest six lights that cast shadows get a tile each frame (see Known Issues for the
  budget).
- **Only the two nearest other flashlights light the world** (16). Farther ones show only a faint
  beam and a glare when pointed your way. Three spotlights (yours and two others) are always in the
  scene at dusk and night so switching one on never recompiles a material.
  **Resolved in part** (25): the four nearest now do. With 24 soldiers close up, all lit, in rain
  at night, the benchmark frame costs about 0.5 ms more than the same crowd by day (M3 Pro, a
  noisy run: both about 14 ms with the machine loaded). Past four, still beams and glares only.
  **Resolved** (36): others' flashlights and the lamps light the world through a patch to
  three.js's lighting chunk, from a list of up to 16 lights in uniforms every lit material shares,
  so none of them costs a texture unit or a recompile. The six nearest are lit fully, the rest
  with their diffuse light only. Every lit flashlight within its reach of the fog lights the
  world, not only the nearest four.
- **Others' flashlights cast no shadows** (25), nor light the rain: only your own beam makes
  drops glint and throws shadows.
  **Resolved** (36): they cast shadows (see above), and the beams of the three lit flashlights
  nearest the camera make the drops glint, as yours does.
- **Only terrain, props and rocks get wet** (25). Trees, grass, bushes, bodies and debris look as
  they do dry. Puddles are painted by noise on near-flat ground, not where water would gather,
  and don't ripple. The roof map reaches 32 m round the camera; beyond it everything is wet, so
  a far building's floor seen through a door would be too.
  **Resolved** (36): trees (in full and as impostors), grass, bushes, pebbles, bodies, their guns,
  bags and debris darken and turn a little glossy in rain, by a patch that works out each pixel's
  place from the view. Puddles gather where the island's map says water would: hollows lower than
  the ground 6 m round them and flat enough to hold water, and level ground such as an outpost's
  yard a little everywhere, the noise only raggeding their edges; they ripple with rings from
  drops. Past the sharp roof map, a map of the island's roofs in 2 m cells keeps far floors dry.
- **Lamplight for bots is a disc** (lamps): anyone within 9 m of the spot a standing lamp points
  at, below it and in its line of sight, is seen from as far as by day (as in a bot's own beam).
  Crouching helps only as much as by day. Operator bots don't avoid lamplight, and nobody shoots
  lamps out on purpose; only the player's and stray rounds or blasts do. A shot lamp comes back with the
  other broken panels. Checked by unit tests and screenshots only; nobody has played it.
  **Resolved** (36): bots see by the lamp's cone as it's drawn (the same strength, reach, fall-off,
  angle and lean, in `LAMP_LIGHT`): lit enough to be seen as by day about 9 m out in front of a
  lamp and 3–4 m to either side, nothing behind it, and not behind a wall or anything else between
  the lamp and them. After dark, operator bots going about their run find paths that keep out of
  lamplight where there's a way round (lit ground costs five times as much), and one about to
  search a crate or wait in a spot a lamp lights shoots the lamp out first, if it can see it within
  35 m and has seen nobody for 10 s. Unit tests cover the cone, walls, the paths and a bot's shot
  meeting the lamp. See Known Issues for what's left.

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
- **Gun fitting uses hand-measured fractions** (9) in `src/client/guns.ts`, so a new model needs
  measuring again.
  **Resolved** (21): the hands go to points marked on each gun model (Grip, Support, Muzzle, Sight, Magazine, Bolt; see `src/client/guns.ts`).
- **Soldiers are expensive to draw** (19). In the benchmark, 24 soldiers 4 to 25 m off take a
  Chromium frame from 3.1 to 10.6 ms (Firefox 7 to 16, WebKit 4 to 11). Posing them is only 2.4 ms
  of it: the rest is drawing, about 43 draw calls each with their shadows (1,113 against 86) and
  1.1 million triangles against 0.42 million. Worth merging a soldier's meshes in chunk 21.
  **Resolved** (32): each soldier is drawn in two calls a pass. Its four meshes (nine parts) and
  its kit (pack, bedroll, helmet band, radio and mast) are merged once per look (operator, guard,
  commander) into one skinned mesh; each part keeps its colour, roughness and metalness in its
  vertices, read by a patched material. The gun is merged with its flashlight's body and, as a
  second look, its suppressor. Only the lens (while lit), the muzzle flash, a grenade or magazine
  in hand add a call. In the benchmark, in one session on an M3 Pro, the 24-body frame went from
  14.4–14.9 ms to 10.8–11.2 ms and from 1,151 draw calls to 245, now with bodies taking shadows
  everywhere; the same bodies 100–400 m off from 12.9 to 10.1 ms (461 calls to 163), now casting
  shadows out to 230 m. The triangles are the same (1.19 million).

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
- **Nobody else has played it yet** (12). The chunk's goal, several full runs by other people with
  the average run between 3 and 10 minutes, still waits on real playtesters. Everything tuned so
  far comes from bots.
  **Resolved** (30): other people have played it and sent run logs.
- **The run log stays in one browser** (12). There's no backend, and since the F4 panel was
  removed there's no way in the game to see or copy it; it's only in localStorage (`runlog`). It
  keeps the last 200 runs.
  **Resolved in part** (29): Stats on the menu sums the log up (runs, how they ended, length,
  score, contracts, causes of death, extraction points, the latest 10) and exports it as
  `onepointsix-runs-<date>.json` (format `onepointsix-runs`, version 1, with the build), for
  playtesters to send. It still stays in one browser, and nothing reads the files back yet: they
  have to be summed by hand or with a script.
  **Moved to Future** (30): not an issue for the local build; with multiplayer every run can send its stats to the server.
- **The stats export hasn't had a real file sent yet** (29). Its format may need more (the
  browser, the screen, the frame rate) once chunk 30's playtesters use it; there's no way to
  clear the log from the page either.
  **Resolved in part** (30): the developer sent the first file (84 runs, see "Guards were too
  deadly for a person"). Every run now records the damage taken from guards and from other
  operators, and a death at someone else's hands how far off the killer was and how many guards
  and operators had hit them in the last 5 s (`SHOOTERS_WINDOW`); the export is version 2, and the
  playtest's summary prints the killer's median distance and the guard counts. Practice runs
  aren't marked (the user decided against it), and the browser, screen and frame rate still
  aren't recorded. Nothing reads the files back yet.
  **Resolved** (30): real files have been sent (the developer's and a second tester's).
- **Nobody did contracts** (30). In the first human run log 1 of 168 contracts offered was done:
  they're risky (in and around the outposts) and paid 1,200–2,500, less than a crate or two.
  **Changed** (30): rewards are 5× as much (intel 7,500, cache 6,000, commander 12,500). Not yet
  played with; bots still get no contracts.
  **Resolved** (30): contracts pay 5× as much; the user considers it done.

## Dropped

Open issues taken off the plan on 2026-09-28 as not worth pursuing: records of what was measured
rather than problems, things accepted or decided, nitpicks nobody would notice in play, and
duplicates. Those that only matter to a multiplayer server are marked **Moved to Future**.

### Look and animation
- **Distant bodies animate at 12 Hz and skip hand IK** (9), beyond 90 m. It's cheaper, but
  scoped players may notice the stutter.
  **Resolved in part** (21): they animate at 20 Hz, each on its own turn rather than all in the
  same frame, which cost 3 ms every few frames for 24 bodies. The benchmark's new far case poses
  24 bodies 100–400 m off in 0.7 ms a frame (median). They still skip hand and leg IK.
  **Dropped** (2026-09-28): 20 Hz is enough; the missing IK beyond 90 m can't be seen.
- **Retargeted legs rely on the leg IK** (21). The library's legs are shorter for their hips than
  the soldier's, so its shins, turned the same way, leave the ankle about 10 cm from where the feet
  are placed. Within 90 m the legs reach the feet every frame. Beyond 90 m there's no leg IK, so a
  crouching or landing body's shins and feet don't quite meet.
  **Dropped** (2026-09-28): only beyond 90 m, where it can't be seen.
- **The head leaves its hitbox for a moment on landing** (21). Moving the body up or down to
  put the head at eye height is eased and limited to 30 cm, so the landing's deep dip shows.
  Deep in a crouch the upper body leans back a little to bring the head over the feet.
  **Dropped** (2026-09-28): a brief dip of a few centimetres, not worth the work.
- **The soldier download grew by 78 kB** (21), 33 kB gzipped, to 599 kB: the new clips' keys
  aren't compressed (meshopt only quantizes the meshes), though they're sampled at 20 per second
  and resampling drops the keys a straight line would give.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
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
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **Working the bolt fills a corner of the screen** (21). In first person the right hand comes
  back to the bolt near the eye, and the forearm covers the bottom right while it does.
  **Dropped** (2026-09-28): a real bolt-action does the same.
- **Glass is simple** (23): a flat, faintly tinted pane with no reflection or dirt, the same whether
  looked at or through. Bots see through it exactly as through air, grenades bounce off it rather
  than breaking it (the blast does), and it shatters into the same flying chunks as a wall, in a
  pale colour.
  **Dropped** (2026-09-28): good enough for panes that break at a touch.
- **Fewer huts than planned** (23): nine were planned, but most islands have room for two to six
  on ground flat enough (0.4 m of fall under the whole hut and a metre round it).
  **Dropped** (2026-09-28): islands without room for more are fine as they are.
- **Impostors are baked from the side** (24): the eight pictures are taken level with the tree,
  so from high up (the menu, a hilltop) an impostor still shows its side, and it's lit as that
  side, not as the crown seen from above. The branch cards are baked with their normals pointing
  out of the crown on both faces, where the full tree flips them toward the camera, so up close
  an impostor is a little smoother and brighter than the tree it replaces. The dither is fixed
  to the screen, so a tree mid-fade may look grainy in motion; nobody has watched it move.
  **Dropped** (2026-09-28): only noticeable from high up, and the far trees look right in play.
- **The waves near the camera changed** (24): with the new swell the sea rises and falls up to
  0.3 m instead of 0.21 m, and the shortest wave (3.7 m) now shows only in the lighting, not the
  surface, where it aliased at the grid's 2 m spacing. `waveHeight`, which decides when the camera
  is under water, still adds every wave in full, so near the surface it can be a few centimetres
  off what's drawn.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.

### Sound
- **The recordings are Freesound's previews** (14), 128 kbps MP3, not the original files, which
  need a Freesound account or API key to download. They're re-encoded once more to 64 kbps AAC.
  Since chunk 20 that's Opus at 40 kbps (AAC where Opus won't decode), still unheard.
  **Dropped** (2026-09-28): the original files were decided against (see Decisions).
- **The AAC fallback is ffmpeg's own encoder** (20), not Apple's: 1.43 MB for the two banks
  against the old file's 1.30 MB at the same 64 kbps, and likely a little worse. It's only for
  browsers that can't decode Opus. Playwright's WebKit decodes Ogg Opus, so the fallback was
  tested by blocking the Opus files; which real Safari versions need it wasn't checked.
  **Dropped** (2026-09-28): only for browsers without Opus; not worth an Apple encoder.
- **The sounds are decoded at 48 kHz before audio is unlocked** (20), in an
  OfflineAudioContext, so a device running at 44.1 kHz resamples them as they play.
  **Dropped** (2026-09-28): resampling while playing costs nothing noticeable.
- **The new recordings are unheard** (26), like the rest: picked by title, description and
  loudness envelope. They added 42 kB to the Opus banks (early 700 to 728 kB, late 84 to 99 kB)
  and 96 kB to the AAC ones.
  **Dropped** (2026-09-28): the same as "Nobody has listened to the new sound".
- **The battle bed places far fights only roughly** (26): by the nearest of 8 compass points,
  all through the same filter, and with no difference between a fight 160 m and 400 m off beyond
  its level and dullness.
  **Dropped** (2026-09-28): far fights are a background bed; rough is enough.
- **Under water is only muffled** (24): everything heard goes through one low-pass filter (450 Hz)
  and drops to 60% while the camera is under the surface. There's no underwater ambience, and
  nothing was listened to: the cut-off was picked, not tuned by ear.
  **Dropped** (2026-09-28): being under water is rare and brief.

### Performance and loading
- **The total JavaScript loaded at start barely changed** (11): about 740 kB minified (200 kB
  gzipped), now in four chunks that load in parallel. Splitting keeps three.js cached across
  game updates, but it doesn't shrink the download.
  **Resolved in part** (20): measured on the production build, the JavaScript and wasm fetched
  before the menu shows fell from 1,550 kB to 1,227 kB (544 kB to 396 kB gzipped), almost all of
  it the smaller transcoder. The JavaScript alone barely moved (1,023 kB to 1,015 kB): the entry
  chunk is 197 kB instead of 212 kB, but the ground cover and impostors, split off, still load
  while the loading screen is up. Only the death cam and replay viewer wait until after it.
  **Dropped** (2026-09-28): measured and cut in chunk 20; the load target itself stays open.
- **The game's entry chunk grew to 141 kB** (13), from 120 kB, with the body posing and the
  first-person arms. The soldier model grew by 4.5 kB for the death clip.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **The entry chunk grew again, to 172 kB** (15), with the terrain tiles, water, ground cover,
  impostors and cascades. It all ships in the entry chunk rather than loading lazily.
  **Resolved in part** (20): it had reached 212 kB by chunk 19. The ground cover (9 kB), the
  impostors (3 kB) and the death cam with the replay viewer (6 kB) are chunks of their own now,
  and the entry is 197 kB. The terrain, water and cascades stay in it.
  **Dropped** (2026-09-28): split as far as is useful in chunk 20.
- **The lazy chunks mostly still load at start** (20). The ground cover and impostors are
  wanted as soon as the island shows, so they load alongside the assets while the loading screen
  is up; splitting them off shrinks the entry chunk but not the start. Only the death cam and
  replay viewer (6 kB) wait, until the menu is up. If one fails to load, a replay or death cam
  says so (or goes straight to the results) and can be tried again.
  **Dropped** (2026-09-28): they're needed as soon as the island shows.
- **The committed transcoder is a binary** (20), built with Emscripten 4.0.10 in Docker. When
  three.js updates KTX2Loader, its calls must still match the wrapper of Basis 1.50; only the
  browser test that loads the textures would notice. A phone GPU with PVRTC but not ETC (old
  iPhones) now gets plain RGBA, four times the memory; the game is desktop only.
  **Dropped** (2026-09-28): accepted; the texture browser test catches a mismatch.
- **The fade-in stands the view still** (20). While the textures go on and their shaders
  compile, the picture of the last flat-coloured frame covers a game that keeps going, so a
  player moving then sees a still frame for that long (a few hundred milliseconds here).
  **Dropped** (2026-09-28): a few hundred milliseconds once, at the start.
- **Chunk 24's cost** (24): the machine was noisy during this chunk: chunk 23's own code measured
  a Chromium empty frame of 5.6 to 8.8 ms in the same session, against its kept 3.1. Run side
  by side, this chunk's empty frame came out 1 to 2 ms slower (7.1 to 10.2 ms), most of it the
  reflection pass, a second drawing of the island at a ninth of the pixels with about 30 draw
  calls; the browser tests' report gave 6.8 ms empty and 11.7 ms with 24 bodies (Firefox 8 and
  16, WebKit 5 and 12), under the 16.7 ms budget. The full trees dissolve between 110 and 140 m
  because a first try at 150 to 180 m drew full trees in twice the tiles, in the main pass, both
  moving cascades and the reflection (137 draw calls against 87); now it's 89, the two more being
  the sea's new ring. Triangles rose from 428k to 499k, mostly that ring, drawn twice (its two
  sides). The kept baseline wasn't replaced.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **Chunk 23's cost** (23): with the light volume in the shader of every lit surface, the
  browser tests' benchmark came out as before in all three engines once materials looked only at
  the four nearest buildings (Chromium 3.3–3.7 ms empty, 10.9–11.4 ms with 24 bodies; the kept
  baseline is 3.1 and 10.6). Looking at all sixteen cost 2.6 ms in Chromium's empty frame, and
  bodies taking shadows everywhere cost 1–3 ms. Chromium's empty frame also comes out at 7–8 ms
  about one run in three, with this chunk's code and with chunk 22's alike, so that's the machine.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **Sight through grass costs about twice as much** (27): about 10 µs a sight line in one part of
  the island, against 4.5 µs before, as each tuft near the low stretches of the line is checked.
  Grass cells are kept for sight up to 3,000 (under a third of the island) and then all let go at
  once, to be scattered again as needed. The frame benchmark showed no change beyond its noise.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix; no frame cost showed.
- **Pebbles are tied to the grass** (27). They carry on from the grass's random numbers, so the
  client runs the generator through the grass's draws for each cell to leave them where they were.
  A change to how grass is scattered moves the pebbles too.
  **Dropped** (2026-09-28): a note on the code, not a problem.

### Sharing and leaderboards
- **Scores in links can be faked** (10). With no backend, a link's `by` and `score` are plain
  query parameters, so anyone can edit them. They're a friendly challenge, not a record.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Leaderboards only hold your own runs, in one browser** (10). They're lost when site data is
  cleared, and they don't follow you to another device.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Online and Offline play the same until there is a multiplayer server** (modes change). Both
  run in the local Worker, so nobody can join an Online game yet. The only difference today is
  that Offline never takes a second human.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Names aren't filtered** (10). Locally only you and the bots see yours, but multiplayer will
  need filtering and length checks on the server.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **"New island" only picks seeds up to 999,999** (10), to keep the numbers short. Typed
  `?world=` values still reach every seed.
  **Dropped** (2026-09-28): accepted (Phase 3).
- **Share links from the single file point at the player's own disk** (single file). The link is
  built from the page's address, a `file://` path that nobody else can open.
  **Dropped** (2026-09-28): expected of a page opened from disk.
- **The single file keeps its data with every other page opened from disk** (single file).
  Browsers key a `file://` page's storage loosely (Chrome shares one store across all of them), so
  the leaderboard, stats and replays sit alongside other local pages' data, and moving or renaming
  the file may lose them. Not checked per browser.
  **Dropped** (2026-09-28): expected of a page opened from disk.
- **The single file starts slower and holds both sound formats** (single file). It parses 8.3 MB
  of HTML before the loading bar moves, which isn't counted by the bar (the scripts are left out of
  its sizes), and it carries the Ogg and the M4A sounds though a browser plays only one.
  **Dropped** (2026-09-28): accepted for the single file.

### Day, night and weather
- **Fog is plain distance fog** (16), the same everywhere, with no banks drifting or thicker
  patches in hollows.
  **Resolved in part** (25): three.js's fog chunks are replaced by a version adding low mist that
  thins with height above the sea and stands deeper in noise-shaped banks, with no uniforms of its
  own (its amount follows the fog's reach). The banks stand still: drifting would need a time
  uniform in every fogged material. "Hollows" means low ground, not ground lower than its
  surroundings.
  **Dropped** (2026-09-28): the still banks are enough.
- **Conditions aren't checked by the server** (16) beyond parsing the link. Every combination is a
  separate game in the directory, so in multiplayer nine conditions per island would split the
  players unless the server picks them.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Night scores beat day scores** (16). Night crates hold an extra item and more valuables,
  and the leaderboards are shared across conditions, so the best scores on a board will tend to
  be night runs.
  **Resolved in part** (25): each score on the board now shows the conditions it was set in
  (kept with new scores; older ones show none), and sharing your best sends it in its conditions.
  The boards stay shared, with no night adjustment, as decided.
  **Dropped** (2026-09-28): conditions are shown by each score, and no night adjustment was decided (see Decisions).
- **The sounds grew to 1.3 MB** (16) with the rain and cricket loops, still downloaded behind the
  menu (see Sound).
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **Splashes are placed on the CPU** (25), 3,000 a second within 22 m, each a ground-height query.
  Cheap on an M3 Pro; not measured on slower machines.
  **Dropped** (2026-09-28): cheap; the mid-range laptop pass would show it if not.
- **Lightning is client-side and random** (25): each viewer sees their own strikes, replays don't
  keep them, and bots ignore flashes and thunder.
  **Dropped** (2026-09-28): cosmetic; nothing depends on it.
- **The thunder** (25) is one recording (a 9 s cut) played slower and duller for far strikes. It
  added 37 kB to the late Opus bank and 73 kB to the AAC one.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **The mist is only in the picture** (25): bots' sight in fog is still the one flat multiple, so
  low ground hides you from the player's eye more than from a bot's.
  **Dropped** (2026-09-28): a small difference between what the eye and a bot see.
- **Beam spotting** (25) uses the holder's aim, while the drawn beam follows the gun, which dips
  while sprinting or reloading; a bot may notice a patch the picture puts a little elsewhere.
  **Dropped** (2026-09-28): the difference is a small dip of the gun.
- **The replay test's floor was lowered** (lamps): with the poles in the world, the test run's
  player is shot 24 s in rather than lasting the 40 s, so fewer ticks are compared (16,905 rather
  than 38,467); the check now asks for 9,000.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.

### Death cam
- **Only the killer is replayed from inputs** (10). Everyone else is drawn from the snapshots the
  victim's client received, so they're a little behind, and bots out of sight may pop in.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Death cam clips are big** (10): about 6 s of commands and keyframes as plain JSON, some tens
  of kB per death. That's fine through the Worker, but multiplayer should pack it.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Every player's inputs are taped all the time** (10), including guards far from anyone, just
  in case they kill someone. It's cheap, but it isn't free.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.

### Replays
- **Look angles are rounded** (17). Commands carry yaw and pitch in whole 0.00001 rad steps, so
  the replay stores them as small whole numbers and still replays exactly. It's far below a
  pixel, but it is a change to what the server simulates. Since chunk 28 the tick a command was
  sampled at (for rewinding shots) is rounded to a thousandth of a tick as well, for the game log.
  **Dropped** (2026-09-28): accepted (Phase 3).
- **The server keeps a human's whole run** (17): every command and a key every 0.5 s, about
  36,000 commands for ten minutes. Fine locally; a multiplayer server should keep it packed.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Replays from before chunk 23 can't be watched** (23). The buildings changed, so the replay
  format's version went up to 2 and older files are refused as from another version. The door
  state in them is rebuilt like broken panels, from the doors open at the start and every door
  event since.
  **Dropped** (2026-09-28): expected: the replay format's version guards against it.
- **Replays from before chunk 28 can't be watched** (28). Version 3 files are packed bytes, not
  JSON; older ones are refused as from another version.
  **Dropped** (2026-09-28): expected: the replay format's version guards against it.
- **Running the game again takes a while for an old game** (28). The worker runs it from the
  game's start, about 0.3 ms a tick, so a run that began 10 minutes into a game is exact only
  after some 6 s; until then, and anywhere the check fails, the frames are shown. A game that ran
  more than 15 minutes (`RERUN_HISTORY`) before the run started sends no log at all, so its replay
  is frames only. Play again in the same game makes each later run's log longer.
  **Dropped** (2026-09-28): the frames fall back until it's ready.
- **The log carries every human's inputs** (28). Locally that's only you, but a multiplayer
  server would hand one player everyone's inputs from the game's start; it should run replays
  itself or send only what's needed.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Nothing after the run's end is logged** (28): the log goes with the tape at the end, so
  anything from the next 2.2 s of replay (a new run joined at once in the same game) makes the run
  again differ, and the replay finishes on frames. A dead player's look after the end isn't logged
  either; only their own body turns, and it's drawn from the tape.
  **Dropped** (2026-09-28): the replay finishes on frames, which is fine.
- **Engines were compared on one short run only** (28). A 6 s run saved in Chromium ran again
  exactly in Chromium, Firefox and WebKit, every tick checked. A long run with many shots and
  deaths might still come out differently where engines work out `Math.sin` and friends
  differently; the check would then fall back to the frames from that moment.
  **Dropped** (2026-09-28): any difference falls back to the frames.
- **The exact track is held in memory** (28): every tick of everyone as 32-bit floats, about 23 MB
  for a ten-minute run.
  **Dropped** (2026-09-28): 23 MB for ten minutes is fine.
- **Far bodies are coarser in the fallback** (28): kept 2 a second beyond 80 m and filled in
  between, so they glide where the game run again isn't in use.
  **Dropped** (2026-09-28): only in the fallback, and only beyond 80 m.
- **Replay files carry a browser id** (28): a random 16-digit hex id, the same for every replay
  from one browser, so replays can be told to come from one person, though not who.
  **Dropped** (2026-09-28): accepted: it names no one.
- **Replays are tied to the game's version** (17). A change to the simulation, the weapons or
  the island generator makes an older replay play back differently; the player would walk
  through a moved wall. A replay from another version only gets a warning, and versions are told
  apart by the date of the newest "What's new" entry, so two updates on one day look the same.
  The file format has its own version, and a replay in another format is refused.
  **Resolved in part** (28): the build is a hash of the simulation's code (`src/shared` and
  `src/server`, see `vite.config.ts`), so only a change there warns. The game run again stops at
  the first tick that differs from the file and falls back to the frames, so others are never
  drawn wrong; the player's own tape can still drift on another build.
  **Dropped** (2026-09-28): replays were removed (see Decisions in the plan).
- **Seeking starts the scene afresh** (17): the kill feed, hit numbers and the death notice are
  cleared, tracers and debris already flying stay, and the dead fall again from standing. What
  happened before the new moment isn't rebuilt, only the panels.
  **Resolved in part** (22): the dead no longer fall again. The kill events before the new moment
  are handed to the bodies, and a body first seen dead falls to rest at once, exactly where it
  fell in play. Bodies also move on the replay's time: faster at 2× and 4×, still while paused, and
  slowed round the kill in the death cam.
  **Dropped** (2026-09-28): replays were removed (see Decisions in the plan).
- **The live game goes on unseen behind a replay** (17). Watching your run from the results
  keeps the connection; live events are dropped but for keeping the books, and the panels are set
  back to how they stand now when the replay closes.
  **Resolved in part** (28): in Offline the local host holds the game still while you watch (a
  `pause` message the host handles, not the game, so it isn't logged). Online games go on, since
  other players could be in them.
  **Dropped** (2026-09-28): replays were removed (see Decisions in the plan).
- **Opening another island doesn't free everything** (28): the tree impostors' baked pictures and
  a few other GPU buffers stay until the page closes, so many switches in one session use more
  memory.
  **Dropped** (2026-09-28): replays were removed (see Decisions in the plan).

### Rivals
- **Operator bots get out less often** (18). In a 30-minute, 6-island bot playtest 13% of their
  runs extract, down from 20% before the personalities: rats 20%, looters 14%, campers 11%,
  hunters 7%. Hunters and campers stay on the island longer by design (up to 4 and 5 minutes into
  the run, or until below 60 health), and guards still do most of the killing. It was tuned from
  hunters at 0%: they now watch fights from 40 m off, 90 m if guards are in it, and 135 m from the
  middle of an outpost, and drop out of hunting when hurt.
  **Resolved in part** (29): operator bots now fight guards only within 40 m, or 60 m when shot
  at, and otherwise get away rather than trade shots with a sentry or patrol far off (guards had
  done two thirds of the killing, most of it at 50–100 m). One shot by a guard gives up the crates
  within 100 m of it; one below 60 health goes on to extract rather than to its next crate once a
  fight is over; one that doesn't raid leaves crates within 60 m of an outpost alone; one looking
  for a way out counts an extraction point within 150 m of an outpost as 150 m farther. Looting
  also stops with 150 s of the clock left, as hunting and camping did. The personalities' own
  numbers were left alone (shorter lingering for hunters and campers was tried and didn't help).
  Over 24 islands × 30 minutes by day, 16% of operator bot runs extract, from 14% just before
  (rats 25%, looters 18%, campers 10.5%, hunters 9.5%, from 23%, 14.5%, 10% and 7%); over 12
  islands at night in rain, 18% from 16%. Chunk 12's 19% wasn't reached: operators killing each
  other (about 105 an hour of game) didn't change, and guards still do three fifths of the
  killing. Between runs of 12 islands the rate moves by a point or two, so smaller changes were
  measured on seeds 1–12 and 13–24 both.
  **Dropped** (2026-09-28): covered by "Operator bots still die in most runs".
- **The kill feed was already there** (18). It came with the run loop; this chunk only marks the
  bounty being killed, and adds a row when someone takes the bounty.
  **Dropped** (2026-09-28): accepted (Phase 3).
- **Killing the bounty pays nothing extra** (18). The reward is their loot, left in their bag. The
  bounty goes to whoever carries the most (at least $3,000), keeps to its carrier on a tie, and is
  called every 20 s within 15 m of where they are. It shows in the HUD for 8 s after each call.
  **Dropped** (2026-09-28): a bounty bonus was decided against (see Decisions).
- **Bots know who fired which shots** (27). A bot joining a fight guesses where the shots came
  from, but still tells two shooters apart exactly and knows whether guards are in the fight.
  **Dropped** (2026-09-28): a small advantage nobody will notice.
- **A new fill bot learns who the bounty is only at the next call** (27), up to 20 s later, while
  a player sees the name at once. Guards no longer spot or hear the bounty any sooner than anyone.
  **Dropped** (2026-09-28): at most 20 s, and rarely matters.
- **Bots remember a bag's value as they last saw it** (27). If someone takes loot from it after,
  the bot comes for what was there, and finds out on searching it.
  **Dropped** (2026-09-28): that's how a person would too.
- **A grenade whose thrower has left counts as the victim's own** (27), as it did before for the
  score, so its death cam is through the victim's eyes, headed "Killed by your own grenade".
  **Dropped** (2026-09-28): accepted: rare, and the score is right.
- **Snapshots are bigger** (18): each carries the bounty, and each bag its value.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Everyone is told a dead bot's kind** (29): the kill event goes to everyone, and a bag's kind
  is in every snapshot, so snapshots grow a little more. Only the one killed is told their
  killer's kind (in how their run ended and the death cam). A human's body and bag name no kind.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **The kinds are told in words only** (29): a small tag in the feed, a word on the bag's tag and
  one fixed sentence per kind on the results. There's no icon or colour for each.
  **Dropped** (2026-09-28): words are enough.
- **Replays from before chunk 29 have no kinds** (29). They still play, with plain bag tags and
  feed rows. The bots' new rules change the simulation, so a replay kept from before this update
  shows everyone exactly only until the game first plays out differently, then its frames.
  **Dropped** (2026-09-28): expected of older replays.

### Code and testing
- **Snapshots are bigger** (13): each player carries five more fields (motion, action and its
  progress, suppressor, commander). That's fine through the Worker, but multiplayer should pack
  them.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **Two tests had leaned on the old outpost layout** (15): the guard test put the intruder at a
  fixed spot, which now sits between two containers, and the mantle test picked a crate that now
  has another stacked on it. They now pick a spot the sentry can see, and an unstacked crate.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **The dev shortcut is a new client message** (19): `{ t: 'dev', cmd }` ends your run, gives
  you or the nearest operator bot loot, brings that bot 8 m in front of you or has you kill it.
  Only the Worker host of a development build passes it on; a multiplayer server must drop it.
  **Moved to Future** (2026-09-28): only matters once there is a multiplayer server; kept as a checklist under Future.
- **The benchmark reports and doesn't judge** (19). `dev/bench.html` times each frame until the
  GPU is done with it (a one-pixel read), so it's one frame's whole cost, not the throughput of
  frames overlapping. Firefox and WebKit round timers to 1 ms. The report shows each number
  next to the one kept in `e2e/bench-baseline.json` (an M3 Pro, chunk 19), but nothing fails on a
  slower frame. It runs last, alone, as the teardown of the setup project, so running a single
  engine's tests runs it too, unless `--no-deps` is given.
  **Dropped** (2026-09-28): accepted: frame times are too noisy to fail on.
- **The committed textures weren't remade by the new script** (20). The KTX2 files are still the
  ones `sips` scaled; the script now scales with ffmpeg's Lanczos, and its textures differ a
  little: 0.1 to 0.5 dB lower on colour, slightly better normals. The next run of the script
  replaces them.
  **Dropped** (2026-09-28): the next run of the script replaces them.
- **The texture comparison mixes in the resize** (20). The originals are scaled by the
  browser's own resize, not the one the textures were made with, so part of the measured error
  is that difference. The comparison needs the originals in `node_modules/.cache`, so it's
  skipped on a fresh checkout until `scripts/fetch-assets.mjs` has run.
  **Dropped** (2026-09-28): accepted as part of the measured error.
- **The ground cover's first fill takes about 21 ms** (19), when every cell in range is scattered
  at once. Crossing into a new cell after that takes about 1 ms (1.7 ms at the 95th percentile in
  Chromium), and into cells seen before about the same, so the copying costs as much as the
  scattering.
  **Dropped** (2026-09-28): once, at the start.
- **Chunk 23's tests** (23): unit tests cover the plans, huts, doors (pairs, swinging, facing,
  walking through open and not shut), glass (stops rounds and bodies, not sight; breaks at a
  touch), roofs falling only when nothing holds them, the stairs, the upper storey, bots reaching
  every crate from outside, and on the server F opening and shutting a door, a body holding it,
  a late joiner told the open doors, a guard opening a door on its way and a round breaking a
  pane. The cover tests had to pick their test wall more carefully and blow a wider hole, as the
  new buildings sit behind walls that used to have room. The light volume, the door swing, the
  glass and the door prompt were checked by screenshots only: the indoor spot moved into the
  two-storey building and an upstairs spot was added.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **Chunk 24's tests** (24): unit tests pin the cascade patch to three.js's lighting chunk and
  check the far tiles' heights and level picks against the terrain's own meshes and three.js's
  LOD. The browser tests add screenshots from the sea at 200, 400 and 600 m and of a tree line
  fading into impostors, and the adaptive-resolution check on a slowed GPU. The impostors' baked
  pictures, the reflection, the swaying, the underwater wobble and muffling and the bushes'
  colour were checked by screenshots (and one dump of the baked pictures) only, and the shader
  that stands things on far tiles only by how its pictures look.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.
- **Chunk 29's tests** (29): unit tests cover the kinds in the kill, on bags (and bags merged
  into), in the run's end and the death cam; operator bots fighting a guard close by but not one
  far off, giving up crates near a guard that shot them and heading out once badly hurt; the
  thorough plan; the run log's cause naming a kind; and PvE's boards being cleared. Browser tests
  in each engine read the kind off the death cam banner, the results, a kill row and a bag's tag,
  open Stats empty and after a run and export it, share through a stubbed share sheet (and close
  it), and check PvE's boards are gone after loading. A replay test had compared frames recorded
  after the replay's end, where a far body's last sample can only be held; the bots' new moves
  made one of those 3.8 m off, so it now stops at the replay's end. The bounty test failed once
  in a full run in Chromium: the rival had wandered off before it was killed and its bag's tag
  didn't show; it's now brought back in front just before. Tried with 6 workers instead of 4,
  several run and rivals tests failed because guards killed the player before the test's
  shortcuts arrived; at 4 they all passed twice over.
  **Dropped** (2026-09-28): a record of what was measured or changed, not a problem to fix.

### Playtest and tuning
- **The buildings haven't been tuned for** (15). In a 10-minute, 6-island bot playtest, operator
  bots got out of 19% of runs, against 18% before the buildings. The bolt-action's rate fell from
  22% to 11%, but on only about 70 runs each.
  **Dropped** (2026-09-28): the same as "The new buildings were tried by bots only".
- **Operator bots now leave far-off enemies alone** (12). They fight guards only within 40 m, and
  other operators only within their gun's effective range, unless shot at in the last 10 s. That
  applies to human players too, so a bot you spot at long range won't open fire first.
  Since chunk 29 being shot at no longer makes a guard fair game at any range: past 60 m an
  operator bot gets away from it instead, even while it keeps hitting them. Nobody has watched
  whether that looks like fleeing or like ignoring the shots.
  **Dropped** (2026-09-28): a note on how bots behave, not a problem.
- **The bot playtest leaves out runs still going when it stops** (12), so long runs are slightly
  undercounted. Bots get no contracts, so "contracts done" is always 0% there.
  **Resolved in part** (29): it now counts them: about 4% of runs in a 30-minute game (21% in the
  thorough mode, whose runs are long and few). They're still left out of the summary.
  **Dropped** (2026-09-28): they're counted now, and few.
- **Bots now path onto low obstacles** (23). The nav grid treats anything up to 0.52 m above a
  cell's floor as something to step onto rather than walk round, so a hut's raised floor doesn't
  block its doorway. Small rocks and the first step of a stair count too.
  **Dropped** (2026-09-28): a note on how bots behave, not a problem.
