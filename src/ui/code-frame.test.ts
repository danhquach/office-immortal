import { afterEach, describe, expect, it, vi } from 'vitest';
import { newGame } from '../core/sim.ts';
import { CONFIG, memory } from '../storage/cloud-fakes.ts';
import { CloudError, createCloud } from '../storage/cloud.ts';
import { framePair, GAME, ITCH } from '../storage/frame-fakes.ts';
import { encodeSave, SAVE_KEY } from '../storage/save.ts';
import {
  createCodeFrame,
  createLinkFrame,
  LINK_FIELD_MAX,
  LINK_WAIT_MS,
  linkSender,
  type CodeFrameDeps,
  type CodeView,
  type LinkFrameDeps,
  type LinkView,
} from './code-frame.ts';
import { LINK_PROTOCOL } from '../storage/frame-protocol.ts';
import { DEFAULT_LANG, LANG_KEY, setLang } from './i18n.ts';

const T = 1_800_000_000_000;

/** A code frame on its own storage with a stand-in cloud; `views` is everything it showed. */
function frame(extra: Partial<CodeFrameDeps> = {}, createLinkCode = vi.fn()) {
  const views: CodeView[] = [];
  const makeCloud = vi.fn(() => ({ createLinkCode }));
  const storage = memory();
  const f = createCodeFrame({
    ancestors: [GAME, ITCH],
    itchOrigin: ITCH,
    storage,
    languages: ['en-US'],
    makeCloud,
    show: (v) => views.push(v),
    ...extra,
  });
  return { f, views, makeCloud, createLinkCode, storage, last: () => views.at(-1) };
}

afterEach(() => {
  setLang(DEFAULT_LANG);
  vi.useRealTimers();
});

describe('where the code frame shows anything', () => {
  it('only where the storage frame would answer: our game inside our itch.io page', () => {
    const refused: Partial<CodeFrameDeps>[] = [
      { ancestors: null },
      { ancestors: [GAME, 'https://attacker.itch.io'] },
      { ancestors: [GAME, ITCH, 'https://itch.io'] },
      { ancestors: [ITCH] },
      { itchOrigin: null },
      { makeCloud: null },
      { storage: null },
    ];
    for (const deps of refused) {
      const c = frame(deps);
      expect(c.f).toBeNull();
      expect(c.views).toEqual([]);
    }
    const blocked = memory();
    blocked.failWrites = true;
    const c = frame({ storage: blocked });
    expect(c.f).toBeNull();
    expect(c.makeCloud).not.toHaveBeenCalled();
  });

  it('starts with its button and no code', () => {
    const c = frame();
    expect(c.f).not.toBeNull();
    expect(c.last()).toEqual({ label: 'Get link code', busy: false, line: '' });
    expect(c.createLinkCode).not.toHaveBeenCalled();
  });
});

describe('making a code', () => {
  it("makes none for a script's click (not trusted)", async () => {
    const c = frame();
    await c.f?.press(false);
    expect(c.createLinkCode).not.toHaveBeenCalled();
    expect(c.last()?.line).toBe('');
  });

  it('shows the code on a real click, and asks once while busy', async () => {
    let answer: (v: { code: string; ttl: number }) => void = () => {};
    const make = vi.fn(() => new Promise<{ code: string; ttl: number }>((r) => (answer = r)));
    const c = frame({}, make);
    const pressing = c.f?.press(true);
    expect(c.last()?.busy).toBe(true);
    void c.f?.press(true);
    answer({ code: 'ABCDEFGH12', ttl: 900 });
    await pressing;
    expect(make).toHaveBeenCalledOnce();
    expect(c.last()).toEqual({
      label: 'Get link code',
      busy: false,
      line: 'Link code: ABCDEFGH12. Enter it on your other device within 15 minutes. It works once.',
    });
  });

  it("shows the game's own message for a failure, never the server's text", async () => {
    const c = frame({}, vi.fn().mockRejectedValueOnce(new CloudError('rejected', 'not_a_member')));
    await c.f?.press(true);
    const refused = c.last()?.line;
    expect(refused).not.toBe('');
    expect(refused).not.toContain('not_a_member');
    c.createLinkCode.mockRejectedValueOnce(new Error('<img src=x onerror=alert(1)> server text'));
    await c.f?.press(true);
    expect(c.last()?.line).not.toMatch(/img|server text/);
    expect(c.last()?.busy).toBe(false);
  });

  it('a new attempt clears the code shown before', async () => {
    const make = vi.fn().mockResolvedValueOnce({ code: 'ABCDEFGH12', ttl: 900 });
    const c = frame({}, make);
    await c.f?.press(true);
    make.mockRejectedValueOnce(new CloudError('offline'));
    await c.f?.press(true);
    expect(c.views.some((v) => v.busy && v.line === '')).toBe(true);
    expect(c.last()?.line).not.toContain('ABCDEFGH12');
  });
});

describe('language', () => {
  it('words it in the language the game stored, again after a switch, the code included', async () => {
    const c = frame({}, vi.fn().mockResolvedValue({ code: 'ABCDEFGH12', ttl: 900 }));
    await c.f?.press(true);
    c.storage.setItem(LANG_KEY, 'vi');
    c.f?.redraw();
    expect(c.last()?.label).toBe('Lấy mã liên kết');
    expect(c.last()?.line).toContain('ABCDEFGH12');
    expect(c.last()?.line).toContain('Mã liên kết');
  });

  it('falls back to the browser language for a hostile stored value', () => {
    const c = frame();
    c.storage.setItem(LANG_KEY, '__proto__');
    c.f?.redraw();
    expect(c.last()?.label).toBe('Get link code');
  });
});

describe('with the storage frame', () => {
  it("makes a code with the storage frame's session, and the game page never sees it", async () => {
    const pair = framePair();
    const link = await pair.client.connect();
    link?.sync?.begin();
    link?.storage.setItem(SAVE_KEY, encodeSave(newGame(1, 'sword'), T));
    link?.sync?.offer(encodeSave(newGame(1, 'sword'), T), T);
    await link?.sync?.turnOn();
    const c = frame({
      storage: pair.storage,
      makeCloud: (s) =>
        createCloud({ config: CONFIG, storage: s, fetch: pair.server.fetch, now: pair.time.now }),
    });
    await c.f?.press(true);
    const code = /Link code: ([0-9A-Z]{10})\./.exec(c.last()?.line ?? '')?.[1];
    expect(code).toBeDefined();
    expect(JSON.stringify(pair.posted.map((p) => p.message))).not.toContain(code);
  });
});

/** A link frame on its own storage; `sent` is every code it handed on. */
function linkFrame(extra: Partial<LinkFrameDeps> = {}) {
  const views: LinkView[] = [];
  const sent: string[] = [];
  let finish: () => void = () => {};
  const f = createLinkFrame({
    ancestors: [GAME, ITCH],
    itchOrigin: ITCH,
    storage: memory(),
    languages: ['en-US'],
    cloud: true,
    send: (code) => {
      sent.push(code);
      return new Promise((r) => (finish = r));
    },
    show: (v) => views.push(v),
    ...extra,
  });
  return { f, views, sent, finish: () => finish(), last: () => views.at(-1) };
}

describe('the link frame', () => {
  it('shows nothing where the storage frame would not answer, or without the cloud save', () => {
    for (const deps of [
      { ancestors: null },
      { ancestors: [GAME, 'https://attacker.itch.io'] },
      { itchOrigin: null },
      { storage: null },
      { cloud: false },
    ] satisfies Partial<LinkFrameDeps>[]) {
      const c = linkFrame(deps);
      expect(c.f).toBeNull();
      expect(c.views).toEqual([]);
    }
  });

  it('starts with its field and button, words them in the stored language', () => {
    const c = linkFrame();
    expect(c.last()).toEqual({
      field: 'Link code from your other device',
      label: 'Link this device',
      busy: false,
      line: '',
    });
  });

  it('hands on a typed code only on a real click, trimmed, once while busy', async () => {
    const c = linkFrame();
    expect(await c.f?.press(false, 'ABCDEFGH12')).toBe(false);
    expect(await c.f?.press(true, '   ')).toBe(false);
    expect(await c.f?.press(true, 'A'.repeat(LINK_FIELD_MAX + 1))).toBe(false);
    expect(c.sent).toEqual([]);
    const pressing = c.f?.press(true, ' abcd-efgh-12 ');
    expect(c.last()).toMatchObject({ busy: true, line: 'Linking…' });
    expect(await c.f?.press(true, 'OTHERCODE1')).toBe(false);
    c.finish();
    expect(await pressing).toBe(true);
    expect(c.sent).toEqual(['abcd-efgh-12']);
    expect(c.last()).toMatchObject({ busy: false, line: '' });
  });
});

describe('handing a typed code to the storage frame', () => {
  const OURS = 'https://ourname.github.io';
  function sender() {
    const posted: { to: string; message: unknown; origin: string }[] = [];
    const frame = (to: string) => ({
      postMessage: (message: unknown, origin: string) => posted.push({ to, message, origin }),
    });
    let listener: ((e: { data: unknown; origin: string }) => void) | null = null;
    let listening = 0;
    const send = linkSender({
      siblings: () => [frame('storage'), frame('video')],
      origin: OURS,
      listen(fn) {
        listener = fn;
        listening++;
        return () => {
          listener = null;
          listening--;
        };
      },
    });
    const answer = (data: unknown, origin = OURS) => listener?.({ data, origin });
    return { send, posted, answer, listening: () => listening };
  }

  it('posts to every sibling at our origin only, so no frame on another origin gets the code', () => {
    const s = sender();
    void s.send('ABCDEFGH12');
    expect(s.posted).toEqual([
      { to: 'storage', message: { p: LINK_PROTOCOL, code: 'ABCDEFGH12', n: 1 }, origin: OURS },
      { to: 'video', message: { p: LINK_PROTOCOL, code: 'ABCDEFGH12', n: 1 }, origin: OURS },
    ]);
  });

  it('settles on the answer to this attempt from our origin, then stops listening', async () => {
    const s = sender();
    let settled = false;
    const sending = s.send('ABCDEFGH12').then(() => (settled = true));
    s.answer({ p: LINK_PROTOCOL, done: true, n: 1 }, 'https://html-classic.itch.zone');
    s.answer({ p: LINK_PROTOCOL, done: true, n: 2 });
    s.answer({ p: LINK_PROTOCOL, done: true });
    await Promise.resolve();
    expect(settled).toBe(false);
    s.answer({ p: LINK_PROTOCOL, done: true, n: 1 });
    await sending;
    expect(s.listening()).toBe(0);
  });

  it("gives up after the wait, and an earlier attempt's late answer doesn't end the next", async () => {
    vi.useFakeTimers();
    const s = sender();
    const first = s.send('ABCDEFGH12');
    await vi.advanceTimersByTimeAsync(LINK_WAIT_MS);
    await first;
    expect(s.listening()).toBe(0);
    let settled = false;
    const second = s.send('ABCDEFGH13').then(() => (settled = true));
    s.answer({ p: LINK_PROTOCOL, done: true, n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    s.answer({ p: LINK_PROTOCOL, done: true, n: 2 });
    await second;
    expect(s.listening()).toBe(0);
  });
});
