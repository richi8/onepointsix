import { expect, test } from '@playwright/test';

// Runs first: the dev server is up and serving the game.

test('the dev server serves the game', async ({ request }) => {
  const page = await request.get('./');
  expect(page.ok()).toBe(true);
  expect(await page.text()).toContain('src/client/main.ts');
});
