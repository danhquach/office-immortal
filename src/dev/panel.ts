// Dev builds only: the Debug panel (issue #118). app.ts loads this module
// behind import.meta.env.DEV, so the production build leaves it out entirely.
// Every setup runs the save checker on its result before the run keeps it;
// the run then saves it and reloads, so what you see is what a reload loads.

import { PATHS, type PathId } from '../core/cultivator.ts';
import { GRADES, namesFor, SLOTS, SOUL_CAPS, type GradeId, type SlotId } from '../core/loot.ts';
import type { GameState } from '../core/sim.ts';
import { MAX_FLOOR, saveProblem } from '../storage/save.ts';
import './debug.css';
import {
  addEveryType,
  addItem,
  addResource,
  BAG_SIZES,
  debugStep,
  emptyBag,
  fillBag,
  freshRun,
  MAX_DEBUG_LEVEL,
  SCENARIO_IDS,
  scenarioFor,
  setBagSize,
  setFloors,
  setHp,
  setLevel,
  setSouls,
  skipToTribulation,
  unequipAll,
  type Resource,
  type ScenarioId,
} from './scenarios.ts';

/** What the running game gives the panel. */
export interface DebugHost {
  state(): GameState;
  /**
   * Saves `next` as if it was saved `awaySeconds` ago and reloads the page.
   * `clean` marks a fresh run, which the cloud save may take again.
   */
  keep(next: GameState, opts?: { awaySeconds?: number; clean?: boolean }): Promise<void>;
  newSeed(): number;
  /** Marks the run as changed here, so the cloud save stays off (speed, forced drop). */
  cheat(): void;
}

/** Hooks the run's step calls each tick. */
export interface DebugTick {
  /** Plays `dt` seconds at the chosen speed, with a forced drop if one is waiting. */
  step(state: GameState, dt: number): GameState;
}

const SPEED_KEY = 'office-immortal.debug.speed';
const SPEEDS = [1, 10, 100] as const;

function readSpeed(): number {
  try {
    const n = Number(sessionStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(n) ? n : 1;
  } catch {
    return 1;
  }
}

let speed = readSpeed();
let forceDrop = false;

declare global {
  interface Window {
    /** Dev builds only: loads a named setup for browser checks, then reloads. */
    officeDebug?: { scenarios: readonly ScenarioId[]; scenario(id: unknown): Promise<string> };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function select<T extends string>(options: readonly [T, string][]): HTMLSelectElement {
  const s = el('select');
  for (const [value, label] of options) {
    const o = el('option', label);
    o.value = value;
    s.append(o);
  }
  return s;
}

function numberInput(value: number, min: number, max: number, label: string): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.value = String(value);
  i.setAttribute('aria-label', label);
  return i;
}

/** Mounts the panel on `root` and returns the tick hook; `cloudOff` says the cloud save is off for this save. */
export function mountDebug(root: HTMLElement, host: DebugHost, cloudOff: boolean): DebugTick {
  const box = el('details');
  box.className = 'debug';
  const summary = el('summary');
  const drawSummary = (): void => {
    summary.textContent = speed > 1 ? `Debug ×${speed}` : 'Debug';
  };
  drawSummary();
  const status = el('p');
  status.className = 'debug-status';
  status.setAttribute('role', 'status');
  status.textContent = cloudOff ? 'Cloud save off: this save was changed here.' : '';

  /** Runs a setup; on success the page reloads into its result. */
  async function run(
    label: string,
    fn: (s: GameState) => GameState,
    away = 0,
    clean = false,
  ): Promise<string> {
    let next: GameState;
    try {
      next = fn(host.state());
    } catch (e) {
      return say(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const problem = saveProblem(next);
    if (problem) return say(`${label}: the save checker refuses it (${problem})`);
    try {
      await host.keep(next, { awaySeconds: away, clean });
    } catch (e) {
      return say(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 'ok';
  }
  function say(text: string): string {
    status.textContent = text;
    return text;
  }
  function action(label: string, fn: (s: GameState) => GameState, away = 0): HTMLButtonElement {
    const b = el('button', label);
    b.type = 'button';
    b.addEventListener('click', () => void run(label, fn, away));
    return b;
  }
  function section(title: string, ...rows: HTMLElement[][]): HTMLElement {
    const s = el('section');
    s.append(el('h3', title));
    for (const row of rows) {
      const line = el('div');
      line.className = 'debug-row';
      line.append(...row);
      s.append(line);
    }
    return s;
  }
  const int = (i: HTMLInputElement): number => Number(i.value);

  // Items
  const slotIds = Object.keys(SLOTS) as SlotId[];
  const gradeIds = Object.keys(GRADES) as GradeId[];
  const slot = select(slotIds.map((id) => [id, SLOTS[id].name]));
  slot.setAttribute('aria-label', 'Type');
  const grade = select(gradeIds.map((id) => [id, GRADES[id].name]));
  grade.setAttribute('aria-label', 'Grade');
  const name = el('select');
  name.setAttribute('aria-label', 'Name');
  const fillNames = (): void => {
    const names = namesFor(slot.value as SlotId, grade.value as GradeId);
    name.replaceChildren(...names.map((n) => Object.assign(el('option', n), { value: n })));
  };
  slot.addEventListener('change', fillNames);
  grade.addEventListener('change', fillNames);
  fillNames();
  const level = host.state().highestFloor;
  const itemLevel = numberInput(level, 1, level, 'Item level');
  const items = section(
    'Items',
    [slot, grade, name, itemLevel],
    [
      action('Add item', (s) =>
        addItem(s, slot.value as SlotId, grade.value as GradeId, name.value, int(itemLevel)),
      ),
      action('Add every type', (s) => addEveryType(s, grade.value as GradeId, int(itemLevel))),
    ],
  );

  // Bag
  const bagSize = select(BAG_SIZES.map((n) => [String(n), `${n} cells`] as [string, string]));
  bagSize.setAttribute('aria-label', 'Bag size');
  bagSize.value = String(host.state().bagSize);
  const bag = section(
    'Bag',
    [
      action('Fill to full − 1', (s) => fillBag(s, 1)),
      action('Fill', (s) => fillBag(s, 0)),
      action('Empty', emptyBag),
    ],
    [bagSize, action('Set size', (s) => setBagSize(s, Number(bagSize.value)))],
  );

  // Cultivator
  const now = host.state();
  const lvl = numberInput(now.cultivator.level, 1, MAX_DEBUG_LEVEL, 'Level');
  const floor = numberInput(now.floor, 1, MAX_FLOOR, 'Floor');
  const highest = numberInput(now.highestFloor, 1, MAX_FLOOR, 'Highest floor');
  const cultivator = section(
    'Cultivator',
    [el('span', 'Level'), lvl, action('Set level', (s) => setLevel(s, int(lvl)))],
    [
      el('span', 'Floor'),
      floor,
      el('span', 'Highest'),
      highest,
      action('Set floors', (s) => setFloors(s, int(floor), int(highest))),
    ],
    [action('Fill HP', (s) => setHp(s, 'full')), action('HP to 1', (s) => setHp(s, 'low'))],
  );

  // Resources
  const amount = numberInput(10_000, 0, Number.MAX_SAFE_INTEGER, 'Amount');
  const resource = select<Resource>([
    ['stones', 'Spirit Stones'],
    ['essence', 'Spirit Essence'],
    ['insight', 'Dao Insight'],
  ]);
  resource.setAttribute('aria-label', 'Resource');
  const resources = section('Resources', [
    amount,
    resource,
    action('Add', (s) => addResource(s, resource.value as Resource, int(amount))),
  ]);

  // Gear state
  const souls = numberInput(now.souls, 0, Math.max(...Object.values(SOUL_CAPS)), 'Souls');
  const gear = section(
    'Gear',
    [el('span', 'Souls'), souls, action('Set souls', (s) => setSouls(s, int(souls)))],
    [action('Unequip all', unequipAll)],
  );

  // Time
  const speedPick = select(SPEEDS.map((n) => [String(n), `×${n}`] as [string, string]));
  speedPick.setAttribute('aria-label', 'Speed');
  speedPick.value = String(speed);
  speedPick.addEventListener('change', () => {
    speed = Number(speedPick.value);
    drawSummary();
    try {
      sessionStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      // Blocked storage: the speed holds until the next reload.
    }
  });
  const dropBtn = el('button', 'Next kill drops');
  dropBtn.type = 'button';
  const drawDrop = (): void => dropBtn.setAttribute('aria-pressed', String(forceDrop));
  dropBtn.addEventListener('click', () => {
    forceDrop = !forceDrop;
    drawDrop();
  });
  drawDrop();
  const time = section(
    'Time',
    [el('span', 'Speed'), speedPick, dropBtn],
    [
      action('Tribulation due', skipToTribulation),
      action('Away 1 h', (s) => s, 3600),
      action('Away 8 h', (s) => s, 8 * 3600),
    ],
  );

  // Scenarios and reset
  const scenarioPick = select(SCENARIO_IDS.map((id) => [id, id] as [ScenarioId, string]));
  scenarioPick.setAttribute('aria-label', 'Scenario');
  const pathIds = Object.keys(PATHS) as PathId[];
  const path = select(pathIds.map((id) => [id, PATHS[id].name]));
  path.setAttribute('aria-label', 'Path');
  path.value = now.cultivator.path;
  const resetBtn = el('button', 'Fresh run');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    void run('Fresh run', () => freshRun(host.newSeed(), path.value as PathId), 0, true);
  });
  /** A named setup; a name off the allow-list is refused, never looked up. */
  const scenarioRun = (id: unknown): Promise<string> => {
    let fn: (s: GameState) => GameState;
    try {
      fn = scenarioFor(id);
    } catch (e) {
      return Promise.resolve(say(e instanceof Error ? e.message : String(e)));
    }
    return run(String(id), fn);
  };
  const setups = section(
    'Setups',
    [scenarioPick, action('Load', (s) => scenarioFor(scenarioPick.value)(s))],
    [path, resetBtn],
  );

  box.append(summary, status, items, bag, cultivator, resources, gear, time, setups);
  root.append(box);
  window.officeDebug = { scenarios: SCENARIO_IDS, scenario: scenarioRun };

  return {
    step(state, dt) {
      const out = debugStep(state, dt, speed, forceDrop);
      if (out.cheated) host.cheat();
      if (out.dropped) {
        forceDrop = false;
        drawDrop();
      }
      return out.state;
    },
  };
}
