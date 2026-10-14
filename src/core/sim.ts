// The game state and the combat tick. Pure: no DOM, no storage.
//
// Time-based, not frame-based: combat is a queue of attack events on one clock,
// and tick() plays every event up to now + dt in time order. Randomness is only
// drawn at events, so one tick(state, 3600) runs the exact same events as 3600
// tick(state, 1) calls (docs/design.md §10).

import {
  breakThrough,
  derive,
  effectiveStats,
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
import { makeFloor, makeTribulation, maxQi, type Enemy } from './floors.ts';
import {
  bonusPoints,
  canRetire,
  insightFor,
  noPassives,
  passiveTreasureFind,
  xpMultiplier,
  type Passives,
} from './prestige.ts';
import {
  defaultSlot,
  equippedArray,
  rollDrop,
  slotsFor,
  soulCap,
  soulDamage,
  type EquipSlotId,
  type GradeId,
  type Item,
} from './loot.ts';
import { chance, rngFrom, type Rng, type RngState } from './rng.ts';
import { boostBonus, emptyStore, noBoosts, type Boosts, type StoreState } from './store.ts';

/** Defence that halves incoming damage. */
export const DEFENCE_HALVES_AT = 50;
/**
 * Seconds between one fight ending (a kill or a loss) and the next starting:
 * neither side attacks meanwhile, so the fallen one's death plays out first.
 */
export const ENEMY_ARRIVAL = 1.2;
/** Seconds between the hits of a Killing Array. */
export const ARRAY_TICK = 1;
/** Seconds between qi regen steps; each adds a second's regen. */
export const QI_TICK = 1;
/** Qi the cultivator gains per attack and per hit taken. */
export const QI_PER_ATTACK = 8;
export const QI_PER_HIT_TAKEN = 4;
/** Qi an enemy with a pool gains per attack, and per second. */
export const ENEMY_QI_PER_ATTACK = 10;
export const ENEMY_QI_REGEN = 1;
/** Tribulation losses in a row before it is set aside (docs/design.md §4). */
export const TRIAL_LOSS_LIMIT = 3;
/** Seconds after the last loss before a set-aside Tribulation gets another try. */
export const TRIAL_RETRY_SECONDS = 10 * 60;
/** How much stronger (damage or max HP, as a share) earns a set-aside Tribulation another try. */
export const TRIAL_STRONGER = 0.05;

/** The Tribulation retry limit's record (docs/design.md §4). */
export interface TrialState {
  /** Auto-Tribulation: a due Tribulation joins the end of the floor; off, only Face it starts one. */
  auto: boolean;
  /** Tribulation losses in a row; at TRIAL_LOSS_LIMIT or more it is set aside. */
  losses: number;
  /** Sim time of the last loss, in seconds; 0 before any. */
  lostAt: number;
  /** The cultivator's damage and max HP at the last loss. */
  lostDamage: number;
  lostMaxHp: number;
}

/** No losses yet, with the switch as given (on by default). */
export function newTrial(auto = true): TrialState {
  return { auto, losses: 0, lostAt: 0, lostDamage: 0, lostMaxHp: 0 };
}

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
  /** Sim time of a Killing Array's next hit, in seconds; unused without one. */
  arrayNextAt: number;
  /** Sim time of the next qi regen step, in seconds. */
  qiNextAt: number;
  /** Souls the equipped Soul Banner holds; 0 without one (docs/design.md §6). */
  souls: number;
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
  /** The Spirit Stone store's stock (docs/design.md §8); lost with the run. */
  store: StoreState;
  /** Timed boosts bought in the store; lost with the run. */
  boosts: Boosts;
  /** Auto-Tribulation and the retry limit; the switch is kept through Early Retirement. */
  trial: TrialState;
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
    arrayNextAt: 0,
    qiNextAt: QI_TICK,
    souls: 0,
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
    store: emptyStore(),
    boosts: noBoosts(),
    trial: newTrial(),
  };
  startFloor(state, rngFrom(state.rng), 0);
  return state;
}

/** How a tick is played: `offline` is Overtime Cultivation, at the offline drop rate. */
export interface TickOptions {
  offline?: boolean;
}

/** Advances the sim by `dt` seconds and returns the new state; `state` is left untouched. */
export function tick(state: GameState, dt: number, opts: TickOptions = {}): GameState {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError(`tick: bad dt ${dt}`);
  const s = structuredClone(state);
  const rng = rngFrom(s.rng);
  const offline = opts.offline === true;
  const end = s.time + dt;
  for (;;) {
    const c = s.cultivator;
    // A disc equipped mid-fight hits at once, never in the past.
    const arrayAt =
      equippedArray(c.equipment)?.id === 'killing' ? Math.max(s.time, s.arrayNextAt) : Infinity;
    // Ties go to the cultivator, then the array, then the enemy, then qi
    // regen, so event order never depends on step size.
    const next = Math.min(c.nextAttackAt, arrayAt, s.enemyNextAttackAt, s.qiNextAt);
    if (next > end) break;
    s.time = next;
    if (c.nextAttackAt === next) cultivatorAttacks(s, rng, offline);
    else if (arrayAt === next) arrayHits(s, rng, offline);
    else if (s.enemyNextAttackAt === next) enemyAttacks(s, rng);
    else regenQi(s);
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
  const next = newGame(seed, s.cultivator.path, {
    insight: Math.min(Number.MAX_SAFE_INTEGER, s.insight + insightFor(s.highestFloor)),
    passives: s.passives,
    retirements: s.retirements + 1,
    filter: s.filter,
  });
  next.trial.auto = s.trial.auto;
  return next;
}

/**
 * The lowest realm (index into REALMS) that may equip a weapon of each grade
 * (docs/design.md §6): Spirit Treasures need Foundation Establishment, Immortal
 * Treasures Golden Core. Magic Tools and every other item type have no gate.
 */
const WEAPON_REALM: Readonly<Partial<Record<GradeId, number>>> = {
  earth: 1,
  heaven: 1,
  immortal: 2,
};

/** The realm (index into REALMS) needed to equip `item`; 0 when anyone may. */
export function requiredRealm(item: Item): number {
  if (item.slot !== 'weapon' || !Object.hasOwn(WEAPON_REALM, item.grade)) return 0;
  return WEAPON_REALM[item.grade] ?? 0;
}

/** True when the cultivator's realm is high enough to equip `item`. */
export function canEquip(c: Cultivator, item: Item): boolean {
  return realmOf(c.level) >= requiredRealm(item);
}

/**
 * Equips the bag item at `index` into position `to` (by default its first free
 * position, else its first), returning the new state; `state` is left
 * untouched. Whatever was in that position goes back into the bag, and a
 * replaced Hidden Weapon takes its souls with it. Throws if the cultivator's
 * realm is below the item's (requiredRealm).
 */
export function equip(state: GameState, index: number, to?: EquipSlotId): GameState {
  const item = Number.isInteger(index) ? state.inventory[index] : undefined;
  if (!item) throw new RangeError(`equip: no item at ${index}`);
  if (to !== undefined && !slotsFor(item.slot).includes(to)) {
    throw new RangeError(`equip: ${item.slot} does not fit ${to}`);
  }
  if (!canEquip(state.cultivator, item)) throw new RangeError('equip: realm too low');
  const s = structuredClone(state);
  const c = s.cultivator;
  const at = to ?? defaultSlot(c.equipment, item);
  const old = c.equipment[at];
  // The clone's copy of the item, so the new state shares nothing with the old.
  const [mine] = s.inventory.splice(index, 1, ...(old ? [old] : [])) as [Item];
  c.equipment[at] = mine;
  // A banner's souls leave with it; the new one starts empty.
  if (mine.slot === 'sideArm') s.souls = 0;
  // Max HP may have dropped with the old item; never sit above it.
  c.hp = Math.min(c.hp, derive(c).maxHp);
  return s;
}

/**
 * Takes off the item worn in position `from` and puts it at the end of the bag,
 * returning the new state; `state` is left untouched. A Soul Banner's souls
 * leave with it, as when it is swapped out. Throws if nothing is worn there or
 * the bag is full.
 */
export function unequip(state: GameState, from: EquipSlotId): GameState {
  if (!Object.hasOwn(state.cultivator.equipment, from) || !state.cultivator.equipment[from]) {
    throw new RangeError(`unequip: nothing in ${from}`);
  }
  if (state.inventory.length >= state.bagSize) throw new RangeError('unequip: bag is full');
  const s = structuredClone(state);
  const c = s.cultivator;
  const item = c.equipment[from] as Item;
  delete c.equipment[from];
  s.inventory.push(item);
  if (item.slot === 'sideArm') s.souls = 0;
  // Max HP may have dropped with the item; never sit above it.
  c.hp = Math.min(c.hp, derive(c).maxHp);
  return s;
}

/**
 * Starts the current floor again from its first enemy, at full HP, with the
 * realm's Tribulation queued if one is due. Returns the new state; `state` is
 * left untouched.
 */
export function restartFloor(state: GameState): GameState {
  const s = structuredClone(state);
  startFloor(s, rngFrom(s.rng), ENEMY_ARRIVAL);
  return s;
}

/** True while a Tribulation is due and not yet being fought, so the player can start it now. */
export function canFaceTribulation(state: GameState): boolean {
  return readyForTribulation(state.cultivator) && state.enemies[0]?.kind !== 'tribulation';
}

/** True while a due Tribulation is set aside after TRIAL_LOSS_LIMIT losses in a row. */
export function trialSetAside(state: GameState): boolean {
  return readyForTribulation(state.cultivator) && state.trial.losses >= TRIAL_LOSS_LIMIT;
}

/**
 * True when a set-aside Tribulation has earned another try: the cultivator's
 * damage or max HP is TRIAL_STRONGER above the last loss's, or
 * TRIAL_RETRY_SECONDS have passed since it.
 */
export function trialRetryDue(state: GameState): boolean {
  if (!trialSetAside(state)) return false;
  const { trial } = state;
  const d = derive(state.cultivator);
  return (
    state.time >= trial.lostAt + TRIAL_RETRY_SECONDS ||
    d.damage >= trial.lostDamage * (1 + TRIAL_STRONGER) ||
    d.maxHp >= trial.lostMaxHp * (1 + TRIAL_STRONGER)
  );
}

/**
 * Seconds until a set-aside Tribulation's timed retry: 0 once due (it joins
 * the floor at the next kill), null when not set aside or Auto-Tribulation is off.
 */
export function trialRetryIn(state: GameState): number | null {
  if (!trialSetAside(state) || !state.trial.auto) return null;
  return trialRetryDue(state)
    ? 0
    : Math.max(0, state.trial.lostAt + TRIAL_RETRY_SECONDS - state.time);
}

/**
 * Turns Auto-Tribulation on or off, returning the new state; `state` is left
 * untouched. Off takes a due Tribulation waiting at the end of the floor off
 * it (one being fought stays); on queues it as a kill would.
 */
export function setAutoTribulation(state: GameState, on: boolean): GameState {
  const s = structuredClone(state);
  s.trial.auto = on;
  if (on) queueTribulation(s);
  else s.enemies = s.enemies.filter((e, i) => i === 0 || e.kind !== 'tribulation');
  return s;
}

/** What the cultivator is doing now, as the status bar names it (docs/design.md §14). */
export type CharacterStatusKind =
  'tribulation' | 'tribulationPaused' | 'tribulationDue' | 'boss' | 'elite' | 'cultivating';

export interface CharacterStatus {
  kind: CharacterStatusKind;
  floor: number;
}

/**
 * The cultivator's status, the first that applies: fighting a Tribulation, one
 * set aside, one due, fighting the floor's boss, an elite, else cultivating.
 */
export function characterStatus(state: GameState): CharacterStatus {
  const { floor } = state;
  const foe = state.enemies[0]?.kind;
  if (foe === 'tribulation') return { kind: 'tribulation', floor };
  if (trialSetAside(state)) return { kind: 'tribulationPaused', floor };
  if (canFaceTribulation(state)) return { kind: 'tribulationDue', floor };
  if (foe === 'boss' || foe === 'elite') return { kind: foe, floor };
  return { kind: 'cultivating', floor };
}

/**
 * Starts the due Tribulation now instead of at the end of the floor (docs/design.md
 * §4): it steps to the front, the enemy it interrupts waits behind it, and the
 * cultivator faces it at full HP. Returns the new state; `state` is left untouched.
 */
export function faceTribulation(state: GameState): GameState {
  if (!canFaceTribulation(state)) throw new RangeError('faceTribulation: no Tribulation to face');
  const s = structuredClone(state);
  const c = s.cultivator;
  const at = s.enemies.findIndex((e) => e.kind === 'tribulation');
  const [trial] = at < 0 ? [makeTribulation(s.floor, realmOf(c.level))] : s.enemies.splice(at, 1);
  s.enemies.unshift(trial as Enemy);
  c.hp = derive(c).maxHp;
  c.attackCount = 0;
  startFight(s, ENEMY_ARRIVAL);
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

function cultivatorAttacks(s: GameState, rng: Rng, offline: boolean): void {
  const c = s.cultivator;
  const path = PATHS[c.path];
  const d = derive(c);
  const enemy = currentEnemy(s);
  c.attackCount += 1;
  let damage = d.damage;
  if (path.burstEvery > 0 && c.attackCount % path.burstEvery === 0) damage *= path.burstMultiplier;
  if (chance(rng, d.critChance)) damage *= d.critMultiplier;
  // A Soul Banner's souls: after crit and burst, so they never crit or burst.
  damage += soulDamage(s.souls, effectiveStats(c).spirit);
  const dealt = Math.min(enemy.hp, mitigate(damage, enemy.defence));
  enemy.hp -= dealt;
  c.hp = Math.min(d.maxHp, c.hp + Math.ceil(dealt * d.lifesteal));
  c.qi = Math.min(d.maxQi, c.qi + QI_PER_ATTACK);
  c.nextAttackAt = s.time + d.attackInterval;
  if (enemy.hp <= 0) defeated(s, rng, offline);
}

/**
 * A qi regen step, once a second, between fights too: the cultivator's
 * regen and, for an enemy with a pool, its trickle.
 */
function regenQi(s: GameState): void {
  const c = s.cultivator;
  const d = derive(c);
  c.qi = Math.min(d.maxQi, c.qi + d.qiRegen * QI_TICK);
  const enemy = currentEnemy(s);
  enemy.qi = Math.min(maxQi(enemy.kind), enemy.qi + ENEMY_QI_REGEN * QI_TICK);
  s.qiNextAt = s.time + QI_TICK;
}

/**
 * A Killing Array's hit, once a second: a share of the cultivator's damage per
 * second (not per hit, so fast and slow Paths gain alike), no crit, burst or
 * lifesteal.
 */
function arrayHits(s: GameState, rng: Rng, offline: boolean): void {
  const enemy = currentEnemy(s);
  const share = equippedArray(s.cultivator.equipment)?.value ?? 0;
  const d = derive(s.cultivator);
  const damage = (d.damage / d.attackInterval) * share * ARRAY_TICK;
  enemy.hp -= Math.min(enemy.hp, mitigate(damage, enemy.defence));
  s.arrayNextAt = s.time + ARRAY_TICK;
  if (enemy.hp <= 0) defeated(s, rng, offline);
}

/** The enemy in front fell: rewards, a drop, then the next enemy or the next floor. */
function defeated(s: GameState, rng: Rng, offline: boolean): void {
  const c = s.cultivator;
  const d = derive(c);
  const enemy = currentEnemy(s);
  s.kills += 1;
  s.souls = Math.min(soulCap(c.equipment), s.souls + 1);
  earn(s, 'stones', killStones(enemy.kind, s.floor, d.stoneFind + boostBonus(s, 'stones')));
  gainXp(c, Math.round(enemy.xp * (xpMultiplier(s.passives) + boostBonus(s, 'xp'))));
  if (enemy.kind === 'tribulation') {
    breakThrough(c);
    s.trial = newTrial(s.trial.auto);
  }
  const find = d.treasureFind + passiveTreasureFind(s.passives) + boostBonus(s, 'treasure');
  const drop = rollDrop(rng, enemy.kind, s.floor, find, offline);
  if (drop) pickUp(s, drop);
  s.enemies.shift();
  queueTribulation(s);
  if (s.enemies.length > 0) {
    // At the attack speed from before any level-up this kill paid for.
    startFight(s, ENEMY_ARRIVAL, d.attackInterval);
    return;
  }
  // A due Tribulation not on the floor (set aside, or Auto-Tribulation off)
  // still bars the way: the floor is played again.
  if (readyForTribulation(c)) {
    startFloor(s, rng, ENEMY_ARRIVAL);
    return;
  }
  s.floor += 1;
  s.highestFloor = Math.max(s.highestFloor, s.floor);
  startFloor(s, rng, ENEMY_ARRIVAL);
}

function enemyAttacks(s: GameState, rng: Rng): void {
  const c = s.cultivator;
  const enemy = currentEnemy(s);
  s.enemyNextAttackAt = s.time + enemy.attackInterval;
  enemy.qi = Math.min(maxQi(enemy.kind), enemy.qi + ENEMY_QI_PER_ATTACK);
  // Rolled only under an Illusion Array, so other runs draw the same numbers.
  const array = equippedArray(c.equipment);
  if (array?.id === 'illusion' && chance(rng, array.value)) return;
  const d = derive(c);
  c.hp -= mitigate(enemy.damage, d.defence);
  c.qi = Math.min(d.maxQi, c.qi + QI_PER_HIT_TAKEN);
  if (c.hp > 0) return;

  // Lost: drop back a floor and climb again from there, so a run never gets
  // stuck. Losing to a Tribulation costs nothing: the floor is played again,
  // and the loss is counted towards setting it aside.
  s.deaths += 1;
  if (enemy.kind === 'tribulation') lostTrial(s);
  else s.floor = Math.max(1, s.floor - 1);
  startFloor(s, rng, ENEMY_ARRIVAL);
}

/** A Tribulation loss: counted, with the time and the cultivator's strength, for the retry limit. */
function lostTrial(s: GameState): void {
  const d = derive(s.cultivator);
  s.trial.losses = Math.min(Number.MAX_SAFE_INTEGER, s.trial.losses + 1);
  s.trial.lostAt = s.time;
  s.trial.lostDamage = d.damage;
  s.trial.lostMaxHp = d.maxHp;
}

/**
 * Once the cultivator is held at a realm cap, the realm's Tribulation joins the
 * end of the floor, so the floor can't be cleared until it is won: only with
 * Auto-Tribulation on, and once set aside only when a retry is due. Checked
 * at kills and floor starts and draws no randomness, so step size never
 * changes what is fought.
 */
function queueTribulation(s: GameState): void {
  const c = s.cultivator;
  if (!readyForTribulation(c) || !s.trial.auto) return;
  if (s.enemies.some((e) => e.kind === 'tribulation')) return;
  if (trialSetAside(s) && !trialRetryDue(s)) return;
  s.enemies.push(makeTribulation(s.floor, realmOf(c.level)));
}

/** Fresh enemies, full HP and no qi, then the first fight. */
export function startFloor(s: GameState, rng: Rng, delay: number): void {
  const c = s.cultivator;
  s.enemies = makeFloor(rng, s.floor);
  queueTribulation(s);
  c.hp = derive(c).maxHp;
  c.qi = 0;
  c.attackCount = 0;
  startFight(s, delay);
}

/**
 * A fight against the enemy in front starts `delay` seconds from now: both
 * sides start their attack timers (the cultivator's `interval` after it), and
 * an equipped disc sets up its array (docs/design.md §6). A Binding Array
 * holds back the enemy's first attack. A Tribulation is faced with full qi.
 */
function startFight(
  s: GameState,
  delay: number,
  interval = derive(s.cultivator).attackInterval,
): void {
  const c = s.cultivator;
  const array = equippedArray(c.equipment);
  const start = s.time + delay;
  if (currentEnemy(s).kind === 'tribulation') c.qi = derive(c).maxQi;
  c.nextAttackAt = start + interval;
  s.enemyNextAttackAt =
    start + currentEnemy(s).attackInterval + (array?.id === 'binding' ? array.value : 0);
  s.arrayNextAt = start + ARRAY_TICK;
}
