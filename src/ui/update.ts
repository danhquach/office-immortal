// Moving onto a newer release of the game (docs/design.md §11, "Updates").
// The GitHub Pages build knows its own build id and checks the one the site
// serves now (version.json, made by the build); when a newer one is out, or a
// save from a later release turns up, the page reloads itself at a safe moment.
// A reload is tried once per build: if the page comes back on the same build
// (a cached or blocked update), it asks the player to reload instead of trying
// again. The itch.io build never reloads itself: its game page is one upload,
// so a reload brings back the same build.

import type { SaveStorage } from '../storage/save.ts';
import { MAX_PASTE_CHARS } from '../storage/transfer.ts';

/** Made by the build next to index.html: `{"build":"<id>"}`. */
export const VERSION_FILE = 'version.json';
/** Session storage: the build a reload to update left from, so a reload that changed nothing isn't tried again. */
export const UPDATE_KEY = 'office-immortal.update-from';
/** Session storage: a save code from a later release, imported again once the page runs it. */
export const IMPORT_KEY = 'office-immortal.import';
/** How often the page asks whether a new release is out, while it is in front. */
export const CHECK_EVERY_MS = 15 * 60_000;
/** A real build id: the commit it was built from. Anything else (a dev build) never checks. */
const BUILD_ID = /^[0-9a-f]{7,40}$/;
/** version.json is a few dozen characters; a longer reply is not ours and is not parsed. */
const MAX_VERSION_CHARS = 200;
const REQUEST_TIMEOUT_MS = 10_000;

export function isBuildId(v: unknown): v is string {
  return typeof v === 'string' && BUILD_ID.test(v);
}

/** The build id in version.json's text, or null for anything else. */
export function readVersion(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > MAX_VERSION_CHARS) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    if (Object.getPrototypeOf(v) !== Object.prototype) return null;
    const keys = Object.keys(v);
    if (keys.length !== 1 || keys[0] !== 'build') return null;
    const build = (v as { build: unknown }).build;
    return isBuildId(build) ? build : null;
  } catch {
    return null;
  }
}

/** The build the site serves now, or null when it can't be told (offline, no file, anything off). */
export async function servedBuild(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
): Promise<string | null> {
  try {
    const res = await fetch(VERSION_FILE, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return readVersion(await capped(res, MAX_VERSION_CHARS));
  } catch {
    return null;
  }
}

/** The reply's text, or null once it passes `max` bytes (read no further, whatever it claims). */
async function capped(res: Response, max: number): Promise<string | null> {
  if (Number(res.headers.get('content-length')) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * What a wanted update does now: nothing (none wanted, or the page can't
 * reload), reload at once (no run to lose), wait (the player is in the middle
 * of a choice), or save the run and reload only if the save was written.
 */
export function updateStep(s: {
  wanted: boolean;
  canReload: boolean;
  playing: boolean;
  choosing: boolean;
}): 'none' | 'reload' | 'wait' | 'save' {
  if (!s.wanted || !s.canReload) return 'none';
  if (!s.playing) return 'reload';
  return s.choosing ? 'wait' : 'save';
}

/**
 * Whether a newer save keeps the game from starting a run (whose autosave would
 * write over it). The one exception: the itch.io build running on itch.io's
 * shared storage without its frame, where any other game can plant a "newer"
 * save; there a readable save of this build's is played (that storage is never
 * preferred over the frame's anyway).
 */
export function holdsStart(s: { newer: boolean; readable: boolean; shared: boolean }): boolean {
  return s.newer && !(s.shared && s.readable);
}

/**
 * The save code an import kept for after the reload, removed as it is read;
 * null when there is none, it is longer than any paste, or `allowed` is false
 * (the itch.io build: that session storage is shared with every other game on
 * itch.io, so nothing there is ours to read or remove). The code still goes
 * through the import allow-list and needs the player's yes.
 */
export function takeKept(session: SaveStorage | null, allowed: boolean): string | null {
  if (!allowed || !session) return null;
  try {
    const code = session.getItem(IMPORT_KEY);
    session.removeItem(IMPORT_KEY);
    return code !== null && code.length <= MAX_PASTE_CHARS ? code : null;
  } catch {
    return null;
  }
}

export interface Updater {
  /** Whether this page may reload itself onto the newest release now. */
  readonly canReload: boolean;
  /** Whether `served` is a different build from this page's (a newer release is out). */
  isNew(served: string | null): boolean;
  /** Reloads to update, once per build; false (nothing done) when it may not. */
  reload(): boolean;
}

export interface UpdaterDeps {
  /** This page's build id ('dev' outside CI). */
  build: string;
  /** False where a reload brings back the same build (the itch.io build). */
  selfUpdates: boolean;
  /** Per-tab storage for the loop guard; null where it is blocked. */
  session: SaveStorage | null;
  reload(): void;
}

/** Whether `session` keeps what is written to it; without that no reload is guarded. */
function keeps(session: SaveStorage | null): boolean {
  const probe = 'office-immortal.probe';
  try {
    session?.setItem(probe, '1');
    const kept = session?.getItem(probe) === '1';
    session?.removeItem(probe);
    return kept;
  } catch {
    return false;
  }
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { build, session } = deps;
  let from: string | null = null;
  try {
    from = session?.getItem(UPDATE_KEY) ?? null;
    // The last reload reached another build: the guard has done its job.
    if (from !== null && from !== build) session?.removeItem(UPDATE_KEY);
  } catch {
    // Blocked: no guard can be kept, so reload() refuses (below).
  }
  /** This tab already reloaded from this very build, and got it back. */
  const tried = from === build;
  const canReload = deps.selfUpdates && !tried && keeps(session);
  let reloading = false;
  return {
    canReload,
    isNew(served) {
      return isBuildId(build) && served !== null && served !== build;
    },
    reload() {
      if (!canReload || reloading) return false;
      try {
        // Fails closed: without the guard a reload that changes nothing could repeat forever.
        session?.setItem(UPDATE_KEY, build);
        if (session?.getItem(UPDATE_KEY) !== build) return false;
      } catch {
        return false;
      }
      reloading = true;
      deps.reload();
      return true;
    },
  };
}
