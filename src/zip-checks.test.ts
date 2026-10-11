import { describe, expect, it } from 'vitest';
import { cloudProblems } from '../tools/zip-checks.mjs';
import { buildCsp } from '../vite.config.ts';

const FRAME = 'https://ourname.github.io';
/** dist/index.html as Vite writes it: the CSP in a meta tag, quotes as &#39;. */
const page = (csp: string): string =>
  `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll("'", '&#39;')}">`;

function check(html: string, files: Record<string, string> = {}): string[] {
  const all: Record<string, string> = { 'index.html': html, ...files };
  return cloudProblems({ html, paths: Object.keys(all), read: (p) => all[p] ?? '' });
}

describe('npm run zip: the itch.io build', () => {
  it('passes with the storage frame and nothing else of the cloud', () => {
    expect(check(page(buildCsp(null, FRAME)), { 'assets/index.js': 'const a = 1;' })).toEqual([]);
  });

  it('refuses a build with the cloud save in it', () => {
    expect(check(page(buildCsp('https://abcdefghij.supabase.co', FRAME)))).toEqual([
      'The build has the cloud save in it: rebuild without VITE_SUPABASE_URL',
      'index.html has a cloud project address: rebuild without VITE_SUPABASE_URL',
    ]);
  });

  it('refuses a build without the storage frame', () => {
    expect(check(page(buildCsp()))[0]).toMatch(/no storage frame/);
  });

  it('refuses any other frame origin, or more than one', () => {
    for (const origin of [
      'https://evil.example',
      'http://ourname.github.io',
      'https://ourname.github.io.evil.example',
      '*',
      `${FRAME} https://evil.example`,
    ]) {
      expect(check(page(buildCsp(null, origin)))).not.toEqual([]);
    }
    const twice = page(`${buildCsp(null, FRAME)}; frame-src ${FRAME}`);
    expect(check(twice)).not.toEqual([]);
  });

  it('refuses a build that carries its own frame page', () => {
    expect(check(page(buildCsp(null, FRAME)), { 'store.html': '<html>' })[0]).toMatch(
      /own storage frame page/,
    );
  });

  it('refuses a cloud project address anywhere in the files, but not the config pattern', () => {
    const html = page(buildCsp(null, FRAME));
    expect(check(html, { 'assets/a.js': 'fetch("https://abcdefghij.supabase.co/rest")' })).toEqual([
      'assets/a.js has a cloud project address: rebuild without VITE_SUPABASE_URL',
    ]);
    expect(
      check(html, { 'assets/a.js': '/^https:\\/\\/[a-z0-9]{8,40}\\.supabase\\.co$/' }),
    ).toEqual([]);
  });
});
