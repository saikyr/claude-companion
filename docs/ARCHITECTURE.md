# Architecture

## The whole picture: build and ship

```
 developers (people, Claude sessions)            GitHub, private: saikyr/claude-companion
 ─ change code on a branch, open a PR ─────────▶  checks.yml: harness, merge rules, self-update
                                                  end-to-end test, syntax, no personal data
 ─ a person merges the PR to main  ────────────▶  publish.yml (after checks pass on main):
                                                  tools/publish-stable.py → branch "stable"
                                                  + zips and latest.json to the public download
                                                  folder (Supabase Storage "releases")
                                                                │
          ┌─────────────────────────────────────────────────────┘ every 30 min, each computer
          ▼
 Each computer: AddOns/ClaudeCompanion  (the addon + the app + its local server)
   server checks latest.json → downloads → checks every file's SHA-256 (BUILD.json) → backs up →
   installs → restarts. companion-data/ and the game's saves are never written. Then /reload in game.
```

**Principles**

1. **Nothing is installed by hand or by an agent.** Code reaches a computer only through the
   updater, from a build that passed CI and that a person merged. The merge is the approval.
2. **One mechanism for everyone.** Every computer, yours or a friend's, uses the same updater.
3. **The game owns its saves.** Each computer's `SavedVariables` is written by the game and only read
   by the app.
4. **One writer per file.** The updater writes the addon folder (never `companion-data/`); the page
   writes `snapshot.json`, `settings.json`, `sync.json` and `sync-cache.json`; Claude writes only its cards.
5. **Verify before you touch.** Builds are checked file by file against `BUILD.json`; a backup is made
   before every install.

### Delivery: builds and updates

| Piece | What it does |
| --- | --- |
| `.github/workflows/checks.yml` | On every push and PR: addon harness (mock game API), merge-rule tests, self-update end-to-end test (mock GitHub, both servers on Windows), syntax, no personal data |
| `.github/workflows/publish.yml` | After the checks pass on `main`: `tools/publish-stable.py` |
| `tools/publish-stable.py` | Copies `ClaudeCompanion/` (with the game-data pack) to the `stable` branch with `BUILD.json` (version, source commit, every file's SHA-256) and `web/channel.json` (where this build keeps updating from). One commit per build. Never packs personal data |
| Download folder (`supabase/functions/publish-build`) | Public-read Supabase Storage bucket `releases` in the sync project: `latest/ClaudeCompanion-Windows.zip`, `latest/ClaudeCompanion-Mac.zip` and `latest.json` (stable commit, build, version, which zip). Only the `publish-build` edge function writes it, and only for a GitHub Actions OIDC token from this repository's `publish.yml` on `main` (no stored secret). Uploads replace those three files; nothing is deleted. The repository stays private and nobody needs a GitHub account or token |
| Updater (`server.py` / `server.ps1`, `/api/update`) | Every 30 min: the download folder's `latest.json` (`web/channel.json` `url`; no token sent), or with `update.json` a GitHub repository's `stable` (token). Auto-install (default) or the app's Install button. Download the zip → reject unsafe paths → check it is the announced build and every file matches `BUILD.json` → back up the addon folder (last 5) → copy exactly the build's files and remove files an older build had (never `companion-data/`) → `installed.json` → restart |
| First install (`tools/make-release.py`, `installer/`) | `publish.yml` also builds **ClaudeCompanion-Windows.zip** and **ClaudeCompanion-Mac.zip** and uploads them to the download folder. Each holds the same build plus an installer that finds `_forever_` (or asks), copies exactly the build's files (never `companion-data/`), records the build in `installed.json` and runs the app's own setup. Tested on real Windows and macOS runners (`installers.yml`). Afterwards the computer updates itself |

Updating from the private repository instead (only if `update.json` names `repo` and no `url`) needs a
token: `gh auth token` (GitHub CLI signed in), or `companion-data/update.json` `"token"`.
Verified for real on a Windows PC on 22 Nov: the app installed build `d7dd338` from `stable` by itself
(36 files, checksums matched, backup made, server restarted).

## Sync between computers (Supabase)

Two kinds of data sync. What only the addon remembers is **history**: journal events, sessions,
grinds, dungeon runs, notes, level/money history, disenchant results, AH price observations, sales,
buys and posts, plus the app's settings (gear weights and picks). The union of every computer's
history is shown everywhere. How the character is **now** (bags, gear, quests, talents, rep, skills;
bank, mail, professions, specs, flight paths, own auctions) is each save's copy of what the game
server said at that save: each computer sends its copy as one replaced `now` row per character, and
the view shows each part from whichever computer saw it last (`js/merge.js`), so opening the app on a
computer you haven't played on lately shows what you have now, not what you had there.

```
 PC: save ─▶ page (js/sync.js) ──push new records──▶  Supabase "claude-companion"  ◀──push── page ◀─ save :Mac
                         ◀──pull the account's records──  records (append-only)  ──pull──▶
             view = this save + every other computer's history + the newest "now" (js/merge.js rules)
```

**Records.** One row per history entry, `id` made from its content (character, kind, time, what it was:
the same identities `js/merge.js` uses), so the same event saved by two computers is one record, a
re-send changes nothing, and there are no conflicts. Some rows are replaced instead of added, because
their data changes after they are first sent: `live` (per computer and character: what's running there
now and when it last saw the character, so another computer can end a stale grind "away"), `setting`
(per key) and the trackers `session`, `grind` and `run` (an edited or finished run updates its row).
A replaced row has one current copy per account (the root account's, see below); a pull leaves out the
copies it shadows.

**Settings.** Each setting carries the time it last changed. The page pulls before it pushes and sends
no setting before its first pull has finished. A pulled setting replaces the local one unless the local
one changed after it. A computer that joins an account takes that account's settings (so linking a
new computer never resets the old one's), and a setting changed there afterwards spreads as usual.

**When.** The page pushes after every save it reads (each `/reload`, logout and the addon's
own saves), from the app window or the server's hidden browser when the window is closed, pulling
first, plus every 2 minutes while the window is open. Only what's new is sent: per character and
kind the page keeps the newest time it has sent (`companion-data/sync.json`), and only moves it once
the backend has the batch.

**Offline.** Nothing waits in memory: the save itself is the queue. If a push fails, the marks don't
move and the next save sends everything since. The app always works from the local save; the other
computers' history is cached in `companion-data/sync-cache.json`, so it shows offline too.

**Pull cursor.** Each row gets a sequence number (`seq`) when it is written, and a pull asks for rows
after the highest one it has. Pushes and joins of one account take a lock on that account for their
transaction (`private.lock_account`), so its rows commit in `seq` order and a pull can never pass a row
that commits later (tested with two overlapping pushes).

**Accounts, with no sign-up.** Each install makes a random 256-bit device key (in `sync.json`) and
registers it (`cc_register`); the backend keeps only its SHA-256. Every call carries the key, and the
functions only touch that key's account. Linking a second computer: System tab, **Link another
computer** shows an 8-character code (30 minutes, works once, 40 bits from `gen_random_bytes`) that
the other computer enters; a computer gets at most 10 wrong codes an hour. Joining
moves nothing: the joining account points at the one it joined (`accounts.merged_into`), its computers
move over, and reads cover the whole group. Claude can also join two accounts it knows are one
person's (`private.merge_accounts`), so one person's computers need no code.

**Turning it off.** System tab, **Turn sync off on this computer** sets `off: true` in that computer's
`sync.json`. Then no page there (the app window or the hidden browser) registers, sends or fetches
anything, and the view shows only that computer's save. Nothing is lost: what wasn't sent stays "not
sent" and goes when it's turned back on. What was already online stays online.

**Security.** All tables have row-level security on and no policies: the API can't read or write them
(checked with the anon role: 0 rows). The only way in is the `cc_*` functions (security definer, fixed
`search_path`), which check the device key. The app ships only the publishable key. The Supabase
advisor lists those functions as "callable without signing in" (by design: the device key is the
credential) and "RLS enabled, no policy" (by design: no direct table access). Limits per call: 1000
records, 64 KB per record; 2 million records per account (a counter on the account); new computers:
20 an hour per IP, 5000 an hour in all. The IP is Cloudflare's `cf-connecting-ip`, which Cloudflare sets
itself (seen in the project's edge logs), not the caller. The API roles have no table grants at all.
An account marked `retired` is closed: its computers' calls are refused and Claude's view leaves it out.

**Each computer's "now", for Claude.** The game save stays the truth for the character as it is now, and
no computer takes another's. But Claude must read it without touching the computers, so each one also
sends its current snapshot (what `snapshot.json` has: position, quest log, gear and bag advice,
professions, rep) as one replaced `snapshot` row per computer, after every save the page reads and only
when it changed. It may be up to 2 MB, and pulls leave it out (other computers never need it).

**After an update.** The server installs a new build by itself; an app window that stays open loads the
new page at a quiet moment (at once if it's hidden or minimised, else after 2 minutes without a click or
key), so an old page never keeps running against a new server. A window from before that code can't reload
itself, so until a window loads the page after the server's restart, the hidden browser also runs after
every save (even though a window wrote `snapshot.json`), and the current page's work (sync, the snapshot
online) still happens.

**Claude's access** (optional; the app doesn't need it): reading the snapshot and history, writing
cards, all in [../CLAUDE.md](../CLAUDE.md). Kinds in `private.history`: journal, session, grind, run,
note, history, de, ah_obs, ah_sale, ah_buy, ah_post, live, setting, snapshot.

**Schema:** `supabase/migrations/` (`supabase/README.md`). Client: `js/sync.js`.
Tests run the real migration files on a plain Postgres (`test/sql/backend.js`; CI has a Postgres
service): `test/web/sync.test.js` (stable ids, no duplicates, offline, link codes and their limits,
settings when linking and after, edited runs, the merged view, a third computer, overlapping pushes,
closed tables, retired accounts, snapshots) and `test/web/sync-browser.js` (the real page in Chromium, also
as the hidden browser). `test/web/server-api.test.js` checks the local server's API on both servers
(server.py on Linux, server.ps1 under Windows PowerShell 5.1 on a Windows runner). CI blocks
the live project's host for the whole job, so no test can reach it. Checked on the real project on
22 Nov 2026 with SQL as the anon role, in a transaction rolled back afterwards: register, history
written once, an edited grind replaced, link code, a wrong code, joining, pull, a retired computer
refused, tables closed.

**Pending cleanup** (retired, so invisible and unusable; to delete once): accounts
`fff05b79-0171-4ce7-85fb-58ebf6fc969c` (a CI runner, 125 records), `8d518109-c416-4368-a0f1-f2ddfb28474e`
and `b02713e0-c711-46a8-b7c6-b40211398579` (the first round-trip test). Delete their records, devices,
link codes and the accounts.

**Free plan limits** (supabase.com/pricing, read 22 Nov 2026): 500 MB database per project; 5 GB egress
and 5 GB cached egress a month; 1 GB file storage; 50,000 monthly active users; unlimited API requests;
500,000 edge function invocations; 2 active projects per organization; **paused after 1 week of
inactivity** (any play syncs, which counts as activity); no automatic backups; 1 day of logs. Pro is
from $25 a month. Size: a level-59 player's save on 22 Nov is about 7,900 records (7,400 of them AH price
observations), a few MB, so one player uses well under 1% of the database a month.

## On one computer: addon, save, local app

```
 World of Warcraft Forever client
 ┌──────────────────────────────────────────┐
 │ ClaudeCompanion addon (Lua)              │   events, C_* APIs, tooltips
 │  Core · Snapshot · Journal · Market ·    │
 │  Professions · UI                        │
 └───────────────┬──────────────────────────┘
                 │ on /reload or logout the game writes
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
   + web/data/gamedata.js (game-data pack: everything you haven't seen in game), web/data/suffixes.js,
     web/data/rules.js and js/icons.js (one source each: see Data sources)
                 │ after each load, js/claude.js POSTs a summary (an open window, or the
                 │ server's hidden headless Chrome/Edge after a save while the app is closed)
                 ▼
 ClaudeCompanion/companion-data/snapshot.json   ◀── what Claude reads first
```

Claude → player channel: **From Claude cards** (`js/cards.js`). Claude writes cards online (the account
setting `cc.claude.cards`, through `private.claude_put_setting`; every computer gets them at its next
sync) or on one computer (`companion-data/from-claude/cards.json`); the app shows both as one list and
saves the player's done / dismissed / ticked steps to `from-claude/state.json` and the synced setting
`cc.claude.cardsState`, which Claude reads back. One writer per place. Format: `companion-data/SCHEMA.md`.

## Addon modules

| File | Owns |
| --- | --- |
| `Core.lua` | Saved layout (`ClaudeCompanionDB`, schema 1), secret-value safety (`Clean`/`Copy`/`Pick`/`Call`), diagnostics (`Try` → `char.diag`), item and spell cache, event bus (`ns.On`), throttling (`ns.Soon`), character key, capability probe |
| `Snapshot.lua` | Full snapshot on login / logout / sync: character, stats, equipped, bags, gear sets, talents (C_ClassTalents / C_Traits, both specs), action bars, macros, bindings, spellbook, skills, reputation, currencies, quest log + rewards, completed quests, group, buffs |
| `Journal.lua` | Timeline (loot, kills, XP, quests, deaths, zones, money by source), sessions, grinds (`/cc start`), disenchant results |
| `Market.lua` | AH prices (browse, search, full scan via `C_AuctionHouse.ReplicateItems`), posts, owned auctions, mailbox + AH invoices (sales, buys) |
| `Professions.lua` | Recipes, reagents, cooldowns (window open + cast log), bank, flight paths |
| `Drops.lua` | Generated (`tools/make-drops.py`): drop chances ForeverDB measured on Forever (no Classic rates), for the grind panel's targets |
| `UI.lua` | `/cc` window, grind panel (live numbers, targets, drops, summary on stop), slash commands, key bindings |

Every capture step runs inside `ns.Try`, so a blocked API on Forever never breaks the addon; the
System tab shows `diag` (what worked, what errored) and `caps` (which APIs exist, which values come
back secret).

Forever specifics found so far: no classic talent API (C_ClassTalents/C_Traits instead);
`UnitHealth`/`UnitPower` are secret; `GetRealmName()` returns ""; the spec-name call returns the
class name (the app names a spec by its biggest tree); the bank is readable only while open;
addons can't read the combat log.

## Data sources: one owner per kind of data

Each kind of game data has exactly one source. The app never mixes two sources for the same fact, and
what the game itself says (your tooltips, quest log, AH scans) always wins over shipped data. Where
Forever differs from Classic the Forever source is used, and anything that is only Classic data says so.

| Domain | Source of truth | Ships in | Built by | Forever or Classic |
| --- | --- | --- | --- | --- |
| Your character, the items you've seen and their tooltips, your quest log | **The game** (the addon reads it) | the save | `Snapshot.lua`, `Core.lua` | Forever (the server's own answers) |
| Item stats and tooltips (weapons, armor) | **endgametools** Forever item pages | `web/data/gamedata.js` `items` | `gamedata/egt_parse.py` | Forever client build (1.60.1); matched the game on all 48 items checked. Items with no page fall back to ForeverDB stats, marked `f` |
| Item names, quality, icons and sell price of non-gear | **ForeverDB** | `gamedata.js` `items` | `gamedata/build.py` | Forever uploads |
| Random-suffix rolls ("of Healing", "of the Owl", per base item) | **foreverchanges.pro** "Confirmed in game" | `web/data/suffixes.js` | `gamedata/suffixes.py` | Forever server numbers |
| "How to get it" and group size | **endgametools** | `gamedata.js` `how`, `size` | `gamedata/egt_parse.py` | Forever client |
| Item sets: pieces / name and bonuses | **ForeverDB** / **endgametools** | `gamedata.js` `sets` | `gamedata/build.py` | Forever |
| Quests: titles, levels, givers, turn-ins, chains, rep needs, quest-item drops, XP | **QuestieDB** (Forever flavor) | `gamedata.js` `quests`, `src` | `gamedata/export_questie.py` | Wowhead Forever snapshot + QuestieTrace player traces; `origin: 'f'` marks Forever-only facts |
| Quest reward split (fixed vs choose one) and reward money | **ForeverDB** quest guides | `gamedata.js` `quests` | `gamedata/build.py` | Forever uploads |
| Every profession recipe's tools and place (rods, hammers, anvils, a Moonwell), learned or not | **VMaNGOS** world database (`brotalnia/database`, 14 June 2021) | `gamedata.js` `recipes` | `gamedata/recipes.py`, `gamedata/build.py` | Classic 1.12, labelled so; a known recipe uses the game's own answer. Matches the in-game Runed Arcanite Rod for Enchant 2H Weapon - Major Intellect |
| Every recipe's reagents and trainer skill; every permanent enchant and what applies it where | **VMaNGOS** world database (as above) | `gamedata.js` `recipes[6..7]`, `enchants` | `gamedata/recipes.py`, `gamedata/build.py` | Classic 1.12, labelled so; the game's own text wins (`js/enchants.js`): Forever changed some enchants |
| NPCs and spawns: name, levels, rank, zone, up to 4 spawn points | **QuestieDB** (Forever flavor) | `gamedata.js` `npcs` | `gamedata/build.py` | Points already in Forever map coordinates (QuestieDB converted Mulgore, Eastern Plaguelands, Redridge and Stormwind, whose maps changed); used as they are |
| Drop rates, who drops what, "seen on Forever" | **ForeverDB** | `gamedata.js` `src` (and `Drops.lua`: only the Forever-measured chances, for the in-game grind panel, made by `tools/make-drops.py`) | `gamedata/build.py` | Only rates ForeverDB measured on Forever kills (`m`) are called Forever rates; the rest are labelled Classic |
| Vendors: who sells it, where | **QuestieDB** list, with **ForeverDB** price and "seen selling it on Forever" (ForeverDB adds vendors QuestieDB lacks) | `gamedata.js` `vend` | `gamedata/build.py` | Forever where seen (`[5] = 1`), else Classic list |
| Recipes you know, reagents, cooldowns | **The game** (profession window) | the save | `Professions.lua` | Forever |
| Recipes you don't know: which recipe item teaches it (`teach`: the recipe's taught spell is the craft's spell), skill to learn it, where the recipe comes from (that item's own sources) | **ForeverDB** | `gamedata.js` `teach`, `src`, `vend` | `gamedata/build.py` | Forever |
| Skill to craft an item | **endgametools** "how" ("Requires Tailoring (260)") | `gamedata.js` `how` | `gamedata/egt_parse.py` | Forever client |
| Reputation an item needs (rep-vendor gear, faction recipes such as Thorium Brotherhood plans) | **ForeverDB** (the item's own requirement) | `gamedata.js` `req` | `gamedata/build.py` | Forever |
| AH prices | **Your own scans and browsing** (`/cc scan`) | the save (`ah.prices`), synced between computers | `Market.lua` | Your realm, your faction. No external price feed |
| Icon names (file id to name) | **wowdev community listfile** | `web/js/icons.js` | `gamedata/icons.py` | Same files in every client |
| Game rules no source ships per item: standings, reputation thresholds, AH cut, disenchant tables and skill | **Hand-kept**, each with its source in the file | `web/data/rules.js` | by hand | Disenchant numbers are Classic (warcraft.wiki.gg), not measured on Forever; your real results are logged |
| Attunements and keys: which quest or item opens which instance, and what it opens | **Hand-kept**, sources in the file (conquestcapped Forever attunement guide, warcraft.wiki.gg WoW Forever) | `web/data/rules.js` `unlocks` | by hand; quest, item and boss ids checked against the pack in CI | Forever guides; the chains themselves come from QuestieDB Forever |
| Stat weights | **Worked out per spec**, sources in `docs/STAT-WEIGHTS.md` | `web/js/weights.js` | by hand | Forever item budgets |

**The same pack in the database.** `publish.yml` (job `game-data`) turns the pack and `rules.js` into rows
(`tools/pack-to-rows.py`) and loads them through `supabase/functions/publish-game` (GitHub OIDC, like
`publish-build`) into the `game` schema whenever the pack changed: Claude's look-ups (`game.item`, `game.npc`,
`game.quest`, `game.instance`, `game.drop_rates`) read exactly what the app shows. Reads switch to a new pack
only after every row has arrived; nothing is deleted. Test: `test/web/game.test.js` loads the real pack.

Links out of the app go to Forever sites: a quest's page is ForeverChanges (`foreverchanges.pro/quest/<id>`).
The only Wowhead address left is its icon image CDN (`wow.zamimg.com`), for pictures: icon files are the same
in every client and no Forever site serves them by name. CI fails if any other Wowhead address appears in the app.

**One presentation.** Every page shows sources and needs the same way, from `app.js`: `gdSourceLines`
(the item tooltip on every page, and the Gear page's source line) and `itemGates` (what an item needs: its own
reputation, a reward quest's, its recipe's, the skill to craft it; each "Needs Friendly with Thorium Brotherhood
(you: Neutral)"). A crafted item shows "Crafted (Blacksmithing) · Recipe: Plans: Dark Iron Reaver (skill 300), sold by
Lokhtos Darkbargainer, Blackrock Depths". No page builds its own.

Not used: Wowhead for any data or link (bot wall, terms; QuestieDB's Forever layer already includes a Wowhead
Forever snapshot), the QuestieDB addon in game (1.4 and earlier kept a copy of
its answers in the save that was never refreshed and shifted points in the four converted zones; the
addon now drops that copy on load), external AH price sites.

**Rebuild** everything with `gamedata/build.sh` (gamedata/README.md), then copy the outputs it names.
**CI** (`checks.yml`, "Game data complete") runs `gamedata/test_pack.py` (shape, facts checked by hand
against the sources, coverage floors) and `test/web/data.test.js` (every domain present, the files agree:
every quest giver is in the NPC table, every pack icon has a name, every suffix base is a pack item,
disenchant tables have no gaps) and warns when the pack is more than 30 days old. Coverage per build:
`gamedata/COVERAGE.md`.

## Contracts

Every interface between the parts (addon, save, local server, page, snapshot, sync, Claude, updates),
with its owner, version and CI check, is in [INTERFACES.md](INTERFACES.md). `test/contract.test.js`
(first step of `checks.yml`) fails when two sides disagree.

## Where things live on a computer

| What | Path |
| --- | --- |
| Addon + app | `_forever_/Interface/AddOns/ClaudeCompanion/` |
| Raw save | `_forever_/WTF/Account/<account>/SavedVariables/ClaudeCompanion.lua` |
| Claude snapshot | `_forever_/Interface/AddOns/ClaudeCompanion/companion-data/snapshot.json` |
| App settings (gear weights, picks) | the browser's `localStorage` for `http://localhost:47615` |

The server finds `_forever_` as four folders up from `web/`, and uses the newest
`ClaudeCompanion.lua` under any account. The app shows the character synced most recently.
