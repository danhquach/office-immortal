// The cloud save's bookkeeping, kept in browser storage beside the save
// (docs/design.md §11): the sign-in session, which server save this browser
// belongs to, and the last revision it saw. Read back with the same allow-list
// discipline as the save: anything off means "cloud save is off here", and the
// local save is never touched.

import type { SaveStorage } from './save.ts';
import { fail, int, obj } from './validate.ts';

export const CLOUD_KEY = 'office-immortal.cloud';
/** Written when this browser takes the cloud's save, so its other tabs restart from it. */
export const ADOPT_KEY = 'office-immortal.cloud.adopted';

export interface Session {
  readonly access: string;
  readonly refresh: string;
  /** When the access token expires, in ms since the epoch. */
  readonly expiresAt: number;
}

export interface CloudMeta {
  /** Null once the server refused to renew it (`relink` is then true). */
  readonly session: Session | null;
  /** The server save this browser syncs with; null until one exists. */
  readonly saveId: string | null;
  /** The server revision this browser last uploaded or downloaded. */
  readonly baseRev: number | null;
  /** `savedAt` of the local save last uploaded or downloaded (this device's clock). */
  readonly syncedSavedAt: number;
  /** A link code was redeemed but the player has not yet chosen between the two saves. */
  readonly pendingLink: boolean;
  /** The server revision whose save did not pass the allow-list; never uploaded over unasked. */
  readonly rejectedRev: number | null;
  /** The sign-in can't be renewed: local play goes on, uploads stop, the player re-links. */
  readonly relink: boolean;
}

export const MAX_REV = Number.MAX_SAFE_INTEGER;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{8,4096}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function isToken(v: unknown): v is string {
  return typeof v === 'string' && TOKEN.test(v);
}

function flag(v: unknown): boolean {
  if (typeof v !== 'boolean') fail('not a flag');
  return v;
}

function uuid(v: unknown): string {
  if (!isUuid(v)) fail('bad id');
  return v;
}

function readSession(v: unknown): Session {
  const o = obj(v, ['access', 'refresh', 'expiresAt']);
  if (!isToken(o.access) || !isToken(o.refresh)) fail('bad token');
  return {
    access: o.access,
    refresh: o.refresh,
    expiresAt: int(o.expiresAt, 0, 1e15),
  };
}

/** The stored meta, or null when there is none or it fails any check. */
export function readMeta(storage: SaveStorage): CloudMeta | null {
  try {
    const raw = storage.getItem(CLOUD_KEY);
    if (raw === null || raw.length > 20_000) return null;
    const o = obj(JSON.parse(raw), [
      'session',
      'saveId',
      'baseRev',
      'syncedSavedAt',
      'pendingLink',
      'rejectedRev',
      'relink',
    ]);
    return {
      session: o.session === null ? null : readSession(o.session),
      saveId: o.saveId === null ? null : uuid(o.saveId),
      baseRev: o.baseRev === null ? null : int(o.baseRev, 1, MAX_REV),
      syncedSavedAt: int(o.syncedSavedAt, 0, Number.MAX_SAFE_INTEGER),
      pendingLink: flag(o.pendingLink),
      rejectedRev: o.rejectedRev === null ? null : int(o.rejectedRev, 1, MAX_REV),
      relink: flag(o.relink),
    };
  } catch {
    return null;
  }
}

/** Writes the meta; returns false when storage refuses (full, blocked). */
export function writeMeta(storage: SaveStorage, meta: CloudMeta): boolean {
  try {
    storage.setItem(CLOUD_KEY, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the cloud on this device; the server save stays for other devices. */
export function clearMeta(storage: SaveStorage): boolean {
  try {
    storage.removeItem(CLOUD_KEY);
    return true;
  } catch {
    return false;
  }
}

export function newMeta(session: Session): CloudMeta {
  return {
    session,
    saveId: null,
    baseRev: null,
    syncedSavedAt: 0,
    pendingLink: false,
    rejectedRev: null,
    relink: false,
  };
}
