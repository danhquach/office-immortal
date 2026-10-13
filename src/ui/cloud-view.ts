// The words the cloud save section shows (docs/design.md §11), as pure
// functions of the sync status so they are testable without a page. All text
// comes from the language packs; the storage layer only hands over codes.

import type { CloudMessage } from '../storage/cloud.ts';
import type { Save } from '../storage/save.ts';
import type { SyncStatus } from '../storage/sync.ts';
import { t } from './i18n.ts';
import { realmLabel } from './view.ts';

/** A message code from the storage layer, in the current language. */
export function cloudText(code: CloudMessage): string {
  return t(`cloud.msg.${code}`);
}

/** How long ago `ms` was, as a short phrase; a time in the future reads as just now. */
export function agoLabel(ms: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return t('cloud.ago.now');
  if (minutes < 60) return t('cloud.ago.min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('cloud.ago.hour', { n: hours });
  return t('cloud.ago.day', { n: Math.floor(hours / 24) });
}

/** One line about a save, to choose between two: realm, level, floor and when it was last played. */
export function saveSummary(save: Save, now: number): string {
  const { level } = save.state.cultivator;
  return t('cloud.summary', {
    realm: realmLabel(level),
    level,
    floor: save.state.floor,
    ago: agoLabel(save.savedAt, now),
  });
}

/** The status line of the Menu's Cloud save section. */
export function cloudStatusLine(status: SyncStatus, now: number): string {
  switch (status.kind) {
    case 'offline':
      return cloudText(status.message);
    case 'synced':
      return t('cloud.status.synced', { ago: agoLabel(status.at, now) });
    default:
      return t(`cloud.status.${status.kind}`);
  }
}

/** Whether the status asks the player for a choice (shown over the game, not just in the Menu). */
export function needsChoice(status: SyncStatus): boolean {
  return status.kind === 'conflict' || status.kind === 'unreadable';
}

/**
 * Whether to add or drop one of the itch.io link code frames (code-frame.ts)
 * as its part of the Menu shows or hides: added when shown, dropped when not,
 * so a code shown or typed before never shows again; the next is a fresh frame.
 */
export function frameStep(hasFrame: boolean, shown: boolean): 'add' | 'drop' | 'keep' {
  if (shown && !hasFrame) return 'add';
  if (!shown && hasFrame) return 'drop';
  return 'keep';
}

/** The line showing a link code, split around the code so it can be set apart in its own type. */
export interface CodeLine {
  before: string;
  /** The code in two groups of five, as the eye reads it. */
  code: string;
  /** The code a character at a time, for a screen reader (which would read a group as a word). */
  spoken: string;
  after: string;
}

/** Marks where the code goes in the translated line; no language pack holds it. */
const CODE_MARK = '\u0000';

/** The line under a fresh link code, `ttl` seconds from expiring, in the current language. */
export function linkCodeLine(code: string, ttl: number): CodeLine {
  const text = t('cloud.code', { code: CODE_MARK, minutes: Math.round(ttl / 60) });
  const at = text.indexOf(CODE_MARK);
  const groups = [code.slice(0, 5), code.slice(5)].filter((g) => g !== '');
  return {
    before: at < 0 ? text : text.slice(0, at),
    code: groups.join(' '),
    spoken: groups.map((g) => [...g].join(' ')).join(', '),
    after: at < 0 ? '' : text.slice(at + CODE_MARK.length),
  };
}
