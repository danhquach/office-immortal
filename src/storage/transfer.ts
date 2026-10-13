// The save code (docs/design.md §11): the save as one line of text the player
// can keep outside the browser and paste back in. It is the save JSON in
// base64 behind a short tag. A pasted code is untrusted: it is size-checked
// before any work, must be plain base64 and valid UTF-8, and the save inside
// goes through decodeSave's allow-list like any other.

import { decodeSave, isNewerSave, MAX_SAVE_CHARS, type Save } from './save.ts';

/** Marks a save code, and its format version. */
export const CODE_TAG = 'OI1:';
/** The longest code a save can make. */
export const MAX_CODE_CHARS = CODE_TAG.length + Math.ceil(MAX_SAVE_CHARS / 3) * 4;
/** The longest paste looked at: a code broken over lines by a mail or notes app still fits. */
export const MAX_PASTE_CHARS = MAX_CODE_CHARS * 2;

export type ImportResult =
  | { ok: true; save: Save; raw: string }
  /** 'newer': a save from a later release than this build, which only that release loads. */
  | { ok: false; why: 'empty' | 'tooBig' | 'bad' | 'newer' };

/** The save text `raw` (from encodeSave) as a save code. */
export function exportCode(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  // In chunks: one call with every byte as an argument overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return CODE_TAG + btoa(binary);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The save in a pasted code, or why there is none. Line breaks and spaces in the paste are ignored. */
export function importCode(pasted: unknown): ImportResult {
  if (typeof pasted !== 'string') return { ok: false, why: 'bad' };
  if (pasted.length > MAX_PASTE_CHARS) return { ok: false, why: 'tooBig' };
  // Only ASCII spaces and line breaks; anything else (zero-width, bidi marks) is not a code.
  const code = pasted.replace(/[ \t\r\n]/g, '');
  if (!code) return { ok: false, why: 'empty' };
  if (code.length > MAX_CODE_CHARS) return { ok: false, why: 'tooBig' };
  if (!code.startsWith(CODE_TAG)) return { ok: false, why: 'bad' };
  const body = code.slice(CODE_TAG.length);
  if (body.length % 4 !== 0 || !BASE64.test(body)) return { ok: false, why: 'bad' };
  let raw: string;
  try {
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, why: 'bad' };
  }
  const save = decodeSave(raw);
  if (save) return { ok: true, save, raw };
  return { ok: false, why: isNewerSave(raw) ? 'newer' : 'bad' };
}
