# Companion game-data pack

`build.sh` makes `web/data/gamedata.js`: every Forever item, quest, NPC source, vendor and drop
chance the app needs for things you haven't seen in game. One owner per kind of data:

| Data | Owner | Why |
| --- | --- | --- |
| Quests, NPCs, objects, quest givers / turn-ins, quest-item drops, vendors | **QuestieDB** (Forever flavor, `github.com/Questie/questiedb`) | The quest addon's own database. Its Forever layer is built from a Wowhead Forever snapshot plus QuestieTrace: traces from ~2 million Forever play sessions. |
| Quest XP | QuestieDB QuestXP (measured by Forever players where traced) | Same project. |
| NPCs and spawns: name, levels, rank, subname, zone, up to 4 spawn points (`npcs`) | **QuestieDB** Forever | Its Forever points are already in Forever map coordinates (Mulgore, Eastern Plaguelands, Redridge and Stormwind were converted by QuestieDB), so they are used as they are. |
| Weapon and armor tooltips and stats; "how to get it"; group size | **endgametools** Forever item pages | Read from the Forever client (build shown on each page). Matched the game's own numbers on all 48 of the player's items checked. |
| Random-suffix rolls: the exact stats of every "of Healing", "of the Owl", ... a base item can roll (`web/data/suffixes.js`, `suffixes.py`) | **foreverchanges.pro** item pages | Marked "Confirmed in game": the numbers the Forever server sends players (client build 1.60.1). On Forever a suffix's numbers depend on the base item, so they come per base. |
| Icon names (file id to name, `web/js/icons.js`, `icons.py`) | **wowdev community listfile** (`github.com/wowdev/wow-listfile`) | Every `interface/icons/*.blp` file. |
| Drop chances, "seen on Forever" counts, loot lists for non-quest items, crafted-by, icons, fixed-vs-choice quest rewards, reward money | **ForeverDB** (`foreverdb.net/data`) | Player uploads from Forever. The only bulk Forever loot data; rates not measured on Forever are labelled Classic. |
| Every profession recipe's tools and place, learned or not (`recipes`, `recipes.py`) | **VMaNGOS** world database (`github.com/brotalnia/database`, the 14 June 2021 dump) | No Forever source has them (QuestieDB and ForeverDB carry none; the game tells only for recipes you know, which the addon reads). Classic 1.12, labelled so in the app; checked against Forever in game for Enchant 2H Weapon - Major Intellect (Runed Arcanite Rod). Forever's own new recipes (spell ids over 1,000,000) are not in it. |
| Every recipe's reagents and trainer skill; every permanent enchant, the formulas and items that apply it and what each fits (`recipes[6..7]`, `enchants`, `recipes.py`) | **VMaNGOS** world database (as above: `spell_template` reagents, `npc_trainer` / `npc_trainer_template`, effect 53 spells and the items that cast them) | Classic 1.12, labelled so. Forever changed some enchants (Enchant Chest - Superior Mana is Superior Intellect there): the app prefers the game's own text (the item's "Enchanted:" line, a known formula's description) and doesn't use Classic numbers for a formula Forever renamed. |

The game always wins in the app: your own tooltips, quest-log rewards and AH scans replace pack data.

## Rebuild

    pip install lupa py7zr
    sh build.sh                # ~10 min first time (endgametools pages), 2-3 min after
    # then copy work/out/gamedata.js and work/out/suffixes.js to web/data/, work/out/icons.js to web/js/,
    # work/out/COVERAGE.md here; CI checks them (test_pack.py, test/web/data.test.js)

Optional: `SAVEDVARIABLES=<path to ClaudeCompanion.lua> sh build.sh` also checks the pack against
that character's own items and quest log.

Game rules that no source ships per item (standings, reputation thresholds, AH cut, disenchant
tables) are kept by hand in `web/data/rules.js`, each with its source.

Files: `export_questie.py` (QuestieDB → JSON, running QuestieDB's own loader in a sandboxed Lua),
`egt_parse.py` (endgametools pages → JSON), `recipes.py` (VMaNGOS dump → each recipe's tools, place, reagents and trainer skill, and every permanent enchant), `build.py` (joins everything; the schema is at the top),
`test_pack.py` (shape, known facts, coverage floors, player check), `coverage_md.py` (COVERAGE.md).
