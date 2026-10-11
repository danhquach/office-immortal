/// <reference types="node" />
// The stage the store-page screenshots and video are taken on: the production
// build served by `vite preview`, a 1920 × 1080 page (1536 × 864 at 1.25x, so
// the game fills the frame) with a test save from marketing/saves/ loaded and
// the page clock started at the save's own stamp, so no time passes offline.

import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { SAVE_KEY } from '../../src/storage/save.ts';

/** Every test save's stamp (tools/marketing/saves.ts writes it). */
export const SAVED_AT = Date.UTC(2026, 9, 1, 12, 0, 0);
const PORT = 4317;
const VIEWPORT = { width: 1536, height: 864 };
const SCALE = 1.25;
/** LANG_KEY in src/ui/i18n.ts, which Node can't import (it loads the packs through Vite). */
const LANG_KEY = 'office-immortal.lang';

export interface Stage {
  browser: Browser;
  server: PreviewServer;
  close: () => Promise<void>;
}

/** Serves dist/ and starts a browser. Refuses a build with the cloud save in it (it's not on itch.io). */
export async function openStage(): Promise<Stage> {
  const html = readFileSync('dist/index.html', 'utf8');
  if (!/connect-src &#39;self&#39;;|connect-src 'self';/.test(html)) {
    throw new Error('dist/ has the cloud save in it: rebuild without VITE_SUPABASE_URL');
  }
  const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  const browser = await chromium.launch();
  return {
    browser,
    server,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * A page with the test save `name` loaded and the game drawn, in `lang` ("en"
 * or "vi"). With `paused`, the page clock only moves on `page.clock.runFor`,
 * so what is shown is the same on every run; otherwise it runs in real time.
 */
export async function load(
  stage: Stage,
  name: string,
  { lang = 'en', paused = true }: { lang?: string; paused?: boolean } = {},
): Promise<Page> {
  const context = await stage.browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: 'dark',
    locale: lang === 'vi' ? 'vi-VN' : 'en-US',
    reducedMotion: 'no-preference',
  });
  const save = readFileSync(`marketing/saves/${name}.json`, 'utf8').trim();
  await context.addInitScript(
    ([keys, save, lang]) => {
      localStorage.setItem(keys[0], save);
      localStorage.setItem(keys[1], lang);
    },
    [[SAVE_KEY, LANG_KEY], save, lang] as const,
  );
  const page = await context.newPage();
  await page.clock.install({ time: SAVED_AT - 1000 });
  if (paused) await page.clock.pauseAt(SAVED_AT);
  else await page.clock.runFor(1000);
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator('.bag .cell').first().waitFor();
  return page;
}

/**
 * Plays on, a second at a time, until `selector` shows up, and returns the
 * seconds played; throws after `limit` seconds.
 */
export async function playUntil(page: Page, selector: string, limit: number): Promise<number> {
  for (let s = 0; s <= limit; s++) {
    if (await page.locator(selector).count()) return s;
    await page.clock.runFor(1000);
  }
  throw new Error(`${selector} did not show within ${limit} s`);
}
