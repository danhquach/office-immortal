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
  PATHS,
  type PathId,
} from '../core/cultivator.ts';
import { INVENTORY_SIZE } from '../core/economy.ts';
import { DEMONS_PER_WAVE, TRIBULATIONS, WAVES_PER_FLOOR, type EnemyKind } from '../core/floors.ts';
import {
  AFFIXES,
  arrayValue,
  ARRAYS,
  equippedArray,
  baseValue,
  CHARM_LINES,
  charmLine,
  isBanner,
  itemAffixValue,
  itemPath,
  GRADES,
  OFFLINE_DROP_MULTIPLIER,
  quality,
  SLOTS,
  SOUL_CAPS,
  soulDamage,
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
import { t, tn, type MessageKey } from './i18n.ts';

/** The Path picker's one-liner: office cover, role, primary stat (docs/design.md §3). */
export function pathBlurb(id: PathId): string {
  return t(`pathBlurb.${id}`);
}

const BONUS_LABELS: Readonly<Record<BonusStat, MessageKey>> = {
  damage: 'bonus.damage',
  damagePct: 'bonus.damage',
  maxHp: 'bonus.maxHp',
  maxHpPct: 'bonus.maxHp',
  defence: 'bonus.defence',
  critChance: 'bonus.critChance',
  critDamage: 'bonus.critDamage',
  attackSpeed: 'bonus.attackSpeed',
  lifesteal: 'bonus.lifesteal',
  qiRegen: 'bonus.qiRegen',
  stoneFind: 'bonus.stoneFind',
  treasureFind: 'bonus.treasureFind',
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
  return `${signed(value, text)} ${t(BONUS_LABELS[stat])}`;
}

/** What an array of strength `value` does, e.g. "Illusion Array: enemy attacks miss 4.2% of the time". */
export function arrayLine(id: ArrayId, value: number): string {
  const v = id === 'binding' ? num(value, 2) : num(value * 100, 1);
  return `${tn('array', ARRAYS[id].name)}: ${t(`array.${id}`, { v })}`;
}

/** Every line of an item card after its title: base stat (a disc's array), affixes, unique effect. */
export function itemLines(item: Item): string[] {
  const lines = [
    item.array
      ? arrayLine(item.array, arrayValue(item))
      : formatBonus(SLOTS[item.slot].base.stat, baseValue(item)),
  ];
  for (const a of item.affixes)
    lines.push(formatBonus(AFFIXES[a.id].stat, itemAffixValue(item, a)));
  if (item.unique) {
    const u = UNIQUES[item.unique];
    lines.push(`${tn('unique', u.name)}: ${formatBonus(u.stat, u.value)}`);
  }
  return lines;
}

/** The short tag under an item's name, e.g. "Heaven · Weapon · Lv 12 · 94%". */
export function itemTag(item: Item): string {
  return t('item.tag', {
    grade: tn('grade', GRADES[item.grade].name),
    slot: tn('slot', SLOTS[item.slot].name),
    level: item.level,
    quality: quality(item),
  });
}

/** A weapon's treasure tier by grade (docs/design.md §6): what kind of magic tool it is. */
const TREASURE_TIERS: Readonly<Record<GradeId, MessageKey>> = {
  mortal: 'tier.magicTool',
  spirit: 'tier.magicTool',
  earth: 'tier.spiritTreasure',
  heaven: 'tier.spiritTreasure',
  immortal: 'tier.immortalTreasure',
};

/** The treasure tier line in an item's details, for weapons only; null for other types. */
export function treasureTier(item: Item): string | null {
  if (item.slot !== 'weapon' || !Object.hasOwn(TREASURE_TIERS, item.grade)) return null;
  return t(TREASURE_TIERS[item.grade]);
}

/** A Charm's line in its details, e.g. "Defend Talisman"; null for other types. */
export function charmLineName(item: Item): string | null {
  const line = charmLine(item);
  return line ? tn('charmLine', CHARM_LINES[line].name) : null;
}

/**
 * The Path an item's family leans toward, for its details, e.g. "Favoured by:
 * Body Refiner"; `match` when it is the player's Path. Null for a neutral item.
 */
export function favouredBy(item: Item, path: PathId): { text: string; match: boolean } | null {
  const lean = itemPath(item);
  if (!lean) return null;
  return {
    text: t('item.favouredBy', { path: tn('path', PATHS[lean].name) }),
    match: lean === path,
  };
}

/**
 * A Soul Banner's souls for its details, e.g. "Souls: 7 / 20 (+6.7 damage per
 * attack)": the equipped banner's from `state`, none for one in the bag. Null
 * for any other item.
 */
export function soulsLine(item: Item, state: GameState): string | null {
  if (!isBanner(item) || !Object.hasOwn(SOUL_CAPS, item.grade)) return null;
  const souls = state.cultivator.equipment.sideArm === item ? state.souls : 0;
  const damage = soulDamage(souls, state.cultivator.stats.spirit);
  return t('item.souls', { souls, cap: SOUL_CAPS[item.grade], damage: num(damage, 1) });
}

/**
 * Why the cultivator can't equip `item` yet, e.g. "Requires Foundation
 * Establishment"; null when they can (docs/design.md §6).
 */
export function equipBlock(c: Cultivator, item: Item): string | null {
  if (canEquip(c, item)) return null;
  const realm = (REALMS[requiredRealm(item)] as (typeof REALMS)[number]).name;
  return t('item.requires', { realm: tn('realm', realm) });
}

/** The Stats tab's groups of derived numbers, in display order. */
export const STAT_GROUPS = ['Offence', 'Defence', 'Find'] as const;
export type StatGroup = (typeof STAT_GROUPS)[number];

interface StatRow {
  label: MessageKey;
  /** The label under its group heading, if shorter than `label`. */
  short?: MessageKey;
  group: StatGroup;
  value: (d: Derived) => number;
  format: (v: number) => string;
  /** How a change in this stat reads, if not the same as `format`. */
  delta?: (v: number) => string;
}

/** The combat numbers on the character panel, in display order. */
export const STAT_ROWS: readonly StatRow[] = [
  { label: 'row.maxHp', group: 'Defence', value: (d) => d.maxHp, format: (v) => num(v, 0) },
  { label: 'row.damage', group: 'Offence', value: (d) => d.damage, format: (v) => num(v, 1) },
  { label: 'row.defence', group: 'Defence', value: (d) => d.defence, format: (v) => num(v, 1) },
  {
    label: 'row.attacks',
    group: 'Offence',
    value: (d) => 1 / d.attackInterval,
    format: (v) => num(v, 2),
  },
  {
    label: 'row.critChance',
    group: 'Offence',
    value: (d) => d.critChance,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.critDamage',
    group: 'Offence',
    value: (d) => d.critMultiplier,
    format: (v) => `×${num(v, 2)}`,
    // Matches the item card: a +0.15 multiplier reads "+15% Crit damage".
    delta: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.lifesteal',
    group: 'Defence',
    value: (d) => d.lifesteal,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.qiRegen',
    group: 'Defence',
    value: (d) => d.qiRegen,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.stoneFind',
    short: 'row.stoneFindShort',
    group: 'Find',
    value: (d) => d.stoneFind,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.treasureFind',
    short: 'row.treasureFindShort',
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
    label: t(r.label),
    short: t(r.short ?? r.label),
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
  const why = nothingToDo
    ? t('respec.nothing')
    : stones < cost
      ? t('respec.need', { n: cost - stones })
      : '';
  return { cost: t('respec.cost', { n: cost }), off: why !== '', why };
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
    lines.push({ text: `${signed(change, text)} ${t(r.label)}`, better: change > 0 });
  }
  return [...lines, ...compareArrays(c.equipment[to], item)];
}

/** An array's strength in short, e.g. "1.75 s" or "9.5%". */
function arrayAmount(id: ArrayId, value: number): string {
  return id === 'binding' ? t('array.seconds', { v: num(value, 2) }) : `${num(value * 100, 1)}%`;
}

/** How the array changes when `next` replaces `now`: stronger or weaker, or one gained and one lost. */
function compareArrays(now: Item | undefined, next: Item): { text: string; better: boolean }[] {
  const was = now?.array ? { id: now.array, value: arrayValue(now) } : null;
  const will = next.array ? { id: next.array, value: arrayValue(next) } : null;
  if (was && will && was.id === will.id) {
    const change = will.value - was.value;
    const text = arrayAmount(will.id, Math.abs(change));
    if (text === arrayAmount(will.id, 0)) return [];
    const name = tn('array', ARRAYS[will.id].name);
    return [{ text: `${signed(change, text)} ${name}`, better: change > 0 }];
  }
  const lines: { text: string; better: boolean }[] = [];
  if (will) {
    const amount = arrayAmount(will.id, will.value);
    lines.push({ text: `+${tn('array', ARRAYS[will.id].name)} (${amount})`, better: true });
  }
  if (was) {
    const amount = arrayAmount(was.id, was.value);
    lines.push({ text: `−${tn('array', ARRAYS[was.id].name)} (${amount})`, better: false });
  }
  return lines;
}

/** Where the cultivator is on the floor: "Wave 2 / 3", "Elite", "Boss" or "Tribulation". */
export function waveLabel(state: GameState): string {
  if (state.enemies[0]?.kind === 'tribulation') return t('strip.tribulation');
  const waves = WAVES_PER_FLOOR * DEMONS_PER_WAVE;
  const left = state.enemies.filter((e) => e.kind !== 'tribulation').length;
  const defeated = waves + 2 - left;
  if (defeated < waves)
    return t('strip.wave', { n: Math.floor(defeated / DEMONS_PER_WAVE) + 1, of: WAVES_PER_FLOOR });
  return t(defeated === waves ? 'strip.elite' : 'strip.boss');
}

/**
 * The XP bar on the combat strip: the level, how full the bar is (0-100), the
 * text inside it ("37 / 60") and the same in words for screen readers. At a
 * realm cap the bar is full and says "Tribulation due".
 */
export function xpBar(c: Cultivator): {
  level: string;
  percent: number;
  text: string;
  spoken: string;
} {
  const level = t('xp.level', { n: c.level });
  if (readyForTribulation(c))
    return {
      level,
      percent: 100,
      text: t('xp.due'),
      spoken: t('xp.spokenDue', { n: c.level }),
    };
  const xp = Math.floor(c.xp);
  const next = xpToNext(c.level);
  return {
    level,
    percent: Math.max(0, Math.min(100, (xp / next) * 100)),
    text: `${xp} / ${next}`,
    spoken: t('xp.spoken', { n: c.level, xp, next }),
  };
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
  if (name === undefined || next === undefined) return null;
  return { name: tn('enemy', name), next: tn('realm', next.name) };
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
    return realm ? t('trial.breakthrough', { realm: tn('realm', realm.name) }) : null;
  }
  if (before?.kind === 'tribulation' && next.deaths > prev.deaths) {
    return t('trial.lost', { name: tn('enemy', before.name) });
  }
  if (now?.kind === 'tribulation' && before?.kind !== 'tribulation') {
    return t('trial.begins', { name: tn('enemy', now.name) });
  }
  const call = tribulationFellDue(prev, next) ? tribulationCall(next) : null;
  return call ? t('trial.fellDue', { name: call.name }) : null;
}

/** The realm, with the job title beside it: "Foundation Establishment · Associate". */
export function realmLabel(level: number): string {
  const realm = REALMS[realmOf(level)] as (typeof REALMS)[number];
  const name = tn('realm', realm.name);
  return realm.title
    ? t('realm.withTitle', { realm: name, title: tn('title', realm.title) })
    : name;
}

/** Icons in the summary atlas, in its column order (tools/art/manifest.json "summary"). */
export const SUMMARY_ICONS: readonly string[] = [
  'stones',
  'essence',
  ...REALMS.map((_, i) => `realm-${i}`),
];

/** The summary atlas column of icon `id`, or of the realm `level` is in when `id` is 'realm'. */
export function summaryIcon(id: 'stones' | 'essence' | 'realm', level = 1): number {
  return SUMMARY_ICONS.indexOf(id === 'realm' ? `realm-${realmOf(level)}` : id);
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
  if (p.count === 0 || p.highest === null) return t('sell.nothing');
  const grade = tn('grade', GRADES[p.highest].name);
  return t(p.count === 1 ? 'sell.one' : 'sell.many', { n: p.count, grade, stones: p.stones });
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
  return array ? t('array.setUp', { name: tn('array', ARRAYS[array.id].name) }) : null;
}

/** A grid cell's accessible name: everything its colour, initial and icon show, in words. */
export function cellLabel(item: Item): string {
  return t('item.cell', { name: tn('item', item.name), tag: itemTag(item) });
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

/** Bag cells per inventory page: the starting bag, so buying slots never grows the grid. */
export const BAG_PAGE = INVENTORY_SIZE;

/** The number of inventory pages a bag of `size` cells needs (always at least one). */
export function bagPages(size: number): number {
  return Math.max(1, Math.ceil(size / BAG_PAGE));
}

/** The inventory page holding bag cell `index`. */
export function pageOf(index: number): number {
  return Math.floor(index / BAG_PAGE);
}

/**
 * Page `page` of a bag of `size` cells: its first cell, how many real cells it
 * shows, how many invisible fillers pad it to a full page, and the page count.
 */
export function bagPage(
  size: number,
  page: number,
): { start: number; cells: number; fillers: number; pages: number } {
  const start = page * BAG_PAGE;
  const cells = Math.max(0, Math.min(BAG_PAGE, size - start));
  return { start, cells, fillers: BAG_PAGE - cells, pages: bagPages(size) };
}

/** A time away, e.g. "45 s", "12 min" or "2 h 5 min". */
export function durationLabel(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return t('time.seconds', { s });
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? t('time.hours', { h, m }) : t('time.minutes', { m });
}

/** The Overtime Cultivation summary, one line per count. */
export function overtimeLines(summary: OvertimeSummary): string[] {
  const time = durationLabel(summary.seconds);
  const lines = [
    t(summary.capped ? 'overtime.awayCapped' : 'overtime.away', { time }),
    t('overtime.floors', { n: summary.floorsClimbed }),
    t('overtime.levels', { n: summary.levels }),
    t('overtime.kills', { n: summary.kills }),
    t('overtime.kept', { n: summary.dropsKept }),
  ];
  if (summary.dropsSold > 0) lines.push(t('overtime.sold', { n: summary.dropsSold }));
  if (summary.dropsSalvaged > 0) lines.push(t('overtime.salvaged', { n: summary.dropsSalvaged }));
  lines.push(t('overtime.stones', { n: summary.stones }));
  if (summary.essence > 0) lines.push(t('overtime.essence', { n: summary.essence }));
  // So a lower drop count isn't read as a bug.
  lines.push(t('overtime.rate', { percent: Math.round(OFFLINE_DROP_MULTIPLIER * 100) }));
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
  const name = tn('passive', p.name);
  const effect = tn('passiveRank', p.perRankText);
  if (cost === null) {
    return {
      name,
      rank: rankText,
      state: 'max',
      buy: t('passive.max'),
      buyName: t('passive.maxName', { name, rank, max: p.maxRank }),
      detail: t('passive.maxDetail', { effect }),
    };
  }
  return {
    name,
    rank: rankText,
    state: insight >= cost ? 'can' : 'cant',
    buy: t('passive.buy', { n: cost }),
    buyName: t('passive.buyName', { n: cost, name, rank: rank + 1, max: p.maxRank }),
    detail: t('passive.detail', { effect, n: cost }),
  };
}

/** The Early Retirement button, or why it is off. */
export function retireLabel(p: RetirePreview): string {
  return p.insight > 0 ? t('retire.button') : t('retire.reach', { n: RETIRE_MIN_FLOOR });
}

/** The Early Retirement confirmation: what is kept and what is lost, one short line each. */
export function retireLines(p: RetirePreview): { kept: string[]; lost: string[] } {
  const lost = [
    t('retire.lostLevel', { level: p.level, floor: p.highestFloor }),
    t(p.items === 1 ? 'retire.lostItem' : 'retire.lostItems', { n: p.items }),
    t('retire.lostStones', { n: p.stones }),
    t('retire.lostEssence', { n: p.essence }),
  ];
  if (p.bagCells > 0) lost.push(t('retire.lostCells', { n: p.bagCells }));
  return {
    kept: [
      t('retire.keptInsight', { n: p.insight, total: p.insightAfter }),
      t('retire.keptPassives'),
      t('retire.keptPath'),
    ],
    lost,
  };
}
