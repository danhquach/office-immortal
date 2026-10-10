// The page: a saved run (after its Overtime Cultivation catch-up) or the
// first-run Path choice, then the combat strip, KPI tiles, character panel,
// inventory grid with its auto filter, item details and recent drops
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
  passiveCost,
  PASSIVE_IDS,
  retirePreview,
  type PassiveId,
} from '../core/prestige.ts';
import { equip, newGame, retire, tick, type GameState } from '../core/sim.ts';
import { browserStorage, loadSave, writeSave, type SaveStorage } from '../storage/save.ts';
import {
  dropToast,
  faviconHref,
  GAME_TITLE,
  immortalNotice,
  miniStatus,
  noteUnseen,
  NOTHING_UNSEEN,
  tabTitle,
  type Unseen,
} from './hud.ts';
import { artUrl } from './art.ts';
import { autosave, runs } from './run.ts';
import { advance, request, type Action, type Playing } from './sprite.ts';
import { canPopOut, notifier, popOut, setFavicon } from './tab.ts';
import {
  cellLabel,
  compareToEquipped,
  freshDrops,
  gridMove,
  itemLines,
  itemTag,
  overtimeLines,
  passiveLabel,
  PATH_BLURBS,
  enemySprite,
  iconCell,
  realmLabel,
  retireLabel,
  retireLines,
  sellBelowLabel,
  SPRITE_SIZE,
  statRows,
  stripEvents,
  waveLabel,
  xpLabel,
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
const FILE_NAME = 'Q3_Cultivation_Report';
/** The favicon's drop dot blinks at most this often, well under any flashing threshold. */
const BLINK_MS = 900;
/** How far the mouse must move with the button down before a press becomes a drag. */
const DRAG_START_PX = 5;
const SLOT_IDS = Object.keys(EQUIP_SLOTS) as EquipSlotId[];
const STAT_NAMES: readonly [StatId, string][] = [
  ['body', 'Body'],
  ['agility', 'Agility'],
  ['spirit', 'Spirit'],
];

type Tag = keyof HTMLElementTagNameMap;

function el<K extends Tag>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
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

/** A labelled <select> of `options` ([value, text] pairs). */
function choice(
  label: string,
  options: readonly (readonly [string, string])[],
): { box: HTMLLabelElement; select: HTMLSelectElement } {
  const box = el('label', 'field', label);
  const select = el('select');
  for (const [value, text] of options) {
    const o = el('option', '', text);
    o.value = value;
    select.append(o);
  }
  box.append(select);
  return { box, select };
}

/** Sets text and on/off only when they change, so a redraw every tick never flickers. */
function setButton(b: HTMLButtonElement, text: string, off: boolean): void {
  if (b.textContent !== text) b.textContent = text;
  if (b.getAttribute('aria-disabled') !== String(off)) b.setAttribute('aria-disabled', String(off));
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
  const saved = storage && loadSave(storage);
  if (saved) {
    const { state, summary } = catchUp(saved.state, offlineSeconds(saved.savedAt, Date.now()));
    // play() stamps the save straight away, so a crash can't replay this time twice.
    play(root, state, storage, summary);
    return;
  }
  document.title = GAME_TITLE;
  // No run, no HP ring: the browser's default icon.
  document.querySelector('link[rel="icon"]')?.remove();
  root.replaceChildren(
    titleBar(),
    pathChoice((path) => play(root, newGame(newSeed(), path), storage, null)),
  );
  root.querySelector<HTMLButtonElement>('.paths button')?.focus();
}

function titleBar(): HTMLElement {
  const bar = el('header', 'titlebar');
  bar.append(el('h1', 'file', FILE_NAME), el('span', 'muted', GAME_TITLE));
  return bar;
}

function pathChoice(onPick: (path: PathId) => void): HTMLElement {
  const box = el('section', 'panel choose');
  box.setAttribute('aria-labelledby', 'choose-title');
  const h = el('h2', '', 'Choose your Path');
  h.id = 'choose-title';
  const list = el('div', 'paths');
  for (const id of Object.keys(PATHS) as PathId[]) {
    const b = el('button');
    b.type = 'button';
    b.append(el('strong', '', PATHS[id].name), el('span', 'muted', PATH_BLURBS[id]));
    b.addEventListener('click', () => onPick(id));
    list.append(b);
  }
  box.append(
    h,
    el('p', 'muted', 'Your cultivator fights on their own. Pick how they fight.'),
    list,
  );
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

/** An item's icon from the atlas, at `scale` (1 in a cell, 2 in the details panel). */
function setIcon(icon: HTMLElement, item: Item | undefined, scale = 1): void {
  if (!item) {
    icon.style.backgroundImage = '';
    return;
  }
  const { col, row } = iconCell(item);
  const px = ICON_PX * scale;
  const s = icon.style;
  s.backgroundImage = cssUrl(artUrl('icons'));
  s.backgroundSize = `${px * 8}px ${px * 3}px`;
  s.backgroundPosition = `${-col * px}px ${-row * px}px`;
}

function kpi(label: string): { box: HTMLElement; value: HTMLElement } {
  const box = el('div', 'panel kpi');
  const value = el('span', 'value');
  box.append(el('span', 'label', label), value);
  return { box, value };
}

function panel(className: string, title: string): { box: HTMLElement; heading: HTMLElement } {
  const box = el('section', `panel ${className}`);
  const heading = el('h2', '', title);
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
  grade.textContent = item ? (GRADES[item.grade].name[0] as string) : '';
  setIcon(icon, item);
  q.textContent = item ? `${quality(item)}%` : '';
  b.setAttribute('aria-label', item ? cellLabel(item) : emptyText);
}

/**
 * Tabs inside a panel: one tab stop, arrow keys (and Home / End) switch, only the chosen body
 * shows. The first tab starts selected.
 */
function tabs(list: { id: string; label: string; body: HTMLElement }[]): {
  bar: HTMLElement;
  panels: HTMLElement[];
  show: (id: string) => void;
} {
  const bar = el('div', 'tabs');
  bar.setAttribute('role', 'tablist');
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const show = (id: string): void => {
    list.forEach((t, i) => {
      const on = t.id === id;
      buttons[i]?.setAttribute('aria-selected', String(on));
      if (buttons[i]) buttons[i].tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    });
  };
  list.forEach((t, i) => {
    const b = el('button', 'tab', t.label);
    b.type = 'button';
    b.id = `tab-${t.id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `tabpanel-${t.id}`);
    b.addEventListener('click', () => show(t.id));
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
    panel.id = `tabpanel-${t.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', b.id);
    panel.append(t.body);
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
/** A mouse or pen: the input that can double-click and drag. */
const finePointer = matchMedia('(pointer: fine)');

type Selection = { bag: number } | { slot: EquipSlotId } | null;

/** The Overtime Cultivation summary, dismissed by its button. */
function overtimePanel(summary: OvertimeSummary): HTMLElement {
  const box = el('section', 'panel overtime');
  box.setAttribute('aria-labelledby', 'overtime-title');
  const h = el('h2', '', 'Overtime Cultivation');
  h.id = 'overtime-title';
  const lines = el('ul', 'lines');
  for (const line of overtimeLines(summary)) lines.append(el('li', '', line));
  const ok = el('button', 'primary', 'Back to work');
  ok.type = 'button';
  ok.addEventListener('click', () => box.remove());
  box.append(h, el('p', 'muted', 'Your cultivator kept fighting while you were away.'), lines, ok);
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
  let state = initial;
  let selected: Selection = null;
  /** The bag cell that holds the grid's one tab stop. */
  let cursor = 0;
  /** Bumped by every equip, so gear redraws only when it changes. */
  let gearVersion = 0;
  let drawnGear = '';
  let drawnDetails = '';
  /** A press on a bag item; it becomes a drag (with a ghost) once the mouse moves. */
  let drag: { index: number; x: number; y: number; ghost: HTMLElement | null } | null = null;

  // Combat strip
  const strip = el('section', 'strip');
  strip.setAttribute('aria-label', 'Combat');
  const where = el('div', 'where');
  const floorText = el('span');
  const killText = el('span');
  where.append(floorText, killText);
  const you = fighter('you');
  const foe = fighter('foe');
  // The stage: the zone's tiling background with both sprites on its floor.
  const stage = el('div', 'stage');
  // The enemy that just died plays its death here, behind the next one.
  const corpse = stageSprite('corpse');
  corpse.sprite.hidden = true;
  stage.append(you.sprite, corpse.sprite, foe.sprite);
  const fighters = el('div', 'fighters');
  fighters.append(you.box, el('span', 'vs', 'vs'), foe.box);
  strip.append(where, stage, fighters);
  let zone = '';

  // KPI tiles
  const kpis = el('section', 'kpis');
  kpis.setAttribute('aria-label', 'Summary');
  const kPath = kpi('Path');
  const kRealm = kpi('Realm');
  kRealm.box.classList.add('realm');
  const kLevel = kpi('Level');
  const kFloor = kpi('Floor');
  const kXp = kpi('XP to next level');
  const kStones = kpi('Spirit Stones');
  const kEssence = kpi('Spirit Essence');
  kpis.append(kPath.box, kRealm.box, kLevel.box, kFloor.box, kXp.box, kStones.box, kEssence.box);

  // Character: a paper doll with each slot where it is worn (the drop target), then stats
  const character = panel('character', 'Character');
  const slots = el('div', 'doll');
  slots.setAttribute('role', 'group');
  slots.setAttribute('aria-label', 'Equipped');
  slots.append(figure());
  const slotCells = {} as Record<EquipSlotId, HTMLButtonElement>;
  for (const slot of SLOT_IDS) {
    const box = el('div', `slot slot-${slot}`);
    const b = cell();
    b.dataset.slot = slot;
    b.addEventListener('click', () => select(state.cultivator.equipment[slot] ? { slot } : null));
    slotCells[slot] = b;
    box.append(b, el('span', 'slot-name', EQUIP_SLOTS[slot].name));
    slots.append(box);
  }
  const stats = el('dl', 'stats');
  // Spending stat points taken back by a reset: one row per stat.
  const points = el('div', 'points');
  const pointsText = el('p');
  points.append(pointsText);
  for (const [id, name] of STAT_NAMES) {
    const row = el('div', 'row');
    const one = button(`+1 ${name}`, '', () => spend(id, 1));
    const all = button(`All to ${name}`, '', () => spend(id, state.cultivator.unspent));
    row.append(one, all);
    points.append(row);
  }
  const resetBtn = button('', '', () => act(resetStats(state)));
  const pathPick = choice('New Path', []);
  const pathBtn = button('', '', () => {
    const to = pathPick.select.value as PathId;
    if (to) act(changePath(state, to));
  });
  const shopNote = el('p', 'muted hint');
  const statsBody = el('div');
  const pathRow = el('div', 'row');
  pathRow.append(pathPick.box, pathBtn);
  statsBody.append(stats, points, resetBtn, pathRow, shopNote);

  // Early Retirement: the Dao Insight shop, then the retire button and its
  // confirmation listing what is kept and what is lost.
  const insightText = el('p');
  const passiveBtns = {} as Record<PassiveId, HTMLButtonElement>;
  const passiveList = el('div', 'passives');
  for (const id of PASSIVE_IDS) {
    passiveBtns[id] = button('', '', () => act(buyPassive(state, id)));
    passiveList.append(passiveBtns[id]);
  }
  // The lists follow the run while open (every kill changes the Spirit Stones
  // lost), so they are not a live region: the Retire button is described by
  // them instead, and focus lands there.
  const retireBox = el('div', 'confirm');
  const keptList = el('ul', 'lines');
  const keptHead = el('p', '', 'Retire early? You keep:');
  keptHead.id = 'retire-kept';
  keptList.id = 'retire-kept-list';
  const lostHead = el('p', '', 'You lose:');
  lostHead.id = 'retire-lost';
  const lostList = el('ul', 'lines');
  lostList.id = 'retire-lost-list';
  const retireYes = button('Retire', 'primary', () => {
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
  const retireNo = button('Cancel', '', () => {
    retireBox.hidden = true;
    retireBtn.focus();
  });
  retireBox.append(keptHead, keptList, lostHead, lostList, retireYes, retireNo);
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
  const retireBody = el('div', 'retire');
  retireBody.append(
    insightText,
    passiveList,
    el(
      'p',
      'muted hint',
      'Retiring starts again at floor 1, level 1 and pays Dao Insight for the highest floor ' +
        'reached. Passives last through every run.',
    ),
    retireBtn,
    retireBox,
  );

  const charTabs = tabs([
    { id: 'gear', label: 'Equipment', body: slots },
    { id: 'stats', label: 'Stats', body: statsBody },
    { id: 'retire', label: 'Retirement', body: retireBody },
  ]);
  character.box.append(charTabs.bar, ...charTabs.panels);

  // Inventory grid
  const inventory = panel('inventory', 'Inventory');
  const grid = el('div', 'bag');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Inventory slots. Arrow keys move, Enter shows details.');
  const bagCells: HTMLButtonElement[] = [];
  /** Adds cells until the grid matches the bag; a bag upgrade adds a row. */
  function growBag(): void {
    for (let i = bagCells.length; i < state.bagSize; i++) {
      const b = cell();
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener('click', () => {
        setCursor(i);
        select(state.inventory[i] ? { bag: i } : null);
        if (selected) revealDetails();
      });
      b.addEventListener('dblclick', () => {
        if (state.inventory[i]) equipFromBag(i);
      });
      b.addEventListener('pointerdown', (e) => startPress(e, i));
      bagCells.push(b);
      grid.append(b);
    }
  }
  grid.addEventListener('keydown', (e) => {
    // The column count is set by the stylesheet (fewer on a narrow screen).
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const to = gridMove(cursor, e.key, state.bagSize, cols);
    if (to === null) return;
    e.preventDefault();
    setCursor(to);
    bagCells[to]?.focus();
  });

  // Bulk sell: pick a grade, then confirm a message naming the count and the
  // highest grade sold.
  const below = choice(
    'Sell everything below',
    GRADE_IDS.slice(1).map((g) => [g, GRADES[g].name] as const),
  );
  /** The grade and preview the player is confirming; null when no confirmation is open. */
  let pending: { grade: GradeId; text: string } | null = null;
  const confirmBox = el('div', 'confirm');
  confirmBox.setAttribute('role', 'alert');
  const confirmText = el('p');
  const confirmYes = button('Sell', 'primary', () => {
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
  const confirmNo = button('Cancel', '', () => {
    closeConfirm();
    sellBelowBtn.focus();
  });
  confirmBox.append(confirmText, confirmYes, confirmNo);
  confirmBox.hidden = true;
  const sellBelowBtn = button('Sell…', '', () => askSellBelow(below.select.value as GradeId));
  below.select.addEventListener('change', closeConfirm);
  function askSellBelow(grade: GradeId): void {
    const preview = sellBelowPreview(state, grade);
    const text = sellBelowLabel(preview);
    pending = preview.count > 0 ? { grade, text } : null;
    confirmText.textContent = text;
    confirmYes.hidden = !pending;
    confirmNo.textContent = pending ? 'Cancel' : 'OK';
    confirmBox.hidden = false;
    (pending ? confirmYes : confirmNo).focus();
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
  const bagBody = el('div');
  bagBody.append(grid, bagTools);

  // Auto filter: a minimum grade, the item types kept, and what happens to the rest.
  const minGrade = choice(
    'Keep drops of grade',
    GRADE_IDS.map((g, i) => [g, i === 0 ? 'Any grade' : `${GRADES[g].name} and above`] as const),
  );
  const actionPick = choice('Drops that fail are', [
    ['sell', 'Sold for Spirit Stones'],
    ['salvage', 'Salvaged into Spirit Essence'],
  ]);
  const types = el('fieldset', 'types');
  types.append(el('legend', '', 'Keep these item types'));
  const typeBoxes = {} as Record<SlotId, HTMLInputElement>;
  for (const id of ITEM_TYPES) {
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    typeBoxes[id] = box;
    label.append(box, ` ${SLOTS[id].name}`);
    types.append(label);
  }
  const filterNote = el('p', 'muted hint', 'A full bag always sells what does not fit.');
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
    { id: 'bag', label: 'Bag', body: bagBody },
    { id: 'filter', label: 'Auto filter', body: filterBody },
  ]);
  inventory.box.append(bagTabs.bar, ...bagTabs.panels);

  // Item details
  const details = panel('details', 'Details');
  const detailBody = el('div');
  details.box.append(detailBody);

  // Recent drops
  const log = panel('log', 'Recent drops');
  const drops = el('ul', 'drops');
  drops.setAttribute('aria-live', 'polite');
  const noDrops = el('p', 'muted', 'Nothing yet.');
  const handledText = el('p', 'muted');
  log.box.append(noDrops, drops, handledText);

  const columns = el('div', 'columns');
  const mainCol = el('div', 'game side');
  mainCol.append(details.box, log.box);
  columns.append(character.box, inventory.box, mainCol);
  const game = el('div', 'game');
  const away = summary && summary.seconds >= SUMMARY_MIN_SECONDS ? overtimePanel(summary) : null;
  if (away) game.append(away);
  game.append(strip, kpis, columns);
  // Tab HUD, pop-out and notification controls
  const tools = el('div', 'tools');
  const notices = notifier(window);
  const noticeBtn = button('', '', () => {
    void notices.toggle().then(() => drawTools());
  });
  const popBtn = button('Pop out', '', () => void togglePopOut());
  // Each control is left out where the browser lacks its feature.
  if (canPopOut(window)) tools.append(popBtn);
  if (notices.state() !== 'unsupported') tools.append(noticeBtn);
  const bar = titleBar();
  bar.append(tools);

  // Mini view, shown in the pop-out: the strip moves in, plus one status line and the latest drop.
  const mini = el('div', 'mini');
  const miniLine = el('p', 'status');
  const miniToast = el('p', 'toast muted', 'No drops yet.');
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

  root.replaceChildren(bar, game);
  away?.querySelector('button')?.focus();

  function setFighter(f: Fighter, name: string, hp: number, maxHp: number): void {
    f.name.textContent = name;
    f.hp.textContent = `HP ${Math.max(0, Math.ceil(hp))} / ${maxHp}`;
    f.bar.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
  }

  function drawStrip(prev: GameState | null): void {
    const c = state.cultivator;
    const enemy = state.enemies[0];
    floorText.textContent = `Floor ${state.floor} · ${waveLabel(state)}`;
    killText.textContent = `Kills ${state.kills}`;
    setFighter(you, PATHS[c.path].name, c.hp, derive(c).maxHp);
    if (enemy) {
      foe.box.dataset.kind = enemy.kind;
      setFighter(foe, enemy.name, enemy.hp, enemy.maxHp);
    }
    const z = zoneOf(state.floor);
    if (z !== zone) {
      zone = z;
      stage.style.backgroundImage = cssUrl(artUrl(`bg-${z}`));
    }
    useSheet(you, `path-${c.path}`, SPRITE_SIZE.path);
    if (prev) {
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
    kPath.value.textContent = PATHS[c.path].name;
    kRealm.value.textContent = realmLabel(c.level);
    kLevel.value.textContent = String(c.level);
    kFloor.value.textContent = `${state.floor} (best ${state.highestFloor})`;
    kXp.value.textContent = xpLabel(c);
    const rows = [
      { label: 'Body', value: String(c.stats.body) },
      { label: 'Agility', value: String(c.stats.agility) },
      { label: 'Spirit', value: String(c.stats.spirit) },
      ...statRows(c, state.passives),
    ];
    // Built once, then only the values change, so selecting text doesn't flicker.
    if (!stats.firstChild) {
      stats.append(...rows.flatMap((r) => [el('dt', '', r.label), el('dd')]));
    }
    stats.querySelectorAll('dd').forEach((dd, i) => {
      const value = rows[i]?.value ?? '';
      if (dd.textContent !== value) dd.textContent = value;
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
    const key = `${detailsKey}|${state.inventory.length}|${state.bagSize}`;
    if (key === drawnGear) return;
    drawnGear = key;

    growBag();
    inventory.heading.textContent = `Inventory (${state.inventory.length} / ${state.bagSize})`;
    bagCells.forEach((b, i) => {
      fillCell(b, state.inventory[i], `Empty slot ${i + 1}`);
      b.setAttribute('aria-pressed', String(!!selected && 'bag' in selected && selected.bag === i));
    });
    for (const slot of SLOT_IDS) {
      const b = slotCells[slot];
      fillCell(b, c.equipment[slot], `${EQUIP_SLOTS[slot].name}: empty`);
      // fillCell resets classes; a drag in progress keeps its target slots marked.
      b.classList.toggle(
        'target',
        !!drag?.ghost && state.inventory[drag.index]?.slot === EQUIP_SLOTS[slot].takes,
      );
      b.setAttribute(
        'aria-pressed',
        String(!!selected && 'slot' in selected && selected.slot === slot),
      );
    }
  }

  function drawDetails(): void {
    const item = selectedItem();
    if (!item || !selected) {
      detailBody.replaceChildren(el('p', 'muted', 'Select an item to see its details.'));
      return;
    }
    const lines = el('ul', 'lines');
    for (const line of itemLines(item)) lines.append(el('li', '', line));
    const head = el('div', 'item-head');
    const icon = el('span', 'icon big');
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, item, 2);
    head.append(icon, el('div', `title grade-${item.grade}`, item.name));
    const parts: HTMLElement[] = [head, el('div', `tag grade-${item.grade}`, itemTag(item)), lines];
    if ('slot' in selected) {
      parts.push(el('p', 'muted', 'Equipped.'));
    } else {
      const index = selected.bag;
      // One comparison and Equip button per position the item fits (two for
      // accessories and charms), the default position first.
      const fits = slotsFor(item.slot);
      const first = defaultSlot(state.cultivator.equipment, item);
      for (const to of [first, ...fits.filter((p) => p !== first)]) {
        const name = EQUIP_SLOTS[to].name;
        const current = state.cultivator.equipment[to];
        const diff = compareToEquipped(state.cultivator, item, to);
        const compare = el('ul', 'compare');
        for (const d of diff) compare.append(el('li', d.better ? 'up' : 'down', d.text));
        if (!diff.length) compare.append(el('li', 'muted', 'No change'));
        const equipBtn = el('button', 'primary', fits.length > 1 ? `Equip in ${name}` : 'Equip');
        equipBtn.type = 'button';
        equipBtn.addEventListener('click', () => equipFromBag(index, to));
        parts.push(
          el('h3', '', current ? `In ${name}, vs ${current.name}:` : `In ${name} (empty):`),
          compare,
          equipBtn,
        );
      }
      if (finePointer.matches) {
        parts.push(el('p', 'muted hint', 'Or double-click it, or drag it onto your character.'));
      }
      const row = el('div', 'row');
      const sellBtn = button(`Sell for ${sellPrice(item)} Spirit Stones`, '', () =>
        dispose(index, 'sell'),
      );
      sellBtn.dataset.action = 'sell';
      const salvageBtn = button(`Salvage for ${essenceValue(item)} Spirit Essence`, '', () =>
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
    if (!item) return;
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
   * Sells or salvages the bag item at `index`. The selection stays on that
   * cell, so the next item can be handled straight away; focus stays on the
   * same button, or goes to the cell when the bag has nothing left there.
   */
  function dispose(index: number, action: 'sell' | 'salvage'): void {
    const next = (action === 'sell' ? sell : salvage)(state, index);
    selected = next.inventory[index] ? { bag: index } : null;
    act(next);
    const again = detailBody.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (again) again.focus();
    else {
      setCursor(index);
      bagCells[index]?.focus();
    }
  }

  function spend(stat: StatId, n: number): void {
    if (n < 1) return;
    act(spendPoints(state, stat, n));
    // The point buttons hide once every point is spent; keep focus in the panel.
    if (state.cultivator.unspent === 0 && points.contains(document.activeElement)) resetBtn.focus();
  }

  // Drag to equip, for mouse and pen. Touch has tap to select and the Equip
  // button instead, so swiping over the grid still scrolls the page.

  function startPress(e: PointerEvent, index: number): void {
    if (e.pointerType === 'touch' || e.button !== 0 || !state.inventory[index]) return;
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
        const ghost = bagCells[drag.index]?.cloneNode(true) as HTMLElement;
        ghost.classList.add('ghost');
        ghost.setAttribute('aria-hidden', 'true');
        document.body.append(ghost);
        document.body.classList.add('dragging');
        for (const p of slotsFor(item.slot)) slotCells[p].classList.add('target');
        drag.ghost = ghost;
      }
      drag.ghost.style.left = `${e.clientX}px`;
      drag.ghost.style.top = `${e.clientY}px`;
      character.box.classList.toggle('drop-ok', overCharacter(e));
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

  function overCharacter(e: PointerEvent): boolean {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    return !!target && character.box.contains(target);
  }

  /** Adds new drops to the top of the live log, so a screen reader reads only those. */
  function logDrops(items: Item[]): void {
    if (!items.length) return;
    noDrops.remove();
    drops.prepend(
      ...items.map((item) =>
        el('li', `grade-${item.grade}`, `${item.name} — ${GRADES[item.grade].name}`),
      ),
    );
    while (drops.children.length > RECENT_DROPS) drops.lastElementChild?.remove();
  }

  /** Spending controls: their costs and whether they can be paid change with every kill. */
  function drawShop(): void {
    const c = state.cultivator;
    kStones.value.textContent = String(state.stones);
    kEssence.value.textContent = String(state.essence);

    const bag = bagCost(state);
    setButton(
      bagBtn,
      bag === null ? 'Bag is full size' : `Buy ${BAG_ROW} more bag slots: ${bag} Spirit Stones`,
      bag === null || state.stones < bag,
    );

    const reset = statResetCost(c);
    setButton(
      resetBtn,
      `Reset stat points: ${reset} Spirit Stones`,
      state.stones < reset || !canResetStats(c),
    );
    const others = (Object.keys(PATHS) as PathId[]).filter((p) => p !== c.path);
    const pathKey = others.join();
    if (pathPick.select.dataset.paths !== pathKey) {
      pathPick.select.dataset.paths = pathKey;
      pathPick.select.replaceChildren(
        ...others.map((p) => {
          const o = el('option', '', PATHS[p].name);
          o.value = p;
          return o;
        }),
      );
    }
    const change = pathChangeCost(c);
    setButton(pathBtn, `Change Path: ${change} Spirit Stones`, state.stones < change);
    shopNote.textContent =
      'A Path change puts every stat point into the new Path’s primary stat. A reset takes ' +
      'them back to spend as you choose.';

    insightText.textContent = `Dao Insight: ${state.insight} · Retirements: ${state.retirements}`;
    for (const id of PASSIVE_IDS) {
      const cost = passiveCost(state.passives, id);
      setButton(
        passiveBtns[id],
        passiveLabel(state.passives, id),
        cost === null || state.insight < cost,
      );
    }
    setButton(retireBtn, retireLabel(retirePreview(state)), !canRetire(state));
    drawRetire();

    points.hidden = c.unspent === 0;
    pointsText.textContent = `Unspent stat points: ${c.unspent}`;

    // The form shows the saved filter; the player's own change already matches it.
    const f = state.filter;
    if (minGrade.select.value !== f.minGrade) minGrade.select.value = f.minGrade;
    if (actionPick.select.value !== f.action) actionPick.select.value = f.action;
    for (const id of ITEM_TYPES) typeBoxes[id].checked = f.slots.includes(id);
  }

  function drawTools(): void {
    const n = notices.state();
    setButton(
      noticeBtn,
      n === 'blocked' ? 'Notifications blocked' : 'Notify on Immortal drops',
      n === 'blocked',
    );
    noticeBtn.setAttribute('aria-pressed', String(n === 'on'));
    if (n === 'blocked') noticeBtn.title = 'Allow notifications in your browser settings.';
    else noticeBtn.removeAttribute('title');
    setButton(popBtn, pip ? 'Close pop-out' : 'Pop out', false);
  }

  /** Title, favicon and the pop-out's status line, refreshed while the tab is in the background too. */
  function drawHud(): void {
    const c = state.cultivator;
    const title = tabTitle(state.floor, unseen.count);
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
      miniLine.textContent = miniStatus(state.floor, realmLabel(c.level), unseen.count);
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

  /** Puts the strip back above the KPI tiles, unless this run has ended. */
  function restoreStrip(): void {
    if (!signal.aborted && !game.contains(strip)) kpis.before(strip);
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
        mini.replaceChildren(el('div', 'file', FILE_NAME), strip, miniLine, miniToast);
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
    if (state.dropsSold > 0) handled.push(`Sold on pickup: ${state.dropsSold}`);
    if (state.dropsSalvaged > 0) handled.push(`Salvaged on pickup: ${state.dropsSalvaged}`);
    handledText.textContent = handled.join(' · ');
    drawHud();
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
