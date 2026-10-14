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
import {
  CAST_PAUSE,
  chooseSkill,
  cooldownFor,
  enduring,
  freshCombat,
  modFactor,
  modInterval,
  modTotal,
  note,
  reflectShare,
  shieldLeft,
  usable,
  WIND_UP,
  type Combat,
  type Effect,
  type RuleInputs,
  type Side,
  type SkillDef,
  type Status,
} from './skills.ts';
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
  /** The current fight's skill state; never saved (docs/design.md §5 Skills). */
  combat: Combat;
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
    combat: freshCombat(),
  };
  startFloor(state, rngFrom(state.rng), 0);
  return state;
}

/** The skills each side may cast now, in priority order for ties. */
export type Loadout = (state: GameState, side: Side) => readonly SkillDef[];

/**
 * The skills in the game: none yet. The Path skills (#144) and the enemy
 * skills (#145, #146) fill this in.
 */
export const noSkills: Loadout = () => [];

/**
 * How a tick is played: `offline` is Overtime Cultivation, at the offline drop
 * rate. `loadout` replaces the game's skills, for tests.
 */
export interface TickOptions {
  offline?: boolean;
  loadout?: Loadout;
}

/** What one tick plays with. */
interface Play {
  rng: Rng;
  offline: boolean;
  loadout: Loadout;
}

/** Advances the sim by `dt` seconds and returns the new state; `state` is left untouched. */
export function tick(state: GameState, dt: number, opts: TickOptions = {}): GameState {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError(`tick: bad dt ${dt}`);
  const s = structuredClone(state);
  const p: Play = {
    rng: rngFrom(s.rng),
    offline: opts.offline === true,
    loadout: opts.loadout ?? noSkills,
  };
  const end = s.time + dt;
  for (;;) {
    const c = s.cultivator;
    const { you, foe } = s.combat;
    // A disc equipped mid-fight hits at once, never in the past.
    const arrayAt =
      equippedArray(c.equipment)?.id === 'killing' ? Math.max(s.time, s.arrayNextAt) : Infinity;
    const youCastAt = you.pending?.at ?? Infinity;
    const foeCastAt = foe.pending?.at ?? Infinity;
    const landAt = foe.windUp?.end ?? Infinity;
    // Ties go to the cultivator, then the array, then the enemy, then qi
    // regen, then the casts, so event order never depends on step size.
    const next = Math.min(
      c.nextAttackAt,
      arrayAt,
      s.enemyNextAttackAt,
      s.qiNextAt,
      youCastAt,
      foeCastAt,
      landAt,
    );
    if (next > end) break;
    s.time = next;
    if (c.nextAttackAt === next) cultivatorAttacks(s, p);
    else if (arrayAt === next) arrayHits(s, p);
    else if (s.enemyNextAttackAt === next) enemyAttacks(s, p);
    else if (s.qiNextAt === next) regenQi(s);
    else if (youCastAt === next) castNow(s, p, 'you');
    else if (foeCastAt === next) castNow(s, p, 'foe');
    else landWindUp(s, p);
    considerCasts(s, p);
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

function cultivatorAttacks(s: GameState, p: Play): void {
  const c = s.cultivator;
  const path = PATHS[c.path];
  const d = derive(c);
  const { you } = s.combat;
  const now = s.time;
  const enemy = currentEnemy(s);
  c.attackCount += 1;
  let damage = d.damage * modFactor(you, 'damage', now);
  if (path.burstEvery > 0 && c.attackCount % path.burstEvery === 0) damage *= path.burstMultiplier;
  if (chance(p.rng, d.critChance + modTotal(you, 'critChance', now))) damage *= d.critMultiplier;
  // A Soul Banner's souls: after crit and burst, so they never crit or burst.
  damage += soulDamage(s.souls, effectiveStats(c).spirit);
  const dealt = strikeFoe(s, 0, damage);
  const lifesteal = d.lifesteal + modTotal(you, 'lifesteal', now);
  c.hp = Math.min(d.maxHp, c.hp + Math.ceil(dealt * lifesteal));
  c.qi = Math.min(d.maxQi, c.qi + QI_PER_ATTACK);
  c.nextAttackAt = now + modInterval(you, d.attackInterval, now);
  if (enemy.hp <= 0) defeated(s, p);
  else reflect(s, p, 'foe', dealt);
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
function arrayHits(s: GameState, p: Play): void {
  const enemy = currentEnemy(s);
  const share = equippedArray(s.cultivator.equipment)?.value ?? 0;
  const d = derive(s.cultivator);
  strikeFoe(s, 0, (d.damage / d.attackInterval) * share * ARRAY_TICK);
  s.arrayNextAt = s.time + ARRAY_TICK;
  if (enemy.hp <= 0) defeated(s, p);
}

/**
 * The enemy at `index` takes a hit of `raw` damage, after its defence (unless
 * `mitigated` is false) and, for the one in front, its buffs, debuffs, shield
 * and "can't drop below 1 HP". Returns the HP it lost; a kill is the caller's
 * to handle.
 */
function strikeFoe(s: GameState, index: number, raw: number, mitigated = true): number {
  const enemy = s.enemies[index];
  if (!enemy) return 0;
  const now = s.time;
  // Only the enemy in front is in the fight; the ones waiting carry no status.
  const status = index === 0 ? s.combat.foe : null;
  const damage = status ? raw * modFactor(status, 'damageTaken', now) : raw;
  const defence = enemy.defence * (status ? modFactor(status, 'defence', now) : 1);
  let dealt = mitigated ? mitigate(damage, defence) : Math.max(1, Math.round(damage));
  if (status) dealt = shielded(status, dealt, enemy.hp, now);
  dealt = Math.min(enemy.hp, dealt);
  enemy.hp -= dealt;
  return dealt;
}

/** The cultivator takes a hit of `raw` damage, as strikeFoe; returns the damage taken. */
function strikeYou(s: GameState, raw: number, mitigated = true): number {
  const c = s.cultivator;
  const { you } = s.combat;
  const now = s.time;
  const damage = raw * modFactor(you, 'damageTaken', now);
  const defence = derive(c).defence * modFactor(you, 'defence', now);
  const taken = shielded(
    you,
    mitigated ? mitigate(damage, defence) : Math.max(1, Math.round(damage)),
    c.hp,
    now,
  );
  c.hp -= taken;
  return taken;
}

/** What gets past a shield (using it up) and a "can't drop below 1 HP" with `hp` left. */
function shielded(status: Status, damage: number, hp: number, now: number): number {
  const absorbed = Math.min(shieldLeft(status, now), damage);
  status.shield -= absorbed;
  const through = damage - absorbed;
  return enduring(status, now) ? Math.min(through, Math.max(0, hp - 1)) : through;
}

/** `hit` took `taken` damage: its reflect sends a share back, which can end the fight. */
function reflect(s: GameState, p: Play, hit: Side, taken: number): void {
  const share = reflectShare(s.combat[hit], s.time);
  if (share <= 0 || taken <= 0) return;
  if (hit === 'you') {
    strikeFoe(s, 0, taken * share, false);
    if (currentEnemy(s).hp <= 0) defeated(s, p);
  } else {
    strikeYou(s, taken * share, false);
    if (s.cultivator.hp <= 0) lost(s, p);
  }
}

/**
 * An enemy fell: rewards and a drop. The one in front makes way for the next
 * enemy or the next floor; one still waiting (a skill's spill) just leaves the wave.
 */
function defeated(s: GameState, p: Play, index = 0): void {
  const c = s.cultivator;
  const d = derive(c);
  const enemy = s.enemies[index];
  if (!enemy) return;
  s.kills += 1;
  s.souls = Math.min(soulCap(c.equipment), s.souls + 1);
  earn(s, 'stones', killStones(enemy.kind, s.floor, d.stoneFind + boostBonus(s, 'stones')));
  gainXp(c, Math.round(enemy.xp * (xpMultiplier(s.passives) + boostBonus(s, 'xp'))));
  if (enemy.kind === 'tribulation') {
    breakThrough(c);
    s.trial = newTrial(s.trial.auto);
  }
  const find = d.treasureFind + passiveTreasureFind(s.passives) + boostBonus(s, 'treasure');
  const drop = rollDrop(p.rng, enemy.kind, s.floor, find, p.offline);
  if (drop) pickUp(s, drop);
  s.enemies.splice(index, 1);
  queueTribulation(s);
  if (index > 0) return;
  if (s.enemies.length > 0) {
    // At the attack speed from before any level-up this kill paid for.
    startFight(s, ENEMY_ARRIVAL, d.attackInterval);
    return;
  }
  // A due Tribulation not on the floor (set aside, or Auto-Tribulation off)
  // still bars the way: the floor is played again.
  if (readyForTribulation(c)) {
    startFloor(s, p.rng, ENEMY_ARRIVAL);
    return;
  }
  s.floor += 1;
  s.highestFloor = Math.max(s.highestFloor, s.floor);
  startFloor(s, p.rng, ENEMY_ARRIVAL);
}

function enemyAttacks(s: GameState, p: Play): void {
  const c = s.cultivator;
  const enemy = currentEnemy(s);
  const { foe } = s.combat;
  s.enemyNextAttackAt = s.time + modInterval(foe, enemy.attackInterval, s.time);
  enemy.qi = Math.min(maxQi(enemy.kind), enemy.qi + ENEMY_QI_PER_ATTACK);
  // Rolled only under an Illusion Array, so other runs draw the same numbers.
  const array = equippedArray(c.equipment);
  if (array?.id === 'illusion' && chance(p.rng, array.value)) return;
  const taken = strikeYou(s, enemy.damage * modFactor(foe, 'damage', s.time));
  c.qi = Math.min(derive(c).maxQi, c.qi + QI_PER_HIT_TAKEN);
  if (c.hp <= 0) lost(s, p);
  else reflect(s, p, 'you', taken);
}

/**
 * Lost: drop back a floor and climb again from there, so a run never gets
 * stuck. Losing to a Tribulation costs nothing: the floor is played again,
 * and the loss is counted towards setting it aside.
 */
function lost(s: GameState, p: Play): void {
  s.deaths += 1;
  if (currentEnemy(s).kind === 'tribulation') lostTrial(s);
  else s.floor = Math.max(1, s.floor - 1);
  startFloor(s, p.rng, ENEMY_ARRIVAL);
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
 * The last fight's buffs, debuffs, shields, cooldowns and wind-ups end here.
 */
function startFight(
  s: GameState,
  delay: number,
  interval = derive(s.cultivator).attackInterval,
): void {
  const c = s.cultivator;
  const array = equippedArray(c.equipment);
  const start = s.time + delay;
  s.combat = freshCombat(start, s.combat);
  if (currentEnemy(s).kind === 'tribulation') c.qi = derive(c).maxQi;
  c.nextAttackAt = start + interval;
  s.enemyNextAttackAt =
    start + currentEnemy(s).attackInterval + (array?.id === 'binding' ? array.value : 0);
  s.arrayNextAt = start + ARRAY_TICK;
}

// ---- Skills (docs/design.md §5 Skills) ----

/**
 * A side's skills now. A skill with neither a qi cost nor a cooldown could
 * recast forever, and a bad wind-up would move the clock backwards.
 */
function skillsOf(s: GameState, p: Play, side: Side): readonly SkillDef[] {
  const list = p.loadout(s, side);
  for (const def of list) {
    if (!(def.qi > 0) && !(def.cooldown > 0)) {
      throw new RangeError(`skill ${def.id}: needs a qi cost or a cooldown`);
    }
    if (def.windUp !== undefined && !(def.windUp >= 0 && Number.isFinite(def.windUp))) {
      throw new RangeError(`skill ${def.id}: bad wind-up ${def.windUp}`);
    }
  }
  return list;
}

/**
 * Agility's cut to the cultivator's skill cooldowns. The stat arrives with the
 * stat rebalance (#149); until then cooldowns run in full.
 */
function cooldownCut(): number {
  return 0;
}

/** What the shared rules and a skill's own rule see for `side`, now. */
function rules(s: GameState, side: Side): RuleInputs {
  const c = s.cultivator;
  const d = derive(c);
  const enemy = currentEnemy(s);
  const { you, foe, fightAt } = s.combat;
  const now = s.time;
  const fightTime = now - fightAt;
  const mine = {
    hp: c.hp,
    maxHp: d.maxHp,
    qi: c.qi,
    maxQi: d.maxQi,
    windingUp: you.windUp !== null,
    fightTime,
  };
  const theirs = {
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    qi: enemy.qi,
    maxQi: maxQi(enemy.kind),
    windingUp: foe.windUp !== null,
    fightTime,
  };
  // The next normal hit, without crit or burst: what rule 2 reads.
  const nextHitKills =
    side === 'you'
      ? mitigate(
          d.damage * modFactor(you, 'damage', now) * modFactor(foe, 'damageTaken', now),
          enemy.defence * modFactor(foe, 'defence', now),
        ) >= enemy.hp
      : mitigate(
          enemy.damage * modFactor(foe, 'damage', now) * modFactor(you, 'damageTaken', now),
          d.defence * modFactor(you, 'defence', now),
        ) >= c.hp;
  return {
    ctx: {
      side,
      self: side === 'you' ? mine : theirs,
      other: side === 'you' ? theirs : mine,
      foeKind: enemy.kind,
      waveLeft: s.enemies.length,
    },
    status: s.combat[side],
    now,
    nextHitKills,
  };
}

/**
 * After every event, each side that is free picks the skill its rules allow
 * and waits a seeded pause of up to CAST_PAUSE before casting it. Randomness is
 * drawn only when a skill is picked, so a side with no skills draws none.
 */
function considerCasts(s: GameState, p: Play): void {
  if (s.time < s.combat.fightAt) return;
  for (const side of ['you', 'foe'] as const) {
    const status = s.combat[side];
    if (status.pending || status.windUp) continue;
    const loadout = skillsOf(s, p, side);
    if (loadout.length === 0) continue;
    const pick = chooseSkill(loadout, rules(s, side));
    if (pick) status.pending = { skill: pick.id, at: s.time + p.rng() * CAST_PAUSE };
  }
}

/**
 * A side's pause ran out: if the skill is still usable it is cast. The
 * cultivator's lands at once; an enemy's pays its qi and winds up first.
 */
function castNow(s: GameState, p: Play, side: Side): void {
  const status = s.combat[side];
  const id = status.pending?.skill;
  status.pending = null;
  const loadout = skillsOf(s, p, side);
  const def = loadout.find((k) => k.id === id);
  if (!def || !usable(def, loadout, rules(s, side))) return;
  const cut = side === 'you' ? cooldownCut() : 0;
  if (def.cooldown > 0) status.cooldowns[def.id] = s.time + cooldownFor(def, cut);
  status.uses[def.id] =
    (Object.hasOwn(status.uses, def.id) ? (status.uses[def.id] as number) : 0) + 1;
  if (side === 'you') {
    s.cultivator.qi -= def.qi;
    land(s, p, 'you', def);
    return;
  }
  currentEnemy(s).qi -= def.qi;
  status.windUp = {
    skill: def.id,
    name: def.name,
    start: s.time,
    end: s.time + (def.windUp ?? WIND_UP),
  };
  note(s.combat, { at: s.time, who: 'foe', skill: def.name, windUp: true });
}

/** An enemy's wind-up ran its course: the skill lands. */
function landWindUp(s: GameState, p: Play): void {
  const { foe } = s.combat;
  const id = foe.windUp?.skill;
  foe.windUp = null;
  const def = skillsOf(s, p, 'foe').find((k) => k.id === id);
  if (def) land(s, p, 'foe', def);
}

/** A skill lands: its effects in order, until one ends the fight. */
function land(s: GameState, p: Play, side: Side, def: SkillDef): void {
  const fight = s.combat.fight;
  note(s.combat, { at: s.time, who: side, skill: def.name, windUp: false });
  for (const effect of def.effects) {
    apply(s, p, side, effect);
    if (s.combat.fight !== fight) return;
  }
}

/** The side opposite `side`. */
function otherSide(side: Side): Side {
  return side === 'you' ? 'foe' : 'you';
}

function apply(s: GameState, p: Play, side: Side, e: Effect): void {
  const c = s.cultivator;
  const d = derive(c);
  const enemy = currentEnemy(s);
  const now = s.time;
  const combat = s.combat;
  const mine = combat[side];
  const other = otherSide(side);
  const theirs = combat[other];
  const maxHp = side === 'you' ? d.maxHp : enemy.maxHp;
  switch (e.type) {
    case 'hit':
      hits(s, p, side, e);
      return;
    case 'mod': {
      const target = combat[e.on === 'self' ? side : other];
      // Ended ones go, so a buff cast over and over never piles up.
      target.mods = target.mods.filter((m) => m.until > now);
      target.mods.push({ stat: e.stat, amount: e.amount, until: now + e.duration });
      return;
    }
    case 'shield':
      mine.shield = Math.round(maxHp * e.share);
      mine.shieldUntil = now + e.duration;
      note(combat, { at: now, who: side, effect: 'shielded' });
      return;
    case 'heal':
      if (side === 'you') c.hp = Math.min(maxHp, c.hp + Math.round(maxHp * e.share));
      else enemy.hp = Math.min(maxHp, enemy.hp + Math.round(maxHp * e.share));
      return;
    case 'stun': {
      const until = Math.max(theirs.stunUntil, now + e.duration);
      theirs.stunUntil = until;
      theirs.pending = null;
      // A stunned fighter attacks again only once it wears off.
      if (other === 'you') c.nextAttackAt = Math.max(c.nextAttackAt, until);
      else s.enemyNextAttackAt = Math.max(s.enemyNextAttackAt, until);
      note(combat, { at: now, who: other, effect: 'stunned' });
      if (theirs.windUp) {
        theirs.windUp = null;
        note(combat, { at: now, who: other, effect: 'interrupted' });
      }
      return;
    }
    case 'silence':
      theirs.silenceUntil = Math.max(theirs.silenceUntil, now + e.duration);
      theirs.pending = null;
      note(combat, { at: now, who: other, effect: 'silenced' });
      return;
    case 'drain': {
      const target = other === 'you' ? c : enemy;
      const taken = Math.min(target.qi, e.amount);
      target.qi -= taken;
      if (!e.steal) return;
      if (side === 'you') c.qi = Math.min(d.maxQi, c.qi + taken);
      else enemy.qi = Math.min(maxQi(enemy.kind), enemy.qi + taken);
      return;
    }
    case 'reflect':
      mine.reflect = e.share;
      mine.reflectUntil = now + e.duration;
      return;
    case 'endure':
      mine.endureUntil = now + e.duration;
      return;
  }
}

/** A hit effect: each hit (and its spill) lands, stopping once the fight ends. */
function hits(s: GameState, p: Play, side: Side, e: Extract<Effect, { type: 'hit' }>): void {
  const fight = s.combat.fight;
  const c = s.cultivator;
  const d = derive(c);
  for (let i = 0; i < (e.hits ?? 1); i++) {
    const now = s.time;
    if (side === 'foe') {
      const { foe } = s.combat;
      const taken = strikeYou(s, currentEnemy(s).damage * e.mult * modFactor(foe, 'damage', now));
      if (c.hp <= 0) lost(s, p);
      else reflect(s, p, 'you', taken);
    } else {
      const { you } = s.combat;
      const base = d.damage * modFactor(you, 'damage', now);
      const crit =
        e.crit === 'always' ||
        ((e.crit ?? 'roll') === 'roll' &&
          chance(p.rng, d.critChance + modTotal(you, 'critChance', now)));
      const dealt = strikeFoe(s, 0, base * e.mult * (crit ? d.critMultiplier : 1));
      // Spill never reaches a Tribulation waiting at the end: it is faced whole.
      let spill = Math.min(e.spill?.count ?? 0, s.enemies.length - 1);
      while (spill > 0 && s.enemies[spill]?.kind === 'tribulation') spill -= 1;
      for (let j = 1; j <= spill; j++) strikeFoe(s, j, base * (e.spill?.mult ?? 0));
      // The ones waiting fall first, from the back, so the indices hold.
      for (let j = spill; j >= 1; j--) if ((s.enemies[j]?.hp ?? 1) <= 0) defeated(s, p, j);
      if (currentEnemy(s).hp <= 0) defeated(s, p);
      else reflect(s, p, 'foe', dealt);
    }
    if (s.combat.fight !== fight) return;
  }
}
