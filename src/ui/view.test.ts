import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  derive,
  newCultivator,
  realmLevels,
  realmOf,
  REALMS,
  type Cultivator,
  type PathId,
} from '../core/cultivator.ts';
import {
  BAG_ROW,
  INVENTORY_SIZE,
  MAX_BAG_SIZE,
  refineCost,
  rerollCost,
  spendPoints,
} from '../core/economy.ts';
import type { EquipSlotId, Item } from '../core/loot.ts';
import {
  equip,
  faceTribulation,
  newGame,
  setAutoTribulation,
  tick,
  TRIAL_RETRY_SECONDS,
  type GameState,
} from '../core/sim.ts';
import { OFFER_IDS, syncStore, type OfferId } from '../core/store.ts';
import {
  arraySetUp,
  BAG_PAGE,
  bagPage,
  bagPages,
  compareGroups,
  compareToEquipped,
  equipBlock,
  cellLabel,
  characterStatusLabel,
  versionDetails,
  versionLabel,
  durationLabel,
  formatBonus,
  freshDrops,
  gridMove,
  itemLineGroups,
  itemLines,
  itemTag,
  itemName,
  qualityLine,
  refineMark,
  refineAction,
  rerollAction,
  refinePreview,
  refineResult,
  rerollResult,
  rerollConfirm,
  affixText,
  CRAFT_MODES,
  gearVerdict,
  verdictOf,
  treasureTier,
  charmLineName,
  favouredBy,
  itemFacts,
  unequipBlock,
  overtimeView,
  pageOf,
  passiveRow,
  realmLabel,
  realmBoost,
  realmBoostTip,
  realmRows,
  retireLabel,
  SUMMARY_ICONS,
  summaryIcon,
  boostChip,
  boostLines,
  offerCard,
  offerName,
  refreshView,
  STORE_ICONS,
  storeCountdown,
  storeIcon,
  chestOrder,
  retireLines,
  respecView,
  STAT_GROUPS,
  bulkAsk,
  bulkLabel,
  bulkParts,
  gradeRuns,
  soulsLine,
  tintOf,
  statRows,
  tribulationBanner,
  tribulationCall,
  trialPause,
  tribulationFellDue,
  discreetRows,
  waveLabel,
  xpBar,
  parseShare,
  planRatio,
  slowPoint,
  spendPreview,
  statTip,
  castCallouts,
  windUpOf,
} from './view.ts';
import { makeEnemy, makeTribulation } from '../core/floors.ts';
import { DEFAULT_LANG, PACKS, setLang, t, tn } from './i18n.ts';
import { setDiscreet } from './discreet.ts';
import { freshCombat, note } from '../core/skills.ts';
import { xpToNext } from '../core/cultivator.ts';
import { noPassives, type RetirePreview } from '../core/prestige.ts';

const stapler: Item = {
  slot: 'weapon',
  name: 'Golden Crow Flying Sword',
  level: 10,
  grade: 'heaven',
  baseRoll: 1,
  affixes: [
    { id: 'critChance', roll: 0 },
    { id: 'maxHp', roll: 1 },
  ],
};

describe('formatBonus', () => {
  it('shows flat stats as numbers and shares as percents', () => {
    expect(formatBonus('damage', 14)).toBe('+14 Damage');
    expect(formatBonus('defence', 2.5)).toBe('+2.5 Defence');
    expect(formatBonus('critChance', 0.015)).toBe('+1.5% Crit chance');
    expect(formatBonus('damagePct', 0.25)).toBe('+25% Damage');
  });

  it('signs negatives with a minus', () => {
    expect(formatBonus('maxHp', -3)).toBe('−3 Max HP');
  });
});

describe('items', () => {
  it('lists base stat then affixes, at the item level', () => {
    // 8–14 damage at level 10, rolled to the top; crit 0.7% at its minimum; max HP 20–50.
    expect(itemLines(stapler)).toEqual(['+14 Damage', '+0.7% Crit chance', '+50 Max HP']);
  });

  it('groups the lines by what they do: offence, defence, then utility', () => {
    expect(itemLineGroups(stapler)).toEqual([
      { kind: 'offence', lines: ['+14 Damage', '+0.7% Crit chance'] },
      { kind: 'defence', lines: ['+50 Max HP'] },
    ]);
    const charmed = {
      ...stapler,
      affixes: [{ id: 'stoneFind' as const, roll: 0 }, ...stapler.affixes],
    };
    expect(itemLineGroups(charmed).map((g) => g.kind)).toEqual(['offence', 'defence', 'utility']);
    // Every line lands in exactly one group, the unique effect too.
    const immortal = { ...stapler, grade: 'immortal' as const, unique: 'parachute' as const };
    expect(
      itemLineGroups(immortal)
        .flatMap((g) => g.lines)
        .sort(),
    ).toEqual(itemLines(immortal).sort());
    expect(
      itemLineGroups(immortal)
        .find((g) => g.kind === 'defence')
        ?.lines.at(-1),
    ).toBe('Golden Parachute: +25% Max HP');
  });

  it('adds the unique effect on an Immortal item', () => {
    const lines = itemLines({ ...stapler, grade: 'immortal', unique: 'synergy' });
    expect(lines.at(-1)).toBe('Synergy of the Dao: +25% Damage');
  });

  it('tags grade, slot and level in text, and quality on its own labeled line', () => {
    expect(itemTag(stapler)).toBe('Heaven · Weapon · Lv 10');
    expect(qualityLine(stapler)).toBe('Quality 66%');
  });

  it('names the grade in office words in Discreet mode', () => {
    setDiscreet(true);
    try {
      expect(itemTag(stapler)).toBe('Premium · Weapon · Lv 10');
    } finally {
      setDiscreet(false);
    }
  });

  it.each([
    ['mortal', 'Magic Tool'],
    ['spirit', 'Magic Tool'],
    ['earth', 'Spirit Treasure'],
    ['heaven', 'Spirit Treasure'],
    ['immortal', 'Immortal Treasure'],
  ] as const)('names a %s weapon a %s', (grade, tier) => {
    expect(treasureTier({ ...stapler, grade })).toBe(tier);
  });

  it('gives no treasure tier to other item types', () => {
    for (const slot of [
      'head',
      'chest',
      'boots',
      'attachment',
      'sideArm',
      'accessory',
      'charm',
    ] as const) {
      expect(treasureTier({ ...stapler, slot, grade: 'immortal' })).toBeNull();
    }
  });

  it('gives no treasure tier for a grade it does not know', () => {
    expect(treasureTier({ ...stapler, grade: '__proto__' as Item['grade'] })).toBeNull();
    expect(treasureTier({ ...stapler, grade: 'toString' as Item['grade'] })).toBeNull();
  });
});

describe('charmLineName', () => {
  const charm = (name: string, grade: Item['grade'] = 'earth'): Item => ({
    slot: 'charm',
    name,
    level: 10,
    grade,
    baseRoll: 0.5,
    affixes: [{ id: 'qiRegen', roll: 1 }],
  });

  it.each([
    ['Jade Seal Talisman', 'Attack Talisman'],
    ['Jade Vajra Talisman', 'Defend Talisman'],
    ['Jade Wealth Talisman', 'Utility Talisman'],
    ['Emerald Jade Token', 'Jade Slip'],
  ])('names %s a %s', (name, line) => {
    expect(charmLineName(charm(name))).toBe(line);
  });

  it('names no line for other types or a name off its grade', () => {
    expect(charmLineName(stapler)).toBeNull();
    expect(charmLineName(charm('Phoenix Blood Jade', 'mortal'))).toBeNull();
    expect(charmLineName(charm('Emerald Jade Token', '__proto__' as Item['grade']))).toBeNull();
  });

  it('shows a utility affix at the line range: 0.75x on a Talisman, 1.5x on Jade', () => {
    // Qi regen 2–6% at level 1 and 1 + 9/20 = 1.45x at level 10: 8.7% at its top.
    expect(itemLines(charm('Jade Wealth Talisman'))[1]).toBe('+6.5% Qi regen');
    expect(itemLines(charm('Emerald Jade Token'))[1]).toBe('+13.1% Qi regen');
  });
});

describe('equipBlock', () => {
  const at = (level: number) => ({ ...newCultivator('sword'), level });

  it('names the realm a Spirit Treasure needs below it, and nothing from it', () => {
    expect(equipBlock(at(10), stapler)).toBe('Requires Foundation Establishment');
    expect(equipBlock(at(11), stapler)).toBeNull();
  });

  it('names the realm an Immortal Treasure needs below it, and nothing from it', () => {
    const relic = { ...stapler, grade: 'immortal' } as const;
    expect(equipBlock(at(20), relic)).toBe('Requires Golden Core');
    expect(equipBlock(at(21), relic)).toBeNull();
  });

  it('never blocks a Magic Tool or another item type', () => {
    expect(equipBlock(at(1), { ...stapler, grade: 'mortal' })).toBeNull();
    expect(equipBlock(at(1), { ...stapler, grade: 'spirit' })).toBeNull();
    expect(equipBlock(at(1), { ...stapler, slot: 'head', grade: 'immortal' })).toBeNull();
  });
});

describe('compareToEquipped', () => {
  const texts = (c: Cultivator, item: Item, to: EquipSlotId = 'weapon') =>
    compareToEquipped(c, item, to).map((l) => l.text);

  it('shows only the stats that would change, signed', () => {
    const c = newCultivator('sword');
    expect(compareToEquipped(c, stapler, 'weapon').every((l) => l.better)).toBe(true);
    expect(texts(c, stapler)).toEqual(['+50 Max HP', '+14 Damage', '+0.7% Crit chance']);
  });

  it('shows losses when the bag item is worse than the equipped one', () => {
    const c = newCultivator('sword');
    c.equipment.weapon = stapler;
    const worse: Item = { ...stapler, baseRoll: 0, affixes: [] };
    expect(compareToEquipped(c, worse, 'weapon').every((l) => !l.better)).toBe(true);
    expect(texts(c, worse)).toEqual(['−50 Max HP', '−6 Damage', '−0.7% Crit chance']);
  });

  it('reads share stats as signed percents, like the item card', () => {
    const c = newCultivator('sword');
    const gourd: Item = {
      slot: 'attachment',
      name: 'Azure Spirit Gourd',
      level: 1,
      grade: 'spirit',
      baseRoll: 0,
      affixes: [
        { id: 'critDamage', roll: 1 },
        { id: 'attackSpeed', roll: 1 },
      ],
    };
    // Lifesteal 1%, crit damage +0.15; attack speed adds straight to attacks/s.
    expect(texts(c, gourd, 'attachment')).toEqual([
      '+0.06 Attacks/s',
      '+15% Crit damage',
      '+1% Lifesteal',
    ]);
  });

  it('is empty for an identical item', () => {
    const c = newCultivator('sword');
    c.equipment.weapon = stapler;
    expect(compareToEquipped(c, { ...stapler }, 'weapon')).toEqual([]);
  });

  describe('compareGroups', () => {
    it('groups the lines by the Attributes box kinds, in its order', () => {
      const c = newCultivator('sword');
      expect(compareGroups(compareToEquipped(c, stapler, 'weapon'))).toEqual([
        {
          kind: 'offence',
          lines: [
            { text: '+14 Damage', better: true },
            { text: '+0.7% Crit chance', better: true },
          ],
        },
        { kind: 'defence', lines: [{ text: '+50 Max HP', better: true }] },
      ]);
    });

    it('files Qi regen under utility, not the Stats tab defence', () => {
      const line = { text: '+5% Qi regen', better: true };
      expect(compareGroups([{ ...line, kind: 'utility' }])).toEqual([
        { kind: 'utility', lines: [line] },
      ]);
      const c = newCultivator('sword');
      const ring: Item = { ...stapler, slot: 'accessory', affixes: [{ id: 'qiRegen', roll: 1 }] };
      const kinds = compareToEquipped(c, ring, 'accessory1').map((l) => [l.text, l.kind]);
      expect(kinds).toContainEqual([expect.stringContaining('Qi regen'), 'utility']);
    });

    it('puts arrays in their own kind and keeps order over input order', () => {
      const lines = [
        { text: '+Illusion Array (8%)', better: true, kind: 'defence' as const },
        { text: '−Killing Array (15%)', better: false, kind: 'offence' as const },
      ];
      expect(compareGroups(lines).map((g) => g.kind)).toEqual(['offence', 'defence']);
    });

    it('is empty when nothing changes', () => {
      expect(compareGroups([])).toEqual([]);
    });
  });

  it('compares against the chosen one of two positions', () => {
    const c = newCultivator('sword');
    const charm = (baseRoll: number): Item => ({
      slot: 'charm',
      name: 'Laminated Seal',
      level: 1,
      grade: 'mortal',
      baseRoll,
      affixes: [],
    });
    c.equipment.charm1 = charm(1);
    // Charm 1 holds the better charm; Charm 2 is empty.
    expect(texts(c, charm(0), 'charm1')).toEqual(['−0.4% Crit chance']);
    expect(texts(c, charm(0), 'charm2')).toEqual(['+0.4% Crit chance']);
  });
});

describe('statRows', () => {
  it('formats the derived numbers of a new cultivator', () => {
    const rows = Object.fromEntries(
      statRows(newCultivator('sword')).map((r) => [r.label, r.value]),
    );
    // Body is another Path's stat for a Sword Cultivator: +5 max HP a point.
    expect(rows['Max HP']).toBe('65');
    expect(rows['Crit chance']).toBe('7.3%');
    // Flowing Sword: +0.5% crit damage a point of Agility (8 at the start).
    expect(rows['Crit damage']).toBe('×2.04');
    expect(rows['HP regen']).toBe('0.25/s');
  });

  it('adds treasure find from passives to the gear’s', () => {
    const label = (n: number) =>
      statRows(newCultivator('sword'), { ...noPassives(), treasure: n }).find(
        (r) => r.label === 'Treasure find',
      )?.value;
    expect(label(0)).toBe('0%');
    expect(label(3)).toBe('15%');
  });

  it('puts every row in a group, in group order, with short labels under Find', () => {
    const rows = statRows(newCultivator('sword'));
    const by = (g: string) => rows.filter((r) => r.group === g).map((r) => r.short);
    expect(by('Offence')).toEqual(['Damage', 'Attacks/s', 'Crit chance', 'Crit damage', 'Pierce']);
    expect(by('Defence')).toEqual([
      'Max HP',
      'Defence',
      'Lifesteal',
      'HP regen',
      'Dodge',
      'Max qi',
      'Qi regen/s',
    ]);
    expect(by('Find')).toEqual(['Spirit stones', 'Treasure']);
    expect(rows.every((r) => (STAT_GROUPS as readonly string[]).includes(r.group))).toBe(true);
    expect(rows.find((r) => r.short === 'Treasure')?.label).toBe('Treasure find');
  });
});

describe('respecView', () => {
  it('is on with the cost shown when it can be paid', () => {
    expect(respecView(3000, 3000)).toEqual({ cost: '3000 Spirit Stones', off: false, why: '' });
  });

  it('says how many more Spirit Stones are needed', () => {
    expect(respecView(3000, 900)).toEqual({
      cost: '3000 Spirit Stones',
      off: true,
      why: 'Need 2100 more',
    });
  });

  it('says there is nothing to reset before anything about cost', () => {
    expect(respecView(3000, 0, true)).toMatchObject({ off: true, why: 'Nothing to reset' });
    expect(respecView(3000, 9999, true)).toMatchObject({ off: true, why: 'Nothing to reset' });
  });
});

describe('Reincarnation', () => {
  const preview: RetirePreview = {
    insight: 8,
    insightAfter: 11,
    highestFloor: 20,
    level: 14,
    items: 9,
    stones: 1500,
    essence: 40,
    bagCells: 8,
    boosts: 0,
  };

  it('labels the button with the insight, or the floor still needed', () => {
    expect(retireLabel(preview)).toBe('Reincarnate…');
    expect(retireLabel({ ...preview, insight: 0 })).toBe('Reach floor 10 to reincarnate');
  });

  it('lists what is kept and what is lost', () => {
    expect(retireLines(preview)).toEqual({
      kept: ['+8 Dao Insight (11 total)', 'Passives', 'Path and auto filter'],
      lost: [
        'Level 14, floor 20',
        '9 items (bag and worn)',
        '1500 Spirit Stones',
        '40 Spirit Essence',
        '8 bought bag slots',
      ],
    });
  });

  it('leaves out bag slots when none were bought, and counts one item', () => {
    const { lost } = retireLines({ ...preview, items: 1, bagCells: 0 });
    expect(lost).toContain('1 item (bag and worn)');
    expect(lost.some((l) => l.includes('bag slots'))).toBe(false);
  });

  it('shows a passive’s rank, buy button and detail, by state', () => {
    const p = { ...noPassives(), xp: 2, offline: 8 };
    expect(passiveRow(p, 8, 'xp')).toEqual({
      name: 'Seniority',
      rank: '2/20',
      state: 'can',
      buy: 'Buy 8',
      buyName: 'Buy 8 Dao Insight: Seniority rank 3 of 20',
      detail: '+10% XP per rank. Next rank: 8 Dao Insight.',
    });
    expect(passiveRow(p, 7, 'xp').state).toBe('cant');
    expect(passiveRow(p, 1000, 'offline')).toEqual({
      name: 'Flexible Hours',
      rank: '8/8',
      state: 'max',
      buy: 'Max',
      buyName: 'Max: Flexible Hours is at rank 8 of 8',
      detail: '+1 h Overtime Cultivation cap per rank. Max rank.',
    });
  });

  it('starts every buy button’s accessible name with its visible text', () => {
    const p = { ...noPassives(), offline: 8 };
    for (const id of ['xp', 'treasure', 'offline', 'points'] as const) {
      const row = passiveRow(p, 5, id);
      expect(row.buyName.startsWith(row.buy)).toBe(true);
    }
  });
});

describe('waveLabel', () => {
  it('walks waves, then the elite, then the boss', () => {
    const s = newGame(1, 'sword');
    const seen: string[] = [];
    while (s.enemies.length > 0) {
      seen.push(waveLabel(s));
      s.enemies.shift();
    }
    expect(seen).toEqual([
      ...Array<string>(3).fill('Wave 1 / 3'),
      ...Array<string>(3).fill('Wave 2 / 3'),
      ...Array<string>(3).fill('Wave 3 / 3'),
      'Elite',
      'Boss',
    ]);
  });

  it('counts the waves the same with a Tribulation queued, then names it', () => {
    const s = newGame(1, 'sword');
    s.enemies.push(makeTribulation(1, 0));
    const seen: string[] = [];
    while (s.enemies.length > 0) {
      seen.push(waveLabel(s));
      s.enemies.shift();
    }
    expect(seen.slice(0, 3)).toEqual(Array<string>(3).fill('Wave 1 / 3'));
    expect(seen.slice(-3)).toEqual(['Elite', 'Boss', 'Tribulation']);
  });
});

describe('discreetRows', () => {
  const ring: Item = {
    slot: 'sideArm',
    name: 'Jade Hundred Ghosts Banner',
    level: 10,
    grade: 'spirit',
    baseRoll: 0.5,
    affixes: [],
  };

  it('writes the run as plain cells in office words', () => {
    const s = newGame(1, 'sword');
    s.kills = 340;
    s.cultivator.hp = derive(s.cultivator).maxHp / 2;
    const enemy = s.enemies[0] as GameState['enemies'][number];
    enemy.hp = enemy.maxHp * 0.25;
    expect(discreetRows(s, ring, false)).toEqual([
      ['Floor', '1 · Step 1 / 3'],
      ['Level', `1 · 0 / ${xpToNext(1)}`],
      ['Health', '50%'],
      ['Target', '25%'],
      ['Closed', '340'],
      ['Latest', 'Plus · Jade Hundred Ghosts Banner'],
      ['Status', 'On track'],
    ]);
  });

  it('dulls the elite, the boss and a Tribulation, and shows no drop or foe as a dash', () => {
    const s = newGame(1, 'sword');
    const seen: string[] = [];
    s.enemies.push(makeTribulation(1, 0));
    while (s.enemies.length > 0) {
      seen.push(discreetRows(s, null, false)[0]?.[1] ?? '');
      s.enemies.shift();
    }
    expect(seen.slice(-3)).toEqual(['1 · Escalation', '1 · Final review', '1 · Audit']);
    const rows = discreetRows(s, null, false);
    expect(rows[3]).toEqual(['Target', '–']);
    expect(rows[5]).toEqual(['Latest', '–']);
  });

  it('says a due review without the XP, and never a realm, Path or the game', () => {
    const s = dueAt(10);
    const rows = discreetRows(s, ring, true);
    expect(rows[1]).toEqual(['Level', '10']);
    expect(rows[6]).toEqual(['Status', 'Review due']);
    const text = rows.flat().join(' ');
    expect(text).not.toMatch(
      /Tribulation|Immortal|Qi Condensation|Foundation|Sword|Wave|Boss|Elite/,
    );
  });

  it('names every grade in office words, never the game grade', () => {
    const s = newGame(1, 'sword');
    const seen = (['mortal', 'spirit', 'earth', 'heaven', 'immortal'] as const).map(
      (grade) => discreetRows(s, { ...ring, grade }, false)[5]?.[1] ?? '',
    );
    expect(seen.map((v) => v.split(' · ')[0])).toEqual([
      'Standard',
      'Plus',
      'Pro',
      'Premium',
      'Enterprise',
    ]);
    for (const v of seen) expect(v).not.toMatch(/Mortal|Spirit|Earth|Heaven|Immortal/);
  });

  it('keeps HP inside 0-100%', () => {
    const s = newGame(1, 'sword');
    s.cultivator.hp = -5;
    const enemy = s.enemies[0] as GameState['enemies'][number];
    enemy.hp = enemy.maxHp * 3;
    const rows = discreetRows(s, null, false);
    expect(rows[2]?.[1]).toBe('0%');
    expect(rows[3]?.[1]).toBe('100%');
  });

  it('has a Vietnamese word for every cell', () => {
    setLang('vi');
    const rows = discreetRows(dueAt(10), ring, true);
    setLang(DEFAULT_LANG);
    for (const [label, value] of rows) {
      expect(label).not.toMatch(/^discreet\./);
      expect(value).not.toMatch(/discreet\./);
    }
    expect(rows[6]?.[1]).toBe('Đến hạn duyệt');
  });

  it('says Review postponed while the Tribulation is set aside', () => {
    expect(discreetRows(pausedAt(10), null, true)[6]?.[1]).toBe('Review postponed');
    setLang('vi');
    const vi = discreetRows(pausedAt(10), null, true)[6]?.[1];
    setLang(DEFAULT_LANG);
    expect(vi).toBe('Hoãn duyệt');
  });
});

describe('summaryIcon', () => {
  it('has Spirit Stones, Spirit Essence and one icon per realm, each its own column', () => {
    expect(SUMMARY_ICONS).toHaveLength(2 + REALMS.length);
    expect(new Set(SUMMARY_ICONS).size).toBe(SUMMARY_ICONS.length);
    expect(summaryIcon('stones')).toBe(0);
    expect(summaryIcon('essence')).toBe(1);
  });

  it('changes the realm icon at each breakthrough, and Immortal Ascension keeps the last', () => {
    expect(summaryIcon('realm', 1)).toBe(2);
    expect(summaryIcon('realm', 10)).toBe(2);
    expect(summaryIcon('realm', 11)).toBe(3);
    expect(summaryIcon('realm', 210)).toBe(10);
    expect(summaryIcon('realm', 211)).toBe(11);
    expect(summaryIcon('realm', 3000)).toBe(11);
    const cols = Array.from({ length: REALMS.length }, (_, r) =>
      summaryIcon('realm', realmLevels(r).from),
    );
    expect(new Set(cols).size).toBe(REALMS.length);
    expect(cols.every((c) => c >= 0 && c < SUMMARY_ICONS.length)).toBe(true);
  });
});

describe('realmLabel', () => {
  it('puts the job title beside the realm name', () => {
    expect(realmLabel(1)).toBe('Qi Condensation · Intern');
    expect(realmLabel(10)).toBe('Qi Condensation · Intern');
    expect(realmLabel(11)).toBe('Foundation Establishment · Associate');
    expect(realmLabel(210)).toBe('Tribulation Transcendence · Chairman');
  });

  it('shows Immortal Ascension alone: it has no job title', () => {
    expect(realmLabel(211)).toBe('Immortal Ascension');
    expect(realmLabel(3000)).toBe('Immortal Ascension');
  });
});

describe('realmRows', () => {
  it('lists every realm in order with its job title and levels', () => {
    expect(realmRows(1).map((r) => [r.name, r.title, r.levels])).toEqual([
      ['Qi Condensation', 'Intern', 'Lv 1–10'],
      ['Foundation Establishment', 'Associate', 'Lv 11–20 · +1% main stat'],
      ['Golden Core', 'Team Lead', 'Lv 21–40 · +2.6% main stat'],
      ['Nascent Soul', 'Manager', 'Lv 41–60 · +4.9% main stat'],
      ['Spirit Transformation', 'Senior Manager', 'Lv 61–80 · +7.8% main stat'],
      ['Void Refinement', 'Director', 'Lv 81–110 · +11.2% main stat'],
      ['Body Integration', 'VP', 'Lv 111–140 · +15.4% main stat'],
      ['Mahayana', 'CEO', 'Lv 141–170 · +20.1% main stat'],
      ['Tribulation Transcendence', 'Chairman', 'Lv 171–210 · +25.5% main stat'],
      ['Immortal Ascension', '', 'Lv 211+ · +31.5% main stat'],
    ]);
  });

  it('names the main-stat boost on every realm but the first', () => {
    const rows = realmRows(1);
    expect(rows[0]?.levels).toBe('Lv 1–10');
    expect(rows[0]?.levels).not.toContain('main stat');
    expect(rows[1]?.levels).toContain('+1% main stat');
    expect(rows[9]?.levels).toBe('Lv 211+ · +31.5% main stat');
  });
});

describe('realm boost on the Stats tab', () => {
  /** A Sword cultivator at `level` with `agility` base points. */
  function sword(level: number, agility: number): Cultivator {
    const c = newGame(1, 'sword').cultivator;
    return { ...c, level, stats: { ...c.stats, agility } };
  }

  it('shows what the realms add to the main stat only, apart from its base', () => {
    const c = sword(47, 146);
    // Nascent Soul: +4.875% of 146.
    expect(realmBoost(c, 'agility')).toBe('+7.1');
    expect(realmBoost(c, 'body')).toBe('');
    expect(realmBoost(c, 'spirit')).toBe('');
  });

  it('shows nothing in the first realm', () => {
    expect(realmBoost(sword(10, 146), 'agility')).toBe('');
  });

  it('gives a sum that adds up as shown, whatever the rounding', () => {
    for (let agility = 5; agility < 2000; agility += 7) {
      for (const level of [11, 21, 47, 100, 211]) {
        const c = sword(level, agility);
        const m = /\((\d+) \+ ([\d.]+) = ([\d.]+)\)/.exec(realmBoostTip(c, 'agility'));
        expect(m).not.toBeNull();
        const [, base, boost, total] = (m as RegExpExecArray).map(Number);
        expect(Number(((base as number) + (boost as number)).toFixed(1))).toBe(total);
        expect(realmBoost(c, 'agility')).toBe(boost === 0 ? '' : `+${boost}`);
      }
    }
  });

  it('names the realm and gives the sum in the tip', () => {
    expect(realmBoostTip(sword(47, 146), 'agility')).toBe(
      'Bonus from your realm: Nascent Soul (146 + 7.1 = 153.1)',
    );
    expect(realmBoostTip(sword(211, 200), 'agility')).toBe(
      'Bonus from your realm: Immortal Ascension (200 + 63 = 263)',
    );
  });

  it('marks only the realm the level is in as current, at both edges of a realm', () => {
    const current = (level: number): number[] =>
      realmRows(level).flatMap((r, i) => (r.current ? [i] : []));
    expect(current(1)).toEqual([0]);
    expect(current(10)).toEqual([0]);
    expect(current(11)).toEqual([1]);
    expect(current(20)).toEqual([1]);
    expect(current(21)).toEqual([2]);
    expect(current(80)).toEqual([4]);
    expect(current(81)).toEqual([5]);
    expect(current(210)).toEqual([8]);
    expect(current(211)).toEqual([9]);
    expect(current(3000)).toEqual([9]);
  });
});

describe('xpBar', () => {
  it('shows the level and XP to the next level', () => {
    const c = newCultivator('sword');
    c.xp = 37;
    expect(xpBar(c)).toEqual({
      level: 'Lv 1',
      percent: (37 / xpToNext(1)) * 100,
      text: `37 / ${xpToNext(1)}`,
      spoken: `Level 1, 37 of ${xpToNext(1)} XP to the next level`,
    });
  });

  it('is full and says so when a Tribulation is due at a cap', () => {
    const c = newCultivator('sword');
    c.level = 10;
    c.xp = xpToNext(10) + 80;
    expect(xpBar(c)).toEqual({
      level: 'Lv 10',
      percent: 100,
      text: 'Tribulation due',
      spoken: 'Level 10, Tribulation due',
    });
  });

  it('keeps the bar between empty and full', () => {
    const c = newCultivator('sword');
    c.level = 10;
    c.xp = 5.7;
    expect(xpBar(c).text).toBe(`5 / ${xpToNext(10)}`);
    c.level = 11;
    c.xp = xpToNext(11) * 3;
    expect(xpBar(c).percent).toBe(100);
    c.xp = -20;
    expect(xpBar(c).percent).toBe(0);
  });
});

/** A fresh game held at `level` with the Tribulation due (queued at the floor's end). */
function dueAt(level: number): GameState {
  const s = newGame(1, 'sword');
  s.cultivator.level = level;
  s.cultivator.xp = xpToNext(level);
  s.enemies.push(makeTribulation(1, realmOf(level)));
  return s;
}

describe('characterStatusLabel', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  /** A fresh game on floor 12, facing an enemy of `kind` first. */
  function facing(kind: 'demon' | 'elite' | 'boss'): GameState {
    const s = newGame(1, 'sword');
    s.floor = 12;
    s.enemies = [makeEnemy(12, kind, 'Foe')];
    return s;
  }

  it('follows the state, in English', () => {
    expect(characterStatusLabel(facing('demon'))).toBe('Cultivating · floor 12');
    expect(characterStatusLabel(facing('elite'))).toBe('Fighting an elite · floor 12');
    expect(characterStatusLabel(facing('boss'))).toBe('Fighting floor 12 boss');
    const due = dueAt(10);
    expect(characterStatusLabel(due)).toBe('Tribulation due');
    expect(characterStatusLabel(faceTribulation(due))).toBe('Facing Tribulation');
    expect(characterStatusLabel(pausedAt(10))).toBe('Tribulation paused');
    expect(characterStatusLabel(faceTribulation(pausedAt(10)))).toBe('Facing Tribulation');
  });

  it('follows the language', () => {
    const due = dueAt(10);
    const s = facing('boss');
    expect(characterStatusLabel(s)).toBe('Fighting floor 12 boss');
    setLang('vi');
    expect(characterStatusLabel(facing('demon'))).toBe('Đang tu luyện · tầng 12');
    expect(characterStatusLabel(facing('elite'))).toBe('Đang đánh tinh anh · tầng 12');
    expect(characterStatusLabel(s)).toBe('Đang đánh trùm tầng 12');
    expect(characterStatusLabel(due)).toBe('Sắp độ kiếp');
    expect(characterStatusLabel(faceTribulation(due))).toBe('Đang độ kiếp');
    setLang('en');
    expect(characterStatusLabel(s)).toBe('Fighting floor 12 boss');
  });
});

describe('tribulationCall', () => {
  it('names the due Tribulation and the realm a win reaches', () => {
    expect(tribulationCall(dueAt(10))).toEqual({
      name: 'Probation Review',
      next: 'Foundation Establishment',
    });
    expect(tribulationCall(dueAt(210))).toEqual({
      name: 'Heavenly Audit',
      next: 'Immortal Ascension',
    });
  });

  it('is null before the cap, short of the XP, and once the fight is on', () => {
    expect(tribulationCall(newGame(1, 'sword'))).toBeNull();
    const short = dueAt(10);
    short.cultivator.xp -= 1;
    expect(tribulationCall(short)).toBeNull();
    expect(tribulationCall(faceTribulation(dueAt(10)))).toBeNull();
  });
});

describe('tribulationBanner', () => {
  it('announces the fight beginning, whether clicked or reached', () => {
    const due = dueAt(10);
    expect(tribulationBanner(due, faceTribulation(due))).toBe(
      'Tribulation begins: Probation Review',
    );
    const reached = structuredClone(due);
    reached.enemies = reached.enemies.slice(-1);
    expect(tribulationBanner(due, reached)).toBe('Tribulation begins: Probation Review');
  });

  it('announces a win as a breakthrough into the next realm', () => {
    const fighting = faceTribulation(dueAt(10));
    const won = structuredClone(fighting);
    won.cultivator.level = 11;
    won.kills += 1;
    won.enemies.shift();
    expect(tribulationBanner(fighting, won)).toBe('Breakthrough! Foundation Establishment');
  });

  it('says the floor replays after a loss', () => {
    const fighting = faceTribulation(dueAt(10));
    const lost = dueAt(10);
    lost.deaths = fighting.deaths + 1;
    expect(tribulationBanner(fighting, lost)).toBe('Probation Review stands. The floor replays.');
  });

  it('announces a Tribulation falling due', () => {
    const before = dueAt(10);
    before.cultivator.xp -= 1;
    expect(tribulationBanner(before, dueAt(10))).toBe('Tribulation due: Probation Review');
  });

  it('stays quiet through an ordinary fight', () => {
    const s = newGame(1, 'sword');
    expect(tribulationBanner(s, tick(s, 30))).toBeNull();
    const due = dueAt(10);
    expect(tribulationBanner(due, due)).toBeNull();
  });
});

describe('Formation Discs', () => {
  const disc = (array: Item['array'], baseRoll = 0.5): Item => ({
    slot: 'attachment',
    name: 'Jade Formation Disc',
    level: 12,
    grade: 'earth',
    baseRoll,
    affixes: [{ id: 'maxHp', roll: 1 }],
    array,
  });

  it('shows the array and its effect in place of a base stat', () => {
    expect(itemLines(disc('binding'))).toEqual([
      "Binding Array: the enemy's first attack comes 1.75 s later",
      '+60 Max HP',
    ]);
    expect(itemLines(disc('illusion'))[0]).toBe(
      'Illusion Array: enemy attacks miss 9.5% of the time',
    );
    expect(itemLines(disc('killing', 1))[0]).toBe(
      'Killing Array: the enemy takes 20% of your damage per second',
    );
  });

  it('groups Binding and Illusion with defence, Killing with offence', () => {
    expect(itemLineGroups(disc('binding'))).toEqual([
      {
        kind: 'defence',
        lines: ["Binding Array: the enemy's first attack comes 1.75 s later", '+60 Max HP'],
      },
    ]);
    expect(itemLineGroups(disc('illusion'))[0]?.kind).toBe('defence');
    expect(itemLineGroups(disc('killing')).map((g) => g.kind)).toEqual(['offence', 'defence']);
  });

  /** A run wearing `item`, played until its first kill. */
  function toFirstKill(item: Item | null): [GameState, GameState] {
    let s = newGame(5, 'sword');
    if (item) {
      s = { ...s, inventory: [item] };
      s = equip(s, 0);
    }
    let prev = s;
    while (s.kills === 0) {
      prev = s;
      s = tick(s, 0.5);
    }
    return [prev, s];
  }

  describe('against the equipped Attachment', () => {
    const wearing = (item?: Item): Cultivator => {
      const c = newCultivator('sword');
      if (item) c.equipment.attachment = item;
      return c;
    };
    const texts = (c: Cultivator, item: Item) =>
      compareToEquipped(c, item, 'attachment').filter((l) => / Array/.test(l.text));

    it('shows a stronger or weaker array of the same kind', () => {
      expect(texts(wearing(disc('illusion', 0)), disc('illusion', 1))).toEqual([
        { text: '+3% Illusion Array', better: true, kind: 'defence' },
      ]);
      expect(texts(wearing(disc('binding', 1)), disc('binding', 0))).toEqual([
        { text: '−0.5 s Binding Array', better: false, kind: 'defence' },
      ]);
      expect(texts(wearing(disc('killing')), disc('killing'))).toEqual([]);
    });

    it('shows an array gained and one lost', () => {
      expect(texts(wearing(disc('killing', 0)), disc('illusion', 0))).toEqual([
        { text: '+Illusion Array (8%)', better: true, kind: 'defence' },
        { text: '−Killing Array (15%)', better: false, kind: 'offence' },
      ]);
      expect(texts(wearing(), disc('binding', 0))).toEqual([
        { text: '+Binding Array (1.5 s)', better: true, kind: 'defence' },
      ]);
      const gourd: Item = { ...disc('binding'), name: 'Jade Elixir Gourd' };
      delete gourd.array;
      expect(texts(wearing(disc('binding', 0)), gourd)).toEqual([
        { text: '−Binding Array (1.5 s)', better: false, kind: 'defence' },
      ]);
    });
  });

  it('says the array is set up as each fight starts', () => {
    const [prev, next] = toFirstKill(disc('killing'));
    expect(arraySetUp(prev, next)).toBe('Killing Array set up');
  });

  it('says nothing mid-fight or without a disc', () => {
    const [prev] = toFirstKill(disc('binding'));
    expect(arraySetUp(prev, tick(prev, 0))).toBeNull();
    const [p2, n2] = toFirstKill(null);
    expect(arraySetUp(p2, n2)).toBeNull();
  });

  it('says it for a Tribulation faced early', () => {
    let s = newGame(5, 'sword');
    s = equip({ ...s, inventory: [disc('illusion')] }, 0);
    s = { ...s, cultivator: { ...s.cultivator, level: 10, xp: xpToNext(10) } };
    expect(arraySetUp(s, faceTribulation(s))).toBe('Illusion Array set up');
  });
});

describe('tribulationFellDue', () => {
  it('is true only on the step a Tribulation becomes due', () => {
    const short = dueAt(10);
    short.cultivator.xp -= 1;
    const due = dueAt(10);
    expect(tribulationFellDue(short, due)).toBe(true);
    expect(tribulationFellDue(due, due)).toBe(false);
    expect(tribulationFellDue(due, short)).toBe(false);
    expect(tribulationFellDue(short, short)).toBe(false);
  });

  it('is true when it is reached straight into the fight (the boss kill made it due)', () => {
    const short = dueAt(10);
    short.cultivator.xp -= 1;
    expect(tribulationFellDue(short, faceTribulation(dueAt(10)))).toBe(true);
  });

  it('is false when a lost Tribulation comes round again, so it never repeats', () => {
    const fighting = faceTribulation(dueAt(10));
    expect(tribulationFellDue(dueAt(10), fighting)).toBe(false);
    expect(tribulationFellDue(fighting, dueAt(10))).toBe(false);
  });
});

describe('freshDrops', () => {
  it('returns exactly what tick picked up, newest first', () => {
    let s = newGame(21, 'sword');
    let seen = 0;
    for (let i = 0; i < 600 && seen < 3; i++) {
      const next = tick(s, 1);
      const fresh = freshDrops(s, next);
      expect([...fresh].reverse()).toEqual(next.inventory.slice(s.inventory.length));
      // tick only appends: the old bag is untouched at the front.
      expect(next.inventory.slice(0, s.inventory.length)).toEqual(s.inventory);
      seen += fresh.length;
      s = next;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('cellLabel', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  it('names the item with its grade, slot and level in words', () => {
    expect(cellLabel(stapler)).toBe('Golden Crow Flying Sword, Heaven · Weapon · Lv 10');
  });

  it('adds the refine level to the name, and nothing at +0', () => {
    expect(cellLabel({ ...stapler, refines: 7 })).toBe(
      'Golden Crow Flying Sword +7, Heaven · Weapon · Lv 10',
    );
    expect(cellLabel({ ...stapler, refines: 7 }, 'up')).toBe(
      'Golden Crow Flying Sword +7, Heaven · Weapon · Lv 10, upgrade',
    );
    expect(cellLabel({ ...stapler, refines: 0 })).toBe(cellLabel(stapler));
  });

  it('adds "upgrade" or "downgrade" only when that badge shows', () => {
    const tag = 'Golden Crow Flying Sword, Heaven · Weapon · Lv 10';
    expect(cellLabel(stapler, 'up')).toBe(`${tag}, upgrade`);
    expect(cellLabel(stapler, 'down')).toBe(`${tag}, downgrade`);
    expect(cellLabel(stapler, 'mixed')).toBe(`${tag}, mixed`);
    expect(cellLabel(stapler, null)).toBe(tag);
    expect(cellLabel(stapler)).toBe(tag);
  });

  it('labels quality, the refine level and the upgrade in Vietnamese', () => {
    setLang('vi');
    expect(itemTag(stapler)).toMatch(/ · Cấp 10$/);
    expect(qualityLine(stapler)).toBe('Chất lượng 66%');
    expect(cellLabel(stapler)).toMatch(/, .* · Cấp 10$/);
    expect(cellLabel({ ...stapler, refines: 3 })).toMatch(/^\S.* \+3, /);
    expect(cellLabel(stapler, 'up')).toMatch(/ · Cấp 10, nâng cấp$/);
    expect(cellLabel(stapler, 'down')).toMatch(/ · Cấp 10, hạ cấp$/);
    expect(cellLabel(stapler, 'mixed')).toMatch(/ · Cấp 10, được mất$/);
    expect(cellLabel(stapler, null)).toMatch(/ · Cấp 10$/);
  });

  it('has no quality helper line in any language', () => {
    for (const pack of PACKS) expect(Object.hasOwn(pack.messages, 'item.qualityHint')).toBe(false);
  });

  it('keeps the sort option as "Quality %" / "Chất lượng %"', () => {
    expect(t('sort.quality')).toBe('Quality %');
    setLang('vi');
    expect(t('sort.quality')).toBe('Chất lượng %');
  });

  it.each(['<img src=x onerror=alert(1)>\u202e\u200b', '__proto__', 'constructor', '{tag}{name}'])(
    'passes a hostile item name through as plain text, never expanded: %s',
    (name) => {
      for (const lang of ['en', 'vi']) {
        setLang(lang);
        for (const v of ['up', 'down', 'mixed'] as const) {
          const label = cellLabel({ ...stapler, name }, v);
          expect(label.startsWith(`${name}, `)).toBe(true);
          expect(label).toMatch(/, (upgrade|nâng cấp|downgrade|hạ cấp|mixed|được mất)$/);
          // A name never fills a placeholder: the tag appears exactly once.
          expect(label.split(itemTag(stapler))).toHaveLength(2);
        }
      }
    },
  );
});

describe('gear badge', () => {
  const c0 = (): Cultivator => newCultivator('sword');
  const sword = (baseRoll: number, affixes: Item['affixes'] = []): Item => ({
    slot: 'weapon',
    name: 'Iron Flying Sword',
    level: 5,
    grade: 'mortal',
    baseRoll,
    affixes,
  });
  const charm = (baseRoll: number): Item => ({
    slot: 'charm',
    name: 'Laminated Seal',
    level: 1,
    grade: 'mortal',
    baseRoll,
    affixes: [],
  });
  const acc = (baseRoll: number): Item => ({
    slot: 'accessory',
    name: 'Lanyard Pendant',
    level: 1,
    grade: 'mortal',
    baseRoll,
    affixes: [],
  });
  const disc = (array: Item['array'], baseRoll: number): Item => ({
    slot: 'attachment',
    name: 'Bronze Formation Disc',
    level: 1,
    grade: 'mortal',
    baseRoll,
    affixes: [],
    array,
  });

  it('reads a comparison: all gains up, all losses down, both mixed, empty none', () => {
    expect(verdictOf([])).toBeNull();
    expect(verdictOf([{ better: true }, { better: true }])).toBe('up');
    expect(verdictOf([{ better: false }, { better: false }])).toBe('down');
    expect(verdictOf([{ better: true }, { better: false }])).toBe('mixed');
  });

  it('all gains: ▲', () => {
    const c = c0();
    c.equipment.weapon = sword(0);
    expect(gearVerdict(c, sword(1))).toBe('up');
  });

  it('strict downgrade (all losses): ▼', () => {
    const c = c0();
    c.equipment.weapon = sword(1);
    expect(compareToEquipped(c, sword(0), 'weapon').every((l) => !l.better)).toBe(true);
    expect(gearVerdict(c, sword(0))).toBe('down');
  });

  it('mixed gains and losses in one position: the dash', () => {
    const c = c0();
    c.equipment.weapon = sword(0, [{ id: 'maxHp', roll: 1 }]);
    const item = sword(1, [{ id: 'critChance', roll: 1 }]);
    const lines = compareToEquipped(c, item, 'weapon');
    expect(lines.some((l) => l.better) && lines.some((l) => !l.better)).toBe(true);
    expect(gearVerdict(c, item)).toBe('mixed');
  });

  it('no change: none', () => {
    const c = c0();
    c.equipment.weapon = sword(1);
    expect(compareToEquipped(c, sword(1), 'weapon')).toEqual([]);
    expect(gearVerdict(c, sword(1))).toBeNull();
  });

  it('empty position: ▲ for any item, never ▼', () => {
    expect(gearVerdict(c0(), sword(0))).toBe('up');
  });

  it('a Formation Disc of the same array: stronger ▲, weaker ▼', () => {
    const c = c0();
    c.equipment.attachment = disc('killing', 0);
    expect(gearVerdict(c, disc('killing', 1))).toBe('up');
    c.equipment.attachment = disc('killing', 1);
    expect(gearVerdict(c, disc('killing', 0))).toBe('down');
  });

  it('a Formation Disc of a different array type (one gain, one loss): the dash', () => {
    const c = c0();
    c.equipment.attachment = disc('killing', 1);
    expect(gearVerdict(c, disc('binding', 0))).toBe('mixed');
    expect(gearVerdict(c, disc('binding', 1))).toBe('mixed');
  });

  it('two positions: a downgrade in one and the other empty: ▲', () => {
    const c = c0();
    c.equipment.charm1 = charm(1);
    expect(verdictOf(compareToEquipped(c, charm(0), 'charm1'))).toBe('down');
    expect(gearVerdict(c, charm(0))).toBe('up');
  });

  it('two positions: a downgrade in both: ▼', () => {
    const c = c0();
    c.equipment.charm1 = charm(1);
    c.equipment.charm2 = charm(0.8);
    expect(gearVerdict(c, charm(0))).toBe('down');
    c.equipment.accessory1 = acc(1);
    c.equipment.accessory2 = acc(0.8);
    expect(gearVerdict(c, acc(0))).toBe('down');
  });

  it('two positions: an upgrade in one and a downgrade in the other: ▲', () => {
    const c = c0();
    c.equipment.charm1 = charm(0);
    c.equipment.charm2 = charm(1);
    const mid = charm(0.5);
    expect(verdictOf(compareToEquipped(c, mid, 'charm1'))).toBe('up');
    expect(verdictOf(compareToEquipped(c, mid, 'charm2'))).toBe('down');
    expect(gearVerdict(c, mid)).toBe('up');
    c.equipment.accessory1 = acc(0);
    c.equipment.accessory2 = acc(1);
    expect(gearVerdict(c, acc(0.5))).toBe('up');
  });

  it('two positions: a downgrade in one and no change in the other: the dash', () => {
    const c = c0();
    c.equipment.charm1 = charm(1);
    c.equipment.charm2 = charm(0);
    expect(gearVerdict(c, charm(0))).toBe('mixed');
  });

  it('two positions: no change in either: none', () => {
    const c = c0();
    c.equipment.charm1 = charm(0.5);
    c.equipment.charm2 = charm(0.5);
    expect(gearVerdict(c, charm(0.5))).toBeNull();
  });

  const mixedAcc = (crit: number, hp: number): Item => ({
    ...acc(0),
    grade: 'spirit',
    name: 'Azure Soul-Scattering Bell',
    affixes: [
      { id: 'critChance', roll: crit },
      { id: 'maxHp', roll: hp },
    ],
  });

  it('two positions: mixed in one and a downgrade in the other: the dash', () => {
    const c = c0();
    c.equipment.accessory1 = mixedAcc(0, 1);
    c.equipment.accessory2 = mixedAcc(1, 1);
    const item = mixedAcc(1, 0);
    expect(verdictOf(compareToEquipped(c, item, 'accessory1'))).toBe('mixed');
    expect(verdictOf(compareToEquipped(c, item, 'accessory2'))).toBe('down');
    expect(gearVerdict(c, item)).toBe('mixed');
  });

  it('two positions: an upgrade in one and mixed in the other: ▲', () => {
    const c = c0();
    c.equipment.accessory1 = mixedAcc(0, 0);
    c.equipment.accessory2 = mixedAcc(0, 1);
    const item = mixedAcc(1, 0);
    expect(verdictOf(compareToEquipped(c, item, 'accessory1'))).toBe('up');
    expect(verdictOf(compareToEquipped(c, item, 'accessory2'))).toBe('mixed');
    expect(gearVerdict(c, item)).toBe('up');
  });

  it('an item below its realm requirement: none, even over an empty or better position', () => {
    const c = c0();
    const relic: Item = { ...stapler, level: 1 };
    expect(equipBlock(c, relic)).not.toBeNull();
    expect(gearVerdict(c, relic)).toBeNull();
    c.equipment.weapon = { ...stapler, level: 1, baseRoll: 0 };
    expect(gearVerdict(c, relic)).toBeNull();
    expect(gearVerdict(c, { ...relic, baseRoll: 0, affixes: [] })).toBeNull();
    expect(gearVerdict({ ...c, level: 11 }, relic)).toBe('up');
  });

  it('an equipped item compared with itself: none', () => {
    const c = c0();
    c.equipment.weapon = stapler;
    c.level = 11;
    expect(gearVerdict(c, stapler)).toBeNull();
  });

  it('agrees with the details comparison, given a precomputed derive()', () => {
    const c = c0();
    c.equipment.weapon = sword(0.5);
    const now = derive(c);
    for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
      const item = sword(roll);
      expect(gearVerdict(c, item, now)).toBe(verdictOf(compareToEquipped(c, item, 'weapon')));
      expect(compareToEquipped(c, item, 'weapon', now)).toEqual(
        compareToEquipped(c, item, 'weapon'),
      );
    }
  });

  it('never badges an item whose rolls are not numbers (a save that slipped a check)', () => {
    const c = c0();
    c.equipment.weapon = stapler;
    c.level = 11;
    const broken = { ...stapler, baseRoll: Number.NaN };
    expect(gearVerdict(c, broken)).toBeNull();
    expect(compareToEquipped(c, broken, 'weapon').map((l) => l.text)).not.toContain(
      expect.stringMatching(/NaN/),
    );
  });
});

describe('inventory pages', () => {
  it('holds the starting bag on one page', () => {
    expect(BAG_PAGE).toBe(INVENTORY_SIZE);
    expect(bagPages(INVENTORY_SIZE)).toBe(1);
  });

  it('puts bought slots on a second page, up to the largest bag', () => {
    expect(bagPages(INVENTORY_SIZE + BAG_ROW)).toBe(2);
    expect(bagPages(MAX_BAG_SIZE)).toBe(Math.ceil(MAX_BAG_SIZE / BAG_PAGE));
    expect(bagPages(MAX_BAG_SIZE)).toBe(2);
  });

  it('never has fewer than one page', () => {
    expect(bagPages(0)).toBe(1);
  });

  it('pads a short last page with fillers to a full page', () => {
    expect(bagPage(INVENTORY_SIZE + BAG_ROW, 1)).toEqual({
      start: BAG_PAGE,
      cells: BAG_ROW,
      fillers: BAG_PAGE - BAG_ROW,
      pages: 2,
    });
  });

  it('fills every full page with real cells only', () => {
    expect(bagPage(INVENTORY_SIZE, 0)).toEqual({
      start: 0,
      cells: BAG_PAGE,
      fillers: 0,
      pages: 1,
    });
    expect(bagPage(MAX_BAG_SIZE, 0).fillers).toBe(0);
    expect(bagPage(MAX_BAG_SIZE, 1)).toEqual({
      start: BAG_PAGE,
      cells: MAX_BAG_SIZE - BAG_PAGE,
      fillers: 2 * BAG_PAGE - MAX_BAG_SIZE,
      pages: 2,
    });
  });

  it('shows the same footprint on every page whatever the bag size', () => {
    for (let size = INVENTORY_SIZE; size <= MAX_BAG_SIZE; size += BAG_ROW) {
      for (let page = 0; page < bagPages(size); page++) {
        const p = bagPage(size, page);
        expect(p.cells + p.fillers).toBe(BAG_PAGE);
        expect(p.cells).toBeGreaterThan(0);
      }
    }
  });

  it('finds the page of a cell', () => {
    expect(pageOf(0)).toBe(0);
    expect(pageOf(BAG_PAGE - 1)).toBe(0);
    expect(pageOf(BAG_PAGE)).toBe(1);
    expect(pageOf(MAX_BAG_SIZE - 1)).toBe(1);
  });
});

describe('gridMove', () => {
  const move = (i: number, key: string) => gridMove(i, key, 40, 8);

  it('moves one cell or one row', () => {
    expect(move(9, 'ArrowLeft')).toBe(8);
    expect(move(9, 'ArrowRight')).toBe(10);
    expect(move(9, 'ArrowUp')).toBe(1);
    expect(move(9, 'ArrowDown')).toBe(17);
  });

  it('stays put at every edge instead of wrapping', () => {
    expect(move(8, 'ArrowLeft')).toBe(8);
    expect(move(15, 'ArrowRight')).toBe(15);
    expect(move(3, 'ArrowUp')).toBe(3);
    expect(move(35, 'ArrowDown')).toBe(35);
    expect(move(39, 'ArrowRight')).toBe(39);
  });

  it('jumps to the ends of the row', () => {
    expect(move(11, 'Home')).toBe(8);
    expect(move(11, 'End')).toBe(15);
    expect(gridMove(17, 'End', 18, 8)).toBe(17);
  });

  it('ignores other keys', () => {
    expect(move(5, 'Enter')).toBeNull();
  });
});

describe('durationLabel', () => {
  it.each([
    [0, '0 s'],
    [59.9, '59 s'],
    [60, '1 min'],
    [3599, '59 min'],
    [3600, '1 h 0 min'],
    [8 * 3600, '8 h 0 min'],
    [2 * 3600 + 5 * 60 + 30, '2 h 5 min'],
  ])('shows %s seconds as %s', (seconds, text) => {
    expect(durationLabel(seconds)).toBe(text);
  });
});

describe('overtimeView', () => {
  const summary = {
    seconds: 7500,
    capped: false,
    floorsClimbed: 3,
    levels: 4,
    kills: 120,
    dropsKept: 9,
    dropsSold: 0,
    dropsSalvaged: 0,
    stones: 450,
    essence: 0,
    boostsEnded: [],
  };
  const text = (v: ReturnType<typeof overtimeView>): string[] =>
    v.chips.map((c) => `${c.label} ${c.value}`);

  it('shows the time away, a chip per count, and the drop-rate note', () => {
    const v = overtimeView(summary);
    expect(v.away).toBe('Away 2 h 5 min');
    expect(text(v)).toEqual([
      'Floors +3',
      'Levels +4',
      'Kills 120',
      'Kept 9',
      'Spirit Stones +450',
    ]);
    expect(v.chips.find((c) => c.label === 'Spirit Stones')?.icon).toBe('stones');
    expect(v.note).toBe('Drops at 50% while away');
  });

  it('says when the cap cut the time short, and shows drops sold and salvaged', () => {
    const v = overtimeView({
      ...summary,
      seconds: 8 * 3600,
      capped: true,
      dropsSold: 2,
      dropsSalvaged: 3,
      essence: 40,
    });
    expect(v.away).toBe('Away 8 h 0 min+ (cap)');
    expect(text(v).slice(4)).toEqual([
      'Sold 2',
      'Salvaged 3',
      'Spirit Stones +450',
      'Spirit Essence +40',
    ]);
    expect(v.chips.at(-1)?.icon).toBe('essence');
    expect(text(v).join()).not.toMatch(/lost/i);
  });
});

describe('bulkLabel: sell', () => {
  it('names the count, the highest grade and the price', () => {
    expect(bulkLabel('sell', { count: 12, highest: 'spirit', total: 340 })).toBe(
      'Sell 12 items (highest grade: Spirit) for 340 Spirit Stones?',
    );
    expect(bulkLabel('sell', { count: 1, highest: 'mortal', total: 2 })).toBe(
      'Sell 1 item (highest grade: Mortal) for 2 Spirit Stones?',
    );
  });

  it('says when there is nothing to sell', () => {
    expect(bulkLabel('sell', { count: 0, highest: null, total: 0 })).toBe(
      'Nothing to sell below that grade.',
    );
  });

  it('says refined items are kept, only when some are', () => {
    expect(bulkLabel('sell', { count: 2, highest: 'spirit', total: 30, kept: 1 })).toBe(
      'Sell 2 items (highest grade: Spirit) for 30 Spirit Stones? Refined items (+1 or higher) are kept.',
    );
    expect(bulkLabel('sell', { count: 0, highest: null, total: 0, kept: 3 })).toBe(
      'Nothing to sell below that grade. Refined items (+1 or higher) are kept.',
    );
    expect(bulkLabel('sell', { count: 2, highest: 'spirit', total: 30, kept: 0 })).not.toMatch(
      /Refined/,
    );
    setLang('vi');
    expect(bulkLabel('sell', { count: 0, highest: null, total: 0, kept: 1 })).toMatch(
      / Vật phẩm đã tinh luyện \(\+1 trở lên\) được giữ lại\.$/,
    );
    setLang(DEFAULT_LANG);
  });
});

describe('bulkLabel: salvage', () => {
  afterEach(() => setLang(DEFAULT_LANG));
  it('names the count, the highest grade and the Spirit Essence', () => {
    expect(bulkLabel('salvage', { count: 12, highest: 'spirit', total: 40 })).toBe(
      'Salvage 12 items (highest grade: Spirit) for 40 Spirit Essence?',
    );
    expect(bulkLabel('salvage', { count: 1, highest: 'mortal', total: 1 })).toBe(
      'Salvage 1 item (highest grade: Mortal) for 1 Spirit Essence?',
    );
  });

  it('says when there is nothing to salvage, and when refined items are kept', () => {
    expect(bulkLabel('salvage', { count: 0, highest: null, total: 0 })).toBe(
      'Nothing to salvage below that grade.',
    );
    expect(bulkLabel('salvage', { count: 2, highest: 'earth', total: 9, kept: 1 })).toBe(
      'Salvage 2 items (highest grade: Earth) for 9 Spirit Essence? Refined items (+1 or higher) are kept.',
    );
    expect(bulkLabel('salvage', { count: 2, highest: 'earth', total: 9, kept: 0 })).not.toMatch(
      /Refined/,
    );
  });

  it('is translated', () => {
    setLang('vi');
    expect(bulkLabel('salvage', { count: 3, highest: 'spirit', total: 7 })).toBe(
      'Phân giải 3 vật phẩm (phẩm cao nhất: ' + tn('grade', 'Spirit') + ') lấy 7 Tinh Hoa?',
    );
    expect(bulkLabel('salvage', { count: 0, highest: null, total: 0 })).toBe(
      'Không có gì dưới phẩm cấp đó để phân giải.',
    );
  });
});

describe('bulkAsk', () => {
  afterEach(() => setLang(DEFAULT_LANG));
  const preview = (count: number, total = 7) => ({
    count,
    highest: count ? ('spirit' as const) : null,
    total,
    kept: 0,
  });

  it('asks to sell or salvage with its own Yes', () => {
    expect(bulkAsk('sell', preview(2))).toMatchObject({
      text: 'Sell 2 items (highest grade: Spirit) for 7 Spirit Stones?',
      yes: 'Sell',
      no: 'Cancel',
    });
    expect(bulkAsk('salvage', preview(2, 3))).toMatchObject({
      text: 'Salvage 2 items (highest grade: Spirit) for 3 Spirit Essence?',
      yes: 'Salvage',
      no: 'Cancel',
    });
  });

  it('offers only OK when there is nothing to take', () => {
    for (const action of ['sell', 'salvage'] as const) {
      const ask = bulkAsk(action, preview(0, 0));
      expect(ask.yes).toBeNull();
      expect(ask.no).toBe('OK');
      expect(ask.text).toMatch(/^Nothing to (sell|salvage) below that grade\.$/);
    }
  });

  it('is translated', () => {
    setLang('vi');
    expect(bulkAsk('salvage', preview(1))).toMatchObject({ yes: 'Phân giải', no: 'Hủy' });
    expect(bulkAsk('sell', preview(0)).no).toBe('OK');
  });
});

describe('gradeRuns', () => {
  it('splits on the placeholder wherever it sits', () => {
    expect(gradeRuns('{grade} first', 'Earth', 'earth')).toEqual([
      { text: 'Earth', grade: 'earth' },
      { text: ' first' },
    ]);
    expect(gradeRuns('last: {grade}', 'Earth', 'earth')).toEqual([
      { text: 'last: ' },
      { text: 'Earth', grade: 'earth' },
    ]);
  });

  it('names a lost placeholder’s grade in brackets, before the closing marks', () => {
    expect(gradeRuns('Sell 2 items?', 'Earth', 'earth')).toEqual([
      { text: 'Sell 2 items (' },
      { text: 'Earth', grade: 'earth' },
      { text: ')?' },
    ]);
    const joined = (m: string) =>
      gradeRuns(m, 'Earth', 'earth')
        .map((r) => r.text)
        .join('');
    expect(joined('Bán 2 vật phẩm lấy 9 Linh Thạch?')).toBe(
      'Bán 2 vật phẩm lấy 9 Linh Thạch (Earth)?',
    );
    expect(joined('Sell them ?! ')).toBe('Sell them (Earth) ?! ');
    expect(joined('No marks')).toBe('No marks (Earth)');
    expect(joined('全部出售？')).toBe('全部出售 (Earth)？');
    expect(joined('?')).toBe('(Earth)?');
    expect(joined('')).toBe('(Earth)');
    // Exactly one run carries the grade.
    expect(gradeRuns('x?', 'Earth', 'earth').filter((r) => r.grade)).toHaveLength(1);
  });

  it('handles a huge lost-placeholder message in linear time', () => {
    // A long run of closing marks then a letter: a backtracking regex would be quadratic.
    const message = `${'? '.repeat(100_000)}x${' ?'.repeat(100_000)}`;
    const start = performance.now();
    const runs = gradeRuns(message, 'Earth', 'earth');
    expect(performance.now() - start).toBeLessThan(500);
    expect(runs.map((r) => r.text).join('')).toBe(
      `${'? '.repeat(100_000)}x (Earth)${' ?'.repeat(100_000)}`,
    );
  });

  it('keeps a hostile name as plain text in one run', () => {
    const name = '<img src=x onerror=alert(1)>\u202e{grade}';
    const runs = gradeRuns('a {grade} b', name, 'spirit');
    expect(runs.filter((r) => r.grade)).toEqual([{ text: name, grade: 'spirit' }]);
  });
});

describe('tintOf', () => {
  it('tints only an allowed value, exactly', () => {
    expect(tintOf('sell', ['sell', 'salvage'])).toBe('sell');
    expect(tintOf('earth', ['mortal', 'earth'])).toBe('earth');
  });

  it.each([
    ['empty', ''],
    ['prototype key', '__proto__'],
    ['object key', 'constructor'],
    ['case', 'SELL'],
    ['attribute break', "sell'] , *[x='"],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['zero-width', 'sell\u200b'],
    ['bidi override', '\u202esell'],
    ['look-alike', 'ѕell'],
    ['padding', ' sell'],
    ['oversized', 'sell'.repeat(100_000)],
  ])('refuses a tampered select value (%s)', (_, value) => {
    expect(tintOf(value, ['sell', 'salvage'])).toBeNull();
  });
});

describe('bulkParts', () => {
  afterEach(() => setLang(DEFAULT_LANG));
  const p = { count: 3, highest: 'heaven' as const, total: 40, kept: 0 };

  it('puts the highest grade name in its own run, tagged with its grade', () => {
    expect(bulkParts('salvage', p)).toEqual([
      { text: 'Salvage 3 items (highest grade: ' },
      { text: 'Heaven', grade: 'heaven' },
      { text: ') for 40 Spirit Essence?' },
    ]);
    expect(
      bulkParts('sell', p)
        .map((x) => x.text)
        .join(''),
    ).toBe(bulkLabel('sell', p));
  });

  it('follows the language, wherever it puts the grade', () => {
    setLang('vi');
    const parts = bulkParts('sell', { ...p, kept: 1 });
    const graded = parts.filter((x) => x.grade);
    expect(graded).toEqual([{ text: tn('grade', 'Heaven'), grade: 'heaven' }]);
    expect(parts.map((x) => x.text).join('')).toBe(
      `Bán 3 vật phẩm (phẩm cao nhất: ${tn('grade', 'Heaven')}) lấy 40 Linh Thạch? Vật phẩm đã tinh luyện (+1 trở lên) được giữ lại.`,
    );
  });

  it('picks the plural form by the language’s rule', () => {
    expect(bulkLabel('sell', { ...p, count: 1 })).toMatch(/^Sell 1 item \(/);
    setLang('vi');
    // Vietnamese has one form: the {n} message, even for one item.
    expect(bulkLabel('sell', { ...p, count: 1 })).toMatch(/^Bán 1 vật phẩm/);
  });

  it('tags nothing when there is nothing to take', () => {
    const parts = bulkParts('salvage', { count: 0, highest: null, total: 0, kept: 2 });
    expect(parts.some((x) => x.grade)).toBe(false);
    expect(parts.map((x) => x.text).join('')).toMatch(/^Nothing to salvage below that grade\. /);
  });

  it('keeps hostile pack text as plain text runs, with one graded run', () => {
    setLang('vi');
    const hostile = '<script>alert(1)</script>\u202e\u200b{grade}{grade}';
    const parts = gradeRuns(hostile, '__proto__', 'heaven');
    expect(parts.map((x) => x.text).join('')).toBe(
      '<script>alert(1)</script>\u202e\u200b__proto____proto__',
    );
    expect(parts.every((x) => typeof x.text === 'string')).toBe(true);
    expect(parts.filter((x) => x.grade).every((x) => x.grade === 'heaven')).toBe(true);
  });

  it('picks a plural form for huge and odd counts without throwing', () => {
    for (const count of [0.5, 2 ** 53, 1e308]) {
      expect(() => bulkLabel('sell', { ...p, count })).not.toThrow();
    }
  });

  it('never splits on a {grade} that came from a number or a name', () => {
    // Only the message's own placeholder is split on; other params are numbers.
    const parts = bulkParts('sell', { ...p, total: 7 });
    expect(parts.filter((x) => x.grade)).toHaveLength(1);
    expect(parts.map((x) => x.text).join('')).not.toMatch(/\{grade\}/);
  });
});

describe('soulsLine', () => {
  const item = (name: string, grade: Item['grade'] = 'earth'): Item => ({
    slot: 'sideArm',
    name,
    level: 10,
    grade,
    baseRoll: 0.5,
    affixes: [],
  });

  it('shows the worn banner souls, its cap and the damage they add, as text', () => {
    const s = newGame(1, 'talisman');
    const banner = item('Jade Hundred Ghosts Banner');
    s.cultivator.equipment.sideArm = banner;
    s.cultivator.stats.spirit = 67;
    s.souls = 7;
    expect(soulsLine(banner, s)).toBe('7 / 20 (+4.7 damage per attack)');
    s.souls = 0;
    expect(soulsLine(banner, s)).toBe('0 / 20 (+0 damage per attack)');
  });

  it('shows no souls on a banner in the bag', () => {
    const s = newGame(1, 'talisman');
    s.cultivator.equipment.sideArm = item('Jade Hundred Ghosts Banner');
    s.souls = 7;
    const bag = item('Ten-Thousand Souls Banner', 'immortal');
    expect(soulsLine(bag, s)).toMatch(/^0 \/ 30 /);
  });

  it('has no line for any other item', () => {
    const s = newGame(1, 'talisman');
    expect(soulsLine(item('Jade Viper Darts'), s)).toBeNull();
    expect(soulsLine(item('Jade Dragon-Binding Chain'), s)).toBeNull();
    expect(soulsLine({ ...item('Jade Hundred Ghosts Banner'), slot: 'charm' }, s)).toBeNull();
  });
});

describe('favouredBy', () => {
  const item = (slot: Item['slot'], name: string, grade: Item['grade'] = 'earth'): Item => ({
    slot,
    name,
    level: 10,
    grade,
    baseRoll: 0.5,
    affixes: [],
  });

  it.each([
    ['weapon', 'Jade Serpent Flying Sword', 'Sword Cultivator'],
    ['weapon', 'Jade Thread Whisk', 'Talisman Master'],
    ['weapon', 'Hundred-Year Peachwood Sword', 'Sword Cultivator'],
    ['weapon', 'Jade Crane Fan', 'Talisman Master'],
    ['weapon', 'Jade Mountain Seal', 'Body Refiner'],
    ['weapon', 'Jade Demon-Subduing Vajra Pestle', 'Body Refiner'],
    ['sideArm', 'Jade Viper Darts', 'Sword Cultivator'],
    ['sideArm', 'Jade Dragon-Binding Chain', 'Body Refiner'],
    ['sideArm', 'Jade Hundred Ghosts Banner', 'Talisman Master'],
    ['accessory', 'Jade Dragon Pendant', 'Body Refiner'],
    ['accessory', 'Jade Wind Chime', 'Talisman Master'],
    ['accessory', 'Jade Demon-Revealing Mirror', 'Sword Cultivator'],
  ] as const)('names the Path a %s %s leans to', (slot, name, path) => {
    expect(favouredBy(item(slot, name), 'body')?.text).toBe(path);
  });

  it("marks a match only on the player's Path", () => {
    const seal = item('weapon', 'Jade Mountain Seal');
    expect(favouredBy(seal, 'body')?.match).toBe(true);
    expect(favouredBy(seal, 'sword')?.match).toBe(false);
    expect(favouredBy(seal, 'talisman')?.match).toBe(false);
  });

  it('shows nothing on neutral items or an unknown name', () => {
    expect(favouredBy(item('head', 'Jade Lotus Crown'), 'sword')).toBeNull();
    expect(favouredBy(item('attachment', 'Jade Formation Disc'), 'sword')).toBeNull();
    expect(favouredBy(item('charm', 'Jade Vajra Talisman'), 'body')).toBeNull();
    expect(favouredBy(item('weapon', 'Iron Flying Sword', 'earth'), 'sword')).toBeNull();
    expect(favouredBy(item('weapon', '__proto__'), 'sword')).toBeNull();
  });
});

describe('itemFacts', () => {
  afterEach(() => setLang(DEFAULT_LANG));
  const item = (slot: Item['slot'], name: string, grade: Item['grade'] = 'earth'): Item => ({
    slot,
    name,
    level: 7,
    grade,
    baseRoll: 0.5,
    affixes: [],
  });
  const pairs = (facts: ReturnType<typeof itemFacts>) => facts.map((f) => [f.label, f.value]);

  it('labels a weapon by grade, type, level, quality, tier and the Path it favours', () => {
    const s = newGame(1, 'body');
    const seal = item('weapon', 'Jade Mountain Seal');
    expect(pairs(itemFacts(seal, s))).toEqual([
      ['Grade', 'Earth'],
      ['Type', 'Weapon'],
      ['Level', '7'],
      ['Quality', `${qualityLine(seal).replace(/\D/g, '')}%`],
      ['Tier', 'Spirit Treasure'],
      ['Favoured by', 'Body Refiner'],
    ]);
    const tones = Object.fromEntries(itemFacts(seal, s).map((f) => [f.id, f.tone]));
    expect(tones.grade).toBe('grade-earth');
    expect(tones.favouredBy).toBe('up');
    expect(itemFacts(seal, newGame(1, 'sword')).find((f) => f.id === 'favouredBy')?.tone).toBe('');
  });

  it("adds a charm's line and a banner's souls, and leaves out what does not apply", () => {
    const s = newGame(1, 'talisman');
    const ids = (it: Item) => itemFacts(it, s).map((f) => f.id);
    expect(ids(item('charm', 'Jade Vajra Talisman'))).toEqual([
      'grade',
      'type',
      'level',
      'quality',
      'line',
    ]);
    expect(ids(item('head', 'Jade Lotus Crown'))).toEqual(['grade', 'type', 'level', 'quality']);
    const banner = item('sideArm', 'Jade Hundred Ghosts Banner');
    expect(itemFacts(banner, s).at(-1)).toMatchObject({ id: 'souls', label: 'Souls' });
    expect(itemFacts(banner, s).at(-1)?.value).toMatch(/^0 \/ 20 /);
  });

  it('labels in Vietnamese too', () => {
    setLang('vi');
    const labels = itemFacts(item('weapon', 'Jade Mountain Seal'), newGame(1, 'body')).map(
      (f) => f.label,
    );
    expect(labels).toEqual(['Phẩm cấp', 'Loại', 'Cấp', 'Chất lượng', 'Bậc', 'Hợp với']);
  });
});

describe('unequipBlock', () => {
  it('blocks only when the bag is full', () => {
    const s = newGame(1, 'sword');
    expect(unequipBlock(s)).toBeNull();
    const full = { ...s, inventory: Array.from({ length: s.bagSize }, () => stapler) };
    expect(unequipBlock(full)).toMatch(/^Bag is full/);
    expect(unequipBlock({ ...full, inventory: full.inventory.slice(1) })).toBeNull();
  });
});

describe('crafting', () => {
  afterEach(() => setLang(DEFAULT_LANG));
  const sword: Item = { ...stapler, baseRoll: 0.62 };

  it('has Refine and Reroll modes, in that order', () => {
    expect(CRAFT_MODES).toEqual(['refine', 'reroll']);
  });

  it('shows the refine level after the name and on the cell, nothing at +0', () => {
    expect(itemName(sword)).toBe('Golden Crow Flying Sword');
    expect(refineMark(sword)).toBe('');
    expect(itemName({ ...sword, refines: 0 })).toBe('Golden Crow Flying Sword');
    expect(itemName({ ...sword, refines: 7 })).toBe('Golden Crow Flying Sword +7');
    expect(refineMark({ ...sword, refines: 7 })).toBe('+7');
    setLang('vi');
    expect(itemName({ ...sword, refines: 12 })).toMatch(/ \+12$/);
  });

  it('previews a refine as the base roll and its stat, before paying', () => {
    // 8–14 damage at level 10: 62% is 11.7; 63% to 72% is 11.8 to 12.3.
    expect(refinePreview(sword)).toEqual(['Base roll 62% → 63–72%', 'Damage: 11.7 → 11.8–12.3']);
    expect(refinePreview({ ...sword, baseRoll: 0.97 })[0]).toBe('Base roll 97% → 98–100%');
    // One decimal kept, so the range lines up: 13.8 → 13.9–14.0.
    expect(refinePreview({ ...sword, baseRoll: 0.97 })[1]).toBe('Damage: 13.8 → 13.9–14.0');
    expect(refinePreview(stapler)).toEqual([]);
  });

  it('shows one value, not "a–a", when only one is reachable', () => {
    // 99% can only become 100%: 8–14 damage at level 10 tops out at 14.0.
    expect(refinePreview({ ...sword, baseRoll: 0.99 })).toEqual([
      'Base roll 99% → 100%',
      'Damage: 13.9 → 14.0',
    ]);
    // A range whose ends round to one amount is shown once too.
    // A level 1 head's defence: 51% to 60% all round to 0.3.
    const tiny: Item = {
      ...sword,
      slot: 'head',
      level: 1,
      grade: 'mortal',
      affixes: [],
      baseRoll: 0.5,
    };
    expect(refinePreview(tiny)).toEqual(['Base roll 50% → 51–60%', 'Defence: 0.3 → 0.3']);
  });

  it('previews a disc refine as its array strength', () => {
    const disc: Item = {
      slot: 'attachment',
      name: 'Bronze Formation Disc',
      level: 1,
      grade: 'mortal',
      baseRoll: 0,
      affixes: [],
      array: 'illusion',
    };
    const [roll, stat] = refinePreview(disc);
    expect(roll).toBe('Base roll 0% → 1–10%');
    expect(stat).toMatch(/^Illusion Array: [\d.]+% → [\d.]+%–[\d.]+%$/);
  });

  it('prices the actions in Spirit Essence and says what is missing', () => {
    const cost = refineCost(sword);
    expect(refineAction(sword, cost)).toEqual({
      cost: `${cost} Spirit Essence`,
      off: false,
      why: '',
    });
    expect(refineAction(sword, cost - 5)).toEqual({
      cost: `${cost} Spirit Essence`,
      off: true,
      why: 'Need 5 more',
    });
    // The button reads "Fully refined"; `why` stays empty so it is not said twice.
    expect(refineAction(stapler, 1e9)).toEqual({ cost: '', off: true, why: '' });
    const r = rerollCost(sword);
    expect(rerollAction(sword, r - 1)).toMatchObject({ off: true, why: 'Need 1 more' });
    expect(rerollAction(sword, r)).toMatchObject({ off: false, cost: `${r} Spirit Essence` });
    expect(rerollAction({ ...sword, affixes: [] }, 1e9)).toEqual({
      cost: '',
      off: true,
      why: 'No affixes to reroll',
    });
  });

  it('says it in Vietnamese', () => {
    setLang('vi');
    expect(refineAction(stapler, 0)).toEqual({ cost: '', off: true, why: '' });
    expect(t('craft.refineMax')).toBe('Đã tinh luyện tối đa');
    expect(refinePreview({ ...sword, baseRoll: 0.99 })[0]).toBe('Độ tung gốc 99% → 100%');
    expect(refineAction(sword, 0)).toMatchObject({ cost: `${refineCost(sword)} Tinh Hoa` });
    expect(rerollAction({ ...sword, affixes: [] }, 0).why).toBe(
      'Không có thuộc tính phụ để tẩy luyện',
    );
    expect(refinePreview(sword)[0]).toBe('Độ tung gốc 62% → 63–72%');
  });

  it('writes the result lines and the reroll confirmation', () => {
    expect(refineResult(sword, { ...sword, baseRoll: 0.69 })).toBe('Base roll 62% → 69%');
    const after: Item = { ...sword, affixes: [sword.affixes[0]!, { id: 'stoneFind', roll: 1 }] };
    expect(affixText(sword, 1)).toBe('+50 Max HP');
    expect(rerollResult(sword, after, 1)).toMatch(/^\+50 Max HP → \+[\d.]+% Spirit stone find$/);
    expect(rerollConfirm(sword, 0)).toBe(
      'Reroll +0.7% Crit chance? It is replaced for good by a random affix and roll.',
    );
    expect(affixText(sword, 9)).toBe('');
  });
});

describe('the store', () => {
  /** A synced game on floor 20 at level 10, with `stones` and offer `id` first on show. */
  function shop(id: OfferId, stones = 1_000_000): GameState {
    const s = syncStore(newGame(1, 'sword'));
    s.floor = s.highestFloor = 20;
    s.cultivator.level = 10;
    s.stones = stones;
    s.store.offers = [id, ...OFFER_IDS.filter((o) => o !== id).slice(0, 3)];
    s.store.sold = [false, false, false, false];
    return s;
  }

  it('orders the chests best grade first, whatever order they rolled in', () => {
    expect(chestOrder(['chest-spirit', 'boost-xp', 'chest-heaven', 'chest-earth'])).toEqual([
      2, 3, 0,
    ]);
    expect(chestOrder(['boost-xp', 'chest-earth', 'boost-stones', 'chest-heaven'])).toEqual([3, 1]);
    expect(chestOrder(['boost-xp', 'boost-treasure', 'boost-stones', ''])).toEqual([]);
    // The roll in the ticket: Spirit, Heaven, Earth shows Heaven, Earth, Spirit.
    expect(chestOrder(['chest-spirit', 'chest-heaven', 'chest-earth'])).toEqual([1, 2, 0]);
    // Two chests of one grade keep their stock order.
    expect(chestOrder(['chest-earth', 'chest-earth', 'chest-heaven'])).toEqual([2, 0, 1]);
  });

  it('maps every offer to its own atlas column', () => {
    expect(STORE_ICONS.map(storeIcon)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('shows a chest with its grade, level, price and Buy', () => {
    const card = offerCard(shop('chest-earth'), 0);
    expect(card).toMatchObject({
      name: 'Earth Chest',
      grade: 'earth',
      desc: 'One Lv 20 item, Earth or better',
      buy: 'Buy · 900',
      off: false,
      why: '',
    });
    expect(card.buyName).toBe('Buy · 900: Earth Chest for 900 Spirit Stones');
  });

  it('names a chest and its grade in office words in Discreet mode', () => {
    setDiscreet(true);
    try {
      const card = offerCard(shop('chest-earth'), 0);
      expect(card.name).toBe('Pro Bundle');
      expect(card.desc).toBe('One Lv 20 item, Pro or better');
    } finally {
      setDiscreet(false);
    }
  });

  it('says what is short, sold out, a full bag or a boost at its cap', () => {
    expect(offerCard(shop('chest-earth', 850), 0)).toMatchObject({
      off: true,
      why: 'Need 50 more',
    });
    const sold = shop('boost-xp');
    sold.store.sold[0] = true;
    expect(offerCard(sold, 0)).toMatchObject({ buy: 'Sold out', off: true, why: '' });
    const full = shop('chest-spirit');
    full.bagSize = 0;
    expect(offerCard(full, 0)).toMatchObject({ buy: 'Bag full', off: true });
    const capped = shop('boost-treasure');
    capped.boosts.treasure = capped.time + 3600;
    expect(offerCard(capped, 0)).toMatchObject({ buy: 'At the 1 h cap', off: true });
    expect(offerCard(capped, 0).desc).toBe('+50% treasure find for 10 min · 1 h 0 min left');
  });

  it('names a boost and what it does', () => {
    expect(offerName('boost-stones')).toBe('Bonus Envelope');
    expect(offerCard(shop('boost-xp'), 0)).toMatchObject({
      name: 'Focus Tea',
      grade: null,
      desc: '+50% XP from kills for 10 min',
      buy: 'Buy · 200',
    });
  });

  it('counts down to the next rotation, and prices Refresh now', () => {
    const s = shop('boost-xp', 499);
    expect(storeCountdown(s)).toBe('New stock in 30 min');
    expect(refreshView(s)).toEqual({ text: 'Refresh now · 500', off: true, why: 'Need 1 more' });
    expect(refreshView({ ...s, stones: 500 }).off).toBe(false);
  });

  it('adds running stone and treasure boosts to the Stats find rows', () => {
    const c = newCultivator('sword');
    const value = (rows: ReturnType<typeof statRows>, label: string) =>
      rows.find((r) => r.label === label)?.value;
    const plain = statRows(c);
    const boosted = statRows(c, noPassives(), { stoneFind: 0.5, treasureFind: 0.5 });
    expect(value(plain, 'Spirit stone find')).toBe('0%');
    expect(value(boosted, 'Spirit stone find')).toBe('50%');
    expect(value(boosted, 'Treasure find')).toBe('50%');
  });

  it('gives a chip value only for a boost that is running', () => {
    const s = shop('boost-xp');
    expect(boostChip(s, 'xp')).toBeNull();
    s.boosts.xp = s.time + 545;
    s.boosts.treasure = s.time;
    expect(boostChip(s, 'xp')).toEqual({
      bonus: '+50%',
      word: 'XP',
      full: 'Focus Tea (+50% XP): 9 min left',
    });
    expect(boostChip(s, 'treasure')).toBeNull();
  });

  it('names each boost short on its chip', () => {
    const s = shop('boost-xp');
    for (const id of ['xp', 'treasure', 'stones'] as const) s.boosts[id] = s.time + 60;
    expect(['xp', 'treasure', 'stones'].map((id) => boostChip(s, id as 'xp')?.word)).toEqual([
      'XP',
      'drops',
      'stones',
    ]);
  });

  it('lists running boosts with their time left', () => {
    const s = shop('boost-xp');
    expect(boostLines(s)).toEqual([]);
    s.boosts.xp = s.time + 125;
    s.boosts.stones = s.time + 30;
    expect(boostLines(s)).toEqual([
      'Focus Tea (+50% XP): 2 min left',
      'Bonus Envelope (+50% spirit stone find): 30 s left',
    ]);
  });

  it('names boosts that ran out while away, and running ones lost to Reincarnation', () => {
    const summary = {
      seconds: 60,
      capped: false,
      floorsClimbed: 0,
      levels: 0,
      kills: 0,
      dropsKept: 0,
      dropsSold: 0,
      dropsSalvaged: 0,
      stones: 0,
      essence: 0,
    };
    const preview: RetirePreview = {
      insight: 8,
      insightAfter: 11,
      highestFloor: 20,
      level: 14,
      items: 0,
      stones: 0,
      essence: 0,
      bagCells: 0,
      boosts: 0,
    };
    expect(overtimeView({ ...summary, boostsEnded: [] }).chips.some((c) => c.boost)).toBe(false);
    expect(overtimeView({ ...summary, boostsEnded: ['xp', 'treasure'] }).chips.at(-1)).toEqual({
      label: 'Boosts ended',
      value: 'Focus Tea, Lucky Charm',
      boost: true,
    });
    expect(retireLines({ ...preview, boosts: 2 }).lost).toContain(
      '2 running boosts and the store stock',
    );
    expect(retireLines({ ...preview, boosts: 1 }).lost).toContain(
      '1 running boost and the store stock',
    );
  });
});

describe('versionLabel', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  it('shows the version with a v and reads it out in full', () => {
    expect(versionLabel('0.6.2')).toEqual({ text: 'v0.6.2', spoken: 'Version 0.6.2' });
    setLang('vi');
    expect(versionLabel('0.6.2')).toEqual({ text: 'v0.6.2', spoken: 'Phiên bản 0.6.2' });
  });

  it('is built from the game version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(__APP_VERSION__).toBe(pkg.version);
    expect(versionLabel(__APP_VERSION__).text).toBe(`v${pkg.version}`);
  });
});

describe('versionDetails', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  it('names the build and when it was made, in UTC', () => {
    expect(versionDetails('5efacb1a2b3c', '2026-10-13T14:05:09.123Z')).toEqual([
      'Build 5efacb1a2b3c',
      'Built 2026-10-13 14:05 UTC',
    ]);
    setLang('vi');
    expect(versionDetails('5efacb1a2b3c', '2026-10-13T14:05:09.123Z')).toEqual([
      'Bản dựng 5efacb1a2b3c',
      'Dựng lúc 2026-10-13 14:05 UTC',
    ]);
  });

  it('calls a dev build local and leaves out a time that is not a date', () => {
    expect(versionDetails('dev', 'not a date')).toEqual(['Local build']);
  });
});

/** Held at `level` with its Tribulation set aside after three losses, `ago` seconds back. */
function pausedAt(level: number, ago = 60): GameState {
  const s = dueAt(level);
  s.enemies.pop();
  s.time = 5000;
  s.trial = { auto: true, losses: 3, lostAt: s.time - ago, lostDamage: 1e9, lostMaxHp: 1e9 };
  return s;
}

describe('trialPause', () => {
  it('is null while the Tribulation is due and not set aside, or not due', () => {
    expect(trialPause(dueAt(10))).toBeNull();
    expect(trialPause(newGame(1, 'sword'))).toBeNull();
  });

  it('says it is paused, the losses so far and when the next try comes', () => {
    expect(trialPause(pausedAt(10, 60))).toEqual({
      head: 'Tribulation paused after 3 losses: get stronger',
      detail: '3 losses · retry in 9 min',
    });
  });

  it('says the retry comes at the end of the floor once it is due', () => {
    const s = pausedAt(10, TRIAL_RETRY_SECONDS);
    expect(trialPause(s)?.detail).toBe('3 losses · retry at floor end');
    s.trial.lostAt = s.time - 60;
    s.enemies.push(makeTribulation(1, realmOf(10)));
    expect(trialPause(s)?.detail).toBe('3 losses · retry at floor end');
  });

  it('says automatic tries are off with the switch off', () => {
    const s = setAutoTribulation(pausedAt(10), false);
    expect(trialPause(s)?.detail).toBe('3 losses · auto off');
  });

  it('is null while the Tribulation is being fought', () => {
    expect(trialPause(faceTribulation(pausedAt(10)))).toBeNull();
  });

  it('is translated', () => {
    setLang('vi');
    const pause = trialPause(pausedAt(10, 60));
    setLang(DEFAULT_LANG);
    expect(pause).toEqual({
      head: 'Tạm hoãn Độ Thiên Kiếp sau 3 lần thua: hãy mạnh hơn',
      detail: 'Thua 3 lần · thử lại sau 9 phút',
    });
  });
});

describe('Mastery rows', () => {
  const labels = (path: PathId) => statRows(newCultivator(path)).map((r) => r.label);
  it('shows Reflect for a Body Refiner and Burst damage for a Talisman Master only', () => {
    expect(labels('body')).toContain('Reflect');
    expect(labels('body')).not.toContain('Burst damage');
    expect(labels('talisman')).toContain('Burst damage');
    expect(labels('talisman')).not.toContain('Reflect');
    expect(labels('sword')).not.toContain('Reflect');
    expect(labels('sword')).not.toContain('Burst damage');
  });
});

describe('statTip', () => {
  it('says what one more point does, in real numbers, with the Mastery for the main stat', () => {
    const c = newCultivator('sword');
    c.stats.agility = 100;
    const tip = statTip(c, 'agility');
    expect(tip.gain).toMatch(
      /^\+1 Agility: Damage .* → .*, Attacks\/s 1\.75 → 1\.76, Crit chance 23% → 23\.11%/,
    );
    expect(tip.gain).toContain('Crit damage ×2.5 → ×2.505');
    expect(tip.gain).toContain('Dodge 5% → 5.04%');
    expect(tip.mastery).toMatch(/^Flowing Sword/);
    expect(tip.share).toBe('Your Path’s stat: full effect.');
    expect(tip.slows).toBe('Gains slow above 62.');
  });

  it('says another Path’s stat adds no damage and works at half', () => {
    const c = newCultivator('sword');
    const tip = statTip(c, 'body');
    expect(tip.gain).toBe('+1 Body: Max HP 65 → 70, Defence 1.3 → 1.5, HP regen 0.25/s → 0.3/s');
    expect(tip.mastery).toBe('Not your Path’s stat: no damage.');
    expect(tip.share).toBe('Other Path: half effect.');
    // Body is a straight line but for Iron Body.
    expect(tip.slows).toBe('');
  });

  it('shows the small qi regen gain a Spirit point gives', () => {
    expect(statTip(newCultivator('talisman'), 'spirit').gain).toMatch(
      /Qi regen\/s 1\.\d+ → 1\.\d+/,
    );
  });

  it('says gains slow only once the curve has flattened', () => {
    const c = newCultivator('talisman');
    expect(statTip(c, 'spirit').slows).toBe('');
    c.stats.spirit = slowPoint('talisman', 'spirit') as number;
    expect(statTip(c, 'spirit').slows).toBe(`Gains slow above ${c.stats.spirit}.`);
    expect(slowPoint('body', 'body')).toBeGreaterThan(0);
    expect(slowPoint('sword', 'body')).toBeNull();
  });

  it('reads the same in Vietnamese, as text only', () => {
    setLang('vi');
    try {
      const tip = statTip(newCultivator('body'), 'body');
      expect(tip.gain.startsWith('+1 Thể Chất: ')).toBe(true);
      expect(tip.mastery.startsWith('Thiết Thân')).toBe(true);
    } finally {
      setLang(DEFAULT_LANG);
    }
  });
});

describe('spendPreview', () => {
  it('matches what spending actually does, row for row', () => {
    for (const path of ['sword', 'body', 'talisman'] as const) {
      const s = tick(newGame(5, path), 900);
      expect(s.cultivator.unspent).toBeGreaterThan(0);
      for (const stat of ['body', 'agility', 'spirit'] as const) {
        for (const n of [1, s.cultivator.unspent]) {
          const preview = spendPreview(s.cultivator, stat, n, s.passives);
          const after = statRows(spendPoints(s, stat, n).cultivator, s.passives);
          expect(preview.map((r) => r.value)).toEqual(after.map((r) => r.value));
        }
      }
    }
  });

  it('marks gains up and leaves untouched rows alone', () => {
    const c = newCultivator('body');
    const rows = statRows(c);
    const preview = spendPreview(c, 'body', 1);
    const at = (label: string) => preview[rows.findIndex((r) => r.label === label)];
    expect(at('Max HP')?.change).toBe('up');
    expect(at('Attacks/s')?.change).toBe('');
    expect(preview.some((r) => r.change === 'down')).toBe(false);
  });
});

describe('plan ratio input', () => {
  it('takes whole numbers from 0 to 100 only', () => {
    expect(parseShare('0')).toBe(0);
    expect(parseShare(' 100 ')).toBe(100);
    for (const bad of [
      '',
      '-1',
      '101',
      '1e2',
      '50.5',
      '0x10',
      '½',
      '٣',
      '１０',
      '10\u200b',
      'NaN',
      '__proto__',
    ]) {
      expect(parseShare(bad)).toBeNull();
    }
  });

  it('refuses a bidi override and oversized text', () => {
    expect(parseShare('1\u202e0')).toBeNull();
    expect(parseShare('\u202d50')).toBeNull();
    expect(parseShare('1'.repeat(1_000_000))).toBeNull();
  });

  it('needs all three to add up to 100', () => {
    expect(planRatio({ body: '30', agility: '60', spirit: '10' })).toEqual({
      ratio: { body: 30, agility: 60, spirit: 10 },
      why: '',
    });
    expect(planRatio({ body: '30', agility: '60', spirit: '0' })).toEqual({
      ratio: null,
      why: 'Shares add up to 90%; they must make 100%.',
    });
    expect(planRatio({ body: '-10', agility: '100', spirit: '10' }).why).toBe(
      'Shares must be whole numbers from 0 to 100.',
    );
  });
});

describe('skill callouts', () => {
  afterEach(() => setLang(DEFAULT_LANG));

  /** A state and the next one, with `notes` noted in between. */
  function noted(...notes: Parameters<typeof note>[1][]): [GameState, GameState] {
    const prev = newGame(7, 'sword');
    const next = structuredClone(prev);
    for (const n of notes) note(next.combat, n);
    return [prev, next];
  }

  it("floats a landed skill's name over its caster and an effect over the one it hit", () => {
    const [prev, next] = noted(
      { at: 1, who: 'you', skill: 'Flying Sword', windUp: false },
      { at: 1, who: 'foe', effect: 'stunned' },
      { at: 1, who: 'foe', effect: 'interrupted' },
    );
    expect(castCallouts(prev, next)).toEqual([
      { who: 'you', text: 'Flying Sword', cast: true },
      { who: 'foe', text: 'Stunned', cast: false },
      { who: 'foe', text: 'Interrupted', cast: false },
    ]);
  });

  it('says every effect in each language', () => {
    for (const code of Object.keys(PACKS)) {
      setLang(code);
      const effects = ['stunned', 'silenced', 'shielded', 'interrupted'] as const;
      const [prev, next] = noted(
        ...effects.map((effect) => ({ at: 1, who: 'you' as const, effect })),
      );
      const texts = castCallouts(prev, next).map((c) => c.text);
      expect(new Set(texts).size).toBe(4);
      for (const text of texts) expect(text).not.toMatch(/^callout\./);
    }
  });

  it("floats nothing as a wind-up starts: the enemy's name line says it", () => {
    const [prev, next] = noted({ at: 1, who: 'foe', skill: 'Paper Jam', windUp: true });
    expect(castCallouts(prev, next)).toEqual([]);
  });

  it('shows each note once, and none across a reload that reset the count', () => {
    const [prev, next] = noted({ at: 1, who: 'you', effect: 'shielded' });
    expect(castCallouts(next, structuredClone(next))).toEqual([]);
    const loaded = structuredClone(prev);
    loaded.combat = freshCombat();
    expect(castCallouts(next, loaded)).toEqual([]);
    expect(castCallouts(prev, next)).toHaveLength(1);
  });

  it('skips callouts that are already over after a long step', () => {
    const [prev, next] = noted(
      { at: 0, who: 'you', effect: 'stunned' },
      { at: 9, who: 'you', effect: 'shielded' },
    );
    next.time = 10;
    expect(castCallouts(prev, next).map((c) => c.text)).toEqual(['Shielded']);
  });

  it("follows an enemy's wind-up from start to end", () => {
    const s = newGame(7, 'sword');
    expect(windUpOf(s)).toBeNull();
    s.combat.foe.windUp = { skill: 'jam', name: 'Paper Jam', start: 10, end: 11 };
    s.time = 10.25;
    expect(windUpOf(s)).toEqual({ skill: 'Paper Jam', progress: 0.25 });
    s.time = 12;
    expect(windUpOf(s)?.progress).toBe(1);
  });
});
