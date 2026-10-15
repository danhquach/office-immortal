# Office Immortal

[![CI](https://github.com/danhquach/office-immortal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/danhquach/office-immortal/actions/workflows/ci.yml?query=branch%3Amain)

An idle loot RPG for the browser. You're an office worker secretly cultivating
at your desk: your cultivator fights up the floors of the office tower on
their own while you work, and you check in to equip better treasures and
break through to the next realm, from Intern to Immortal.

Play it:

- **[On itch.io](https://bluezinger.itch.io/office-immortal)**: the released
  version, uploaded for each version tag.
- **[On GitHub Pages](https://danhquach.github.io/office-immortal/)**: the
  latest build from `main`, redeployed on every push to `main`.

## Status

**Version 1.0.0** ([#188]) is the first public release. The v1 build order in
[`docs/design.md`](docs/design.md) (§13) is complete: the simulation core
([#2]), loot ([#3]), the combat strip, character panel and inventory ([#4]),
save and offline catch-up ([#5]), sell and salvage ([#6]), realms and
Tribulation ([#7]), Reincarnation ([#8]), the tab HUD, pop-out and
notifications ([#9]), and the game art ([#15]). Skills, the Store, cloud save,
Discreet mode and a Vietnamese translation shipped on top of it.

No further features are planned yet. New work is tracked in
[GitHub issues](https://github.com/danhquach/office-immortal/issues).

## Core loop

All shipped in 1.0.0:

- **Solo cultivator** ([#2]). Pick a Path: Sword Cultivator, Body Refiner or
  Talisman Master.
- **Auto-battle** ([#2], [#4]). Fight waves of office demons, an elite and a
  boss on each floor. Lose, and you drop back a floor to farm.
- **Skills** ([#143]–[#148]). Each Path has four skills, learned and
  upgraded at realm breakthroughs and auto-cast with Qi. Elites, bosses and
  Tribulations have skills of their own.
- **Rolled loot** ([#3]). Every treasure rolls its base stat, affixes and
  quality, in five grades from Mortal to Immortal.
- **Sell and salvage** ([#6]). Sell what you don't want for Spirit Stones or
  melt it into Spirit Essence, by hand or with an auto filter.
- **Crafting** ([#95]). Spend Spirit Essence to refine an item's base roll
  (its refine level shows as "+N") or reroll one of its affixes.
- **Store** ([#123]). Spend Spirit Stones on gear chests and timed boosts from
  a stock that rotates every 30 minutes.
- **Realms** ([#7]). Climb ten realms from Qi Condensation (Intern) through
  Tribulation Transcendence (Chairman) to Immortal Ascension, with a
  Tribulation boss at each cap. Hover the Realm chip to see them all.
- **Reincarnation** ([#8]). Reset for Dao Insight and permanent bonuses.
- **Overtime Cultivation** ([#5]). Progress continues while the tab is in the
  background or closed, up to a cap.
- **Tab HUD** ([#9]). Status in the tab title and favicon, a pop-out mini
  window where the browser supports it, and an optional notification for
  Immortal drops and due Tribulations.
- **Discreet mode** ([#124]). One click makes the page, tab and pop-out look
  like a plain spreadsheet.
- **English and Vietnamese** ([#67]). Pick the language in the title bar.
- **Save backup** ([#84], [#63]). A save code to export and import, and an
  optional cloud save shared between browsers (see below).

## Project layout

- `src/core/`: the pure simulation. One `tick(state, dt)` step, no DOM, no
  storage; all randomness goes through the seeded RNG in `src/core/rng.ts`.
- `src/storage/`: the save, validated against an allow-list on load, and the
  optional cloud save (REST client and sync logic).
- `supabase/`: the cloud save's SQL migrations and tests, with setup steps.
- `src/ui/`: the DOM view. Text reaches the page only as text nodes.
- `src/main.ts`: the entry point that mounts the UI.

Layering rule: the UI imports core, never the reverse (enforced by ESLint).

## Cloud save

Optional. Menu, Settings, Cloud save keeps your cultivator on a server so you
can load it in another browser or device. There is no account: this browser
gets an anonymous save, and a one-time link code joins another browser to it.
Without it, play is exactly as before, local only.

- Uploads at most once a minute while playing, when the tab is hidden or left,
  and on **Sync now**. Offline play uploads when the connection returns.
- If this device and the cloud both changed, you choose which to keep.
- **Warning:** an anonymous cloud save is lost if the site data is cleared on
  every linked device. Link a second device to keep a copy.
- Reset progress also deletes the cloud save.
- If you played on past this device's last upload and another device moved the
  cloud save meanwhile, you get the choice too; hidden-tab and page-leave
  uploads keep that rare.

Builds have it only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are
set (a local `.env`, or GitHub Actions variables for the deployed site); see
[`.env.example`](.env.example) and [`supabase/README.md`](supabase/README.md)
for the one-time backend setup.

## Development

Requires Node 20.19+ or 22.12+.

```bash
npm ci
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run lint     # type check, ESLint, Prettier
npm run format   # rewrite files with Prettier
npm run build    # production build in dist/
npm run preview  # serve the production build from dist/
npm run check:version  # this branch's version is above main's (as CI wants)
```

`npm ci` also points git at the hooks in `.githooks/`. Its pre-push hook stops
a push to any branch but `main` when the pushed commit's version is not above
`main`'s, the same check CI runs on every PR (see below), so a missed bump is
caught before the push. It compares with `origin`'s `main` and blocks the
push if it can't fetch it. Raise the version, commit and push again;
`git push --no-verify` skips the check. Setting git's `core.hooksPath` for the
repo means hooks in `.git/hooks` no longer run; if `core.hooksPath` already
points elsewhere, `npm ci` leaves it alone and says so.
The hook runs the checked-out branch's own `.githooks/` and `tools/` code, so
review those before pushing a branch you didn't write.

Unit tests sit next to the code they cover, as `src/**/*.test.ts`.

`npm run dev` adds a **Debug** panel (bottom left) that sets up test states in
one click: items of any type and grade, a full or two-page bag, a level, floor
or due Tribulation, resources, Soul Banner souls, game speed, a forced drop,
time away and a fresh run. Every setup must pass the save checker, then the
game saves it and reloads (other open tabs load it too). Browser checks can
load a named setup (names in `src/dev/scenarios.ts`):

```js
await page.waitForFunction(() => window.officeDebug);
await Promise.all([
  page.waitForEvent('load'),
  page.evaluate(() => window.officeDebug.scenario('fullBag')),
]);
```

Once a setup, a speed above ×1 or a forced drop changes the run, the cloud
save stays off until the panel starts a fresh run. The panel lives in
`src/dev/` and is left out of `npm run build`; `npm run check:no-debug` (run
by CI) fails a build that contains it.

## Release on itch.io

The game is also published on itch.io as an HTML5 project. Pushing a version
tag on a commit already on `main` builds it with the storage frame instead of
the cloud settings, zips it (`npm run zip`, which checks itch.io's upload
limits and refuses a build with the cloud save in it; it needs `zip` on the
PATH) and, once the required check
is green and you approve the run, uploads it with butler, itch.io's upload
tool. Pushes to `main` still deploy only to GitHub
Pages.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The tag must name the version on that commit (`package.json`, shown in the
status bar); CI refuses any other. Every PR to `main` raises that version
(`npm version patch --no-git-tag-version`), and CI fails a PR that doesn't
(Dependabot's PRs excepted); the pre-push hook checks the same before a push.

One-time setup:

- **itch.io project:** Kind of project **HTML**; upload channel `html5` (butler
  creates it on the first push), marked **This file will be played in the
  browser**; embed in page at 960 × 640 with **Fullscreen button** and
  **Enable scrollbars** on; **Mobile friendly** on. The store page describes
  the game by genre only.
- **GitHub:** the `itch` environment holds the secret `BUTLER_API_KEY` (an
  itch.io API key) and the variable `ITCH_GAME` (`user/game`). Repository
  variables: `VITE_STORE_FRAME_URL`, the frame page on GitHub Pages
  (`https://<user>.github.io/<repo>/store.html`, used by the itch.io build),
  and `VITE_ITCH_PAGE_ORIGIN`, the itch.io page (`https://<user>.itch.io`, used
  by the GitHub Pages build so its frame answers that page). The release
  refuses to zip without the first. The job runs only for
  `v*` tags and waits for a reviewer's approval; a tag ruleset lets only admins
  create, move or delete `v*` tags.

How the itch.io build differs from GitHub Pages:

- **Cloud save through a storage frame.** itch.io serves every uploaded game
  from one shared origin, so another game there could read a cloud sign-in
  token kept in its storage. The itch.io build keeps its save and cloud save
  in a hidden frame on GitHub Pages instead, which answers only our own itch.io
  page (`docs/design.md` §11, "Cloud save on itch.io"). Where the browser
  can't use it (Firefox, which lacks `location.ancestorOrigins`, or blocked
  frame storage), the game runs on its own itch.io storage without the cloud
  save. A cloud link code is made and shown, or typed, only inside frames on
  GitHub Pages, never on the itch.io game page. To move progress between itch.io and
  GitHub Pages, use a link code (cloud save) or the save code.
- **Its own local save.** Saves are kept per site, so progress on itch.io and
  on GitHub Pages are separate. Every save also goes to a fallback copy on
  itch.io's shared origin, used only when the frame doesn't answer or holds no
  save; there another game can clear or overwrite `localStorage`, so it also
  goes to IndexedDB and the game loads the newest valid copy.
- **Save code backup.** Menu, Settings, Save code: **Export** copies the save
  as a text code to keep outside the browser. To restore (new browser, cleared
  site data), paste the code into the field, press **Import** and confirm.
- **No pop-out.** The browser refuses Document Picture-in-Picture inside a
  frame, so the button is hidden. Browsers may also refuse notifications
  inside the frame.

## Store page

The itch.io page's text, tags, AI disclosure and settings are in
[`docs/itch-page.md`](docs/itch-page.md); its images live in `marketing/`. The
screenshots, video and GIF are taken from the production build with test
saves committed in `marketing/saves/`, so retake them after any UI change
(Playwright's Chromium and, for the video, `ffmpeg` on the PATH):

```bash
npx playwright install chromium   # once
npm run build
npm run marketing:screenshots     # marketing/screenshots/01-…06-*.png, same on every run
npm run marketing:trailer         # marketing/trailer-1080p.mp4 and marketing/autobattle.gif
npm run marketing:saves           # rewrite the test saves (after a sim or save-format change)
```

The cover is `marketing/cover-630x500.png`, built from a generated painting by
`python3 tools/marketing/cover.py <painting>` (needs Pillow 10.1+:
`pip install pillow`).

The video is about 30 seconds at 1080p and is git-ignored (too big for the
repo). itch.io embeds only YouTube or Vimeo, so after making it:

1. Upload `marketing/trailer-1080p.mp4` to YouTube (or Vimeo) as Public or
   Unlisted, titled "Office Immortal: gameplay".
2. On itch.io, Edit game, paste the video's link into **Gameplay video or
   trailer**, and save.

## License

[MIT](LICENSE)

[#2]: https://github.com/danhquach/office-immortal/issues/2
[#3]: https://github.com/danhquach/office-immortal/issues/3
[#4]: https://github.com/danhquach/office-immortal/issues/4
[#5]: https://github.com/danhquach/office-immortal/issues/5
[#6]: https://github.com/danhquach/office-immortal/issues/6
[#7]: https://github.com/danhquach/office-immortal/issues/7
[#8]: https://github.com/danhquach/office-immortal/issues/8
[#9]: https://github.com/danhquach/office-immortal/issues/9
[#15]: https://github.com/danhquach/office-immortal/issues/15
[#63]: https://github.com/danhquach/office-immortal/issues/63
[#67]: https://github.com/danhquach/office-immortal/issues/67
[#84]: https://github.com/danhquach/office-immortal/issues/84
[#95]: https://github.com/danhquach/office-immortal/issues/95
[#123]: https://github.com/danhquach/office-immortal/issues/123
[#124]: https://github.com/danhquach/office-immortal/issues/124
[#143]: https://github.com/danhquach/office-immortal/issues/143
[#148]: https://github.com/danhquach/office-immortal/issues/148
[#188]: https://github.com/danhquach/office-immortal/issues/188
