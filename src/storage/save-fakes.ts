// Test help for comparing game states across a save. Test support only;
// nothing in the app imports this file.

import { expect } from 'vitest';

type Tester = Parameters<typeof expect.addEqualityTesters>[0][number];

function isState(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && 'cultivator' in v && 'combat' in v;
}

/**
 * Compares game states without the fight's skill state: it is never saved,
 * so a loaded state always has a fresh one (docs/design.md §5 Skills).
 * Register with expect.addEqualityTesters([withoutCombat]).
 */
export const withoutCombat: Tester = function (a, b, testers) {
  if (!isState(a) || !isState(b)) return undefined;
  const [restA, restB] = [{ ...a }, { ...b }];
  delete restA.combat;
  delete restB.combat;
  return this.equals(restA, restB, testers);
};
