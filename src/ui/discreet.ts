// Discreet mode for the main page (docs/design.md §14): the game dressed as a
// plain sheet, switched by a title-bar button or one key. A display
// preference, like the theme: Reset progress keeps it. Pure (storage and key
// events are passed in), so it can be unit-tested; app.ts puts it on the page.

import { GRADES, type GradeId } from '../core/loot.ts';
import { t, tn, type MessageKey } from './i18n.ts';

export const DISCREET_KEY = 'office-immortal.discreet';
const ON = 'on';
const OFF = 'off';

/** On only for the exact stored word; anything else (storage, a click) is off. */
export function pickDiscreet(value: unknown): boolean {
  return value === ON;
}

/** The saved choice; anything else in storage, or no storage at all, is off. */
export function readDiscreet(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return pickDiscreet(storage?.getItem(DISCREET_KEY));
  } catch {
    return false;
  }
}

/** Saves the choice; false where storage is blocked (it still applies this visit). */
export function writeDiscreet(storage: Pick<Storage, 'setItem'> | null, on: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DISCREET_KEY, on ? ON : OFF);
    return true;
  } catch {
    return false;
  }
}

let discreet = false;

/** Switches every later gradeName() and gradeInitial(); anything but true is off. */
export function setDiscreet(on: unknown): void {
  discreet = on === true;
}

export function isDiscreet(): boolean {
  return discreet;
}

/** Grades in office words: never a game grade's name. */
export const OFFICE_GRADE = {
  mortal: 'discreet.grade.mortal',
  spirit: 'discreet.grade.spirit',
  earth: 'discreet.grade.earth',
  heaven: 'discreet.grade.heaven',
  immortal: 'discreet.grade.immortal',
} as const satisfies Record<GradeId, MessageKey>;

/** The same, short, for the inventory cells. */
const OFFICE_INITIAL = {
  mortal: 'discreet.initial.mortal',
  spirit: 'discreet.initial.spirit',
  earth: 'discreet.initial.earth',
  heaven: 'discreet.initial.heaven',
  immortal: 'discreet.initial.immortal',
} as const satisfies Record<GradeId, MessageKey>;

/** A grade's name: in office words while Discreet is on (or `office` asks for them). */
export function gradeName(grade: GradeId, office = discreet): string {
  return office ? t(OFFICE_GRADE[grade]) : tn('grade', GRADES[grade].name);
}

/** A grade's short form on an inventory cell, in office words while Discreet is on. */
export function gradeInitial(grade: GradeId): string {
  return t(discreet ? OFFICE_INITIAL[grade] : `grade.initial.${grade}`);
}

/** The key that switches Discreet mode: the one left of 1, wherever the layout puts its character. */
export const DISCREET_CODE = 'Backquote';
/** Its character, for a press with no key position (some on-screen keyboards). */
const DISCREET_CHAR = '`';

/** What the shortcut needs to know about a key press. */
export interface KeyPress {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly target: unknown;
}

/** Fields the key goes into as text: the shortcut leaves those alone. */
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Inputs that take no typed text: the shortcut still works on them. */
const NOT_TEXT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function typingIn(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const node = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (node.isContentEditable === true) return true;
  if (typeof node.tagName !== 'string') return false;
  const tag = node.tagName.toUpperCase();
  if (tag === 'INPUT' && typeof node.type === 'string' && NOT_TEXT.has(node.type.toLowerCase()))
    return false;
  return TYPING.has(tag);
}

/**
 * Whether a key press switches Discreet mode: the key alone (Shift allowed, as
 * some layouts need it), not held down, and not while a text field has focus.
 * Ctrl, Alt and Meta are left to the browser and screen readers.
 */
export function isDiscreetKey(e: KeyPress): boolean {
  return (
    (e.code === DISCREET_CODE || (e.code === '' && e.key === DISCREET_CHAR)) &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.repeat &&
    !typingIn(e.target)
  );
}
