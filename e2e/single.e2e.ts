import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// The single-file build (npm run build:single) opened from disk, as a player
// would open the file they were sent: it loads everything packed in the page,
// textures and sounds included, and a run starts. Built here, into a folder of
// its own, so it's always the current code.

let dir = '';

test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'onepointsix-single-'));
  execFileSync('npx', ['vite', 'build', '--mode', 'single', '--outDir', dir, '--emptyOutDir', '--logLevel', 'warn'], { stdio: 'inherit' });
});

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('the single file plays when opened from disk', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  // Anything asked of the disk besides the page itself is a file the shim missed.
  const file = pathToFileURL(join(dir, 'onepointsix.html')).href;
  const strays: string[] = [];
  page.on('request', (r) => void (r.url().startsWith('file:') && r.url() !== file && strays.push(r.url())));

  await page.goto(file);
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('#menu')).toBeVisible();
  await page.click('#play');
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#ammo .name')).not.toBeEmpty();
  // A moment in, for a failure to load to be told.
  await page.waitForTimeout(1000);
  await expect(page.locator('#toast')).not.toHaveText(/failed/i);
  expect(strays).toEqual([]);
  expect(errors).toEqual([]);
});
