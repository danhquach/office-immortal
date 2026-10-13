import { describe, expect, it } from 'vitest';
import { isRealmCap, LAST_CAP, readyForTribulation, realmOf } from '../core/cultivator.ts';
import { INVENTORY_SIZE, MAX_BAG_SIZE } from '../core/economy.ts';
import { GRADES, namesFor, SLOTS, soulCap, type GradeId, type SlotId } from '../core/loot.ts';
import { canEquip, canFaceTribulation, equip, newGame, tick, type GameState } from '../core/sim.ts';
import { decodeSave, encodeSave, saveProblem } from '../storage/save.ts';
import {
  addEveryType,
  addItem,
  addResource,
  BAG_SIZES,
  debugStep,
  dropOnKill,
  emptyBag,
  fillBag,
  MAX_DEBUG_LEVEL,
  freshRun,
  SCENARIO_IDS,
  scenarioFor,
  SCENARIOS,
  setBagSize,
  setFloors,
  setHp,
  setLevel,
  setSouls,
  skipToTribulation,
  unequipAll,
} from './scenarios.ts';

const SLOT_IDS = Object.keys(SLOTS) as SlotId[];
const GRADE_IDS = Object.keys(GRADES) as GradeId[];

function game(): GameState {
  return setFloors(newGame(7, 'sword'), 20, 30);
}

/** The save checker takes it, and a reload gives back the same state. */
function loads(s: GameState): void {
  expect(saveProblem(s)).toBeNull();
  expect(decodeSave(encodeSave(s, 1))?.state).toEqual(s);
}

describe('debug setups', () => {
  it('adds a valid item of every type, grade and name', () => {
    for (const slot of SLOT_IDS) {
      for (const grade of GRADE_IDS) {
        for (const name of namesFor(slot, grade)) {
          const s = addItem(game(), slot, grade, name, 30);
          const item = s.inventory.at(-1);
          expect(item).toMatchObject({ slot, grade, name, level: 30 });
          const [min, max] = GRADES[grade].affixes;
          expect(item?.affixes.length).toBeGreaterThanOrEqual(min);
          expect(item?.affixes.length).toBeLessThanOrEqual(max);
          loads(s);
        }
      }
    }
  });

  it('refuses an item above the highest floor, a bad name or a full bag', () => {
    const name = namesFor('head', 'mortal')[0] as string;
    expect(() => addItem(game(), 'head', 'mortal', name, 31)).toThrow(/highest floor/);
    expect(() => addItem(game(), 'head', 'mortal', name, 0)).toThrow(RangeError);
    expect(() => addItem(game(), 'head', 'mortal', name, Number.NaN)).toThrow(RangeError);
    expect(() => addItem(game(), 'head', 'mortal', name, 1.5)).toThrow(RangeError);
    expect(() => addItem(game(), 'head', 'immortal', name, 1)).toThrow(/bad name/);
    expect(() => addItem(game(), 'head', 'mortal', '__proto__', 1)).toThrow(/bad name/);
    expect(() => addItem(fillBag(game(), 0), 'head', 'mortal', name, 1)).toThrow(/no room/);
  });

  it('adds one of every type at a grade', () => {
    const s = addEveryType(game(), 'immortal', 5);
    expect(s.inventory.map((i) => i.slot)).toEqual(SLOT_IDS);
    expect(s.inventory.every((i) => i.unique)).toBe(true);
    loads(s);
  });

  it('fills the bag to full or full minus one, and empties it', () => {
    expect(fillBag(game(), 0).inventory).toHaveLength(INVENTORY_SIZE);
    expect(fillBag(game(), 1).inventory).toHaveLength(INVENTORY_SIZE - 1);
    loads(fillBag(game(), 0));
    loads(emptyBag(fillBag(game(), 0)));
    expect(emptyBag(fillBag(game(), 0)).inventory).toEqual([]);
  });

  it('sets the bag size to any size Spirit Stones can buy', () => {
    expect(BAG_SIZES[0]).toBe(INVENTORY_SIZE);
    expect(BAG_SIZES.at(-1)).toBe(MAX_BAG_SIZE);
    for (const size of BAG_SIZES) loads(fillBag(setBagSize(game(), size), 0));
    expect(() => setBagSize(game(), 41)).toThrow(RangeError);
    expect(() => setBagSize(game(), MAX_BAG_SIZE + 8)).toThrow(RangeError);
    const big = fillBag(setBagSize(game(), 48), 0);
    expect(() => setBagSize(big, 40)).toThrow(/more items/);
  });

  it('sets any level with its realm, stat points and Tribulation in line', () => {
    for (const level of [
      1,
      9,
      10,
      11,
      22,
      23,
      36,
      37,
      90,
      91,
      LAST_CAP,
      LAST_CAP + 1,
      MAX_DEBUG_LEVEL,
    ]) {
      const s = setLevel(game(), level);
      expect(s.cultivator.level).toBe(level);
      expect(realmOf(s.cultivator.level)).toBe(realmOf(level));
      loads(s);
      // It plays on from there.
      loads(tick(s, 120));
    }
    expect(() => setLevel(game(), 0)).toThrow(RangeError);
    expect(() => setLevel(game(), MAX_DEBUG_LEVEL + 1)).toThrow(RangeError);
    expect(() => setLevel(game(), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('gated weapons go in the bag at level 1, where they cannot be equipped', () => {
    const s = SCENARIOS.gatedWeapons(setLevel(game(), 23));
    expect(s.cultivator.level).toBe(1);
    expect(s.inventory.map((i) => i.grade)).toEqual(['earth', 'heaven', 'immortal']);
    for (const item of s.inventory) expect(canEquip(s.cultivator, item)).toBe(false);
  });

  it('refuses a lower level while a weapon it could not equip is worn', () => {
    const name = namesFor('weapon', 'immortal')[0] as string;
    // Golden Core starts at 23; 22 is the top of Foundation Establishment.
    const golden = setLevel(game(), 23);
    const s = equip(addItem(golden, 'weapon', 'immortal', name, 1), 0, 'weapon');
    expect(() => setLevel(s, 22)).toThrow(/higher realm/);
    loads(setLevel(s, 23));
  });

  it('starts a fresh run on the chosen Path', () => {
    for (const path of ['sword', 'body', 'talisman'] as const) {
      const s = freshRun(9, path);
      expect(s).toMatchObject({ floor: 1, highestFloor: 1, inventory: [], insight: 0 });
      expect(s.cultivator).toMatchObject({ path, level: 1 });
      loads(s);
    }
  });

  it('looks setups up by allow-list only', () => {
    for (const id of SCENARIO_IDS) expect(scenarioFor(id)).toBe(SCENARIOS[id]);
    for (const bad of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      '',
      'fullbag',
      'fullBag\u200b',
      1,
      null,
      undefined,
      {},
      ['fullBag'],
    ]) {
      expect(() => scenarioFor(bad)).toThrow(/unknown setup/);
    }
  });

  it('sets the floor and highest floor, never below an item', () => {
    const s = setFloors(game(), 3, 50);
    expect(s).toMatchObject({ floor: 3, highestFloor: 50 });
    loads(s);
    const withItem = addItem(game(), 'head', 'mortal', namesFor('head', 'mortal')[0] as string, 30);
    expect(() => setFloors(withItem, 1, 29)).toThrow(/level 30/);
    expect(() => setFloors(game(), 5, 4)).toThrow(RangeError);
  });

  it('fills or nearly empties HP', () => {
    loads(setHp(game(), 'full'));
    expect(setHp(game(), 'low').cultivator.hp).toBe(1);
    loads(setHp(game(), 'low'));
  });

  it('adds resources, refusing bad amounts and stopping at the largest safe number', () => {
    const s = addResource(
      addResource(addResource(game(), 'stones', 5), 'essence', 6),
      'insight',
      7,
    );
    expect(s).toMatchObject({ stones: 5, essence: 6, insight: 7 });
    loads(s);
    const max = addResource(addResource(game(), 'stones', Number.MAX_SAFE_INTEGER), 'stones', 1);
    expect(max.stones).toBe(Number.MAX_SAFE_INTEGER);
    loads(max);
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(() => addResource(game(), 'stones', bad)).toThrow(RangeError);
    }
  });

  it('sets souls on a worn banner up to its cap, and only then', () => {
    const s = SCENARIOS.soulBanner(game());
    const cap = soulCap(s.cultivator.equipment);
    expect(s.souls).toBe(cap);
    loads(s);
    loads(setSouls(s, 0));
    expect(() => setSouls(s, cap + 1)).toThrow(RangeError);
    expect(() => setSouls(game(), 1)).toThrow(/no Soul Banner/);
  });

  it('unequips everything into the bag, or refuses with no room', () => {
    const worn = SCENARIOS.soulBanner(game());
    const s = unequipAll(worn);
    expect(s.cultivator.equipment).toEqual({});
    expect(s.souls).toBe(0);
    loads(s);
    expect(() => unequipAll(fillBag(worn, 0))).toThrow(/no room/);
  });

  it('skips to the next Tribulation, due at the end of the floor', () => {
    for (const [level, cap] of [
      [1, 10],
      [10, 10],
      [11, 22],
      [15, 22],
      [23, 36],
      [61, 70],
      [LAST_CAP, LAST_CAP],
    ]) {
      const s = skipToTribulation(setLevel(game(), level as number));
      expect(isRealmCap(s.cultivator.level)).toBe(true);
      expect(s.cultivator.level).toBe(cap);
      expect(readyForTribulation(s.cultivator)).toBe(true);
      expect(s.enemies.at(-1)?.kind).toBe('tribulation');
      expect(canFaceTribulation(s)).toBe(true);
      loads(s);
    }
    expect(() => skipToTribulation(setLevel(game(), LAST_CAP + 1))).toThrow(/no Tribulation/);
  });

  it('forces a drop on a kill that dropped nothing, through pickUp', () => {
    let prev = game();
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const next = tick(prev, 1);
      const forced = dropOnKill(prev, next);
      if (next.kills === prev.kills) expect(forced).toBeNull();
      else {
        const before = prev.inventory.length + prev.dropsSold + prev.dropsSalvaged;
        const after = forced as GameState;
        expect(after.inventory.length + after.dropsSold + after.dropsSalvaged).toBeGreaterThan(
          before,
        );
        loads(after);
        found = true;
      }
      prev = next;
    }
    expect(found).toBe(true);
  });

  it('plays at speed, marking the run as cheated only for speed or a forced drop', () => {
    const s = game();
    const plain = debugStep(s, 5, 1, false);
    expect(plain).toEqual({ state: tick(s, 5), cheated: false, dropped: false });
    const fast = debugStep(s, 5, 10, false);
    expect(fast).toEqual({ state: tick(s, 50), cheated: true, dropped: false });
    // Armed: waits for a kill, then spends the forced drop; only a forced (not natural) one cheats.
    let prev = s;
    let natural = false;
    let forced = false;
    for (let i = 0; i < 2000 && !(natural && forced); i++) {
      const out = debugStep(prev, 1, 1, true);
      const next = tick(prev, 1);
      if (next.kills === prev.kills)
        expect(out).toEqual({ state: next, cheated: false, dropped: false });
      else {
        expect(out.dropped).toBe(true);
        const fell =
          next.inventory.length + next.dropsSold + next.dropsSalvaged >
          prev.inventory.length + prev.dropsSold + prev.dropsSalvaged;
        expect(out.cheated).toBe(!fell);
        if (fell) natural = true;
        else forced = true;
        loads(out.state);
      }
      prev = next;
    }
    expect(natural && forced).toBe(true);
  });

  it('leaves every named scenario loadable, from a fresh run and a busy one', () => {
    for (const id of SCENARIO_IDS) {
      loads(SCENARIOS[id](newGame(3, 'talisman')));
      loads(SCENARIOS[id](setLevel(fillBag(game(), 30), 35)));
    }
    const discs = SCENARIOS.discs(game()).inventory.map((i) => i.array);
    expect(discs).toEqual(['binding', 'illusion', 'killing']);
    expect(SCENARIOS.twoPages(game()).inventory.length).toBeGreaterThan(INVENTORY_SIZE);
  });
});
