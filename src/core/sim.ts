// The game state and the combat tick. Pure: no DOM, no storage.
//
// Time-based, not frame-based: combat is a queue of attack events on one clock,
// and tick() plays every event up to now + dt in time order. Randomness is only
// drawn at events, so one tick(state, 3600) runs the exact same events as 3600
// tick(state, 1) calls (docs/design.md §10).

import {
  derive,
  gainXp,
  newCultivator,
  PATHS,
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
import { makeFloor, type Enemy } from './floors.ts';
import { defaultSlot, rollDrop, slotsFor, type EquipSlotId, type Item } from './loot.ts';
import { chance, rngFrom, type Rng, type RngState } from './rng.ts';

/** Defence that halves incoming damage. */
export const DEFENCE_HALVES_AT = 50;

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
}

export function newGame(seed: number, path: PathId): GameState {
  const state: GameState = {
    time: 0,
    rng: { s: seed >>> 0 },
    cultivator: newCultivator(path),
    floor: 1,
    highestFloor: 1,
    enemies: [],
    enemyNextAttackAt: 0,
    inventory: [],
    bagSize: INVENTORY_SIZE,
    stones: 0,
    essence: 0,
    filter: defaultFilter(),
    dropsSold: 0,
    dropsSalvaged: 0,
    kills: 0,
    deaths: 0,
  };
  startFloor(state, rngFrom(state.rng));
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
  gainXp(c, enemy.xp);
  const drop = rollDrop(rng, enemy.kind, s.floor, d.treasureFind);
  if (drop) pickUp(s, drop);
  s.enemies.shift();
  if (s.enemies.length > 0) {
    s.enemyNextAttackAt = s.time + currentEnemy(s).attackInterval;
    return;
  }
  s.floor += 1;
  s.highestFloor = Math.max(s.highestFloor, s.floor);
  startFloor(s, rng);
}

function enemyAttacks(s: GameState, rng: Rng): void {
  const c = s.cultivator;
  const enemy = currentEnemy(s);
  c.hp -= mitigate(enemy.damage, derive(c).defence);
  s.enemyNextAttackAt = s.time + enemy.attackInterval;
  if (c.hp > 0) return;

  // Lost: drop back a floor and climb again from there, so a run never gets stuck.
  s.deaths += 1;
  s.floor = Math.max(1, s.floor - 1);
  startFloor(s, rng);
}

/** Fresh enemies and full HP; both sides start their attack timers from now. */
function startFloor(s: GameState, rng: Rng): void {
  const c = s.cultivator;
  s.enemies = makeFloor(rng, s.floor);
  c.hp = derive(c).maxHp;
  c.attackCount = 0;
  c.nextAttackAt = s.time + derive(c).attackInterval;
  s.enemyNextAttackAt = s.time + currentEnemy(s).attackInterval;
}
