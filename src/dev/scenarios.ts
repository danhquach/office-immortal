// Dev builds only: the Debug panel's setups (issue #118). Each takes a state
// and returns a new one through the game's own rules (rolls, equip, pickUp,
// restartFloor); the panel then runs the save checker on it before keeping it.
// Pure, like src/core: no DOM, no storage. Throws RangeError with a reason
// when a setup can't apply.

import {
  derive,
  newCultivator,
  readyForTribulation,
  REALM_CAPS,
  spendByPlan,
  STAT_POINTS_PER_LEVEL,
  xpToNext,
  zeroCarry,
  type PathId,
} from '../core/cultivator.ts';
import {
  answerFreeReset,
  BAG_ROW,
  canResetStats,
  earn,
  INVENTORY_SIZE,
  MAX_BAG_SIZE,
  pickUp,
} from '../core/economy.ts';
import type { EnemyKind } from '../core/floors.ts';
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
import {
  bonusPoints,
  PASSIVE_IDS,
  PASSIVES,
  POINTS_PER_RANK,
  RETIRE_MIN_FLOOR,
  type PassiveId,
} from '../core/prestige.ts';
import { rngFrom } from '../core/rng.ts';
import {
  activePlan,
  canEquip,
  equip,
  newGame,
  restartFloor,
  tick,
  TRIAL_LOSS_LIMIT,
  unequip,
  type GameState,
} from '../core/sim.ts';
import { BOOST_CAP_SECONDS, BOOST_IDS, emptyStore, type BoostId } from '../core/store.ts';
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
 * The cultivator at `level` with no XP, every level's stat points placed as
 * levelling places them (by the Auto-assign plan when it is on, else left
 * unspent), gear kept; the floor starts again so its Tribulation matches the
 * new level.
 */
export function setLevel(state: GameState, level: number): GameState {
  whole(level, 1, MAX_DEBUG_LEVEL, 'level');
  const s = structuredClone(state);
  const c = s.cultivator;
  const fresh = newCultivator(c.path, bonusPoints(s.passives));
  c.stats = fresh.stats;
  c.unspent = fresh.unspent;
  // At the new level first, so a plan's spend heals with that level's realm bonus.
  c.level = level;
  c.xp = 0;
  const points = STAT_POINTS_PER_LEVEL * (level - 1);
  const plan = activePlan(s);
  if (plan) {
    // A fresh spend of every level's points: the plan's rounding starts afresh.
    plan.carry = zeroCarry();
    spendByPlan(c, plan, points);
  } else c.unspent += points;
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

/**
 * The next realm's Tribulation due (kept when one is due already) after
 * `losses` losses in a row just now, at the cultivator's strength; at
 * TRIAL_LOSS_LIMIT it is set aside.
 */
export function setTrialLosses(state: GameState, losses: number): GameState {
  whole(losses, 0, TRIAL_LOSS_LIMIT, 'losses');
  const s = readyForTribulation(state.cultivator)
    ? structuredClone(state)
    : skipToTribulation(state);
  const d = derive(s.cultivator);
  const lost = losses > 0;
  s.trial = {
    ...s.trial,
    losses,
    lostAt: lost ? s.time : 0,
    lostDamage: lost ? d.damage : 0,
    lostMaxHp: lost ? d.maxHp : 0,
  };
  return restartFloor(s);
}

/** The next realm's Tribulation due and set aside after TRIAL_LOSS_LIMIT losses just now. */
export function setTribulationAside(state: GameState): GameState {
  return setTrialLosses(state, TRIAL_LOSS_LIMIT);
}

export type FightKind = Extract<EnemyKind, 'elite' | 'boss'>;

/**
 * Floor `floor` (up to the highest floor) starts again with its demon waves
 * cleared, and for a boss its elite too, so the next enemy is the one asked
 * for; a due Tribulation still waits at the end. The cultivator's HP and qi
 * are kept, so a fight can be set up first. Beating it plays on as normal.
 */
export function jumpToFight(state: GameState, kind: FightKind, floor: number): GameState {
  if (kind !== 'elite' && kind !== 'boss') throw new RangeError('fight must be elite or boss');
  whole(floor, 1, state.highestFloor, 'floor (up to the highest floor)');
  const { hp, qi } = state.cultivator;
  const s = structuredClone(state);
  s.floor = floor;
  const out = restartFloor(s);
  const skip: readonly EnemyKind[] = kind === 'boss' ? ['demon', 'elite'] : ['demon'];
  out.enemies = out.enemies.filter((e) => !skip.includes(e.kind));
  const d = derive(out.cultivator);
  out.cultivator.hp = Math.min(hp, d.maxHp);
  out.cultivator.qi = Math.min(qi, d.maxQi);
  return out;
}

/** Qi to `qi` (a whole number up to the max), or to the exact max with `'full'`. */
export function setQi(state: GameState, qi: number | 'full'): GameState {
  const max = derive(state.cultivator).maxQi;
  if (qi !== 'full') whole(qi, 0, Math.floor(max), 'qi');
  const s = structuredClone(state);
  s.cultivator.qi = qi === 'full' ? max : qi;
  return s;
}

/** Every one of the cultivator's skills off cooldown now, mid-fight. */
export function resetCooldowns(state: GameState): GameState {
  const s = structuredClone(state);
  s.combat.you.cooldowns = {};
  return s;
}

/** Qi full and every skill off cooldown: the next skill its rules allow goes off. */
export function readyToCast(state: GameState): GameState {
  return resetCooldowns(setQi(state, 'full'));
}

/** The enemy in front down to 1 HP, so the next hit kills it through the normal rules. */
export function foeToOneHp(state: GameState): GameState {
  const s = structuredClone(state);
  const foe = s.enemies[0];
  if (!foe) throw new RangeError('no enemy to hit');
  foe.hp = Math.min(foe.hp, 1);
  return s;
}

/** Every spent stat point back to unspent, free, as the rebalance offer does; that offer is left as it was. */
export function freeStatReset(state: GameState): GameState {
  if (!canResetStats(state.cultivator)) throw new RangeError('no stat point is spent');
  const s = structuredClone(state);
  s.freeReset = true;
  const out = answerFreeReset(s, true);
  out.freeReset = state.freeReset;
  return out;
}

/** The one-time free stat reset offer on or off. */
export function setFreeResetOffer(state: GameState, on: boolean): GameState {
  const s = structuredClone(state);
  s.freeReset = on;
  return s;
}

/**
 * Passive `id` at `rank`. Head Start's points come and go unspent, as buying
 * a rank gives them; taking back more than are unspent is refused.
 */
export function setPassive(state: GameState, id: PassiveId, rank: number): GameState {
  if (!PASSIVE_IDS.includes(id)) throw new RangeError(`passive must be one of ${PASSIVE_IDS}`);
  whole(rank, 0, PASSIVES[id].maxRank, 'rank');
  const s = structuredClone(state);
  const before = bonusPoints(s.passives);
  s.passives[id] = rank;
  s.cultivator.unspent += bonusPoints(s.passives) - before;
  if (s.cultivator.unspent < 0) {
    throw new RangeError(`that takes back ${POINTS_PER_RANK} points a rank: reset stats first`);
  }
  return s;
}

/** The highest floor up to Early Retirement's minimum, so it pays Dao Insight. */
export function retireReady(state: GameState): GameState {
  return setFloors(state, state.floor, Math.max(state.highestFloor, RETIRE_MIN_FLOOR));
}

/** The store's stock thrown out; the game rolls a fresh one at once, free. */
export function restockStore(state: GameState): GameState {
  const s = structuredClone(state);
  s.store = emptyStore();
  return s;
}

/** Boost `id` on at its longest, or off. */
export function setBoost(state: GameState, id: BoostId, on: boolean): GameState {
  if (!BOOST_IDS.includes(id)) throw new RangeError(`boost must be one of ${BOOST_IDS}`);
  const s = structuredClone(state);
  s.boosts[id] = on ? s.time + BOOST_CAP_SECONDS : 0;
  return s;
}

/** The most hours a setup may say the player was away: past the offline cap, to test it. */
export const MAX_AWAY_HOURS = 24;

/** `hours` away, in seconds. */
export function awaySeconds(hours: number): number {
  return whole(hours, 1, MAX_AWAY_HOURS, 'hours away') * 3600;
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

/** Longest stretch played between HP refills while HP is kept full, in sim seconds. */
export const KEEP_HP_STEP = 0.1;
/** Most refills in one step, so a long step (a throttled tab) stays cheap. */
const MAX_KEEP_HP_STEPS = 1000;

/**
 * `seconds` of play; with `keepHp`, in short stretches each started at full
 * HP, so only a hit bigger than max HP can still end a fight.
 */
function play(state: GameState, seconds: number, keepHp: boolean): GameState {
  if (!keepHp) return tick(state, seconds);
  const n = Math.min(MAX_KEEP_HP_STEPS, Math.max(1, Math.ceil(seconds / KEEP_HP_STEP)));
  let s = state;
  for (let i = 0; i < n; i++) s = tick(setHp(s, 'full'), seconds / n);
  return s;
}

/**
 * Plays `dt` seconds at `speed` (HP kept full with `keepHp`), then forces a
 * drop on a kill if `forceDrop` is armed.
 */
export function debugStep(
  state: GameState,
  dt: number,
  speed: number,
  forceDrop: boolean,
  keepHp = false,
): DebugStep {
  const next = play(state, dt * speed, keepHp);
  const cheated = speed > 1 || keepHp;
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
  /** The same, one loss before it is set aside. */
  tribulationLastTry: (s: GameState) => setTrialLosses(s, TRIAL_LOSS_LIMIT - 1),
  /** This floor's elite next, at full HP and qi. */
  eliteFight: (s: GameState) => setQi(setHp(jumpToFight(s, 'elite', s.floor), 'full'), 'full'),
  /** This floor's boss next, at full HP and qi. */
  bossFight: (s: GameState) => setQi(setHp(jumpToFight(s, 'boss', s.floor), 'full'), 'full'),
  /** This floor's boss next, at full HP and no qi, for skills held back or out of reach. */
  lowQi: (s: GameState) => setQi(setHp(jumpToFight(s, 'boss', s.floor), 'full'), 0),
  /** Back after eight hours away (the panel saves it as written that long ago). */
  offline8h: (s: GameState) => s,
  /** Far enough up the tower for Early Retirement to pay Dao Insight. */
  retireReady,
} satisfies Record<string, (s: GameState) => GameState>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

/** How long ago a named setup is saved as written, in seconds; 0 for most. */
export function scenarioAway(id: ScenarioId): number {
  return id === 'offline8h' ? 8 * 3600 : 0;
}

/** The named setup `id`, from the allow-list only (never an inherited name such as `constructor`). */
export function scenarioFor(id: unknown): (s: GameState) => GameState {
  if (typeof id !== 'string' || !(SCENARIO_IDS as readonly string[]).includes(id)) {
    throw new RangeError(`unknown setup; one of ${SCENARIO_IDS.join(', ')}`);
  }
  return SCENARIOS[id as ScenarioId];
}
