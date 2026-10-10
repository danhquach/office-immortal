// The game state and the combat tick. Pure: no DOM, no storage.
//
// Time-based, not frame-based: combat is a queue of attack events on one clock,
// and tick() plays every event up to now + dt in time order. Randomness is only
// drawn at events, so one tick(state, 3600) runs the exact same events as 3600
// tick(state, 1) calls (docs/design.md §10).

import {
  breakThrough,
  derive,
  gainXp,
  newCultivator,
  PATHS,
  readyForTribulation,
  realmOf,
  type Cultivator,
  type PathId,
} from './cultivator.ts';
import {
  defaultFilter,
  earn,
  INVENTORY_SIZE,
  killStones,
  pickUp,
  type LootFilter,
} from './economy.ts';
import { makeFloor, makeTribulation, type Enemy } from './floors.ts';
import {
  bonusPoints,
  canRetire,
  insightFor,
  noPassives,
  passiveTreasureFind,
  xpMultiplier,
  type Passives,
} from './prestige.ts';
import { defaultSlot, rollDrop, slotsFor, type EquipSlotId, type Item } from './loot.ts';
import { chance, rngFrom, type Rng, type RngState } from './rng.ts';

/** Defence that halves incoming damage. */
export const DEFENCE_HALVES_AT = 50;
/**
 * Seconds between one fight ending (a kill or a loss) and the next starting:
 * neither side attacks meanwhile, so the fallen one's death plays out first.
 */
export const ENEMY_ARRIVAL = 1.2;

export interface GameState {
  /** Sim clock, in seconds. */
  time: number;
  rng: RngState;
  cultivator: Cultivator;
  floor: number;
  highestFloor: number;
  /** Enemies left on this floor; the first one is being fought. */
  enemies: Enemy[];
  /** Sim time of the current enemy's next attack, in seconds. */
  enemyNextAttackAt: number;
  /** Items picked up and not equipped. */
  inventory: Item[];
  /** Cells in the bag; Spirit Stones buy more. */
  bagSize: number;
  stones: number;
  essence: number;
  filter: LootFilter;
  /** Drops sold on pickup, by the filter or a full bag. */
  dropsSold: number;
  /** Drops salvaged on pickup by the filter. */
  dropsSalvaged: number;
  kills: number;
  deaths: number;
  /** Dao Insight held, to spend on passives; kept through Early Retirement. */
  insight: number;
  /** Passive ranks bought with Dao Insight; kept through Early Retirement. */
  passives: Passives;
  retirements: number;
}

/** What a run carries into the next one through Early Retirement. */
export type Kept = Pick<GameState, 'insight' | 'passives' | 'retirements' | 'filter'>;

export function newGame(
  seed: number,
  path: PathId,
  kept: Kept = { insight: 0, passives: noPassives(), retirements: 0, filter: defaultFilter() },
): GameState {
  const state: GameState = {
    time: 0,
    rng: { s: seed >>> 0 },
    cultivator: newCultivator(path, bonusPoints(kept.passives)),
    floor: 1,
    highestFloor: 1,
    enemies: [],
    enemyNextAttackAt: 0,
    inventory: [],
    bagSize: INVENTORY_SIZE,
    stones: 0,
    essence: 0,
    filter: kept.filter,
    dropsSold: 0,
    dropsSalvaged: 0,
    kills: 0,
    deaths: 0,
    insight: kept.insight,
    passives: kept.passives,
    retirements: kept.retirements,
  };
  startFloor(state, rngFrom(state.rng), 0);
  return state;
}

/** Advances the sim by `dt` seconds and returns the new state; `state` is left untouched. */
export function tick(state: GameState, dt: number): GameState {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError(`tick: bad dt ${dt}`);
  const s = structuredClone(state);
  const rng = rngFrom(s.rng);
  const end = s.time + dt;
  for (;;) {
    const c = s.cultivator;
    // Ties go to the cultivator, so event order never depends on step size.
    if (c.nextAttackAt <= s.enemyNextAttackAt) {
      if (c.nextAttackAt > end) break;
      s.time = c.nextAttackAt;
      cultivatorAttacks(s, rng);
    } else {
      if (s.enemyNextAttackAt > end) break;
      s.time = s.enemyNextAttackAt;
      enemyAttacks(s, rng);
    }
  }
  s.time = end;
  return s;
}

/**
 * Early Retirement: a new run at floor 1, level 1 on the same Path, paying Dao
 * Insight for the highest floor reached. Insight, passives and the auto filter
 * are kept; level, floors, items, currencies and bag upgrades are not. Returns
 * the new state; `state` is left untouched.
 */
export function retire(state: GameState): GameState {
  if (!canRetire(state)) throw new RangeError('retire: too little progress to pay any insight');
  const s = structuredClone(state);
  // The next run's seed comes from this run's, so a run still replays from one seed.
  const seed = Math.floor(rngFrom(s.rng)() * 2 ** 32);
  return newGame(seed, s.cultivator.path, {
    insight: Math.min(Number.MAX_SAFE_INTEGER, s.insight + insightFor(s.highestFloor)),
    passives: s.passives,
    retirements: s.retirements + 1,
    filter: s.filter,
  });
}

/**
 * Equips the bag item at `index` into position `to` (by default its first free
 * position, else its first), returning the new state; `state` is left
 * untouched. Whatever was in that position goes back into the bag.
 */
export function equip(state: GameState, index: number, to?: EquipSlotId): GameState {
  const item = Number.isInteger(index) ? state.inventory[index] : undefined;
  if (!item) throw new RangeError(`equip: no item at ${index}`);
  if (to !== undefined && !slotsFor(item.slot).includes(to)) {
    throw new RangeError(`equip: ${item.slot} does not fit ${to}`);
  }
  const s = structuredClone(state);
  const c = s.cultivator;
  const at = to ?? defaultSlot(c.equipment, item);
  const old = c.equipment[at];
  // The clone's copy of the item, so the new state shares nothing with the old.
  const [mine] = s.inventory.splice(index, 1, ...(old ? [old] : [])) as [Item];
  c.equipment[at] = mine;
  // Max HP may have dropped with the old item; never sit above it.
  c.hp = Math.min(c.hp, derive(c).maxHp);
  return s;
}

/** Damage after defence: never below 1, always a whole number. */
export function mitigate(damage: number, defence: number): number {
  return Math.max(1, Math.round((damage * DEFENCE_HALVES_AT) / (DEFENCE_HALVES_AT + defence)));
}

function currentEnemy(s: GameState): Enemy {
  const enemy = s.enemies[0];
  if (!enemy) throw new Error('no enemy: a floor always has one until cleared');
  return enemy;
}

function cultivatorAttacks(s: GameState, rng: Rng): void {
  const c = s.cultivator;
  const path = PATHS[c.path];
  const d = derive(c);
  const enemy = currentEnemy(s);
  c.attackCount += 1;
  let damage = d.damage;
  if (path.burstEvery > 0 && c.attackCount % path.burstEvery === 0) damage *= path.burstMultiplier;
  if (chance(rng, d.critChance)) damage *= d.critMultiplier;
  const dealt = Math.min(enemy.hp, mitigate(damage, enemy.defence));
  enemy.hp -= dealt;
  c.hp = Math.min(d.maxHp, c.hp + Math.ceil(dealt * d.lifesteal));
  c.nextAttackAt = s.time + d.attackInterval;
  if (enemy.hp > 0) return;

  s.kills += 1;
  earn(s, 'stones', killStones(enemy.kind, s.floor, d.stoneFind));
  gainXp(c, Math.round(enemy.xp * xpMultiplier(s.passives)));
  if (enemy.kind === 'tribulation') breakThrough(c);
  const drop = rollDrop(rng, enemy.kind, s.floor, d.treasureFind + passiveTreasureFind(s.passives));
  if (drop) pickUp(s, drop);
  s.enemies.shift();
  queueTribulation(s);
  if (s.enemies.length > 0) {
    c.nextAttackAt = s.time + ENEMY_ARRIVAL + d.attackInterval;
    s.enemyNextAttackAt = s.time + ENEMY_ARRIVAL + currentEnemy(s).attackInterval;
    return;
  }
  s.floor += 1;
  s.highestFloor = Math.max(s.highestFloor, s.floor);
  startFloor(s, rng, ENEMY_ARRIVAL);
}

function enemyAttacks(s: GameState, rng: Rng): void {
  const c = s.cultivator;
  const enemy = currentEnemy(s);
  c.hp -= mitigate(enemy.damage, derive(c).defence);
  s.enemyNextAttackAt = s.time + enemy.attackInterval;
  if (c.hp > 0) return;

  // Lost: drop back a floor and climb again from there, so a run never gets
  // stuck. Losing to a Tribulation costs nothing: the floor is played again.
  s.deaths += 1;
  if (enemy.kind !== 'tribulation') s.floor = Math.max(1, s.floor - 1);
  startFloor(s, rng, ENEMY_ARRIVAL);
}

/**
 * Once the cultivator is held at a realm cap, the realm's Tribulation joins the
 * end of the floor, so the floor can't be cleared until it is won. Draws no
 * randomness, so step size never changes what is fought.
 */
function queueTribulation(s: GameState): void {
  const c = s.cultivator;
  if (!readyForTribulation(c) || s.enemies.some((e) => e.kind === 'tribulation')) return;
  s.enemies.push(makeTribulation(s.floor, realmOf(c.level)));
}

/** Fresh enemies and full HP; both sides start their attack timers `delay` seconds from now. */
function startFloor(s: GameState, rng: Rng, delay: number): void {
  const c = s.cultivator;
  s.enemies = makeFloor(rng, s.floor);
  queueTribulation(s);
  c.hp = derive(c).maxHp;
  c.attackCount = 0;
  c.nextAttackAt = s.time + delay + derive(c).attackInterval;
  s.enemyNextAttackAt = s.time + delay + currentEnemy(s).attackInterval;
}
