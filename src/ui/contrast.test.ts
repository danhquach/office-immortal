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

/** The hue of `#rrggbb`, 0–360°. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The gap between two hues round the colour wheel, 0–180°. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

const GRADES = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'];
const TEXT = [
  '--ink',
  '--muted',
  '--up',
  '--down',
  '--sell',
  '--salvage',
  '--craft',
  '--offence',
  '--defence',
  '--utility',
  ...GRADES.map((g) => `--grade-${g}`),
];
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

  it('turns every grade colour into --ink in Discreet mode, which passes 4.5:1 in both themes', () => {
    const block = /:root\[data-discreet\]\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    for (const g of GRADES) expect(block).toMatch(new RegExp(`--grade-${g}:\\s*var\\(--ink\\);`));
    for (const theme of [t.light, t.dark]) {
      for (const surface of SURFACES) {
        expect(
          contrast(theme.get('--ink') as string, theme.get(surface) as string),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the cultivator's yell (qi) apart in hue from the enemy's gold yell", () => {
    const t = themes();
    for (const vars of [t.light, t.dark]) {
      const gap = hueGap(hue(vars.get('--qi') as string), hue(vars.get('--strip-elite') as string));
      expect(gap).toBeGreaterThan(90);
    }
  });

  it('sets the mixed dash colour in both theme blocks', () => {
    const dark = /:root:not\(\[data-theme='light'\]\)\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    const light = /^:root\s*{([^}]*)}/m.exec(css)?.[1] ?? '';
    expect(light).toMatch(/--mixed:\s*#[0-9a-f]{6}\s*;/i);
    expect(dark).toMatch(/--mixed:\s*#[0-9a-f]{6}\s*;/i);
  });

  it('sets the sell and salvage colours in both theme blocks, distinct from each other', () => {
    const dark = /:root:not\(\[data-theme='light'\]\)\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    const light = /^:root\s*{([^}]*)}/m.exec(css)?.[1] ?? '';
    for (const block of [light, dark]) {
      expect(block).toMatch(/--sell:\s*#[0-9a-f]{6}\s*;/i);
      expect(block).toMatch(/--salvage:\s*#[0-9a-f]{6}\s*;/i);
      expect(block).toMatch(/--craft:\s*#[0-9a-f]{6}\s*;/i);
    }
    // Each sits apart in hue from the other and from the colours that mean
    // something else nearby (grades, badges, accent, strip tiers).
    const others = [
      '--up',
      '--down',
      '--mixed',
      '--accent',
      '--strip-elite',
      '--strip-boss',
      '--strip-tribulation',
      ...GRADES.filter((g) => g !== 'mortal').map((g) => `--grade-${g}`),
    ];
    for (const vars of [t.light, t.dark]) {
      const hueOf = (v: string) => hue(vars.get(v) as string);
      expect(hueGap(hueOf('--sell'), hueOf('--salvage'))).toBeGreaterThan(90);
      for (const action of ['--sell', '--salvage'])
        expect(hueGap(hueOf(action), hueOf('--craft')), `${action} vs --craft`).toBeGreaterThan(60);
      for (const action of ['--sell', '--salvage', '--craft']) {
        for (const other of others) {
          expect(hueGap(hueOf(action), hueOf(other)), `${action} vs ${other}`).toBeGreaterThan(15);
        }
      }
    }
  });

  it('gives each attribute kind its own colour, apart from the others nearby', () => {
    const others = [
      '--up',
      '--down',
      '--mixed',
      '--accent',
      '--sell',
      '--salvage',
      '--craft',
      '--strip-tribulation',
      ...GRADES.filter((g) => g !== 'mortal').map((g) => `--grade-${g}`),
    ];
    const kinds = ['--offence', '--defence', '--utility'];
    for (const vars of [t.light, t.dark]) {
      const hueOf = (v: string) => hue(vars.get(v) as string);
      for (const kind of kinds) {
        for (const other of [...others, ...kinds.filter((k) => k !== kind)]) {
          expect(hueGap(hueOf(kind), hueOf(other)), `${kind} vs ${other}`).toBeGreaterThan(15);
        }
      }
    }
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const kind of ['offence', 'defence', 'utility']) {
      expect(new RegExp(`\\.kind-${kind}\\s*{[^}]*color:\\s*var\\(--${kind}\\)`).test(code)).toBe(
        true,
      );
    }
  });

  it('colours every sell control with --sell and every salvage control with --salvage', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const action of ['sell', 'salvage']) {
      const button = new RegExp(
        `button\\.${action}:not\\(\\[aria-disabled='true'\\]\\)\\s*{([^}]*)}`,
      ).exec(code)?.[1];
      expect(button).toMatch(new RegExp(`(?:^|[^-])color:\\s*var\\(--${action}\\)`));
      expect(button).toMatch(new RegExp(`border-color:\\s*var\\(--${action}\\)`));
      const box = new RegExp(`\\.confirm\\[data-action='${action}'\\]\\s*{([^}]*)}`).exec(
        code,
      )?.[1];
      expect(box).toMatch(new RegExp(`border-color:\\s*var\\(--${action}\\)`));
    }
    const craft = /button\[data-action='craft'\]:not\(\[aria-disabled='true'\]\)\s*{([^}]*)}/.exec(
      code,
    )?.[1];
    expect(craft).toMatch(/(?:^|[^-])color:\s*var\(--craft\)/);
    expect(craft).toMatch(/border-color:\s*var\(--craft\)/);
  });

  it('tints the bulk grade picker and the confirmation grade name with the grade tokens', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string) =>
      new RegExp(`(?:^|[},])\\s*${selector}\\s*(?:,[^{]*)?{([^}]*)}`, 'm').exec(code)?.[1] ?? '';
    for (const g of GRADES) {
      // The picker's chosen value, and the bag cells' / confirmation span's class.
      expect(rule(`\\.field select\\[data-tint='${g}'\\]`)).toMatch(
        new RegExp(`(?:^|[^-])color:\\s*var\\(--grade-${g}\\)`),
      );
      expect(rule(`\\.grade-${g}`)).toMatch(
        new RegExp(`(?:^|[^-])color:\\s*var\\(--grade-${g}\\)`),
      );
    }
    for (const a of ['sell', 'salvage']) {
      expect(rule(`\\.field select\\[data-tint='${a}'\\]`)).toMatch(
        new RegExp(`(?:^|[^-])color:\\s*var\\(--${a}\\)`),
      );
    }
    // Picker and options sit on --bg, a surface every text colour is checked on.
    expect(rule('select')).toMatch(/background:\s*var\(--bg\)/);
    expect(rule('\\.field option')).toMatch(/background:\s*var\(--bg\)/);
    // Unstyled options fall back to --ink, never the chosen value's colour, and
    // a highlighted row uses the system's own pair.
    expect(rule('\\.field option')).toMatch(/(?:^|[^-])color:\s*var\(--ink\)/);
    for (const g of GRADES) {
      expect(rule(`\\.field option\\.grade-${g}`)).toMatch(
        new RegExp(`(?:^|[^-])color:\\s*var\\(--grade-${g}\\)`),
      );
    }
    expect(rule('\\.field option:hover')).toMatch(/color:\s*HighlightText/);
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

    it(`${name}: the cell's refine level is at least 4.5:1 on its --bg halo`, () => {
      const rule = /^\.cell \.refine\s*{([^}]*)}/m.exec(css)?.[1] ?? '';
      // No backing box: the digits stand on the art with a --bg halo round them.
      expect(rule).not.toMatch(/background/);
      expect(rule).toMatch(/text-shadow:[^;]*var\(--bg\)/);
      const text = /(?:^|[^-])color:\s*var\((--[\w-]+)\)/.exec(rule)?.[1] as string;
      expect(TEXT).toContain(text);
      expect(contrast(vars.get(text) as string, vars.get('--bg') as string)).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it.each([
      '--strip-ink',
      '--strip-hurt',
      '--strip-elite',
      '--strip-boss',
      '--strip-tribulation',
      // The cultivator's yell bubble text.
      '--qi',
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
  /**
   * The body of the `@media` rule whose condition is `query`, nested braces and
   * all: the first such rule, or the one holding offset `at`.
   */
  const media = (query: string, at = -1): string => {
    const head = `@media ${query} {`;
    const start = at < 0 ? code.indexOf(head) : code.lastIndexOf(head, at);
    if (start < 0) return '';
    let depth = 0;
    for (let i = code.indexOf('{', start); i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
    }
    return '';
  };
  /**
   * page.css without the under-720 px block: that compact strip (one line per
   * fighter, the tier as a symbol) is checked in "Full view layout"; these rules
   * hold everywhere else.
   */
  const roomy = code.replace(
    media('(min-width: 940px) and (min-height: 600px) and (max-height: 719px)'),
    '',
  );

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
    expect(fighter.join('\n')).toMatch(/grid-template-areas:\s*'name'\s*'bar'\s*'qi'\s*;/);
    expect(fighter.join('\n')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    // No rule (in any other media query) puts the name beside the HP.
    expect(roomy).not.toMatch(/'name hp'|'hp name'/);
    expect(rules('.foe').join('\n')).not.toMatch(/grid-template/);
    // The foe's tier and name both sit on the right; the player's stay on the left.
    expect(all('.foe')).toMatch(/text-align:\s*right/);
    // The tier inherits its side's alignment: no rule aligns it on its own.
    for (const m of code.matchAll(/([^{}]+){([^{}]*)}/g)) {
      if (/\.enemy-tier(?!\))/.test(m[1] as string)) expect(m[2]).not.toMatch(/text-align/);
    }
  });

  it('writes the HP inside the HP bar at every size, outlined over the fills', () => {
    const hp = all('.fighter .hp');
    expect(hp).toMatch(/grid-area:\s*bar/);
    expect(hp).toMatch(/text-shadow:[^;]*var\(--strip-bg\)/);
    expect(hp).toMatch(/white-space:\s*nowrap/);
    // The text's line is the bar's height, so it sits centred in it.
    const bar = /(?:^|\s)height:\s*(\d+)px/.exec(all('.fighter .bar'))?.[1];
    expect(hp).toMatch(new RegExp(`line-height:\\s*${bar}px`));
    expect(Number(bar)).toBeGreaterThanOrEqual(12);
    // The cultivator's HP bar keeps the whole width (its skills sit beside the
    // qi bar), so a long HP fits.
    expect(all('.fighter.you')).toMatch(
      /grid-template-areas:\s*'name name'\s*'bar bar'\s*'qi skills'/,
    );
    // A step smaller on a phone, so an 8-digit HP still fits at 375 px.
    const phone = /\.fighter \.hp\s*{([^}]*)}/.exec(media('(max-width: 479px)'))?.[1] ?? '';
    expect(phone).toMatch(/font-size:\s*0\.65rem/);
    // No HP row of its own anywhere: no grid area named hp, no template using it.
    expect(code).not.toMatch(/grid-area:\s*hp\b/);
    for (const m of code.matchAll(/grid-template-areas:([^;]*);/g)) {
      expect(m[1]).not.toMatch(/\bhp\b/);
    }
  });

  it('keeps the pop-out’s HP bars thin, with no HP text', () => {
    expect(all('.mini .fighter .hp')).toMatch(/display:\s*none/);
    expect(all('.mini .fighter .bar:not(.qi)')).toMatch(/height:\s*8px/);
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
    // No other rule gives the tier unit its own font size.
    for (const m of roomy.matchAll(/([^{}]+){([^{}]*)}/g)) {
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
        if (sel.includes('enemy-tier')) expect(sel.trim()).toMatch(/^(?:\.game )?\.fighter \./);
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

describe('Full view layout', () => {
  /** page.css without its comments. */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /**
   * The body of the `@media` rule whose condition is `query`, nested braces and
   * all: the first such rule, or the one holding offset `at`.
   */
  const media = (query: string, at = -1): string => {
    const head = `@media ${query} {`;
    const start = at < 0 ? code.indexOf(head) : code.lastIndexOf(head, at);
    if (start < 0) return '';
    let depth = 0;
    for (let i = code.indexOf('{', start); i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
    }
    return '';
  };
  /** The declarations of `selector`'s rule inside `block`. */
  const rule = (block: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[}\\s])${escaped}\\s*{([^}]*)}`).exec(block)?.[1] ?? '';
  };
  const FIT = '(min-width: 940px) and (min-height: 600px)';
  const SHORT = '(min-width: 940px) and (min-height: 600px) and (max-height: 899px)';
  const SHORTER = '(min-width: 940px) and (min-height: 600px) and (max-height: 809px)';
  const SHORTEST = '(min-width: 940px) and (min-height: 600px) and (max-height: 719px)';

  it('starts at 940 px, so the 960 px itch.io frame gets two panels and a ten-cell bag', () => {
    expect(code).not.toMatch(/@media \(min-width: 1100px\)|@media \(max-width: 1099px\)/);
    expect(rule(media('(min-width: 940px)'), '.top')).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(rule(code, '.columns')).toMatch(/grid-template-areas:\s*'char bag';/);
    // No details column anywhere: the details are a card over the panels.
    expect(code).not.toMatch(/'side'|\.side\b/);
    const full = media('(min-width: 940px)', code.indexOf('.inventory .bag {'));
    expect(rule(full, '.inventory .bag')).toMatch(/repeat\(10,\s*minmax\(0,\s*46px\)\)/);
  });

  it('fits the character and a bag of ten 44 px cells into 940 px', () => {
    const columns = rule(code, '.columns');
    const [char, bagRem] = [
      /minmax\(([\d.]+)rem,\s*1fr\)/.exec(columns)?.[1],
      /minmax\(0,\s*([\d.]+)rem\)/.exec(columns)?.[1],
    ].map(Number) as [number, number];
    expect(rule(media('(min-width: 940px) and (max-width: 1099px)'), 'main')).toMatch(
      /padding:\s*0 0\.5rem/,
    );
    const MARGINS = 2 * 8; // main's 0.5rem each side
    const COLUMN_GAP = 8;
    const PANEL_CHROME = 2 * 0.6 * 16 + 2; // the panel's padding and border
    const THIN_SCROLLBAR = 13; // measured in Chromium
    const CELL_GAPS = 9 * 4;
    // The character keeps the paper doll's width beside the full bag.
    expect(char + bagRem).toBeLessThanOrEqual((940 - MARGINS - COLUMN_GAP) / 16);
    const cells = (bagRem * 16 - PANEL_CHROME - THIN_SCROLLBAR - CELL_GAPS) / 10;
    // The 32 px icon and its 2 px border fit with room to spare.
    expect(cells).toBeGreaterThanOrEqual(44);
  });

  it('keeps each Character tab on one line, the Stats dot beside its label', () => {
    const tab = rule(code, '.character > .tabs > .tab');
    expect(tab).toMatch(/white-space:\s*nowrap/);
    expect(tab).toMatch(/padding-inline:\s*0\.4rem/);
  });

  it('makes the page the window’s height, the panels taking the rest', () => {
    const fit = media(FIT);
    expect(rule(fit, 'main > .game')).toMatch(/flex:\s*1 1 0/);
    const columns = rule(fit, '.game > .columns');
    expect(columns).toMatch(/flex:\s*1 1 0/);
    expect(rule(fit, '.columns > .inventory')).toMatch(/overflow-y:\s*auto/);
    // A tall notice makes the page scroll rather than crush the panels.
    expect(rule(fit, 'main')).toMatch(/min-height:\s*100dvh/);
    expect(rule(fit, 'main')).not.toMatch(/(?:^|[^-])height:\s*100dvh/);
    expect(columns).toMatch(/min-height:\s*16rem/);
    expect(rule(fit, '.inventory .pager.single')).toMatch(/display:\s*none/);
    // Each bag tab scrolls inside itself, so the tall store never puts a
    // scrollbar on the bag.
    expect(rule(fit, '.columns > .inventory')).toMatch(
      /grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/,
    );
    expect(rule(fit, '.inventory > .tabpanel')).toMatch(/overflow-y:\s*auto/);
    // Room for the edge cells' focus rings inside the scroller.
    expect(rule(fit, '.inventory > .tabpanel')).toMatch(/padding:\s*5px/);
    expect(rule(fit, '.inventory > .tabpanel')).toMatch(/margin:\s*-5px/);
    expect(rule(media(SHORT), '.inventory')).toMatch(
      /grid-template-rows:\s*auto minmax\(0,\s*1fr\)/,
    );
  });

  it('compacts a short window without moving the name off its own row', () => {
    const short = media(SHORT);
    expect(rule(short, '.formula')).toMatch(/display:\s*none/);
    expect(rule(short, '.inventory > .tabs')).toMatch(/grid-area:\s*1 \/ 2/);
    // 810 to 899 px tall keeps the Full strip: names under a 3/4 stage.
    expect(short).not.toMatch(/zoom|\.fighter|\.strip/);
    const shorter = media(SHORTER);
    expect(rule(shorter, '.game .strip > .fighters')).toMatch(/grid-row:\s*3/);
    // The name keeps its own row over the HP bar (the base layout, HP inside).
    expect(shorter).not.toMatch(/grid-template-areas/);
    // Damage numbers rise over the names.
    expect(rule(shorter, '.game .strip .dmg')).toMatch(/z-index:\s*2/);
    expect(shorter).not.toMatch(/zoom/);
    // Only the itch.io frame's height rises the strip over the title bar's file
    // name and draws the stage at 0.7, with a slimmer header bar and fewer drop lines.
    const shortest = media(SHORTEST);
    expect(rule(shortest, '.game .top > .strip')).toMatch(/margin-top:\s*-2\.5rem/);
    // A notice shown above the strip (Overtime Cultivation and the like) keeps
    // the strip under it instead of the strip rising over it.
    expect(rule(shortest, '.game > .panel:not([hidden]) ~ .top > .strip')).toMatch(
      /margin-top:\s*0;/,
    );
    expect(rule(shortest, '.game .strip > .stage')).toMatch(/zoom:\s*0\.7;/);
    expect(rule(shortest, '.game .strip > .stage')).toMatch(/--z:\s*0\.7;/);
    expect(rule(shortest, '.beside > .log')).toMatch(/min-height:\s*2\.5rem/);
    // The header bar's compact padding must outrank its base rule, which comes
    // later in the file with `.game .strip .where`.
    expect(rule(code, '.game .strip .where')).toMatch(/padding:/);
    expect(rule(shorter, '.game .top > .strip > .where')).toMatch(/padding-block:\s*0\.1rem/);
    expect(rule(shortest, '.game .top > .strip > .where')).toMatch(/padding-block:\s*0;/);
    // Each fighter is its HP bar with the HP inside, then its qi bar; the
    // enemy's name has the whole line under them (the longest Tribulation name
    // fits at 940 px), so the stage shows.
    expect(rule(shortest, '.game .fighter')).toMatch(
      /grid-template-areas:\s*'bar'\s*'qi'\s*'name'/,
    );
    // A slimmer bar here, the HP text's line matching it.
    expect(rule(shortest, '.game .fighter .hp')).toMatch(/line-height:\s*12px/);
    expect(rule(shortest, '.game .fighter .bar')).toMatch(/height:\s*12px/);
    expect(rule(shortest, '.game .fighter .bar.qi')).toMatch(/height:\s*2px/);
    expect(rule(shortest, '.game .skills')).toMatch(/--skill-size:\s*16px/);
    expect(rule(shortest, '.game .strip > .xp')).toMatch(/height:\s*0\.9rem/);
    // The stamp keeps clear of the risen strip.
    expect(rule(shortest, '.titlebar .stamp')).toMatch(/margin-left:\s*0/);
    // The cultivator's skill icons sit beside its qi bar; its name (the Path)
    // moves to the XP bar, which shows it only here.
    expect(rule(shortest, '.game .fighter.you')).toMatch(
      /grid-template-areas:\s*'bar bar'\s*'qi skills'/,
    );
    expect(rule(shortest, '.game .fighter.you .name')).toMatch(/display:\s*none/);
    expect(code).toMatch(/^\.xp-path\s*{\s*display:\s*none;/m);
    expect(rule(shortest, '.game .strip .xp-path')).toMatch(/display:\s*inline/);
    expect(rule(shortest, '.game .fighter .name')).toMatch(/text-overflow:\s*ellipsis/);
    // The tier is a badge icon before the name; its label stays for screen readers.
    expect(rule(shortest, '.game .fighter .enemy-tier')).toMatch(/font-size:\s*0/);
    const badge = rule(shortest, '.game .fighter .enemy-tier::before');
    expect(badge).toMatch(/content:\s*''/);
    expect(badge).toMatch(/var\(--rank-art\)[^;]*\/\s*300% 100%/);
    expect(rule(shortest, '.game .fighter .enemy-tier--boss::before')).toMatch(/position-x:\s*50%/);
    expect(rule(shortest, '.game .fighter .enemy-tier--tribulation::before')).toMatch(
      /position-x:\s*100%/,
    );
    // The Tribulation alert takes the XP bar's row instead of adding one.
    const alert = rule(shortest, '.game .strip > .trial-call');
    expect(alert).toMatch(/grid-row:\s*4/);
    expect(alert).toMatch(/flex-wrap:\s*nowrap/);
    // Its row only wins over the under-810 px block's because it comes later.
    expect(code.indexOf(`@media ${SHORTEST} {`)).toBeGreaterThan(
      code.indexOf(`@media ${SHORTER} {`),
    );
  });

  it('keeps the item card’s action row still while the item scrolls under it', () => {
    expect(rule(code, '.game > .details')).toMatch(/position:\s*fixed/);
    expect(rule(code, '.game > .details')).toMatch(/overflow:\s*hidden/);
    expect(rule(code, '.game > .details[hidden]')).toMatch(/display:\s*none/);
    expect(rule(code, '.details > .detail-body')).toMatch(/min-height:\s*0/);
    expect(rule(code, '.details .detail-info')).toMatch(/overflow-y:\s*auto/);
    // Under a dragged item (the ghost is z-index 10).
    expect(Number(/z-index:\s*(\d+)/.exec(rule(code, '.game > .details'))?.[1])).toBeLessThan(10);
    // A label wraps only between words.
    expect(rule(code, '.details .row.actions button')).toMatch(/overflow-wrap:\s*normal/);
    // Side by side only when the card is wide enough; a sheet in a narrow window.
    expect(code).toMatch(/@container \(min-width: 26rem\)/);
    expect(rule(code, '.game > .details.sheet')).toMatch(/bottom:\s*0/);
  });

  it('sets the link code panel under the Path choice at its width', () => {
    const start = rule(code, '.path-start');
    expect(start).toMatch(/grid-template-columns:\s*fit-content\(40rem\)/);
    expect(start).toMatch(/justify-content:\s*center/);
    expect(code).not.toMatch(/\.choose\s*{[^}]*max-width/);
  });

  it('gives the chips and drops the whole row while the strip is popped out', () => {
    expect(rule(media('(min-width: 940px)'), '.top > .beside:only-child')).toMatch(
      /grid-column:\s*1 \/ -1/,
    );
  });

  it('keeps the Overtime chips a wrapping row, the grid only beside the strip', () => {
    expect(rule(code, '.kpis')).toMatch(/display:\s*flex/);
    expect(rule(code, '.kpis')).toMatch(/flex-wrap:\s*wrap/);
    // An inline-size container in a flex row (Overtime) shrinks to nothing:
    // the summary chips beside the strip are the only chip row that is one.
    expect(rule(code, '.kpis')).not.toMatch(/container-type/);
    const beside = rule(code, '.beside > .kpis');
    expect(beside).toMatch(/container-type:\s*inline-size/);
    expect(beside).toMatch(/grid-template-columns:\s*repeat\(2,/);
    // The icon-for-label rule is scoped the same way, so Overtime keeps its labels.
    for (const m of code.matchAll(/([^{}]+){[^{}]*}/g)) {
      for (const sel of (m[1] as string).split(',')) {
        // Only the base row is unscoped; every other chip-row rule is beside the strip.
        if (/\.kpis\b/.test(sel) && sel.trim() !== '.kpis') {
          expect(sel).toMatch(/\.beside > \.kpis/);
        }
      }
    }
  });

  it('leaves the status bar’s live line at its left', () => {
    expect(code).not.toMatch(/\.statusbar \.muted\s*{[^}]*margin-left:\s*auto/);
  });
});

describe('Realm list', () => {
  /** page.css without its comments. */
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** Every declaration of `selector`'s rules, wherever it stands alone in a selector list. */
  const all = (selector: string): string =>
    [...code.matchAll(/([^{}]+){([^{}]*)}/g)]
      .filter((m) => (m[1] as string).split(',').some((s) => s.trim() === selector))
      .map((m) => m[2] as string)
      .join('\n');

  it('stays inside the window at every width', () => {
    expect(all('.realm-list')).toMatch(/max-width:\s*min\(22rem,\s*calc\(100vw - 8px\)\)/);
  });

  it('sets each realm apart with a rule between it and the one above', () => {
    expect(all('.realm-list li + li')).toMatch(/border-top:\s*1px solid var\(--line\)/);
  });

  it('puts the title beside the name and the "You are here" tag beside the levels', () => {
    expect(all('.realm-list .head')).toMatch(/justify-content:\s*space-between/);
    expect(all('.realm-list .levels')).toMatch(/justify-content:\s*space-between/);
    expect(all('.realm-list .here')).toMatch(/color:\s*var\(--accent\)/);
  });

  it('highlights the current realm and dims the one before it by colour, not opacity', () => {
    expect(all('.realm-list li.current')).toMatch(/border-left-color:\s*var\(--accent\)/);
    expect(all('.realm-list li.past .name')).toMatch(/color:\s*var\(--muted\)/);
    expect(code).not.toMatch(/\.realm-list[^{]*{[^}]*opacity/);
  });

  it('keeps the "You are here" tag at 4.5:1 on the current row and the list', () => {
    const t = themes();
    for (const theme of [t.light, t.dark]) {
      for (const surface of ['--head', '--panel']) {
        const ratio = contrast(theme.get('--accent') as string, theme.get(surface) as string);
        expect(ratio, surface).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('hides the title tag for the realm with no job title', () => {
    expect(all('.realm-list .title:empty')).toMatch(/display:\s*none/);
  });
});
