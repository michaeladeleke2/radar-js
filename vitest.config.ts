// Tests run from the repository root (vite.config.ts points Vite at demo/).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.test.{js,ts}'],
    environment: 'node',
    testTimeout: 30000,
  },
});
