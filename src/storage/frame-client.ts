// The itch.io game's side of the storage frame (docs/design.md §11, "Cloud
// save on itch.io"). The frame on our GitHub Pages origin holds the save, its
// IndexedDB copy and the cloud save; the game works from a copy of the
// frame's storage kept in memory, so play never waits on a message. Writes go
// to the copy at once and on to the frame; the frame's own writes and other
// tabs' come back as events. Only messages from the frame window at its
// origin are read, through the protocol's allow-list.

import { clearBoth, loadNewest, writeBoth, type Backup } from './backup.ts';
import type { CloudMessage } from './cloud.ts';
import type { FrameConfig } from './frame-config.ts';
import type { Save, SaveStorage } from './save.ts';
import type { Sync, SyncStatus } from './sync.ts';
import {
  isMirrorKey,
  PROTOCOL,
  readBackupText,
  readDeleted,
  readFrameMessage,
  readHello,
  type FrameEvent,
  type MirrorKey,
  type Op,
  type Reply,
} from './frame-protocol.ts';
import type { Incoming } from './frame-host.ts';

/** How long the frame page has to load. */
export const LOAD_TIMEOUT_MS = 5000;
/** How long the frame has to answer the first message once loaded. */
export const HELLO_TIMEOUT_MS = 2000;
/** A backup call that hasn't answered by then counts as refused. */
export const BACKUP_REQUEST_MS = 3000;
/** A cloud action (several requests of up to 10 s each) that hasn't answered by then is given up on. */
export const SYNC_REQUEST_MS = 60_000;

export interface ClientDeps {
  /** Posts to the frame window at its origin. */
  post(message: Record<string, unknown>): void;
  /** The frame's origin; messages from any other are ignored. */
  origin: string;
  /** The frame window: the only source taken. */
  source(): unknown;
  /** The frame's sync took the cloud's save, now in the storage copy: restart the run from it. */
  onAdopt(): void;
  onNote(code: CloudMessage): void;
}

/** What the game uses in place of its own storage once the frame answers. */
export interface FrameLink {
  /** The frame's storage, as a copy in memory that writes through. */
  storage: SaveStorage;
  /** The frame's IndexedDB copy of the save. */
  backup: Backup;
  /** The frame's cloud save; null when the frame's build has none. */
  sync: Sync | null;
  /** Calls `fn` on another tab's change to a mirrored key (key null: storage cleared). */
  onStorage(fn: (key: MirrorKey | null, value: string | null) => void): () => void;
}

export interface Client {
  /** A message posted to the game window. */
  receive(e: Incoming): void;
  /** Says hello; the link, or null when the frame does not answer in time. */
  connect(timeoutMs?: number): Promise<FrameLink | null>;
}

export function createClient(deps: ClientDeps): Client {
  let nextId = 0;
  const pending = new Map<number, (value: unknown) => void>();
  const copy = new Map<MirrorKey, string>();
  const storageFns = new Set<(key: MirrorKey | null, value: string | null) => void>();
  const statusFns = new Set<(s: SyncStatus) => void>();
  let status: SyncStatus = { kind: 'off' };
  let linked = false;

  function post(op: Op, args: Record<string, unknown> = {}): number {
    const id = ++nextId;
    deps.post({ p: PROTOCOL, id, op, ...args });
    return id;
  }

  /** Posts a request and waits for its reply; `fallback` when none comes in time. */
  function ask(
    op: Op,
    args: Record<string, unknown>,
    ms: number,
    fallback: unknown,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      const id = post(op, args);
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(fallback);
      }, ms);
      pending.set(id, (value) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(value);
      });
    });
  }

  function setStatus(s: SyncStatus): void {
    status = s;
    for (const fn of statusFns) fn(s);
  }

  function apply(e: FrameEvent): void {
    switch (e.ev) {
      case 'status':
        setStatus(e.status);
        break;
      case 'note':
        deps.onNote(e.code);
        break;
      case 'adopt':
        deps.onAdopt();
        break;
      case 'write':
        if (e.value === null) copy.delete(e.key);
        else copy.set(e.key, e.value);
        break;
      case 'storage':
        if (e.key === null) copy.clear();
        else if (e.value === null) copy.delete(e.key);
        else copy.set(e.key, e.value);
        for (const fn of storageFns) fn(e.key, e.value);
        break;
    }
  }

  const storage: SaveStorage = {
    getItem: (k) => (isMirrorKey(k) ? (copy.get(k) ?? null) : null),
    setItem(k, v) {
      // As browser storage does when refusing: callers already handle a throw.
      if (!isMirrorKey(k)) throw new Error('not a stored key');
      copy.set(k, v);
      post('set', { key: k, value: v });
    },
    removeItem(k) {
      if (!isMirrorKey(k)) return;
      copy.delete(k);
      post('remove', { key: k });
    },
  };

  const backup: Backup = {
    read: async () => readBackupText(await ask('backup.read', {}, BACKUP_REQUEST_MS, null)),
    put: async (raw) => (await ask('backup.put', { raw }, BACKUP_REQUEST_MS, false)) === true,
    clear: async () => (await ask('backup.clear', {}, BACKUP_REQUEST_MS, false)) === true,
  };

  const waitFor = async (op: Op, args: Record<string, unknown> = {}): Promise<void> => {
    await ask(op, args, SYNC_REQUEST_MS, null);
  };

  const sync: Sync = {
    get status() {
      return status;
    },
    subscribe(fn) {
      statusFns.add(fn);
      return () => void statusFns.delete(fn);
    },
    begin: () => void post('sync.begin'),
    offer: (raw, savedAt) => void post('sync.offer', { raw, savedAt }),
    flush: (reason) => void post('sync.flush', { reason }),
    retry: () => void post('sync.retry'),
    syncNow: () => waitFor('sync.syncNow'),
    turnOn: () => waitFor('sync.turnOn'),
    // Never through the game: a code is typed into a link frame (code-frame.ts).
    link: async () => {},
    // Never through the game: the frame shows the code in a frame of its own (code-frame.ts).
    linkCode: async () => null,
    keepLocal: () => waitFor('sync.keepLocal'),
    useCloud: () => void post('sync.useCloud'),
    turnOff: () => void post('sync.turnOff'),
    deleteCloud: async () =>
      readDeleted(
        await ask('sync.deleteCloud', {}, SYNC_REQUEST_MS, { ok: false, message: 'offline' }),
      ),
  };

  return {
    receive(e) {
      if (e.source !== deps.source() || e.origin !== deps.origin) return;
      const m = readFrameMessage(e.data);
      if (!m) return;
      if ('re' in m) pending.get((m as Reply).re)?.((m as Reply).value);
      else if (linked) apply(m);
    },
    async connect(timeoutMs = HELLO_TIMEOUT_MS) {
      const hello = readHello(await ask('hello', {}, timeoutMs, null));
      if (!hello) return null;
      for (const [k, v] of hello.items) copy.set(k, v);
      status = hello.status;
      linked = true;
      return {
        storage,
        backup,
        sync: hello.cloud ? sync : null,
        onStorage(fn) {
          storageFns.add(fn);
          return () => void storageFns.delete(fn);
        },
      };
    },
  };
}

/**
 * The frame's backup, plus this page's own copies of the save (browser storage
 * and IndexedDB on itch.io's origin). Those are a fallback only: they are read
 * when the frame doesn't answer or holds no save, never in preference to the
 * frame's. Reset progress clears them all.
 */
export function withFallbackCopy(
  frame: Backup,
  local: SaveStorage | null,
  localBackup: Backup,
): Backup {
  return {
    read: () => frame.read(),
    put(raw) {
      writeBoth(local, localBackup, raw);
      return frame.put(raw);
    },
    async clear() {
      const [a, b] = await Promise.all([frame.clear(), clearBoth(local, localBackup)]);
      return a && b;
    },
  };
}

/**
 * The run to start with the frame linked: the newest save in the frame
 * (storage or backup); only when the frame holds none, the newest of this
 * page's own copies (the first start with the frame, or frame storage the
 * browser wiped). The frame's save always wins over this page's copies, which
 * another game on itch.io's origin can write.
 */
export async function loadFramed(
  frame: { storage: SaveStorage; backup: Backup },
  local: { storage: SaveStorage | null; backup: Backup },
  now: number,
): Promise<Save | null> {
  const found = await loadNewest(frame.storage, frame.backup, now);
  return found ?? loadNewest(local.storage, local.backup, now);
}

/**
 * Adds the frame to the page (hidden) and links to it; null when the browser
 * can't pass the frame's check, the frame doesn't load or doesn't answer in
 * time. A null leaves no frame or listener behind.
 */
export function openFrame(
  config: FrameConfig,
  hooks: Pick<ClientDeps, 'onAdopt' | 'onNote'>,
): Promise<FrameLink | null> {
  // The frame answers only a page that knows its ancestors: without the list, don't wait for it.
  if (!('ancestorOrigins' in window.location)) return Promise.resolve(null);
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  const client = createClient({
    post: (m) => frame.contentWindow?.postMessage(m, config.origin),
    origin: config.origin,
    source: () => frame.contentWindow,
    ...hooks,
  });
  const listener = (e: MessageEvent): void => client.receive(e);
  window.addEventListener('message', listener);
  return new Promise((resolve) => {
    let settled = false;
    const done = (link: FrameLink | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!link) {
        window.removeEventListener('message', listener);
        frame.remove();
      }
      resolve(link);
    };
    const timer = setTimeout(() => done(null), LOAD_TIMEOUT_MS + HELLO_TIMEOUT_MS);
    frame.addEventListener('load', () => void client.connect().then(done), { once: true });
    frame.src = config.url;
    document.body.append(frame);
  });
}
