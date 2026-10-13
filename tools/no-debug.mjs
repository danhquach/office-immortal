// Fails when the production build in dist/ carries any of the dev-only Debug
// panel (src/dev/, src/ui/debug-flag.ts). CI runs it after every build
// (npm run check:no-debug); npm run zip runs the same check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { debugProblems } from './zip-checks.mjs';

const DIST = 'dist';

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let all;
try {
  all = files(DIST);
} catch {
  console.error('no dist/: run npm run build first');
  process.exit(1);
}
const found = debugProblems({
  paths: all.map((f) => relative(DIST, f)),
  read: (path) => readFileSync(join(DIST, path), 'latin1'),
});
if (found.length) {
  console.error(found.join('\n'));
  process.exit(1);
}
console.log(`dist/ is free of the Debug panel (${all.length} files checked)`);
