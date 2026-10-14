// What the UI shows, worked out from game state. Pure: no DOM, so it can be
// unit-tested; the DOM layer (app.ts) only puts these strings on the page.

import {
  ATTACK_SPEED_SLOWS_AT,
  CRIT_CURVE,
  derive,
  DODGE_CURVE,
  effectiveStats,
  pathShare,
  PIERCE_CURVE,
  REFLECT_CURVE,
  slowsAt,
  STAT_IDS,
  type Stats,
  readyForTribulation,
  realmLevels,
  realmOf,
  realmPrimaryShare,
  REALMS,
  xpToNext,
  type Cultivator,
  type Derived,
  PATHS,
  type PathId,
  type StatId,
} from '../core/cultivator.ts';
import {
  INVENTORY_SIZE,
  refineCost,
  refineReach,
  rerollCost,
  rollPoints,
  type BulkAction,
  type BulkPreview,
} from '../core/economy.ts';
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
  OFFLINE_DROP_MULTIPLIER,
  quality,
  SLOTS,
  slotsFor,
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
import { gradeName, isDiscreet } from './discreet.ts';
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
import {
  canEquip,
  canFaceTribulation,
  characterStatus,
  requiredRealm,
  TRIAL_LOSS_LIMIT,
  trialRetryIn,
  trialSetAside,
  type GameState,
} from '../core/sim.ts';
import { pathSkills } from '../core/path-skills.ts';
import type { CastNote, EffectNote, Side } from '../core/skills.ts';
import {
  BOOST_BONUS,
  BOOST_IDS,
  BOOST_SECONDS,
  boostLeft,
  boostOf,
  CHEST_GRADES,
  chestGrade,
  nextRotationIn,
  OFFER_IDS,
  offerBlock,
  offerPrice,
  refreshCost,
  type BoostId,
  type OfferBlock,
  type OfferId,
} from '../core/store.ts';
import { lang, t, tn, yellText, type MessageKey } from './i18n.ts';

/** The Path picker's one-liner: role, primary stat (docs/design.md §3). */
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

/** What a stat does for the cultivator; the details panel groups an item's lines by it. */
export type StatKind = 'offence' | 'defence' | 'utility';
export const STAT_KINDS: readonly StatKind[] = ['offence', 'defence', 'utility'];
const STAT_KIND: Readonly<Record<BonusStat, StatKind>> = {
  damage: 'offence',
  damagePct: 'offence',
  critChance: 'offence',
  critDamage: 'offence',
  attackSpeed: 'offence',
  maxHp: 'defence',
  maxHpPct: 'defence',
  defence: 'defence',
  lifesteal: 'defence',
  qiRegen: 'utility',
  stoneFind: 'utility',
  treasureFind: 'utility',
};
/** Binding delays the enemy's first attack and Illusion makes attacks miss; Killing deals damage. */
const ARRAY_KIND: Readonly<Record<ArrayId, StatKind>> = {
  binding: 'defence',
  illusion: 'defence',
  killing: 'offence',
};

/** Every line of an item card after its title, with its kind: base stat (a disc's array), affixes, unique effect. */
function itemEntries(item: Item): { kind: StatKind; text: string }[] {
  const base = SLOTS[item.slot].base.stat;
  const entries = [
    item.array
      ? { kind: ARRAY_KIND[item.array], text: arrayLine(item.array, arrayValue(item)) }
      : { kind: STAT_KIND[base], text: formatBonus(base, baseValue(item)) },
  ];
  for (const a of item.affixes) {
    const stat = AFFIXES[a.id].stat;
    entries.push({ kind: STAT_KIND[stat], text: formatBonus(stat, itemAffixValue(item, a)) });
  }
  if (item.unique) {
    const u = UNIQUES[item.unique];
    entries.push({
      kind: STAT_KIND[u.stat],
      text: `${tn('unique', u.name)}: ${formatBonus(u.stat, u.value)}`,
    });
  }
  return entries;
}

/** Every line of an item card after its title: base stat (a disc's array), affixes, unique effect. */
export function itemLines(item: Item): string[] {
  return itemEntries(item).map((e) => e.text);
}

/** An item's lines grouped by kind, in STAT_KINDS order, each group in card order; empty kinds left out. */
export function itemLineGroups(item: Item): { kind: StatKind; lines: string[] }[] {
  const entries = itemEntries(item);
  return STAT_KINDS.map((kind) => ({
    kind,
    lines: entries.filter((e) => e.kind === kind).map((e) => e.text),
  })).filter((g) => g.lines.length > 0);
}

/** The short tag under an item's name, e.g. "Heaven · Weapon · Lv 12". */
export function itemTag(item: Item): string {
  return t('item.tag', {
    grade: gradeName(item.grade),
    slot: tn('slot', SLOTS[item.slot].name),
    level: item.level,
  });
}

/** An item's refine level as its cell shows it, e.g. "+7"; empty at +0. */
export function refineMark(item: Item): string {
  return item.refines ? `+${item.refines}` : '';
}

/** An item's name with its refine level, e.g. "Iron Flying Sword +7"; nothing added at +0. */
export function itemName(item: Item): string {
  const name = tn('item', item.name);
  return item.refines ? `${name} ${refineMark(item)}` : name;
}

/** The labeled quality line under the tag, e.g. "Quality 94%". */
export function qualityLine(item: Item): string {
  return t('item.quality', { quality: quality(item) });
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
 * The Path an item's family leans toward, for its details, e.g. "Body Refiner";
 * `match` when it is the player's Path. Null for a neutral item.
 */
export function favouredBy(item: Item, path: PathId): { text: string; match: boolean } | null {
  const lean = itemPath(item);
  if (!lean) return null;
  return { text: tn('path', PATHS[lean].name), match: lean === path };
}

/**
 * A Soul Banner's souls for its details, e.g. "7 / 20 (+6.7 damage per
 * attack)": the equipped banner's from `state`, none for one in the bag. Null
 * for any other item.
 */
export function soulsLine(item: Item, state: GameState): string | null {
  if (!isBanner(item) || !Object.hasOwn(SOUL_CAPS, item.grade)) return null;
  const souls = state.cultivator.equipment.sideArm === item ? state.souls : 0;
  const damage = soulDamage(souls, effectiveStats(state.cultivator).spirit);
  return t('item.souls', { souls, cap: SOUL_CAPS[item.grade], damage: num(damage, 1) });
}

/** One labelled fact in a details panel's Item block, e.g. Grade: Spirit. */
export interface ItemFact {
  id: 'grade' | 'type' | 'level' | 'quality' | 'tier' | 'line' | 'favouredBy' | 'souls';
  label: string;
  value: string;
  /** A class for the value: the grade's colour, or `up` for the player's own Path. */
  tone: string;
}

/**
 * The Item block's facts in display order: grade, type, level and quality,
 * then those that apply to this item only (treasure tier, charm line, the Path
 * it favours, a Soul Banner's souls).
 */
export function itemFacts(item: Item, state: GameState): ItemFact[] {
  const facts: ItemFact[] = [
    {
      id: 'grade',
      label: t('fact.grade'),
      value: gradeName(item.grade),
      tone: `grade-${item.grade}`,
    },
    { id: 'type', label: t('fact.type'), value: tn('slot', SLOTS[item.slot].name), tone: '' },
    { id: 'level', label: t('fact.level'), value: String(item.level), tone: '' },
    { id: 'quality', label: t('fact.quality'), value: `${quality(item)}%`, tone: '' },
  ];
  const tier = treasureTier(item);
  if (tier) facts.push({ id: 'tier', label: t('fact.tier'), value: tier, tone: '' });
  const line = charmLineName(item);
  if (line) facts.push({ id: 'line', label: t('fact.line'), value: line, tone: '' });
  const lean = favouredBy(item, state.cultivator.path);
  if (lean) {
    const tone = lean.match ? 'up' : '';
    facts.push({ id: 'favouredBy', label: t('fact.favouredBy'), value: lean.text, tone });
  }
  const souls = soulsLine(item, state);
  if (souls !== null) facts.push({ id: 'souls', label: t('fact.souls'), value: souls, tone: '' });
  return facts;
}

/** Why a worn item can't be taken off now (a full bag); null when it can. */
export function unequipBlock(state: GameState): string | null {
  return state.inventory.length >= state.bagSize ? t('details.unequipBlocked') : null;
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
  /** The only Path the row shows for (its Mastery's number); every Path when unset. */
  only?: PathId;
  /** The kind the details panel files this stat under; the Stats tab's `group` is separate. */
  kind: StatKind;
  /** The label under its group heading, if shorter than `label`. */
  short?: MessageKey;
  group: StatGroup;
  value: (d: Derived) => number;
  format: (v: number) => string;
  /** How a change in this stat reads, if not the same as `format`. */
  delta?: (v: number) => string;
  /** A finer `format` for the stat tip, where one point moves it by less than the last digit. */
  fine?: (v: number) => string;
}

/** A share as a percent to two decimals, for the stat tip: "5.04%". */
const finePct = (v: number): string => `${num(v * 100, 2)}%`;

/** The combat numbers on the character panel, in display order. */
export const STAT_ROWS: readonly StatRow[] = [
  {
    label: 'row.maxHp',
    kind: 'defence',
    group: 'Defence',
    value: (d) => d.maxHp,
    format: (v) => num(v, 0),
  },
  {
    label: 'row.damage',
    kind: 'offence',
    group: 'Offence',
    value: (d) => d.damage,
    format: (v) => num(v, 1),
  },
  {
    label: 'row.defence',
    kind: 'defence',
    group: 'Defence',
    value: (d) => d.defence,
    format: (v) => num(v, 1),
  },
  {
    label: 'row.attacks',
    kind: 'offence',
    group: 'Offence',
    value: (d) => 1 / d.attackInterval,
    format: (v) => num(v, 2),
  },
  {
    label: 'row.critChance',
    kind: 'offence',
    group: 'Offence',
    value: (d) => d.critChance,
    format: (v) => `${num(v * 100, 1)}%`,
    fine: finePct,
  },
  {
    label: 'row.critDamage',
    kind: 'offence',
    group: 'Offence',
    value: (d) => d.critMultiplier,
    format: (v) => `×${num(v, 2)}`,
    // Flowing Sword moves it by 0.005 a point.
    fine: (v) => `×${num(v, 3)}`,
    // Matches the item card: a +0.15 multiplier reads "+15% Crit damage".
    delta: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.pierce',
    kind: 'offence',
    group: 'Offence',
    value: (d) => d.pierce,
    format: (v) => `${num(v * 100, 1)}%`,
    fine: finePct,
  },
  {
    label: 'row.burst',
    only: 'talisman',
    kind: 'offence',
    group: 'Offence',
    value: (d) => d.burstMultiplier,
    format: (v) => `×${num(v, 2)}`,
  },
  {
    label: 'row.lifesteal',
    kind: 'defence',
    group: 'Defence',
    value: (d) => d.lifesteal,
    format: (v) => `${num(v * 100, 1)}%`,
    fine: finePct,
  },
  {
    label: 'row.hpRegen',
    kind: 'defence',
    group: 'Defence',
    value: (d) => d.hpRegen,
    format: (v) => `${num(v, 2)}/s`,
  },
  {
    label: 'row.dodge',
    kind: 'defence',
    group: 'Defence',
    value: (d) => d.dodge,
    format: (v) => `${num(v * 100, 1)}%`,
    fine: finePct,
  },
  {
    label: 'row.reflect',
    only: 'body',
    kind: 'defence',
    group: 'Defence',
    value: (d) => d.reflect,
    format: (v) => `${num(v * 100, 1)}%`,
    fine: finePct,
  },
  {
    label: 'row.maxQi',
    kind: 'utility',
    group: 'Defence',
    value: (d) => d.maxQi,
    format: (v) => num(v, 0),
  },
  {
    label: 'row.qiRegen',
    kind: 'utility',
    group: 'Defence',
    value: (d) => d.qiRegen,
    format: (v) => num(v, 1),
    // A Spirit point adds 0.01 to 0.02 a second.
    fine: (v) => num(v, 2),
  },
  {
    label: 'row.stoneFind',
    kind: 'utility',
    short: 'row.stoneFindShort',
    group: 'Find',
    value: (d) => d.stoneFind,
    format: (v) => `${num(v * 100, 1)}%`,
  },
  {
    label: 'row.treasureFind',
    kind: 'utility',
    short: 'row.treasureFindShort',
    group: 'Find',
    value: (d) => d.treasureFind,
    format: (v) => `${num(v * 100, 1)}%`,
  },
];

/** What the realms add to `stat`, to one decimal as shown, so the shown sum adds up. */
function shownBoost(c: Cultivator, stat: StatId): number {
  return Number((effectiveStats(c)[stat] - c.stats[stat]).toFixed(1));
}

/**
 * What the realms add to `stat` on top of its base points, as "+7.1", or ''
 * for a stat they don't raise (all but the Path's main stat, and every stat in
 * the first realm).
 */
export function realmBoost(c: Cultivator, stat: StatId): string {
  const boost = shownBoost(c, stat);
  return boost > 0 ? `+${boost}` : '';
}

/**
 * Where a realm boost comes from, and the sum: "Bonus from your realm: Nascent
 * Soul (146 + 7.1 = 153.1)". The total is the base plus the boost as shown.
 */
export function realmBoostTip(c: Cultivator, stat: StatId): string {
  const realm = REALMS[realmOf(c.level)] as (typeof REALMS)[number];
  const base = c.stats[stat];
  const boost = shownBoost(c, stat);
  return t('stats.realmTip', {
    realm: tn('realm', realm.name),
    base,
    boost,
    total: num(base + boost, 1),
  });
}

/**
 * The cultivator's numbers, with the passives (treasure find) and running
 * store boosts (stone and treasure find) that change them.
 */
export function statRows(
  c: Cultivator,
  passives: Passives = noPassives(),
  boosts: { stoneFind: number; treasureFind: number } = { stoneFind: 0, treasureFind: 0 },
): { label: string; short: string; group: StatGroup; value: string; raw: number }[] {
  const d = derive(c);
  d.treasureFind += passiveTreasureFind(passives) + boosts.treasureFind;
  d.stoneFind += boosts.stoneFind;
  return rowsFor(c.path).map((r) => ({
    label: t(r.label),
    short: t(r.short ?? r.label),
    group: r.group,
    value: r.format(r.value(d)),
    raw: r.value(d),
  }));
}

/** The rows the Stats tab shows for `path`: every row but another Path's Mastery number. */
function rowsFor(path: PathId): readonly StatRow[] {
  return STAT_ROWS.filter((r) => r.only === undefined || r.only === path);
}

/** `c` with `n` more points in `stat`, as spendPoints() would leave it. */
function withPoints(c: Cultivator, stat: StatId, n: number): Cultivator {
  return { ...c, stats: { ...c.stats, [stat]: c.stats[stat] + n } };
}

/**
 * What spending `n` points on `stat` would do to the Stats tab's rows: each
 * row's value after, and whether it goes up or down (or stays). Built the same
 * way as statRows(), so it matches the spend exactly.
 */
export function spendPreview(
  c: Cultivator,
  stat: StatId,
  n: number,
  passives: Passives = noPassives(),
  boosts: { stoneFind: number; treasureFind: number } = { stoneFind: 0, treasureFind: 0 },
): { value: string; change: 'up' | 'down' | '' }[] {
  const before = statRows(c, passives, boosts);
  return statRows(withPoints(c, stat, n), passives, boosts).map((r, i) => {
    const was = (before[i] as (typeof before)[number]).raw;
    return { value: r.value, change: r.raw > was ? 'up' : r.raw < was ? 'down' : '' };
  });
}

/**
 * Where a stat's gains start to slow for `path`: the first of its curves to
 * fall to half its first gains (docs/design.md §3); null for a stat with no
 * curve on this Path (Body is straight HP and defence but for Iron Body).
 */
export function slowPoint(path: PathId, stat: StatId): number | null {
  if (stat === 'agility') {
    return Math.min(slowsAt(CRIT_CURVE), slowsAt(DODGE_CURVE), ATTACK_SPEED_SLOWS_AT);
  }
  if (stat === 'spirit') return slowsAt(PIERCE_CURVE);
  return path === 'body' ? slowsAt(REFLECT_CURVE) : null;
}

/**
 * A stat's tip (docs/design.md §3): what one more point does now, in real
 * numbers; the Path Mastery line for the main stat, or that another stat adds
 * no damage; the Path share (full or half effect); and "Gains slow above N"
 * once its curve has flattened ('' before then).
 */
export function statTip(
  c: Cultivator,
  stat: StatId,
): { gain: string; mastery: string; share: string; slows: string } {
  const rows = rowsFor(c.path);
  const now = derive(c);
  const next = derive(withPoints(c, stat, 1));
  // Only rows whose shown number moves: a gain too small to show reads as none.
  const changes = rows.flatMap((r) => {
    const show = r.fine ?? r.format;
    const from = show(r.value(now));
    const to = show(r.value(next));
    return from === to ? [] : [t('tip.change', { row: t(r.short ?? r.label), from, to })];
  });
  const name = t(`stat.${stat}`);
  const gain = t('tip.gain', { stat: name, changes: changes.join(', ') });
  const main = PATHS[c.path].primary === stat;
  const mastery = main ? t(`mastery.${c.path}`) : t('tip.notMain');
  const share = pathShare(c.path, stat) === 1 ? t('tip.full') : t('tip.half');
  const n = slowPoint(c.path, stat);
  const slows = n !== null && effectiveStats(c)[stat] >= n ? t('tip.slows', { n }) : '';
  return { gain, mastery, share, slows };
}

/** A typed share: whole numbers from 0 to 100 only, as digits; anything else is null. */
export function parseShare(text: string): number | null {
  if (!/^[0-9]{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= 100 ? n : null;
}

/**
 * The plan's three typed shares as a ratio, or why they can't be one: each a
 * whole number from 0 to 100, all three adding up to 100.
 */
export function planRatio(texts: Readonly<Record<StatId, string>>): {
  ratio: Stats | null;
  why: string;
} {
  const ratio: Stats = { body: 0, agility: 0, spirit: 0 };
  for (const id of STAT_IDS) {
    const n = parseShare(texts[id]);
    if (n === null) return { ratio: null, why: t('plan.whole') };
    ratio[id] = n;
  }
  const sum = ratio.body + ratio.agility + ratio.spirit;
  return sum === 100 ? { ratio, why: '' } : { ratio: null, why: t('plan.sum', { n: sum }) };
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
 * nothing are left out. `now` is the cultivator's current `derive()`, when the
 * caller already has it.
 */
export function compareToEquipped(
  c: Cultivator,
  item: Item,
  to: EquipSlotId,
  now: Derived = derive(c),
): CompareLine[] {
  const lines = statChanges(c, item, to, now).map(({ row, change, text }) => ({
    text: `${signed(change, text)} ${t(row.label)}`,
    better: change > 0,
    kind: row.kind,
  }));
  return [...lines, ...compareArrays(c.equipment[to], item)];
}

/** One line of a comparison; `kind` is the Attributes box group it belongs to. */
export interface CompareLine {
  text: string;
  better: boolean;
  kind: StatKind;
}

/** A comparison's lines grouped by kind, in STAT_KINDS order like the Attributes box; empty kinds left out. */
export function compareGroups(
  lines: readonly CompareLine[],
): { kind: StatKind; lines: { text: string; better: boolean }[] }[] {
  return STAT_KINDS.map((kind) => ({
    kind,
    lines: lines.filter((l) => l.kind === kind).map(({ text, better }) => ({ text, better })),
  })).filter((g) => g.lines.length > 0);
}

/**
 * The stat rows that equipping `item` into `to` changes, with the change and
 * its shown size (no label). Shared by the comparison and the upgrade badge,
 * so both drop the same rounds-to-nothing rows.
 */
function statChanges(
  c: Cultivator,
  item: Item,
  to: EquipSlotId,
  now: Derived,
): { row: StatRow; change: number; text: string }[] {
  const next = derive({ ...c, equipment: { ...c.equipment, [to]: item } });
  const out: { row: StatRow; change: number; text: string }[] = [];
  for (const row of STAT_ROWS) {
    const fmt = row.delta ?? row.format;
    const change = row.value(next) - row.value(now);
    // A non-number (only from a roll a save check missed) is no gain and no loss.
    if (!Number.isFinite(change)) continue;
    const text = fmt(Math.abs(change));
    if (text !== fmt(0)) out.push({ row, change, text });
  }
  return out;
}

/**
 * What a bag cell's badge says: a strict upgrade (▲), a strict downgrade (▼),
 * a mix of gains and losses (a gold dash), or nothing.
 */
export type GearVerdict = 'up' | 'down' | 'mixed' | null;

/**
 * A comparison's verdict: 'up' when every line is a gain, 'down' when every
 * line is a loss, 'mixed' when it has both, null when it is empty (no change).
 */
export function verdictOf(lines: readonly { better: boolean }[]): GearVerdict {
  if (!lines.length) return null;
  if (lines.every((l) => l.better)) return 'up';
  return lines.every((l) => !l.better) ? 'down' : 'mixed';
}

/**
 * The badge on bag item `item` (docs/design.md §6), from the same lines the
 * details panel shows; none when the cultivator can't equip it yet. Over the
 * positions it fits, in order: 'up' when one is empty or it is an upgrade in
 * one; 'down' when it is a downgrade in every one; 'mixed' when any position
 * changes at all; else null. `now` is the cultivator's current `derive()`,
 * worked out once per pass by the caller.
 */
export function gearVerdict(c: Cultivator, item: Item, now: Derived = derive(c)): GearVerdict {
  if (!canEquip(c, item)) return null;
  const fits = slotsFor(item.slot);
  if (fits.some((to) => !c.equipment[to])) return 'up';
  const verdicts = fits.map((to) =>
    verdictOf([
      ...statChanges(c, item, to, now).map((s) => ({ better: s.change > 0 })),
      ...compareArrays(c.equipment[to], item),
    ]),
  );
  if (verdicts.includes('up')) return 'up';
  if (verdicts.every((v) => v === 'down')) return 'down';
  return verdicts.some((v) => v !== null) ? 'mixed' : null;
}

/** An array's strength in short, e.g. "1.75 s" or "9.5%". */
function arrayAmount(id: ArrayId, value: number): string {
  return id === 'binding' ? t('array.seconds', { v: num(value, 2) }) : `${num(value * 100, 1)}%`;
}

/** How the array changes when `next` replaces `now`: stronger or weaker, or one gained and one lost. */
function compareArrays(now: Item | undefined, next: Item): CompareLine[] {
  const was = now?.array ? { id: now.array, value: arrayValue(now) } : null;
  const will = next.array ? { id: next.array, value: arrayValue(next) } : null;
  if (was && will && was.id === will.id) {
    const change = will.value - was.value;
    const text = arrayAmount(will.id, Math.abs(change));
    if (text === arrayAmount(will.id, 0)) return [];
    const name = tn('array', ARRAYS[will.id].name);
    return [
      { text: `${signed(change, text)} ${name}`, better: change > 0, kind: ARRAY_KIND[will.id] },
    ];
  }
  const lines: CompareLine[] = [];
  if (will) {
    const amount = arrayAmount(will.id, will.value);
    lines.push({
      text: `+${tn('array', ARRAYS[will.id].name)} (${amount})`,
      better: true,
      kind: ARRAY_KIND[will.id],
    });
  }
  if (was) {
    const amount = arrayAmount(was.id, was.value);
    lines.push({
      text: `−${tn('array', ARRAYS[was.id].name)} (${amount})`,
      better: false,
      kind: ARRAY_KIND[was.id],
    });
  }
  return lines;
}

/** Where the cultivator is on the floor: "Wave 2 / 3", "Elite", "Boss" or "Tribulation". */
export function waveLabel(state: GameState, discreet = false): string {
  const keys = discreet ? DISCREET_WAVE : STRIP_WAVE;
  if (state.enemies[0]?.kind === 'tribulation') return t(keys.tribulation);
  const waves = WAVES_PER_FLOOR * DEMONS_PER_WAVE;
  const left = state.enemies.filter((e) => e.kind !== 'tribulation').length;
  const defeated = waves + 2 - left;
  if (defeated < waves)
    return t(keys.wave, { n: Math.floor(defeated / DEMONS_PER_WAVE) + 1, of: WAVES_PER_FLOOR });
  return t(defeated === waves ? keys.elite : keys.boss);
}

const STRIP_WAVE = {
  tribulation: 'strip.tribulation',
  wave: 'strip.wave',
  elite: 'strip.elite',
  boss: 'strip.boss',
} as const satisfies Record<string, MessageKey>;
/** The same stages in office words, for the Discreet pop-out. */
const DISCREET_WAVE = {
  tribulation: 'discreet.tribulation',
  wave: 'discreet.wave',
  elite: 'discreet.elite',
  boss: 'discreet.boss',
} as const satisfies Record<string, MessageKey>;

/**
 * The Discreet pop-out's cells (docs/design.md §14): a label and a value per
 * row, in office words, with no realm, Path, tier colour or game name. `latest`
 * is the newest drop (null for none) and `due` a Tribulation waiting.
 */
export function discreetRows(
  state: GameState,
  latest: Item | null,
  due: boolean,
): [label: string, value: string][] {
  const c = state.cultivator;
  const enemy = state.enemies[0];
  const percent = (hp: number, max: number): string =>
    `${Math.max(0, Math.min(100, Math.ceil((hp / max) * 100)))}%`;
  const xp = readyForTribulation(c) ? '' : ` · ${xpBar(c).text}`;
  return [
    [t('discreet.floor'), `${state.floor} · ${waveLabel(state, true)}`],
    [t('discreet.level'), `${c.level}${xp}`],
    [t('discreet.health'), percent(c.hp, derive(c).maxHp)],
    [t('discreet.target'), enemy ? percent(enemy.hp, enemy.maxHp) : '–'],
    [t('discreet.closed'), String(state.kills)],
    [
      t('discreet.latest'),
      latest
        ? t('discreet.drop', {
            grade: gradeName(latest.grade, true),
            name: tn('item', latest.name),
          })
        : '–',
    ],
    [
      t('discreet.status'),
      t(due ? (trialSetAside(state) ? 'discreet.postponed' : 'discreet.due') : 'discreet.ok'),
    ],
  ];
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
 * The Tribulation alert's paused state, while a due Tribulation is set aside
 * after TRIAL_LOSS_LIMIT losses: the heading and a line with the losses so far
 * and when the next automatic try comes. Null otherwise.
 */
export function trialPause(state: GameState): { head: string; detail: string } | null {
  if (!trialSetAside(state) || tribulationCall(state) === null) return null;
  const n = state.trial.losses;
  const head = t('trial.paused', { n: TRIAL_LOSS_LIMIT });
  const retryIn = trialRetryIn(state);
  if (retryIn === null) return { head, detail: t('trial.pausedOff', { n }) };
  // A retry that is due joins the floor at the next kill, so it comes at the floor's end.
  if (retryIn === 0 || state.enemies.some((e) => e.kind === 'tribulation'))
    return { head, detail: t('trial.pausedSoon', { n }) };
  return { head, detail: t('trial.pausedIn', { n, time: durationLabel(Math.ceil(retryIn)) }) };
}

/** The status bar's live line: what the cultivator is doing now, e.g. "Cultivating · floor 12". */
export function characterStatusLabel(state: GameState): string {
  const { kind, floor } = characterStatus(state);
  return t(`status.char.${kind}`, { n: floor });
}

/** The status bar's version label, e.g. { text: "v0.6.2", spoken: "Version 0.6.2" }. */
export function versionLabel(version: string): { text: string; spoken: string } {
  return { text: `v${version}`, spoken: t('status.version', { v: version }) };
}

/**
 * The version label's details on hover or focus: the build (its commit, or a
 * local build) and when it was made, e.g. ["Build 5efacb1a2b3c",
 * "Built 2026-10-13 14:05 UTC"]. A build time that isn't a date is left out.
 */
export function versionDetails(build: string, builtAt: string): string[] {
  const lines = [build === 'dev' ? t('status.buildLocal') : t('status.build', { id: build })];
  const at = new Date(builtAt);
  if (!Number.isNaN(at.getTime())) {
    const date = at.toISOString().slice(0, 16).replace('T', ' ');
    lines.push(t('status.built', { date }));
  }
  return lines;
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

/** One row of the realm list: the realm, its job title, its levels, and whether `level` is in it. */
export interface RealmRow {
  readonly name: string;
  readonly title: string;
  readonly levels: string;
  readonly current: boolean;
}

/**
 * Every realm in order, for the Realm chip's hover list; the one `level` is in
 * is current. Each realm past the first names the main-stat boost reached there, in all.
 */
export function realmRows(level: number): RealmRow[] {
  const at = realmOf(level);
  return REALMS.map((realm, i) => {
    const { from, to } = realmLevels(i);
    const levels = to === null ? t('realm.levelsFrom', { from }) : t('realm.levels', { from, to });
    return {
      name: tn('realm', realm.name),
      title: realm.title ? tn('title', realm.title) : '',
      levels:
        i === 0
          ? levels
          : t('realm.withBonus', { levels, pct: num(realmPrimaryShare(i) * 100, 1) }),
      current: i === at,
    };
  });
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

/**
 * The `data-tint` a select wears for `value` (app.ts tintChoice): the value
 * itself when it is exactly one of `allowed`, else null (no tint). A value
 * tampered with in devtools never becomes an attribute or a class.
 */
export function tintOf(value: string, allowed: readonly string[]): string | null {
  return allowed.includes(value) ? value : null;
}

/** A run of text; `grade` marks one to show in that grade's colour (its name stays as text). */
export interface TextPart {
  text: string;
  grade?: GradeId;
}

/** Sentence-ending marks a lost-placeholder grade name goes in front of (gradeRuns). */
const TRAILING_MARKS = new Set([...'?!.:;…。？！：；', ' ', '\u00a0']);

/**
 * `message` as text runs, its `{grade}` placeholder replaced by a run of
 * `name` tagged with `grade`. A message that lost its placeholder (a pack
 * typo; i18n.test checks for it) still names the grade, in brackets before
 * the sentence's closing marks: "Sell 2 items (Earth)?".
 */
export function gradeRuns(message: string, name: string, grade: GradeId): TextPart[] {
  const parts: TextPart[] = [];
  message.split('{grade}').forEach((text, i) => {
    if (i > 0) parts.push({ text: name, grade });
    if (text) parts.push({ text });
  });
  if (parts.some((part) => part.grade)) return parts;
  // Walked back by hand, not by regex, so no message can make it backtrack.
  let end = message.length;
  while (end > 0 && TRAILING_MARKS.has(message.charAt(end - 1))) end -= 1;
  const head = message.slice(0, end);
  const tail = message.slice(end);
  return [
    ...(head ? [{ text: `${head} (` }] : [{ text: '(' }]),
    { text: name, grade },
    { text: `)${tail}` },
  ];
}

/**
 * A bulk sell or salvage confirmation (§7), e.g. "Sell 12 items (highest grade:
 * Spirit) for 340 Spirit Stones?", as text runs: the highest grade's name is
 * its own run, wherever the language puts it, so it can wear its grade colour.
 * A note follows when refined items below the grade are kept.
 */
export function bulkParts(
  action: BulkAction,
  p: { count: number; highest: GradeId | null; total: number; kept?: number },
): TextPart[] {
  const note: TextPart[] = p.kept ? [{ text: ` ${t('bulk.keptRefined')}` }] : [];
  if (p.count === 0 || p.highest === null) return [{ text: t(`${action}.nothing`) }, ...note];
  const grade = p.highest;
  const name = gradeName(grade);
  // Every other placeholder is filled first; {grade} is left in to split on.
  // The language's own plural rule picks the form (Vietnamese has one).
  const form = new Intl.PluralRules(lang().code).select(p.count) === 'one' ? 'one' : 'many';
  const message = t(`${action}.${form}`, { n: p.count, total: p.total });
  const parts = gradeRuns(message, name, grade);
  return [...parts, ...note];
}

/** The bulk confirmation as one string (see bulkParts). */
export function bulkLabel(
  action: BulkAction,
  p: { count: number; highest: GradeId | null; total: number; kept?: number },
): string {
  return bulkParts(action, p)
    .map((part) => part.text)
    .join('');
}

/**
 * What the bulk confirmation shows for `action` with `preview` (§7): the
 * message (as text runs and as one string) and its Yes and dismiss labels.
 * Nothing to take (count 0) offers only "OK", and `yes` is null.
 */
export function bulkAsk(
  action: BulkAction,
  preview: BulkPreview,
): { parts: TextPart[]; text: string; yes: string | null; no: string } {
  const can = preview.count > 0;
  const parts = bulkParts(action, preview);
  return {
    parts,
    text: parts.map((part) => part.text).join(''),
    yes: can ? t(`confirm.${action}`) : null,
    no: t(can ? 'confirm.cancel' : 'confirm.ok'),
  };
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
  /** HP the hit took, with any regen step in between added back; 0 without a hit. */
  youTook: number;
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
  // A stun pushes the stunned side's timer back: that move is no attack.
  const stunned = new Set(
    newNotes(prev, next).flatMap((n) => ('effect' in n && n.effect === 'stunned' ? [n.who] : [])),
  );
  // A kill or a death restarts the timers, so only a timer that moved on its own is an attack.
  const youAttack =
    !youDied &&
    !stunned.has('you') &&
    next.cultivator.nextAttackAt !== prev.cultivator.nextAttackAt;
  const foeAttack =
    !youDied && !killed && !stunned.has('foe') && next.enemyNextAttackAt !== prev.enemyNextAttackAt;
  // A regen step in the same frame as a hit would hide some or all of it: add
  // back what it could have healed (never past max HP). The frame doesn't say
  // which came first, so a tiny hit at full HP healed back by a later regen
  // step can still go unshown; only the animation misses it, never the sim.
  const d = derive(next.cultivator);
  const regen =
    !youDied && next.qiNextAt !== prev.qiNextAt
      ? Math.max(0, Math.min(d.hpRegen, d.maxHp - prev.cultivator.hp))
      : 0;
  const took = prev.cultivator.hp + regen - next.cultivator.hp;
  const youHit = !youDied && took > 1e-9;
  return {
    youAttack,
    foeAttack,
    youHit,
    youTook: youHit ? took : 0,
    foeHit: !killed && !youDied && !!before && !!now && now.hp < before.hp,
    youDied,
    foeDied: killed && before ? { kind: before.kind, name: before.name } : null,
  };
}

/** The skill callouts the sim noted between two states, oldest first; none across a reload. */
function newNotes(prev: GameState, next: GameState): readonly CastNote[] {
  const from = prev.combat.nextNote;
  if (next.combat.nextNote < from) return [];
  return next.combat.log.filter((n) => n.id >= from);
}

/**
 * A callout over a fighter (docs/design.md §5 Skills); `cast` marks a skill's
 * name. `yell` is what the cultivator yells in its bubble instead, for its
 * costliest skill; null for a plain callout.
 */
export interface Callout {
  who: Side;
  text: string;
  cast: boolean;
  yell: string | null;
}

/** How long a callout shows; one noted longer ago than this is not shown. */
export const CALLOUT_SECONDS = 1.4;

const EFFECT_CALLOUTS: Readonly<Record<EffectNote, MessageKey>> = {
  stunned: 'callout.stunned',
  silenced: 'callout.silenced',
  shielded: 'callout.shielded',
  interrupted: 'callout.interrupted',
};

/** The names of the cultivator's costliest skills at its Path and realm (ties all count). */
export function yelledSkills(c: Cultivator): ReadonlySet<string> {
  const skills = pathSkills(c.path, realmOf(c.level));
  const top = Math.max(0, ...skills.map((k) => k.qi));
  return new Set(skills.filter((k) => k.qi === top).map((k) => k.name));
}

/**
 * The callouts to float between two states: a skill's name over its caster
 * as it lands, an effect's word over the fighter it hit. An enemy starting a
 * wind-up floats nothing: its yell bubble says it (windUpOf). The
 * cultivator's costliest skill carries its yell (yelledSkills).
 */
export function castCallouts(prev: GameState, next: GameState): Callout[] {
  // After a long step (a throttled tab), only the latest ones: older ones are over.
  const fresh = newNotes(prev, next).filter((n) => n.at >= next.time - CALLOUT_SECONDS);
  const yelled = yelledSkills(next.cultivator);
  return fresh.flatMap((n): Callout[] => {
    if ('effect' in n) {
      return [{ who: n.who, text: t(EFFECT_CALLOUTS[n.effect]), cast: false, yell: null }];
    }
    if (n.windUp) return [];
    const yell = n.who === 'you' && yelled.has(n.skill) ? yellText(n.skill) : null;
    return [{ who: n.who, text: tn('skill', n.skill), cast: true, yell }];
  });
}

/** The skill the enemy in front winds up, and how far along (0 to 1); null when none. */
export function windUpOf(state: GameState): { skill: string; progress: number } | null {
  const w = state.combat.foe.windUp;
  if (!w) return null;
  const span = w.end - w.start;
  const progress = span > 0 ? (state.time - w.start) / span : 1;
  return { skill: w.name, progress: Math.max(0, Math.min(1, progress)) };
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

/** The words a gear badge adds to a cell's accessible name. */
const CELL_LABELS: Readonly<Record<NonNullable<GearVerdict>, MessageKey>> = {
  up: 'item.cellUpgrade',
  down: 'item.cellDowngrade',
  mixed: 'item.cellMixed',
};

/**
 * A grid cell's accessible name: everything its colour, initial, icon and
 * gear badge show, in words.
 */
export function cellLabel(item: Item, verdict: GearVerdict = null): string {
  return t(verdict ? CELL_LABELS[verdict] : 'item.cell', {
    name: itemName(item),
    tag: itemTag(item),
  });
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

/** One Overtime Cultivation chip: "Label value", with a currency icon or as an ended boost. */
export interface OvertimeChip {
  label: string;
  value: string;
  icon?: 'stones' | 'essence';
  boost?: true;
}

/** The Overtime Cultivation summary: the time away, a chip per count, and the drop-rate note. */
export function overtimeView(summary: OvertimeSummary): {
  away: string;
  chips: OvertimeChip[];
  note: string;
} {
  const time = durationLabel(summary.seconds);
  const chip = (key: MessageKey, value: string): OvertimeChip => ({ label: t(key), value });
  const chips = [
    chip('overtime.floors', `+${summary.floorsClimbed}`),
    chip('overtime.levels', `+${summary.levels}`),
    chip('overtime.kills', String(summary.kills)),
    chip('overtime.kept', String(summary.dropsKept)),
  ];
  if (summary.dropsSold > 0) chips.push(chip('overtime.sold', String(summary.dropsSold)));
  if (summary.dropsSalvaged > 0) {
    chips.push(chip('overtime.salvaged', String(summary.dropsSalvaged)));
  }
  chips.push({ ...chip('overtime.stones', `+${summary.stones}`), icon: 'stones' });
  if (summary.essence > 0) {
    chips.push({ ...chip('overtime.essence', `+${summary.essence}`), icon: 'essence' });
  }
  if (summary.boostsEnded.length > 0) {
    const names = summary.boostsEnded.map((id) => t(`store.boost.${id}`)).join(', ');
    chips.push({ ...chip('overtime.boostsEnded', names), boost: true });
  }
  return {
    away: t(summary.capped ? 'overtime.awayCapped' : 'overtime.away', { time }),
    chips,
    // So a lower drop count isn't read as a bug.
    note: t('overtime.rate', { percent: Math.round(OFFLINE_DROP_MULTIPLIER * 100) }),
  };
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
  if (p.boosts > 0)
    lost.push(t(p.boosts === 1 ? 'retire.lostBoost' : 'retire.lostBoosts', { n: p.boosts }));
  return {
    kept: [
      t('retire.keptInsight', { n: p.insight, total: p.insightAfter }),
      t('retire.keptPassives'),
      t('retire.keptPath'),
    ],
    lost,
  };
}

/** The Crafting panel's modes, in tab order; a new mode is one more entry. */
export const CRAFT_MODES = ['refine', 'reroll'] as const;
export type CraftMode = (typeof CRAFT_MODES)[number];

/** A crafting action: its cost, whether it is off, and why (like respecView). */
export interface CraftAction {
  cost: string;
  off: boolean;
  why: string;
}

function craftAction(cost: number, essence: number): CraftAction {
  const why = essence < cost ? t('respec.need', { n: cost - essence }) : '';
  return { cost: t('craft.cost', { n: cost }), off: why !== '', why };
}

/** Refine: its cost, or off once the base roll is 100% (fully refined). */
export function refineAction(item: Item, essence: number): CraftAction {
  // The button itself reads "Fully refined" (app.ts), so `why` stays empty
  // rather than say it twice to a screen reader.
  if (!refineReach(item)) return { cost: '', off: true, why: '' };
  return craftAction(refineCost(item), essence);
}

/** Reroll: its cost, or "No affixes to reroll" for an item without any. */
export function rerollAction(item: Item, essence: number): CraftAction {
  if (item.affixes.length === 0) return { cost: '', off: true, why: t('craft.noAffixes') };
  return craftAction(rerollCost(item), essence);
}

/**
 * A base stat's or array's amount at base roll `roll` (points), without its
 * name, e.g. "8.0" or "4.5%": one decimal kept, so a range lines up.
 */
function baseAmount(item: Item, roll: number): string {
  const at = { ...item, baseRoll: roll / 100 };
  if (item.array) return arrayAmount(item.array, arrayValue(at));
  const stat = SLOTS[item.slot].base.stat;
  const v = baseValue(at);
  return FLAT.has(stat) ? v.toFixed(1) : `${(v * 100).toFixed(1)}%`;
}

/**
 * What a refine can do, before paying: the base roll now and the rolls it can
 * land on, then the same as the stat, e.g. "Base roll 62% → 63–72%" and
 * "Damage: 8.2 → 8.3–9.0". Empty once fully refined.
 */
export function refinePreview(item: Item): string[] {
  const reach = refineReach(item);
  if (!reach) return [];
  const [lo, hi] = reach;
  const now = rollPoints(item.baseRoll);
  const stat = item.array
    ? tn('array', ARRAYS[item.array].name)
    : t(BONUS_LABELS[SLOTS[item.slot].base.stat]);
  const [from, to] = [baseAmount(item, lo), baseAmount(item, hi)];
  // One reachable value (99%, or a range that rounds to one amount) is shown once.
  return [
    lo === hi ? t('craft.refineRollOne', { now, to: hi }) : t('craft.refineRoll', { now, lo, hi }),
    from === to
      ? t('craft.refineRangeOne', { stat, now: baseAmount(item, now), to })
      : t('craft.refineRange', { stat, now: baseAmount(item, now), lo: from, hi: to }),
  ];
}

/** Affix `i` of `item` as its details show it, e.g. "+3% Crit chance". */
export function affixText(item: Item, i: number): string {
  const a = item.affixes[i];
  return a ? formatBonus(AFFIXES[a.id].stat, itemAffixValue(item, a)) : '';
}

/** The result line after a refine, e.g. "Base roll 62% → 69%". */
export function refineResult(before: Item, after: Item): string {
  return t('craft.result.refine', {
    from: rollPoints(before.baseRoll),
    to: rollPoints(after.baseRoll),
  });
}

/** The result line after rerolling affix `i`, e.g. "+3% Crit chance → +11% Stone find". */
export function rerollResult(before: Item, after: Item, i: number): string {
  return t('craft.result.reroll', { from: affixText(before, i), to: affixText(after, i) });
}

/** The reroll confirmation, naming affix `i` and its current value. */
export function rerollConfirm(item: Item, i: number): string {
  return t('confirm.reroll', { affix: affixText(item, i) });
}

// The Spirit Stone store (docs/design.md §8).

/** The store atlas's columns, in catalog order (tools/art/manifest.json "store"). */
export const STORE_ICONS: readonly OfferId[] = OFFER_IDS;

/** The store atlas column of offer `id`. */
export function storeIcon(id: OfferId): number {
  return STORE_ICONS.indexOf(id);
}

/**
 * The stock positions of its chests in the order the Chests section shows
 * them: best grade first (Heaven, Earth, Spirit), whatever order they rolled in.
 */
export function chestOrder(offers: readonly string[]): number[] {
  return offers
    .flatMap((id, at) => {
      const grade = chestGrade(id as OfferId);
      return grade ? [{ at, rank: CHEST_GRADES.indexOf(grade) }] : [];
    })
    .sort((a, b) => b.rank - a.rank)
    .map((c) => c.at);
}

/** One offer as its card shows it. */
export interface OfferCard {
  id: OfferId;
  name: string;
  /** A chest's minimum grade, for its colour; null for a boost. */
  grade: GradeId | null;
  /** What it gives, e.g. "One Lv 20 item, Earth or better". */
  desc: string;
  /** The button's text: "Buy · 900", "Sold out" or "Bag full". */
  buy: string;
  /** The button's accessible name, naming the offer and its price. */
  buyName: string;
  off: boolean;
  /** Why it is off, when that is not on the button: "Need 120 more". */
  why: string;
}

const OFFER_BLOCK_TEXT: Readonly<Record<Exclude<OfferBlock, 'stones'>, MessageKey>> = {
  sold: 'store.sold',
  bagFull: 'store.bagFull',
  boostCap: 'store.boostCap',
};

/** The name of offer `id` in the player's language. */
export function offerName(id: OfferId): string {
  const grade = chestGrade(id);
  if (!grade) return t(`store.boost.${boostOf(id) as BoostId}`);
  // Discreet mode: the grade in office words, never the game's.
  return isDiscreet()
    ? t('discreet.chest', { grade: gradeName(grade) })
    : t(`store.chest.${grade}`);
}

/** Offer `at` of the current stock as its card shows it. */
export function offerCard(state: GameState, at: number): OfferCard {
  const id = state.store.offers[at] as OfferId;
  const price = offerPrice(state, id);
  const block = offerBlock(state, at);
  const name = offerName(id);
  const grade = chestGrade(id);
  let desc: string;
  if (grade) {
    desc = t('store.chestDesc', { level: state.floor, grade: gradeName(grade) });
  } else {
    const boost = boostOf(id) as BoostId;
    desc = t(`store.boostDesc.${boost}`, {
      percent: Math.round(BOOST_BONUS * 100),
      time: durationLabel(BOOST_SECONDS),
    });
    const left = boostLeft(state, boost);
    if (left > 0) desc += ` · ${t('store.left', { time: durationLabel(left) })}`;
  }
  const buy =
    block && block !== 'stones' ? t(OFFER_BLOCK_TEXT[block]) : t('store.buy', { n: price });
  return {
    id,
    name,
    grade,
    desc,
    buy,
    buyName: `${buy}: ${t('store.buyName', { name, n: price })}`,
    off: block !== null,
    why: block === 'stones' ? t('respec.need', { n: price - state.stones }) : '',
  };
}

/** When the stock next rotates, e.g. "New stock in 12 min". */
export function storeCountdown(state: GameState): string {
  return t('store.rotates', { time: durationLabel(nextRotationIn(state)) });
}

/** The Refresh now button, like respecView: its text, whether it is off and why. */
export function refreshView(state: GameState): { text: string; off: boolean; why: string } {
  const cost = refreshCost(state);
  const short = state.stones < cost;
  return {
    text: t('store.refresh', { n: cost }),
    off: short,
    why: short ? t('respec.need', { n: cost - state.stones }) : '',
  };
}

/**
 * Boost `id`'s summary chip: the bonus and the short word it shows beside its
 * icon ("+50%", "drops"; a narrow chip drops the word), and the whole line its
 * tip and screen readers give ("Lucky Charm (+50% treasure find): 9 min left");
 * null while it is off.
 */
export function boostChip(
  state: GameState,
  id: BoostId,
): { bonus: string; word: string; full: string } | null {
  const left = boostLeft(state, id);
  if (left <= 0) return null;
  const percent = Math.round(BOOST_BONUS * 100);
  return {
    bonus: `+${percent}%`,
    word: t(`store.boostShort.${id}`),
    full: t('store.boostLine', {
      name: t(`store.boost.${id}`),
      effect: t(`store.boostEffect.${id}`, { percent }),
      time: durationLabel(left),
    }),
  };
}

/** The boosts running now, one line each with the time left; empty when none are. */
export function boostLines(state: GameState): string[] {
  return BOOST_IDS.filter((id) => boostLeft(state, id) > 0).map((id) =>
    t('store.boostLine', {
      name: t(`store.boost.${id}`),
      effect: t(`store.boostEffect.${id}`, { percent: Math.round(BOOST_BONUS * 100) }),
      time: durationLabel(boostLeft(state, id)),
    }),
  );
}
