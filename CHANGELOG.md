# Changelog

Dates are UTC, 2026. The addon version is in `ClaudeCompanion.toc` / `Core.lua`.

## Unreleased (background snapshot)

- `snapshot.json` now updates after every save in game even with the app closed (#3): the server
  notices the save and has a hidden (headless) Chrome or Edge load the page once, so there is still
  one snapshot implementation (`js/claude.js`). `by` says which wrote it.
- The app's own settings (gear weights and picks, flips set aside) are kept in
  `companion-data/settings.json` too (`GET`/`POST /api/settings`): they survive a cleared browser,
  carry over between browsers, and the hidden browser uses them. Part of #15.

## Unreleased (app launch)

- The app is a normal app now. **Claude Companion.app** (macOS, replaces the `.command`) and
  **Claude Companion.bat** (Windows) set the local server to start at login, hidden (a LaunchAgent /
  a Startup-folder shortcut), restart it so an update takes effect, and open the app. No Terminal or
  PowerShell window to keep open.
- The page installs as its own app (Chrome / Edge "Install as an app" button in the sidebar; Safari:
  File > Add to Dock): Dock, Launchpad and Spotlight on a Mac, Start menu and taskbar on Windows.
  New icon (`tools/make-icons.py`), manifest with local icons.
- `server.py --serve / --uninstall`, `server.ps1 -Serve / -Uninstall`. Removed the old file mode
  (`data.js` written next to the page when the server couldn't start).

## Unreleased (From Claude cards)

- New **From Claude** tab, and its open cards on the Overview: Claude's suggestions (farm, flip, quest,
  gear, craft, route, note) in one card format, with facts, items (icon, tooltip, your AH price), steps
  you tick off, sources, and live results from `/cc start <name>` runs. Done / Dismiss / Restore.
- Claude writes `companion-data/from-claude/cards.json`; the app saves your choices to
  `from-claude/state.json` (servers: `GET /api/cards`, `GET` and `POST /api/cards-state`). Format in SCHEMA.md;
  `tools/check-cards.py` checks a cards file and runs in CI.

## Unreleased (data fixes)

- **Item cache no longer stops at 6,000 (#1):** when full, the items seen longest ago make room (a
  tenth of the cap at a time), never one that any character wears, carries, banks, has in the mail
  or keeps in a gear set. `cacheStats` counts evictions. Harness test fills the cache past the cap.
- **Flips count stacks (#2):** buys and sales keep the stack size from the AH letter (invoice count,
  or the won item's stack); flips match unit by unit, oldest purchase first. A purchase can be set
  aside as "Used, not a flip".
- **Stale snapshot is detectable (#3):** `snapshot.json` gains `saveModified` (the save file time
  it was built from) and `taken` per part (bank, mail, flight paths, AH, professions, specs).
  SCHEMA.md tells Claude to compare `saveModified` with the save file before trusting it.

## 1.4.0 (22 Nov), first release from this repository

Addon 1.4.0 plus the app as of 22 Nov 08:30 UTC.

- **Addon:** group kills and party coin share count as loot; disenchant source found even when
  Forever doesn't flag the item locked; mail origin for received items (AH win + price);
  AH purchases recorded (`ah.buys`); `ns.PlanPrice`.
- **Game-data pack v2:** one owner per field (QuestieDB / endgametools / ForeverDB), built by
  `gamedata/build.sh` with tests (`test_pack.py`) and `COVERAGE.md`.
- **Gear tab:** next upgrades, pre-BiS and a BoE watch list per spec. Wearable items come from
  your weapon and armor skills (any class); Ranged slot incl. relics; necks, rings, trinkets and
  cloaks included; compare against a gear set; "Your own weights" editor. Spec named by its
  biggest tree (Forever returns the class name).
- **Cooldowns:** any profession, from recipes and the cast log; shared cooldowns (Transmutes) grouped.
- **AH Flips:** each purchase matched to its later sale; profit after the 5% cut.
- **Claude snapshot:** `companion-data/snapshot.json` (see `SCHEMA.md`).
- **macOS:** `server.py` + `Claude Companion.command`, same endpoints as `server.ps1`.
- **UI:** Graphite theme, responsive rem layout (860 px to 1920 px+), item tooltips use the app
  font instead of the in-game serif.
- Fixed a stray `}` in `server.ps1`.

## 1.3.0 (22 Nov)

- The page became an app: `server.ps1` local server, Edge app window, live updates on Sync.
- Overview freshness list; disenchant-or-sell for every green/blue in bags and bank (skips worn
  and gear-set items); AH sales no longer counted twice.

## 1.2.0 (22 Nov)

- Full AH scan button (`/cc scan`, `C_AuctionHouse.ReplicateItems`; 242k auctions confirmed).
- Disenchant tracking, reputation per grind, interaction-manager hooks (bank, taxi, AH, money
  source), other-spec talents via loadout probe, quest rewards, QuestieDB enrichment.

## 1.1.0 (21 Nov)

- Grind tracker (`/cc start|stop|pause`, panel), full talent trees with tooltips, bank fix.

## 1.0.1 (21 Nov)

- Character key uses the normalized realm when `GetRealmName()` is empty; migrates old keys.

## 1.0.0 (21 Nov)

- First version: records character, gear, bags, bank, specs, bars, quests, professions, gold,
  loot and AH prices to SavedVariables; `/cc` window; Claude inbox.
