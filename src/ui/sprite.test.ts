import { describe, expect, it } from 'vitest';
import {
  advance,
  DEATH_HOLD_MS,
  duration,
  FRAME_MS,
  frameAt,
  request,
  type Playing,
} from './sprite.ts';

const at = (action: Playing['action'], start = 0): Playing => ({ action, start });

describe('frameAt', () => {
  it('loops idle through its 4 frames forever', () => {
    const cols = [0, 1, 2, 3, 4, 5].map((i) => frameAt(at('idle'), i * FRAME_MS.idle, false).col);
    expect(cols).toEqual([0, 1, 2, 3, 0, 1]);
    expect(frameAt(at('idle'), 1e9, false)).toMatchObject({ row: 0, done: false });
  });

  it('plays attack once on its row, then is done', () => {
    const f = (t: number) => frameAt(at('attack', 100), 100 + t, false);
    expect([0, 1, 2, 3].map((i) => f(i * FRAME_MS.attack).col)).toEqual([0, 1, 2, 3]);
    expect(f(0).row).toBe(1);
    expect(f(4 * FRAME_MS.attack - 1).done).toBe(false);
    expect(f(4 * FRAME_MS.attack).done).toBe(true);
  });

  it('plays hit on 2 frames only', () => {
    expect(frameAt(at('hit'), 0, false)).toMatchObject({ row: 2, col: 0 });
    expect(frameAt(at('hit'), FRAME_MS.hit, false).col).toBe(1);
    expect(frameAt(at('hit'), 2 * FRAME_MS.hit, false).done).toBe(true);
  });

  it('holds death on its last frame (lying flat) before it is done', () => {
    const end = 4 * FRAME_MS.death;
    expect(frameAt(at('death'), end, false)).toMatchObject({ row: 3, col: 3, done: false });
    expect(frameAt(at('death'), end + DEATH_HOLD_MS - 1, false).done).toBe(false);
    expect(frameAt(at('death'), end + DEATH_HOLD_MS, false).done).toBe(true);
  });

  it('shows one still pose with reduced motion, whatever plays', () => {
    for (const action of ['idle', 'attack', 'hit', 'death'] as const) {
      for (const t of [0, 150, 900]) {
        expect(frameAt(at(action), t, true)).toMatchObject({ row: 0, col: 0 });
      }
    }
  });

  it('never shows a frame from before the action started', () => {
    expect(frameAt(at('attack', 500), 0, false)).toMatchObject({ col: 0, done: false });
  });
});

describe('request', () => {
  it('lets a hit cut an attack short but not the other way round', () => {
    const hit = request(at('attack', 0), 'hit', 50);
    expect(hit).toEqual(at('hit', 50));
    expect(request(hit, 'attack', 60)).toBe(hit);
  });

  it('never cuts a death short', () => {
    const dying = at('death', 0);
    expect(request(dying, 'hit', 10)).toBe(dying);
    expect(request(dying, 'attack', 10)).toBe(dying);
  });

  it('restarts the same action, so back-to-back attacks each show', () => {
    expect(request(at('attack', 0), 'attack', 300)).toEqual(at('attack', 300));
  });

  it('takes anything once the current action has finished', () => {
    const done = duration('hit');
    expect(request(at('hit', 0), 'attack', done)).toEqual(at('attack', done));
  });

  it('starts anything over idle', () => {
    expect(request(at('idle', 0), 'attack', 5)).toEqual(at('attack', 5));
  });
});

describe('advance', () => {
  it('keeps playing until the action ends, then goes back to idle from that moment', () => {
    const attack = at('attack', 0);
    expect(advance(attack, 100, false)).toMatchObject({ playing: attack, row: 1, gone: false });
    const end = duration('attack');
    expect(advance(attack, end, false)).toEqual({
      playing: at('idle', end),
      row: 0,
      col: 0,
      gone: false,
    });
  });

  it('lets a corpse go once its death (and hold) is over, and not before', () => {
    const dying = at('death', 0);
    const end = 4 * FRAME_MS.death + DEATH_HOLD_MS;
    expect(advance(dying, end - 1, false, true)).toMatchObject({ row: 3, col: 3, gone: false });
    expect(advance(dying, end, false, true).gone).toBe(true);
  });

  it('never goes for a living fighter, however long it has been', () => {
    expect(advance(at('death', 0), 1e9, false).gone).toBe(false);
  });

  it('holds the still pose with reduced motion while an action runs and after', () => {
    for (const t of [0, 50, 5000]) {
      expect(advance(at('attack', 0), t, true)).toMatchObject({ row: 0, col: 0, gone: false });
    }
  });
});
