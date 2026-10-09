// Floors and the office demons on them (docs/design.md §5). A floor is waves
// of demons, then an elite, then a boss. Numbers are starting points.

import { pick, type Rng } from './rng.ts';

export type EnemyKind = 'demon' | 'elite' | 'boss';

export interface Enemy {
  name: string;
  kind: EnemyKind;
  maxHp: number;
  hp: number;
  damage: number;
  defence: number;
  /** Seconds between attacks. */
  attackInterval: number;
  xp: number;
}

export const DEMONS = [
  'Deadline Fiend',
  'Inbox Hydra',
  'Meeting Wraith',
  'Printer Golem',
  'Reply-All Swarm',
] as const;

export const BOSSES = ['Quarterly Review', 'The Auditor', 'Middle Manager'] as const;

export const WAVES_PER_FLOOR = 3;
export const DEMONS_PER_WAVE = 3;

/** Growth per floor of enemy HP and damage. */
export const POWER_GROWTH = 1.2;
/** Growth per floor of XP per kill. */
export const XP_GROWTH = 1.15;

const KINDS: Readonly<Record<EnemyKind, { hp: number; damage: number; xp: number }>> = {
  demon: { hp: 1, damage: 1, xp: 1 },
  elite: { hp: 3, damage: 1.5, xp: 3 },
  boss: { hp: 6, damage: 2, xp: 8 },
};

export function makeEnemy(floor: number, kind: EnemyKind, name: string): Enemy {
  const power = POWER_GROWTH ** (floor - 1);
  const k = KINDS[kind];
  const maxHp = Math.round(25 * power * k.hp);
  return {
    name,
    kind,
    maxHp,
    hp: maxHp,
    damage: 3 * power * k.damage,
    defence: 2 * (floor - 1),
    attackInterval: 2,
    xp: Math.round(5 * XP_GROWTH ** (floor - 1) * k.xp),
  };
}

/** Every enemy on a floor, in fighting order: the waves, then the elite, then the boss. */
export function makeFloor(rng: Rng, floor: number): Enemy[] {
  const enemies: Enemy[] = [];
  for (let i = 0; i < WAVES_PER_FLOOR * DEMONS_PER_WAVE; i++) {
    enemies.push(makeEnemy(floor, 'demon', pick(rng, DEMONS)));
  }
  enemies.push(makeEnemy(floor, 'elite', `Elite ${pick(rng, DEMONS)}`));
  enemies.push(makeEnemy(floor, 'boss', pick(rng, BOSSES)));
  return enemies;
}
