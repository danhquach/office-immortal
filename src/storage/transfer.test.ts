import { describe, expect, it } from 'vitest';
import { newGame } from '../core/sim.ts';
import { encodeSave } from './save.ts';
import {
  CODE_TAG,
  exportCode,
  importCode,
  MAX_CODE_CHARS,
  MAX_PASTE_CHARS,
  type ImportResult,
} from './transfer.ts';

const raw = encodeSave(newGame(7, 'talisman'), 1_700_000_000_000);
const code = exportCode(raw);
/** A code holding any text: exportCode encodes it whether or not it is a save. */
const codeOf = exportCode;
const why = (r: ImportResult): string => (r.ok ? 'ok' : r.why);

describe('save code', () => {
  it('is one line of plain ASCII behind the tag', () => {
    expect(code.startsWith(CODE_TAG)).toBe(true);
    expect(code).toMatch(/^[\x21-\x7e]+$/);
    expect(code.length).toBeLessThanOrEqual(MAX_CODE_CHARS);
  });

  it('imports back to the same save', () => {
    const r = importCode(code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.raw).toBe(raw);
    expect(r.save.savedAt).toBe(1_700_000_000_000);
    expect(encodeSave(r.save.state, r.save.savedAt)).toBe(raw);
  });

  it('ignores spaces and line breaks a mail or notes app adds', () => {
    const broken = `  ${code.slice(0, 20)}\r\n${code.slice(20, 50)}\n\t${code.slice(50)}  \n`;
    expect(why(importCode(broken))).toBe('ok');
  });

  it('refuses an empty paste', () => {
    expect(why(importCode(''))).toBe('empty');
    expect(why(importCode(' \n\t'))).toBe('empty');
  });

  it('refuses anything that is not text', () => {
    for (const v of [null, undefined, 42, {}, [code]]) expect(why(importCode(v))).toBe('bad');
  });

  it('refuses oversized input before decoding it', () => {
    expect(why(importCode('A'.repeat(MAX_PASTE_CHARS + 1)))).toBe('tooBig');
    expect(why(importCode(CODE_TAG + 'A'.repeat(MAX_CODE_CHARS)))).toBe('tooBig');
    // Spaces don't count toward the code, but do toward the paste.
    expect(why(importCode(`${code}${' '.repeat(MAX_PASTE_CHARS)}`))).toBe('tooBig');
  });

  it('answers fast on long hostile input (no ReDoS)', () => {
    const t0 = performance.now();
    for (const s of [
      'A'.repeat(MAX_PASTE_CHARS),
      `${CODE_TAG}${'='.repeat(MAX_CODE_CHARS - CODE_TAG.length)}`,
      `${CODE_TAG}${'A'.repeat(MAX_CODE_CHARS - CODE_TAG.length - 1)}!`,
      ' \n'.repeat(MAX_PASTE_CHARS / 2),
    ]) {
      importCode(s);
    }
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('refuses a missing, wrong or look-alike tag', () => {
    expect(why(importCode(code.slice(CODE_TAG.length)))).toBe('bad');
    expect(why(importCode(code.replace('OI1:', 'OI2:')))).toBe('bad');
    expect(why(importCode(code.replace('OI1:', 'oi1:')))).toBe('bad');
    // A Cyrillic O.
    expect(why(importCode(code.replace('O', 'О')))).toBe('bad');
    // The raw JSON is not a code.
    expect(why(importCode(raw))).toBe('bad');
  });

  it('refuses broken base64', () => {
    expect(why(importCode(code.slice(0, -1)))).toBe('bad');
    expect(why(importCode(`${code}!`))).toBe('bad');
    expect(why(importCode(`${code.slice(0, 30)}-_${code.slice(32)}`))).toBe('bad');
    expect(why(importCode(`${CODE_TAG}====`))).toBe('bad');
  });

  it('refuses Unicode tricks in the code: zero-width, bidi, non-breaking and full-width', () => {
    for (const trick of ['​', '‍', '﻿', '‮', '⁦', ' ', '　']) {
      expect(why(importCode(code.slice(0, 40) + trick + code.slice(40))), trick).toBe('bad');
    }
    expect(why(importCode(code.replace(/A/, 'Ａ')))).toBe('bad');
  });

  it('refuses a code whose bytes are not valid UTF-8', () => {
    expect(why(importCode(CODE_TAG + btoa('{"v":\xff\xfe}')))).toBe('bad');
  });

  it('refuses a well-formed code that holds no valid save', () => {
    for (const text of ['', 'null', '[]', '"save"', '{}', '{"v":7,"savedAt":1,"state":{}}']) {
      expect(why(importCode(codeOf(text))), text).toBe('bad');
    }
  });

  it('refuses prototype pollution and leaves the prototype alone', () => {
    for (const text of [
      '{"__proto__":{"polluted":1}}',
      raw.replace('{"v"', '{"__proto__":{"polluted":1},"v"'),
      raw.replace('"state":{', '"state":{"__proto__":{"polluted":1},'),
      raw.replace('"state":{', '"state":{"constructor":{"prototype":{"polluted":1}},'),
      raw.replace('"cultivator":{', '"cultivator":{"__proto__":{"polluted":1},'),
    ]) {
      expect(text).not.toBe(raw);
      expect(why(importCode(codeOf(text)))).toBe('bad');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses Unicode tricks inside the save', () => {
    for (const path of ['‮talisman', 'tali​sman', 'tаlisman', 'talisman\u0000']) {
      const text = raw.replace('"path":"talisman"', `"path":${JSON.stringify(path)}`);
      expect(text).not.toBe(raw);
      expect(why(importCode(codeOf(text))), JSON.stringify(path)).toBe('bad');
    }
  });

  it('refuses a save past the size limit even when the code fits the paste', () => {
    const big = raw.replace('{"v"', `{"pad":"${'x'.repeat(200_000)}","v"`);
    expect(why(importCode(codeOf(big)))).toBe('tooBig');
  });
});
