// The save: game state in browser storage, as versioned JSON (docs/design.md
// §11). Loading trusts nothing: every field is checked against an allow-list
// (exact keys, known enums, known names, whole numbers in range) and copied
// into a fresh object. Anything off means no save, so the player starts a new
// run instead of the page crashing or running on tampered state.

import {
  BASE_STAT,
  derive,
  isRealmCap,
  PATHS,
  readyForTribulation,
  realmOf,
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
  type FilterAction,
  type LootFilter,
} from '../core/economy.ts';
import {
  BOSSES,
  DEMONS,
  DEMONS_PER_WAVE,
  makeEnemy,
  makeTribulation,
  WAVES_PER_FLOOR,
  type Enemy,
  type EnemyKind,
} from '../core/floors.ts';
import {
  AFFIXES,
  EQUIP_SLOTS,
  GRADES,
  SLOTS,
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
import type { GameState } from '../core/sim.ts';

export const SAVE_KEY = 'office-immortal.save';
/** Where a save that failed to load is kept, so a new run's autosave doesn't destroy it. */
export const REJECTED_KEY = 'office-immortal.save.rejected';
export const SAVE_VERSION = 2;
/** Older versions that still load: v1 came before currencies, the filter and bag upgrades. */
const OLD_VERSIONS: readonly number[] = [1];
/** A full save is a few KB; anything far bigger is not ours and is not parsed. */
export const MAX_SAVE_CHARS = 200_000;
/** Far past anything a run reaches, and low enough that every formula stays finite. */
export const MAX_LEVEL = 3000;
export const MAX_FLOOR = 3000;
/** Sim clock limit, in seconds (over 30,000 years). */
const MAX_TIME = 1e12;
/** The longest attack interval in the game, in seconds; a next-attack time is never further off. */
const MAX_INTERVAL = 2;

/** The parts of `Storage` the save uses, so tests can pass a plain object. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;

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

export function encodeSave(state: GameState, savedAt: number): string {
  return JSON.stringify({ v: SAVE_VERSION, savedAt, state });
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

/** Writes the save; returns false when storage refuses (full, blocked). */
export function writeSave(storage: SaveStorage, state: GameState, savedAt: number): boolean {
  try {
    storage.setItem(SAVE_KEY, encodeSave(state, savedAt));
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

// Validation. Each reader throws Bad on the first problem; decodeSave turns
// that into null. Readers build new objects field by field, so a key the
// schema doesn't name (such as __proto__) is never copied, and is rejected.

class Bad extends Error {}

function fail(what: string): never {
  throw new Bad(what);
}

type Obj = Record<string, unknown>;

/** A plain object with exactly `required` keys, plus any of `optional`. */
function obj(v: unknown, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('not an object');
  if (Object.getPrototypeOf(v) !== Object.prototype) fail('not a plain object');
  const keys = Object.keys(v);
  for (const k of keys) if (!required.includes(k) && !optional.includes(k)) fail(`key ${k}`);
  for (const k of required) if (!Object.hasOwn(v, k)) fail(`missing ${k}`);
  return v as Obj;
}

function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail('bad array');
  return v;
}

function num(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail('bad number');
  return v;
}

function int(v: unknown, min: number, max: number): number {
  const n = num(v, min, max);
  if (!Number.isInteger(n)) fail('not whole');
  return n;
}

/** One of `allowed`, compared exactly, so look-alike or padded text never matches. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail('not allowed');
  return v as T;
}

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

/** Reads a state of `version`; a v1 state gets the defaults of what it lacks. */
function readState(v: unknown, version: number): GameState {
  const v1 = version === 1;
  const o = obj(v, [
    'time',
    'rng',
    'cultivator',
    'floor',
    'highestFloor',
    'enemies',
    'enemyNextAttackAt',
    'inventory',
    'kills',
    'deaths',
    ...(v1
      ? ['dropsLost']
      : ['bagSize', 'stones', 'essence', 'filter', 'dropsSold', 'dropsSalvaged']),
  ]);
  const time = num(o.time, 0, MAX_TIME);
  const highestFloor = int(o.highestFloor, 1, MAX_FLOOR);
  const floor = int(o.floor, 1, highestFloor);
  const rng = obj(o.rng, ['s']);
  // v1 counted drops lost to a full bag; they were never sold, so the count is dropped.
  if (v1) int(o.dropsLost, 0, COUNT);
  const bagSize = v1 ? INVENTORY_SIZE : int(o.bagSize, INVENTORY_SIZE, MAX_BAG_SIZE);
  if ((bagSize - INVENTORY_SIZE) % BAG_ROW !== 0) fail('bag size');
  const cultivator = readCultivator(o.cultivator, time, highestFloor, v1);
  const state: GameState = {
    time,
    rng: { s: int(rng.s, 0, 0xffffffff) },
    cultivator,
    floor,
    highestFloor,
    enemies: readEnemies(o.enemies, floor, cultivator),
    enemyNextAttackAt: num(o.enemyNextAttackAt, time, time + MAX_INTERVAL),
    inventory: arr(o.inventory, bagSize).map((i) => readItem(i, highestFloor)),
    bagSize,
    stones: v1 ? 0 : int(o.stones, 0, COUNT),
    essence: v1 ? 0 : int(o.essence, 0, COUNT),
    filter: v1 ? defaultFilter() : readFilter(o.filter),
    dropsSold: v1 ? 0 : int(o.dropsSold, 0, COUNT),
    dropsSalvaged: v1 ? 0 : int(o.dropsSalvaged, 0, COUNT),
    kills: int(o.kills, 0, COUNT),
    deaths: int(o.deaths, 0, COUNT),
  };
  return state;
}

const FILTER_ACTIONS: readonly FilterAction[] = ['sell', 'salvage'];

function readFilter(v: unknown): LootFilter {
  const o = obj(v, ['minGrade', 'slots', 'action']);
  const slots = arr(o.slots, SLOT_IDS.length).map((id) => oneOf(id, SLOT_IDS));
  // In SLOTS order without repeats, as setFilter keeps them.
  if (SLOT_IDS.filter((id) => slots.includes(id)).join() !== slots.join()) fail('filter slots');
  return {
    minGrade: oneOf(o.minGrade, GRADE_IDS),
    slots,
    action: oneOf(o.action, FILTER_ACTIONS),
  };
}

function readCultivator(v: unknown, time: number, highestFloor: number, v1: boolean): Cultivator {
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
  ]);
  const path = oneOf(o.path, PATH_IDS);
  const level = int(o.level, 1, MAX_LEVEL);
  const s = obj(o.stats, STAT_IDS);
  const stats = { body: 0, agility: 0, spirit: 0 };
  for (const id of STAT_IDS) stats[id] = int(s[id], BASE_STAT, Number.MAX_SAFE_INTEGER);
  // Every stat point comes from the start or a level-up; none can appear from nowhere.
  const points = 3 * BASE_STAT + STARTING_PRIMARY_BONUS + STAT_POINTS_PER_LEVEL * (level - 1);
  const unspent = v1 ? 0 : int(o.unspent, 0, points);
  if (stats.body + stats.agility + stats.spirit + unspent !== points) fail('stat points');
  const eq = obj(o.equipment, [], EQUIP_IDS);
  const equipment: Equipment = {};
  for (const at of EQUIP_IDS) {
    if (!Object.hasOwn(eq, at)) continue;
    const item = readItem(eq[at], highestFloor);
    if (EQUIP_SLOTS[at].takes !== item.slot) fail('item in wrong slot');
    equipment[at] = item;
  }
  const c: Cultivator = {
    path,
    level,
    // XP past a realm cap is held until the Tribulation is won.
    xp: int(o.xp, 0, isRealmCap(level) ? COUNT : xpToNext(level) - 1),
    stats,
    unspent,
    equipment,
    hp: 0,
    nextAttackAt: num(o.nextAttackAt, time, time + MAX_INTERVAL),
    attackCount: int(o.attackCount, 0, Number.MAX_SAFE_INTEGER),
  };
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

function readEnemies(v: unknown, floor: number, c: Cultivator): Enemy[] {
  // A cultivator held at a cap has the realm's Tribulation at the end of the
  // floor, and only then.
  const ready = readyForTribulation(c);
  const order: readonly EnemyKind[] = ready ? [...FLOOR_KINDS, 'tribulation'] : FLOOR_KINDS;
  const list = arr(v, order.length);
  // A floor always has an enemy until it is cleared, and clearing starts the next one.
  if (list.length === 0) fail('no enemies');
  const kinds = order.slice(order.length - list.length);
  return list.map((e, i) => {
    const o = obj(e, ['name', 'kind', 'maxHp', 'hp', 'damage', 'defence', 'attackInterval', 'xp']);
    const kind = kinds[i] as EnemyKind;
    if (o.kind !== kind) fail('enemy order');
    // Rebuilt from the floor, so every number is the sim's own, not the save's.
    const enemy =
      kind === 'tribulation'
        ? makeTribulation(floor, realmOf(c.level))
        : makeEnemy(floor, kind, oneOf(o.name, NAMES[kind]));
    // The realm fixes the Tribulation's name; for the others oneOf already checked it.
    if (o.name !== enemy.name) fail('enemy name');
    for (const k of ['maxHp', 'damage', 'defence', 'attackInterval', 'xp'] as const) {
      if (o[k] !== enemy[k]) fail(`enemy ${k}`);
    }
    enemy.hp = num(o.hp, Number.MIN_VALUE, enemy.maxHp);
    return enemy;
  });
}

function readItem(v: unknown, highestFloor: number): Item {
  const o = obj(v, ['slot', 'name', 'level', 'grade', 'baseRoll', 'affixes'], ['unique']);
  const slot = oneOf(o.slot, SLOT_IDS);
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
    name: oneOf(o.name, SLOTS[slot].names),
    // An item drops on a floor the run has reached.
    level: int(o.level, 1, highestFloor),
    grade,
    baseRoll: roll(o.baseRoll),
    affixes,
  };
  // Immortal items, and only they, carry one unique effect.
  if (grade === 'immortal') item.unique = oneOf(o.unique, UNIQUE_IDS);
  else if (Object.hasOwn(o, 'unique')) fail('unique on a lower grade');
  return item;
}
