import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from './save.ts';

// The store-page screenshots are taken from these saves (tools/marketing/).
// A change to the save format that stops one loading shows up here, not as a
// screenshot of the Path choice; rerun `npm run marketing:saves` to fix it.
const DIR = 'marketing/saves';
const NAMES = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('store-page test saves', () => {
  it('are all there', () => {
    expect(NAMES.sort()).toEqual([
      'early-floor.json',
      'immortal-drop.json',
      'inventory.json',
      'reincarnation.json',
      'tribulation.json',
    ]);
  });

  it.each(NAMES)('%s loads', (name) => {
    expect(decodeSave(readFileSync(`${DIR}/${name}`, 'utf8').trim())).not.toBeNull();
  });

  it('include a Tribulation faced early, the floor waiting behind it', () => {
    const save = decodeSave(readFileSync(`${DIR}/tribulation.json`, 'utf8').trim());
    expect(save?.state.enemies[0]?.kind).toBe('tribulation');
    expect(save?.state.enemies.length).toBeGreaterThan(1);
  });
});
