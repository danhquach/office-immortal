// CI's version checks (tools/version-checks.mjs).
//   node tools/version-check.mjs bump <base-ref>  a PR raises the version over <base-ref>'s
//   node tools/version-check.mjs tag <tag>        a release tag names the version it ships
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { bumpProblems, tagProblems } from './version-checks.mjs';

const version = (text) => JSON.parse(text).version;
const head = version(readFileSync('package.json', 'utf8'));
const [mode, ref] = process.argv.slice(2);

let found;
if (mode === 'bump' && ref) {
  const base = version(execFileSync('git', ['show', `${ref}:package.json`], { encoding: 'utf8' }));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  found = bumpProblems({ base, head, locks: [lock.version, lock.packages?.['']?.version] });
} else if (mode === 'tag' && ref) {
  found = tagProblems({ tag: ref, version: head });
} else {
  console.error('usage: node tools/version-check.mjs bump <base-ref> | tag <tag>');
  process.exit(2);
}
if (found.length) {
  console.error(found.join('\n'));
  process.exit(1);
}
console.log(`version ${head} ok`);
