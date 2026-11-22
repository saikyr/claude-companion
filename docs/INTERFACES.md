# Interfaces

Every place two parts of Claude Companion meet: who owns it, what goes across, which version, and what
checks it. When a change crosses one of these lines, the owner's file changes first and the check below
must pass. How the parts work inside: [ARCHITECTURE.md](ARCHITECTURE.md).

## Is Claude part of the app?

**No. The app is complete without Claude.** The addon, the local app, its scores and advice, sync
between computers and the updates all work with no Claude project at all. Every number the app shows
(gear scores, upgrades, pre-BiS targets, bag verdicts, quest reward scores, gold per hour) is computed
by the app itself, on the player's computer.

**Claude is an optional advisor on top.** It reads what the app computed (the snapshot) and writes
suggestions back (From Claude cards). It never computes a second version of something the app already
computes: if the app's answer is missing or wrong, the fix goes into the app, so the app and Claude can
never disagree. How to set up a Claude project: [CLAUDE-PROJECT.md](CLAUDE-PROJECT.md).

## The map

```
 game client ──(1)──▶ SavedVariables ──(2)──▶ local server ──(3)──▶ app page ──(4)──▶ snapshot.json
                                              ▲                    │   ▲               │
                             updates (7)      │                    │   │ cards (6)     │
 GitHub main ─▶ publish.yml ─▶ download folder┘          sync (5)  ▼   │               │
                                                       Supabase account ◀──────────────┘
                                                              ▲   │
                                                   reads (6)  │   │ writes cards (6)
                                                         Claude (optional)
```

| # | Interface | Owner (the one place it is defined) | What goes across | Version | Checked by |
| --- | --- | --- | --- | --- | --- |
| 1 | Game → save | `ClaudeCompanion/Core.lua` (layout at the top) | the global `ClaudeCompanionDB`, written by the game at `/reload` and logout. The app only reads it | `ns.SCHEMA` (`schema = 1`) | `test/harness.lua` (mock game API), `contract.test.js` |
| 2 | Save → page | `js/lua.js`, `js/merge.js` | the Lua file as text, parsed in the page. A Lua list 1..n arrives as a JS array 0..n-1; anything the game numbers (specs 1 and 2, bag ids) is re-keyed to the game's numbers once, in `merge.js` | follows 1 | `merge.test.js` |
| 3 | Local HTTP API | `web/server.py` (Mac) and `web/server.ps1` (Windows), identical | `/api/*` on `127.0.0.1:47615`; writes need the header `X-CC: 1`; the page writes only its own files in `companion-data/` | | `contract.test.js` (same paths, same writable files, page calls only those), `server-api.test.js` on both servers |
| 4 | Page → snapshot | `js/claude.js` writes, `companion-data/SCHEMA.md` documents | `companion-data/snapshot.json`: what the app shows, with its own scores for every spec | `SCHEMA = 1` | `contract.test.js` (schema agrees), `gear-browser.js`, `advice.test.js` |
| 5 | Sync | `supabase/migrations/` (`cc_*` functions), client `js/sync.js` | history records (union of every computer), one `snapshot` row per computer, `now` rows, settings (`cc.*`, newest wins) | migration file name; additive only | `sync.test.js` and `sync-browser.js` on a real Postgres; `contract.test.js` (every `cc_*` call exists, no merged migration edited) |
| 6 | Claude ↔ app | [CLAUDE.md](../CLAUDE.md) (the agent guide); formats in `companion-data/SCHEMA.md` | **reads** the snapshot (online: `private.history`, or `snapshot.json` on the computer); **writes** From Claude cards (online: `private.claude_put_setting` → setting `cc.claude.cards`, or `from-claude/cards.json`); **reads back** the player's choices (`cc.claude.cardsState` / `from-claude/state.json`) | cards `schema 1` | `claude.test.js` (real Postgres), `tools/check-cards.py`, `contract.test.js` (card fields agree) |
| 7 | Builds and updates | `tools/publish-stable.py`, `supabase/functions/publish-build`, the servers' updater | `stable` branch + `latest.json` and zips in the public download folder; `BUILD.json` lists every file's SHA-256 | build = source commit | `update_test.py` (both servers, both channels), `installers.yml` (real Windows and macOS) |

## Contracts in detail

The parts update separately (the addon's Lua at a `/reload`, the page when its window reloads, the
backend once for everyone), so each contract has one owner, one version, and a CI check
(`test/contract.test.js`, the first step of `checks.yml`) that fails when two sides disagree.

| Contract | Owner | Version | Rules | Checked |
| --- | --- | --- | --- | --- |
| Addon version | `ClaudeCompanion.toc` `## Version` | semver | `Core.lua` `ns.VERSION` and the newest `CHANGELOG.md` section say the same | versions agree |
| Build | `tools/publish-stable.py` | source commit | stamps `Core.lua` `ns.BUILD` and writes `web/channel.json` `build`; the addon saves `addonBuild`, the servers report both (`/api/update` `builds`), and the app says "type /reload" while they differ | one `ns.BUILD = "dev"` line, update test |
| **`ClaudeCompanionDB`** (SavedVariables, `schema = 1`) | `Core.lua` (layout at the top) | `ns.SCHEMA` | new fields any time, readers tolerate missing ones; bump only when a field changes meaning | schema agrees here and in `Core.lua` |
| Lua tables in the page | `js/lua.js` | | a Lua table keyed 1..n arrives as a JS array (index 0..n-1). Anything the game numbers is re-keyed once, where the save is read (`specsByGroup`, `js/merge.js`), never offset by hand elsewhere | `merge.test.js` (specs keep 1 and 2) |
| **`snapshot.json`** | `js/claude.js` writes, `companion-data/SCHEMA.md` documents | `schema = 1` | bump only when a field changes meaning or is removed. Scores in it come from the app's one engine (`js/advice.js`, `js/gear.js`) | schema agrees |
| Scores | `js/advice.js` (`measure`, `rate`) with `js/gear.js` (`baseline`, weights from `js/weights.js`) | | one engine for Bags, Gear, the Quest log and the snapshot. No other file and no Claude session scores gear | `advice.test.js` |
| `gamedata.js` | `gamedata/build.py` (schema at its top) | pack date | one source per domain ([ARCHITECTURE.md](ARCHITECTURE.md), Data sources) | "Game data complete" |
| `Drops.lua` (the pack's Forever-measured drop chances, for the in-game grind panel) | `tools/make-drops.py`, from `gamedata.js` `src` | pack date | generated, never edited; written again whenever the pack changes | "Drops.lua matches the pack" (`make-drops.py --check`) |
| Local HTTP API | `server.py` and `server.ps1`, identical | | the endpoints in ARCHITECTURE, plus the files the page keeps in `companion-data/` | same paths, the page calls only those, the same files writable; `server-api.test.js` on both |
| Sync backend | `supabase/migrations/` (`cc_*` functions) | migration file name | additive only; a migration on `main` is never edited (the live database already ran it): changes go in a new file. Every record's `id` is its content's identity (`js/sync.js`), so the same event from two computers is one record | every call in `js/sync.js` is defined; no merged migration edited |
| Claude's cards | `companion-data/SCHEMA.md` (fields), `tools/check-cards.py` (checker) | `schema 1` | Claude writes cards only; the app writes the player's choices only. Online only the key `cc.claude.cards` can be written by Claude | card fields agree in SCHEMA.md and the checker; `claude.test.js` |
| Installed files | `BUILD.json` | build | the updater copies exactly the build's files and removes what an older build had (outside `companion-data/`) | `update_test.py` on both servers |

## Who writes what

One writer per file or record, so nothing is overwritten by someone else:

| Thing | Only writer |
| --- | --- |
| `SavedVariables/ClaudeCompanion.lua` | the game (the addon) |
| `AddOns/ClaudeCompanion/` outside `companion-data/` | the updater (or the first-install installer) |
| `companion-data/snapshot.json`, `settings.json`, `sync.json`, `sync-cache.json`, `from-claude/state.json` | the app page (through the local server) |
| `companion-data/from-claude/cards.json`, account setting `cc.claude.cards` | Claude |
| Supabase records | `cc_push` (the app), and `private.claude_put_setting` for Claude's cards |
| `stable` branch, download folder | `publish.yml` only, after CI passes on `main` |
