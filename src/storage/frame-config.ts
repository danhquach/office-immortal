// Where the storage frame lives and who may use it, from build-time env
// (docs/design.md §11, "Cloud save on itch.io"). Both values are public: the
// itch.io build names the frame page on GitHub Pages, and the GitHub Pages
// build names the itch.io page allowed to embed it. Anything that isn't exactly
// the expected shape means no frame: the itch.io build keeps its own local
// save, and the frame page answers no one.

/** The frame page: https://<user>.github.io[/<path>]/store.html, no query or fragment. */
const FRAME_URL =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.github\.io(?:\/[A-Za-z0-9._-]+)*\/store\.html$/;
/** The itch.io page origin: https://<user>.itch.io, no path. */
const ITCH_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.itch\.io$/;

/** Added to the frame's address, it shows the cloud link code instead (ui/code-frame.ts). */
export const CODE_HASH = '#code';
/** Added to the frame's address, it takes a link code from another device (ui/code-frame.ts). */
export const LINK_HASH = '#link';

export interface FrameConfig {
  /** The frame page's address. */
  readonly url: string;
  /** Its origin, the only one messages go to or are taken from. */
  readonly origin: string;
}

/** The itch.io build's frame (VITE_STORE_FRAME_URL), or null when missing or malformed. */
export function readFrameConfig(env: Readonly<Record<string, unknown>>): FrameConfig | null {
  const url = env.VITE_STORE_FRAME_URL;
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!FRAME_URL.test(u) || u.includes('..')) return null;
  return { url: u, origin: new URL(u).origin };
}

/** The itch.io page the frame answers for (VITE_ITCH_PAGE_ORIGIN), or null when missing or malformed. */
export function readItchOrigin(env: Readonly<Record<string, unknown>>): string | null {
  const origin = env.VITE_ITCH_PAGE_ORIGIN;
  if (typeof origin !== 'string') return null;
  const o = origin.trim().replace(/\/$/, '');
  return ITCH_ORIGIN.test(o) ? o : null;
}
