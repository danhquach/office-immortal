import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Unit tests cover the pure simulation (src/core/**) and the save's
      // storage glue (src/storage/**). The DOM layer is kept thin and is not
      // unit-tested here.
      include: ['src/core/**/*.test.ts', 'src/storage/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
