# companion-data: what Claude reads

The Companion app (`web/`) writes `snapshot.json` here every time the game saves (after each Sync,
`/reload` or logout), **also with the app closed**: the server, which starts at login, then has a
hidden (headless) Chrome or Edge load the page once, about 10-20 seconds after the save. With no
Chrome or Edge installed it waits until the app is opened (see `saveModified`). It is the page's own view of the
character, so Claude's answers match what the app shows. Claude sessions read it from
`_forever_/Interface/AddOns/ClaudeCompanion/companion-data/snapshot.json` on the computer the game runs on
(Windows: `server.ps1`, set up by `Claude Companion.bat`; macOS: `server.py`, set up by `Claude Companion.app`;
both start the server at login, hidden).

`update.json` (yours, optional): `{"auto": true, "token": "...", "sync": {"folder": "<drive>/Claude Companion"}}`.
`auto`: install new builds by themselves; `token`: only to update from the private repository without the GitHub
CLI; `sync`: set by the app when you pick a cloud drive. `installed.json` (the app writes it): the build installed.
Neither is ever shipped or overwritten by an update.

`devices/<computer>/` (the app writes it): the other computers' latest saves (`save.lua`, `meta.json`), copied from
the sync folder. The app merges them with this computer's save, so `snapshot.json` describes one character across all
of the person's computers; `mergedWith` lists which saves are in it. The same merged snapshot is in the sync folder as
`<computer>/snapshot.json.gz` (each computer's copy; read the one with the newest `written`).

`settings.json` here holds the app's own choices (gear weights, compare-with picks, flips set aside),
copied from the browser so every browser and the hidden one give the same advice. The app writes it; Claude can read it.

The raw store is still the game's SavedVariables file
(`WTF\Account\<account>\SavedVariables\ClaudeCompanion.lua`, global `ClaudeCompanionDB`).
Read that only for things the snapshot leaves out (bag contents, journal, full AH price history).

## snapshot.json, schema 1

| Key | What |
| --- | --- |
| `schema` | 1. Bumped only when a field changes meaning or is removed. New fields can appear at any time. |
| `written` / `savedInGame` | ISO times: when the app wrote this, and when the game saved the data it shows. |
| `by` | `app` (an open app window) or `background` (the server's hidden browser). Same content either way. |
| `saveModified` | The save file's modified time (UTC, ISO) that this snapshot was built from. **Check before trusting the snapshot:** if `ClaudeCompanion.lua` is newer than this, the game saved since the snapshot was written (it catches up within about 20 seconds; if it doesn't, the computer has no Chrome or Edge), so read the save itself for anything newer or ask the player to open the app once. |
| `device` | Which computer wrote this: `host` (computer name) and `os` (`pc` / `mac`). **The PC and the Mac each keep their own SavedVariables and their own `snapshot.json`;** neither sees what was played on the other. Read the one whose `savedInGame` is newest, and the other for history (journal, grinds, AH) from that computer. |
| `grind` | `running`: the grind going on now, or null; `recent[]`: the last five finished, newest first. Each: name, device, start, last (last counted event), finish, secs (counted time), kills, paused, ended (`logout`, `away` = this save last saw it more than 2 min before the next login, `idle` = 30 min with nothing counted; null = stopped by the player). A running grind in an older snapshot isn't live: it ends at the next login if the player was away. |
| `runs[]` | Dungeon and raid runs, newest first (10): name, kind (party / raid), difficulty, device, live (going on now) and inside, start, finish, ended (`left` = 15 min outside, `other` = another instance, `reset`, `away`), secs (time inside), kills, bosses[] (names), wipes, deaths, xp, quests, coin (gold looted, copper), itemsValue (AH or vendor value of the loot), loot[] (green and better: id, name, q, count), group[] (names), groupLoot[] (greens and better that went to someone else: t, who, name, q, how = won / loot, rolls[] {who, choice need / greed / pass, roll}). `fromJournal: true` = a run from before the addon tracked runs, rebuilt from the Journal: kills are XP gains that weren't quest rewards, and bosses are unknown. |
| `flightPaths` | `byContinent` {continent: [flight path names]} and `read` {continent: when its flight map was last open}. The game's flight map only lists the continent you're on, so a continent missing from `read` hasn't been saved yet: ask the player to open a flight map there once. Paths saved before continents were noted are under `unknown` until that continent's map is opened again. |
| `taken` | When each part was last read in game: character, bank, mail, flightPaths, ahScan, ahOwned, professions {name: time}, specs {talent group as saved: time}. Bank, mail, professions, flight paths and the AH only update while that window is open in game. |
| `pack` | Game-data pack build time and sources (`gamedata/build.sh`). |
| `character` | name, level, xp, xpMax, rested, class, race, faction, money (copper), where {zone, sub, x, y, map}, hearth. |
| `gear[]` | One entry per talent spec: `spec` (1/2), `label` ("Holy 16/33/0"), `tree`, `active`, `comparedWith` (the gear set it is measured against, or what you wear), `weights` (the profile id, e.g. "healing", "shadow", "iv-arms", or one of yours "u…"; null = none), `weightsName`, `weightsSource` (guide link, "yours" or a note), `weightValues` {statId: weight}. With weights: `worn[]` {slot, score}, `upgrades[]` (usable now), `preBis[]` (best per slot up to 60, no raids), `watch[]` (BoE upgrades to look for on the AH), `classSets[]` (every item set for the class that Forever has: name, kind, owned/pieces, worn, missing[] with where, bonuses[] with active). `preBis[]` items also carry `status`: done (in the compared set), worn, bags, bank or missing. Each item: slot, id, name, score, gain over worn, reqLevel, boe, where (how to get it), needs[] (unmet reputation / profession gates). |
| `bagAdvice[]` | What the app says about each item you own (bags, bank), from `js/advice.js`. Only items with something to do: `flag` up / de / ah / sell / ask (kept items are left out), `words` ("Upgrade for Shadow", "Sell on the Auction House"), `why`, `value` (copper, the chosen way), `where` [bags, bank], `specs[]` {spec, score, gain (vs what that spec's gear uses in the slot), canWear, level (an upgrade from that level)}. Words and colours: docs/ui-language.md. |
| `bestOwned[]` | Per spec: `spec`, `comparedWith`, `slots[]` {slot ("Ring", "Trinket", "Weapons", ...), gain, best[] (the best items you own for it: id, name, score, where worn/bags/bank; two for rings and trinkets), now[] (what that spec's set uses)}. |
| `weightProfiles[]` | Your own weight profiles for this class: id, name, from (the profile it was copied from), weights {statId: weight}. |
| `equipped[]` | slot, id, name. |
| `quests[]` | The quest log: id, title, level, complete, failed, objectives[], turnIn {npc, zone, x, y}, xp, money (copper). |
| `cooldowns[]` | Profession cooldowns: name, profession, readyAt (Unix seconds; in the past = ready now). Shared ones (Transmutes) are one entry. |
| `professions[]` | name, rank, max. |
| `reputation[]` | name, standing (1 Hated ... 4 Neutral ... 8 Exalted), value. |
| `ah` | lastScan {t, auctions}, itemsPriced, sold[] {t, item, net}, bought[] {t, item, price}, flips {totals, done[] (purchases matched to later sales unit by unit, oldest first, using the stack size from the AH letter: units, paid, price, cut, deposit, profit = price - cut - paid), open[] (bought, not sold: units, paid, listedAt); purchases the player marked "used, not a flip" are left out}, mine[] (your auctions when last saved). Times are Unix seconds; money in copper. |

Scores use the stat weights of the profile each spec uses (Stat weights page; defaults and sources in
docs/STAT-WEIGHTS.md). Stat ids are the game-data pack's (`gamedata/build.py` STAT); `dps` = weapon DPS.

## from-claude/: cards Claude writes, and what the player did with them

Claude's suggestions (a farm, a flip, a quest route, a gear change...) show in the app's **From Claude**
tab and on the Overview as cards. Two files, one writer each:

| File | Written by | What |
| --- | --- | --- |
| `from-claude/cards.json` | **Claude only** | Every card, open or closed. Claude rewrites the whole file (write a temp file, then rename). The app never changes it. |
| `from-claude/state.json` | **the app only** | What the player did: done, dismissed, which steps are ticked. Claude reads it, never writes it. |

The app checks both every 5 seconds, so a new card shows without a reload.
**Before writing cards.json, run `python3 tools/check-cards.py cards.json`** (in the repo); it must print `ok`.
Reinstalling the addon by copying the zip over the folder keeps both files; deleting the folder first loses them.

### cards.json, schema 1

```json
{ "schema": 1, "cards": [ { "id": "farm-steppes-patterns", "kind": "farm", "title": "...", ... } ] }
```

| Field | | What |
| --- | --- | --- |
| `id` | required | Stable, lower-case letters, digits and dashes. Update a card by keeping its id; the player's choices stay attached to it. |
| `title` | required | Short, says what to do. |
| `kind` | | `farm`, `flip`, `quest`, `gear`, `craft`, `route` or `note` (default). Sets the icon and the filter chip. |
| `summary` | | One or two sentences: what and why. Shown on the Overview too. |
| `status` | | Claude's side: `open` (default), `done` (Claude saw it finished, e.g. the item is in the bags) or `withdrawn` (no longer a good idea). |
| `created`, `updated` | | ISO times. Newest `updated` first. |
| `expires` | | ISO time after which the card closes by itself (a price or a cooldown that won't last). |
| `character` | | Character name; the card shows only for that character. Leave out for any. |
| `where` | | Zone or place, as text. |
| `facts[]` | | `{label, value, note?}`, all text: the numbers that matter (rate, drops per hour, gold per hour), with the sample size or "Classic only" in `note`. |
| `items[]` | | `{id, note?}`: game item ids. The app shows the icon, tooltip and the player's own AH price. |
| `track` | | `{grind, mobs?[]}`: the name to use with `/cc start <grind>`. The card then shows the tracked time, kills, gold per hour, kills of each listed mob and drops of the card's items, from every run with that name. |
| `steps[]` | | Text, in order. The player ticks them off. |
| `body` | | Longer text: the stop rule, caveats. Blank lines split paragraphs. Plain text, no HTML or Markdown. |
| `sources[]` | | `{label, url?}`: where each number came from. |

Unknown fields are refused by the checker, so a typo can't hide a field.

### state.json

```json
{ "schema": 1, "written": "<ISO>", "cards": { "<card id>": { "state": "done" | "dismissed", "steps": [0, 2], "at": "<ISO>" } } }
```

No `state` means the card is open (the player can restore a closed card). `steps` are the ticked
step positions, counting from 0. A card is open in the app when the player hasn't closed it, its
`status` is `open` and it hasn't expired. A dismissed card stays dismissed even if Claude updates it;
to raise it again, give it a new id.
