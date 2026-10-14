import { describe, expect, it } from 'vitest';
import {
  isRealmCap,
  LAST_CAP,
  readyForTribulation,
  realmOf,
  xpToNext,
} from '../core/cultivator.ts';
import { INVENTORY_SIZE, MAX_BAG_SIZE } from '../core/economy.ts';
import { GRADES, namesFor, SLOTS, soulCap, type GradeId, type SlotId } from '../core/loot.ts';
import { canEquip, canFaceTribulation, equip, newGame, tick, type GameState } from '../core/sim.ts';
import { decodeSave, encodeSave, saveProblem } from '../storage/save.ts';
import {
  addEveryType,
  addItem,
  addResource,
  awaySeconds,
  BAG_SIZES,
  debugStep,
  dropOnKill,
  emptyBag,
  fillBag,
  foeToOneHp,
  freeStatReset,
  MAX_AWAY_HOURS,
  MAX_DEBUG_LEVEL,
  freshRun,
  jumpToFight,
  KEEP_HP_STEP,
  readyToCast,
  resetCooldowns,
  restockStore,
  retireReady,
  SCENARIO_IDS,
  scenarioAway,
  scenarioFor,
  SCENARIOS,
  setBagSize,
  setBoost,
  setFloors,
  setFreeResetOffer,
  setHp,
  setLevel,
  setPassive,
  setQi,
  setSouls,
  setTrialLosses,
  skipToTribulation,
  unequipAll,
  type FightKind,
} from './scenarios.ts';
import { derive } from '../core/cultivator.ts';
import { answerFreeReset, canResetStats } from '../core/economy.ts';
import { canRetire, PASSIVES, POINTS_PER_RANK, type PassiveId } from '../core/prestige.ts';
import {
  characterStatus,
  setAutoTribulation,
  trialSetAside,
  TRIAL_LOSS_LIMIT,
} from '../core/sim.ts';
import { BOOST_CAP_SECONDS, boostLeft, storeStale, syncStore } from '../core/store.ts';
import { withoutCombat } from '../storage/save-fakes.ts';

// The fight's skill state is never saved: states compare without it.
expect.addEqualityTesters([withoutCombat]);

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
      20,
      21,
      40,
      41,
      110,
      111,
      170,
      171,
      210,
      211,
      MAX_DEBUG_LEVEL,
    ]) {
      const s = setLevel(game(), level);
      expect(s.cultivator.level).toBe(level);
      expect(realmOf(s.cultivator.level)).toBe(realmOf(level));
      loads(s);
      // It plays on from there.
      loads(tick(s, 120));
    }
    // Every level a setup reaches keeps its XP price a safe whole number.
    expect(Number.isSafeInteger(xpToNext(MAX_DEBUG_LEVEL))).toBe(true);
    expect(() => setLevel(game(), 0)).toThrow(RangeError);
    expect(() => setLevel(game(), MAX_DEBUG_LEVEL + 1)).toThrow(RangeError);
    expect(() => setLevel(game(), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('gated weapons go in the bag at level 1, where they cannot be equipped', () => {
    const s = SCENARIOS.gatedWeapons(setLevel(game(), 21));
    expect(s.cultivator.level).toBe(1);
    expect(s.inventory.map((i) => i.grade)).toEqual(['earth', 'heaven', 'immortal']);
    for (const item of s.inventory) expect(canEquip(s.cultivator, item)).toBe(false);
  });

  it('refuses a lower level while a weapon it could not equip is worn', () => {
    const name = namesFor('weapon', 'immortal')[0] as string;
    // Golden Core starts at 21; 20 is the top of Foundation Establishment.
    const golden = setLevel(game(), 21);
    const s = equip(addItem(golden, 'weapon', 'immortal', name, 1), 0, 'weapon');
    expect(() => setLevel(s, 20)).toThrow(/higher realm/);
    loads(setLevel(s, 21));
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

  it("puts the floor's elite and boss in front with full qi", () => {
    // Even once the floor's elite and boss are beaten.
    const past = newGame(5, 'sword');
    past.enemies = past.enemies.filter((e) => e.kind === 'demon');
    const s = SCENARIOS.skilledFoes(past);
    expect(s.enemies.map((e) => [e.kind, e.qi])).toEqual([
      ['elite', 60],
      ['boss', 100],
    ]);
  });

  it('skips to the next Tribulation, due at the end of the floor', () => {
    for (const [level, cap] of [
      [1, 10],
      [10, 10],
      [11, 20],
      [15, 20],
      [21, 40],
      [61, 80],
      [170, 170],
      [171, 210],
      [210, 210],
    ]) {
      const s = skipToTribulation(setLevel(game(), level as number));
      expect(isRealmCap(s.cultivator.level)).toBe(true);
      expect(s.cultivator.level).toBe(cap);
      expect(readyForTribulation(s.cultivator)).toBe(true);
      expect(s.enemies.at(-1)?.kind).toBe('tribulation');
      expect(canFaceTribulation(s)).toBe(true);
      loads(s);
    }
    // Past the last cap there is no Tribulation left to skip to.
    expect(LAST_CAP).toBeLessThan(MAX_DEBUG_LEVEL);
    for (const level of [LAST_CAP + 1, MAX_DEBUG_LEVEL]) {
      expect(() => skipToTribulation(setLevel(game(), level))).toThrow(/no Tribulation/);
    }
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

/** Plays until the enemy in front is no longer the one it was, at most `limit` seconds. */
function fightOut(s: GameState, limit = 600): GameState {
  const kills = s.kills;
  const deaths = s.deaths;
  let t = s;
  for (let i = 0; i < limit && t.kills === kills && t.deaths === deaths; i++) t = tick(t, 1);
  return t;
}

describe('debug setups for fights, skills, stats and retirement', () => {
  it('jumps to the elite or boss of any floor reached, keeping HP and qi', () => {
    const base = setQi(setHp(game(), 'low'), 7);
    for (const [kind, left] of [
      ['elite', ['elite', 'boss']],
      ['boss', ['boss']],
    ] as const) {
      for (const floor of [1, 12, 30]) {
        const s = jumpToFight(base, kind, floor);
        expect(s.floor).toBe(floor);
        expect(s.highestFloor).toBe(30);
        expect(s.enemies.map((e) => e.kind)).toEqual(left);
        expect(characterStatus(s).kind).toBe(kind);
        expect(s.cultivator.hp).toBe(1);
        expect(s.cultivator.qi).toBe(7);
        loads(s);
      }
    }
    expect(() => jumpToFight(base, 'boss', 31)).toThrow(/highest floor/);
    expect(() => jumpToFight(base, 'boss', 0)).toThrow(/highest floor/);
    expect(() => jumpToFight(base, 'demon' as FightKind, 1)).toThrow(/elite or boss/);
  });

  it('plays a jumped boss fight on as normal: the kill clears the floor', () => {
    const s = setLevel(game(), 60);
    const boss = jumpToFight(s, 'boss', 1);
    const after = fightOut(boss);
    expect(after.kills).toBe(boss.kills + 1);
    expect(after.floor).toBe(2);
    expect(after.enemies[0]?.kind).toBe('demon');
  });

  it('keeps a due Tribulation at the end of a jumped floor', () => {
    const s = jumpToFight(skipToTribulation(game()), 'boss', 5);
    expect(s.enemies.map((e) => e.kind)).toEqual(['boss', 'tribulation']);
    loads(s);
  });

  it('sets qi to a whole number up to the max, or exactly full', () => {
    const s = game();
    const max = derive(s.cultivator).maxQi;
    expect(setQi(s, 'full').cultivator.qi).toBe(max);
    expect(setQi(s, 0).cultivator.qi).toBe(0);
    expect(setQi(s, Math.floor(max)).cultivator.qi).toBe(Math.floor(max));
    for (const bad of [-1, Math.floor(max) + 1, 1.5, NaN]) {
      expect(() => setQi(s, bad)).toThrow(RangeError);
    }
    loads(setQi(s, 'full'));
  });

  it('resets cooldowns mid-fight, and readies the next cast', () => {
    // No Path skill has a cooldown yet; one set by hand stands in for an enemy's or a later one.
    const s = tick(game(), 3);
    s.combat.you.cooldowns = { flyingSword: s.time + 30 };
    expect(resetCooldowns(s).combat.you.cooldowns).toEqual({});
    const ready = readyToCast(s);
    expect(ready.combat.you.cooldowns).toEqual({});
    expect(ready.cultivator.qi).toBe(derive(ready.cultivator).maxQi);
    expect(s.combat.you.cooldowns).not.toEqual({});
  });

  it('brings the enemy in front to 1 HP, and the next hit kills it through the rules', () => {
    const s = jumpToFight(game(), 'boss', 30);
    const hit = foeToOneHp(s);
    expect(hit.enemies[0]?.hp).toBe(1);
    loads(hit);
    const after = fightOut(hit, 10);
    expect(after.kills).toBe(s.kills + 1);
  });

  it('keeps HP full through a fight it would lose, and cheats doing it', () => {
    // Level 1 against floor 8's boss loses, though no one hit beats its max HP.
    const s = jumpToFight(setLevel(game(), 1), 'boss', 8);
    const lost = fightOut(s, 120);
    expect(lost.deaths).toBe(s.deaths + 1);
    const out = debugStep(s, 120, 1, false, true);
    expect(out.cheated).toBe(true);
    // It never falls, so it wears the boss down and climbs on.
    expect(out.state.deaths).toBe(s.deaths);
    expect(out.state.floor).toBeGreaterThan(8);
    expect(KEEP_HP_STEP).toBeLessThan(1);
    loads(out.state);
  });

  it('gives back every spent stat point for free, leaving the offer as it was', () => {
    const s = setLevel(game(), 30);
    const spent = answerFreeReset(setFreeResetOffer(s, true), false);
    // Spend points by hand the way levelling with Auto-assign would.
    spent.cultivator.stats.body += spent.cultivator.unspent;
    spent.cultivator.unspent = 0;
    loads(spent);
    const reset = freeStatReset(spent);
    expect(canResetStats(reset.cultivator)).toBe(false);
    expect(reset.stones).toBe(spent.stones);
    expect(reset.freeReset).toBe(false);
    expect(freeStatReset(setFreeResetOffer(spent, true)).freeReset).toBe(true);
    loads(reset);
    expect(() => freeStatReset(reset)).toThrow(/no stat point/);
    loads(setFreeResetOffer(s, true));
  });

  it('sets Tribulation losses up to the limit, setting it aside at the limit', () => {
    for (let n = 0; n <= TRIAL_LOSS_LIMIT; n++) {
      const s = setTrialLosses(game(), n);
      expect(s.trial.losses).toBe(n);
      expect(trialSetAside(s)).toBe(n === TRIAL_LOSS_LIMIT);
      expect(s.enemies.some((e) => e.kind === 'tribulation')).toBe(n < TRIAL_LOSS_LIMIT);
      loads(s);
    }
    // One already due keeps its level and stats.
    const due = skipToTribulation(game());
    expect(setTrialLosses(due, 1).cultivator).toEqual(restarted(due).cultivator);
    expect(() => setTrialLosses(game(), TRIAL_LOSS_LIMIT + 1)).toThrow(RangeError);
    expect(() => setTrialLosses(game(), -1)).toThrow(RangeError);
  });

  it('switches Auto-Tribulation through the game, and the result loads', () => {
    const due = skipToTribulation(game());
    const off = setAutoTribulation(due, false);
    expect(off.enemies.some((e) => e.kind === 'tribulation')).toBe(false);
    loads(off);
    loads(setAutoTribulation(off, true));
  });

  it('makes Early Retirement pay, keeping a higher highest floor', () => {
    const fresh = newGame(3, 'body');
    expect(canRetire(fresh)).toBe(false);
    const ready = retireReady(fresh);
    expect(canRetire(ready)).toBe(true);
    loads(ready);
    expect(retireReady(game()).highestFloor).toBe(30);
  });

  it('sets passive ranks, Head Start moving unspent points as buying does', () => {
    const ids = Object.keys(PASSIVES) as PassiveId[];
    for (const id of ids) {
      const s = setPassive(game(), id, PASSIVES[id].maxRank);
      expect(s.passives[id]).toBe(PASSIVES[id].maxRank);
      loads(s);
      expect(() => setPassive(game(), id, PASSIVES[id].maxRank + 1)).toThrow(RangeError);
    }
    const up = setPassive(game(), 'points', 3);
    expect(up.cultivator.unspent - game().cultivator.unspent).toBe(3 * POINTS_PER_RANK);
    expect(setPassive(up, 'points', 0).cultivator.unspent).toBe(game().cultivator.unspent);
    const spent = structuredClone(up);
    spent.cultivator.stats.body += spent.cultivator.unspent;
    spent.cultivator.unspent = 0;
    expect(() => setPassive(spent, 'points', 0)).toThrow(/reset stats first/);
    expect(() => setPassive(game(), 'constructor' as PassiveId, 1)).toThrow(/passive/);
  });

  it('restocks the store for free and turns boosts on and off', () => {
    const stocked = syncStore(game());
    const thrown = restockStore(stocked);
    expect(storeStale(thrown)).toBe(true);
    expect(syncStore(thrown).stones).toBe(stocked.stones);
    loads(thrown);
    const on = setBoost(stocked, 'xp', true);
    expect(boostLeft(on, 'xp')).toBe(BOOST_CAP_SECONDS);
    loads(on);
    expect(boostLeft(setBoost(on, 'xp', false), 'xp')).toBe(0);
    expect(() => setBoost(stocked, '__proto__' as 'xp', true)).toThrow(/boost/);
  });

  it('turns whole hours away into seconds, past the offline cap but bounded', () => {
    expect(awaySeconds(1)).toBe(3600);
    expect(awaySeconds(MAX_AWAY_HOURS)).toBe(MAX_AWAY_HOURS * 3600);
    for (const bad of [0, -1, MAX_AWAY_HOURS + 1, 1.5, NaN]) {
      expect(() => awaySeconds(bad)).toThrow(RangeError);
    }
  });

  it('refuses hostile numbers and names on every new input', () => {
    const s = game();
    const numbers = [NaN, Infinity, -Infinity, 1.5, -1, Number.MAX_VALUE];
    for (const n of numbers) {
      expect(() => jumpToFight(s, 'boss', n)).toThrow(RangeError);
      expect(() => setQi(s, n)).toThrow(RangeError);
      expect(() => setTrialLosses(s, n)).toThrow(RangeError);
      expect(() => setPassive(s, 'xp', n)).toThrow(RangeError);
      expect(() => awaySeconds(n)).toThrow(RangeError);
    }
    for (const name of ['__proto__', 'constructor', 'toString', '', 'xp ']) {
      expect(() => setPassive(s, name as PassiveId, 1)).toThrow(/passive/);
      expect(() => setBoost(s, name as 'xp', true)).toThrow(/boost/);
      expect(() => jumpToFight(s, name as FightKind, 1)).toThrow(/elite or boss/);
      expect(() => scenarioFor(name)).toThrow(/unknown setup/);
    }
    for (const id of [{}, [], null, 1, Symbol('x')]) {
      expect(() => scenarioFor(id)).toThrow(/unknown setup/);
    }
    // Nothing leaked onto shared prototypes.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(s.passives)).toBe(Object.prototype);
  });

  it('names the new scenarios, offline8h saved eight hours back', () => {
    expect(SCENARIO_IDS).toEqual(
      expect.arrayContaining([
        'eliteFight',
        'bossFight',
        'lowQi',
        'tribulationLastTry',
        'tribulationSkill',
        'tribulationLightning',
        'offline8h',
        'retireReady',
      ]),
    );
    expect(scenarioAway('offline8h')).toBe(8 * 3600);
    expect(scenarioAway('bossFight')).toBe(0);
    expect(SCENARIOS.bossFight(game()).enemies[0]?.kind).toBe('boss');
    expect(SCENARIOS.eliteFight(game()).enemies[0]?.kind).toBe('elite');
    expect(SCENARIOS.lowQi(game()).cultivator.qi).toBe(0);
    expect(SCENARIOS.tribulationLastTry(game()).trial.losses).toBe(TRIAL_LOSS_LIMIT - 1);
  });

  it('faces the next Tribulation with full qi, whole or just under half HP', () => {
    const whole = SCENARIOS.tribulationSkill(game());
    const trial = whole.enemies[0]!;
    expect(trial).toMatchObject({ kind: 'tribulation', hp: trial.maxHp, qi: 150 });
    const low = SCENARIOS.tribulationLightning(game()).enemies[0]!;
    expect(low.hp).toBeLessThan(low.maxHp / 2);
    expect(low.hp).toBeGreaterThan(low.maxHp * 0.48);
    // Again while already fighting it: still the same Tribulation, no second one.
    const again = SCENARIOS.tribulationLightning(whole);
    expect(again.enemies.filter((e) => e.kind === 'tribulation')).toHaveLength(1);
    // On floor 1, where its normal hit can't kill (a damage skill waits then),
    // each casts at once: the signature skill, or Heavenly Lightning.
    const first = (x: GameState) =>
      tick(x, 3).combat.log.find((n) => 'skill' in n && n.who === 'foe' && n.windUp);
    expect(first(SCENARIOS.tribulationSkill(newGame(7, 'sword')))).toMatchObject({
      skill: 'Final Warning',
    });
    expect(first(SCENARIOS.tribulationLightning(newGame(7, 'sword')))).toMatchObject({
      skill: 'Heavenly Lightning',
    });
  });
});

/** `s` with its floor started again, as a setup that restarts it leaves it. */
function restarted(s: GameState): GameState {
  return setTrialLosses(s, 0);
}
