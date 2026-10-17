# Tell Me What To Do

**[Українська версія → README.uk.md](README.uk.md)**

A small browser dungeon crawler where **you don't control the hero — you talk to him.**
Hold Space, say what to do ("go east, then attack the skeleton"), and a curious,
slightly naive hero tries to follow. He doesn't know where the traps or the lava are, which key
fits which door, or that the chest in the corner is breathing. You can see the map; he can't.

Voice commands are turned into a plan by **JEV** ([TypeSafe](https://typesafe.ai) System One, model `jev-latest`).
Without an API key the game falls back to a built-in keyword parser (Ukrainian + English), so you can play for free.

![Screenshot](docs/screenshot.png)

## Features

- **3 floors** (1 → −1 → −2), each a fresh 12×8-room maze (96 rooms), with a minimap.
- **Colored keys** and matching doors: white → stairs down (floors 1 and −1), yellow → a vault with a better sword (every floor), blue → the lever room (floor −2 only).
- **Lever** on the last floor opens the barred boss door, which is guarded by 3 skeletons, a mage and a chomper.
- **Compass** (always on floor 1): a yellow arrow by the hero points to the nearest key you haven't picked up yet.
- Enemies: sword skeletons, **vampire mages** whose magic bolts you can dodge by moving, **chompers** that follow you through doors, **mimics** (watch for a brief toothy tell — the hero won't notice), and the demon boss.
- Hidden spike traps, all-lava rooms (the hero walks right in if you tell him to).
- **Hero autonomy:** if you go quiet, he does things on his own. He runs back when hit by magic or badly hurt, fights a single weak enemy, opens chests, and after 12–20 s of silence wanders into a neighbouring room ("What's there?"). Any voice command interrupts him.
- **"Huh?" replies:** when he can't make sense of a command he answers with a funny childlike line. With an API key, the same JEV request also classifies what you said (greeting, insult, food, "fly!", gibberish, …) so the joke fits.
- UI and voice in **Ukrainian and English** (UKR / ENG buttons).

## Requirements

- **Node.js** 18+ (tested with Node 24). No `npm install` needed: no dependencies.
- **Chrome or Edge** (desktop) for speech recognition (Web Speech API). Other browsers can open the game but can't listen.
- A microphone.
- Optional: a TypeSafe API key for JEV.

## Run

```bash
node server.js            # http://localhost:9123
PORT=8080 node server.js  # another port (Windows: set PORT=8080 && node server.js)
```

On Windows you can just double-click `start.bat`: it starts the server on port 9123 and opens the browser.

The server serves the static files and proxies `POST /api/decide` → `https://api.typesafe.ai/v1/systemone`.
The proxy avoids CORS issues and writes the last request and response to `tools/last-jev.json` for debugging.

## TypeSafe API key (optional)

1. Get a key at **https://console.typesafe.ai/keys** (the 🔑 button in the settings panel links there).
2. Paste it into the settings panel. The key is stored **only in your browser's** `localStorage` (`jev_key`). It is sent only to the local proxy, which forwards it to TypeSafe.
3. Cost: billed per input token (the game estimates `input_tokens × $0.000000042`). A typical command is about 6–8 k input tokens, so **roughly $0.0003 per command** (about 3,000 commands per dollar). The HUD shows the running total.

Without a key, commands are parsed by keywords. That's good for simple orders; JEV handles free-form speech and multi-step plans.

## How to play

- Press **Start** (or P), then **hold Space and speak**. Release to send.
- Camera: mouse wheel or Q/E zoom, WASD or drag to pan, F follows the hero, M toggles the minimap (click it to jump there), P pauses.
- Goal: find the keys, take the stairs down twice, pull the lever on floor −2, beat the demon and reach the exit.

Example commands:

| English | Українською |
|---|---|
| go east / go to the lower room | йди на схід / йди в нижню кімнату |
| three steps left, then up to the wall | три кроки ліворуч, потім вгору до стіни |
| attack the skeleton | атакуй скелета |
| open the chest, then pick up the sword | відкрий скриню, потім підбери меч |
| put on the helmet / drink the potion | одягни шолом / випий зілля |
| run back / stop | тікай назад / стоп |
| pull the lever / go downstairs | потягни важіль / спустись сходами |

Tips: the hero opens a colored door by himself when you send him through it and he has that key (the key is used up). He'll never use keys on his own. Traps and lava are visible to you, not to him: guide him around them step by step.

## Project structure

```
index.html        UI layout, styles, data-i18n attributes
server.js         static server + /api/decide proxy to TypeSafe (PORT env, default 9123)
start.bat         Windows launcher
src/
  main.js         wiring: UI, HUD, log, voice command → JEV/keywords → plan, event → speech bubble/sound
  game.js         game state & rules: hero, goals/macros, combat, doors/keys/lever, floors, autonomy, enemy AI
  maze.js         per-floor maze generator (rooms, doors, special rooms, keys, traps, lava), FLOORS config, BAL balance knobs
  path.js         grid A* (optional diagonals)
  items.js        items, hero stats formulas, loot tables
  agent.js        actions offered to JEV for the current room, state description, keyword fallback parser
  plan.js         JEV question building (noul + score), plan selection, command splitting
  jev.js          TypeSafe System One request
  huh.js         funny "didn't understand" replies (categories + picking; phrases in i18n)
  render.js       canvas renderer (tiles, entities, smoothing, bolts, compass, minimap, bubbles)
  assets.js       sprite/sound paths
  audio.js, speech.js   sound effects/music, Web Speech wrapper
  i18n.js         Ukrainian/English strings
tools/
  test-logic.mjs  headless tests (node tools/test-logic.mjs)
  oracle.mjs      "good guide" bot used for balance simulations
  sim.mjs         shared simulation loop (guide answers ~3 s after the hero runs out of orders)
  tune-enemies.mjs  try balance overrides: node tools/tune-enemies.mjs '[{"boltCd":6}]' 80
  make-items.mjs, make-tiles.mjs   generate pixel-art item icons / lava tiles
  check-walls.mjs, preview-rooms.mjs, check-assets.mjs   debug previews/checks
```

## How JEV planning works

1. The spoken command is split into **parts** ("go east, then attack" → 2 parts) using language-specific connectors (`then`, `and`, `потім`, `і`, …).
2. The game lists every action that makes sense right now: room-specific macros (`go_to_room_E`, `kill_monster12`, `open_chest_chest7`, `pull_lever`, …) plus generic ones (`move_west_3`, `drink_potion`, `wait`, …).
3. **One request** asks two questions per action:
   - `noul` (probability 0..1): "does the command ask for this action?"
   - `score` (levels = the command parts): "which part of the command is this action?"
4. Actions with noul > 0.5 are kept (at most 5) and ordered by score. That ordered list is the plan. It shows in the log (🧠) and in the hero's speech bubble.
5. A new command aborts the current plan, and answers to older commands are discarded.

## Adding content

- **New enemy type:** add base stats in `monsterStats` (`maze.js`), sprites in `ENEMY`/`IMAGES` (`assets.js`), drawing in `drawMonster` (`render.js`), behaviour in the monster loop in `Game.update` (`game.js`; see `mageAct`/`chompFollow`), names `mon.`*/`monAcc.*` in `i18n.js`, an English description in `MON_EN` (`agent.js`), and add it to a floor's `mix` in `FLOORS`.
- **New item:** add it to `ITEMS` (and a loot table in `FLOORS[].loot`) in `items.js`/`maze.js`, an icon in `tools/make-items.mjs` (then run it), `ITEM_ICONS` in `assets.js`, `item.<id>` names in `i18n.js`, and optional keyword patterns in `ITEM_RX` (`agent.js`).
- **New room type:** set `r.type` in `genOnce` (`maze.js`), keep `solvable()` true, draw it in `render.js` (and the minimap colors).
- **New action/macro:** resolve its label in `Game.resolve`, execute it in `Game.runGoal`, offer it in `roomActions`/`genericActions` (`agent.js`) with a clear English description, add a short description to `DESC` (`plan.js`), a line to `sayFor`, and keywords in `RX`.
- **Strings:** every UI/log/speech string lives in `i18n.js` under both `uk` and `en`. The tests fail if a key is missing in either language.

## Tests & balance

```bash
node tools/test-logic.mjs
```

Covers maze generation for all floors (200 seeds each: connectivity, dead-end special rooms, keys never behind their own door, compass on floor 1), keys/doors/lever/stairs/compass/mimic logic, autonomy rules, enemy behaviour, keyword parsing in both languages, JEV plan selection on mocked answers, i18n completeness, and full 3-floor runs with the oracle guide. The guide's win rate is kept around 35–50%. With no commands at all the hero practically never wins.

## Credits & licenses (assets)

Asset licenses belong to their authors. Check each source before redistributing.

| Asset | Author | License (as stated by the author) | Where |
|---|---|---|---|
| 16x16 DungeonTileset II v1.7 | 0x72 (Robert Norenberg) | CC0 1.0 (credit optional), https://0x72.itch.io/dungeontileset-ii | `assets/environment/0x72_DungeonTilesetII_v1.7` (no license file inside; stated on the itch page) |
| 2D Pixel Dungeon Asset Pack v2.0 + Enemy_Animations_Set | Pixel_Poem | Free for free and commercial projects, modification allowed, credit appreciated; **"You may not redistribute it or resell it"**, https://pixel-poem.itch.io/dungeon-assetpuck | `assets/environment/2D Pixel Dungeon Asset Pack v2.0`, `assets/environment/Enemy_Animations_Set` |
| Top-Down Character Animations (hero) | Eduardo Scarpato / Dagon Dev | CC0 (per `assets/LICENSE.txt`), https://eduardscarpato.itch.io/top-down-character | `assets/characters` |
| Survival Kit [Pixel Art 16x16] (free version) | Eduardo Scarpato / Dagon Dev | see the itch page (`assets/LICENSE.txt` notes it must be verified); not used by the current code | `assets/environment/Sprites` |
| Emotes pack | Kenney (kenney.nl) | CC0 (`assets/emotes/kenney_emotes-pack/License.txt`) | `assets/emotes` |
| The Essential Retro Video Game Sound Effects Collection [512 sounds] | Juhani Junkala | CC0 (`INFO.txt`) | `assets/sound/...` |
| 5 Action Chiptunes | Juhani Junkala | CC0 (`INFO.txt`) | `assets/sound/...` |
| RPG Sound Pack | artisticdude (OpenGameArt) | CC0, https://opengameart.org/content/rpg-sound-pack (no license file inside) | `assets/sound/RPG Sound Pack` |
| Item icons, lava tiles | generated by `tools/make-items.mjs`, `tools/make-tiles.mjs` | same as the project code | `assets/items`, `assets/tiles` |



Debug: URL params `?near` `?god` `?compass` `?test` (all), combinable with `&`.