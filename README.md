# Office Immortal

An idle loot RPG for the browser. You're an office worker secretly cultivating
at your desk: your cultivator fights up the floors of the office tower on
their own while you work, and you check in to equip better treasures and
break through to the next realm, from Intern to Immortal.

## Status

Project setup only. The design is in [`docs/design.md`](docs/design.md); the
first playable build follows the build order there (§13).

## Core loop

- **Solo cultivator.** Pick a Path: Sword Cultivator, Body Refiner or Talisman
  Master.
- **Auto-battle.** Fight waves of office demons, an elite and a boss on each
  floor. Lose, and you drop back a floor to farm.
- **Rolled loot.** Every treasure rolls its base stat, affixes and quality, in
  five grades from Mortal to Immortal.
- **Salvage.** Melt what you don't want into Spirit Essence, by hand or with
  an auto-salvage filter.
- **Realms.** Climb from Qi Condensation (Intern) to Immortal Ascension (CEO)
  and beyond, with a Tribulation boss at each realm.
- **Early Retirement.** Reset for Dao Insight and permanent bonuses.
- **Overtime Cultivation.** Progress continues while the tab is in the
  background or closed, up to a cap.

## Development

Requires Node 20.19+ or 22.12+.

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run lint     # type check, ESLint, Prettier
npm run build    # production build in dist/
```

## License

[MIT](LICENSE)
