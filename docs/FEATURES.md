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
| **Grinds** (`/cc start <name>`, `/cc stop`) | counted time (pauses and logged-out time left out), kills (by mob), looted coin, loot, XP, deaths, rep, disenchants, zones. Ends by itself at logout, after 30 min with nothing counted (`idle`), or `away`. Shows after the next `/reload` | kind `grind` (running one: kind `live`); Grinds tab | snapshot `grind.running`, `grind.recent[]` (5); all: `kind = 'grind'` |
| Grind gold per hour | `(looted coin + loot at today's AH median, else vendor price) / counted hours`. Loot value is what it would sell for, not what it sold for | Grinds tab, From Claude cards with `track` | compute from the record the same way, or quote the Grinds tab |
| Sessions | the same counters from login to logout, automatic | kind `session` | `kind = 'session'` |
| **Dungeon and raid runs** | automatic from entering an instance: time inside, kills, bosses, wipes, deaths, XP, quests, coin, loot (green+), loot value, group, loot that went to others with the rolls. Ends after 15 min outside, another instance, a reset, or away | kind `run`; Dungeons tab | snapshot `runs[]` (10); all: `kind = 'run'` |

## Character, gear and quests

| Feature | Where | Claude reads (snapshot) |
| --- | --- | --- |
| Character: level, XP, gold, position, hearth, stats, equipped | Character tab | `character`, `equipped[]` |
| Bags and bank, with a verdict per item (upgrade, disenchant, AH, sell, ask) | Bags & Bank | `bagAdvice[]` |
| Gear per spec: worn, upgrades, AH upgrades, rolls to search, pre-BiS with alternatives, class sets | Gear tab | `gear[]` (one per spec), `bestOwned[]` |
| Stat weights per spec, own profiles | Stat weights tab | `gear[].weightValues`, `weightProfiles[]` |
| Quest log with every reward scored for every spec, and the chain's next quest | Quests tab | `quests[]` (`rewards[].specs[]`, `next`) |
| Quests you can do, attunements and keys, ranked next steps | Overview (Now) | `nextSteps[]` |
| Talents and action bars, both specs | Talents & Bars | save only (`specs`) |
| Reputation | Reputation tab | `reputation[]` |
| Professions, recipes, cooldowns (Mooncloth, transmutes) | Professions tab | `professions[]`, `cooldowns[]` |
| Flight paths per continent | Character tab | `flightPaths` |
| Journal: every event (loot, kills, XP, quests, zones, deaths, rep, skills, money, group, notes) | Journal tab | kind `journal` (`data->>'e'` = event) |

Every score comes from the app (`js/advice.js`, `js/gear.js`). Claude quotes them for every spec and never
scores by hand (CLAUDE.md, the scoring rule).

## Claude, sync, updates

| Feature | Where |
| --- | --- |
| From Claude cards (Claude writes, the player ticks or closes) | From Claude tab, Overview; setting `cc.claude.cards`, choices in `cc.claude.cardsState` |
| Sync between computers (union of history, newest "now" per part); can be turned off per computer | System tab; [ARCHITECTURE.md](ARCHITECTURE.md) |
| Self-update from `stable` within ~30 min; the app says "type /reload" when the addon is older | System tab; `snapshot.app.build` |

## Not tracked (say so; don't guess)

- Profit on anything not bought on the AH: crafted or farmed goods have no recorded cost.
- What a craft actually cost you (the Professions tab prices reagents at today's AH, not what you paid).
- Vendor purchases item by item (only the gold change, source `vendor`).
- Other players' sales, and AH sales whose letter was never opened.
- Anything since the last `/reload` or logout.
- Bank, mail, profession and AH-window data newer than the last time that window was open.
