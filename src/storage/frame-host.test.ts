import { describe, expect, it } from 'vitest';
import { newGame } from '../core/sim.ts';
import { clock, CONFIG, fakeServer, memory } from './cloud-fakes.ts';
import { createCloud } from './cloud.ts';
import { ADOPT_KEY, CLOUD_KEY, readMeta } from './cloud-meta.ts';
import { FRAME, framePair, GAME, ITCH, settle } from './frame-fakes.ts';
import { allowedParent, createHost, storageWorks } from './frame-host.ts';
import { LINK_PROTOCOL, PROTOCOL } from './frame-protocol.ts';
import { encodeSave, SAVE_KEY } from './save.ts';

const T = 1_800_000_000_000;
const raw = (savedAt: number, seed = 1): string => encodeSave(newGame(seed, 'sword'), savedAt);
const req = (id: number, op: string, args: Record<string, unknown> = {}) => ({
  p: PROTOCOL,
  id,
  op,
  ...args,
});

/** A second cloud on a frame's storage, as the link code frame has (same origin, same storage). */
const codeCloud = (
  f: { storage: ReturnType<typeof memory> },
  server: ReturnType<typeof fakeServer>,
  time: ReturnType<typeof clock>,
) => createCloud({ config: CONFIG, storage: f.storage, fetch: server.fetch, now: time.now });

describe('who the frame answers', () => {
  it('answers our game, directly inside our itch.io page at the top', () => {
    expect(allowedParent([GAME, ITCH], ITCH)).toBe(GAME);
  });

  it('refuses another game on the same itch.io origin, in its own page', () => {
    expect(allowedParent([GAME, 'https://attacker.itch.io'], ITCH)).toBeNull();
  });

  it('refuses a browser without ancestorOrigins', () => {
    expect(allowedParent(null, ITCH)).toBeNull();
    expect(allowedParent(undefined, ITCH)).toBeNull();
  });

  it('refuses any other nesting: our page framed by another, the frame on its own, or loaded directly', () => {
    expect(allowedParent([GAME, ITCH, 'https://itch.io'], ITCH)).toBeNull();
    expect(allowedParent([GAME, ITCH, 'https://attacker.itch.io'], ITCH)).toBeNull();
    expect(allowedParent([ITCH], ITCH)).toBeNull();
    expect(allowedParent([], ITCH)).toBeNull();
    expect(allowedParent([GAME, 'https://attacker.itch.io', ITCH], ITCH)).toBeNull();
  });

  it('refuses look-alike, opaque and plain-http origins, and a frame with no itch.io page set', () => {
    expect(allowedParent([GAME, `${ITCH}.evil.example`], ITCH)).toBeNull();
    expect(allowedParent([GAME, 'https://ourgame.itch.io​'], ITCH)).toBeNull();
    expect(allowedParent(['null', ITCH], ITCH)).toBeNull();
    expect(allowedParent(['http://html-classic.itch.zone', ITCH], ITCH)).toBeNull();
    expect(allowedParent([`${GAME}/path`, ITCH], ITCH)).toBeNull();
    // Another frame on our itch.io page (a video embed) is not the game.
    expect(allowedParent(['https://www.youtube-nocookie.com', ITCH], ITCH)).toBeNull();
    expect(allowedParent(['https://html-classic.itch.zone.evil.example', ITCH], ITCH)).toBeNull();
    expect(allowedParent([GAME, ITCH], null)).toBeNull();
  });

  it('makes no host (so listens to nothing) when refused or when its storage is blocked', () => {
    expect(framePair({ ancestors: [GAME, 'https://attacker.itch.io'] }).host).toBeNull();
    expect(framePair({ ancestors: null }).host).toBeNull();
    const blocked = memory();
    blocked.failWrites = true;
    expect(storageWorks(blocked)).toBe(false);
    expect(framePair({ storage: blocked }).host).toBeNull();
    expect(storageWorks(null)).toBe(false);
  });

  it('a refused frame never posts anything', async () => {
    const f = framePair({ ancestors: [GAME, 'https://attacker.itch.io'] });
    expect(await f.client.connect(50)).toBeNull();
    expect(f.posted).toEqual([]);
  });
});

describe('messages the frame takes', () => {
  it('takes them only from its parent window at the checked origin', async () => {
    const f = framePair();
    f.storage.setItem(SAVE_KEY, raw(T));
    // Another game's window on the same itch.io origin, and our window from another origin.
    f.inject(req(1, 'hello'));
    f.inject(req(2, 'hello'), 'https://attacker.example', f.parentWindow);
    f.inject(req(3, 'set', { key: SAVE_KEY, value: 'x' }));
    f.inject(req(4, 'remove', { key: SAVE_KEY }), GAME, { name: 'popup' });
    await settle();
    expect(f.posted).toEqual([]);
    expect(f.storage.getItem(SAVE_KEY)).toBe(raw(T));
    // The real parent gets an answer.
    f.inject(req(5, 'hello'), GAME, f.parentWindow);
    await settle();
    expect(f.posted).toHaveLength(1);
  });

  it('replies only to the checked origin, never "*"', async () => {
    const f = framePair();
    await f.client.connect();
    const { storage } = (await f.client.connect()) ?? {};
    storage?.setItem(SAVE_KEY, raw(T));
    await settle();
    expect(f.posted.length).toBeGreaterThan(0);
    for (const p of f.posted) expect(p.origin).toBe(GAME);
  });

  it('drops hostile and malformed requests without answering or writing', async () => {
    const f = framePair();
    const hostile: unknown[] = [
      null,
      'hello',
      42,
      [req(1, 'hello')],
      { ...req(1, 'hello'), p: 'other' },
      { ...req(1, 'hello'), extra: 1 },
      req(0, 'hello'),
      req(1.5, 'hello'),
      req(2 ** 40, 'hello'),
      req(1, 'getToken'),
      req(1, 'constructor'),
      req(1, '__proto__'),
      req(1, 'set', { key: CLOUD_KEY, value: '{}' }),
      req(1, 'set', { key: 'office-immortal.save ', value: 'x' }),
      req(1, 'set', { key: SAVE_KEY, value: 'x'.repeat(200_001) }),
      req(1, 'set', { key: 'office-immortal.theme', value: 'x'.repeat(201) }),
      req(1, 'set', { key: SAVE_KEY, value: { toString: 'x' } }),
      req(1, 'remove', { key: CLOUD_KEY }),
      req(1, 'sync.offer', { raw: raw(T), savedAt: Number.NaN }),
      req(1, 'sync.offer', { raw: raw(T), savedAt: -1 }),
      req(1, 'sync.flush', { reason: 'unload' }),
      // The game never sees a link code either way: code frames do (ui/code-frame.ts).
      req(1, 'sync.linkCode'),
      req(1, 'sync.link', { code: 'ABCDEFGH12' }),
      req(1, 'backup.put', { raw: 'x'.repeat(200_001) }),
      JSON.parse(`{"p":"${PROTOCOL}","id":1,"op":"hello","__proto__":{"polluted":true}}`),
      JSON.parse(
        `{"p":"${PROTOCOL}","id":1,"op":"set","key":"office-immortal.save","value":"x","__proto__":{}}`,
      ),
      Object.assign(Object.create({ inherited: true }), req(1, 'hello')),
    ];
    for (const data of hostile) f.inject(data, GAME, f.parentWindow);
    await settle();
    expect(f.posted).toEqual([]);
    expect(f.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(f.storage.getItem(SAVE_KEY)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('the game linked to its frame', () => {
  it('starts from the frame storage copy and writes through to it', async () => {
    const f = framePair();
    f.storage.setItem(SAVE_KEY, raw(T));
    f.storage.setItem('office-immortal.lang', 'vi');
    const link = await f.client.connect();
    expect(link?.storage.getItem(SAVE_KEY)).toBe(raw(T));
    expect(link?.storage.getItem('office-immortal.lang')).toBe('vi');
    link?.storage.setItem(SAVE_KEY, raw(T + 1));
    link?.storage.removeItem('office-immortal.lang');
    // At once in the game's copy, then in the frame.
    expect(link?.storage.getItem(SAVE_KEY)).toBe(raw(T + 1));
    await settle();
    expect(f.storage.getItem(SAVE_KEY)).toBe(raw(T + 1));
    expect(f.storage.getItem('office-immortal.lang')).toBeNull();
  });

  it('never hands the game the cloud key, and refuses to write it', async () => {
    const f = framePair();
    const link = await f.client.connect();
    link?.storage.setItem(SAVE_KEY, raw(T));
    link?.sync?.begin();
    link?.sync?.offer(raw(T), T);
    await link?.sync?.turnOn();
    expect(readMeta(f.storage)?.session).not.toBeNull();
    expect(link?.storage.getItem(CLOUD_KEY)).toBeNull();
    expect(() => link?.storage.setItem(CLOUD_KEY, '{}')).toThrow();
    // A second hello (a reload) still leaves the cloud key out.
    const again = await f.client.connect();
    expect(again?.storage.getItem(CLOUD_KEY)).toBeNull();
  });

  it('runs the cloud save in the frame: turn on, upload, sync now', async () => {
    const f = framePair();
    const link = await f.client.connect();
    const sync = link?.sync;
    expect(sync?.status.kind).toBe('off');
    sync?.begin();
    link?.storage.setItem(SAVE_KEY, raw(T));
    sync?.offer(raw(T), T);
    await sync?.turnOn();
    await settle();
    expect(sync?.status.kind).toBe('synced');
    expect([...f.server.saves.values()].map((s) => s.data)).toEqual([raw(T)]);
    sync?.offer(raw(T + 1000, 2), T + 1000);
    await sync?.syncNow();
    await settle();
    expect([...f.server.saves.values()].map((s) => s.data)).toEqual([raw(T + 1000, 2)]);
  });

  it('never posts the sign-in token, refresh token or apikey in any message', async () => {
    const f = framePair();
    const link = await f.client.connect();
    const sync = link?.sync;
    sync?.begin();
    sync?.offer(raw(T), T);
    await sync?.turnOn();
    f.server.down = true;
    await sync?.syncNow();
    f.server.down = false;
    await sync?.deleteCloud();
    await settle();
    const everything = JSON.stringify(f.posted.map((p) => p.message));
    expect(everything).not.toMatch(/access-token|refresh-token|sb_publishable|Bearer/);
    expect(everything).not.toContain(CLOUD_KEY);
  });

  it('links a second itch.io browser with a code, and restarts it from the cloud save', async () => {
    const server = fakeServer();
    const time = clock(T);
    const a = framePair({ server, time });
    const la = await a.client.connect();
    la?.sync?.begin();
    la?.storage.setItem(SAVE_KEY, raw(T));
    la?.sync?.offer(raw(T), T);
    await la?.sync?.turnOn();
    // As the code frame makes it: on the frame's storage, never through the game.
    const code = (await codeCloud(a, server, time).createLinkCode()).code;

    const b = framePair({ server, time });
    const lb = await b.client.connect();
    lb?.sync?.begin();
    lb?.storage.setItem(SAVE_KEY, raw(T + 5, 2));
    lb?.sync?.offer(raw(T + 5, 2), T + 5);
    await settle();
    // Typed into the link frame beside the storage frame, never into the game.
    b.fromLink({ p: LINK_PROTOCOL, code, n: 1 });
    await settle();
    expect(b.linkReplies).toEqual([
      { source: b.linkWindow, message: { p: LINK_PROTOCOL, done: true, n: 1 } },
    ]);
    expect(JSON.stringify(b.posted.map((p) => p.message))).not.toContain(code);
    expect(lb?.sync?.status.kind).toBe('conflict');
    lb?.sync?.useCloud();
    await settle();
    expect(b.adopted).toHaveBeenCalledOnce();
    // The game's copy already holds the cloud's save when it restarts.
    expect(lb?.storage.getItem(SAVE_KEY)).toBe(raw(T));
    expect(lb?.storage.getItem(ADOPT_KEY)).not.toBeNull();
    expect(b.notes).toContain('loaded');
  });

  it("passes on another tab's changes to mirrored keys, but never the cloud key", async () => {
    const f = framePair();
    const link = await f.client.connect();
    const seen: [string | null, string | null][] = [];
    link?.onStorage((k, v) => seen.push([k, v]));
    f.host?.otherTab(SAVE_KEY, null);
    f.host?.otherTab(CLOUD_KEY, '{"session":"x"}');
    f.host?.otherTab('unrelated', 'x');
    f.host?.otherTab(null, null);
    await settle();
    expect(seen).toEqual([
      [SAVE_KEY, null],
      [null, null],
    ]);
  });

  it('works without the cloud save: storage and backup only', async () => {
    const f = framePair({ cloud: false });
    const link = await f.client.connect();
    expect(link?.sync).toBeNull();
    expect(await link?.backup.put(raw(T))).toBe(true);
    expect(f.backup.text).toBe(raw(T));
    expect(await link?.backup.read()).toBe(raw(T));
    expect(await link?.backup.clear()).toBe(true);
    expect(f.backup.text).toBeNull();
    // A cloud request to a frame without the cloud changes nothing.
    f.inject(req(99, 'sync.turnOn'), GAME, f.parentWindow);
    await settle();
    expect(f.server.calls).toEqual([]);
  });

  it('a hostile request from the parent itself only reaches allow-listed actions', async () => {
    const f = framePair();
    await f.client.connect();
    const before = f.posted.length;
    f.inject(req(50, 'set', { key: CLOUD_KEY, value: '{"session":null}' }), GAME, f.parentWindow);
    f.inject(req(51, 'readKey', { key: CLOUD_KEY }), GAME, f.parentWindow);
    await settle();
    expect(f.posted.length).toBe(before);
    expect(f.storage.getItem(CLOUD_KEY)).toBeNull();
  });
});

describe('a typed code from a link frame', () => {
  it('is taken only from a sibling frame on our own origin, through the allow-list', async () => {
    const f = framePair();
    const link = await f.client.connect();
    link?.sync?.begin();
    const ok = { p: LINK_PROTOCOL, code: 'ABCDEFGH10', n: 1 };
    // The game window, another origin, an unknown window, hostile shapes: no answer, no attempt.
    f.fromLink(ok, GAME, f.parentWindow);
    f.fromLink(ok, FRAME, f.parentWindow);
    f.fromLink(ok, 'https://attacker.example');
    f.fromLink(ok, FRAME, { name: 'stranger' });
    f.fromLink({ ...ok, code: 'A'.repeat(65) });
    f.fromLink({ ...ok, extra: 1 });
    f.fromLink(JSON.parse(`{"p":"${LINK_PROTOCOL}","code":"A","n":1,"__proto__":{"polluted":1}}`));
    await settle();
    expect(f.linkReplies).toEqual([]);
    expect(f.server.calls.length).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('answers done even when the code is refused; the reason goes to the game as a note', async () => {
    const f = framePair();
    const link = await f.client.connect();
    link?.sync?.begin();
    f.fromLink({ p: LINK_PROTOCOL, code: 'NOSUCHCODE', n: 4 });
    await settle();
    expect(f.linkReplies.map((r) => r.message)).toEqual([{ p: LINK_PROTOCOL, done: true, n: 4 }]);
    expect(f.notes.length).toBe(1);
  });

  it('answers done with nothing tried where the build has no cloud save', async () => {
    const f = framePair({ cloud: false });
    f.fromLink({ p: LINK_PROTOCOL, code: 'ABCDEFGH10', n: 1 });
    await settle();
    expect(f.linkReplies.map((r) => r.message)).toEqual([{ p: LINK_PROTOCOL, done: true, n: 1 }]);
    expect(f.server.calls.length).toBe(0);
  });
});

describe('the frame host on its own', () => {
  it('needs a matching parent: a host built for one game ignores the frame origin itself', async () => {
    const posted: unknown[] = [];
    const parent = {};
    const host = createHost({
      ancestors: [GAME, ITCH],
      itchOrigin: ITCH,
      parent,
      post: (m) => posted.push(m),
      self: FRAME,
      isSibling: () => false,
      reply: (_, m) => posted.push(m),
      storage: memory(),
      backup: { read: async () => null, put: async () => true, clear: async () => true },
      makeSync: null,
    });
    host?.receive({ data: req(1, 'hello'), origin: FRAME, source: parent });
    await settle();
    expect(posted).toEqual([]);
    host?.receive({ data: req(1, 'hello'), origin: GAME, source: parent });
    await settle();
    expect(posted).toHaveLength(1);
  });
});
