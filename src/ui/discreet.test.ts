import { afterEach, describe, expect, it } from 'vitest';
import {
  DISCREET_CODE,
  DISCREET_KEY,
  gradeInitial,
  gradeName,
  isDiscreet,
  isDiscreetKey,
  pickDiscreet,
  readDiscreet,
  setDiscreet,
  writeDiscreet,
  type KeyPress,
} from './discreet.ts';
import { DEFAULT_LANG, setLang } from './i18n.ts';

const GRADES = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'] as const;

function store(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (k) => (k === DISCREET_KEY ? value : null) };
}

afterEach(() => {
  setDiscreet(false);
  setLang(DEFAULT_LANG);
});

describe('readDiscreet', () => {
  it('is off with nothing saved or no storage', () => {
    expect(readDiscreet(store(null))).toBe(false);
    expect(readDiscreet(null)).toBe(false);
  });

  it('reads each saved choice', () => {
    expect(readDiscreet(store('on'))).toBe(true);
    expect(readDiscreet(store('off'))).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['wrong case', 'On'],
    ['padded', ' on'],
    ['true', 'true'],
    ['one', '1'],
    ['prototype key', '__proto__'],
    ['constructor', 'constructor'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['bidi override', 'on‮'],
    ['zero-width', 'o​n'],
    ['look-alike', 'оn'],
    ['JSON', '{"discreet":"on"}'],
    ['oversized', 'on'.repeat(100_000)],
  ])('falls back to off on a hostile value (%s)', (_, value) => {
    expect(readDiscreet(store(value))).toBe(false);
  });

  it('falls back to off when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readDiscreet(blocked)).toBe(false);
  });
});

describe('writeDiscreet', () => {
  it('saves under its own key, and reads back the same', () => {
    const saved = new Map<string, string>();
    const s = { setItem: (k: string, v: string) => saved.set(k, v) };
    expect(writeDiscreet(s, true)).toBe(true);
    expect(saved.get(DISCREET_KEY)).toBe('on');
    expect(readDiscreet({ getItem: (k) => saved.get(k) ?? null })).toBe(true);
    writeDiscreet(s, false);
    expect(saved.get(DISCREET_KEY)).toBe('off');
  });

  it('reports blocked or missing storage', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeDiscreet(full, true)).toBe(false);
    expect(writeDiscreet(null, true)).toBe(false);
  });
});

describe('pickDiscreet and setDiscreet', () => {
  it('pass only the exact values', () => {
    expect(pickDiscreet('on')).toBe(true);
    expect(pickDiscreet(true)).toBe(false);
    expect(pickDiscreet(undefined)).toBe(false);
    setDiscreet('on');
    expect(isDiscreet()).toBe(false);
    setDiscreet(true);
    expect(isDiscreet()).toBe(true);
  });
});

describe('gradeName and gradeInitial', () => {
  it('name the game grade while off', () => {
    expect(GRADES.map((g) => gradeName(g))).toEqual([
      'Mortal',
      'Spirit',
      'Earth',
      'Heaven',
      'Immortal',
    ]);
    expect(GRADES.map(gradeInitial)).toEqual(['M', 'S', 'E', 'H', 'I']);
  });

  it('use office words while on, never a game grade', () => {
    setDiscreet(true);
    const names = GRADES.map((g) => gradeName(g));
    expect(names).toEqual(['Standard', 'Plus', 'Pro', 'Premium', 'Enterprise']);
    const initials = GRADES.map(gradeInitial);
    expect(initials).toEqual(['Std', 'Plus', 'Pro', 'Prem', 'Ent']);
    // Every short form is told apart from the others.
    expect(new Set(initials).size).toBe(GRADES.length);
    for (const v of [...names, ...initials]) {
      expect(v).not.toMatch(/Mortal|Spirit|Earth|Heaven|Immortal/);
    }
  });

  it('can ask for office words with the mode off (the Discreet pop-out)', () => {
    expect(gradeName('heaven', true)).toBe('Premium');
  });

  it('have Vietnamese office words, each short form distinct', () => {
    setLang('vi');
    setDiscreet(true);
    expect(gradeName('immortal')).toBe('Doanh nghiệp');
    const initials = GRADES.map(gradeInitial);
    expect(new Set(initials).size).toBe(GRADES.length);
    for (const v of initials) expect(v).not.toMatch(/^discreet\./);
  });
});

describe('isDiscreetKey', () => {
  const press = (over: Partial<KeyPress> = {}): KeyPress => ({
    code: DISCREET_CODE,
    key: '`',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: { tagName: 'BODY' },
    ...over,
  });

  it('switches on the key alone, on the page or a button', () => {
    expect(isDiscreetKey(press())).toBe(true);
    expect(isDiscreetKey(press({ target: { tagName: 'BUTTON' } }))).toBe(true);
    expect(isDiscreetKey(press({ target: null }))).toBe(true);
  });

  it('leaves other keys, modifiers and a held key alone', () => {
    expect(isDiscreetKey(press({ code: 'KeyD', key: 'd' }))).toBe(false);
    // A layout whose key there types another character still switches.
    expect(isDiscreetKey(press({ key: '^' }))).toBe(true);
    // No key position: the character alone decides.
    expect(isDiscreetKey(press({ code: '', key: '`' }))).toBe(true);
    expect(isDiscreetKey(press({ code: '', key: 'd' }))).toBe(false);
    expect(isDiscreetKey(press({ code: 'KeyD', key: '`' }))).toBe(false);
    expect(isDiscreetKey(press({ ctrlKey: true }))).toBe(false);
    expect(isDiscreetKey(press({ altKey: true }))).toBe(false);
    expect(isDiscreetKey(press({ metaKey: true }))).toBe(false);
    expect(isDiscreetKey(press({ repeat: true }))).toBe(false);
  });

  it('leaves text fields alone', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(isDiscreetKey(press({ target: { tagName } }))).toBe(false);
    }
    expect(isDiscreetKey(press({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(
      false,
    );
  });

  it('still works on inputs that take no text', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'CHECKBOX']) {
      expect(isDiscreetKey(press({ target: { tagName: 'INPUT', type } }))).toBe(true);
    }
    for (const type of ['text', 'search', 'email', '', 7]) {
      expect(isDiscreetKey(press({ target: { tagName: 'INPUT', type } }))).toBe(false);
    }
  });

  it('copes with an odd target', () => {
    expect(isDiscreetKey(press({ target: 'INPUT' }))).toBe(true);
    expect(isDiscreetKey(press({ target: { tagName: 7 } }))).toBe(true);
    expect(isDiscreetKey(press({ target: { isContentEditable: 'true' } }))).toBe(true);
  });
});
