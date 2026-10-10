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
([#6]), realms and Tribulation ([#7]), Early Retirement ([#8]), the tab HUD,
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
- **Realms** ([#7]). Climb from Qi Condensation (Intern) to Immortal Ascension
  (CEO) and beyond, with a Tribulation boss at each realm.
- **Early Retirement** ([#8]). Reset for Dao Insight and permanent bonuses.
- **Overtime Cultivation** ([#5]). Progress continues while the tab is in the
  background or closed, up to a cap.
- **Tab HUD** ([#9]). Status in the tab title and favicon, a pop-out mini
  window where the browser supports it, and an optional drop notification.

## Project layout

- `src/core/`: the pure simulation. One `tick(state, dt)` step, no DOM, no
  storage; all randomness goes through the seeded RNG in `src/core/rng.ts`.
- `src/storage/`: the save, validated against an allow-list on load.
- `src/ui/`: the DOM view. Text reaches the page only as text nodes.
- `src/main.ts`: the entry point that mounts the UI.

Layering rule: the UI imports core, never the reverse (enforced by ESLint).

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
