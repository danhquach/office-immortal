import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Unit tests cover the pure simulation (src/core/**), the save's
      // storage glue (src/storage/**), the UI's pure helpers (src/ui/**) and
      // the build's Content-Security-Policy (src/csp.test.ts) and the lint
      // rules that ban HTML sinks (src/lint.test.ts).
      // The DOM code itself is kept thin and is not unit-tested here.
      include: [
        'src/core/**/*.test.ts',
        'src/storage/**/*.test.ts',
        'src/ui/**/*.test.ts',
        'src/dev/**/*.test.ts',
        'src/csp.test.ts',
        'src/zip-checks.test.ts',
        'src/lint.test.ts',
      ],
      environment: 'node',
      // Vitest blanks CSS imports by default; the colour-contrast test reads
      // page.css (?raw) to check the real theme values.
      css: { include: [/page\.css/] },
    },
  }),
);
