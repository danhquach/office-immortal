// Which groups of the Stats tab are open (docs/design.md §14): a display
// preference kept on this device only, like the theme. Pure (storage is passed
// in), so it can be unit-tested; app.ts puts it on the page.

export const FOLD_KEY = 'office-immortal.folds';
/** Every group that folds: the allow-list a stored value is read against. */
export const FOLDS = ['Plan', 'Offence', 'Defence', 'Find', 'Boosts'] as const;
export type Fold = (typeof FOLDS)[number];
export type Folds = Record<Fold, boolean>;

/** Offence and Defence start open; Auto-assign, Find and Boosts start folded. */
export function defaultFolds(): Folds {
  return { Plan: false, Offence: true, Defence: true, Find: false, Boosts: false };
}

/** Longer than any value writeFolds() stores: anything over it is not read. */
const MAX_LENGTH = 200;
const OPEN = 'open';
const CLOSED = 'closed';

/**
 * Folds from an untrusted value (storage): a JSON object naming groups
 * "open" or "closed". Only the allow-listed groups' own keys are read; any
 * other key, a wrong type or an oversized or broken value keeps the default.
 */
export function pickFolds(value: unknown): Folds {
  const folds = defaultFolds();
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return folds;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return folds;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return folds;
  for (const id of FOLDS) {
    if (!Object.hasOwn(parsed, id)) continue;
    const v = (parsed as Record<string, unknown>)[id];
    if (v === OPEN) folds[id] = true;
    else if (v === CLOSED) folds[id] = false;
  }
  return folds;
}

/** The saved folds; the defaults where there is none or storage is blocked. */
export function readFolds(storage: Pick<Storage, 'getItem'> | null): Folds {
  try {
    return pickFolds(storage?.getItem(FOLD_KEY));
  } catch {
    return defaultFolds();
  }
}

/** Saves the folds; false where storage is blocked (they still apply this visit). */
export function writeFolds(storage: Pick<Storage, 'setItem'> | null, folds: Folds): boolean {
  if (!storage) return false;
  const out: Record<string, string> = {};
  for (const id of FOLDS) out[id] = folds[id] === true ? OPEN : CLOSED;
  try {
    storage.setItem(FOLD_KEY, JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}
