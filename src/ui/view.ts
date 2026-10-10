// What the UI shows, worked out from game state. Pure: no DOM, so it can be
// unit-tested; the DOM layer (app.ts) only puts these strings on the page.

import {
  derive,
  readyForTribulation,
  realmOf,
  REALMS,
  xpToNext,
  type Cultivator,
  type Derived,
  type PathId,
} from '../core/cultivator.ts';
import { DEMONS_PER_WAVE, TRIBULATIONS, WAVES_PER_FLOOR, type EnemyKind } from '../core/floors.ts';
import {
  AFFIXES,
  affixValue,
  arrayValue,
  ARRAYS,
  equippedArray,
  baseValue,
  GRADES,
  OFFLINE_DROP_MULTIPLIER,
  quality,
  SLOTS,
  UNIQUES,
  type BonusStat,
  type EquipSlotId,
  type ArrayId,
  type GradeId,
  type Item,
  type SlotId,
} from '../core/loot.ts';
import type { OvertimeSummary } from '../core/offline.ts';
import {
  noPassives,
  passiveCost,
  passiveTreasureFind,
  PASSIVES,
  RETIRE_MIN_FLOOR,
  type PassiveId,
  type Passives,
  type RetirePreview,
} from '../core/prestige.ts';
import { canEquip, canFaceTribulation, requiredRealm, type GameState } from '../core/sim.ts';

/** The Path picker's one-liners: office cover, role, primary stat (docs/design.md §3). */
export const PATH_BLURBS: Readonly<Record<PathId, string>> = {
  sword: 'Sales · Fast hits, crit, a little lifesteal · Agility',
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

/** What an array of strength `value` does, e.g. "Illusion Array: enemy attacks miss 4.2% of the time". */
export function arrayLine(id: ArrayId, value: number): string {
  const effect = {
    binding: `the enemy's first attack comes ${num(value, 2)} s later`,
    illusion: `enemy attacks miss ${num(value * 100, 1)}% of the time`,
    killing: `the enemy takes ${num(value * 100, 1)}% of your damage per second`,
  }[id];
  return `${ARRAYS[id].name}: ${effect}`;
}

/** Every line of an item card after its title: base stat (a disc's array), affixes, unique effect. */
export function itemLines(item: Item): string[] {
  const lines = [
    item.array
      ? arrayLine(item.array, arrayValue(item))
      : formatBonus(SLOTS[item.slot].base.stat, baseValue(item)),
  ];
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

/** A weapon's treasure tier by grade (docs/design.md §6): what kind of magic tool it is. */
const TREASURE_TIERS: Readonly<Record<GradeId, string>> = {
  mortal: 'Magic Tool',
  spirit: 'Magic Tool',
  earth: 'Spirit Treasure',
  heaven: 'Spirit Treasure',
  immortal: 'Immortal Treasure',
};

/** The treasure tier line in an item's details, for weapons only; null for other types. */
export function treasureTier(item: Item): string | null {
  if (item.slot !== 'weapon' || !Object.hasOwn(TREASURE_TIERS, item.grade)) return null;
  return TREASURE_TIERS[item.grade];
}

/**
 * Why the cultivator can't equip `item` yet, e.g. "Requires Foundation
 * Establishment"; null when they can (docs/design.md §6).
 */
export function equipBlock(c: Cultivator, item: Item): string | null {
  if (canEquip(c, item)) return null;
  return `Requires ${(REALMS[requiredRealm(item)] as (typeof REALMS)[number]).name}`;
}

/** The Stats tab's groups of derived numbers, in display order. */
export const STAT_GROUPS = ['Offence', 'Defence', 'Find'] as const;
export type StatGroup = (typeof STAT_GROUPS)[number];

interface StatRow {
  label: string;
  /** The label under its group heading, if shorter than `label`. */
  short?: string;
  group: StatGroup;
  value: (d: Derived) => number;
  format: (v: number) => string;
  /** How a change in this stat reads, if not the same as `format`. */
  delta?: (v: number) => string;
}

/** The combat numbers on the character panel, in display order. */
export const STAT_ROWS: readonly StatRow[] = [
  { label: 'Max HP', group: 'Defence', value: (d) => d.maxHp, format: (v) => num(v, 0) },
  { label: 'Damage', group: 'Offence', value: (d) => d.damage, format: (v) => num(v, 1) },
  { label: 'Defence', group: 'Defence', value: (d) => d.defence, format: (v) => num(v, 1) },
  {
    label: 'Attacks/s',
    group: 'Offence',
    value: (d) => 1 / d.attackInterval,
    format: (v) => num(v, 2),
  },
  {
    label: 'Crit chance',
    group: 'Offence',
    value: (d) => d.critChance,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'Crit damage',
    group: 'Offence',
    value: (d) => d.critMultiplier,
    format: (v) => `×${num(v, 2)}`,
    // Matches the item card: a +0.15 multiplier reads "+15% Crit damage".
    delta: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'Lifesteal',
    group: 'Defence',
    value: (d) => d.lifesteal,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'Qi regen',
    group: 'Defence',
    value: (d) => d.qiRegen,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'Spirit stone find',
    short: 'Spirit stones',
    group: 'Find',
    value: (d) => d.stoneFind,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'Treasure find',
    short: 'Treasure',
    group: 'Find',
    value: (d) => d.treasureFind,
    format: (v) => `${num(v * 100, 1)}%`,
  },
];

/** The cultivator's numbers, with the passives that change them (treasure find). */
export function statRows(
  c: Cultivator,
  passives: Passives = noPassives(),
): { label: string; short: string; group: StatGroup; value: string }[] {
  const d = derive(c);
  d.treasureFind += passiveTreasureFind(passives);
  return STAT_ROWS.map((r) => ({
    label: r.label,
    short: r.short ?? r.label,
    group: r.group,
    value: r.format(r.value(d)),
  }));
}

/** A Respec action (stat reset, Path change): its cost, whether it is off, and why. */
export function respecView(
  cost: number,
  stones: number,
  nothingToDo = false,
): { cost: string; off: boolean; why: string } {
  const why = nothingToDo ? 'Nothing to reset' : stones < cost ? `Need ${cost - stones} more` : '';
  return { cost: `${cost} Spirit Stones`, off: why !== '', why };
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
  return [...lines, ...compareArrays(c.equipment[to], item)];
}

/** An array's strength in short, e.g. "1.75 s" or "9.5%". */
function arrayAmount(id: ArrayId, value: number): string {
  return id === 'binding' ? `${num(value, 2)} s` : `${num(value * 100, 1)}%`;
}

/** How the array changes when `next` replaces `now`: stronger or weaker, or one gained and one lost. */
function compareArrays(now: Item | undefined, next: Item): { text: string; better: boolean }[] {
  const was = now?.array ? { id: now.array, value: arrayValue(now) } : null;
  const will = next.array ? { id: next.array, value: arrayValue(next) } : null;
  if (was && will && was.id === will.id) {
    const change = will.value - was.value;
    const text = arrayAmount(will.id, Math.abs(change));
    if (text === arrayAmount(will.id, 0)) return [];
    return [{ text: `${signed(change, text)} ${ARRAYS[will.id].name}`, better: change > 0 }];
  }
  const lines: { text: string; better: boolean }[] = [];
  if (will) {
    const amount = arrayAmount(will.id, will.value);
    lines.push({ text: `+${ARRAYS[will.id].name} (${amount})`, better: true });
  }
  if (was) {
    const amount = arrayAmount(was.id, was.value);
    lines.push({ text: `−${ARRAYS[was.id].name} (${amount})`, better: false });
  }
  return lines;
}

/** Where the cultivator is on the floor: "Wave 2 / 3", "Elite", "Boss" or "Tribulation". */
export function waveLabel(state: GameState): string {
  if (state.enemies[0]?.kind === 'tribulation') return 'Tribulation';
  const waves = WAVES_PER_FLOOR * DEMONS_PER_WAVE;
  const left = state.enemies.filter((e) => e.kind !== 'tribulation').length;
  const defeated = waves + 2 - left;
  if (defeated < waves)
    return `Wave ${Math.floor(defeated / DEMONS_PER_WAVE) + 1} / ${WAVES_PER_FLOOR}`;
  return defeated === waves ? 'Elite' : 'Boss';
}

/** XP towards the next level, e.g. "37 / 60"; at a realm cap, "480 / 400 · Tribulation due". */
export function xpLabel(c: Cultivator): string {
  const xp = `${Math.floor(c.xp)} / ${xpToNext(c.level)}`;
  return readyForTribulation(c) ? `${xp} · Tribulation due` : xp;
}

/**
 * The Tribulation alert, while one is due and not yet being fought: its name
 * and the realm a win reaches, e.g. { name: "Probation Review", next:
 * "Foundation Establishment" }. Null otherwise.
 */
export function tribulationCall(state: GameState): { name: string; next: string } | null {
  if (!canFaceTribulation(state)) return null;
  const realm = realmOf(state.cultivator.level);
  const name = TRIBULATIONS[realm];
  const next = REALMS[realmOf(state.cultivator.level + 1)];
  return name === undefined || next === undefined ? null : { name, next: next.name };
}

/**
 * True when a Tribulation falls due between two states: the cultivator has just
 * reached it. A lost one coming round again doesn't count, so it never repeats.
 */
export function tribulationFellDue(prev: GameState, next: GameState): boolean {
  return !readyForTribulation(prev.cultivator) && readyForTribulation(next.cultivator);
}

/**
 * The stage banner for a Tribulation moment between two states: it falls due,
 * begins (clicked or reached at the floor's end), is won, or is lost. Null otherwise.
 */
export function tribulationBanner(prev: GameState, next: GameState): string | null {
  const before = prev.enemies[0];
  const now = next.enemies[0];
  if (realmOf(next.cultivator.level) > realmOf(prev.cultivator.level)) {
    const realm = REALMS[realmOf(next.cultivator.level)];
    return realm ? `Breakthrough! ${realm.name}` : null;
  }
  if (before?.kind === 'tribulation' && next.deaths > prev.deaths) {
    return `${before.name} stands. The floor replays.`;
  }
  if (now?.kind === 'tribulation' && before?.kind !== 'tribulation') {
    return `Tribulation begins: ${now.name}`;
  }
  const call = tribulationFellDue(prev, next) ? tribulationCall(next) : null;
  return call ? `Tribulation due: ${call.name}` : null;
}

/** The realm, with the job title beside it: "Foundation Establishment · Associate". */
export function realmLabel(level: number): string {
  const realm = REALMS[realmOf(level)] as (typeof REALMS)[number];
  return realm.title ? `${realm.name} · ${realm.title}` : realm.name;
}

/** Items `tick` picked up between two states, newest first. tick() only appends to the bag. */
export function freshDrops(prev: GameState, next: GameState): Item[] {
  return next.inventory.slice(prev.inventory.length).reverse();
}

/** The bulk-sell confirmation, e.g. "Sell 12 items (best: Spirit) for 340 Spirit Stones?". */
export function sellBelowLabel(p: {
  count: number;
  highest: GradeId | null;
  stones: number;
}): string {
  if (p.count === 0 || p.highest === null) return 'Nothing to sell below that grade.';
  const items = p.count === 1 ? '1 item' : `${p.count} items`;
  return `Sell ${items} (highest grade: ${GRADES[p.highest].name}) for ${p.stones} Spirit Stones?`;
}

/** Item types in the icon atlas's column order (tools/art/manifest.json "icons"). */
export const ICON_COLUMNS: readonly SlotId[] = [
  'head',
  'chest',
  'boots',
  'attachment',
  'weapon',
  'sideArm',
  'accessory',
  'charm',
];

/** Rows in the icon atlas: one per name of the type with the most names. */
export const ICON_ROWS = Math.max(...ICON_COLUMNS.map((s) => SLOTS[s].names.length));

/**
 * An item's cell in the icon atlas: its type's column, and the row of its name's
 * material (one row per name, in the order loot.ts lists them). An unknown
 * name, from an old save, gets the first material.
 */
export function iconCell(item: Item): { col: number; row: number } {
  const col = Math.max(0, ICON_COLUMNS.indexOf(item.slot));
  const row = Math.max(0, SLOTS[item.slot]?.names.indexOf(item.name) ?? 0);
  return { col, row };
}

/** A sprite sheet's frame size in px, by who is in it. */
export const SPRITE_SIZE: Readonly<Record<EnemyKind | 'path', number>> = {
  path: 128,
  demon: 128,
  elite: 160,
  boss: 192,
  tribulation: 192,
};

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * The sprite sheet an enemy uses, e.g. "demon-inbox-hydra", "elite-inbox-hydra"
 * or "boss-the-auditor". Elites are named "Elite <demon>" and share its art.
 */
export function enemySprite(kind: EnemyKind, name: string): string {
  return `${kind}-${slug(kind === 'elite' ? name.replace(/^Elite /, '') : name)}`;
}

/** What the strip plays between two states; all of it was decided by the sim. */
export interface StripEvents {
  youAttack: boolean;
  foeAttack: boolean;
  youHit: boolean;
  foeHit: boolean;
  youDied: boolean;
  /** The enemy that just died, for its death animation; the next one is already in front. */
  foeDied: { kind: EnemyKind; name: string } | null;
}

export function stripEvents(prev: GameState, next: GameState): StripEvents {
  const youDied = next.deaths > prev.deaths;
  const killed = next.kills > prev.kills;
  const before = prev.enemies[0];
  const now = next.enemies[0];
  // A kill or a death restarts the timers, so only a timer that moved on its own is an attack.
  const youAttack = !youDied && next.cultivator.nextAttackAt !== prev.cultivator.nextAttackAt;
  const foeAttack = !youDied && !killed && next.enemyNextAttackAt !== prev.enemyNextAttackAt;
  return {
    youAttack,
    foeAttack,
    youHit: !youDied && next.cultivator.hp < prev.cultivator.hp,
    foeHit: !killed && !youDied && !!before && !!now && now.hp < before.hp,
    youDied,
    foeDied: killed && before ? { kind: before.kind, name: before.name } : null,
  };
}

/**
 * The array set up as a fight starts between two states, e.g. "Killing Array
 * set up"; null when no fight started or no disc is equipped.
 */
export function arraySetUp(prev: GameState, next: GameState): string | null {
  const faced = next.enemies[0]?.kind === 'tribulation' && prev.enemies[0]?.kind !== 'tribulation';
  if (next.kills === prev.kills && next.deaths === prev.deaths && !faced) return null;
  const array = equippedArray(next.cultivator.equipment);
  return array ? `${ARRAYS[array.id].name} set up` : null;
}

/** A grid cell's accessible name: everything its colour, initial and icon show, in words. */
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

/** A time away, e.g. "45 s", "12 min" or "2 h 5 min". */
export function durationLabel(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** The Overtime Cultivation summary, one line per count. */
export function overtimeLines(summary: OvertimeSummary): string[] {
  const away = `Away ${durationLabel(summary.seconds)}`;
  const lines = [
    summary.capped ? `Away more than ${durationLabel(summary.seconds)} (the most replayed)` : away,
    `Floors climbed: ${summary.floorsClimbed}`,
    `Levels gained: ${summary.levels}`,
    `Kills: ${summary.kills}`,
    `Drops kept: ${summary.dropsKept}`,
  ];
  if (summary.dropsSold > 0) lines.push(`Drops sold: ${summary.dropsSold}`);
  if (summary.dropsSalvaged > 0) lines.push(`Drops salvaged: ${summary.dropsSalvaged}`);
  lines.push(`Spirit Stones: +${summary.stones}`);
  if (summary.essence > 0) lines.push(`Spirit Essence: +${summary.essence}`);
  // So a lower drop count isn't read as a bug.
  lines.push(
    `Items drop at ${Math.round(OFFLINE_DROP_MULTIPLIER * 100)}% of the usual rate while away. Keep the tab open for more loot.`,
  );
  return lines;
}

/** How a passive's row looks: affordable, too dear, or at max rank. */
export type PassiveState = 'can' | 'cant' | 'max';

/** A passive's shop row: name and rank, the buy button, and the detail shown on expand. */
export interface PassiveRow {
  name: string;
  /** e.g. "2/20". */
  rank: string;
  state: PassiveState;
  /** The button's text, e.g. "Buy 8" or "Max". */
  buy: string;
  /** The button's accessible name; starts with its text. */
  buyName: string;
  /** e.g. "+10% XP per rank. Next rank: 8 Dao Insight." */
  detail: string;
}

export function passiveRow(passives: Passives, insight: number, id: PassiveId): PassiveRow {
  const p = PASSIVES[id];
  const rank = passives[id];
  const cost = passiveCost(passives, id);
  const rankText = `${rank}/${p.maxRank}`;
  if (cost === null) {
    return {
      name: p.name,
      rank: rankText,
      state: 'max',
      buy: 'Max',
      buyName: `Max: ${p.name} is at rank ${rank} of ${p.maxRank}`,
      detail: `${p.perRankText} per rank. Max rank.`,
    };
  }
  return {
    name: p.name,
    rank: rankText,
    state: insight >= cost ? 'can' : 'cant',
    buy: `Buy ${cost}`,
    buyName: `Buy ${cost} Dao Insight: ${p.name} rank ${rank + 1} of ${p.maxRank}`,
    detail: `${p.perRankText} per rank. Next rank: ${cost} Dao Insight.`,
  };
}

/** The Early Retirement button, or why it is off. */
export function retireLabel(p: RetirePreview): string {
  return p.insight > 0 ? 'Retire early…' : `Reach floor ${RETIRE_MIN_FLOOR} to retire early`;
}

/** The Early Retirement confirmation: what is kept and what is lost, one short line each. */
export function retireLines(p: RetirePreview): { kept: string[]; lost: string[] } {
  const lost = [
    `Level ${p.level}, floor ${p.highestFloor}`,
    p.items === 1 ? '1 item (bag and worn)' : `${p.items} items (bag and worn)`,
    `${p.stones} Spirit Stones`,
    `${p.essence} Spirit Essence`,
  ];
  if (p.bagCells > 0) lost.push(`${p.bagCells} bought bag slots`);
  return {
    kept: [
      `+${p.insight} Dao Insight (${p.insightAfter} total)`,
      'Passives',
      'Path and auto filter',
    ],
    lost,
  };
}
