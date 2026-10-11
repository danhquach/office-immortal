import { describe, expect, it } from 'vitest';
import { newGame } from '../core/sim.ts';
import { THEME_KEY } from '../ui/theme.ts';
import { LANG_KEY } from '../ui/i18n.ts';
import { BAG_REVERSE_KEY, BAG_SORT_KEY } from '../ui/sort.ts';
import { ADOPT_KEY, CLOUD_KEY } from './cloud-meta.ts';
import { readCloudConfig } from './cloud-config.ts';
import { readFrameConfig, readItchOrigin } from './frame-config.ts';
import { MIRROR_KEYS, PROTOCOL, readFrameMessage, readRequest, toWire } from './frame-protocol.ts';
import { decodeSave, encodeSave, REJECTED_KEY, SAVE_KEY } from './save.ts';

const T = 1_800_000_000_000;

describe('mirrored keys', () => {
  it("are the game's storage keys, without the cloud's", () => {
    expect([...MIRROR_KEYS].sort()).toEqual(
      [
        SAVE_KEY,
        REJECTED_KEY,
        ADOPT_KEY,
        THEME_KEY,
        LANG_KEY,
        BAG_SORT_KEY,
        BAG_REVERSE_KEY,
      ].sort(),
    );
    expect(MIRROR_KEYS).not.toContain(CLOUD_KEY);
  });
});

describe('requests', () => {
  it('reads each allowed request into a fresh object', () => {
    const save = encodeSave(newGame(1, 'sword'), T);
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'hello' })).toEqual({ id: 1, op: 'hello' });
    expect(readRequest({ p: PROTOCOL, id: 2, op: 'set', key: SAVE_KEY, value: save })).toEqual({
      id: 2,
      op: 'set',
      key: SAVE_KEY,
      value: save,
    });
    expect(readRequest({ p: PROTOCOL, id: 3, op: 'sync.offer', raw: save, savedAt: T })).toEqual({
      id: 3,
      op: 'sync.offer',
      raw: save,
      savedAt: T,
    });
    expect(readRequest({ p: PROTOCOL, id: 4, op: 'sync.flush', reason: 'pagehide' })).toEqual({
      id: 4,
      op: 'sync.flush',
      reason: 'pagehide',
    });
  });

  it('refuses arguments on a request that takes none, and missing ones where needed', () => {
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'hello', key: SAVE_KEY })).toBeNull();
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'set', key: SAVE_KEY })).toBeNull();
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'sync.offer', raw: 'x' })).toBeNull();
  });

  it('refuses a huge or non-text code, and keeps a code with odd characters for the server to refuse', () => {
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'sync.link', code: 'x'.repeat(65) })).toBeNull();
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'sync.link', code: ['A'] })).toBeNull();
    // Only sent on to the server in a JSON body, never shown or put in a URL.
    expect(readRequest({ p: PROTOCOL, id: 1, op: 'sync.link', code: 'AB‮CD' })).not.toBeNull();
  });
});

describe('status on the wire', () => {
  it('carries a conflict as save text, read back through the load allow-list', () => {
    const local = decodeSave(encodeSave(newGame(1, 'sword'), T));
    const server = decodeSave(encodeSave(newGame(2, 'body'), T + 5));
    if (!local || !server) throw new Error('setup');
    const wire = structuredClone({
      p: PROTOCOL,
      ev: 'status',
      status: toWire({ kind: 'conflict', local, server }),
    });
    const read = readFrameMessage(wire);
    expect(read).toEqual({ ev: 'status', status: { kind: 'conflict', local, server } });
  });

  it('round-trips the plain kinds', () => {
    for (const status of [
      { kind: 'off' },
      { kind: 'checking' },
      { kind: 'synced', at: T },
      { kind: 'offline', message: 'server' },
      { kind: 'relink' },
      { kind: 'unreadable' },
    ] as const) {
      expect(readFrameMessage({ p: PROTOCOL, ev: 'status', status: toWire(status) })).toEqual({
        ev: 'status',
        status,
      });
    }
  });
});

describe('build settings for the frame', () => {
  it('takes only a GitHub Pages store.html address for the itch.io build', () => {
    const ok = 'https://ourname.github.io/office-immortal/store.html';
    expect(readFrameConfig({ VITE_STORE_FRAME_URL: ok })).toEqual({
      url: ok,
      origin: 'https://ourname.github.io',
    });
    expect(readFrameConfig({ VITE_STORE_FRAME_URL: ` ${ok} ` })?.origin).toBe(
      'https://ourname.github.io',
    );
    for (const bad of [
      undefined,
      '',
      'http://ourname.github.io/office-immortal/store.html',
      'https://ourname.github.io.evil.example/store.html',
      'https://evil.example/ourname.github.io/store.html',
      'https://user:pw@ourname.github.io/store.html',
      'https://ourname.github.io/office-immortal/store.html?x=1',
      'https://ourname.github.io/office-immortal/store.html#x',
      'https://ourname.github.io/../store.html',
      'https://ourname.github.io/office-immortal/index.html',
      'javascript:alert(1)//ourname.github.io/store.html',
      'https://ourname​.github.io/store.html',
    ]) {
      expect(readFrameConfig({ VITE_STORE_FRAME_URL: bad })).toBeNull();
    }
  });

  it('takes only an itch.io page origin for the frame', () => {
    expect(readItchOrigin({ VITE_ITCH_PAGE_ORIGIN: 'https://ourgame.itch.io' })).toBe(
      'https://ourgame.itch.io',
    );
    expect(readItchOrigin({ VITE_ITCH_PAGE_ORIGIN: 'https://ourgame.itch.io/' })).toBe(
      'https://ourgame.itch.io',
    );
    for (const bad of [
      undefined,
      '',
      'https://itch.io',
      'http://ourgame.itch.io',
      'https://ourgame.itch.io/game',
      'https://ourgame.itch.io.evil.example',
      'https://html-classic.itch.zone',
      '*',
    ]) {
      expect(readItchOrigin({ VITE_ITCH_PAGE_ORIGIN: bad })).toBeNull();
    }
  });

  it('the itch.io build carries no cloud settings in CI (both left empty)', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
  });
});
