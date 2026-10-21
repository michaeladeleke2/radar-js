// Tests run from the repository root (vite.config.ts points Vite at demo/).
import { defineConfig } from 'vitest/config';
import { buildDefine } from './build_info.ts';

export default defineConfig({
  define: buildDefine(),
  test: {
    root: '.',
    include: ['test/**/*.test.{js,ts}'],
    environment: 'node',
    testTimeout: 30000,
  },
});
