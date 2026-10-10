import { describe, expect, it } from 'vitest';
import {
  AFFIXES,
  affixScale,
  affixValue,
  ARRAY_IDS,
  arrayValue,
  ARRAYS,
  baseValue,
  CHARM_LINES,
  charmLine,
  drawAffixes,
  FAVOURED_WEIGHT,
  itemAffixValue,
  defaultSlot,
  DROP_CHANCE,
  EQUIP_SLOTS,
  OFFLINE_DROP_MULTIPLIER,
  equipmentBonuses,
  equippedArray,
  isDisc,
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
  type CharmLineId,
  type GradeId,
  type Item,
  type SlotId,
} from './loot.ts';
import { createRng, type Rng } from './rng.ts';
import { makeFloor } from './floors.ts';

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
        const def = AFFIXES[a.id];
        const k = affixScale(item, a.id);
        const r = rangeAt({ ...def, lo: def.lo * k, hi: def.hi * k }, item.level);
        within(`${a.id} roll`, a.roll, 0, 1, i);
        within(a.id, itemAffixValue(item, a), r.lo, r.hi, i);
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

  it('names every type but weapons by grade, one name per family, in grade order', () => {
    const families = {
      head: 1,
      chest: 1,
      boots: 1,
      attachment: 2,
      sideArm: 2,
      accessory: 3,
      charm: 4,
    } as const;
    // With weapons, that is every type.
    expect([...Object.keys(families), 'weapon'].sort()).toEqual(Object.keys(SLOTS).sort());
    for (const [slot, n] of Object.entries(families) as [keyof typeof families, number][]) {
      for (const g of GRADE_IDS) expect(namesFor(slot, g)).toHaveLength(n);
      expect(SLOTS[slot].names).toEqual(GRADE_IDS.flatMap((g) => namesFor(slot, g)));
      expect(new Set(SLOTS[slot].names).size).toBe(n * GRADE_IDS.length);
      // Seeded: every grade rolls every one of its names, and only those.
      for (const g of GRADE_IDS) {
        const seen = MANY.filter((i) => i.slot === slot && i.grade === g).map((i) => i.name);
        expect(seen.length, `${slot} ${g}`).toBeGreaterThan(0);
        expect(new Set(seen), `${slot} ${g}`).toEqual(new Set(namesFor(slot, g)));
      }
    }
  });

  it('gives each grade one Gourd and one Formation Disc, in that order', () => {
    for (const g of GRADE_IDS) {
      const [gourd, disc] = namesFor('attachment', g);
      expect(gourd, g).toMatch(/ Gourd$/);
      expect(disc, g).toMatch(/ (Formation|Bagua|Star) Disc$/);
    }
  });

  it('gives each grade one Accessory and one Hidden Weapon of each family, in family order', () => {
    const accessory = [/ (Pendant|Amulet)$/, / (Bell|Wind Chime)$/, / Mirror$/];
    const sideArm = [
      / (Darts|Flying Knives)$/,
      /(Binding Cord|Silk Sash|Binding Chain|Wrapping Sash|Binding Rope)$/,
    ];
    for (const g of GRADE_IDS) {
      const a = namesFor('accessory', g);
      accessory.forEach((family, i) => expect(a[i], `${g} ${i}`).toMatch(family));
      const h = namesFor('sideArm', g);
      sideArm.forEach((family, i) => expect(h[i], `${g} ${i}`).toMatch(family));
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
        'Hempen Binding Cord',
        'Azure Frost Darts',
        'Azure Silk Sash',
        'Jade Viper Darts',
        'Jade Dragon-Binding Chain',
        'Golden Crow Flying Knives',
        'Golden Heaven-Wrapping Sash',
        'Phoenix Flame Darts',
        'Phoenix Flame Binding Rope',
      ],
      attachment: [
        'Clay Wine Gourd',
        'Bronze Formation Disc',
        'Azure Spirit Gourd',
        'Azure Bagua Disc',
        'Jade Elixir Gourd',
        'Jade Formation Disc',
        'Golden Nectar Gourd',
        'Golden Star Disc',
        'Phoenix Flame Gourd',
        'Phoenix Flame Formation Disc',
      ],
      accessory: [
        'Bone Bead Pendant',
        'Bronze Clapper Bell',
        'Bronze Hand Mirror',
        'Azure Spirit Pendant',
        'Azure Soul-Scattering Bell',
        'Azure Bagua Mirror',
        'Jade Dragon Pendant',
        'Jade Wind Chime',
        'Jade Demon-Revealing Mirror',
        'Golden Sun Amulet',
        'Golden Sun Bell',
        'Golden Sun Mirror',
        'Phoenix Flame Amulet',
        'Phoenix Flame Bell',
        'Phoenix Flame Mirror',
      ],
      charm: [
        'Paper Ward Talisman',
        'Paper Body-Guard Talisman',
        'Paper Fortune Talisman',
        'Cloudy Jade Slip',
        'Azure Thunder Talisman',
        'Azure Barrier Talisman',
        'Azure Clear-Mind Talisman',
        'Azure Spirit Jade Slip',
        'Jade Seal Talisman',
        'Jade Vajra Talisman',
        'Jade Wealth Talisman',
        'Emerald Jade Token',
        'Golden Heaven Seal',
        'Golden Bell Guard Talisman',
        'Golden Treasure-Seeking Talisman',
        'Golden Sun Jade Token',
        'Phoenix Flame Talisman',
        'Phoenix Rebirth Talisman',
        'Phoenix Heaven-Luck Talisman',
        'Phoenix Blood Jade',
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
  function dropRate(kind: keyof typeof DROP_CHANCE, treasureFind: number, offline = false): number {
    const rng = createRng(77);
    let drops = 0;
    for (let i = 0; i < 20_000; i++) if (rollDrop(rng, kind, 5, treasureFind, offline)) drops++;
    return drops / 20_000;
  }

  /** Mean drops per floor's line-up (makeFloor) over many seeded floors. */
  function floorRate(treasureFind: number, offline: boolean): number {
    const rng = createRng(2024);
    const floors = 20_000;
    let drops = 0;
    for (let f = 0; f < floors; f++) {
      for (const enemy of makeFloor(rng, 1)) {
        if (rollDrop(rng, enemy.kind, 1, treasureFind, offline)) drops++;
      }
    }
    return drops / floors;
  }

  it('drops at the online chances: demon 2%, elite 12%, boss 25%, Tribulation 100%', () => {
    expect(DROP_CHANCE).toEqual({ demon: 0.02, elite: 0.12, boss: 0.25, tribulation: 1 });
    expect(OFFLINE_DROP_MULTIPLIER).toBe(0.5);
  });

  it('halves every chance offline but a Tribulation, which always drops', () => {
    expect(dropRate('tribulation', 0, true)).toBe(1);
    // Over 20k draws, these margins are more than 5 standard deviations.
    expect(Math.abs(dropRate('boss', 0, true) - DROP_CHANCE.boss / 2)).toBeLessThan(0.02);
    expect(Math.abs(dropRate('elite', 0, true) - DROP_CHANCE.elite / 2)).toBeLessThan(0.015);
    expect(Math.abs(dropRate('demon', 0, true) - DROP_CHANCE.demon / 2)).toBeLessThan(0.005);
  });

  it('gives about 0.55 drops a floor online and 0.28 offline, both rising with treasure find', () => {
    // 20k floors: one standard deviation is about 0.005 drops a floor online.
    const online = floorRate(0, false);
    const offline = floorRate(0, true);
    expect(Math.abs(online - 0.55)).toBeLessThan(0.03);
    expect(Math.abs(offline - 0.275)).toBeLessThan(0.02);
    expect(floorRate(0.5, false)).toBeGreaterThan(online * 1.3);
    expect(floorRate(0.5, true)).toBeGreaterThan(offline * 1.3);
  });

  it('always drops from a Tribulation, often from a boss and rarely from a demon', () => {
    expect(dropRate('tribulation', 0)).toBe(1);
    // Over 20k draws, ±0.02 is more than 5 standard deviations.
    expect(Math.abs(dropRate('boss', 0) - DROP_CHANCE.boss)).toBeLessThan(0.02);
    expect(Math.abs(dropRate('elite', 0) - DROP_CHANCE.elite)).toBeLessThan(0.02);
    expect(Math.abs(dropRate('demon', 0) - DROP_CHANCE.demon)).toBeLessThan(0.006);
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

describe('Formation Discs', () => {
  const attachments = MANY.filter((i) => i.slot === 'attachment');
  const discs = attachments.filter(isDisc);

  it('drops a disc for about half of all Attachments', () => {
    expect(discs.length / attachments.length).toBeGreaterThan(0.47);
    expect(discs.length / attachments.length).toBeLessThan(0.53);
  });

  it('gives every disc one array, each about a third of the time, and no other item one', () => {
    for (const i of MANY) expect(i.array !== undefined, i.name).toBe(isDisc(i));
    for (const id of ARRAY_IDS) {
      const share = discs.filter((d) => d.array === id).length / discs.length;
      expect(share, id).toBeGreaterThan(0.3);
      expect(share, id).toBeLessThan(0.37);
    }
  });

  it('keeps each array within its grade range, rising with grade', () => {
    for (const d of discs) {
      const [lo, hi] = ARRAYS[d.array as keyof typeof ARRAYS].byGrade[d.grade];
      expect(arrayValue(d)).toBeGreaterThanOrEqual(lo);
      expect(arrayValue(d)).toBeLessThanOrEqual(hi);
    }
    for (const id of ARRAY_IDS) {
      // Each grade starts where the one below ends.
      GRADE_IDS.slice(1).forEach((g, i) => {
        const below = ARRAYS[id].byGrade[GRADE_IDS[i] as GradeId];
        expect(ARRAYS[id].byGrade[g][0], `${id} ${g}`).toBeGreaterThanOrEqual(below[1]);
      });
    }
  });

  it('matches the docs/design.md table at both ends', () => {
    const disc = (grade: GradeId, array: Item['array'], baseRoll: number): Item => ({
      slot: 'attachment',
      name: namesFor('attachment', grade)[1] as string,
      level: 1,
      grade,
      baseRoll,
      affixes: [],
      array,
    });
    expect(arrayValue(disc('mortal', 'binding', 0))).toBe(0.5);
    expect(arrayValue(disc('immortal', 'binding', 1))).toBe(3);
    expect(arrayValue(disc('mortal', 'illusion', 0))).toBe(0.03);
    expect(arrayValue(disc('immortal', 'illusion', 1))).toBe(0.18);
    expect(arrayValue(disc('mortal', 'killing', 0))).toBe(0.05);
    expect(arrayValue(disc('immortal', 'killing', 1))).toBe(0.3);
    expect(arrayValue(disc('earth', 'killing', 0.5))).toBe(0.175);
  });

  it('adds no lifesteal: a disc carries its array instead', () => {
    const disc = discs.find((d) => d.affixes.length === 0) as Item;
    const gourd = attachments.find((d) => !isDisc(d) && d.affixes.length === 0) as Item;
    expect(equipmentBonuses({ attachment: disc }).lifesteal).toBe(0);
    expect(equipmentBonuses({ attachment: gourd }).lifesteal).toBeGreaterThan(0);
    expect(equippedArray({ attachment: disc })).toEqual({
      id: disc.array,
      value: arrayValue(disc),
    });
    expect(equippedArray({ attachment: gourd })).toBeNull();
    expect(equippedArray({})).toBeNull();
  });
});

describe('Charm lines', () => {
  const LINE_IDS = Object.keys(CHARM_LINES) as CharmLineId[];
  const UTILITY: AffixId[] = ['qiRegen', 'stoneFind', 'treasureFind'];
  const charms = MANY.filter((i) => i.slot === 'charm');
  const charm = (grade: GradeId, line: number, affixes: Item['affixes'] = []): Item => ({
    slot: 'charm',
    name: namesFor('charm', grade)[line] as string,
    level: 10,
    grade,
    baseRoll: 0.5,
    affixes,
  });

  it('matches the docs/design.md lines: names, favoured affixes and utility range', () => {
    expect(LINE_IDS).toEqual(['attack', 'defend', 'utility', 'jade']);
    expect(Object.values(CHARM_LINES)).toEqual([
      {
        name: 'Attack Talisman',
        favours: ['critChance', 'critDamage', 'attackSpeed'],
        utility: 0.75,
      },
      { name: 'Defend Talisman', favours: ['maxHp', 'defence', 'lifesteal'], utility: 0.75 },
      { name: 'Utility Talisman', favours: UTILITY, utility: 0.75 },
      { name: 'Jade Slip', favours: UTILITY, utility: 1.5 },
    ]);
    expect(FAVOURED_WEIGHT).toBe(3);
  });

  it('gives every name of every grade its line, in line order', () => {
    for (const g of GRADE_IDS) {
      LINE_IDS.forEach((line, i) => expect(charmLine(charm(g, i)), `${g} ${line}`).toBe(line));
      const [, , , jade] = namesFor('charm', g);
      expect(jade, g).toMatch(/Jade/);
      for (const name of namesFor('charm', g).slice(0, 3))
        expect(name, g).toMatch(/Talisman|Seal$/);
    }
  });

  it('has no line for other types, unknown names or a name on the wrong grade', () => {
    expect(charmLine({ slot: 'accessory', name: 'Paper Ward Talisman', grade: 'mortal' })).toBe(
      null,
    );
    expect(charmLine({ slot: 'charm', name: 'Paper Ward Talisman ', grade: 'mortal' })).toBe(null);
    expect(charmLine({ slot: 'charm', name: 'Phoenix Blood Jade', grade: 'mortal' })).toBe(null);
    expect(charmLine({ slot: 'charm', name: '__proto__', grade: 'mortal' })).toBe(null);
    expect(
      charmLine({ slot: 'charm', name: 'Paper Ward Talisman', grade: 'constructor' as GradeId }),
    ).toBe(null);
  });

  it('rolls every line of every grade, each about a quarter of the Charms (seeded)', () => {
    for (const g of GRADE_IDS) {
      const of = charms.filter((c) => c.grade === g);
      const lines = new Set(of.map((c) => charmLine(c)));
      expect(lines, g).toEqual(new Set(LINE_IDS));
    }
    for (const line of LINE_IDS) {
      const share = charms.filter((c) => charmLine(c) === line).length / charms.length;
      expect(share, line).toBeGreaterThan(0.23);
      expect(share, line).toBeLessThan(0.27);
    }
  });

  it('draws favoured affixes at the designed rate over 100k rolls', () => {
    // One affix from 9: three weigh 3 and six weigh 1, so each favoured one
    // comes up 3/15 of the time and each other one 1/15.
    for (const line of LINE_IDS) {
      const rng = createRng(77);
      const seen = new Map<AffixId, number>();
      for (let i = 0; i < N; i++) {
        const [a] = drawAffixes(rng, 1, line);
        seen.set(a?.id as AffixId, (seen.get(a?.id as AffixId) ?? 0) + 1);
      }
      for (const id of AFFIX_IDS) {
        const p = CHARM_LINES[line].favours.includes(id) ? 3 / 15 : 1 / 15;
        const got = (seen.get(id) ?? 0) / N;
        expect(Math.abs(got - p), `${line} ${id}`).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / N));
      }
    }
  });

  it('never repeats an affix, and can still roll every affix on every line', () => {
    const rng = createRng(5);
    for (const line of LINE_IDS) {
      const all = drawAffixes(rng, AFFIX_IDS.length, line).map((a) => a.id);
      expect(new Set(all).size).toBe(AFFIX_IDS.length);
    }
    for (const line of LINE_IDS) {
      const seen = new Set(
        charms.filter((c) => charmLine(c) === line).flatMap((c) => c.affixes.map((a) => a.id)),
      );
      expect(seen, line).toEqual(new Set(AFFIX_IDS));
    }
  });

  it("favours a line's affixes on seeded Charm drops", () => {
    for (const line of LINE_IDS) {
      const affixes = charms.filter((c) => charmLine(c) === line).flatMap((c) => c.affixes);
      const favoured = affixes.filter((a) => CHARM_LINES[line].favours.includes(a.id)).length;
      // An even draw would give 3/9; weighted it is well over that.
      expect(favoured / affixes.length, line).toBeGreaterThan(0.45);
    }
  });

  it('draws every other item evenly, with the same numbers as before the lines', () => {
    // The draw before the lines, written out: a non-Charm must roll as it did.
    const legacy = (rng: Rng, count: number) => {
      const pool = [...AFFIX_IDS];
      const out = [];
      for (let n = count; n > 0; n--) {
        const id = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        out.push({ id, roll: Math.floor(rng() * 101) / 100 });
      }
      return out;
    };
    for (let seed = 1; seed <= 200; seed++) {
      expect(drawAffixes(createRng(seed), 1 + (seed % 5), null)).toEqual(
        legacy(createRng(seed), 1 + (seed % 5)),
      );
    }
  });

  it('rolls utility affixes at 0.75x on a Talisman and 1.5x on a Jade Slip', () => {
    for (const id of UTILITY) {
      const top = { id, roll: 1 };
      const bottom = { id, roll: 0 };
      const full = rangeAt(AFFIXES[id], 10);
      for (const [line, k] of [
        [0, 0.75],
        [1, 0.75],
        [2, 0.75],
        [3, 1.5],
      ] as const) {
        const item = charm('earth', line, [top]);
        expect(affixScale(item, id)).toBe(k);
        // Within the 0.1% rounding of both ranges, scaled.
        expect(
          Math.abs(itemAffixValue(item, top) - full.hi * k),
          `${id} ${line}`,
        ).toBeLessThanOrEqual(0.0015);
        expect(
          Math.abs(itemAffixValue(item, bottom) - full.lo * k),
          `${id} ${line}`,
        ).toBeLessThanOrEqual(0.0015);
      }
    }
    // Spot values from docs/design.md: qi regen 2–6% at level 1.
    const at1 = (line: number, roll: number) =>
      itemAffixValue({ ...charm('mortal', line), level: 1 }, { id: 'qiRegen', roll });
    expect([at1(0, 0), at1(0, 1)]).toEqual([0.015, 0.045]);
    expect([at1(3, 0), at1(3, 1)]).toEqual([0.03, 0.09]);
  });

  it('leaves other affixes and other types at the full range', () => {
    const crit = { id: 'critChance' as const, roll: 1 };
    for (let line = 0; line < 4; line++) {
      expect(itemAffixValue(charm('heaven', line), crit)).toBe(affixValue(crit, 10));
    }
    const qi = { id: 'qiRegen' as const, roll: 1 };
    const ring: Item = { ...charm('heaven', 0), slot: 'accessory', name: 'Golden Sun Bell' };
    expect(affixScale(ring, 'qiRegen')).toBe(1);
    expect(itemAffixValue(ring, qi)).toBe(affixValue(qi, 10));
  });

  it('sums scaled utility affixes into the equipment bonuses', () => {
    const qi = { id: 'qiRegen' as const, roll: 1 };
    const tal = charm('spirit', 2, [qi]);
    const jade = charm('spirit', 3, [qi]);
    expect(equipmentBonuses({ charm1: tal }).qiRegen).toBe(itemAffixValue(tal, qi));
    expect(equipmentBonuses({ charm1: jade }).qiRegen).toBe(itemAffixValue(jade, qi));
    expect(equipmentBonuses({ charm1: jade }).qiRegen).toBeGreaterThan(
      equipmentBonuses({ charm1: tal }).qiRegen * 1.9,
    );
  });

  it('keeps the base stat and affix count per grade the same on every line', () => {
    for (const g of GRADE_IDS) {
      const counts = LINE_IDS.map(
        (line) =>
          new Set(
            charms
              .filter((c) => c.grade === g && charmLine(c) === line)
              .map((c) => c.affixes.length),
          ),
      );
      for (const c of counts) expect(c, g).toEqual(counts[0]);
    }
    const base = LINE_IDS.map((_, line) => baseValue(charm('earth', line)));
    expect(new Set(base).size).toBe(1);
  });
});
