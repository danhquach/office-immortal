import { afterEach, describe, expect, it } from 'vitest';
import { derive, newCultivator, REALMS, type Cultivator } from '../core/cultivator.ts';
import { BAG_ROW, INVENTORY_SIZE, MAX_BAG_SIZE } from '../core/economy.ts';
import type { EquipSlotId, Item } from '../core/loot.ts';
import { equip, faceTribulation, newGame, tick, type GameState } from '../core/sim.ts';
import {
  arraySetUp,
  BAG_PAGE,
  bagPage,
  bagPages,
  compareToEquipped,
  equipBlock,
  cellLabel,
  characterStatusLabel,
  durationLabel,
  formatBonus,
  freshDrops,
  gridMove,
  itemLines,
  itemTag,
  gearVerdict,
  verdictOf,
  treasureTier,
  charmLineName,
  favouredBy,
  overtimeLines,
  pageOf,
  passiveRow,
  realmLabel,
  realmRows,
  retireLabel,
  SUMMARY_ICONS,
  summaryIcon,
  retireLines,
  respecView,
  STAT_GROUPS,
  sellBelowLabel,
  soulsLine,
  statRows,
  tribulationBanner,
  tribulationCall,
  tribulationFellDue,
  waveLabel,
  xpBar,
} from './view.ts';
import { makeEnemy, makeTribulation } from '../core/floors.ts';
import { DEFAULT_LANG, PACKS, setLang, t } from './i18n.ts';
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

  it('adds the unique effect on an Immortal item', () => {
    const lines = itemLines({ ...stapler, grade: 'immortal', unique: 'synergy' });
    expect(lines.at(-1)).toBe('Synergy of the Dao: +25% Damage');
  });

  it('tags grade, slot, level and quality in text', () => {
    expect(itemTag(stapler)).toBe('Heaven · Weapon · Lv 10 · Quality 66%');
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
    expect(rows['Max HP']).toBe('100');
    expect(rows['Crit chance']).toBe('6.6%');
    expect(rows['Crit damage']).toBe('×2');
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
    expect(by('Offence')).toEqual(['Damage', 'Attacks/s', 'Crit chance', 'Crit damage']);
    expect(by('Defence')).toEqual(['Max HP', 'Defence', 'Lifesteal', 'Qi regen']);
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
    expect(summaryIcon('realm', 90)).toBe(10);
    expect(summaryIcon('realm', 91)).toBe(11);
    expect(summaryIcon('realm', 3000)).toBe(11);
    const cols = Array.from({ length: REALMS.length }, (_, r) => summaryIcon('realm', r * 10 + 1));
    expect(new Set(cols).size).toBe(REALMS.length);
    expect(cols.every((c) => c >= 0 && c < SUMMARY_ICONS.length)).toBe(true);
  });
});

describe('realmLabel', () => {
  it('puts the job title beside the realm name', () => {
    expect(realmLabel(1)).toBe('Qi Condensation · Intern');
    expect(realmLabel(10)).toBe('Qi Condensation · Intern');
    expect(realmLabel(11)).toBe('Foundation Establishment · Associate');
    expect(realmLabel(90)).toBe('Tribulation Transcendence · Chairman');
  });

  it('shows Immortal Ascension alone: it has no job title', () => {
    expect(realmLabel(91)).toBe('Immortal Ascension');
    expect(realmLabel(3000)).toBe('Immortal Ascension');
  });
});

describe('realmRows', () => {
  it('lists every realm in order with its job title and levels', () => {
    expect(realmRows(1).map((r) => [r.name, r.title, r.levels])).toEqual([
      ['Qi Condensation', 'Intern', 'Lv 1–10'],
      ['Foundation Establishment', 'Associate', 'Lv 11–20'],
      ['Golden Core', 'Team Lead', 'Lv 21–30'],
      ['Nascent Soul', 'Manager', 'Lv 31–40'],
      ['Spirit Transformation', 'Senior Manager', 'Lv 41–50'],
      ['Void Refinement', 'Director', 'Lv 51–60'],
      ['Body Integration', 'VP', 'Lv 61–70'],
      ['Mahayana', 'CEO', 'Lv 71–80'],
      ['Tribulation Transcendence', 'Chairman', 'Lv 81–90'],
      ['Immortal Ascension', '', 'Lv 91+'],
    ]);
  });

  it('marks only the realm the level is in as current, at both edges of a realm', () => {
    const current = (level: number): number[] =>
      realmRows(level).flatMap((r, i) => (r.current ? [i] : []));
    expect(current(1)).toEqual([0]);
    expect(current(10)).toEqual([0]);
    expect(current(11)).toEqual([1]);
    expect(current(60)).toEqual([5]);
    expect(current(61)).toEqual([6]);
    expect(current(90)).toEqual([8]);
    expect(current(91)).toEqual([9]);
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
  s.enemies.push(makeTribulation(1, Math.floor((level - 1) / 10)));
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
    expect(tribulationCall(dueAt(90))).toEqual({
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
        { text: '+3% Illusion Array', better: true },
      ]);
      expect(texts(wearing(disc('binding', 1)), disc('binding', 0))).toEqual([
        { text: '−0.5 s Binding Array', better: false },
      ]);
      expect(texts(wearing(disc('killing')), disc('killing'))).toEqual([]);
    });

    it('shows an array gained and one lost', () => {
      expect(texts(wearing(disc('killing', 0)), disc('illusion', 0))).toEqual([
        { text: '+Illusion Array (8%)', better: true },
        { text: '−Killing Array (15%)', better: false },
      ]);
      expect(texts(wearing(), disc('binding', 0))).toEqual([
        { text: '+Binding Array (1.5 s)', better: true },
      ]);
      const gourd: Item = { ...disc('binding'), name: 'Jade Elixir Gourd' };
      delete gourd.array;
      expect(texts(wearing(disc('binding', 0)), gourd)).toEqual([
        { text: '−Binding Array (1.5 s)', better: false },
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

  it('names the item with its grade, slot, level and labeled quality in words', () => {
    expect(cellLabel(stapler)).toBe(
      'Golden Crow Flying Sword, Heaven · Weapon · Lv 10 · Quality 66%',
    );
  });

  it('adds "upgrade" or "downgrade" only when that badge shows', () => {
    const tag = 'Golden Crow Flying Sword, Heaven · Weapon · Lv 10 · Quality 66%';
    expect(cellLabel(stapler, 'up')).toBe(`${tag}, upgrade`);
    expect(cellLabel(stapler, 'down')).toBe(`${tag}, downgrade`);
    expect(cellLabel(stapler, 'mixed')).toBe(`${tag}, mixed`);
    expect(cellLabel(stapler, null)).toBe(tag);
    expect(cellLabel(stapler)).toBe(tag);
  });

  it('labels quality and the upgrade in Vietnamese', () => {
    setLang('vi');
    expect(itemTag(stapler)).toMatch(/ · Cấp 10 · Chất lượng 66%$/);
    expect(cellLabel(stapler)).toMatch(/, .* · Chất lượng 66%$/);
    expect(cellLabel(stapler, 'up')).toMatch(/ · Chất lượng 66%, nâng cấp$/);
    expect(cellLabel(stapler, 'down')).toMatch(/ · Chất lượng 66%, hạ cấp$/);
    expect(cellLabel(stapler, 'mixed')).toMatch(/ · Chất lượng 66%, được mất$/);
    expect(cellLabel(stapler, null)).toMatch(/ · Chất lượng 66%$/);
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

describe('overtimeLines', () => {
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
  };

  it('lists every count', () => {
    expect(overtimeLines(summary)).toEqual([
      'Away 2 h 5 min',
      'Floors climbed: 3',
      'Levels gained: 4',
      'Kills: 120',
      'Drops kept: 9',
      'Spirit Stones: +450',
      'Items drop at 50% of the usual rate while away. Keep the tab open for more loot.',
    ]);
  });

  it('says when the cap cut the time short, and shows drops sold and salvaged', () => {
    const lines = overtimeLines({
      ...summary,
      seconds: 8 * 3600,
      capped: true,
      dropsSold: 2,
      dropsSalvaged: 3,
      essence: 40,
    });
    expect(lines[0]).toBe('Away more than 8 h 0 min (the most replayed)');
    expect(lines.slice(5)).toEqual([
      'Drops sold: 2',
      'Drops salvaged: 3',
      'Spirit Stones: +450',
      'Spirit Essence: +40',
      'Items drop at 50% of the usual rate while away. Keep the tab open for more loot.',
    ]);
    expect(lines.join()).not.toMatch(/lost/i);
  });
});

describe('sellBelowLabel', () => {
  it('names the count, the highest grade and the price', () => {
    expect(sellBelowLabel({ count: 12, highest: 'spirit', stones: 340 })).toBe(
      'Sell 12 items (highest grade: Spirit) for 340 Spirit Stones?',
    );
    expect(sellBelowLabel({ count: 1, highest: 'mortal', stones: 2 })).toBe(
      'Sell 1 item (highest grade: Mortal) for 2 Spirit Stones?',
    );
  });

  it('says when there is nothing to sell', () => {
    expect(sellBelowLabel({ count: 0, highest: null, stones: 0 })).toBe(
      'Nothing to sell below that grade.',
    );
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
    expect(soulsLine(banner, s)).toBe('Souls: 7 / 20 (+4.7 damage per attack)');
    s.souls = 0;
    expect(soulsLine(banner, s)).toBe('Souls: 0 / 20 (+0 damage per attack)');
  });

  it('shows no souls on a banner in the bag', () => {
    const s = newGame(1, 'talisman');
    s.cultivator.equipment.sideArm = item('Jade Hundred Ghosts Banner');
    s.souls = 7;
    const bag = item('Ten-Thousand Souls Banner', 'immortal');
    expect(soulsLine(bag, s)).toMatch(/^Souls: 0 \/ 30 /);
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
    expect(favouredBy(item(slot, name), 'body')?.text).toBe(`Favoured by: ${path}`);
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
