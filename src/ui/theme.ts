// The colour theme: dark unless the player picks Light or Match system in Settings.
// Pure (storage is passed in), so it can be unit-tested; app.ts puts it on the page.

export const THEME_KEY = 'office-immortal.theme';
export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** A theme from an untrusted value (storage, the Settings select); anything else is Dark. */
export function pickTheme(value: unknown): Theme {
  return THEMES.find((t) => t === value) ?? 'dark';
}

/** The saved choice; anything else in storage, or no storage at all, is Dark. */
export function readTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  try {
    return pickTheme(storage?.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

/** Saves the choice; false where storage is blocked (it still applies this visit). */
export function writeTheme(storage: Pick<Storage, 'setItem'> | null, theme: Theme): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** The palette to show: Match system follows the OS setting. */
export function resolveTheme(theme: Theme, osDark: boolean): 'dark' | 'light' {
  return theme === 'system' ? (osDark ? 'dark' : 'light') : theme;
}

/**
 * Puts the palette on each document root: the page, and the pop-out while it
 * is open (undefined when closed). page.css shows light only for 'light'.
 */
export function showTheme(
  roots: readonly (Pick<HTMLElement, 'dataset'> | undefined)[],
  theme: Theme,
  osDark: boolean,
): void {
  const palette = resolveTheme(theme, osDark);
  for (const root of roots) if (root) root.dataset.theme = palette;
}
