import { afterEach, describe, expect, it } from 'vitest';
import { clearSave, SAVE_KEY } from '../storage/save.ts';
import { tabTitle } from './hud.ts';
import {
  browserLang,
  DEFAULT_LANG,
  enemyName,
  LANG_KEY,
  lang,
  PACKS,
  pickLang,
  readLang,
  setLang,
  t,
  tn,
  writeLang,
  type MessageKey,
} from './i18n.ts';
import { NAME_KINDS, type NameKind } from './names.ts';
import { realmLabel, waveLabel } from './view.ts';

const english = PACKS[0]!;
const keys = (o: object) => Object.keys(o).sort();
const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => setLang(DEFAULT_LANG));

describe('language packs', () => {
  it('has English first and Vietnamese', () => {
    expect(PACKS.map((p) => p.code)).toEqual(['en', 'vi']);
    expect(PACKS.map((p) => p.label)).toEqual(['English', 'Tiếng Việt']);
    expect(PACKS.map((p) => p.short)).toEqual(['EN', 'VI']);
  });

  for (const pack of PACKS) {
    describe(pack.code, () => {
      it('has every message the other packs have, and no others', () => {
        for (const other of PACKS) expect(keys(pack.messages)).toEqual(keys(other.messages));
      });

      it('has a name for every sim name of every kind, and no stale ones', () => {
        expect(keys(pack.names)).toEqual(keys(NAME_KINDS));
        for (const kind of Object.keys(NAME_KINDS) as NameKind[]) {
          expect(keys(pack.names[kind]), kind).toEqual([...new Set(NAME_KINDS[kind])].sort());
        }
      });

      it('never has a blank text', () => {
        for (const text of Object.values(pack.messages)) expect(text.trim()).not.toBe('');
        for (const kind of Object.values(pack.names)) {
          for (const text of Object.values(kind)) expect(text.trim()).not.toBe('');
        }
      });

      it('fills the same values as English in every message', () => {
        for (const key of Object.keys(english.messages) as MessageKey[]) {
          expect(holes(pack.messages[key]), key).toEqual(holes(english.messages[key]));
        }
      });

      it('carries no bidi controls or zero-width characters', () => {
        const all = JSON.stringify(pack);
        expect(all).not.toMatch(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/);
      });
    });
  }

  it('keeps the grade initials apart in every pack', () => {
    for (const pack of PACKS) {
      const initials = Object.entries(pack.messages)
        .filter(([k]) => k.startsWith('grade.initial.'))
        .map(([, v]) => v);
      expect(new Set(initials).size, pack.code).toBe(5);
    }
  });
});

describe('t and tn', () => {
  it('fills values and switches language', () => {
    expect(t('strip.wave', { n: 2, of: 3 })).toBe('Wave 2 / 3');
    setLang('vi');
    expect(t('strip.wave', { n: 2, of: 3 })).toBe('Đợt 2 / 3');
    expect(lang().code).toBe('vi');
  });

  it('falls back to English for a message a pack lacks, never a blank or the key', () => {
    setLang('vi');
    const messages = lang().messages as Record<string, string>;
    const kept = messages['strip.boss'] as string;
    delete messages['strip.boss'];
    try {
      expect(t('strip.boss')).toBe('Boss');
    } finally {
      messages['strip.boss'] = kept;
    }
  });

  it('leaves a name it has no translation for in English (an old save, say)', () => {
    setLang('vi');
    expect(tn('item', 'Jade Stapler')).toBe('Jade Stapler');
    expect(tn('item', 'constructor')).toBe('constructor');
    expect(tn('item', '__proto__')).toBe('__proto__');
    expect(tn('item', 'hasOwnProperty')).toBe('hasOwnProperty');
    expect(tn('item', 'toString')).toBe('toString');
    expect(tn('item', 'Iron Flying Sword')).toBe('Thiết Phi Kiếm');
  });

  it('tells the Immortal grade from the Immortal realm', () => {
    setLang('vi');
    expect(tn('grade', 'Immortal')).toBe('Tiên Phẩm');
    expect(tn('realm', 'Immortal')).toBe('Tiên Nhân');
  });

  it('fills each value once, as plain text: no value is read as a placeholder', () => {
    expect(t('drops.line', { name: '{grade}<b>', grade: 'Earth' })).toBe('{grade}<b> — Earth');
    expect(t('drops.line', { name: 'x' })).toBe('x — {grade}');
    expect(t('drops.line', { name: '$&$1$$', grade: 'x' })).toBe('$&$1$$ — x');
    expect(t('drops.line', { __proto__: 'x' } as unknown as Record<string, string>)).toBe(
      '{name} — {grade}',
    );
  });

  it('names elites in the language, from the sim’s "Elite <demon>"', () => {
    expect(enemyName('elite', 'Elite Inbox Hydra')).toBe('Elite Inbox Hydra');
    setLang('vi');
    expect(enemyName('elite', 'Elite Inbox Hydra')).toBe('Cửu Đầu Xà Hộp Thư Tinh Anh');
    expect(enemyName('boss', 'The Auditor')).toBe('Kiểm Toán Viên');
    expect(enemyName('elite', 'Elite Nobody')).toBe('Nobody Tinh Anh');
  });

  it('puts the cultivation terms on the page in Vietnamese', () => {
    setLang('vi');
    expect([1, 11, 21, 31].map(realmLabel)).toEqual([
      'Luyện Khí · Thực Tập Sinh',
      'Trúc Cơ · Nhân Viên',
      'Kim Đan · Trưởng Phòng',
      'Nguyên Anh · Giám Đốc',
    ]);
    expect(realmLabel(61)).toBe('Tiên Nhân');
    expect(tabTitle(12, 3, true)).toBe('T12 · Đến lúc độ kiếp · 3 món đồ');
  });

  it('keeps numbers in the same format in both languages', () => {
    const state = { enemies: [{ kind: 'tribulation' }] } as Parameters<typeof waveLabel>[0];
    expect(waveLabel(state)).toBe('Tribulation');
    expect(t('item.souls', { souls: 7, cap: 20, damage: '6.7' })).toContain('6.7');
    setLang('vi');
    expect(t('item.souls', { souls: 7, cap: 20, damage: '6.7' })).toContain('6.7');
  });
});

describe('choosing the language', () => {
  it('allows only a pack’s code; anything else is English', () => {
    expect(pickLang('vi')).toBe('vi');
    expect(pickLang('en')).toBe('en');
    const hostile = [
      'VI',
      'vi-VN',
      'fr',
      '',
      ' vi',
      'vi\u200b',
      '\u202evi',
      '__proto__',
      'constructor',
    ];
    for (const bad of hostile) {
      expect(pickLang(bad), bad).toBe('en');
    }
    for (const bad of [null, undefined, 1, {}, ['vi']]) expect(pickLang(bad)).toBe('en');
  });

  it('defaults to the browser’s language when there is a pack for it, else English', () => {
    expect(browserLang(['vi-VN', 'en'])).toBe('vi');
    expect(browserLang(['VI'])).toBe('vi');
    expect(browserLang(['fr-FR', 'vi'])).toBe('vi');
    expect(browserLang(['en-US', 'vi'])).toBe('en');
    expect(browserLang(['fr'])).toBe('en');
    expect(browserLang([])).toBe('en');
  });

  it('gives English for hostile browser languages', () => {
    const hostile = ['__proto__', 'constructor-x', 'x'.repeat(100_000), 'vi\u200b', '\u202evi'];
    for (const tag of hostile) expect(browserLang([tag]), tag.slice(0, 20)).toBe('en');
    expect(browserLang([{} as unknown as string, null as unknown as string])).toBe('en');
  });

  it('reads a saved choice through the allow-list', () => {
    expect(readLang(memory({ [LANG_KEY]: 'vi' }), ['en'])).toBe('vi');
    expect(readLang(memory({ [LANG_KEY]: 'en' }), ['vi'])).toBe('en');
    // Unknown or tampered: the default, as if nothing were saved.
    expect(readLang(memory({ [LANG_KEY]: 'xx' }), ['vi'])).toBe('vi');
    expect(readLang(memory({ [LANG_KEY]: '<script>' }), ['en'])).toBe('en');
    expect(readLang(memory({ [LANG_KEY]: 'x'.repeat(100_000) }), ['en'])).toBe('en');
    expect(readLang(null, ['vi'])).toBe('vi');
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLang(blocked, ['vi-VN'])).toBe('vi');
  });

  it('saves the choice, and only a known one', () => {
    const store = memory();
    expect(writeLang(store, 'vi')).toBe(true);
    expect(store.map.get(LANG_KEY)).toBe('vi');
    expect(writeLang(store, 'evil')).toBe(true);
    expect(store.map.get(LANG_KEY)).toBe('en');
    expect(writeLang(null, 'vi')).toBe(false);
    const blocked = {
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(writeLang(blocked, 'vi')).toBe(false);
  });

  it('switches to English on an unknown code', () => {
    setLang('vi');
    setLang('nope');
    expect(lang().code).toBe('en');
  });

  it('is kept by Reset progress, like the theme', () => {
    const store = memory({ [LANG_KEY]: 'vi', [SAVE_KEY]: '{}' });
    expect(clearSave(store)).toBe(true);
    expect(store.map.has(SAVE_KEY)).toBe(false);
    expect(readLang(store, ['en'])).toBe('vi');
  });
});
