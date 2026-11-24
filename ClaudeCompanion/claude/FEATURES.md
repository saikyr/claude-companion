# Features: what the Companion does, records and shows

The one list of what the app already does. **Read it before saying a feature exists or doesn't, and
before any answer about gold, flips, grinds, runs, gear or quests.** When you add, change or remove a
feature, change this file in the same PR. Field details: [SCHEMA.md](../ClaudeCompanion/companion-data/SCHEMA.md).
How it works inside: [ARCHITECTURE.md](ARCHITECTURE.md).

`<account>` below is the snapshot's `sync.account` (also in project memory). "Snapshot" = the newest row of
`private.history` with `kind = 'snapshot'` (queries in [CLAUDE.md](../CLAUDE.md)). Raw history rows are one per
record; `data` holds the addon's record as saved. Times are Unix seconds, money is copper.

## Saving: when data exists

- The game writes addon data **only at `/reload` or logout** (`ClaudeCompanionDB`). `/cc sync` was removed
  (PR #64); typing it says "type /reload". Nothing done since the last `/reload` is anywhere yet.
- After a save, each computer's app sends new history and its snapshot to Supabase (about a minute).
  Check `at` on the snapshot row and say how old it is.
- Windows the game only shows while open (bank, mailbox, AH, profession windows, the class trainer, flight map) are read
  only while open. `snapshot.taken` says when each was last read.

## Chat commands (`/cc` or `/claude`, UI.lua)

| Command | Does |
| --- | --- |
| `/cc` | open or close the in-game window |
| `/cc start <name>` / `/cc stop` / `/cc pause` | a named grind (below) |
| `/cc target <item>` | an item you farm for in the running grind (shift-click it in); again takes it off; alone lists them. Up to 3 |
| `/cc status` | gold, kills and XP per hour of the running grind, else of the session |
| `/cc scan` | full AH scan (same as the "Scan AH" button under the AH window), once per 15 min |
| `/cc note <text>` | a note for Claude (history kind `note`) |

## Gold and the auction house

| Feature | Records | Where | Claude reads |
| --- | --- | --- | --- |
| **Gold log** | every money change with its source (`loot`, `vendor`, `ah`, `mail`, `quest`, `trade`, `trainer`, `flight`, `bank`, `other`) and the balance after | journal events `e = 'money'`; Journal tab | `select to_timestamp(t), data->>'amount', data->>'source', data->>'balance' from private.history where account = '<account>' and kind = 'journal' and data->>'e' = 'money' order by t desc` |
| Gold over time | level, XP and gold at each save | kind `history` | `kind = 'history'` |
| **AH prices** | full scans (min, median, count per item and random-suffix roll) and prices seen while browsing | kind `ah_obs` (30 per item kept in game); Auction House tab, Prices | `kind = 'ah_obs' and data->>'name' = '<item>'`; snapshot `gear[].ahUpgrades` for gear |
| **AH sales** | one per "Auction successful" letter: item, price, count, buyer, AH cut, deposit, `net` = price + deposit - cut | kind `ah_sale`; Auction House tab, Sold | snapshot `ah.sold[]` (last 25); all: `kind = 'ah_sale'` |
| **AH buys** | one per "Auction won" letter: item, price paid, count, seller | kind `ah_buy`; Auction House tab, Flips | snapshot `ah.bought[]` (last 25); all: `kind = 'ah_buy'` |
| **Flips** (cost basis) | each sale matched to earlier buys of the same item, unit by unit, oldest buy first: `profit = price - cut - paid`; buys not sold yet are `open[]` with `listedAt` if one of your auctions has it. Buys the player marked "Used, not a flip" are left out (setting `cc.flips.used.<name>`) | computed by the app (`flipsOf`, js/app.js); Auction House tab, Flips | snapshot `ah.flips`: `totals`, `done[]` (25), `open[]` |
| AH posts | each auction you post: item, qty, unit price, duration | kind `ah_post`; Auction House tab, Posted | `kind = 'ah_post'` |
| Your auctions | what you had listed when the AH was last open | `now` row; Auction House tab | snapshot `ah.mine[]` |
| AH chat lines | sold, expired, outbid, won, removed | journal `e` = `ahSold`, `ahExpired`, `ahOutbid`, `ahWon`, `ahRemoved` | `kind = 'journal' and data->>'e' like 'ah%'` |
| Craft profit | each recipe's reagent cost and its output's value at your AH prices, after the AH cut | Professions tab ("Makes a profit": only recipes whose every reagent has a price; the others say how many have none) | not in the snapshot: say so, or read the recipe and the prices |
| Disenchant results | what each item really gave when disenchanted | kind `de`; grind cards | `kind = 'de'` |

Flip query, every flip so far:
`select jsonb_pretty(data->'ah'->'flips') from private.history where account = '<account>' and kind = 'snapshot' order by t desc limit 1;`

**Profit rules.** A sale is revenue, not profit. Profit exists only where the app matched a sale to a
recorded buy (`ah.flips.done[]`). A sale with no recorded buy (loot, crafts, farmed mats) has **no cost
basis in the app**: say "revenue X, cost not recorded", never "profit X". Most buys are things the
player used (gear, reagents); they show in `ah.flips.open[]` until marked "Used, not a flip", so
`open[]` is not a list of failed flips.

Limits: a buy or sale is recorded only when the mailbox is opened with its letter in it (taking the gold
or item before the addon loaded loses it). Its time is estimated from the letter's days left (to the hour).
Raw `ah_sale` / `ah_buy` rows can hold the same letter twice; the app counts each letter once (use the
snapshot's `ah`, or dedupe on item + price + time within 2 h). The vendor and mats cost of a craft is not
recorded per craft.

## Grinds, sessions, dungeon runs

| Feature | Records | Where | Claude reads |
| --- | --- | --- | --- |
| **Grinds** (`/cc start <name>`, `/cc stop`) | counted time (pauses and logged-out time left out), kills (by mob), looted coin, loot, XP, deaths, rep, disenchants, zones, targets (`/cc target`, kept per grind name for the next start). Ends by itself at logout, after 30 min with nothing counted (`idle`), or `away`. Shows after the next `/reload` | kind `grind` (running one: kind `live`); Grinds tab | snapshot `grind.running`, `grind.recent[]` (20, with the gold-per-hour fields below); all: `kind = 'grind'` |
| **Grind panel** (in game) | while a grind runs: time counted, gold per hour, kills per hour and total, deaths, coin per hour vs items per hour (AH median of your newest scan, else vendor), the most valuable drops with icons, and targets: dropped vs expected (your kills of each creature that drops it × the drop chance ForeverDB **measured on Forever**, with its sample size; the tooltip gives the chance of none so far). Classic rates are never used: with no Forever rate it says "rate unknown" and shows your own count (1 per N kills, with a 95% range in the tooltip). After `/cc stop` it shows the grind's summary until closed. Shift-click pause, shift-right-click stop, alt-click a drop to make it a target | `UI.lua`; drop chances `Drops.lua` (made from the pack by `tools/make-drops.py`; loads after a game restart, not a /reload) | the grind record's `targets[]` (`id`, `name`, `got`, `expected`, `kills`, `rated`, `sample`); snapshot `grind.*.targets` |
| **Gold per hour** (the app's, the only one) | `gph` = (looted coin + loot at your AH median, or vendor price when it was never on the AH or a vendor pays more) / counted hours, the same number as the Grinds and Dungeons tabs; `gph_low` = coin + loot at vendor price (what it is worth for sure); `gph_high` = coin + loot at the highest median your scans saw in the 7 days before it ended. Copper per hour, before the 5% AH cut, loot counted whether sold or not. `complete: false` with `incomplete[]` reasons: still running, ended `away`, paused, under 10 minutes, rebuilt from the journal. `itemsUnpriced` = loot never seen on the AH (vendor price used) | Grinds and Dungeons tabs (`js/app.js` `goldOf`), From Claude cards with `track` | the brief's `gold.measured[]`, or snapshot `grind.recent[]` (20) and `runs[]`: **quote these fields; never work gold per hour out yourself** |
| **Loot by corpse** (grinds, runs, sessions) | at each loot window, which creature each slot came from (`GetLootSourceInfo`): per creature, its corpses opened and what they held (counted when the window shows it, taken or not; a corpse opened twice, skinned later or area-looted counts once). A corpse with no loot opens no window, so a creature's own rate for an item lies between count ÷ kills and count ÷ corpses. Nothing is recorded where the game hides the corpse's GUID (check `caps.loot`); chests and nodes aren't creatures | the tracker's `lootBy` {creature: {npc, corpses, items {id: count}}} (kinds `grind`, `run`, `session`) | snapshot `grind.*.lootBy[]` (10 creatures with the most corpses: name, npc, kills, corpses, items[] id, name, count) |
| **Combat log** (this computer, while `/combatlog` is on in game) | the app reads the game's own log files (`Logs/WoWCombatLog*.txt`) from where it stopped and keeps per creature only: your, your pet's and your group's spells on it per magic school (`n` casts that hit or missed, DoT and channel ticks left out; `full` casts fully resisted; `dmg` done and `resisted` lost to partial resists, ticks included), kills by you or your group, deaths seen. No player names, spell names or lines are kept or synced. A file without the game's `COMBAT_LOG_VERSION` header is skipped (`bad`). Respawn times are not measured. The resist counts are read the same in every log layout; `dmg` assumes the usual layout (17 advanced-logging fields) and isn't yet checked against a real Forever log | `companion-data/combat.json` (`js/combatlog.js`) | snapshot `combat` (`npcs[]`: 60 with the most counts, `files`, `lines`, `through` = the last line's local time stamp). A resist share is `full ÷ n` (spells fully resisted) and `resisted ÷ (dmg + resisted)` (damage lost to partial resists); quote it with its `n` |
| Sessions | the same counters from login to logout, automatic | kind `session` | `kind = 'session'` |
| **Dungeon and raid runs** | automatic from entering an instance: time inside, kills, bosses, wipes, deaths, XP, quests, coin, loot (green+), loot value, group, loot that went to others with the rolls. Ends after 15 min outside, another instance, a reset, or away. Runs from before the addon tracked runs are rebuilt from the journal (`fromJournal: true`, no `run` row; their bosses come from the Dungeon Journal addon's log, synced to every computer) | kind `run`; Dungeons tab | snapshot `runs[]` (10); all: `kind = 'run'` plus, for `fromJournal` runs, the journal |

## Character, gear and quests

| Feature | Where | Claude reads (snapshot) |
| --- | --- | --- |
| Character: level, XP, gold, position, hearth, stats, equipped | Character tab | `character`, `equipped[]` |
| Bags and bank, with a verdict per item (upgrade, disenchant, AH, sell, ask) | Bags & Bank | `bagAdvice[]` |
| Gear per spec: worn, upgrades, AH upgrades, rolls to search, pre-BiS with alternatives, class sets | Gear tab | `gear[]` (one per spec), `bestOwned[]` |
| Raid, PvP and not-in-game-yet items per slot, scored, with why they aren't in pre-BiS (raid content incl. quests whose chain runs through a raid or needs raid-only reputation, world bosses, crafts needing raid materials; Honor gear and battleground quartermasters; or not seen on Forever yet; or a world drop your own AH has never listed: lists in data/rules.js `instances`) | Gear tab, a slot in full | `gear[].notInPreBis[]` |
| Stat weights per spec, own profiles | Stat weights tab | `gear[].weightValues`, `weightProfiles[]` |
| Spell hit against the raid cap (17%): hit from gear and talents (read from the talent's own text at your rank), the client's rating per 1%; spell weights count hit only up to the cap | Gear tab, the hit line | `gear[].hit`; raw: `now` → `snap.stats.spellHitRating`, `specs.<n>.traits.trees[].nodes[].desc` |
| Quest log with every reward scored for every spec, and the chain's next quest | Quests tab | `quests[]` (`rewards[].specs[]`, `next`) |
| Quests to keep: `keep: true` with `keepWhy` and `dungeon` when the quest or any step of its chain is a pack `Dungeon` quest, has its quest zone or objective in an instance, or is a step of a key or attunement (`rules.js` unlocks: the Skeleton Key, the Seal of Ascension...); also when it gives rep with a faction some item needs (pack `req`) and the character isn't Exalted. `rep[]`: the rep a quest gives. Never on a drop list | snapshot only | `quests[].keep`, `keepWhy`, `dungeon`, `rep`; the brief's `quests[]` |
| Quests you can do, attunements and keys, ranked next steps (a quest the pack has twice, same title, zone, objective and rewards, counts once) | Overview (Now) | `nextSteps[]` |
| Talents and action bars, both specs (every slot: spell id, item, macro, key) | Talents & Bars | snapshot `spells.specs[].bars`; raw: the `now` record's `specs` (below) |
| **Spell ranks**: each spec's bar spells below the best rank in your spellbook (marked on the bar, listed above it; a low rank kept beside the best one on the same bars is left alone); from the class trainer's own list (read while its window is open: every rank it teaches, the level and cost, learned or not; weapon masters and pet trainers, which open the same window, are left out) the ranks to train now and the next ones. The game's list, so Forever's own spells and ranks are right. No trainer visited yet: bars are still checked, "to train" says to open the trainer once | Talents & Bars, Spell ranks (`js/spells.js`) | snapshot `spells` (`specs[].outdated`, `train[]`, `later[]`, `known[]`, `trainer.taken`) |
| Spellbook: every spell and rank the game lists in it (each bar slot also saves its own rank) | Talents & Bars (the rank check) | snapshot `spells.known[]`; raw: `now` record `snap.spellbook` |
| Macros (name and text), key bindings, buffs, currencies, gear sets, completed quests, weapon skills | Talents & Bars (macros), Character | raw only: the `now` record's `snap` (below) |
| Reputation | Reputation tab | `reputation[]` |
| Professions, recipes, cooldowns (Mooncloth, transmutes) | Professions tab | `professions[]`, `cooldowns[]` |
| Game-data pack age (rebuilt every Monday by `pack.yml`, merged by the build project when its checks pass) | System tab, and Overview when older than 14 days | `pack.built` |
| Item cooldowns (Salt Shaker, Hearthstone, on-use trinkets), read from the game's timers at each snapshot and when an item is used | Overview, Cooldowns list (with profession cooldowns; time left and the clock time, or "Ready now"), Now when ready | `cooldowns[]` (`item`); raw: `now` → `snap.itemCooldowns` |
| Flight paths per continent | Character tab | `flightPaths` |
| Journal: every event (loot, kills, XP, quests, zones, deaths, rep, skills, money, group, notes) | Journal tab | kind `journal` (`data->>'e'` = event) |

Every score comes from the app (`js/advice.js`, `js/gear.js`). Claude quotes them for every spec and never
scores by hand (CLAUDE.md, the scoring rule).

Weapons: a two-hander's gain is its score minus the main hand **and** the off hand it replaces; under a
worn two-hander the off hand shows as blocked (`blocked`) rather than as a loss, and a one-hander is
measured against the two-hander alone. The pre-BiS plan takes a one-hander plus off hand over a two-hander
when the pair scores higher. Held-in-off-hand items go in the off hand for anyone, shields only with the Shield skill (an item the
Forever client's tooltip calls a Shield counts as one, whatever subclass the pack gives it); one-hand and
off-hand weapons only with the Dual Wield skill (snapshot `skills`, or a Rogue), and then a one-hander is
measured in whichever hand it gains most.

Weapon DPS counts where the weapon hits: in full in the main hand, half for an off-hand weapon (off-hand
hits do half damage), and in the Ranged slot only for Hunters (profile weight `rdps`). Beast Mastery and
Marksmanship Hunters score their melee weapon on its stats alone; Survival counts both. A wand's DPS is not
scored. Hunters also count ranged attack power like attack power.

Which tree a spec is: the one with the most talent points (`gear[].tree`, `talentPoints`). With no points yet
(below level 10, or a second spec never set up) it is the tree the class levels in (Arms, Retribution, Beast
Mastery, Combat, Shadow, Frost, Affliction, Enhancement, Feral), not the first tree; a tie goes to that tree
when it is one of the tied ones. `gear[].weightsChosen` says which case applied. Every class and spec is
checked by `test/web/classes.test.js`.

## Everything saved, online: the `now` record

The snapshot is the app's summary, with its scores. **Everything the addon saved about the character is
online too**, in one `now` record per computer (replaced at each sync), so nothing is kept from Claude: when the
snapshot or the brief lacks a fact the addon records, read it there, and quote its time. Scores and
verdicts still come only from the snapshot (the scoring rule).

```sql
select id, to_timestamp(t) saved, jsonb_object_keys(data->'snap') part from private.history
 where account = '<account>' and kind = 'now' order by t desc;            -- one row per computer and part
select data->'snap'->'macros' from private.history
 where account = '<account>' and kind = 'now' order by t desc limit 1;    -- the newest computer's macros
```

| `now` part | Holds |
| --- | --- |
| `snap` | the last in-game read: `character`, `stats`, `equipped`, `bags` (every slot), `gearSets`, `talents`, `macros` (name, text), `bindings`, `spellbook` (every rank, spell id), `skills` (weapon and profession skill), `reputation`, `currencies`, `quests`, `completedQuests`, `group`, `buffs`, `activeSpec`, `taken`; `kept` lists parts kept from the read before at logout |
| `specs` | per talent group (1, 2): `talents` / `traits`, `actionBars` (slot, kind, id, name, key, macro text), `talentsTaken`, `barsTaken` |
| `trainer` | the class trainer's list when its window was last open: `services[]` {name, rank, status available / unavailable / used, level, cost}, `npc`, `level`, `taken` |
| `bank`, `mail`, `professions` | bank bags, mailbox, each profession's recipes and reagents, each with its `taken` |
| `taxi`, `taxiRead`, `ah` (`owned`, `lastScan`), `bossLog` | flight paths, your auctions, the last scan, the Dungeon Journal addon's boss log |

Not online: the addon's item cache (names and tooltips of items seen; the pack has the same facts) and its
`diag` counters (`caps` in the snapshot says what the game allows).

## Claude, sync, updates

**Start here: the brief.** `select private.claude_brief('<account>');` returns a few KB built from the
newest snapshot of any of the account's computers: `meta` (which computer, `ageMinutes`, `stale` over an
hour, the build, and each computer's newest build when they differ, how to quote), `character`, `specs[]` (the app's top 3 upgrades and 4 pre-BiS
still missing, every spec, with `upgradesTotal` / `preBisMissingTotal`), `quests[]` (`keep`/`dungeon`/`keepWhy`, each reward's `upgradeFor` specs, `unscored[]` = rewards the app has no score for; empty fields left out), `gold`
(`flips` = profit, `sales7d` = revenue and `buys7d`, both for every character of the account, `measured[]` = the app's gph for the 6 newest grinds and runs, each with its `start` for a card's src, and for grinds the `mobs` it killed as `"<name> ×<kills>"`), shortened in the default: no quest `level`, `keepWhy` as `rep: <faction +n>` or `step: <quest>` next to its dungeon, each `where` cut to its first clause;
`professions`, `cooldowns`, `caps`. More parts in full by name: `array['rep','bags','next','ah','runs']`
(or any default part, untrimmed). It selects; it computes nothing (`supabase/migrations/*_claude_brief.sql`).

| Feature | Where |
| --- | --- |
| **Game data in the database** (`game` schema, owner): every item, its sources, quests and chains, NPCs, vendors, instance rules, from the same pack as the app (loaded by `publish.yml` when the pack changes). Drop rates are labelled: `forever` = ForeverDB measured it on Forever kills, with a 95% range and the number of corpses; `classic` = a Classic rate, never a Forever one; `unknown` = seen on Forever (or only in Classic data), no rate. `game.quest` gives `keep` (dungeon, why, the chain step) by the app's own keep test, battlegrounds left out. Long lists say their size (`sourcesTotal`, `dropsTotal`). A new pack loads into a second copy and reads switch only when every row is there, so a failed load never leaves reads short. No source publishes mob resistances or respawn times for Forever: `game.npc` says so | `game.item`, `game.npc`, `game.quest`, `game.instance`, `game.drop_rates`, `game.status()` |
| What the game lets the addon read (`caps`): which APIs exist, which values are secret; at a loot window whether `GetLootSourceInfo` names the corpse of each slot (`caps.loot`); inside an instance whether GUIDs are readable (`caps.instance`); whether `LoggingCombat` can be read. Read-only probes: they change nothing in game | snapshot `caps`, the brief's `caps` |
| From Claude cards (Claude writes, the player ticks or closes); a card's `risk` shows as its own Risk line under the summary | From Claude tab, Overview; setting `cc.claude.cards`, choices in `cc.claude.cardsState` |
| **Install in one paste** (Windows or Mac): the text in `claude/SETUP.md`, pasted into a Claude desktop project's instructions, has Claude install the Companion (it runs, or hands the player, one PowerShell or Terminal line that downloads the public zip and runs its installer), ask for folder access and read the character; before every answer it sends Claude to `claude/GUIDE.md`, where every rule is. CI runs both lines on a real Windows and Mac | `claude/SETUP.md`; `.github/workflows/installers.yml` |
| The Claude kit for a friend's own Claude: `claude/GUIDE.md` (where the numbers are in `snapshot.json`, what it may write), `claude/SETUP.md` (their project, the text to paste), with COACHING.md, this file and the checkers, in every build | `AddOns/ClaudeCompanion/claude/` (`tools/publish-stable.py` `KIT`) |
| The card gate: online, `private.claude_put_setting` refuses a card list whose facts don't match their `src` (game data, the snapshot's grinds, runs and flips, the player's own AH scans), or that breaks the answer rules (rates without samples, profit not from flips, unmeasured duo claims, farm cards without `risk`, banned tips). Chat has no gate: `tools/check-answer.py` is Claude's self-check | `private.check_cards(<account>, <cards jsonb>)` lists the problems without writing |
| How Claude answers (every rule in one place: read the question literally, sources, cards, depth, routing, tone) and the **weekly correction audit**: a week's corrections counted by cause per 100 of the player's messages against the 12-22 Nov baseline. A rule, not a gate: the audit measures. It runs weekly by a scheduled task and keeps each week's log. Deep dives follow a written procedure with their check-ins scheduled up front | [COACHING.md](COACHING.md), [DEEP-DIVE.md](DEEP-DIVE.md); `python3 tools/audit.py <log.md>`, `docs/audit-baseline.json`; logs in project files `audit/` |
| Sync between computers (union of history, newest "now" per part); can be turned off per computer | System tab; [ARCHITECTURE.md](ARCHITECTURE.md) |
| Self-update from `stable` within ~30 min; the app says "type /reload" when the addon is older. Each computer checks on its own clock, so for up to ~30 min after a merge two computers can show different builds | System tab; `snapshot.app.build` (and `installedAt`) |

## Not tracked (say so; don't guess)

- Profit on anything not bought on the AH: crafted or farmed goods have no recorded cost.
- What a craft actually cost you (the Professions tab prices reagents at today's AH, not what you paid).
- Vendor purchases item by item (only the gold change, source `vendor`).
- Other players' sales, and AH sales whose letter was never opened.
- Anything since the last `/reload` or logout.
- Bank, mail, profession and AH-window data newer than the last time that window was open.
- Mob respawn times. Resistances only from the player's own combat log (snapshot `combat`), with its sample;
  no Forever source publishes them.
- Combat-log counts from a computer whose log was never read, or from before `/combatlog` was turned on.
