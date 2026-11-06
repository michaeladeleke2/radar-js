// The demo site: demo/index.html, built into dist/ for GitHub Pages.
import { defineConfig } from 'vite';
import { buildDefine } from './build_info.ts';

export default defineConfig({
  root: 'demo',
  base: './',                 // works under https://<user>.github.io/radar-js/
  // Chrome 89: one benchmark laptop (a Chromebook) cannot update past it.
  // tools/check_chrome89.mjs checks the output.
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome89' },
  worker: { format: 'es' },
  define: buildDefine(),
});
