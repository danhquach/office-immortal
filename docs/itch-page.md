# itch.io store page

The text, images and settings for the game's itch.io page, ready to paste in.
Everything describes the game by genre only: no other game or studio is named.
The project and upload settings match the README's "Release on itch.io"
section; change both together.

## Text

**Title:** Office Immortal

**Tagline / short description** (itch.io's 150-character field, 120 used):

> An idle loot RPG: cultivate in secret at your office desk while your
> cultivator fights up the tower, Intern to Immortal.

**Full description:**

> You're an office worker with a secret: between spreadsheets, you cultivate.
>
> **Office Immortal** is an idle loot RPG that lives in a browser tab. Your
> cultivator fights up the floors of the office tower on their own (waves of
> office demons, an elite and a boss on every floor) while you get on with your
> day. Check in now and then to equip better treasures and break through to the
> next realm.
>
> - **Plays itself.** Combat, levelling and loot pickup are automatic. Every
>   choice is made between fights.
> - **Loot worth chasing.** Every treasure rolls its base stat, affixes and
>   quality, in five grades from Mortal to Immortal. Immortal treasures carry a
>   unique effect.
> - **Three Paths.** Sword Cultivator, Body Refiner or Talisman Master.
> - **Ten realms.** Climb from Qi Condensation (Intern) to Immortal Ascension,
>   with a Tribulation boss at the end of each.
> - **Reincarnation.** Start over for Dao Insight and permanent bonuses.
> - **Overtime Cultivation.** Progress keeps going while the tab is in the
>   background or closed, up to a cap.
> - **Sell, salvage and auto filter.** Keep what matters and turn the rest into
>   Spirit Stones or Spirit Essence.
> - **English and Tiếng Việt.**
>
> The cultivation is played straight; the office is the joke. It even looks
> like a spreadsheet.
>
> **Controls:** mouse, or keyboard (Tab, Enter, arrow keys in tabs). There is
> nothing to press during a fight.
>
> **Saves:** progress is saved in your browser for this site, so it doesn't
> carry over from another site or another browser, and clearing site data
> deletes it. Playing on itch.io and on the game's own site keeps two separate
> saves. Cloud save isn't available in the itch.io version.
>
> **Made with AI:** the art was generated with an image model (flux.2-klein-4b,
> through Pollinations) and then cleaned up and reworked by hand; the code was
> written with the help of an AI coding assistant.
>
> Free and open source under the MIT licence:
> https://github.com/danhquach/office-immortal

## Metadata

- **Classification:** Games
- **Kind of project:** HTML
- **Release status:** In development
- **Pricing:** No payments
- **Genre:** Role Playing
- **Tags** (itch.io allows 10): idle, incremental, loot, rpg, pixel-art,
  cultivation, xianxia, auto-battler, singleplayer, browser
- **AI generation disclosure:** Yes. Graphics: AI-generated (flux.2-klein-4b
  through Pollinations), then cleaned up by hand. Code: written with AI
  assistance. Sound and text: no AI audio (the game has no sound); the text is
  written by the developer.
- **App store links, community, custom noun:** none.
- **Visibility:** Draft until the page is checked, then Public.

## Licences

- **The game:** MIT ([LICENSE](../LICENSE)).
- **Third-party art:** none ships. The sprites, backgrounds and icons are
  generated for this game and cleaned up in `tools/art/build.py`; the weapon
  icons are drawn as SVG in `tools/art/weapons.mjs`. If outside art is ever
  shipped, list it here with its licence.

## Images and video

Made from the production build with the committed test saves, so they can be
retaken after any UI change (see the README's "Store page" section).

| Upload as | File |
| --- | --- |
| Cover image (630 × 500) | `marketing/cover-630x500.png` |
| Screenshots, in this order | `marketing/screenshots/01-…06-*.png` (1920 × 1080) |
| Screenshot (animated) | `marketing/autobattle.gif` (960 × 211, loops) |
| Gameplay video or trailer | YouTube link to `marketing/trailer-1080p.mp4` (not committed) |

Screenshots:

1. `01-early-floor-fight`: a new run fighting through floor 4.
2. `02-immortal-drop`: an Immortal treasure just dropped, its details open.
3. `03-tribulation-boss`: a Body Refiner facing the Foundation Establishment
   Tribulation.
4. `04-inventory-and-equipment`: every position filled and a full bag.
5. `05-reincarnation`: Dao Insight passives and the Reincarnation offer.
6. `06-vietnamese`: the same run in the Tiếng Việt language pack.

The cover's painting comes from flux.2-klein-4b (Pollinations); the title is
stamped on by `tools/marketing/cover.py`, so it is always spelled right.
Cover prompt (concept A of four, seed 8501, 1264 × 1008):

> pixel art game cover illustration, chunky pixels, limited palette, bold dark
> outlines. A young office worker cultivator with messy spiky black hair, white
> dress shirt with rolled sleeves and dark blue necktie, sitting cross-legged in
> meditation on top of his office desk with a computer monitor and coffee mug, a
> glowing jade green aura and floating green sword around him. Behind him
> through a big window, a tall glowing office skyscraper tower rises into golden
> clouds at night, the top floors shining like a heavenly palace. Dramatic,
> epic, cozy. Empty dark sky band across the top third for a title. No text, no
> letters, no logo.

## Project and upload settings

As in the README's "Release on itch.io" section:

- **Kind of project:** HTML. Upload channel `html5`, marked **This file will
  be played in the browser**.
- **Embed options:** embed in page, **960 × 640**, **Fullscreen button** on,
  **Enable scrollbars** on, **Mobile friendly** on.
- **Frame options:** no automatic start needed (the game starts on the Path
  choice); leave **SharedArrayBuffer** support off.
- **Theme:** dark background to match the game's dark theme.
