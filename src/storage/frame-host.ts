// The storage frame's side (docs/design.md §11, "Cloud save on itch.io"). The
// frame runs on our GitHub Pages origin inside the itch.io game, and keeps
// what other games on itch.io's shared origin must not reach: the local save,
// its IndexedDB copy and the cloud save with its sign-in token. It answers
// only when the page embedding it is our own itch.io page, and only messages
// from its direct parent at that page's game origin. Replies go to that origin
// alone and never hold the token: the cloud's key is not mirrored, and the
// sync's messages carry codes and save text only.

import type { Backup } from './backup.ts';
import type { CloudMessage } from './cloud.ts';
import type { SaveStorage } from './save.ts';
import type { Sync } from './sync.ts';
import {
  event,
  helloReply,
  isMirrorKey,
  MIRROR_KEYS,
  PROTOCOL,
  readRequest,
  type MirrorKey,
  type Request,
} from './frame-protocol.ts';

/** Where itch.io serves uploaded HTML5 games (html-classic.itch.zone today). */
const ITCH_GAME_ORIGIN = /^https:\/\/[a-z0-9-]{1,63}\.itch\.zone$/;

/**
 * The game page's origin when the frame may answer it, else null. The frame
 * must sit in the game, and the game directly in our itch.io page at the top:
 * exactly two ancestors, the outer one ours and the inner one itch.io's game
 * host (not another frame on our page, such as a video). A missing list (browsers without
 * `location.ancestorOrigins`) or any other shape is refused, so another game on
 * the same itch.io origin, embedded in its own page, gets no answer.
 */
export function allowedParent(
  ancestors: readonly string[] | null | undefined,
  itchOrigin: string | null,
): string | null {
  if (!itchOrigin || !ancestors || ancestors.length !== 2) return null;
  const [parent, top] = ancestors;
  if (top !== itchOrigin || !parent || !ITCH_GAME_ORIGIN.test(parent)) return null;
  return parent;
}

/** Whether `storage` takes a write; partitioned or blocked frame storage may refuse. */
export function storageWorks(storage: SaveStorage | null): storage is SaveStorage {
  if (!storage) return false;
  try {
    storage.setItem('office-immortal.probe', '1');
    storage.removeItem('office-immortal.probe');
    return true;
  } catch {
    return false;
  }
}

export interface Incoming {
  data: unknown;
  origin: string;
  source: unknown;
}

export interface HostDeps {
  /** `location.ancestorOrigins` as a list; null where the browser lacks it. */
  ancestors: readonly string[] | null;
  /** The itch.io page allowed to embed the frame (frame-config.ts). */
  itchOrigin: string | null;
  /** The frame's parent window: the only source taken. */
  parent: unknown;
  /** Posts to the parent at `origin` (the checked one, never "*"). */
  post(message: unknown, origin: string): void;
  /** The frame's browser storage; null where blocked. */
  storage: SaveStorage | null;
  /** The frame's IndexedDB copy of the save. */
  backup: Backup;
  /** Makes the cloud sync on the frame's storage; null when the build has no cloud save. */
  makeSync: ((storage: SaveStorage, hooks: Hooks) => Sync) | null;
}

/** What the sync tells its page, sent on to the game. */
export interface Hooks {
  onAdopt(): void;
  onNote(code: CloudMessage): void;
}

export interface Host {
  /** A message posted to the frame. */
  receive(e: Incoming): void;
  /** A storage event from another tab of the frame (key null: storage cleared). */
  otherTab(key: string | null, value: string | null): void;
}

/** Requests the game waits on; the rest are fire-and-forget. */
const ANSWERED: readonly Request['op'][] = [
  'hello',
  'backup.read',
  'backup.put',
  'backup.clear',
  'sync.syncNow',
  'sync.turnOn',
  'sync.link',
  'sync.linkCode',
  'sync.keepLocal',
  'sync.deleteCloud',
];

/** The frame's host, or null when it must not answer (wrong ancestors, no working storage). */
export function createHost(deps: HostDeps): Host | null {
  const origin = allowedParent(deps.ancestors, deps.itchOrigin);
  if (!origin || !storageWorks(deps.storage)) return null;
  const raw: SaveStorage = deps.storage;
  const send = (message: Record<string, unknown>): void => deps.post(message, origin);
  const emit = (e: { ev: string } & Record<string, unknown>): void => send(event(e));

  /** The sync's view of storage: its writes to mirrored keys reach the game's copy. */
  const tracked: SaveStorage = {
    getItem: (k) => raw.getItem(k),
    setItem(k, v) {
      raw.setItem(k, v);
      if (isMirrorKey(k)) emit({ ev: 'write', key: k, value: v });
    },
    removeItem(k) {
      raw.removeItem(k);
      if (isMirrorKey(k)) emit({ ev: 'write', key: k, value: null });
    },
  };

  const sync = deps.makeSync
    ? deps.makeSync(tracked, {
        onAdopt: () => emit({ ev: 'adopt' }),
        onNote: (code) => emit({ ev: 'note', code }),
      })
    : null;
  sync?.subscribe((status) => emit({ ev: 'status', status }));

  function items(): Map<MirrorKey, string> {
    const out = new Map<MirrorKey, string>();
    for (const k of MIRROR_KEYS) {
      try {
        const v = raw.getItem(k);
        if (v !== null) out.set(k, v);
      } catch {
        // Unreadable: the game sees no value.
      }
    }
    return out;
  }

  async function run(r: Request): Promise<unknown> {
    switch (r.op) {
      case 'hello':
        return helloReply(items(), sync !== null, sync?.status ?? { kind: 'off' });
      case 'set':
        try {
          raw.setItem(r.key, r.value);
        } catch {
          // Full or blocked: the game's copy still holds it, and the next save tries again.
        }
        return null;
      case 'remove':
        try {
          raw.removeItem(r.key);
        } catch {
          // As for set.
        }
        return null;
      case 'backup.read':
        return deps.backup.read();
      case 'backup.put':
        return deps.backup.put(r.raw);
      case 'backup.clear':
        return deps.backup.clear();
      case 'sync.deleteCloud':
        return sync ? sync.deleteCloud() : { ok: true };
      case 'sync.linkCode':
        return sync ? sync.linkCode() : null;
    }
    if (!sync) return null;
    switch (r.op) {
      case 'sync.begin':
        sync.begin();
        break;
      case 'sync.offer':
        sync.offer(r.raw, r.savedAt);
        break;
      case 'sync.flush':
        sync.flush(r.reason);
        break;
      case 'sync.retry':
        sync.retry();
        break;
      case 'sync.syncNow':
        await sync.syncNow();
        break;
      case 'sync.turnOn':
        await sync.turnOn();
        break;
      case 'sync.link':
        await sync.link(r.code);
        break;
      case 'sync.keepLocal':
        await sync.keepLocal();
        break;
      case 'sync.useCloud':
        sync.useCloud();
        break;
      case 'sync.turnOff':
        sync.turnOff();
        break;
    }
    return null;
  }

  return {
    receive(e) {
      if (e.source !== deps.parent || e.origin !== origin) return;
      const r = readRequest(e.data);
      if (!r) return;
      const answer = ANSWERED.includes(r.op);
      void run(r).then(
        (value) => answer && send({ p: PROTOCOL, re: r.id, value }),
        () => answer && send({ p: PROTOCOL, re: r.id, value: null }),
      );
    },
    otherTab(key, value) {
      if (key === null) emit({ ev: 'storage', key: null, value: null });
      else if (isMirrorKey(key)) emit({ ev: 'storage', key, value });
    },
  };
}
