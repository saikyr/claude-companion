# Architecture

## The whole picture: build and ship

```
 developers (people, Claude sessions)            GitHub, private: saikyr/claude-companion
 ─ change code on a branch, open a PR ─────────▶  checks.yml: harness, merge rules, self-update
                                                  end-to-end test, syntax, no personal data
 ─ a person merges the PR to main  ────────────▶  publish.yml (after checks pass on main):
                                                  tools/publish-stable.py → branch "stable"
                                                  (+ optional public download repo for friends)
                                                                │
          ┌─────────────────────────────────────────────────────┘ every 30 min, each computer
          ▼
 Each computer: AddOns/ClaudeCompanion  (the addon + the app + its local server)
   server checks "stable" → downloads → checks every file's SHA-256 (BUILD.json) → backs up →
   installs → restarts. companion-data/ and the game's saves are never written. Then /reload in game.
```

**Principles**

1. **Nothing is installed by hand or by an agent.** Code reaches a computer only through the
   updater, from a build that passed CI and that a person merged. The merge is the approval.
2. **One mechanism for everyone.** Gabriel's PC and Mac and a friend's computers use the same updater.
3. **The game owns its saves.** Each computer's `SavedVariables` is written by the game and only read
   by the app.
4. **One writer per file.** The updater writes the addon folder (never `companion-data/`); the page
   writes `snapshot.json` and `settings.json`; Claude writes `from-claude/cards.json`.
5. **Verify before you touch.** Builds are checked file by file against `BUILD.json`; a backup is made
   before every install.

### Delivery: builds and updates

| Piece | What it does |
| --- | --- |
| `.github/workflows/checks.yml` | On every push and PR: addon harness (mock game API), merge-rule tests, self-update end-to-end test (mock GitHub, both servers on Windows), syntax, no personal data |
| `.github/workflows/publish.yml` | After the checks pass on `main`: `tools/publish-stable.py` |
| `tools/publish-stable.py` | Copies `ClaudeCompanion/` (with the game-data pack) to the `stable` branch with `BUILD.json` (version, source commit, every file's SHA-256) and `web/channel.json` (where this build keeps updating from). One commit per build. Never packs personal data |
| Public download repo (optional) | Set the repository variable `DIST_REPO` and secret `DIST_TOKEN`: the same build also goes to a public repo, whose builds point their updater at it. Friends need no GitHub account or token |
| Updater (`server.py` / `server.ps1`, `/api/update`) | Every 30 min: newest commit of the channel's `stable`. Auto-install (default) or the app's Install button. Download the zipball → reject unsafe paths → check every file against `BUILD.json` → back up the addon folder (last 5) → copy over (never `companion-data/`) → `installed.json` → restart |
| `tools/install.sh` | First install on a Mac (or repair). Afterwards the Mac updates itself |
| Windows first install | Unzip into AddOns, double-click `Claude Companion.bat` once |

The private repository needs a token to read: `gh auth token` (GitHub CLI signed in), or
`companion-data/update.json` `"token"`. Builds from the public download repo need none.
Verified for real on Gabriel's PC on 22 Nov: the app installed build `d7dd338` from `stable` by itself
(36 files, checksums matched, backup made, server restarted).

### Today: one save per computer

Each computer has its own save and its own `snapshot.json`; the snapshot says which computer wrote it
(`device`). The addon ends a grind or dungeon run that was left running when you come back after
playing elsewhere (`ended: "away"`), so a stale tracker from the other computer never runs on.
There is no sync between computers yet.

## Planned: sync through a hosted backend (not built)

A real account-based backend, so any person with any number of computers sees one character, and
Claude can read it without a session on anyone's computer. Proposed: **Supabase** (Auth + Postgres
with row-level security + an API), because it is hosted, free at this size, and already connected to
this project. Not created yet: it starts when Gabriel says go.

**Accounts and security**
- Sign-in from the app: email magic link or Discord (Supabase Auth). The app keeps the user's
  session token locally (`companion-data/`), never a service key: the client only has the public
  anon key, and every table has row-level security `user_id = auth.uid()`.
- Claude reads Gabriel's data through the Supabase connector (his project), read-only by default.

**Schema (Postgres)**

| Table | Key | What |
| --- | --- | --- |
| `characters` | id, user_id, name, realm | One row per character |
| `devices` | id, user_id, name, os, last_seen | Each computer that syncs |
| `snapshots` | character_id, device_id, taken | The latest "now" state per part (bags, gear, bank, professions, specs, flight paths) with its own time; newest wins |
| `events` | character_id, device_id, t, kind, n | The journal: append only; unique on (character, device, t, kind, n) where n numbers identical events in one second, so re-sending is harmless |
| `trackers` | character_id, kind (session/grind/run), start, device_id | Sessions, grinds, dungeon runs; upsert by (character, kind, start, device) |
| `ah_observations` | character_id, item_key, t, src | Price history; append only |
| `ah_records` | character_id, kind (sale/buy/post), t, item | AH ledger; append only |
| `settings` | user_id, key | App settings; per key, last writer wins with its time |

**Sync protocol**
- After each save in game, the local server parses the save (it already ships the same parser the
  page uses) and sends only what is new since its last acknowledged position per table (deltas),
  batched, to a Postgres function (`sync_push`) that upserts idempotently. Ids are the natural keys
  above, so a retry or an offline backlog never duplicates.
- To show the character, the app asks for the merged view (`sync_pull` since a time): the union of
  history, the newest "now" parts, trackers ended "away" by the same rule as `js/merge.js` (the merge
  rules are already written and tested there, on a real save).
- **Offline:** the app always works from the local save; unsent deltas wait in `companion-data/` and
  go when the network is back. Nothing in the game depends on the backend.
- **Conflicts:** history is append-only (no conflicts); "now" parts and settings carry their own
  times (newest wins); trackers are keyed by start time and device.

**Cost (Supabase pricing page, read 22 Nov 2026)**
- Free plan: 500 MB database per project, 50,000 monthly active users, 5 GB egress, 1 GB file
  storage, 500,000 edge function invocations, 2 active projects. Free projects **pause after one week
  without activity** (they resume when opened; a scheduled ping or regular play avoids it).
- Gabriel's save is about 5 MB raw; as rows (journal events, price history) a character is well
  under 50 MB, so a handful of players fit the free plan. Daily backups are not in the free plan.
- Next step up: Pro, from $25 a month (no pausing, backups).

**What it would take:** the schema and RLS policies (one migration), sign-in in the app, the delta
push/pull in both servers, and the merge on the server side (from `js/merge.js`). Until then each
computer keeps working on its own save, as today.

## On one computer: addon, save, local app

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
 Local server on 127.0.0.1:47615  (web/server.ps1 on Windows, web/server.py on macOS),
   started at login, hidden: a Startup-folder shortcut (Windows) / a LaunchAgent (macOS),
   set up by Claude Companion.bat / Claude Companion.app. The page installs as its own app (PWA).
   GET  /api/ping  /api/stamp  /api/data      POST /api/snapshot (needs header X-CC: 1)
                 │
                 ▼
 App (web/index.html + js/)  ── lua.js parses the save ── app.js / gear.js render tabs
   + web/data/gamedata.js (game-data pack: everything you haven't seen in game)
                 │ after each load, js/claude.js POSTs a summary (an open window, or the
                 │ server's hidden headless Chrome/Edge after a save while the app is closed)
                 ▼
 ClaudeCompanion/companion-data/snapshot.json   ◀── what Claude reads first
```

Claude → player channel: **From Claude cards** (`js/cards.js`). Claude writes
`companion-data/from-claude/cards.json` (one format for farms, flips, quests, gear...; checked with
`tools/check-cards.py`); the app polls it through the server every 5 s and saves the player's
done / dismissed / ticked steps to `from-claude/state.json`, which Claude reads back. One writer per
file. Format: `companion-data/SCHEMA.md`. The older `Inbox.lua` message (shown in the `/cc` window
after a `/reload`) still works for a note inside the game.

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
