// The storage frame page (store.html, docs/design.md §11 "Cloud save on
// itch.io"): runs on GitHub Pages inside the itch.io game and keeps its save
// and cloud save here, out of reach of other games on itch.io's origin. It has
// no visible content and answers only our own itch.io page (frame-host.ts).

import { browserIdb, idbBackup } from './storage/backup.ts';
import { createCloud } from './storage/cloud.ts';
import { readCloudConfig } from './storage/cloud-config.ts';
import { readItchOrigin } from './storage/frame-config.ts';
import { createHost } from './storage/frame-host.ts';
import { browserStorage } from './storage/save.ts';
import { createSync } from './storage/sync.ts';

const config = readCloudConfig(import.meta.env);
const ancestors = window.location.ancestorOrigins;
const storage = browserStorage();

const host = createHost({
  ancestors: ancestors ? Array.from(ancestors) : null,
  itchOrigin: readItchOrigin(import.meta.env),
  parent: window.parent,
  post: (message, origin) => window.parent.postMessage(message, origin),
  storage,
  backup: idbBackup(browserIdb()),
  makeSync: config
    ? (tracked, hooks) =>
        createSync({
          cloud: createCloud({
            config,
            storage: tracked,
            fetch: (url, init) => fetch(url, init),
            now: Date.now,
            locks: navigator.locks
              ? { request: (name, callback) => navigator.locks.request(name, callback) }
              : null,
          }),
          storage: tracked,
          now: Date.now,
          visible: () => !document.hidden,
          ...hooks,
        })
    : null,
});

if (host) {
  window.addEventListener('message', (e) => host.receive(e));
  window.addEventListener('storage', (e) => {
    if (e.storageArea === storage) host.otherTab(e.key, e.newValue);
  });
}
