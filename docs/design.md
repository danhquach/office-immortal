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

| Path | Role | Primary stat | Path Mastery |
|---|---|---|---|
| Sword Cultivator | Fast hits, crit, a little lifesteal (5%) | Agility | Flowing Sword |
| Body Refiner | Tanky, lifesteal (15%), +15% damage | Body | Iron Body |
| Talisman Master | Burst (every 5th attack ×5), area damage | Spirit | Talisman Resonance |

- **Balance:** no Path is much stronger than the others; a test plays each
  Path with a fixed reference build (its Auto-assign plan: Sword 30 / 60 / 10,
  Body 70 / 20 / 10, Talisman 30 / 10 / 60 Body / Agility / Spirit) and keeps
  each within 15% of the others on the floor reached, at 10 and 60 minutes,
  with the Path skills (§5) cast as in play. The skills let the Sword
  Cultivator and Talisman Master clear the first Tribulations much sooner, while
  the Body Refiner's first skill is defensive, so the Body Refiner deals
  +15% damage (all of its damage, after gear and realm bonuses).
- **Stats: every stat helps every Path.** Each stat's effects are full for
  the Path whose main stat it is and **half** for the other two (the Path
  share). The numbers below are the full share:
  - **Body:** +10 max HP, +0.5 defence and +0.1 HP regen a second per point.
    HP regen heals on the regen step, once a second, in fights and between
    them (the same step as qi regen).
  - **Agility:** attacks a second on a log curve with no limit of its own,
    1 + 1.08 · ln(1 + Agility / 100): 1.75 at 100, 2.5 at 300, about 3.1 at
    600 (off-Path, half the gain over 1). Crit chance 5% + 45% · A / (A + 150):
    23% at 100, 35% at 300 (off-Path, half the part above 5%). Dodge
    27.5% · A / (A + 450): 5% at 100, 11% at 300; a dodged attack misses.
    Skill cooldown reduction 50% · A / (A + 250): 14% at 100, 27% at 300,
    cutting the cultivator's skill cooldowns (§5 Skills).
  - **Spirit:** defence pierce 48.5% · S / (S + 185): 17% at 100, 30% at 300;
    that share of each hit ignores the enemy's defence. Max qi and qi regen
    (§5 Qi and skills) follow the same Path share. A Soul Banner works as
    before.
  - **The Path's main stat** also adds +1.5 damage a point, so a point spent
    elsewhere is a real trade-off.
  - Curves gain less as they grow but never stop; the only limit is attack
    speed: 4 a second, 5 with Flowing Sword. A crit chance can't pass 100%.
- **Path Mastery** (the main stat's own effect, always full):
  - **Flowing Sword:** +0.5% crit damage per Agility point; attacks up to 5 a
    second.
  - **Iron Body:** reflects 40% · B / (B + 345) of each hit taken back on the
    attacker, past its defence and rounded (9% at 100 Body), which can
    finish it; +0.1% lifesteal per Body point (lifesteal stays capped at 50%).
  - **Talisman Resonance:** +1% burst damage per Spirit point; each burst
    splashes 50% onto the next enemy waiting (after its defence, never a
    Tribulation), leaving it at least 1 HP.
- **Stat points:** each level-up adds 3 **unspent** points; nothing is spent
  by itself unless Auto-assign is on. While points wait, the Stats tab and
  its Stats sub-tab show a dot, Base stats says "N unspent" and the Mini
  view's status line adds "+N pts". +1 or All on a stat's row spends them.
- **Auto-assign** (a switch on the Stats tab, off by default, folded into
  one line, "Auto-assign: off" or "Auto-assign: 40 / 40 / 20"): a ratio across
  Body, Agility and Spirit in whole percent, 0 to 100 each, adding up to 100;
  it starts at 100% on the main stat. New points follow it exactly over time:
  a smooth weighted round robin carries the rounding from point to point, so
  every 100 points match the ratio exactly and no stat strays a point between
  (live and offline alike). Each Path keeps its own plan; a Path change
  switches to that Path's. Points already unspent wait for the player or
  **Apply plan**. Typed shares that break the rules are refused with a note
  and not saved; a saved plan that breaks them loads as the default.
- **Explaining a point before it is spent:** hovering, focusing or tapping a
  stat's name opens a tip: what one more point does now, in real numbers
  ("+1 Agility: Attacks/s 1.75 → 1.76, Crit chance 23% → 23.11%, Dodge 5% →
  5.04%"); the Mastery line for the main stat, or "Not your Path's stat: no
  damage"; "Your Path's stat: full effect" or "Other Path: half effect"; and
  "Gains slow above N" once its curve has slowed to half its first gains.
  Hovering or focusing +1 or All shows the derived rows as they would be,
  gains green and losses red. Help has a Stats entry with the same parts.

## 4. Realms and levels

Level-ups give stat points. Realms get longer as the run goes on: the first two
are 10 levels, then 20, then 30 and the last 40, so every realm ends on a
multiple of 10 and none is shorter than the one before. Each realm ends in a
Tribulation boss that must be beaten to advance.

The XP to the next level is 50 × 1.15^(level − 1): it grows at the same rate as
a kill's XP per floor, so the pace of levelling holds as the run deepens, and
even the price of level 210 is a whole number a save can hold.

| Realm | Job title | Levels |
|---|---|---|
| Qi Condensation | Intern | 1–10 |
| Foundation Establishment | Associate | 11–20 |
| Golden Core | Team Lead | 21–40 |
| Nascent Soul | Manager | 41–60 |
| Spirit Transformation | Senior Manager | 61–80 |
| Void Refinement | Director | 81–110 |
| Body Integration | VP | 111–140 |
| Mahayana | CEO | 141–170 |
| Tribulation Transcendence | Chairman | 171–210 |
| Immortal Ascension | — | 211+ (endless) |

The realm name is primary; the job title is shown beside it.

- **The cap:** at level 10, 20, 40, 60, 80, 110, 140, 170 and 210 (the last
  level of each realm) the level stops; XP keeps coming and is held. Once the
  next level's XP is held, the realm's Tribulation falls due and joins the end
  of the current floor, so that floor can't be passed until it is won. Winning the one at level 210 opens Immortal Ascension.
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
- **Main-stat bonus:** each breakthrough also raises the Path's primary stat,
  by a bigger share every realm: +1% into Foundation Establishment, rising
  evenly to +6% into Immortal Ascension (+1%, +1.625%, +2.25% … +6%),
  cumulative, so Golden Core has +2.625% in all, Nascent Soul +4.875% and
  Immortal Ascension +31.5%. It is derived from the level, not stored: the
  stat points a cultivator holds and spends are unchanged, and the boosted
  stat (not rounded, so a small step still counts) is what combat and Soul
  Banner souls read. The Realm chip's list names each realm's total, to one
  decimal ("+2.6% main stat"). The Stats tab shows it in green beside the base
  value ("146 +7.1"); hovering, focusing or tapping it explains it and gives
  the sum ("Bonus from your realm: Nascent Soul (146 + 7.1 = 153.1)").
- **Losing** to a Tribulation costs nothing: the floor is played again, with
  the Tribulation at its end. Gear is what beats it; a cultivator who stays
  stuck can start over through Reincarnation.
- **Auto-Tribulation** (Menu, Settings; on by default, kept through Early
  Retirement): on, a due Tribulation joins the end of the floor as above;
  off, only the alert's click starts one. Either way a floor can't be passed
  while a Tribulation is due: cleared without it, the floor is played again.
- **Retry limit:** after 3 Tribulation losses in a row it is set aside. It
  leaves the floor and the cultivator farms that floor (loot keeps coming,
  the floor is not passed). The alert reads "Tribulation paused after 3
  losses: get stronger" with the losses so far, when the next try comes
  ("3 losses · retry in 9 min") and a **Try again** chip; a click is a single
  try. With Auto-Tribulation on it gets one automatic try, joining the end of
  the floor at the next kill, once either holds: the cultivator's damage or
  max HP is at least 5% above what it was at the last loss (the Stats tab's
  damage and max HP, from anything that raises them: gear, stat points,
  realm bonuses; Soul Banner souls and a Killing Array's hits don't count),
  or 10 minutes of sim time have passed since the
  last loss, live or offline (§10 replays the same rules). A lost try sets it
  aside again and restarts the 10 minutes; a win breaks through as usual and
  clears the count. While set aside, the status bar and Mini say "Tribulation
  paused" and Discreet's Status says "Review postponed".
- **Tribulations:** Probation Review, Annual Appraisal, Restructuring, Hostile
  Takeover, Shareholder Revolt, Board Inquiry, Regulatory Probe, Market Crash,
  Heavenly Audit. Each is 8× a demon's HP and 2.5× its damage on the floor it
  is fought on.
- **Older saves:** a save from the seven-realm ladder keeps its level; its realm
  is read from the table above. A Tribulation it had due is renamed for that
  realm. A version 8 save (a cap every 10 levels) or a version 9 or 10 save (caps
  at 10, 22, 36 … 162) moves onto the current realms on load: XP it held at a
  cap that is no longer one buys its levels up to the next cap, a Tribulation
  that is no longer due is dropped (a fresh floor starts if it was the last
  enemy), one that is now due is queued, and HP above the new max is clamped.
  A save before version 11 was also priced on the old XP curve (each level
  1.2× the one before): it is read on that price, then moves onto the cheaper
  one, so the XP it held buys the levels it now pays for (and may carry it onto
  a cap, with that Tribulation queued if the cap's price is held too).
  Realm is worked out from level, so a level can land in another realm: it may
  move up one (levels 21–22) or down (most levels from 37 up), losing that
  realm's +10% HP and damage and its main-stat bonus until it levels back up.

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
  Golem, Reply-All Swarm. Elites and bosses cast skills (§5 Elite and boss
  skills); regular demons don't.

### Qi and skills

Qi is the resource skills will spend. Both sides build it up in combat and
the pure simulation tracks it, so offline play gives the same qi as live play.

- **The cultivator's pool:** 100 max qi, plus 0.5 per point of Spirit for a
  Talisman Master and 0.25 for the other Paths (half the benefit), rounded to
  a whole number. A Talisman Master's realm bonus to Spirit (its primary stat,
  §4) counts.
- **Gaining qi:** +8 per attack, +4 per hit taken (a hit an Illusion Array
  turns aside gives none), and regen once a second, between fights too:
  - a base of 1 qi/s;
  - the Qi regen stat read as a share of max qi (a 4% roll is 4 qi/s at 100
    max qi);
  - 0.02 qi/s per point of Spirit for a Talisman Master, 0.01 for the other
    Paths.
  Never past max qi; a Path change or stat reset that shrinks the pool cuts
  qi down to it.
- **Across fights:** qi carries over between fights on a floor, starts at 0
  on each new floor (and when a floor is played again after a loss), and is
  full when a Tribulation starts, faced early or reached in turn.
- **Enemies:** elites hold up to 60 qi, bosses 100, Tribulations 150, each
  stepping up at 0 (the first Tribulation at 30, §5 Tribulation skills) and
  gaining 10 per attack (one an Illusion Array turns aside too) plus 1 a
  second from when it steps up. Regular demons have no qi.
- **On the strip:** a thin cyan bar under each fighter's HP bar, read by
  screen readers as "Qi 42 / 100". A regular demon's qi row stays reserved
  but empty, so the strip never changes height. The Mini view shows HP bars
  only. The Stats tab shows Max qi and Qi per second.
- **Skill bar:** the cultivator's skills (up to 4, learned order) as icons
  on its side of the strip, beside the qi bar, under the full-width HP bar
  (whose HP text needs the room). Each icon fills as qi builds toward its cost
  and glows once the qi is there and nothing blocks it (the sim may still
  hold a ready skill for its "uses it when" rules: a defensive one waits for
  low HP or a wind-up, a buff isn't cast again while it runs); it flashes
  as its cast lands, and a ring inside it runs down while its buff or shield
  lasts (dodges by count). While the cultivator is stunned or silenced every icon
  greys out under a padlock. Its border shows its level: green when
  learned, azure between, gold at its top level (a 2-level skill goes green
  to gold); a skill that becomes something new (Mountain-Toppling Palm,
  Heavenly Thunder Array) has its own icon. Hover, focus or tap opens a tip
  with the name, "Level 2 / 3", the qi cost and the effect at that level,
  worded from the skill's own numbers; screen readers hear the name, level
  and ready, charging or blocked. Full and Narrow show it; under 720 px tall
  the icons sit on the qi bar's row; under 480 px wide they take the name's
  second line at 18 px; Mini shows HP bars only and Discreet hides the strip.
- **Skills outside the strip:** each follows the current Path and realm at
  once (a breakthrough, a Path change, a Reincarnation).
  - **Stats tab, Skills sub-tab** (between Stats and Respec): each skill
    learned, learned order, with its icon (border by level), name, level pips
    ("Level 2 / 3" for screen readers), qi cost and effect, worded as on the
    skill bar. The name opens its "uses it when" rule as a tip (hover, focus
    or tap), worded with the sim's own numbers. A last line says what the
    next realm brings ("Next realm: Ten Thousand Swords"), or that every
    realm is reached.
  - **Breakthrough banner:** a second line names what the realm brought:
    "New skill: Sword Intent", or an upgrade, "Flying Sword ↑ Two swords"
    (a renamed one names its new name: "Mountain Fist ↑ Mountain-Toppling
    Palm"). The banner is a status, so screen readers announce it; casts are
    not announced.
  - **Path choice:** each Path lists its four skills, icon and name (as first
    learned), under its portrait. **Change Path** in Respec shows the skills
    the picked Path would have at the current realm.
  - **Realm chip list:** each realm names what it brings the current Path, in
    the same words as the banner. Each realm takes three lines (name and
    title, levels, what it brings) in a narrow box.
  - **Help:** a "Qi and skills" entry: qi gain, Qi per second, auto-cast and
    enemy wind-ups, with the sim's own numbers.
  - **Discreet** hides every skill icon on these surfaces; the text stays.

### Skills

The engine that spends qi, shared by the cultivator and enemies. The
simulation casts every skill itself, so offline play casts as live play does.
The Path skills, the elite and boss skills and the Tribulation skills
(below) plug into it.

- **A skill** has a qi cost, an optional cooldown, a kind (damage, defensive
  or other), its effects, and its own "uses it when" rule.
- **Effects:** hits (several hits, a crit that is rolled, always or never,
  and a spill onto the next enemies waiting in the wave, never onto a waiting
  Tribulation), buffs and debuffs with a duration (attack speed, damage,
  defence, crit chance, damage taken, lifesteal), a shield (a share of max HP),
  a heal, a stun, a silence, qi drain or steal, a damage reflect, and "HP
  can't drop below 1". A waiting enemy a spill kills pays out like any kill.
  Skill hits give no qi and no lifesteal. The Path skills added:
  - a hit may deal more to an enemy below a share of its max HP (checked hit
    by hit), add a share of the caster's max HP to each hit (never a crit),
    and give back a share of the skill's qi at its first kill (a spill kill
    counts; clearing the floor still empties qi);
  - a spill with no limit reaches the whole wave (every enemy left on the
    floor, never a waiting Tribulation);
  - a buff may be relative: +100% lifesteal adds the caster's own lifesteal,
    doubling it;
  - a shield may burst: the hit that breaks it (not running out) deals the
    shield's full value to the other side, past its defence, once, at once,
    whatever broke it (an attack, a skill, a reflect or the other side's own
    burst, which can set off a chain);
  - "HP can't drop below 1" may heal a share of max HP as it ends, if the
    fight is still on;
  - an evade turns aside the next normal attacks (after the dodge roll, so
    only hits that would land use one), or the other side's next skill whole,
    which uses them all up (that skill's effects on its caster still land);
    it may answer each with a counter: a crit at the normal hit (a skill
    hit, so it gets the Spirit bonus);
  - a burn deals a share of the normal hit over its duration, a tick a
    second through defence (no crit, qi, lifesteal or reflect). A new burn
    replaces the last one unless burns stack: then each runs its own timer,
    3 at most, a fourth replacing the oldest.
  The Tribulation skills added:
  - a hit may deal more the more of its target's max HP is gone: ×(1 +
    share × the share lost), checked hit by hit;
  - a cut takes a share of the other side's current or max HP a hit, past
    its defence (a shield and damage-taken buffs and debuffs still count; no
    crit, qi or lifesteal; reflect answers it as any skill hit);
  - a purge ends the other side's buffs: its mods that help it (more of a
    stat, or less damage taken), its shield (no burst), reflect, "can't drop
    below 1" and dodges; its debuffs stay. "Dispelled" floats over it. A dodge
    turns a purge aside like any skill;
  - an enemy skill may land as several strikes, paid for once: each strike
    winds up and lands on its own, the next winding up as the last lands; a
    stun cancels the wind-up and the strikes left.
- **Spirit bonus:** every cultivator skill's damage (hits, spills, burns,
  counters and the max-HP part) gains +0.1% per point of Spirit, after the realm bonus, on
  every Path alike (+10% at 100 Spirit). A shield burst is its own value.
- **When a skill is cast:** after every combat event, each side that is not
  already casting picks the costliest skill it may cast now: enough qi, off
  cooldown, not stunned or silenced, its own rule, and four shared rules:
  1. the cultivator holds a cheap skill (not a defensive one) while a bigger
     skill is within 20 qi, against an elite or tougher, but only a bigger
     skill that would be cast once its qi is there: off cooldown, and rules
     2 to 4 and its own rule holding for it now (read as if it had its qi).
     A bigger skill whose rule is false, or held by its running buff, holds
     nothing;
  2. don't spend a damage skill when the next normal hit kills;
  3. defensive skills wait for HP at or below 60%, or the other side winding
     up; a skill may name an urgent case that skips this wait (Vajra Body);
  4. a skill made only of buffs on its caster isn't cast again while one of
     them still works: its own buff not run out, a shield not broken or run
     out, a reflect or "can't drop below 1" running, dodges left. A broken
     shield can be cast again at once, and a skill that also heals or hits
     (Blood Qi Surge) is never held by the buff it gives.
  Ties go to the skill listed first. Nobody casts in the pause before a fight.
  Choices are only made at combat events, so a skill whose cooldown or stun
  ends between them waits for the next one; the qi regen step makes one at
  least every second.
- **A seeded pause** of 0 to 0.8 s comes before every cast; the skill is
  checked again when the pause ends and dropped if it no longer may be cast.
  Randomness is only drawn when a skill is picked, so the same seed always
  plays the same, in one big step or many small ones.
- **Wind-ups:** the cultivator's skills land at once. An enemy pays the qi,
  then winds up for 1 s (a skill may set its own time) before the skill lands.
  A stun cancels a wind-up; the qi stays spent. A silence stops new casts
  but lets a wind-up already under way land. A stunned fighter attacks
  again only once the stun wears off.
- **Cooldowns:** the cultivator's are cut by Agility's cooldown reduction
  (§3), at most 95%; enemies' run in full. Dodge and Iron Body's reflect work
  on skills as on attacks: a dodge turns aside only normal attacks, and Iron
  Body sends back a share of skill hits too, adding to a skill's reflect.
- **Fight end:** buffs, debuffs, shields, burns, dodges, cooldowns and wind-ups end with the
  fight (a kill, a loss, a Tribulation faced early); nothing reaches the next
  one. This skill state is never saved: a save made mid-fight loads with none,
  and an attack a stun or slow had pushed back loads at the normal limit. A
  load keeps when the fight started, read from the array timer (set a second
  after each fight starts): nobody casts in an arrival pause it was saved in,
  and fight-start rules read the right time. Under a Killing Array mid-fight
  that timer tells the last hit, not the start, so the fight is taken to have
  started long ago (never early, a fight-start rule is past).
- **On the strip:** the skill's name floats over its caster as it lands, in
  the tier gold, with the attack pose as the cast pose; an effect's word
  ("Stunned", "Silenced", "Shielded", "Interrupted", "Dispelled") floats over the fighter it
  hit. While an enemy winds up, it yells the skill in a gold speech bubble
  ("Paper-Binding Seal!") at the top of the stage, its right edge on the
  enemy's sprite and its tail pointing down at it, and a gold cast bar fills over its
  qi bar. The bubble wraps to 2 lines at most, so the longest name fits a
  320 px phone whole; it is sized against the stage's zoom so it reads at the
  callouts' full size. Where names and HP are drawn over the stage (short
  screens) it starts just under them, and when it can't fit above the enemy
  it sits on the enemy's left instead, tail pointing right, so it never covers
  the enemy or its name. The name line keeps the enemy's name, so
  the strip never changes height. The cultivator yells too, for its costliest
  skill at its Path and realm (every skill tied for the highest qi cost): a
  speech bubble in the qi cyan, never the enemy's gold, with "Ten Thousand
  Swords!" for about 1 s as it lands, instead of the floating name. It sits at
  the top of the stage with its left edge on the cultivator's sprite and its
  tail pointing down at it, or beside the sprite on its right (tail pointing
  left) when there is no room above, and in either place drops just under the
  enemy's bubble when that one is in the way. It never covers a sprite, the
  enemy's bubble or the names and bars; the enemy's bubble keeps its place, and
  the cultivator's narrows (2 lines at most), moves or, mid-yell, goes. When it
  fits nowhere (both long names on the short 960 x 640 stage), the name floats
  as a callout instead. One at a time: a new yell replaces the last, and a
  fight's end clears it. Reduced motion shows the text in place with
  no rise or pop and the bar with no glide. Discreet hides callouts, bubbles
  and cast bars, and the Mini view leaves callouts and bubbles out. Screen
  readers are not told about each cast.

### Path skills

Each Path has four skills. The first is learned in Qi Condensation, and each
of the nine breakthroughs brings one new skill or an upgrade, so every realm
gives something. None has a cooldown: the qi cost is the limit. Skill damage
is a share of the normal hit (so it follows the Path's main stat), plus the
Spirit bonus (§5 Skills).

| Realm | Sword Cultivator | Body Refiner | Talisman Master |
|---|---|---|---|
| Qi Condensation | Flying Sword (30 qi): one hit at 250%, always a crit | Iron Skin (30 qi): +60% defence for 6 s | Fire Talisman (30 qi): one hit at 220%, then a burn for 50% over 3 s |
| Foundation Establishment | Sword Intent (45 qi): +40% attack speed for 6 s | Mountain Fist (40 qi): one hit at 200%, stuns 1 s | Thunder Talisman (45 qi): 180% to the enemy in front, 90% to the next one waiting |
| Golden Core | Flying Sword: two swords, 2 × 150% (still always crits) | Iron Skin: also reflects 25% of damage taken for 6 s | Spirit Shield (40 qi): a shield worth 20% of max HP for 8 s |
| Nascent Soul | Lightning Step (35 qi): dodges the next 2 hits or the next enemy skill | Blood Qi Surge (55 qi): heals 25% of max HP | Fire Talisman: burns stack (up to 3) |
| Spirit Transformation | Sword Intent: also +15% crit chance | Mountain Fist: stuns 1.5 s, adds 10% of max HP as damage | Sealing Talisman (50 qi): empties the enemy's qi and silences it for 5 s |
| Void Refinement | Ten Thousand Swords (90 qi): 6 × 100%, double on an enemy below 30% HP | Vajra Body (80 qi): HP can't drop below 1 for 4 s, then heals 10% | Thunder Talisman: also hits the 2 enemies after it (90% each) |
| Body Integration | Lightning Step: each dodge answers with a crit | Blood Qi Surge: also doubles lifesteal for 6 s | Spirit Shield: bursts for its full value when it breaks |
| Mahayana | Flying Sword: a kill gives back half its qi | Iron Skin: costs 20 qi | Sealing Talisman: 8 s, and steals the qi |
| Tribulation Transcendence | Ten Thousand Swords: 8 hits | Vajra Body: lasts 6 s | Fire Talisman: costs 20 qi |
| Immortal Ascension | Sword Intent: lasts 10 s, costs 35 qi | Mountain Fist becomes Mountain-Toppling Palm: 300% + 15% of max HP, stuns 1.5 s | Thunder Talisman becomes Heavenly Thunder Array: 200% to the whole wave, the enemy in front included |

**Uses it when** (on top of the shared rules; ties go to the skill learned
first):

- **Flying Sword:** whenever ready; shared rule 1 holds it while Ten Thousand
  Swords is within 20 qi and would be cast (an elite below 30% HP, a boss or
  Tribulation). Rule 1 holds it the same way for a Sword Intent that would be
  cast, never for one whose buff is running or whose rule is false.
- **Sword Intent:** in the first second of a fight against an elite or
  tougher, or while the enemy is above 50% of its max HP.
- **Lightning Step and Iron Skin** (defensive): when the enemy winds up, or
  HP is low: at or below 60% of max HP, the shared threshold. Neither is cast
  again while it still works (rule 4: dodges left, the defence buff or the
  reflect running).
- **Ten Thousand Swords:** against an elite below 30% of its max HP, or a
  boss or Tribulation.
- **Mountain Fist:** to interrupt a wind-up, otherwise when qi is full.
- **Blood Qi Surge** (defensive): HP below 40%.
- **Vajra Body** (defensive): the enemy's next normal hit (after defence)
  would take HP below 20% (urgent: even from above 60% HP, against a
  one-shot), or a boss or Tribulation winds up.
- **Fire Talisman:** when the enemy isn't already burning; once burns stack
  (Nascent Soul), whenever ready.
- **Thunder Talisman:** two or more enemies its spill can reach (the one in
  front and those waiting on the floor; a Tribulation waiting at the end
  doesn't count), or a boss or Tribulation.
- **Spirit Shield** (defensive): HP at or below 60%, or a wind-up; again as
  soon as the last shield broke or ran out.
- **Sealing Talisman:** an elite or tougher with qi above 70% of its own max.

Skills follow the current Path and realm: they are worked out from them at
every combat event and never saved. A Path change or a Reincarnation (level
1, Qi Condensation) has the right skills at once, and an older save loads
with the skills for its Path and realm. A skill's name floats over the
cultivator as it lands (§5 Skills), in the player's language; its costliest
one is yelled in a cyan bubble instead.

### Elite and boss skills

An elite has one skill, from the demon it is a variant of; a boss has two;
regular demons have none. Every one winds up first (1 s unless listed), so
the cultivator's defensive and stun skills can answer it. Enemy skill damage
is a share of the enemy's normal hit, through the cultivator's defence; it
never crits.

| Enemy | Skill | Qi | Cooldown | Effect | Uses it when |
|---|---|---|---|---|---|
| Elite Deadline Fiend | Deadline Frenzy Art | 40 | — | +50% attack speed for 5 s | whenever ready, not while it runs |
| Elite Inbox Hydra | Ten Thousand Unread Scrolls | 40 | — | 3 hits at 60% | whenever ready |
| Elite Meeting Wraith | Endless Meeting Domain | 40 | 10 s | the cultivator attacks 30% slower for 5 s | whenever ready |
| Elite Printer Golem | Paper-Binding Seal | 45 | 8 s | stuns the cultivator 1.5 s | whenever ready |
| Elite Reply-All Swarm | Thousand Echo Reply Array | 40 | — | 5 hits at 30%, one more each cast that fight | whenever ready |
| Quarterly Review | Quarterly Judgement Palm | 60 | — | one hit at 250%, 2.5 s wind-up | whenever ready |
| Quarterly Review | Meridian-Sealing Review | 40 | 12 s | the cultivator's damage −25% for 6 s | whenever ready |
| The Auditor | Qi Confiscation Palm | 50 | — | takes 50 of the cultivator's qi, then a hit at 100% | the cultivator holds 25 qi or more |
| The Auditor | Golden Ledger Body (defensive) | 40 | 10 s | takes 50% less damage for 5 s | HP at or below 60% (rule 3), not while it runs |
| Middle Manager | Burden-Shifting Mirror | 40 | 10 s | reflects 30% of damage taken for 5 s | whenever ready, not while it runs |
| Middle Manager | Heavenly Oversight Seal | 50 | 12 s | silences the cultivator (no skills) for 4 s | the cultivator's qi at 90% of its max or more |

- **Picking:** the shared rules apply (§5 Skills): the costliest skill it may
  cast, a damage skill held when its next normal hit kills, Golden Ledger Body
  waiting for low HP. A debuff's cooldown outlasts it, so it is never cast
  over one still running.
- **Thousand Echo Reply Array** counts every cast from its wind-up, an
  interrupted one too; the count starts again each fight.
- **Balance:** the Path balance test (§3) plays with these skills on; the
  floor ratios across Paths are 1.127 at 10 min and 1.112 at 60 min, so no
  numbers moved.
- **Names** are yelled in the wind-up bubble and float as the skill lands, in
  the player's language (EN and VI) (§5 Skills). Every one, EN and VI, fits
  the bubble whole within 2 lines at 320 px, 375 px, 479 px, 960 x 640 and
  1280 px.

### Tribulation skills

Each Tribulation has one signature skill, and every Tribulation gains
Heavenly Lightning below 50% of its max HP. Lightning is listed first, so it
wins a tie with a signature skill of the same cost; at 30 qi it comes before
any costlier one. Like the elite and boss skills,
each winds up first (1 s unless listed), deals a share of the Tribulation's
normal hit through the cultivator's defence unless listed, never crits, and
follows the shared rules (§5 Skills): the costliest it may cast, a damage
skill held when its next normal hit kills.

| Tribulation | Skill | Qi | Cooldown | Effect | Uses it when |
|---|---|---|---|---|---|
| Probation Review | Final Warning | 30 | — | one hit at 100%, ×(1 + the share of max HP the cultivator has lost): 150% at half HP | whenever ready |
| Annual Appraisal | Bell Curve | 30 | — | damage equal to 20% of the cultivator's current HP, past defence | whenever ready |
| Restructuring | Redundancy | 40 | 20 s | removes the cultivator's active buffs (a purge) | the cultivator has a buff |
| Hostile Takeover | Asset Seizure | 30 | 20 s | steals up to 40 of the cultivator's qi | the cultivator holds 30 qi or more |
| Shareholder Revolt | Vote of No Confidence | 40 | 20 s | silences the cultivator (no skills) for 2 s | whenever ready |
| Board Inquiry | Under Investigation | 40 | 20 s | burns for 100% over 5 s | whenever ready |
| Regulatory Probe | Compliance Freeze | 40 | 20 s | stuns the cultivator for 1.5 s | whenever ready |
| Market Crash | Freefall | 60 | 30 s | 3 hits, each 10% of the cultivator's max HP, past defence | whenever ready |
| Heavenly Audit | Final Judgement | 60 | 30 s | one hit at 400%, 3 s wind-up | whenever ready |
| Every Tribulation | Heavenly Lightning | 30 | 30 s | 3 strikes, each 10% of the cultivator's max HP past defence and after its own 3 s wind-up; a stun cancels the rest | below 50% of its max HP |

- **Starting:** a Tribulation steps up at full HP and 0 qi like any enemy,
  faced early or reached in turn; the cultivator starts it at full HP and qi
  (§5 Qi and skills). Probation Review alone steps up with 30 qi, enough for
  Final Warning: a cultivator at the level 10 cap wins that fight in about 2
  to 13 s, before the qi would build up, so without it most players never
  saw the skill. Heavenly Lightning still never comes at the start (it waits
  for half HP).
- **On the strip:** each Heavenly Lightning strike yells its name in the
  wind-up bubble and flashes the whole stage once, pale gold, as it lands
  (drawn in code, at most one flash every 3 s). Reduced motion, Discreet and
  the Mini view show no flash.
- **Balance:** three tests per Path, each played with every skill cast and
  again with the Tribulations casting nothing:
  - *Tribulations 1–3:* the reference run (§3), 16 seeds, through the first
    three (the ones a run reaches in four hours). Every seed breaks through
    all three, and the skills cost under 30% more time. Measured: Sword
    1.04×, Body 1.11×, Talisman Master 1.14× (59.8, 145.1 and 76.3 min
    against 57.6, 130.3 and 66.9).
  - *Tribulations 4–9:* past what a test-length run reaches, so each starts
    from a reference cultivator built at its realm cap: set to the cap (stat
    points by its plan), it climbs from floor 1 keeping every upgrade until 30
    min pass with no new highest floor, its XP held below the Tribulation's
    price (a run farms where it is stuck); then the Tribulation falls due on
    that floor. The run plays on to the breakthrough, losses, retries and
    farming included, 8 seeds each. Every seed breaks through each one within
    10 hours, and the skills cost under 50% more time from due to
    breakthrough. Measured: Sword 1.13×, Body 1.18×, Talisman Master 1.00×
    (4.9, 29.7 and 7.9 min a Tribulation, against 4.3, 25.3 and 7.9).
    Before these numbers: 1.42×, 2.85× and 2.57×.
  - *Final Warning:* Probation Review winds up Final Warning in at least 75%
    of a fresh reference run's first fight against it. Measured: 16 of 16
    on every Path (before the opening qi: 0, 11 and 0 of 16).
- **Why these numbers:** Heavenly Lightning was 3 strikes at 150% of the
  Tribulation's hit, through defence, so it took the most from the Path with
  the least HP: the Talisman Master needed 1.22× the time on Tribulations
  1–3 and 2.57× on 4–9. A share of max HP past defence takes the same share
  from every Path. The signature skills that act every 10 to 15 s cost most
  in the Body Refiner's long fights (2 to 9 min at the realm caps), so their
  cooldowns are 20 or 30 s and their effects smaller.
- **The Talisman Master's gap:** on Tribulations 1–3 it still pays a little
  more than the others (64 seeds: 1.08× against Sword 1.00× and Body 0.95×,
  about 5 min in all; one standard error is about 0.03). It has no stun to
  cancel a Lightning wind-up and no lifesteal to win back the HP, and at the
  level 10 cap it reaches Probation Review hurt, so Final Warning wins about
  1 first fight in 3 for the Tribulation (none before; a loss costs nothing
  but the floor played again, §4). On Tribulations 4–9 its extra time (about
  1 min a Tribulation, at 16 seeds and a 60 min stall) is within the
  Sword's and the Body Refiner's (0.4 and 2.3 min).
- **The Path balance test (§3)** still keeps every Path within 15%: 1.128
  at 10 min and 1.127 at 60 min.
- **Names** are yelled and float in the player's language (EN and VI), and
  fit the bubble as the elite and boss skills do.

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
  +max HP, +defence, +qi regen, +spirit stone find, +treasure find. Qi regen
  rolls +2–6% and is read as that share of max qi each second (§5 Qi and
  skills), so an item shows it as "+4% of max qi per second" and the Stats
  tab shows Qi per second.
- **Quality %:** the unweighted average of the item's base roll and its affix
  rolls, each a whole 0–100% within its range, rounded down; the Immortal
  unique effect is not a roll and is left out. It ignores grade, item level and
  the number of affixes (a Mortal item with only its base roll easily reads
  90%+), so it is not a measure of power. Crafting changes it: a refine raises
  the base roll and a reroll replaces an affix roll (§7). It is shown on its
  own labeled line ("Quality 94%" / "Chất lượng 94%") under the tag in the
  details panel and the Crafting panel, and in the drop toast; not in
  the tag (grade · type · Lv), the cell's screen-reader label or on the grid
  cell. The bag can still be sorted by it.
- **Refine level:** how many times an item has been refined (§7), 0 to 100,
  0 on every drop. It is the item's headline progress marker: " +7" after its
  name (details panel, Crafting panel, the cell's screen-reader label) and
  "+7" in the top-right corner of its bag or equipment cell; nothing shows at
  +0. It is display only. The bag can be sorted by it (highest first, quality
  breaking ties).
- **Gear badge:** a bag cell shows a badge in its bottom-right corner, worked
  out from the same comparison the details panel shows (stat changes that
  round to nothing are ignored). Per position the item fits: gains and no
  losses is an upgrade, losses and no gains a downgrade, both is mixed, and
  no change is nothing. A Formation Disc of the same array type counts its
  array as a gain when stronger and a loss when weaker; a different array type
  is one gain and one loss, so mixed. Over the positions it fits (two for
  accessories and charms), in order:
  1. A green ▲ (the gain colour) when a position is empty or it is an upgrade
     in at least one.
  2. A red ▼ (the loss colour) when it is a downgrade in every position.
  3. A gold dash when any position changes at all (mixed, or a downgrade in
     one and no change in the other).
  4. Otherwise nothing.

  Equipped items and items the cultivator can't equip yet (below the realm
  they require) get no badge. Soul Banner souls are not counted. The shape is
  the cue, not the colour alone: "upgrade", "downgrade" or "mixed" ("nâng
  cấp", "hạ cấp", "được mất") is added to the cell's accessible name when a
  badge shows.

## 7. Sell, salvage and filter

- Unwanted items **sell** for Spirit Stones or **salvage** into **Spirit
  Essence**, the crafting material. Both pay by grade and item level.
- **Bulk sell:** "sell everything below grade X", after a confirmation that
  names how many items go and the highest grade among them. Refined items
  (+1 or higher, §7 Crafting) are never bulk sold: the count, highest grade
  and price leave them out, and the confirmation says they are kept. They can
  still be sold or salvaged one at a time. (The auto filter is unaffected:
  every drop is +0.)
- **Bulk salvage:** "salvage everything below grade X", the same way: the bag
  tools share one grade picker between **Sell…** and **Salvage…**, and the
  confirmation names how many items go, the highest grade among them and the
  Spirit Essence gained. It takes exactly the items bulk sell would (never
  refined or equipped ones). With nothing below the grade the confirmation
  says so and offers only OK; cancelling, or nothing to take, changes nothing.
  Both bulk actions take only the bag the confirmation showed: drops that land
  while it is open are left alone, and if the shown part changes (an item sold
  or equipped from it) the open confirmation updates to the new numbers before
  anything is taken. Near a currency's cap the payout is clamped like every
  earning.
- **Bulk select:** a **Select** switch above the bag grid turns select mode
  on. While it is on, clicking, tapping or pressing Enter / Space on a cell
  ticks or unticks it instead of opening its card (no drag or double-click
  equip). A ticked cell shows a check mark as well as the selection ring, and
  reads as pressed to screen readers. The grade row gives way to a bar that
  names how many are ticked and what selling them would pay in Spirit Stones
  or salvaging them in Spirit Essence, with **Sell selected…**, **Salvage
  selected…**, **Select all on page** and **Clear**. Any item in the bag can be
  ticked, whatever its grade; refined ones too, and the confirmation names
  how many refined items it includes (worn items are not in the bag, so they
  can never be ticked). The confirmation names the count, the highest grade and
  the payout, and takes only the ticked items from the bag it showed, like the
  grade-based actions: drops landing meanwhile are never ticked or taken, and
  if the shown part of the bag changes the ticks are dropped, nothing is
  taken and an open confirmation says so (OK only). Turning Select off, Esc
  anywhere in the Bag (it closes an open confirmation first) or switching away
  from the Bag tab ends select mode and clears the ticks.
- **Colours:** every sell control (the details panel's Sell, bulk Sell…, Sell selected… and
  its confirm) wears the Spirit Stones colour (`--sell`, cyan like the stone
  icon); every salvage control (Salvage, bulk Salvage…, Salvage selected… and its confirm) wears
  the Spirit Essence colour (`--salvage`, orange like the essence drop); the
  details panel's Craft button wears violet (`--craft`, a hue no grade uses).
  All three are theme tokens with light and dark values that pass 4.5:1 on every
  surface, and the labels still name the action, so colour is never the only
  cue.
- **Grade colours:** the bulk grade picker wears the chosen grade's colour
  (the same `--grade-*` tokens as bag cells; each option too where the
  browser allows), and the confirmation's highest grade name wears its own.
  The auto filter's minimum grade wears its grade colour too, and its sell /
  salvage choice wears `--sell` / `--salvage`. Every
  one passes 4.5:1 on the picker's and the confirmation's background in both
  themes, and the name or label is still there as text.
- **Auto filter:** a minimum grade ("keep Earth and above") plus the item types
  to keep. Drops that fail are sold or salvaged on pickup, as the player
  chooses. The filter starts off: everything is kept.
- **Full bag:** a drop that doesn't fit is sold, never lost.
- Equipped items are never sold or salvaged.

### Crafting

The details panel's **Craft** button opens the Crafting panel for the
selected item, in the bag or equipped (Mortal items too). It is a modal with
one tab per mode, Refine and Reroll; it stays open between crafts, and the
last mode used is kept for the visit. Both modes cost Spirit Essence and roll
from the game's seeded stream (`state.rng`), like every other roll.

- **Refine** adds +1 to +10 points to the base roll (a Formation Disc's array
  strength), capped at 100% of its range; it never goes down. Small gains are
  likelier, and more so as the roll climbs: the weight of each gain is
  `LOW × (100 − p) + HIGH × p` at a base roll of `p`%, summing to 10 000.

  | Gain | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 | +10 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | LOW (at 0%) | 25 | 20 | 15 | 10 | 8 | 7 | 5 | 4 | 3 | 3 |
  | HIGH (at 100%) | 50 | 25 | 12 | 5 | 3 | 2 | 1 | 1 | 1 | 0 |

  The average gain is +3.56 at 0%, +2.81 at 50% and +2.22 at 90%: about 37
  refines take an item from 0% to 100%. Each refine raises the refine level
  by 1 (§6). The panel shows the reachable range before paying ("Base roll
  62% → 63–72%", "Damage: 11.7 → 11.8–12.3"); at 100% it reads "Fully
  refined" and is off.
- **Reroll** replaces one affix the player picks with a new affix and roll,
  drawn with the item's favoured weights as on a drop. It never draws one of
  the item's other affixes, so there are still no repeats; it may land on the
  same affix with a new roll. It asks first, naming the affix and its value.
  Items with no affixes (Mortal) have nothing to reroll.
- **Costs:** refine 2 × and reroll 3 × the item's salvage value, so they scale
  by grade and item level (a Heaven Lv 40 item salvages for 480 and refines for
  960). The cost is flat per attempt. Without enough Essence the action is off
  and says how much more is needed.
- Never changed: the grade, item level, the number of affixes, an Immortal
  unique or a disc's array type. Equipped items can be crafted but still not
  sold or salvaged.
- After each craft the panel shows the result, before → after ("Base roll
  62% → 69%", "+0.7% Crit chance → +11% Spirit stone find"), and the bag
  badges, quality and comparisons update at once.

## 8. Currencies

| Currency | Source | Spent on |
|---|---|---|
| Spirit Stones | Kills and selling | Path change, stat reset, inventory space, the Store |
| Spirit Essence | Salvage | Crafting (§7): refining the base roll, rerolling one affix |
| Dao Insight | Reincarnation | Permanent passives (§9) |

- **Path change** gives every stat point above the base back unspent; its
  cost is unchanged. The new Path's Auto-assign plan applies from then on.
- **Stat reset** takes back every point above the base to spend by hand.
- **Stats were rebalanced:** a save from before the rebalance keeps its points
  where they were and, on its first load (if any point is spent), shows a
  one-time notice over the game offering one free stat reset. Taking it or
  keeping the stats closes it for good; a paid reset or a Path change uses
  it up too.
- **Inventory space** adds a row of 8 cells, each row dearer, up to 80 (on a
  second inventory page).

### Store

The Inventory panel's **Store** tab (Bag | Auto filter | Store) sells gear
chests and timed boosts for Spirit Stones, from a rotating stock.

- **Stock:** 4 different offers from the catalog below, rolled from the
  game's seeded stream (`state.rng`). The stock rotates every 30 minutes of
  sim time, so Overtime Cultivation rotates it too; the tab counts down to the
  next rotation. Each offer sells once per rotation, then reads "Sold out".
  **Refresh now** rolls a new stock early for 50 × cultivator level; the
  rotation clock is unchanged. The new stock is rolled outside the combat tick
  (the first time it is asked for after a rotation is due), so the fight draws
  the same numbers whether or not the store is ever opened.
- **Gear chests** put one item of the current floor's item level straight in
  the bag, of the chest's grade or better: the grade is rolled with the drop
  weights (§6) with every lower grade left out. The auto filter never sees it
  (the player paid for it); it shows in Recent drops and the toast like a drop.
  A full bag turns Buy off ("Bag full").

  | Chest | Grade or better | Price |
  |---|---|---|
  | Spirit Chest | Spirit | 3 × Spirit sell value × floor (15 × floor) |
  | Earth Chest | Earth | 45 × floor |
  | Heaven Chest | Heaven | 120 × floor |

  There is no Immortal chest: Immortal stays a lucky roll inside a Heaven chest.
- **Timed boosts** run on sim time and stack: each purchase adds 10 minutes, up
  to 60 minutes left (Buy turns off at the cap, "At the 1 h cap"). They act at
  each kill, next to the passives (§9).

  | Boost | Effect | Price |
  |---|---|---|
  | Focus Tea | +50% XP from kills | 20 × level |
  | Lucky Charm | +50% treasure find | 30 × level |
  | Bonus Envelope | +50% spirit stone find | 20 × level |

  Bonuses add to the passives': Focus Tea adds 50% of a kill's base XP
  beside Seniority's ranks. The boosts' summary chips sit on their own row
  under Spirit Stones and Spirit Essence: three fixed columns, kept even while
  no boost runs, so a boost starting never grows the chips or moves the
  panels. Running boosts fill it from the left in catalog order (Focus Tea,
  Lucky Charm, Bonus Envelope); the columns after them stay empty. A chip
  shows its icon, bonus and a short word ("+50% XP", "+50% drops", "+50%
  stones"; Vietnamese "KN", "vật phẩm", "Linh Thạch"), with a `--sell` edge;
  on a row under 30rem (a phone) the word goes and only "+50%" shows. A hover,
  focus or tap opens the whole line with the time left ("Focus Tea (+50% XP):
  9 min left"), which is also what screen readers hear. The Stats tab also lists
  the boosts running, with the time each has left, and its Find rows include
  a running Lucky Charm or Bonus Envelope.
- **Colours:** Buy and Refresh now wear `--sell`; a chest's name wears its
  grade colour; the price is in the button's words, so colour is never the
  only cue. Without enough stones the button is off and says how many more are
  needed.
- **Icons:** one per offer from the store atlas (§14).

## 9. Prestige: Reincarnation

Reincarnate to restart at floor 1, level 1, keeping Dao Insight (earned from the
highest floor reached). Insight buys permanent passives: more XP, more
treasure find, a higher offline cap, more starting stat points.

- **Insight paid:** highest floor² / 50, rounded down; nothing below floor 10,
  where the Reincarnate button stays off (floor 10 pays 2, 20 pays 8, 50 pays 50).
- **Kept:** Dao Insight, passives, the Path and the auto filter. **Lost:**
  level, floors, every item (bag and equipped), Spirit Stones, Spirit Essence,
  bought bag slots, running boosts and the store's stock (§8).
- **Confirmation** lists what is kept and lost before the run ends; the new
  run is saved at once.
- **Passives** (any time, apply at once; each rank costs twice the last):

| Passive | Per rank | First rank | Max rank |
|---|---|---|---|
| Seniority | +10% XP from kills | 2 | 20 |
| Expense Account | +5% treasure find | 2 | 20 |
| Flexible Hours | +1 h Overtime Cultivation cap | 3 | 8 |
| Head Start | +2 stat points (unspent), this run and every run after | 3 | 20 |

## 10. Offline and background play

- **Time-based, not tick-based.** Progress is worked out from elapsed real
  time, because browsers throttle background tabs.
- **Overtime Cultivation:** on return, the game replays the time away (capped
  at 8 hours, more with Flexible Hours, §9) and shows a summary: floors
  cleared, levels, drops kept, sold and salvaged, the currencies earned and
  any store boosts that ran out while away (§8), as one wrapping row of
  labelled chips over the game. While it shows, the strip stays under it
  (it rises into the title bar only with nothing above it).
  Offline means the browser or the game's tab was closed. The replay plays
  the same as an open tab, except items drop at half the online rate (§6), so
  playing is the better way to find loot and catch-up is mostly for floors and
  XP. The summary says that drops are reduced while away. A tab left open in
  the background is online and keeps the online rate.
- **Tab as HUD:** the tab title shows status (e.g. `F12 · 3 drops`); the
  favicon can show an HP ring or flash on a Heaven-grade drop or better.
- **Pop-out window:** where supported (Document Picture-in-Picture), the Mini
  or Discreet view (§14) pops out into a small always-on-top window. Pop out
  opens a short list of the two; the last pick is ticked next time, and kept
  as a display preference (Reset progress keeps it). While one is open the
  button closes it. Not offered when the page is embedded in a frame (the
  itch.io build): the API refuses there.
- **Notification:** optional browser notification on an Immortal-grade drop
  and when a Tribulation falls due (§4). None is sent while Discreet mode
  (§14) is on, as each names the game.
- **Discreet mode** (§14): the tab title is a fixed `Q3_Budget_Review` (no
  floor, drop count or game name) and the favicon a plain sheet icon, with no
  HP ring and no flash.

## 11. Save

Saved to browser storage, validated on load against an allow-list; a bad
save starts a new run instead of crashing. The save is versioned JSON, written
on every autosave, and is always the copy the game plays from.

- **Version 8** adds an item's refine level (`refines`, §6): a whole number
  from 1 to 100, left out on an item never refined (0 loads as none). It can't
  exceed the item's base roll in points (each refine adds at least one point),
  so an item at 37% holds at most 37 refines. Anything else (negative,
  fractional, above 100 or the base roll, text, huge) is rejected, and so is
  the field in an older save. Saves from v1 to v7 load with no refine
  levels; an older build refuses a v8 save rather than drop the field, and
  moves onto the newer release instead (Updates, below).

- **Version 9** has the longer realms (§4): a cap at 10, 22, 36 … 162 instead
  of every 10 levels up to 90, so XP is held only at those levels.
- **Version 11** has the caps on multiples of 10 (§4): 10, 20, 40, 60, 80, 110,
  140, 170, 210, and the cheaper XP curve of 50 × 1.15^(level − 1) per level
  (it was 1.2 before). Version 8, 9 and 10 saves are moved onto both on load,
  held XP buying the levels it now pays for (§4, older saves).
- **Version 13** adds qi (§5): the cultivator's (0 to its max qi), each
  enemy's (0 to its kind's pool, so a demon's is always 0) and the next qi
  regen step (`qiNextAt`, at most a second off). Older saves load with no qi
  and the next step a second away; the fields in an older save are rejected.
- **Version 14** adds the Tribulation retry record (§4): the Auto-Tribulation
  switch, the loss count, the last loss's sim time and the damage and max HP
  at it. (There is no version 12.)
  Each field is allow-listed (a boolean; whole counts; a time no later than
  the save's clock; finite, non-negative strength within the safe-integer
  range; exact keys, so `__proto__` and the like are refused). Unlike the
  rest of the save, a bad or missing record does not reject the save: it
  falls back to the defaults, switch on and no losses, which at worst puts
  the Tribulation back on the floor. Older saves load with those defaults; a
  Tribulation already due stays due. A held floor may now be saved with its
  Tribulation off it (set aside, or the switch off).
- **Version 15** has the stat rebalance (§3): `statPlan` (the Auto-assign
  switch and each Path's ratio and rounding carry) and `freeReset` (the
  one-time free reset is on offer). A plan that breaks the rules (a ratio not
  of whole numbers 0–100 adding to 100, a carry the round robin can't reach,
  stray or prototype keys) falls back to that Path's default instead of
  refusing the save. Older saves load with Auto-assign off, their points where
  they were, HP cut to the new max, and the free reset on offer if any point
  is spent. Version 12 was kept for the rebalance and never written.

### Updates

Releases land on top of the session being played; a tab left open for days
never has to settle a version conflict.

- **A save from a newer release.** A save whose outer shape is a save's
  (`v`, `savedAt`, `state`) with a version above this build's (up to 1000) is
  newer, not damaged. Anything else that fails the allow-list is damaged and is
  handled as before ("That cloud save can't be read."). Wherever the game meets
  a newer save (the cloud check, a refused upload, a link from the Path choice
  or the Menu, an import, the local save or its backup at start, another tab
  taking the cloud's save or saving from a newer release) it keeps this device's progress, saved locally as it
  is now, and moves onto the latest release by reloading the page. The newer
  release upgrades older saves as usual, so Overtime Cultivation and progress
  carry on.
- **Carrying on.** The interrupted action finishes after the reload: a link
  keeps its sign-in and the cloud save it joined (as when the page closes
  mid-choice), so it completes with no new link code, loading the cloud save
  or asking which to keep; a sync settles as usual; an imported code is kept
  for this tab (session storage) and asked about again, with the player's yes,
  in the run the reload resumes (never a later one). The kept code goes through
  the import allow-list again and is removed as it is read. Only the GitHub
  Pages build keeps one: on itch.io a tab's session storage is shared with every
  other game there, so the itch.io build neither keeps nor reads it, and the
  player pastes the code again after reloading.
- **Nothing is lost.** An older build never writes over, merges into or
  discards a newer save: the sync stops uploading and loading (status "Paused
  until the page runs the new version of the game."), a newer local save
  starts no run, since its autosave would write over it, and a run saved since
  the last write is saved again just before the reload; if that save is
  refused (storage full), the reload waits. One exception: the itch.io build
  running without its frame, on itch.io's shared storage, where any other game
  could plant a "newer" save to lock the game out, plays a readable save of its
  own instead, at start and when another tab writes one mid-run (that storage
  never overrides the frame's, as before).
- **A new release while playing.** The GitHub Pages build names its build (the
  commit) and ships `version.json` with it. While the tab is in front it asks
  for that file every 15 minutes, and when the tab is looked at again after a
  while; fetched fresh, without credentials, at most 200 characters, and read
  through an allow-list (one key, a lowercase hex id). A different build means a
  new release is out. Build ids can't be ordered, so a rollback (or a stale
  cache serving an older file) also counts; it costs at most one reload, then
  the fallback (No loops, below).
- **A safe moment.** The reload waits until no choice is open (the bag, retire,
  reroll, reset and import confirmations, the cloud save's choice) and the run
  is saved just before it; with no run (the Path choice) it goes at once. The
  page says "Moving to the new version of the game…" meanwhile.
- **Fallback.** Where the game can't move itself onto the latest release, it
  says "A new version is out. Reload the page to keep syncing." (or "…to keep
  playing." with no run). The game stays playable, except where the local save
  itself is newer: no run starts over it until the reload. The itch.io build is
  one upload per release, so it never reloads itself and never polls; it shows
  the fallback when it meets a newer save, including one its storage frame
  (always the newest GitHub Pages build when loaded) reports.
- **No loops.** Before reloading, the page notes in session storage the build
  it is leaving. If the reload brings back that same build (a cached or blocked
  update), it shows the fallback instead of reloading again. Where session
  storage is blocked, it never reloads itself and shows the fallback.

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
  **Import** (a code from a newer release moves the game onto it first, see
  Updates): the game shows the code's realm, level, floor and last-played
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
  valid 15 minutes, links one device); the other device enters it and joins the
  same save. Letter case, spaces, dashes and look-alikes (O/0, I/L/1) don't matter.
  If the link fails on that device (the reply was lost, or it can't read the
  save), the same device can retry the same code until it expires; no other
  device can use it.
- **Server is storage only.** One text save per player with a revision number,
  and size and shape checks (at most 200,000 characters, a JSON object). Each
  player reads and writes only their own save, through a handful of database
  functions; the tables themselves are closed to the browser. The simulation
  runs on the client, so the server cannot stop tampering and does not try.
- **Allow-list on the way back.** Everything downloaded goes through the same
  load check as a local save (§11 above), plus checks on the reply's shape.
  A rejected cloud save never replaces the local one: the player is told, the
  local save is kept, and the cloud save is overwritten only if the player
  asks ("Overwrite cloud with this device's save"). A save from a newer
  release is not rejected: sync pauses and the game updates (Updates, above).
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
  asks again next time. The hint under the link field says so: "If both saves
  have progress, you pick one to keep. The other is replaced."
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
  own writes (taking the cloud's save) come back as messages. The frame may
  run a newer release than the game (GitHub Pages deploys every change, itch.io
  only tagged releases): its "update" status, and a conflict over a save the
  game can't read but is newer, reach the game as "update" and it shows the
  fallback (Updates, above). An autosave
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
  Refusing the frames when our page has an opener (`top.opener`) doesn't help
  (#154): the attacker opens a blank popup, sets its `opener` to null and only
  then loads our page in it, keeping its handle, so the frames see no opener.
  Only a Cross-Origin-Opener-Policy from itch.io would close this, and the
  check would cost players opened from another site their cloud save.
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
- **Status bar:** at its left a live line saying what the cultivator is
  doing, then "Ready" and the one sheet tab. The live line shows the first
  that applies: fighting a Tribulation ("Facing Tribulation"), one set
  aside ("Tribulation paused", §4), one due ("Tribulation due"), the floor's
  boss ("Fighting floor 12 boss"), an elite
  ("Fighting an elite · floor 12"), else "Cultivating · floor 12". It follows
  the game every frame and the language on a switch, and is not a live
  region, so screen readers do not announce each change.
  At its right end, the game's version ("v0.6.2", read as "Version 0.6.2");
  on hover or keyboard focus a tip names the build (its commit, or "Local
  build") and when it was made, in UTC. Every PR to `main` raises the
  version (CI refuses one that doesn't; Dependabot's PRs are let through and
  keep the number), so each live build shows a new number.
- **Title stamp:** the game's name sits in the title bar as a red rubber
  stamp (like "CONFIDENTIAL"): capitals, double border, tilted, in the
  Immortal grade colour. It is the one loud mark on the dull shell.
- **Generic, never a copy.** No real software names, logos, icons, ribbon
  layouts or colour schemes that identify a real product. It should read as
  "office software", not as any one product.
- The summary is a column of one-line chips ("Label value") beside Recent
  drops: Path and Realm a row each, Spirit Stones and Spirit Essence side by
  side, then the boosts. The Realm chip names the realm alone; its job title
  is in its list. Every chip opens with a small icon (decorative, hidden from
  screen readers): the Path's first skill, the realm's icon (it changes at
  each breakthrough), Spirit Stones and Spirit Essence. Where the column is
  narrow (under 22rem: the 960 × 640 itch.io frame, and phones) the icon stands in
  for the label, which screen readers still hear, and hovering, focusing or
  tapping Path, Spirit Stones or Spirit Essence opens the whole line ("Spirit
  Stones: 340"). Discreet mode hides the icons, so it keeps the labels and
  gives each chip its own row. Hovering or focusing the Realm chip lists the
  realm before, the current one and the one after (three at either end), each
  with its job title and levels ("Lv 11–20 · +1% main stat"; Immortal
  Ascension "Lv 211+ · +31.5% main stat"), the current one highlighted; it
  closes when the pointer and focus leave, or on Escape. A tap opens it on a
  touch screen; tapping elsewhere closes it.
  Level and XP to the next level are a yellow progress bar along the foot of
  the combat strip ("Lv 14" at its left end, "37 / 60" inside; full with
  "Tribulation due" when one is due). The strip header shows floor, best
  floor, wave and kills ("Floor 12 (best 15) · Wave 2 / 3 · Kills 340").
- **Inventory is a grid**, as loot games do it: a fixed grid of bag cells
  (empty ones shown), each item cell marked by grade colour and grade initial.
  A page holds the starting 40 cells; bought cells go on page 2, reached with
  the Previous / Next pager under the grid (hidden, space kept, while the bag
  has one page), so buying slots never grows the panel. A short last page is
  padded to full size. Arrow keys stay on the shown page; turning the page
  clears a bag selection left on the other one. A new run (after
  Reincarnation) opens on page 1.
  Cells show no quality %. A cell's corners: the grade initial top-left, the
  refine level ("+7", hidden at +0) top-right, and a ▲, ▼ or gold dash
  bottom-right marking an upgrade, downgrade or mixed change (§6). The refine
  level sits inside the border with a transparent background. Both top
  labels (the grade initial and the refine level) are 7 px, the icon stays
  centred, and either may overlap the icon's top corner by a pixel or so; a
  thin halo in the cell's background colour keeps the refine level readable
  over the art. The badge has a small backing and may touch the icon's
  corner. Equipment cells show the grade and refine level the same
  way. Selecting a cell opens
  its item card (the details): Sell, Salvage and the Craft button (§7) on a
  row at its top, then blocks for the item (name with its refine level, the
  tag, labeled quality, with that position's Equip button) and its
  attributes. Beside them, for a bag item, a block per position it fits (both
  of a pair): the item worn there with its attributes, or that the position
  is empty, then the gains / losses equipping this one brings. The attributes are
  grouped by what they do, each group on a pill naming it in its colour:
  Offence (`--offence`, rose: damage, crit, attack speed, the Killing
  Array), Defence (`--defence`, indigo: HP, defence, lifesteal, the Binding
  and Illusion Arrays) and Utility (`--utility`, lime: qi regen, stone and
  treasure find). Each position's gains and losses are grouped the same
  way, on the same pills; a gain is green and a loss red.
  Equip by dragging the item onto the character panel (onto one of a pair to
  choose it; anywhere else picks its default position), by double-click, or
  with the panel's Equip button (touch and keyboard use the button).
- In the Full view the character and inventory panels keep fixed widths and
  one shared height whatever tab is open; a taller tab scrolls inside its
  panel. The item card floats over them beside its cell, never over it: on
  the right when 480 px fit there (320 px for a worn item, one column), else
  on the roomier side, narrowed; level with the cell, kept inside the window.
  The item and the worn items sit side by side when the card is at least
  26rem wide, one over the other otherwise. In a window under 940 px wide,
  or with under 272 px either side, it is a sheet along the bottom (at most
  60% of the height), and the page scrolls so the sheet never covers the
  cell. Its Sell, Salvage and Craft row sits at its top, over the item, in
  three equal columns (Craft always the last, even alone on a worn item; a
  long label wraps between words inside its button), and only the item's
  lines scroll, so the buttons never move under the pointer.
- The card closes with Esc (from the card or its cell; focus goes back to
  the cell), its ✕ button, a press anywhere outside it (a tap on touch, so
  the page still scrolls under the sheet; not a cell, which opens that
  cell's card, nor the Crafting panel it opened), switching away from the
  tab its cell is on, starting to drag a bag item, and once its item leaves
  the cell: sold, salvaged, equipped or unequipped (focus then goes to the
  cell, or the slot it was equipped to). Enter or Space on a cell opens it
  with focus on the card itself (Tab reaches its buttons), so a repeated
  Enter never sells. It is a dialog named after the item, and follows its
  cell when the window, a panel's scroll or a re-sort moves it.
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
- **Names under the stage:** each fighter's name has its own row (name, then
  the HP bar with the HP written inside it, then the qi bar) at every width,
  with 2 lines always reserved, so the strip
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
- **Store icons:** in the same style and size, one atlas row (`store.png`),
  one per offer (§8) in catalog order: three chests that grow grander with
  their grade (an azure-trimmed wooden chest, a carved jade chest, an open
  white-and-gold chest spilling light), a steaming celadon teacup with golden
  qi, a red-tasselled jade charm, and a red envelope with spirit stones
  peeking out. Built by `python3 tools/art/build.py store` from the manifest's
  `store` row.
- **Skill icons:** in the same style and size, one atlas row (`skills.png`),
  one per skill name in `PATH_SKILL_NAMES` order (14: the renamed upgrades
  have their own), each in a rounded metal frame in its Path's colour (Sword
  azure and silver, Body bronze and gold, Talisman jade and gold), shown at
  22 px on the strip. Built by `python3 tools/art/build.py skills` from the
  manifest's `skills` row.
- **Paper doll:** the Equipment tab, laid out like a classic equipment
  panel. The player's own Path character stands in the middle, facing
  forward: a 96×128 figure at 1× in the combat sprites' style (one front
  generation per Path, edited from that Path's approved idle, cleaned like the
  sprites into `doll-<path>.png`), breathing through 4 frames. A Path change
  or Reincarnation swaps it at once. It stands on a small jade plinth in the
  item icon style (`plinth.png`, drawn smooth at 2×), in a soft qi mist whose
  colour follows the realm (`REALM_MIST` in view.ts, one per realm). The
  panel is CSS only (the theme's border and background, no backdrop art).
  Two even columns of five 44 px slots flank it, labels under each and
  nothing drawn over the figure: left Head, Chest, Boots, Weapon, Hidden
  Weapon; right Accessory 1, Accessory 2, Attachment, Charm 1, Charm 2 (one
  grid row per pair, so they line up). Tab order follows the columns: the
  left five top to bottom, then the right five. An empty slot is the bag's cell frame
  with a faint grey icon of what goes there (`slots.png`, one per item type
  in the icon atlas's column order; the two Accessory slots share one, as do
  the two Charm slots; darkened on the light theme). A filled slot shows the
  item icon with an inner glow in its grade colour, stronger with each grade,
  and the grade initial as on every cell. Equipping (double-click, drop or
  the Equip button) pulses the slot once; refining a worn item or loading a
  save does not.
  Reduced motion keeps the figure, mist and slots still. Under 720 px tall
  the slots shrink to 38 px so the tab fits without scrolling. Built by
  `python3 tools/art/build.py figures plinth slots`.
- Damage numbers are drawn in code, not baked into sprites. An enemy that dies
  falls where it stood, and the next one steps up only once it is down (the
  pause between fights, §5).
- The sim decides every outcome; the strip only plays it back. Reduced motion
  shows a still pose.
- The Full view shows the whole stage at 3/4 (156 px tall) in the left half
  of the page, with the summary chips and Recent drops beside it, so the
  panels fit one screen; a window under 720 px tall shows it at 0.55 (114 px). The
  Mini view shows it at 3/8 so it fits its 160 px window. Narrow shows it at 1×, whole
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
| **Full** | Normal tab, 768 px wide or more | Title bar; combat strip with its XP bar, and beside it the summary chips and Recent drops side by side (stacked under 560 px wide); then Character and Inventory side by side, the bag ten cells wide, with an item's details in a card over them (under 940 px wide the strip spans the page, the bag is eight cells wide and the card is a sheet along the bottom). From 940 × 600 px the page is the window's height and the panels scroll inside (never shorter than 16rem, so a notice over the game scrolls the page until it is closed). Under 900 px tall it compacts further: no formula bar and the bag's tabs on its header bar; under 810 px the names and HP are drawn over the stage; under 720 px (such as the 960 × 640 itch.io frame) the stage is at 0.55 too. The Path choice and the link code panel under it share one centred column, as wide as the choice |
| **Narrow** | Under 768 px (down to 375 px) | Same panels stacked: strip first, then the chips, Recent drops, then the panels |
| **Mini** | Pop-out window (§10), or any window under 240 px tall | Title bar, combat strip with HP bars only (no names, HP numbers or "vs"), one status line (`F21 · Golden Core · Manager · 3 drops`; `Tribulation due` or `Tribulation paused` in place of the realm, §4; then `· +6 pts` while stat points wait) and the latest-drop toast |
| **Discreet** | Pop-out window, picked from Pop out's list | A plain sheet for looking busy: a header row (A, B), row numbers and seven label / value rows in office words: Floor (`12 · Step 2 / 3`; Escalation, Final review or Audit for an elite, boss or Tribulation), Level (`14 · 37 / 60`), Health and Target (HP as %), Closed (kills), Latest (`Plus · Jade Ring`: the grade in office words, Standard, Plus, Pro, Premium or Enterprise) and Status (On track, Review due while a Tribulation is due, or Review postponed while it is set aside, §4). Theme colours only: no art, stamp, grade or tier colour, flashing, realm, Path or game name; the window's title is `Q3_Budget_Review` |

- The title bar's language button (globe and code) sits beside **Menu**.
- The title bar's **Menu** holds Settings and Help (how to play). Settings is
  one section per setting, set off by a rule: a bold name with a one-line
  hint, and its control. Theme, Notifications, Auto-Tribulation and Reset
  progress sit on one row each, the control at one fixed width at the right
  (toggles read On / Off); Cloud save and Save code stack their controls
  under the hint, every button that same width. Reset progress asks first
  and then deletes the save. Help ends with a Stats entry: each stat's tip
  for the cultivator now (§3).
- The Character panel's **Stats** tab has two sub-tabs (tabs pattern: arrow
  keys move between them), whose bar stays in view while the sub-tab under it
  scrolls; from 940 × 600 px only that sub-tab scrolls, never the page.
  - **Stats** (a dot while points wait, "Stats (N unspent points)" for
    screen readers): Base stats (each stat's tip on its name, +1 and All),
    Auto-assign folded into its summary line (opening it shows the switch and,
    while on, the shares and Apply plan), then the derived numbers one per row
    (label left, value right, in every view) in groups that fold: Offence,
    Defence, Find (Reflect shows for a Body Refiner only, Burst damage for a
    Talisman Master only) and Boosts running. A group's heading is a button
    that reports whether it is open, with its count ("Boosts (2)") shown while
    folded and read either way. Offence and Defence start open; Auto-assign,
    Find and Boosts start folded. Which are open is a display preference kept
    on this device only, like the theme (`office-immortal.folds`): read
    against the allow-list of groups, each "open" or "closed", and anything
    else (unknown names, wrong types, oversized or broken values, no storage)
    keeps the default.
  - **Respec:** the "How Respec works" note as text, then Reset stats and
    Change Path, each with its cost and the reason it is off.
  - A Skills sub-tab (a follow-up, §5 Qi and skills) goes between them.
- The Inventory panel has three tabs: Bag, Auto filter and Store (§8). Each
  tab wears a colour on its border (Bag the accent, Auto filter the Salvage
  colour, Store the Spirit Stones colour), tinted while open. The Store groups
  its cards under **Gear chests** and **Boosts** headings; chests run best
  grade first (Heaven, Earth, Spirit), boosts in stock order; a group with
  nothing in stock is hidden. Store cards stack in one column in every view.
- The Crafting panel (§7) is a modal over the Full view; in the Narrow view
  it is a full-width sheet along the bottom. Esc, Close or a click outside it
  closes it, and focus goes back to the Craft button.
- Full and Narrow are chosen by width; Mini is chosen by height or by being
  the pop-out, and wins when both apply.
- The Mini view has no inventory or menus. In the pop-out, a click on it
  focuses the main tab; in a short main window, making the window taller
  brings the other views back. Its aspect is about 3:1 (e.g. 480×160).
- The Discreet view behaves like the Mini pop-out: same size, a click
  focuses the main tab, and a language switch rewords it in place.
- **Discreet mode** sits on top of the Full and Narrow views: the title bar's
  **Discreet** button, or the key left of 1 (`` ` ``) anywhere on the page or
  in the pop-out while no text field has focus, switches it; again switches
  back, and the game keeps running. Both work on every screen, the Path
  choice too (its portraits are hidden). It is a display preference like the theme
  (Reset progress keeps it). While on, the combat strip gives way to the
  Discreet view's seven rows (no sprites, background, damage numbers or
  flashing Tribulation alert: Status says Review due as plain text); the title
  bar hides the stamp and its file name becomes `Q3_Budget_Review`; the
  summary chips lose their icons; item icons, store icons and the paper doll's
  figure, plinth, mist and slot icons are hidden (plain slots, no grade glow); every grade colour is the plain text colour, and grades are named in
  office words (Standard to Enterprise; Std, Plus, Pro, Prem, Ent on a cell;
  a store chest is a Plus, Pro or Premium Bundle).
  An open Mini pop-out shows the Discreet view until it is switched off. Help
  lists the key.
- All the views render the same state; switching never pauses the sim.

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
- The paper doll's art (§14 Paper doll) is generated too: the three Path
  figures with flux.2-klein-4b, each an edit of its Path's approved combat
  idle, cleaned to the shared palette like the sprites; the plinth and the
  eight empty slot icons as plain generations in the item icon style (pale
  grey, so they read faint), drawn smooth like the item icons. The old
  64×80 mannequin (`paperdoll.png`) is gone.
