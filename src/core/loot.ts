// Loot: seeded item rolls, grades, affixes and quality (docs/design.md §6).
// Every number here is a starting point for balancing.
//
// An item stores its rolls, not its values: each roll is a position in [0, 1]
// within a range set by the item level. Values and quality are worked out from
// the rolls, so they can't drift from each other.

import { chance, int, pick, type Rng } from './rng.ts';

/** An item's type; it decides which equipment positions take the item. */
export type SlotId =
  'head' | 'chest' | 'pants' | 'attachment' | 'weapon' | 'sideArm' | 'accessory' | 'charm';
/** A position on the cultivator. Accessories and charms have two each. */
export type EquipSlotId =
  | 'head'
  | 'chest'
  | 'pants'
  | 'attachment'
  | 'weapon'
  | 'sideArm'
  | 'accessory1'
  | 'accessory2'
  | 'charm1'
  | 'charm2';
export type GradeId = 'mortal' | 'spirit' | 'earth' | 'heaven' | 'immortal';
export type AffixId =
  | 'critChance'
  | 'critDamage'
  | 'attackSpeed'
  | 'lifesteal'
  | 'maxHp'
  | 'defence'
  | 'qiRegen'
  | 'stoneFind'
  | 'treasureFind';
export type UniqueId = 'synergy' | 'parachute' | 'overtime';

/** Everything an item can add to the cultivator. Shares are fractions: 0.05 is +5%. */
export type BonusStat = AffixId | 'damage' | 'damagePct' | 'maxHpPct';
export type Bonuses = Record<BonusStat, number>;

export interface Affix {
  id: AffixId;
  /** Position in the affix's range: 0 is the minimum, 1 the maximum. */
  roll: number;
}

export interface Item {
  slot: SlotId;
  name: string;
  /** The floor it dropped on; it scales every range. */
  level: number;
  grade: GradeId;
  /** Position in the base stat's range: 0 is the minimum, 1 the maximum. */
  baseRoll: number;
  affixes: Affix[];
  /** Immortal grade only. */
  unique?: UniqueId;
}

export type Equipment = Partial<Record<EquipSlotId, Item>>;

/**
 * How a range grows with item level. Flat stats grow in step with the level;
 * shares grow slower so they stay sane on deep floors.
 */
type Scale = 'flat' | 'share';

interface RangeDef {
  readonly stat: BonusStat;
  readonly scale: Scale;
  /** The range at item level 1 for a share, or per item level for a flat stat. */
  readonly lo: number;
  readonly hi: number;
}

export const SLOTS: Readonly<
  Record<SlotId, { name: string; base: RangeDef; names: readonly string[] }>
> = {
  head: {
    name: 'Head',
    base: { stat: 'defence', scale: 'flat', lo: 0.2, hi: 0.4 },
    names: ['Headset of Clarity', 'Thinking Cap', 'Jade Hair Crown'],
  },
  chest: {
    name: 'Chest',
    base: { stat: 'defence', scale: 'flat', lo: 0.4, hi: 0.7 },
    names: ['Silk Cardigan', 'Pinstripe Daoist Robe', 'Casual-Friday Vestment'],
  },
  pants: {
    name: 'Pants',
    base: { stat: 'maxHp', scale: 'flat', lo: 2, hi: 4 },
    names: ['Slacks of Stillness', 'Pleated Dao Trousers', 'Khaki Leggings'],
  },
  attachment: {
    name: 'Attachment',
    base: { stat: 'lifesteal', scale: 'share', lo: 0.01, hi: 0.02 },
    names: ['Coffee Gourd', 'Thermos of Elixirs', 'Break-Room Calabash'],
  },
  // A Jade Stapler rolls 8–14 damage at item level 10.
  weapon: {
    name: 'Weapon',
    base: { stat: 'damage', scale: 'flat', lo: 0.8, hi: 1.4 },
    names: ['Jade Stapler', 'Letter-Opener Sword', 'Spirit Ruler'],
  },
  sideArm: {
    name: 'Side arm',
    base: { stat: 'damage', scale: 'flat', lo: 0.5, hi: 0.9 },
    names: ['Stapler Dagger', 'Laser-Pointer Wand', 'Hole-Punch Knuckle'],
  },
  accessory: {
    name: 'Accessory',
    base: { stat: 'maxHp', scale: 'flat', lo: 4, hi: 7 },
    names: ['Lanyard Pendant', 'Badge of the Dao', 'Key-Card Amulet'],
  },
  charm: {
    name: 'Charm',
    base: { stat: 'critChance', scale: 'share', lo: 0.004, hi: 0.008 },
    names: ['Sticky-Note Talisman', 'Laminated Seal', 'Post-Meeting Charm'],
  },
};

/** Every equipment position and the item type it takes, in display order. */
export const EQUIP_SLOTS: Readonly<Record<EquipSlotId, { name: string; takes: SlotId }>> = {
  head: { name: 'Head', takes: 'head' },
  chest: { name: 'Chest', takes: 'chest' },
  pants: { name: 'Pants', takes: 'pants' },
  attachment: { name: 'Attachment', takes: 'attachment' },
  weapon: { name: 'Weapon', takes: 'weapon' },
  sideArm: { name: 'Side arm', takes: 'sideArm' },
  accessory1: { name: 'Accessory 1', takes: 'accessory' },
  accessory2: { name: 'Accessory 2', takes: 'accessory' },
  charm1: { name: 'Charm 1', takes: 'charm' },
  charm2: { name: 'Charm 2', takes: 'charm' },
};

/** The positions an item type fits, in the order they fill. */
export function slotsFor(type: SlotId): EquipSlotId[] {
  return (Object.keys(EQUIP_SLOTS) as EquipSlotId[]).filter((p) => EQUIP_SLOTS[p].takes === type);
}

/** Where equipping `item` goes when no position is chosen: the first free one, else the first. */
export function defaultSlot(equipment: Equipment, item: Item): EquipSlotId {
  const fits = slotsFor(item.slot);
  return (fits.find((p) => !equipment[p]) ?? fits[0]) as EquipSlotId;
}

export const GRADES: Readonly<
  Record<GradeId, { name: string; weight: number; affixes: readonly [number, number] }>
> = {
  // Weights are per 1000 drops: 60%, 28%, 9%, 2.7%, 0.3%.
  mortal: { name: 'Mortal', weight: 600, affixes: [0, 0] },
  spirit: { name: 'Spirit', weight: 280, affixes: [1, 2] },
  earth: { name: 'Earth', weight: 90, affixes: [3, 4] },
  heaven: { name: 'Heaven', weight: 27, affixes: [4, 5] },
  immortal: { name: 'Immortal', weight: 3, affixes: [5, 5] },
};

export const AFFIXES: Readonly<Record<AffixId, RangeDef & { name: string }>> = {
  critChance: { name: 'Crit chance', stat: 'critChance', scale: 'share', lo: 0.005, hi: 0.015 },
  critDamage: { name: 'Crit damage', stat: 'critDamage', scale: 'share', lo: 0.05, hi: 0.15 },
  attackSpeed: { name: 'Attack speed', stat: 'attackSpeed', scale: 'share', lo: 0.02, hi: 0.06 },
  lifesteal: { name: 'Lifesteal', stat: 'lifesteal', scale: 'share', lo: 0.01, hi: 0.03 },
  maxHp: { name: 'Max HP', stat: 'maxHp', scale: 'flat', lo: 2, hi: 5 },
  defence: { name: 'Defence', stat: 'defence', scale: 'flat', lo: 0.2, hi: 0.5 },
  qiRegen: { name: 'Qi regen', stat: 'qiRegen', scale: 'share', lo: 0.02, hi: 0.06 },
  stoneFind: { name: 'Spirit stone find', stat: 'stoneFind', scale: 'share', lo: 0.05, hi: 0.15 },
  treasureFind: {
    name: 'Treasure find',
    stat: 'treasureFind',
    scale: 'share',
    lo: 0.03,
    hi: 0.1,
  },
};

export const UNIQUES: Readonly<Record<UniqueId, { name: string; stat: BonusStat; value: number }>> =
  {
    synergy: { name: 'Synergy of the Dao', stat: 'damagePct', value: 0.25 },
    parachute: { name: 'Golden Parachute', stat: 'maxHpPct', value: 0.25 },
    overtime: { name: 'Unpaid Overtime', stat: 'attackSpeed', value: 0.25 },
  };

/** Chance that a kill drops an item; bosses have better odds. */
export const DROP_CHANCE = { demon: 0.04, elite: 0.25, boss: 0.5, tribulation: 1 } as const;

const SLOT_IDS = Object.keys(SLOTS) as SlotId[];
const EQUIP_SLOT_IDS = Object.keys(EQUIP_SLOTS) as EquipSlotId[];
const GRADE_IDS = Object.keys(GRADES) as GradeId[];
const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];
const UNIQUE_IDS = Object.keys(UNIQUES) as UniqueId[];
const WEIGHT_TOTAL = GRADE_IDS.reduce((sum, g) => sum + GRADES[g].weight, 0);

/** A roll in [0, 1] in steps of 1%, so both ends can be rolled. */
function roll(rng: Rng): number {
  return int(rng, 0, 100) / 100;
}

/**
 * Flat stats are kept to 0.1 and shares to 0.1%, so even level-1 ranges are
 * wide enough for quality to mean a better stat.
 */
function round(scale: Scale, v: number): number {
  const step = scale === 'flat' ? 10 : 1000;
  return Math.round(v * step) / step;
}

/** The [lo, hi] a range covers at an item level, already rounded. */
export function rangeAt(def: RangeDef, level: number): { lo: number; hi: number } {
  const k = def.scale === 'flat' ? level : 1 + (level - 1) / 20;
  return { lo: round(def.scale, def.lo * k), hi: round(def.scale, def.hi * k) };
}

function valueAt(def: RangeDef, level: number, r: number): number {
  const { lo, hi } = rangeAt(def, level);
  return round(def.scale, lo + r * (hi - lo));
}

export function baseValue(item: Item): number {
  return valueAt(SLOTS[item.slot].base, item.level, item.baseRoll);
}

export function affixValue(affix: Affix, level: number): number {
  return valueAt(AFFIXES[affix.id], level, affix.roll);
}

/**
 * How close the item rolled to its maxima, as a whole percent: 0 all minimum,
 * 100 only when every roll is a maximum (rounded down, so 99.5% shows 99).
 */
export function quality(item: Item): number {
  // Rolls are whole percents; summing them as integers avoids float drift.
  const rolls = [item.baseRoll, ...item.affixes.map((a) => a.roll)];
  return Math.floor(rolls.reduce((sum, r) => sum + Math.round(r * 100), 0) / rolls.length);
}

export function rollGrade(rng: Rng): GradeId {
  let n = int(rng, 0, WEIGHT_TOTAL - 1);
  for (const g of GRADE_IDS) {
    n -= GRADES[g].weight;
    if (n < 0) return g;
  }
  throw new Error('rollGrade: weights do not cover the roll');
}

export function rollItem(rng: Rng, level: number): Item {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`rollItem: bad level ${level}`);
  const slot = pick(rng, SLOT_IDS);
  const grade = rollGrade(rng);
  const item: Item = {
    slot,
    name: pick(rng, SLOTS[slot].names),
    level,
    grade,
    baseRoll: roll(rng),
    affixes: [],
  };
  // Draw affixes without replacement: one item never has the same affix twice.
  const pool = [...AFFIX_IDS];
  const [min, max] = GRADES[grade].affixes;
  for (let n = int(rng, min, max); n > 0; n--) {
    const id = pool.splice(int(rng, 0, pool.length - 1), 1)[0] as AffixId;
    item.affixes.push({ id, roll: roll(rng) });
  }
  if (grade === 'immortal') item.unique = pick(rng, UNIQUE_IDS);
  return item;
}

/** Rolls whether a kill drops an item and, if so, the item. Treasure find raises the odds. */
export function rollDrop(
  rng: Rng,
  kind: keyof typeof DROP_CHANCE,
  floor: number,
  treasureFind: number,
): Item | null {
  if (!chance(rng, DROP_CHANCE[kind] * (1 + treasureFind))) return null;
  return rollItem(rng, floor);
}

/** The sum of everything the equipped items add. */
export function equipmentBonuses(equipment: Equipment): Bonuses {
  const b: Bonuses = {
    damage: 0,
    damagePct: 0,
    maxHpPct: 0,
    critChance: 0,
    critDamage: 0,
    attackSpeed: 0,
    lifesteal: 0,
    maxHp: 0,
    defence: 0,
    qiRegen: 0,
    stoneFind: 0,
    treasureFind: 0,
  };
  // In position order, not the order items were put on: float sums depend on
  // order, and a loaded save must derive the exact same numbers as the live run.
  for (const at of EQUIP_SLOT_IDS) {
    const item = equipment[at];
    if (!item) continue;
    b[SLOTS[item.slot].base.stat] += baseValue(item);
    for (const a of item.affixes) b[AFFIXES[a.id].stat] += affixValue(a, item.level);
    if (item.unique) b[UNIQUES[item.unique].stat] += UNIQUES[item.unique].value;
  }
  return b;
}
