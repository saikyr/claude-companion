# companion-data: what Claude reads

The Companion app (`web/`) writes `snapshot.json` here every time it loads new game data
(after each Sync in game, while the app window is open). It is the page's own view of the
character, so Claude's answers match what the app shows. Claude sessions read it from
`_forever_/Interface/AddOns/ClaudeCompanion/companion-data/snapshot.json` on the computer the game runs on
(Windows: `server.ps1` via `Claude Companion.bat`; macOS: `server.py` via `Claude Companion.command`).

The raw store is still the game's SavedVariables file
(`WTF\Account\<account>\SavedVariables\ClaudeCompanion.lua`, global `ClaudeCompanionDB`).
Read that only for things the snapshot leaves out (bag contents, journal, full AH price history).

## snapshot.json, schema 1

| Key | What |
| --- | --- |
| `schema` | 1. Bumped only when a field changes meaning or is removed. New fields can appear at any time. |
| `written` / `savedInGame` | ISO times: when the app wrote this, and when the game saved the data it shows. |
| `pack` | Game-data pack build time and sources (`gamedata/build.sh`). |
| `character` | name, level, xp, xpMax, rested, class, race, faction, money (copper), where {zone, sub, x, y, map}, hearth. |
| `gear[]` | One entry per talent spec: `spec` (1/2), `label` ("Holy 16/33/0"), `tree`, `active`, `comparedWith` (the gear set it is measured against, or what you wear), `weights` (the profile id, e.g. "healing", "shadow", "iv-arms", or one of yours "u…"; null = none), `weightsName`, `weightsSource` (guide link, "yours" or a note), `weightValues` {statId: weight}. With weights: `worn[]` {slot, score}, `upgrades[]` (usable now), `preBis[]` (best per slot up to 60, no raids), `watch[]` (BoE upgrades to look for on the AH). Each item: slot, id, name, score, gain over worn, reqLevel, boe, where (how to get it), needs[] (unmet reputation / profession gates). |
| `bagAdvice[]` | What the app says about each item you own (bags, bank), from `js/advice.js`. Only items with something to do: `flag` up / de / ah / sell / ask (kept items are left out), `words` ("Upgrade for Shadow", "Sell on the Auction House"), `why`, `value` (copper, the chosen way), `where` [bags, bank], `specs[]` {spec, score, gain (vs what that spec's gear uses in the slot), canWear, level (an upgrade from that level)}. Words and colours: docs/ui-language.md. |
| `bestOwned[]` | Per spec: `spec`, `comparedWith`, `slots[]` {slot ("Ring", "Trinket", "Weapons", ...), gain, best[] (the best items you own for it: id, name, score, where worn/bags/bank; two for rings and trinkets), now[] (what that spec's set uses)}. |
| `weightProfiles[]` | Your own weight profiles for this class: id, name, from (the profile it was copied from), weights {statId: weight}. |
| `equipped[]` | slot, id, name. |
| `quests[]` | The quest log: id, title, level, complete, failed, objectives[], turnIn {npc, zone, x, y}, xp, money (copper). |
| `cooldowns[]` | Profession cooldowns: name, profession, readyAt (Unix seconds; in the past = ready now). Shared ones (Transmutes) are one entry. |
| `professions[]` | name, rank, max. |
| `reputation[]` | name, standing (1 Hated ... 4 Neutral ... 8 Exalted), value. |
| `ah` | lastScan {t, auctions}, itemsPriced, sold[] {t, item, net}, bought[] {t, item, price}, flips {totals, done[] (each buy matched to its later sale: paid, price, cut, deposit, profit = price - cut - paid), open[] (bought, not sold: paid, listedAt)}, mine[] (your auctions when last saved). Times are Unix seconds; money in copper. |

Scores use the stat weights of the profile each spec uses (Stat weights page; defaults and sources in
docs/STAT-WEIGHTS.md). Stat ids are the game-data pack's (`gamedata/build.py` STAT); `dps` = weapon DPS.

## Room for Claude to write (not built yet)

Planned: Claude drops JSON files into `companion-data/from-claude/` and the app shows them in
their own tab. Kinds being considered: `plan` (a session plan or route with steps and coords),
`gear` (a gear decision with the items), `todo` (a checklist that ticks itself off from game
data, e.g. "turn in 3 quests", "craft Mooncloth"). Nothing reads that folder today.
