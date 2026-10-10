// The page: a saved run (after its Overtime Cultivation catch-up) or the
// first-run Path choice, then the combat strip with its XP bar, the summary
// chips and recent drops beside it, character panel, inventory grid with its
// auto filter and item details
// (docs/design.md §5–§8, §10, §14). Text reaches the page only through
// textContent. The sim decides everything; this file only shows state, passes
// the player's choices (equip, sell, salvage, filter, spending) back in and
// saves.

import { derive, PATHS, type PathId, type StatId } from '../core/cultivator.ts';
import {
  BAG_ROW,
  bagCost,
  buyBagSpace,
  canResetStats,
  changePath,
  essenceValue,
  GRADE_IDS,
  pathChangeCost,
  resetStats,
  salvage,
  sell,
  sellBelow,
  sellBelowPreview,
  sellPrice,
  setFilter,
  // Item types, not the equipment positions this file calls SLOT_IDS.
  SLOT_IDS as ITEM_TYPES,
  spendPoints,
  statResetCost,
  type FilterAction,
} from '../core/economy.ts';
import {
  defaultSlot,
  EQUIP_SLOTS,
  GRADES,
  quality,
  SLOTS,
  slotsFor,
  type EquipSlotId,
  type GradeId,
  type Item,
  type SlotId,
} from '../core/loot.ts';
import { zoneOf } from '../core/floors.ts';
import { catchUp, offlineSeconds, type OvertimeSummary } from '../core/offline.ts';
import {
  buyPassive,
  canRetire,
  PASSIVE_IDS,
  retirePreview,
  type PassiveId,
} from '../core/prestige.ts';
import {
  canFaceTribulation,
  equip,
  faceTribulation,
  newGame,
  retire,
  tick,
  type GameState,
} from '../core/sim.ts';
import {
  browserStorage,
  clearSave,
  loadSave,
  SAVE_KEY,
  writeSave,
  type SaveStorage,
} from '../storage/save.ts';
import {
  dropToast,
  faviconHref,
  gameTitle,
  immortalNotice,
  miniStatus,
  noteUnseen,
  NOTHING_UNSEEN,
  tabTitle,
  tribulationNotice,
  type Unseen,
} from './hud.ts';
import { artUrl } from './art.ts';
import {
  enemyName,
  lang,
  PACKS,
  readLang,
  setLang,
  t,
  tn,
  writeLang,
  type MessageKey,
} from './i18n.ts';
import { autosave, runs } from './run.ts';
import { pickTheme, readTheme, showTheme, type Theme, writeTheme } from './theme.ts';
import {
  BAG_SORT_DIRS,
  BAG_SORT_NAMES,
  BAG_SORTS,
  bagOrder,
  type BagSort,
  pickBagSort,
  readBagReverse,
  readBagSort,
  writeBagReverse,
  writeBagSort,
} from './sort.ts';
import { advance, request, type Action, type Playing } from './sprite.ts';
import { canPopOut, notifier, popOut, setFavicon } from './tab.ts';
import {
  arraySetUp,
  BAG_PAGE,
  bagPage,
  cellLabel,
  charmLineName,
  favouredBy,
  compareToEquipped,
  equipBlock,
  freshDrops,
  gridMove,
  itemLines,
  itemTag,
  overtimeLines,
  pageOf,
  passiveRow,
  pathBlurb,
  soulsLine,
  enemySprite,
  ICON_COLUMNS,
  ICON_ROWS,
  iconCell,
  realmLabel,
  retireLabel,
  SUMMARY_ICONS,
  summaryIcon,
  retireLines,
  sellBelowLabel,
  SPRITE_SIZE,
  respecView,
  STAT_GROUPS,
  statRows,
  type StatGroup,
  stripEvents,
  treasureTier,
  tribulationBanner,
  tribulationCall,
  tribulationFellDue,
  waveLabel,
  xpBar,
} from './view.ts';

const TICK_MS = 200;
const SAVE_MS = 10_000;
/** How often the strip's sprites move to their next frame. */
const FRAME_TICK_MS = 50;
/** Damage numbers on the stage at once, and how long each shows. */
const MAX_DAMAGE_NUMBERS = 6;
const DAMAGE_NUMBER_MS = 900;
/** Item icon frame in the atlas, in px. */
const ICON_PX = 32;
/** Shorter times away (a reload, a quick tab switch) get no summary. */
const SUMMARY_MIN_SECONDS = 60;
const RECENT_DROPS = 8;
/** How long the live regions stay quiet after a language switch rewrites them. */
const LIVE_QUIET_MS = 500;
/** The favicon's drop dot blinks at most this often, well under any flashing threshold. */
const BLINK_MS = 900;
/** How long a Tribulation banner stays over the stage. */
const TRIAL_BANNER_MS = 2400;
/** How long an array's set-up shows: the pause before the fight (sim ENEMY_ARRIVAL). */
const ARRAY_SETUP_MS = 1200;
/** How far the mouse must move with the button down before a press becomes a drag. */
const DRAG_START_PX = 5;
const SLOT_IDS = Object.keys(EQUIP_SLOTS) as EquipSlotId[];
/** The Help tab of the main menu: how the game plays, in short. */
const HELP_LINES: readonly MessageKey[] = [
  'help.1',
  'help.2',
  'help.3',
  'help.4',
  'help.5',
  'help.6',
  'help.7',
  'help.8',
];
const STAT_IDS: readonly StatId[] = ['body', 'agility', 'spirit'];

type Tag = keyof HTMLElementTagNameMap;

function el<K extends Tag>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Every fixed text on the page, as a function that puts it there in the current
 * language: run once now, and again on a language switch, so the page changes
 * in place (no reload, focus and the pop-out kept). A new page starts a new list.
 */
let labels: (() => void)[] = [];

function say(fn: () => void): void {
  fn();
  labels.push(fn);
}

/** An element whose text is message `key`, kept in the current language. */
function elt<K extends Tag>(tag: K, className: string, key: MessageKey): HTMLElementTagNameMap[K] {
  const node = el(tag, className);
  say(() => (node.textContent = t(key)));
  return node;
}

/** Keeps attribute `name` of `node` as message `key` in the current language. */
function attr(node: HTMLElement, name: string, key: MessageKey): void {
  say(() => node.setAttribute(name, t(key)));
}

function button(text: string, className = '', onClick?: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  // Off buttons are aria-disabled, not disabled, so one that turns off under the
  // player's focus (a purchase they can no longer afford) keeps that focus.
  if (onClick) {
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') !== 'true') onClick();
    });
  }
  return b;
}

/** A button whose text is message `key`, kept in the current language. */
function buttonT(key: MessageKey, className = '', onClick?: () => void): HTMLButtonElement {
  const b = button('', className, onClick);
  say(() => (b.textContent = t(key)));
  return b;
}

/** A labelled <select> of `options` ([value, text] pairs, the text worked out in the current language). */
function choice(
  label: MessageKey,
  options: readonly (readonly [string, () => string])[],
): { box: HTMLLabelElement; select: HTMLSelectElement } {
  const box = el('label', 'field');
  const caption = document.createTextNode('');
  say(() => (caption.data = t(label)));
  const select = el('select');
  for (const [value, text] of options) {
    const o = el('option');
    say(() => (o.textContent = text()));
    o.value = value;
    select.append(o);
  }
  box.append(caption, select);
  return { box, select };
}

/** Sets text and on/off only when they change, so a redraw every tick never flickers. */
function setButton(b: HTMLButtonElement, text: string, off: boolean): void {
  if (b.textContent !== text) b.textContent = text;
  if (b.getAttribute('aria-disabled') !== String(off)) b.setAttribute('aria-disabled', String(off));
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** The Dao Insight mark; decorative, the words beside it carry the meaning. */
function gem(): HTMLElement {
  const g = el('span', 'gem', '◆');
  g.setAttribute('aria-hidden', 'true');
  return g;
}

/** A seed for a new run. Runs replay from it; it need not be secret. */
function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

/** The one run playing; starting or loading another stops its timers and listeners first. */
const run = runs();

/** Loads the saved run and replays the time away, or offers a new run when there is none. */
export function start(root: HTMLElement, storage: SaveStorage | null = browserStorage()): void {
  run.stop();
  labels = [];
  showTheme([document.documentElement], pickedTheme ?? readTheme(storage), osDark.matches);
  setLang(pickedLang ?? readLang(storage, navigator.languages ?? []));
  document.documentElement.lang = lang().code;
  const saved = storage && loadSave(storage);
  if (saved) {
    const { state, summary } = catchUp(saved.state, offlineSeconds(saved.savedAt, Date.now()));
    // play() stamps the save straight away, so a crash can't replay this time twice.
    play(root, state, storage, summary);
    return;
  }
  document.title = gameTitle();
  // No run, no HP ring: the browser's default icon.
  document.querySelector('link[rel="icon"]')?.remove();
  const bar = titleBar(storage, () => {
    // Nothing to keep before a run starts: the choice is drawn again in the new language.
    start(root, storage);
    root.querySelector<HTMLButtonElement>('.lang > button')?.focus();
  });
  root.replaceChildren(
    bar,
    pathChoice((path) => play(root, newGame(newSeed(), path), storage, null)),
  );
  root.querySelector<HTMLButtonElement>('.paths button')?.focus();
}

/** The title bar; its language switch calls `relabel` once the language has changed. */
function titleBar(storage: SaveStorage | null, relabel: () => void): HTMLElement {
  const bar = el('header', 'titlebar');
  // A generic sheet glyph, drawn in CSS: no real product's logo.
  const glyph = el('span', 'glyph');
  glyph.setAttribute('aria-hidden', 'true');
  // The game's name as a red rubber stamp; CSS sets the capitals, so screen readers say the words.
  const tools = el('div', 'tools');
  tools.append(langSwitch(storage, relabel));
  bar.append(glyph, elt('h1', 'file', 'game.file'), elt('span', 'stamp', 'game.title'), tools);
  return bar;
}

/** A globe, drawn as SVG nodes (never markup); decorative, the code beside it is the text. */
function globe(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'globe');
  for (const d of [
    'M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13',
    'M1.5 8h13',
    'M8 1.5c-3.5 3.5-3.5 9.5 0 13',
    'M8 1.5c3.5 3.5 3.5 9.5 0 13',
  ]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * The language switch beside Menu: a globe and the language's code, opening a
 * short list of the packs. Mouse, touch and keyboard (arrows, Home / End,
 * Enter / Space, Escape) all work. Picking one saves it and calls `relabel`.
 */
function langSwitch(storage: SaveStorage | null, relabel: () => void): HTMLElement {
  const box = el('div', 'lang');
  const code = el('span');
  const open = el('button');
  open.type = 'button';
  open.setAttribute('aria-haspopup', 'menu');
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', 'lang-list');
  open.append(globe(), code);
  say(() => {
    code.textContent = lang().short;
    open.setAttribute('aria-label', t('lang.button'));
  });
  const list = el('ul', 'lang-list');
  list.id = 'lang-list';
  list.setAttribute('role', 'menu');
  say(() => list.setAttribute('aria-label', t('lang.button')));
  // The title bar clips what spills past it (its edge-to-edge shadow), so the
  // list opens in the top layer as a popover, placed under the button.
  list.popover = 'manual';
  let isOpen = false;
  const items = PACKS.map((pack) => {
    const item = el('li', '', pack.label);
    item.setAttribute('role', 'menuitemradio');
    // Each name in its own language, so a screen reader says it right.
    item.lang = pack.code;
    item.tabIndex = -1;
    item.addEventListener('click', () => pick(pack.code));
    list.append(item);
    return item;
  });
  const outside = (e: PointerEvent): void => {
    if (!box.contains(e.target as Node)) close(false);
  };
  // The list is placed once, where it opened: a resize or scroll closes it.
  const moved = (): void => close(false);
  function show(): void {
    const at = Math.max(0, PACKS.indexOf(lang()));
    items.forEach((item, i) => item.setAttribute('aria-checked', String(i === at)));
    isOpen = true;
    list.showPopover();
    const r = open.getBoundingClientRect();
    list.style.top = `${r.bottom + 2}px`;
    list.style.left = `${Math.max(4, r.right - list.offsetWidth)}px`;
    open.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', moved);
    items[at]?.focus({ preventScroll: true });
  }
  function close(refocus: boolean): void {
    if (!isOpen) return;
    isOpen = false;
    list.hidePopover();
    open.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    window.removeEventListener('resize', moved);
    window.removeEventListener('scroll', moved);
    if (refocus) open.focus();
  }
  function pick(next: string): void {
    close(true);
    if (next === lang().code) return;
    pickedLang = next;
    setLang(next);
    // Blocked storage still changes it for this visit.
    writeLang(storage, next);
    document.documentElement.lang = lang().code;
    relabel();
  }
  open.addEventListener('click', () => (isOpen ? close(true) : show()));
  open.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    show();
  });
  list.addEventListener('keydown', (e) => {
    const at = items.indexOf(document.activeElement as HTMLLIElement);
    const to: Record<string, number> = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (at - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const pack = PACKS[at];
      if (pack) pick(pack.code);
      // Back on the button first, so Tab moves on from there in every browser.
    } else if (e.key === 'Tab') close(true);
    else if (to[e.key] !== undefined) {
      e.preventDefault();
      items[to[e.key] as number]?.focus({ preventScroll: true });
    }
  });
  box.append(open, list);
  return box;
}

/** The office shell's set dressing: a formula bar. */
function formulaBar(): HTMLElement {
  const bar = el('div', 'formula');
  bar.setAttribute('aria-hidden', 'true');
  bar.append(el('span', 'ref', 'A1'), el('span', 'fx', 'fx'), elt('span', 'expr', 'game.formula'));
  return bar;
}

/** The status bar under the sheet: ready state, the one sheet tab, autosave. */
function statusBar(): HTMLElement {
  const bar = el('footer', 'statusbar');
  bar.append(
    elt('span', '', 'status.ready'),
    elt('span', 'sheet-tab', 'status.sheet'),
    elt('span', 'muted', 'status.autosave'),
  );
  return bar;
}

function pathChoice(onPick: (path: PathId) => void): HTMLElement {
  const box = el('section', 'panel choose');
  box.setAttribute('aria-labelledby', 'choose-title');
  const h = elt('h2', '', 'choose.title');
  h.id = 'choose-title';
  const list = el('div', 'paths');
  for (const id of Object.keys(PATHS) as PathId[]) {
    const b = el('button');
    b.type = 'button';
    b.append(el('strong', '', tn('path', PATHS[id].name)), el('span', 'muted', pathBlurb(id)));
    b.addEventListener('click', () => onPick(id));
    list.append(b);
  }
  box.append(h, elt('p', 'muted', 'choose.intro'), list);
  return box;
}

/** A sprite on the stage: a frame of a sheet (tools/art/build.py). */
interface StageSprite {
  sprite: HTMLElement;
  /** The sheet shown, its frame size, what it is playing and the frame last drawn. */
  sheet: string;
  size: number;
  playing: Playing;
  drawn: string;
}

function stageSprite(className: string): StageSprite {
  const sprite = el('div', `sprite ${className}`);
  sprite.setAttribute('aria-hidden', 'true');
  return { sprite, sheet: '', size: 0, playing: { action: 'idle', start: 0 }, drawn: '' };
}

interface Fighter extends StageSprite {
  /** Name, HP bar and HP text, under the stage. */
  box: HTMLElement;
  name: HTMLElement;
  bar: HTMLElement;
  hp: HTMLElement;
}

function fighter(side: 'you' | 'foe'): Fighter {
  const box = el('div', `fighter ${side}`);
  const name = el('div', 'name');
  const track = el('div', 'bar');
  track.setAttribute('aria-hidden', 'true');
  const bar = el('span');
  track.append(bar);
  const hp = el('div', 'hp');
  box.append(name, track, hp);
  return { box, name, bar, hp, ...stageSprite(side) };
}

/** A CSS url() for art, or none when there is no such file (never url(""), which loads the page). */
function cssUrl(url: string): string {
  return url ? `url("${url}")` : '';
}

/** Puts sheet `name` (frames `size` px square) on a fighter's sprite, if it changed. */
function useSheet(f: StageSprite, name: string, size: number): void {
  if (f.sheet === name) return;
  f.sheet = name;
  f.size = size;
  const s = f.sprite.style;
  s.width = s.height = `${size}px`;
  s.backgroundImage = cssUrl(artUrl(name));
  s.backgroundSize = `${size * 4}px ${size * 4}px`;
}

/** An item's icon from the atlas. */
function setIcon(icon: HTMLElement, item: Item | undefined): void {
  if (!item) {
    icon.style.backgroundImage = '';
    return;
  }
  const { col, row } = iconCell(item);
  const px = ICON_PX;
  const s = icon.style;
  s.backgroundImage = cssUrl(artUrl('icons'));
  s.backgroundSize = `${px * ICON_COLUMNS.length}px ${px * ICON_ROWS}px`;
  s.backgroundPosition = `${-col * px}px ${-row * px}px`;
}

/** Shows column `col` of the summary atlas on `icon`; sized in em, so it follows the chip's text. */
function setSummaryIcon(icon: HTMLElement, col: number): void {
  const s = icon.style;
  s.backgroundImage = cssUrl(artUrl('summary'));
  s.backgroundSize = `${SUMMARY_ICONS.length * 100}% 100%`;
  s.backgroundPosition = `${(col / (SUMMARY_ICONS.length - 1)) * 100}% 0`;
}

/** A summary chip: an optional decorative icon, the label, then the value. */
function kpi(
  label: MessageKey,
  iconCol?: number,
): { box: HTMLElement; icon: HTMLElement | null; value: HTMLElement } {
  const box = el('div', 'kpi');
  let icon: HTMLElement | null = null;
  if (iconCol !== undefined) {
    icon = el('span', 'kpi-icon');
    icon.setAttribute('aria-hidden', 'true');
    setSummaryIcon(icon, iconCol);
    box.append(icon);
  }
  const value = el('span', 'value');
  box.append(elt('span', 'label', label), value);
  return { box, icon, value };
}

function panel(className: string, title: MessageKey): { box: HTMLElement; heading: HTMLElement } {
  const box = el('section', `panel ${className}`);
  const heading = elt('h2', '', title);
  heading.tabIndex = -1;
  box.append(heading);
  return { box, heading };
}

/** A grid cell: grade initial, slot code and quality; the grade colour is its border. */
function cell(): HTMLButtonElement {
  const b = el('button', 'cell');
  b.type = 'button';
  const icon = el('span', 'icon');
  icon.setAttribute('aria-hidden', 'true');
  b.append(el('span', 'grade'), icon, el('span', 'q'));
  return b;
}

/** Shows `item` in a cell, or an empty cell with `emptyText` as its name. */
function fillCell(b: HTMLButtonElement, item: Item | undefined, emptyText: string): void {
  const [grade, icon, q] = b.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
  b.className = item ? `cell grade-${item.grade}` : 'cell empty';
  grade.textContent = item ? t(`grade.initial.${item.grade}`) : '';
  setIcon(icon, item);
  q.textContent = item ? `${quality(item)}%` : '';
  b.setAttribute('aria-label', item ? cellLabel(item) : emptyText);
}

/**
 * Tabs inside a panel: one tab stop, arrow keys (and Home / End) switch, only the chosen body
 * shows. The first tab starts selected.
 */
function tabs(list: { id: string; label: MessageKey; body: HTMLElement }[]): {
  bar: HTMLElement;
  panels: HTMLElement[];
  show: (id: string) => void;
} {
  const bar = el('div', 'tabs');
  bar.setAttribute('role', 'tablist');
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const show = (id: string): void => {
    list.forEach((tab, i) => {
      const on = tab.id === id;
      buttons[i]?.setAttribute('aria-selected', String(on));
      if (buttons[i]) buttons[i].tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    });
  };
  list.forEach((tab, i) => {
    const b = elt('button', 'tab', tab.label);
    b.type = 'button';
    b.id = `tab-${tab.id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `tabpanel-${tab.id}`);
    b.addEventListener('click', () => show(tab.id));
    b.addEventListener('keydown', (e) => {
      const to: Record<string, number> = {
        ArrowRight: (i + 1) % list.length,
        ArrowLeft: (i - 1 + list.length) % list.length,
        Home: 0,
        End: list.length - 1,
      };
      const j = to[e.key];
      if (j === undefined) return;
      e.preventDefault();
      const next = list[j] as (typeof list)[number];
      show(next.id);
      buttons[list.indexOf(next)]?.focus();
    });
    const panel = el('div', 'tabpanel');
    panel.id = `tabpanel-${tab.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', b.id);
    panel.append(tab.body);
    buttons.push(b);
    panels.push(panel);
    bar.append(b);
  });
  show(list[0]?.id ?? '');
  return { bar, panels, show };
}

/** The figure behind the equipment slots: pixel art at 4x, slots placed over it in %. */
function figure(): HTMLImageElement {
  const img = el('img', 'figure');
  img.src = artUrl('paperdoll');
  img.alt = '';
  img.width = 256;
  img.height = 320;
  return img;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const osDark = matchMedia('(prefers-color-scheme: dark)');
/** The theme picked this visit: kept across runs even where storage is blocked. */
let pickedTheme: Theme | null = null;
/** The bag sort picked this visit: kept across runs even where storage is blocked. */
let pickedSort: BagSort | null = null;
let pickedReverse: boolean | null = null;
/** The language picked this visit: kept across runs even where storage is blocked. */
let pickedLang: string | null = null;

type Selection = { bag: number } | { slot: EquipSlotId } | null;

/** The Overtime Cultivation summary, dismissed by its button. */
function overtimePanel(summary: OvertimeSummary): HTMLElement {
  const box = el('section', 'panel overtime');
  box.setAttribute('aria-labelledby', 'overtime-title');
  const h = elt('h2', '', 'overtime.title');
  h.id = 'overtime-title';
  const lines = el('ul', 'lines');
  say(() => lines.replaceChildren(...overtimeLines(summary).map((line) => el('li', '', line))));
  const ok = buttonT('overtime.ok', 'primary', () => box.remove());
  box.append(h, elt('p', 'muted', 'overtime.intro'), lines, ok);
  return box;
}

function play(
  root: HTMLElement,
  initial: GameState,
  storage: SaveStorage | null,
  summary: OvertimeSummary | null,
): void {
  const scope = run.next();
  const { signal } = scope;
  labels = [];
  let state = initial;
  let selected: Selection = null;
  /** The bag cell that holds the grid's one tab stop; always on the shown page. */
  let cursor = 0;
  /** The inventory page shown; a run always starts on the first. */
  let page = 0;
  /** How the bag is ordered, and the inventory index shown in each cell. */
  let sort = pickedSort ?? readBagSort(storage);
  let reverse = pickedReverse ?? readBagReverse(storage);
  let order: number[] = [];
  /** Bumped by every equip, so gear redraws only when it changes. */
  let gearVersion = 0;
  let drawnGear = '';
  let drawnDetails = '';
  /** The selected Soul Banner's souls line; refilled every draw, as kills add souls. */
  let soulsText: HTMLElement | null = null;
  /** A press on a bag item; it becomes a drag (with a ghost) once the mouse moves. */
  let drag: { index: number; x: number; y: number; ghost: HTMLElement | null } | null = null;

  // Combat strip
  const strip = el('section', 'strip');
  attr(strip, 'aria-label', 'strip.label');
  const where = el('div', 'where');
  const floorText = el('span');
  const killText = el('span');
  const live = elt('span', 'live', 'strip.live');
  where.append(floorText, killText, live);
  const you = fighter('you');
  const foe = fighter('foe');
  // The stage: the zone's tiling background with both sprites on its floor.
  const stage = el('div', 'stage');
  // The enemy that just died plays its death here, behind the next one.
  const corpse = stageSprite('corpse');
  corpse.sprite.hidden = true;
  stage.append(you.sprite, corpse.sprite, foe.sprite);
  const fighters = el('div', 'fighters');
  fighters.append(you.box, elt('span', 'vs', 'strip.vs'), foe.box);
  // The Tribulation alert: flashes while one is due; a click starts the fight now.
  const trialCall = el('button', 'trial-call');
  trialCall.type = 'button';
  trialCall.hidden = true;
  const trialHead = elt('strong', '', 'trial.due');
  const trialText = el('span');
  trialCall.append(trialHead, trialText);
  trialCall.addEventListener('click', () => {
    if (!canFaceTribulation(state)) return;
    const prev = state;
    act(faceTribulation(state));
    banner(tribulationBanner(prev, state));
    // The alert hides once the fight is on; focus moves to the fight, not the page.
    strip.focus({ preventScroll: true });
  });
  strip.tabIndex = -1;
  // Tribulation moments (falls due, begins, is won, is lost), over the stage; also read out.
  // Always in the accessibility tree (hidden by opacity only), so each one is announced.
  const trialBanner = el('p', 'trial-banner');
  trialBanner.setAttribute('role', 'status');
  let bannerTimer = 0;
  stage.append(trialBanner);
  // A disc's array being set up as each fight starts. Not read out: it comes
  // every few seconds, and the item's Details says the same in words.
  const arrayMark = el('p', 'array-setup');
  arrayMark.setAttribute('aria-hidden', 'true');
  let arrayTimer = 0;
  stage.append(arrayMark);
  // XP to the next level, with the level at its left end. The text is drawn
  // twice: light on the dark track, and dark on the yellow fill, which is
  // clipped to the XP so far. Screen readers get aria-valuetext instead.
  const xp = el('div', 'xp');
  xp.setAttribute('role', 'progressbar');
  attr(xp, 'aria-label', 'strip.xp');
  xp.setAttribute('aria-valuemin', '0');
  xp.setAttribute('aria-valuemax', '100');
  const xpLevel = el('span', 'xp-level');
  const xpText = el('span', 'xp-text');
  const xpFill = el('span', 'xp-fill');
  const xpFillLevel = el('span', 'xp-level');
  const xpFillText = el('span', 'xp-text');
  xpFill.append(xpFillLevel, xpFillText);
  xp.append(xpLevel, xpText, xpFill);
  strip.append(where, trialCall, stage, fighters, xp);
  let zone = '';

  // Summary chips, one line each
  const kpis = el('section', 'kpis');
  attr(kpis, 'aria-label', 'kpi.label');
  const kPath = kpi('kpi.path');
  const kRealm = kpi('kpi.realm', summaryIcon('realm', state.cultivator.level));
  const kStones = kpi('kpi.stones', summaryIcon('stones'));
  const kEssence = kpi('kpi.essence', summaryIcon('essence'));
  let realmIcon = summaryIcon('realm', state.cultivator.level);
  kpis.append(kPath.box, kRealm.box, kStones.box, kEssence.box);

  // Character: a paper doll with each slot where it is worn (the drop target), then stats
  const character = panel('character', 'character.title');
  const slots = el('div', 'doll');
  slots.setAttribute('role', 'group');
  attr(slots, 'aria-label', 'character.equipped');
  slots.append(figure());
  const slotCells = {} as Record<EquipSlotId, HTMLButtonElement>;
  for (const slot of SLOT_IDS) {
    const box = el('div', `slot slot-${slot}`);
    const b = cell();
    b.dataset.slot = slot;
    b.addEventListener('click', () => select(state.cultivator.equipment[slot] ? { slot } : null));
    slotCells[slot] = b;
    const slotName = el('span', 'slot-name');
    say(() => (slotName.textContent = tn('equipSlot', EQUIP_SLOTS[slot].name)));
    box.append(b, slotName);
    slots.append(box);
  }
  // Stats: base stats with their spend buttons on the same row, the derived
  // numbers in groups, then Respec (stat reset and Path change).
  const base = el('section', 'base');
  const baseHead = el('div', 'head');
  const baseTitle = elt('h3', '', 'stats.base');
  baseTitle.id = 'base-stats';
  baseTitle.tabIndex = -1;
  const unspentText = el('span', 'unspent');
  baseHead.append(baseTitle, unspentText);
  const baseList = el('ul', 'base-list');
  baseList.setAttribute('aria-labelledby', 'base-stats');
  const baseValues = {} as Record<StatId, HTMLElement>;
  for (const id of STAT_IDS) {
    const row = el('li');
    const value = el('b', 'value');
    baseValues[id] = value;
    // Hidden (not off) with no points to spend; the words name the stat.
    const one = button('+1', 'spend', () => spend(id, 1));
    const all = buttonT('stats.all', 'spend', () => spend(id, state.cultivator.unspent));
    say(() => {
      const stat = t(`stat.${id}`);
      one.setAttribute('aria-label', t('stats.plusOne', { stat }));
      all.setAttribute('aria-label', t('stats.allTo', { stat }));
    });
    row.append(elt('span', 'name', `stat.${id}`), value, one, all);
    baseList.append(row);
  }
  base.append(baseHead, baseList);

  const derived = el('div', 'derived');
  const derivedLists = {} as Record<StatGroup, HTMLElement>;
  const derivedValues: HTMLElement[] = [];
  const derivedLabels: HTMLElement[] = [];
  for (const group of STAT_GROUPS) {
    const head = elt('h3', '', `group.${group}`);
    const list = el('dl');
    derivedLists[group] = list;
    derived.append(head, list);
  }

  const respec = el('section', 'respec');
  const respecHead = el('div', 'head');
  const respecInfo = el('button', 'info', '?');
  respecInfo.type = 'button';
  // The name starts with the visible "?", so voice control can say it.
  attr(respecInfo, 'aria-label', 'respec.info');
  respecInfo.setAttribute('aria-expanded', 'false');
  respecInfo.setAttribute('aria-controls', 'respec-info');
  const respecNote = elt('p', 'muted hint', 'respec.note');
  respecNote.id = 'respec-info';
  respecNote.hidden = true;
  respecInfo.addEventListener('click', () => {
    respecNote.hidden = !respecNote.hidden;
    respecInfo.setAttribute('aria-expanded', String(!respecNote.hidden));
  });
  respecHead.append(elt('h3', '', 'respec.title'), respecInfo);
  /** A Respec line: the controls, then the cost and why it is off; the button is described by both. */
  function respecLine(key: string, ...controls: HTMLElement[]) {
    const line = el('div', 'line');
    const cost = el('span', 'cost');
    cost.id = `${key}-cost`;
    const why = el('span', 'why');
    why.id = `${key}-why`;
    const meta = el('small', 'meta');
    meta.append(cost, why);
    line.append(...controls, meta);
    return { line, cost, why };
  }
  const resetBtn = buttonT('respec.reset', '', () => act(resetStats(state)));
  resetBtn.setAttribute('aria-describedby', 'reset-cost reset-why');
  const resetLine = respecLine('reset', resetBtn);
  // The button beside it says what the choice is for; the name says it too.
  const pathPick = el('select');
  attr(pathPick, 'aria-label', 'respec.newPath');
  const pathBtn = buttonT('respec.change', '', () => {
    const to = pathPick.value as PathId;
    if (to) act(changePath(state, to));
  });
  pathBtn.setAttribute('aria-describedby', 'path-cost path-why');
  const pathLine = respecLine('path', pathPick, pathBtn);
  respec.append(respecHead, respecNote, resetLine.line, pathLine.line);

  const statsBody = el('div', 'statstab');
  statsBody.append(base, derived, respec);

  // Early Retirement: the Dao Insight total, the passive shop (one line per
  // passive, its effect on expand), then the retire box with its confirmation.
  const insightTotal = el('div', 'insight');
  const insightCount = el('b');
  const retiredText = el('small', 'muted');
  insightTotal.append(gem(), insightCount, elt('span', '', 'retire.insight'), retiredText);
  const passiveRows = {} as Record<
    PassiveId,
    {
      row: HTMLElement;
      name: HTMLElement;
      rank: HTMLElement;
      buy: HTMLButtonElement;
      detail: HTMLElement;
    }
  >;
  const passiveList = el('ul', 'passives');
  attr(passiveList, 'aria-label', 'retire.passives');
  for (const id of PASSIVE_IDS) {
    const row = el('li', 'passive');
    const toggle = el('button', 'more');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `passive-${id}`);
    const name = el('span', 'name');
    const rank = el('span', 'rank');
    toggle.append(name, ' ', rank);
    const buy = button('', '', () => act(buyPassive(state, id)));
    const detail = el('p', 'detail');
    detail.id = `passive-${id}`;
    detail.hidden = true;
    toggle.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      toggle.setAttribute('aria-expanded', String(!detail.hidden));
    });
    row.append(toggle, buy, detail);
    passiveList.append(row);
    passiveRows[id] = { row, name, rank, buy, detail };
  }
  // The lists follow the run while open (every kill changes the Spirit Stones
  // lost), so they are not a live region: the Retire button is described by
  // them instead, and focus lands there.
  const retireBox = el('div', 'confirm');
  const keptList = el('ul', 'lines');
  const keptHead = elt('h4', 'keep', 'retire.kept');
  keptHead.id = 'retire-kept';
  keptList.id = 'retire-kept-list';
  const lostHead = elt('h4', 'lose', 'retire.lost');
  lostHead.id = 'retire-lost';
  const lostList = el('ul', 'lines');
  lostList.id = 'retire-lost-list';
  const keptCol = el('div');
  keptCol.append(keptHead, keptList);
  const lostCol = el('div');
  lostCol.append(lostHead, lostList);
  const cols = el('div', 'cols');
  cols.append(keptCol, lostCol);
  const retireYes = buttonT('retire.yes', 'primary', () => {
    // A new run on a fresh page; play() saves it straight away.
    play(root, retire(state), storage, null);
    // The old page is gone with its focus: land on the new run's Retirement tab.
    const tab = root.querySelector<HTMLButtonElement>('#tab-retire');
    tab?.click();
    tab?.focus();
  });
  retireYes.setAttribute(
    'aria-describedby',
    'retire-kept retire-kept-list retire-lost retire-lost-list',
  );
  const retireNo = buttonT('confirm.cancel', '', () => {
    retireBox.hidden = true;
    retireBtn.focus();
  });
  retireBox.append(elt('p', 'ask', 'retire.ask'), cols, retireYes, retireNo);
  retireBox.hidden = true;
  const retireBtn = button('', '', askRetire);
  function askRetire(): void {
    if (!canRetire(state)) return;
    retireBox.hidden = false;
    drawRetire();
    retireYes.focus();
  }
  /** Refills the open confirmation, touching only lines that changed. */
  function drawRetire(): void {
    if (retireBox.hidden) return;
    const { kept, lost } = retireLines(retirePreview(state));
    for (const [list, lines] of [
      [keptList, kept],
      [lostList, lost],
    ] as const) {
      while (list.children.length > lines.length) list.lastElementChild?.remove();
      lines.forEach((line, i) => {
        const li = list.children[i] ?? list.appendChild(el('li'));
        if (li.textContent !== line) li.textContent = line;
      });
    }
  }
  const reward = el('span', 'reward');
  const retireHead = el('div', 'head');
  retireHead.append(elt('h3', '', 'retire.title'), reward);
  const retireSection = el('section', 'early');
  retireSection.append(retireHead, elt('p', 'muted hint', 'retire.hint'), retireBtn, retireBox);
  const retireBody = el('div', 'retire');
  retireBody.append(insightTotal, passiveList, retireSection);

  const charTabs = tabs([
    { id: 'gear', label: 'tab.gear', body: slots },
    { id: 'stats', label: 'tab.stats', body: statsBody },
    { id: 'retire', label: 'tab.retire', body: retireBody },
  ]);
  character.box.append(charTabs.bar, ...charTabs.panels);

  // Inventory grid
  const inventory = panel('inventory', 'inventory.title');
  const grid = el('div', 'bag');
  grid.setAttribute('role', 'group');
  attr(grid, 'aria-label', 'inventory.grid');
  const bagCells: HTMLButtonElement[] = [];
  /** Invisible cells that pad a short last page, so every page is the same size. */
  const fillers: HTMLElement[] = [];
  /** Adds cells until the grid matches the bag; bought slots land on later pages. */
  function growBag(): void {
    for (let i = bagCells.length; i < state.bagSize; i++) {
      const b = cell();
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener('click', () => {
        setCursor(i);
        const index = order[i];
        select(index === undefined ? null : { bag: index });
        if (selected) revealDetails();
      });
      b.addEventListener('dblclick', () => {
        const index = order[i];
        if (index !== undefined) equipFromBag(index);
      });
      b.addEventListener('pointerdown', (e) => startPress(e, i));
      bagCells.push(b);
      grid.insertBefore(b, fillers[0] ?? null);
    }
  }
  /** Shows only the cells on the current page, padded out to a full page. */
  function drawPage(): void {
    const { fillers: pad, pages } = bagPage(state.bagSize, page);
    bagCells.forEach((b, i) => {
      b.hidden = pageOf(i) !== page;
    });
    while (fillers.length < pad) {
      const f = el('span', 'cell filler');
      f.setAttribute('aria-hidden', 'true');
      fillers.push(f);
      grid.append(f);
    }
    fillers.forEach((f, i) => {
      f.hidden = i >= pad;
    });
    pager.classList.toggle('single', pages === 1);
    setText(pageText, t('inventory.page', { n: page + 1, of: pages }));
    setButton(prevPage, t('inventory.prev'), page === 0);
    setButton(nextPage, t('inventory.next'), page === pages - 1);
  }
  /** Turns to page `to`; a bag selection left on another page is cleared. */
  function showPage(to: number): void {
    page = to;
    if (selected && 'bag' in selected && pageOf(order.indexOf(selected.bag)) !== page) {
      selected = null;
    }
    setCursor(page * BAG_PAGE);
    draw(null);
  }
  // Space for the pager is kept even with one page, so the first bought slots
  // never make the panel taller.
  const pager = el('div', 'pager');
  pager.setAttribute('role', 'group');
  attr(pager, 'aria-label', 'inventory.pages');
  const prevPage = button('', '', () => showPage(page - 1));
  // Announced on a turn, as the focused button's name does not change.
  const pageText = el('span', 'muted');
  pageText.setAttribute('aria-live', 'polite');
  const nextPage = button('', '', () => showPage(page + 1));
  pager.append(prevPage, pageText, nextPage);
  grid.addEventListener('keydown', (e) => {
    // The column count is set by the stylesheet (fewer on a narrow screen).
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    // Arrows stay on the shown page; the pager turns it.
    const { start, cells } = bagPage(state.bagSize, page);
    const move = gridMove(cursor - start, e.key, cells, cols);
    if (move === null) return;
    const to = start + move;
    e.preventDefault();
    setCursor(to);
    bagCells[to]?.focus();
  });

  // Bulk sell: pick a grade, then confirm a message naming the count and the
  // highest grade sold.
  const gradeName = (g: GradeId): string => tn('grade', GRADES[g].name);
  const below = choice(
    'inventory.sellBelow',
    GRADE_IDS.slice(1).map((g) => [g, () => gradeName(g)] as const),
  );
  /** The grade and preview the player is confirming; null when no confirmation is open. */
  let pending: { grade: GradeId; text: string } | null = null;
  const confirmBox = el('div', 'confirm');
  confirmBox.setAttribute('role', 'alert');
  const confirmText = el('p');
  const confirmYes = buttonT('confirm.sell', 'primary', () => {
    if (!pending) return;
    const text = sellBelowLabel(sellBelowPreview(state, pending.grade));
    // A drop since the preview changed what would go: show the new numbers first.
    if (text !== pending.text) return askSellBelow(pending.grade);
    const grade = pending.grade;
    closeConfirm();
    // Bag positions shift; an equipped selection stays.
    if (selected && 'bag' in selected) selected = null;
    act(sellBelow(state, grade));
    sellBelowBtn.focus();
  });
  const confirmNo = button('', '', () => {
    closeConfirm();
    sellBelowBtn.focus();
  });
  confirmBox.append(confirmText, confirmYes, confirmNo);
  confirmBox.hidden = true;
  const sellBelowBtn = buttonT('inventory.sell', '', () =>
    askSellBelow(below.select.value as GradeId),
  );
  below.select.addEventListener('change', closeConfirm);
  /** Opens (or, on a language switch, refills) the confirmation for selling below `grade`. */
  function askSellBelow(grade: GradeId, focus = true): void {
    const preview = sellBelowPreview(state, grade);
    const text = sellBelowLabel(preview);
    pending = preview.count > 0 ? { grade, text } : null;
    confirmText.textContent = text;
    confirmYes.hidden = !pending;
    confirmNo.textContent = t(pending ? 'confirm.cancel' : 'confirm.ok');
    confirmBox.hidden = false;
    if (focus) (pending ? confirmYes : confirmNo).focus();
  }
  function closeConfirm(): void {
    pending = null;
    confirmBox.hidden = true;
  }
  const bulkRow = el('div', 'row');
  bulkRow.append(below.box, sellBelowBtn);
  const bagBtn = button('', '', () => act(buyBagSpace(state)));
  const bagTools = el('div', 'tools');
  bagTools.append(bulkRow, confirmBox, bagBtn);
  // Sorting reorders the cells only: the bag itself stays in drop order.
  const sortPick = choice(
    'sort.by',
    BAG_SORTS.map((s) => [s, () => t(BAG_SORT_NAMES[s])] as const),
  );
  sortPick.box.classList.add('sort');
  sortPick.select.value = sort;
  sortPick.select.addEventListener('change', () => {
    sort = pickedSort = pickBagSort(sortPick.select.value);
    writeBagSort(storage, sort);
    draw(null);
  });
  // Flips the sort's direction; its text names the direction shown.
  const sortDir = button('', '', () => {
    reverse = pickedReverse = !reverse;
    writeBagReverse(storage, reverse);
    draw(null);
  });
  // The arrow is decorative; the words name the direction.
  const sortArrow = el('span');
  sortArrow.setAttribute('aria-hidden', 'true');
  const sortDirText = el('span');
  sortDir.append(sortArrow, sortDirText);
  const sortRow = el('div', 'sort-row');
  sortRow.append(sortPick.box, sortDir);
  const bagBody = el('div');
  bagBody.append(sortRow, grid, pager, bagTools);

  // Auto filter: a minimum grade, the item types kept, and what happens to the rest.
  const minGrade = choice(
    'filter.minGrade',
    GRADE_IDS.map(
      (g, i) =>
        [
          g,
          () => (i === 0 ? t('filter.anyGrade') : t('filter.andAbove', { grade: gradeName(g) })),
        ] as const,
    ),
  );
  const actionPick = choice('filter.action', [
    ['sell', () => t('filter.sell')],
    ['salvage', () => t('filter.salvage')],
  ]);
  const types = el('fieldset', 'types');
  types.append(elt('legend', '', 'filter.types'));
  const typeBoxes = {} as Record<SlotId, HTMLInputElement>;
  for (const id of ITEM_TYPES) {
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    typeBoxes[id] = box;
    const name = document.createTextNode('');
    say(() => (name.data = ` ${tn('slot', SLOTS[id].name)}`));
    label.append(box, name);
    types.append(label);
  }
  const filterNote = elt('p', 'muted hint', 'filter.note');
  const filterBody = el('div', 'filter');
  filterBody.append(minGrade.box, types, actionPick.box, filterNote);
  const readFilterForm = (): void => {
    state = setFilter(state, {
      minGrade: minGrade.select.value as GradeId,
      slots: ITEM_TYPES.filter((id) => typeBoxes[id].checked),
      action: actionPick.select.value as FilterAction,
    });
  };
  filterBody.addEventListener('change', readFilterForm);
  const bagTabs = tabs([
    { id: 'bag', label: 'tab.bag', body: bagBody },
    { id: 'filter', label: 'tab.filter', body: filterBody },
  ]);
  inventory.box.append(bagTabs.bar, ...bagTabs.panels);

  // Item details
  const details = panel('details', 'details.title');
  const detailBody = el('div');
  details.box.append(detailBody);

  // Recent drops
  const log = panel('log', 'drops.title');
  const drops = el('ul', 'drops');
  drops.setAttribute('aria-live', 'polite');
  const noDrops = elt('p', 'muted', 'drops.none');
  /** The drops in the log, newest first, so a language switch can write them again. */
  const recent: Item[] = [];
  const handledText = el('p', 'muted');
  log.box.append(noDrops, drops, handledText);

  const columns = el('div', 'columns');
  const mainCol = el('div', 'game side');
  mainCol.append(details.box);
  columns.append(character.box, inventory.box, mainCol);
  const game = el('div', 'game');
  const away = summary && summary.seconds >= SUMMARY_MIN_SECONDS ? overtimePanel(summary) : null;
  if (away) game.append(away);
  // Beside the strip: the summary chips over Recent drops.
  const beside = el('div', 'beside');
  beside.append(kpis, log.box);
  game.append(strip, beside, columns);
  // Tab HUD and pop-out controls, then the main menu (Settings and Help).
  const tools = el('div', 'tools');
  const notices = notifier(window);
  const noticeBtn = button('', '', () => {
    void notices.toggle().then(() => drawTools());
  });
  const popBtn = button('', '', () => void togglePopOut());
  // Each control is left out where the browser lacks its feature.
  if (canPopOut(window)) tools.append(popBtn);
  const menuBtn = buttonT('tools.menu', '', () => {
    resetBox.hidden = true;
    menu.showModal();
  });
  menuBtn.setAttribute('aria-haspopup', 'dialog');
  tools.append(menuBtn);
  const bar = titleBar(storage, relabel);
  // The title bar's own tools hold the language switch; Pop out and Menu go before it.
  bar.querySelector('.tools')?.prepend(...tools.children);

  // Reset progress: asks first, then deletes the save and starts a new run.
  /** The browser refused to delete the save: the confirmation says so instead. */
  let resetRefused = false;
  const resetText = el('p');
  say(() => (resetText.textContent = t(resetRefused ? 'menu.resetRefused' : 'menu.resetText')));
  const resetYes = buttonT('menu.resetYes', 'primary', () => {
    if (storage && !clearSave(storage)) {
      resetRefused = true;
      resetText.textContent = t('menu.resetRefused');
      resetYes.hidden = true;
      return;
    }
    menu.close();
    // start() stops this run (timers, autosave, pop-out) before anything is saved again.
    start(root, storage);
  });
  const resetNo = buttonT('confirm.cancel', '', () => {
    resetBox.hidden = true;
    resetAsk.focus();
  });
  const resetBox = el('div', 'confirm');
  resetBox.setAttribute('role', 'alert');
  resetBox.append(resetText, resetYes, resetNo);
  resetBox.hidden = true;
  const resetAsk = buttonT('menu.resetAsk', '', () => {
    resetRefused = false;
    resetText.textContent = t('menu.resetText');
    resetBox.hidden = false;
    resetYes.hidden = false;
    resetNo.focus();
  });

  /** The Settings theme choice; start() already put the saved one on the page. */
  let theme = pickedTheme ?? readTheme(storage);
  /** Shows `theme` on the page and, while it is open, the pop-out. */
  const applyTheme = (): void =>
    showTheme([document.documentElement, pip?.document.documentElement], theme, osDark.matches);
  const menu = mainMenu();

  function mainMenu(): HTMLDialogElement {
    const dialog = el('dialog', 'menu');
    dialog.setAttribute('aria-labelledby', 'menu-title');
    const head = el('div', 'menu-head');
    const h = elt('h2', '', 'menu.title');
    h.id = 'menu-title';
    head.append(
      h,
      buttonT('menu.close', '', () => dialog.close()),
    );
    const settings = el('div', 'settings');
    const themePick = choice('menu.theme', [
      ['dark', () => t('menu.dark')],
      ['light', () => t('menu.light')],
      ['system', () => t('menu.system')],
    ]);
    themePick.select.value = theme;
    themePick.select.addEventListener('change', () => {
      theme = pickedTheme = pickTheme(themePick.select.value);
      // Blocked storage still changes it for this visit.
      writeTheme(storage, theme);
      applyTheme();
    });
    settings.append(themePick.box);
    if (notices.state() !== 'unsupported') {
      settings.append(elt('h3', '', 'menu.notifications'), noticeBtn);
    }
    settings.append(
      elt('h3', '', 'menu.reset'),
      elt('p', 'muted hint', 'menu.resetHint'),
      resetAsk,
      resetBox,
    );
    const help = el('ul', 'lines help');
    for (const line of HELP_LINES) help.append(elt('li', '', line));
    const menuTabs = tabs([
      { id: 'settings', label: 'tab.settings', body: settings },
      { id: 'help', label: 'tab.help', body: help },
    ]);
    dialog.append(head, menuTabs.bar, ...menuTabs.panels);
    return dialog;
  }

  // Mini view, shown in the pop-out: the strip moves in, plus one status line and the latest drop.
  const mini = el('div', 'mini');
  const miniFile = elt('div', 'file', 'game.file');
  const miniLine = el('p', 'status');
  const miniToast = el('p', 'toast muted');
  say(() => (miniToast.textContent = recent[0] ? dropToast(recent[0]) : t('hud.noDrops')));
  miniToast.setAttribute('aria-live', 'polite');
  // A click on the pop-out brings the game's tab forward (docs/design.md §14).
  mini.addEventListener('click', () => window.focus());
  let pip: Window | null = null;
  /** A pop-out request is waiting on the browser; further clicks wait for it. */
  let opening = false;
  /** Drops kept while the tab was hidden: the title counts them, the favicon marks the best. */
  let unseen: Unseen = NOTHING_UNSEEN;
  let blinkOn = true;
  let blinkAt = 0;

  root.replaceChildren(bar, formulaBar(), game, statusBar(), menu);
  away?.querySelector('button')?.focus();

  function setFighter(f: Fighter, name: string, hp: number, maxHp: number): void {
    f.name.textContent = name;
    f.hp.textContent = t('strip.hp', { hp: Math.max(0, Math.ceil(hp)), max: maxHp });
    f.bar.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
  }

  function drawStrip(prev: GameState | null): void {
    const c = state.cultivator;
    const enemy = state.enemies[0];
    floorText.textContent = t('strip.floor', {
      floor: state.floor,
      best: state.highestFloor,
      wave: waveLabel(state),
    });
    killText.textContent = t('strip.kills', { n: state.kills });
    setFighter(you, tn('path', PATHS[c.path].name), c.hp, derive(c).maxHp);
    if (enemy) {
      foe.box.dataset.kind = enemy.kind;
      setFighter(foe, enemyName(enemy.kind, enemy.name), enemy.hp, enemy.maxHp);
    }
    const z = zoneOf(state.floor);
    if (z !== zone) {
      zone = z;
      stage.style.backgroundImage = cssUrl(artUrl(`bg-${z}`));
    }
    useSheet(you, `path-${c.path}`, SPRITE_SIZE.path);
    const call = tribulationCall(state);
    trialCall.hidden = !call;
    const callText = call ? t('trial.call', call) : '';
    if (trialText.textContent !== callText) trialText.textContent = callText;
    strip.classList.toggle('trial', enemy?.kind === 'tribulation');
    if (prev) {
      banner(tribulationBanner(prev, state));
      showArray(arraySetUp(prev, state));
      // Only replays what the sim decided between the two states.
      const e = stripEvents(prev, state);
      const now = performance.now();
      const before = prev.enemies[0];
      if (e.youDied) playAction(you, 'death', now);
      else if (e.youHit) playAction(you, 'hit', now);
      else if (e.youAttack) playAction(you, 'attack', now);
      if (e.foeDied && !reducedMotion.matches) {
        // The one that died falls behind the next, which is already in front.
        useSheet(corpse, enemySprite(e.foeDied.kind, e.foeDied.name), SPRITE_SIZE[e.foeDied.kind]);
        corpse.playing = { action: 'death', start: now };
        corpse.sprite.hidden = false;
        // The next enemy steps up once the fallen one is down (the sim's pause).
        foe.sprite.style.visibility = 'hidden';
        foe.playing = { action: 'idle', start: now };
      } else if (e.foeHit) playAction(foe, 'hit', now);
      else if (e.foeAttack) playAction(foe, 'attack', now);
      // HP lost, net of lifesteal; the killing blow shows what was left.
      if (e.youHit) damageNumber(you, prev.cultivator.hp - c.hp);
      if (e.youDied) damageNumber(you, prev.cultivator.hp);
      if (before && (e.foeHit || e.foeDied)) {
        damageNumber(foe, before.hp - (e.foeDied ? 0 : (enemy?.hp ?? 0)));
      }
    }
    showEnemy();
    drawSprites();
  }

  /** Shows `text` over the stage for a moment; null leaves the banner as it is. */
  function banner(text: string | null): void {
    if (text === null) return;
    trialBanner.textContent = text;
    // Restarts the fade, even for the same text twice.
    trialBanner.classList.remove('show');
    void trialBanner.offsetWidth;
    trialBanner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      trialBanner.classList.remove('show');
      trialBanner.textContent = '';
    }, TRIAL_BANNER_MS);
  }

  /** Shows an array's set-up under the fighters for the pause before a fight; null does nothing. */
  function showArray(text: string | null): void {
    if (text === null) return;
    arrayMark.textContent = text;
    arrayMark.classList.add('show');
    clearTimeout(arrayTimer);
    arrayTimer = window.setTimeout(() => {
      arrayMark.classList.remove('show');
      arrayMark.textContent = '';
    }, ARRAY_SETUP_MS);
  }

  function playAction(f: StageSprite, action: Action, now: number): void {
    f.playing = request(f.playing, action, now);
  }

  /** The enemy in front, on the foe's sprite. */
  function showEnemy(): void {
    const enemy = state.enemies[0];
    if (enemy) useSheet(foe, enemySprite(enemy.kind, enemy.name), SPRITE_SIZE[enemy.kind]);
  }

  /** Each sprite's current frame (sprite.ts decides it); a finished corpse goes. */
  function drawSprites(): void {
    const now = performance.now();
    const reduced = reducedMotion.matches;
    // No corpse on stage (none started, or it already went): the foe always shows.
    if (corpse.sprite.hidden) foe.sprite.style.visibility = '';
    for (const f of [you, foe, corpse]) {
      if (f.sprite.hidden) continue;
      const step = advance(f.playing, now, reduced, f === corpse);
      f.playing = step.playing;
      if (step.gone) {
        f.sprite.hidden = true;
        continue;
      }
      const pos = `${-step.col * f.size}px ${-step.row * f.size}px`;
      if (pos !== f.drawn) f.sprite.style.backgroundPosition = f.drawn = pos;
    }
  }

  /** Damage drawn in code (never baked into a sprite), rising off the one who took it. */
  function damageNumber(f: Fighter, amount: number): void {
    if (!(amount >= 1) || stage.querySelectorAll('.dmg').length >= MAX_DAMAGE_NUMBERS) return;
    const n = el('span', `dmg ${f === you ? 'you' : 'foe'}`, String(Math.round(amount)));
    n.setAttribute('aria-hidden', 'true');
    n.style.left = `${f.sprite.offsetLeft + f.size / 2}px`;
    n.style.bottom = `${Math.round(f.size * 0.75)}px`;
    stage.append(n);
    setTimeout(() => n.remove(), DAMAGE_NUMBER_MS);
  }

  function drawSummary(): void {
    const c = state.cultivator;
    kPath.value.textContent = tn('path', PATHS[c.path].name);
    kRealm.value.textContent = realmLabel(c.level);
    // A breakthrough swaps the realm's icon.
    const icon = summaryIcon('realm', c.level);
    if (icon !== realmIcon && kRealm.icon) {
      realmIcon = icon;
      setSummaryIcon(kRealm.icon, icon);
    }
    const bar = xpBar(c);
    xp.style.setProperty('--xp', `${bar.percent}%`);
    for (const n of [xpLevel, xpFillLevel]) setText(n, bar.level);
    for (const n of [xpText, xpFillText]) setText(n, bar.text);
    xp.setAttribute('aria-valuenow', String(Math.round(bar.percent)));
    xp.setAttribute('aria-valuetext', bar.spoken);
    for (const id of STAT_IDS) setText(baseValues[id], String(c.stats[id]));
    const rows = statRows(c, state.passives);
    // Built once, then only the values change, so selecting text doesn't flicker.
    if (derivedValues.length === 0) {
      for (const r of rows) {
        const dd = el('dd', '', r.value);
        const dt = el('dt', '', r.short);
        // The full name where the group shortens it ("Treasure" under Find).
        if (r.short !== r.label) dt.title = r.label;
        derivedLabels.push(dt);
        derivedLists[r.group].append(dt, dd);
        derivedValues.push(dd);
      }
    }
    rows.forEach((r, i) => {
      const dd = derivedValues[i];
      if (dd) setText(dd, r.value);
      const dt = derivedLabels[i];
      if (dt) {
        setText(dt, r.short);
        if (r.short !== r.label && dt.title !== r.label) dt.title = r.label;
      }
    });
  }

  function selectedItem(): Item | undefined {
    if (!selected) return undefined;
    return 'bag' in selected
      ? state.inventory[selected.bag]
      : state.cultivator.equipment[selected.slot];
  }

  /** Cells and details are built once and refilled in place, so focus never drops. */
  function drawGear(): void {
    const c = state.cultivator;
    // The panel ignores the bag's length (drops only append), so a drop never
    // rebuilds it and takes focus off its Equip button.
    const detailsKey = `${gearVersion}|${c.level}|${JSON.stringify(selected)}`;
    if (detailsKey !== drawnDetails) {
      drawnDetails = detailsKey;
      drawDetails();
    }
    const item = selectedItem();
    if (soulsText && item) setText(soulsText, soulsLine(item, state) ?? '');
    const key = `${detailsKey}|${state.inventory.length}|${state.bagSize}|${page}|${sort}|${reverse}`;
    if (key === drawnGear) return;
    drawnGear = key;
    order = bagOrder(state.inventory, sort, reverse);
    setText(sortArrow, reverse ? '↑ ' : '↓ ');
    setText(sortDirText, t(BAG_SORT_DIRS[sort][reverse ? 1 : 0]));

    growBag();
    drawPage();
    inventory.heading.textContent = t('inventory.count', {
      n: state.inventory.length,
      size: state.bagSize,
    });
    bagCells.forEach((b, i) => {
      const index = order[i];
      fillCell(
        b,
        index === undefined ? undefined : state.inventory[index],
        t('inventory.emptyCell', { n: i + 1 }),
      );
      b.setAttribute(
        'aria-pressed',
        String(index !== undefined && !!selected && 'bag' in selected && selected.bag === index),
      );
    });
    for (const slot of SLOT_IDS) {
      const b = slotCells[slot];
      const name = tn('equipSlot', EQUIP_SLOTS[slot].name);
      fillCell(b, c.equipment[slot], t('inventory.emptySlot', { slot: name }));
      // fillCell resets classes; a drag in progress keeps its target slots marked.
      b.classList.toggle('target', !!drag?.ghost && canDrop(state.inventory[drag.index], slot));
      b.setAttribute(
        'aria-pressed',
        String(!!selected && 'slot' in selected && selected.slot === slot),
      );
    }
  }

  function drawDetails(): void {
    const item = selectedItem();
    soulsText = null;
    if (!item || !selected) {
      detailBody.replaceChildren(el('p', 'muted', t('details.none')));
      return;
    }
    const lines = el('ul', 'lines');
    for (const line of itemLines(item)) lines.append(el('li', '', line));
    const head = el('div', 'item-head');
    const icon = el('span', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, item);
    const name = el('div');
    name.append(
      el('div', `title grade-${item.grade}`, tn('item', item.name)),
      el('div', `tag grade-${item.grade}`, itemTag(item)),
    );
    const tier = treasureTier(item);
    if (tier) name.append(el('div', 'muted', tier));
    const line = charmLineName(item);
    if (line) name.append(el('div', 'muted', line));
    const lean = favouredBy(item, state.cultivator.path);
    if (lean) name.append(el('div', lean.match ? 'up' : 'muted', lean.text));
    const souls = soulsLine(item, state);
    if (souls !== null) name.append((soulsText = el('div', 'muted', souls)));
    head.append(icon, name);
    const parts: HTMLElement[] = [head, lines];
    if ('slot' in selected) {
      parts.push(el('p', 'muted', t('details.equipped')));
    } else {
      const index = selected.bag;
      const blocked = equipBlock(state.cultivator, item);
      if (blocked) {
        const why = el('p', 'down', t('details.blocked', { why: blocked }));
        why.id = 'equip-why';
        parts.push(why);
      }
      // One comparison and Equip button per position the item fits (two for
      // accessories and charms), the default position first.
      const fits = slotsFor(item.slot);
      const first = defaultSlot(state.cultivator.equipment, item);
      for (const to of [first, ...fits.filter((p) => p !== first)]) {
        const name = tn('equipSlot', EQUIP_SLOTS[to].name);
        const current = state.cultivator.equipment[to];
        const diff = compareToEquipped(state.cultivator, item, to);
        const compare = el('ul', 'compare');
        for (const d of diff) compare.append(el('li', d.better ? 'up' : 'down', d.text));
        if (!diff.length) compare.append(el('li', 'muted', t('details.noChange')));
        // The line it sits on already names the position.
        const equipBtn = el('button', 'primary', t('details.equip'));
        if (fits.length > 1)
          equipBtn.setAttribute('aria-label', t('details.equipIn', { slot: name }));
        equipBtn.type = 'button';
        // aria-disabled, as everywhere here; equipFromBag ignores the click.
        if (blocked) {
          equipBtn.setAttribute('aria-disabled', 'true');
          equipBtn.setAttribute('aria-describedby', 'equip-why');
          equipBtn.title = blocked;
        }
        equipBtn.addEventListener('click', () => equipFromBag(index, to));
        const cmp = el('div', 'cmp');
        cmp.append(
          el(
            'h3',
            '',
            current
              ? t('details.vs', { slot: name, item: tn('item', current.name) })
              : t('details.empty', { slot: name }),
          ),
          equipBtn,
        );
        parts.push(cmp, compare);
      }
      const row = el('div', 'row');
      const sellBtn = button(t('details.sell', { n: sellPrice(item) }), '', () =>
        dispose(index, 'sell'),
      );
      sellBtn.dataset.action = 'sell';
      const salvageBtn = button(t('details.salvage', { n: essenceValue(item) }), '', () =>
        dispose(index, 'salvage'),
      );
      salvageBtn.dataset.action = 'salvage';
      row.append(sellBtn, salvageBtn);
      parts.push(row);
    }
    // A level-up redraws the comparison; a focused Equip button keeps focus.
    const active = document.activeElement;
    const focusAt = detailBody.contains(active)
      ? [...detailBody.querySelectorAll('button')].indexOf(active as HTMLButtonElement)
      : -1;
    detailBody.replaceChildren(...parts);
    if (focusAt >= 0) {
      const buttons = detailBody.querySelectorAll('button');
      (buttons[focusAt] ?? buttons[0])?.focus();
    }
  }

  /** On a stacked layout the details sit below the grid; bring their top on screen. */
  function revealDetails(): void {
    const r = details.box.getBoundingClientRect();
    if (r.top >= 0 && r.top <= innerHeight * 0.75) return;
    details.box.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
    });
  }

  function setCursor(i: number): void {
    bagCells[cursor]?.setAttribute('tabindex', '-1');
    cursor = i;
    bagCells[cursor]?.setAttribute('tabindex', '0');
  }

  function select(sel: Selection): void {
    selected = sel;
    draw(null);
  }

  function equipFromBag(index: number, to?: EquipSlotId): void {
    const item = state.inventory[index];
    // A double-click or drop below the item's realm does nothing; Details says why.
    if (!item || equipBlock(state.cultivator, item)) return;
    // The Equip button is about to be replaced; keep keyboard focus nearby.
    const fromDetails = details.box.contains(document.activeElement);
    const at = to ?? defaultSlot(state.cultivator.equipment, item);
    state = equip(state, index, at);
    gearVersion += 1;
    selected = { slot: at };
    draw(null);
    if (fromDetails) {
      charTabs.show('gear');
      slotCells[at].focus();
    }
  }

  /** Applies a player action that changes the bag or the cultivator, then redraws. */
  function act(next: GameState): void {
    state = next;
    gearVersion += 1;
    draw(null);
  }

  /**
   * Sells or salvages the bag item at `index`. The selection stays on its
   * cell, so the next item can be handled straight away; focus stays on the
   * same button, or goes to the cell when the bag has nothing left there.
   */
  function dispose(index: number, action: 'sell' | 'salvage'): void {
    const at = order.indexOf(index);
    const next = (action === 'sell' ? sell : salvage)(state, index);
    const now = bagOrder(next.inventory, sort, reverse)[at];
    selected = now === undefined ? null : { bag: now };
    act(next);
    const again = detailBody.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (again) again.focus();
    else {
      setCursor(at);
      bagCells[at]?.focus();
    }
  }

  function spend(stat: StatId, n: number): void {
    if (n < 1) return;
    act(spendPoints(state, stat, n));
    // The point buttons hide once every point is spent; keep focus in the panel.
    if (state.cultivator.unspent === 0 && baseList.contains(document.activeElement)) {
      baseTitle.focus();
    }
  }

  // Drag to equip, for mouse and pen. Touch has tap to select and the Equip
  // button instead, so swiping over the grid still scrolls the page.

  function startPress(e: PointerEvent, cell: number): void {
    const index = order[cell];
    if (e.pointerType === 'touch' || e.button !== 0 || index === undefined) return;
    drag = { index, x: e.clientX, y: e.clientY, ghost: null };
  }

  function endDrag(): void {
    drag?.ghost?.remove();
    document.body.classList.remove('dragging');
    character.box.classList.remove('drop-ok');
    for (const slot of SLOT_IDS) slotCells[slot].classList.remove('target');
    drag = null;
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_START_PX) return;
        const item = state.inventory[drag.index];
        if (!item) return endDrag();
        // A drop since the press may have re-sorted the bag: clone the item's cell now.
        const ghost = bagCells[order.indexOf(drag.index)]?.cloneNode(true) as HTMLElement;
        ghost.classList.add('ghost');
        ghost.setAttribute('aria-hidden', 'true');
        document.body.append(ghost);
        document.body.classList.add('dragging');
        for (const p of slotsFor(item.slot))
          slotCells[p].classList.toggle('target', canDrop(item, p));
        drag.ghost = ghost;
      }
      drag.ghost.style.left = `${e.clientX}px`;
      drag.ghost.style.top = `${e.clientY}px`;
      const dragged = state.inventory[drag.index];
      character.box.classList.toggle(
        'drop-ok',
        overCharacter(e) && !!dragged && !equipBlock(state.cultivator, dragged),
      );
    },
    { signal },
  );

  window.addEventListener(
    'pointerup',
    (e) => {
      if (!drag) return;
      const { index, ghost } = drag;
      endDrag();
      // Dropped on a position the item fits: that one. Anywhere else on the
      // character: the item's default position.
      if (ghost && overCharacter(e)) equipFromBag(index, dropSlot(e, index));
    },
    { signal },
  );
  window.addEventListener('pointercancel', endDrag, { signal });
  // A drag's ghost lives on <body>, outside this run's page; it goes with the run.
  signal.addEventListener('abort', endDrag);
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && drag) endDrag();
    },
    { signal },
  );

  function dropSlot(e: PointerEvent, index: number): EquipSlotId | undefined {
    const at = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]')
      ?.dataset.slot;
    const item = state.inventory[index];
    return item && slotsFor(item.slot).find((p) => p === at);
  }

  /** A dragged item marks a position as a target only if it fits and its realm is reached. */
  function canDrop(item: Item | undefined, slot: EquipSlotId): boolean {
    return item?.slot === EQUIP_SLOTS[slot].takes && !equipBlock(state.cultivator, item);
  }

  function overCharacter(e: PointerEvent): boolean {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    return !!target && character.box.contains(target);
  }

  /** Adds new drops to the top of the live log, so a screen reader reads only those. */
  function logDrops(items: Item[]): void {
    if (!items.length) return;
    noDrops.remove();
    recent.unshift(...items);
    recent.splice(RECENT_DROPS);
    drops.prepend(...items.map(dropLine));
    while (drops.children.length > RECENT_DROPS) drops.lastElementChild?.remove();
  }

  function dropLine(item: Item): HTMLElement {
    const text = t('drops.line', { name: tn('item', item.name), grade: gradeName(item.grade) });
    return el('li', `grade-${item.grade}`, text);
  }

  /** Spending controls: their costs and whether they can be paid change with every kill. */
  function drawShop(): void {
    const c = state.cultivator;
    kStones.value.textContent = String(state.stones);
    kEssence.value.textContent = String(state.essence);

    const bag = bagCost(state);
    setButton(
      bagBtn,
      bag === null ? t('inventory.bagFull') : t('inventory.buyBag', { n: BAG_ROW, cost: bag }),
      bag === null || state.stones < bag,
    );

    const reset = respecView(statResetCost(c), state.stones, !canResetStats(c));
    setButton(resetBtn, t('respec.reset'), reset.off);
    setText(resetLine.cost, reset.cost);
    setText(resetLine.why, reset.why);
    const others = (Object.keys(PATHS) as PathId[]).filter((p) => p !== c.path);
    const pathKey = others.join();
    if (pathPick.dataset.paths !== pathKey) {
      pathPick.dataset.paths = pathKey;
      pathPick.replaceChildren(
        ...others.map((p) => {
          const o = el('option', '', tn('path', PATHS[p].name));
          o.value = p;
          return o;
        }),
      );
    }
    const change = respecView(pathChangeCost(c), state.stones);
    setButton(pathBtn, t('respec.change'), change.off);
    setText(pathLine.cost, change.cost);
    setText(pathLine.why, change.why);

    setText(insightCount, String(state.insight));
    setText(retiredText, t('retire.count', { n: state.retirements }));
    for (const id of PASSIVE_IDS) {
      const view = passiveRow(state.passives, state.insight, id);
      const r = passiveRows[id];
      if (r.row.dataset.state !== view.state) r.row.dataset.state = view.state;
      setText(r.name, view.name);
      setText(r.rank, view.rank);
      setText(r.detail, view.detail);
      setButton(r.buy, view.buy, view.state !== 'can');
      if (r.buy.getAttribute('aria-label') !== view.buyName)
        r.buy.setAttribute('aria-label', view.buyName);
    }
    const preview = retirePreview(state);
    if (reward.dataset.insight !== String(preview.insight)) {
      reward.dataset.insight = String(preview.insight);
      if (preview.insight > 0) {
        reward.replaceChildren(
          `+${preview.insight}`,
          gem(),
          el('span', 'sr-only', ` ${t('retire.insight')}`),
        );
      } else {
        reward.replaceChildren(el('span', 'muted', t('retire.locked')));
      }
    }
    setButton(retireBtn, retireLabel(preview), !canRetire(state));
    drawRetire();

    // Shown once, highlighted while there are points to spend.
    const none = c.unspent === 0;
    if (base.classList.contains('none') !== none) base.classList.toggle('none', none);
    setText(unspentText, none ? t('stats.noUnspent') : t('stats.unspent', { n: c.unspent }));

    // The form shows the saved filter; the player's own change already matches it.
    const f = state.filter;
    if (minGrade.select.value !== f.minGrade) minGrade.select.value = f.minGrade;
    if (actionPick.select.value !== f.action) actionPick.select.value = f.action;
    for (const id of ITEM_TYPES) typeBoxes[id].checked = f.slots.includes(id);
  }

  function drawTools(): void {
    const n = notices.state();
    setButton(noticeBtn, t(n === 'blocked' ? 'menu.blocked' : 'menu.notify'), n === 'blocked');
    noticeBtn.setAttribute('aria-pressed', String(n === 'on'));
    if (n === 'blocked') noticeBtn.title = t('menu.blockedHint');
    else noticeBtn.removeAttribute('title');
    setButton(popBtn, t(pip ? 'tools.closePopOut' : 'tools.popOut'), false);
  }

  /** Title, favicon and the pop-out's status line, refreshed while the tab is in the background too. */
  function drawHud(): void {
    const c = state.cultivator;
    const due = tribulationCall(state) !== null;
    const title = tabTitle(state.floor, unseen.count, due);
    if (document.title !== title) document.title = title;
    // A Heaven-or-better drop blinks the favicon's dot, flipping on each redraw at most
    // every BLINK_MS: about once a second in a throttled background tab, and on each
    // (rarer) step under heavier throttling. Held still for reduced motion.
    const now = performance.now();
    if (unseen.mark && !reducedMotion.matches && now - blinkAt >= BLINK_MS) {
      blinkOn = !blinkOn;
      blinkAt = now;
    }
    const dot = blinkOn || reducedMotion.matches ? unseen.mark : null;
    setFavicon(document, faviconHref(c.hp / derive(c).maxHp, dot));
    if (pip) {
      miniLine.textContent = miniStatus(state.floor, realmLabel(c.level), unseen.count, due);
      miniLine.classList.toggle('due', due);
      if (pip.document.title !== title) pip.document.title = title;
    }
  }

  /** Counts drops the player has not seen yet, and notifies on an Immortal one. */
  function noteDrops(items: Item[]): void {
    const latest = items[0];
    if (latest) {
      miniToast.className = `toast grade-${latest.grade}`;
      miniToast.textContent = dropToast(latest);
    }
    const noted = noteUnseen(unseen, items, document.hidden);
    if (noted.unseen.mark && !unseen.mark) {
      // A new mark starts lit, for a full blink before it first goes dark.
      blinkOn = true;
      blinkAt = performance.now();
    }
    unseen = noted.unseen;
    if (noted.notify) notices.show(immortalNotice(state.floor));
  }

  /** Puts the strip back above the summary chips, unless this run has ended. */
  function restoreStrip(): void {
    if (!signal.aborted && !game.contains(strip)) beside.before(strip);
  }

  async function togglePopOut(): Promise<void> {
    if (opening) return;
    if (pip) {
      pip.close();
      return;
    }
    opening = true;
    const opened = await popOut(
      window,
      () => {
        mini.replaceChildren(miniFile, strip, miniLine, miniToast);
        return mini;
      },
      (closed) => {
        // Only the open pop-out's own close counts.
        if (pip !== closed) return;
        pip = null;
        restoreStrip();
        drawTools();
      },
    );
    opening = false;
    if (!opened || opened.closed || signal.aborted) {
      // Refused, failed, closed at once, or the run ended while the browser answered.
      opened?.close();
      restoreStrip();
      return;
    }
    pip = opened;
    drawTools();
    drawHud();
  }
  signal.addEventListener('abort', () => pip?.close());
  // Match system follows the OS while the game is open.
  osDark.addEventListener('change', applyTheme, { signal });

  // A Reset progress in another tab deletes the save: this tab stops its run
  // too, so its autosave can't write the old state back.
  window.addEventListener(
    'storage',
    (e) => {
      if (storage && (e.key === null || e.key === SAVE_KEY) && e.newValue === null) {
        start(root, storage);
      }
    },
    { signal },
  );

  // Looking at the tab again clears the count and the favicon's dot.
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) return;
      unseen = NOTHING_UNSEEN;
      drawHud();
    },
    { signal },
  );

  function draw(prev: GameState | null): void {
    drawStrip(prev);
    drawSummary();
    drawGear();
    drawShop();
    const handled = [];
    if (state.dropsSold > 0) handled.push(t('drops.soldOnPickup', { n: state.dropsSold }));
    if (state.dropsSalvaged > 0) {
      handled.push(t('drops.salvagedOnPickup', { n: state.dropsSalvaged }));
    }
    handledText.textContent = handled.join(' · ');
    drawHud();
  }

  /**
   * A language switch: every fixed text again, then every drawn one. Drawn
   * parts that skip unchanged state are made to draw in full.
   */
  let liveTimer = 0;
  function relabel(): void {
    // Rewritten, not new: the live regions stay quiet while their text changes.
    const live = [drops, pageText, miniToast];
    for (const node of live) node.setAttribute('aria-live', 'off');
    // A second switch inside the window restarts it.
    clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => {
      for (const node of live) node.setAttribute('aria-live', 'polite');
    }, LIVE_QUIET_MS);
    for (const fn of labels) fn();
    if (pip) pip.document.documentElement.lang = document.documentElement.lang;
    drawnGear = drawnDetails = '';
    delete pathPick.dataset.paths;
    delete reward.dataset.insight;
    drops.replaceChildren(...recent.map(dropLine));
    if (!confirmBox.hidden) askSellBelow(pending?.grade ?? (below.select.value as GradeId), false);
    drawRetire();
    drawTools();
    draw(null);
  }

  drawTools();
  draw(null);

  // Time-based: each step plays the real time since the last one, so a
  // throttled background tab still makes the same progress.
  let last = performance.now();
  function step(): void {
    const now = performance.now();
    const prev = state;
    state = tick(state, (now - last) / 1000);
    last = now;
    const fresh = freshDrops(prev, state);
    logDrops(fresh);
    noteDrops(fresh);
    if (document.hidden && tribulationFellDue(prev, state)) {
      notices.show(tribulationNotice(state.floor));
    }
    draw(prev);
  }

  /** Plays up to now, then saves, so the stamp and the state agree. */
  function save(): void {
    if (!storage) return;
    step();
    writeSave(storage, state, Date.now());
  }

  scope.every(TICK_MS, step);
  scope.every(FRAME_TICK_MS, drawSprites);
  autosave(scope, save, { doc: document, win: window }, SAVE_MS);
}
