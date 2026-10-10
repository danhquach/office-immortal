import { describe, expect, it } from 'vitest';
import { buildCsp } from '../vite.config.ts';

// What main shipped before the cloud save existed.
const BASE =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

describe('Content-Security-Policy', () => {
  it('is unchanged without a cloud origin', () => {
    expect(buildCsp()).toBe(BASE);
    expect(buildCsp(null)).toBe(BASE);
  });

  it('adds only the cloud origin to connect-src', () => {
    const csp = buildCsp('https://abcdefghij.supabase.co');
    expect(csp).toBe(
      BASE.replace("connect-src 'self'", "connect-src 'self' https://abcdefghij.supabase.co"),
    );
  });
});
