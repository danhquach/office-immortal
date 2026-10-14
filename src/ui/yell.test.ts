import { describe, expect, it } from 'vitest';
import { overlaps, placeYell, type YellRoom } from './yell.ts';

/** A bubble whose text is `textW` wide on one line, wrapping (2 lines at most) under it. */
function bubble(textW: number, lineH = 20): YellRoom['measure'] {
  return (maxWidth) => {
    const lines = Math.ceil(textW / maxWidth);
    return lines > 2 ? null : { w: Math.min(textW, maxWidth), h: lines * lineH };
  };
}

/** A 600 x 208 stage: the cultivator on the left, the enemy on the right. */
function room(over: Partial<YellRoom> = {}): YellRoom {
  return {
    width: 600,
    top: 6,
    gap: 6,
    you: { x: 16, y: 74, w: 128, h: 128 },
    avoid: [{ x: 456, y: 74, w: 128, h: 128 }],
    measure: bubble(140),
    ...over,
  };
}

describe('the cultivator yell bubble', () => {
  it('sits above the sprite, its left edge on it, when there is room', () => {
    expect(placeYell(room())).toEqual({ box: { x: 16, y: 6, w: 140, h: 26 }, beside: false });
  });

  it("stops short of the enemy's bubble, wrapping to fit", () => {
    const foeYell = { x: 250, y: 6, w: 200, h: 40 };
    const r = room({ avoid: [{ x: 456, y: 74, w: 128, h: 128 }, foeYell] });
    let width = 0;
    const place = placeYell({
      ...r,
      measure: (max) => {
        width = max;
        return bubble(300)(max);
      },
    });
    expect(place).toMatchObject({ box: { x: 16, y: 6 }, beside: false });
    expect(16 + width).toBeLessThanOrEqual(foeYell.x - r.gap);
  });

  it('goes beside the sprite when the names leave no room above it', () => {
    const place = placeYell(room({ top: 60 }));
    expect(place).toEqual({ box: { x: 16 + 128 + 6, y: 74, w: 140, h: 20 }, beside: true });
  });

  it('gives up when it fits nowhere, so the cast floats as a callout', () => {
    // A phone stage: the sprites nearly touch and the names cover the top.
    const r = room({
      width: 300,
      top: 60,
      you: { x: 2, y: 74, w: 128, h: 128 },
      avoid: [{ x: 170, y: 74, w: 128, h: 128 }],
      measure: bubble(260),
    });
    expect(placeYell(r)).toBeNull();
  });

  it('never covers a sprite or the enemy bubble, across stage sizes and layouts', () => {
    for (const width of [300, 360, 480, 600, 720]) {
      for (const top of [0, 6, 30, 60, 90]) {
        for (const size of [96, 128]) {
          for (const textW of [60, 140, 260]) {
            const above = { x: width - 200, y: top, w: 190, h: 40 };
            // Beside the enemy: on its sprite's left, level with it.
            const beside = {
              x: width - 2 - size - 200,
              y: Math.max(top, 202 - size),
              w: 194,
              h: 50,
            };
            for (const foeYell of [null, above, beside]) {
              const you = { x: 2, y: 202 - size, w: size, h: size };
              const foe = { x: width - 2 - size, y: 202 - size, w: size, h: size };
              const r = room({
                width,
                top,
                you,
                avoid: foeYell ? [foe, foeYell] : [foe],
                measure: bubble(textW),
              });
              const place = placeYell(r);
              if (!place) continue;
              const { box } = place;
              for (const b of [you, ...r.avoid]) expect(overlaps(box, b)).toBe(false);
              expect(box.x + box.w).toBeLessThanOrEqual(width);
            }
          }
        }
      }
    }
  });

  it('counts only boxes that share space as overlapping', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlaps(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(overlaps(a, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
  });
});

describe("the cultivator yell bubble under the enemy's", () => {
  it("drops below the enemy's bubble when it takes the row beside the sprite", () => {
    // Names over a short stage: no room above either sprite, so the enemy's
    // bubble sits beside its own sprite, in the row the cultivator's would take.
    const foeYell = { x: 274, y: 93, w: 246, h: 50 };
    const place = placeYell(
      room({
        width: 664,
        top: 93,
        you: { x: 16, y: 80, w: 128, h: 128 },
        avoid: [{ x: 520, y: 80, w: 128, h: 128 }, foeYell],
        // Too long for 2 lines in the gap left of the enemy's bubble.
        measure: bubble(300, 24),
      }),
    );
    expect(place).toEqual({ box: { x: 150, y: 149, w: 300, h: 24 }, beside: true });
  });

  it('never ends below the sprite beside it', () => {
    const foeYell = { x: 150, y: 80, w: 300, h: 110 };
    const place = placeYell(
      room({
        top: 80,
        you: { x: 16, y: 80, w: 128, h: 128 },
        avoid: [{ x: 456, y: 80, w: 128, h: 128 }, foeYell],
        measure: bubble(200, 24),
      }),
    );
    expect(place).toBeNull();
  });
});

describe('the cultivator yell bubble next to the enemy one', () => {
  it("narrows to the gap left of the enemy's bubble and keeps one line when it fits", () => {
    const foeYell = { x: 300, y: 6, w: 150, h: 26 };
    let given = 0;
    const place = placeYell(
      room({
        avoid: [{ x: 456, y: 74, w: 128, h: 128 }, foeYell],
        measure: (max) => {
          given = max;
          return bubble(140)(max);
        },
      }),
    );
    // 16 to 294: room for the whole name on one line.
    expect(given).toBe(300 - 6 - 16);
    expect(place).toEqual({ box: { x: 16, y: 6, w: 140, h: 26 }, beside: false });
  });
});
