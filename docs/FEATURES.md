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
- Windows the game only shows while open (bank, mailbox, AH, profession windows, flight map) are read
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
| Craft profit | each recipe's reagent cost and its output's value at your AH prices, after the AH cut | Professions tab ("Makes a profit") | not in the snapshot: say so, or read the recipe and the prices |
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
| Sessions | the same counters from login to logout, automatic | kind `session` | `kind = 'session'` |
| **Dungeon and raid runs** | automatic from entering an instance: time inside, kills, bosses, wipes, deaths, XP, quests, coin, loot (green+), loot value, group, loot that went to others with the rolls. Ends after 15 min outside, another instance, a reset, or away. Runs from before the addon tracked runs are rebuilt from the journal (`fromJournal: true`, no `run` row; their bosses come from the Dungeon Journal addon's log, synced to every computer) | kind `run`; Dungeons tab | snapshot `runs[]` (10); all: `kind = 'run'` plus, for `fromJournal` runs, the journal |

## Character, gear and quests

| Feature | Where | Claude reads (snapshot) |
| --- | --- | --- |
| Character: level, XP, gold, position, hearth, stats, equipped | Character tab | `character`, `equipped[]` |
| Bags and bank, with a verdict per item (upgrade, disenchant, AH, sell, ask) | Bags & Bank | `bagAdvice[]` |
| Gear per spec: worn, upgrades, AH upgrades, rolls to search, pre-BiS with alternatives, class sets | Gear tab | `gear[]` (one per spec), `bestOwned[]` |
| Stat weights per spec, own profiles | Stat weights tab | `gear[].weightValues`, `weightProfiles[]` |
| Quest log with every reward scored for every spec, and the chain's next quest | Quests tab | `quests[]` (`rewards[].specs[]`, `next`) |
| Quests to keep: `keep: true` with `keepWhy` and `dungeon` when the quest or any step of its chain is a pack `Dungeon` quest, has its quest zone or objective in an instance, or is a step of a key or attunement (`rules.js` unlocks: the Skeleton Key, the Seal of Ascension...); also when it gives rep with a faction some item needs (pack `req`) and the character isn't Exalted. `rep[]`: the rep a quest gives. Never on a drop list | snapshot only | `quests[].keep`, `keepWhy`, `dungeon`, `rep`; the brief's `quests[]` |
| Quests you can do, attunements and keys, ranked next steps | Overview (Now) | `nextSteps[]` |
| Talents and action bars, both specs | Talents & Bars | save only (`specs`) |
| Reputation | Reputation tab | `reputation[]` |
| Professions, recipes, cooldowns (Mooncloth, transmutes) | Professions tab | `professions[]`, `cooldowns[]` |
| Flight paths per continent | Character tab | `flightPaths` |
| Journal: every event (loot, kills, XP, quests, zones, deaths, rep, skills, money, group, notes) | Journal tab | kind `journal` (`data->>'e'` = event) |

Every score comes from the app (`js/advice.js`, `js/gear.js`). Claude quotes them for every spec and never
scores by hand (CLAUDE.md, the scoring rule).

## Claude, sync, updates

**Start here: the brief.** `select private.claude_brief('<account>');` returns a few KB built from the
newest snapshot of any of the account's computers: `meta` (which computer, `ageMinutes`, `stale` over an
hour, each computer's newest build, how to quote), `character`, `specs[]` (the app's top 3 upgrades and 4 pre-BiS
still missing, every spec, with `upgradesTotal` / `preBisMissingTotal`), `quests[]` (`keep`/`dungeon`/`keepWhy`, each reward's `upgradeFor` specs; empty fields left out), `gold`
(`flips` = profit, `sales7d` = revenue and `buys7d`, both for every character of the account, `measured[]` = the app's gph for the 6 newest grinds and runs, each with its `start` for a card's src, and for grinds the `mobs` it killed),
`professions`, `cooldowns`, `caps`. More parts in full by name: `array['rep','bags','next','ah','runs']`
(or any default part, untrimmed). It selects; it computes nothing (`supabase/migrations/*_claude_brief.sql`).

| Feature | Where |
| --- | --- |
| **Game data in the database** (`game` schema, owner): every item, its sources, quests and chains, NPCs, vendors, instance rules, from the same pack as the app (loaded by `publish.yml` when the pack changes). Drop rates are labelled: `forever` = ForeverDB measured it on Forever kills, with a 95% range and the number of corpses; `classic` = a Classic rate, never a Forever one; `unknown` = seen on Forever (or only in Classic data), no rate. `game.quest` gives `keep` (dungeon, why, the chain step) by the app's own keep test, battlegrounds left out. Long lists say their size (`sourcesTotal`, `dropsTotal`). A new pack loads into a second copy and reads switch only when every row is there, so a failed load never leaves reads short. No source publishes mob resistances or respawn times for Forever: `game.npc` says so | `game.item`, `game.npc`, `game.quest`, `game.instance`, `game.drop_rates`, `game.status()` |
| What the game lets the addon read (`caps`): which APIs exist, which values are secret; at a loot window whether `GetLootSourceInfo` names the corpse of each slot (`caps.loot`); inside an instance whether GUIDs are readable (`caps.instance`); whether `LoggingCombat` can be read. Read-only probes: they change nothing in game | snapshot `caps`, the brief's `caps` |
| From Claude cards (Claude writes, the player ticks or closes) | From Claude tab, Overview; setting `cc.claude.cards`, choices in `cc.claude.cardsState` |
| The card gate: online, `private.claude_put_setting` refuses a card list whose facts don't match their `src` (game data, the snapshot's grinds, runs and flips, the player's own AH scans), or that breaks the answer rules (rates without samples, profit not from flips, unmeasured duo claims, farm cards without `risk`, banned tips). Chat has no gate: `tools/check-answer.py` is Claude's self-check | `private.check_cards(<account>, <cards jsonb>)` lists the problems without writing |
| Sync between computers (union of history, newest "now" per part); can be turned off per computer | System tab; [ARCHITECTURE.md](ARCHITECTURE.md) |
| Self-update from `stable` within ~30 min; the app says "type /reload" when the addon is older. Each computer checks on its own clock, so for up to ~30 min after a merge two computers can show different builds | System tab; `snapshot.app.build` (and `installedAt`) |

## Not tracked (say so; don't guess)

- Profit on anything not bought on the AH: crafted or farmed goods have no recorded cost.
- What a craft actually cost you (the Professions tab prices reagents at today's AH, not what you paid).
- Vendor purchases item by item (only the gold change, source `vendor`).
- Other players' sales, and AH sales whose letter was never opened.
- Anything since the last `/reload` or logout.
- Bank, mail, profession and AH-window data newer than the last time that window was open.
