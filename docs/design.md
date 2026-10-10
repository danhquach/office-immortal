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
fight floor ─► drops + XP ─► equip / sell / salvage ─► stronger ─► next floor
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

- **Balance:** no Path is much stronger than the others; a test keeps each
  within 15% of the others on the floor reached.
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

- **The cap:** at level 10, 20, … 60 the level stops; XP keeps coming and is
  held. Once the next level's XP is held, the realm's Tribulation joins the end
  of the current floor, so that floor can't be passed until it is won.
- **Winning** breaks through: the level moves on (spending the held XP) and the
  new realm adds +10% max HP and damage, once (added to gear's % bonuses,
  not multiplied).
- **Losing** to a Tribulation costs nothing: the floor is played again, with
  the Tribulation at its end. Gear is what beats it; a cultivator who stays
  stuck can start over through Early Retirement.
- **Tribulations:** Probation Review, Annual Appraisal, Restructuring, Hostile
  Takeover, Board Inquiry, Heavenly Audit. Each is 8× a demon's HP and 2.5×
  its damage on the floor it is fought on.

## 5. Floors and combat

- **The tower:** floors climb through four zones: Basement Archives (floors
  1–10), the open-plan floors (11–40), the Executive Suite (41–70) and the
  Heavenly Boardroom (71 up).
- **A floor** is waves of office demons → an elite → a floor boss. Clearing it
  unlocks the next floor.
- **Losing** sends the cultivator back one floor to farm (a lost
  Tribulation replays the floor instead, §4).
- **Combat is numbers.** Attack timers, damage, crit and HP resolve in the
  pure simulation; the strip animation only shows what happened.
- **A pause between fights:** after a kill or a loss, neither side attacks
  for 1.2 s, so the fallen one's death plays out before the next fight.
- **Enemy examples:** Deadline Fiend, Inbox Hydra, Meeting Wraith, Printer
  Golem, Reply-All Swarm.

## 6. Loot

Every drop is generated from a seeded roll.

- **Slots:** Head, Chest, Pants, Attachment (worn at the hip, e.g. a pill
  gourd), Weapon, Side arm, two Accessories and two Charms: eight item types
  over ten positions. An item fills its first free position; a player can
  choose either of a pair.
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

- **Drop chance per kill:** demon 4%, elite 25%, boss 50%, Tribulation
  100%; treasure find multiplies it. About one drop per floor at the start.
- **Affix pool:** +crit chance, +crit damage, +attack speed, lifesteal,
  +max HP, +defence, +qi regen, +spirit stone find, +treasure find.
- **Quality %:** how close the item rolled to its maximum, shown on every item
  (e.g. "94%"). The "one more floor" hook.

## 7. Sell, salvage and filter

- Unwanted items **sell** for Spirit Stones or **salvage** into **Spirit
  Essence**, the crafting material (crafting comes later). Both pay by grade
  and item level.
- **Bulk sell:** "sell everything below grade X", after a confirmation that
  names how many items go and the highest grade among them.
- **Auto filter:** a minimum grade ("keep Earth and above") plus the item types
  to keep. Drops that fail are sold or salvaged on pickup, as the player
  chooses. The filter starts off: everything is kept.
- **Full bag:** a drop that doesn't fit is sold, never lost.
- Equipped items are never sold or salvaged.

## 8. Currencies

| Currency | Source | Spent on |
|---|---|---|
| Spirit Stones | Kills and selling | Path change, stat reset, inventory space |
| Spirit Essence | Salvage | Crafting (later): upgrading base stats, rerolling one affix |
| Dao Insight | Early Retirement | Permanent passives (§9) |

- **Path change** puts every stat point into the new Path's primary stat.
- **Stat reset** takes back every point above the base to spend by hand;
  level-ups keep going to the primary stat.
- **Inventory space** adds a row of 8 cells, each row dearer, up to 80.

## 9. Prestige: Early Retirement

Retire to restart at floor 1, level 1, keeping Dao Insight (earned from the
highest floor reached). Insight buys permanent passives: more XP, more
treasure find, a higher offline cap, more starting stat points.

- **Insight paid:** highest floor² / 50, rounded down; nothing below floor 10,
  where the Retire button stays off (floor 10 pays 2, 20 pays 8, 50 pays 50).
- **Kept:** Dao Insight, passives, the Path and the auto filter. **Lost:**
  level, floors, every item (bag and equipped), Spirit Stones, Spirit Essence
  and bought bag slots.
- **Confirmation** lists what is kept and lost before the run ends; the new
  run is saved at once.
- **Passives** (any time, apply at once; each rank costs twice the last):

| Passive | Per rank | First rank | Max rank |
|---|---|---|---|
| Seniority | +10% XP from kills | 2 | 20 |
| Expense Account | +5% treasure find | 2 | 20 |
| Flexible Hours | +1 h Overtime Cultivation cap | 3 | 8 |
| Head Start | +2 stat points (primary stat), this run and every run after | 3 | 20 |

## 10. Offline and background play

- **Time-based, not tick-based.** Progress is worked out from elapsed real
  time, because browsers throttle background tabs.
- **Overtime Cultivation:** on return, the game replays the time away (capped
  at 8 hours, more with Flexible Hours, §9) and shows a summary: floors
  cleared, levels, drops kept, sold and salvaged, and the currencies earned.
- **Tab as HUD:** the tab title shows status (e.g. `F12 · 3 drops`); the
  favicon can show an HP ring or flash on a Heaven-grade drop or better.
- **Pop-out window:** where supported (Document Picture-in-Picture), the Mini
  view (§14) pops out into a small always-on-top window.
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

## 14. Art direction

**Hybrid:** the game is dressed as office software, and the only illustrated
part is a pixel-art combat strip shown like a live chart inside it. The joke is
the contrast: a dull spreadsheet with a vivid cultivation fight in the middle.

### Office shell (CSS only, no art)

- A generic spreadsheet / dashboard look: a title bar with a file name
  (`Q3_Cultivation_Report`), a formula bar, faint cell lines behind the
  panels, KPI tiles, panels with header bars, tabs and a status bar. The
  combat strip sits in it like an embedded chart, with its own header bar.
- **Generic, never a copy.** No real software names, logos, icons, ribbon
  layouts or colour schemes that identify a real product. It should read as
  "office software", not as any one product.
- Stats are KPI tiles (Realm, Job title, Floor, Qi to next breakthrough),
  the log is a "Cultivation Log" panel.
- **Inventory is a grid**, as loot games do it: a fixed grid of bag cells
  (empty ones shown), each item cell marked by grade colour and grade initial.
  Selecting a cell shows a details panel: rolls, quality, and gains / losses
  against the equipped item. Equip by dragging the item onto the character
  panel (onto one of a pair to choose it; anywhere else picks its default
  position), by double-click, or with the panel's Equip button (touch
  and keyboard use the button).
- In the Full view the character, inventory and side panels keep fixed widths
  and one shared height whatever tab is open; a taller tab or item scrolls
  inside its panel.
- Dark theme by default; Menu → Settings offers Light and Match system. The
  choice is a display preference, so Reset progress keeps it, and the page
  paints in it from the first frame. Text 4.5:1 or more on its background in
  both.

### Combat strip (pixel art)

- Crisp pixel art (`image-rendering: pixelated`) on a limited palette, drawn
  at 1× and scaled down as a whole where a view needs the room (below).
- **Sprites:** frames are 128×128 for the cultivator and regular demons,
  160×160 for elites and 192×192 for bosses: the detail the art is drawn at,
  not shrunk to fit. Frames: idle 4, attack 4, hit 2, death 4. Each action is
  its own drawn pose: attack swings or leaps, hit knocks back in a white flash,
  death falls slowly until flat.
- **Elites and Tribulations are variants:** an elite reuses its demon's poses
  and a Tribulation a boss's, rebuilt at its own size with a colour swap and a
  glow drawn around it. No art of their own.
- **Backgrounds:** one tiling layer per tower zone, 208 px tall, with office
  props in pixel form: filing cabinets, cubicles, water cooler, KPI whiteboard,
  city windows at night, a boardroom above the clouds. Dimmed so the fighters
  stay the brightest thing in the strip.
- **Item icons:** one drawn icon per item type, 32×32; each item name has its
  own material (a colour swap of the type's icon). The grade stays on the cell
  border and its initial, never on the icon alone.
- **Paper doll:** a 64×80 pixel-art figure at 4×, the slots placed where they
  are worn.
- Damage numbers are drawn in code, not baked into sprites. An enemy that dies
  falls where it stood, and the next one steps up only once it is down (the
  pause between fights, §5).
- The sim decides every outcome; the strip only plays it back. Reduced motion
  shows a still pose.
- The Full view shows the whole stage at 3/4 (156 px tall) in the left half
  of the page, with the KPI tiles beside it, so the panels fit one screen; the
  Mini view at 3/8 so it fits its 160 px window. Narrow shows it at 1×, whole
  pixels.

### Grade colours

| Grade | Colour |
|---|---|
| Mortal | Grey |
| Spirit | Blue |
| Earth | Green |
| Heaven | Gold |
| Immortal | Crimson |

Each has a light- and a dark-theme value that passes 4.5:1 on its background.
Grade is also written as text, never shown by colour alone.

### Views

| View | When | Shows |
|---|---|---|
| **Full** | Normal tab, 768 px wide or more | Title bar, KPI tiles, combat strip, loot table, Cultivation Log, side panels; compact, to fit a 768 px tall screen |
| **Narrow** | Under 768 px (down to 375 px) | Same panels stacked: strip first, then KPI tiles, loot, log |
| **Mini** | Pop-out window (§10), or any window under 240 px tall | Title bar, combat strip with HP bars, one status line (`F21 · Golden Core · Manager · 3 drops`) and the latest-drop toast |

- The title bar's **Menu** holds Settings (notifications, Reset progress,
  which asks first and then deletes the save) and Help (how to play).
- Full and Narrow are chosen by width; Mini is chosen by height or by being
  the pop-out, and wins when both apply.
- The Mini view has no inventory or menus. In the pop-out, a click on it
  focuses the main tab; in a short main window, making the window taller
  brings the other views back. Its aspect is about 3:1 (e.g. 480×160).
- All three views render the same state; switching never pauses the sim.

### Assets

- Concept art is generated with an image model to explore direction; it is
  reference only and never shipped.
- Shipped art is generated per asset, then cleaned to its final pixel size and
  the shared palette by `tools/art/build.py` (prompts and seeds in
  `tools/art/manifest.json`; the generated sources are not committed). No
  commercial characters, logos or brand marks in any asset. All of it is
  served from the site itself and stays under 1 MB.
