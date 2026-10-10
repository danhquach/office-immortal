import { describe, expect, it, vi } from 'vitest';
import { canPopOut, notifier, popOut, setFavicon } from './tab.ts';

type Perm = NotificationPermission;

/** A stand-in for window.Notification: records what was shown, answers prompts with `answer`. */
function fakeNotification(start: Perm, answer: Perm | Error = start) {
  const shown: { title: string; body?: string }[] = [];
  const api = Object.assign(
    function (this: unknown, title: string, options?: NotificationOptions) {
      shown.push({ title, body: options?.body });
    },
    {
      permission: start,
      requestPermission: vi.fn(async () => {
        if (answer instanceof Error) throw answer;
        api.permission = answer;
        return answer;
      }),
    },
  );
  return { api, shown, win: { Notification: api } as unknown as Window };
}

const notice = { title: 'Office Immortal', body: 'Immortal-grade drop on floor 3' };

describe('notifier', () => {
  it('is unsupported, and does nothing, without the API', async () => {
    const n = notifier({} as Window);
    expect(n.state()).toBe('unsupported');
    await n.toggle();
    n.show(notice);
    expect(n.state()).toBe('unsupported');
  });

  it('starts off and never prompts on its own', () => {
    const f = fakeNotification('default', 'granted');
    const n = notifier(f.win);
    n.show(notice);
    expect(n.state()).toBe('off');
    expect(f.api.requestPermission).not.toHaveBeenCalled();
    expect(f.shown).toEqual([]);
  });

  it('asks on the toggle, then shows notices once granted', async () => {
    const f = fakeNotification('default', 'granted');
    const n = notifier(f.win);
    await n.toggle();
    expect(f.api.requestPermission).toHaveBeenCalledTimes(1);
    expect(n.state()).toBe('on');
    n.show(notice);
    expect(f.shown).toEqual([notice]);
  });

  it('turns off again on a second toggle', async () => {
    const f = fakeNotification('granted');
    const n = notifier(f.win);
    expect(n.state()).toBe('on');
    await n.toggle();
    expect(n.state()).toBe('off');
    n.show(notice);
    expect(f.shown).toEqual([]);
  });

  it('stays quiet when the player denies', async () => {
    const f = fakeNotification('default', 'denied');
    const n = notifier(f.win);
    await n.toggle();
    expect(n.state()).toBe('blocked');
    n.show(notice);
    expect(f.shown).toEqual([]);
  });

  it('does not prompt again once blocked', async () => {
    const f = fakeNotification('denied');
    const n = notifier(f.win);
    await n.toggle();
    expect(f.api.requestPermission).not.toHaveBeenCalled();
    expect(n.state()).toBe('blocked');
  });

  it('stays off when the prompt throws or is dismissed', async () => {
    const thrown = fakeNotification('default', new Error('no'));
    const a = notifier(thrown.win);
    await expect(a.toggle()).resolves.toBeUndefined();
    expect(a.state()).toBe('off');

    const dismissed = fakeNotification('default', 'default');
    const b = notifier(dismissed.win);
    await b.toggle();
    expect(b.state()).toBe('off');
  });

  it('goes quiet if permission is revoked later', () => {
    const f = fakeNotification('granted');
    const n = notifier(f.win);
    f.api.permission = 'denied';
    n.show(notice);
    expect(n.state()).toBe('blocked');
    expect(f.shown).toEqual([]);
  });

  it('swallows a constructor that throws', () => {
    const win = {
      Notification: Object.assign(
        function () {
          throw new TypeError('Illegal constructor');
        },
        { permission: 'granted', requestPermission: async () => 'granted' },
      ),
    } as unknown as Window;
    expect(() => notifier(win).show(notice)).not.toThrow();
  });
});

describe('pop-out', () => {
  it('is offered only where Document Picture-in-Picture exists', () => {
    expect(canPopOut({} as Window)).toBe(false);
    expect(canPopOut({ documentPictureInPicture: {} } as unknown as Window)).toBe(true);
  });

  it('gives null, and builds nothing, without the API or when the window is refused', async () => {
    const build = vi.fn(() => ({}) as HTMLElement);
    const onClose = vi.fn();
    expect(await popOut({} as Window, build, onClose)).toBeNull();
    const refusing = {
      documentPictureInPicture: {
        requestWindow: () => Promise.reject(new DOMException('no activation', 'NotAllowedError')),
      },
    } as unknown as Window;
    expect(await popOut(refusing, build, onClose)).toBeNull();
    expect(build).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  type Node = { tag: string; rel?: string; href?: string; textContent?: string };

  /** A pop-out window stand-in recording what goes into its head and body. */
  function fakePip(append?: (n: unknown) => void) {
    const head: Node[] = [];
    const body: unknown[] = [];
    const listeners: Record<string, () => void> = {};
    const pip = {
      closed: false,
      close: vi.fn(() => {
        pip.closed = true;
      }),
      document: {
        title: '',
        documentElement: { lang: '' },
        head: { append: (n: Node) => head.push(n) },
        body: { className: '', append: append ?? ((n: unknown) => body.push(n)) },
        createElement: (tag: string): Node => ({ tag }),
      },
      addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
    };
    return { pip, head, body, listeners };
  }

  function page(pip: unknown, styleSheets: unknown[] = []): Window {
    return {
      document: {
        title: 'F3 · Office Immortal',
        documentElement: { lang: 'en' },
        styleSheets,
      },
      documentPictureInPicture: { requestWindow: async () => pip },
    } as unknown as Window;
  }

  it('opens with the page styles, the content and a close hook', async () => {
    const { pip, head, body, listeners } = fakePip();
    const unreadable = {
      href: null,
      get cssRules(): never {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    };
    const win = page(pip, [
      { href: 'http://localhost/assets/page.css', cssRules: [] },
      { href: null, cssRules: [{ cssText: '.a{color:red}' }, { cssText: '.b{}' }] },
      unreadable,
    ]);
    const content = { id: 'mini' } as unknown as HTMLElement;
    const onClose = vi.fn();

    expect(await popOut(win, () => content, onClose)).toBe(pip);
    expect(head).toEqual([
      { tag: 'link', rel: 'stylesheet', href: 'http://localhost/assets/page.css' },
      { tag: 'style', textContent: '.a{color:red}\n.b{}' },
    ]);
    expect(body).toEqual([content]);
    expect(pip.document.title).toBe('F3 · Office Immortal');
    expect(pip.document.documentElement.lang).toBe('en');
    expect(pip.document.body.className).toBe('popped');
    expect(onClose).not.toHaveBeenCalled();
    listeners.pagehide?.();
    expect(onClose).toHaveBeenCalledExactlyOnceWith(pip);
  });

  it('closes the window and gives null when filling it throws', async () => {
    const { pip, listeners } = fakePip(() => {
      throw new DOMException('gone', 'InvalidStateError');
    });
    const onClose = vi.fn();
    expect(await popOut(page(pip), () => ({}) as HTMLElement, onClose)).toBeNull();
    expect(pip.close).toHaveBeenCalledTimes(1);
    expect(listeners.pagehide).toBeUndefined();
  });
});

describe('setFavicon', () => {
  function fakeDoc(existing: { href: string } | null) {
    const added: { rel?: string; href?: string }[] = [];
    let writes = 0;
    const wrap = (link: { href: string; rel?: string }) =>
      new Proxy(link, {
        set(target, key, value) {
          if (key === 'href') writes += 1;
          return Reflect.set(target, key, value);
        },
        get(target, key) {
          if (key === 'getAttribute') return () => target.href ?? null;
          return Reflect.get(target, key);
        },
      });
    let link = existing ? wrap(existing) : null;
    const doc = {
      querySelector: () => link,
      createElement: () => wrap({ href: '' }),
      head: {
        append: (n: { href: string }) => {
          link = n;
          added.push(n);
        },
      },
    } as unknown as Document;
    return { doc, added, writes: () => writes };
  }

  it('adds the icon link once, then only rewrites a changed href', () => {
    const f = fakeDoc(null);
    setFavicon(f.doc, 'data:a');
    expect(f.added).toHaveLength(1);
    expect(f.added[0]).toMatchObject({ rel: 'icon', href: 'data:a' });
    setFavicon(f.doc, 'data:a');
    expect(f.writes()).toBe(1);
    setFavicon(f.doc, 'data:b');
    expect(f.writes()).toBe(2);
    expect(f.added).toHaveLength(1);
  });
});
