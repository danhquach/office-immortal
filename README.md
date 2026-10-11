# Office Immortal

[![CI](https://github.com/danhquach/office-immortal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/danhquach/office-immortal/actions/workflows/ci.yml?query=branch%3Amain)

An idle loot RPG for the browser. You're an office worker secretly cultivating
at your desk: your cultivator fights up the floors of the office tower on
their own while you work, and you check in to equip better treasures and
break through to the next realm, from Intern to Immortal.

**[Play it](https://danhquach.github.io/office-immortal/)**: the latest build
from `main`, redeployed to GitHub Pages on every push to `main`.

## Status

The v1 build order in [`docs/design.md`](docs/design.md) (§13) is complete and
playable: the simulation core ([#2]), loot ([#3]), the combat strip, character
panel and inventory ([#4]), save and offline catch-up ([#5]), sell and salvage
([#6]), realms and Tribulation ([#7]), Reincarnation ([#8]), the tab HUD,
pop-out and notifications ([#9]), and the game art ([#15]).

No further features are planned yet. New work is tracked in
[GitHub issues](https://github.com/danhquach/office-immortal/issues).

## Core loop

All shipped on `main`:

- **Solo cultivator** ([#2]). Pick a Path: Sword Cultivator, Body Refiner or
  Talisman Master.
- **Auto-battle** ([#2], [#4]). Fight waves of office demons, an elite and a
  boss on each floor. Lose, and you drop back a floor to farm.
- **Rolled loot** ([#3]). Every treasure rolls its base stat, affixes and
  quality, in five grades from Mortal to Immortal.
- **Sell and salvage** ([#6]). Sell what you don't want for Spirit Stones or
  melt it into Spirit Essence, by hand or with an auto filter.
- **Realms** ([#7]). Climb ten realms from Qi Condensation (Intern) through
  Tribulation Transcendence (Chairman) to Immortal Ascension, with a
  Tribulation boss at each cap. Hover the Realm chip to see them all.
- **Reincarnation** ([#8]). Reset for Dao Insight and permanent bonuses.
- **Overtime Cultivation** ([#5]). Progress continues while the tab is in the
  background or closed, up to a cap.
- **Tab HUD** ([#9]). Status in the tab title and favicon, a pop-out mini
  window where the browser supports it, and an optional notification for
  Immortal drops and due Tribulations.

## Project layout

- `src/core/`: the pure simulation. One `tick(state, dt)` step, no DOM, no
  storage; all randomness goes through the seeded RNG in `src/core/rng.ts`.
- `src/storage/`: the save, validated against an allow-list on load, and the
  optional cloud save (REST client and sync logic).
- `supabase/`: the cloud save's SQL migration and tests, with setup steps.
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
```

Unit tests sit next to the code they cover, as `src/**/*.test.ts`.

## Release on itch.io

The game is also published on itch.io as an HTML5 project. Pushing a version
tag on a commit already on `main` builds it without the cloud save, zips it
(`npm run zip`, which checks itch.io's upload limits and refuses a build with
the cloud save in it; it needs `zip` on the PATH) and, once the required check
is green and you approve the run, uploads it with butler, itch.io's upload
tool. Pushes to `main` still deploy only to GitHub
Pages.

```bash
git tag v0.2.0 && git push origin v0.2.0
```

One-time setup:

- **itch.io project:** Kind of project **HTML**; upload channel `html5` (butler
  creates it on the first push), marked **This file will be played in the
  browser**; embed in page at 960 × 640 with **Fullscreen button** and
  **Enable scrollbars** on; **Mobile friendly** on. The store page describes
  the game by genre only.
- **GitHub:** the `itch` environment holds the secret `BUTLER_API_KEY` (an
  itch.io API key) and the variable `ITCH_GAME` (`user/game`). It runs only for
  `v*` tags and waits for a reviewer's approval; a tag ruleset lets only admins
  create, move or delete `v*` tags.

How the itch.io build differs from GitHub Pages:

- **No cloud save.** itch.io serves every uploaded game from one shared origin,
  so another game there could read the cloud sign-in token. The itch.io build
  leaves the cloud settings out and the menu doesn't offer it.
- **Its own local save.** Saves are kept per site, so progress on itch.io and
  on GitHub Pages are separate. On that shared origin another game can also
  clear or overwrite the local save; there is no way to stop that from inside
  the page.
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
