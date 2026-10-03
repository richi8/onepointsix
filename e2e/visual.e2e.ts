import { expect, test, type Page } from '@playwright/test';
import { open } from './game.ts';

// Screenshot comparisons of what only a picture can check: the island's
// rendering at fixed spots with time stood still, and the pose viewer's
// soldiers. Chromium only: each engine draws a little differently, and one
// set of pictures is enough to catch a change. A machine without the pictures
// makes its own on the first run (see playwright.config.ts).

test.use({ viewport: { width: 640, height: 360 } });

/** Hold the menu camera at `cam` (see main.ts) with time stopped, and hide the menu. */
async function spot(page: Page, cam: string, query = ''): Promise<void> {
  await open(page, `?still=10&cam=${cam}${query}`);
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  // A few frames for the shadows and ground cover to settle.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
}

const SPOTS: Record<string, string> = {
  // The sea along a beach: waves, foam and the shallows.
  water: '20,4,305,-30,0,340',
  // Grass, bushes and pebbles at eye height in a field.
  groundcover: '40,19.9,-40,60,19,-30',
  // Across the island from its highest point: far trees are impostors.
  impostors: '0,76,0,300,20,-200',
  // Over an outpost: both shadow cascades, near and far.
  cascades: 'o0,20,9,25,-6,1,6',
  // Inside a two-storey building, lit from its windows: the stairs, crates and glass.
  indoor: '-65.28,18.16,36.55,-60.34,17.56,42.72',
  // Its upper floor, with the sun through the windows and a plain ceiling.
  upstairs: '-65.28,21.16,36.55,-60.34,20.56,42.72',
  // An outpost's watchtower: posts, braces, the deck, the parapet and the stairs.
  watchtower: 'o0,3,5.7,2,-6,3.2,-6',
  // A shipping container's doors, with their locking bars.
  container: 'o0,-16,1.7,2.5,-8.7,0.7,0.7',
  // At eye height, trees 150 to 180 m off dissolving into their impostors.
  treeline: '60,30,-60,230,22,-160',
  // The island from the sea, 200, 400 and 600 m off its shore: its reflection,
  // the far waves, far terrain tiles carrying their trees and the far shadows.
  'sea-200': '-150,6,420,0,20,100',
  'sea-400': '250,12,650,0,15,0',
  'sea-600': '0,25,1000,0,20,0',
};

for (const [name, cam] of Object.entries(SPOTS)) {
  test(`island: ${name}`, async ({ page }) => {
    await spot(page, cam);
    await expect(page).toHaveScreenshot(`${name}.png`);
  });
}

// An inside corner of that building, the sun on the wall beside it: no line
// of sun down the seam where the walls meet. The line is thin, about 900
// pixels and dim, so this one is held closer than the rest.
test('island: inside corner', async ({ page }) => {
  await spot(page, '-64.37,17.76,41.2,-65.78,17.56,42.92');
  await expect(page).toHaveScreenshot('corner.png', { maxDiffPixels: 100, threshold: 0.05 });
});

// Outside an outpost at eye height, in each weather (held with ?sky=, see
// main.ts): the sky, sun and fog of each, and the rain (frozen).
const OUTSIDE = 'o0,-25,1.7,-25,0,1.5,0';
const CONDITIONS: Record<string, string> = {
  clear: '',
  rain: '&sky=rain',
  fog: '&sky=fog',
};

for (const [name, query] of Object.entries(CONDITIONS)) {
  test(`conditions: ${name}`, async ({ page }) => {
    await spot(page, OUTSIDE, query);
    await expect(page).toHaveScreenshot(`conditions-${name}.png`);
  });
}

// The weather turning, held part way (see ?sky= in main.ts): clouds gathering
// a few seconds before rain, the rain half come in, mist lying in the valleys
// ahead of a fog (and seen from the island's top), halfway from rain to fog with both at once, the
// sky breaking and the rain easing or the fog thinning a few seconds before
// it clears, a fog half lifted, and the yard drying two minutes after the rain, its last puddles
// shrunk into the hollows and dark in the sun.
const TURNING: Record<string, string> = {
  'rain-coming': `${OUTSIDE}&sky=clear,rain,-5`,
  'rain-arriving': `${OUTSIDE}&sky=clear,rain,0.5`,
  'fog-coming': '60,30,-60,230,22,-160&sky=clear,fog,-5',
  'fog-coming-hilltop': '124,57.7,-236,0,15,0&sky=clear,fog,-5',
  'rain-to-fog': `${OUTSIDE}&sky=rain,fog,0.5`,
  'rain-clearing': `${OUTSIDE}&sky=rain,clear,-5`,
  'fog-clearing': `${OUTSIDE}&sky=fog,clear,-5`,
  'fog-lifting': `${OUTSIDE}&sky=fog,clear,0.5`,
  'yard-drying': 'o0,2,1.7,-8,11,0,-4&sky=rain,clear,3',
};

for (const [name, query] of Object.entries(TURNING)) {
  test(`weather: ${name}`, async ({ page }) => {
    const [cam, sky] = query.split('&');
    await spot(page, cam, `&${sky}`);
    await expect(page).toHaveScreenshot(`weather-${name}.png`);
  });
}

// An outpost's yard from above, the shadows cast by crates and the
// watchtower; and the yard on the ground in the rain, wet, with puddles on
// the level ground.
const YARD: Record<string, string> = {
  yard: 'o0,0,16,-22,2,0,4',
  'yard-wet': 'o0,2,1.7,-8,11,0,-4&sky=rain',
};

for (const [name, query] of Object.entries(YARD)) {
  test(`yard: ${name}`, async ({ page }) => {
    const [cam, ...rest] = query.split('&');
    await spot(page, cam, rest.map((r) => `&${r}`).join(''));
    await expect(page).toHaveScreenshot(`${name}.png`);
  });
}

// Deathmatch's map (see maps/teststreet.ts): down its street from the west
// end, the two-storey house on the left and the two-room one on the right, and
// from above, the yards, the outside stair and the walls round it.
const MAP: Record<string, string> = {
  'test-street': '-26,17.7,1,10,16.5,0',
  'test-street-above': '-30,40,30,0,16,0',
};

for (const [name, cam] of Object.entries(MAP)) {
  test(`map: ${name}`, async ({ page }) => {
    await spot(page, cam, '&mode=deathmatch');
    await expect(page).toHaveScreenshot(`${name}.png`);
  });
}

// Soldiers stood on the island (see ?stand in main.ts): one in a tree's
// shadow out in the open, shaded, beside one in the sun; one wading, mirrored
// in the sea.
const STANDING: Record<string, string> = {
  'tree-shade': 'cam=-93.5,22.1,110,-99.5,20.9,114.5&stand=-97.6,115.2,0.6;-101.5,112.2,0.6',
  wading: 'cam=11.5,1.2,320,7.5,0.3,327&stand=8,326,2.5',
};

for (const [name, query] of Object.entries(STANDING)) {
  test(`soldiers: ${name}`, async ({ page }) => {
    const [cam, stand] = query.split('&');
    await spot(page, cam.slice('cam='.length), `&${stand}`);
    await expect(page).toHaveScreenshot(`soldiers-${name}.png`);
  });
}

const POSES: Record<string, string> = {
  moving: 'show=stand,walk,run,crouch,crouchwalk,jump,fall,mantle&view=side&d=13',
  hands: 'show=reload:0.1,reload:0.4,draw,throw:0.2,lean,leanl,aimup,dead&view=front&d=13',
  guns: 'show=stand,pistol,bolt,commander,guard&view=side&quiet&d=9',
  firstperson: 'view=fp&weapon=0',
  'firstperson-reload': 'view=fp&weapon=1&act=reload&t=0.5',
  'firstperson-bolt': 'view=fp&weapon=2&act=reload&t=0.45',
  'firstperson-pistol-aimed': 'view=fp&weapon=1&aim=1',
  reloads: 'show=reload:0.58:0,reload:0.5:1,reload:0.36:2,cycle:0.6&view=front&eye=2.4,1.35,2.2&at=2.4,1.15,0',
  reactions: 'show=stand,hit:0.2,hithead:0.2,shoot:0.08,land:0.12,land:0.35&view=side&d=11',
  // Chunk 33: struck from the side, a climb onto a ledge, a slope underfoot, and magazines let fall.
  'hits-side': 'show=hit:0.1,hithead:0.1,hitleg:0.1,shoot:0.09:2&view=front&from=1.57&side=0.15&eye=2.4,1.2,6&at=2.4,1,0',
  climb: 'show=climb:0.08,climb:0.14,climb:0.2,climb:0.3&view=front&ledge=1.2&eye=-3.4,1.6,1.5&at=2.4,1.1,0.5',
  slope: 'show=stand,walk,crouch&view=front&slope=0.3&eye=1.6,1.6,6&at=1.6,1.1,0',
  drops: 'show=reload:0.9:0,reload:0.9:1&view=front&eye=0.8,1.4,2.4&at=0.8,0.4,0.4',
  // The crouched run at four points in its stride, the last with a pistol, so nothing turns it side-on.
  'crouch-run': 'show=crouchrun,crouchrun,crouchrun,crouchrun:0.4:1&view=side&spacing=1.2&eye=1.8,1.3,-5&at=1.8,0.6,0',
  // Chunk 34: a pile of bodies, the same pile after a grenade under it, and one falling against someone standing.
  pile: 'show=dead:1.5,dead:1.4,dead:1.3&view=side&spacing=0.7&eye=0.4,2.6,4.2&at=1.6,0.2,0',
  'pile-blast': 'show=dead:1.5,dead:1.4,dead:1.3&view=side&spacing=0.7&blast=0.8&blastat=1.4,0.6&eye=0.4,2.6,4.2&at=1.6,0.2,0',
  against: 'show=dead:1.5,stand&view=side&spacing=0.9&eye=-1.5,1.6,3&at=0.5,0.5,0',
  // The rifle's charging handle drawn back at the end of a reload, from over the left shoulder.
  'charging-handle': 'show=reload:0.9:0&view=front&eye=-0.6,1.6,-0.5&at=0.05,1.3,0.1',
  // Chunk 42: every avatar, by side: operators, guards and commanders.
  avatars: 'show=operator,operator,guard,guard,guard,guard,guard,commander,commander,commander&avatar=each&view=front&spacing=1.1&d=9',
};

for (const [name, query] of Object.entries(POSES)) {
  test(`pose viewer: ${name}`, async ({ page }) => {
    await page.goto(`./dev/pose.html?${query}`);
    await expect(page).toHaveTitle('ready', { timeout: 60_000 });
    await expect(page).toHaveScreenshot(`pose-${name}.png`);
  });
}
