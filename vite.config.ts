import { defineConfig, loadEnv, type Plugin } from 'vite';
import { readCloudConfig } from './src/storage/cloud-config.ts';

/**
 * The built page's Content-Security-Policy. GitHub Pages sends no headers, so it
 * rides in a meta tag placed first in `<head>`. `default-src 'none'` makes every
 * kind of load not listed here a violation. The game is text and same-origin
 * script and style only; widen this list only when a feature needs it (the cloud
 * save's one server is the only network origin).
 *
 * Not settable from a meta tag (accepted): `frame-ancestors`, `report-uri`, `sandbox`.
 */
export function buildCsp(cloudOrigin: string | null = null): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    // The cloud save's project origin, only when the build is configured for it (§11).
    ["connect-src 'self'", cloudOrigin].filter(Boolean).join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The cloud origin the build is configured with; null (no change to the CSP) when missing or malformed. */
const cloud = readCloudConfig(loadEnv('production', process.cwd(), 'VITE_'));
const CSP = buildCsp(cloud?.url ?? null);

/** Build only: the dev server's hot reload needs inline script and a websocket. */
const cspMeta: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  plugins: [cspMeta],
  // Relative asset URLs so the same build works at the site root (local preview)
  // and under the repository sub-path on GitHub Pages.
  base: './',
});
