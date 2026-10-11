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
     └─────── Reincarnation (prestige) ◄── wall: can't clear ◄──┘
```

## 3. The cultivator

- **Solo.** One character. No party in v1.
- **Paths (classes):** pick one at the start; change it later for a cost.

| Path | Role | Primary stat |
|---|---|---|
| Sword Cultivator | Fast hits, crit, a little lifesteal (5%) | Agility |
| Body Refiner | Tanky, lifesteal | Body |
| Talisman Master | Burst, area damage | Spirit |

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
| Golden Core | Team Lead | 21–30 |
| Nascent Soul | Manager | 31–40 |
| Spirit Transformation | Senior Manager | 41–50 |
| Void Refinement | Director | 51–60 |
| Body Integration | VP | 61–70 |
| Mahayana | CEO | 71–80 |
| Tribulation Transcendence | Chairman | 81–90 |
| Immortal Ascension | — | 91+ (endless) |

The realm name is primary; the job title is shown beside it.

- **The cap:** at level 10, 20, … 90 the level stops; XP keeps coming and is
  held. Once the next level's XP is held, the realm's Tribulation falls due and
  joins the end of the current floor, so that floor can't be passed until it is
  won.
- **Facing it early:** while a Tribulation is due, a flashing alert above the
  fight names it and the realm it leads to. A click starts it at once: it steps
  to the front, the enemy it interrupts waits behind it, and the cultivator
  faces it at full HP. Left alone, it is still fought at the end of the floor,
  so idle and offline play break through as before. A banner over the stage
  marks it beginning, won or lost; the tab title and the pop-out say it is
  due, and the drop notification (when on) also fires for it.
- **Winning** breaks through: the level moves on (spending the held XP) and the
  new realm adds +10% max HP and damage, once (added to gear's % bonuses,
  not multiplied).
- **Losing** to a Tribulation costs nothing: the floor is played again, with
  the Tribulation at its end. Gear is what beats it; a cultivator who stays
  stuck can start over through Reincarnation.
- **Tribulations:** Probation Review, Annual Appraisal, Restructuring, Hostile
  Takeover, Shareholder Revolt, Board Inquiry, Regulatory Probe, Market Crash,
  Heavenly Audit. Each is 8× a demon's HP and 2.5× its damage on the floor it
  is fought on.
- **Older saves:** a save from the seven-realm ladder keeps its level; its realm
  is read from the table above. A Tribulation it had due is renamed for that
  realm.

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
- **Arrays:** an equipped Formation Disc sets up its array as each fight
  starts (§6); the strip shows it being set up.
- **Souls:** an equipped Soul Banner gathers a soul per kill and adds them
  to every attack as extra damage (§6).
- **A pause between fights:** after a kill or a loss, neither side attacks
  for 1.2 s, so the fallen one's death plays out before the next fight.
- **Enemy examples:** Deadline Fiend, Inbox Hydra, Meeting Wraith, Printer
  Golem, Reply-All Swarm.

## 6. Loot

Every drop is generated from a seeded roll.

- **Slots:** Head, Chest, Boots, Attachment (worn at the hip: a pill gourd
  or a formation disc), Weapon, Hidden Weapon (throwing darts and knives, a
  binding rope or a soul banner), two Accessories
  and two Charms: eight item types over ten positions. An item fills its
  first free position; a player can choose either of a pair.
- **Item level** = the floor it dropped on. It caps every roll.
- **Base stat:** each item type rolls in a range (e.g. an Iron Flying Sword
  weapon rolls 8–14 damage at item level 10).
- **Every other item's name follows the grade,** one name per grade (per
  family for Accessories, Hidden Weapons and Charms, below), so a better drop looks
  better (each name has its own icon, coloured like its grade: Mortal grey,
  Spirit azure, Earth jade, Heaven white and gold, Immortal crimson and gold):

| Grade | Head | Chest | Boots | Attachment |
|---|---|---|---|---|
| Mortal | Hempen Scholar Cap | Hempen Novice Robe | Hempen Cloth Boots | Clay Wine Gourd |
| Spirit | Azure Cloud Circlet | Azure Disciple Robe | Azure Cloud Boots | Azure Spirit Gourd |
| Earth | Jade Lotus Crown | Jade Crane Robe | Jade Step Boots | Jade Elixir Gourd |
| Heaven | Golden Sun Crown | Golden Elder Robe | Golden Cloud Boots | Golden Nectar Gourd |
| Immortal | Phoenix Flame Crown | Phoenix Flame Robe | Phoenix Flame Boots | Phoenix Flame Gourd |

- **Accessories and Hidden Weapons come in families** like weapons: each
  grade drops one of each family. Accessories are Pendants, Bells or Mirrors;
  Hidden Weapons are Darts, Binding Ropes or Soul Banners. Every Accessory rolls the same
  base stat, and so does every Hidden Weapon; the family sets the name, the
  icon and the Path its affixes lean toward (**Path lean**, below).

| Grade | Pendant | Bell | Mirror |
|---|---|---|---|
| Mortal | Bone Bead Pendant | Bronze Clapper Bell | Bronze Hand Mirror |
| Spirit | Azure Spirit Pendant | Azure Soul-Scattering Bell | Azure Bagua Mirror |
| Earth | Jade Dragon Pendant | Jade Wind Chime | Jade Demon-Revealing Mirror |
| Heaven | Golden Sun Amulet | Golden Sun Bell | Golden Sun Mirror |
| Immortal | Phoenix Flame Amulet | Phoenix Flame Bell | Phoenix Flame Mirror |

- **Attachments come in two families:** Gourds and Formation Discs, even
  odds. A Gourd's base stat is lifesteal. A Formation Disc has no base stat:
  it carries one array (Binding, Illusion or Killing, even odds), set up
  automatically at the start of every fight, Tribulations included. Its base
  roll is the array's strength, within a range set by the grade (not the item
  level). Affixes roll as on any Attachment. Details names the array and its
  effect as text.

| Grade | Formation Disc | Binding Array: enemy's first attack later by | Illusion Array: enemy attack misses | Killing Array: each second, share of the cultivator's damage per second |
|---|---|---|---|---|
| Mortal | Bronze Formation Disc | 0.5–1.0 s | 3–5% | 5–10% |
| Spirit | Azure Bagua Disc | 1.0–1.5 s | 5–8% | 10–15% |
| Earth | Jade Formation Disc | 1.5–2.0 s | 8–11% | 15–20% |
| Heaven | Golden Star Disc | 2.0–2.5 s | 11–14% | 20–25% |
| Immortal | Phoenix Flame Formation Disc | 2.5–3.0 s | 14–18% | 25–30% |

- **How the arrays fight:** Binding delays only the enemy's first attack of
  the fight; the cultivator's timing is unchanged. Illusion rolls a seeded miss
  on every enemy attack. Killing deals its damage once a second from the start
  of the fight: a share of the cultivator's damage per second, not per hit, so
  fast and slow Paths gain alike (no crit, burst or lifesteal; reduced by the
  enemy's defence, at least 1). A kill by the array counts as any other kill.

| Grade | Darts | Binding Rope | Soul Banner | Soul cap |
|---|---|---|---|---|
| Mortal | Iron Throwing Darts | Hempen Binding Cord | Hempen Soul Banner | 10 |
| Spirit | Azure Frost Darts | Azure Silk Sash | Azure Soul-Calling Banner | 15 |
| Earth | Jade Viper Darts | Jade Dragon-Binding Chain | Jade Hundred Ghosts Banner | 20 |
| Heaven | Golden Crow Flying Knives | Golden Heaven-Wrapping Sash | Golden Soul-Gathering Banner | 25 |
| Immortal | Phoenix Flame Darts | Phoenix Flame Binding Rope | Ten-Thousand Souls Banner | 30 |

- **Hidden Weapon drop share:** each grade drops one of each family, so Darts,
  Binding Ropes and Soul Banners are even odds (one in three). The Hidden
  Weapon drop rate is unchanged.
- **Soul Banners** are small flags that gather the souls of slain enemies. A
  banner rolls the same base stat and affixes as any Hidden Weapon. While it
  is worn, each enemy slain (Tribulations included, and kills by an array)
  adds one soul, up to its grade's soul cap (above); the cap is set by the
  grade, not the item level. Every attack the cultivator makes releases the
  souls as extra damage: **1% of Spirit per soul**, added after crit and
  burst (souls never crit or burst) and reduced by the enemy's defence with
  the hit. Talisman Masters, whose primary stat is Spirit, gain the most.
  A full Immortal banner adds 30% of Spirit to every attack.
- **Souls clear** when the banner is unequipped or replaced and on
  Reincarnation. They are kept through a lost fight, a new floor and a
  Tribulation. A banner in the bag holds no souls. Details shows the soul
  count and cap as text, e.g. "Souls: 7 / 20 (+6.7 damage per attack)".

- **Charms come in four lines,** even odds, and none leans toward a Path: a
  player picks the one that fits how they play. A line favours three affixes:
  when a Charm draws its affixes (still without repeats), each favoured affix
  weighs 3 and every other affix 1, so a favoured one is about 3× as likely.
  Every affix can still roll on every line. The utility affixes (qi regen,
  spirit stone find, treasure find) roll at a scaled range on a Charm: 0.75×
  on any Talisman, 1.5× on a Jade Slip (both ends of the range, before
  rounding). Every other affix, the base stat (crit chance) and the affix
  count per grade are the same on every line. Details names the line, e.g.
  "Defend Talisman".

| Line | Favoured affixes (weight 3, others 1) | Utility affix range |
|---|---|---|
| Attack Talisman | crit chance, crit damage, attack speed | 0.75× |
| Defend Talisman | max HP, defence, lifesteal | 0.75× |
| Utility Talisman | qi regen, spirit stone find, treasure find | 0.75× |
| Jade Slip | qi regen, spirit stone find, treasure find | 1.5× |

| Grade | Attack Talisman | Defend Talisman | Utility Talisman | Jade Slip |
|---|---|---|---|---|
| Mortal | Paper Ward Talisman | Paper Body-Guard Talisman | Paper Fortune Talisman | Cloudy Jade Slip |
| Spirit | Azure Thunder Talisman | Azure Barrier Talisman | Azure Clear-Mind Talisman | Azure Spirit Jade Slip |
| Earth | Jade Seal Talisman | Jade Vajra Talisman | Jade Wealth Talisman | Emerald Jade Token |
| Heaven | Golden Heaven Seal | Golden Bell Guard Talisman | Golden Treasure-Seeking Talisman | Golden Sun Jade Token |
| Immortal | Phoenix Flame Talisman | Phoenix Rebirth Talisman | Phoenix Heaven-Luck Talisman | Phoenix Blood Jade |

- **Charms from before the lines** keep their name, so they load as the Attack
  Talisman of their grade with their stored rolls. A utility affix on one now
  shows at the Talisman range (0.75×).

- **Weapons are a Taoist cultivator's magic tools,** in six families. Each
  grade drops one of each family at even odds (one weapon in six per family),
  and the material gets richer with the grade (each name has its own icon).
  Every weapon rolls the same base stat and follows the treasure tier and tier
  gate (below); the family sets the name, the icon and the Path its affixes
  lean toward (**Path lean**, below).

| Grade | Flying Sword | Horsetail Whisk | Peachwood Sword | Fan | Seal | Vajra Pestle |
|---|---|---|---|---|---|---|
| Mortal | Iron Flying Sword | Hempen Horsetail Whisk | Peachwood Sword | Feather Fan | Stone Mountain Seal | Iron Vajra Pestle |
| Spirit | Azure Cloud Flying Sword | Azure Silk Whisk | Spirit Peachwood Sword | Azure Wind Fan | Azure Peak Seal | Azure Thunder Vajra Pestle |
| Earth | Jade Serpent Flying Sword | Jade Thread Whisk | Hundred-Year Peachwood Sword | Jade Crane Fan | Jade Mountain Seal | Jade Demon-Subduing Vajra Pestle |
| Heaven | Golden Crow Flying Sword | Golden Sun Whisk | Thunderstruck Peachwood Sword | Golden Cloud Fan | Golden Mountain Seal | Golden Vajra Pestle |
| Immortal | Phoenix Flame Flying Sword | Phoenix Plume Whisk | Thousand-Year Peachwood Sword | Phoenix Flame Fan | Heaven-Crushing Seal | Phoenix Flame Vajra Pestle |

- **Path lean:** each Weapon, Hidden Weapon and Accessory family leans toward
  one Path through its affixes. When a leaning item draws its affixes (still
  without repeats), each of its Path's three favoured affixes weighs 3 and
  every other affix 1, the same weighting as a Charm line, so a favoured one is
  about 3× as likely. Every affix can still roll, the affix count per grade is
  unchanged, and any Path can equip any item. Head, Chest, Boots and
  Attachments (Gourds and Formation Discs) are neutral and draw evenly; Charms
  follow their own lines (above). There is no other bonus for a matching Path.
  Details shows "Favoured by: <Path>" on a leaning item, highlighted when it is
  the player's Path. Items saved before the lean keep their stored rolls; only
  new drops lean.

| Path | Weapon | Hidden Weapon | Accessory | Favoured affixes (weight 3, others 1) |
|---|---|---|---|---|
| Sword Cultivator | Flying Sword, Peachwood Sword | Darts | Mirror | crit chance, crit damage, attack speed |
| Body Refiner | Seal, Vajra Pestle | Binding Rope | Pendant | max HP, defence, lifesteal |
| Talisman Master | Fan, Horsetail Whisk | Soul Banner | Bell | qi regen, crit damage, attack speed |

- **Treasure tier:** a weapon's details show its tier by grade: Mortal and
  Spirit are a **Magic Tool**, Earth and Heaven a **Spirit Treasure**, Immortal
  an **Immortal Treasure**.
- **Tier gate:** a tier needs a minimum realm to equip. A Magic Tool needs
  none, a Spirit Treasure needs Foundation Establishment (level 11) and an
  Immortal Treasure needs Golden Core (level 21). The gates sit low so a rare
  drop is usable early in a run. Below the realm, Details names it ("Requires
  Golden Core to equip.") and the Equip action is disabled; a double-click or
  drag does nothing. The gate applies only when equipping, so a weapon already
  worn (e.g. from a save made before the gate) stays equipped. Other item types
  have no tier and no gate.
- **Retired names:** a save's weapon with a name from before the weapon families
  (Iron Jian, Bronze Longsword, Tempered Steel Blade; Azure Cloud Jian, Sky
  River Blade, Frost Lotus Sword; Jade Serpent Blade, Verdant Pine Sword,
  Emerald Wind Jian; Golden Crow Sword, Sunlit Phoenix Blade, Imperial Gold
  Sabre; Vermilion Bird Blade, Heart Flame Jian, Nine Suns Sabre, by grade)
  loads as the Flying Sword of its grade. The same name on another grade is
  rejected. A Head, Hidden Weapon, Attachment, Accessory or Charm with a name
  from before names followed the grade (the office names, e.g. Thinking Cap,
  Stapler Dagger, Coffee Gourd, Lanyard Pendant, Sticky-Note Talisman) loads as
  the first name of its type and grade (a Pendant for Accessories, Darts for
  Hidden Weapons); on another type it is rejected.

- **Grades (rarity) and affix count:**

| Grade | Affixes | Drop weight (start) |
|---|---|---|
| Mortal | 0 | 60% |
| Spirit | 1–2 | 28% |
| Earth | 3–4 | 9% |
| Heaven | 4–5 | 2.7% |
| Immortal | 5 + one unique effect | 0.3% |

- **Drop chance per kill:** demon 2%, elite 12%, boss 25%, Tribulation
  100%; treasure find multiplies it. About 0.55 drops a floor at the start.
  Offline (Overtime Cultivation, §10) every chance but a Tribulation's is
  multiplied by 0.5: demon 1%, elite 6%, boss 12.5%, about 0.28 drops a floor.
  Grades, affixes and item level roll the same online and offline.
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
| Dao Insight | Reincarnation | Permanent passives (§9) |

- **Path change** puts every stat point into the new Path's primary stat.
- **Stat reset** takes back every point above the base to spend by hand;
  level-ups keep going to the primary stat.
- **Inventory space** adds a row of 8 cells, each row dearer, up to 80 (on a
  second inventory page).

## 9. Prestige: Reincarnation

Reincarnate to restart at floor 1, level 1, keeping Dao Insight (earned from the
highest floor reached). Insight buys permanent passives: more XP, more
treasure find, a higher offline cap, more starting stat points.

- **Insight paid:** highest floor² / 50, rounded down; nothing below floor 10,
  where the Reincarnate button stays off (floor 10 pays 2, 20 pays 8, 50 pays 50).
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
  Offline means the browser or the game's tab was closed. The replay plays
  the same as an open tab, except items drop at half the online rate (§6), so
  playing is the better way to find loot and catch-up is mostly for floors and
  XP. The summary says that drops are reduced while away. A tab left open in
  the background is online and keeps the online rate.
- **Tab as HUD:** the tab title shows status (e.g. `F12 · 3 drops`); the
  favicon can show an HP ring or flash on a Heaven-grade drop or better.
- **Pop-out window:** where supported (Document Picture-in-Picture), the Mini
  view (§14) pops out into a small always-on-top window. Not offered when the
  page is embedded in a frame (the itch.io build): the API refuses there.
- **Notification:** optional browser notification on an Immortal-grade drop
  and when a Tribulation falls due (§4).

## 11. Save

Saved to browser storage, validated on load against an allow-list; a bad
save starts a new run instead of crashing. The save is versioned JSON, written
on every autosave, and is always the copy the game plays from.

### Backup copy and save code

- **IndexedDB copy.** Every save also goes to IndexedDB, and each write goes
  ahead whether or not the other succeeds. On start the game reads both copies,
  runs each through the same allow-list, and plays the newest one that passes
  (the browser storage copy on a tie); a broken copy is skipped, never
  preferred, and so is a backup stamped more than a minute in the future
  (both copies are stamped by this browser's clock). So a `localStorage.clear()` by another page on the same origin
  (itch.io serves every game from one), or a full browser storage, doesn't
  lose the run: the next start loads the IndexedDB copy, and a running tab
  that sees the clear writes its save straight back. Where IndexedDB is
  missing, blocked or doesn't answer within 1.5 s, the game runs on browser
  storage alone. A save taken from the cloud (below) loads from browser
  storage whatever its stamp, since another device's clock may be behind.
  Reset progress stops autosaving, deletes the IndexedDB copy first, then
  browser storage, and is refused if either refuses.
- **Save code.** Menu, Settings, Save code. **Export** copies the save to the
  clipboard as one line of text (`OI1:` and the save JSON in base64); where
  the browser won't copy, the code is shown to copy by hand. Keep it anywhere
  outside the browser. To restore, paste it into the field and press
  **Import**: the game shows the code's realm, level, floor and last-played
  time, and replaces the current run only after the player confirms. Overtime
  Cultivation replays from the code's own time stamp.
- **Import is untrusted input.** At most twice the longest possible code is
  looked at; only ASCII spaces and line breaks are ignored; the rest must be
  the tag and plain base64 of valid UTF-8, and the save inside goes through the
  load allow-list. Anything else (too long, wrong tag, look-alike or invisible
  characters, a hostile save) is refused with a short message and nothing
  changes. The pasted text is cleared from the field once read and is never
  shown back, put in the title or logged; the field has spell check off.
- **Clearing all site data** in the browser deletes both copies. Only an
  exported save code (or the cloud save) survives that.

### Cloud save

Optional, off until the player turns it on (Menu, Settings, Cloud save). It
keeps the same one-cultivator save on a server so it can be loaded in another
browser or device. Browser storage stays the working copy; the game never
waits on the network.

- **Identity.** No account, no email. Turning it on makes this browser an
  anonymous user on the backend (Supabase anonymous sign-in). To use the save
  elsewhere, the first device shows a one-time **link code** (10 characters,
  valid 15 minutes, used once); the other device enters it and joins the same
  save. Letter case, spaces, dashes and look-alikes (O/0, I/L/1) don't matter.
- **Server is storage only.** One text save per player with a revision number,
  and size and shape checks (at most 200,000 characters, a JSON object). Each
  player reads and writes only their own save, through a handful of database
  functions; the tables themselves are closed to the browser. The simulation
  runs on the client, so the server cannot stop tampering and does not try.
- **Allow-list on the way back.** Everything downloaded goes through the same
  load check as a local save (§11 above), plus checks on the reply's shape.
  A rejected cloud save never replaces the local one: the player is told, the
  local save is kept, and the cloud save is overwritten only if the player
  asks ("Overwrite cloud with this device's save").
- **Sync timing.** At most one upload a minute while playing, plus when the tab
  is hidden or the page is left, plus a **Sync now** button. Nothing uploads
  until the startup check (below) has answered. Failed requests back off from
  one to five minutes and retry at once when the browser comes back online.
  Playing offline just queues: the latest save goes up when the connection
  returns.
- **Ordering and conflicts.** The server's revision number is the only order;
  clocks on different devices are never compared. An upload says which
  revision it builds on, and the server refuses it if the save has moved. On
  start the game plays from the local save, then checks the cloud in the
  background:
  - cloud unchanged since this device last synced: nothing to do;
  - cloud moved, and this device has nothing the cloud lacks: the cloud save
    is loaded, and Overtime Cultivation (§10) replays from the time stamped in
    that save;
  - cloud moved, and this device has unsynced progress, or an upload is
    refused during play: the player chooses. A panel shows each save's realm,
    level, floor and last-played time, and neither is replaced until the
    player picks "Keep this device's" or "Use cloud save".
  A reply lost after the server stored an upload is recognised by the stored
  data matching the local save, so it is not shown as a conflict.
- **Linking.** Joining with a code never overwrites silently: a device that
  already has a run is asked which save to keep, and closing the page mid-choice
  asks again next time.
- **Reset progress** also deletes the cloud save (other linked devices lose it
  too) and is refused, changing nothing, if the cloud can't be reached.
  "Turn off on this device" only forgets the cloud here and leaves the server
  save for other devices.
- **Signed out.** If the backend stops honouring this browser's sign-in, play
  continues, uploads stop, and the Menu offers to link again or start a new
  cloud save. No new anonymous user is created behind the player's back.
- **Data loss warning.** An anonymous cloud save lives only as long as at least
  one linked device keeps its site data. Clearing site data on every linked
  device loses it. Linking a second device keeps a copy.
- **Privacy and safety.** The backend address and public client key come from
  build-time environment variables (§ README), not the repository; without
  them the build has no cloud save and its Content-Security-Policy is
  unchanged. With them, the policy allows that one origin and nothing else.
  Tokens and save data travel in headers and request bodies, never in URLs;
  the game logs nothing and never puts cloud data in the page title.
  Server text is never shown: errors map to the game's own messages.

### Cloud save on itch.io

itch.io serves every uploaded HTML5 game from one shared origin, so anything
the game keeps in its own browser storage there can be read, changed or
cleared by any other game on itch.io. The itch.io build therefore keeps its
save and its cloud save in a **storage frame**: a page without visible content
(`store.html`) on our GitHub Pages origin, embedded hidden in the game.

- **What lives in the frame.** The local save, its IndexedDB copy, the
  settings, and the whole cloud save: the sign-in session, the sync and every
  request to the backend. The token never leaves the frame. The game works from
  a copy of the frame's storage kept in memory, so play never waits on a
  message: writes go to the copy at once and on to the frame, and the frame's
  own writes (taking the cloud's save) come back as messages. An autosave
  sent just as the frame takes the cloud's save can land after it; the game
  restarts from the cloud's save either way and its next save puts it back, as
  between two tabs.
- **Who the frame answers.** Only when `location.ancestorOrigins` is exactly
  itch.io's game host (`*.itch.zone`) inside our own itch.io page at the top
  (the page origin is set at build time). Anything else gets no answer: a
  missing `ancestorOrigins` (Firefox), another game on the same itch.io origin
  in its own page, another frame on our page (a video), our page framed by
  another, or the frame loaded on its own. The trust is per itch.io account:
  `https://<user>.itch.io` is the top of every game that account publishes. A
  message counts only from the frame's parent window at that origin; replies go
  to that origin alone, never `*`.
- **Messages.** A fixed list of request types (read and write a stored key, the
  backup, and each cloud action). Both sides read every message through an
  allow-list, as for the save: exact keys, known storage keys only (the cloud's
  own key is never one), text of a save's size at most, known message codes.
  A conflict's two saves travel as save text and go through the load check
  again on arrival. Anything off is dropped without an answer. No message
  carries a link code, either way.
- **Link codes.** The game page never sees one. On itch.io, two visible frames
  of the same page take the place of the game's own controls, and the game
  shows only their captions:
  - `store.html#code` (Menu, while cloud save is on) has the **Get link code**
    button. It makes the code itself, on a real click inside it (a script's
    click is ignored), and shows it there. It uses the sign-in the storage
    frame keeps (same origin, same storage) and posts nothing.
  - `store.html#link` (Menu while cloud save is off or signed out, and the
    Path choice) has
    the field for a code from another device. On a real click or Enter it
    hands the code straight to the storage frame beside it in the game, which
    links as before; the storage frame takes it only from a frame of the same
    game page on our own origin, through the same allow-list. How it went
    reaches the game as a status or a note, never the code.

  Both answer only where the storage frame would and follow the game's theme
  and language from that storage. Another page can't read or type into a
  frame on another origin, so a game scripting ours (below) can't read a code
  or link on its own.
  Each frame is added when its part of the Menu shows and removed when it
  hides (cloud save turned off, or signed out), so a code shown or typed
  before never shows again.
- **Fallback.** Where the frame refuses, or isn't linked within 7 s (2 s
  once loaded), the game runs on its own itch.io storage and IndexedDB
  copy, without the cloud save, as before. A browser without
  `ancestorOrigins` skips the frame at once. So progress is never stuck behind
  the frame, every save also goes to the game's own itch.io copies. Those are
  read only when the frame doesn't answer or holds no save (its first start,
  or a browser that wipes frame storage between visits); whenever the frame has
  a save, it wins. Another game can read or change those copies, but they hold
  only the game's state, never the token, and never override the frame's save.
  Reset progress clears every copy. The cost: a session that ran without the
  frame while the frame still holds a save (GitHub Pages slow or down) is
  dropped at the next linked start, which plays the frame's save.
- **Builds.** The GitHub Pages build ships `store.html` and names the itch.io
  page it answers (`VITE_ITCH_PAGE_ORIGIN`). The itch.io build has no cloud
  settings and no `store.html`; it names the frame
  (`VITE_STORE_FRAME_URL`) and its Content-Security-Policy gains only
  `frame-src` for that GitHub Pages origin. `npm run zip` refuses any other
  form: a cloud address, no frame or a frame origin that is not GitHub Pages,
  or a frame page of its own.
- **Known limit.** itch.io sends no Cross-Origin-Opener-Policy, so another
  itch.io game that opens our itch.io page in a popup can script our game
  (they share an origin) and act through it: upload over or delete the cloud
  save. It can't read the token, read a link code or link on its own (above).
  It can still fake or cover the frames to trick the player: a look-alike
  field on its own origin that catches a typed code, a fake code of its own,
  or text dragged into a hidden link frame. Each needs the attack running
  while the player links; a frame can't show its origin, so no frame can
  prevent it. The storage frame shares its origin with every GitHub Pages
  site of the same account (`<user>.github.io`), so those sites must stay
  free of script injection; a custom domain for the frame would isolate it.

## 12. Out of scope (v1)

- Party / multiple characters.
- Trading, real-money items, and accounts with email or passwords. The only
  server is the cloud save's storage (§11); it has no leaderboards or shared
  state.

## 13. Build order

1. Simulation core: cultivator, stats, combat tick, enemies, floors.
2. Loot: item generation with seeded rolls, grades, affixes, quality.
3. Equip and inventory UI; the combat strip.
4. Save and offline catch-up.
5. Salvage, filter, currencies.
6. Realms and Tribulation bosses.
7. Reincarnation (prestige).
8. Tab HUD, pop-out window, notifications.

## 14. Art direction

**Hybrid:** the game is dressed as office software, and the only illustrated
part is a pixel-art combat strip shown like a live chart inside it. The joke is
the contrast: a dull spreadsheet with a vivid cultivation fight in the middle.

### Office shell (CSS only, no art)

- A generic spreadsheet / dashboard look: a title bar with a file name
  (`Q3_Cultivation_Report`), a formula bar, faint cell lines behind the
  panels, summary chips, panels with header bars, tabs and a status bar. The
  combat strip sits in it like an embedded chart, with its own header bar.
- **Title stamp:** the game's name sits in the title bar as a red rubber
  stamp (like "CONFIDENTIAL"): capitals, double border, tilted, in the
  Immortal grade colour. It is the one loud mark on the dull shell.
- **Generic, never a copy.** No real software names, logos, icons, ribbon
  layouts or colour schemes that identify a real product. It should read as
  "office software", not as any one product.
- The summary is a band of one-line chips ("Label value"): Path, Realm with
  its job title, Spirit Stones and Spirit Essence. Realm, Spirit Stones and
  Spirit Essence open with a small icon (decorative, hidden from screen
  readers); the Realm icon changes at each breakthrough. Hovering or focusing
  the Realm chip lists every realm in order with its job title and levels
  ("Lv 11–20"; Immortal Ascension "Lv 91+"), the current one highlighted; it
  closes when the pointer and focus leave, or on Escape. A tap opens it on a
  touch screen; tapping elsewhere closes it. Level and XP to the next
  level are a yellow progress bar along the foot of the combat strip ("Lv 14"
  at its left end, "37 / 60" inside; full with "Tribulation due" when one is
  due). The strip header shows floor, best floor, wave and kills
  ("Floor 12 (best 15) · Wave 2 / 3 · Kills 340").
- **Inventory is a grid**, as loot games do it: a fixed grid of bag cells
  (empty ones shown), each item cell marked by grade colour and grade initial.
  A page holds the starting 40 cells; bought cells go on page 2, reached with
  the Previous / Next pager under the grid (hidden, space kept, while the bag
  has one page), so buying slots never grows the panel. A short last page is
  padded to full size. Arrow keys stay on the shown page; turning the page
  clears a bag selection left on the other one. A new run (after
  Reincarnation) opens on page 1.
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
- Languages: English and Vietnamese. A globe button beside Menu shows the
  code (EN / VI) and opens the list; the default is the browser's language
  when there is a pack for it, else English. Like the theme it is a display
  preference (Reset progress keeps it), and a switch changes the page in
  place, with no reload. Vietnamese uses the genre's Sino-Vietnamese terms
  (Luyện Khí, Trúc Cơ, Kim Đan, Nguyên Anh…). Numbers keep one format in both.
  The sim keeps its English names as ids; the UI translates them
  (`src/ui/lang/`, one file per language).

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
- **Names under the stage:** each fighter's name has its own row (name, HP
  bar, then HP) at every width, with 2 lines always reserved, so the strip
  never changes height between enemies. A ranked enemy's tier, in brackets,
  bold and in its tier colour, sits on line 1 by itself and the name on line 2,
  in every language: "(Elite)" over "Inbox Hydra", "(Boss)" over "The
  Auditor", "(Tribulation)" over "Heavenly Audit". A demon's name takes line 1.
  The foe's side is right-aligned, the player's left. Under 480 px the name
  (never the tier) is set a step smaller so the longest fits one line. The
  full name, e.g. "(Boss) The Auditor", is also the tooltip.
- **Backgrounds:** one tiling layer per tower zone, 208 px tall, with office
  props in pixel form: filing cabinets, cubicles, water cooler, KPI whiteboard,
  city windows at night, a boardroom above the clouds. Dimmed so the fighters
  stay the brightest thing in the strip.
- **Item icons:** one atlas cell per item name, 64×64, shown at 32×32 (sharp
  on high-density screens). Every item name has its own drawn icon, kept close
  to its source art (256 colours picked from the icons themselves, not the
  shared palette). The grade stays on the cell border and its initial, never
  on the icon alone.
- **Summary icons:** in the item icons' style, 64×64 in one atlas row
  (`summary.png`), shown at the chip's text size: a glowing cyan spirit stone,
  an orange essence drop, and one per realm, each grander than the last (qi
  swirl, jade foundation, golden core, lotus with a spirit flame, azure flying
  sword, crane over the clouds, crimson and gold sun emblem).
- **Paper doll:** a 64×80 pixel-art figure at 4×, the slots placed where they
  are worn.
- Damage numbers are drawn in code, not baked into sprites. An enemy that dies
  falls where it stood, and the next one steps up only once it is down (the
  pause between fights, §5).
- The sim decides every outcome; the strip only plays it back. Reduced motion
  shows a still pose.
- The Full view shows the whole stage at 3/4 (156 px tall) in the left half
  of the page, with the summary chips and Recent drops beside it, so the
  panels fit one screen; the
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
| **Full** | Normal tab, 768 px wide or more | Title bar; combat strip with its XP bar, and beside it the summary chips over Recent drops; then Character, Inventory and Details; compact, to fit an 800 px tall screen |
| **Narrow** | Under 768 px (down to 375 px) | Same panels stacked: strip first, then the chips, Recent drops, then the panels |
| **Mini** | Pop-out window (§10), or any window under 240 px tall | Title bar, combat strip with HP bars only (no names, HP numbers or "vs"), one status line (`F21 · Golden Core · Manager · 3 drops`) and the latest-drop toast |

- The title bar's language button (globe and code) sits beside **Menu**.
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
  the shared palette (item icons: their own 256 colours) by
  `tools/art/build.py` (prompts and seeds in `tools/art/manifest.json`; the
  generated sources are not committed). No commercial characters, logos or
  brand marks in any asset. All of it is served from the site itself and
  stays under 1 MB.
- Weapon icons are drawn by hand as SVG in `tools/art/weapons.mjs`, so their
  editable sources are committed. `node tools/art/render-weapons.mjs` renders
  them to transparent PNGs in `art-src/weapons/`, and
  `python3 tools/art/build.py icons:weapon` fits them into the atlas's weapon
  column, copying every other column from the shipped atlas (their sources
  are not always at hand; the atlas picks its 256 colours again on save, so
  their colours can move slightly).
