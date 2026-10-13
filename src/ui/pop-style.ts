// Which pop-out the player last picked: Mini (the fight) or Discreet (a plain
// sheet). A display preference, like the theme: Reset progress keeps it.
// Pure (storage is passed in), so it can be unit-tested.

export const POP_STYLE_KEY = 'office-immortal.popStyle';
export const POP_STYLES = ['mini', 'discreet'] as const;
export type PopStyle = (typeof POP_STYLES)[number];

/** A style from an untrusted value (storage); anything else is Mini. */
export function pickPopStyle(value: unknown): PopStyle {
  return POP_STYLES.find((s) => s === value) ?? 'mini';
}

/** The saved choice; anything else in storage, or no storage at all, is Mini. */
export function readPopStyle(storage: Pick<Storage, 'getItem'> | null): PopStyle {
  try {
    return pickPopStyle(storage?.getItem(POP_STYLE_KEY));
  } catch {
    return 'mini';
  }
}

/** Saves the choice; false where storage is blocked (it still applies this visit). */
export function writePopStyle(storage: Pick<Storage, 'setItem'> | null, style: PopStyle): boolean {
  if (!storage) return false;
  try {
    storage.setItem(POP_STYLE_KEY, style);
    return true;
  } catch {
    return false;
  }
}
