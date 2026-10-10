// Language packs: every player-visible string, in English and Vietnamese.
// Pure (storage and the browser's languages are passed in), so it can be
// unit-tested; app.ts puts the strings on the page, always as text.
//
// The sim keeps its English names (they are ids in saves and sprite files):
// the UI turns them into the player's language here, by kind. A third
// language is one more file in ./lang/, picked up on its own.

import type { MessageKey } from './lang/en.ts';
import type { NameKind } from './names.ts';

export type { MessageKey, NameKind };

export interface Pack {
  /** BCP 47 code, put on <html lang> so screen readers pronounce the text. */
  readonly code: string;
  /** The language's own name, as the switcher lists it. */
  readonly label: string;
  /** The switcher's short code, e.g. "EN". */
  readonly short: string;
  readonly messages: Readonly<Record<MessageKey, string>>;
  /** The sim's English names in this language, by kind. */
  readonly names: { readonly [K in NameKind]: Readonly<Record<string, string>> };
}

const loaded = import.meta.glob<{ default: Pack }>(['./lang/*.ts', '!./lang/*.test.ts'], {
  eager: true,
});

/** Every pack, English first; English is the fallback for anything a pack lacks. */
export const PACKS: readonly Pack[] = Object.values(loaded)
  .map((m) => m.default)
  .sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.code.localeCompare(b.code)));

export const LANG_KEY = 'office-immortal.lang';
export const DEFAULT_LANG = 'en';

const ENGLISH = PACKS.find((p) => p.code === DEFAULT_LANG) as Pack;
let current: Pack = ENGLISH;

/** The pack for an untrusted value (storage, a click); null for anything not on the list. */
function packFor(value: unknown): Pack | null {
  return PACKS.find((p) => p.code === value) ?? null;
}

/** The language for an untrusted value; anything not on the list is the default. */
export function pickLang(value: unknown): string {
  return packFor(value)?.code ?? DEFAULT_LANG;
}

/** The first of the browser's languages there is a pack for (by primary tag), else English. */
export function browserLang(languages: readonly string[]): string {
  for (const tag of languages) {
    const primary = String(tag).toLowerCase().split('-')[0];
    const pack = packFor(primary);
    if (pack) return pack.code;
  }
  return DEFAULT_LANG;
}

/** The saved choice if it is on the list, else the browser's language. */
export function readLang(
  storage: Pick<Storage, 'getItem'> | null,
  languages: readonly string[],
): string {
  try {
    const saved = packFor(storage?.getItem(LANG_KEY));
    if (saved) return saved.code;
  } catch {
    // Blocked storage: the browser's language.
  }
  return browserLang(languages);
}

/** Saves the choice; false where storage is blocked (it still applies this visit). */
export function writeLang(storage: Pick<Storage, 'setItem'> | null, code: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LANG_KEY, pickLang(code));
    return true;
  } catch {
    return false;
  }
}

/** Switches every later t() and tn(); an unknown code switches to English. */
export function setLang(code: unknown): void {
  current = packFor(code) ?? ENGLISH;
}

export function lang(): Pack {
  return current;
}

/**
 * A message in the current language, with each `{name}` filled from `params`.
 * A missing message falls back to English, never to a blank or a raw key.
 */
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  const text = Object.hasOwn(current.messages, key) ? current.messages[key] : ENGLISH.messages[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** A sim name in the current language; one the pack lacks (an old save's, say) stays English. */
export function tn(kind: NameKind, name: string): string {
  const names = current.names[kind];
  return Object.hasOwn(names, name) ? (names[name] as string) : name;
}

/** An enemy's name: elites are "Elite <demon>" in the sim. */
export function enemyName(kind: string, name: string): string {
  if (kind !== 'elite' || !name.startsWith('Elite ')) return tn('enemy', name);
  return t('enemy.elite', { name: tn('enemy', name.slice('Elite '.length)) });
}
