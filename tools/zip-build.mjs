// Zips the production build (dist/) for an itch.io HTML5 upload: index.html at
// the zip root, and checked against itch.io's limits (1,000 files, 500 MB in
// all, 200 MB per file, 240-character paths) so a bad upload fails here, not
// on the site. Also refuses a build with the cloud save in it: itch.io serves
// every game from one shared origin, where another game could read the cloud
// sign-in token. Run `npm run build` first; writes office-immortal-web.zip.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const OUT = 'office-immortal-web.zip';
const LIMITS = { files: 1000, total: 500 * 2 ** 20, file: 200 * 2 ** 20, path: 240 };

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

if (!existsSync(join(DIST, 'index.html'))) {
  throw new Error(`${DIST}/index.html is missing: run npm run build first`);
}

// The build's CSP lists the cloud origin in connect-src only when it has the cloud save.
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!/connect-src &#39;self&#39;;|connect-src 'self';/.test(html)) {
  throw new Error('The build has the cloud save in it: rebuild without VITE_SUPABASE_URL');
}

const all = files(DIST);
const problems = [];
let total = 0;
for (const f of all) {
  const path = relative(DIST, f);
  const size = statSync(f).size;
  total += size;
  if (size > LIMITS.file) problems.push(`${path} is over 200 MB`);
  if (path.length > LIMITS.path) problems.push(`${path} has a path over 240 characters`);
}
if (all.length > LIMITS.files) problems.push(`${all.length} files, over 1,000`);
if (total > LIMITS.total) problems.push(`${total} bytes in all, over 500 MB`);
if (problems.length) throw new Error(`The build breaks itch.io's limits:\n${problems.join('\n')}`);

rmSync(OUT, { force: true });
// -X leaves out extra file attributes; run inside dist/ so index.html sits at the root.
execFileSync('zip', ['-qrX', join('..', OUT), '.'], { cwd: DIST, stdio: 'inherit' });
console.log(`${OUT}: ${all.length} files, ${(total / 2 ** 20).toFixed(1)} MB unzipped`);
