// The REST client for the cloud save (docs/design.md §11): plain fetch against
// Supabase's auth and function endpoints, no SDK. Nothing secret or personal
// goes in a URL (tokens in headers, everything else in JSON bodies), every
// request times out, and every reply is shape-checked before anything reads it.
// Server text is never shown: errors map to our own messages.

import type { CloudConfig } from './cloud-config.ts';
import { isToken, isUuid, MAX_REV, readMeta, writeMeta, type Session } from './cloud-meta.ts';
import { MAX_SAVE_CHARS, type SaveStorage } from './save.ts';
import { fail, int, obj } from './validate.ts';

export const REQUEST_TIMEOUT_MS = 10_000;
/** Browsers cap a keepalive request body at 64 KB; stay well under. */
export const KEEPALIVE_MAX_BYTES = 48 * 1024;
/** A save is at most MAX_SAVE_CHARS; JSON escaping can grow it, so allow double. */
const RESPONSE_MAX_CHARS = 2 * MAX_SAVE_CHARS;
/** Renew an access token this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;
const LOCK_NAME = 'oi-cloud-auth';

/** What the server's functions raise; any other message is treated as a generic failure. */
const SERVER_CODES = [
  'already_member',
  'not_a_member',
  'bad_data',
  'save_too_large',
  'link_code_invalid',
  'link_code_expired',
] as const;
export type ServerCode = (typeof SERVER_CODES)[number];

export type CloudErrorKind =
  /** No connection, a timeout, or the browser refused the request. */
  | 'offline'
  /** The sign-in was refused. */
  | 'auth'
  /** Rate limit or server trouble: try again later. */
  | 'server'
  /** The reply was not what the server sends (HTML, not JSON, wrong shape, too big). */
  | 'bad-response'
  /** The server refused this request for a reason in SERVER_CODES. */
  | 'rejected';

export class CloudError extends Error {
  kind: CloudErrorKind;
  code: ServerCode | null;
  status: number;
  constructor(kind: CloudErrorKind, code: ServerCode | null = null, status = 0) {
    super(kind);
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

const SERVER_TEXT: Record<ServerCode, string> = {
  already_member: 'This browser already has a cloud save.',
  not_a_member: 'There is no cloud save for this browser.',
  bad_data: 'The cloud save was refused.',
  save_too_large: 'The save is too large for the cloud.',
  link_code_invalid: 'That link code is not valid. Check it and try again.',
  link_code_expired: 'That link code has expired. Get a new one on the other device.',
};

/** Words for the player; fixed text, never the server's own. */
export function describeError(e: unknown): string {
  if (!(e instanceof CloudError)) return 'Cloud save hit a problem.';
  if (e.code) return SERVER_TEXT[e.code];
  switch (e.kind) {
    case 'offline':
      return 'Cannot reach the cloud. Playing continues; it will retry.';
    case 'auth':
      return 'The cloud sign-in was refused.';
    case 'server':
      return 'The cloud is busy. It will retry.';
    default:
      return 'The cloud sent an unexpected reply.';
  }
}

/** The part of the browser's Web Locks API the client uses. */
export interface Locks {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

export interface CloudDeps {
  config: CloudConfig;
  /** Holds the session (cloud-meta.ts); other tabs of the same browser share it. */
  storage: SaveStorage;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  /** Serialises token renewal across tabs; without it (older browsers) tabs may race. */
  locks?: Locks | null;
}

export interface Cloud {
  /** Creates an anonymous user; the caller stores the session. */
  signUp(): Promise<Session>;
  createSave(data: string): Promise<{ saveId: string; rev: number }>;
  getSave(): Promise<{ saveId: string; data: string; rev: number } | null>;
  putSave(
    data: string,
    baseRev: number | null,
    keepalive?: boolean,
  ): Promise<{ ok: true; rev: number } | { ok: false; rev: number; data: string }>;
  createLinkCode(): Promise<{ code: string; ttl: number }>;
  redeemLinkCode(code: string): Promise<{ saveId: string; data: string; rev: number }>;
  deleteSave(): Promise<void>;
}

/** Whether `data` fits in a keepalive request (the page-leaving upload). */
export function fitsKeepalive(data: string): boolean {
  return new TextEncoder().encode(data).length <= KEEPALIVE_MAX_BYTES;
}

export function createCloud(deps: CloudDeps): Cloud {
  const { config, storage } = deps;

  /** One POST with a body; resolves to the parsed JSON (null for an empty reply). */
  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string>,
    keepalive = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CloudError('offline'));
      }, REQUEST_TIMEOUT_MS);
    });
    let status: number;
    let text: string;
    try {
      const res = await Promise.race([
        deps.fetch(config.url + path, {
          method: 'POST',
          headers: { apikey: config.key, 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: controller.signal,
          keepalive,
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        }),
        timeout,
      ]);
      status = res.status;
      const length = Number(res.headers.get('content-length'));
      if (length > RESPONSE_MAX_CHARS) throw new CloudError('bad-response', null, status);
      text = await Promise.race([res.text(), timeout]);
    } catch (e) {
      throw e instanceof CloudError ? e : new CloudError('offline');
    } finally {
      clearTimeout(timer);
    }
    if (text.length > RESPONSE_MAX_CHARS) throw new CloudError('bad-response', null, status);
    let json: unknown = null;
    try {
      if (text !== '') json = JSON.parse(text);
    } catch {
      throw new CloudError('bad-response', null, status);
    }
    if (status >= 200 && status < 300) return json;
    if (status === 401 || status === 403) throw new CloudError('auth', null, status);
    if (status === 408 || status === 429 || status >= 500) {
      throw new CloudError('server', null, status);
    }
    throw new CloudError('rejected', serverCode(json), status);
  }

  function serverCode(json: unknown): ServerCode | null {
    const message = typeof json === 'object' && json !== null ? Reflect.get(json, 'message') : null;
    return SERVER_CODES.find((c) => c === message) ?? null;
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    return deps.locks ? (deps.locks.request(LOCK_NAME, fn) as Promise<T>) : fn();
  }

  /** A session out of an auth reply; it carries more fields than we use. */
  function readSession(json: unknown): Session {
    try {
      if (typeof json !== 'object' || json === null) fail('not an object');
      const field = (k: string): unknown => (Object.hasOwn(json, k) ? Reflect.get(json, k) : null);
      const access = field('access_token');
      const refresh = field('refresh_token');
      if (!isToken(access) || !isToken(refresh)) fail('bad token');
      const seconds = int(field('expires_in'), 60, 7 * 24 * 3600);
      return { access, refresh, expiresAt: deps.now() + seconds * 1000 };
    } catch {
      throw new CloudError('bad-response');
    }
  }

  /**
   * A usable access token, renewing it first when it is about to expire or is
   * `stale` (the server just refused it). Renewal is serialised across tabs and
   * re-reads the session inside the lock, so one tab's renewal serves them all.
   * A refresh token the server refuses means the player must link again.
   */
  async function accessToken(stale?: string): Promise<string> {
    const needsRenewal = (s: Session): boolean =>
      s.access === stale || s.expiresAt - REFRESH_MARGIN_MS <= deps.now();
    const first = readMeta(storage)?.session;
    if (!first) throw new CloudError('auth');
    if (!needsRenewal(first)) return first.access;
    return withLock(async () => {
      const meta = readMeta(storage);
      if (!meta?.session) throw new CloudError('auth');
      if (!needsRenewal(meta.session)) return meta.session.access;
      let session: Session;
      try {
        const json = await post(
          '/auth/v1/token?grant_type=refresh_token',
          {
            refresh_token: meta.session.refresh,
          },
          {},
        );
        session = readSession(json);
      } catch (e) {
        if (e instanceof CloudError && [400, 401, 403].includes(e.status)) {
          writeMeta(storage, { ...meta, session: null, relink: true });
          throw new CloudError('auth', null, e.status);
        }
        throw e;
      }
      writeMeta(storage, { ...meta, session });
      return session.access;
    });
  }

  /** The stored access token if it is still good, without any waiting (page-leaving upload). */
  function freshAccess(): string {
    const session = readMeta(storage)?.session;
    if (!session || session.expiresAt - REFRESH_MARGIN_MS <= deps.now()) {
      throw new CloudError('auth');
    }
    return session.access;
  }

  async function rpc(name: string, args: object, keepalive = false): Promise<unknown> {
    const path = `/rest/v1/rpc/${name}`;
    // For a keepalive call nothing may be awaited before fetch starts: the page is closing.
    const token = keepalive ? freshAccess() : await accessToken();
    const send = (t: string): Promise<unknown> =>
      post(path, args, { Authorization: `Bearer ${t}` }, keepalive);
    try {
      return await send(token);
    } catch (e) {
      if (keepalive || !(e instanceof CloudError) || e.kind !== 'auth') throw e;
      // The clock or another device may have outdated the token: renew once and retry.
      return send(await accessToken(token));
    }
  }

  /** Runs a reader over a reply; a reply of the wrong shape is a bad-response. */
  function shaped<T>(json: unknown, read: (o: unknown) => T): T {
    try {
      return read(json);
    } catch {
      throw new CloudError('bad-response');
    }
  }

  const rev = (v: unknown): number => int(v, 1, MAX_REV);
  const id = (v: unknown): string => (isUuid(v) ? v : fail('bad id'));
  const text = (v: unknown): string => (typeof v === 'string' ? v : fail('not text'));

  return {
    async signUp() {
      return readSession(await post('/auth/v1/signup', {}, {}));
    },
    async createSave(data) {
      return shaped(await rpc('create_save', { p_data: data }), (r) => {
        const x = obj(r, ['save_id', 'rev']);
        return { saveId: id(x.save_id), rev: rev(x.rev) };
      });
    },
    async getSave() {
      return shaped(await rpc('get_save', {}), (r) => {
        if (r === null) return null;
        const x = obj(r, ['save_id', 'data', 'rev']);
        return { saveId: id(x.save_id), data: text(x.data), rev: rev(x.rev) };
      });
    },
    async putSave(data, baseRev, keepalive = false) {
      const reply = await rpc('put_save', { p_data: data, p_base_rev: baseRev }, keepalive);
      return shaped(reply, (r) => {
        const x = obj(r, ['ok', 'rev'], ['data']);
        if (x.ok === true && !Object.hasOwn(x, 'data'))
          return { ok: true as const, rev: rev(x.rev) };
        if (x.ok === false) return { ok: false as const, rev: rev(x.rev), data: text(x.data) };
        return fail('bad put reply');
      });
    },
    async createLinkCode() {
      return shaped(await rpc('create_link_code', {}), (r) => {
        const x = obj(r, ['code', 'ttl']);
        if (typeof x.code !== 'string' || !/^[0-9A-Z]{10}$/.test(x.code)) fail('bad code');
        return { code: x.code, ttl: int(x.ttl, 1, 3600) };
      });
    },
    async redeemLinkCode(code) {
      return shaped(await rpc('redeem_link_code', { p_code: code }), (r) => {
        const x = obj(r, ['save_id', 'data', 'rev']);
        return { saveId: id(x.save_id), data: text(x.data), rev: rev(x.rev) };
      });
    },
    async deleteSave() {
      shaped(await rpc('delete_save', {}), (r) => {
        if (obj(r, ['ok']).ok !== true) fail('not ok');
      });
    },
  };
}
