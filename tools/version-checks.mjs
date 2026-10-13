// The game's version checks (package.json "version", shown in the status bar),
// apart from git and the file system so they can be tested. Every PR to main
// raises the version, so each live build shows a new number; a release tag
// names the version it ships.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** [major, minor, patch], or null when `v` isn't a plain x.y.z version. */
function parts(v) {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Why a PR's version may not land on main; empty when it may.
 * @param {{ base: string, head: string, locks: string[] }} versions
 *   `base` is main's version, `head` the PR's, `locks` the versions the PR's
 *   package-lock.json names (its own and its root package's).
 * @returns {string[]}
 */
export function bumpProblems({ base, head, locks }) {
  const problems = [];
  const b = parts(base);
  const h = parts(head);
  if (!h) problems.push(`The version "${head}" is not x.y.z`);
  const stale = locks.filter((v) => v !== head);
  if (stale.length) {
    problems.push(
      `package-lock.json says ${stale.join(', ')}, package.json ${head}: run npm install`,
    );
  }
  if (h && b) {
    const higher = h[0] - b[0] || h[1] - b[1] || h[2] - b[2];
    if (higher <= 0) {
      problems.push(
        `The version ${head} is not higher than main's ${base}: raise it (npm version patch --no-git-tag-version)`,
      );
    }
  }
  return problems;
}

/**
 * Why a release tag doesn't match the version it would ship; empty when it does.
 * @param {{ tag: string, version: string }} release
 * @returns {string[]}
 */
export function tagProblems({ tag, version }) {
  return tag === `v${version}`
    ? []
    : [`The tag ${tag} ships version ${version}: tag v${version} instead`];
}
