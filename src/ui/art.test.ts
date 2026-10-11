import { describe, expect, it } from 'vitest';
import manifestText from '../../tools/art/manifest.json?raw';
import { renders } from '../../tools/art/render-weapons.mjs';
import { FAMILIES, GRADES } from '../../tools/art/weapons.mjs';
import { PATHS, type PathId } from '../core/cultivator.ts';
import { BOSSES, DEMONS, makeFloor, TRIBULATIONS, ZONES, type Enemy } from '../core/floors.ts';
import { SLOTS, type Item, type SlotId } from '../core/loot.ts';
import { createRng } from '../core/rng.ts';
import { newGame, type GameState } from '../core/sim.ts';
import { artUrl } from './art.ts';
import {
  enemySprite,
  ICON_COLUMNS,
  ICON_ROWS,
  iconCell,
  SPRITE_SIZE,
  stripEvents,
  SUMMARY_ICONS,
} from './view.ts';

/** Every shipped art file as a base64 data URL, to weigh them. */
const INLINE = import.meta.glob<string>('../assets/art/*.png', {
  eager: true,
  query: '?inline',
  import: 'default',
});
const exists = (name: string) => artUrl(name) !== '';
const manifest = JSON.parse(manifestText) as {
  icons: {
    id: SlotId;
    family?: string;
    materials?: string[];
    files?: string[];
    sources?: string[];
    renders?: string[];
    source?: string;
  }[];
  summary: { id: string; source: string }[];
  icon_size: number;
  icon_scale: number;
  sprites: { id: string; size?: number; base?: string }[];
};

describe('shipped art', () => {
  it('has a sheet for every Path, demon, elite, boss and Tribulation, and a background per zone', () => {
    const sheets = [
      ...(Object.keys(PATHS) as PathId[]).map((p) => `path-${p}`),
      ...DEMONS.flatMap((d) => [enemySprite('demon', d), enemySprite('elite', `Elite ${d}`)]),
      ...BOSSES.map((b) => enemySprite('boss', b)),
      ...TRIBULATIONS.map((b) => enemySprite('tribulation', b)),
      ...ZONES.map((z) => `bg-${z.id}`),
      'icons',
      'paperdoll',
      'summary',
    ];
    for (const name of sheets) expect(exists(name), name).toBe(true);
  });

  it('builds each sheet at the frame size the strip draws it at', () => {
    for (const s of manifest.sprites) {
      const kind = s.id.split('-')[0] as keyof typeof SPRITE_SIZE;
      const size = s.size ?? manifest.sprites.find((b) => b.id === s.base)?.size;
      expect(size, s.id).toBe(SPRITE_SIZE[kind]);
    }
  });

  it('stays under 1 MB in total', () => {
    const files = Object.values(INLINE);
    expect(files.length).toBeGreaterThan(20);
    const bytes = files.reduce((sum, url) => sum + (url.length - url.indexOf(',') - 1) * 0.75, 0);
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});

describe('enemySprite', () => {
  it('names sheets after the enemy, elites after their demon', () => {
    expect(enemySprite('demon', 'Reply-All Swarm')).toBe('demon-reply-all-swarm');
    expect(enemySprite('elite', 'Elite Inbox Hydra')).toBe('elite-inbox-hydra');
    expect(enemySprite('boss', 'The Auditor')).toBe('boss-the-auditor');
  });

  it('finds art for every enemy a floor can make', () => {
    for (let floor = 1; floor <= 5; floor++) {
      for (const e of makeFloor(createRng(floor), floor)) {
        expect(exists(enemySprite(e.kind, e.name)), e.name).toBe(true);
      }
    }
  });

  it('has no art for a name it does not know (shown as nothing, never a broken URL)', () => {
    expect(artUrl(enemySprite('boss', 'Nobody'))).toBe('');
  });

  it.each([
    ['a quote breaking out of url()', 'x") ; background:url(//evil'],
    ['a path climbing out of the art folder', '../../index'],
    ['an object key', '__proto__'],
    ['bidi and zero-width characters', 'The\u202e Audi\u200btor'],
    ['an oversized name', 'A'.repeat(100_000)],
  ])('finds no art for %s', (_, name) => {
    for (const kind of ['demon', 'elite', 'boss', 'tribulation'] as const) {
      expect(artUrl(enemySprite(kind, name))).toBe('');
    }
  });

  it('keeps an odd name from a save to a plain, harmless file name', () => {
    expect(enemySprite('demon', '"); background:url(x) <b>')).toMatch(/^demon-[a-z0-9-]*$/);
  });
});

describe('summary icons', () => {
  it('uses the atlas columns in the manifest order', () => {
    expect(manifest.summary.map((s) => s.id)).toEqual(SUMMARY_ICONS);
  });

  it('is one row of item icon cells, one per icon', () => {
    const png = atob((INLINE['../assets/art/summary.png'] ?? '').split(',')[1] ?? '');
    const u32 = (at: number) => [0, 1, 2, 3].reduce((n, i) => n * 256 + png.charCodeAt(at + i), 0);
    const cell = manifest.icon_size * manifest.icon_scale;
    expect([u32(16), u32(20)]).toEqual([cell * SUMMARY_ICONS.length, cell]);
  });
});

describe('iconCell', () => {
  it('uses the atlas columns in the manifest order', () => {
    expect(manifest.icons.map((i) => i.id)).toEqual(ICON_COLUMNS);
  });

  it('gives every item name its own icon, one atlas row per name', () => {
    const cells = new Set<string>();
    for (const slot of ICON_COLUMNS) {
      const entry = manifest.icons.find((i) => i.id === slot);
      expect(entry?.sources ?? entry?.renders).toHaveLength(SLOTS[slot].names.length);
      for (const name of SLOTS[slot].names) {
        const { col, row } = iconCell({ slot, name } as Item);
        cells.add(`${col},${row}`);
      }
    }
    expect(cells.size).toBe(ICON_COLUMNS.reduce((n, s) => n + SLOTS[s].names.length, 0));
  });

  it('sizes the atlas the way the page draws it: one cell per column and row', () => {
    const png = atob((INLINE['../assets/art/icons.png'] ?? '').split(',')[1] ?? '');
    // The PNG header stores width and height as big-endian 32-bit numbers at bytes 16 and 20.
    const u32 = (at: number) => [0, 1, 2, 3].reduce((n, i) => n * 256 + png.charCodeAt(at + i), 0);
    const cell = manifest.icon_size * manifest.icon_scale;
    expect(cell).toBe(64);
    expect([u32(16), u32(20)]).toEqual([cell * ICON_COLUMNS.length, cell * ICON_ROWS]);
    // The weapon column has the most names: 6 families in each of 5 grades.
    expect(ICON_ROWS).toBe(30);
    expect(ICON_ROWS).toBe(SLOTS.weapon.names.length);
  });

  it('draws weapons from our own SVG renders, with no pack art left', () => {
    const weapon = manifest.icons.find((i) => i.id === 'weapon');
    expect(weapon?.renders).toHaveLength(30);
    expect(weapon?.files).toBeUndefined();
    expect(weapon?.source).toBeUndefined();
    expect(manifest.icons.some((i) => i.files)).toBe(false);
  });

  it('draws every other type from one source-style generation per name, in name order', () => {
    const grades = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'];
    // Each family's file prefix, in the order loot.ts lists the families.
    const families: Record<string, string[]> = {
      accessory: ['accessory', 'accessory-bell', 'accessory-mirror'],
      sideArm: ['sideArm', 'sideArm-rope', 'sideArm-banner'],
      attachment: ['attachment', 'attachment-disc'],
      charm: ['charm', 'charm-defend', 'charm-utility', 'charm-jade'],
    };
    for (const entry of manifest.icons) {
      if (entry.id === 'weapon') continue;
      const prefixes = families[entry.id] ?? [entry.id];
      expect(entry.sources, entry.id).toEqual(
        grades.flatMap((g) => prefixes.map((f) => `items/${f}-${g}.jpg`)),
      );
      expect(SLOTS[entry.id].names, entry.id).toHaveLength(grades.length * prefixes.length);
    }
    // 30 weapons, 20 charms, 15 accessories, 15 hidden weapons, 10 attachments and 5 of each of the other three types.
    const icons = manifest.icons.reduce((n, i) => n + (i.sources ?? i.renders ?? []).length, 0);
    expect(icons).toBe(30 + 20 + 15 + 15 + 10 + 5 * 3);
    // No recoloured pixel-pack icon is left in the atlas.
    expect(manifest.icons.some((i) => i.materials ?? i.family)).toBe(false);
  });

  it('puts each Accessory and Hidden Weapon family name in its own row', () => {
    const at = (slot: 'accessory' | 'sideArm', name: string) => iconCell({ slot, name } as Item);
    const acc = ICON_COLUMNS.indexOf('accessory');
    const side = ICON_COLUMNS.indexOf('sideArm');
    expect(at('accessory', 'Bone Bead Pendant')).toEqual({ col: acc, row: 0 });
    expect(at('accessory', 'Bronze Clapper Bell')).toEqual({ col: acc, row: 1 });
    expect(at('accessory', 'Bronze Hand Mirror')).toEqual({ col: acc, row: 2 });
    expect(at('accessory', 'Phoenix Flame Mirror')).toEqual({ col: acc, row: 14 });
    expect(at('sideArm', 'Iron Throwing Darts')).toEqual({ col: side, row: 0 });
    expect(at('sideArm', 'Hempen Binding Cord')).toEqual({ col: side, row: 1 });
    expect(at('sideArm', 'Hempen Soul Banner')).toEqual({ col: side, row: 2 });
    expect(at('sideArm', 'Phoenix Flame Binding Rope')).toEqual({ col: side, row: 13 });
    expect(at('sideArm', 'Ten-Thousand Souls Banner')).toEqual({ col: side, row: 14 });
  });

  it('puts each Charm line name in its own row, old Charms on every fourth row', () => {
    const col = ICON_COLUMNS.indexOf('charm');
    const at = (name: string) => iconCell({ slot: 'charm', name } as Item);
    expect(at('Paper Ward Talisman')).toEqual({ col, row: 0 });
    expect(at('Paper Body-Guard Talisman')).toEqual({ col, row: 1 });
    expect(at('Paper Fortune Talisman')).toEqual({ col, row: 2 });
    expect(at('Cloudy Jade Slip')).toEqual({ col, row: 3 });
    expect(at('Azure Thunder Talisman')).toEqual({ col, row: 4 });
    expect(at('Phoenix Flame Talisman')).toEqual({ col, row: 16 });
    expect(at('Phoenix Blood Jade')).toEqual({ col, row: 19 });
  });

  it('puts each Hidden Weapon name in its own row of the side arm column', () => {
    const col = ICON_COLUMNS.indexOf('sideArm');
    SLOTS.sideArm.names.forEach((name, row) =>
      expect(iconCell({ slot: 'sideArm', name } as Item), name).toEqual({ col, row }),
    );
    expect(iconCell({ slot: 'sideArm', name: 'Phoenix Flame Darts' } as Item)).toEqual({
      col,
      row: 12,
    });
  });

  it('lists the weapon renders in the row order of the weapon names', () => {
    const family = (name: string) =>
      name.endsWith('Flying Sword')
        ? 'flying'
        : name.endsWith('Whisk')
          ? 'whisk'
          : name.endsWith('Peachwood Sword')
            ? 'peach'
            : name.endsWith('Fan')
              ? 'fan'
              : name.endsWith('Seal')
                ? 'seal'
                : 'pestle';
    const grades = ['mortal', 'spirit', 'earth', 'heaven', 'immortal'];
    const renders = manifest.icons.find((i) => i.id === 'weapon')?.renders;
    expect(renders).toEqual(
      SLOTS.weapon.names.map((n, i) => `weapons/${grades[Math.floor(i / 6)]}-${family(n)}.png`),
    );
  });

  it('draws the weapon names loot.ts rolls, in its order', () => {
    expect(GRADES.flatMap((_, g) => FAMILIES.map((f) => f.names[g]))).toEqual(SLOTS.weapon.names);
  });

  it('renders the weapon icons to the files the manifest lists, in row order', () => {
    const list = renders();
    expect(list.map((r) => r.name)).toEqual(SLOTS.weapon.names);
    expect(list.map((r) => r.file)).toEqual(manifest.icons.find((i) => i.id === 'weapon')?.renders);
  });

  it('puts each weapon name in its grade and family cell', () => {
    // Rows run grade by grade, families in the order loot.ts lists them.
    expect(iconCell({ slot: 'weapon', name: 'Iron Flying Sword' } as Item)).toEqual({
      col: 4,
      row: 0,
    });
    expect(iconCell({ slot: 'weapon', name: 'Stone Mountain Seal' } as Item)).toEqual({
      col: 4,
      row: 4,
    });
    expect(iconCell({ slot: 'weapon', name: 'Iron Vajra Pestle' } as Item)).toEqual({
      col: 4,
      row: 5,
    });
    expect(iconCell({ slot: 'weapon', name: 'Azure Cloud Flying Sword' } as Item)).toEqual({
      col: 4,
      row: 6,
    });
    expect(iconCell({ slot: 'weapon', name: 'Heaven-Crushing Seal' } as Item)).toEqual({
      col: 4,
      row: 28,
    });
    expect(iconCell({ slot: 'weapon', name: 'Phoenix Flame Vajra Pestle' } as Item)).toEqual({
      col: 4,
      row: 29,
    });
  });

  it('falls back to the first material for a name it does not know', () => {
    expect(iconCell({ slot: 'weapon', name: 'Mystery' } as Item)).toEqual({ col: 4, row: 0 });
    expect(iconCell({ slot: 'weapon', name: '__proto__' } as Item)).toEqual({ col: 4, row: 0 });
  });

  it('stays inside the atlas for a type it does not know', () => {
    const cell = iconCell({ slot: 'cape' as SlotId, name: 'x' } as Item);
    expect(cell).toEqual({ col: 0, row: 0 });
  });
});

describe('stripEvents', () => {
  const base = (): GameState => newGame(7, 'sword');
  const front = (s: GameState): Enemy => s.enemies[0] as Enemy;

  it('sees an attack and a hit when the cultivator lands a blow', () => {
    const prev = base();
    const next = structuredClone(prev);
    next.cultivator.nextAttackAt += 1;
    front(next).hp -= 3;
    expect(stripEvents(prev, next)).toMatchObject({
      youAttack: true,
      foeHit: true,
      foeAttack: false,
      youHit: false,
      foeDied: null,
    });
  });

  it('sees the enemy attack and the cultivator hit', () => {
    const prev = base();
    const next = structuredClone(prev);
    next.enemyNextAttackAt += 2;
    next.cultivator.hp -= 4;
    expect(stripEvents(prev, next)).toMatchObject({ foeAttack: true, youHit: true });
  });

  it('reports which enemy died, not the next one, and no foe attack from the timer reset', () => {
    const prev = base();
    const next = structuredClone(prev);
    const dead = next.enemies.shift() as Enemy;
    next.kills += 1;
    next.cultivator.nextAttackAt += 1;
    next.enemyNextAttackAt += 2;
    const e = stripEvents(prev, next);
    expect(e.foeDied).toEqual({ kind: dead.kind, name: dead.name });
    expect(e.foeAttack).toBe(false);
    expect(e.foeHit).toBe(false);
  });

  it('on a death reports only the death, not the attacks the restart looks like', () => {
    const prev = base();
    const next = structuredClone(prev);
    next.deaths += 1;
    next.cultivator.nextAttackAt += 5;
    next.enemyNextAttackAt += 5;
    expect(stripEvents(prev, next)).toEqual({
      youAttack: false,
      foeAttack: false,
      youHit: false,
      foeHit: false,
      youDied: true,
      foeDied: null,
    });
  });

  it('sees nothing when nothing happened', () => {
    const prev = base();
    expect(Object.values(stripEvents(prev, structuredClone(prev))).some(Boolean)).toBe(false);
  });
});
