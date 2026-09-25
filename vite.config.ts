import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages subpath (/<repo>/).
  base: './',
  worker: { format: 'es' },
  // Every page's dependencies found at start, so the dev server never stops
  // to add one and reloads a page mid-test.
  optimizeDeps: { entries: ['index.html', 'dev/*.html'] },
  build: {
    rolldownOptions: {
      // three.js in chunks of its own (its core, and the WebGL renderer), loaded
      // in parallel with the game's code and kept in the cache across updates to it.
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]three\.core/ },
            { name: 'three-webgl', test: /node_modules[\\/]three[\\/]build[\\/]three\.module/ },
          ],
        },
      },
    },
  },
});
