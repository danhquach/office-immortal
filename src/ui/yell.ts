// Where the cultivator's yell bubble goes on the stage (docs/design.md §5
// Skills): over its sprite, or beside it, never over a sprite or the enemy's
// bubble. Pure (the bubble is measured through a callback), so it can be
// unit-tested.

/** A box on the stage, in the stage's own pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the bubble goes, and the box it takes there (its tail included);
 * `beside` puts it right of the sprite, tail pointing left at it.
 */
export interface YellPlace {
  box: Box;
  beside: boolean;
}

export interface YellRoom {
  /** The stage's width. */
  width: number;
  /** The first row free of the names and HP drawn over the stage (0 when they sit under it). */
  top: number;
  /** The gap kept from everything, and the room the tail takes. */
  gap: number;
  /** The cultivator's sprite. */
  you: Box;
  /** Everything else the bubble must not cover: the enemy's sprite and bubble. */
  avoid: readonly Box[];
  /**
   * The bubble's size when no wider than `maxWidth`; null when it can't fit
   * there (it would wrap past its line limit).
   */
  measure: (maxWidth: number) => { w: number; h: number } | null;
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The bubble's place: above the sprite, its left edge on it, when it fits
 * there; otherwise beside it on its right, level with the sprite; null when
 * neither fits, so the cast is announced some other way. Each first tries the
 * highest row, then just under each box in the way (the enemy's bubble). Its
 * width stops short of the nearest box on its right.
 */
export function placeYell(room: YellRoom): YellPlace | null {
  const { you, gap } = room;
  const blockers = [you, ...room.avoid];
  const fits = (box: Box, floor: number): boolean =>
    box.x >= 0 &&
    box.x + box.w <= room.width &&
    box.y + box.h <= floor &&
    !blockers.some((b) => overlaps(b, box));
  // `floor` is the row it must end above: the sprite's top, or its bottom beside it.
  const tryAt = (x: number, y: number, floor: number, beside: boolean): YellPlace | null => {
    // The nearest box on the right that shares rows with the bubble's band.
    let right = room.width;
    for (const b of room.avoid) {
      if (b.x >= x && b.y < floor && b.y + b.h > y) right = Math.min(right, b.x - gap);
    }
    const size = right - x > 0 ? room.measure(right - x) : null;
    if (!size) return null;
    // Above: its tail must still end over the sprite's top.
    const box = { x, y, w: size.w, h: beside ? size.h : size.h + gap };
    return fits(box, floor) ? { box, beside } : null;
  };
  const rows = (first: number): number[] => [
    first,
    ...room.avoid
      .map((b) => b.y + b.h + gap)
      .filter((y) => y > first)
      .sort((a, b) => a - b),
  ];
  const besideX = you.x + you.w + gap;
  for (const y of rows(room.top)) {
    const place = tryAt(you.x, y, you.y, false);
    if (place) return place;
  }
  for (const y of rows(Math.max(room.top, you.y))) {
    const place = tryAt(besideX, y, you.y + you.h, true);
    if (place) return place;
  }
  return null;
}
