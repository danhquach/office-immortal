// Dev builds only: the mark the Debug panel (src/dev/panel.ts) leaves on a save
// it changed. While it is set the cloud save stays off, so a cheated save never
// reaches the server. Callers check import.meta.env.DEV first, so production
// never reads it and Vite drops this module from the build.

import type { SaveStorage } from '../storage/save.ts';

/** Holds the time of the last debug change, so every change tells other tabs. */
export const DEBUG_KEY = 'office-immortal.debug';

/** Whether the Debug panel changed the save in `storage`. */
export function debugged(storage: SaveStorage | null): boolean {
  try {
    return (storage?.getItem(DEBUG_KEY) ?? null) !== null;
  } catch {
    return false;
  }
}

/** Marks the save as changed by the Debug panel; false when storage refuses. */
export function markDebugged(storage: SaveStorage, at: number): boolean {
  try {
    storage.setItem(DEBUG_KEY, String(at));
    return true;
  } catch {
    return false;
  }
}

/** A fresh run: the cloud save may take it again. */
export function clearDebugged(storage: SaveStorage): void {
  try {
    storage.removeItem(DEBUG_KEY);
  } catch {
    // Blocked storage: nothing was marked either.
  }
}
