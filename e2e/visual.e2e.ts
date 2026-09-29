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
  // Its upper floor, with the sun through the windows.
  upstairs: '-65.28,21.16,36.55,-60.34,20.56,42.72',
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

test('island: indoor at dusk', async ({ page }) => {
  await spot(page, SPOTS.indoor, '&time=dusk');
  await expect(page).toHaveScreenshot('indoor-dusk.png');
});

// Outside an outpost at eye height, a lamp on its wall, in each light and
// weather but a clear day: the sky, sun and fog of each, the rain (frozen),
// and at night your own flashlight lit and the lamps.
const OUTSIDE = 'o0,-25,1.7,-25,0,1.5,0';
const CONDITIONS: Record<string, string> = {
  dusk: '&time=dusk',
  rain: '&weather=rain',
  fog: '&weather=fog',
  night: '&time=night&torch',
  'night-rain': '&time=night&weather=rain&torch',
};

for (const [name, query] of Object.entries(CONDITIONS)) {
  test(`conditions: ${name}`, async ({ page }) => {
    await spot(page, OUTSIDE, query);
    await expect(page).toHaveScreenshot(`conditions-${name}.png`);
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
};

for (const [name, query] of Object.entries(POSES)) {
  test(`pose viewer: ${name}`, async ({ page }) => {
    await page.goto(`./dev/pose.html?${query}`);
    await expect(page).toHaveTitle('ready', { timeout: 60_000 });
    await expect(page).toHaveScreenshot(`pose-${name}.png`);
  });
}
