// The cloud link code on itch.io (docs/design.md §11, "Cloud save on itch.io").
// Anything that scripts the itch.io game page (another game on itch.io's
// shared origin, through a popup of our page) could read a link code there and
// join the player's cloud save with it. So the game page never sees one. It
// shows visible frames of store.html on our GitHub Pages origin instead:
// - the code frame (CODE_HASH) makes a code on a real click inside it and
//   shows it there, with the cloud session the storage frame keeps (same
//   origin, same storage), and posts nothing;
// - the link frame (LINK_HASH) takes a code from another device and hands it
//   straight to the storage frame beside it, which links as before.
// Both answer only where the storage frame would. Pure apart from what is
// passed in; store-main.ts puts them on the page.

import { describeError, type Cloud, type CloudMessage } from '../storage/cloud.ts';
import { LINK_PROTOCOL, readLinkDone } from '../storage/frame-protocol.ts';
import { allowedParent, storageWorks } from '../storage/frame-host.ts';
import type { SaveStorage } from '../storage/save.ts';
import { cloudText, linkCodeLine, type CodeLine } from './cloud-view.ts';
import { readLang, setLang, t } from './i18n.ts';

/** What the frame shows: its one button and the line under it (a code, or a message). */
export interface CodeView {
  label: string;
  busy: boolean;
  /** The message under the button, when there is no code to show. */
  line: string;
  code: CodeLine | null;
}

export interface CodeFrameDeps {
  /** `location.ancestorOrigins` as a list; null where the browser lacks it. */
  ancestors: readonly string[] | null;
  /** The itch.io page allowed to embed the frame (frame-config.ts). */
  itchOrigin: string | null;
  /** The frame's browser storage, shared with the storage frame; null where blocked. */
  storage: SaveStorage | null;
  /** The browser's languages, for a player who never picked one. */
  languages: readonly string[];
  /** Makes the cloud on that storage; null when the build has no cloud save. */
  makeCloud: ((storage: SaveStorage) => Pick<Cloud, 'createLinkCode'>) | null;
  show(view: CodeView): void;
}

export interface CodeFrame {
  /** The button was pressed; `trusted` is the click's isTrusted (a script's click makes no code). */
  press(trusted: boolean): Promise<void>;
  /** Words it again, in the language now stored (the player switched it in the game). */
  redraw(): void;
}

/** The frame's storage when it may show anything (where the storage frame would answer), else null. */
function allowed(deps: Pick<CodeFrameDeps, 'ancestors' | 'itchOrigin' | 'storage'>) {
  if (!allowedParent(deps.ancestors, deps.itchOrigin)) return null;
  return storageWorks(deps.storage) ? deps.storage : null;
}

/** The link code frame, or null (showing nothing) where the storage frame wouldn't answer. */
export function createCodeFrame(deps: CodeFrameDeps): CodeFrame | null {
  const storage = deps.makeCloud ? allowed(deps) : null;
  if (!storage || !deps.makeCloud) return null;
  const cloud = deps.makeCloud(storage);
  let busy = false;
  /** The code on show, or why there is none; kept so a language switch can word it again. */
  let shown: { code: string; ttl: number } | { message: CloudMessage } | null = null;

  function redraw(): void {
    setLang(readLang(storage, deps.languages));
    const code = shown && 'code' in shown ? linkCodeLine(shown.code, shown.ttl) : null;
    const line = shown && 'message' in shown ? cloudText(shown.message) : '';
    deps.show({ label: t('cloud.getCode'), busy, line, code });
  }

  async function press(trusted: boolean): Promise<void> {
    if (!trusted || busy) return;
    busy = true;
    shown = null;
    redraw();
    try {
      shown = await cloud.createLinkCode();
    } catch (e) {
      shown = { message: describeError(e) };
    }
    busy = false;
    redraw();
  }

  redraw();
  return { press, redraw };
}

/** What the link frame shows: a field, its button and the line under them. */
export interface LinkView {
  /** The field's accessible name; the game shows the caption beside the frame. */
  field: string;
  label: string;
  busy: boolean;
  line: string;
}

export interface LinkFrameDeps extends Pick<
  CodeFrameDeps,
  'ancestors' | 'itchOrigin' | 'storage' | 'languages'
> {
  /** Whether the build has the cloud save. */
  cloud: boolean;
  /** Hands the code to the storage frame; settles when that attempt has ended. */
  send(code: string): Promise<void>;
  show(view: LinkView): void;
}

export interface LinkFrame {
  /** The button was pressed with `typed` in the field; true when it was sent (clear the field). */
  press(trusted: boolean, typed: string): Promise<boolean>;
  redraw(): void;
}

/** The longest code taken from the field (a real one is 10 characters, with spaces or dashes). */
export const LINK_FIELD_MAX = 32;

/** The frame taking a link code from another device, or null where the storage frame wouldn't answer. */
export function createLinkFrame(deps: LinkFrameDeps): LinkFrame | null {
  const storage = deps.cloud ? allowed(deps) : null;
  if (!storage) return null;
  let busy = false;

  function redraw(): void {
    setLang(readLang(storage, deps.languages));
    deps.show({
      field: t('cloud.linkField'),
      label: t('cloud.link'),
      busy,
      line: busy ? t('cloud.linking') : '',
    });
  }

  async function press(trusted: boolean, typed: string): Promise<boolean> {
    const code = typed.trim();
    if (!trusted || busy || !code || code.length > LINK_FIELD_MAX) return false;
    busy = true;
    redraw();
    // How it went comes back to the game as a status or a note, as before.
    await deps.send(code);
    busy = false;
    redraw();
    return true;
  }

  redraw();
  return { press, redraw };
}

/** A link attempt (several requests of up to 10 s each) not answered by then is given up on. */
export const LINK_WAIT_MS = 60_000;

export interface SenderDeps {
  /** The game page's other frames; the storage frame is one (store-main.ts). */
  siblings(): readonly { postMessage(message: unknown, targetOrigin: string): void }[];
  /** This frame's origin: the only one the code is posted to and an answer taken from. */
  origin: string;
  /** Listens to messages posted to this frame; returns the way to stop. */
  listen(fn: (e: { data: unknown; origin: string }) => void): () => void;
}

/**
 * Hands a typed code to the storage frame beside this one, at this origin only
 * (no frame on another origin gets it); settles on its answer to this attempt,
 * or after LINK_WAIT_MS. An answer to an earlier attempt doesn't count.
 */
export function linkSender(deps: SenderDeps): (code: string) => Promise<void> {
  let attempt = 0;
  return (code) =>
    new Promise((resolve) => {
      const n = ++attempt;
      const done = (): void => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const stop = deps.listen((e) => {
        if (e.origin === deps.origin && readLinkDone(e.data) === n) done();
      });
      const timer = setTimeout(done, LINK_WAIT_MS);
      for (const f of deps.siblings()) f.postMessage({ p: LINK_PROTOCOL, code, n }, deps.origin);
    });
}
