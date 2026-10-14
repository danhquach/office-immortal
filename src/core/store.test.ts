import { describe, expect, it } from 'vitest';
import { GRADE_IDS, SELL_VALUE, setAutoAssign } from './economy.ts';
import { GRADES, rollGrade, type GradeId } from './loot.ts';
import { catchUp } from './offline.ts';
import { retirePreview } from './prestige.ts';
import { createRng } from './rng.ts';
import { newGame, noSkills, retire, tick, type GameState } from './sim.ts';
import { setLevel } from '../dev/scenarios.ts';
import {
  BOOST_BONUS,
  BOOST_CAP_SECONDS,
  BOOST_PRICE,
  BOOST_SECONDS,
  boostBonus,
  boostLeft,
  buyOffer,
  CHEST_PRICE_MULT,
  nextRotationIn,
  OFFER_IDS,
  offerBlock,
  offerPrice,
  refreshCost,
  refreshStore,
  REFRESH_COST,
  ROTATION_SECONDS,
  STOCK_SIZE,
  storeStale,
  syncStore,
  type OfferId,
} from './store.ts';

/** A synced game with plenty of Spirit Stones, on floor 20 at level 10. */
function rich(seed = 1): GameState {
  // Level 10 with its points placed (the dev scenario), so it fights floor 20 as a real run would.
  const s = setLevel(setAutoAssign(newGame(seed, 'sword'), true), 10);
  s.stones = 1_000_000;
  s.floor = 20;
  s.highestFloor = 20;
  return syncStore(s);
}

/** `s` with offer `id` on show at position 0, unsold. */
function offering(s: GameState, id: OfferId): GameState {
  const t = structuredClone(s);
  const rest = OFFER_IDS.filter((o) => o !== id).slice(0, STOCK_SIZE - 1);
  t.store.offers = [id, ...rest];
  t.store.sold = t.store.offers.map(() => false);
  return t;
}

describe('the stock', () => {
  it('starts unrolled, so a new game draws the same numbers as before the store', () => {
    const s = newGame(1, 'sword');
    expect(s.store).toEqual({ rotation: -1, offers: [], sold: [] });
    expect(storeStale(s)).toBe(true);
  });

  it('rolls STOCK_SIZE different offers once per rotation', () => {
    const s = syncStore(newGame(1, 'sword'));
    expect(s.store.rotation).toBe(0);
    expect(s.store.offers).toHaveLength(STOCK_SIZE);
    expect(new Set(s.store.offers).size).toBe(STOCK_SIZE);
    for (const id of s.store.offers) expect(OFFER_IDS).toContain(id);
    expect(s.store.sold).toEqual([false, false, false, false]);
    expect(syncStore(s)).toBe(s);
  });

  it('rotates by the sim clock, open tab or offline, with one roll however the time passed', () => {
    const s = syncStore(newGame(3, 'sword'));
    expect(nextRotationIn(s)).toBe(ROTATION_SECONDS);
    const later = tick(s, ROTATION_SECONDS * 2.5);
    expect(storeStale(later)).toBe(true);
    expect(nextRotationIn(later)).toBe(ROTATION_SECONDS / 2);
    const away = catchUp(s, ROTATION_SECONDS * 2.5).state;
    expect(syncStore(later).store.rotation).toBe(2);
    expect(syncStore(away).store.rotation).toBe(2);
  });

  it('is never rolled or touched by tick()', () => {
    const s = newGame(5, 'sword');
    expect(tick(s, 600).store).toEqual(s.store);
    const synced = syncStore(s);
    expect(tick(synced, 600).store).toEqual(synced.store);
  });

  it('refreshes for its price, keeping the rotation clock', () => {
    const s = rich();
    s.store.sold[0] = true;
    const r = refreshStore(s);
    expect(r.stones).toBe(s.stones - REFRESH_COST * 10);
    expect(refreshCost(s)).toBe(REFRESH_COST * 10);
    expect(r.store.rotation).toBe(s.store.rotation);
    expect(r.store.sold).toEqual([false, false, false, false]);
    expect(s.store.sold[0]).toBe(true);
    const poor = { ...s, stones: refreshCost(s) - 1 };
    expect(() => refreshStore(poor)).toThrow(RangeError);
  });
});

describe('gear chests', () => {
  it.each(['spirit', 'earth', 'heaven'] as const)(
    'a %s chest costs three sells of its grade at the floor and drops one item into the bag',
    (grade) => {
      const s = offering(rich(), `chest-${grade}`);
      s.filter = { minGrade: 'immortal', slots: [], action: 'sell' };
      const price = CHEST_PRICE_MULT * SELL_VALUE[grade] * 20;
      expect(offerPrice(s, `chest-${grade}`)).toBe(price);
      const b = buyOffer(s, 0);
      expect(b.stones).toBe(s.stones - price);
      expect(b.store.sold[0]).toBe(true);
      // The filter would sell it; a bought chest still lands in the bag.
      expect(b.inventory).toHaveLength(1);
      const item = b.inventory[0]!;
      expect(item.level).toBe(20);
      expect(GRADE_IDS.indexOf(item.grade)).toBeGreaterThanOrEqual(GRADE_IDS.indexOf(grade));
      expect(offerBlock(b, 0)).toBe('sold');
      expect(() => buyOffer(b, 0)).toThrow(RangeError);
    },
  );

  it('is off with a full bag, and when the stones fall short', () => {
    const s = offering(rich(), 'chest-earth');
    s.bagSize = 0;
    expect(offerBlock(s, 0)).toBe('bagFull');
    expect(() => buyOffer(s, 0)).toThrow(RangeError);
    const poor = offering(rich(), 'chest-earth');
    poor.stones = offerPrice(poor, 'chest-earth') - 1;
    expect(offerBlock(poor, 0)).toBe('stones');
    expect(() => buyOffer(poor, 0)).toThrow(RangeError);
  });

  it('rolls grades by the normal weights, left out below the minimum', () => {
    for (const min of ['spirit', 'earth', 'heaven'] as const) {
      const allowed = GRADE_IDS.slice(GRADE_IDS.indexOf(min));
      const total = allowed.reduce((n, g) => n + GRADES[g].weight, 0);
      const rng = createRng(42);
      const counts: Partial<Record<GradeId, number>> = {};
      const n = 40_000;
      for (let i = 0; i < n; i++) {
        const g = rollGrade(rng, min);
        counts[g] = (counts[g] ?? 0) + 1;
      }
      for (const g of GRADE_IDS) {
        const want = allowed.includes(g) ? GRADES[g].weight / total : 0;
        expect(Math.abs((counts[g] ?? 0) / n - want), `${min} ${g}`).toBeLessThan(0.01);
      }
    }
  });

  it('draws exactly as before from Mortal', () => {
    const a = createRng(9);
    const b = createRng(9);
    for (let i = 0; i < 200; i++) expect(rollGrade(a, 'mortal')).toBe(rollGrade(b));
  });
});

describe('timed boosts', () => {
  it('adds ten minutes per purchase up to an hour, then is off', () => {
    let s = offering(rich(), 'boost-xp');
    expect(offerPrice(s, 'boost-xp')).toBe(BOOST_PRICE.xp * 10);
    s = buyOffer(s, 0);
    expect(boostLeft(s, 'xp')).toBe(BOOST_SECONDS);
    expect(boostBonus(s, 'xp')).toBe(BOOST_BONUS);
    for (let i = 0; i < 10; i++) {
      s.store.sold[0] = false;
      if (offerBlock(s, 0) === 'boostCap') break;
      s = buyOffer(s, 0);
    }
    expect(boostLeft(s, 'xp')).toBe(BOOST_CAP_SECONDS);
    s.store.sold[0] = false;
    expect(offerBlock(s, 0)).toBe('boostCap');
  });

  it('turns off at the cap on a fractional clock, where expiry - time can round short of it', () => {
    // (t + 3600) - t rounds below 3600 at each of these, so a check on time left would never turn off.
    for (const time of [525.723456, 562.223456, 598.723456, 635.223456]) {
      let s = offering(rich(), 'boost-stones');
      s.time = time;
      s.store.rotation = Math.floor(time / ROTATION_SECONDS);
      let bought = 0;
      while (offerBlock(s, 0) !== 'boostCap') {
        s = buyOffer(s, 0);
        s.store.sold[0] = false;
        bought += 1;
        expect(bought, `${time}`).toBeLessThanOrEqual(BOOST_CAP_SECONDS / BOOST_SECONDS);
      }
      expect(bought).toBe(BOOST_CAP_SECONDS / BOOST_SECONDS);
      expect(s.boosts.stones).toBe(time + BOOST_CAP_SECONDS);
    }
  });

  it('runs out on time', () => {
    const s = buyOffer(offering(rich(), 'boost-treasure'), 0);
    expect(boostBonus(tick(s, BOOST_SECONDS - 1), 'treasure')).toBe(BOOST_BONUS);
    expect(boostBonus(tick(s, BOOST_SECONDS), 'treasure')).toBe(0);
  });

  it('raises XP and spirit stones from kills while active', () => {
    const base = rich();
    base.stones = 0;
    const xpOn = structuredClone(base);
    xpOn.boosts.xp = 1e6;
    const stonesOn = structuredClone(base);
    stonesOn.boosts.stones = 1e6;
    // No Path skills: a boost that brings a breakthrough sooner would also bring new skills.
    const opts = { loadout: noSkills };
    const plain = tick(base, 300, opts);
    const xp = tick(xpOn, 300, opts);
    const stones = tick(stonesOn, 300, opts);
    expect(xp.kills).toBe(plain.kills);
    const totalXp = (st: GameState) => st.cultivator.level * 1e9 + st.cultivator.xp;
    expect(totalXp(xp)).toBeGreaterThan(totalXp(plain));
    expect(stones.stones).toBeGreaterThan(plain.stones);
  });

  it('raises treasure find while active', () => {
    const base = rich();
    base.bagSize = 1e6;
    const on = structuredClone(base);
    on.boosts.treasure = 1e9;
    const drops = (st: GameState) => st.inventory.length + st.dropsSold + st.dropsSalvaged;
    expect(drops(tick(on, 3600))).toBeGreaterThan(drops(tick(base, 3600)));
  });

  it('plays the same in one big step as in many small ones, across an expiry', () => {
    const s = buyOffer(offering(rich(), 'boost-stones'), 0);
    let small = s;
    for (let i = 0; i < 900; i++) small = tick(small, 1);
    expect(tick(s, 900)).toEqual(small);
  });

  it('lists boosts that ran out while away', () => {
    const s = buyOffer(offering(rich(), 'boost-xp'), 0);
    expect(catchUp(s, 60).summary.boostsEnded).toEqual([]);
    expect(catchUp(s, BOOST_SECONDS + 1).summary.boostsEnded).toEqual(['xp']);
    expect(catchUp(rich(), 3600).summary.boostsEnded).toEqual([]);
  });
});

describe('Reincarnation', () => {
  it('loses the stock and the boosts, and the preview counts running boosts', () => {
    const s = buyOffer(offering(rich(), 'boost-xp'), 0);
    s.highestFloor = 30;
    expect(retirePreview(s).boosts).toBe(1);
    const r = retire(s);
    expect(r.store).toEqual({ rotation: -1, offers: [], sold: [] });
    expect(r.boosts).toEqual({ xp: 0, treasure: 0, stones: 0 });
  });
});

describe('hostile input', () => {
  it.each([-1, 4, 1.5, NaN, Infinity, '0' as unknown as number, '__proto__' as unknown as number])(
    'refuses offer position %s',
    (at) => {
      const s = rich();
      expect(() => buyOffer(s, at)).toThrow(RangeError);
      expect(() => offerBlock(s, at)).toThrow(RangeError);
    },
  );

  it('refuses to sell from or refresh a stock that is out of date', () => {
    const s = tick(rich(), ROTATION_SECONDS);
    expect(() => buyOffer(s, 0)).toThrow(RangeError);
    expect(() => refreshStore(s)).toThrow(RangeError);
  });

  it('prices only known offers', () => {
    expect(() => offerPrice(rich(), 'chest-immortal' as OfferId)).toThrow(RangeError);
    expect(() => offerPrice(rich(), 'boost-__proto__' as OfferId)).toThrow(RangeError);
  });
});
