// Skills outside the strip (docs/design.md §5 Qi and skills): the Stats tab's
// Skills list, the breakthrough banner, the Path choice, Respec's preview, the
// Realm chip's list and Help.

import { afterEach, describe, expect, it } from 'vitest';
import { PATH_IDS, REALMS, realmLevels, xpToNext } from '../core/cultivator.ts';
import { makeTribulation } from '../core/floors.ts';
import { pathSkillList, pathStep, rankedPathSkills } from '../core/path-skills.ts';
import { MAX_BURNS, type Effect, type SkillDef } from '../core/skills.ts';
import { faceTribulation, newGame, type GameState } from '../core/sim.ts';
import { DEFAULT_LANG, PACKS, setLang } from './i18n.ts';
import {
  breakthroughSkill,
  helpQiLines,
  nearRealmRows,
  nextRealmLine,
  pathCell,
  realmName,
  realmRows,
  realmUnlock,
  skillCell,
  skillRows,
  skillWhen,
  tribulationBanner,
} from './view.ts';

afterEach(() => setLang(DEFAULT_LANG));

/** The first level of realm `realm`. */
const levelIn = (realm: number): number => realmLevels(realm).from;

/** A Tribulation won between two states: the cultivator steps from realm `realm - 1` into `realm`. */
function breakthrough(path: (typeof PATH_IDS)[number], realm: number): [GameState, GameState] {
  const due = newGame(1, path);
  due.cultivator.level = levelIn(realm) - 1;
  due.cultivator.xp = xpToNext(due.cultivator.level);
  due.enemies.push(makeTribulation(1, realm - 1));
  const fighting = faceTribulation(due);
  const won = structuredClone(fighting);
  won.cultivator.level = levelIn(realm);
  won.kills += 1;
  won.enemies.shift();
  return [fighting, won];
}

describe('skillRows', () => {
  it('lists a new Sword Cultivator with Flying Sword alone, at level 1 / 3', () => {
    const rows = skillRows('sword', 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'flyingSword',
      name: 'Flying Sword',
      cell: skillCell('Flying Sword'),
      level: 1,
      maxLevel: 3,
      tier: 'base',
      levelText: 'Level 1 / 3',
      cost: '30 qi',
      effect: '250% damage, always a crit',
    });
    expect(rows[0]?.when).toBe(
      'Whenever ready, unless a bigger skill it would cast is within 20 qi.',
    );
  });

  it('follows the realm: Golden Core has two swords and Sword Intent', () => {
    const rows = skillRows('sword', levelIn(2));
    expect(rows.map((r) => [r.name, r.levelText, r.tier])).toEqual([
      ['Flying Sword', 'Level 2 / 3', 'mid'],
      ['Sword Intent', 'Level 1 / 3', 'base'],
    ]);
    expect(rows[0]?.effect).toBe('2 × 150% damage, always a crit');
  });

  it('has every skill at its top level, gold, in the last realm', () => {
    for (const path of PATH_IDS) {
      const rows = skillRows(path, levelIn(REALMS.length - 1));
      expect(rows, path).toHaveLength(4);
      expect(rows.every((r) => r.tier === 'max' && r.level === r.maxLevel)).toBe(true);
    }
  });

  it('names an upgrade that becomes something new by its new name and icon', () => {
    const palm = skillRows('body', levelIn(9)).find((r) => r.id === 'mountainFist');
    expect(palm?.name).toBe('Mountain-Toppling Palm');
    expect(palm?.cell).toBe(skillCell('Mountain-Toppling Palm'));
  });
});

describe('skillWhen', () => {
  it("words each rule with the sim's own numbers", () => {
    expect(skillWhen('bloodQiSurge', 1)).toBe('When your HP is below 40%.');
    expect(skillWhen('ironSkin', 1)).toContain('at or below 60%');
    expect(skillWhen('tenThousandSwords', 1)).toContain('below 30% HP');
    expect(skillWhen('sealingTalisman', 2)).toContain('over 70% of its qi');
  });

  it('drops the burning check once Fire Talisman burns stack', () => {
    expect(skillWhen('fireTalisman', 1)).toBe("When the enemy isn't already burning.");
    expect(skillWhen('fireTalisman', 2)).toBe('Whenever ready.');
  });

  it('has a rule for every skill at every rank, in every language', () => {
    for (const pack of PACKS) {
      setLang(pack.code);
      for (const path of PATH_IDS) {
        for (const { def, rank } of rankedPathSkills(path, REALMS.length - 1)) {
          for (let r = 1; r <= rank; r++) {
            const text = skillWhen(def.id, r);
            expect(text, `${pack.code} ${def.id} ${r}`).not.toMatch(/skill\.when|\{\w+\}/);
          }
        }
      }
    }
  });
});

describe('realmUnlock', () => {
  it('names a new skill alone, and an upgrade after the skill it raises', () => {
    expect(realmUnlock('sword', 1)).toEqual({ text: 'Sword Intent', learned: true });
    expect(realmUnlock('sword', 2)).toEqual({ text: 'Flying Sword ↑ Two swords', learned: false });
    expect(realmUnlock('talisman', 3)?.text).toBe('Fire Talisman ↑ Burns stack (up to 3)');
  });

  it('names what an upgrade becomes when it is renamed', () => {
    expect(realmUnlock('body', 9)?.text).toBe('Mountain Fist ↑ Mountain-Toppling Palm');
    expect(realmUnlock('talisman', 9)?.text).toBe('Thunder Talisman ↑ Heavenly Thunder Array');
  });

  it('is null past the last realm', () => {
    expect(realmUnlock('sword', REALMS.length)).toBeNull();
  });

  it('words every realm of every Path in every language, with no key left raw', () => {
    for (const pack of PACKS) {
      setLang(pack.code);
      for (const path of PATH_IDS) {
        for (let realm = 0; realm < REALMS.length; realm++) {
          const text = realmUnlock(path, realm)?.text ?? '';
          expect(text, `${pack.code} ${path} ${realm}`).not.toBe('');
          expect(text, `${pack.code} ${path} ${realm}`).not.toMatch(/skillUp\.|\{\w+\}/);
        }
      }
    }
  });

  it('puts the Vietnamese names and words on the page in Vietnamese', () => {
    setLang('vi');
    expect(realmUnlock('sword', 1)?.text).toBe('Kiếm Ý');
    expect(realmUnlock('sword', 2)?.text).toBe('Phi Kiếm ↑ Hai thanh kiếm');
    expect(nextRealmLine('sword', 1)).toBe('Cảnh giới tới: Kiếm Ý');
  });
});

describe('nextRealmLine', () => {
  it('says what the next realm brings', () => {
    expect(nextRealmLine('sword', 1)).toBe('Next realm: Sword Intent');
    expect(nextRealmLine('sword', levelIn(4))).toBe('Next realm: Ten Thousand Swords');
    expect(nextRealmLine('body', levelIn(1))).toBe(
      'Next realm: Iron Skin ↑ Reflects 25% of damage taken',
    );
  });

  it('says no skill is left in the last realm', () => {
    expect(nextRealmLine('talisman', levelIn(REALMS.length - 1))).toBe(
      'Every realm reached: no skill left to learn.',
    );
  });
});

describe('breakthrough banner', () => {
  it('names a new skill on its second line', () => {
    expect(breakthroughSkill('body', 1)).toBe('New skill: Mountain Fist');
    expect(tribulationBanner(...breakthrough('talisman', 1))).toBe(
      'Breakthrough! Foundation Establishment\nNew skill: Thunder Talisman',
    );
  });

  it('names an upgrade with its arrow', () => {
    expect(tribulationBanner(...breakthrough('sword', 2))).toBe(
      'Breakthrough! Golden Core\nFlying Sword ↑ Two swords',
    );
  });
});

describe('realmRows', () => {
  it("names each realm's unlock for the Path asked for", () => {
    expect(realmRows(1, 'sword').map((r) => r.unlock)).toEqual([
      'New skill: Flying Sword',
      'New skill: Sword Intent',
      'Upgrade: Flying Sword → Two swords',
      'New skill: Lightning Step',
      'Upgrade: Sword Intent → +15% crit chance',
      'New skill: Ten Thousand Swords',
      'Upgrade: Lightning Step → Each dodge answers with a crit',
      'Upgrade: Flying Sword → A kill gives back half its qi',
      'Upgrade: Ten Thousand Swords → 8 hits',
      'Upgrade: Sword Intent → Lasts 10 s, costs 35 qi',
    ]);
    // A Path change names the new Path's unlocks at once.
    expect(realmRows(1, 'talisman')[1]?.unlock).toBe('New skill: Thunder Talisman');
  });

  it("gives each realm's unlock its skill's icon, tinted by the rank reached there", () => {
    const rows = realmRows(1, 'sword');
    expect(rows[0]?.icon).toEqual({ cell: skillCell('Flying Sword'), tier: 'base' });
    expect(rows[1]?.icon).toEqual({ cell: skillCell('Sword Intent'), tier: 'base' });
    expect(rows[2]?.icon?.tier).toBe('mid');
    for (const path of PATH_IDS) {
      for (const row of realmRows(1, path)) {
        expect(row.icon, `${path} ${row.name}`).not.toBeNull();
        expect(row.icon?.cell, `${path} ${row.name}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('nearRealmRows', () => {
  const names = (level: number): string[] => nearRealmRows(level, 'sword').map((r) => r.name);

  it('shows the realm before, the current one and the one after', () => {
    expect(names(levelIn(3))).toEqual(['Golden Core', 'Nascent Soul', 'Spirit Transformation']);
    const rows = nearRealmRows(levelIn(3), 'sword');
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
    expect(rows[1]?.title).toBe('Manager');
  });

  it('keeps three rows at either end', () => {
    expect(names(1)).toEqual(['Qi Condensation', 'Foundation Establishment', 'Golden Core']);
    expect(nearRealmRows(1, 'sword')[0]?.current).toBe(true);
    const last = nearRealmRows(levelIn(REALMS.length - 1), 'sword');
    expect(last).toHaveLength(3);
    expect(last[2]?.current).toBe(true);
  });

  it('marks only the realm just before the current one as past, at either end too', () => {
    const past = (level: number): boolean[] => nearRealmRows(level, 'sword').map((r) => r.past);
    expect(past(1)).toEqual([false, false, false]);
    expect(past(levelIn(3))).toEqual([true, false, false]);
    expect(past(levelIn(REALMS.length - 1))).toEqual([false, true, false]);
    for (let realm = 0; realm < REALMS.length; realm++) {
      const rows = nearRealmRows(levelIn(realm), 'sword');
      expect(
        rows.filter((r) => r.current),
        `realm ${realm}`,
      ).toHaveLength(1);
      expect(
        rows.filter((r) => r.past && r.current),
        `realm ${realm}`,
      ).toHaveLength(0);
    }
  });
});

describe('realmName', () => {
  it('is the realm alone, without its job title', () => {
    expect(realmName(1)).toBe('Qi Condensation');
    expect(realmName(levelIn(8))).toBe('Tribulation Transcendence');
  });
});

describe('pathCell', () => {
  it("is the cell of the Path's first skill", () => {
    for (const path of PATH_IDS)
      expect(pathCell(path), path).toBe(skillCell(pathSkillList(path)[0]?.name ?? ''));
    expect(new Set(PATH_IDS.map(pathCell)).size).toBe(PATH_IDS.length);
  });
});

describe('pathSkillList', () => {
  it('lists each Path’s four skills by the names first learned, learned order', () => {
    expect(pathSkillList('body').map((k) => k.name)).toEqual([
      'Iron Skin',
      'Mountain Fist',
      'Blood Qi Surge',
      'Vajra Body',
    ]);
    for (const path of PATH_IDS) {
      for (const k of pathSkillList(path))
        expect(skillCell(k.name), k.name).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('helpQiLines', () => {
  it("puts the sim's qi numbers in Help's Qi and skills entry", () => {
    const [gain, regen, cast, windUp] = helpQiLines();
    expect(gain).toContain('+8 per attack, +4 per hit taken');
    expect(regen).toContain('Qi per second: 1 to start');
    expect(cast).toContain('Uses it when');
    expect(windUp).toContain('a stun cancels the wind-up');
  });

  it('has the entry in every language, with no placeholder left', () => {
    for (const pack of PACKS) {
      setLang(pack.code);
      for (const line of helpQiLines()) expect(line, pack.code).not.toMatch(/\{\w+\}|help\.qi/);
    }
  });
});

describe('out-of-range levels and realms', () => {
  const levels = [0, -5, NaN, 1e9, Number.MAX_SAFE_INTEGER, Infinity];

  it('clamps any level to a realm there is, never throwing', () => {
    for (const path of PATH_IDS) {
      for (const level of levels) {
        expect(() => skillRows(path, level), `${path} ${level}`).not.toThrow();
        expect(realmRows(level, path), `${path} ${level}`).toHaveLength(REALMS.length);
        expect(nearRealmRows(level, path), `${path} ${level}`).toHaveLength(3);
        expect(realmName(level), `${path} ${level}`).not.toBe('');
        expect(nextRealmLine(path, level), `${path} ${level}`).not.toBe('');
      }
    }
  });

  it('has no unlock before the first realm or after the last', () => {
    for (const path of PATH_IDS) {
      for (const realm of [-1, REALMS.length, 1e9, NaN]) {
        expect(realmUnlock(path, realm), `${path} ${realm}`).toBeNull();
        expect(breakthroughSkill(path, realm), `${path} ${realm}`).toBeNull();
      }
    }
  });
});

describe('upgrade wording', () => {
  /** A skill's def at the rank realm `realm` brings it. */
  function defAt(path: (typeof PATH_IDS)[number], realm: number, id: string): SkillDef {
    const k = rankedPathSkills(path, realm).find((r) => r.def.id === id);
    if (!k) throw new Error(`${path} ${id} at ${realm}`);
    return k.def;
  }
  const effect = <T extends Effect['type']>(d: SkillDef, type: T) =>
    d.effects.find((e): e is Extract<Effect, { type: T }> => e.type === type);
  const mods = (d: SkillDef) =>
    d.effects.filter((e): e is Extract<Effect, { type: 'mod' }> => e.type === 'mod');
  const pct = (share: number | undefined): string => `${Math.round((share ?? 0) * 100)}%`;

  // The upgrade lines are written by hand: each names the numbers the core
  // def has at that rank, so retuning a skill fails here until they follow.
  const cases: [(typeof PATH_IDS)[number], number, (d: SkillDef) => string[]][] = [
    ['sword', 2, (d) => [effect(d, 'hit')?.hits === 2 ? 'Two swords' : '?']],
    ['sword', 4, (d) => [`+${pct(mods(d).find((e) => e.stat === 'critChance')?.amount)}`]],
    ['sword', 6, (d) => [effect(d, 'evade')?.counter ? 'crit' : '?']],
    ['sword', 7, (d) => [effect(d, 'hit')?.refund === 0.5 ? 'half its qi' : '?']],
    ['sword', 8, (d) => [`${effect(d, 'hit')?.hits} hits`]],
    ['sword', 9, (d) => [`${effect(d, 'mod')?.duration} s`, `${d.qi} qi`]],
    ['body', 2, (d) => [pct(effect(d, 'reflect')?.share)]],
    ['body', 4, (d) => [`${effect(d, 'stun')?.duration} s`, pct(effect(d, 'hit')?.maxHp)]],
    [
      'body',
      6,
      (d) => [`${effect(d, 'mod')?.duration} s`, effect(d, 'mod')?.amount === 1 ? 'Doubles' : '?'],
    ],
    ['body', 7, (d) => [`${d.qi} qi`]],
    ['body', 8, (d) => [`${effect(d, 'endure')?.duration} s`]],
    ['talisman', 3, (d) => [effect(d, 'burn')?.stack ? `up to ${MAX_BURNS}` : '?']],
    ['talisman', 5, (d) => [`${(effect(d, 'hit')?.spill?.count ?? 0) - 1} enemies`]],
    ['talisman', 6, (d) => [effect(d, 'shield')?.burst ? 'Bursts' : '?']],
    [
      'talisman',
      7,
      (d) => [`${effect(d, 'silence')?.duration} s`, effect(d, 'drain')?.steal ? 'steals' : '?'],
    ],
    ['talisman', 8, (d) => [`${d.qi} qi`]],
  ];

  it.each(cases)('%s at realm %i names the numbers its def has', (path, realm, numbers) => {
    const step = pathStep(path, realm);
    expect(step?.rank).toBeGreaterThan(1);
    const text = realmUnlock(path, realm)?.text ?? '';
    for (const n of numbers(defAt(path, realm, step?.id ?? ''))) expect(text).toContain(n);
  });

  it('covers every upgrade that keeps its name', () => {
    const covered = new Set(cases.map(([path, realm]) => `${path} ${realm}`));
    for (const path of PATH_IDS) {
      for (let realm = 1; realm < REALMS.length; realm++) {
        const step = pathStep(path, realm);
        if (!step || step.rank === 1) continue;
        const renamed = realmUnlock(path, realm)?.text.endsWith(step.name);
        if (!renamed) expect(covered.has(`${path} ${realm}`), `${path} ${realm}`).toBe(true);
      }
    }
  });
});
