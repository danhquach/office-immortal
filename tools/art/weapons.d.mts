// Types for weapons.mjs, so TypeScript tests can import it.
export interface WeaponFamily {
  readonly id: string;
  /** One name per grade, in GRADES order. */
  readonly names: readonly string[];
  draw(grade: string): string;
}
export declare const FAMILIES: readonly WeaponFamily[];
export declare const GRADES: readonly string[];
