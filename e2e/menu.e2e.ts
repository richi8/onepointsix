import { expect, test } from '@playwright/test';
import { CHANGELOG } from '../src/client/changelog.ts';
import { open } from './game.ts';

test.describe('loading screen', () => {
  test('fills its bar, then gives way to the menu', async ({ page }) => {
    await page.goto('./');
    const loading = page.locator('#loading');
    await expect(loading).toBeVisible();
    await expect(loading.locator('h1')).toHaveText('onepointsix');
    await expect(loading).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#play')).toBeFocused();
  });

  test('offers to play in flat colours while the textures hang', async ({ page }) => {
    // The soldier never arrives.
    await page.route('**/assets/soldier.glb', () => {});
    await page.goto('./');
    const skip = page.locator('#loading-skip');
    await expect(skip).toBeHidden();
    await expect(skip).toBeVisible({ timeout: 15_000 });
    await skip.click();
    await expect(page.locator('#loading')).toHaveCount(0);
    await page.click('#play');
    await expect(page.locator('#hud')).toBeVisible();
  });

  test('says so when the textures fail, and plays on', async ({ page }) => {
    await page.route('**/assets/soldier.glb', (route) => route.abort());
    await page.goto('./');
    await expect(page.locator('#toast')).toHaveText('Textures failed to load. Playing in flat colours.', { timeout: 60_000 });
    await expect(page.locator('#loading')).toHaveCount(0);
  });
});

test.describe('menu', () => {
  test('remembers the mode and the name', async ({ page }) => {
    await open(page);
    await page.click('#modes [data-mode=offline]');
    await expect(page.locator('#modes [data-mode=offline]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#briefing p.on').first()).toContainText('bot operators');
    await page.fill('#name', '  Test   Pilot ');
    await page.locator('#name').blur();
    await expect(page.locator('#name')).toHaveValue('Test Pilot');
    await open(page);
    await expect(page.locator('#modes [data-mode=offline]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#name')).toHaveValue('Test Pilot');
  });

  test('puts the time of day and weather in the address', async ({ page }) => {
    await open(page);
    await page.click('#times [data-time=night]');
    await page.click('#weathers [data-weather=fog]');
    await expect(page).toHaveURL(/time=night/);
    await expect(page).toHaveURL(/weather=fog/);
    await expect(page.locator('#times [data-time=night]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#briefing p.on').nth(1)).toContainText('More and tougher guards');
    await expect(page.locator('#briefing p.on').nth(2)).toContainText('Nobody sees far');
    // Back to day and clear leaves the address plain.
    await page.click('#times [data-time=day]');
    await page.click('#weathers [data-weather=clear]');
    await expect(page).not.toHaveURL(/time=|weather=/);
    // A link with conditions opens in them.
    await open(page, '?time=dusk&weather=rain');
    await expect(page.locator('#times [data-time=dusk]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#weathers [data-weather=rain]')).toHaveAttribute('aria-checked', 'true');
  });

  test("What's new lights a dot until opened, and Esc closes it", async ({ page }) => {
    await open(page);
    const dot = page.locator('#news-open .dot');
    await expect(dot).toBeVisible();
    await page.click('#news-open');
    await expect(page.locator('#news')).toBeVisible();
    await expect(page.locator('#news section')).toHaveCount(CHANGELOG.length);
    await expect(page.locator('#news section h3').first()).toHaveText(CHANGELOG[0].title);
    await page.keyboard.press('Escape');
    await expect(page.locator('#news')).toBeHidden();
    await expect(dot).toBeHidden();
    await open(page);
    await expect(dot).toBeHidden();
  });

  test('New island goes to another seed', async ({ page }) => {
    await open(page);
    await expect(page.locator('#world-label')).toHaveText('Default island');
    await page.click('#new-island');
    await expect(page).toHaveURL(/world=\d+/);
    const seed = new URL(page.url()).searchParams.get('world');
    await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('#world-label')).toHaveText(`Island #${seed}`);
  });

  test('Enter plays', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('#menu')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    await page.waitForFunction(() => !!window.game.conn?.run);
  });
});
