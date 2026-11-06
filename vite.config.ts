// The demo site: demo/index.html, built into dist/ for GitHub Pages.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { buildDefine } from './build_info.ts';

export default defineConfig({
  root: 'demo',
  base: './',                 // works under https://<user>.github.io/radar-js/
  // Chrome 89: one benchmark laptop (a Chromebook) cannot update past it.
  // tools/check_chrome89.mjs checks the output.
  // Two pages: the demo and the benchmark (demo/bench.html).
  build: {
    outDir: '../dist', emptyOutDir: true, target: 'chrome89',
    rolldownOptions: { input: { index: fileURLToPath(new URL('./demo/index.html', import.meta.url)), bench: fileURLToPath(new URL('./demo/bench.html', import.meta.url)) } },
  },
  worker: { format: 'es' },
  define: buildDefine(),
});
