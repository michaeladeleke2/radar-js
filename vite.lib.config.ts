// The library, built twice into dist-lib/:
//   npm run build:lib          radar.js       ES module (npm, <script type="module">)
//   (second pass, mode iife)   radar.iife.js  plain <script> tag, defines window.radar
// An IIFE has no import.meta.url, which the worker clients use to find their
// worker files, so that build takes it from the <script> tag's own URL.
import { defineConfig } from 'vite';
import { buildDefine } from './build_info.ts';

export default defineConfig(({ mode }) => {
  const iife = mode === 'iife';
  return {
    define: { ...buildDefine(), ...(iife ? { 'import.meta.url': '__radarScriptUrl' } : {}) },
    build: {
      outDir: 'dist-lib',
      emptyOutDir: !iife,
      lib: { entry: iife ? 'src/iife.ts' : 'src/index.ts', name: 'radar', formats: [iife ? 'iife' : 'es'], fileName: () => (iife ? 'radar.iife.js' : 'radar.js') },
      rolldownOptions: iife ? { output: { exports: 'default', banner: "var __radarScriptUrl = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : '');" } } : {},
    },
    worker: { format: 'es' },
  };
});
