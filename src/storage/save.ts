// The save: game state in browser storage, as versioned JSON (docs/design.md
// §11). Loading trusts nothing: every field is checked against an allow-list
// (exact keys, known enums, known names, whole numbers in range) and copied
// into a fresh object. Anything off means no save, so the player starts a new
// run instead of the page crashing or running on tampered state.

import {
  BASE_STAT,
  derive,
  gainXp,
  isRealmCap,
  PATHS,
  readyForTribulation,
  REALM_BONUS,
  realmOf,
  REALMS,
  STARTING_PRIMARY_BONUS,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
  type Cultivator,
  type PathId,
  type StatId,
} from '../core/cultivator.ts';
import {
  BAG_ROW,
  defaultFilter,
  INVENTORY_SIZE,
  MAX_BAG_SIZE,
  rollPoints,
  type FilterAction,
  type LootFilter,
} from '../core/economy.ts';
import {
  BOSSES,
  DEMONS,
  DEMONS_PER_WAVE,
  makeEnemy,
  maxQi,
  makeTribulation,
  TRIBULATIONS,
  WAVES_PER_FLOOR,
  type Enemy,
  type EnemyKind,
} from '../core/floors.ts';
import {
  AFFIXES,
  ARRAY_IDS,
  EQUIP_SLOTS,
  GRADES,
  isDisc,
  MAX_BINDING,
  MAX_REFINES,
  namesFor,
  renamed,
  SLOTS,
  soulCap,
  UNIQUES,
  type Affix,
  type AffixId,
  type EquipSlotId,
  type Equipment,
  type GradeId,
  type Item,
  type SlotId,
  type UniqueId,
} from '../core/loot.ts';
import { rngFrom } from '../core/rng.ts';
import { bonusPoints, noPassives, PASSIVE_IDS, PASSIVES, type Passives } from '../core/prestige.ts';
import {
  ARRAY_TICK,
  ENEMY_ARRIVAL,
  newTrial,
  QI_TICK,
  startFloor,
  type GameState,
  type TrialState,
} from '../core/sim.ts';
import { freshCombat } from '../core/skills.ts';
import {
  BOOST_CAP_SECONDS,
  BOOST_IDS,
  emptyStore,
  noBoosts,
  OFFER_IDS,
  rotationAt,
  STOCK_SIZE,
  type Boosts,
  type OfferId,
  type StoreState,
} from '../core/store.ts';
import { arr, Bad, fail, int, num, obj, oneOf } from './validate.ts';

export const SAVE_KEY = 'office-immortal.save';
/** Where a save that failed to load is kept, so a new run's autosave doesn't destroy it. */
export const REJECTED_KEY = 'office-immortal.save.rejected';
// 12 is taken by other work in flight; it is never reused.
export const SAVE_VERSION = 14;
/**
 * Older versions that still load: v1 came before currencies, the filter and
 * bag upgrades; v2 before Early Retirement and Dao Insight; v3 had Pants
 * where Boots are now; v4 came before Formation Discs; v5 before Soul Banners;
 * v6 had seven realms, so a due Tribulation may carry another realm's name;
 * v7 came before crafting, so no item has a refine level; v8 had a cap every
 * 10 levels; v9 came before the store and its boosts; v10 had caps at 10, 22,
 * 36 … 162; v11 came before qi; v13 before Auto-Tribulation and the retry
 * limit.
 */
const OLD_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13];
/** A full save is a few KB; anything far bigger is not ours and is not parsed. */
export const MAX_SAVE_CHARS = 200_000;
/** Far past anything a run reaches, and low enough that every formula stays finite. */
export const MAX_LEVEL = 3000;
export const MAX_FLOOR = 3000;
/** Sim clock limit, in seconds (over 30,000 years). */
const MAX_TIME = 1e12;
/**
 * The longest attack interval in the game plus the pause before a fight, in
 * seconds; a next-attack time is never further off.
 */
const MAX_INTERVAL = 2 + ENEMY_ARRIVAL;
/**
 * How much further off a stun or a slowing debuff may have pushed an attack.
 * Those end with the fight's skill state, which is never saved, so such a
 * timer loads pulled back to MAX_INTERVAL.
 */
export const SKILL_SLACK = 60;

/** A next-attack time within `limit` of `time`, or one a skill pushed further, pulled back to it. */
function attackAt(v: unknown, time: number, limit: number): number {
  return Math.min(num(v, time, time + limit + SKILL_SLACK), time + limit);
}

/** The parts of `Storage` the save uses, so tests can pass a plain object. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Save {
  state: GameState;
  /** When it was written, in ms since the epoch. */
  savedAt: number;
}

/** The page's storage, or null where it is blocked (some private modes throw on access). */
export function browserStorage(): SaveStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The fight's skill state is left out: it ends with the fight, so it is never saved (docs/design.md §5). */
export function encodeSave(state: GameState, savedAt: number): string {
  const saved: Partial<GameState> = { ...state };
  delete saved.combat;
  return JSON.stringify({ v: SAVE_VERSION, savedAt, state: saved });
}

/** The save in `raw`, or null if it is missing, too big, not JSON or fails any check. */
export function decodeSave(raw: unknown): Save | null {
  if (typeof raw !== 'string' || raw.length > MAX_SAVE_CHARS) return null;
  try {
    return readSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Why the save checker would refuse `state` once saved, or null when it loads.
 * The same checks as decodeSave, run on the state as encodeSave writes it.
 */
export function saveProblem(state: GameState): string | null {
  try {
    const raw = encodeSave(state, 0);
    if (raw.length > MAX_SAVE_CHARS) return 'too big';
    readSave(JSON.parse(raw));
    return null;
  } catch (e) {
    return e instanceof Bad ? e.message : 'not a save';
  }
}

/** The highest save version taken as a real later release's; anything above is damaged. */
const MAX_FUTURE_VERSION = 1000;

/**
 * Whether `raw` is a save from a later release of the game than this one: the
 * save's outer shape with a version above SAVE_VERSION. Its state is not read
 * (this build doesn't know its fields); only the newer build loads it. Anything
 * else that decodeSave refuses is damaged, not newer.
 */
export function isNewerSave(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > MAX_SAVE_CHARS) return false;
  try {
    const o = obj(JSON.parse(raw), ['v', 'savedAt', 'state']);
    int(o.savedAt, 0, Number.MAX_SAFE_INTEGER);
    obj(o.state, Object.keys(o.state as object));
    return int(o.v, SAVE_VERSION + 1, MAX_FUTURE_VERSION) > SAVE_VERSION;
  } catch {
    return false;
  }
}

/** Writes the save; returns false when storage refuses (full, blocked). */
export function writeSave(storage: SaveStorage, state: GameState, savedAt: number): boolean {
  return writeRaw(storage, encodeSave(state, savedAt));
}

/** Writes save text from encodeSave; returns false when storage refuses (full, blocked). */
export function writeRaw(storage: SaveStorage, raw: string): boolean {
  try {
    storage.setItem(SAVE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset progress: removes the save and any rejected one, so the next start is a
 * new run. Returns false when storage refuses.
 */
export function clearSave(storage: SaveStorage): boolean {
  try {
    storage.removeItem(SAVE_KEY);
    storage.removeItem(REJECTED_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadSave(storage: SaveStorage): Save | null {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  const save = decodeSave(raw);
  // Only a value that could be ours is worth keeping; a huge one would just fill storage.
  if (!save && raw !== null && raw.length <= MAX_SAVE_CHARS) {
    try {
      storage.setItem(REJECTED_KEY, raw);
    } catch {
      // Too big or storage full: nothing more to do; the new run still starts.
    }
  }
  return save;
}

// Validation. The readers below (shared helpers in validate.ts) throw on the first
// problem; decodeSave turns that into null. They build new objects field by
// field, so a key the schema doesn't name (such as __proto__) is never copied,
// and is rejected.

/** A roll is a whole percent in [0, 1], as rollItem makes it. */
function roll(v: unknown): number {
  const r = num(v, 0, 1);
  if (Math.round(r * 100) / 100 !== r) fail('bad roll');
  return r;
}

const PATH_IDS = Object.keys(PATHS) as PathId[];
const SLOT_IDS = Object.keys(SLOTS) as SlotId[];
const EQUIP_IDS = Object.keys(EQUIP_SLOTS) as EquipSlotId[];
const GRADE_IDS = Object.keys(GRADES) as GradeId[];
const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];
const UNIQUE_IDS = Object.keys(UNIQUES) as UniqueId[];
const STAT_IDS: readonly StatId[] = ['body', 'agility', 'spirit'];

function readSave(v: unknown): Save {
  const o = obj(v, ['v', 'savedAt', 'state']);
  if (o.v !== SAVE_VERSION && !OLD_VERSIONS.includes(o.v as number)) fail('version');
  const version = o.v as number;
  return {
    savedAt: int(o.savedAt, 0, Number.MAX_SAFE_INTEGER),
    state: readState(o.state, version),
  };
}

const COUNT = Number.MAX_SAFE_INTEGER;

/**
 * How far a number the sim derives with `**` may drift between browsers. The
 * engines may round `**` differently in the last bits, and a rounded or very
 * large result can land a step apart. The drift seen is at most about 4e-14
 * of the value; this allows a wide margin over that, and far less than any
 * change that would matter in a fight.
 */
const ENGINE_DRIFT = 1e-9;

/** Whether `saved` is this build's `ours`, give or take another engine's rounding. */
function same(saved: unknown, ours: number): boolean {
  return typeof saved === 'number' && Math.abs(saved - ours) <= Math.abs(ours) * ENGINE_DRIFT;
}

/** A limit of ours widened by another engine's rounding; what passes is then kept within ours. */
function give(limit: number): number {
  return limit + Math.abs(limit) * ENGINE_DRIFT;
}

/** Reads a state of `version`; an older state gets the defaults of what it lacks. */
function readState(v: unknown, version: number): GameState {
  const v1 = version === 1;
  const before3 = version < 3;
  // Before v4, the Boots type and position were called Pants.
  const before4 = version < 4;
  // Before v5 there were no arrays, so no Killing Array timer.
  const before5 = version < 5;
  // Before v6 there were no Soul Banners, so no souls.
  const before6 = version < 6;
  // Before v8 there was no crafting, so no item carries a refine level.
  // Before v11 the realm ladder was different (seven realms before v7, then a
  // cap every 10 levels, then caps 2 levels further apart each): a due
  // Tribulation is renamed for its realm.
  const oldCaps = oldLadder(version);
  // Before v10 there was no store, so no stock and no boosts.
  const before10 = version < 10;
  // Before v13 there was no qi: everyone starts with none.
  const before13 = version < 13;
  // Before v14 there was no Auto-Tribulation switch or retry limit.
  const before14 = version < 14;
  const items: ItemReader = {
    slot: before4 ? fromPants : (id) => id,
    refines: version >= 8,
  };
  const o = obj(
    v,
    [
      'time',
      'rng',
      'cultivator',
      'floor',
      'highestFloor',
      'enemies',
      'enemyNextAttackAt',
      ...(before5 ? [] : ['arrayNextAt']),
      ...(before13 ? [] : ['qiNextAt']),
      ...(before6 ? [] : ['souls']),
      'inventory',
      'kills',
      'deaths',
      ...(v1
        ? ['dropsLost']
        : ['bagSize', 'stones', 'essence', 'filter', 'dropsSold', 'dropsSalvaged']),
      ...(before3 ? [] : ['insight', 'passives', 'retirements']),
      ...(before10 ? [] : ['store', 'boosts']),
    ],
    before14 ? [] : ['trial'],
  );
  const time = num(o.time, 0, MAX_TIME);
  const highestFloor = int(o.highestFloor, 1, MAX_FLOOR);
  const floor = int(o.floor, 1, highestFloor);
  const rng = obj(o.rng, ['s']);
  // v1 counted drops lost to a full bag; they were never sold, so the count is dropped.
  if (v1) int(o.dropsLost, 0, COUNT);
  const bagSize = v1 ? INVENTORY_SIZE : int(o.bagSize, INVENTORY_SIZE, MAX_BAG_SIZE);
  if ((bagSize - INVENTORY_SIZE) % BAG_ROW !== 0) fail('bag size');
  const passives = before3 ? noPassives() : readPassives(o.passives);
  const cultivator = readCultivator(
    o.cultivator,
    time,
    highestFloor,
    v1,
    bonusPoints(passives),
    items,
    before4,
    oldCaps,
    before13,
  );
  const state: GameState = {
    time,
    rng: { s: int(rng.s, 0, 0xffffffff) },
    cultivator,
    floor,
    highestFloor,
    enemies: readEnemies(
      o.enemies,
      floor,
      cultivator,
      oldCaps ? heldAtOldCap(cultivator, oldCaps) : readyForTribulation(cultivator),
      oldCaps !== null,
      before13,
    ),
    enemyNextAttackAt: attackAt(o.enemyNextAttackAt, time, MAX_INTERVAL + MAX_BINDING),
    // Left behind while no Killing Array is equipped, so it may be in the past.
    arrayNextAt: before5
      ? time + ARRAY_TICK
      : num(o.arrayNextAt, 0, time + ENEMY_ARRIVAL + ARRAY_TICK),
    qiNextAt: before13 ? time + QI_TICK : num(o.qiNextAt, time, time + QI_TICK),
    // Only an equipped banner holds souls, and never more than its cap.
    souls: before6 ? 0 : int(o.souls, 0, soulCap(cultivator.equipment)),
    inventory: arr(o.inventory, bagSize).map((i) => readItem(i, highestFloor, items)),
    bagSize,
    stones: v1 ? 0 : int(o.stones, 0, COUNT),
    essence: v1 ? 0 : int(o.essence, 0, COUNT),
    filter: v1 ? defaultFilter() : readFilter(o.filter, items.slot),
    dropsSold: v1 ? 0 : int(o.dropsSold, 0, COUNT),
    dropsSalvaged: v1 ? 0 : int(o.dropsSalvaged, 0, COUNT),
    kills: int(o.kills, 0, COUNT),
    deaths: int(o.deaths, 0, COUNT),
    insight: before3 ? 0 : int(o.insight, 0, COUNT),
    passives,
    retirements: before3 ? 0 : int(o.retirements, 0, COUNT),
    store: before10 ? emptyStore() : readStore(o.store, time),
    boosts: before10 ? noBoosts() : readBoosts(o.boosts, time),
    trial: readTrial(o.trial, time, readyForTribulation(cultivator)),
    combat: freshCombat(),
  };
  if (oldCaps) toNewRealms(state);
  return state;
}

/** A stock rolled at or before `time`'s rotation: STOCK_SIZE different offers, or none before the first roll. */
function readStore(v: unknown, time: number): StoreState {
  const o = obj(v, ['rotation', 'offers', 'sold']);
  const rotation = int(o.rotation, -1, rotationAt(time));
  const size = rotation < 0 ? 0 : STOCK_SIZE;
  const offers = arr(o.offers, size).map((id) => oneOf(id, OFFER_IDS));
  const sold = arr(o.sold, size).map((b) => (typeof b === 'boolean' ? b : fail('sold')));
  if (offers.length !== size || sold.length !== size) fail('stock size');
  if (new Set<OfferId>(offers).size !== size) fail('repeated offer');
  return { rotation, offers, sold };
}

/** Each expiry in sim seconds, never more than a full boost past `time`. */
function readBoosts(v: unknown, time: number): Boosts {
  const o = obj(v, BOOST_IDS);
  const boosts = noBoosts();
  for (const id of BOOST_IDS) boosts[id] = num(o[id], 0, time + BOOST_CAP_SECONDS);
  return boosts;
}

/**
 * The Tribulation retry record. Unlike the rest of the save, a bad or missing
 * one does not reject the save: it falls back to the defaults (switch on, no
 * losses), which at worst puts the Tribulation back on the floor.
 */
function readTrial(v: unknown, time: number, held: boolean): TrialState {
  if (v === undefined) return newTrial();
  try {
    const o = obj(v, ['auto', 'losses', 'lostAt', 'lostDamage', 'lostMaxHp']);
    if (typeof o.auto !== 'boolean') fail('auto');
    const trial: TrialState = {
      auto: o.auto,
      losses: int(o.losses, 0, COUNT),
      // A loss is never in the future.
      lostAt: num(o.lostAt, 0, time),
      lostDamage: num(o.lostDamage, 0, COUNT),
      lostMaxHp: int(o.lostMaxHp, 0, COUNT),
    };
    // A loss is recorded with the cultivator's strength, which is never 0.
    if (trial.losses > 0 && (trial.lostDamage <= 0 || trial.lostMaxHp <= 0)) fail('no strength');
    // Losses only count against a Tribulation that is due; a win clears them.
    return held ? trial : newTrial(trial.auto);
  } catch (e) {
    if (e instanceof Bad) return newTrial();
    throw e;
  }
}

function readPassives(v: unknown): Passives {
  const o = obj(v, PASSIVE_IDS);
  const passives = noPassives();
  for (const id of PASSIVE_IDS) passives[id] = int(o[id], 0, PASSIVES[id].maxRank);
  return passives;
}

const FILTER_ACTIONS: readonly FilterAction[] = ['sell', 'salvage'];

/** An older save's name for an item type or position, as it is called now. */
type SlotName = (id: unknown) => unknown;

/** How a save of some version stores its items. */
interface ItemReader {
  slot: SlotName;
  /** True from v8 on, when an item may carry a refine level. */
  refines: boolean;
}

/**
 * Pants became Boots in v4: the type, and the position that takes it. A save
 * from before has no boots.
 */
function fromPants(id: unknown): unknown {
  if (id === 'boots') fail('boots before v4');
  return id === 'pants' ? 'boots' : id;
}

function readFilter(v: unknown, slot: SlotName): LootFilter {
  const o = obj(v, ['minGrade', 'slots', 'action']);
  const slots = arr(o.slots, SLOT_IDS.length).map((id) => oneOf(slot(id), SLOT_IDS));
  // In SLOTS order without repeats, as setFilter keeps them.
  if (SLOT_IDS.filter((id) => slots.includes(id)).join() !== slots.join()) fail('filter slots');
  return {
    minGrade: oneOf(o.minGrade, GRADE_IDS),
    slots,
    action: oneOf(o.action, FILTER_ACTIONS),
  };
}

function readCultivator(
  v: unknown,
  time: number,
  highestFloor: number,
  v1: boolean,
  bonus: number,
  items: ItemReader,
  before4: boolean,
  oldCaps: readonly number[] | null,
  before13: boolean,
): Cultivator {
  // An older save was priced on the old XP curve; what it held below a cap still counts.
  const price = oldCaps ? oldXpToNext : xpToNext;
  const o = obj(v, [
    'path',
    'level',
    'xp',
    'stats',
    'equipment',
    'hp',
    'nextAttackAt',
    'attackCount',
    ...(v1 ? [] : ['unspent']),
    ...(before13 ? [] : ['qi']),
  ]);
  const path = oneOf(o.path, PATH_IDS);
  const level = int(o.level, 1, MAX_LEVEL);
  const s = obj(o.stats, STAT_IDS);
  const stats = { body: 0, agility: 0, spirit: 0 };
  for (const id of STAT_IDS) stats[id] = int(s[id], BASE_STAT, Number.MAX_SAFE_INTEGER);
  // Every stat point comes from the start, a level-up or a Head Start passive;
  // none can appear from nowhere.
  const points =
    3 * BASE_STAT + STARTING_PRIMARY_BONUS + STAT_POINTS_PER_LEVEL * (level - 1) + bonus;
  const unspent = v1 ? 0 : int(o.unspent, 0, points);
  if (stats.body + stats.agility + stats.spirit + unspent !== points) fail('stat points');
  // The positions under the names this save uses.
  const saved = before4 ? EQUIP_IDS.map((at) => (at === 'boots' ? 'pants' : at)) : EQUIP_IDS;
  const eq = obj(o.equipment, [], saved);
  const equipment: Equipment = {};
  for (const [i, at] of EQUIP_IDS.entries()) {
    const key = saved[i] as string;
    if (!Object.hasOwn(eq, key)) continue;
    const item = readItem(eq[key], highestFloor, items);
    if (EQUIP_SLOTS[at].takes !== item.slot) fail('item in wrong slot');
    equipment[at] = item;
  }
  const c: Cultivator = {
    path,
    level,
    // XP past a realm cap is held until the Tribulation is won. Below one, the
    // limit may be another engine's (see same()), so it is kept within ours.
    xp: (oldCaps ? oldCaps.includes(level) : isRealmCap(level))
      ? int(o.xp, 0, COUNT)
      : Math.min(int(o.xp, 0, give(price(level) - 1)), price(level) - 1, COUNT),
    stats,
    unspent,
    equipment,
    hp: 0,
    qi: 0,
    nextAttackAt: attackAt(o.nextAttackAt, time, MAX_INTERVAL),
    attackCount: int(o.attackCount, 0, Number.MAX_SAFE_INTEGER),
  };
  // Never above the max the stats allow; that max may carry another engine's rounding.
  if (!before13) c.qi = Math.min(num(o.qi, 0, give(derive(c).maxQi)), derive(c).maxQi);
  if (oldCaps) {
    // The old ladder may have put this level in a higher realm, with a bigger bonus.
    const max = derive(c).maxHp;
    c.hp = Math.min(
      num(o.hp, Number.MIN_VALUE, give(max * (1 + REALM_BONUS * REALMS.length))),
      max,
    );
    return c;
  }
  // Above 0 (a fight in progress) and never above the max the gear allows.
  c.hp = num(o.hp, Number.MIN_VALUE, derive(c).maxHp);
  return c;
}

/** The canonical fighting order of a floor; what is left is always its tail. */
const FLOOR_KINDS: readonly EnemyKind[] = [
  ...Array<EnemyKind>(WAVES_PER_FLOOR * DEMONS_PER_WAVE).fill('demon'),
  'elite',
  'boss',
];
const NAMES: Readonly<Record<Exclude<EnemyKind, 'tribulation'>, readonly string[]>> = {
  demon: DEMONS,
  elite: DEMONS.map((d) => `Elite ${d}`),
  boss: BOSSES,
};

/** v8's realm ladder: a cap every 10 levels up to 90. */
const V8_CAPS: readonly number[] = [10, 20, 30, 40, 50, 60, 70, 80, 90];
/** v9 and v10's: each realm 2 levels longer than the one before. */
const V10_CAPS: readonly number[] = [10, 22, 36, 52, 70, 90, 112, 136, 162];

/** XP to the next level before v11, when each level was 1.2× the one before. */
function oldXpToNext(level: number): number {
  return Math.round(50 * 1.2 ** (level - 1));
}

/** The caps a save of `version` was played on, or null when they are the current ones. */
function oldLadder(version: number): readonly number[] | null {
  if (version < 9) return V8_CAPS;
  return version < 11 ? V10_CAPS : null;
}

/** Whether a cultivator from an old ladder was held at one of its caps with a Tribulation due. */
function heldAtOldCap(c: Cultivator, caps: readonly number[]): boolean {
  return caps.includes(c.level) && c.xp >= oldXpToNext(c.level);
}

/**
 * Moves an older run onto the current realms and XP curve: XP held (at a cap
 * that is no longer one, or now worth more levels) buys its levels, and a
 * Tribulation is due only at a cap of the current ladder.
 */
function toNewRealms(s: GameState): void {
  const c = s.cultivator;
  gainXp(c, 0);
  const ready = readyForTribulation(c);
  const has = s.enemies.some((e) => e.kind === 'tribulation');
  if (has && !ready) {
    s.enemies = s.enemies.filter((e) => e.kind !== 'tribulation');
    // The Tribulation was all that was left: the floor it ended is cleared, so start it afresh.
    if (s.enemies.length === 0) startFloor(s, rngFrom(s.rng), ENEMY_ARRIVAL);
  }
  if (ready && !has) s.enemies.push(makeTribulation(s.floor, realmOf(c.level)));
}

function readEnemies(
  v: unknown,
  floor: number,
  c: Cultivator,
  ready: boolean,
  oldLadder: boolean,
  before13: boolean,
): Enemy[] {
  // A cultivator held at a cap may have the realm's Tribulation at the end of
  // the floor (or at its front, once faced), and only then. It may also be off
  // the floor: set aside after losses, or waiting for Face it with
  // Auto-Tribulation off.
  const list = arr(v, FLOOR_KINDS.length + (ready ? 1 : 0));
  const trial = ready && list.some((e) => (e as { kind?: unknown } | null)?.kind === 'tribulation');
  const order: readonly EnemyKind[] = trial ? [...FLOOR_KINDS, 'tribulation'] : FLOOR_KINDS;
  // A floor always has an enemy until it is cleared, and clearing starts the next one.
  if (list.length === 0) fail('no enemies');
  // Faced early (faceTribulation), it fights first and the floor it interrupted waits behind it.
  const faced =
    trial && list.length > 1 && (list[0] as { kind?: unknown } | null)?.kind === 'tribulation';
  const kinds = faced
    ? ['tribulation', ...FLOOR_KINDS.slice(FLOOR_KINDS.length - (list.length - 1))]
    : order.slice(order.length - list.length);
  return list.map((e, i) => {
    const o = obj(e, [
      'name',
      'kind',
      'maxHp',
      'hp',
      ...(before13 ? [] : ['qi']),
      'damage',
      'defence',
      'attackInterval',
      'xp',
    ]);
    const kind = kinds[i] as EnemyKind;
    if (o.kind !== kind) fail('enemy order');
    // Rebuilt from the floor, so every number is the sim's own, not the save's.
    const enemy =
      kind === 'tribulation'
        ? makeTribulation(floor, realmOf(c.level))
        : makeEnemy(floor, kind, oneOf(o.name, NAMES[kind]));
    // The realm fixes the Tribulation's name; for the others oneOf already checked
    // it. An old ladder's Tribulation may have another realm's, but still one of ours.
    if (oldLadder && kind === 'tribulation') oneOf(o.name, TRIBULATIONS);
    else if (o.name !== enemy.name) fail('enemy name');
    // HP, damage and XP grow by `**`, so may carry another engine's rounding.
    for (const k of ['maxHp', 'damage', 'xp'] as const) {
      if (!same(o[k], enemy[k])) fail(`enemy ${k}`);
    }
    for (const k of ['defence', 'attackInterval'] as const) {
      if (o[k] !== enemy[k]) fail(`enemy ${k}`);
    }
    enemy.hp = Math.min(num(o.hp, Number.MIN_VALUE, give(enemy.maxHp)), enemy.maxHp);
    // A demon has no pool, so a saved demon's qi can only be 0.
    enemy.qi = before13 ? 0 : num(o.qi, 0, maxQi(kind));
    return enemy;
  });
}

function readItem(v: unknown, highestFloor: number, reader: ItemReader): Item {
  const o = obj(
    v,
    ['slot', 'name', 'level', 'grade', 'baseRoll', 'affixes'],
    ['unique', 'array', ...(reader.refines ? ['refines'] : [])],
  );
  const slot = oneOf(reader.slot(o.slot), SLOT_IDS);
  const grade = oneOf(o.grade, GRADE_IDS);
  const [min, max] = GRADES[grade].affixes;
  const affixes: Affix[] = arr(o.affixes, max).map((a) => {
    const x = obj(a, ['id', 'roll']);
    return { id: oneOf(x.id, AFFIX_IDS), roll: roll(x.roll) };
  });
  if (affixes.length < min) fail('too few affixes');
  if (new Set(affixes.map((a) => a.id)).size !== affixes.length) fail('repeated affix');
  const item: Item = {
    slot,
    name: oneOf(renamed(slot, grade, o.name), namesFor(slot, grade)),
    // An item drops on a floor the run has reached.
    level: int(o.level, 1, highestFloor),
    grade,
    baseRoll: roll(o.baseRoll),
    affixes,
  };
  // Immortal items, and only they, carry one unique effect.
  if (grade === 'immortal') item.unique = oneOf(o.unique, UNIQUE_IDS);
  else if (Object.hasOwn(o, 'unique')) fail('unique on a lower grade');
  // Formation Discs, and only they, carry one array.
  if (isDisc(item)) item.array = oneOf(o.array, ARRAY_IDS);
  else if (Object.hasOwn(o, 'array')) fail('array on an item that is not a disc');
  // A refine level is a whole number up to MAX_REFINES; 0 is the same as none,
  // and is left out as the game leaves it out. Each refine adds at least a
  // point of base roll, so there are never more refines than base roll points.
  if (Object.hasOwn(o, 'refines')) {
    const refines = int(o.refines, 0, Math.min(MAX_REFINES, rollPoints(item.baseRoll)));
    if (refines > 0) item.refines = refines;
  }
  return item;
}
