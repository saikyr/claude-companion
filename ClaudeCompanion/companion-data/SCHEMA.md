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
| `gear[]` | One entry per talent spec: `spec` (1/2), `label` ("Holy 16/33/0"), `tree`, `active`, `comparedWith` (the gear set it is measured against, or what you wear), `weights` ("healing" / "shadow" / null = not set up). With weights: `worn[]` {slot, score}, `upgrades[]` (usable now), `preBis[]` (best per slot up to 60, no raids), `watch[]` (BoE upgrades to look for on the AH). Each item: slot, id, name, score, gain over worn, reqLevel, boe, where (how to get it), needs[] (unmet reputation / profession gates). |
| `equipped[]` | slot, id, name. |
| `quests[]` | The quest log: id, title, level, complete, failed, objectives[], turnIn {npc, zone, x, y}, xp, money (copper). |
| `cooldowns[]` | Profession cooldowns: name, profession, readyAt (Unix seconds; in the past = ready now). Shared ones (Transmutes) are one entry. |
| `professions[]` | name, rank, max. |
| `reputation[]` | name, standing (1 Hated ... 4 Neutral ... 8 Exalted), value. |
| `ah` | lastScan {t, auctions}, itemsPriced, sold[] {t, item, net}, bought[] {t, item, price}, flips {totals, done[] (each buy matched to its later sale: paid, price, cut, deposit, profit = price - cut - paid), open[] (bought, not sold: paid, listedAt)}, mine[] (your auctions when last saved). Times are Unix seconds; money in copper. |

Scores use the stat weights shown in the app's Gear tab (Healing: healing 1, Int 1.6, MP5 2.3,
Spirit 0.7, crit rating 0.3; Shadow: spell power 1, Spirit 0.55, MP5 0.66, Int 0.35, crit 0.3, hit 0.2).

## Room for Claude to write (not built yet)

Planned: Claude drops JSON files into `companion-data/from-claude/` and the app shows them in
their own tab. Kinds being considered: `plan` (a session plan or route with steps and coords),
`gear` (a gear decision with the items), `todo` (a checklist that ticks itself off from game
data, e.g. "turn in 3 quests", "craft Mooncloth"). Nothing reads that folder today.
