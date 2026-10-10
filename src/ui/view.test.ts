import { describe, expect, it } from 'vitest';
import { newCultivator, type Cultivator } from '../core/cultivator.ts';
import type { EquipSlotId, Item } from '../core/loot.ts';
import { newGame, tick } from '../core/sim.ts';
import {
  compareToEquipped,
  cellLabel,
  durationLabel,
  formatBonus,
  freshDrops,
  gridMove,
  itemLines,
  itemTag,
  overtimeLines,
  realmLabel,
  sellBelowLabel,
  statRows,
  waveLabel,
  xpLabel,
} from './view.ts';
import { makeTribulation } from '../core/floors.ts';
import { xpToNext } from '../core/cultivator.ts';

const stapler: Item = {
  slot: 'weapon',
  name: 'Jade Stapler',
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
    expect(itemTag(stapler)).toBe('Heaven · Weapon · Lv 10 · 66%');
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
      name: 'Coffee Gourd',
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

describe('realmLabel', () => {
  it('puts the job title beside the realm name', () => {
    expect(realmLabel(1)).toBe('Qi Condensation · Intern');
    expect(realmLabel(10)).toBe('Qi Condensation · Intern');
    expect(realmLabel(11)).toBe('Foundation Establishment · Associate');
    expect(realmLabel(60)).toBe('Immortal Ascension · CEO');
  });

  it('shows Immortal alone: it has no job title', () => {
    expect(realmLabel(61)).toBe('Immortal');
    expect(realmLabel(3000)).toBe('Immortal');
  });
});

describe('xpLabel', () => {
  it('shows XP to the next level, and flags a Tribulation due at a cap', () => {
    const c = newCultivator('sword');
    c.xp = 37;
    expect(xpLabel(c)).toBe(`37 / ${xpToNext(1)}`);
    c.level = 10;
    c.xp = xpToNext(10) + 80;
    expect(xpLabel(c)).toBe(`${xpToNext(10) + 80} / ${xpToNext(10)} · Tribulation due`);
    c.xp = 5;
    expect(xpLabel(c)).toBe(`5 / ${xpToNext(10)}`);
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
  it('names the item with its grade, slot, level and quality in words', () => {
    expect(cellLabel(stapler)).toBe('Jade Stapler, Heaven · Weapon · Lv 10 · 66%');
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
