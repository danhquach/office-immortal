import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Unit tests cover the pure simulation (src/core/**), the save's
      // storage glue (src/storage/**) and the UI's pure helpers (src/ui/**).
      // The DOM code itself is kept thin and is not unit-tested here.
      include: ['src/core/**/*.test.ts', 'src/storage/**/*.test.ts', 'src/ui/**/*.test.ts'],
      environment: 'node',
      // Vitest blanks CSS imports by default; the colour-contrast test reads
      // page.css (?raw) to check the real theme values.
      css: { include: [/page\.css/] },
    },
  }),
);
