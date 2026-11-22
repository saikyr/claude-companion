# Architecture

```
 World of Warcraft Forever client
 ┌──────────────────────────────────────────┐
 │ ClaudeCompanion addon (Lua)              │   events, C_* APIs, tooltips,
 │  Core · Snapshot · Journal · Market ·    │   QuestieDB globals (if installed)
 │  Professions · UI · Inbox                │
 └───────────────┬──────────────────────────┘
                 │ on /cc sync (ReloadUI) or logout the game writes
                 ▼
 WTF/Account/<account>/SavedVariables/ClaudeCompanion.lua   (global ClaudeCompanionDB)
                 │ read directly, polled every 3 s via /api/stamp
                 ▼
 Local server on 127.0.0.1:47615  (web/server.ps1 on Windows, web/server.py on macOS)
   GET  /api/ping  /api/stamp  /api/data      POST /api/snapshot (needs header X-CC: 1)
                 │
                 ▼
 App (web/index.html + js/)  ── lua.js parses the save ── app.js / gear.js render tabs
   + web/data/gamedata.js (game-data pack: everything you haven't seen in game)
                 │ after each load, js/claude.js POSTs a summary
                 ▼
 ClaudeCompanion/companion-data/snapshot.json   ◀── what Claude reads first
```

Claude → player channel: `ClaudeCompanion/Inbox.lua` (`ClaudeCompanionInbox`), shown in the `/cc`
window after a `/reload`. A richer write channel (`companion-data/from-claude/`) is planned, not built.

## Addon modules

| File | Owns |
| --- | --- |
| `Core.lua` | Saved layout (`ClaudeCompanionDB`, schema 1), secret-value safety (`Clean`/`Copy`/`Pick`/`Call`), diagnostics (`Try` → `char.diag`), item and spell cache, event bus (`ns.On`), throttling (`ns.Soon`), character key, capability probe |
| `Snapshot.lua` | Full snapshot on login / logout / sync: character, stats, equipped, bags, gear sets, talents (C_ClassTalents / C_Traits, both specs), action bars, macros, bindings, spellbook, skills, reputation, currencies, quest log + rewards, completed quests, group, buffs |
| `Journal.lua` | Timeline (loot, kills, XP, quests, deaths, zones, money by source), sessions, grinds (`/cc start`), disenchant results |
| `Market.lua` | AH prices (browse, search, full scan via `C_AuctionHouse.ReplicateItems`), posts, owned auctions, mailbox + AH invoices (sales, buys) |
| `Professions.lua` | Recipes, reagents, cooldowns (window open + cast log), bank, flight paths, and `Enrich` (QuestieDB lookups when that addon is loaded) |
| `UI.lua` | `/cc` window, grind panel, slash commands, key bindings |

Every capture step runs inside `ns.Try`, so a blocked API on Forever never breaks the addon; the
System tab shows `diag` (what worked, what errored) and `caps` (which APIs exist, which values come
back secret).

Forever specifics found so far: no classic talent API (C_ClassTalents/C_Traits instead);
`UnitHealth`/`UnitPower` are secret; `GetRealmName()` returns ""; the spec-name call returns the
class name (the app names a spec by its biggest tree); the bank is readable only while open;
addons can't read the combat log.

## Data sources: one owner per kind of data

| Data | Owner | Notes |
| --- | --- | --- |
| Your character, items you've seen, your tooltips | **The game** (the addon) | Always wins over pack data |
| Quests, NPCs, objects, givers / turn-ins, quest-item drops, vendors, quest XP | **QuestieDB** (Forever flavor) | Built from a Wowhead Forever snapshot + QuestieTrace. Lists drops only for quest items |
| Weapon / armor tooltips and stats, "how to get it", group size | **endgametools** Forever item pages | Matched the game on all 48 items checked |
| Drop chances, Forever sightings, general loot, crafted-by, icons, reward split, reward money | **ForeverDB** | Crowd uploads. Only a few hundred rates are Forever-measured; the rest are labelled Classic |
| AH prices | **Your own scans** (`/cc scan`, browsing) | Per character, per realm you scan on. External sites are only a sanity check |
| Disenchant tables | warcraft.wiki.gg (in `app.js`) | Classic tables; the addon also learns your real results |

Wowhead is not pulled in bulk (bot wall / ToS). Pack build: `gamedata/build.sh`; coverage:
`gamedata/COVERAGE.md`.

## Contracts

1. **`ClaudeCompanionDB`** (SavedVariables, `schema = 1`): layout at the top of `Core.lua`. The app
   tolerates missing fields; new fields can appear any time.
2. **`snapshot.json`** (`schema = 1`): `ClaudeCompanion/companion-data/SCHEMA.md`. Bump `schema`
   only when a field changes meaning or is removed. Claude reads this before the raw save.
3. **`gamedata.js`**: positional arrays per item; schema documented at the top of `gamedata/build.py`.
4. **Local HTTP API**: the four endpoints above. Same on both servers; keep them identical.

## Where things live on a computer

| What | Path |
| --- | --- |
| Addon + app | `_forever_/Interface/AddOns/ClaudeCompanion/` |
| Raw save | `_forever_/WTF/Account/<account>/SavedVariables/ClaudeCompanion.lua` |
| Claude snapshot | `_forever_/Interface/AddOns/ClaudeCompanion/companion-data/snapshot.json` |
| App settings (gear weights, picks) | the browser's `localStorage` for `http://localhost:47615` |

The server finds `_forever_` as four folders up from `web/`, and uses the newest
`ClaudeCompanion.lua` under any account. The app shows the character synced most recently.
