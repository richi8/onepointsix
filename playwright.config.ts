import { defineConfig, devices } from '@playwright/test';

// Browser tests (`npm run test:browser`): the real game on the Vite dev server,
// whose development build has the hooks the tests use (window.game, game.dev,
// ?cam= and ?still=). The UI tests run in all three engines. The screenshot
// comparisons run in Chromium only, and the frame-cost benchmark runs last, on
// its own, in each engine in turn.

const PORT = 5188;
// Headless Chromium draws WebGL in software unless told to use the GPU.
const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=gl'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 120_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.15 },
  },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  // A machine without the screenshots yet makes its own.
  updateSnapshots: 'missing',
  snapshotPathTemplate: '{testDir}/screenshots/{platform}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: 'setup.e2e.ts', teardown: 'bench' },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: ['setup.e2e.ts', 'bench.e2e.ts'],
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { args: gpu } },
    },
    { name: 'firefox', dependencies: ['setup'], testIgnore: ['setup.e2e.ts', 'bench.e2e.ts', 'visual.e2e.ts'], use: devices['Desktop Firefox'] },
    { name: 'webkit', dependencies: ['setup'], testIgnore: ['setup.e2e.ts', 'bench.e2e.ts', 'visual.e2e.ts'], use: devices['Desktop Safari'] },
    // After everything else, so nothing else is drawing meanwhile.
    { name: 'bench', testMatch: 'bench.e2e.ts', fullyParallel: false },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
