// The save's second copy, in IndexedDB (docs/design.md §11). Every save goes to
// both browser storage and here, and a load takes the newest copy that passes
// the allow-list, so a cleared or full browser storage doesn't lose the run.
// IndexedDB is optional: where it is missing, blocked or slow, every call just
// answers "nothing" and the game runs on browser storage alone, as before.

import {
  clearSave,
  decodeSave,
  loadSave,
  MAX_SAVE_CHARS,
  writeRaw,
  type Save,
  type SaveStorage,
} from './save.ts';

/** The second copy: the save text, stored and read back as is. */
export interface Backup {
  /** The stored text, or null when there is none, it can't be read or it is not text of a sane size. */
  read(): Promise<string | null>;
  /** Stores `raw`; false when refused. */
  put(raw: string): Promise<boolean>;
  /** Deletes the copy; false when refused (true when there is no IndexedDB to hold one). */
  clear(): Promise<boolean>;
}

const DB_NAME = 'office-immortal';
const STORE = 'save';
const KEY = 'save';
/** A call that hasn't answered by then counts as refused, so a start never waits long. */
export const BACKUP_TIMEOUT_MS = 1500;

/** The page's IndexedDB, or null where it is missing or blocked (some private modes throw on access). */
export function browserIdb(): IDBFactory | null {
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}

/** A backup in `idb`; with null, one that holds nothing. */
export function idbBackup(idb: IDBFactory | null, timeoutMs = BACKUP_TIMEOUT_MS): Backup {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> =>
    (opened ??= new Promise((resolve) => {
      if (!idb) return resolve(null);
      try {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => {
          const db = req.result;
          // A newer page version upgrading the database: let it.
          db.onversionchange = () => {
            db.close();
            opened = null;
          };
          resolve(db);
        };
        // Refused this time: answer nothing, and try again on the next call.
        const refused = (): void => {
          opened = null;
          resolve(null);
        };
        req.onerror = refused;
        req.onblocked = refused;
      } catch {
        resolve(null);
      }
    }));

  /** Runs `op` on the store; `fallback` on any failure or after the timeout. */
  function use<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore, done: (v: T) => void) => void,
    fallback: T,
    none: T,
  ): Promise<T> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => done(fallback), timeoutMs);
      void open().then((db) => {
        if (!db) return done(none);
        try {
          const tx = db.transaction(STORE, mode);
          tx.onerror = () => done(fallback);
          tx.onabort = () => done(fallback);
          op(tx.objectStore(STORE), done);
        } catch {
          done(fallback);
        }
      });
    });
  }

  return {
    read: () =>
      use<string | null>(
        'readonly',
        (store, done) => {
          const req = store.get(KEY);
          req.onsuccess = () => {
            const v: unknown = req.result;
            // Anything but text of a save's size is not ours; decodeSave checks the rest.
            done(typeof v === 'string' && v.length <= MAX_SAVE_CHARS ? v : null);
          };
        },
        null,
        null,
      ),
    put: (raw) =>
      use<boolean>(
        'readwrite',
        (store, done) => {
          store.put(raw, KEY);
          // Written once the transaction commits, not when the request is queued.
          store.transaction.oncomplete = () => done(true);
        },
        false,
        false,
      ),
    clear: () =>
      use<boolean>(
        'readwrite',
        (store, done) => {
          store.delete(KEY);
          store.transaction.oncomplete = () => done(true);
        },
        false,
        // No IndexedDB here: nothing to delete.
        true,
      ),
  };
}

/** How far past `now` a backup's stamp may be and still count as newer (clock adjustments). */
export const FUTURE_SLACK_MS = 60_000;

/**
 * The newer of two saves; on a tie, or with one missing, the other or the local
 * one. Both are stamped by this browser's clock, so a backup stamped well past
 * `now` was not written by this game and never wins over a local save.
 */
export function newest(local: Save | null, backup: Save | null, now: number): Save | null {
  if (!local) return backup;
  if (!backup || backup.savedAt > now + FUTURE_SLACK_MS) return local;
  return backup.savedAt > local.savedAt ? backup : local;
}

/**
 * The newest copy that passes the load check, from browser storage (null when
 * blocked) and the backup. The backup's text goes through the same allow-list
 * as browser storage's; a broken copy is skipped, never preferred.
 */
export async function loadNewest(
  storage: SaveStorage | null,
  backup: Backup,
  now: number,
): Promise<Save | null> {
  const backed = decodeSave(await backup.read());
  // Read after the wait, so a write from another tab meanwhile is seen.
  return newest(storage && loadSave(storage), backed, now);
}

/**
 * Reset progress: deletes both copies, the backup first, so a tab that
 * restarts on the deleted browser storage save can't find it there. False when
 * either refuses.
 */
export async function clearBoth(storage: SaveStorage | null, backup: Backup): Promise<boolean> {
  if (!(await backup.clear())) return false;
  return storage === null || clearSave(storage);
}

/**
 * Writes `raw` to both copies, each whatever the other does. Returns whether
 * browser storage took it (the cloud save uploads only what it holds).
 */
export function writeBoth(storage: SaveStorage | null, backup: Backup, raw: string): boolean {
  void backup.put(raw);
  return storage !== null && writeRaw(storage, raw);
}
