import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG,
  SAVE_ID,
  clock,
  fakeFetch,
  fakeLocks,
  json,
  memory,
  signedIn,
  tokenReply,
} from './cloud-fakes.ts';
import { readMeta } from './cloud-meta.ts';
import {
  CloudError,
  KEEPALIVE_MAX_BYTES,
  createCloud,
  describeError,
  fitsKeepalive,
} from './cloud.ts';

const SAVE = '{"v":6,"savedAt":1,"state":{}}';

function setup(routes: Parameters<typeof fakeFetch>[0], opts: { locks?: boolean } = {}) {
  const storage = memory();
  const time = clock();
  const net = fakeFetch(routes);
  const cloud = createCloud({
    config: CONFIG,
    storage,
    fetch: net.fetch,
    now: time.now,
    locks: opts.locks ? fakeLocks() : null,
  });
  signedIn(storage, time.t);
  return { storage, time, net, cloud };
}

async function failure(p: Promise<unknown>): Promise<CloudError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CloudError);
    return e as CloudError;
  }
  throw new Error('expected a failure');
}

describe('requests', () => {
  it('signs up anonymously with an empty body and reads the session', async () => {
    const { cloud, net, time } = setup({ '/auth/v1/signup': () => tokenReply(1) });
    const session = await cloud.signUp();
    expect(session).toEqual({
      access: 'access-token-1',
      refresh: 'refresh-token-1',
      expiresAt: time.t + 3_600_000,
    });
    expect(net.calls[0]?.body).toEqual({});
    expect(net.calls[0]?.url).toBe(`${CONFIG.url}/auth/v1/signup`);
  });

  it('calls a function with the token in a header and the data in a JSON body, never the URL', async () => {
    const { cloud, net } = setup({
      create_save: () => json({ save_id: SAVE_ID, rev: 1 }),
    });
    expect(await cloud.createSave(SAVE)).toEqual({ saveId: SAVE_ID, rev: 1 });
    const call = net.calls[0];
    expect(call?.url).toBe(`${CONFIG.url}/rest/v1/rpc/create_save`);
    expect(call?.body).toEqual({ p_data: SAVE });
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-token-0');
    expect(headers.apikey).toBe(CONFIG.key);
    expect(call?.init.credentials).toBe('omit');
    for (const c of net.calls) {
      expect(c.url).not.toContain('access-token');
      expect(c.url).not.toContain('savedAt');
      expect(c.url).not.toContain('?');
    }
  });

  it('puts with the base revision and understands both replies', async () => {
    let reply: unknown = { ok: true, rev: 4 };
    const { cloud, net } = setup({ put_save: () => json(reply) });
    expect(await cloud.putSave(SAVE, 3)).toEqual({ ok: true, rev: 4 });
    expect(net.calls[0]?.body).toEqual({ p_data: SAVE, p_base_rev: 3 });
    reply = { ok: false, rev: 9, data: SAVE };
    expect(await cloud.putSave(SAVE, 3)).toEqual({ ok: false, rev: 9, data: SAVE });
  });

  it('reads get_save as a save or null', async () => {
    let reply: unknown = null;
    const { cloud } = setup({ get_save: () => json(reply) });
    expect(await cloud.getSave()).toBeNull();
    reply = { save_id: SAVE_ID, data: SAVE, rev: 2 };
    expect(await cloud.getSave()).toEqual({ saveId: SAVE_ID, data: SAVE, rev: 2 });
  });

  it('reads link code and redeem replies', async () => {
    const { cloud, net } = setup({
      create_link_code: () => json({ code: 'ABCDEFGH23', ttl: 900 }),
      redeem_link_code: () => json({ save_id: SAVE_ID, data: SAVE, rev: 5 }),
      delete_save: () => json({ ok: true }),
    });
    expect(await cloud.createLinkCode()).toEqual({ code: 'ABCDEFGH23', ttl: 900 });
    expect(await cloud.redeemLinkCode('abcd-efgh-23')).toEqual({
      saveId: SAVE_ID,
      data: SAVE,
      rev: 5,
    });
    expect(net.calls[1]?.body).toEqual({ p_code: 'abcd-efgh-23' });
    await cloud.deleteSave();
  });
});

describe('hostile replies', () => {
  const wrongShapes: [string, unknown][] = [
    ['an array', []],
    ['a string', 'ok'],
    ['an extra key', { save_id: SAVE_ID, rev: 1, admin: true }],
    ['a __proto__ key', JSON.parse('{"save_id":"' + SAVE_ID + '","rev":1,"__proto__":{"x":1}}')],
    ['a bad id', { save_id: 'not-a-uuid', rev: 1 }],
    ['a fractional rev', { save_id: SAVE_ID, rev: 1.5 }],
    ['a negative rev', { save_id: SAVE_ID, rev: -1 }],
    ['a string rev', { save_id: SAVE_ID, rev: '1' }],
  ];
  it.each(wrongShapes)('rejects %s', async (_name, reply) => {
    const { cloud } = setup({ create_save: () => json(reply) });
    expect((await failure(cloud.createSave(SAVE))).kind).toBe('bad-response');
  });

  it('rejects wrong shapes from every other function', async () => {
    const bad = (): Response => json({ nope: 1 });
    const { cloud } = setup({
      get_save: bad,
      put_save: bad,
      create_link_code: bad,
      redeem_link_code: bad,
      delete_save: bad,
    });
    for (const p of [
      cloud.getSave(),
      cloud.putSave(SAVE, 1),
      cloud.createLinkCode(),
      cloud.redeemLinkCode('X'),
      cloud.deleteSave(),
    ]) {
      expect((await failure(p)).kind).toBe('bad-response');
    }
  });

  it('rejects a put reply that mixes the two shapes, and a code that is not ours', async () => {
    let reply: unknown = { ok: true, rev: 2, data: SAVE };
    const { cloud } = setup({
      put_save: () => json(reply),
      create_link_code: () => json({ code: '<script>', ttl: 900 }),
    });
    expect((await failure(cloud.putSave(SAVE, 1))).kind).toBe('bad-response');
    reply = { ok: false, rev: 2 };
    expect((await failure(cloud.putSave(SAVE, 1))).kind).toBe('bad-response');
    expect((await failure(cloud.createLinkCode())).kind).toBe('bad-response');
  });

  it('treats an HTML page, plain text and a truncated body as bad replies', async () => {
    for (const body of ['<html><body>Captive portal</body></html>', 'OK', '{"save_id":']) {
      const { cloud } = setup({ get_save: () => new Response(body, { status: 200 }) });
      expect((await failure(cloud.getSave())).kind).toBe('bad-response');
    }
  });

  it('refuses an oversized body, by header or by length', async () => {
    const big = JSON.stringify({ save_id: SAVE_ID, data: 'x'.repeat(500_000), rev: 1 });
    const a = setup({ get_save: () => new Response(big) });
    expect((await failure(a.cloud.getSave())).kind).toBe('bad-response');
    const b = setup({
      get_save: () => new Response('null', { headers: { 'content-length': '900000' } }),
    });
    expect((await failure(b.cloud.getSave())).kind).toBe('bad-response');
  });

  it('turns status codes into kinds', async () => {
    const cases: [number, string][] = [
      [429, 'server'],
      [500, 'server'],
      [503, 'server'],
      [408, 'server'],
      [404, 'rejected'],
    ];
    for (const [status, kind] of cases) {
      const { cloud } = setup({ get_save: () => json({ message: 'x' }, status) });
      expect((await failure(cloud.getSave())).kind).toBe(kind);
    }
    const html = setup({ get_save: () => new Response('<h1>Bad gateway</h1>', { status: 502 }) });
    expect((await failure(html.cloud.getSave())).kind).toBe('bad-response');
  });

  it("shows only our own text for a server error, never the server's", async () => {
    const { cloud } = setup({
      redeem_link_code: () => json({ message: 'link_code_invalid', hint: '<img src=x>' }, 400),
      get_save: () => json({ message: '<script>alert(1)</script> secret=abc' }, 400),
    });
    const known = await failure(cloud.redeemLinkCode('X'));
    expect(known.code).toBe('link_code_invalid');
    expect(describeError(known)).toBe('link_code_invalid');
    const unknown = await failure(cloud.getSave());
    expect(unknown.code).toBeNull();
    expect(describeError(unknown)).toBe('bad-response');
    expect(describeError(new Error('<b>x</b>'))).toBe('generic');
  });
});

describe('offline and timeouts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('treats a thrown fetch as offline', async () => {
    const { cloud } = setup({
      get_save: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect((await failure(cloud.getSave())).kind).toBe('offline');
  });

  it('gives up on a fetch that never answers after 10 s and aborts it', async () => {
    let signal: AbortSignal | null | undefined;
    const { cloud } = setup({
      get_save: ({ init }) => {
        signal = init.signal;
        return new Promise<Response>(() => undefined);
      },
    });
    const result = failure(cloud.getSave());
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).kind).toBe('offline');
    expect(signal?.aborted).toBe(true);
  });

  it('gives up on a body that never finishes', async () => {
    const { cloud } = setup({
      get_save: () => {
        const res = new Response('null');
        res.text = () => new Promise<string>(() => undefined);
        return res;
      },
    });
    const result = failure(cloud.getSave());
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).kind).toBe('offline');
  });
});

describe('sign-in session', () => {
  it('renews an expiring token once and uses the new one', async () => {
    const { cloud, net, storage, time } = setup({
      'grant_type=refresh_token': () => tokenReply(1),
      get_save: () => json(null),
    });
    time.t += 3_600_000 - 30_000; // inside the 60 s margin
    await cloud.getSave();
    expect(net.count('refresh_token')).toBe(1);
    expect(net.calls[0]?.body).toEqual({ refresh_token: 'refresh-token-0' });
    expect(net.calls[0]?.url).not.toContain('refresh-token');
    const headers = net.calls[1]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-token-1');
    expect(readMeta(storage)?.session?.refresh).toBe('refresh-token-1');
  });

  it('two tabs under a lock renew exactly once', async () => {
    const storage = memory();
    const time = clock();
    const net = fakeFetch({
      'grant_type=refresh_token': () => tokenReply(1),
      get_save: () => json(null),
    });
    const locks = fakeLocks();
    const tab = () =>
      createCloud({ config: CONFIG, storage, fetch: net.fetch, now: time.now, locks });
    signedIn(storage, time.t);
    time.t += 3_600_000;
    await Promise.all([tab().getSave(), tab().getSave()]);
    expect(net.count('refresh_token')).toBe(1);
    expect(net.count('get_save')).toBe(2);
    expect(readMeta(storage)?.session?.access).toBe('access-token-1');
  });

  it('two tabs without Web Locks both finish with a stored session', async () => {
    const storage = memory();
    const time = clock();
    const net = fakeFetch({
      'grant_type=refresh_token': () => tokenReply(1),
      get_save: () => json(null),
    });
    const tab = () => createCloud({ config: CONFIG, storage, fetch: net.fetch, now: time.now });
    signedIn(storage, time.t);
    time.t += 3_600_000;
    await Promise.all([tab().getSave(), tab().getSave()]);
    expect(net.count('get_save')).toBe(2);
    expect(readMeta(storage)?.session).not.toBeNull();
  });

  it('on a refused refresh token stops for good: relink, no new user, local meta kept', async () => {
    const { cloud, net, storage, time } = setup({
      'grant_type=refresh_token': () => json({ error: 'invalid_grant' }, 400),
      get_save: () => json(null),
      '/auth/v1/signup': () => tokenReply(9),
    });
    time.t += 3_600_000;
    expect((await failure(cloud.getSave())).kind).toBe('auth');
    const meta = readMeta(storage);
    expect(meta?.session).toBeNull();
    expect(meta?.relink).toBe(true);
    expect((await failure(cloud.getSave())).kind).toBe('auth');
    expect(net.count('signup')).toBe(0);
    expect(net.count('get_save')).toBe(0);
  });

  it('keeps the session when a renewal fails for network or server reasons', async () => {
    const { cloud, storage, time } = setup({
      'grant_type=refresh_token': () => json({}, 503),
    });
    time.t += 3_600_000;
    expect((await failure(cloud.getSave())).kind).toBe('server');
    expect(readMeta(storage)?.session?.refresh).toBe('refresh-token-0');
    expect(readMeta(storage)?.relink).toBe(false);
  });

  it('renews once and retries when the server refuses a token that looks fresh', async () => {
    let first = true;
    const { cloud, net } = setup({
      'grant_type=refresh_token': () => tokenReply(1),
      get_save: () => {
        if (first) {
          first = false;
          return json({ message: 'JWT expired' }, 401);
        }
        return json(null);
      },
    });
    expect(await cloud.getSave()).toBeNull();
    expect(net.count('get_save')).toBe(2);
    expect(net.count('refresh_token')).toBe(1);
  });

  it('gives up when the retry is refused too', async () => {
    const { cloud, net } = setup({
      'grant_type=refresh_token': () => tokenReply(1),
      get_save: () => json({}, 401),
    });
    expect((await failure(cloud.getSave())).kind).toBe('auth');
    expect(net.count('get_save')).toBe(2);
  });

  it('survives storage refusing the renewed session', async () => {
    const { cloud, storage, time } = setup({
      'grant_type=refresh_token': () => tokenReply(1),
      get_save: () => json(null),
    });
    time.t += 3_600_000;
    storage.failWrites = true;
    expect(await cloud.getSave()).toBeNull();
  });

  it('refuses a refresh reply with a bad token or expiry', async () => {
    for (const reply of [
      { access_token: 'a b', refresh_token: 'refresh-token-1', expires_in: 3600 },
      { access_token: 'access-token-1', refresh_token: 'refresh-token-1', expires_in: -5 },
      { access_token: 'access-token-1', refresh_token: 'refresh-token-1' },
      [],
    ]) {
      const { cloud, time } = setup({ 'grant_type=refresh_token': () => json(reply) });
      time.t += 3_600_000;
      expect((await failure(cloud.getSave())).kind).toBe('bad-response');
    }
  });

  it('has no session before signing in', async () => {
    const { cloud, storage } = setup({ get_save: () => json(null) });
    storage.data.clear();
    expect((await failure(cloud.getSave())).kind).toBe('auth');
  });
});

describe('page-leaving upload', () => {
  it('sends with keepalive and the stored token, without waiting on a renewal', async () => {
    const { cloud, net } = setup({ put_save: () => json({ ok: true, rev: 2 }) });
    const sent = cloud.putSave(SAVE, 1, true);
    // fetch has been called already, before anything was awaited.
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]?.init.keepalive).toBe(true);
    await sent;
  });

  it('does not try to renew an expired token while leaving', async () => {
    const { cloud, net, time } = setup({ put_save: () => json({ ok: true, rev: 2 }) });
    time.t += 3_600_000;
    expect((await failure(cloud.putSave(SAVE, 1, true))).kind).toBe('auth');
    expect(net.calls).toHaveLength(0);
  });

  it('knows what fits in a keepalive body', () => {
    expect(fitsKeepalive('x'.repeat(KEEPALIVE_MAX_BYTES))).toBe(true);
    expect(fitsKeepalive('x'.repeat(KEEPALIVE_MAX_BYTES + 1))).toBe(false);
    expect(fitsKeepalive('é'.repeat(KEEPALIVE_MAX_BYTES / 2 + 1))).toBe(false);
  });
});
