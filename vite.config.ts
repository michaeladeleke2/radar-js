// The demo site: demo/index.html, built into dist/ for GitHub Pages.
import { defineConfig } from 'vite';
import { buildDefine } from './build_info.ts';

export default defineConfig({
  root: 'demo',
  base: './',                 // works under https://<user>.github.io/radar-js/
  build: { outDir: '../dist', emptyOutDir: true },
  worker: { format: 'es' },
  define: buildDefine(),
});
