// The page: a saved run (after its Overtime Cultivation catch-up) or the
// first-run Path choice, then the combat strip with its XP bar, the summary
// chips and recent drops beside it, character panel, inventory grid with its
// auto filter and item details
// (docs/design.md §5–§8, §10, §14). Text reaches the page only through
// textContent. The sim decides everything; this file only shows state, passes
// the player's choices (equip, sell, salvage, filter, spending) back in and
// saves.

import {
  derive,
  PATHS,
  realmOf,
  type Derived,
  type PathId,
  type StatId,
} from '../core/cultivator.ts';
import {
  BAG_ROW,
  bagCost,
  buyBagSpace,
  canResetStats,
  answerFreeReset,
  applyPlan,
  changePath,
  disposeItem,
  essenceValue,
  GRADE_IDS,
  refine,
  refineReach,
  rerollAffix,
  pathChangeCost,
  resetStats,
  setAutoAssign,
  setPlanRatio,
  bulkPreview,
  bagStillShows,
  bulkConfirm,
  type BulkPreview,
  sellPrice,
  setFilter,
  // Item types, not the equipment positions this file calls SLOT_IDS.
  SLOT_IDS as ITEM_TYPES,
  spendPoints,
  statResetCost,
  type BulkAction,
  type FilterAction,
  type ItemAt,
} from '../core/economy.ts';
import {
  defaultSlot,
  EQUIP_SLOTS,
  SLOTS,
  slotsFor,
  type EquipSlotId,
  type GradeId,
  type Item,
  type SlotId,
} from '../core/loot.ts';
import { maxQi, zoneOf } from '../core/floors.ts';
import { catchUp, offlineSeconds, type OvertimeSummary } from '../core/offline.ts';
import { pathSkillList } from '../core/path-skills.ts';
import {
  BOOST_IDS,
  boostBonus,
  buyOffer,
  refreshStore,
  STOCK_SIZE,
  storeStale,
  syncStore,
} from '../core/store.ts';
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
  unequip,
  faceTribulation,
  setAutoTribulation,
  trialSetAside,
  newGame,
  retire,
  tick,
  type GameState,
} from '../core/sim.ts';
import { createCloud, type CloudMessage } from '../storage/cloud.ts';
import { readCloudConfig } from '../storage/cloud-config.ts';
import { ADOPT_KEY } from '../storage/cloud-meta.ts';
import {
  browserIdb,
  clearBoth,
  idbBackup,
  loadNewest,
  writeBoth,
  type Backup,
} from '../storage/backup.ts';
import {
  CODE_HASH,
  LINK_HASH,
  readFrameConfig,
  type FrameConfig,
} from '../storage/frame-config.ts';
import {
  loadFramed,
  openFrame,
  withFallbackCopy,
  type FrameLink,
} from '../storage/frame-client.ts';
import {
  browserStorage,
  encodeSave,
  isNewerSave,
  loadSave,
  SAVE_KEY,
  writeRaw,
  type Save,
  type SaveStorage,
} from '../storage/save.ts';
import type { DebugTick } from '../dev/panel.ts';
import { clearDebugged, DEBUG_KEY, debugged, markDebugged } from './debug-flag.ts';
import { createSync, type Sync, type SyncStatus } from '../storage/sync.ts';
import { exportCode, importCode } from '../storage/transfer.ts';
import {
  dropToast,
  faviconHref,
  sheetFaviconHref,
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
  cloudStatusLine,
  cloudText,
  frameStep,
  linkCodeLine,
  needsChoice,
  saveSummary,
} from './cloud-view.ts';
import { showCodeLine } from './code-line.ts';
import {
  enemyNameParts,
  yellText,
  lang,
  nameSpans,
  PACKS,
  plainName,
  readLang,
  setLang,
  t,
  tn,
  writeLang,
  type MessageKey,
  type NamePart,
} from './i18n.ts';
import { autosave, runs, type RunScope } from './run.ts';
import { type Fold, type Folds, readFolds, writeFolds } from './fold.ts';
import { pickTheme, readTheme, showTheme, type Theme, writeTheme } from './theme.ts';
import {
  gradeInitial,
  gradeName,
  isDiscreet,
  isDiscreetKey,
  readDiscreet,
  setDiscreet,
  writeDiscreet,
} from './discreet.ts';
import {
  pickPopStyle,
  POP_STYLES,
  readPopStyle,
  type PopStyle,
  writePopStyle,
} from './pop-style.ts';
import { placeYell, type Box } from './yell.ts';
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
  CHECK_EVERY_MS,
  createUpdater,
  holdsStart,
  IMPORT_KEY,
  isBuildId,
  servedBuild,
  takeKept,
  updateStep,
} from './update.ts';
import {
  arraySetUp,
  BAG_PAGE,
  bagPage,
  cellLabel,
  characterStatusLabel,
  chestOrder,
  compareGroups,
  compareToEquipped,
  equipBlock,
  itemFacts,
  unequipBlock,
  freshDrops,
  gridMove,
  cardPlace,
  CARD_EDGE,
  CARD_NARROW,
  CARD_WIDTH,
  itemLineGroups,
  itemName,
  itemTag,
  qualityLine,
  refineMark,
  refineAction,
  refinePreview,
  refineResult,
  rerollAction,
  rerollConfirm,
  rerollResult,
  affixText,
  CRAFT_MODES,
  type CraftMode,
  gearVerdict,
  type GearVerdict,
  overtimeView,
  pageOf,
  passiveRow,
  pathBlurb,
  soulsLine,
  DOLL_COLUMNS,
  enemySprite,
  ICON_COLUMNS,
  ICON_ROWS,
  iconCell,
  realmLabel,
  realmMist,
  realmBoost,
  realmBoostTip,
  realmRows,
  retireLabel,
  SUMMARY_ICONS,
  summaryIcon,
  boostChip,
  boostLines,
  offerCard,
  refreshView,
  STORE_ICONS,
  storeCountdown,
  storeIcon,
  retireLines,
  bulkAsk,
  tintOf,
  SPRITE_SIZE,
  planRatio,
  planSummary,
  respecView,
  spendPreview,
  statTip,
  STAT_GROUPS,
  statRows,
  type StatGroup,
  type StatKind,
  skillBar,
  skillCell,
  skillRows,
  nextRealmLine,
  helpQiLines,
  skillLabel,
  skillTip,
  stripEvents,
  type SkillIcon,
  type SkillTier,
  castCallouts,
  CALLOUT_SECONDS,
  lightningStrikes,
  windUpOf,
  tribulationBanner,
  tribulationCall,
  trialPause,
  tribulationFellDue,
  discreetRows,
  waveLabel,
  xpBar,
  versionDetails,
  versionLabel,
} from './view.ts';

const TICK_MS = 200;
const SAVE_MS = 10_000;
/** How often the strip's sprites move to their next frame. */
const FRAME_TICK_MS = 50;
/** Damage numbers on the stage at once, and how long each shows. */
const MAX_DAMAGE_NUMBERS = 6;
const DAMAGE_NUMBER_MS = 900;
/** Skill callouts on the stage at once, and how long each shows. */
const MAX_CALLOUTS = 4;
const CALLOUT_MS = CALLOUT_SECONDS * 1000;
/** How long the cultivator's yell bubble shows. */
const YOU_YELL_MS = 1000;
/** How long a Heavenly Lightning strike's flash shows. */
const STRIKE_MS = 350;
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
  'help.9',
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

/**
 * Tints `select` by its chosen value (page.css): `data-tint` mirrors the
 * value when it is one of `allowed`, and is removed otherwise. Each option
 * gets its own value's class, for browsers that colour options.
 */
function tintChoice(
  select: HTMLSelectElement,
  classOf: (value: string) => string,
  allowed: readonly string[],
): () => void {
  for (const o of select.options) {
    const value = tintOf(o.value, allowed);
    if (value !== null) o.className = classOf(value);
  }
  const tint = (): void => {
    const value = tintOf(select.value, allowed);
    if (value !== null) select.dataset.tint = value;
    else delete select.dataset.tint;
  };
  select.addEventListener('change', tint);
  tint();
  return tint;
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

/** Session storage, or null where it is blocked. */
function sessionStore(): SaveStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Time between tries at a safe moment to reload onto a newer release. */
const UPDATE_RETRY_MS = 5000;
/** A tab looked at again after this long checks for a new release at once. */
const STALE_CHECK_MS = 60_000;
/** The itch.io build (one upload, one build) never reloads itself onto a new release. */
const selfUpdates = readFrameConfig(import.meta.env) === null;
const updater = createUpdater({
  build: __BUILD_ID__,
  selfUpdates,
  // The itch.io build never reloads itself, so it leaves the tab's shared session storage alone.
  session: selfUpdates ? sessionStore() : null,
  reload: () => window.location.reload(),
});
/** Why this page should run a newer release: it met a save it can't read, or one is out. */
let outdated: 'save' | 'release' | null = null;
/** The save before an update's reload was refused (storage full): ask the player to reload instead. */
let saveRefused = false;
/**
 * Set by the run playing: whether the player is in the middle of a choice, and
 * a save that says whether it was written. Null with no run (the Path choice),
 * where nothing is lost.
 */
let saveForUpdate: { choosing(): boolean; save(): boolean } | null = null;
/**
 * A save code from a later release, kept by an import just before this page
 * reloaded to update; read (and removed) once as the page loads, and asked
 * about again in the first run. Only the GitHub Pages build keeps one: on
 * itch.io the tab's session storage is shared with every other game there.
 */
let stashedImport: string | null = takeKept(sessionStore(), selfUpdates);
/** Says, over the game, that the page is moving onto a newer release or that the player should reload. */
const updateNote = el('section', 'panel cloud-panel');
updateNote.setAttribute('role', 'status');
const updateText = el('p');
updateNote.append(updateText);
updateNote.hidden = true;

/** Writes the update note in the current language; `running` says whether a run is being played. */
function drawUpdate(running: boolean): void {
  updateNote.hidden = outdated === null;
  if (!outdated) return;
  const moving = updater.canReload && !saveRefused;
  const key = moving ? 'update.reloading' : running ? 'update.sync' : 'update.play';
  setText(updateText, t(key));
}

/**
 * A save from a later release turned up, or a new release is out: move onto it
 * at the next safe moment, or, where the page can't, ask the player to reload.
 */
function needUpdate(why: 'save' | 'release'): void {
  if (outdated !== 'save') outdated = why;
  drawUpdate(saveForUpdate !== null);
  tryUpdate();
}

function tryUpdate(): void {
  const run = saveForUpdate;
  const step = updateStep({
    wanted: outdated !== null,
    canReload: updater.canReload,
    playing: run !== null,
    choosing: run?.choosing() ?? false,
  });
  // A save that wasn't written (storage full or refused) waits: a reload would lose the progress.
  if (step === 'reload') updater.reload();
  else if (step === 'save') {
    const saved = run?.save() ?? false;
    if (saveRefused === saved) {
      saveRefused = !saved;
      drawUpdate(true);
    }
    if (saved) updater.reload();
  }
}

let updatesWatched = false;
/** Once per page: retries a wanted update, and checks for a new release while the tab is in front. */
function watchUpdates(): void {
  if (updatesWatched) return;
  updatesWatched = true;
  window.setInterval(tryUpdate, UPDATE_RETRY_MS);
  if (!selfUpdates || !isBuildId(__BUILD_ID__)) return;
  let checkedAt = Date.now();
  const check = (): void => {
    if (document.hidden || outdated) return;
    checkedAt = Date.now();
    void servedBuild((url, init) => fetch(url, init)).then((served) => {
      if (updater.isNew(served)) needUpdate('release');
    });
  };
  window.setInterval(check, CHECK_EVERY_MS);
  // A tab left in the background for hours checks as soon as it is looked at again.
  document.addEventListener('visibilitychange', () => {
    if (Date.now() - checkedAt >= STALE_CHECK_MS) check();
  });
}

/** The itch.io build without its frame: it plays on itch.io's storage, which every game there shares. */
function sharedStorage(): boolean {
  return !selfUpdates && !frameLink;
}

/** Whether browser storage or the backup holds a save from a later release than this build. */
async function newerCopy(storage: SaveStorage | null): Promise<boolean> {
  return newerLocal(storage) || isNewerSave(await backup().read());
}

function newerLocal(storage: SaveStorage | null): boolean {
  try {
    return isNewerSave(storage?.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}

/** Moves onto a newer release when the sync meets a save from one. */
function watchSync(s: Sync): Sync {
  s.subscribe((status) => {
    if (status.kind === 'update') needUpdate('save');
  });
  if (s.status.kind === 'update') needUpdate('save');
  return s;
}

/** The cloud save's sync, made on first use; null where the build has no cloud config or storage is blocked. */
let sync: Sync | null = null;
/** A message from the cloud save for the player, shown over the game until dismissed. */
let cloudNote: CloudMessage | null = null;
let showCloudNote: ((note: CloudMessage) => void) | null = null;
/** Where the run is drawn, so the sync can restart it when it takes the cloud's save. */
let current: { root: HTMLElement; storage: SaveStorage } | null = null;

function cloudSync(root: HTMLElement, storage: SaveStorage | null): Sync | null {
  // Dev builds only: a save the Debug panel changed never reaches the cloud.
  if (!storage || (import.meta.env.DEV && debugged(storage))) return null;
  // In the storage frame (itch.io), the frame's sync is set before the first start.
  if (sync) {
    current = { root, storage };
    return sync;
  }
  const config = readCloudConfig(import.meta.env);
  if (!config) return null;
  current = { root, storage };
  sync = watchSync(
    createSync({
      cloud: createCloud({
        config,
        storage,
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        // Web Locks keep two tabs from renewing the sign-in at once; older browsers go without.
        locks: navigator.locks
          ? { request: (name, callback) => navigator.locks.request(name, callback) }
          : null,
      }),
      storage,
      now: Date.now,
      visible: () => !document.hidden,
      // The adopted save is in browser storage; its stamp may be older than the backup's.
      onAdopt: adopted,
      onNote: noted,
    }),
  );
  return sync;
}

/** The sync took the cloud's save: restart from it (it is in browser storage, whatever its stamp). */
function adopted(): void {
  if (current) start(current.root, current.storage, 'local');
}

function noted(code: CloudMessage): void {
  cloudNote = code;
  showCloudNote?.(code);
}

/** The storage frame, once it answered (the itch.io build); null everywhere else. */
let frameLink: FrameLink | null = null;
/** With the storage frame: its page, also shown visibly to make or take a link code, which this page never sees. */
let frameUrl: string | null = null;

/** A visible frame of the storage page that makes or takes a link code (ui/code-frame.ts). */
function storeFrame(url: string, hash: string, title: MessageKey, className: string) {
  const frame = el('iframe', className);
  attr(frame, 'title', title);
  frame.src = url + hash;
  return frame;
}

/**
 * The itch.io build: links to the storage frame on GitHub Pages, then starts.
 * Linked, the save, its backup and the cloud save live in the frame; if the
 * frame refuses or doesn't load, the game runs on this page's own storage as
 * before. Either way the run starts once, after the answer.
 */
export async function startWithFrame(root: HTMLElement, config: FrameConfig): Promise<void> {
  const link = await openFrame(config, { onAdopt: adopted, onNote: noted });
  if (!link) {
    start(root);
    return;
  }
  frameLink = link;
  frameUrl = config.url;
  sync = link.sync && watchSync(link.sync);
  backupCopy = withFallbackCopy(link.backup, browserStorage(), idbBackup(browserIdb()));
  start(root, link.storage);
}

/**
 * The newest save in `storage` and the backup. With the frame, its save wins
 * whenever it has one; this page's own copies (on itch.io's shared origin) are
 * read only when the frame holds none, as on the first start with the frame.
 */
function loadStart(storage: SaveStorage | null): Promise<Save | null> {
  if (!frameLink || !storage) return loadNewest(storage, backup(), Date.now());
  const own = { storage: browserStorage(), backup: idbBackup(browserIdb()) };
  return loadFramed({ storage, backup: backup() }, own, Date.now());
}

/** Calls `fn` on another tab's change to browser storage (key null: cleared) until `signal`. */
function watchStorage(
  fn: (key: string | null, value: string | null) => void,
  signal: AbortSignal,
): void {
  if (frameLink) {
    const stop = frameLink.onStorage(fn);
    signal.addEventListener('abort', stop);
    return;
  }
  window.addEventListener('storage', (e) => fn(e.key, e.newValue), { signal });
}

/** The IndexedDB copy of the save, opened on first use. */
let backupCopy: Backup | null = null;
const backup = (): Backup => (backupCopy ??= idbBackup(browserIdb()));
/** Bumped by every start, so a load that answers after a newer start is dropped. */
let starts = 0;

/**
 * Loads the saved run and replays the time away, or offers a new run when there
 * is none. The run loaded is the newest copy in browser storage or the backup;
 * `from` overrides that: 'local' for a save just put in browser storage (the
 * cloud's, whose stamp may be older than the backup's), or a save to play.
 */
export function start(
  root: HTMLElement,
  storage: SaveStorage | null = browserStorage(),
  from?: 'local' | Save,
): void {
  run.stop();
  saveForUpdate = null;
  watchUpdates();
  // Before play() saves over the local run: the cloud check compares against it.
  cloudSync(root, storage)?.begin();
  labels = [];
  showTheme([document.documentElement], pickedTheme ?? readTheme(storage), osDark.matches);
  discreetStore = storage;
  showDiscreet(pickedDiscreet ?? readDiscreet(storage));
  // Once per page: the key works on every screen, run or not.
  if (!discreetKeyOn) {
    discreetKeyOn = true;
    document.addEventListener('keydown', onDiscreetKey);
  }
  redrawDiscreet = relabelScreen;
  setLang(pickedLang ?? readLang(storage, navigator.languages ?? []));
  document.documentElement.lang = lang().code;
  const token = ++starts;
  const begin = (saved: Save | null, newer: boolean): void => {
    if (token !== starts) return;
    if (holdsStart({ newer, readable: saved !== null, shared: sharedStorage() })) {
      waitForUpdate(root, storage);
    } else resume(root, storage, saved);
  };
  if (from === 'local') {
    const saved = storage && loadSave(storage);
    begin(saved, !saved && newerLocal(storage));
  } else if (from) begin(from, false);
  else {
    void Promise.all([loadStart(storage), newerCopy(storage)]).then(([saved, newer]) =>
      begin(saved, newer),
    );
  }
}

/**
 * The save here is from a later release than this build: no run starts, as
 * its autosave would write over it. The page moves onto that release, or asks
 * the player to reload.
 */
function waitForUpdate(root: HTMLElement, storage: SaveStorage | null): void {
  labels = [];
  redrawDiscreet = relabelScreen;
  document.title = pageTitle();
  document.querySelector('link[rel="icon"]')?.remove();
  const bar = titleBar(storage, () => {
    drawUpdate(false);
    root.querySelector<HTMLButtonElement>('.lang > button')?.focus();
  });
  root.replaceChildren(bar, updateNote);
  say(() => drawUpdate(false));
  stashedImport = null;
  needUpdate('save');
}

function resume(root: HTMLElement, storage: SaveStorage | null, saved: Save | null): void {
  if (saved) {
    const { state, summary } = catchUp(saved.state, offlineSeconds(saved.savedAt, Date.now()));
    // play() stamps the save straight away, so a crash can't replay this time twice.
    play(root, state, storage, summary);
    return;
  }
  showPaths(root, storage);
  root.querySelector<HTMLButtonElement>('.paths button')?.focus();
}

/** The link code typed on the Path choice, kept across a language switch; cleared when a run starts. */
let typedLink = '';

/** Draws the Path choice. A language switch calls this alone: no restart, so the cloud check isn't redone. */
function showPaths(root: HTMLElement, storage: SaveStorage | null): void {
  labels = [];
  redrawDiscreet = relabelScreen;
  // A kept import is asked about only in the run the reload resumed, never in a later one.
  stashedImport = null;
  document.title = pageTitle();
  // No run, no HP ring: the browser's default icon.
  document.querySelector('link[rel="icon"]')?.remove();
  const cloud = sync;
  const bar = titleBar(storage, () => {
    // Nothing to keep before a run starts: the choice is drawn again in the new language.
    showPaths(root, storage);
    root.querySelector<HTMLButtonElement>('.lang > button')?.focus();
  });
  // One column, as wide as the choice: the link panel under it matches it.
  const start = el('div', 'path-start');
  start.append(
    pathChoice((path) => play(root, newGame(newSeed(), path), storage, null)),
    ...(cloud ? [pathLink(cloud)] : []),
  );
  root.replaceChildren(bar, updateNote, start);
  say(() => drawUpdate(false));
}

/**
 * Discreet mode on or off (docs/design.md §14): later grade names and initials
 * follow it, and page.css reads `data-discreet` on the root to hide the art.
 */
function showDiscreet(on: boolean): void {
  setDiscreet(on);
  document.documentElement.toggleAttribute('data-discreet', on);
}

/** The page's title outside a run: a dull file name while Discreet is on. */
function pageTitle(): string {
  return isDiscreet() ? t('discreet.file') : gameTitle();
}

/** Where the shown screen keeps Discreet mode; start() sets it. */
let discreetStore: SaveStorage | null = null;
/** Redraws the shown screen after a Discreet switch; each screen sets its own. */
let redrawDiscreet = (): void => {};
/** The fixed texts and the title again: enough for a screen with no run. */
function relabelScreen(): void {
  for (const fn of labels) fn();
  document.title = pageTitle();
}

/** Switches Discreet mode, keeping it as a display preference; the game runs on. */
function switchDiscreet(): void {
  const on = !isDiscreet();
  pickedDiscreet = on;
  // Blocked storage still switches it for this visit.
  writeDiscreet(discreetStore, on);
  showDiscreet(on);
  redrawDiscreet();
}

/** Discreet mode's key, on the page or in the pop-out (docs/design.md §14). */
function onDiscreetKey(e: KeyboardEvent): void {
  if (!isDiscreetKey(e)) return;
  e.preventDefault();
  switchDiscreet();
}
let discreetKeyOn = false;

/** The title bar; its language switch calls `relabel` once the language has changed. */
function titleBar(storage: SaveStorage | null, relabel: () => void): HTMLElement {
  const bar = el('header', 'titlebar');
  // A generic sheet glyph, drawn in CSS: no real product's logo.
  const glyph = el('span', 'glyph');
  glyph.setAttribute('aria-hidden', 'true');
  const file = el('h1', 'file');
  say(() => (file.textContent = t(isDiscreet() ? 'discreet.file' : 'game.file')));
  // Discreet mode: this button, or its key anywhere on the page (docs/design.md §14).
  const discreetBtn = buttonT('tools.discreet', '', switchDiscreet);
  say(() => discreetBtn.setAttribute('aria-pressed', String(isDiscreet())));
  // The game's name as a red rubber stamp; CSS sets the capitals, so screen readers say the words.
  const tools = el('div', 'tools');
  tools.append(discreetBtn, langSwitch(storage, relabel));
  bar.append(glyph, file, elt('span', 'stamp', 'game.title'), tools);
  return bar;
}

/**
 * A plain sheet of label / value rows under an A, B header, as in the Discreet
 * pop-out and the main page's Discreet mode; `fill` puts rows in its cells.
 */
function plainSheet(className: string): {
  box: HTMLElement;
  fill: (rows: readonly (readonly [string, string])[]) => void;
} {
  const box = el('div', className);
  const table = el('table');
  const head = el('tr');
  for (const col of ['', 'A', 'B']) head.append(el('th', '', col));
  table.append(head);
  const cells: { label: HTMLElement; value: HTMLElement }[] = [];
  box.append(table);
  return {
    box,
    fill(rows) {
      rows.forEach(([label, value], i) => {
        let cell = cells[i];
        if (!cell) {
          const row = el('tr');
          cell = { label: el('td'), value: el('td') };
          row.append(el('th', '', String(i + 1)), cell.label, cell.value);
          table.append(row);
          cells.push(cell);
        }
        setText(cell.label, label);
        setText(cell.value, value);
      });
    },
  };
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
 * A short list opening under `open`, in the top layer (a popover). Mouse,
 * touch and keyboard (arrows, Home / End, Enter / Space, Escape) all work.
 * `checked` is the entry ticked as it opens; `pick` gets the chosen entry's
 * index once the list has closed. While `enabled` is false the arrow keys
 * leave the list shut. Returns the list, to go beside `open`, and `toggle`.
 */
function pickList(
  open: HTMLButtonElement,
  id: string,
  label: MessageKey,
  entries: readonly { text: () => string; lang?: string }[],
  checked: () => number,
  pick: (index: number) => void,
  enabled: () => boolean = () => true,
): { list: HTMLUListElement; show: () => void; toggle: () => void } {
  open.setAttribute('aria-haspopup', 'menu');
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', id);
  const list = el('ul', 'pick-list');
  list.id = id;
  list.setAttribute('role', 'menu');
  say(() => list.setAttribute('aria-label', t(label)));
  // The title bar clips what spills past it (its edge-to-edge shadow), so the
  // list opens in the top layer as a popover, placed under the button.
  list.popover = 'manual';
  let isOpen = false;
  const items = entries.map((entry, i) => {
    const item = el('li');
    say(() => (item.textContent = entry.text()));
    item.setAttribute('role', 'menuitemradio');
    if (entry.lang) item.lang = entry.lang;
    item.tabIndex = -1;
    item.addEventListener('click', () => choose(i));
    list.append(item);
    return item;
  });
  const outside = (e: PointerEvent): void => {
    if (!open.contains(e.target as Node) && !list.contains(e.target as Node)) close(false);
  };
  // The list is placed once, where it opened: a resize or scroll closes it.
  const moved = (): void => close(false);
  function show(): void {
    const at = Math.max(0, checked());
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
  function choose(i: number): void {
    close(true);
    pick(i);
  }
  open.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !enabled()) return;
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
      if (at >= 0) choose(at);
      // Back on the button first, so Tab moves on from there in every browser.
    } else if (e.key === 'Tab') close(true);
    else if (to[e.key] !== undefined) {
      e.preventDefault();
      items[to[e.key] as number]?.focus({ preventScroll: true });
    }
  });
  return { list, show, toggle: () => (isOpen ? close(true) : show()) };
}

/**
 * The language switch beside Menu: a globe and the language's code, opening a
 * short list of the packs. Picking one saves it and calls `relabel`.
 */
function langSwitch(storage: SaveStorage | null, relabel: () => void): HTMLElement {
  const box = el('div', 'lang');
  const code = el('span');
  const open = el('button');
  open.type = 'button';
  open.append(globe(), code);
  say(() => {
    code.textContent = lang().short;
    open.setAttribute('aria-label', t('lang.button'));
  });
  const { list, toggle } = pickList(
    open,
    'lang-list',
    'lang.button',
    // Each name in its own language, so a screen reader says it right.
    PACKS.map((pack) => ({ text: () => pack.label, lang: pack.code })),
    () => PACKS.indexOf(lang()),
    (i) => {
      const next = PACKS[i]?.code;
      if (next === undefined || next === lang().code) return;
      pickedLang = next;
      setLang(next);
      // Blocked storage still changes it for this visit.
      writeLang(storage, next);
      document.documentElement.lang = lang().code;
      relabel();
    },
  );
  open.addEventListener('click', toggle);
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

/**
 * The status bar under the sheet: what the cultivator is doing now
 * (`character`, drawn every frame by the game page) at the left, then the
 * ready state and the one sheet tab, and the game's version at the right.
 */
function statusBar(): { bar: HTMLElement; character: HTMLElement } {
  const bar = el('footer', 'statusbar');
  const character = el('span', 'muted');
  // Seen as "v0.6.2", read as "Version 0.6.2"; the build and its time on hover or focus.
  const version = el('span', 'version muted', versionLabel(__APP_VERSION__).text);
  version.tabIndex = 0;
  // A named group, so focus reads the whole name, not the bare "v0.6.2".
  version.setAttribute('role', 'group');
  say(() => version.setAttribute('aria-label', versionLabel(__APP_VERSION__).spoken));
  bar.append(
    character,
    elt('span', '', 'status.ready'),
    elt('span', 'sheet-tab', 'status.sheet'),
    version,
  );
  const tip = el('p', 'boost-tip version-tip');
  tip.id = 'version-tip';
  hoverTip(version, tip, () =>
    tip.replaceChildren(
      ...versionDetails(__BUILD_ID__, __BUILD_TIME__).map((line) => el('span', '', line)),
    ),
  );
  return { bar, character };
}

/**
 * A skill's icon from skills.png, outside the strip (Stats tab, Path choice,
 * Respec); decorative, the name beside it says what it is. Discreet hides it.
 */
function skillIcon(cell: number, tier: SkillTier = 'base'): HTMLElement {
  const icon = el('span', 'skill-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.dataset.tier = tier;
  icon.style.setProperty('--cell', String(cell));
  icon.style.setProperty('--skill-art', cssUrl(artUrl('skills')));
  return icon;
}

/** A row of skills, each its icon and name: a Path's four on the Path choice, or Respec's preview. */
function skillNames(
  skills: readonly { name: string; cell: number; tier?: SkillTier }[],
): HTMLElement {
  const list = el('ul', 'skill-names');
  list.append(
    ...skills.map((k) => {
      const li = el('li');
      li.append(skillIcon(k.cell, k.tier), el('span', '', k.name));
      return li;
    }),
  );
  return list;
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
    const avatar = el('span', 'avatar');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.style.backgroundImage = cssUrl(artUrl(`path-${id}`));
    // Its four skills under the portrait, by the names they are first learned under.
    const skills = skillNames(
      pathSkillList(id).map((k) => ({ name: tn('skill', k.name), cell: skillCell(k.name) })),
    );
    b.append(
      el('strong', '', tn('path', PATHS[id].name)),
      el('span', 'muted', pathBlurb(id)),
      avatar,
      skills,
    );
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
  /** Name, HP bar, qi bar and HP text, under the stage. */
  box: HTMLElement;
  name: HTMLElement;
  bar: HTMLElement;
  hp: HTMLElement;
  /** The qi bar's track (a progressbar for screen readers) and its fill. */
  qiTrack: HTMLElement;
  qi: HTMLElement;
  /** The cast bar, filling over the qi bar while an enemy winds up a skill. */
  cast: HTMLElement;
  /** The qi last read out, so a frame with the same one touches nothing. */
  qiSaid: string;
  /** The language, kind and name last drawn (see setFighter), so a frame with the same ones touches nothing. */
  nameKey: string;
}

function fighter(side: 'you' | 'foe'): Fighter {
  const box = el('div', `fighter ${side}`);
  const name = el('div', 'name');
  const track = el('div', 'bar');
  track.setAttribute('aria-hidden', 'true');
  const bar = el('span');
  track.append(bar);
  const hp = el('div', 'hp');
  // A fighter with no qi pool (a regular demon) keeps the row, empty and
  // hidden, so the strip never changes height.
  const qiTrack = el('div', 'bar qi');
  qiTrack.setAttribute('role', 'progressbar');
  attr(qiTrack, 'aria-label', 'strip.qi');
  qiTrack.setAttribute('aria-valuemin', '0');
  const qi = el('span');
  // Drawn over the qi fill inside the same row, so a wind-up never moves anything.
  const cast = el('span', 'cast');
  cast.hidden = true;
  qiTrack.append(qi, cast);
  box.append(name, track, qiTrack, hp);
  return { box, name, bar, hp, qiTrack, qi, cast, qiSaid: '', nameKey: '', ...stageSprite(side) };
}

/** A CSS url() for art, or none when there is no such file (never url(""), which loads the page). */
function cssUrl(url: string): string {
  return url ? `url("${url}")` : '';
}

/** A padlock, drawn as SVG nodes (never markup); decorative, the icon's name says "blocked". */
function padlock(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'lock');
  const shackle = document.createElementNS(ns, 'path');
  shackle.setAttribute('d', 'M5 7V5a3 3 0 0 1 6 0v2');
  const body = document.createElementNS(ns, 'rect');
  const box: [string, string][] = [
    ['x', '3'],
    ['y', '7'],
    ['width', '10'],
    ['height', '7.5'],
    ['rx', '1.5'],
  ];
  for (const [k, v] of box) body.setAttribute(k, v);
  svg.append(shackle, body);
  return svg;
}

/** One icon of the skill bar; the bar reuses up to four of them. */
interface SkillSlot {
  box: HTMLElement;
  tip: HTMLElement;
  /** What it shows now, so a frame with the same skill and state touches nothing. */
  icon: SkillIcon | null;
  drawn: string;
  /** Its accessible name as last set (skillLabel: name, level, state, in the language shown). */
  label: string;
  /** The cast it last flashed for; null once the flash is over. */
  flashed: number | null;
  isOpen: () => boolean;
  fill: () => void;
}

/** The cultivator's skill bar: up to four icons beside its qi bar (docs/design.md §5 Skills). */
function skillRow(read: () => GameState): { row: HTMLElement; slots: SkillSlot[] } {
  const row = el('div', 'skills');
  row.setAttribute('role', 'group');
  attr(row, 'aria-label', 'skill.bar');
  const slots = [0, 1, 2, 3].map((i): SkillSlot => {
    const box = el('span', 'skill');
    box.setAttribute('role', 'img');
    box.tabIndex = 0;
    box.hidden = true;
    const art = el('span', 'art');
    const charge = el('span', 'charge');
    const ring = el('span', 'ring');
    box.append(art, charge, ring, padlock());
    row.append(box);
    const tip = el('div', 'boost-tip skill-tip');
    tip.id = `skill-tip-${i}`;
    const slot: SkillSlot = {
      box,
      tip,
      icon: null,
      drawn: '',
      label: '',
      flashed: null,
      isOpen: () => false,
      fill: () => {
        if (!slot.icon) return;
        const info = skillTip(slot.icon, read());
        tip.replaceChildren(
          el('strong', '', info.name),
          el('p', 'cost', `${info.level} · ${info.cost}`),
          el('p', '', info.effect),
        );
      },
    };
    slot.isOpen = hoverTip(box, tip, slot.fill).isOpen;
    return slot;
  });
  return { row, slots };
}

/** Draws the skill bar's icons for `icons`; only what changed is touched. */
function drawSkills(slots: readonly SkillSlot[], icons: readonly SkillIcon[]): void {
  const code = lang().code;
  slots.forEach((slot, i) => {
    const icon = icons[i] ?? null;
    slot.icon = icon;
    if (!icon) {
      slot.box.hidden = true;
      slot.drawn = '';
      slot.label = '';
      if (slot.isOpen()) slot.tip.hidePopover();
      return;
    }
    // Fill and ring in steps of 1%, so a frame with no visible change touches nothing.
    const fill = Math.round(icon.fill * 100);
    const ring = Math.round(icon.ring * 100);
    const key = [code, icon.name, icon.state, icon.tier, icon.level, fill, ring].join('\u0000');
    if (key !== slot.drawn) {
      slot.drawn = key;
      const b = slot.box;
      b.hidden = false;
      b.style.setProperty('--cell', String(icon.cell));
      b.style.setProperty('--fill', String(fill / 100));
      b.style.setProperty('--ring', String(ring / 100));
      b.dataset.tier = icon.tier;
      b.classList.toggle('ready', icon.ready);
      b.classList.toggle('blocked', icon.blocked);
      b.classList.toggle('buffed', ring > 0);
      // The name changes with the skill, its level or state, or the language;
      // an open tip (name, level, cost, effect) is redrawn with it.
      const label = skillLabel(icon);
      if (label !== slot.label) {
        slot.label = label;
        b.setAttribute('aria-label', label);
        if (slot.isOpen()) slot.fill();
      }
    }
    if (icon.flash !== null && icon.flash !== slot.flashed) {
      // Restarts the flash for each new cast, even one right after the last.
      slot.box.classList.remove('flash');
      void slot.box.offsetWidth;
      slot.box.classList.add('flash');
    }
    slot.flashed = icon.flash;
  });
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

/** Shows column `col` of the store atlas on `icon`; sized by page.css. */
function setStoreIcon(icon: HTMLElement, col: number): void {
  const s = icon.style;
  s.backgroundImage = cssUrl(artUrl('store'));
  s.backgroundSize = `${STORE_ICONS.length * 100}% 100%`;
  s.backgroundPosition = `${(col / (STORE_ICONS.length - 1)) * 100}% 0`;
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

/** A stat tip's parts, one line each; a part with nothing to say is left out. */
function fillStatTip(
  box: HTMLElement,
  tip: { gain: string; mastery: string; share: string; slows: string },
): void {
  box.replaceChildren(
    ...[tip.gain, tip.mastery, tip.share, tip.slows]
      .filter((text) => text !== '')
      .map((text) => el('p', '', text)),
  );
}

/**
 * Opens `tip` (a popover, placed under `anchor`, or over it near the window's
 * bottom) on hover or keyboard focus, and on a tap through the focus it
 * leaves; it closes when the pointer has
 * left and the anchor has no keyboard focus, on blur after a tap, on Escape,
 * or on a resize or scroll. `fill` draws it just before it opens.
 */
function hoverTip(
  anchor: HTMLElement,
  tip: HTMLElement,
  fill: () => void,
): { isOpen: () => boolean } {
  tip.setAttribute('role', 'tooltip');
  // A panel can clip what spills out, so the tip opens in the top layer.
  tip.popover = 'manual';
  anchor.setAttribute('aria-describedby', tip.id);
  anchor.after(tip);
  let hovered = false;
  const isOpen = (): boolean => tip.matches(':popover-open');
  function show(): void {
    if (isOpen()) return;
    fill();
    tip.showPopover();
    const r = anchor.getBoundingClientRect();
    // Under the anchor, or over it when the window has no room below (the status bar).
    const below = r.bottom + tip.offsetHeight + 8 <= window.innerHeight;
    tip.style.top = `${below ? r.bottom : Math.max(0, r.top - tip.offsetHeight - 8)}px`;
    tip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - tip.offsetWidth - 4))}px`;
    // Placed once, where it opened: a resize or scroll closes it. The scroll
    // a focus may cause to bring the anchor into view is let through first.
    window.addEventListener('resize', hide);
    requestAnimationFrame(() => {
      if (isOpen()) window.addEventListener('scroll', hide, true);
    });
  }
  function hide(): void {
    window.removeEventListener('resize', hide);
    window.removeEventListener('scroll', hide, true);
    if (isOpen()) tip.hidePopover();
  }
  const over = (e: PointerEvent): void => {
    hovered = true;
    if (e.pointerType !== 'touch') show();
  };
  // Moving from the anchor onto the tip (or back) keeps it open; so does
  // keyboard focus, but not the focus a mouse click leaves behind.
  const out = (e: PointerEvent): void => {
    const to = e.relatedTarget as Node | null;
    if (to && (anchor.contains(to) || tip.contains(to))) return;
    hovered = false;
    // A tap's finger lifts at once: the focus it left keeps the tip open until blur.
    if (e.pointerType !== 'touch' && !anchor.matches(':focus-visible')) hide();
  };
  for (const node of [anchor, tip]) {
    node.addEventListener('pointerenter', over);
    node.addEventListener('pointerleave', out);
  }
  anchor.addEventListener('focus', show);
  anchor.addEventListener('blur', () => {
    if (!hovered) hide();
  });
  anchor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  return { isOpen };
}

/**
 * The Realm chip's hover list: every realm, the current one highlighted, each
 * naming what it brings the Path (see hoverTip for when it opens). It reads
 * the level and Path when it opens; `refresh` redraws an open list after a
 * breakthrough or a Path change.
 */
function realmList(
  chip: HTMLElement,
  level: () => number,
  path: () => PathId,
): { refresh: () => void } {
  const list = el('ul', 'realm-list');
  list.id = 'realm-list';
  chip.tabIndex = 0;
  let shown = '';
  /** The realm and Path the open list shows: either changing redraws it. */
  const key = (): string => `${realmOf(level())} ${path()}`;
  function fill(): void {
    shown = key();
    list.replaceChildren(
      ...realmRows(level(), path()).map((row) => {
        const li = el('li', row.current ? 'current' : '');
        if (row.current) li.setAttribute('aria-current', 'true');
        // The spaces keep a screen reader's words apart; the grid drops them.
        li.append(
          el('span', 'name', row.name),
          ' ',
          el('span', 'title', row.title),
          ' ',
          el('span', 'levels', row.levels),
          ' ',
          el('span', 'unlock', row.unlock),
        );
        // A tooltip's text is read flat, so say which row is current in words too.
        if (row.current) li.append(el('span', 'sr-only', ` ${t('realm.current')}`));
        return li;
      }),
    );
  }
  const { isOpen } = hoverTip(chip, list, fill);
  return {
    refresh: () => {
      if (isOpen() && key() !== shown) fill();
    },
  };
}

/**
 * The line saying why `buttons` are off, with id `id`: the buttons are marked
 * aria-disabled (as everywhere here; button() ignores their clicks) and point to it.
 */
function blockedBy(why: string, id: string, buttons: HTMLButtonElement[]): HTMLElement {
  const line = el('p', 'down', why);
  line.id = id;
  for (const b of buttons) {
    b.setAttribute('aria-disabled', 'true');
    b.setAttribute('aria-describedby', id);
    b.title = why;
  }
  return line;
}

/** A block of the details panel: a small label over its own lines. */
function block(label: MessageKey): HTMLElement {
  const box = el('div', 'detail-block');
  // Drawn again on a language switch with the rest of the panel, so plain text is enough.
  box.append(el('div', 'detail-block-label', t(label)));
  return box;
}

function panel(className: string, title: MessageKey): { box: HTMLElement; heading: HTMLElement } {
  const box = el('section', `panel ${className}`);
  const heading = elt('h2', '', title);
  heading.tabIndex = -1;
  box.append(heading);
  return { box, heading };
}

/**
 * A grid cell: grade initial (top-left), refine level (top-right, "+7", hidden
 * at +0), icon (centred) and the gear badge (bottom-right: ▲ a strict upgrade,
 * ▼ a strict downgrade, a gold dash for mixed gains and losses, hidden
 * otherwise); the grade colour is its border.
 */
function cell(): HTMLButtonElement {
  const b = el('button', 'cell');
  b.type = 'button';
  const icon = el('span', 'icon');
  icon.setAttribute('aria-hidden', 'true');
  const badge = el('span', 'verdict');
  badge.setAttribute('aria-hidden', 'true');
  badge.hidden = true;
  // The cell's name says the refine level in words (cellLabel).
  const refined = el('span', 'refine');
  refined.setAttribute('aria-hidden', 'true');
  refined.hidden = true;
  b.append(el('span', 'grade'), icon, badge, refined);
  return b;
}

/**
 * Shows `item` in a cell, or an empty cell with `emptyText` as its name. `verdict`
 * shows the ▲ / ▼ / dash badge and adds it to the cell's name (bag cells only).
 */
function fillCell(
  b: HTMLButtonElement,
  item: Item | undefined,
  emptyText: string,
  verdict: GearVerdict = null,
): void {
  const [grade, icon, badge, refined] = b.children as unknown as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  const v = item ? verdict : null;
  const mark = item ? refineMark(item) : '';
  refined.hidden = mark === '';
  refined.textContent = mark;
  b.className = item ? `cell grade-${item.grade}` : 'cell empty';
  grade.textContent = item ? gradeInitial(item.grade) : '';
  setIcon(icon, item);
  badge.hidden = v === null;
  badge.className = v ? `verdict ${v}` : 'verdict';
  // The mixed dash is drawn by CSS (a solid bar reads better than a thin glyph).
  badge.textContent = v === 'up' ? '▲' : v === 'down' ? '▼' : '';
  b.setAttribute('aria-label', item ? cellLabel(item, v) : emptyText);
}

/**
 * Tabs inside a panel: one tab stop, arrow keys (and Home / End) switch, only the chosen body
 * shows. The first tab starts selected; `onShow` hears every switch the player makes.
 */
function tabs(
  list: { id: string; label: MessageKey; body: HTMLElement }[],
  onShow?: (id: string) => void,
): {
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
    b.addEventListener('click', () => {
      show(tab.id);
      onShow?.(tab.id);
    });
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
      onShow?.(next.id);
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

/**
 * The paper doll's middle column: the Path's figure (a 4-frame breathing loop,
 * set by drawGear) on a jade plinth, in a qi mist of the realm's colour.
 * Decoration only, so screen readers skip it.
 */
function stand(): { box: HTMLElement; figure: HTMLElement } {
  const box = el('div', 'stand');
  box.setAttribute('aria-hidden', 'true');
  const plinth = el('div', 'plinth');
  plinth.style.backgroundImage = cssUrl(artUrl('plinth'));
  const figure = el('div', 'figure');
  box.append(el('div', 'mist'), plinth, figure);
  return { box, figure };
}

/** Shows the faint icon of item type `type` from the slot icon atlas on an empty slot's icon. */
function setSlotIcon(icon: HTMLElement, type: SlotId): void {
  const s = icon.style;
  s.backgroundImage = cssUrl(artUrl('slots'));
  s.backgroundSize = `${ICON_PX * ICON_COLUMNS.length}px ${ICON_PX}px`;
  s.backgroundPosition = `${-ICON_COLUMNS.indexOf(type) * ICON_PX}px 0`;
}

/** How long an equipped slot's pulse plays (page.css slot-pulse). */
const PULSE_MS = 600;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const osDark = matchMedia('(prefers-color-scheme: dark)');
/** The theme picked this visit: kept across runs even where storage is blocked. */
let pickedTheme: Theme | null = null;
/** Discreet mode as switched this visit: kept across runs even where storage is blocked. */
let pickedDiscreet: boolean | null = null;
/** The bag sort picked this visit: kept across runs even where storage is blocked. */
let pickedSort: BagSort | null = null;
let pickedReverse: boolean | null = null;
/** The language picked this visit: kept across runs even where storage is blocked. */
let pickedLang: string | null = null;
/** The pop-out style picked this visit: kept across runs even where storage is blocked. */
let pickedPopStyle: PopStyle | null = null;
/** The Stats tab's open groups as switched this visit: kept across runs even where storage is blocked. */
let pickedFolds: Folds | null = null;
/** The Crafting panel's last mode, kept for the visit. */
let pickedCraftMode: CraftMode = 'refine';

type Selection = { bag: number } | { slot: EquipSlotId } | null;

/** The Overtime Cultivation summary: one row of chips, dismissed by its button. */
function overtimePanel(summary: OvertimeSummary): HTMLElement {
  const box = el('section', 'panel overtime');
  box.setAttribute('aria-labelledby', 'overtime-title');
  const h = el('h2');
  h.id = 'overtime-title';
  const chips = el('div', 'kpis');
  const note = el('span', 'muted');
  say(() => {
    const v = overtimeView(summary);
    h.replaceChildren(t('overtime.title'), el('span', 'muted', ` · ${v.away}`));
    chips.replaceChildren(
      ...v.chips.map((c) => {
        const chip = el('div', c.boost ? 'kpi boost' : 'kpi');
        if (c.icon) {
          const icon = el('span', 'kpi-icon');
          icon.setAttribute('aria-hidden', 'true');
          setSummaryIcon(icon, summaryIcon(c.icon));
          chip.append(icon);
        }
        chip.append(el('span', 'label', c.label), el('span', 'value', c.value));
        return chip;
      }),
    );
    note.textContent = v.note;
  });
  const ok = buttonT('overtime.ok', 'primary', () => box.remove());
  const row = el('div', 'overtime-row');
  row.append(chips, note, ok);
  box.append(h, row);
  return box;
}

/**
 * The cloud save's parts of the page: a note and the choice between two saves
 * (both over the game, since a choice must not wait for the Menu), and the
 * Menu's Cloud save section. All text goes in as text, in the current language
 * (rewritten on a language switch); the sync's status is the only other input.
 */
function cloudPanels(
  cloud: Sync,
  scope: RunScope,
): { note: HTMLElement; choice: HTMLElement; menu: HTMLElement[] } {
  const note = el('section', 'panel cloud-panel');
  note.setAttribute('role', 'status');
  const noteText = el('p');
  note.append(
    noteText,
    buttonT('confirm.ok', '', () => {
      note.hidden = true;
      cloudNote = null;
    }),
  );
  note.hidden = true;
  const showNote = (code: CloudMessage): void => {
    noteText.textContent = cloudText(code);
    note.hidden = false;
  };
  if (cloudNote) showNote(cloudNote);
  showCloudNote = showNote;
  say(() => {
    if (cloudNote) noteText.textContent = cloudText(cloudNote);
  });

  const choice = el('section', 'panel cloud-panel');
  choice.setAttribute('role', 'alert');
  const choiceText = el('p');
  const localLine = el('p', 'muted');
  const cloudLine = el('p', 'muted');
  const keep = button('', '', () => void cloud.keepLocal());
  const use = buttonT('cloud.useCloud', 'primary', () => cloud.useCloud());
  choice.append(choiceText, localLine, cloudLine, keep, use);
  choice.hidden = true;

  const statusLine = el('p');
  statusLine.setAttribute('aria-live', 'polite');
  const turnOn = button('', 'primary', () => void cloud.turnOn());
  const syncNow = button('', '', () => void cloud.syncNow());
  const codeLine = el('p', 'muted');
  /** The link code on show, kept so a language switch can word it again. */
  let shownCode: { code: string; ttl: number } | null = null;
  const showCode = (): void =>
    showCodeLine(codeLine, shownCode && linkCodeLine(shownCode.code, shownCode.ttl));
  say(showCode);
  const getCode = buttonT('cloud.getCode', '', () => {
    void cloud.linkCode().then((made) => {
      if (!made) return;
      shownCode = made;
      showCode();
    });
  });
  /** On itch.io, the code is made and shown, or typed, in frames on GitHub Pages instead (ui/code-frame.ts). */
  const codeSlot = el('div');
  const linkSlot = el('div');
  const turnOff = buttonT('cloud.turnOff', '', () => {
    shownCode = null;
    showCode();
    cloud.turnOff();
  });
  const linkBox = el('label', 'field');
  const linkCaption = document.createTextNode('');
  say(() => (linkCaption.data = t('cloud.linkField')));
  const linkInput = el('input');
  linkInput.type = 'text';
  linkInput.maxLength = 32;
  linkInput.autocomplete = 'off';
  linkInput.spellcheck = false;
  linkBox.append(linkCaption, linkInput);
  const link = buttonT('cloud.link', '', () => {
    const code = linkInput.value.trim();
    if (!code) return;
    setButton(link, t('cloud.link'), true);
    void cloud.link(code).then(() => {
      linkInput.value = '';
      setButton(link, t('cloud.link'), false);
    });
  });
  const linkHint = elt('p', 'muted hint', 'cloud.linkHint');
  const linkRow = el('div', frameUrl ? '' : 'cloud-row');
  if (frameUrl) linkRow.append(elt('p', '', 'cloud.linkField'), linkSlot);
  else linkRow.append(linkBox, link);

  const menu = [
    elt('h3', '', 'cloud.title'),
    elt('p', 'muted hint', 'cloud.hint'),
    statusLine,
    turnOn,
    syncNow,
    ...(frameUrl ? [codeSlot] : [getCode, codeLine]),
    linkRow,
    linkHint,
    turnOff,
  ];

  function draw(status: SyncStatus): void {
    const now = Date.now();
    setText(statusLine, cloudStatusLine(status, now));
    const off = status.kind === 'off';
    const relink = status.kind === 'relink';
    const on = !off && !relink;
    setText(turnOn, t(relink ? 'cloud.startNew' : 'cloud.turnOn'));
    turnOn.hidden = !(off || relink);
    linkRow.hidden = linkHint.hidden = !(off || relink);
    const syncing = status.kind === 'syncing' || status.kind === 'checking';
    syncNow.hidden = getCode.hidden = !on;
    setButton(syncNow, t('cloud.syncNow'), syncing || needsChoice(status));
    turnOff.hidden = off;
    codeLine.hidden = !on;
    if (frameUrl) {
      const url = frameUrl;
      const slot = (box: HTMLElement, shown: boolean, add: () => HTMLElement): void => {
        const step = frameStep(box.childElementCount > 0, shown);
        if (step === 'add') box.append(add());
        else if (step === 'drop') box.replaceChildren();
      };
      slot(codeSlot, on, () => storeFrame(url, CODE_HASH, 'cloud.codeFrame', 'code-frame'));
      slot(linkSlot, off || relink, () =>
        storeFrame(url, LINK_HASH, 'cloud.linkField', 'code-frame link-frame'),
      );
    }
    choice.hidden = !needsChoice(status);
    if (status.kind === 'conflict') {
      setText(choiceText, t('cloud.conflict'));
      setText(localLine, t('cloud.localLine', { summary: saveSummary(status.local, now) }));
      setText(cloudLine, t('cloud.cloudLine', { summary: saveSummary(status.server, now) }));
      localLine.hidden = cloudLine.hidden = use.hidden = false;
      setText(keep, t('cloud.keepLocal'));
    } else if (status.kind === 'unreadable') {
      setText(choiceText, t('cloud.unreadable'));
      localLine.hidden = cloudLine.hidden = use.hidden = true;
      setText(keep, t('cloud.overwrite'));
    }
  }
  say(() => draw(cloud.status));
  const unsubscribe = cloud.subscribe(draw);
  // "Synced 2 min ago" ages while nothing else changes.
  scope.every(30_000, () => draw(cloud.status));
  scope.signal.addEventListener('abort', () => {
    unsubscribe();
    if (showCloudNote === showNote) showCloudNote = null;
  });
  return { note, choice, menu };
}

/** On the Path choice, where there is no Menu: load a cloud save with a link code. */
function pathLink(cloud: Sync): HTMLElement {
  const box = el('section', 'panel cloud-panel');
  /** What the line under the field says now: progress or the last problem. */
  let shown: (() => string) | null = null;
  const msg = el('p', 'muted');
  msg.setAttribute('role', 'status');
  const show = (text: (() => string) | null): void => {
    shown = text;
    msg.textContent = text ? text() : '';
  };
  say(() => (msg.textContent = shown ? shown() : ''));
  if (frameUrl) {
    // On itch.io the code is typed into a frame on GitHub Pages, out of this page's reach.
    box.append(
      elt('p', '', 'cloud.pathLink'),
      storeFrame(frameUrl, LINK_HASH, 'cloud.pathLink', 'code-frame link-frame'),
      msg,
    );
    // This page sees an attempt only as the sync's status: it starts at "syncing".
    let attempt = false;
    /** Set once on the page; off it again (a language switch or the run starting), it stops listening. */
    let mounted = false;
    const stop = cloud.subscribe((status) => {
      if (box.isConnected) mounted = true;
      else if (mounted) return stop();
      if (status.kind !== 'syncing') return;
      attempt = true;
      show(null);
    });
    showCloudNote = (code) => {
      show(() => cloudText(code));
      // A problem with the attempt is shown here, not again over the run (a loaded save still is).
      if (attempt && code !== 'loaded') cloudNote = null;
    };
    return box;
  }
  const field = el('label', 'field');
  const caption = document.createTextNode('');
  say(() => (caption.data = t('cloud.pathLink')));
  const input = el('input');
  input.type = 'text';
  input.maxLength = 32;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = typedLink;
  input.addEventListener('input', () => (typedLink = input.value));
  field.append(caption, input);
  const go = buttonT('cloud.link', '', () => {
    const code = input.value.trim();
    if (!code) return;
    show(() => t('cloud.linking'));
    setButton(go, t('cloud.link'), true);
    void cloud.link(code).then(() => {
      setButton(go, t('cloud.link'), false);
      if (!msg.isConnected) return;
      // Still on the Path choice: the problem was shown here; don't repeat it over the new run.
      cloudNote = null;
      if (msg.textContent === t('cloud.linking')) show(null);
    });
  });
  // Problems come back as notes; here they show beside the field.
  showCloudNote = (code) => show(() => cloudText(code));
  box.append(field, go, msg);
  return box;
}

function play(
  root: HTMLElement,
  initial: GameState,
  storage: SaveStorage | null,
  summary: OvertimeSummary | null,
): void {
  typedLink = '';
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
  /** The gear badge cache (see verdicts()): its key, the current derive() and results per item. */
  let badges: { key: string; now: Derived; cache: WeakMap<Item, GearVerdict> } | null = null;
  /** The selected Soul Banner's souls line; refilled every draw, as kills add souls. */
  let soulsText: HTMLElement | null = null;
  /** A press on a bag item; it becomes a drag (with a ghost) once the mouse moves. */
  let drag: { index: number; x: number; y: number; ghost: HTMLElement | null } | null = null;

  // Combat strip
  const strip = el('section', 'strip');
  attr(strip, 'aria-label', 'strip.label');
  // The rank icons' atlas, for the compact strip's tier badges (page.css).
  strip.style.setProperty('--rank-art', cssUrl(artUrl('ranks')));
  const where = el('div', 'where');
  const floorText = el('span');
  const killText = el('span');
  const live = elt('span', 'live', 'strip.live');
  where.append(floorText, killText, live);
  const you = fighter('you');
  const foe = fighter('foe');
  // The cultivator's skill bar, beside its qi bar; skills.png holds the icons.
  const skills = skillRow(() => state);
  skills.row.style.setProperty('--skill-art', cssUrl(artUrl('skills')));
  you.box.append(skills.row);
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
  // Set aside after losses, it says so and the click is a single Try again.
  const trialHead = el('strong');
  const trialText = el('span');
  const trialRetry = elt('span', 'trial-retry', 'trial.retry');
  trialCall.append(trialHead, trialText, trialRetry);
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
  // The skill the enemy winds up, yelled in a bubble over it (docs/design.md
  // §5 Skills). Not read out: screen readers are not told each cast.
  const yell = el('p', 'yell');
  yell.setAttribute('aria-hidden', 'true');
  yell.hidden = true;
  // The layout the bubble was last placed for; '' while hidden.
  let yellPlacedFor = '';
  // The cultivator's costliest skill, yelled in a bubble over it as it lands,
  // for YOU_YELL_MS; one at a time, placed clear of the sprites and the
  // enemy's bubble (yell.ts).
  const youYell = el('p', 'yell you');
  youYell.setAttribute('aria-hidden', 'true');
  youYell.hidden = true;
  let youYellTimer = 0;
  // The fight the cultivator's bubble was yelled in, and the layout it was placed for.
  let youYellFight = 0;
  let youYellPlacedFor = '';
  stage.append(yell, youYell);
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
  // The Path, after the level: shown only where the strip has no room for the
  // cultivator's name over the stage (page.css). The name says it to screen readers.
  const xpPath = el('span', 'xp-path');
  const xpFillPath = el('span', 'xp-path');
  for (const n of [xpPath, xpFillPath]) n.setAttribute('aria-hidden', 'true');
  xpFill.append(xpFillLevel, xpFillPath, xpFillText);
  xp.append(xpLevel, xpPath, xpText, xpFill);
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
  // A chip per store boost (§8) on a row of three fixed columns, kept while off
  // so a boost starting never grows the chips; running ones fill it from the
  // left (page.css). Each shows its icon, bonus and a short word (the word
  // goes on a narrow row); a hover, focus or tap opens the whole line with the
  // time left, which is also what screen readers hear.
  const boostRow = el('div', 'kpi-boosts');
  const boostChips = BOOST_IDS.map((id) => {
    const box = el('div', 'kpi boost off');
    box.tabIndex = 0;
    const icon = el('span', 'kpi-icon');
    icon.setAttribute('aria-hidden', 'true');
    setStoreIcon(icon, storeIcon(`boost-${id}`));
    const full = el('span', 'sr-only');
    const bonus = el('span', 'value');
    const word = el('span', 'word');
    bonus.append(word);
    bonus.setAttribute('aria-hidden', 'true');
    const percent = document.createTextNode('');
    bonus.prepend(percent);
    box.append(icon, full, bonus);
    boostRow.append(box);
    const tip = el('p', 'boost-tip');
    tip.id = `boost-chip-tip-${id}`;
    const fillTip = (): void => setText(tip, boostChip(state, id)?.full ?? '');
    const { isOpen } = hoverTip(box, tip, fillTip);
    // The chip's own text already says the whole line; don't say it twice.
    box.removeAttribute('aria-describedby');
    return { id, box, full, percent, word, tip, isOpen, fillTip };
  });
  kpis.append(kPath.box, kRealm.box, kStones.box, kEssence.box, boostRow);
  const realms = realmList(
    kRealm.box,
    () => state.cultivator.level,
    () => state.cultivator.path,
  );

  // Character: a paper doll, the Path's figure between two columns of slots
  // (the drop targets), then stats
  const character = panel('character', 'character.title');
  const slots = el('div', 'doll');
  slots.setAttribute('role', 'group');
  attr(slots, 'aria-label', 'character.equipped');
  const doll = stand();
  const slotCells = {} as Record<EquipSlotId, HTMLButtonElement>;
  const slotColumn = (column: readonly EquipSlotId[]): HTMLElement => {
    const col = el('div', 'slot-col');
    for (const slot of column) {
      const box = el('div', 'slot');
      const b = cell();
      b.dataset.slot = slot;
      b.addEventListener('click', (e) => {
        select(state.cultivator.equipment[slot] ? { slot } : null);
        if (selected && e.detail === 0) focusCard();
      });
      slotCells[slot] = b;
      const slotName = el('span', 'slot-name');
      say(() => (slotName.textContent = tn('equipSlot', EQUIP_SLOTS[slot].name)));
      box.append(b, slotName);
      col.append(box);
    }
    return col;
  };
  const [left, right] = DOLL_COLUMNS;
  slots.append(slotColumn(left), doll.box, slotColumn(right));
  // Stats: two sub-tabs. Stats has the base stats with their spend buttons on
  // the same row, Auto-assign, then the derived numbers and boosts in groups
  // that fold; Respec has the stat reset and Path change.
  const folds = pickedFolds ?? readFolds(storage);
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
  const boostValues = {} as Record<StatId, HTMLElement>;
  /** Redraws the boost tips that are open, so a breakthrough under one shows at once. */
  const boostTips: (() => void)[] = [];
  /** The same for the stat name tips, whose numbers move with every point. */
  const statTips: (() => void)[] = [];
  /** The spend +1 or All previews while hovered or focused; null when none is. */
  let previewing: { stat: StatId; n: number } | null = null;
  /** The Path the derived rows were built for: each Path has its own Mastery rows. */
  let derivedPath: PathId | null = null;
  for (const id of STAT_IDS) {
    const row = el('li');
    const value = el('b', 'value');
    baseValues[id] = value;
    // What the realms add, kept apart from the points the player spends; a
    // hover, focus or tap says where it comes from.
    const boost = el('span', 'boost');
    boost.tabIndex = 0;
    boostValues[id] = boost;
    const tip = el('p', 'boost-tip');
    tip.id = `boost-tip-${id}`;
    const fillTip = (): void => setText(tip, realmBoostTip(state.cultivator, id));
    const { isOpen } = hoverTip(boost, tip, fillTip);
    boostTips.push(() => {
      if (isOpen()) fillTip();
    });
    // Hidden (not off) with no points to spend; the words name the stat.
    const one = button('+1', 'spend', () => spend(id, 1));
    const all = buttonT('stats.all', 'spend', () => spend(id, state.cultivator.unspent));
    say(() => {
      const stat = t(`stat.${id}`);
      one.setAttribute('aria-label', t('stats.plusOne', { stat }));
      all.setAttribute('aria-label', t('stats.allTo', { stat }));
    });
    // The stat's name explains a point's worth on hover, focus or tap.
    // A button, so every screen reader reads the tip it is described by.
    const name = elt('button', 'name', `stat.${id}`);
    name.type = 'button';
    const nameTip = el('div', 'boost-tip stat-tip');
    nameTip.id = `stat-tip-${id}`;
    const fillNameTip = (): void => fillStatTip(nameTip, statTip(state.cultivator, id));
    const named = hoverTip(name, nameTip, fillNameTip);
    statTips.push(() => {
      if (named.isOpen()) fillNameTip();
    });
    // Hover or focus on +1 or All previews the change in the rows below.
    for (const [b, count] of [
      [one, () => 1],
      [all, () => state.cultivator.unspent],
    ] as const) {
      const on = (): void => {
        previewing = { stat: id, n: count() };
        drawDerived();
      };
      const off = (): void => {
        previewing = null;
        drawDerived();
      };
      b.addEventListener('pointerenter', on);
      b.addEventListener('focus', on);
      b.addEventListener('pointerleave', off);
      b.addEventListener('blur', off);
    }
    row.append(name, value, boost, tip, one, all);
    nameTip.remove();
    row.append(nameTip);
    baseList.append(row);
  }
  base.append(baseHead, baseList);

  // Auto-assign: the switch, then (while it is on) the plan's three shares
  // for this Path and Apply plan (docs/design.md §3).
  const planTitle = el('span');
  const planSwitch = el('button', 'switch');
  planSwitch.type = 'button';
  planSwitch.setAttribute('role', 'switch');
  say(() => (planSwitch.textContent = t('plan.title')));
  planSwitch.addEventListener('click', () => act(setAutoAssign(state, !state.statPlan.auto)));
  const planBody = el('div', 'plan-body');
  const shares = el('div', 'shares');
  const shareInputs = {} as Record<StatId, HTMLInputElement>;
  for (const id of STAT_IDS) {
    const box = el('label', 'share');
    const shareName = elt('span', '', `stat.${id}`);
    const input = el('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 3;
    input.autocomplete = 'off';
    input.setAttribute('aria-describedby', 'plan-why');
    say(() => input.setAttribute('aria-label', t('plan.share', { stat: t(`stat.${id}`) })));
    input.addEventListener('change', savePlan);
    shareInputs[id] = input;
    box.append(shareName, input, el('span', 'muted', '%'));
    shares.append(box);
  }
  const planWhy = el('p', 'why');
  planWhy.id = 'plan-why';
  planWhy.setAttribute('aria-live', 'polite');
  const applyBtn = buttonT('plan.apply', '', () => {
    if (state.cultivator.unspent > 0) act(applyPlan(state));
  });
  planBody.append(elt('p', 'muted hint', 'plan.hint'), shares, planWhy, applyBtn);
  const planInner = el('div');
  planInner.append(planSwitch, planBody);
  const plan = fold('Plan', planTitle, planInner).box;
  plan.classList.add('plan');
  /** Saves the typed shares once they make a ratio; until then says why and keeps the saved one. */
  function savePlan(): void {
    const { ratio, why } = planRatio({
      body: shareInputs.body.value,
      agility: shareInputs.agility.value,
      spirit: shareInputs.spirit.value,
    });
    setText(planWhy, why);
    if (ratio) act(setPlanRatio(state, state.cultivator.path, ratio));
  }

  const derived: HTMLElement[] = [];
  const derivedLists = {} as Record<StatGroup, HTMLElement>;
  const derivedCounts = {} as Record<StatGroup, HTMLElement>;
  const derivedValues: HTMLElement[] = [];
  const derivedLabels: HTMLElement[] = [];
  for (const group of STAT_GROUPS) {
    const list = el('dl');
    const g = fold(group, elt('span', '', `group.${group}`), list);
    g.box.classList.add('derived');
    derivedLists[group] = list;
    derivedCounts[group] = g.count;
    derived.push(g.box);
  }

  const respec = el('div', 'respec');
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
  // The skills the picked Path would have at the realm now.
  const pathSkillsLine = el('div', 'path-skills');
  const pathSkillsHead = el('p', 'muted hint');
  const pathSkillsBox = el('div');
  pathSkillsLine.append(pathSkillsHead, pathSkillsBox);
  /** The Path, realm and language the preview shows. */
  let pathSkillsShown = '';
  pathPick.addEventListener('change', drawPathSkills);
  respec.append(
    elt('p', 'muted hint', 'respec.note'),
    resetLine.line,
    pathLine.line,
    pathSkillsLine,
  );
  function drawPathSkills(): void {
    const to = pathPick.value as PathId;
    // Only a Path on the list (the options are), never a value edited in.
    if (!Object.hasOwn(PATHS, to)) return;
    const level = state.cultivator.level;
    const key = `${to} ${realmOf(level)} ${lang().code}`;
    if (key === pathSkillsShown) return;
    pathSkillsShown = key;
    setText(pathSkillsHead, t('skill.changeTo', { path: tn('path', PATHS[to].name) }));
    pathSkillsBox.replaceChildren(skillNames(skillRows(to, level)));
  }

  // Store boosts running now, with the time each has left.
  const boostList = el('ul', 'boost-list');
  const noBoosts = elt('p', 'muted hint', 'store.noBoosts');
  const boostBody = el('div');
  boostBody.append(boostList, noBoosts);
  const boosts = fold('Boosts', elt('span', '', 'store.boosts'), boostBody);
  boosts.box.classList.add('boosts');

  // Skills: each skill learned, its icon, name, level pips, qi cost and
  // effect, its "uses it when" rule as the name's tip; then what the next
  // realm brings (docs/design.md §5 Qi and skills). Four rows, reused.
  const skillsPane = el('div', 'skills-tab');
  const skillList = el('ul', 'skill-list');
  const nextRealm = el('p', 'muted next-realm');
  /** What the rows show (Path, realm, language), so an unchanged frame touches nothing. */
  let skillsShown = '';
  const skillSlots = [0, 1, 2, 3].map((i) => {
    const li = el('li');
    const icon = skillIcon(0);
    // A button, so every screen reader reads the rule it is described by.
    const name = el('button', 'name');
    name.type = 'button';
    const tip = el('div', 'boost-tip skill-tip');
    tip.id = `skill-when-${i}`;
    const tipLabel = el('strong');
    const tipText = el('p');
    tip.append(tipLabel, tipText);
    const pips = el('span', 'pips');
    pips.setAttribute('aria-hidden', 'true');
    const level = el('span', 'sr-only');
    const cost = el('span', 'cost');
    const effect = el('p', 'effect');
    li.append(icon, name, pips, level, cost, effect);
    hoverTip(name, tip, () => {});
    skillList.append(li);
    return { li, icon, name, tip, tipLabel, tipText, pips, level, cost, effect };
  });
  skillsPane.append(skillList, nextRealm);

  /** The Skills list, for the cultivator's Path and realm now. */
  function drawSkillsTab(): void {
    const c = state.cultivator;
    const key = `${c.path} ${realmOf(c.level)} ${lang().code}`;
    if (key === skillsShown) return;
    skillsShown = key;
    const rows = skillRows(c.path, c.level);
    skillSlots.forEach((slot, i) => {
      const row = rows[i];
      // A tip open on a row that changes or goes would show the old skill.
      if (slot.tip.matches(':popover-open')) slot.tip.hidePopover();
      slot.li.hidden = !row;
      if (!row) return;
      slot.icon.dataset.tier = row.tier;
      slot.icon.style.setProperty('--cell', String(row.cell));
      setText(slot.name, row.name);
      setText(slot.tipLabel, t('skill.whenLabel'));
      setText(slot.tipText, row.when);
      setText(slot.pips, '●'.repeat(row.level) + '○'.repeat(row.maxLevel - row.level));
      setText(slot.level, row.levelText);
      setText(slot.cost, row.cost);
      setText(slot.effect, row.effect);
    });
    setText(nextRealm, nextRealmLine(c.path, c.level));
  }

  const statMain = el('div', 'statmain');
  statMain.append(base, plan, ...derived, boosts.box);
  const statTabs = tabs([
    { id: 'stats-main', label: 'tab.stats', body: statMain },
    { id: 'stats-skills', label: 'skill.bar', body: skillsPane },
    { id: 'stats-respec', label: 'respec.title', body: respec },
  ]);
  statTabs.bar.classList.add('subtabs');
  const statsBody = el('div', 'statstab');
  statsBody.append(statTabs.bar, ...statTabs.panels);

  /**
   * A group of the Stats tab that folds (docs/design.md §14): a heading button
   * that reports whether it is open, then `body`. The count after the title
   * shows while folded and is read either way. Which groups are open is kept
   * on this device.
   */
  function fold(
    id: Fold,
    title: HTMLElement,
    body: HTMLElement,
  ): { box: HTMLElement; count: HTMLElement } {
    const box = el('section', 'fold');
    const head = el('h3', 'fold-head');
    const toggle = el('button', 'fold-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', `fold-${id}`);
    const count = el('span', 'count');
    toggle.append(title, count);
    head.append(toggle);
    body.id = `fold-${id}`;
    const show = (): void => {
      const open = folds[id];
      toggle.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      count.className = open ? 'count sr-only' : 'count';
    };
    toggle.addEventListener('click', () => {
      folds[id] = !folds[id];
      pickedFolds = folds;
      writeFolds(storage, folds);
      show();
    });
    show();
    box.append(head, body);
    return { box, count };
  }

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

  // A worn item's card closes with the tab that shows its slot.
  const charTabs = tabs(
    [
      { id: 'gear', label: 'tab.gear', body: slots },
      { id: 'stats', label: 'tab.stats', body: statsBody },
      { id: 'retire', label: 'tab.retire', body: retireBody },
    ],
    (id) => {
      if (id !== 'gear' && selected && 'slot' in selected) select(null);
    },
  );
  character.box.append(charTabs.bar, ...charTabs.panels);
  // A dot on the Stats tab and its Stats sub-tab while points wait to be
  // placed; its words for screen readers.
  const unspentDots = ['#tab-stats', '#tab-stats-main'].map((id) => {
    const tab = character.box.querySelector<HTMLElement>(id) as HTMLElement;
    const dot = el('span', 'tab-dot');
    dot.setAttribute('aria-hidden', 'true');
    const text = el('span', 'sr-only');
    // Put back after the tab's own label is rewritten on a language switch.
    say(() => tab.append(dot, text));
    return { dot, text };
  });

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
      b.addEventListener('click', (e) => {
        setCursor(i);
        const index = order[i];
        select(index === undefined ? null : { bag: index });
        // Enter or Space (a click with no pointer) takes focus into the card.
        if (selected && e.detail === 0) focusCard();
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

  // Bulk sell or salvage: pick a grade, then confirm a message naming the
  // count, the highest grade taken and what it pays (§7).
  const below = choice(
    'inventory.bulkBelow',
    GRADE_IDS.slice(1).map((g) => [g, () => gradeName(g)] as const),
  );
  /**
   * The confirmation open now: its action and grade, the bag the player saw
   * and what it named; null when closed.
   */
  let pending: {
    action: BulkAction;
    grade: GradeId;
    /** The bag it looked at; drops landing later are not taken. */
    seen: readonly Item[];
    preview: BulkPreview;
  } | null = null;
  const confirmBox = el('div', 'confirm');
  confirmBox.setAttribute('role', 'alert');
  const confirmText = el('p');
  const confirmYes = button('', 'primary', () => {
    if (!pending) return;
    const { action, grade, seen } = pending;
    // Null when the bag the player saw changed: show the new numbers first.
    const next = bulkConfirm(state, action, grade, seen);
    if (!next) return askBelow(action, grade);
    closeConfirm();
    // Bag positions shift; an equipped selection stays.
    if (selected && 'bag' in selected) selected = null;
    act(next);
    bulkBtn[action].focus();
  });
  const confirmNo = button('', '', () => {
    if (!pending) return;
    const { action } = pending;
    closeConfirm();
    bulkBtn[action].focus();
  });
  confirmBox.append(confirmText, confirmYes, confirmNo);
  confirmBox.hidden = true;
  // Sell controls wear the Spirit Stones colour, salvage ones the Spirit Essence
  // colour: the class names the action (page.css).
  const bulkBtn: Record<BulkAction, HTMLButtonElement> = {
    sell: buttonT('inventory.sell', 'sell', () => askBelow('sell', below.select.value as GradeId)),
    salvage: buttonT('inventory.salvage', 'salvage', () =>
      askBelow('salvage', below.select.value as GradeId),
    ),
  };
  below.select.addEventListener('change', closeConfirm);
  // The picker wears its grade's colour, as bag cells do.
  tintChoice(below.select, (g) => `grade-${g}`, GRADE_IDS);
  /** Opens the confirmation for `action` below `grade`, naming what it would take now. */
  function askBelow(action: BulkAction, grade: GradeId, focus = true): void {
    // A refill (focus false) keeps focus where it is, unless it is on the Yes
    // button that is about to hide: then it moves to OK, not to the page.
    const onYes = document.activeElement === confirmYes;
    pending = {
      action,
      grade,
      seen: state.inventory,
      preview: bulkPreview(state, action, grade),
    };
    fillConfirm();
    if (focus || (onYes && confirmYes.hidden)) (confirmYes.hidden ? confirmNo : confirmYes).focus();
  }
  /**
   * Writes the open confirmation in the current language. Text that did not
   * change is left alone, so the alert is not read out again for nothing.
   */
  function fillConfirm(): void {
    if (!pending) return;
    const { action, preview } = pending;
    const ask = bulkAsk(action, preview);
    // Rebuilt only when the words change; the highest grade's name is its own
    // span, so it wears its grade colour (text only, never markup).
    if (confirmText.textContent !== ask.text) {
      confirmText.replaceChildren(
        ...ask.parts.map((part) =>
          part.grade
            ? el('span', `grade-${part.grade}`, part.text)
            : document.createTextNode(part.text),
        ),
      );
    }
    setText(confirmYes, ask.yes ?? '');
    confirmYes.className = `primary ${action}`;
    confirmYes.hidden = ask.yes === null;
    confirmBox.dataset.action = action;
    setText(confirmNo, ask.no);
    confirmBox.hidden = false;
  }
  function closeConfirm(): void {
    pending = null;
    confirmBox.hidden = true;
    // Emptied, so the next one is written (and announced) afresh.
    confirmText.replaceChildren();
    delete confirmBox.dataset.action;
    confirmYes.className = 'primary';
  }
  const bulkRow = el('div', 'row');
  bulkRow.append(below.box, bulkBtn.sell, bulkBtn.salvage);
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
  // The minimum grade wears its grade's colour, as the bulk picker does.
  const tintMinGrade = tintChoice(minGrade.select, (g) => `grade-${g}`, GRADE_IDS);
  // Sold or salvaged: the choice wears its action's colour, as the buttons do.
  const tintAction = tintChoice(actionPick.select, (a) => a, ['sell', 'salvage']);
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
  // The Spirit Stone store: the rotation countdown and Refresh now, then one
  // card per offer (icon, name, what it gives, Buy). Cards are made once and
  // filled by drawStore, so a redraw every tick keeps focus on a Buy button.
  const storeCountdownText = el('p', 'muted countdown');
  const refreshBtn = button('', 'sell', () => {
    if (!storeStale(state)) act(refreshStore(state));
  });
  refreshBtn.setAttribute('aria-describedby', 'refresh-why');
  const refreshWhy = el('small', 'why');
  refreshWhy.id = 'refresh-why';
  const storeHead = el('div', 'store-head');
  storeHead.append(storeCountdownText, refreshBtn, refreshWhy);
  const storeCards = Array.from({ length: STOCK_SIZE }, (_, at) => {
    const card = el('li', 'offer');
    const icon = el('span', 'store-icon');
    icon.setAttribute('aria-hidden', 'true');
    const name = el('div', 'title');
    const desc = el('div', 'desc');
    const why = el('small', 'why');
    why.id = `offer-why-${at}`;
    const buy = button('', 'sell', () => buyFromStore(at));
    buy.setAttribute('aria-describedby', why.id);
    const text = el('div', 'offer-text');
    text.append(name, desc, why);
    card.append(icon, text, buy);
    return { card, icon, name, desc, why, buy, drawn: '' };
  });
  // Chests and boosts each get a headed section; drawStore moves a card into
  // its section when the stock changes.
  const storeGroup = (title: MessageKey) => {
    const list = el('ul', 'offers');
    const box = el('section', 'offer-group');
    box.append(elt('h3', '', title), list);
    box.hidden = true;
    return { box, list };
  };
  const chestGroup = storeGroup('store.chests');
  const boostGroup = storeGroup('store.boosts');
  const storeBody = el('div', 'store');
  storeBody.append(storeHead, chestGroup.box, boostGroup.box);

  // A bag item's card closes with the Bag tab.
  const bagTabs = tabs(
    [
      { id: 'bag', label: 'tab.bag', body: bagBody },
      { id: 'filter', label: 'tab.filter', body: filterBody },
      { id: 'store', label: 'tab.store', body: storeBody },
    ],
    (id) => {
      if (id !== 'bag' && selected && 'bag' in selected) select(null);
    },
  );
  inventory.box.append(bagTabs.bar, ...bagTabs.panels);

  // Item details: a card beside the selected cell (a sheet along the bottom of
  // a narrow window), open while an item is selected.
  const details = panel('details', 'details.title');
  details.box.setAttribute('role', 'dialog');
  // Focus lands on the card itself, not on its Sell button, so a repeated
  // Enter never sells.
  details.box.tabIndex = -1;
  details.box.hidden = true;
  const detailBody = el('div', 'detail-body');
  const closeCardBtn = button('✕', 'close', () => closeCard());
  attr(closeCardBtn, 'aria-label', 'details.close');
  details.box.append(closeCardBtn, detailBody);
  details.box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeCard();
  });
  // A press anywhere else closes it: not on a cell (that selects its own item)
  // or inside an open dialog (the Crafting panel works on the card's item). A
  // touch closes it only as a tap, so the page still scrolls under the sheet.
  const outside = (target: EventTarget | null): boolean =>
    !details.box.hidden &&
    target instanceof Element &&
    !details.box.contains(target) &&
    !target.closest('.cell, dialog[open]');
  let touchAt: { x: number; y: number } | null = null;
  document.addEventListener(
    'pointerdown',
    (e) => {
      touchAt = null;
      if (!outside(e.target)) return;
      if (e.pointerType === 'touch') touchAt = { x: e.clientX, y: e.clientY };
      else select(null);
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      const from = touchAt;
      touchAt = null;
      if (!from || !outside(e.target)) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_START_PX) select(null);
    },
    { signal },
  );
  // A scroll gesture ends in pointercancel, not pointerup: not a tap.
  document.addEventListener('pointercancel', () => (touchAt = null), { signal });
  // Esc on the selected cell closes it too.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || details.box.hidden) return;
      if (document.activeElement !== anchorCell()) return;
      e.preventDefault();
      select(null);
    },
    { signal },
  );
  // The card follows its cell when the window or a panel moves it.
  window.addEventListener('resize', () => placeCard(), { signal });
  document.addEventListener(
    'scroll',
    (e) => {
      if (e.target instanceof Node && details.box.contains(e.target)) return;
      placeCard();
    },
    { signal, capture: true, passive: true },
  );
  /** The item's lines under the action row: kept across redraws, so a level-up keeps its scroll. */
  const detailInfo = el('div', 'detail-info');
  /** The selection detailInfo shows; another one starts at the top. */
  let infoFor = '';

  // Crafting: a modal over the office shell for the selected item (bag or worn),
  // one tab per mode. It stays open between crafts, so a craft can be repeated.
  /** Where the item being crafted is, and that item as last drawn; null while closed. */
  let crafting: { at: ItemAt; item: string } | null = null;
  /** The affix picked for a reroll, by index. */
  let craftPick = 0;
  /** The last craft's result line, so a language switch can write it again. */
  let craftSaid: (() => string) | null = null;
  const craft = el('dialog', 'menu craft');
  craft.setAttribute('aria-labelledby', 'craft-title');
  // The dialog has no padding of its own, so a click on it is a click on the backdrop.
  const craftBody = el('div', 'craft-body');
  const craftHead = el('div', 'menu-head');
  const craftTitle = elt('h2', '', 'craft.title');
  craftTitle.id = 'craft-title';
  craftHead.append(
    craftTitle,
    buttonT('craft.close', '', () => closeCraft()),
  );
  const craftItem = el('div', 'item-head');
  const craftEssence = el('p', 'essence');
  /** An action line: the button, then its cost and why it is off; the button is described by both. */
  function craftLine(key: string, btn: HTMLButtonElement) {
    const line = el('div', 'line');
    const cost = el('span', 'cost');
    cost.id = `${key}-cost`;
    const why = el('span', 'why');
    why.id = `${key}-why`;
    const meta = el('small', 'meta');
    meta.append(cost, why);
    btn.setAttribute('aria-describedby', `${cost.id} ${why.id}`);
    line.append(btn, meta);
    return { line, cost, why };
  }
  // Refine: what it can do, then the button.
  const refineLines = el('ul', 'lines');
  const refineBtn = button('', 'primary', () => doRefine());
  const refineLine = craftLine('craft-refine', refineBtn);
  const refineBody = el('div', 'craft-mode');
  refineBody.append(elt('p', 'muted hint', 'craft.refineNote'), refineLines, refineLine.line);
  // Reroll: pick an affix, then the button and its inline confirmation.
  const affixPick = el('fieldset', 'affix-pick');
  const affixList = el('div', 'affixes');
  affixPick.append(elt('legend', '', 'craft.pickAffix'), affixList);
  const rerollBtn = buttonT('craft.reroll', 'primary', () => askReroll());
  const rerollLine = craftLine('craft-reroll', rerollBtn);
  const rerollAsk = el('div', 'confirm');
  rerollAsk.setAttribute('role', 'alert');
  const rerollAskText = el('p');
  const rerollYes = buttonT('craft.reroll', 'primary', () => doReroll());
  const rerollNo = buttonT('confirm.cancel', '', () => {
    rerollAsk.hidden = true;
    rerollBtn.focus();
  });
  rerollAsk.append(rerollAskText, rerollYes, rerollNo);
  rerollAsk.hidden = true;
  const noAffixes = elt('p', 'muted', 'craft.noAffixes');
  const rerollBody = el('div', 'craft-mode');
  rerollBody.append(
    elt('p', 'muted hint', 'craft.rerollNote'),
    affixPick,
    rerollLine.line,
    rerollAsk,
    noAffixes,
  );
  const modeBodies: Record<CraftMode, HTMLElement> = { refine: refineBody, reroll: rerollBody };
  const craftTabs = tabs(
    CRAFT_MODES.map((m) => ({ id: `craft-${m}`, label: `craft.mode.${m}`, body: modeBodies[m] })),
    (id) => {
      pickedCraftMode = CRAFT_MODES.find((m) => `craft-${m}` === id) ?? 'refine';
      rerollAsk.hidden = true;
    },
  );
  attr(craftTabs.bar, 'aria-label', 'craft.modes');
  const craftResult = el('p', 'craft-result');
  craftResult.setAttribute('aria-live', 'polite');
  craftBody.append(
    craftHead,
    craftItem,
    craftEssence,
    craftTabs.bar,
    ...craftTabs.panels,
    craftResult,
  );
  craft.append(craftBody);
  // Esc, and a click on the backdrop, close it the same way as Close.
  craft.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeCraft();
  });
  // Only a press that starts and ends on the backdrop: outside the panel's box
  // (its border is the dialog too), and not a text selection dragged out of it.
  const onBackdrop = (e: MouseEvent): boolean => {
    if (e.target !== craft) return false;
    const r = craft.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedBackdrop = false;
  craft.addEventListener('pointerdown', (e) => (pressedBackdrop = onBackdrop(e)));
  craft.addEventListener('click', (e) => {
    if (pressedBackdrop && onBackdrop(e)) closeCraft();
    pressedBackdrop = false;
  });
  // Tab and Shift+Tab wrap inside the panel.
  craft.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...craft.querySelectorAll<HTMLElement>('button, input')].filter(
      (n) => n.tabIndex >= 0 && n.getClientRects().length > 0,
    );
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

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
  columns.append(character.box, inventory.box);
  const game = el('div', 'game');
  const away = summary && summary.seconds >= SUMMARY_MIN_SECONDS ? overtimePanel(summary) : null;
  if (away) game.append(away);
  const cloud = import.meta.env.DEV && debugged(storage) ? null : sync;
  const cloudUi = cloud ? cloudPanels(cloud, scope) : null;
  if (cloudUi) game.append(cloudUi.note, cloudUi.choice);
  game.append(updateNote);
  // The one-time offer an older save gets after the stat rebalance.
  const rebalance = el('section', 'panel rebalance');
  rebalance.setAttribute('aria-labelledby', 'rebalance-title');
  const rebalanceTitle = elt('h2', '', 'rebalance.title');
  rebalanceTitle.id = 'rebalance-title';
  const rebalanceRow = el('div', 'overtime-row');
  const answerRebalance = (take: boolean): void => {
    if (!state.freeReset) return;
    // The Stats tab hides the slots: a worn item's card closes with them.
    if (selected && 'slot' in selected) selected = null;
    act(answerFreeReset(state, take));
    // The notice is gone: focus goes where the points are placed.
    charTabs.show('stats');
    statTabs.show('stats-main');
    baseTitle.focus();
  };
  rebalanceRow.append(
    elt('p', '', 'rebalance.text'),
    buttonT('rebalance.take', 'primary', () => answerRebalance(true)),
    buttonT('rebalance.keep', '', () => answerRebalance(false)),
  );
  rebalance.append(rebalanceTitle, rebalanceRow);
  rebalance.hidden = !state.freeReset;
  game.append(rebalance);
  // Beside the strip: the summary chips over Recent drops; the two share a row.
  const beside = el('div', 'beside');
  beside.append(kpis, log.box);
  const top = el('div', 'top');
  top.append(strip, beside);
  // Discreet mode: a plain sheet in the strip's place (docs/design.md §14). Only
  // in the page while it shows, so a popped-out strip still leaves the chips the row.
  const pageSheet = plainSheet('discreet in-page');
  /** Puts the sheet in or out of the page as Discreet mode says. */
  const placeSheet = (): void => {
    if (!isDiscreet()) pageSheet.box.remove();
    else if (!top.contains(pageSheet.box)) top.prepend(pageSheet.box);
  };
  placeSheet();
  game.append(top, columns, details.box);
  // Tab HUD and pop-out controls, then the main menu (Settings and Help).
  const tools = el('div', 'tools');
  const notices = notifier(window);
  const noticeBtn = button('', 'toggle', () => {
    void notices.toggle().then(() => drawTools());
  });
  // Auto-Tribulation (docs/design.md §4): on, a due Tribulation joins the end of the floor.
  const autoTrialBtn = button('', 'toggle', () =>
    act(setAutoTribulation(state, !state.trial.auto)),
  );
  // Pop out offers Mini or Discreet (docs/design.md §14); while one is open it closes it.
  const popBtn = button('', '', () => (pip ? pip.close() : popList.toggle()));
  const popList = pickList(
    popBtn,
    'pop-list',
    'discreet.menu',
    POP_STYLES.map((style) => ({ text: () => t(`discreet.${style}`) })),
    () => POP_STYLES.indexOf(pickedPopStyle ?? readPopStyle(storage)),
    (i) => {
      // A pick while the last request still waits on the browser opens nothing, so it is not kept.
      if (opening) return;
      const style = pickPopStyle(POP_STYLES[i]);
      pickedPopStyle = style;
      // Blocked storage still keeps it for this visit.
      writePopStyle(storage, style);
      void togglePopOut(style);
    },
    () => !pip,
  );
  const popBox = el('div', 'lang');
  popBox.append(popBtn, popList.list);
  // Each control is left out where the browser lacks its feature.
  if (canPopOut(window)) tools.append(popBox);
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
  /** What the confirmation says instead of its question (a refusal, progress); null for the question. */
  let resetShown: (() => string) | null = null;
  const resetText = el('p');
  say(
    () =>
      (resetText.textContent = resetShown
        ? resetShown()
        : t(cloud && cloud.status.kind !== 'off' ? 'menu.resetTextCloud' : 'menu.resetText')),
  );
  const refuse = (text: () => string): void => {
    resetShown = text;
    resetText.textContent = text();
    resetYes.hidden = true;
  };
  let resetting = false;
  /** Reset progress is deleting the save: save() writes nothing until the new run. */
  let clearing = false;
  const resetYes = buttonT('menu.resetYes', 'primary', () => {
    if (resetting) return;
    resetting = true;
    void resetAll().finally(() => (resetting = false));
  });
  async function resetAll(): Promise<void> {
    // The cloud save goes first, so a failure leaves everything as it was; a
    // local-only reset would just be undone by the next cloud check.
    if (cloud && cloud.status.kind !== 'off') {
      resetShown = () => t('cloud.resetting');
      resetText.textContent = resetShown();
      const gone = await cloud.deleteCloud();
      if (!gone.ok) {
        refuse(() => t('cloud.resetFailed', { reason: cloudText(gone.message) }));
        return;
      }
    }
    // No autosave while the copies go, or it would write this run back.
    clearing = true;
    if (!(await clearBoth(storage, backup()))) {
      clearing = false;
      refuse(() => t('menu.resetRefused'));
      return;
    }
    menu.close();
    // start() stops this run (timers, autosave, pop-out) before anything is saved again.
    start(root, storage);
  }
  const resetNo = buttonT('confirm.cancel', '', () => {
    resetBox.hidden = true;
    resetAsk.focus();
  });
  const resetBox = el('div', 'confirm');
  resetBox.setAttribute('role', 'alert');
  resetBox.append(resetText, resetYes, resetNo);
  resetBox.hidden = true;
  const resetAsk = buttonT('menu.resetAsk', '', () => {
    resetShown = null;
    resetText.textContent = t(
      cloud && cloud.status.kind !== 'off' ? 'menu.resetTextCloud' : 'menu.resetText',
    );
    resetBox.hidden = false;
    resetYes.hidden = false;
    resetNo.focus();
  });

  // Save code: Export copies the save as text; Import takes one back, after asking.
  /** The line under the save code tools: what the last action did; null for nothing. */
  let codeShown: (() => string) | null = null;
  const codeMsg = el('p', 'muted');
  codeMsg.setAttribute('role', 'status');
  say(() => (codeMsg.textContent = codeShown ? codeShown() : ''));
  const showCode = (text: (() => string) | null): void => {
    codeShown = text;
    codeMsg.textContent = text ? text() : '';
  };
  // Where the browser won't copy (some frames), the code is shown to copy by hand.
  const exportBox = el('textarea', 'code');
  exportBox.readOnly = true;
  exportBox.rows = 3;
  exportBox.hidden = true;
  attr(exportBox, 'aria-label', 'menu.exportField');
  const exportBtn = buttonT('menu.export', '', () => {
    save();
    const code = exportCode(encodeSave(state, Date.now()));
    const manual = (): void => {
      exportBox.value = code;
      exportBox.hidden = false;
      exportBox.select();
      showCode(() => t('menu.exportManual'));
    };
    exportBox.hidden = true;
    exportBox.value = '';
    if (!navigator.clipboard) return manual();
    navigator.clipboard.writeText(code).then(() => showCode(() => t('menu.exported')), manual);
  });
  const importField = el('label', 'field');
  // Named for screen readers; the field shows the same words as its placeholder.
  const importCaption = elt('span', 'sr-only', 'menu.importField');
  // The pasted code is never echoed: not in a message, the title or a log.
  const importBox = el('textarea', 'code');
  importBox.rows = 2;
  attr(importBox, 'placeholder', 'menu.importField');
  importBox.autocomplete = 'off';
  // Off, so no spell or grammar checker sends a code anywhere.
  for (const box of [importBox, exportBox]) {
    box.spellcheck = false;
    box.dataset.gramm = 'false';
    box.dataset.enableGrammarly = 'false';
  }
  importField.append(importCaption, importBox);
  /** The save a checked code holds, waiting for the player's yes. */
  let imported: Save | null = null;
  const importText = el('p');
  const importYes = buttonT('menu.importYes', 'primary', () => {
    if (!imported) return;
    const save = imported;
    imported = null;
    menu.close();
    // start() stops this run first; play() then writes the imported save to both copies.
    start(root, storage, save);
  });
  const importNo = buttonT('confirm.cancel', '', () => {
    imported = null;
    importConfirm.hidden = true;
    importBtn.focus();
  });
  const importConfirm = el('div', 'confirm');
  importConfirm.setAttribute('role', 'alert');
  importConfirm.append(importText, importYes, importNo);
  importConfirm.hidden = true;
  say(() => {
    if (imported)
      importText.textContent = t('menu.importText', { summary: saveSummary(imported, Date.now()) });
  });
  const importBtn = buttonT('menu.import', '', () => {
    const pasted = importBox.value;
    const result = importCode(pasted);
    importBox.value = '';
    imported = null;
    importConfirm.hidden = true;
    if (!result.ok) {
      if (result.why === 'newer' && updater.canReload) {
        // Kept for this tab only, and imported again (with the player's yes) once the page runs that release.
        try {
          sessionStore()?.setItem(IMPORT_KEY, pasted);
        } catch {
          // Too big or blocked: the player pastes it again after the reload.
        }
        needUpdate('save');
      }
      const key = (
        {
          empty: 'menu.importEmpty',
          tooBig: 'menu.importTooBig',
          bad: 'menu.importBad',
          newer: 'menu.importNewer',
        } as const
      )[result.why];
      showCode(() => t(key));
      return;
    }
    showCode(null);
    imported = result.save;
    importText.textContent = t('menu.importText', {
      summary: saveSummary(result.save, Date.now()),
    });
    importConfirm.hidden = false;
    importNo.focus();
  });

  /** The Settings theme choice; start() already put the saved one on the page. */
  let theme = pickedTheme ?? readTheme(storage);
  /** Shows `theme` on the page and, while it is open, the pop-out. */
  const applyTheme = (): void =>
    showTheme([document.documentElement, pip?.document.documentElement], theme, osDark.matches);
  /** Help's Stats entry, one line per stat: its name, then the tip's parts. */
  const helpStatParts = Object.fromEntries(
    STAT_IDS.map((id) => [id, { name: el('b'), lines: [0, 1, 2, 3].map(() => el('span')) }]),
  ) as Record<StatId, { name: HTMLElement; lines: HTMLElement[] }>;
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
    /** One section of Settings, set off from the next by a rule. */
    const section = (...nodes: HTMLElement[]): HTMLElement => {
      const box = el('section');
      box.append(...nodes);
      return box;
    };
    /**
     * A setting with one control: its name and a hint on the left, the
     * control at a fixed width on the right. A select or toggle is named by
     * the heading; a toggle's On / Off is its aria-pressed state.
     */
    const row = (id: string, title: MessageKey, hint: MessageKey | null, control: HTMLElement) => {
      const h3 = elt('h3', '', title);
      h3.id = id;
      const text = el('div');
      text.append(h3, ...(hint ? [elt('p', 'muted hint', hint)] : []));
      const line = el('div', 'setting-row');
      // A plain button keeps its own words as its name.
      if (control.classList.contains('toggle') || !(control instanceof HTMLButtonElement)) {
        control.id ||= `${id}-control`;
        control.setAttribute('aria-labelledby', id);
      }
      line.append(text, control);
      return section(line);
    };
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
    settings.append(row('menu-theme', 'menu.theme', null, themePick.select));
    if (notices.state() !== 'unsupported') {
      settings.append(row('menu-notify', 'menu.notifications', 'menu.notify', noticeBtn));
    }
    settings.append(row('menu-trial', 'menu.autoTrial', 'menu.autoTrialHint', autoTrialBtn));
    if (cloudUi) settings.append(section(...cloudUi.menu));
    // Paste, then Import; Export beside it shows the code to copy under the row.
    const codeRow = el('div', 'cloud-row');
    codeRow.append(importBtn, exportBtn);
    const reset = row('menu-reset', 'menu.reset', 'menu.resetHint', resetAsk);
    reset.append(resetBox);
    settings.append(
      section(
        elt('h3', '', 'menu.backup'),
        elt('p', 'muted hint', 'menu.backupHint'),
        importField,
        codeRow,
        exportBox,
        importConfirm,
        codeMsg,
      ),
      reset,
    );
    const help = el('div', 'help');
    const helpLines = el('ul', 'lines');
    for (const line of HELP_LINES) helpLines.append(elt('li', '', line));
    // Stats: each stat's tip, filled in for this cultivator while the menu is open.
    const statList = el('ul', 'lines help-stats');
    for (const id of STAT_IDS) {
      const li = el('li');
      const parts = helpStatParts[id];
      li.append(parts.name, ...parts.lines);
      statList.append(li);
    }
    // Qi and skills, with the sim's own numbers.
    const qiList = el('ul', 'lines');
    const qiLines = [0, 1, 2, 3].map(() => el('li'));
    qiList.append(...qiLines);
    say(() => helpQiLines().forEach((line, i) => qiLines[i] && setText(qiLines[i], line)));
    help.append(
      helpLines,
      elt('h3', '', 'help.qi'),
      qiList,
      elt('h3', '', 'help.stats'),
      elt('p', 'muted hint', 'help.statsHint'),
      statList,
    );
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
  // Discreet view, the other pop-out: a plain sheet of the same numbers, in office words.
  const discreetPop = plainSheet('discreet');
  discreetPop.box.addEventListener('click', () => window.focus());
  let pip: Window | null = null;
  /** Which view the open pop-out was opened as. */
  let popped: PopStyle = 'mini';
  /** What the open pop-out shows: the Discreet sheet while Discreet mode is on, whichever was picked. */
  const popView = (): PopStyle => (isDiscreet() ? 'discreet' : popped);
  /** A pop-out request is waiting on the browser; further clicks wait for it. */
  let opening = false;
  /** Drops kept while the tab was hidden: the title counts them, the favicon marks the best. */
  let unseen: Unseen = NOTHING_UNSEEN;
  let blinkOn = true;
  let blinkAt = 0;

  const footer = statusBar();
  root.replaceChildren(bar, formulaBar(), game, footer.bar, menu, craft);
  away?.querySelector('button')?.focus();

  /**
   * `key` names what the name shows (who, in which language): the parts are
   * only built, and the name only redrawn, when it changes, not every frame.
   */
  function setFighter(
    f: Fighter,
    key: string,
    parts: () => readonly NamePart[],
    hp: number,
    maxHp: number,
    qi: number,
    maxQi: number,
  ): void {
    if (key !== f.nameKey) {
      f.nameKey = key;
      const shown = parts();
      // The tier unit (a block: a line of its own), then the name, as DOM nodes
      // and text only. The space between them collapses at the start of line 2;
      // it is there so the element's text reads like the tooltip.
      const nodes: Node[] = [];
      for (const span of nameSpans(shown)) {
        if (nodes.length) nodes.push(document.createTextNode(' '));
        nodes.push(el('span', span.className, span.text));
      }
      f.name.replaceChildren(...nodes);
      // The full name on hover, should one ever reach the 2-line clamp.
      f.name.setAttribute('title', plainName(shown));
    }
    f.hp.textContent = t('strip.hp', { hp: Math.max(0, Math.ceil(hp)), max: maxHp });
    f.bar.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
    const pool = maxQi > 0;
    f.qiTrack.style.visibility = pool ? '' : 'hidden';
    f.qi.style.width = pool ? `${Math.max(0, Math.min(100, (qi / maxQi) * 100))}%` : '0%';
    const shown = Math.floor(qi);
    const said = `${lang().code}\u0000${shown}\u0000${maxQi}`;
    // A demon's hidden bar is not read out, so its numbers are left as they were.
    if (pool && said !== f.qiSaid) {
      f.qiSaid = said;
      f.qiTrack.setAttribute('aria-valuemax', String(maxQi));
      f.qiTrack.setAttribute('aria-valuenow', String(shown));
      f.qiTrack.setAttribute('aria-valuetext', t('strip.qiValue', { qi: shown, max: maxQi }));
    }
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
    const code = lang().code;
    const d = derive(c);
    setFighter(
      you,
      `${code}\u0000${c.path}`,
      () => [{ text: tn('path', PATHS[c.path].name) }],
      c.hp,
      d.maxHp,
      c.qi,
      d.maxQi,
    );
    if (enemy) {
      foe.box.dataset.kind = enemy.kind;
      setFighter(
        foe,
        `${code}\u0000${enemy.kind}\u0000${enemy.name}`,
        () => enemyNameParts(enemy.kind, enemy.name),
        enemy.hp,
        enemy.maxHp,
        enemy.qi,
        maxQi(enemy.kind),
      );
      // While it winds up, it yells the skill and a cast bar fills over its qi.
      const windUp = windUpOf(state);
      foe.cast.hidden = !windUp;
      foe.cast.style.width = `${(windUp?.progress ?? 0) * 100}%`;
      showYell(windUp?.skill ?? null);
    } else showYell(null);
    // The cultivator's bubble ends with its fight, and moves (or goes) for the enemy's.
    if (!youYell.hidden) {
      if (state.combat.fight !== youYellFight) hideYouYell();
      else placeYouYell();
    }
    const z = zoneOf(state.floor);
    if (z !== zone) {
      zone = z;
      stage.style.backgroundImage = cssUrl(artUrl(`bg-${z}`));
    }
    useSheet(you, `path-${c.path}`, SPRITE_SIZE.path);
    drawSkills(skills.slots, skillBar(state));
    const call = tribulationCall(state);
    const pause = trialPause(state);
    trialCall.hidden = !call;
    trialCall.classList.toggle('paused', pause !== null);
    trialRetry.hidden = pause === null;
    setText(trialHead, pause ? pause.head : t('trial.due'));
    setText(trialText, pause ? pause.detail : call ? t('trial.call', call) : '');
    // The one-line strip may cut the text short; the whole of it shows on hover.
    const whole = call ? `${trialHead.textContent ?? ''} ${trialText.textContent ?? ''}` : '';
    if (trialCall.title !== whole) trialCall.title = whole;
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
      if (e.youHit) damageNumber(you, e.youTook);
      if (e.youDied) damageNumber(you, prev.cultivator.hp);
      if (before && (e.foeHit || e.foeDied)) {
        damageNumber(foe, before.hp - (e.foeDied ? 0 : (enemy?.hp ?? 0)));
      }
      const calls = castCallouts(prev, state);
      // Only the last yell of a step gets the bubble; any earlier one floats.
      const lastYell = calls.findLastIndex((c) => c.yell !== null);
      calls.forEach((call, i) => {
        const f = call.who === 'you' ? you : foe;
        // The attack pose is the cast pose.
        if (call.cast && !(call.who === 'you' ? e.youDied : e.foeDied))
          playAction(f, 'attack', now);
        // A yell that finds no room floats as a plain callout instead.
        const yelled = i === lastYell && call.yell !== null && showYouYell(call.yell);
        if (!yelled) callout(f, call.text, call.cast);
      });
      if (lightningStrikes(prev, state) > 0) strikeFlash();
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

  /**
   * The foe's yell bubble: `skill` while it winds up, hidden for null. Its
   * right edge lines up with the foe's sprite and its top with the stage's,
   * so it never leaves the stage whatever the sprite's size; where the names
   * and HP are drawn over the stage (short screens), it sits just under them.
   * Placed as it appears, and again if the stage changes size mid wind-up.
   */
  function showYell(skill: string | null): void {
    yell.hidden = skill === null;
    if (skill === null) {
      yellPlacedFor = '';
      return;
    }
    const text = yellText(skill);
    setText(yell, text);
    const placeFor = `${stage.clientWidth}x${stage.clientHeight}x${window.innerHeight}x${foe.size}x${foe.sprite.offsetLeft}x${text}`;
    if (placeFor === yellPlacedFor) return;
    yellPlacedFor = placeFor;
    const s = stage.getBoundingClientRect();
    const f = fighters.getBoundingClientRect();
    const over = f.top < s.bottom && f.bottom > s.top ? f.bottom - s.top : 0;
    // Bounding boxes are in page pixels; the stage may be zoomed (page.css --z).
    const z = s.height > 0 && stage.offsetHeight > 0 ? s.height / stage.offsetHeight : 1;
    const top = over > 0 ? Math.ceil(over / z) : 0;
    const sprite = foe.sprite;
    // Above the sprite when it fits there; otherwise (the names drawn over a
    // short stage) beside it, on its left, so it never covers the enemy.
    yell.classList.remove('beside');
    yell.style.top = top > 0 ? `${top}px` : '';
    yell.style.right = `${Math.max(0, stage.clientWidth - sprite.offsetLeft - foe.size)}px`;
    // The tail points at the middle of the sprite, whatever its size.
    yell.style.setProperty('--tail', `${foe.size / 2}px`);
    if (yell.offsetTop + yell.offsetHeight <= sprite.offsetTop) return;
    yell.classList.add('beside');
    yell.style.right = `${Math.max(0, stage.clientWidth - sprite.offsetLeft)}px`;
    yell.style.top = `${Math.max(top, sprite.offsetTop)}px`;
  }

  /**
   * The cultivator yells `text` in its bubble for YOU_YELL_MS, replacing one
   * already up. False when it fits nowhere clear of the sprites and the
   * enemy's bubble (then nothing shows).
   */
  function showYouYell(text: string): boolean {
    setText(youYell, text);
    youYell.hidden = false;
    // Restarts the pop, even for the same skill twice.
    youYell.style.animation = 'none';
    void youYell.offsetWidth;
    youYell.style.animation = '';
    youYellFight = state.combat.fight;
    youYellPlacedFor = '';
    clearTimeout(youYellTimer);
    if (!placeYouYell()) return false;
    youYellTimer = window.setTimeout(hideYouYell, YOU_YELL_MS);
    return true;
  }

  function hideYouYell(): void {
    clearTimeout(youYellTimer);
    youYell.hidden = true;
    youYellPlacedFor = '';
  }

  /**
   * Places the cultivator's bubble (yell.ts): above its sprite under any
   * names drawn over the stage, else beside it; hidden when neither fits.
   * Placed again only when the layout or the enemy's bubble changed.
   */
  function placeYouYell(): boolean {
    const foeYell = yell.hidden ? null : stageBox(yell);
    const sprite = you.sprite;
    const placeFor = `${stage.clientWidth}x${stage.clientHeight}x${window.innerHeight}x${you.size}x${sprite.offsetLeft}x${foe.size}x${foe.sprite.offsetLeft}x${youYell.textContent ?? ''}x${foeYell ? Object.values(foeYell).join(',') : ''}`;
    if (placeFor === youYellPlacedFor) return true;
    youYellPlacedFor = placeFor;
    const s = stage.getBoundingClientRect();
    const f = fighters.getBoundingClientRect();
    const over = f.top < s.bottom && f.bottom > s.top ? f.bottom - s.top : 0;
    // Bounding boxes are in page pixels; the stage may be zoomed (page.css --z).
    const z = s.height > 0 && stage.offsetHeight > 0 ? s.height / stage.offsetHeight : 1;
    // The same gap as the enemy's bubble keeps from the stage's top, and its tail.
    const gap = Math.ceil(6 / z);
    const top = over > 0 ? Math.ceil(over / z) : 0;
    const style = youYell.style;
    style.left = '0px';
    style.top = '0px';
    // Two lines at most, like the enemy's: page.css sets the line height to
    // 1.2; padding and borders are read, so a style change keeps the count.
    const cs = getComputedStyle(youYell);
    const px = (v: string): number => parseFloat(v) || 0;
    const lineHeight = px(cs.fontSize) * 1.2;
    const frame =
      px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const maxHeight = lineHeight * 2.5 + frame;
    const place = placeYell({
      width: stage.clientWidth,
      top: top > 0 ? top : gap,
      gap,
      you: stageBox(sprite),
      avoid: foeYell ? [stageBox(foe.sprite), foeYell] : [stageBox(foe.sprite)],
      measure: (maxWidth) => {
        style.maxWidth = `min(${10.5 / z}rem, ${Math.floor(maxWidth)}px)`;
        const h = youYell.offsetHeight;
        return h > maxHeight ? null : { w: youYell.offsetWidth, h };
      },
    });
    if (!place) {
      hideYouYell();
      return false;
    }
    youYell.classList.toggle('beside', place.beside);
    style.left = `${place.box.x}px`;
    style.top = `${place.box.y}px`;
    // The tail points at the middle of the sprite, kept inside a short bubble.
    style.setProperty('--tail', `${Math.min(you.size / 2, place.box.w - gap * 2)}px`);
    return true;
  }

  /** An element's box in the stage's own pixels. */
  function stageBox(n: HTMLElement): Box {
    return { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
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

  /**
   * A skill's name or an effect's word, drawn in code like the damage numbers,
   * floating over the fighter. Not read out: screen readers are not told each cast.
   */
  function callout(f: Fighter, text: string, cast: boolean): void {
    if (stage.querySelectorAll('.callout').length >= MAX_CALLOUTS) return;
    const n = el('span', `callout ${f === you ? 'you' : 'foe'}${cast ? ' cast' : ''}`, text);
    n.setAttribute('aria-hidden', 'true');
    n.style.left = `${f.sprite.offsetLeft + f.size / 2}px`;
    n.style.bottom = `${Math.round(f.size * 1.05)}px`;
    stage.append(n);
    setTimeout(() => n.remove(), CALLOUT_MS);
  }

  /** A Heavenly Lightning strike flashes the stage, drawn in code; reduced motion shows none. */
  function strikeFlash(): void {
    const n = el('span', 'strike');
    n.setAttribute('aria-hidden', 'true');
    stage.append(n);
    setTimeout(() => n.remove(), STRIKE_MS);
  }

  function drawSummary(): void {
    const c = state.cultivator;
    kPath.value.textContent = tn('path', PATHS[c.path].name);
    kRealm.value.textContent = realmLabel(c.level);
    realms.refresh();
    // A breakthrough swaps the realm's icon.
    const icon = summaryIcon('realm', c.level);
    if (icon !== realmIcon && kRealm.icon) {
      realmIcon = icon;
      setSummaryIcon(kRealm.icon, icon);
    }
    for (const chip of boostChips) {
      const value = boostChip(state, chip.id);
      chip.box.classList.toggle('off', value === null);
      setText(chip.full, value?.full ?? '');
      const bonus = value?.bonus ?? '';
      if (chip.percent.data !== bonus) chip.percent.data = bonus;
      setText(chip.word, value?.word ?? '');
      // An open tip keeps counting down; one whose boost ran out closes.
      if (chip.isOpen()) {
        if (value) chip.fillTip();
        else chip.tip.hidePopover();
      }
    }
    const bar = xpBar(c);
    xp.style.setProperty('--xp', `${bar.percent}%`);
    for (const n of [xpLevel, xpFillLevel]) setText(n, bar.level);
    for (const n of [xpPath, xpFillPath]) setText(n, tn('path', PATHS[c.path].name));
    for (const n of [xpText, xpFillText]) setText(n, bar.text);
    xp.setAttribute('aria-valuenow', String(Math.round(bar.percent)));
    xp.setAttribute('aria-valuetext', bar.spoken);
    for (const id of STAT_IDS) {
      setText(baseValues[id], String(c.stats[id]));
      const boost = realmBoost(c, id);
      setText(boostValues[id], boost);
      // Only a boost there is takes focus and opens its tip.
      boostValues[id].hidden = boost === '';
    }
    for (const refresh of boostTips) refresh();
    for (const refresh of statTips) refresh();
    drawSkillsTab();
    drawDerived();
    drawPlan();
    if (menu.open) drawHelpStats();
  }

  /**
   * The derived rows; while +1 or All is hovered or focused, the values
   * spending would give, gains green and losses red.
   */
  function drawDerived(): void {
    const c = state.cultivator;
    const found = {
      stoneFind: boostBonus(state, 'stones'),
      treasureFind: boostBonus(state, 'treasure'),
    };
    const rows = statRows(c, state.passives, found);
    if (previewing && (previewing.n < 1 || previewing.n > c.unspent)) previewing = null;
    const preview = previewing
      ? spendPreview(c, previewing.stat, previewing.n, state.passives, found)
      : null;
    // Built once per Path's set of rows, then only the values change, so
    // selecting text doesn't flicker.
    if (derivedPath !== c.path || derivedValues.length !== rows.length) {
      derivedPath = c.path;
      derivedValues.length = 0;
      derivedLabels.length = 0;
      for (const list of Object.values(derivedLists)) list.replaceChildren();
      for (const r of rows) {
        const dd = el('dd', '', r.value);
        const dt = el('dt', '', r.short);
        // The full name where the group shortens it ("Treasure" under Find).
        if (r.short !== r.label) dt.title = r.label;
        derivedLabels.push(dt);
        derivedLists[r.group].append(dt, dd);
        derivedValues.push(dd);
      }
      for (const group of STAT_GROUPS) {
        setText(derivedCounts[group], ` (${derivedLists[group].querySelectorAll('dt').length})`);
      }
    }
    rows.forEach((r, i) => {
      const dd = derivedValues[i];
      if (dd) {
        const p = preview?.[i];
        setText(dd, p?.value ?? r.value);
        const change = p?.change ?? '';
        if ((dd.dataset.change ?? '') !== change) dd.dataset.change = change;
      }
      const dt = derivedLabels[i];
      if (dt) {
        setText(dt, r.short);
        if (r.short !== r.label && dt.title !== r.label) dt.title = r.label;
      }
    });
  }

  /** The Auto-assign switch and, while it is on, this Path's shares and Apply plan. */
  function drawPlan(): void {
    const c = state.cultivator;
    const auto = state.statPlan.auto;
    if (planSwitch.getAttribute('aria-checked') !== String(auto)) {
      planSwitch.setAttribute('aria-checked', String(auto));
    }
    planBody.hidden = !auto;
    setText(planTitle, planSummary(auto, state.statPlan.slots[c.path].ratio));
    // A Path change shows that Path's plan afresh.
    const fresh = plan.dataset.path !== c.path;
    if (fresh) {
      plan.dataset.path = c.path;
      setText(planWhy, '');
    }
    // The saved shares, unless the player is typing or what they typed was refused.
    const typing = STAT_IDS.some((id) => shareInputs[id] === document.activeElement);
    if (fresh || (!typing && planWhy.textContent === '')) {
      const ratio = state.statPlan.slots[c.path].ratio;
      for (const id of STAT_IDS) {
        const v = String(ratio[id]);
        if (shareInputs[id].value !== v) shareInputs[id].value = v;
      }
    }
    setButton(applyBtn, t('plan.apply'), c.unspent === 0);
  }

  /** Help's Stats entry: each stat's tip, for this cultivator now. */
  function drawHelpStats(): void {
    for (const id of STAT_IDS) {
      const tip = statTip(state.cultivator, id);
      const parts = helpStatParts[id];
      setText(parts.name, t(`stat.${id}`));
      [tip.gain, tip.mastery, tip.share, tip.slows].forEach((text, i) => {
        const part = parts.lines[i] as HTMLElement;
        setText(part, text);
        part.hidden = text === '';
      });
    }
  }

  function selectedItem(): Item | undefined {
    if (!selected) return undefined;
    return 'bag' in selected
      ? state.inventory[selected.bag]
      : state.cultivator.equipment[selected.slot];
  }

  /**
   * A bag item's badge (▲ / ▼ / dash / none). Results are kept per item until the
   * equipped gear or the level changes (gearVersion + level: everything derive()
   * reads), so a drop, selection, page turn or sort reuses them; the cultivator's
   * current derive() is worked out once per gear change.
   */
  function verdicts(): (item: Item) => GearVerdict {
    const c = state.cultivator;
    const key = `${gearVersion}|${c.level}`;
    if (badges?.key !== key) badges = { key, now: derive(c), cache: new WeakMap() };
    const { now, cache } = badges;
    return (item) => {
      let v = cache.get(item);
      if (v === undefined) cache.set(item, (v = gearVerdict(c, item, now)));
      return v;
    };
  }

  /** Cells and details are built once and refilled in place, so focus never drops. */
  function drawGear(): void {
    const c = state.cultivator;
    // The figure follows the Path at once (a Path change or Reincarnation), the mist the realm.
    if (doll.figure.dataset.path !== c.path) {
      doll.figure.dataset.path = c.path;
      doll.figure.style.backgroundImage = cssUrl(artUrl(`doll-${c.path}`));
    }
    const mist = realmMist(realmOf(c.level));
    if (slots.dataset.mist !== mist) {
      slots.dataset.mist = mist;
      slots.style.setProperty('--mist', mist);
    }
    // The panel ignores the bag's length (drops only append), so a drop never
    // rebuilds it and takes focus off its Equip button. A worn item's panel
    // redraws only when a drop fills the bag, which turns its Unequip off.
    const full = !!selected && 'slot' in selected && !!unequipBlock(state);
    const detailsKey = `${gearVersion}|${c.level}|${JSON.stringify(selected)}|${full}`;
    // A new selection (or its item changing) also moves the card, once the cells are drawn.
    const moved = detailsKey !== drawnDetails;
    if (moved) {
      drawnDetails = detailsKey;
      drawDetails();
      details.box.hidden = !selectedItem();
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
    const verdict = verdicts();
    bagCells.forEach((b, i) => {
      const index = order[i];
      const item = index === undefined ? undefined : state.inventory[index];
      fillCell(b, item, t('inventory.emptyCell', { n: i + 1 }), item ? verdict(item) : null);
      b.setAttribute(
        'aria-pressed',
        String(index !== undefined && !!selected && 'bag' in selected && selected.bag === index),
      );
    });
    for (const slot of SLOT_IDS) {
      const b = slotCells[slot];
      const name = tn('equipSlot', EQUIP_SLOTS[slot].name);
      const item = c.equipment[slot];
      fillCell(b, item, t('inventory.emptySlot', { slot: name }));
      if (!item) setSlotIcon(b.children[1] as HTMLElement, EQUIP_SLOTS[slot].takes);
      // fillCell resets classes; a drag in progress keeps its target slots marked.
      b.classList.toggle('target', !!drag?.ghost && canDrop(state.inventory[drag.index], slot));
      b.setAttribute(
        'aria-pressed',
        String(!!selected && 'slot' in selected && selected.slot === slot),
      );
    }
    // The cells may have moved (a drop re-sorting the bag): the card follows.
    if (moved || selected) placeCard(moved);
  }

  function drawDetails(): void {
    const item = selectedItem();
    soulsText = null;
    if (!item || !selected) {
      detailBody.replaceChildren(el('p', 'muted', t('details.none')));
      return;
    }
    // One kind's lines on a row behind a pill naming the kind, in its colour.
    const kindRow = (k: StatKind, items: readonly HTMLElement[]): HTMLElement => {
      const kind = t(`stat.kind.${k}`);
      const label = el('div', 'kind-label', kind);
      label.setAttribute('aria-hidden', 'true');
      const lines = el('ul', 'lines');
      lines.setAttribute('aria-label', kind);
      lines.append(...items);
      const box = el('div', `kind kind-${k}`);
      box.append(label, lines);
      return box;
    };
    // The attributes in one block, grouped by what they do, each kind in its own colour.
    const attrs = block('details.attributes');
    for (const group of itemLineGroups(item))
      attrs.append(
        kindRow(
          group.kind,
          group.lines.map((line) => el('li', '', line)),
        ),
      );
    const head = el('div', 'item-head');
    const icon = el('span', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, item);
    head.append(icon, el('div', `title grade-${item.grade}`, itemName(item)));
    // Each fact under its own label, as the attributes sit under theirs.
    const facts = el('dl', 'facts');
    for (const f of itemFacts(item, state)) {
      const value = el('dd', f.tone, f.value);
      if (f.id === 'souls') soulsText = value;
      const pair = el('div');
      pair.append(el('dt', '', f.label), value);
      facts.append(pair);
    }
    const about = block('details.item');
    about.append(head, facts);
    // The item on the left; for a bag item, what is worn in each position it
    // fits on the right, side by side.
    const itemCol = el('div', 'card-item');
    itemCol.append(about, attrs);
    const parts: HTMLElement[] = [itemCol];
    // Crafting works on bag and worn items alike.
    const craftBtn = button(t('details.craft'), '', () => openCraft());
    craftBtn.dataset.action = 'craft';
    craftBtn.setAttribute('aria-haspopup', 'dialog');
    const actions = el('div', 'row actions');
    // Equip or Unequip in the Item block, on a row of their own.
    const wear = el('div', 'row');
    if ('slot' in selected) {
      actions.append(craftBtn);
      const from = selected.slot;
      const off = button(t('details.unequip'), '', () => unequipFromSlot(from));
      off.dataset.action = 'unequip';
      wear.append(off);
      about.append(el('p', 'muted', t('details.equipped')));
      const blocked = unequipBlock(state);
      if (blocked) about.append(blockedBy(blocked, 'unequip-why', [off]));
      about.append(wear);
    } else {
      const index = selected.bag;
      const blocked = equipBlock(state.cultivator, item);
      // One Equip button per position the item fits (two for accessories and
      // charms, each naming its position), the default position first; each
      // position's comparison below in a block of its own.
      const fits = slotsFor(item.slot);
      const first = defaultSlot(state.cultivator.equipment, item);
      const compareCol = el('div', 'card-compare');
      parts.push(compareCol);
      for (const to of [first, ...fits.filter((p) => p !== first)]) {
        const name = tn('equipSlot', EQUIP_SLOTS[to].name);
        const current = state.cultivator.equipment[to];
        const diff = compareToEquipped(state.cultivator, item, to);
        // The same kind rows as the Attributes box; each line keeps its up/down colour.
        const compare = compareGroups(diff).map((group) =>
          kindRow(
            group.kind,
            group.lines.map((d) => el('li', d.better ? 'up' : 'down', d.text)),
          ),
        );
        if (!diff.length) {
          const none = el('ul', 'lines');
          none.append(el('li', 'muted', t('details.noChange')));
          compare.push(none);
        }
        const equipBtn = button(
          fits.length > 1 ? t('details.equipIn', { slot: name }) : t('details.equip'),
          'primary',
          () => equipFromBag(index, to),
        );
        equipBtn.dataset.action = 'equip';
        wear.append(equipBtn);
        const vs = el('div', 'detail-block');
        vs.append(
          el(
            'h3',
            '',
            current
              ? t('details.vs', { slot: name, item: itemName(current) })
              : t('details.empty', { slot: name }),
          ),
        );
        // The worn item's own attributes, then what equipping this one changes.
        if (current)
          for (const group of itemLineGroups(current))
            vs.append(
              kindRow(
                group.kind,
                group.lines.map((line) => el('li', '', line)),
              ),
            );
        vs.append(el('div', 'detail-block-label change', t('details.change')), ...compare);
        compareCol.append(vs);
      }
      if (blocked) {
        const why = t('details.blocked', { why: blocked });
        about.append(blockedBy(why, 'equip-why', [...wear.querySelectorAll('button')]));
      }
      about.append(wear);
      const sellBtn = button(t('details.sell', { n: sellPrice(item) }), 'sell', () =>
        dispose(index, 'sell'),
      );
      sellBtn.dataset.action = 'sell';
      const salvageBtn = button(t('details.salvage', { n: essenceValue(item) }), 'salvage', () =>
        dispose(index, 'salvage'),
      );
      salvageBtn.dataset.action = 'salvage';
      actions.append(sellBtn, salvageBtn, craftBtn);
    }
    // A level-up redraws the comparison; a focused Equip button keeps focus.
    const active = document.activeElement;
    const focusAt = detailBody.contains(active)
      ? [...detailBody.querySelectorAll('button')].indexOf(active as HTMLButtonElement)
      : -1;
    // Sell, Salvage and Craft first, on a row of their own above the item, so
    // they stay in one place whatever the item says; the rest scrolls under them.
    // The group is named for the item, so a screen reader hears whose buttons they are.
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', itemName(item));
    details.box.setAttribute('aria-label', itemName(item));
    detailInfo.classList.toggle('two', parts.length > 1);
    const scroll = detailInfo.scrollTop;
    detailInfo.replaceChildren(...parts);
    detailBody.replaceChildren(actions, detailInfo);
    const key = JSON.stringify(selected);
    detailInfo.scrollTop = key === infoFor ? scroll : 0;
    infoFor = key;
    if (focusAt >= 0) {
      const buttons = detailBody.querySelectorAll('button');
      (buttons[focusAt] ?? buttons[0])?.focus();
    }
  }

  /** The cell the selected item shows in: its bag cell or its slot. */
  function anchorCell(): HTMLButtonElement | undefined {
    if (!selected) return undefined;
    return 'bag' in selected ? bagCells[order.indexOf(selected.bag)] : slotCells[selected.slot];
  }

  /**
   * Sets the open card beside its cell, kept inside the window, or along the
   * bottom as a sheet (cardPlace). A cell out of sight (its tab or page not
   * shown) hides the card. `reveal` (a new selection) scrolls the page so the
   * sheet does not cover the cell.
   */
  function placeCard(reveal = false): void {
    const box = details.box;
    if (!selectedItem()) {
      columns.style.marginBottom = '';
      return;
    }
    const r = anchorCell()?.getBoundingClientRect();
    const shown = !!r && r.width > 0;
    box.hidden = !shown;
    if (!r || !shown) {
      columns.style.marginBottom = '';
      return;
    }
    const want = detailInfo.classList.contains('two') ? CARD_WIDTH : CARD_NARROW;
    const first = cardPlace(r, innerWidth, innerHeight, 0, want);
    box.classList.toggle('sheet', first.sheet);
    if (first.sheet) {
      for (const p of ['left', 'top', 'width', 'max-height']) box.style.removeProperty(p);
      // Room under the panels for the sheet, so even the last row can scroll above it.
      columns.style.marginBottom = `${box.offsetHeight}px`;
      const under = r.bottom + CARD_EDGE - box.getBoundingClientRect().top;
      if (reveal && under > 0) window.scrollBy(0, under);
      return;
    }
    columns.style.marginBottom = '';
    // The width first, then the top from the height that width gives.
    box.style.width = `${first.width}px`;
    box.style.maxHeight = `${first.maxHeight}px`;
    const at = cardPlace(r, innerWidth, innerHeight, box.offsetHeight, want);
    if (at.sheet) return;
    box.style.left = `${at.left}px`;
    box.style.top = `${at.top}px`;
  }

  /** Moves focus into the open card (the card itself; Tab reaches its buttons). */
  function focusCard(): void {
    if (!details.box.hidden) details.box.focus();
  }

  /** Closes the card; focus goes back to its cell if it was in the card. */
  function closeCard(): void {
    const back = details.box.contains(document.activeElement) ? anchorCell() : undefined;
    select(null);
    back?.focus();
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
    // The item has left the bag, and its card closes with it.
    selected = null;
    act(equip(state, index, at));
    // The slot pulses once when the item lands (restarted for an equip right
    // after the last). The class goes when it ends, or showing the tab again
    // would replay it.
    const box = slotCells[at].parentElement;
    if (box && state.cultivator.equipment[at]?.name === item.name) {
      box.classList.remove('pulse');
      void box.offsetWidth;
      box.classList.add('pulse');
      window.setTimeout(() => box.classList.remove('pulse'), PULSE_MS);
    }
    if (fromDetails) {
      charTabs.show('gear');
      slotCells[at].focus();
    }
  }

  /**
   * Takes off the item worn in `from` into the bag and closes its card; from the
   * card, focus goes to the item's new cell.
   */
  function unequipFromSlot(from: EquipSlotId): void {
    // A full bag does nothing; Details says why.
    if (!state.cultivator.equipment[from] || unequipBlock(state)) return;
    const fromDetails = details.box.contains(document.activeElement);
    const next = unequip(state, from);
    const index = next.inventory.length - 1;
    // Turn to the page its cell sorts onto, so the cell is in view.
    const at = bagOrder(next.inventory, sort, reverse).indexOf(index);
    page = pageOf(at);
    setCursor(at);
    selected = null;
    act(next);
    if (fromDetails) {
      bagTabs.show('bag');
      bagCells[at]?.focus();
    }
  }

  /** Applies a player action that changes the bag or the cultivator, then redraws. */
  function act(next: GameState): void {
    state = next;
    gearVersion += 1;
    // The player changed the bag an open bulk confirmation shows (sold or
    // equipped from it): show its new numbers rather than stale ones.
    if (pending && !bagStillShows(state, pending.seen))
      askBelow(pending.action, pending.grade, false);
    draw(null);
  }

  /**
   * Buys offer `at`. A chest's item is a drop the player paid for: it shows in
   * Recent drops and the toast like one. A stock that has just rotated is not
   * sold from; the next redraw shows the new one.
   */
  function buyFromStore(at: number): void {
    if (storeStale(state)) return;
    const next = buyOffer(state, at);
    const bought = next.inventory.slice(state.inventory.length);
    act(next);
    logDrops(bought);
    noteDrops(bought);
  }

  /**
   * Sells or salvages the bag item at `index` and closes its card; from the
   * card, focus goes to its cell, which now holds the next item.
   */
  function dispose(index: number, action: BulkAction): void {
    const at = order.indexOf(index);
    const fromDetails = details.box.contains(document.activeElement);
    const next = disposeItem(state, index, action);
    selected = null;
    act(next);
    setCursor(at);
    if (fromDetails) bagCells[at]?.focus();
  }

  /** The item at `at` in `s`, if any. */
  function itemIn(s: GameState, at: ItemAt): Item | undefined {
    return 'bag' in at ? s.inventory[at.bag] : s.cultivator.equipment[at.slot];
  }

  /** Opens the Crafting panel on the selected item, in the last mode used. */
  function openCraft(): void {
    const item = selectedItem();
    if (!selected || !item) return;
    crafting = { at: selected, item: JSON.stringify(item) };
    craftPick = 0;
    craftSaid = null;
    craftResult.textContent = '';
    rerollAsk.hidden = true;
    craftTabs.show(`craft-${pickedCraftMode}`);
    fillCraft(item);
    drawCraft();
    craft.showModal();
    craft.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  /** Closes the panel; focus goes back to the Craft button (or the details, if it has gone). */
  function closeCraft(): void {
    if (!crafting) return;
    crafting = null;
    rerollAsk.hidden = true;
    if (craft.open) craft.close();
    const back = detailBody.querySelector<HTMLButtonElement>('[data-action="craft"]');
    if (back) back.focus();
    else details.heading.focus();
  }

  /** Rebuilds the panel's parts that show the item: its head, the refine range and the affixes. */
  function fillCraft(item: Item): void {
    const icon = el('span', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, item);
    const name = el('div');
    name.append(
      el('div', `title grade-${item.grade}`, itemName(item)),
      el('div', `tag grade-${item.grade}`, itemTag(item)),
      el('div', 'quality', qualityLine(item)),
    );
    craftItem.replaceChildren(icon, name);
    refineLines.replaceChildren(...refinePreview(item).map((line) => el('li', '', line)));
    // An item with no affixes (Mortal) has nothing to pick and no action.
    const has = item.affixes.length > 0;
    affixPick.hidden = !has;
    rerollLine.line.hidden = !has;
    noAffixes.hidden = has;
    if (!has) rerollAsk.hidden = true;
    craftPick = Math.max(0, Math.min(craftPick, item.affixes.length - 1));
    const refocus = affixList.contains(document.activeElement);
    const inputs = item.affixes.map((_, i) => {
      const input = el('input');
      input.type = 'radio';
      input.name = 'craft-affix';
      input.checked = i === craftPick;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        craftPick = i;
        rerollAsk.hidden = true;
      });
      return input;
    });
    affixList.replaceChildren(
      ...inputs.map((input, i) => {
        const label = el('label', 'affix');
        label.append(input, document.createTextNode(affixText(item, i)));
        return label;
      }),
    );
    if (refocus) inputs[craftPick]?.focus();
  }

  /**
   * Every tick while open: the Essence balance and what each action costs, so
   * an Essence change alone turns a button on. Closes if the item left (benchItem).
   */
  function drawCraft(): void {
    const item = benchItem();
    if (!item) return;
    setText(craftEssence, t('craft.essence', { n: state.essence }));
    const r = refineAction(item, state.essence);
    setButton(refineBtn, t(refineReach(item) ? 'craft.refine' : 'craft.refineMax'), r.off);
    setText(refineLine.cost, r.cost);
    setText(refineLine.why, r.why);
    const x = rerollAction(item, state.essence);
    setButton(rerollBtn, t('craft.reroll'), x.off);
    setText(rerollLine.cost, x.cost);
    setText(rerollLine.why, x.why);
  }

  /** Applies a craft: the new state, the panel's item and its result line. */
  function crafted(next: GameState, said: (after: Item) => () => string): void {
    if (!crafting) return;
    const after = itemIn(next, crafting.at) as Item;
    crafting.item = JSON.stringify(after);
    act(next);
    fillCraft(after);
    craftSaid = said(after);
    craftResult.textContent = craftSaid();
  }

  /**
   * The item being crafted, checked against the one the panel shows. The sim
   * never changes an item, so a different one at the crafted place means it
   * left: the panel closes (undefined) rather than craft the wrong item.
   */
  function benchItem(): Item | undefined {
    if (!crafting) return undefined;
    const item = itemIn(state, crafting.at);
    if (item && JSON.stringify(item) === crafting.item) return item;
    closeCraft();
    return undefined;
  }

  function doRefine(): void {
    const item = benchItem();
    if (!crafting || !item || refineAction(item, state.essence).off) return;
    crafted(refine(state, crafting.at), (after) => () => refineResult(item, after));
  }

  function askReroll(): void {
    const item = benchItem();
    if (!item || rerollAction(item, state.essence).off) return;
    rerollAskText.textContent = rerollConfirm(item, craftPick);
    rerollAsk.hidden = false;
    rerollYes.focus();
  }

  function doReroll(): void {
    const item = benchItem();
    rerollAsk.hidden = true;
    if (!crafting || !item || rerollAction(item, state.essence).off) return;
    const i = craftPick;
    crafted(rerollAffix(state, crafting.at, i), (after) => () => rerollResult(item, after, i));
    rerollBtn.focus();
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
        drag.ghost = ghost;
        // An open card would hide the slots and catch the drop (the redraw keeps the targets).
        if (selected) select(null);
        for (const p of slotsFor(item.slot))
          slotCells[p].classList.toggle('target', canDrop(item, p));
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
    drawPathSkills();

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
    for (const d of unspentDots) {
      d.dot.hidden = none;
      setText(d.text, none ? '' : ` (${t('tab.statsUnspent', { n: c.unspent })})`);
    }
    rebalance.hidden = !state.freeReset;

    // The form shows the saved filter; the player's own change already matches it.
    const f = state.filter;
    if (minGrade.select.value !== f.minGrade) {
      minGrade.select.value = f.minGrade;
      tintMinGrade();
    }
    if (actionPick.select.value !== f.action) {
      actionPick.select.value = f.action;
      tintAction();
    }
    for (const id of ITEM_TYPES) typeBoxes[id].checked = f.slots.includes(id);
  }

  function drawTools(): void {
    const n = notices.state();
    const notify = n === 'blocked' ? 'menu.blocked' : n === 'on' ? 'menu.on' : 'menu.off';
    setButton(noticeBtn, t(notify), n === 'blocked');
    noticeBtn.setAttribute('aria-pressed', String(n === 'on'));
    if (n === 'blocked') noticeBtn.title = t('menu.blockedHint');
    else noticeBtn.removeAttribute('title');
    setButton(popBtn, t(pip ? 'tools.closePopOut' : 'tools.popOut'), false);
    // While a pop-out is open the button closes it, with no list to open.
    if (pip) {
      popBtn.removeAttribute('aria-haspopup');
      popBtn.removeAttribute('aria-expanded');
    } else if (!popBtn.hasAttribute('aria-haspopup')) {
      popBtn.setAttribute('aria-haspopup', 'menu');
      popBtn.setAttribute('aria-expanded', 'false');
    }
  }

  /** The store tab and the Stats tab's boosts: prices, time left and what can be paid change every tick. */
  function drawStore(): void {
    setText(storeCountdownText, storeCountdown(state));
    const refresh = refreshView(state);
    setButton(refreshBtn, refresh.text, refresh.off);
    setText(refreshWhy, refresh.why);
    // Only the step syncs the stock; until it has, the old cards stay as they are.
    if (!storeStale(state)) {
      let restocked = false;
      storeCards.forEach((c, at) => {
        const card = offerCard(state, at);
        setButton(c.buy, card.buy, card.off);
        if (c.buy.getAttribute('aria-label') !== card.buyName)
          c.buy.setAttribute('aria-label', card.buyName);
        setText(c.name, card.name);
        setText(c.desc, card.desc);
        setText(c.why, card.why);
        c.card.classList.toggle('sold', state.store.sold[at] === true);
        if (c.drawn !== card.id) {
          c.drawn = card.id;
          setStoreIcon(c.icon, storeIcon(card.id));
          c.name.className = card.grade ? `title grade-${card.grade}` : 'title';
          restocked = true;
        }
      });
      if (restocked) {
        // Moving a card drops focus, so a focused Buy gets it back.
        const focused = document.activeElement;
        const drawn = storeCards.map((c) => c.drawn);
        // Chests best first; each card still buys its own stock position.
        chestGroup.list.replaceChildren(
          ...chestOrder(drawn).map((at) => (storeCards[at] as (typeof storeCards)[number]).card),
        );
        boostGroup.list.replaceChildren(
          ...storeCards.filter((c) => c.drawn.startsWith('boost-')).map((c) => c.card),
        );
        if (focused instanceof HTMLElement && focused !== document.activeElement) focused.focus();
        chestGroup.box.hidden = chestGroup.list.children.length === 0;
        boostGroup.box.hidden = boostGroup.list.children.length === 0;
      }
    }
    const lines = boostLines(state);
    const key = lines.join('\n');
    if (boostList.dataset.lines !== key) {
      boostList.dataset.lines = key;
      boostList.replaceChildren(...lines.map((line) => el('li', '', line)));
    }
    noBoosts.hidden = lines.length > 0;
    setText(boosts.count, ` (${lines.length})`);
  }

  /** Title, favicon and the pop-out's status line, refreshed while the tab is in the background too. */
  function drawHud(): void {
    const c = state.cultivator;
    const due = tribulationCall(state) !== null;
    const paused = due && trialSetAside(state);
    // Drawn here, so a save loaded from elsewhere shows its own switch.
    setText(autoTrialBtn, t(state.trial.auto ? 'menu.on' : 'menu.off'));
    if (autoTrialBtn.getAttribute('aria-pressed') !== String(state.trial.auto))
      autoTrialBtn.setAttribute('aria-pressed', String(state.trial.auto));
    const plain = isDiscreet();
    // Discreet: a dull file name and a still sheet icon, never the floor, drops or game name.
    const title = plain ? t('discreet.file') : tabTitle(state.floor, unseen.count, due, paused);
    if (document.title !== title) document.title = title;
    if (plain) setFavicon(document, sheetFaviconHref());
    else {
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
    }
    const sheetShown = pip !== null && popView() === 'discreet';
    const rows = plain || sheetShown ? discreetRows(state, recent[0] ?? null, due) : [];
    if (plain) pageSheet.fill(rows);
    if (pip && sheetShown) {
      discreetPop.fill(rows);
      const file = t('discreet.file');
      if (pip.document.title !== file) pip.document.title = file;
    } else if (pip) {
      miniLine.textContent = miniStatus(
        state.floor,
        realmLabel(c.level),
        unseen.count,
        due,
        paused,
        c.unspent,
      );
      miniLine.classList.toggle('due', due);
      if (pip.document.title !== title) pip.document.title = title;
    }
  }

  /** After a Discreet switch: the sheet, the pop-out, and every grade name and initial, in place. */
  redrawDiscreet = (): void => {
    placeSheet();
    if (pip) pip.document.body.replaceChildren(popContent(popView()));
    relabel();
  };

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
    // Discreet: no notification, as every one names the game.
    if (noted.notify && !isDiscreet()) notices.show(immortalNotice(state.floor));
  }

  /** Puts the strip back above the summary chips, unless this run has ended. */
  function restoreStrip(): void {
    if (!signal.aborted && !game.contains(strip)) beside.before(strip);
  }

  /** The pop-out's content for `view`; the Mini view takes the strip in. */
  function popContent(view: PopStyle): HTMLElement {
    if (view === 'discreet') {
      restoreStrip();
      return discreetPop.box;
    }
    mini.replaceChildren(miniFile, strip, miniLine, miniToast);
    return mini;
  }

  /** Opens the pop-out in `style`, or closes the open one. */
  async function togglePopOut(style: PopStyle): Promise<void> {
    if (opening) return;
    if (pip) {
      pip.close();
      return;
    }
    opening = true;
    const opened = await popOut(
      window,
      () => popContent(isDiscreet() ? 'discreet' : style),
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
    popped = style;
    // The key works in the pop-out too; the listener goes with its window.
    opened.document.addEventListener('keydown', onDiscreetKey);
    drawTools();
    drawHud();
  }
  signal.addEventListener('abort', () => pip?.close());
  // Match system follows the OS while the game is open.
  osDark.addEventListener('change', applyTheme, { signal });

  // A Reset progress in another tab deletes the save: this tab stops its run
  // too, so its autosave can't write the old state back.
  watchStorage((key, value) => {
    if (!storage) return;
    if (key === SAVE_KEY && value === null) start(root, storage);
    // Another tab took the cloud's save: this tab's run is stale and would overwrite it.
    // Only an adoption writes this key, so autosaving tabs can't set each other off.
    else if (key === ADOPT_KEY) start(root, storage, 'local');
    // A tab on a newer release saved: this run is older, and its autosave would write over that.
    // Not on itch.io's shared storage (no frame), where any game can write a "newer" save:
    // there this readable run carries on, as at start.
    else if (
      key === SAVE_KEY &&
      holdsStart({ newer: isNewerSave(value), readable: true, shared: sharedStorage() })
    )
      start(root, storage, 'local');
    // Something else cleared browser storage: put this run's save straight back.
    else if (key === null) save();
    // Dev builds only: the Debug panel in another tab kept a setup; this run would write over it.
    else if (import.meta.env.DEV && key === DEBUG_KEY) start(root, storage, 'local');
  }, signal);

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
    drawStore();
    drawCraft();
    const handled = [];
    if (state.dropsSold > 0) handled.push(t('drops.soldOnPickup', { n: state.dropsSold }));
    if (state.dropsSalvaged > 0) {
      handled.push(t('drops.salvagedOnPickup', { n: state.dropsSalvaged }));
    }
    handledText.textContent = handled.join(' · ');
    setText(footer.character, characterStatusLabel(state));
    drawHud();
  }

  /**
   * A language switch: every fixed text again, then every drawn one. Drawn
   * parts that skip unchanged state are made to draw in full.
   */
  let liveTimer = 0;
  function relabel(): void {
    // Rewritten, not new: the live regions stay quiet while their text changes.
    const live = [drops, pageText, miniToast, craftResult];
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
    // A language switch rewords the open confirmation. One that offered only OK,
    // or whose bag changed, is asked again with the new numbers (focus stays).
    if (pending && (pending.preview.count === 0 || !bagStillShows(state, pending.seen)))
      askBelow(pending.action, pending.grade, false);
    else fillConfirm();
    drawRetire();
    drawTools();
    const onBench = crafting && itemIn(state, crafting.at);
    if (onBench) {
      fillCraft(onBench);
      if (craftSaid) craftResult.textContent = craftSaid();
      if (!rerollAsk.hidden) rerollAskText.textContent = rerollConfirm(onBench, craftPick);
    }
    draw(null);
  }

  state = syncStore(state);
  drawTools();
  draw(null);

  // Time-based: each step plays the real time since the last one, so a
  // throttled background tab still makes the same progress.
  let last = performance.now();
  /** Dev builds only: the Debug panel's speed and forced drop; null until it loads, and in production. */
  let debugTick: DebugTick | null = null;
  /** Dev builds only: the panel changed this run, even if storage refused the mark. */
  let cheated = false;
  function step(): void {
    const now = performance.now();
    const prev = state;
    const dt = (now - last) / 1000;
    // The store rolls its new stock outside tick(), so the fight draws the same numbers.
    state = syncStore(debugTick ? debugTick.step(state, dt) : tick(state, dt));
    last = now;
    const fresh = freshDrops(prev, state);
    logDrops(fresh);
    noteDrops(fresh);
    if (document.hidden && !isDiscreet() && tribulationFellDue(prev, state)) {
      notices.show(tribulationNotice(state.floor));
    }
    draw(prev);
  }

  /** Plays up to now, then saves, so the stamp and the state agree; true when browser storage took it. */
  function save(): boolean {
    if (clearing) return false;
    step();
    const savedAt = Date.now();
    const raw = encodeSave(state, savedAt);
    const written = writeBoth(storage, backup(), raw);
    // Dev builds only: the Debug panel's speed or forced drop may have marked this run since it began.
    if (written && !(import.meta.env.DEV && (cheated || debugged(storage)))) {
      cloud?.offer(raw, savedAt);
    }
    return written;
  }

  scope.every(TICK_MS, step);
  scope.every(FRAME_TICK_MS, drawSprites);
  autosave(scope, save, { doc: document, win: window }, SAVE_MS);

  /** A choice the player is in the middle of: an update waits until it is closed. */
  const choosing = (): boolean =>
    clearing ||
    pending !== null ||
    [retireBox, confirmBox, resetBox, importConfirm, rerollAsk, cloudUi?.choice].some(
      (box) => box && !box.hidden,
    );
  const forUpdate = { choosing, save };
  saveForUpdate = forUpdate;
  signal.addEventListener('abort', () => {
    if (saveForUpdate === forUpdate) saveForUpdate = null;
  });
  say(() => drawUpdate(true));
  // A save code from a later release, pasted before this page moved onto it: ask about it again.
  const stashed = stashedImport;
  stashedImport = null;
  if (stashed !== null) {
    menu.showModal();
    importBox.value = stashed;
    importBtn.click();
  }
  tryUpdate();
  if (import.meta.env.DEV && storage) {
    const debugStore = storage;
    void import('../dev/panel.ts').then(({ mountDebug }) => {
      if (signal.aborted) return;
      debugTick = mountDebug(
        root,
        {
          state: () => state,
          async keep(next, { awaySeconds = 0, clean = false } = {}) {
            // No autosave may write over it before the reload.
            run.stop();
            const raw = encodeSave(next, Date.now() - awaySeconds * 1000);
            // Awaited: a reload before the backup lands would load the older backup.
            await backup().put(raw);
            if (!writeRaw(debugStore, raw)) {
              throw new Error('browser storage refused the save; reload the page');
            }
            // Also tells other open tabs to load it (watchStorage).
            if (clean) clearDebugged(debugStore);
            else markDebugged(debugStore, Date.now());
            location.reload();
          },
          cheat() {
            cheated = true;
            if (!debugged(debugStore)) markDebugged(debugStore, Date.now());
          },
          newSeed,
        },
        debugged(debugStore),
      );
    });
  }
  if (cloud) {
    // After autosave's own listeners, so the upload sends the save they just wrote.
    document.addEventListener('visibilitychange', () => document.hidden && cloud.flush('hidden'), {
      signal,
    });
    window.addEventListener('pagehide', () => cloud.flush('pagehide'), { signal });
    window.addEventListener('online', () => cloud.retry(), { signal });
  }
}
