import { describe, expect, it } from 'vitest';
import { memory, SAVE_ID } from './cloud-fakes.ts';
import {
  CLOUD_KEY,
  clearMeta,
  clearSpare,
  LINK_SPARE_KEY,
  LINK_SPARE_MS,
  newMeta,
  readMeta,
  readSpare,
  writeMeta,
  writeSpare,
} from './cloud-meta.ts';
import { readCloudConfig } from './cloud-config.ts';

const SESSION = {
  access: 'access-token-1',
  refresh: 'refresh-token-1',
  expiresAt: 1_800_000_000_000,
};

describe('cloud meta', () => {
  it('round-trips', () => {
    const s = memory();
    const meta = { ...newMeta(SESSION), saveId: SAVE_ID, baseRev: 3, syncedSavedAt: 5 };
    expect(writeMeta(s, meta)).toBe(true);
    expect(readMeta(s)).toEqual(meta);
    expect(clearMeta(s)).toBe(true);
    expect(readMeta(s)).toBeNull();
  });

  it('reads back as off when tampered with', () => {
    const good = JSON.stringify(newMeta(SESSION));
    const parsed = JSON.parse(good) as Record<string, unknown>;
    const tampered: string[] = [
      '{"__proto__":{"x":1}}',
      JSON.stringify({ ...parsed, extra: 1 }),
      JSON.stringify({ ...parsed, saveId: 'nope' }),
      JSON.stringify({ ...parsed, baseRev: '3' }),
      JSON.stringify({ ...parsed, baseRev: 0 }),
      JSON.stringify({ ...parsed, relink: 'false' }),
      JSON.stringify({ ...parsed, syncedSavedAt: -1 }),
      JSON.stringify({ ...parsed, session: { ...SESSION, access: 'a b' } }),
      JSON.stringify({ ...parsed, session: { ...SESSION, extra: 1 } }),
      JSON.stringify([]),
      'null',
      'not json',
      good + ' '.repeat(30_000),
    ];
    for (const raw of tampered) {
      const s = memory();
      s.data.set(CLOUD_KEY, raw);
      expect(readMeta(s)).toBeNull();
    }
  });

  it('survives storage that throws', () => {
    const s = memory();
    s.failWrites = true;
    expect(writeMeta(s, newMeta(SESSION))).toBe(false);
    const broken = {
      ...s,
      getItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readMeta(broken)).toBeNull();
    expect(clearMeta(broken)).toBe(false);
  });
});

describe('the sign-in kept from a failed link', () => {
  const NOW = 1_800_000_000_000;

  it('round-trips until a link code would have expired, then is forgotten', () => {
    const s = memory();
    writeSpare(s, SESSION, NOW);
    expect(readSpare(s, NOW + LINK_SPARE_MS - 1)).toEqual(SESSION);
    expect(readSpare(s, NOW + LINK_SPARE_MS)).toBeNull();
    expect(s.data.has(LINK_SPARE_KEY)).toBe(false);
    writeSpare(s, SESSION, NOW);
    clearSpare(s);
    expect(readSpare(s, NOW)).toBeNull();
  });

  it('is forgotten when tampered with', () => {
    const good = { session: SESSION, until: NOW + LINK_SPARE_MS };
    const tampered: string[] = [
      '{"__proto__":{"until":1}}',
      JSON.stringify({ ...good, extra: 1 }),
      JSON.stringify({ ...good, until: String(good.until) }),
      JSON.stringify({ ...good, until: 1.5 }),
      // Set by a clock that later went back: never lives past one code lifetime from now.
      JSON.stringify({ ...good, until: NOW + LINK_SPARE_MS + 1 }),
      JSON.stringify({ ...good, session: { ...SESSION, access: 'a\u202eb' } }),
      JSON.stringify({ ...good, session: { ...SESSION, refresh: 'x'.repeat(5000) } }),
      JSON.stringify({ ...good, session: null }),
      JSON.stringify(good) + ' '.repeat(10_000),
      'null',
      'not json',
    ];
    for (const raw of tampered) {
      const s = memory();
      s.data.set(LINK_SPARE_KEY, raw);
      expect(readSpare(s, NOW), raw.slice(0, 80)).toBeNull();
      expect(s.data.has(LINK_SPARE_KEY)).toBe(false);
    }
  });

  it('survives storage that throws', () => {
    const s = memory();
    s.failWrites = true;
    expect(() => writeSpare(s, SESSION, NOW)).not.toThrow();
    const broken = {
      ...s,
      getItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSpare(broken, NOW)).toBeNull();
    expect(() => clearSpare(broken)).not.toThrow();
  });
});

describe('cloud config', () => {
  const URL = 'https://abcdefghij.supabase.co';
  const KEY = 'sb_publishable_abcdefghijklmnopqrstu';
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlMTIzNDU2';

  it('accepts a project origin with either key style', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: KEY })).toEqual({
      url: URL,
      key: KEY,
    });
    expect(
      readCloudConfig({ VITE_SUPABASE_URL: URL + '/', VITE_SUPABASE_ANON_KEY: JWT })?.url,
    ).toBe(URL);
  });

  it('rejects anything else, so the feature stays off', () => {
    const bad = [
      undefined,
      '',
      'http://abcdefghij.supabase.co',
      'https://abcdefghij.supabase.co/rest/v1',
      'https://abcdefghij.supabase.co:8443',
      'https://abcdefghij.supabase.co.evil.com',
      'https://evil.com/abcdefghij.supabase.co',
      'https://user@abcdefghij.supabase.co',
      'https://ABCDEFGHIJ.supabase.co',
      'https://abc.supabase.co',
      'https://abcdefghij.supabase.co;script-src *',
      'https://abcdefghij.supabase.co ',
      `${URL}\n`,
    ];
    for (const url of bad) {
      // Trimmed whitespace is the only leniency; everything else must fail.
      const ok = readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: KEY });
      if (url === 'https://abcdefghij.supabase.co ' || url === `${URL}\n`)
        expect(ok?.url).toBe(URL);
      else expect(ok).toBeNull();
    }
    for (const key of [
      undefined,
      '',
      'short',
      'sb_secret_abcdefghijklmnopqrstu',
      'a b c',
      `${KEY}; x`,
    ]) {
      expect(readCloudConfig({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: key })).toBeNull();
    }
    expect(readCloudConfig({})).toBeNull();
  });
});
