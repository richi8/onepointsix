import { expect, test } from '@playwright/test';
import { open } from './game.ts';

// The assets as the game loads them: through our own Basis transcoder in
// every engine, and measured against the originals they were made from (see
// dev/assets.ts).

test('the textures load through the transcoder', async ({ page }) => {
  await open(page);
  const layers = await page.evaluate(() => {
    const assets = (window as unknown as { assets?: { albedo: { image: { depth: number } }; normal: { image: { depth: number } } } }).assets;
    return assets && [assets.albedo.image.depth, assets.normal.image.depth];
  });
  expect(layers).toEqual([10, 10]);
});

interface Report {
  textures: {
    layers: string[];
    picked: string;
    color: Record<string, number[]>;
    normal: Record<string, { mean: number; p95: number }[]>;
  };
  sky: {
    game: Record<string, { brightness: number; error: number }>;
    diffuse: Record<string, { mean: number; each: number[] }>;
  };
}

test('the packed assets against the originals', async ({ page }) => {
  await page.goto('./dev/assets.html');
  await page.waitForFunction(() => document.title === 'done', null, { timeout: 90_000 });
  const r = await page.evaluate(() => (window as unknown as { report: Report }).report);
  const t = r.textures;
  console.log(`Textures, as ${t.picked} here. Colour PSNR (dB), then normals' mean and 95th percentile error (degrees):`);
  t.layers.forEach((name, i) => {
    const color = Object.entries(t.color).map(([k, v]) => `${k} ${v[i]}`).join('  ');
    const normal = Object.entries(t.normal).map(([k, v]) => `${k} ${v[i].mean}/${v[i].p95}`).join('  ');
    console.log(`  ${name.padEnd(18)} ${color}   ${normal}`);
  });
  console.log('Sky, brighter than the original prefiltered at full size (%):',
    Object.entries(r.sky.game).map(([k, v]) => `${k} ${v.brightness}`).join(', '));
  console.log('Sky, diffuse light over the true light from the original:',
    Object.entries(r.sky.diffuse).map(([k, v]) => `${k} ${v.mean}`).join(', '));

  for (const [target, layers] of Object.entries(t.color)) {
    for (const [i, db] of layers.entries()) expect(db, `${target} ${t.layers[i]} colour`).toBeGreaterThan(28);
  }
  for (const [target, layers] of Object.entries(t.normal)) {
    for (const [i, e] of layers.entries()) expect(e.mean, `${target} ${t.layers[i]} normals`).toBeLessThan(12);
  }
  // As measured in chunk 20: the game's sky lights 24% brighter than the
  // original would, and 13% above the light the original really casts.
  for (const [k, v] of Object.entries(r.sky.game)) expect(Math.abs(v.brightness), k).toBeLessThan(30);
  expect(r.sky.diffuse.game.mean).toBeGreaterThan(0.9);
  expect(r.sky.diffuse.game.mean).toBeLessThan(1.2);
});
