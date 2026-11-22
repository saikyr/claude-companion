# Architecture

## The whole picture: build, ship, sync

```
 developers (people, Claude sessions)            GitHub, private: saikyr/claude-companion
 ─ change code on a branch, open a PR ─────────▶  checks.yml: harness, merge rules, self-update and
                                                  sync end-to-end tests, syntax, no personal data
 ─ a person merges the PR to main  ────────────▶  publish.yml (after checks pass on main):
                                                  tools/publish-stable.py → branch "stable"
                                                  (+ optional public download repo for friends)
                                                                │
          ┌─────────────────────────────────────────────────────┘ every 30 min, each computer
          ▼
 Each computer: AddOns/ClaudeCompanion  (the addon + the app + its local server)
   server checks "stable" → downloads → checks every file's SHA-256 (BUILD.json) → backs up →
   installs → restarts. companion-data/ and the game's saves are never written. Then /reload in game.
          │
          │ the game writes this computer's save; the server reads it
          ▼
 Cloud drive the person's computers already share (Google Drive for desktop, OneDrive, Dropbox,
 iCloud Drive) — chosen once in the app:
   <drive>/Claude Companion/<computer>/  save.lua.gz · settings.json · snapshot.json.gz · meta.json
          │ each computer writes only its own subfolder, reads the others'
          ▼
 The app merges this computer's save with the others' (js/merge.js) → one character →
 shows it, and writes companion-data/snapshot.json (also copied to the drive, where Claude reads it)
```

**Principles**

1. **Nothing is installed by hand or by an agent.** Code reaches a computer only through the
   updater, from a build that passed CI and that a person merged. The merge is the approval.
2. **One mechanism for everyone.** Gabriel's PC and Mac and a friend's computers use the same
   updater and the same sync. Nothing is special-cased for one person.
3. **The game owns its saves.** Each computer's `SavedVariables` is written by the game and only
   read by the app. Sharing happens one level up, in files the app owns.
4. **One writer per file.** The updater writes the addon folder (never `companion-data/`). Each
   computer writes only its own subfolder in the sync folder. The page writes `snapshot.json` and
   `settings.json`. Claude writes `from-claude/cards.json`.
5. **Verify before you touch.** Builds are checked file by file against `BUILD.json`. Synced saves
   are checked against the SHA-256 in `meta.json`, which is written last, so a half-synced file is
   never taken. Backups are made before every install.

### Delivery: builds and updates

| Piece | What it does |
| --- | --- |
| `.github/workflows/checks.yml` | On every push and PR: addon harness (mock game API), merge-rule tests, self-update and sync end-to-end tests (mock GitHub, temp folders, both servers), syntax, no personal data |
| `.github/workflows/publish.yml` | After the checks pass on `main`: `tools/publish-stable.py` |
| `tools/publish-stable.py` | Copies `ClaudeCompanion/` (with the game-data pack) to the `stable` branch with `BUILD.json` (version, source commit, every file's SHA-256) and `web/channel.json` (where this build keeps updating from). One commit per build. Never packs personal data |
| Public download repo (optional) | Set the repository variable `DIST_REPO` and secret `DIST_TOKEN`: the same build also goes to a public repo, whose builds point their updater at it. Friends need no GitHub account or token |
| Updater (`server.py` / `server.ps1`, `/api/update`) | Every 30 min: newest commit of the channel's `stable`. Auto-install (default) or the app's Install button. Download the zipball → reject unsafe paths → check every file against `BUILD.json` → back up the addon folder (last 5) → copy over (never `companion-data/`) → `installed.json` → restart |
| `tools/install.sh` | First install on a Mac (or repair). Afterwards the Mac updates itself |
| Windows first install | Unzip into AddOns, double-click `Claude Companion.bat` once |

The private repository needs a token to read: `gh auth token` (GitHub CLI signed in), or
`companion-data/update.json` `"token"`. Builds from the public download repo need none.

### Sync: one character on every computer

The game writes a separate save per computer, so the saves are never merged on disk. Instead:

- **Store:** a `Claude Companion` folder in a cloud drive the computers already sync, chosen once in
  the app (it lists Google Drive, OneDrive, Dropbox and iCloud Drive when it finds them). Kept in
  `companion-data/update.json` as `"sync": {"folder": ...}`. Off until chosen.
- **Write:** after each save in game (10 s quiet), the server writes `save.lua.gz`, `settings.json`,
  `snapshot.json.gz` and finally `meta.json` (device, OS, save time, SHA-256) into its own subfolder.
- **Read:** it copies the other subfolders' saves into `companion-data/devices/<computer>/`, only
  when complete (the SHA-256 matches).
- **Merge** (`js/merge.js`, tested by `test/web/merge.test.js` on a real save):
  - History (journal, sessions, grinds, runs, notes, AH sales/buys/posts, price history, disenchants)
    is the union of all saves, in time order. Identical events in one save stay separate, so nothing
    is lost or doubled. Entries from another computer carry `dev`.
  - What's current (bags, gear, gold, bank, mail, professions, specs, flight paths) comes from the
    computer that saw it last.
  - A grind or run still running on a computer you then stopped using is shown as ended "away", the
    same rule the addon applies at login.
  - Settings follow the computer where they changed last. The replaced file is kept as `settings.json.bak`.
- **Claude** reads the merged `snapshot.json.gz` from the sync folder (for Gabriel, through his Google
  Drive connector), so routine reads need no session on his computer.
- **Pluggable:** a store is three operations (`put` its own files, list `versions`, `get` another
  computer's files). A hosted store could be added later without touching the merge.

### For friends

1. Download the latest build from the public download repo (a zip of `ClaudeCompanion/`), unzip into
   AddOns, run `Claude Companion.bat` (Windows) or `Claude Companion.app` (Mac) once.
2. The app updates itself from the public repo. No GitHub account.
3. Optional: pick their own cloud drive in the app to share their character between their computers.
   Their data never goes near anyone else's.

Still to do: the public download repository itself (creating it is Gabriel's call), and a
first-run page that walks through the game folder and the drive in one screen.

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
