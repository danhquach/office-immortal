// The names the sim hands the UI, by kind: language packs translate each kind
// on its own, as one English name can mean two things (the Immortal grade and
// the Immortal realm).

import { PATHS, REALMS } from '../core/cultivator.ts';
import { BOSSES, DEMONS, TRIBULATIONS } from '../core/floors.ts';
import { ARRAYS, CHARM_LINES, EQUIP_SLOTS, GRADES, SLOTS, UNIQUES } from '../core/loot.ts';
import { PASSIVES } from '../core/prestige.ts';

export const NAME_KINDS = {
  path: Object.values(PATHS).map((p) => p.name),
  realm: REALMS.map((r) => r.name),
  title: REALMS.flatMap((r) => (r.title ? [r.title] : [])),
  grade: Object.values(GRADES).map((g) => g.name),
  slot: Object.values(SLOTS).map((s) => s.name),
  equipSlot: Object.values(EQUIP_SLOTS).map((s) => s.name),
  item: [...new Set(Object.values(SLOTS).flatMap((s) => s.names))],
  unique: Object.values(UNIQUES).map((u) => u.name),
  array: Object.values(ARRAYS).map((a) => a.name),
  charmLine: Object.values(CHARM_LINES).map((l) => l.name),
  passive: Object.values(PASSIVES).map((p) => p.name),
  passiveRank: Object.values(PASSIVES).map((p) => p.perRankText),
  enemy: [...DEMONS, ...BOSSES, ...TRIBULATIONS],
} as const satisfies Record<string, readonly string[]>;

export type NameKind = keyof typeof NAME_KINDS;

/** Every name as itself, by kind: the English pack's names. */
export function namesAsIs(): { [K in NameKind]: Record<string, string> } {
  const entries = Object.entries(NAME_KINDS).map(([kind, names]) => [
    kind,
    Object.fromEntries(names.map((n) => [n, n])),
  ]);
  return Object.fromEntries(entries) as { [K in NameKind]: Record<string, string> };
}
