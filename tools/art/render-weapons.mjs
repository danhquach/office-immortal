// Renders the weapon icon SVGs (tools/art/weapons.mjs) to transparent PNGs in
// art-src/weapons/, one per weapon name, for tools/art/build.py to fit into the
// icon atlas (the "renders" of the manifest's weapon entry).
//
//   node tools/art/render-weapons.mjs
//
// Needs Playwright with Chromium. It is not a project dependency: install it
// anywhere and point PLAYWRIGHT_MODULE at its entry file if `playwright` does
// not resolve from here.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAMILIES, GRADES } from './weapons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'art-src', 'weapons');
const SIZE = 384;

/** The file each weapon renders to, in atlas row order: by grade, then family. */
export function renders() {
  return GRADES.flatMap((grade, g) =>
    FAMILIES.map((family) => ({
      name: family.names[g],
      file: `weapons/${grade}-${family.id}.png`,
      svg: () => family.draw(grade),
    })),
  );
}

async function main() {
  const spec = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
  const pw = await import(isAbsolute(spec) ? pathToFileURL(spec).href : spec);
  const { chromium } = pw.default ?? pw;
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    for (const r of renders()) {
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent">${r.svg()}</body></html>`,
      );
      const png = await page.locator('svg').screenshot({ omitBackground: true });
      await writeFile(join(ROOT, 'art-src', r.file), png);
      console.log(`${r.file}  ${r.name}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
