import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, firefox, test, webkit, type BrowserType } from '@playwright/test';

// The frame-cost report (see dev/bench.ts), in each engine in turn, after all
// the other tests. It prints the numbers next to those in bench-baseline.json,
// the last ones kept on purpose, and fails only if the page does. To keep a
// run's numbers as the new baseline: BENCH_BASELINE=1 npm run test:browser.

const BASELINE = new URL('./bench-baseline.json', import.meta.url);
const ENGINES: [string, BrowserType, string[]][] = [
  ['chromium', chromium, process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=gl']],
  ['firefox', firefox, []],
  ['webkit', webkit, []],
];

type Stats = { median: number; p95: number; max: number };
interface Bench {
  gpu: string;
  size: string;
  bodies: number;
  empty: { frame: Stats; calls: number; triangles: number };
  crowd: { bodies: Stats; frame: Stats; calls: number; triangles: number };
  groundCover: { first: Stats; again: Stats };
}

const results: Record<string, Bench> = {};

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
      `    ground cover, new    ${was(b.groundCover.first.median, o?.groundCover.first.median)} / ${was(b.groundCover.first.p95, o?.groundCover.first.p95)}` +
        `   (max ${b.groundCover.first.max})`,
      `    ground cover, again  ${was(b.groundCover.again.median, o?.groundCover.again.median)} / ${was(b.groundCover.again.p95, o?.groundCover.again.p95)}`,
    );
  }
  console.log(lines.join('\n'));
  if (process.env.BENCH_BASELINE && Object.keys(results).length) {
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, ...results }, null, 2)}\n`);
    console.log(`Kept as the baseline in ${BASELINE.pathname}`);
  }
});
