// Fakes for the storage frame tests: the itch.io game and its frame wired
// together through a fake postMessage (a structured clone, delivered in order
// on a later task), plus a backup in memory. Test support only; nothing in the
// app imports this file.

import { vi } from 'vitest';
import type { Backup } from './backup.ts';
import { CONFIG, clock, fakeLocks, fakeServer, memory, type FakeStorage } from './cloud-fakes.ts';
import { createCloud } from './cloud.ts';
import { createClient, type Client } from './frame-client.ts';
import { createHost, type Host } from './frame-host.ts';
import { createSync } from './sync.ts';

export const GAME = 'https://html-classic.itch.zone';
export const ITCH = 'https://ourgame.itch.io';
export const FRAME = 'https://ourname.github.io';

export function memoryBackup(): Backup & { text: string | null } {
  const b = {
    text: null as string | null,
    read: async () => b.text,
    put: async (raw: string) => {
      b.text = raw;
      return true;
    },
    clear: async () => {
      b.text = null;
      return true;
    },
  };
  return b;
}

/** Lets queued messages and promise chains run. */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

export interface Posted {
  message: unknown;
  origin: string;
}

/**
 * A game page and its frame. `ancestors` is what the frame sees as
 * `location.ancestorOrigins`; `server` is shared so two pages can link.
 */
export function framePair(
  opts: {
    ancestors?: readonly string[] | null;
    storage?: FakeStorage;
    cloud?: boolean;
    server?: ReturnType<typeof fakeServer>;
    time?: ReturnType<typeof clock>;
  } = {},
) {
  const server = opts.server ?? fakeServer();
  const time = opts.time ?? clock();
  const storage = opts.storage ?? memory();
  const backup = memoryBackup();
  const parentWindow = { name: 'game' };
  const frameWindow = { name: 'frame' };
  /** Everything the frame posted, with the origin it was posted to. */
  const posted: Posted[] = [];
  const adopted = vi.fn();
  const notes: string[] = [];
  let client: Client | null = null;
  const host: Host | null = createHost({
    ancestors: opts.ancestors === undefined ? [GAME, ITCH] : opts.ancestors,
    itchOrigin: ITCH,
    parent: parentWindow,
    post: (message, origin) => {
      posted.push({ message, origin });
      const data = structuredClone(message);
      setTimeout(() => client?.receive({ data, origin: FRAME, source: frameWindow }));
    },
    storage,
    backup,
    makeSync:
      opts.cloud === false
        ? null
        : (tracked, hooks) =>
            createSync({
              cloud: createCloud({
                config: CONFIG,
                storage: tracked,
                fetch: server.fetch,
                now: time.now,
                locks: fakeLocks(),
              }),
              storage: tracked,
              now: time.now,
              visible: () => true,
              ...hooks,
            }),
  });
  client = createClient({
    post: (message) => {
      const data = structuredClone(message);
      setTimeout(() => host?.receive({ data, origin: GAME, source: parentWindow }));
    },
    origin: FRAME,
    source: () => frameWindow,
    onAdopt: adopted,
    onNote: (code) => notes.push(code),
  });
  return {
    server,
    time,
    storage,
    backup,
    host,
    client,
    posted,
    adopted,
    notes,
    parentWindow,
    frameWindow,
    /** Posts `data` to the frame as `source` from `origin` (an attacker, by default). */
    inject(data: unknown, origin = GAME, source: unknown = { name: 'other game' }) {
      host?.receive({ data, origin, source });
    },
  };
}
