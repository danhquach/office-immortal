// Puts a link code line (cloud-view.ts) on the page, the code in its own
// monospace type, shared by the Menu and the itch.io code frame. Text only,
// through DOM nodes.

import type { CodeLine } from './cloud-view.ts';

/** Fills `line` with the words and the code, or empties it for null. */
export function showCodeLine(line: HTMLElement, shown: CodeLine | null): void {
  if (!shown) {
    line.textContent = '';
    return;
  }
  const code = document.createElement('span');
  code.className = 'link-code';
  code.textContent = shown.code;
  code.setAttribute('aria-hidden', 'true');
  const spoken = document.createElement('span');
  spoken.className = 'sr-only';
  spoken.textContent = shown.spoken;
  line.replaceChildren(shown.before, code, spoken, shown.after);
}
