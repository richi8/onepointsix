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
- **Water is a flat, see-through plane** (9), with no waves, reflections, shoreline foam or
  underwater effect.
  **Resolved in part** (15): a 240 m grid round the camera rolls with four wave trains, inside a
  flat ring out to the horizon. The sea's depth comes from a height map of the island: shallow
  water is clear and pale, deep water dark, waves die down toward the shore and foam laps along
  it in bands. Below the surface the fog turns murky green. It reflects the sky through the
  environment map, but not the island (see below).
  **Resolved** (24): the one thing left, reflecting the island, came with the sea's reflection
  (see "The sea reflects only the sky" above); what that still lacks is under "The reflection
  is partial" in the plan.
- **Trees are procedural** (9), because Poly Haven's tree models are hundreds of MB each. They
  have no LOD or impostors, and they don't sway.
  **Resolved in part** (15): trees are split into 100 m tiles. Tiles within 170–190 m of the
  camera draw every tree in full, and their crowns sway in one wind. Farther tiles draw each tree
  as an impostor: a card facing the camera, with a picture of the tree baked at startup. In the
  shadow pass the card faces the sun, so far trees still cast shadows. The trees are still
  procedural.
  **Resolved** (39): still generated, as real tree models are far too big to download, but as
  spruces rather than cones and cards: a flared trunk, whorls of limbs drooping at the foot and
  rising at the top, many small arched sprays of needles along each limb with shoots hanging
  under them, dead twigs below the crown and a dark core inside it, shaded darker toward the
  trunk and the crown's foot. A tree is drawn in full within 30–40 m, then as the same tree with
  a tenth of the triangles (no limbs, a few large sprays a limb) out to 110–140 m, and the
  impostors are baked from that plainer tree; each hand-over is a dither the three share, so
  no pixel is drawn twice. Sprays keep their normals out of the crown on both sides and have no
  sheen, which had shaded the full trees darker and bluer than their impostors (now within 4% of
  each other by mean colour) and glared against the sun. What's left is under "Every tree is
  the same spruce" in the plan.
- **Every tree is the same spruce** (39). One tree is generated per island and every tree is
  that one, turned, scaled and tinted; there's one species, and no saplings, dead trees or
  broadleaves. Sprays are cards: from under a few metres, most of all looking up into a crown,
  they read as flat fronds. Limbs are drawn only within 40 m, and the needles have no sheen, wet
  or dry. Each hand-over (30–40 m and 110–140 m) is a dither that shows as a fine speckle in a
  still picture; nobody has watched the trees in motion.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Only the bodies you hit flinch** (33, from 13). Hits are told only to whoever fired, so a body
  struck by someone else doesn't react on your screen, whichever way the round went.
  **Accepted** (2026-09-30): the user is fine with it for now.
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
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Door leaves count as open for bots' paths** (35): the nav grid keeps clear of every leaf where
  it stands open, and walks through where it stands shut, as bots open doors by walking into
  them. A bot opening a door toward itself is swept back by the leaf, the opener not counting as
  in the way.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Doors swing on two clocks** (35): the server swings them each tick and each client each frame,
  so a leaf mid-swing can be a frame apart on the two. A door you swung isn't in the death cam as
  it swung; the death cam shows doors as they stood at its start. Whether someone stands in the
  way is judged from where they stood, not from the leaf's thickness, and on your own screen from
  where you see others, a tenth of a second behind; the server's answer puts it right.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Bots slam doors on a chase only rarely** (35): once in two 20-minute bot playtests of six
  islands (in 982 doors shut). It needs a bot getting away from someone seen in the last 6 s,
  within 30 m of the doorway on the side it came from, and a doorway on its way. Nobody has been
  chased through a door by a person, and a shut door only slows a chaser, who opens it.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **The upper floor rests only on its posts** (35): with every wall under it shot out but the
  posts standing, the upper storey stays up; with the posts gone it falls though the walls stand.
  The landing beside the stairs falls with the posts too. Someone standing on a floor that falls
  just drops. A building's ground storey can't be brought down but a panel at a time, and a
  one-storey building's roof comes down only once everything under it has gone, as before.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Towers and containers collide as the boxes they were** (35): drawn from their parts, they
  still stop rounds, sight and bodies as solid boxes, so the finger gaps between a parapet's
  boards, the space between the deck's joists and the underside of the stairs are solid. A
  container's doors don't open. Every watchtower is the same, and the wood is a little darker
  than the boxes were.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Bodies step under their head rather than bend to it** (grips, after chunk 35). To put the head
  over its hitbox front to back, the whole body, feet and all, first moves up to 0.3 m, and only
  what's left is taken by the hips and the waist. A crouch keeps the clip's hunch, but its feet
  can stand a little behind the legs' hitbox.
  **Resolved** (2026-10-01): the step stays, and a still crouch now draws in a foot it leaves
  behind the legs' hitbox, up to its edge (0.2 m behind its middle), so the back knee comes in
  under the hips. Taking more of the step with the hips over planted feet was tried, limited by
  the legs' reach, but the crouch clip's front foot is 0.3 m ahead of the head's spot, so the
  front shin then leaned back to it in a lunge. Standing, the step is under 0.1 m and the feet stay
  in the hitbox. A crouch-walk's or a landing's back foot can still reach past it mid-stride.
- **Long guns are held short of the fore-end** (grips, after chunk 35). With the butt against the
  front of the shoulder, the model's short arms can't reach the rifle's or bolt-action's fore-end,
  so the left hand slides back along the gun until it can, as far as the magazine well. The pistol
  is drawn in from 0.5 m until both wrists reach its grip. Checked in the pose viewer, not in play.
  **Resolved** (2026-10-01): behind a long gun the chest turns side-on, left shoulder forward, as
  a rifleman stands, and the neck turns the head back to the aim; it eases square again for the
  pistol and for a climb. The left hand now reaches the rifle's fore-end, and comes within 5 cm
  of the bolt-action's mark (from 21 cm short).
- **The low run is the run clip lowered** (33): the hips tipped and dropped over the run's feet,
  not a crouched run of its own. A foot on a step's edge stands at the step's height, as the
  ground's height counts anything under a player's width.
  **Resolved** (2026-10-01): neither of Quaternius's free animation sets (the first library's, nor
  the second's, out in January 2026) has a crouched run, so one is keyed by hand when the soldier
  loads (`crouchRun` in clips.ts): hips 0.6 m up and 0.42 m behind the feet's middle, bent
  forward 0.65 rad and 0.25 more down the spine with the head turned back up, dipping as each foot
  lands, swaying over it and twisting with the legs while the chest stays square; short strides
  (0.66 s, 2.1 m/s) with the feet on the ground 42% of the time, pushing off on the toe, kicking
  only 0.2 m up behind, coming through with the knee up and landing on the heel. The crouch
  hitbox's head at 1 m keeps it low: higher hips would need a flatter back. A foot now stands on
  what's within 5 cm of it (a boot's half width) rather than a player's footing, so one off a
  step's edge goes down to the ground, though its tilt is still taken from the wider footing so
  the edge doesn't tip it. Checked in the pose viewer, with a screenshot test of four points in
  the stride; not watched in play.
- **Dropped magazines are only for show** (33). Each player sees only the ones dropped near them
  and in view (within 90 m), where they saw them fall; they don't land on bodies, go after 90 s,
  and no more than 40 lie about. The rifle's charging handle doesn't move, and the pistol's
  magazine body is a plain box inside the grip.
  **Resolved in part** (2026-10-01): every body drops its magazines, near, far or out of sight
  (from where its gun was last posed, so a body never yet seen drops one from its feet), and
  they're drawn instanced, one draw a kind, so 400 lie about for the whole game, the oldest
  going first. They land on bodies, dropped guns and each other, fall when the body under them
  is cleared away, and are thrown by grenades; a death cam drops none again. The rifle has a
  charging handle, added to the model (which had none) as a latch on a stem at the back of the
  receiver, set high enough to draw back over the stock: the left hand hooks it and draws it
  back at the end of a reload, timed to the recording, which now plays then rather than once
  the reload is over. The pistol's magazine body is flat at the back and round at the front,
  and a full one shows a round between its lips; the dropped one is empty. Checked in the pose
  viewer and a screenshot test, not watched in play; in first person the left sleeve comes up
  close to the eye for the pull. Left: they're each player's own, falling from each screen's
  poses rather than the server's, so two players would see them a little apart (matters only
  with multiplayer); and the living walk through them rather than kicking them aside.
  **Accepted** (2026-10-01): the user is fine with both of what's left.
- **The climb follows the game's lift, not a person's** (33). The game raises the body straight
  up to the ledge's top in about 0.2 s and then moves it on, so the hand holding the edge can only
  reach it early on; after that the arm points down at it, straight, above it. The ledge's top is
  looked for with the ground's height ahead of the body, which can miss a thin ledge; then it
  guesses 1 m.
  **Resolved** (2026-10-01): the game's lift is a person's. It pulls straight up only until the
  hips are at the ledge (0.9 m below its top), then presses up and over together, the rise left
  shrinking as the square of the way over left, so it's mostly up before it's far over, as a knee
  goes onto the ledge; the hitbox hunches (ducks) while it presses and stands once on top. It
  takes as long as before. The hand holds the ledge's edge, found by stepping out from the body
  for where the top begins, and stays on it through the press, letting go as the feet get onto
  it; the right foot steps onto the top past the edge and stays there as the body goes over it,
  and the left foot keeps to the wall. The top is looked for as the game looks for it (the
  highest ledge in reach at that point), falling back on the ground's height and then 1 m only if
  that fails. Checked in the pose viewer at 1 m and 1.8 m, with the screenshot test updated, not
  watched in play.
- **Bodies posed only for what's in view** (32): a body is posed while it's on screen, while its
  shadow may fall on screen, or while its flashlight is on within 60 m. One seen only in the
  sea's reflection, above the top of the screen, keeps its last pose there.
  **Resolved** (2026-10-01): while the sea's reflection is drawn, a body whose mirror image (its
  sphere flipped about the surface) is on screen is posed and drawn too, as seeing it from the
  mirrored camera is the same as seeing its mirror image from the real one. It's tested against
  the screen alone, so one whose reflection is hidden behind a hill is posed anyway. The check
  uses whether the last frame drew the reflection, so on the first frame the sea comes into view
  such a body is a frame behind. (Hidden, such a body was in fact left out of the reflection too,
  not only unposed.) Typechecked and unit-tested, not watched in play.

- **The sea is looked for by 144 rays** (32): a grid of 16 by 9 across the screen, each marched
  over the terrain to where it meets the surface. Buildings and trees aren't counted, which only
  errs toward drawing the reflection, but a sliver of sea narrower than the grid's spacing (about
  80 px at 1280 wide) between hills can be missed, and there the sea shows the sky's picture
  instead of the island's. It costs about 0.006 ms a frame with no sea in view.
  **Resolved in part** (2026-10-01): after the scene is drawn, while its depth is still there, a
  disk over the sea out to the fog, 0.35 m above still water (over the highest wave), is drawn
  without colour inside a GPU occlusion query, which counts whether any of it showed past the
  hills, buildings and trees in front. A count that saw sea turns the reflection on as the rays
  do. Checked in Chromium, Firefox and WebKit at four views the rays miss: each now draws the
  reflection, and one where the sea strip is plain now shows the island in it. It costs about
  0.03 to 0.05 ms of CPU a frame for the extra render call. Still open: the count arrives a frame
  or two late, so a sliver only the count finds shows the sky's picture for those frames as it
  comes into view; the disk stands above shore that's within 0.35 m of the water, and fogged sea
  right out at the fog's edge counts, which only err toward drawing the reflection.
  **Accepted** (2026-10-01): the user finds it good enough by eye. None of what's left costs
  much: drawing the disk straight through WebGL rather than a render call would save about
  0.03 ms a frame, the fog's edge was already the rays' rule, and a beach in view without the sea
  is rare. Letting the count also turn the reflection off where buildings and trees hide sea the
  rays find would save whole reflection passes, but the late count would make it pop in.
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
  **Resolved in part** (2026-10-01): the ripples bend each pixel by how far what it mirrors is
  behind the surface, read from the reflection's depth: the sky by as much as before, a soldier
  wading or a tree at the water's edge by hardly any, so they no longer tear apart. Bushes,
  tracers, puffs, smoke, the explosion's fireball and others' flashlight beams are in it. The
  picture is read no brighter than 95% white before the sea undoes its tone mapping, which had
  turned a fireball's glow into a white disk brighter than the fireball. Window glass mirrors the
  sky (the light it's lit by) without thinning it out with what it lets through, more toward a
  glancing angle, and seen from indoors mirrors the room's dimmer light. Checked by screenshots
  against the code before; on an M3 Pro the reflection pass at a bushy shore took about 0.1–0.2 ms
  more of the GPU's 2.2–2.4 ms, all of it the bushes; the benchmark has no sea in view and came
  out the same. Still open, and left as not worth it: grass and pebbles aren't in it (drawn twice
  they'd cost 0.5–1 ms, and at a third of the resolution blades turn to noise); rain, impact marks
  and the flashlights' glare (bright only toward the eye) aren't either; nor is the sea itself;
  it's a third of the screen's resolution and reuses the last frame's shadow maps. Glass mirrors
  only the sky, not what's round it, and only faintly face on, as glass does; its outside face
  reads the light volume a little indoors, so outdoors it mirrors about half what it would.
  **Accepted** (2026-10-01): the user finds it good enough for now. What's left is either too
  costly for what it shows (grass, a higher resolution) or hardly seen (rain, impact marks, the
  glare, the sea itself, last frame's shadow maps); mirroring what's round a window would take
  screen-space reflections, 1–2 ms and a large job, and the half-strength outside face of glass
  could be fixed by reading the light volume from further out.
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
  **Resolved in part** (2026-10-01): the flat 30% is gone. Each cell also takes the light bounced
  once off what's round it, from 32 directions all round: each block a ray meets bounces the sky's
  light of the cell before it (walls take their room's), in its prop's colour, and rays out
  through a doorway downward bounce off the ground outside. A floor of 15% stands for light
  bounced more; tuned (15%, ×4) so the rooms of the default island are as bright on average as
  before (0.32 against 0.335), with corners down to about 0.15–0.2 and walls by windows brighter.
  The texture holds red, green and blue. When a building's cover changes, every other building
  within 150 m works out its sky outside again (200 rays), and its cells only if that changed by
  2% any way. The gun in your hands blends the eight cells round it, 0.4 m ahead of the eye, and
  its sky light leans toward the side that's brighter. Working out all ten buildings takes about
  80 ms in Node, double before, still spread at 2.5 ms a frame. Checked by still screenshots
  against the old code (subtle: walls by windows lighter, the stairs warmer); the gun was checked
  by its numbers, not seen in play. Still open: sunlight doesn't bounce (a sunlit patch on a floor
  doesn't light the room round it), colours are the props' flat ones, not their textures', and
  cells are 0.5 m.
  **Resolved in part** (2026-10-01): sunlight bounces. Every face of a block the sun reaches
  indoors (by a ray through the blocks, then on through the world and the trees' crowns, from
  that very spot) is gathered into a patch for each cell; every cell takes each patch's light it
  can see, falling off with the square of the distance; rays out of a doorway downward add the
  sunny ground outside. It's kept as a share of the sun's light in a second texture, and
  materials add it times the sun's light, so it follows the time of day and the weather, and
  the gun takes it too. Physically it's faint on these dark surfaces (about 4% of the sun a metre
  or two from a patch), so it's boosted 4× (with 0.5 for a surface not facing the patch), tuned by
  screenshots: walls beside a sunlit window are brighter and warmer at midday; at dusk the low,
  dim sun shows no difference in the test rooms. All ten buildings take about 125 ms in Node
  (80 ms before), at 2.5 ms a frame; the extra texture read in every lit material wasn't
  benchmarked. Still open: cells are 0.5 m, and a patch of sun lights only the cells it sees, once.
  Left as not worth it (2026-10-01, the user's call): light bounces in the props' flat colours, not
  their textures' averages; the difference would hardly show.
  **Accepted** (2026-10-01): the user finds it good enough. Neither thing left would show: the
  light from the sky changes smoothly across a room and the cells are blended, while the sharp
  edges (sun through a window, a doorway's line) come from the shadow maps; 0.25 m cells would
  cost 8× the work and memory and a 3D texture past what WebGL2 promises. A second bounce of the
  sun would add about a third of the first, which the 4× already stands in for.
- **World detail was checked by screenshots on one machine** (15). Headless Chrome on an M3 Pro
  holds 60 fps (median 16.7 ms, 95th percentile 18.2 ms) at 1280 × 720 in a Mixed game.
  Draw calls fell from 348 to 239 at the same spawn, and triangles rose from 639k to 736k. A
  mid-range laptop wasn't tried, nobody has watched the swaying and waves in motion, and the
  ground cover's rebuild, when the camera crosses an 8 m cell, wasn't timed.
  **Resolved in part** (19): the benchmark times the rebuild at about 1 ms a cell crossed in all
  three engines (see "The ground cover's first fill"), and the screenshots are now compared by
  the tests. The mid-range laptop and watching it move are left for chunk 30.
  **Accepted** (2026-10-01): the user has played it on a slower machine and it runs fine.
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
  **Resolved** (2026-10-01): the user has watched the animations in play and they're fine.
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
  **Resolved** (2026-10-01): the user has watched bodies fall, pile up and get thrown by grenades
  in play and finds them fine; the gaps left above (the living not moved by a body, elbows bent
  by a guess, bodies left lying not in a death cam, magazines not thrown) weren't noticed.
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
  **Resolved** (2026-10-01): props are drawn in their shapes over the same colliders: crates with
  edge battens and side braces, fences of boards between posts, panelled door leaves with handles,
  tables on legs, stair steps with a tread and nosing, lamp heads with a sloped housing, and
  window frames round the glass with sills standing out of the wall. Parts keep their size in
  metres however the box stretches (an `inset` offset per vertex in `src/client/props.ts`).
  Concrete walls, posts, lintels and floors and the steel roof sheets stay slabs, as they are.
  Checked by screenshots, not watched in play. Props take 10 draw calls rather than 2; the
  benchmark's frames came out within 0.3 ms of the code before in alternating runs. The fence's
  slits and the doors' grain are a separate issue, accepted.
- **Fences show slits that stop rounds, and door panels show sideways grain** (2026-10-01). A
  fence's boards leave finger-wide gaps you can glimpse through, but bullets and bots treat the
  section as solid. The wood texture is laid in world space and its grain runs across, so a door
  leaf's stiles and panel all show horizontal grain.
  **Accepted** (2026-10-01): the user is fine with both as they are.
- **The new soldier hasn't been watched in play** (41). It was checked in the pose viewer (every
  pose and clip, screenshot tests re-recorded) and by the benchmark, not by playing. Some things
  were set by eye there and may want another look in motion: how far into the palm the thumb's
  side is taken (`THUMB_TILT`), how deep the palm is (`PALM_DEPTH`), the fingers' and thumb's
  curl, how far the chest turns side-on behind a rifle (`BLADE`, down from 0.8 to 0.5, since this
  body's bulky vest swallowed the right arm), how far out the right elbow is held, where a long
  gun's butt sits on the front of the shoulder (`SHOULDER_DEPTH`) and how far it's rolled
  leaning left (`LEAN_CANT`). Those last were measured, not only looked at: a scratch probe in the
  pose viewer put the butt pad within about 3 cm of the vest in every stance, with the rifle at
  most 2.6 cm into it (a stock resting on a vest's pouches), standing, leaning either way,
  walking, running, crouched or aiming up; the right forearm still dips up to about 4 cm into the vest
  leaning left, drawing and throwing. Where the pack sits on the back, and the hand-keyed crouched run, whose numbers were made
  for the old model and only carried over (its legs are now bent by IK each key, as the feet hang
  off the shins).
  **Resolved** (41, 2026-10-01): the developer played against it and reported what was wrong,
  each reproduced in the pose viewer from the same angle and fixed. Crouched, the head dropped and
  the rifle rode up over it: the rig hangs the collarbones off the neck, so every turn of the head
  swung the shoulders, and `scripts/rocketbox.py` now hangs them off the chest; the gun is also
  kept below the eye. Behind a rifle the right arm and then the stock went into the vest: the
  chest turns side-on less, the right elbow is held out, the butt sits on the front of the
  shoulder along the way the chest faces, raised so its toe clears the chest, and leaning left
  the rifle rolls away from the shoulder. Pushed too far out at first, the rifle floated at arm's
  length with the left hand short of the bolt-action's fore-end, which the probe's gap from the
  butt pad to the vest then settled. Accepted as it looks now; the right forearm's dip of up to
  about 4 cm into the vest leaning left, drawing and throwing is left as it is.
- **The soldier's normal map is plain ETC1S** (41). The terrain's normal maps keep two channels
  for quality, which needs the shader to rebuild the third; the soldier's go through three.js's
  own material, so they're packed as an ordinary colour image, which ETC1S blurs a little. The
  goggle lens, the one see-through part, is left out.
  **Resolved** (41, 2026-10-02): it's packed as the terrain's are, X in RGB and Y in alpha
  (`--normal-mode`), and the soldier's shader patch (`atlas`, moved to `baked.ts`) samples green
  and alpha and rebuilds Z, as `surfTangent` does. The first-person arms take the same patch now,
  carried over to their wet copies in rain. Side by side in the pose viewer, the blocky patches on the
  sleeves and vest are gone and the shading is otherwise the same. The map grows from 127 KB to
  210 KB, for the alpha slice. The lens is still left out.
- **The ragdoll's unit tests start from the old soldier's fall** (41). `test/slump.json` is the
  stylized soldier's death clip where the ragdoll took over, falling back; the Rocketbox body's
  death clip (the library's `Death01`) falls forward, and the tests, written round a fall back,
  keep the old start. The browser test of a fall in play and in the death cam runs on the new body.
  **Resolved** (41, 2026-10-02): `test/slump.json` is now the Rocketbox body's slump, written by
  `scripts/slump.ts` with ragrig.ts as the game works it out. The tests expect a fall forward:
  the slope, the wall, the body landing on another and the person in the way are all ahead of it,
  and the magazine lands on its left shoulder, uppermost as it lies face down. The knee test
  skips a leg lying along the way the body faces, as ragdoll.ts does; without that, it read the
  bend backward. The new start showed that elbows and ankles give a little in a hard landing (see
  PLAN.md's Known Issues), so the tests check the joints' limits strictly once the body is at
  rest, and more loosely while it falls.
- **Elbows and ankles give a little in a hard landing** (41, 2026-10-02). Started from the
  Rocketbox body's forward fall, the ragdoll can force an elbow up to about 5 cm the wrong way, or
  an ankle up to about 0.2 rad past its range, for a few steps as it lands, when thrown hard or
  sliding downhill. The ground has the last word in each step, over the joints' limits. Both
  settle back within their limits at rest, and the unit tests allow the give while it falls.
  **Resolved** (41, 2026-10-02): each of the solver's eight passes now pushes the joints out of
  the ground after the limits, not just the last two, so the two settle together; colliders,
  other bodies and the living still come in on the last two passes only. Trying 16 throws, a knee
  was found going 12 cm the wrong way too, and the knee's own limit turned the foot: it moved the
  ankle and not the toe, which now goes with it. Over 16 throws and 8 slopes and shoves, elbows
  and knees now stay within their limits, and ankles within 0.023 rad of theirs (0.137 before).
  A step costs about 35 µs instead of 24. Bodies still stop on slopes up to about 0.5 rad and
  slide down steeper ones. The unit tests check the limits strictly all the way down again, over
  16 throws instead of 8.
- **One stylized soldier model for every side** (9, 11; joined 2026-10-01). Every side uses
  the same model, told apart at first only by tint, so commanders looked like any other guard.
  Quaternius's low-poly SWAT character (chunk 11) was the best rigged and animated CC0 soldier
  available, but it doesn't match the grounded tone, and its helmet hides the face.
  **Resolved in part** (13): the sides now differ in kit as well as uniform. Operators carry a
  pack and bedroll with black webbing, and guards wear brown webbing. Commanders (flagged in
  snapshots) wear a paler uniform, a red band round the helmet and a radio with a mast on their
  back. The fingers close round the grip and fore-end. It's still one stylized model, with the
  face hidden. Phase 5 (chunks 41–42) replaces it with Rocketbox's SWAT officers and soldiers.
  **Resolved in part** (41): every body is now Rocketbox's SWAT officer (`Police_Male_02`), a
  realistic avatar with its own textures. The side tints went with the old model, so for now
  operators and guards differ only by the operators' pack, and commanders by their red band and
  radio; chunk 42 gives each side its own avatars.
  **Resolved** (42, 2026-10-02): each side wears its own Rocketbox avatars, picked for each body
  by the island's seed: operators are SWAT officers (`Police_Male_02`, `Police_Female_01`), guards soldiers in camouflage, helmets and vests (`Military_Male_01`, `_03`, `_04`,
  `Military_Female_01`, `_02`), and commanders soldiers in caps (`Military_Male_02`, `_05`,
  `_06`). The code-built kit is gone: the pack, the helmet band, the radio and its mast. At 30 m,
  as the game frames it, the operator is a black figure, the guard a bulky one in a helmet and
  vest, and the commander a slimmer one in a cap with a bare face; the last two are hard to tell
  apart from the side. The first avatar carries the clips, and the others' bones are
  turned to play them (posed by them, Military_Female_01's skin lands within 0.01 mm of where
  its own retargeted clips put it).
- **Guards and commanders look alike from the side at a distance** (42). With the radio and its
  mast taken off at the developer's wish, all that sets a commander apart is the cap and bare
  face in place of a helmet and vest, both in the same camouflage. At 30 m, as the game frames
  it, that shows from the front but barely from the side.
  **Resolved** (42, 2026-10-02): the clothes are recoloured by side as the avatars are packed,
  guards in green and commanders in brown, caps and helmets included (skin, far more saturated,
  is left alone). At 30 m, as the game frames it, the two are easy to tell apart from the front
  and the side.

- **The backdrop round the town is still the island's** (59): pines and grass on the hills
  behind a Mediterranean town, where olive groves, maquis and terraces would belong.
  **Resolved** (63): a map grows its own trees and hillside (`greenery.ts`, `species.ts`,
  `shared/hillside.ts`): olives in rows on terraces behind dry-stone walls along the
  contours, the maquis, holm oaks and umbrella pines in place of the island's spruces,
  cypresses, outcrops of pale rock, and grass bleached to straw beyond the walls.
- **Doors are painted by where they stand** (chunk 59), one of four colours, not in their
  building's own paint as its shutters are.
  **Moot** (65): the doors were removed; doorways are plain openings.
- **A pitched roof's overhang reaches into a taller neighbour** (chunk 56, found in chunk 62):
  its slopes run 0.25 m past a gable standing against a taller building's 0.3 m wall, so
  about 10 cm of them shows inside that building's room (as where two of the west's houses
  meet, one a storey higher). The ridge and verge tiles stop short of such a gable.
  **Resolved** (66): each slope stops at the middle of the wall its gable shares with a
  building it stands against, judged under the ridge and under that slope's eave, so a gable
  only partly against a neighbour (one in the west has a free middle and a corner in the next
  house) keeps its overhang on the slope that looks out. The ridge and verge tiles stop as
  before. A test checks no slope of Calabianca's reaches into another building's room.
- **Signs are drawn with the machine's own fonts** (chunk 62), Georgia and Arial where it has
  them, so their letters differ from machine to machine; they don't weather or get wet as the
  walls do. The lanterns are never lit, as the game is day only.
  **Accepted** (2026-10-07): Unlit lanterns are day only by design; fonts differ only where a machine lacks Georgia or Arial, on the old town.
- **The terraces aren't cut into the ground** (chunk 63): the terrain is 4 m a cell, too coarse
  for a level terrace, so each dry-stone wall stands on the hillside's even slope, 0.8 m over
  its contour on both sides, rather than holding up a level step. From the town they read as
  terraces; up close it's a low wall on a slope.
  **Accepted** (2026-10-07): Beyond the bounds, and they read as terraces from the town.
- **The hillside's trees aren't the world's** (chunk 63): a map's world still places the
  island's trees as spruce-shaped colliders, drawn as oaks and pines but left out in the groves
  and near the town, where they stand invisible; the olives, cypresses, shrubs, walls and rocks
  out there collide with nothing. All beyond the bounds, so nobody meets them, but a round
  flying out of the town passes through what's drawn and may stop on what isn't.
  **Accepted** (2026-10-07): All of it is beyond the bounds.
- **The island's sky light still holds the sun** (chunk 60): only a map's town has it taken
  out, so on the island the shade is still lit from the sun's way, as before, and outposts
  read flatter than the town. Taking it out there too would darken the island's rooms and
  shade, which the testers know.
  **Accepted** (2026-10-07): Kept on purpose: the testers know the island's shade as it is.
- **The sky's photograph is soft close up** (chunk 60): 4096 pixels round, about 11 a degree
  against about 18 on screen, and the same sky in every game.
  **Accepted** (2026-10-07): Day only, one sky; a sharper one costs download for little.

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
  **Resolved in part** (37): the reloads are real guns: the rifle's magazine out, a fresh one
  seated and its charging handle from an AR15 being handled, the pistol's magazine from a pistol
  and its slide from a Glock 19. Each part plays as the hands get to it rather than as one mix at
  the start, and a reload cut short by drawing another gun cuts its sounds short too. The cuts
  were placed by loudness envelope, not by ear: in the AR15 recording the loud clicks alternate
  with quieter ones about two seconds apart, taken as seating and pulling the magazine, and a
  pair 0.3 s apart as the charging handle pulled and let go. Still a stand-in: the rifle's
  suppressed shot, as no CC0 recording of a suppressed rifle of its kind was found (the few
  suppressed ones on Freesound are made in an editor, an air rifle, or a blank-firing BB gun).
  The rifle's reload still has no charging handle in the animation, though the sound plays.
  **Accepted** (2026-09-30): the charging handle heard in the rifle's reload without being seen is a
  small thing. Closed at the user's request, all but the rifle's suppressed shot, which stays open
  on its own ("The rifle's suppressed shot is a stand-in", in the plan).
- **The rifle's suppressed shot is a stand-in** (14, split out 2026-09-30). It's a suppressed
  sniper rifle from a US government video, the nearest real one found: no CC0 recording of a
  suppressed rifle of its kind turned up (the few suppressed ones on Freesound are made in an
  editor, an air rifle, or a blank-firing BB gun). The rest of the recordings are real (see "Some
  recordings aren't what they stand for" above).
  **Resolved** (2026-10-02): it's an HK MP7 now, a real suppressed select-fire gun fired
  outdoors, its single shot cut from the start of the same recording that goes on to fire full
  auto. Recorded by areniporgen, who also recorded the pistol's and the bolt-action's suppressed
  shots, so all three sound like one place and microphone. A fresh search still found no CC0
  suppressed AR15 or other 5.56 carbine on Freesound (the rest are made in an editor, an air rifle,
  a BB gun or are pistols), so the MP7's 4.6 mm round is as near as it gets. Played at the same
  gain as the old one, it's within 1 dB over its first 50 and 200 ms, and it dies away in half a
  second where the sniper rifle's rang on for nearly a second.
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
  **Resolved in part** (37): the half of a sound's ringing that comes from the space round it is
  panned to where the sound seems to be before its reverb, whose two sides ring apart, so a door
  slammed to your right rings back from the right (four times as loud there as on the left, in the
  browser test); the listener's own half still comes from all round. A roof is found by six rays,
  one straight up and five leaning 30° round it, as a share of the sky covered, so an overhang or
  the eaves count for part of a roof, not all of it. What's left: the returns are panned only left
  and right, not in front, behind or overhead, and the impulses are still generated, not
  recorded.
  **Accepted** (2026-09-30): returns panned only left and right and generated impulses are fine for
  now. Closed at the user's request.
- **Sound round corners is worked out on a flat grid** (26). The grid is at ground level, so
  upstairs, on a roof or up a watchtower, routes are worked out as if on the ground below; the
  legs are checked in 3D, so a wrong route is dropped rather than heard, but a right one upstairs
  can be missed. Sound can't go round through an open window, only straight through its gap, and
  goes round only within 48 m; past that it's straight through or over. The losses per material
  and per bend were picked, not measured or heard.
  **Resolved in part** (37): over the ground grid, each stair, upper floor, watchtower platform
  and roof has a node in the air over it, and so has each broken window, in its gap. They're
  joined to the nodes round them by lines checked against the world, rising or falling beside the
  higher one when they're more than a metre apart in height, so sound goes up a stairwell, out of
  a window upstairs and down to the ground, or over a roof's edge. A sound past the 48 m flood,
  up to 150 m, is heard along the way out of the flood nearest to it, then straight on, so from
  inside a house a far shot comes in through the door. What's left: that far leg is straight, so
  a sound far off inside another building is still heard straight through or over it; a floor's
  links are worked out the first time the flood reaches them, 1–4 ms at an outpost once; a
  window is only a way round once its glass is broken (none open); and the losses per material
  and per bend are still picked, not measured.
  **Accepted** (2026-09-30): what's left (the straight far leg, links worked out on first reach, no
  way round through unbroken windows, picked losses) is small. Closed at the user's request.
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
- **The benchmark's empty frame is twice its kept baseline** (32): 5–6.8 ms against 3.1, in runs
  of both the code before chunk 32 and after it in the same session, with the same 95 draw calls
  and 502k triangles as each other. The baseline in `e2e/bench-baseline.json` is older than the
  night case and the far frame, so whether a later chunk made the empty frame dearer or the
  machine was busier wasn't looked into; it wasn't kept as the new baseline.
  **Resolved** (2026-09-30): in chunk 39 the code before measured 5.5–7.3 ms empty in the same
  sessions as the new code, so the machine had slowed, not the code. The baseline was kept again
  from a clean run (8.8 ms empty, 12.1 ms with 24 bodies, 14.8 ms on the rainy night); the empty
  frame, measured first, swings between 6 and 9 ms from run to run, so it's the least telling of
  the numbers.
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
  **Accepted** (2026-09-30): the user is fine with it being tested only on simulated slowness.
- **The 5 s load target wasn't measured on a mid-range laptop** (11). Locally on an M3 Pro, the
  production build loads in 1.1 s cold and 0.4 s warm (3 MB transferred).
  **Resolved in part** (after 39): the user found a load with nothing cached took over 5 s even
  on the M3 Pro, and switching the menu to dusk or night stalled. "Cold" above meant only the
  network cache: with Chrome's Metal shader cache empty too, as on a first visit or after an update
  that changes a shader, the production build took about 16 s by day and 17 s at night to leave
  the loading screen, locally in headless Chrome, and the first switch to dusk or night froze for
  5.7 s. Nearly all of it was compiling shaders and Metal pipelines. Now nothing is drawn behind
  the loading screen until the textures are on, so the flat colours' shaders are never compiled;
  your own flashlight stays in the scene by day at no brightness, with its shadow map drawn once,
  so nightfall changes no shader and no pipeline; the sea's reflection is drawn with the screen's
  shaders (its picture flagged as three.js's XR kind, tone mapped and in sRGB, which the sea
  undoes as it reads it); and the loading screen waits for a frame that has drawn the reflection,
  in view or not, and for the GPU to finish. Cold, the loading screen now goes after about 8.5 s
  by day or night, with no stall after it; warm, 0.83 s against 1.38 s; the first switch to night
  takes 20 ms. The sea's screenshots moved by a mean of 2.6 levels in 255, the sky's reflection a
  touch brighter, as it's never tone mapped on screen but is undone as if it had been. The
  benchmark, in runs alternating with the code before, came out no slower, and faster for reasons
  not looked into (24 bodies 10.2–10.3 against 12.9–14.2 ms, the empty frame 4.5–4.7 against
  6.5–7.5 ms). Still left:
  a cold load is still over 5 s, 5 s of it compiling about 38 programs, the lit ones each with
  the local lights' loop, and it's unmeasured on a mid-range laptop; the first dusk or night bakes
  its sky with two shaders three.js keeps to itself, 0.8 s cold (since fixed, below); measured
  only in Chrome on Metal.
  Once in three cold loads the old code hung in "Preparing the island…" for nearly two minutes;
  the new code didn't in about fifteen, which doesn't rule it out.
  **Resolved in part** (after 39): the user found the first second of a game froze on a cold
  cache, and so did shooting a window the first time: 2.2 s at the start, compiling the soldiers,
  the gun in your hands and the effects. The frames under the loading screen now also draw an
  operator, a guard and a commander with each gun, a bag, a grenade, a round, hits, a broken
  panel's debris and a blast, with everything hidden shown and nothing culled, and the gun in
  your hands; the debris is coloured from the start, as colours first given at a break changed
  its shader. The stand-ins stand just ahead of the camera, near enough to cast shadows, and one
  gone body's material is never freed, so the soldiers' shader stays compiled after them. Cold, a
  game now starts compiling nothing, with one frame of about 130 ms that's there warm too (the
  game's own start), and a window breaks with no stall. The cost moved to the loading screen, which
  now goes after about 12.2 s cold instead of 8.5 s; warm, 0.93 s instead of 0.83 s. The user
  prefers it there.
  **Resolved in part** (after 39): a day's loading screen bakes a night sky once and throws it
  away, so the first dusk or night doesn't compile the shaders that bake it: after a cold load by
  day, switching to night or dusk takes about 20 ms. The cold load held at about 12.1 s.
  **Accepted** (2026-09-30): the user would rather wait once through a long cold start than have
  play freeze, so a cold load of about 12 s on an M3 Pro stands. Left as they are: no load timed
  on a mid-range laptop (the user found one plays fine), only Chrome on Metal measured (Windows'
  Chrome draws through Direct3D, whose costs may differ), and the two-minute hang seen once with
  the old code, not seen since.
- **Frames got slower when the local lights went** (found in 43): the benchmark's frames by day
  took about 3 ms more after chunk 43 than before it (empty frame 7 against 4 ms, 24 bodies 13
  against 10 ms), all of it GPU time, and putting back a never-run read of the local lights'
  shadow atlas seemed to win it back.
  **Moot** (2026-10-02): a fault of the old benchmark, not a slowdown. From chunk 36 the
  benchmark set up the local lights' shadow atlas only when it first drew them, after its day
  phases had already run, and every lit material reading the atlas, never set up, drew nothing:
  its empty, 24-body and far-off frames showed only the sky (seen in screenshots taken during
  them). The game set the atlas up before anything was drawn, so play was never affected. A copy
  of the read, its texture likewise never set up, made the game's own screenshots sky-only too,
  so it was dropped. The day numbers chunks 36 to 42 quote (chunk 41's and 42's 24-body frames
  among them) are therefore of the sky and the unlit parts only; chunk 43's (6.7 ms empty,
  13.1 ms with 24 bodies, 13.2 ms in the rain on an M3 Pro) are the first true ones since.

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
- **Night tuning comes from bots only** (16). In a bot playtest (4 islands × 15 min each),
  operator bots got out of 18% of runs on a clear day, 22% in rain, 26% in fog, 12% on a clear
  night, 19% on a rainy night and 24% on a foggy night. So night is the hardest and fog the
  easiest, as intended, but none of the numbers (sight multiples, one extra guard per outpost,
  loot boost, flashlight reach) have been checked by humans.
  **Accepted** (2026-09-30): the user is fine with it for now; bot extraction at night in rain is
  about 20%, near the day baseline (see Decisions).
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
  **Resolved** (39): within 8–12 m of the camera each tuft is drawn blade by blade (18 tapering,
  curving blades, coloured as the painted ones and still taking the ground's colour at the
  root), handing over to the cards by how many of each pixel's samples each covers. The blades
  hide about as much as the sight model's tufts: test/foliage.test.ts draws a tuft side on from
  every direction and checks its cover at each tenth of its height is within 0.15 of the model's.
  Only the lower blade vertices read the ground's textures, which kept the blades within the
  benchmark's noise. What's left is under "Blades only up close" in the plan.
- **Blades only up close** (39). Grass is drawn blade by blade only within 8–12 m; past that
  it's the crossed cards, and the hand-over shows as a faint band in a still picture. The blades
  are wider than real grass (about 2–8 cm at a typical tuft), so a tuft of them hides as much as
  the sight model says; the cards' own cover was never measured against it. Neither casts a
  shadow. Checked by screenshots and the benchmark on an M3 Pro only.
  **Accepted** (2026-09-30): the user is fine with it for now.
- **Sunlight shows down a building's inside corners** (seen in chunk 36): a thin line of sun
  shows where two walls meet inside, a gap in the shadow map at the seam, not in the light volume.
  **Resolved** (2026-09-30): three.js draws shadows from the faces turned away from the sun, so a
  wall's lit inner face wasn't in the map; on a texel straddling the corner, what was drawn could
  be the far side of the corner post, behind the wall being lit, which read as sun. Props now
  cast shadows from both sides (`PROP_SHADOW_SIDE` in `worldview.ts`), the shadows' bias keeping
  lit faces clear; no acne showed in screenshots by day or at dusk, and the sun through a window
  now falls a sliver narrower, as its jambs no longer leak either. A screenshot test of an inside
  corner at dusk, held to 100 pixels, fails on the line (1,293 pixels) without the change.
- **Bots and lamps are unplayed** (36). Only operator bots shoot lamps out, and only one about to
  search a crate or wait in a spot the lamp lights; they do it without a suppressor too, which
  guards may hear. In a bot playtest at night in rain (4 islands × 15 min), they aimed at a lamp
  3 times, and operator bots got out of 16% of runs against 12% for the code before, in the same
  session. Crouching under a lamp still helps only as much as by day.
  **Accepted** (2026-09-30): the user is fine with it; the lamps are there mainly for the look of
  the place, and players will likely shoot them more often than bots do.
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
  **Resolved** (2026-09-30): the gun in your hands is lit by the lamps and others' flashlights
  too. It's still drawn apart, but the lights are placed in its space as the world's camera sees
  them, and it takes their shadows where it is, so a lamp behind a wall leaves it dark. Checked in
  screenshots under a lamp at night (the fore-end and sleeve catch it), behind the wall (no change)
  and by day (no change); no automated test.
- **Local lights have a budget** (36). At most 16 lamps and others' flashlights light the world,
  ranked by how near the camera they come; past that, the farthest go out at once rather than
  fading. Only the six nearest that cast shadows get a tile of the atlas, 512 px each, all drawn
  every frame; the sea's reflection reuses the last frame's atlas. Shadow offsets were tuned by
  screenshots only. On the benchmark's rainy night (24 lit flashlights near the quarry's lamps)
  the frame held within noise of the code before (14.6 against 14.9 ms median in one session on
  an M3 Pro), with 120 more draw calls; a mid-range laptop wasn't measured.
  **Resolved in part** (after 36): every light within the 16 that casts shadows now gets a tile,
  the six nearest 512 px and the rest 256 px, so a seventh lamp or beam no longer lights through
  walls; a light crossing the 16 fades out over 6 m, and one crossing the six lit fully loses its
  highlight over 6 m, instead of either happening at once. Checked by unit tests and by
  screenshots of the lamp behind a wall with six lights put ahead of it (dark, where six tiles let
  a strip through). On the benchmark's rainy night, 15.2–15.3 against 14.9–15.2 ms median,
  alternating runs in one session on an M3 Pro, with 199 more draw calls and 1.6M more triangles
  in the tiles. Still left: past 16 lights the farthest are out; every tile is drawn every frame,
  though lamps stand still; the reflection's one-frame-old atlas; offsets tuned by screenshots;
  no mid-range laptop. Every lit material now reads 16 shadow matrices rather than six (40 more
  uniform vectors), untried on a GPU that allows few.
  **Accepted** (2026-09-30): the user is fine with what's left; none of it is major. Lights now
  fade out past the 16 rather than switch off, and the rest is cost that held the benchmark.
- **The look was tuned by screenshots only** (16), on an M3 Pro through headless Chrome. The cost
  of up to 24 beams and glares, three spotlights and the rain on a mid-range laptop wasn't
  measured. The lighting presets, rain, flashlights and menu pickers have no automated tests; the
  config, link, bot senses, night guards and loot do.
  **Resolved in part** (31): screenshots outside an outpost at dusk, in rain, in fog, at night
  with your flashlight lit (dev-only `?torch`) and on a rainy night with it; a test that T lights
  the flashlight at night and puts it out, and does nothing by day; the menu's pickers were
  already tested (chunk 19). The dev camera (`?cam=`) now sees the fog a player there would, not
  the menu's thinned fog. The cost on a mid-range laptop still isn't measured.
  **Resolved** (2026-09-30): the user played on a mid-range laptop and found the performance OK.
- **Wet is worked out simply** (36). Bodies, bags and debris dry the moment they're under a roof,
  and are as wet as the ground round them in the open, how much they face up judged from their
  triangles. Puddles form only on the terrain, not on floors or roofs open to the sky. Past 32 m
  from the camera, roofs are known in 2 m cells, so a floor near a far building's wall may be wet.
  Grass and leaves were kept nearly matte when wet, as a gloss turned them grey in screenshots.
  Checked by screenshots only.
  **Resolved in part** (2026-10-01): soldiers, bodies and bags carry their own wetness, soaking
  through in 20 s in the rain and drying over four minutes under a roof; a bag left by a body
  starts as wet as it. How much a thing faces up comes from its normal, not its triangles.
  Floors open to the sky, as once a roof is down, gather puddles as level ground does, and a
  floor shelters the room under it. Past 32 m each 2 m cell also keeps which part of it the
  roofs cover, as a rectangle or a notch left open (an L's inside corner), in steps of 12.5 cm
  rounded onto the roof, so far floors stay dry to the walls (the unit test finds no point
  wrong round six buildings); a cell crossed by two roofs' edges apart keeps their bounds
  together. Soaked grass is glossier and keeps less of the sky's reflection, which was what
  greyed it. Left: needles and bushes stay matte; guns, dropped magazines and debris (which
  lasts 4 s) still dry the moment they're under a roof; something first seen under a roof
  starts dry, as a guard posted inside should, but so does a body rebuilt there after a death
  cam. Checked by unit tests and screenshots, not watched in play.
  **Resolved** (2026-10-01): each body's gun and loose round have materials of their own, wet as
  it is, and each dropped magazine one of its own, starting as wet as whoever dropped it (you
  too) and drying under a roof; debris is as wet as the panel it broke from looked, a roof's
  among them. A body drawn again, as a death cam starts or ends, keeps how wet it was. Needles
  and bushes gloss when soaked and keep less of the sky's reflection, like the grass, and
  needles get back some of the direct light's gloss they're denied dry (the full trees and
  impostors alike). Checked by unit tests, screenshots and a rainy run with no shader errors;
  the needles' glint is faint under the overcast of rain, and nobody has looked at it in play.
- **Your own gun never gets wet** (2026-10-01). The gun in your hands is drawn dry in any rain,
  though your dropped magazines and everyone else's guns are wet.
  **Resolved** (2026-10-01): everything in your hands, gun, arms, grenade and loose round, gets
  a copy of its material that is as wet as you are, soaking in the rain and drying under a roof
  as everyone else does; the materials it shares with the world are left alone. Drawn in a view
  of its own, it has no place in the world, so it takes the world's up turned into the view to
  tell which of its faces are up; in a death cam it is as wet as the killer.
- **The weather switches at once on screen** (44): the island's sky, fog, rain and sounds turned to
  the new weather halfway through each 30–60 s change, while bots' sight and hearing blended
  across it.
  **Resolved** (45): `src/client/outlook.ts` works out from the forecast, at the moment shown,
  how the clouds (sun, sky) and the air (fog reach, blended by ratio) stand between the two
  weathers, how hard it rains (the streaks drawn, the splashes, the ripples, the rain bed, how
  much it muffles far sounds, the birds), how hard the wind blows (the sway and its sound), and
  the signs of the next change in the minute before it. The ground soaks in about 30 s of full
  rain and dries over 3 minutes after (slower in fog), the puddles fill over 90 s from the deepest
  hollows outward and drain over 6 minutes, shrinking back into them; soldiers, bags and
  magazines dry out in the open once the rain stops, not only under a roof. Worked out afresh
  from the forecast when the clock jumps, as into a death cam. Checked by unit tests (no jump
  anywhere over an hour on ten islands, signs ahead of each change, wetting the same followed
  along or after a jump), screenshot tests part way through changes, and a game in the browser
  fed a change 70 s ahead, at 60 fps throughout.
- **The mist ahead of a fog shows mostly by the sea and in valleys** (45): it lay by height above
  the sea, not in hollows of the ground round it, so from a hilltop or high ground inland it was
  faint, and a player there was warned of fog mainly by the greying sky.
  **Resolved** (2026-10-03): the mist now lies from a level a texture gives across the island:
  the ground blurred over about 80 m round each point (two box blurs of 10 cells), less 6 m,
  never below the sea. The island's hollows sit only a few metres under it (95% within 4 m), so
  inland the mist stands near as thick over the ground as by the sea, deepest in the hollows,
  and ridges rise clear. One texture is shared by every fogged material (three.js clones each
  material's uniforms, so it clones to itself), read per vertex, and laid anew for each island
  shown; GPU timer queries in the benchmark found no cost beyond the noise. Checked by
  a new screenshot test from the island's top at eye height ahead of a fog, where the far
  inland ground now greys over as well as the low valleys.
- **Thunder isn't the same for everyone** (45): when lightning strikes and how far is random on
  each client, as before, so two players hear different thunder and a death cam doesn't replay
  the thunder of its moment. Only how stormy it is comes from the forecast.
  **Accepted** (2026-10-03): the user is fine with each player hearing their own thunder.
- **The menu's weather stands still** (44): back on the menu, the island keeps the weather it was
  last shown in, while the game kept for two minutes behind it goes on turning; joining that game
  again switches to its weather at once.
  **Resolved** (2026-10-03): leaving a game notes its clock and the moment we left, and the menu
  shows that game's weather on that clock as it runs on, so rejoining it within the two minutes
  picks up where the menu has got to. A game joined after it closes, or in another mode, is a
  new one and can still differ (see below).
- **A new game can open in other weather than the menu's** (44): the menu's weather goes on along
  the clock of the game last left, but once that game closes (two minutes empty), or when another
  mode is picked, the game joined is a new one starting from its own clock, and the weather
  switches to its own at once.
  **Accepted** (2026-10-03): the user is fine with a new game switching to its own clock's weather.
- **Puddles in the sun after rain look pale** (45): once the ground has dried round them, the
  puddles left mirror a bright sky and read as light patches more than water.
  **Resolved** (2026-10-03): draining puddles faded out evenly instead of shrinking, and their
  ragged edge was wide enough that the last of the water never came fully in. Ground half covered
  by water went half glossy, and at a low angle that shows a bright sky as a milky haze. The
  ground under them was darkened only as much as the drying ground round them was. Now each puddle
  shrinks into its hollow with a narrow edge, so a spot is water or it isn't, and its rim stays
  dull until the water is nearly full. The ground under a puddle stays soaked and dark after the
  rest has dried. The yard-drying screenshot moved from three minutes to two minutes after the
  rain, where puddles are still left.
- **Nothing warns that the weather is clearing** (45): before rain or fog lifts, the clouds only
  brighten a little; the plan asked for warnings of rain and fog only.
  **Resolved** (2026-10-03): in the 75 s before it clears, the clouds turn 40% of the way to clear
  (from 15%), so the sky lightens and more sun gets through. Before rain stops, or turns to fog,
  it eases to 55% and the thunder dies away by the time the change starts. Before a fog goes, the
  air clears a quarter of the way, and before it clears the wind rises with the clouds. Unit tests
  check the signs; two new screenshots show the rain and the fog 5 s before they clear.
- **The mist lies by the ground at either end of a view** (2026-10-03): how high the mist stands is
  taken as changing evenly from the ground under the camera to the ground at what's seen, so a
  ridge or a hollow between the two doesn't count, only its ends.
  **Resolved** (2026-10-03): the mist's ground is also read at a fifth, two, three and four
  fifths of the way, per vertex as before; the points move with the vertex, so across a triangle
  they interpolate to the points along each pixel's way. The mist is integrated over each fifth
  on its own, so a ridge between the camera and what's seen thins it and a hollow thickens it.
  The vertex shader works out how much mist there is from the fog's near and far, as the
  fragment shader does, and reads nothing without any, as on a clear day. The views in the
  screenshot tests hardly change (they look down into the mist or along level ground); forcing
  the mist to the ground all along the way showed the new reads take effect. Alternated benchmark
  runs against the last commit: clear frames the same within the noise, rain and fog perhaps
  0.5 ms slower.
- **The mist ahead of a fog rides in the fog's near distance** (45): three.js sends a linear fog
  only its near and far, so the mist level is packed into the near distance's multiples of 4096
  m (`mistNear` in `fogbanks.ts`). Anything else that reads `scene.fog.near` gets the packed
  number; only the sea's underwater fog does, saving and restoring it whole.
  **Resolved** (2026-10-03): the mist ahead of a fog is a uniform of its own, `mistGathered`, set
  by `setMistAhead`. Like the mist's ground texture it's added to three.js's fog uniforms and
  shared by every fogged material, its vector cloning to itself, so `scene.fog.near` is the plain
  near distance again. The mist is no longer rounded to 255 steps. Under water the gathered mist
  now stays rather than going with the near distance, but the underwater fog is near enough to
  have all the mist anyway. The fog screenshots, the mist ahead of a fog among them, are unchanged.

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
- **Campers may wait where they can't see the extraction point** (18). A spot that can see into it
  from a crouch is preferred, but if none of 16 tries finds one, any dry spot 25–45 m off will do.
  **Resolved in part** (27): a camper first looks for a big bush 25 m out to the range that sees
  into the extraction point, then for any spot that does. A blind camp is looked at again every
  20 s, 10 m farther out each time up to 85 m, and swapped for a spot that sees. In the day
  playtest 19% of first camps were blind and 22 of those 50 later moved to one that could see; the
  rest ran out of range or time. Campers still settle for a blind spot while they look.
  **Resolved** (38): a camper waits only where it sees into the extraction point from a crouch.
  It looks for a big bush that does, then for any of 24 spots that does, out to 45 m, then
  again 10 m farther each time up to 85 m; finding none, it doesn't camp and heads out. In the
  bot playtest (6 islands × 20 min) no camp was given up for want of a spot by day (0 of 43)
  and 5 of 94 at night in rain.

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
- **The browser tests don't run in CI** (19). The deploy workflow still runs only Vitest. The
  tests want a GPU to draw the game at speed; on Linux Chromium is told to use OpenGL
  (`--use-angle=gl`), which hasn't been tried.
  **Left for later** (31): tried and set aside (see Decisions). In the Playwright Linux image,
  every choice of `--use-angle` (gl, vulkan, swiftshader, none) ends in SwiftShader, drawing in
  software, and GitHub's runners have no GPU. `E2E_GL=software npm run test:browser` shows it
  on the Mac: about 20 s to load the page and 45 s to 1.5 min a test with one worker (on the
  M3 Pro's cores), 10 minutes for the suite with four, and 7 tests failing on slow frames (the
  textures fading in, the death cam, resuming after Esc). On a 2-core runner the suite would
  take well over an hour a push. Linux would also need screenshots of its own, made on a
  matching machine; Docker here has 1 CPU and under 1 GB, too little to make them.
  **Moot** (2026-09-30): decided against; see "Browser tests stay local" in Decisions.
- **The screenshots come from one machine** (19): Chromium on an M3 Pro through Metal, at
  640 × 360, kept in `e2e/screenshots/darwin/`. With the tests local only (31), that's the
  machine they run on. Another machine makes its own on its first run (which reports each as a
  failure once), so they only catch changes on the machine that made them. A change to fewer
  than 1% of the pixels passes.
  **Resolved** (2026-09-30): accepted, as the browser tests run only on the developer's machine
  (see "Browser tests stay local" in Decisions).
- **The scripts' CI job hasn't run on GitHub yet** (20). `.github/workflows/scripts.yml` runs
  both scripts on Ubuntu when they or their lists change, and the unit tests on what they make.
  It was run as-is in a Linux x86-64 container (about 8 minutes under emulation), not on GitHub,
  since it isn't pushed. It downloads from Poly Haven, Freesound and poly.pizza every time, so
  a change or a rate limit there fails it. The transcoder's build script isn't in it (it needs
  Docker or Emscripten). Its run on GitHub was dropped from chunk 31 with the rest of CI; it
  still runs there if pushed.
  **Resolved** (2026-09-30): pushed with chunk 20, and it passed on GitHub.
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
  **Accepted** (2026-09-30): the browser tests now cover most of it: about 40 screenshot
  comparisons (island spots, every light and weather, lamps, soldiers and the pose viewer), two
  ragdoll tests (a body falling and the death cam replaying it the same) and four audio tests
  (sounds in on time, every shot starting on time, far fights going to the distant-battle bed,
  a sound's ringing coming back from its side), besides the unit tests of the sound code. What's
  left, animation checked in motion and the audio judged by ear, is fine as it is. Closed at the
  user's request.
- **The rivals bounty test is flaky** (31, found while timing the suite). "A rival with the
  bounty is marked..." failed 1 of 20 runs on the code before chunk 31, and 3 of 7 in two
  batches after it, though nothing chunk 31 changed touches it. At its last step, facing the dead
  rival's bag, no tag with the bag's $8,000 shows within 20 s. The bag may land out of sight, out
  of the tags' reach or behind something; not looked into.
  Seen again in chunk 34: it passed in one full run, then failed in the next and on its own,
  both with chunk 34's changes and without them.
  **Resolved** (2026-09-30): the tag was right to hide. The `rival` dev command put the rival 8 m
  ahead whatever was there, and about one run in ten its bag fell in grass thick enough to hide it
  (bag tags are hidden by grass and bushes since chunk 27), a little uphill of the player. It now
  takes the nearest spot round 8 m ahead where a bag would show from your eye across 1.5 m of
  ground, as the bot may walk a step before it's killed; the first fix, checking only the spot
  itself, still failed 3 runs in 40. After it the test passed 180 runs in a row (the only
  failures were the browser not starting under four workers).
- **The asset script's CI job can't download the models** (2026-09-30). On GitHub's runners,
  static.poly.pizza answered the soldier's download with 403, though the same URL downloads fine
  from a home connection, so its Cloudflare most likely turns away datacentre IPs.
  **Resolved** (2026-09-30): a User-Agent of the scripts' own didn't help, so the four source
  models (the soldier and three guns, 1.8 MB, public domain) are committed with their poly.pizza
  URLs noted, and `fetch-assets.mjs` reads them from there. The packed models came out byte for
  byte the same. Then every other original followed, so nothing depends on the sites staying up:
  the Poly Haven textures and sky, the animation library and the Freesound previews, 53 MB in all,
  in `scripts/originals`. The scripts download only what's missing there, and the browser test
  of the packed assets no longer skips without them.
- **The "draw" sound starts late in its bank** (43): the browser test that every shot
  starts on time failed on `draw`, loud only 63 ms in against the 45 ms allowed. It failed the
  same at `7120c80`, before chunk 43 touched the sounds.
  **Resolved** (2026-10-02): the cut started at a 5 ms click 10 ms before the slide's hit, just
  loud enough to set the start. Opus at 40 kbps smears the click below that, so decoded the sound
  only got loud at the hit. The cut now starts at 0.28 s in the recording, past the click, and
  the early bank was re-packed; the draw starts on the slide itself.
- **Boulders are smooth domes to rounds and sight** (2026-10-03, after rounds were stopped by
  the invisible top corners of a boulder's flat-topped collider): rays now meet an upright
  ellipsoid at 0.85 of the rock's width and height, but the drawn rock is a lumpy, flat-shaded
  ellipsoid whose corners sit at 0.8–1.15 of its size, so a lump can stand up to about 0.3 of
  its radius off the dome. A round skimming the very edge of a lump can still pass through it,
  or stop just short of a hollow. Walking into a boulder still meets the flat-topped post.
  **Resolved** (2026-10-03): the rock's lumpy shape is now built in `src/shared/rock.ts` from
  the island's seed, and both the renderer and the rays use it. Rounds and sight test its 80
  triangles, placed as drawn, once a ray reaches the sphere its corners lie within. Impacts
  take the normal of the face hit. Bot extraction on 12 clear islands stayed at 19% (20%
  before), and the playtest ran no slower.
- **A one-room building's table can leave bots no way in** (chunk 51): in an outpost or a hut,
  the table under the end window stands close enough to the open door leaf that the 1 m nav
  grid can find no cell between them, depending on how the building falls on the grid (found
  in the generated towns, where it hit 11 of about 400 rooms until their houses had the table
  moved). Fixing it moves props on Extraction's islands, so it was left as it is.
  **Resolved** (65): the door leaves were removed, and the table stays where it was. A test
  walks every building on islands 1–6 from outside and finds every spot on its floors reached;
  chunk 64's code left spots unreached in 7 of 66 buildings, two of them one-room houses.
- **The doors browser test can fail under load** (found in chunk 59): it wants a door swinging
  within 400 ms of pressing F, and once in a full parallel run it wasn't; alone and in three
  more parallel runs it passed. In chunk 63 it failed so in one of three full runs.
  **Moot** (65): the doors and the test went. The other stalls seen under load (the textures'
  and the death cam's tests) stay in Known Issues as "Browser tests can stall under load".
- **Bots can't search about one crate in ten inside buildings** (chunk 51): the search spot,
  1.4 m out from the crate, falls on no open cell of the nav grid when the crate stands in a
  corner close to a wall or partition: 10 of 102 crates in the outposts' and huts' buildings on
  islands 1–6. Players can search them.
  **Resolved** (66): where none of the ring 0.9 m out from the crate is open, its search spot is
  the place nearest it, tried every 10 cm, where a body fits on its floor in a cell bots walk,
  within the reach the server allows less a quarter metre, with nothing between the eyes and the
  crate. The other 92 crates' spots are as before. A test walks a body along the path from
  outside each building to every crate on islands 1–6 and finds it ends within reach.
- **Browser tests can stall under load** (found in chunk 63): in one of three full runs the
  textures' test timed out, passing alone; a dev server left running through a long session of
  edits made the death cam's test fail every time, until restarted. (The doors test that failed
  the same way went with the doors in chunk 65.)
  **Accepted** (2026-10-07): Worked round by running one suite at a time and restarting a long-lived dev server.
- **Island buildings still draw a number for each doorway** (chunk 65): the leaves were found
  open or shut from the buildings' stream, and dropping the draw would move everything placed
  after it on every island; so `addFacade` still draws it and throws it away.
  **Accepted** (2026-10-07): One throwaway draw keeps every island as it was; costs nothing.

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
  **Replaced** (2026-10-02): an outpost's guards are no longer replaced at their posts at all, but
  by ones running in from out of sight (see "Outpost reinforcements are untested by people").
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
- **Bots don't sneak through grass or bushes** (27). They hide in bushes only to take cover or to
  wait, never pick a route through cover, and rats don't hide on hearing a fight nearby.
  **Resolved** (38): a bot sneaking (near an outpost, closing in on a fight, or after seeing a
  guard) and a rat going about its run take routes through bushes and tall grass: the nav grid
  counts open ground as 1.7 times the walk (`BARE_COST`), a 1 m square counting as cover under a
  bush at least 0.8 m tall or with tufts adding up to 1.2 m of height (`Vegetation.cover`, about
  a fifth of the island's land). A rat hearing gunfire within 90 m lies low for 10–20 s (longer
  while the shots go on) in a bush that hides it from the fight, or out of its sight within
  25 m, then goes on. What's left is in PLAN.md's "Hidden routes keep little off open ground".
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
  **Accepted** (2026-09-30): the user is fine with it for now; the thorough playtest reads run
  length well enough until people play.
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
  **Accepted** (2026-09-30): the user is fine with it for now, with guards eased further since
  (slower to turn and settle, more aim error; see "Weaker guards, more exits and cover at them
  didn't raise extraction"). People playing will say if it's still too much.
- **Most of the listed tuning wasn't changed** (12): guard count, bot skill numbers, weapon damage
  and recoil, extraction timings and loot values. In the bot playtest the rifle and bolt-action
  came out even (about 210 and 190 points per run), as did light and heavy carrying, so there was
  nothing to fix there without human data. Only the operator cap and operator bot behaviour were
  tuned.
  **Accepted** (2026-09-30): the user is fine with it for now; tuned from human run logs when there
  are more.
- **The new buildings were tried by bots only** (23). Two bot playtests of 6 islands × 20 minutes
  each, before and after, came out the same: operator bots got out of 12% of runs before and
  12.5% after (13% → 11% on seeds 1–6, 11% → 14% on seeds 7–12), with the same kill rates. Over
  30 minutes of bot games bots opened 10 doors and broke 5 panes; no roof came down. Nothing
  was tuned, as nothing moved. Nobody has fought through the new buildings.
  Still (35): bots now go upstairs, up the watchtowers and through doors they shut behind them,
  and guards no longer look into a friend's door or broken panel (only their gunfire). Bot
  playtests of 6 islands × 20 minutes before and after the chunk: by day operator bots got out of
  9% of runs both times, with about the same kill rates; at night in rain 15% before and 13%
  after. The bots spent about 40 bot-minutes upstairs or on a tower in the two hours of day play.
  Nothing was tuned, and nobody has fought upstairs or up a tower against them.
  **Accepted** (2026-09-30): the user is fine with it for now; bot extraction sits at the baseline
  (see Decisions).
- **Bot stealth was tried by bots only** (27). Two 6-island × 30-minute bot playtests, by day and
  at night in rain: operator bots got out of 15% and 17% of runs (12% just before the chunk);
  rats 24% and 36%, hunters 6% and 9%. The playtest now prints how often bots take a bush for
  cover and to wait in, how far off their guesses at fights are and how often camps are blind
  (counted in `tally`, a module-level counter in `server/bot.ts`). Nobody has played against bots
  that hide in bushes, and whether they're too hard to find there is untested.
  Still (38): rats now also lie low when a fight breaks out nearby and sneak through bushes and
  tall grass, and operators get away from guards; tried by bots only. Since the flights count as
  cover taken, the playtest's share of cover taken in a bush fell from 33% to about 10–18%.
  **Accepted** (2026-09-30): the user is fine with it for now; bot extraction sits at the baseline
  (see Decisions).
- **The thorough playtest isn't a person** (29). Its bots can't be killed, play alone, don't
  notice being shot and never run dry, so it reads how long a full search and its fights take,
  not how often a person survives one. 13% of its runs still end stuck in a fight at 10:00.
  **Accepted** (2026-09-30): the user is fine with it for now; it's a tool for reading run length,
  not a stand-in for people.
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
  **Accepted** (2026-09-30): the user is fine with it for now; the fee stays at 2,000.
- **Outpost reinforcements are untested by people** (2026-10-02). An outpost's fallen guards are
  no longer replaced at their posts: each is replaced 60 s later by one that sets off 100–140 m
  away, out of every operator's reach and sight, and sprints back; once the last of an outpost's
  guards (sentry included, and a living commander counts) falls, all of them set off together
  after 15 s. Nobody has played it yet, so whether 15 s plus the run in (roughly 30–40 s in all)
  is the right rush is a guess. The starting point isn't checked for a way to the outpost, so on
  a rugged island a replacement could take a long way round. Patrols are still replaced at the
  start of their route. A bot playtest by day came out at 15% of operator bots extracting,
  against 14% just before (seeds 1–6), since bots rarely wipe out an outpost; night wasn't run.
  **Resolved** (2026-10-02): the developer played it and liked it: staying too long in a cleared
  outpost means fighting the replacements coming in, which is the rush it was meant to add. The
  15 s delay stays, and the unchecked way in was accepted as it is.
- **Nobody has played against the weather-wise bots yet** (46): chunk 46's human pass was to
  come, to see whether a tester notices the bots playing the weather and uses the weather turning
  themselves.
  **Resolved** (2026-10-03): the developer played it; how the bots use the weather was hard to
  judge in play but looked fine, and they accepted it.
- **Bots only read the signs of fog** (46): a rat lay low for fog it saw coming, but no bot acted
  on rain or clearing seen coming, such as a hunter setting out as the thunder rolls or a rat
  hurrying to get out before a fog lifts.
  **Resolved** (2026-10-03): bots are given the next change as its signs show it, up to 75 s
  ahead. A hunter stays on 120 s longer to hunt while rain is coming or in, and turns back from
  heading out to do so; a rat or a looter seeing a fog lift gives up the crate it took on for
  the fog, unless within 30 m of it, and gets on with its run. In the bot playtest (seeds 1–6)
  68 of 86 fog crates were given up as the fog lifted, and operator bots extracted from 15% of
  runs. Campers need no signs: they move with sight as it changes.
- **Bot extraction at the top of its range** (49): the bot playtest over the weather cycle came
  to 18% extracted on seeds 1–6 and 19% on seeds 7–12, against the 15% ± 3 baseline. The commit
  before chunk 49 gave 18% and 20% on the same seeds, so solid walls didn't move it; it drifted
  up before (chunk 46 measured 15%).
  **Accepted** (2026-10-03): the user is fine with it.
### Scoreboard
- **Records kept by name** (47): the server kept each player's line under the name typed on the
  menu, so two players with the same name shared one line, and anyone could carry on another's
  record by taking their name.
  **Resolved** (2026-10-03): each browser makes a random id once, keeps it (`playerId` in local
  storage, or for the page alone with storage blocked) and sends it in every hello; the server
  keeps records by it, so a renamed player keeps their line and two of the same name get one
  each. The id is never sent to other players, so it can't be read off the board. A hello with no
  id, or a malformed one, gets a record for that run alone. It isn't checked by anything, so it
  stands in for the anonymous identity in Future until then.
- **Records last only as long as the game** (47): the cumulative score is over one game on one
  island; back on the menu for more than 2 minutes (the game closes) or playing another island
  starts everyone afresh, and nothing is kept in the browser.
  **Accepted** (2026-10-03): the user is fine with it.
- **Only ever you, locally** (47): without a multiplayer server the board lists one line; several
  players in one game are covered by unit tests only, not seen on screen.
  **Accepted** (2026-10-03): the user is fine with it for now.

### Deathmatch
- **Kills while you watch your death cam go unseen** (48): the client sets aside the game's events
  while a death cam plays, so those kills miss the feed, and their bodies lie down after a short
  wait instead of falling from the round that killed them.
  **Accepted** (2026-10-03): the user is fine with it.
- **A respawn can be in someone's sight** (48): the spot was the farthest from the living of 24
  tried at random, with no check of who could see it.
  **Resolved** (2026-10-03): `arenaPoint` tries up to 64 spots and takes only those with no living
  operator within 80 m or seeing it from within 200 m, the farthest of up to 8 such; only with
  none does it fall back to the farthest of all. In three 10-minute games of 20 bots, 549
  respawns all found a clear spot, the nearest operator 87 m away at the least, and none in sight.
  Checked by `test/deathmatch.test.ts`.
- **Bots leave the board when a player takes their slot** (48): their kills and deaths go with
  them, so the totals on Tab don't add up over a game.
  **Accepted** (2026-10-03): the user is fine with it.
- **Untuned by people** (48). Only bots have played it. Ten-minute headless games of 20 bots
  on islands 1–3 (2026-10-03, `npm run sim:deathmatch -- 600 1,2,3`): 13–17 kills a minute, a median life of 54–74 s, the median bot
  6–8 kills and the best 16–19, 3–5 deaths a game within 15 s of spawning, nobody ever out of
  ammo, and bots searching crates 3–5% of the time. How it feels, and whether 20 is the right
  count, wait for the user's own playtest. Deathmatch games aren't in the run log or the stats page.
  **Accepted** (2026-10-03): the user finds the numbers about right, and will playtest it.
- **Roads are only painted** (chunk 50): dirt on the terrain's 4 m grid, so their edges are
  ragged and they follow every bump of the ground, with no cutting or levelling across a slope.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **Less cover in Deathmatch's streets until chunk 52** (chunk 50): the outposts' crates,
  containers and walls went with them. **Resolved in part** (chunk 51): the towns have their
  buildings, garden walls and 15–34 loot crates each, more than the outposts had, and
  `sim:deathmatch` is back near the outposts' kills; but the streets, the square and the green are
  bare, long open lanes, until chunk 52's street cover.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **Most town buildings have no light grid** (chunk 51): the indoor light keeps grids for 16
  buildings (`MAX_BUILDINGS`, its 3D texture's depth and the shaders' uniform arrays), the first
  16 built, so rooms in the other 40-odd town buildings are lit as if outdoors; and in the old
  town a building's light volume can reach over its neighbour's, whose cells on the island map
  it takes. Chunk 53's benchmark and cold load are to settle how many grids the towns can have.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **A bot's path to a spot it can't reach costs up to 140 ms in a town** (chunk 51): A* runs its
  30,000 expansions, and among a town's upper floors and terraces each costs more. In
  `sim:deathmatch`, about two server ticks in ten minutes take over 20 ms, one (seed 1) 140 ms;
  the mean tick costs half as much again as on the bare sites. For chunk 53, with the bots in
  the towns.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **Warehouses are big two-room houses** (chunk 51): the harbour's warehouses use the two-room
  plan at 15–19 × 9.5–11 m, the same 3 m storey, doors and windows as a house, not a tall shed
  with wide doors.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **Roads run on into the towns as paint** (chunk 50, 51): a road still runs to its town's
  middle, painted over yards and under houses, and doesn't meet a street at the town's edge.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **The terraces' retaining walls are 4 m deep** (chunk 51): each is a block over the whole
  terrain cell the ground ramps in, so its top is a plain concrete strip 4 m wide along the
  terrace's edge, and terraces step only 1.6 m, so the ramps where streets cross stay walkable
  for bots.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **The harbour's basin is cut straight** (chunk 51): the sea off the quay is 3.5 m deep in a
  straight line along it whatever the coast did, sloping back to the shore beyond the site, so it
  can read as a dug dock; someone who falls in can't climb back up the quay and wades to where
  the basin's side slopes up.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **Houses built against each other keep their end windows** (chunk 51): in the old town and the
  harbour, the window at a house's end can look straight into its neighbour's wall.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **The yards' grass is coarse** (chunk 51): the ground is painted on the terrain's 4 m grid, so
  a yard's grass only shows where a grid point falls in it, and spills a little under walls.
  **Moot** (2026-10-03): the generated towns were dropped for a fixed, hand-made map (Phase 8);
  chunk 52 removes their code.
- **The test street is far too small for 16** (chunk 52): at 56 × 36 m no spawn point is ever
  80 m from everyone or out of their sight, so a respawn takes the farthest and is shot at
  once: in `sim:deathmatch` 409 of 416 deaths came within 15 s of spawning (324 of 360 with
  chunk 53's five buildings).
  **Resolved** (54): Deathmatch is played in the town, 136 × 111 m with 32 spawn points, and on a
  map a respawn wants nobody within 30 m and nobody seeing it, then takes the farthest that
  nobody sees. In three 10-minute games of 16 bots none spawned in anyone's sight, and 30–37% of
  deaths came within 15 s of spawning (see Respawns are still often near a fight in the plan).
- **A map's edge is an invisible wall** (chunk 52): players are held inside its bounds, and the
  nav grid ends there.
  **Resolved** (54): the town's bounds stand a body's width inside its edge walls, its high
  street's houses' backs and its sea wall, so walking into the edge meets a wall. What's left,
  the sea wall low enough to try to climb, is in the plan.
- **Walls are shared only where storeys line up** (chunk 53): the kit merges walls along a line
  storey by storey, so two blocks side by side whose floors differ each build their own wall on
  the line they share.
  **Moot** (54): every row of the town's houses stands on one level, so the floors of houses side
  by side always line up. The kit still works that way, should a map ever need it.
- **The town is a grid** (chunk 54): its four cross streets run straight across it, 136 m, and
  the lanes straight up it, so views across are as long as views down, against the plan's
  short ones across; the high street's three-storey roofs look down over the whole town; and
  its houses are all one template, so nowhere looks different.
  **Resolved** (57): the town was rebuilt from its sketch round the market, the piazza and the
  palazzo's courtyard, with districts that climb, play and look different (each its own
  plaster, its buildings made by hand), and streets that bend, tee or meet a building.
- **Only stairs join the levels, no ramps** (chunk 54).
  **Resolved** (57): the road climbs from the quay to the palazzo in three legs, the kit's
  ramps, besides the stairs.
- **The church and its tower are stand-ins** (chunk 54): a single 3 m storey, and the bell tower
  a solid box.
  **Resolved** (57): the church is one storey 6 m tall under a pitched roof, entered by three
  doors. The bell tower stays solid, as the sketch has it, nobody climbing it; its look is
  chunk 59's.
- **Bots can stall behind an open door leaf** (chunk 54): `sim:deathmatch` found one bot in three
  10-minute games standing 30 s in a doorway's corner, beside the jamb where the open leaf
  stands, going nowhere.
  **Resolved** (57): its path started at the nearest open cell, often the doorway through the
  leaf, which the path left out, so the bot walked straight at the leaf. A bot somewhere no
  path goes now starts from the nearest spot it walks to in a straight line, and walks to it
  first; and the town's doors are kept from opening into slots by a corner, a flight's foot or
  a crate, checked by a test. Six 10-minute games found nobody stuck.
- **Bots don't go up onto roofs** (chunk 52), **resolved in part** (chunk 53): the kit's roofs,
  upper floors, inside stairs and hatches are floors to the nav grid, and a bot following a
  noise or a sighting paths to its height, so it can come up after someone. But nothing sends
  bots up of their own accord: they roam to spots on the ground. In the town `sim:deathmatch`
  had them on the ground 92–96% of the time, upstairs 4–7% and on the roofs 1% (chunk 57).
  Left for the flow (chunk 58).
  **Resolved** (58): on a map, a bot closing in on a fight watches it half the time from a
  window or a roof's edge that sees it, a hunter roams to one within 50 m 40% of the time, and a
  bot flanking a lost target goes up to one half the time; they're found from the world's
  windows and walked roofs (`src/server/vantage.ts`). In six 10-minute games bots were upstairs
  10–15% of the time and on the roofs 3–5%, and 5–12% of kills came from windows and roofs.
- **The town's dressing isn't measured for speed** (chunk 59): 11,300 boxes (136,000 triangles)
  and 41,000 triangles of shapes, all casting shadows, drawn as two meshes; and four new
  programs to compile on a cold load (the dressing's two, the paved terrain, the roofs' tiles).
  **Resolved** (chunk 64): `npm run bench` measures the town too, at seven of the screenshots'
  spots, with nobody about and with 16 soldiers, and reports the GPU's and the CPU's share. The
  dressing is drawn in 32 m tiles, its fine detail only in the near shadows, and with the
  trees' and the reflection's cuts the town's frame with 16 soldiers holds the island's with
  24 (see the open item on its empty frame). A cold first load of the town takes as long as the
  island's, about 12 s on an M3 Pro, and a warm one 0.9 s.
- **The dev view of a test map can't be played** (chunk 56): `?map=kit-yard` builds the client's
  world from the test map behind the menu, but a game started from it is played on the mode's
  own world by the server, so nothing matches.
  **Resolved** (66): the test map's name goes to the local host in the hello, in development
  only (`maps/dev.ts`), and a game started from it is a Deathmatch on that map, whatever mode
  was picked; production builds leave the test maps out. A browser test starts one on the kit
  yard and comes in at one of its spawn points.
- **The new map is a maze of plain boxes** (chunk 67): its blocks are flat-topped stone 6 m over
  the ground beside them, the same texture all over, until its look (chunk 68).
  **Resolved** (68): the blocks are plastered a colour for each part of the map and dressed in
  stone as houses (`client/blocks.ts`: plinths, cornices, quoins, lintels over the tunnels and
  doorways, shuttered windows high up, caps on the low walls); the ground is cobbled, flagged or
  earth by place and worn along the ways; the tunnels are lit by lanterns; the doors are wood.
- **The new map's heights and joins are read off a picture** (chunk 67): the heights came from
  the overview's shading, put in four steps, not the original's own; its slanted walls were
  squared to whole metres; where the shading was unclear (the defenders' end beside short), a
  wide flight was guessed from the defenders' end up to short and A, which wasn't how the
  original joins them, and there was no way under the walk to A; the map was 86 m a side.
  **Resolved** (2026-10-07, chunk 67 redone at the user's word that it was far from the
  original): the layout is made from the original's navigation mesh, every floor at its own
  height, at 2.54 cm a unit (114 m a side); see `scripts/calabianca.mjs`.
- **The new map's slopes are steps** (chunk 67, redone): the floors were boxes on 25 cm steps,
  as the game's ramps are, so the original's slopes (long A, mid, the T ramp) were flights of
  25 cm steps, their edges seen as lines across the ground, and its houses' tops stepped from
  cell to cell.
  **Resolved** (2026-10-07, at the user's word that the roads and houses were stepped): boxes
  can have a sloping top (`Box.tilt`); the floors are planes fitted to the original's ground,
  drawn as one surface; stairs only where it's as steep as stairs; the houses one height to an
  8 m plot.
- **The heat map counts a room fought through as a window held** (chunk 58): kills from upstairs
  are summed by the building's storey or roof, so the quay house's upper floor, a way from the
  market down to the quay, tops the list every game (1–5% of kills, from 4–10 m) as if held from
  a window; only the median range tells them apart. Where a window sees far shows only as the
  lines of kills from 40 m.
  **Accepted** (2026-10-07): A dev tool's reading; the median range already tells them apart.
- **The yard where the quay steps come up by the hotel is the busiest place** (chunk 58): the
  steps, Via del Porto, the road's hairpin and the hotel's way through meet there, and a cart and
  a crate didn't move it off the top of the list, at 2–3% of kills. No place has more than 3%.
  **Accepted** (2026-10-07): No place is over the 3% asked.
- **The kit trusts its map** (chunk 53): blocks that overlap, openings running past a wall's
  end or into a corner, and flights of stairs with no room at their foot or top are built as
  given; only the test that walks a bot's path into every room finds them, and anywhere bots
  can't reach; crates standing in a narrow gap were found and moved by hand (chunk 57). The
  door leaves' slots (chunk 57) went with the doors (chunk 65).
  **Accepted** (2026-10-07): The test that walks into every room catches what matters.
- **Pitched roofs collide as steps** (chunk 56): each is layers 0.6–1.2 m high stepping in
  toward the ridge under the slopes drawn over it, so a round can stop up to half a layer off
  the drawn slope, either way. Nobody walks up them or mantles onto them, but a jump (1.4 m at
  its height) carries a player up a layer where one can be reached, and someone dropping onto
  one from higher stands on it. The town keeps pitched roofs out of reach by placing them.
  **Accepted** (2026-10-07): The town keeps them out of reach.
- **Joined pitched roofs aren't mitred** (chunk 56): each block's roof is its own, so two
  pitched blocks of an L or round a courtyard cross each other's slopes and gables at the
  corner instead of meeting in a valley or a hip.
  **Accepted** (2026-10-07): Old town only; seen from below at most.
- **A wall between two buildings is plastered as one of them** (chunk 56): a shared wall is
  one box, so it takes the colour of whichever building's stretch comes first along it, on
  both faces.
  **Accepted** (2026-10-07): Old town only, and rare.
- **A courtyard's rooms are joined only at its corners** (chunk 56): the kit cuts a 2.4 m
  archway at each of its four inside corners on every storey, whether wanted or not, and no
  other way between its ranges unless the map adds one; an arcade is only on a ground storey,
  its bays all one width.
  **Accepted** (2026-10-07): How the kit builds; maps add more ways where wanted.
- **Bots don't fit through a doorway or arch under 2.4 m centred on a whole metre** (chunk 56):
  the nav grid's cells are 1 m with 0.55 m kept clear round a body, so a 2 m arch at x = 0 has
  no cell open in it, though a player walks through. A 2.2 m door has a cell open in it only
  where it's centred on a whole metre, as the maps have them so far; the kit's corner
  archways are 2.4 m for it.
  **Accepted** (2026-10-07): The maps are built to it.
- **The sea is hidden from the attackers' end but toward the horizon** (chunk 67, redone): the
  parapet stands 1.1 m over the floor behind it, a body's eye 1.6, so from a spawn the near sea
  is under it and only the far sea shows over it.
  **Accepted** (2026-10-07): The far sea shows; lowering the parapet changes cover.
- **A sloping box is drawn sheared** (2026-10-07): a box with a sloping top (`Box.tilt`) is
  drawn by shearing its instance, which tilts its sides' and top's normals wrongly; the map's
  sloping floors' tops aren't drawn as boxes (the ground surface is), so it shows only on their
  sides, a few centimetres high.
  **Accepted** (2026-10-07): It shows only on a few centimetres of floor sides.
- **The new map's doors were read off the overview by eye** (chunk 67, redone): the original's
  leaves stand open, and the mesh keeps off them, so the floor is carried over where they swing
  (0.6 m round each leaf as drawn on the overview) and our fixed leaves are set across each
  doorway's narrowest part, measured along the line between its hinges, with a 1.6 m gap. Small
  nubs of wall are left where a leaf met its frame.
  **Accepted** (2026-10-07): The leaves are fixed and the gaps measured; only their angle is by eye.
- **Only five of the original's boxes are crates** (chunk 67, redone): a box top the mesh walks
  on, 0.75 m over the floor round it at least, square and 0.9–1.7 m a side, is a crate; the rest
  (larger, oblong, stacked) are stone, walked on. Bots resupply at the five.
  **Accepted** (2026-10-07): By the rule chosen; more crates is tuning for chunk 70.
- **Crates stand on the floors only on a map of blocks** (chunk 67, redone): a map's crates
  used to be set on the terrain under any terrace, so two of the old town's are buried 0.7–1.9 m
  in theirs; on the new map they stand on the floor (`World.buildMap`), but the old town is
  left as it was, as setting them on its terraces leaves spots bots can't reach, until it goes
  in chunk 69. Likewise `lootCrates` counts a crate on a walked floor as loot only on a map
  without buildings.
  **Accepted** (2026-10-07): The old town is kept as it was on purpose while both maps are played.
- **The new map's windows are blind** (chunk 68): its houses are solid blocks, so their windows
  are drawn with their shutters shut, and nothing is behind them; no shutters stand open, no
  signs are put up, as the plan asked for few.
  **Accepted** (2026-10-07): As the plan asked: few shutters, no signs.
- **The new map's cold load is half a second over the island's** (chunk 68): 13.0–13.4 s
  against 12.7–13.0 on an M3 Pro, as at chunk 67, so not its look's; chunk 70 measures again.
  **Accepted** (2026-10-07): Or fold it into chunk 70's measuring; 0.3–0.4 s.
- **Production builds carry the old town until it's removed** (chunk 67): the server worker
  imports the dev test maps for `?map`, and the old Calabianca works its ground out as its
  module loads, so a build can't leave it out as it does the kit yard; it was in the worker
  before too, as Deathmatch's map. Chunk 69 removes it. Since 2026-10-07 it's played again, as
  Calabianca DM, so the client carries it too, until the user picks one map.
  **Accepted** (2026-10-07): Both maps are played now, so the build needs it.
- **The edge can be met on top of a wall** (chunk 54): the bounds stand a body's width inside the
  edge walls, the houses' backs and the sea wall, so walking into them meets the wall itself;
  but the sea wall is low enough to mantle, and a player trying to climb onto it is held back
  by the bound, not the wall.
  **Resolved** (2026-10-07): a mantle doesn't start onto a ledge past the bounds (`startMantle`
  in sim.ts), so a player trying to climb the sea wall is held at its foot by the wall itself; a
  test walks one into it. Letting players onto the wall's top instead, by moving the bound to
  its middle, was tried and dropped: the roofs whose backs stand on the sea wall could then be
  walked off onto it, and the warehouse's onto a ledge outside the town.
- **The plinth steps up the ramps** (chunk 68): along a block beside a ramp it's cut every
  25 cm at the ground's height there, a stair of stone rather than a slope.
  **Resolved** (2f348b5, checked 2026-10-07): the plinth is laid a metre at a time, each piece
  tilted to the ground under it (`blocks.ts`), and left out where the ground steps; the
  `calabianca-mid` screenshot shows it running straight down the sloping road.
- **The new map is made from another game's navigation mesh** (chunk 67, redone 2026-10-07):
  its floors and heights come from Dust 2's mesh as the analysis library awpy (MIT) publishes it
  for its tests, fetched by `scripts/calabianca.mjs` from a pinned commit and not committed
  here; only the boxes made from it are. The layout is followed exactly, as the plan asks; none
  of the original's textures, models or name are used. Whether following a layout this closely
  is fine for a released game is a licensing question left open.
  **Accepted** (2026-10-07): at the user's word, ignored for now; the map will be changed a
  little from the original later.

### Team Deathmatch
- **A game never ends** (Team Deathmatch, 2026-10-07): there's no score to reach, round or
  clock, as in Deathmatch; the sides' scores run on until the last player leaves.
  **Accepted** (2026-10-07): at the user's word it's fine as it is.
- **Sides aren't told apart by their look** (Team Deathmatch, 2026-10-07): both sides wore the
  same soldiers; only the marker over a friend said who's who.
  **Resolved** (2026-10-07): at the user's word Blue, at CT spawn, wear the operators' SWAT
  officers and Red the guards' soldiers in helmets (the body drawn as the side's team). The
  sides' ids alternate, so a body's avatar is picked by half its id, or every Blue would wear the
  same one of the two officers.

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
  **Moot** (2026-10-03): Offline was removed. It played the same as Online and still would with a
  multiplayer server, so there is one mode for runs; old `mode=offline` links open Online, and
  Offline's scores were folded into Online's board.
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
- **Operator bots still die in most runs** (12). Over 6 islands × 30 min, 19% of their runs
  extract (up from 8%), 81% are killed, and guards do about two thirds of the killing, mostly
  sentries and outpost guards at 40–120 m. Making guards weaker helped bots but would also make
  PvE easier for humans, so guards were left alone until humans have played.
  Still true after chunk 29 (see Rivals): 84% of their runs end in death by day, 82% at night in
  rain.
  **Resolved in part** (38): operator bots survive more runs, with the guards, the fee and
  extraction as they were. Shot at by someone they'd rather not fight (a guard past 40 m, anyone
  for a rat), or by two at once, or by anyone once below 40% health, they duck out of sight at
  once; from guards, and when outgunned, they get 40–70 m away, out of sight if they can, and
  start no fights for 20 s. Their cover must hide them from everyone lately seen or shooting,
  not only one, and cover that turns out to show them (they can see the enemy from it, or are
  still running for it after 2 s) is fought from instead of waited in, which before got them
  shot without firing back. They keep low for 10 s after seeing a guard within 110 m, a guard
  shooting at them from any range spoils the crates near it as a hit did, they crouch more in a
  fight, and heading out with enough to pay they start no fights but a hunter's. In bot
  playtests of 6 islands × 20 min: by day 13% of runs extracted (9% before) on seeds 1–6 and 13%
  (10%) on seeds 7–12; at night in rain 18% (15%) and 18% (17%). Guards kill 65–77 operators an
  hour by day instead of 123–126. Most runs still end in death, and the night gain is thin.
  Tried and left out, as they did worse: starting fights with guards only within 15 m, no fights
  at all once able to pay, counting enemies in sight as outgunning before they fire, escaping
  through bushes and grass, and the nearest escape rather than the farthest.
  **Resolved** (2026-09-30): operator bots extract from about 15% of runs by day and 20% at night
  in rain, which the user set as the baseline (15% ± 3, see Decisions). Most runs still end in
  death, as a raid should.
- **Hidden routes keep little off open ground** (38). Bushes and tall grass cover about a fifth of
  the island's land in patches, and open ground costs only 1.7 times the walk, so a sneaking bot's
  route crosses about 15% less open ground than a plain one, for 3% more walking. At 2.5 times
  it crossed 22% less for 9% more, but operator bots got out of fewer runs (11% and 16% against
  13% and 18% on seeds 1–6, and 13% and 16% against 13% and 18% on seeds 7–12). The search is
  weighted A* (1.4), so it doesn't always find the most covered way.
  **Accepted** (2026-09-30): operator bots extract from about 15% of runs by day and 20% at night
  in rain, which the user set as the baseline (15% ± 3, see Decisions); stronger weights for open
  ground cost extraction, so the routes stay as they are.
- **The outskirts' extra cover didn't help bots** (38, after the chunk). At the user's request,
  each outpost's outskirts (45–130 m out, `OUTSKIRTS` in `world.ts`) got 14 boulder clusters of
  2–4 crouch-high boulders (about 240 more rocks an island, from their own random stream so
  nothing else moved), 2.5 times the bushes and grass up to 1.7 times as tall. Ground there that
  hides someone crouched went from 20% to 46%. In bot playtests (6 islands × 20 min) operator
  bots came out as before within the noise: 11% and 14% by day (13% and 13%), 19% and 16% at
  night in rain (18% and 18%): the cover hides guards from them as much, and they walk upright
  through most of it. Making them sneak across the whole outskirts cut guard kills by about a
  fifth but lengthened runs by a minute, with extraction the same, so it was left out. Kept for
  people, who pick their cover; nobody has played it yet. The benchmark's frame time didn't
  move. Every island's outskirts changed, so scores and links from before were set on slightly
  different ground.
  **Accepted** (2026-09-30): operator bots extract from about 15% of runs by day and 20% at night
  in rain, which the user set as the baseline (15% ± 3, see Decisions). The cover stays for people.
- **Weaker guards, more exits and cover at them didn't raise extraction** (38, after the chunk).
  At the user's request, guards turn and settle 25% slower, trail a moving target a third longer
  and start 1.6 times an operator's aim error (was 1.3; `guardSkill` in `skill.ts`); islands have
  six extraction points, one per outpost (was four; the first four didn't move, and a name
  already taken goes to the next nearest compass direction); and each point has five pieces of
  cover 9–14 m out: low breakable walls and rows of boulders, from their own random stream.
  Bot playtests (6 islands × 30 min, day, seeds 1–6): 12% of operator bot runs extracted before,
  11% with the slower aim alone, 9% with the larger error too, 12% with six points, and 11% with
  the cover as well. Guard kills of operators fell from 75 to 65 an hour, but more operators got
  past the guards and killed each other (89 to 100 an hour). Most bots die fighting long before
  they head out, so neither the exits nor the guards' aim are what limits extraction. The first
  cover tried was crate stacks, which put about seven loot crates by every exit (every crate on
  the ground is a loot crate, see `lootCrates`) and sent extraction to 28% with runs a minute
  shorter; boulders replaced them. Kept for people; nobody has played it yet. Every island has
  changed, so scores and links from before were set on slightly different ground.
  **Accepted** (2026-09-30): kept as they are; with bots holding back once carrying loot ("Most
  bots die with nothing to lose"), operator bots extract from about 15% of runs by day and 20% at
  night in rain, which the user set as the baseline (15% ± 3, see Decisions).
- **Most bots die with nothing to lose** (38, after the chunk). At the user's request, operator
  bots carrying loot worth 500 or more (`LOADED` in `bot.ts`), hunters excepted, now start no
  fights beyond touch range, whatever they're doing; before, only one heading out with the fee
  held back. Tried first: holding back only once carrying the fee (12% and 13% extracted, against
  11%), since few bots reach it. With 500, operator bots extract from 15% of runs by day (11%)
  and 20% at night in rain (19%) on seeds 1–6, 6 islands × 30 min; operator kills of operators
  fell from 100 to 89 an hour by day, and at night, when guards do most of the killing, hardly
  changed. The playtest now shows what killed bots carried: 45% had nothing, so it can't help
  them. Bots carrying loot now make easy targets for a person, since they won't start a fight;
  nobody has played against it yet.
  **Accepted** (2026-09-30): the user is fine with bots dying before they find anything; operator
  bots extract from about 15% of runs by day and 20% at night in rain, which the user set as the
  baseline (15% ± 3, see Decisions).
- **Operators getting away are often shot in the back** (38). Fleeing 40–70 m from guards is now
  the commonest way for an operator bot to die at a guard's hands: in a 4-island × 10-minute
  diagnostic, 23 of 51 guard kills were on the way. They sprint in the open without firing back
  until someone is within 20 m.
  **Accepted** (2026-09-30): operator bots extract from about 15% of runs by day and 20% at night
  in rain, which the user set as the baseline (15% ± 3, see Decisions), so their getaways are left
  as they are.
- **Bots see through tree crowns as smooth cones** (2026-10-03, bots seeing through trees). Each
  crown is a cone of needles, densest at the trunk, rather than the limbs and gaps actually drawn,
  and doesn't sway with the wind. Bots also don't seek out trees to hide in, as they do bushes. Day
  extraction moved from 14% to 17% in the bot playtest (seeds 1–6, clear).
  **Accepted** (2026-10-03): the user accepted it as it is, and the 17% rate with it.

### Deathmatch
- **Ramps are drawn as steps** (56): a ramp is steps of up to 0.25 m drawn as a stair's, 1–2 m
  deep each; a smooth slope drawn over them was left for the town's look (chunk 59).
  **Dropped** (chunk 59): the road's legs are kept as a stepped street, a *cordonata*, as these
  towns have, cobbled on top and stone at each step's face. A slope drawn over the steps would
  leave feet floating or sunk by up to 12 cm along it.
- **Most of the town's houses are lit as outdoors inside** (54): the indoor light keeps 16
  buildings' grids, and the town has 41.
  **Resolved** (60): a map's town has a light of its own, baked over all of it at load
  (`townbake.ts`, `townlight.ts`), indoors and out, and the indoor light keeps no grids there.
  Every room is darker than the street, lit from its windows and doors.
- **Three buildings meeting light one of them as outdoors** (53): a 2 m cell of the island map
  points to two buildings' light grids at most, enough for two sharing a wall; where a third
  meets them, its rooms in that cell are lit as if outdoors.
  **Moot** (60): only the town has buildings meeting so, and it no longer uses the buildings'
  grids; the islands' outposts and huts stand apart.

- **Bots at a window stand in it** (58): a post was watched standing, never ducking between looks.
  **Resolved in part** (2026-10-07): a bot at a post ducks below the sill for the last second
  before each new look; changing window after firing stays open in Known Issues.

- **Bots at a window don't change window after firing** (58, the rest of the one above): a bot
  held its post after firing from it until its wait was up.
  **Resolved** (2026-10-07): a hunter that fought while standing at its post gives it up
  (`postFired`) and roams to another when the fight's over.

- **A spawn zone's points see each other** (57): the town's spawn points stand four to a zone, so
  one operator in a zone spoils all four; as a game starts, with 15 bots over the eight zones,
  nearly every point is seen, and a player joining then can come in seen.
  **Accepted** (2026-10-07): it matters only to a human joining the instant a game starts; later
  respawns have fewer operators about, and the picker already takes the farthest unseen point.
  Starting bots two or three to a zone, or holding zones back for joins, would leave a zone free
  but change the opening for everyone.

- **Cables and washing lines cross each other** (62, part of "strung by a straight look"): lines
  were strung from random anchors to whatever wall a level ray met, so two could cross.
  **Resolved** (2026-10-07): `Life.string` skips a line that crosses one already strung
  within half a metre of its height; lines to blank walls and the lack of sway stay in Known Issues.

- **Washing lines run to blank walls; nothing sways** (62, the rest of "strung by a straight look"):
  a line was strung from beside a window to whatever wall a level ray met.
  **Resolved** (2026-10-07): a washing line now ends only at a hook beside a window on the wall
  facing it, within 1.5 m of where its ray met the wall (`Life.hookNear`), at the same height, or
  isn't strung. **Accepted**: nothing sways, as the lines and clothes are static geometry merged
  into the town's tiles; animating them would take a wind shader on every one for little to see.

- **Balconies' railings are drawn as iron but collide as plaster** (62): rounds stopped at the
  whole railing and bots couldn't see through it, though it's drawn as bars.
  **Resolved** (2026-10-07): each railing is three boxes, a solid foot (12 cm) and top rail (6 cm)
  and the bars between, flagged `open` (`Box.open`): bodies still stop at it, but rounds and
  sight (`raycast`, `collidersAlong`) pass through, so legs behind a railing can be shot and seen.

- **Downpipes run through cornices and string courses** (62, part of "Things drawn on the walls
  are walked through"): **Resolved** (2026-10-07, found already so): a downpipe stands `PIPE_OFF`
  0.17 m off its wall with a 0.05 m radius, so its inner face is 0.12 m out, as far as a
  cornice (0.12 m) or any string course (0.04 m) stands; it touches the cornice and doesn't
  cross it. The rest of that issue, things on the walls that don't collide, stays open.

- **Every mode loads the town's textures** (59): the town's six layers were stacked into the
  same arrays as the island's, 2.12 MB against 1.35 MB, transcoded on every first visit though
  only Deathmatch used them. **Resolved** (2026-10-07): the town's layers come last, so
  `fetch-assets.mjs` also writes `color-island.ktx2` and `normal-island.ktx2` (the first
  `ISLAND_LAYERS` = 10 layers, 1.37 MB together); `loadAssets` loads those unless it's a map,
  which loads the full arrays as before (the loading bar's `swap` swaps its expected sizes).
  The layer indices don't change, and the full files came out byte for byte as before.

- **Things drawn on the walls are walked through** (62): window surrounds 8 cm proud, air
  conditioners, lanterns, aerials, dishes and the signs standing out don't collide.
  **Accepted** (2026-10-07): they're placed by client-only dressing code, so colliding would mean
  moving the placement into shared code (and re-baselining the bots' nav), for little: a body
  sinks 8 cm into a surround, lanterns hang above head height, air conditioners sit beside
  upper windows, and an aerial's mast is 3.6 cm thick. (Downpipes were already clear.)

- **The town's dressing is only drawn** (59), and **its pots and plants are walked through** (63):
  shutters, window boxes, creepers, awnings, stall canopies, the trees' crowns, pots, lemon trees,
  agaves, the obelisk and the crosses neither stop rounds nor hide anyone from bots.
  **Accepted** (2026-10-07), as the island's bushes are: nothing that's drawn to hide behind
  hides anyone, so cover is only what collides, and a player can't be shot through a plant or
  die to something they can't see. Making them solid would also need their placement moved into
  shared code (see "Things drawn on the walls are walked through").

- **Picking Deathmatch on the menu reloads the page (50)**: **Accepted** (2026-10-07): the reload takes a second on a warm cache and happens only when switching into or out of Deathmatch; building a world in place would mean rebuilding the view, bodies, sound and HUDs for it.

- **The town's baked light doesn't change (60)**: **Accepted** (2026-10-07): a broken window or a stack of crates changing the light is invisible at the half-metre cells it's baked in, and rebaking mid-game would cost seconds of a worker.

- **Rounded edges are only shading (62)**: **Accepted** (2026-10-07): the bevel is a few centimetres, read in the shading; real geometry would multiply the town's triangles for an edge nobody sees against the sky.

- **Small things on the walls cast no shadow past 32 m (64)**: **Accepted** (2026-10-07): at that distance they're under a pixel of shadow, and drawing them into the far maps was what cost the frame.

- **The trees are cards close up (63)**: **Accepted** (2026-10-07): the near trees are real, and a crown seen from beneath is shaded dark; photographs would only change how they read, not how the game plays.

- **Some features collide where nothing is drawn (59)**: **Accepted** (2026-10-07): these are a few tenths of a metre, and solid boxes keep the bots' nav and cover simple and fair; shaping them would shift paths for nothing seen.

- **Rooms in the town take the sky's blue (60)**: **Accepted** (2026-10-07): a room lit only through windows is bluish, as in daylight; the tint is mild and the rooms are readable.

- **The new map's ground floats a few centimetres over its floors (2026-10-07)**: **Accepted** (2026-10-07): 6 cm is inside a footstep's bounce, and the alternative, seams showing between floor boxes, looked worse.

- **The greenery costs 2–5 ms a frame** (63) on an M3 Pro at 1280 × 720: most of it the trees'
  far tiles, which drew the plainer trees out to 145 m past a tile's edge and cast them into the
  shadows, with the leaf cards' overdraw. **Resolved in part** (64): the small and the many hand
  over to their impostors sooner (`Species.fadeRange`), 1.4 ms less GPU time at the hillside.
  **Resolved** (2026-10-07): what no spot a player can stand on sees isn't planted or drawn
  (`sightlines.ts`: lines of sight over the terrain from a viewpoint every 12 m on the ground and
  on each walkable roof and floor, to a target's top, with 1.5 m's slack): of 3,348 trees 962 are
  left, of 6,744 terrace walls 1,379, of 195 rocks 88; the town's screenshots are unchanged and
  the benchmark's triangles are down 12-15%, at about 0.1 s more load. Frame times didn't separate
  from the noise over two alternating runs. Buildings aren't counted as hiding anything, only
  the ground, so a tree behind a house is kept. Its leaf cards close up are the trees' own issue.
