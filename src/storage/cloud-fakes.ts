// Fakes shared by the cloud tests: a storage in memory, a clock, a fetch that
// routes to handlers and records every call, and a lock that queues callers.
// Test support only; nothing in the app imports this file.

import { newMeta, writeMeta, type CloudMeta } from './cloud-meta.ts';
import type { CloudConfig } from './cloud-config.ts';
import type { Locks } from './cloud.ts';
import type { SaveStorage } from './save.ts';

export const CONFIG: CloudConfig = {
  url: 'https://abcdefghij.supabase.co',
  key: 'sb_publishable_abcdefghijklmnopqrstu',
};
export const SAVE_ID = '11111111-1111-4111-8111-111111111111';

export interface FakeStorage extends SaveStorage {
  data: Map<string, string>;
  /** Make every later write throw, as a full or blocked storage does. */
  failWrites: boolean;
}

export function memory(): FakeStorage {
  const data = new Map<string, string>();
  const s: FakeStorage = {
    data,
    failWrites: false,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (s.failWrites) throw new Error('quota');
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
  return s;
}

export interface Call {
  url: string;
  init: RequestInit;
  /** The parsed JSON body. */
  body: Record<string, unknown>;
}

export type Handler = (call: Call) => Response | Promise<Response>;

/** A fetch that gives each call to `route(name)` where name is the last path segment. */
export function fakeFetch(routes: Record<string, Handler>): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: Call[];
  count(name: string): number;
} {
  const calls: Call[] = [];
  return {
    calls,
    count: (name) => calls.filter((c) => c.url.includes(name)).length,
    async fetch(url, init) {
      const call: Call = {
        url,
        init,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
      calls.push(call);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) throw new Error(`unrouted ${url}`);
      return (routes[key] as Handler)(call);
    },
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

export const tokenReply = (n: number): Response =>
  json({
    access_token: `access-token-${n}`,
    refresh_token: `refresh-token-${n}`,
    expires_in: 3600,
    user: { id: SAVE_ID },
  });

export function clock(start = 1_800_000_000_000): { now: () => number; t: number } {
  const c = { t: start, now: () => c.t };
  return c;
}

/** A Web Locks stand-in: callers of the same name run one after another. */
export function fakeLocks(): Locks {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request(_name, callback) {
      const run = tail.then(callback, callback);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

export function signedIn(storage: FakeStorage, now: number, patch: Partial<CloudMeta> = {}): void {
  writeMeta(storage, {
    ...newMeta({
      access: 'access-token-0',
      refresh: 'refresh-token-0',
      expiresAt: now + 3_600_000,
    }),
    ...patch,
  });
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * A stand-in for the Supabase project that follows the migration's rules: users
 * with tokens, one save per user, revisions, one-time link codes. Knobs make it
 * misbehave: `down` answers 503, `loseNextPut` applies a put but drops the reply.
 */
export function fakeServer() {
  const saves = new Map<string, { data: string; rev: number }>();
  const members = new Map<string, string>();
  const codes = new Map<string, string>();
  const users = new Map<string, string>();
  const refreshOwner = new Map<string, string>();
  let nextId = 1;
  const server = {
    saves,
    members,
    down: false,
    loseNextPut: false,
    /** Refuse every renewal, as if the refresh token were revoked. */
    revokeRefresh: false,
    /** Replaces the next get_save reply, e.g. with a hostile save. */
    getSaveReply: null as unknown,
    /** Holds a function's calls (by name) until the promise settles. */
    hold: {} as Record<string, Promise<void> | undefined>,
    calls: [] as Call[],
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const call: Call = {
        url,
        init,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
      server.calls.push(call);
      if (server.down) return json({}, 503);
      if (url.endsWith('/auth/v1/signup')) {
        const n = nextId++;
        users.set(`access-token-u${n}`, uuid(1000 + n));
        refreshOwner.set(`refresh-token-u${n}`, uuid(1000 + n));
        return json({
          access_token: `access-token-u${n}`,
          refresh_token: `refresh-token-u${n}`,
          expires_in: 3600,
        });
      }
      if (url.includes('grant_type=refresh_token')) {
        if (server.revokeRefresh) return json({ error: 'invalid_grant' }, 400);
        const n = nextId++;
        const owner = refreshOwner.get(String(call.body.refresh_token));
        if (!owner) return json({ error: 'invalid_grant' }, 400);
        users.set(`access-token-u${n}`, owner);
        refreshOwner.set(`refresh-token-u${n}`, owner);
        return json({
          access_token: `access-token-u${n}`,
          refresh_token: `refresh-token-u${n}`,
          expires_in: 3600,
        });
      }
      const headers = init.headers as Record<string, string>;
      const user = users.get((headers.Authorization ?? '').replace('Bearer ', ''));
      if (!user) return json({ message: 'JWT invalid' }, 401);
      const name = url.split('/rpc/')[1];
      await server.hold[name ?? ''];
      const mine = members.get(user);
      const error = (message: string): Response => json({ code: 'P0001', message }, 400);
      switch (name) {
        case 'create_save': {
          if (mine) return error('already_member');
          const id = uuid(nextId++);
          saves.set(id, { data: String(call.body.p_data), rev: 1 });
          members.set(user, id);
          return json({ save_id: id, rev: 1 });
        }
        case 'get_save': {
          if (server.getSaveReply !== null) {
            const r = server.getSaveReply;
            server.getSaveReply = null;
            return json(r);
          }
          const s = mine ? saves.get(mine) : undefined;
          return json(s && mine ? { save_id: mine, data: s.data, rev: s.rev } : null);
        }
        case 'put_save': {
          const s = mine ? saves.get(mine) : undefined;
          if (!s) return error('not_a_member');
          let reply: Response;
          if (s.rev === call.body.p_base_rev) {
            s.data = String(call.body.p_data);
            s.rev++;
            reply = json({ ok: true, rev: s.rev });
          } else reply = json({ ok: false, rev: s.rev, data: s.data });
          if (server.loseNextPut) {
            server.loseNextPut = false;
            throw new TypeError('connection lost');
          }
          return reply;
        }
        case 'create_link_code': {
          if (!mine) return error('not_a_member');
          const code = `ABCDEFGH${String(codes.size + 10)}`;
          codes.set(code, mine);
          return json({ code, ttl: 900 });
        }
        case 'redeem_link_code': {
          const code = String(call.body.p_code)
            .toUpperCase()
            .replace(/[\s-]/g, '')
            .replace(/[IL]/g, '1')
            .replace(/O/g, '0');
          const target = codes.get(code);
          if (!target) return error('link_code_invalid');
          codes.delete(code);
          if (mine && mine !== target) {
            members.delete(user);
            if (![...members.values()].includes(mine)) saves.delete(mine);
          }
          members.set(user, target);
          const s = saves.get(target) as { data: string; rev: number };
          return json({ save_id: target, data: s.data, rev: s.rev });
        }
        case 'delete_save': {
          if (mine) {
            saves.delete(mine);
            for (const [u, id] of [...members]) if (id === mine) members.delete(u);
          }
          return json({ ok: true });
        }
      }
      return json({}, 404);
    },
  };
  return server;
}
