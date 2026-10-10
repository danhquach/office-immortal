import { describe, expect, it } from 'vitest';
import {
  AFFIXES,
  affixValue,
  baseValue,
  defaultSlot,
  DROP_CHANCE,
  EQUIP_SLOTS,
  equipmentBonuses,
  GRADES,
  namesFor,
  quality,
  rangeAt,
  renamed,
  rollDrop,
  rollItem,
  SLOTS,
  slotsFor,
  UNIQUES,
  type AffixId,
  type GradeId,
  type Item,
  type SlotId,
} from './loot.ts';
import { createRng, type Rng } from './rng.ts';

const GRADE_IDS = Object.keys(GRADES) as GradeId[];
const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];
const N = 100_000;

function rollMany(seed: number, n: number, level: (i: number) => number): Item[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, (_, i) => rollItem(rng, level(i)));
}

// Rolled once and shared: the frequency and range checks walk the same 100k items.
const MANY = rollMany(2024, N, (i) => 1 + (i % 120));

/** A source that always returns `v`: every roll lands on the same end. */
const constant =
  (v: number): Rng =>
  () =>
    v;

describe('rollItem', () => {
  it('is reproducible from a seed', () => {
    expect(rollMany(9, 1000, () => 10)).toEqual(rollMany(9, 1000, () => 10));
  });

  it('rolls differently from a different seed', () => {
    expect(rollMany(9, 100, () => 10)).not.toEqual(rollMany(10, 100, () => 10));
  });

  it('matches the design drop weights over 100k rolls', () => {
    // docs/design.md §6, written out so a wrong table fails here.
    const design: Record<GradeId, number> = {
      mortal: 0.6,
      spirit: 0.28,
      earth: 0.09,
      heaven: 0.027,
      immortal: 0.003,
    };
    for (const g of GRADE_IDS) {
      const p = design[g];
      const seen = MANY.filter((item) => item.grade === g).length / N;
      // Five standard deviations: never flaky, still catches a wrong weight.
      expect(Math.abs(seen - p)).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / N));
    }
  });

  it('keeps every roll and value within its range', () => {
    // Collected and checked once: a million expect() calls are too slow for CI.
    const bad: string[] = [];
    const within = (what: string, v: number, lo: number, hi: number, i: number): void => {
      if (!(v >= lo && v <= hi)) bad.push(`item ${i} ${what}: ${v} not in [${lo}, ${hi}]`);
    };
    MANY.forEach((item, i) => {
      const base = rangeAt(SLOTS[item.slot].base, item.level);
      within('baseRoll', item.baseRoll, 0, 1, i);
      within('base', baseValue(item), base.lo, base.hi, i);
      for (const a of item.affixes) {
        const r = rangeAt(AFFIXES[a.id], item.level);
        within(`${a.id} roll`, a.roll, 0, 1, i);
        within(a.id, affixValue(a, item.level), r.lo, r.hi, i);
      }
      within('quality', quality(item), 0, 100, i);
    });
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('gives each grade its affix count, never the same affix twice, and a unique only on Immortal', () => {
    // docs/design.md §6, written out so a wrong table fails here.
    const design: Record<GradeId, number[]> = {
      mortal: [0],
      spirit: [1, 2],
      earth: [3, 4],
      heaven: [4, 5],
      immortal: [5],
    };
    const counts = new Map<GradeId, Set<number>>(GRADE_IDS.map((g) => [g, new Set()]));
    const bad: string[] = [];
    MANY.forEach((item, i) => {
      counts.get(item.grade)?.add(item.affixes.length);
      if (new Set(item.affixes.map((a) => a.id)).size !== item.affixes.length) {
        bad.push(`item ${i}: repeated affix`);
      }
      if ((item.unique !== undefined) !== (item.grade === 'immortal')) {
        bad.push(`item ${i}: unique on ${item.grade}`);
      }
      if (!namesFor(item.slot, item.grade).includes(item.name)) {
        bad.push(`item ${i}: name ${item.name} on ${item.grade} ${item.slot}`);
      }
    });
    expect(bad.slice(0, 10)).toEqual([]);
    for (const g of GRADE_IDS) expect([...(counts.get(g) ?? [])].sort()).toEqual(design[g]);
  });

  it('names weapons by grade: five names each, no name shared between grades', () => {
    const all = GRADE_IDS.flatMap((g) => namesFor('weapon', g));
    for (const g of GRADE_IDS) expect(namesFor('weapon', g)).toHaveLength(5);
    expect(new Set(all).size).toBe(25);
    // Atlas rows follow SLOTS.names, so it lists them in grade order.
    expect(SLOTS.weapon.names).toEqual(all);
    // Seeded: every grade rolls every one of its names, and only those.
    for (const g of GRADE_IDS) {
      const seen = new Set(
        MANY.filter((i) => i.slot === 'weapon' && i.grade === g).map((i) => i.name),
      );
      expect(seen, g).toEqual(new Set(namesFor('weapon', g)));
    }
  });

  it('gives each grade one weapon of each family, in family order', () => {
    const families = [/ Flying Sword$/, / Whisk$/, /Peachwood Sword$/, / Fan$/, / Seal$/];
    for (const g of GRADE_IDS) {
      const names = namesFor('weapon', g);
      families.forEach((family, i) => expect(names[i], `${g} ${i}`).toMatch(family));
    }
    // The Flying Sword family must not also catch the Peachwood Sword.
    expect(namesFor('weapon', 'mortal')[2]).not.toMatch(/Flying/);
    expect(namesFor('weapon', 'immortal')).toEqual([
      'Phoenix Flame Flying Sword',
      'Phoenix Plume Whisk',
      'Thousand-Year Peachwood Sword',
      'Phoenix Flame Fan',
      'Heaven-Crushing Seal',
    ]);
  });

  it('renames each retired blade to the first weapon name of its own grade only', () => {
    const blades: Record<GradeId, string[]> = {
      mortal: ['Iron Jian', 'Bronze Longsword', 'Tempered Steel Blade'],
      spirit: ['Azure Cloud Jian', 'Sky River Blade', 'Frost Lotus Sword'],
      earth: ['Jade Serpent Blade', 'Verdant Pine Sword', 'Emerald Wind Jian'],
      heaven: ['Golden Crow Sword', 'Sunlit Phoenix Blade', 'Imperial Gold Sabre'],
      immortal: ['Vermilion Bird Blade', 'Heart Flame Jian', 'Nine Suns Sabre'],
    };
    for (const g of GRADE_IDS) {
      for (const old of blades[g]) {
        expect(renamed('weapon', g, old)).toBe(namesFor('weapon', g)[0]);
        // On another grade it is left as is, so the save check rejects it.
        const other = g === 'mortal' ? 'spirit' : 'mortal';
        expect(renamed('weapon', other, old)).toBe(old);
        expect(renamed('head', g, old)).toBe(old);
      }
    }
    expect(renamed('weapon', 'heaven', '__proto__')).toBe('__proto__');
    expect(renamed('weapon', 'heaven', 'Golden Crow Flying Sword')).toBe(
      'Golden Crow Flying Sword',
    );
  });

  it('names every type but weapons by grade: one name each, in grade order', () => {
    const types = [
      'head',
      'chest',
      'boots',
      'attachment',
      'sideArm',
      'accessory',
      'charm',
    ] as const;
    // With weapons, that is every type.
    expect([...types, 'weapon'].sort()).toEqual(Object.keys(SLOTS).sort());
    for (const slot of types) {
      for (const g of GRADE_IDS) expect(namesFor(slot, g)).toHaveLength(1);
      expect(SLOTS[slot].names).toEqual(GRADE_IDS.flatMap((g) => namesFor(slot, g)));
      for (const g of GRADE_IDS) {
        const seen = MANY.filter((i) => i.slot === slot && i.grade === g).map((i) => i.name);
        expect(seen.length, `${slot} ${g}`).toBeGreaterThan(0);
        expect(new Set(seen)).toEqual(new Set(namesFor(slot, g)));
      }
    }
  });

  it('rolls the names docs/design.md lists for the five remaining types', () => {
    const table: Record<'head' | 'sideArm' | 'attachment' | 'accessory' | 'charm', string[]> = {
      head: [
        'Hempen Scholar Cap',
        'Azure Cloud Circlet',
        'Jade Lotus Crown',
        'Golden Sun Crown',
        'Phoenix Flame Crown',
      ],
      sideArm: [
        'Iron Throwing Darts',
        'Azure Frost Darts',
        'Jade Viper Darts',
        'Golden Crow Flying Knives',
        'Phoenix Flame Darts',
      ],
      attachment: [
        'Clay Wine Gourd',
        'Azure Spirit Gourd',
        'Jade Elixir Gourd',
        'Golden Nectar Gourd',
        'Phoenix Flame Gourd',
      ],
      accessory: [
        'Bone Bead Pendant',
        'Azure Spirit Pendant',
        'Jade Dragon Pendant',
        'Golden Sun Amulet',
        'Phoenix Flame Amulet',
      ],
      charm: [
        'Paper Ward Talisman',
        'Azure Thunder Talisman',
        'Jade Seal Talisman',
        'Golden Heaven Seal',
        'Phoenix Flame Talisman',
      ],
    };
    for (const [slot, names] of Object.entries(table)) {
      expect(SLOTS[slot as keyof typeof table].names).toEqual(names);
    }
  });

  it('labels the side arm type and position Hidden Weapon', () => {
    expect(SLOTS.sideArm.name).toBe('Hidden Weapon');
    expect(EQUIP_SLOTS.sideArm).toEqual({ name: 'Hidden Weapon', takes: 'sideArm' });
    const labels = [...Object.values(SLOTS), ...Object.values(EQUIP_SLOTS)].map((x) => x.name);
    expect(labels.filter((l) => /side arm/i.test(l))).toEqual([]);
  });

  it('renames each retired office name to the first name of the item grade', () => {
    const office: [SlotId, string[]][] = [
      ['head', ['Headset of Clarity', 'Thinking Cap', 'Jade Hair Crown']],
      ['sideArm', ['Stapler Dagger', 'Laser-Pointer Wand', 'Hole-Punch Knuckle']],
      ['attachment', ['Coffee Gourd', 'Thermos of Elixirs', 'Break-Room Calabash']],
      ['accessory', ['Lanyard Pendant', 'Badge of the Dao', 'Key-Card Amulet']],
      ['charm', ['Sticky-Note Talisman', 'Laminated Seal', 'Post-Meeting Charm']],
    ];
    for (const [slot, olds] of office) {
      for (const old of olds) {
        for (const g of GRADE_IDS) expect(renamed(slot, g, old)).toBe(namesFor(slot, g)[0]);
        // On another type it is left as is, so the save check rejects it.
        expect(renamed(slot === 'head' ? 'charm' : 'head', 'mortal', old)).toBe(old);
      }
    }
    expect(renamed('sideArm', 'mortal', 'Stapler Dagger\u200b')).toBe('Stapler Dagger\u200b');
  });

  it('rolls every slot, affix and unique effect', () => {
    expect(new Set(MANY.map((i) => i.slot)).size).toBe(Object.keys(SLOTS).length);
    expect(new Set(MANY.flatMap((i) => i.affixes.map((a) => a.id))).size).toBe(AFFIX_IDS.length);
    expect(new Set(MANY.map((i) => i.unique).filter(Boolean)).size).toBe(
      Object.keys(UNIQUES).length,
    );
  });

  it('gives 100% quality and top values when every roll is a maximum', () => {
    const item = rollItem(constant(0.999999), 30);
    expect(item.grade).toBe('immortal');
    expect(quality(item)).toBe(100);
    expect(baseValue(item)).toBe(rangeAt(SLOTS[item.slot].base, 30).hi);
    for (const a of item.affixes) expect(affixValue(a, 30)).toBe(rangeAt(AFFIXES[a.id], 30).hi);
  });

  it('gives 0% quality and bottom values when every roll is a minimum', () => {
    const item = rollItem(constant(0), 30);
    expect(item.grade).toBe('mortal');
    expect(quality(item)).toBe(0);
    expect(baseValue(item)).toBe(rangeAt(SLOTS[item.slot].base, 30).lo);
  });

  it('gives 0% quality when the base and every affix roll a minimum', () => {
    const item: Item = {
      slot: 'chest',
      name: 'Silk Cardigan',
      level: 10,
      grade: 'spirit',
      baseRoll: 0,
      affixes: [
        { id: 'maxHp', roll: 0 },
        { id: 'defence', roll: 0 },
      ],
    };
    expect(quality(item)).toBe(0);
    for (const a of item.affixes) expect(affixValue(a, 10)).toBe(rangeAt(AFFIXES[a.id], 10).lo);
  });

  it('shows 100% only when every roll is a maximum', () => {
    const item: Item = {
      slot: 'weapon',
      name: 'Iron Flying Sword',
      level: 10,
      grade: 'mortal',
      baseRoll: 0.99,
      affixes: [],
    };
    expect(quality(item)).toBe(99);
    // 199 of 200 points: 99.5% rounds down.
    expect(quality({ ...item, baseRoll: 1, affixes: [{ id: 'maxHp', roll: 0.99 }] })).toBe(99);
  });

  it('averages quality over the base roll and every affix roll', () => {
    const item: Item = {
      slot: 'weapon',
      name: 'Iron Flying Sword',
      level: 10,
      grade: 'spirit',
      baseRoll: 1,
      affixes: [{ id: 'maxHp', roll: 0.5 }],
    };
    expect(quality(item)).toBe(75);
  });

  it('rejects an item level that is not a whole number of at least 1', () => {
    const rng = createRng(1);
    for (const level of [0, -3, 1.5, Number.NaN]) {
      expect(() => rollItem(rng, level)).toThrow(RangeError);
    }
  });
});

describe('equipment positions', () => {
  it('gives every item type at least one position, and pairs to accessories and charms', () => {
    for (const type of Object.keys(SLOTS) as SlotId[]) {
      expect(slotsFor(type).length).toBe(type === 'accessory' || type === 'charm' ? 2 : 1);
    }
    expect(Object.keys(EQUIP_SLOTS)).toHaveLength(10);
  });

  it('defaults to the first free position, else the first', () => {
    const charm = rollItem(constant(0), 1);
    charm.slot = 'charm';
    expect(defaultSlot({}, charm)).toBe('charm1');
    expect(defaultSlot({ charm1: charm }, charm)).toBe('charm2');
    expect(defaultSlot({ charm1: charm, charm2: charm }, charm)).toBe('charm1');
  });
});

describe('ranges', () => {
  it('rolls a weapon 8–14 damage at item level 10', () => {
    expect(rangeAt(SLOTS.weapon.base, 10)).toEqual({ lo: 8, hi: 14 });
  });

  it('gives the expected ranges at sample levels', () => {
    expect(rangeAt(SLOTS.chest.base, 20)).toEqual({ lo: 8, hi: 14 });
    expect(rangeAt(SLOTS.accessory.base, 3)).toEqual({ lo: 12, hi: 21 });
    expect(rangeAt(SLOTS.attachment.base, 21)).toEqual({ lo: 0.02, hi: 0.04 });
    expect(rangeAt(AFFIXES.critChance, 41)).toEqual({ lo: 0.015, hi: 0.045 });
    expect(rangeAt(AFFIXES.defence, 1)).toEqual({ lo: 0.2, hi: 0.5 });
  });

  it('keeps level-1 ranges wide enough that a better roll is a better stat', () => {
    const defs = [...Object.values(SLOTS).map((s) => s.base), ...Object.values(AFFIXES)];
    for (const def of defs) {
      const r = rangeAt(def, 1);
      expect(r.lo).toBeGreaterThan(0);
      expect(r.hi).toBeGreaterThan(r.lo);
    }
  });

  it('grows every range with item level and keeps lo <= hi', () => {
    const defs = [...Object.values(SLOTS).map((s) => s.base), ...Object.values(AFFIXES)];
    for (const def of defs) {
      for (const level of [1, 10, 100]) {
        const r = rangeAt(def, level);
        expect(r.lo).toBeLessThanOrEqual(r.hi);
      }
      expect(rangeAt(def, 100).hi).toBeGreaterThan(rangeAt(def, 1).hi);
    }
  });
});

describe('rollDrop', () => {
  function dropRate(kind: keyof typeof DROP_CHANCE, treasureFind: number): number {
    const rng = createRng(77);
    let drops = 0;
    for (let i = 0; i < 20_000; i++) if (rollDrop(rng, kind, 5, treasureFind)) drops++;
    return drops / 20_000;
  }

  it('always drops from a Tribulation, often from a boss and rarely from a demon', () => {
    expect(dropRate('tribulation', 0)).toBe(1);
    // Over 20k draws, ±0.02 is more than 5 standard deviations.
    expect(Math.abs(dropRate('boss', 0) - DROP_CHANCE.boss)).toBeLessThan(0.02);
    expect(Math.abs(dropRate('elite', 0) - DROP_CHANCE.elite)).toBeLessThan(0.02);
    expect(Math.abs(dropRate('demon', 0) - DROP_CHANCE.demon)).toBeLessThan(0.015);
  });

  it('drops more with treasure find', () => {
    expect(dropRate('demon', 0.5)).toBeGreaterThan(dropRate('demon', 0) * 1.3);
  });

  it('sets the item level to the floor', () => {
    const item = rollDrop(createRng(3), 'tribulation', 17, 0);
    expect(item?.level).toBe(17);
  });
});

describe('equipmentBonuses', () => {
  it('is all zeros with nothing equipped', () => {
    expect(Object.values(equipmentBonuses({})).every((v) => v === 0)).toBe(true);
  });

  it('sums base stats, affixes and unique effects across slots', () => {
    const weapon: Item = {
      slot: 'weapon',
      name: 'Iron Flying Sword',
      level: 10,
      grade: 'immortal',
      baseRoll: 1,
      affixes: [{ id: 'maxHp', roll: 0 }],
      unique: 'synergy',
    };
    const sideArm: Item = {
      slot: 'sideArm',
      name: 'Azure Frost Darts',
      level: 10,
      grade: 'spirit',
      baseRoll: 0,
      affixes: [{ id: 'maxHp', roll: 1 }],
    };
    const b = equipmentBonuses({ weapon, sideArm });
    expect(b.damage).toBe(14 + 5);
    expect(b.maxHp).toBe(20 + 50);
    expect(b.damagePct).toBe(0.25);
  });

  it('sums to the exact same numbers whatever order the items went on', () => {
    // Float sums depend on order; a save reloads gear in position order.
    const positions = Object.keys(EQUIP_SLOTS) as (keyof typeof EQUIP_SLOTS)[];
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      const worn = positions.map((at) => {
        let item = rollItem(rng, 1 + (seed % 40));
        while (item.slot !== EQUIP_SLOTS[at].takes) item = rollItem(rng, item.level);
        return [at, item] as const;
      });
      const forward = equipmentBonuses(Object.fromEntries(worn));
      const backward = equipmentBonuses(Object.fromEntries([...worn].reverse()));
      expect(backward).toEqual(forward);
    }
  });
});
