// What the UI shows, worked out from game state. Pure: no DOM, so it can be
// unit-tested; the DOM layer (app.ts) only puts these strings on the page.

import {
  derive,
  xpToNext,
  type Cultivator,
  type Derived,
  type PathId,
} from '../core/cultivator.ts';
import { DEMONS_PER_WAVE, WAVES_PER_FLOOR } from '../core/floors.ts';
import {
  AFFIXES,
  affixValue,
  baseValue,
  GRADES,
  quality,
  SLOTS,
  UNIQUES,
  type BonusStat,
  type EquipSlotId,
  type Item,
  type SlotId,
} from '../core/loot.ts';
import type { GameState } from '../core/sim.ts';

/** The Path picker's one-liners: office cover, role, primary stat (docs/design.md §3). */
export const PATH_BLURBS: Readonly<Record<PathId, string>> = {
  sword: 'Sales · Fast hits, crit · Agility',
  body: 'Facilities · Tanky, lifesteal · Body',
  talisman: 'IT · Burst, area damage · Spirit',
};

const BONUS_LABELS: Readonly<Record<BonusStat, string>> = {
  damage: 'Damage',
  damagePct: 'Damage',
  maxHp: 'Max HP',
  maxHpPct: 'Max HP',
  defence: 'Defence',
  critChance: 'Crit chance',
  critDamage: 'Crit damage',
  attackSpeed: 'Attack speed',
  lifesteal: 'Lifesteal',
  qiRegen: 'Qi regen',
  stoneFind: 'Spirit stone find',
  treasureFind: 'Treasure find',
};

/** Bonuses kept as plain numbers; every other bonus is a share (0.05 is +5%). */
const FLAT: ReadonlySet<BonusStat> = new Set(['damage', 'maxHp', 'defence']);

/** Up to `digits` decimals, without trailing zeros. */
function num(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}

function signed(v: number, text: string): string {
  return v < 0 ? `−${text.replace('-', '')}` : `+${text}`;
}

/** One bonus as shown on an item, e.g. "+12.3 Damage" or "+1.5% Crit chance". */
export function formatBonus(stat: BonusStat, value: number): string {
  const text = FLAT.has(stat) ? num(value, 1) : `${num(value * 100, 1)}%`;
  return `${signed(value, text)} ${BONUS_LABELS[stat]}`;
}

/** Every line of an item card after its title: base stat, affixes, unique effect. */
export function itemLines(item: Item): string[] {
  const lines = [formatBonus(SLOTS[item.slot].base.stat, baseValue(item))];
  for (const a of item.affixes)
    lines.push(formatBonus(AFFIXES[a.id].stat, affixValue(a, item.level)));
  if (item.unique) {
    const u = UNIQUES[item.unique];
    lines.push(`${u.name}: ${formatBonus(u.stat, u.value)}`);
  }
  return lines;
}

/** The short tag under an item's name, e.g. "Heaven · Weapon · Lv 12 · 94%". */
export function itemTag(item: Item): string {
  return `${GRADES[item.grade].name} · ${SLOTS[item.slot].name} · Lv ${item.level} · ${quality(item)}%`;
}

interface StatRow {
  label: string;
  value: (d: Derived) => number;
  format: (v: number) => string;
  /** How a change in this stat reads, if not the same as `format`. */
  delta?: (v: number) => string;
}

/** The combat numbers on the character panel, in display order. */
export const STAT_ROWS: readonly StatRow[] = [
  { label: 'Max HP', value: (d) => d.maxHp, format: (v) => num(v, 0) },
  { label: 'Damage', value: (d) => d.damage, format: (v) => num(v, 1) },
  { label: 'Defence', value: (d) => d.defence, format: (v) => num(v, 1) },
  { label: 'Attacks/s', value: (d) => 1 / d.attackInterval, format: (v) => num(v, 2) },
  { label: 'Crit chance', value: (d) => d.critChance, format: (v) => `${num(v * 100, 1)}%` },
  {
    label: 'Crit damage',
    value: (d) => d.critMultiplier,
    format: (v) => `×${num(v, 2)}`,
    // Matches the item card: a +0.15 multiplier reads "+15% Crit damage".
    delta: (v) => `${num(v * 100, 1)}%`,
  },
  { label: 'Lifesteal', value: (d) => d.lifesteal, format: (v) => `${num(v * 100, 1)}%` },
  { label: 'Qi regen', value: (d) => d.qiRegen, format: (v) => `${num(v * 100, 1)}%` },
  { label: 'Spirit stone find', value: (d) => d.stoneFind, format: (v) => `${num(v * 100, 1)}%` },
  { label: 'Treasure find', value: (d) => d.treasureFind, format: (v) => `${num(v * 100, 1)}%` },
];

export function statRows(c: Cultivator): { label: string; value: string }[] {
  const d = derive(c);
  return STAT_ROWS.map((r) => ({ label: r.label, value: r.format(r.value(d)) }));
}

/**
 * What equipping `item` into position `to` would change, as signed lines such
 * as "+3.2 Damage"; `better` is true for a gain. Rows whose change rounds to
 * nothing are left out.
 */
export function compareToEquipped(
  c: Cultivator,
  item: Item,
  to: EquipSlotId,
): { text: string; better: boolean }[] {
  const now = derive(c);
  const next = derive({ ...c, equipment: { ...c.equipment, [to]: item } });
  const lines: { text: string; better: boolean }[] = [];
  for (const r of STAT_ROWS) {
    const fmt = r.delta ?? r.format;
    const change = r.value(next) - r.value(now);
    const text = fmt(Math.abs(change));
    if (text === fmt(0)) continue;
    lines.push({ text: `${signed(change, text)} ${r.label}`, better: change > 0 });
  }
  return lines;
}

/** Where the cultivator is on the floor: "Wave 2 / 3", "Elite" or "Boss". */
export function waveLabel(state: GameState): string {
  const waves = WAVES_PER_FLOOR * DEMONS_PER_WAVE;
  const defeated = waves + 2 - state.enemies.length;
  if (defeated < waves)
    return `Wave ${Math.floor(defeated / DEMONS_PER_WAVE) + 1} / ${WAVES_PER_FLOOR}`;
  return defeated === waves ? 'Elite' : 'Boss';
}

/** XP towards the next level, e.g. "37 / 60". */
export function xpLabel(c: Cultivator): string {
  return `${Math.floor(c.xp)} / ${xpToNext(c.level)}`;
}

/** Items `tick` picked up between two states, newest first. tick() only appends to the bag. */
export function freshDrops(prev: GameState, next: GameState): Item[] {
  return next.inventory.slice(prev.inventory.length).reverse();
}

/** The short code on an item's grid cell, standing in until item icons exist. */
export const SLOT_CODES: Readonly<Record<SlotId, string>> = {
  head: 'Hd',
  chest: 'Cht',
  pants: 'Pnt',
  attachment: 'Att',
  weapon: 'Wpn',
  sideArm: 'Sde',
  accessory: 'Acc',
  charm: 'Chm',
};

/** A grid cell's accessible name: everything its colour and codes show, in words. */
export function cellLabel(item: Item): string {
  return `${item.name}, ${itemTag(item)}`;
}

/**
 * Where an arrow / Home / End key moves the grid cursor from `index`, in a grid
 * of `size` cells and `cols` columns. Stays put at an edge; other keys: null.
 */
export function gridMove(index: number, key: string, size: number, cols: number): number | null {
  const moves: Record<string, number> = {
    ArrowLeft: index % cols === 0 ? index : index - 1,
    ArrowRight: index % cols === cols - 1 || index === size - 1 ? index : index + 1,
    ArrowUp: index - cols >= 0 ? index - cols : index,
    ArrowDown: index + cols < size ? index + cols : index,
    Home: index - (index % cols),
    End: Math.min(size - 1, index - (index % cols) + cols - 1),
  };
  return moves[key] ?? null;
}
