import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect, test, type BrowserType } from '@playwright/test';

// The frame-cost report (see dev/bench.ts), in Chromium, run on its own
// (npm run bench) rather than with the other tests. It prints the numbers next to those in bench-baseline.json,
// the last ones kept on purpose, and fails only if the page does. To keep a
// run's numbers as the new baseline: BENCH_BASELINE=1 npm run bench.
// Then the adaptive resolution on a GPU slowed on purpose, which does fail if
// it doesn't settle.

const BASELINE = new URL('./bench-baseline.json', import.meta.url);
const ENGINES: [string, BrowserType, string[]][] = [
  ['chromium', chromium, process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=gl']],
];

type Stats = { median: number; p95: number; max: number };
interface Bench {
  gpu: string;
  size: string;
  bodies: number;
  empty: { frame: Stats; calls: number; triangles: number };
  crowd: { bodies: Stats; frame: Stats; calls: number; triangles: number };
  /** Missing from baselines older than chunk 21; its frame and calls, older than chunk 32. */
  distant?: { bodies: Stats; frame?: Stats; calls?: number };
  groundCover: { first: Stats; again: Stats };
  /** Missing from baselines older than chunk 43. */
  rain?: { frame: Stats; calls: number; triangles: number };
  /** Missing from baselines older than chunk 45. */
  crossover?: { frame: Stats; calls: number; triangles: number };
}

const results: Record<string, Bench> = {};

/** What dev/bench.ts?adaptive reports: see adaptive() there. */
interface Adaptive {
  iterations: number;
  full: number;
  changes: number;
  log: { t: number; share: number }[];
  share: number;
  settled: number;
}
let adaptive: Adaptive | null = null;

test.describe.configure({ mode: 'serial' });

for (const [name, type, args] of ENGINES) {
  test(`frame cost in ${name}`, async ({ baseURL }) => {
    test.setTimeout(180_000);
    const browser = await type.launch({ args });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(new URL('dev/bench.html', baseURL).href);
      await page.waitForFunction(() => document.title === 'done', null, { timeout: 150_000 });
      results[name] = await page.evaluate(() => (window as unknown as { bench: Bench }).bench);
    } finally {
      await browser.close();
    }
  });
}

// Adaptive resolution on a GPU made slow on purpose, in Chromium only: the
// point is the controller, and one engine's timing is enough to see it settle.
// 25 s is long enough to settle (in about 3 s) and for one step back up that
// proves too slow to be taken back.
test('adaptive resolution settles on a slow GPU', async ({ baseURL }) => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({ args: ENGINES[0][2] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(new URL('dev/bench.html?adaptive=25', baseURL).href);
    await page.waitForFunction(() => document.title === 'done', null, { timeout: 100_000 });
    const a = await page.evaluate(() => (window as unknown as { adaptive: Adaptive }).adaptive);
    adaptive = a;
    // Full resolution was too slow, so it came down, and holds 50 fps without switching back and forth.
    expect(a.full).toBeGreaterThan(20);
    expect(a.share).toBeLessThan(1);
    expect(a.settled).toBeLessThan(20);
    expect(a.changes).toBeLessThanOrEqual(4);
  } finally {
    await browser.close();
  }
});

test.afterAll(() => {
  const baseline: Record<string, Bench> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const was = (v: number, old: number | undefined) => (old === undefined ? `${v}` : `${v} (was ${old})`);
  const lines = ['', 'Frame cost, ms (median / 95th percentile), 1280 × 720 at pixel ratio 1:'];
  for (const [name, b] of Object.entries(results)) {
    const o = baseline[name];
    lines.push(
      `  ${name} · ${b.gpu}`,
      `    empty frame          ${was(b.empty.frame.median, o?.empty.frame.median)} / ${was(b.empty.frame.p95, o?.empty.frame.p95)}` +
        `   ${b.empty.calls} draw calls, ${Math.round(b.empty.triangles / 1000)}k triangles`,
      `    ${b.bodies} bodies, frame     ${was(b.crowd.frame.median, o?.crowd.frame.median)} / ${was(b.crowd.frame.p95, o?.crowd.frame.p95)}` +
        `   ${b.crowd.calls} draw calls, ${Math.round(b.crowd.triangles / 1000)}k triangles`,
      `    posing them          ${was(b.crowd.bodies.median, o?.crowd.bodies.median)} / ${was(b.crowd.bodies.p95, o?.crowd.bodies.p95)}`,
      `    posing them far off  ${was(b.distant!.bodies.median, o?.distant?.bodies.median)} / ${was(b.distant!.bodies.p95, o?.distant?.bodies.p95)}`,
      `    far off, frame       ${was(b.distant!.frame!.median, o?.distant?.frame?.median)} / ${was(b.distant!.frame!.p95, o?.distant?.frame?.p95)}` +
        `   ${b.distant!.calls} draw calls`,
      `    ground cover, new    ${was(b.groundCover.first.median, o?.groundCover.first.median)} / ${was(b.groundCover.first.p95, o?.groundCover.first.p95)}` +
        `   (max ${b.groundCover.first.max})`,
      `    ground cover, again  ${was(b.groundCover.again.median, o?.groundCover.again.median)} / ${was(b.groundCover.again.p95, o?.groundCover.again.p95)}`,
      `    in the rain          ${was(b.rain!.frame.median, o?.rain?.frame.median)} / ${was(b.rain!.frame.p95, o?.rain?.frame.p95)}` +
        `   ${b.rain!.calls} draw calls, ${Math.round(b.rain!.triangles / 1000)}k triangles`,
      `    rain turning to fog  ${was(b.crossover!.frame.median, o?.crossover?.frame.median)} / ${was(b.crossover!.frame.p95, o?.crossover?.frame.p95)}` +
        `   ${b.crossover!.calls} draw calls, ${Math.round(b.crossover!.triangles / 1000)}k triangles`,
    );
  }
  if (adaptive) {
    const steps = adaptive.log.map((l) => `${l.share} at ${l.t} s`).join(', ') || 'none';
    lines.push(
      '',
      `Adaptive resolution, chromium: full resolution ${adaptive.full} ms a frame; ${adaptive.changes} changes (${steps});`,
      `  settled at ${adaptive.share} of full resolution, ${adaptive.settled} ms a frame`,
    );
  }
  console.log(lines.join('\n'));
  if (process.env.BENCH_BASELINE && Object.keys(results).length) {
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, ...results }, null, 2)}\n`);
    console.log(`Kept as the baseline in ${BASELINE.pathname}`);
  }
});
