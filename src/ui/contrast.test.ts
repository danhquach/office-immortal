import { describe, expect, it } from 'vitest';
import css from '../page.css?raw';
import { contrast } from './contrast.ts';

/** The custom properties set in the light block and in the dark-scheme block of page.css. */
function themes(): { light: Map<string, string>; dark: Map<string, string> } {
  const dark = /@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/.exec(css);
  const light = /^:root\s*{([^}]*)}/m.exec(css);
  if (!light?.[1] || !dark?.[1]) throw new Error('page.css: theme blocks not found');
  const vars = (block: string) =>
    new Map(
      [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
        (m) => [m[1], m[2]] as [string, string],
      ),
    );
  const l = vars(light[1]);
  // Dark overrides light; anything it leaves alone keeps its light value.
  return { light: l, dark: new Map([...l, ...vars(dark[1])]) };
}

const GRADES = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'];
const TEXT = ['--ink', '--muted', '--up', '--down', ...GRADES.map((g) => `--grade-${g}`)];
const SURFACES = ['--bg', '--panel'];

describe('contrast', () => {
  it('matches known WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('rejects anything but #rrggbb', () => {
    expect(() => contrast('red', '#ffffff')).toThrow(RangeError);
  });
});

describe('page.css colours', () => {
  const t = themes();

  it('defines every grade colour in both themes', () => {
    for (const g of GRADES) {
      expect(t.light.has(`--grade-${g}`)).toBe(true);
      expect(t.dark.has(`--grade-${g}`)).toBe(true);
    }
  });

  for (const [name, vars] of Object.entries(t)) {
    it.each(TEXT.flatMap((text) => SURFACES.map((surface) => [text, surface])))(
      `${name}: %s on %s is at least 4.5:1`,
      (text, surface) => {
        expect(
          contrast(vars.get(text) as string, vars.get(surface) as string),
        ).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(['--strip-ink', '--strip-hurt'])(
      `${name}: %s on the strip is at least 4.5:1`,
      (text) => {
        expect(
          contrast(vars.get(text) as string, vars.get('--strip-bg') as string),
        ).toBeGreaterThanOrEqual(4.5);
      },
    );
  }
});
