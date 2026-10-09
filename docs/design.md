# Office Immortal — Design

Status: draft. Every number below is a starting point for balancing, not a
final value.

## 1. Vision

An idle loot RPG that lives in a browser tab. You are an office worker
secretly cultivating at your desk. Your cultivator fights on their own through
the floors of the office tower while you work; you check in, equip better
treasures, and push higher.

### Pillars

1. **Plays itself.** Combat, levelling and loot pickup are automatic. Every
   choice is made between fights, never during them.
2. **Loot worth chasing.** Every drop is rolled: base stats, affixes and
   quality. Two items with the same name can be far apart.
3. **Small and quiet.** Runs in a background tab or a small always-on-top
   window and never needs attention to make progress.
4. **Office humour, real cultivation.** The realms and the power fantasy are
   played straight; the office setting is the joke.

## 2. Core loop

```
fight floor ─► drops + XP ─► equip / salvage ─► stronger ─► next floor
     ▲                                                          │
     └──── Early Retirement (prestige) ◄── wall: can't clear ◄──┘
```

## 3. The cultivator

- **Solo.** One character. No party in v1.
- **Paths (classes):** pick one at the start; change it later for a cost.

| Path | Office cover | Role | Primary stat |
|---|---|---|---|
| Sword Cultivator | Sales | Fast hits, crit | Agility |
| Body Refiner | Facilities | Tanky, lifesteal | Body |
| Talisman Master | IT | Burst, area damage | Spirit |

- **Stats:** Body (HP, defence), Agility (attack speed, crit), Spirit (skill
  damage, qi regen). Each level grants stat points, assigned automatically to
  the Path's primary stat by default; the player can reset and re-spend them.

## 4. Realms and levels

Level-ups give stat points. Every 10 levels is a realm stage; each realm ends
in a Tribulation boss that must be beaten to advance.

| Realm | Job title | Levels |
|---|---|---|
| Qi Condensation | Intern | 1–10 |
| Foundation Establishment | Associate | 11–20 |
| Golden Core | Manager | 21–30 |
| Nascent Soul | Director | 31–40 |
| Spirit Severing | VP | 41–50 |
| Immortal Ascension | CEO | 51–60 |
| Immortal | — | 60+ (endless) |

The realm name is primary; the job title is shown beside it.

## 5. Floors and combat

- **The tower:** floors climb from Basement Archives through the open-plan
  floors to the Executive Suite and the Heavenly Boardroom.
- **A floor** is waves of office demons → an elite → a floor boss. Clearing it
  unlocks the next floor.
- **Losing** sends the cultivator back one floor to farm. A run never gets
  stuck.
- **Combat is numbers.** Attack timers, damage, crit and HP resolve in the
  pure simulation; the strip animation only shows what happened.
- **Enemy examples:** Deadline Fiend, Inbox Hydra, Meeting Wraith, Printer
  Golem, Reply-All Swarm.

## 6. Loot

Every drop is generated from a seeded roll.

- **Slots:** Weapon, Robe, Talisman, Pendant, Pill Gourd.
- **Item level** = the floor it dropped on. It caps every roll.
- **Base stat:** each item type rolls in a range (e.g. a Jade Stapler weapon
  rolls 8–14 damage at item level 10).
- **Grades (rarity) and affix count:**

| Grade | Affixes | Drop weight (start) |
|---|---|---|
| Mortal | 0 | 60% |
| Spirit | 1–2 | 28% |
| Earth | 3–4 | 9% |
| Heaven | 4–5 | 2.7% |
| Immortal | 5 + one unique effect | 0.3% |

- **Affix pool:** +crit chance, +crit damage, +attack speed, lifesteal,
  +max HP, +defence, +qi regen, +spirit stone find, +treasure find.
- **Quality %:** how close the item rolled to its maximum, shown on every item
  (e.g. "94%"). The "one more floor" hook.

## 7. Salvage and filter

- Unwanted items melt into **Spirit Essence**, which pays for upgrades.
- **Auto-salvage filter:** rules such as "keep Earth and above" or "keep only
  Weapons for my Path". Items that fail the filter are melted on pickup.

## 8. Currencies

| Currency | Source | Spent on |
|---|---|---|
| Spirit Stones | Every kill | Path change, stat reset, inventory space |
| Spirit Essence | Salvage | Upgrading item base stats, rerolling one affix |
| Dao Insight | Early Retirement | Permanent passives (§9) |

## 9. Prestige: Early Retirement

Retire to restart at floor 1, level 1, keeping Dao Insight (earned from the
highest floor reached). Insight buys permanent passives: more XP, more
treasure find, a higher offline cap, more starting stat points.

## 10. Offline and background play

- **Time-based, not tick-based.** Progress is worked out from elapsed real
  time, because browsers throttle background tabs.
- **Overtime Cultivation:** on return, the game replays the time away (capped
  at 8 hours) and shows a summary: floors cleared, levels, drops kept and
  melted.
- **Tab as HUD:** the tab title shows status (e.g. `F12 · 3 drops`); the
  favicon can show an HP ring or flash on a Heaven-grade drop or better.
- **Pop-out window:** where supported (Document Picture-in-Picture), the strip
  can pop out into a small always-on-top window.
- **Notification:** optional browser notification on an Immortal-grade drop.

## 11. Save

Saved to browser storage, validated on load against an allow-list; a bad
save starts a new run instead of crashing.

## 12. Out of scope (v1)

- Party / multiple characters.
- Trading, real-money items, accounts, servers.

## 13. Build order

1. Simulation core: cultivator, stats, combat tick, enemies, floors.
2. Loot: item generation with seeded rolls, grades, affixes, quality.
3. Equip and inventory UI; the combat strip.
4. Save and offline catch-up.
5. Salvage, filter, currencies.
6. Realms and Tribulation bosses.
7. Early Retirement (prestige).
8. Tab HUD, pop-out window, notifications.
