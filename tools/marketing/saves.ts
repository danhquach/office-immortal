/// <reference types="node" />
// Writes the test saves the store-page screenshots and video are taken from
// (marketing/saves/*.json, committed). Each one is a real run: a seeded
// autoplayer drives the simulation, equipping whatever makes the cultivator
// stronger and selling the weak end of a full bag, so every save is one the
// game could have written and passes the save's own checks. Same seeds, same
// saves: rerun it after a change to the simulation or the save format.
//
//   npm run marketing:saves

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  derive,
  readyForTribulation,
  type Cultivator,
  type PathId,
} from '../../src/core/cultivator.ts';
import { bulkTake } from '../../src/core/economy.ts';
import { slotsFor, type EquipSlotId } from '../../src/core/loot.ts';
import { buyPassive, passiveCost, type PassiveId } from '../../src/core/prestige.ts';
import {
  canEquip,
  canFaceTribulation,
  equip,
  faceTribulation,
  newGame,
  retire,
  tick,
  type GameState,
} from '../../src/core/sim.ts';
import { syncStore } from '../../src/core/store.ts';
import { decodeSave, encodeSave } from '../../src/storage/save.ts';
import { SAVED_AT } from './stage.ts';

const OUT = 'marketing/saves';
const DAY = 24 * 60 * 60;

/** A rough fighting strength: damage per second times how long the cultivator lasts. */
function power(c: Cultivator): number {
  const d = derive(c);
  return (d.damage / d.attackInterval) * d.maxHp * (1 + d.defence / 50);
}

/** A new run with Auto-assign on, so level-up points go where a player would put them. */
function start(seed: number, path: PathId): GameState {
  const state = newGame(seed, path);
  return { ...state, statPlan: { ...state.statPlan, auto: true } };
}

/** Equips the bag item that makes the cultivator strongest, again and again, until none helps. */
function gearUp(state: GameState): GameState {
  for (;;) {
    const c = state.cultivator;
    let best: [number, EquipSlotId] | null = null;
    let bestPower = power(c) * 1.0001;
    state.inventory.forEach((item, i) => {
      if (!canEquip(c, item)) return;
      for (const at of slotsFor(item.slot)) {
        const p = power({ ...c, equipment: { ...c.equipment, [at]: item } });
        if (p > bestPower) [best, bestPower] = [[i, at], p];
      }
    });
    if (!best) return state;
    state = equip(state, ...(best as [number, EquipSlotId]));
  }
}

/** Plays in one-minute steps, gearing up after each and clearing a full bag, until `done`. */
function playUntil(state: GameState, done: (s: GameState) => boolean, limit: number): GameState {
  const end = state.time + limit;
  while (!done(state)) {
    if (state.time >= end) throw new Error(`not reached within ${limit} s`);
    state = gearUp(tick(state, 60));
    if (state.inventory.length >= state.bagSize && !done(state))
      state = bulkTake(state, 'sell', 'earth');
  }
  return state;
}

/** Buys passive ranks in `order`, round and round, while the Dao Insight lasts. */
function spend(state: GameState, order: readonly PassiveId[]): GameState {
  for (let bought = true; bought;) {
    bought = false;
    for (const id of order) {
      const cost = passiveCost(state.passives, id);
      if (cost !== null && cost <= state.insight) [state, bought] = [buyPassive(state, id), true];
    }
  }
  return state;
}

/**
 * The first seed, from 1 up, whose next `seconds` of play drop an Immortal
 * item into the bag, so the capture can play on until it lands. Played as the
 * page plays it: from the save as the page loads it (the fight's skill state is
 * never saved, so a loaded fight plays on afresh), the store's stock rolled on
 * load and after every step, each roll drawing from the same random numbers as
 * the fight.
 */
function immortalSoon(state: GameState, seconds: number): GameState {
  for (let s = 1; s < 1_000_000; s++) {
    const seeded = decodeSave(encodeSave({ ...state, rng: { s } }, SAVED_AT))?.state;
    if (!seeded) throw new Error('immortal-drop: the save does not load');
    let later = syncStore(seeded);
    for (let t = 0; t < seconds; t++) later = syncStore(tick(later, 1));
    if (later.inventory.some((item) => item.grade === 'immortal')) return seeded;
  }
  throw new Error('no seed drops an Immortal item');
}

/** A Sword Cultivator's second run, climbed far enough for high-grade gear. */
const late = playUntil(
  spend(retire(playUntil(start(20261001, 'sword'), (s) => s.highestFloor >= 20, DAY)), [
    'xp',
    'treasure',
  ]),
  (s) => s.highestFloor >= 30 && s.inventory.length >= s.bagSize,
  5 * DAY,
);

const saves: Record<string, GameState> = {
  // A new run on its first floors.
  'early-floor': playUntil(start(7, 'sword'), (s) => s.floor >= 3, DAY),
  // The late run with room in the bag; an Immortal item drops within the minute.
  'immortal-drop': immortalSoon(bulkTake(late, 'sell', 'heaven'), 60),
  // A Body Refiner held at the Foundation Establishment cap (level 20), the Tribulation started.
  tribulation: faceTribulation(
    playUntil(
      start(1, 'body'),
      (s) => s.cultivator.level >= 20 && readyForTribulation(s.cultivator) && canFaceTribulation(s),
      5 * DAY,
    ),
  ),
  // The late run: a full bag and every position filled.
  inventory: late,
  // A Talisman Master on a second run, with Dao Insight spent and more to come.
  reincarnation: playUntil(
    spend(retire(playUntil(start(55, 'talisman'), (s) => s.highestFloor >= 20, DAY)), [
      'points',
      'xp',
    ]),
    (s) => s.highestFloor >= 25,
    3 * DAY,
  ),
};

mkdirSync(OUT, { recursive: true });
for (const [name, state] of Object.entries(saves)) {
  const raw = encodeSave(state, SAVED_AT);
  if (!decodeSave(raw)) throw new Error(`${name}: the save does not load`);
  writeFileSync(`${OUT}/${name}.json`, `${raw}\n`);
  const c = state.cultivator;
  const gear = Object.values(c.equipment).map((item) => item.grade[0]);
  console.log(
    `${name}: floor ${state.floor} (best ${state.highestFloor}), level ${c.level}, ` +
      `bag ${state.inventory.length}/${state.bagSize}, gear ${gear.join('')}`,
  );
}
