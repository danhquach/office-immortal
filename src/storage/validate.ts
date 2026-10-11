// Allow-list readers shared by the local save (save.ts) and everything that
// comes back from the cloud (cloud.ts, cloud-meta.ts). Each throws Bad on the
// first problem; callers turn that into "no value". They never copy a key the
// schema doesn't name, so __proto__ and friends are rejected, not carried over.

export class Bad extends Error {}

export function fail(what: string): never {
  throw new Bad(what);
}

export type Obj = Record<string, unknown>;

/** A plain object with exactly `required` keys, plus any of `optional`. */
export function obj(
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('not an object');
  if (Object.getPrototypeOf(v) !== Object.prototype) fail('not a plain object');
  const keys = Object.keys(v);
  for (const k of keys) if (!required.includes(k) && !optional.includes(k)) fail(`key ${k}`);
  for (const k of required) if (!Object.hasOwn(v, k)) fail(`missing ${k}`);
  return v as Obj;
}

export function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail('bad array');
  return v;
}

export function num(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail('bad number');
  return v;
}

export function int(v: unknown, min: number, max: number): number {
  const n = num(v, min, max);
  if (!Number.isInteger(n)) fail('not whole');
  return n;
}

/** One of `allowed`, compared exactly, so look-alike or padded text never matches. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail('not allowed');
  return v as T;
}
