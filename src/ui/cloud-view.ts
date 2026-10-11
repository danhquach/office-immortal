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
