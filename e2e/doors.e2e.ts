import { expect, test } from '@playwright/test';
import { dev, face, open, play } from './game.ts';

// Doors on our own screen: they swing the moment F is pressed, a round trip
// before the server says so, and stay swung once it does.

interface Leaf {
  x: number;
  z: number;
  pair: number;
  open: boolean;
  swing: number;
}

test('a door swings open on your own screen at once, ahead of the server', async ({ page }) => {
  await open(page);
  await play(page);
  await dev(page, { act: 'door' });
  // Wait to be put there: a shut door just ahead.
  await page.waitForFunction(() => {
    const g = window.game;
    const me = g.conn!.predictor.state;
    const world = g.world as { doors: Leaf[]; doorFacing(x: number, y: number, z: number, yaw: number, reach: number): number };
    return world.doors.some((d) => !d.open && Math.hypot(d.x - me.x, d.z - me.z) < 2.5);
  });
  const door = await page.evaluate(() => {
    const me = window.game.conn!.predictor.state;
    const doors = (window.game.world as { doors: Leaf[] }).doors;
    const i = doors.findIndex((d) => !d.open && Math.hypot(d.x - me.x, d.z - me.z) < 2.5);
    const d = doors[i];
    return { i, x: (d.x + doors[d.pair].x) / 2, z: (d.z + doors[d.pair].z) / 2 };
  });
  await face(page, door.x, door.z);
  // A slow connection: 400 ms each way.
  await page.evaluate(() => {
    (window.game.conn!.transport as unknown as { net: { latency: number } }).net.latency = 400;
  });
  const pressed = await page.evaluate(() => performance.now());
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(80);
  await page.keyboard.up('KeyF');
  // Swinging already, long before the server could have answered.
  const early = await page.evaluate((i) => ({ at: performance.now(), leaf: (window.game.world as { doors: Leaf[] }).doors[i] }), door.i);
  expect(early.at - pressed).toBeLessThan(400);
  expect(early.leaf.open).toBe(true);
  expect(early.leaf.swing).toBeGreaterThan(0);
  // Once the server has said so too, it's still open, and all the way.
  await page.waitForTimeout(2000);
  const later = await page.evaluate((i) => (window.game.world as { doors: Leaf[] }).doors[i], door.i);
  expect(later).toMatchObject({ open: true, swing: 1 });
});
