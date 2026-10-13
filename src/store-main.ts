// The storage frame page (store.html, docs/design.md §11 "Cloud save on
// itch.io"): runs on GitHub Pages inside the itch.io game and keeps its save
// and cloud save here, out of reach of other games on itch.io's origin. It has
// no visible content and answers only our own itch.io page (frame-host.ts).
// With CODE_HASH or LINK_HASH it is instead a visible frame in the game that
// shows a link code or takes one (ui/code-frame.ts), on this origin's storage.

import { browserIdb, idbBackup } from './storage/backup.ts';
import { createCloud } from './storage/cloud.ts';
import { readCloudConfig } from './storage/cloud-config.ts';
import { CODE_HASH, LINK_HASH, readItchOrigin } from './storage/frame-config.ts';
import { createHost } from './storage/frame-host.ts';
import { browserStorage, type SaveStorage } from './storage/save.ts';
import { createSync } from './storage/sync.ts';
import { createCodeFrame, createLinkFrame, LINK_FIELD_MAX, linkSender } from './ui/code-frame.ts';
import { showCodeLine } from './ui/code-line.ts';
import { lang, LANG_KEY } from './ui/i18n.ts';
import { readTheme, showTheme, THEME_KEY } from './ui/theme.ts';

const config = readCloudConfig(import.meta.env);
const ancestors = window.location.ancestorOrigins;
const storage = browserStorage();
const itchOrigin = readItchOrigin(import.meta.env);

/** The cloud on `s`; null when the build has no cloud save. */
const makeCloud = config
  ? (s: SaveStorage) =>
      createCloud({
        config,
        storage: s,
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        locks: navigator.locks
          ? { request: (name, callback) => navigator.locks.request(name, callback) }
          : null,
      })
  : null;

if (window.location.hash === CODE_HASH) showCode();
else if (window.location.hash === LINK_HASH) showLink();
else serve();

/** The game page's other frames: a link frame and the storage frame are siblings in it. */
function siblings(): Window[] {
  const frames = window.parent.frames;
  const out: Window[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f && f !== window) out.push(f);
  }
  return out;
}

/** Puts the game's theme on this page, and again whenever the game changes it. */
function follow(redraw: () => void): void {
  const osDark = window.matchMedia('(prefers-color-scheme: dark)');
  const paint = (): void =>
    showTheme([document.documentElement], readTheme(storage), osDark.matches);
  paint();
  osDark.addEventListener('change', paint);
  // The game's Settings write theme and language through the storage frame, on this origin.
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== storage || ![THEME_KEY, LANG_KEY, null].includes(e.key)) return;
    paint();
    redraw();
  });
}

function serve(): void {
  const host = createHost({
    ancestors: ancestors ? Array.from(ancestors) : null,
    itchOrigin,
    parent: window.parent,
    post: (message, origin) => window.parent.postMessage(message, origin),
    self: window.location.origin,
    isSibling: (source) => siblings().includes(source as Window),
    reply: (source, message) => (source as Window).postMessage(message, window.location.origin),
    storage,
    backup: idbBackup(browserIdb()),
    makeSync: makeCloud
      ? (tracked, hooks) =>
          createSync({
            cloud: makeCloud(tracked),
            storage: tracked,
            now: Date.now,
            visible: () => !document.hidden,
            ...hooks,
          })
      : null,
  });

  if (host) {
    window.addEventListener('message', (e) => host.receive(e));
    window.addEventListener('storage', (e) => {
      if (e.storageArea === storage) host.otherTab(e.key, e.newValue);
    });
  }
}

/** The link code frame: a button and a line, in the game's theme and language. */
function showCode(): void {
  const button = document.createElement('button');
  button.type = 'button';
  const line = document.createElement('p');
  line.className = 'muted';
  line.setAttribute('role', 'status');
  const frame = createCodeFrame({
    ancestors: ancestors ? Array.from(ancestors) : null,
    itchOrigin,
    storage,
    languages: navigator.languages,
    makeCloud,
    show(view) {
      document.documentElement.lang = lang().code;
      button.textContent = view.label;
      button.setAttribute('aria-disabled', String(view.busy));
      if (view.code) showCodeLine(line, view.code);
      else line.textContent = view.line;
    },
  });
  if (!frame) return;
  follow(() => frame.redraw());
  button.addEventListener('click', (e) => void frame.press(e.isTrusted));
  document.body.className = 'code-frame';
  document.body.append(button, line);
}

/** The link frame: a field for a code from another device, its button and a line. */
function showLink(): void {
  const row = document.createElement('div');
  row.className = 'cloud-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = LINK_FIELD_MAX;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const box = document.createElement('label');
  box.className = 'field';
  box.append(input);
  const button = document.createElement('button');
  button.type = 'button';
  row.append(box, button);
  const line = document.createElement('p');
  line.className = 'muted';
  line.setAttribute('role', 'status');
  const frame = createLinkFrame({
    ancestors: ancestors ? Array.from(ancestors) : null,
    itchOrigin,
    storage,
    languages: navigator.languages,
    cloud: config !== null,
    send: linkSender({
      siblings,
      origin: window.location.origin,
      listen(fn) {
        window.addEventListener('message', fn);
        return () => window.removeEventListener('message', fn);
      },
    }),
    show(view) {
      document.documentElement.lang = lang().code;
      input.setAttribute('aria-label', view.field);
      button.textContent = view.label;
      button.setAttribute('aria-disabled', String(view.busy));
      line.textContent = view.line;
    },
  });
  if (!frame) return;
  follow(() => frame.redraw());
  const go = (trusted: boolean): void => {
    void frame.press(trusted, input.value).then((sent) => {
      if (sent) input.value = '';
    });
  };
  button.addEventListener('click', (e) => go(e.isTrusted));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) go(e.isTrusted);
  });
  document.body.className = 'code-frame';
  document.body.append(row, line);
}
