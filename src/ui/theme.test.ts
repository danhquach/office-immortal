import { describe, expect, it } from 'vitest';
import boot from '../../public/theme-boot.js?raw';
import html from '../../index.html?raw';
import { clearSave, SAVE_KEY } from '../storage/save.ts';
import { pickTheme, readTheme, resolveTheme, showTheme, THEME_KEY, writeTheme } from './theme.ts';

function store(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (k) => (k === THEME_KEY ? value : null) };
}

describe('readTheme', () => {
  it('is dark with nothing saved or no storage', () => {
    expect(readTheme(store(null))).toBe('dark');
    expect(readTheme(null)).toBe('dark');
  });

  it('reads each saved choice', () => {
    expect(readTheme(store('dark'))).toBe('dark');
    expect(readTheme(store('light'))).toBe('light');
    expect(readTheme(store('system'))).toBe('system');
  });

  it.each([
    ['empty', ''],
    ['wrong case', 'Light'],
    ['padded', ' light'],
    ['prototype key', '__proto__'],
    ['constructor', 'constructor'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['bidi override', 'light‮'],
    ['zero-width', 'li​ght'],
    ['look-alike', 'lіght'],
    ['JSON', '{"theme":"light"}'],
    ['oversized', 'light'.repeat(100_000)],
  ])('falls back to dark on a hostile value (%s)', (_, value) => {
    expect(readTheme(store(value))).toBe('dark');
  });

  it('falls back to dark when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readTheme(blocked)).toBe('dark');
  });
});

describe('writeTheme', () => {
  it('saves under the theme key', () => {
    const saved = new Map<string, string>();
    expect(writeTheme({ setItem: (k, v) => saved.set(k, v) }, 'light')).toBe(true);
    expect(saved.get(THEME_KEY)).toBe('light');
  });

  it('reports blocked or missing storage', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeTheme(full, 'light')).toBe(false);
    expect(writeTheme(null, 'light')).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('shows Dark and Light as chosen, whatever the OS says', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('follows the OS for Match system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('pickTheme', () => {
  it('takes only the three choices', () => {
    expect(pickTheme('light')).toBe('light');
    expect(pickTheme('system')).toBe('system');
    for (const v of ['', 'Light', '__proto__', '<b>light</b>', 'light​', null, undefined, 1, {}])
      expect(pickTheme(v)).toBe('dark');
  });
});

describe('showTheme', () => {
  it('puts the palette on every open document and skips a closed pop-out', () => {
    const page = { dataset: {} as DOMStringMap };
    const pip = { dataset: {} as DOMStringMap };
    showTheme([page, pip], 'light', true);
    expect(page.dataset.theme).toBe('light');
    expect(pip.dataset.theme).toBe('light');
    showTheme([page, undefined], 'system', true);
    expect(page.dataset.theme).toBe('dark');
  });
});

describe('first-paint script (public/theme-boot.js)', () => {
  const script = boot;

  /** Runs public/theme-boot.js with a saved value and an OS setting; returns data-theme. */
  function firstPaint(saved: string | null, osDark: boolean, blocked = false): string | undefined {
    const root = { dataset: {} as DOMStringMap };
    const storage = {
      getItem: (k: string) => {
        if (blocked) throw new Error('SecurityError');
        return k === THEME_KEY ? saved : null;
      },
    };
    // Test-only: run the repo's own boot script with stand-ins for its globals.
    new Function('localStorage', 'matchMedia', 'document', script as string)(
      storage,
      () => ({ matches: osDark }),
      { documentElement: root },
    );
    return root.dataset.theme;
  }

  it('loads as a classic script from the page head, before the app', () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
    expect(head).toContain('<script src="/theme-boot.js"></script>');
    // Inline script would be blocked by the build's CSP (script-src 'self').
    expect(html).not.toMatch(/<script>/);
  });

  it.each([
    [null, true],
    [null, false],
    ['dark', false],
    ['light', true],
    ['system', true],
    ['system', false],
    ['__proto__', false],
    ['Light', false],
    ['<img src=x onerror=alert(1)>', false],
    ['light\u202e', false],
    ['light'.repeat(100_000), false],
  ])('matches theme.ts (case %#)', (saved, osDark) => {
    const expected = resolveTheme(readTheme({ getItem: () => saved }), osDark);
    // The page is dark until told otherwise, so only light is ever set.
    expect(firstPaint(saved, osDark) ?? 'dark').toBe(expected);
  });

  it('stays dark when storage is blocked', () => {
    expect(firstPaint('light', false, true)).toBeUndefined();
  });
});

describe('Reset progress', () => {
  it('keeps the theme: it is a display preference, not progress', () => {
    const saved = new Map([
      [SAVE_KEY, '{}'],
      [THEME_KEY, 'light'],
    ]);
    const storage = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    };
    expect(clearSave(storage)).toBe(true);
    expect(saved.has(SAVE_KEY)).toBe(false);
    expect(readTheme(storage)).toBe('light');
  });
});
