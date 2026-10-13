// Cloud save sync (docs/design.md §11): when to upload, what to do when the
// server's save and the local one disagree, and how to stay out of the way of
// play. The server's revision number is the only ordering: clocks on different
// devices are never compared. Nothing here blocks the game: the run always
// starts from the local save, and the cloud is checked in the background.
//
// Uploads are gated on the startup check having answered, so a device never
// overwrites a cloud save it has not looked at. A save the player has not
// decided about is never replaced in either direction.

import {
  CloudError,
  describeError,
  fitsKeepalive,
  type Cloud,
  type CloudMessage,
} from './cloud.ts';
import {
  ADOPT_KEY,
  clearMeta,
  newMeta,
  readMeta,
  writeMeta,
  type CloudMeta,
} from './cloud-meta.ts';
import { decodeSave, isNewerSave, SAVE_KEY, type Save, type SaveStorage } from './save.ts';

/** The most often an automatic upload is sent. */
export const UPLOAD_EVERY_MS = 60_000;
/** Failed requests back off from UPLOAD_EVERY_MS up to this. */
export const BACKOFF_MAX_MS = 5 * 60_000;

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'checking' }
  | { kind: 'syncing' }
  /** Both sides agree as of `at` (ms since the epoch). */
  | { kind: 'synced'; at: number }
  /** The last request failed; it retries by itself. */
  | { kind: 'offline'; message: CloudMessage }
  /** The sign-in can't be renewed; the player links again or starts a new cloud save. */
  | { kind: 'relink' }
  /** Both saves moved on: the player chooses. */
  | { kind: 'conflict'; local: Save; server: Save }
  /** The cloud's save fails the allow-list; the local save is kept until the player overwrites it. */
  | { kind: 'unreadable' }
  /**
   * The cloud's or the local save is from a later release than this build:
   * nothing uploads or loads until the page runs that release (the UI reloads).
   */
  | { kind: 'update' };

export interface SyncDeps {
  cloud: Cloud;
  /** Holds the cloud meta and the local save. */
  storage: SaveStorage;
  now(): number;
  /** Whether this tab is in front; only then does the timer upload. */
  visible(): boolean;
  /** The local save was replaced by the cloud's: restart the run from it. */
  onAdopt(): void;
  /** A one-time message for the player, as a code (the UI words it). */
  onNote(note: CloudMessage): void;
}

export interface Sync {
  readonly status: SyncStatus;
  subscribe(fn: (s: SyncStatus) => void): () => void;
  /** Checks the cloud in the background. Call before the run's first save overwrites the local one. */
  begin(): void;
  /** The save just written locally; uploads it when one is due. */
  offer(raw: string, savedAt: number): void;
  /** Tab hidden or page leaving: upload now, if the startup check has answered. */
  flush(reason: 'hidden' | 'pagehide'): void;
  /** The connection came back: retry without waiting out the backoff. */
  retry(): void;
  syncNow(): Promise<void>;
  /** Starts a cloud save from this device (also replaces one that needs linking again). */
  turnOn(): Promise<void>;
  /** Joins another device's save with its one-time code. */
  link(code: string): Promise<void>;
  linkCode(): Promise<{ code: string; ttl: number } | null>;
  /** Conflict or unreadable: the cloud takes this device's save. */
  keepLocal(): Promise<void>;
  /** Conflict: this device takes the cloud's save and restarts the run from it. */
  useCloud(): void;
  /** Forgets the cloud on this device; the server's save stays for other devices. */
  turnOff(): void;
  /** Deletes the cloud save for every device. ok=false means nothing was deleted. */
  deleteCloud(): Promise<{ ok: true } | { ok: false; message: CloudMessage }>;
}

interface Server {
  saveId: string;
  data: string;
  rev: number;
}

export function createSync(deps: SyncDeps): Sync {
  const { cloud, storage } = deps;
  let status: SyncStatus = { kind: 'off' };
  const listeners = new Set<(s: SyncStatus) => void>();
  let latest: { raw: string; savedAt: number } | null = null;
  /** The startup check has answered, so uploads may begin. */
  let checked = false;
  let checking = false;
  let inflight = false;
  let failures = 0;
  /** The earliest the next automatic request may go out. */
  let nextAt = 0;
  /** The meta could not be stored: stay paused until the page reloads. */
  let broken = false;
  let generation = 0;
  let adoptions = 0;
  let linking = false;
  /** The startup facts the check works from, kept so a failed check can retry. */
  let startup: { raw: string | null; local: Save | null; clean: boolean } | null = null;
  /** The last upload that failed without an answer: the cloud may hold it all the same. */
  let lost: { raw: string; savedAt: number } | null = null;
  /** The cloud save the player is choosing about. */
  let choice: Server | null = null;

  function setStatus(s: SyncStatus): void {
    status = s;
    for (const fn of listeners) fn(s);
  }

  /** Waiting on the player's choice or a newer release: nothing uploads. */
  function paused(): boolean {
    return status.kind === 'conflict' || status.kind === 'unreadable' || status.kind === 'update';
  }

  function store(meta: CloudMeta): boolean {
    if (writeMeta(storage, meta)) return true;
    broken = true;
    setStatus({ kind: 'offline', message: 'storage' });
    return false;
  }

  function localRaw(): string | null {
    try {
      return storage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }

  /** A failed request: say so, back off, keep playing. */
  function failed(e: unknown): void {
    if (e instanceof CloudError && e.kind === 'auth' && readMeta(storage)?.relink) {
      setStatus({ kind: 'relink' });
      return;
    }
    failures++;
    nextAt = deps.now() + Math.min(BACKOFF_MAX_MS, UPLOAD_EVERY_MS * 2 ** (failures - 1));
    setStatus({ kind: 'offline', message: describeError(e) });
  }

  function succeeded(): void {
    failures = 0;
    nextAt = deps.now() + UPLOAD_EVERY_MS;
    setStatus({ kind: 'synced', at: deps.now() });
  }

  /** This device takes `server`'s save: writes it as the local save, then restarts the run. */
  function adopt(server: Server, decoded: Save): void {
    const meta = readMeta(storage);
    if (!meta) return;
    const next = {
      ...meta,
      saveId: server.saveId,
      baseRev: server.rev,
      syncedSavedAt: decoded.savedAt,
      pendingLink: false,
      rejectedRev: null,
    };
    // Settings first: if they can't be stored the local save is left as it was.
    if (!store(next)) return;
    try {
      // The signal first: the save write is the last, so a refusal anywhere leaves the old run.
      // It tells the browser's other tabs to restart from what is about to be loaded.
      storage.setItem(ADOPT_KEY, `${deps.now()}-${++adoptions}`);
      storage.setItem(SAVE_KEY, server.data);
    } catch {
      writeMeta(storage, meta);
      deps.onNote('refused-save');
      // Not stuck on "checking" or "syncing": say so, and try again after a pause.
      nextAt = deps.now() + UPLOAD_EVERY_MS;
      setStatus({ kind: 'offline', message: 'refused-save' });
      return;
    }
    choice = null;
    deps.onNote('loaded');
    deps.onAdopt();
  }

  /**
   * The cloud's save is not the one this device last synced (or was never
   * synced): lines up what to do. `clean` is true when the local run has
   * nothing the cloud lacks.
   */
  function settle(server: Server, raw: string | null, local: Save | null, clean: boolean): void {
    const meta = readMeta(storage);
    if (!meta) return;
    if (raw !== null && server.data === raw && local) {
      // The cloud holds exactly this device's save (an upload whose reply was lost).
      if (
        store({
          ...meta,
          saveId: server.saveId,
          baseRev: server.rev,
          syncedSavedAt: local.savedAt,
          pendingLink: false,
          rejectedRev: null,
        })
      ) {
        checked = true;
        succeeded();
      }
      return;
    }
    const decoded = decodeSave(server.data);
    if (!decoded && isNewerSave(server.data)) {
      // Not damaged, just newer than this build: the release that reads it settles it.
      choice = null;
      setStatus({ kind: 'update' });
      return;
    }
    choice = server;
    if (!decoded) {
      if (meta.rejectedRev !== server.rev) {
        if (!store({ ...meta, saveId: server.saveId, rejectedRev: server.rev })) return;
        deps.onNote('unreadable-kept');
      }
      setStatus({ kind: 'unreadable' });
      return;
    }
    if (clean || !local) {
      adopt(server, decoded);
      return;
    }
    setStatus({ kind: 'conflict', local, server: decoded });
  }

  async function check(gen: number): Promise<void> {
    if (!startup || checking) return;
    checking = true;
    try {
      const server = await cloud.getSave();
      if (gen !== generation) return;
      const meta = readMeta(storage);
      if (!meta) {
        setStatus({ kind: 'off' });
        return;
      }
      const { raw, local, clean } = startup;
      if (server === null) {
        if (meta.saveId !== null) {
          clearMeta(storage);
          setStatus({ kind: 'off' });
          deps.onNote('deleted-elsewhere');
          return;
        }
        // Nothing in the cloud yet: the first upload creates it.
        checked = true;
        failures = 0;
        await upload('manual');
        return;
      }
      if (meta.saveId === server.saveId && meta.baseRev === server.rev && !meta.pendingLink) {
        checked = true;
        succeeded();
        return;
      }
      settle(server, raw, local, clean);
    } catch (e) {
      if (gen === generation) failed(e);
    } finally {
      if (gen === generation) checking = false;
    }
  }

  /**
   * Stores `patch` on the current meta, unless the meta changed under an upload
   * (turned off, linked, signed out in this or another tab): then the upload's
   * result is dropped, as it describes a save this browser no longer syncs.
   */
  function commit(snapshot: CloudMeta, patch: Partial<CloudMeta>): 'ok' | 'failed' | 'dropped' {
    const now = readMeta(storage);
    if (!now || changed(snapshot, now)) return 'dropped';
    return store({ ...now, ...patch }) ? 'ok' : 'failed';
  }

  function changed(snapshot: CloudMeta, now: CloudMeta): boolean {
    return (
      now.saveId !== snapshot.saveId ||
      now.pendingLink !== snapshot.pendingLink ||
      now.relink !== snapshot.relink
    );
  }

  /** Looks at what the cloud holds, as at startup, with `sending` as this device's save. */
  function recheck(sending: { raw: string }): void {
    checked = false;
    nextAt = 0;
    startup = { raw: sending.raw, local: decodeSave(sending.raw), clean: false };
    setStatus({ kind: 'checking' });
  }

  /** An upload finished after the meta changed: forget it; look again unless cloud is now off. */
  function dropped(sending: { raw: string }): void {
    if (!readMeta(storage)) setStatus({ kind: 'off' });
    // A choice the player is looking at stays as it is.
    else if (!paused()) recheck(sending);
  }

  async function upload(reason: 'timer' | 'manual' | 'hidden' | 'pagehide'): Promise<void> {
    if (broken || !latest || !checked || paused()) return;
    // A put is already out. A second at the same revision would race it, and one built on the
    // next revision could overwrite another device's save. So a page-leave waits: the last
    // seconds reach the cloud next session, and may then show as a both-moved choice (README).
    if (inflight) return;
    let meta = readMeta(storage);
    if (!meta) {
      setStatus({ kind: 'off' });
      return;
    }
    if (meta.relink || meta.pendingLink) return;
    const sending = latest;
    if (reason === 'pagehide' && !fitsKeepalive(sending.raw)) return;
    inflight = true;
    if (reason !== 'pagehide') setStatus({ kind: 'syncing' });
    try {
      for (let again = true; again;) {
        again = false;
        if (meta.saveId === null) {
          const made = await cloud.createSave(sending.raw);
          const done = commit(meta, {
            saveId: made.saveId,
            baseRev: made.rev,
            syncedSavedAt: sending.savedAt,
          });
          if (done === 'dropped') return dropped(sending);
          break;
        }
        const put = await cloud.putSave(sending.raw, meta.baseRev, reason === 'pagehide');
        if (put.ok || put.data === sending.raw) {
          lost = null;
          // Stored, or the cloud already holds exactly this (an earlier reply was lost).
          const done = commit(meta, {
            baseRev: put.rev,
            syncedSavedAt: sending.savedAt,
            rejectedRev: null,
          });
          if (done === 'dropped') return dropped(sending);
          break;
        }
        if (lost && put.data === lost.raw) {
          // An earlier upload landed though its reply never came: go again from its revision.
          const done = commit(meta, { baseRev: put.rev, syncedSavedAt: lost.savedAt });
          lost = null;
          if (done === 'dropped') return dropped(sending);
          meta = readMeta(storage) ?? meta;
          again = true;
          continue;
        }
        const now = readMeta(storage);
        if (now && now.baseRev !== meta.baseRev && now.saveId === meta.saveId) {
          // Another tab of this browser uploaded meanwhile: go again from its revision.
          meta = now;
          again = true;
          continue;
        }
        settle(
          { saveId: meta.saveId, data: put.data, rev: put.rev },
          sending.raw,
          decodeSave(sending.raw),
          false,
        );
        return;
      }
      if (!broken) succeeded();
    } catch (e) {
      const now = readMeta(storage);
      // Turned off, linked or signed out while the request was out: its failure is moot.
      if (!now || (changed(meta, now) && !now.relink)) return dropped(sending);
      if (e instanceof CloudError && e.code === 'already_member') {
        // An earlier create's reply was lost: look at what the cloud holds, as at startup.
        recheck(sending);
      } else {
        lost = sending;
        failed(e);
      }
    } finally {
      inflight = false;
    }
  }

  function maybeUpload(): void {
    if (broken || status.kind === 'off' || status.kind === 'relink' || paused()) return;
    if (!deps.visible() || deps.now() < nextAt) return;
    if (!checked) {
      if (!checking) void check(generation);
      return;
    }
    void upload('timer');
  }

  /** Signs up a fresh anonymous user and stores its session as the whole meta. */
  async function signUpFresh(): Promise<CloudMeta | null> {
    const meta = newMeta(await cloud.signUp());
    return store(meta) ? meta : null;
  }

  return {
    get status() {
      return status;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    begin() {
      generation++;
      checked = false;
      checking = false;
      choice = null;
      latest = null;
      lost = null;
      nextAt = 0;
      const meta = readMeta(storage);
      if (!meta) {
        setStatus({ kind: 'off' });
        return;
      }
      if (meta.relink) {
        setStatus({ kind: 'relink' });
        return;
      }
      // Read now, before the new run's first save replaces the local one.
      const raw = localRaw();
      if (isNewerSave(raw)) {
        // This build can't tell what the newer local save holds, so it never settles against it.
        startup = null;
        setStatus({ kind: 'update' });
        return;
      }
      const local = decodeSave(raw);
      startup = { raw, local, clean: !local || local.savedAt <= meta.syncedSavedAt };
      setStatus({ kind: 'checking' });
      void check(generation);
    },
    offer(raw, savedAt) {
      latest = { raw, savedAt };
      maybeUpload();
    },
    flush(reason) {
      if (paused()) return;
      void upload(reason);
    },
    retry() {
      nextAt = 0;
      maybeUpload();
    },
    async syncNow() {
      if (broken || status.kind === 'off' || status.kind === 'relink' || paused()) return;
      nextAt = 0;
      if (!checked) {
        if (!startup) return;
        await check(generation);
      } else {
        await upload('manual');
      }
    },
    async turnOn() {
      const existing = readMeta(storage);
      if ((existing && !existing.relink) || !latest || broken) return;
      const prev = status;
      setStatus({ kind: 'syncing' });
      try {
        // A brand-new user has no cloud save, so there is nothing to check first.
        if (!(await signUpFresh())) return;
        checked = true;
        await upload('manual');
      } catch (e) {
        // Signing up failed: nothing was stored, so the player can simply try again.
        const stored = readMeta(storage);
        if (stored && !stored.relink) {
          failed(e);
        } else {
          setStatus(prev);
          deps.onNote(describeError(e));
        }
      }
    },
    async link(code) {
      const before = readMeta(storage);
      // No run yet (the Path choice screen) is fine: the cloud save simply loads.
      const raw = latest?.raw ?? null;
      // One attempt at a time: a double click must not sign up and redeem twice.
      if (broken || linking) return;
      linking = true;
      const prev = status;
      setStatus({ kind: 'syncing' });
      /** The session this attempt works under; only meta still holding it is ours to undo. */
      let mine: string | null = null;
      const undo = (): void => {
        if (!mine || readMeta(storage)?.session?.access !== mine) return;
        if (before) store(before);
        else clearMeta(storage);
      };
      try {
        const meta = before && !before.relink ? before : await signUpFresh();
        if (!meta) return;
        mine = meta.session?.access ?? null;
        const server = await cloud.redeemLinkCode(code);
        if (!raw && !decodeSave(server.data) && !isNewerSave(server.data)) {
          // Nothing local to keep and nothing readable to load: leave cloud off here.
          undo();
          setStatus(prev);
          deps.onNote('cant-read');
          return;
        }
        // Remembered before asking the player, so closing the page mid-choice asks again next time.
        // A save newer than this build is settled the same way by the release that reads it.
        if (
          !store({
            ...meta,
            saveId: server.saveId,
            baseRev: null,
            pendingLink: true,
            rejectedRev: null,
          })
        ) {
          return;
        }
        checked = false;
        settle(server, raw, raw ? decodeSave(raw) : null, false);
      } catch (e) {
        // A failed attempt leaves things as they were (a sign-in made just for it is dropped).
        undo();
        setStatus(prev);
        deps.onNote(describeError(e));
      } finally {
        linking = false;
      }
    },
    async linkCode() {
      try {
        return await cloud.createLinkCode();
      } catch (e) {
        deps.onNote(describeError(e));
        return null;
      }
    },
    async keepLocal() {
      const meta = readMeta(storage);
      const target = choice;
      if (!meta || !target || !latest || inflight) return;
      const before = status;
      const sending = latest;
      inflight = true;
      setStatus({ kind: 'syncing' });
      try {
        const put = await cloud.putSave(sending.raw, target.rev);
        if (put.ok) {
          const ok = store({
            ...meta,
            saveId: target.saveId,
            baseRev: put.rev,
            syncedSavedAt: sending.savedAt,
            pendingLink: false,
            rejectedRev: null,
          });
          choice = null;
          checked = true;
          if (ok) succeeded();
        } else {
          // The cloud moved again while the player chose: ask again with what it holds now.
          settle(
            { saveId: target.saveId, data: put.data, rev: put.rev },
            sending.raw,
            decodeSave(sending.raw),
            false,
          );
        }
      } catch (e) {
        setStatus(before);
        deps.onNote(describeError(e));
      } finally {
        inflight = false;
      }
    },
    useCloud() {
      const decoded = choice ? decodeSave(choice.data) : null;
      if (choice && decoded) adopt(choice, decoded);
    },
    turnOff() {
      if (!clearMeta(storage)) {
        deps.onNote('refused-settings');
        return;
      }
      checked = false;
      choice = null;
      setStatus({ kind: 'off' });
    },
    async deleteCloud() {
      const meta = readMeta(storage);
      if (!meta) return { ok: true };
      if (meta.relink) {
        return { ok: false, message: 'relink-first' };
      }
      inflight = true;
      try {
        if (meta.saveId !== null) await cloud.deleteSave();
        clearMeta(storage);
        checked = false;
        setStatus({ kind: 'off' });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: describeError(e) };
      } finally {
        inflight = false;
      }
    },
  };
}
