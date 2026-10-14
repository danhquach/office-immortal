// Dev builds only: the Debug panel's setups (issue #118). Each takes a state
// and returns a new one through the game's own rules (rolls, equip, pickUp,
// restartFloor); the panel then runs the save checker on it before keeping it.
// Pure, like src/core: no DOM, no storage. Throws RangeError with a reason
// when a setup can't apply.

import {
  derive,
  newCultivator,
  PATHS,
  REALM_CAPS,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
  type PathId,
} from '../core/cultivator.ts';
import { BAG_ROW, earn, INVENTORY_SIZE, MAX_BAG_SIZE, pickUp } from '../core/economy.ts';
import {
  ARRAY_IDS,
  EQUIP_SLOTS,
  isBanner,
  namesFor,
  rollItem,
  rollItemAs,
  soulCap,
  SLOTS,
  type ArrayId,
  type EquipSlotId,
  type GradeId,
  type Item,
  type SlotId,
} from '../core/loot.ts';
import { bonusPoints } from '../core/prestige.ts';
import { rngFrom } from '../core/rng.ts';
import {
  canEquip,
  equip,
  newGame,
  restartFloor,
  tick,
  TRIAL_LOSS_LIMIT,
  unequip,
  type GameState,
} from '../core/sim.ts';
import { MAX_FLOOR } from '../storage/save.ts';

/** The highest level a setup goes to: XP to the next level stays a safe whole number. */
export const MAX_DEBUG_LEVEL = 230;

const SLOT_IDS = Object.keys(SLOTS) as SlotId[];
const EQUIP_IDS = Object.keys(EQUIP_SLOTS) as EquipSlotId[];

function whole(n: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RangeError(`${what} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function roomFor(s: GameState, n: number): void {
  if (s.inventory.length + n > s.bagSize) throw new RangeError('the bag has no room');
}

/** An item of this type, grade and name, rolled as a drop on floor `level` would be. */
export function addItem(
  state: GameState,
  slot: SlotId,
  grade: GradeId,
  name: string,
  level: number,
): GameState {
  whole(level, 1, state.highestFloor, 'item level (up to the highest floor)');
  roomFor(state, 1);
  const s = structuredClone(state);
  s.inventory.push(rollItemAs(rngFrom(s.rng), slot, grade, name, level));
  return s;
}

/** One item of every type at `grade`, each its type's first name. */
export function addEveryType(state: GameState, grade: GradeId, level: number): GameState {
  whole(level, 1, state.highestFloor, 'item level (up to the highest floor)');
  roomFor(state, SLOT_IDS.length);
  const s = structuredClone(state);
  const rng = rngFrom(s.rng);
  for (const slot of SLOT_IDS) {
    s.inventory.push(rollItemAs(rng, slot, grade, namesFor(slot, grade)[0] as string, level));
  }
  return s;
}

/** Random drops of the current floor's level until the bag has `free` cells left. */
export function fillBag(state: GameState, free: number): GameState {
  const s = structuredClone(state);
  const rng = rngFrom(s.rng);
  while (s.inventory.length < s.bagSize - free) s.inventory.push(rollItem(rng, s.floor));
  return s;
}

export function emptyBag(state: GameState): GameState {
  const s = structuredClone(state);
  s.inventory = [];
  return s;
}

/** The bag sizes Spirit Stones can buy, smallest first. */
export const BAG_SIZES: readonly number[] = Array.from(
  { length: (MAX_BAG_SIZE - INVENTORY_SIZE) / BAG_ROW + 1 },
  (_, i) => INVENTORY_SIZE + i * BAG_ROW,
);

export function setBagSize(state: GameState, size: number): GameState {
  if (!BAG_SIZES.includes(size)) throw new RangeError(`bag size must be one of ${BAG_SIZES}`);
  if (state.inventory.length > size) throw new RangeError('the bag holds more items than that');
  const s = structuredClone(state);
  s.bagSize = size;
  return s;
}

/**
 * The cultivator at `level` with no XP, every level's stat points on the
 * Path's primary stat as levelling puts them, gear kept; the floor starts
 * again so its Tribulation matches the new level.
 */
export function setLevel(state: GameState, level: number): GameState {
  whole(level, 1, MAX_DEBUG_LEVEL, 'level');
  const s = structuredClone(state);
  const c = s.cultivator;
  const fresh = newCultivator(c.path, bonusPoints(s.passives));
  fresh.stats[PATHS[c.path].primary] += STAT_POINTS_PER_LEVEL * (level - 1);
  c.stats = fresh.stats;
  c.unspent = 0;
  c.level = level;
  c.xp = 0;
  for (const at of EQUIP_IDS) {
    const item = c.equipment[at];
    if (item && !canEquip(c, item)) {
      throw new RangeError(`the worn ${item.name} needs a higher realm: unequip it first`);
    }
  }
  return restartFloor(s);
}

/** The floor and the highest floor reached; the floor starts again from its first enemy. */
export function setFloors(state: GameState, floor: number, highest: number): GameState {
  whole(highest, 1, MAX_FLOOR, 'highest floor');
  whole(floor, 1, highest, 'floor (up to the highest floor)');
  const items = [...state.inventory, ...Object.values(state.cultivator.equipment)];
  const top = Math.max(0, ...items.map((i) => i.level));
  if (top > highest) throw new RangeError(`an item is level ${top}: highest floor must reach it`);
  const s = structuredClone(state);
  s.floor = floor;
  s.highestFloor = highest;
  return restartFloor(s);
}

export function setHp(state: GameState, to: 'full' | 'low'): GameState {
  const s = structuredClone(state);
  s.cultivator.hp = to === 'full' ? derive(s.cultivator).maxHp : 1;
  return s;
}

export type Resource = 'stones' | 'essence' | 'insight';

export function addResource(state: GameState, what: Resource, n: number): GameState {
  whole(n, 0, Number.MAX_SAFE_INTEGER, 'amount');
  const s = structuredClone(state);
  if (what === 'insight') s.insight = Math.min(Number.MAX_SAFE_INTEGER, s.insight + n);
  else earn(s, what, n);
  return s;
}

/** Souls on the worn Soul Banner, up to its cap. */
export function setSouls(state: GameState, souls: number): GameState {
  const cap = soulCap(state.cultivator.equipment);
  if (cap === 0) throw new RangeError('no Soul Banner is worn');
  whole(souls, 0, cap, 'souls');
  const s = structuredClone(state);
  s.souls = souls;
  return s;
}

/** Every worn item into the bag, in position order, as Unequip does. */
export function unequipAll(state: GameState): GameState {
  const worn = EQUIP_IDS.filter((at) => state.cultivator.equipment[at]);
  roomFor(state, worn.length);
  return worn.reduce(unequip, state);
}

/** The next realm cap with its Tribulation due, at the end of a fresh floor. */
export function skipToTribulation(state: GameState): GameState {
  const { level } = state.cultivator;
  const cap = REALM_CAPS.find((c) => c >= level);
  if (cap === undefined) throw new RangeError('no Tribulation is left past this realm');
  const s = setLevel(state, cap);
  s.cultivator.xp = xpToNext(cap);
  return restartFloor(s);
}

/** The next realm's Tribulation due and set aside after TRIAL_LOSS_LIMIT losses just now. */
export function setTribulationAside(state: GameState): GameState {
  const s = skipToTribulation(state);
  const d = derive(s.cultivator);
  s.trial = {
    ...s.trial,
    losses: TRIAL_LOSS_LIMIT,
    lostAt: s.time,
    lostDamage: d.damage,
    lostMaxHp: d.maxHp,
  };
  return restartFloor(s);
}

export function freshRun(seed: number, path: PathId): GameState {
  return newGame(seed, path);
}

/**
 * The force-drop hook: when a kill between `prev` and `next` dropped nothing,
 * an item of the floor's level drops now, through pickUp as any drop. Null
 * when no enemy died.
 */
export function dropOnKill(prev: GameState, next: GameState): GameState | null {
  if (next.kills === prev.kills) return null;
  const dropped =
    next.inventory.length -
    prev.inventory.length +
    next.dropsSold -
    prev.dropsSold +
    next.dropsSalvaged -
    prev.dropsSalvaged;
  if (dropped > 0) return next;
  const s = structuredClone(next);
  pickUp(s, rollItem(rngFrom(s.rng), s.floor));
  return s;
}

/** One tick of the run under the panel's time controls. */
export interface DebugStep {
  state: GameState;
  /** The run now holds what the game alone would not have: sped-up time or a forced drop. */
  cheated: boolean;
  /** The forced drop is spent (a kill dropped, naturally or forced). */
  dropped: boolean;
}

/** Plays `dt` seconds at `speed`, then forces a drop on a kill if `forceDrop` is armed. */
export function debugStep(
  state: GameState,
  dt: number,
  speed: number,
  forceDrop: boolean,
): DebugStep {
  const next = tick(state, dt * speed);
  const cheated = speed > 1;
  if (!forceDrop) return { state: next, cheated, dropped: false };
  const forced = dropOnKill(state, next);
  if (!forced) return { state: next, cheated, dropped: false };
  return { state: forced, cheated: cheated || forced !== next, dropped: true };
}

/** Puts on an item from the bag (the last one added) at `at`, through equip. */
function wearLast(state: GameState, at?: EquipSlotId): GameState {
  return equip(state, state.inventory.length - 1, at);
}

/** Named setups for the panel and for browser checks (window.officeDebug.scenario). */
export const SCENARIOS = {
  /** A full bag with an item worn, to check Unequip with no room. */
  fullBag: (s: GameState) =>
    fillBag(
      wearLast(
        addItem(emptyBag(s), 'weapon', 'spirit', namesFor('weapon', 'spirit')[0] as string, 1),
      ),
      0,
    ),
  /** A bag of two pages, the second partly filled. */
  twoPages: (s: GameState) => fillBag(setBagSize(emptyBag(s), INVENTORY_SIZE + BAG_ROW), 3),
  /** Weapons gated at Foundation Establishment and Golden Core, at level 1. */
  gatedWeapons: (s: GameState) =>
    (['earth', 'heaven', 'immortal'] as const).reduce(
      (st, g) => addItem(st, 'weapon', g, namesFor('weapon', g)[0] as string, 1),
      setLevel(unequipAll(emptyBag(s)), 1),
    ),
  /** A Spirit Soul Banner worn with its souls full. */
  soulBanner: (s: GameState) => {
    const name = namesFor('sideArm', 'spirit').find((n) => isBanner({ slot: 'sideArm', name: n }));
    const worn = wearLast(addItem(s, 'sideArm', 'spirit', name as string, 1), 'sideArm');
    return setSouls(worn, soulCap(worn.cultivator.equipment));
  },
  /** One Formation Disc of each array in the bag. */
  discs: (s: GameState) => {
    const name = namesFor('attachment', 'earth')[1] as string;
    roomFor(s, ARRAY_IDS.length);
    return ARRAY_IDS.reduce((st, id: ArrayId) => {
      const next = addItem(st, 'attachment', 'earth', name, 1);
      (next.inventory[next.inventory.length - 1] as Item).array = id;
      return next;
    }, s);
  },
  /** Accessories and charms, which fit two positions each. */
  twoPositions: (s: GameState) =>
    (['accessory', 'charm'] as const).reduce(
      (st, slot) =>
        addItem(
          addItem(st, slot, 'spirit', namesFor(slot, 'spirit')[0] as string, 1),
          slot,
          'earth',
          namesFor(slot, 'earth')[0] as string,
          1,
        ),
      s,
    ),
  /** The next realm's Tribulation due. */
  tribulationDue: skipToTribulation,
  /** The same, set aside after three losses. */
  tribulationPaused: setTribulationAside,
} satisfies Record<string, (s: GameState) => GameState>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

/** The named setup `id`, from the allow-list only (never an inherited name such as `constructor`). */
export function scenarioFor(id: unknown): (s: GameState) => GameState {
  if (typeof id !== 'string' || !(SCENARIO_IDS as readonly string[]).includes(id)) {
    throw new RangeError(`unknown setup; one of ${SCENARIO_IDS.join(', ')}`);
  }
  return SCENARIOS[id as ScenarioId];
}
