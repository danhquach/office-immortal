// The itch.io build's safety checks for npm run zip (docs/design.md §11, "Cloud
// save on itch.io"), apart from the file system so they can be tested. The
// cloud save reaches itch.io only through the storage frame on GitHub Pages:
// the build may name that one frame origin, and nothing else of the cloud.

/** A cloud project address; the config check's own pattern (with backslashes) doesn't match. */
const PROJECT = /https:\/\/[a-z0-9]{8,40}\.supabase\.co/;
const FRAME_ORIGIN = /^https:\/\/[a-z0-9-]+\.github\.io$/;

/**
 * Why the build must not go to itch.io; empty when it may.
 * @param {{ html: string, paths: string[], read: (path: string) => string }} build
 *   `html` is dist/index.html, `paths` every file under dist/ (relative), `read` a file's text.
 * @returns {string[]}
 */
export function cloudProblems({ html, paths, read }) {
  const problems = [];
  const csp = html.replaceAll('&#39;', "'");
  // The CSP lists the cloud origin in connect-src only when the build has the cloud save.
  if (!csp.includes("connect-src 'self';")) {
    problems.push('The build has the cloud save in it: rebuild without VITE_SUPABASE_URL');
  }
  // Exactly one frame origin, a GitHub Pages one: the storage frame.
  const frames = [...csp.matchAll(/frame-src ([^;"]*)/g)].map((m) => m[1].trim());
  if (frames.length === 0) {
    problems.push('The build has no storage frame: rebuild with VITE_STORE_FRAME_URL');
  } else if (frames.length > 1 || !FRAME_ORIGIN.test(frames[0])) {
    problems.push(`The build frames something other than the storage frame: ${frames.join(', ')}`);
  }
  if (paths.includes('store.html')) {
    problems.push('The build has its own storage frame page: rebuild with VITE_STORE_FRAME_URL');
  }
  for (const path of paths) {
    if (/\.(html|js|css|json|map)$/.test(path) && PROJECT.test(read(path))) {
      problems.push(`${path} has a cloud project address: rebuild without VITE_SUPABASE_URL`);
    }
  }
  return problems;
}
