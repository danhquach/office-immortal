// Where the cloud save lives, from build-time env (docs/design.md §11). Both
// values are public by design (they ship in the page), but they come from the
// environment, not the repo. Anything that isn't exactly a Supabase project
// origin and a client key means no cloud save: the feature stays hidden and the
// page's Content-Security-Policy gains nothing.

export interface CloudConfig {
  /** The project origin, https://<ref>.supabase.co, with no path. */
  readonly url: string;
  /** The public client key (the legacy anon JWT or a publishable key). */
  readonly key: string;
}

const ORIGIN = /^https:\/\/[a-z0-9]{8,40}\.supabase\.co$/;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{16,200}$/;
const JWT_KEY = /^[A-Za-z0-9_-]{8,500}\.[A-Za-z0-9_-]{8,2000}\.[A-Za-z0-9_-]{8,500}$/;

/** The config in `env` (Vite's import.meta.env shape), or null when missing or malformed. */
export function readCloudConfig(env: Readonly<Record<string, unknown>>): CloudConfig | null {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || typeof key !== 'string') return null;
  const origin = url.trim().replace(/\/$/, '');
  if (!ORIGIN.test(origin)) return null;
  const k = key.trim();
  if (!PUBLISHABLE_KEY.test(k) && !JWT_KEY.test(k)) return null;
  return { url: origin, key: k };
}
