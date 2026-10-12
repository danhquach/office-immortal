import { describe, expect, it } from 'vitest';
import css from '../page.css?raw';
import { contrast } from './contrast.ts';

/** The custom properties set in the light block and in the dark (default) block of page.css. */
function themes(): { light: Map<string, string>; dark: Map<string, string> } {
  const dark = /:root:not\(\[data-theme='light'\]\)\s*{([^}]*)}/.exec(css);
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
const SURFACES = ['--bg', '--panel', '--head'];

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

  it('sets the mixed dash colour in both theme blocks', () => {
    const dark = /:root:not\(\[data-theme='light'\]\)\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    const light = /^:root\s*{([^}]*)}/m.exec(css)?.[1] ?? '';
    expect(light).toMatch(/--mixed:\s*#[0-9a-f]{6}\s*;/i);
    expect(dark).toMatch(/--mixed:\s*#[0-9a-f]{6}\s*;/i);
  });

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

    // The XP bar is set once on :root, so the dark theme inherits the same colours.
    it.each([
      ['--xp-ink', '--xp-fill'],
      ['--xp-track-ink', '--xp-track'],
    ])(`${name}: XP bar %s on %s is at least 4.5:1`, (text, surface) => {
      expect(
        contrast(vars.get(text) as string, vars.get(surface) as string),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the XP fill stands out from its track at least 3:1`, () => {
      expect(
        contrast(vars.get('--xp-fill') as string, vars.get('--xp-track') as string),
      ).toBeGreaterThanOrEqual(3);
    });

    // The bag cell's ▲ / ▼ / dash badge is a non-text mark (WCAG 1.4.11) on the cell's --bg.
    it.each(['--up', '--down', '--mixed'])(
      `${name}: the %s gear badge is at least 3:1 on the cell background`,
      (mark) => {
        expect(
          contrast(vars.get(mark) as string, vars.get('--bg') as string),
        ).toBeGreaterThanOrEqual(3);
      },
    );

    it.each([
      '--strip-ink',
      '--strip-hurt',
      '--strip-elite',
      '--strip-boss',
      '--strip-tribulation',
    ])(`${name}: %s on the strip is at least 4.5:1`, (text) => {
      expect(
        contrast(vars.get(text) as string, vars.get('--strip-bg') as string),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('fight strip names', () => {
  /** page.css without its comments, so a selector is just the selector. */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every declaration block of page.css whose selector list includes `selector` exactly. */
  const rules = (selector: string): string[] =>
    [...code.matchAll(/([^{}]+){([^{}]*)}/g)]
      .filter((m) => (m[1] as string).split(',').some((s) => s.trim() === selector))
      .map((m) => m[2] as string);
  const all = (selector: string) => rules(selector).join('\n');
  /** The body of the `@media` rule whose condition is `query`, nested braces and all. */
  const media = (query: string): string => {
    const start = code.indexOf(`@media ${query} {`);
    if (start < 0) return '';
    let depth = 0;
    for (let i = code.indexOf('{', start); i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
    }
    return '';
  };

  it('wraps a long name onto 2 reserved lines instead of clipping it', () => {
    const name = all('.fighter .name');
    expect(name).not.toMatch(/white-space:\s*nowrap/);
    expect(name).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/overflow-wrap:\s*anywhere/);
    expect(name).toMatch(/(?:^|[^-])line-clamp:\s*2\b/);
    // 2 lines reserved, so a long name doesn't push the bar down.
    const lh = /line-height:\s*([\d.]+)\s*;/.exec(name)?.[1];
    const min = /min-height:\s*([\d.]+)em\s*;/.exec(name)?.[1];
    expect(Number(min)).toBeCloseTo(2 * Number(lh), 5);
  });

  it('gives the name its own row at every width, the foe mirrored', () => {
    const fighter = rules('.fighter');
    expect(fighter.join('\n')).toMatch(/grid-template-areas:\s*'name'\s*'bar'\s*'hp'/);
    expect(fighter.join('\n')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    // No rule anywhere (in any media query) puts the name beside the HP.
    expect(code).not.toMatch(/'name hp'|'hp name'/);
    expect(rules('.foe').join('\n')).not.toMatch(/grid-template/);
    // The foe's tier and name both sit on the right; the player's stay on the left.
    expect(all('.foe')).toMatch(/text-align:\s*right/);
    // The tier inherits its side's alignment: no rule aligns it on its own.
    for (const m of code.matchAll(/([^{}]+){([^{}]*)}/g)) {
      if (/\.enemy-tier(?!\))/.test(m[1] as string)) expect(m[2]).not.toMatch(/text-align/);
    }
  });

  it('puts the tier on line 1 by itself and the name on line 2', () => {
    expect(all('.fighter .enemy-tier')).toMatch(/display:\s*block/);
    expect(all('.fighter .name')).toMatch(/(?:^|[^-])line-clamp:\s*2\b/);
  });

  it('shrinks the name, never the tier, under 480 px only', () => {
    const narrow = media('(max-width: 479px)');
    const inNarrow = /\.fighter \.name > :not\(\.enemy-tier\)\s*{([^}]*)}/.exec(narrow)?.[1] ?? '';
    expect(inNarrow).toMatch(/font-size:\s*0\.8rem/);
    // Above 480 px the name keeps the strip's size: the rule exists only in that query.
    expect(code.split('.fighter .name > :not(.enemy-tier)')).toHaveLength(2);
    // No rule anywhere gives the tier unit its own font size.
    for (const m of code.matchAll(/([^{}]+){([^{}]*)}/g)) {
      const sel = m[1] as string;
      if (/\.enemy-tier(?!\))/.test(sel)) expect(m[2]).not.toMatch(/font-size/);
    }
  });

  it('keeps the tier unit whole, bold and in its colour, scoped to the fight strip', () => {
    const tier = all('.fighter .enemy-tier');
    expect(tier).toMatch(/white-space:\s*nowrap/);
    expect(tier).toMatch(/font-weight:\s*700/);
    for (const kind of ['elite', 'boss', 'tribulation']) {
      expect(all(`.fighter .enemy-tier--${kind}`)).toMatch(
        new RegExp(`color:\\s*var\\(--strip-${kind}\\)`),
      );
    }
    // Every tier rule sits under .fighter, so the passives panel's .rank can't pick it up.
    for (const m of code.matchAll(/([^{}]+){/g)) {
      for (const sel of (m[1] as string).split(',')) {
        if (sel.includes('enemy-tier')) expect(sel.trim()).toMatch(/^\.fighter \./);
      }
    }
  });

  it('leaves the passives panel’s rank alone', () => {
    expect(rules('.passive .rank')).toHaveLength(1);
    expect(code).not.toMatch(/\.rank[^{]*enemy|enemy[^{]*\.rank/);
  });

  it('still hides the name in the pop-out', () => {
    expect(all('.mini .fighter .name')).toMatch(/display:\s*none/);
  });
});

describe('title stamp', () => {
  const rule = /^\.stamp\s*{([^}]*)}/m.exec(css)?.[1] ?? '';

  it('is drawn in the Immortal grade colour, which passes contrast above', () => {
    expect(rule).toMatch(/\bcolor:\s*var\(--grade-immortal\)/);
    expect(rule).toMatch(/border:[^;]*var\(--grade-immortal\)/);
  });

  it('sets its capitals in CSS, so screen readers read words, not letters', () => {
    expect(rule).toMatch(/text-transform:\s*uppercase/);
  });
});
