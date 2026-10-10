// Browser glue for the tab HUD (docs/design.md §10): the favicon link, the
// optional Immortal-drop notification and the Document Picture-in-Picture
// pop-out. Each feature is skipped where the browser lacks it, and a refused
// permission or a throwing API leaves the game running.

/** Points the page's icon link at `href`, adding the link the first time. */
export function setFavicon(doc: Document, href: string): void {
  let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.append(link);
  }
  if (link.getAttribute('href') !== href) link.href = href;
}

export type NoticeState = 'unsupported' | 'blocked' | 'off' | 'on';

/** The Immortal-drop notification: off until the player turns it on with a click. */
export interface Notifier {
  state(): NoticeState;
  /** Turns it on (asking for permission the first time) or off. Call only from a click. */
  toggle(): Promise<void>;
  /** `tag` names the kind of notice: a newer one of the same kind replaces it. */
  show(notice: { title: string; body: string; tag: string }): void;
}

export function notifier(win: Window): Notifier {
  const api =
    'Notification' in win
      ? (win as Window & { Notification: typeof Notification }).Notification
      : null;
  // Permission granted earlier came from this toggle, so it starts on.
  let on = api?.permission === 'granted';
  return {
    state() {
      if (!api) return 'unsupported';
      if (api.permission === 'denied') return 'blocked';
      return on && api.permission === 'granted' ? 'on' : 'off';
    },
    async toggle() {
      if (!api) return;
      if (on) {
        on = false;
        return;
      }
      try {
        // Permission is read back below either way: an old callback-style
        // browser returns at once, so the player clicks again once they answer.
        if (api.permission === 'default') await api.requestPermission();
      } catch {
        // A browser that throws here simply leaves notifications off.
      }
      on = api.permission === 'granted';
    },
    show(notice) {
      if (!api || !on || api.permission !== 'granted') return;
      try {
        // One tag per kind, so a burst of drops replaces rather than stacks.
        new api(notice.title, { body: notice.body, tag: `office-immortal-${notice.tag}` });
      } catch {
        // Some mobile browsers only notify through a service worker; skip it.
      }
    },
  };
}

interface PictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

function pictureInPicture(win: Window): PictureInPicture | null {
  return 'documentPictureInPicture' in win
    ? (win as Window & { documentPictureInPicture: PictureInPicture }).documentPictureInPicture
    : null;
}

/** Whether this browser can pop the Mini view out (Chromium's Document Picture-in-Picture). */
export function canPopOut(win: Window): boolean {
  return pictureInPicture(win) !== null;
}

/** The Mini view's size: about 3:1 (docs/design.md §14). */
const POP_OUT = { width: 480, height: 160 };

/**
 * Opens an always-on-top window showing what `build` returns, with the page's
 * styles. `build` runs only once the window exists, so a refusal moves nothing.
 * `onClose` gets the window when it closes, by the player or by close(). Call
 * from a click. Resolves to the window, or null when the browser refuses it or
 * it fails to fill (then it is closed again).
 */
export async function popOut(
  win: Window,
  build: () => HTMLElement,
  onClose: (pip: Window) => void,
): Promise<Window | null> {
  const api = pictureInPicture(win);
  if (!api) return null;
  let pip: Window;
  try {
    pip = await api.requestWindow(POP_OUT);
  } catch {
    return null;
  }
  try {
    copyStyles(win.document, pip.document);
    pip.document.documentElement.lang = win.document.documentElement.lang;
    const theme = win.document.documentElement.dataset.theme;
    if (theme) pip.document.documentElement.dataset.theme = theme;
    pip.document.title = win.document.title;
    pip.document.body.className = 'popped';
    pip.document.body.append(build());
  } catch {
    pip.close();
    return null;
  }
  pip.addEventListener('pagehide', () => onClose(pip), { once: true });
  return pip;
}

/**
 * Copies the page's stylesheets into the pop-out. A linked sheet is linked again,
 * since the pop-out inherits the page's Content-Security-Policy, which allows
 * same-origin stylesheets but no inline style. Sheets with no URL (the dev
 * server's, which has no CSP) are copied rule by rule.
 */
function copyStyles(from: Document, to: Document): void {
  for (const sheet of from.styleSheets) {
    if (sheet.href) {
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      to.head.append(link);
      continue;
    }
    let rules: string;
    try {
      rules = [...sheet.cssRules].map((r) => r.cssText).join('\n');
    } catch {
      // An unreadable sheet (say, injected cross-origin by an extension) is skipped.
      continue;
    }
    const style = to.createElement('style');
    style.textContent = rules;
    to.head.append(style);
  }
}
