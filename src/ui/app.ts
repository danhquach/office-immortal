// The page: a saved run (after its Overtime Cultivation catch-up) or the
// first-run Path choice, then the combat strip, KPI tiles, character panel,
// inventory grid, item details and recent drops (docs/design.md §5, §6, §10,
// §14). Text reaches the page only through textContent. The sim decides
// everything; this file only shows state, passes the player's equip choices
// back in and saves.

import { derive, PATHS, type PathId } from '../core/cultivator.ts';
import {
  defaultSlot,
  EQUIP_SLOTS,
  GRADES,
  quality,
  slotsFor,
  type EquipSlotId,
  type Item,
} from '../core/loot.ts';
import { catchUp, offlineSeconds, type OvertimeSummary } from '../core/offline.ts';
import { equip, INVENTORY_SIZE, newGame, tick, type GameState } from '../core/sim.ts';
import { browserStorage, loadSave, writeSave, type SaveStorage } from '../storage/save.ts';
import { autosave, runs } from './run.ts';
import {
  cellLabel,
  compareToEquipped,
  freshDrops,
  gridMove,
  itemLines,
  itemTag,
  overtimeLines,
  PATH_BLURBS,
  SLOT_CODES,
  statRows,
  waveLabel,
  xpLabel,
} from './view.ts';

const TICK_MS = 200;
const SAVE_MS = 10_000;
/** Shorter times away (a reload, a quick tab switch) get no summary. */
const SUMMARY_MIN_SECONDS = 60;
const RECENT_DROPS = 8;
/** How far the mouse must move with the button down before a press becomes a drag. */
const DRAG_START_PX = 5;
const SLOT_IDS = Object.keys(EQUIP_SLOTS) as EquipSlotId[];

type Tag = keyof HTMLElementTagNameMap;

function el<K extends Tag>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
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
  root.replaceChildren(
    titleBar(),
    pathChoice((path) => play(root, newGame(newSeed(), path), storage, null)),
  );
  root.querySelector<HTMLButtonElement>('.paths button')?.focus();
}

function titleBar(): HTMLElement {
  const bar = el('header', 'titlebar');
  bar.append(el('h1', 'file', 'Q3_Cultivation_Report'), el('span', 'muted', 'Office Immortal'));
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

interface Fighter {
  box: HTMLElement;
  name: HTMLElement;
  sprite: HTMLElement;
  bar: HTMLElement;
  hp: HTMLElement;
}

function fighter(side: 'you' | 'foe'): Fighter {
  const box = el('div', `fighter ${side}`);
  const name = el('div', 'name');
  const sprite = el('div', 'sprite');
  sprite.setAttribute('aria-hidden', 'true');
  const track = el('div', 'bar');
  track.setAttribute('aria-hidden', 'true');
  const bar = el('span');
  track.append(bar);
  const hp = el('div');
  box.append(name, sprite, track, hp);
  return { box, name, sprite, bar, hp };
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
  b.append(el('span', 'grade'), el('span', 'code'), el('span', 'q'));
  return b;
}

/** Shows `item` in a cell, or an empty cell with `emptyText` as its name. */
function fillCell(b: HTMLButtonElement, item: Item | undefined, emptyText: string): void {
  const [grade, code, q] = b.children as unknown as [HTMLElement, HTMLElement, HTMLElement];
  b.className = item ? `cell grade-${item.grade}` : 'cell empty';
  grade.textContent = item ? (GRADES[item.grade].name[0] as string) : '';
  code.textContent = item ? SLOT_CODES[item.slot] : '';
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The figure behind the equipment slots: head and body, drawn in code (no art asset). */
function silhouette(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'figure');
  svg.setAttribute('viewBox', '0 0 100 125');
  svg.setAttribute('aria-hidden', 'true');
  const head = document.createElementNS(SVG_NS, 'circle');
  head.setAttribute('cx', '50');
  head.setAttribute('cy', '15');
  head.setAttribute('r', '9');
  const body = document.createElementNS(SVG_NS, 'path');
  // Shoulders, arms out to the hands, torso, legs.
  body.setAttribute(
    'd',
    'M50 26C40 26 30 27 27 31L16 62L23 65L33 41L34 72L36 121L46 121L49 82L51 82L54 121L64 121' +
      'L66 72L67 41L77 65L84 62L73 31C70 27 60 26 50 26Z',
  );
  svg.append(head, body);
  return svg;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** A mouse or pen: the input that can double-click and drag. */
const finePointer = matchMedia('(pointer: fine)');

/** A short shake on a sprite that just took damage. */
function flash(sprite: HTMLElement): void {
  if (reducedMotion.matches || document.hidden) return;
  sprite.animate(
    [{ transform: 'none' }, { transform: 'translateX(3px)', opacity: 0.4 }, { transform: 'none' }],
    { duration: 250, easing: 'steps(2)' },
  );
}

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
  const fighters = el('div', 'fighters');
  fighters.append(you.box, el('span', 'vs', 'vs'), foe.box);
  strip.append(where, fighters);

  // KPI tiles
  const kpis = el('section', 'kpis');
  kpis.setAttribute('aria-label', 'Summary');
  const kPath = kpi('Path');
  const kLevel = kpi('Level');
  const kFloor = kpi('Floor');
  const kXp = kpi('XP to next level');
  kpis.append(kPath.box, kLevel.box, kFloor.box, kXp.box);

  // Character: a paper doll with each slot where it is worn (the drop target), then stats
  const character = panel('character', 'Character');
  const slots = el('div', 'doll');
  slots.setAttribute('role', 'group');
  slots.setAttribute('aria-label', 'Equipped');
  slots.append(silhouette());
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
  const charTabs = tabs([
    { id: 'gear', label: 'Equipment', body: slots },
    { id: 'stats', label: 'Stats', body: stats },
  ]);
  character.box.append(charTabs.bar, ...charTabs.panels);

  // Inventory grid
  const inventory = panel('inventory', 'Inventory');
  const grid = el('div', 'bag');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Inventory slots. Arrow keys move, Enter shows details.');
  const bagCells: HTMLButtonElement[] = [];
  for (let i = 0; i < INVENTORY_SIZE; i++) {
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
  grid.addEventListener('keydown', (e) => {
    // The column count is set by the stylesheet (fewer on a narrow screen).
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const to = gridMove(cursor, e.key, INVENTORY_SIZE, cols);
    if (to === null) return;
    e.preventDefault();
    setCursor(to);
    bagCells[to]?.focus();
  });
  inventory.box.append(grid);

  // Item details
  const details = panel('details', 'Details');
  const detailBody = el('div');
  details.box.append(detailBody);

  // Recent drops
  const log = panel('log', 'Recent drops');
  const drops = el('ul', 'drops');
  drops.setAttribute('aria-live', 'polite');
  const noDrops = el('p', 'muted', 'Nothing yet.');
  const lost = el('p', 'muted');
  log.box.append(noDrops, drops, lost);

  const columns = el('div', 'columns');
  const mainCol = el('div', 'game side');
  mainCol.append(details.box, log.box);
  columns.append(character.box, inventory.box, mainCol);
  const game = el('div', 'game');
  const away = summary && summary.seconds >= SUMMARY_MIN_SECONDS ? overtimePanel(summary) : null;
  if (away) game.append(away);
  game.append(strip, kpis, columns);
  root.replaceChildren(titleBar(), game);
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
    if (!prev) return;
    // Only replays what the sim decided: a flash where HP went down.
    const before = prev.enemies[0];
    if (enemy && before && prev.enemies.length === state.enemies.length && enemy.hp < before.hp) {
      flash(foe.sprite);
    } else if (state.kills > prev.kills) flash(foe.sprite);
    if (c.hp < prev.cultivator.hp && state.deaths === prev.deaths) flash(you.sprite);
  }

  function drawSummary(): void {
    const c = state.cultivator;
    kPath.value.textContent = PATHS[c.path].name;
    kLevel.value.textContent = String(c.level);
    kFloor.value.textContent = `${state.floor} (best ${state.highestFloor})`;
    kXp.value.textContent = xpLabel(c);
    const rows = [
      { label: 'Body', value: String(c.stats.body) },
      { label: 'Agility', value: String(c.stats.agility) },
      { label: 'Spirit', value: String(c.stats.spirit) },
      ...statRows(c),
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
    const key = `${detailsKey}|${state.inventory.length}`;
    if (key === drawnGear) return;
    drawnGear = key;

    inventory.heading.textContent = `Inventory (${state.inventory.length} / ${INVENTORY_SIZE})`;
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
    const parts: HTMLElement[] = [
      el('div', `title grade-${item.grade}`, item.name),
      el('div', `tag grade-${item.grade}`, itemTag(item)),
      lines,
    ];
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

  function draw(prev: GameState | null): void {
    drawStrip(prev);
    drawSummary();
    drawGear();
    lost.textContent = state.dropsLost > 0 ? `Lost to a full bag: ${state.dropsLost}` : '';
  }

  draw(null);

  // Time-based: each step plays the real time since the last one, so a
  // throttled background tab still makes the same progress.
  let last = performance.now();
  function step(): void {
    const now = performance.now();
    const prev = state;
    state = tick(state, (now - last) / 1000);
    last = now;
    logDrops(freshDrops(prev, state));
    draw(prev);
  }

  /** Plays up to now, then saves, so the stamp and the state agree. */
  function save(): void {
    if (!storage) return;
    step();
    writeSave(storage, state, Date.now());
  }

  scope.every(TICK_MS, step);
  autosave(scope, save, { doc: document, win: window }, SAVE_MS);
}
