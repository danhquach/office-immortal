// The messages between the itch.io game and its storage frame on GitHub Pages
// (docs/design.md §11, "Cloud save on itch.io"). Both sides treat what arrives
// as untrusted: every message is read through an allow-list (known request and
// event types, exact keys, known storage keys, text of a sane size) into a
// fresh object, and anything off is dropped. The cloud sign-in token is never
// part of any message: it stays in the frame's own storage (CLOUD_KEY is not a
// mirrored key) and only the frame talks to the server. Nor is a link code,
// either way: a code joins a cloud save as well as the token would. The code
// is made and shown, and a code from another device typed, in visible frames
// on our origin (ui/code-frame.ts); a typed code goes from that frame straight
// to the storage frame beside it (LINK_PROTOCOL), never through the game.

import type { CloudMessage } from './cloud.ts';
import { ADOPT_KEY } from './cloud-meta.ts';
import { decodeSave, encodeSave, MAX_SAVE_CHARS, REJECTED_KEY, SAVE_KEY } from './save.ts';
import type { SyncStatus } from './sync.ts';
import { fail, int, obj, oneOf, type Obj } from './validate.ts';

/** Tags every message, so the frame and game ignore anything else posted to them. */
export const PROTOCOL = 'oi-store-1';

/**
 * The browser storage keys the game keeps in the frame and holds a copy of.
 * The cloud's own key (session, token) is not one of them.
 */
export const MIRROR_KEYS = [
  SAVE_KEY,
  REJECTED_KEY,
  ADOPT_KEY,
  'office-immortal.theme',
  'office-immortal.lang',
  'office-immortal.bagSort',
  'office-immortal.bagSortReverse',
] as const;
export type MirrorKey = (typeof MIRROR_KEYS)[number];

/** The longest value of a key that is not a save (settings, the adoption stamp). */
const MAX_SETTING_CHARS = 200;
/** The longest link code looked at; a real one is 10 characters, typed with spaces or dashes. */
const MAX_CODE_CHARS = 64;
/** Request ids count up from 1 in each game page. */
const MAX_ID = 2 ** 31;

export function isMirrorKey(k: unknown): k is MirrorKey {
  return typeof k === 'string' && (MIRROR_KEYS as readonly string[]).includes(k);
}

/** A value of `key`, or a failure when it is not text of that key's size. */
function value(key: MirrorKey, v: unknown): string {
  const max = key === SAVE_KEY || key === REJECTED_KEY ? MAX_SAVE_CHARS : MAX_SETTING_CHARS;
  if (typeof v !== 'string' || v.length > max) fail('bad value');
  return v;
}

function saveText(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_SAVE_CHARS) fail('bad save text');
  return v;
}

// Requests: game to frame.

/** Requests that carry nothing. */
const BARE_OPS = [
  'hello',
  'backup.read',
  'backup.clear',
  'sync.begin',
  'sync.retry',
  'sync.syncNow',
  'sync.turnOn',
  'sync.keepLocal',
  'sync.useCloud',
  'sync.turnOff',
  'sync.deleteCloud',
] as const;
type BareOp = (typeof BARE_OPS)[number];

export type Request = { id: number } & (
  | { op: BareOp }
  | { op: 'set'; key: MirrorKey; value: string }
  | { op: 'remove'; key: MirrorKey }
  | { op: 'backup.put'; raw: string }
  | { op: 'sync.offer'; raw: string; savedAt: number }
  | { op: 'sync.flush'; reason: 'hidden' | 'pagehide' }
);
export type Op = Request['op'];

/** The request in `data`, or null when it is not exactly one the frame takes. */
export function readRequest(data: unknown): Request | null {
  try {
    const head = obj(data, ['p', 'id', 'op'], ['key', 'value', 'raw', 'savedAt', 'reason']);
    if (head.p !== PROTOCOL) fail('protocol');
    const id = int(head.id, 1, MAX_ID);
    const op = head.op;
    const only = (keys: readonly string[]): Obj => obj(data, ['p', 'id', 'op', ...keys]);
    if ((BARE_OPS as readonly unknown[]).includes(op)) {
      only([]);
      return { id, op: op as BareOp };
    }
    switch (op) {
      case 'set': {
        const o = only(['key', 'value']);
        if (!isMirrorKey(o.key)) fail('key');
        return { id, op, key: o.key, value: value(o.key, o.value) };
      }
      case 'remove': {
        const o = only(['key']);
        if (!isMirrorKey(o.key)) fail('key');
        return { id, op, key: o.key };
      }
      case 'backup.put':
        return { id, op, raw: saveText(only(['raw']).raw) };
      case 'sync.offer': {
        const o = only(['raw', 'savedAt']);
        return {
          id,
          op,
          raw: saveText(o.raw),
          savedAt: int(o.savedAt, 0, Number.MAX_SAFE_INTEGER),
        };
      }
      case 'sync.flush':
        return { id, op, reason: oneOf(only(['reason']).reason, ['hidden', 'pagehide'] as const) };
      default:
        return fail('op');
    }
  } catch {
    return null;
  }
}

// Status and messages: what the frame's sync tells the game.

/** Every CloudMessage, so a code from the frame can be checked against the list. */
export const CLOUD_MESSAGES = [
  'already_member',
  'not_a_member',
  'bad_data',
  'save_too_large',
  'link_code_invalid',
  'link_code_expired',
  'generic',
  'offline',
  'auth',
  'server',
  'bad-response',
  'storage',
  'loaded',
  'deleted-elsewhere',
  'unreadable-kept',
  'cant-read',
  'refused-save',
  'refused-settings',
  'relink-first',
] as const satisfies readonly CloudMessage[];
// Fails to compile when CloudMessage gains a code the list lacks.
const allMessages: Exclude<CloudMessage, (typeof CLOUD_MESSAGES)[number]> extends never
  ? true
  : never = true;
void allMessages;

/** A SyncStatus as it travels: a conflict's two saves go as save text. */
export type WireStatus =
  | { kind: 'off' | 'checking' | 'syncing' | 'relink' | 'unreadable' }
  | { kind: 'synced'; at: number }
  | { kind: 'offline'; message: CloudMessage }
  | { kind: 'conflict'; local: string; server: string };

export function toWire(s: SyncStatus): WireStatus {
  switch (s.kind) {
    case 'synced':
      return { kind: s.kind, at: s.at };
    case 'offline':
      return { kind: s.kind, message: s.message };
    case 'conflict':
      return {
        kind: s.kind,
        local: encodeSave(s.local.state, s.local.savedAt),
        server: encodeSave(s.server.state, s.server.savedAt),
      };
    default:
      return { kind: s.kind };
  }
}

const PLAIN_KINDS = ['off', 'checking', 'syncing', 'relink', 'unreadable'] as const;

/** The status in `v`; a conflict's saves go through the load allow-list again. */
function readStatus(v: unknown): SyncStatus {
  const kind = obj(v, ['kind'], ['at', 'message', 'local', 'server']).kind;
  if ((PLAIN_KINDS as readonly unknown[]).includes(kind)) {
    obj(v, ['kind']);
    return { kind: kind as (typeof PLAIN_KINDS)[number] };
  }
  switch (kind) {
    case 'synced':
      return { kind, at: int(obj(v, ['kind', 'at']).at, 0, Number.MAX_SAFE_INTEGER) };
    case 'offline':
      return { kind, message: oneOf(obj(v, ['kind', 'message']).message, CLOUD_MESSAGES) };
    case 'conflict': {
      const o = obj(v, ['kind', 'local', 'server']);
      const local = decodeSave(o.local);
      const server = decodeSave(o.server);
      if (!local || !server) fail('conflict save');
      return { kind, local, server };
    }
    default:
      return fail('status');
  }
}

// Events and replies: frame to game.

export type FrameEvent =
  /** The frame's sync changed status. */
  | { ev: 'status'; status: SyncStatus }
  | { ev: 'note'; code: CloudMessage }
  /** The frame's sync took the cloud's save: the game restarts from its copy. */
  | { ev: 'adopt' }
  /** The frame's sync wrote a mirrored key (null: removed). */
  | { ev: 'write'; key: MirrorKey; value: string | null }
  /** Another tab changed a mirrored key (null: removed), or cleared storage (key null). */
  | { ev: 'storage'; key: MirrorKey | null; value: string | null };

export interface Reply {
  re: number;
  value: unknown;
}

/** A frame-to-game message as it is posted. */
export function event(e: { ev: string } & Record<string, unknown>): Record<string, unknown> {
  return e.ev === 'status'
    ? { p: PROTOCOL, ev: 'status', status: toWire(e.status as SyncStatus) }
    : { p: PROTOCOL, ...e };
}

/** The event or reply in `data`, or null when it is not exactly one the game takes. */
export function readFrameMessage(data: unknown): FrameEvent | Reply | null {
  try {
    const head = obj(data, ['p'], ['re', 'value', 'ev', 'status', 'code', 'key']);
    if (head.p !== PROTOCOL) fail('protocol');
    if (Object.hasOwn(head, 're')) {
      const o = obj(data, ['p', 're', 'value']);
      return { re: int(o.re, 1, MAX_ID), value: o.value };
    }
    switch (head.ev) {
      case 'status':
        return { ev: 'status', status: readStatus(obj(data, ['p', 'ev', 'status']).status) };
      case 'note':
        return { ev: 'note', code: oneOf(obj(data, ['p', 'ev', 'code']).code, CLOUD_MESSAGES) };
      case 'adopt':
        obj(data, ['p', 'ev']);
        return { ev: 'adopt' };
      case 'write': {
        const o = obj(data, ['p', 'ev', 'key', 'value']);
        if (!isMirrorKey(o.key)) fail('key');
        return { ev: 'write', key: o.key, value: o.value === null ? null : value(o.key, o.value) };
      }
      case 'storage': {
        const o = obj(data, ['p', 'ev', 'key', 'value']);
        if (o.key === null) {
          if (o.value !== null) fail('clear with a value');
          return { ev: 'storage', key: null, value: null };
        }
        if (!isMirrorKey(o.key)) fail('key');
        return {
          ev: 'storage',
          key: o.key,
          value: o.value === null ? null : value(o.key, o.value),
        };
      }
      default:
        return fail('event');
    }
  } catch {
    return null;
  }
}

// Reply values, read by the request that asked for them.

export interface Hello {
  /** The frame's mirrored keys that hold a value. */
  items: Map<MirrorKey, string>;
  /** Whether the frame has the cloud save. */
  cloud: boolean;
  status: SyncStatus;
}

export function helloReply(
  items: ReadonlyMap<MirrorKey, string>,
  cloud: boolean,
  status: SyncStatus,
): unknown {
  return { items: [...items], cloud, status: toWire(status) };
}

/** The hello reply in `v`, or null. */
export function readHello(v: unknown): Hello | null {
  try {
    const o = obj(v, ['items', 'cloud', 'status']);
    if (!Array.isArray(o.items) || o.items.length > MIRROR_KEYS.length) fail('items');
    const items = new Map<MirrorKey, string>();
    for (const pair of o.items as unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2) fail('pair');
      const [k, v] = pair as unknown[];
      if (!isMirrorKey(k) || items.has(k)) fail('key');
      items.set(k, value(k, v));
    }
    if (typeof o.cloud !== 'boolean') fail('cloud');
    return { items, cloud: o.cloud, status: readStatus(o.status) };
  } catch {
    return null;
  }
}

/** Backup read: save text or null; anything else counts as null. */
export function readBackupText(v: unknown): string | null {
  return typeof v === 'string' && v.length <= MAX_SAVE_CHARS ? v : null;
}

// The link frame and the storage frame: siblings in the game, both on our origin.

/** Tags a typed link code the link frame hands to the storage frame, and its answer. */
export const LINK_PROTOCOL = 'oi-link-1';

/** A typed link code and its attempt number, or null; odd characters are kept for the server to refuse. */
export function readLinkMessage(data: unknown): { code: string; n: number } | null {
  try {
    const o = obj(data, ['p', 'code', 'n']);
    if (o.p !== LINK_PROTOCOL) fail('protocol');
    if (typeof o.code !== 'string' || o.code.length > MAX_CODE_CHARS) fail('code');
    return { code: o.code, n: int(o.n, 1, MAX_ID) };
  } catch {
    return null;
  }
}

/** The attempt number in the storage frame's answer that a link attempt has ended, or null. */
export function readLinkDone(data: unknown): number | null {
  try {
    const o = obj(data, ['p', 'done', 'n']);
    if (o.p !== LINK_PROTOCOL || o.done !== true) fail('done');
    return int(o.n, 1, MAX_ID);
  } catch {
    return null;
  }
}

/** A delete reply; anything off reads as a failure that changed nothing. */
export function readDeleted(v: unknown): { ok: true } | { ok: false; message: CloudMessage } {
  try {
    const o = obj(v, ['ok'], ['message']);
    if (o.ok === true && !Object.hasOwn(o, 'message')) return { ok: true };
    if (o.ok === false) return { ok: false, message: oneOf(o.message, CLOUD_MESSAGES) };
    return fail('delete reply');
  } catch {
    return { ok: false, message: 'bad-response' };
  }
}
