/// <reference types="node" />
// Takes the store-page screenshots (marketing/screenshots/NN-*.png, 1920 ×
// 1080) from the production build and the test saves in marketing/saves/. The
// page clock only moves when told to and CSS animations are finished before
// each shot, so a rerun takes the same pictures; retake them after a UI change.
//
//   npm run build && npm run marketing:screenshots

import { mkdirSync, rmSync } from 'node:fs';
import type { Page } from 'playwright';
import { load, openStage, playUntil } from './stage.ts';

const OUT = 'marketing/screenshots';

interface Shot {
  name: string;
  save: string;
  lang?: string;
  /** Sets the scene once the save is loaded. */
  act: (page: Page) => Promise<void>;
}

/** Shows the details of the first bag item matching `selector` (the bag sorts best first). */
async function inspect(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click();
}

const SHOTS: Shot[] = [
  {
    name: '01-early-floor-fight',
    save: 'early-floor',
    act: (page) => page.clock.runFor(2600),
  },
  {
    name: '02-immortal-drop',
    save: 'immortal-drop',
    act: async (page) => {
      await playUntil(page, '.drops li.grade-immortal', 60);
      await inspect(page, '.bag .cell.grade-immortal');
    },
  },
  {
    name: '03-tribulation-boss',
    save: 'tribulation',
    act: (page) => page.clock.runFor(3000),
  },
  {
    name: '04-inventory-and-equipment',
    save: 'inventory',
    act: async (page) => {
      await page.clock.runFor(1500);
      await inspect(page, '.bag .cell.grade-heaven');
    },
  },
  {
    name: '05-reincarnation',
    save: 'reincarnation',
    act: async (page) => {
      await page.clock.runFor(1500);
      await page.locator('#tab-retire').click();
    },
  },
  {
    name: '06-vietnamese',
    save: 'inventory',
    lang: 'vi',
    act: async (page) => {
      await page.clock.runFor(1500);
      await inspect(page, '.bag .cell.grade-heaven');
    },
  },
];

const stage = await openStage();
try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    const page = await load(stage, shot.save, { lang: shot.lang });
    await shot.act(page);
    // Clicks move the mouse; park it so no hover state shows.
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, animations: 'disabled' });
    await page.context().close();
    console.log(`${OUT}/${shot.name}.png`);
  }
} finally {
  await stage.close();
}
