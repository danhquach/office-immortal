// The words the cloud save section shows (docs/design.md §11), as pure
// functions of the sync status so they are testable without a page.

import type { Save } from '../storage/save.ts';
import type { SyncStatus } from '../storage/sync.ts';
import { realmLabel } from './view.ts';

/** How long ago `ms` was, as a short phrase; a time in the future reads as just now. */
export function agoLabel(ms: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** One line about a save, to choose between two: realm, level, floor and when it was last played. */
export function saveSummary(save: Save, now: number): string {
  const { level } = save.state.cultivator;
  return `${realmLabel(level)} · Level ${level} · Floor ${save.state.floor} · played ${agoLabel(save.savedAt, now)}`;
}

/** The status line of the Menu's Cloud save section. */
export function cloudStatusLine(status: SyncStatus, now: number): string {
  switch (status.kind) {
    case 'off':
      return 'Off. This browser keeps your save only here.';
    case 'checking':
      return 'Checking the cloud…';
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return `Synced ${agoLabel(status.at, now)}.`;
    case 'offline':
      return status.message;
    case 'relink':
      return (
        'This browser was signed out of the cloud. Your game here is safe. ' +
        'Link this device again, or start a new cloud save.'
      );
    case 'conflict':
      return 'Needs your choice: this device and the cloud both changed.';
    case 'unreadable':
      return "The cloud save can't be read. This device's save is kept.";
  }
}

/** Whether the status asks the player for a choice (shown over the game, not just in the Menu). */
export function needsChoice(status: SyncStatus): boolean {
  return status.kind === 'conflict' || status.kind === 'unreadable';
}

export const CLOUD_HINT =
  'Keep your cultivator on a server to play on another browser or device. There is no account: ' +
  'this browser gets an anonymous save, and a one-time code links another browser to it. ' +
  "If this site's data is cleared on every linked device, the cloud save is lost too, " +
  'so link a second device to keep a copy.';
