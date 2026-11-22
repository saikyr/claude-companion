# Changelog

Dates are UTC, 2026. The addon version is in `ClaudeCompanion.toc` / `Core.lua`.

## Unreleased (one character on every computer)

- **The PC and the Mac (and a friend's computers) show the same character.** The game keeps a
  separate save on each computer and writes it itself, so the saves can't be one file. Instead you
  pick, once, the cloud drive your computers already share (Google Drive for desktop, OneDrive,
  Dropbox, iCloud Drive: the app lists the ones it finds). The server keeps a `Claude Companion`
  folder there with one subfolder per computer (save.lua.gz, settings.json, snapshot.json.gz, and
  meta.json written last with the save's SHA-256), so two computers never write the same file and the
  drive never has a conflict. It copies the other computers' saves into `companion-data/devices/`
  (only when complete and matching their SHA-256), and the page merges them (`js/merge.js`) before it
  shows anything or writes snapshot.json:
  - history (journal, sessions, grinds, runs, notes, AH sales/buys/posts, price history, disenchants)
    is the union of both, without duplicates and without dropping identical events, in time order;
    entries from the other computer carry `dev`
  - what's current (bags, gear, gold, bank, mail, professions, specs, flight paths) comes from the
    computer that saw it last
  - a grind or run left running on one computer while you played on the other is shown as ended
    "away", like the addon does at login
  - settings follow the computer where they changed last (the replaced file is kept as settings.json.bak)
- No save file is ever written. Same mechanism for everyone; no account beyond the drive.
  `GET /api/devices`, `POST /api/sync-config {"folder": ...}`. snapshot.json has `mergedWith`.

## Unreleased (updates itself)

- **Builds publish themselves.** When a PR merges to `main` and the checks pass, CI
  (`.github/workflows/publish.yml`) publishes it to the `stable` branch; nobody publishes by hand.
  The game-data pack is now in the repository so CI can build. With the repository variable
  `DIST_REPO` and secret `DIST_TOKEN` it also publishes to a public download repository for friends;
  each build carries `web/channel.json`, so an app keeps updating from where it came from.
- **The app updates itself.** Each tested build is on the `stable` branch
  (`tools/publish-stable.py`): the ClaudeCompanion folder as it goes in AddOns,
  with the game-data pack, plus `BUILD.json` with every file's SHA-256. The local server checks the
  branch every 30 minutes and installs a new build by itself (auto-update, on by default), or when you
  click **Install now** on the card the app shows. It downloads the build, checks every file against
  `BUILD.json` (a damaged download installs nothing), backs up the current addon folder (last 5, in
  `%LOCALAPPDATA%\Claude Companionackups` or `~/Library/Application Support/Claude Companion/backups`),
  copies the new files over and restarts itself. `companion-data/` (snapshot, settings, cards) and the
  game's saved data are never touched. The only step left per build is `/reload` in game.
- The repository is private, so downloads use a token: `companion-data/update.json` `"token"`, else
  `CC_GITHUB_TOKEN`, else the GitHub CLI's (`gh auth token`). A public repository needs none.
- `GET /api/update` (status, `?force=1` checks now), `POST /api/update` (install),
  `POST /api/update-auto?on=0|1`. `companion-data/installed.json` says which build is installed.
- Mac, once: `tools/install.sh` (see its first lines) puts this on a Mac; it updates itself after that.

## Unreleased (smooth AH scan)

- **The full AH scan no longer freezes the game.** With 200,000+ auctions it read everything in one
  frame, up to three times. Now it waits until the list stops growing, reads a slice per frame (about
  6 ms), only asks for item links on items whose name has " of " (random suffixes), and the second
  pass rereads only the auctions whose details hadn't loaded. Closing the AH mid-scan stops it cleanly.
  `lastScan.secs` says how long it took.
- **The button moved** just below the AH window's right edge ("Scan AH"), where the game's own
  buttons and tabs can't overlap it. It shows Waiting, Reading 45%, Saving, and next to it when the
  next scan is allowed.

## Unreleased (dungeon runs)

- **Dungeon and raid runs are tracked by themselves.** Entering an instance starts a run on the same
  tracker as grinds: time, kills, loot, gold, XP, deaths, quests and rep, plus bosses (`ENCOUNTER_END` /
  `BOSS_KILL`), wipes and everyone in the group. Leaving parks it, so a run back after a wipe or a quest
  handed in outside stays the same run (time outside doesn't count). It ends after 15 min outside, on
  entering another instance, on "X has been reset.", or (like a grind) when this computer's save last saw
  it more than 15 min before the next login. A /reload or a short disconnect inside keeps it.
- **Kills inside dungeons are counted again.** Forever hides the kill event's GUIDs in instances, so
  no kill at all was logged in BRD. Kills now also come from the XP line ("X dies, you gain N
  experience"), which still names the mob (kills that give no XP are still missed).
- **App: new Dungeons tab** with every run. Runs from before this update are rebuilt from the Journal
  ("from the journal": kills counted from XP gains, no boss list), so past BRD runs show up too.
- **Group loot and rolls:** items (green and better) that go to someone else, who won them and every
  Need / Greed / Pass and roll, from the loot chat lines. In the run (`groupLoot[]`), the Journal
  (`groupLoot`) and the Dungeons tab ("Went to others").
- **Flight paths by continent:** the flight map only lists the continent you're on. Paths were already
  kept across continents; now each notes its continent, `taxiRead` says which continent's map was read
  when, the app groups them and says which continent still needs a flight map opened, and
  `snapshot.json` has `flightPaths`. Old "zzOLD" nodes are dropped.
- Bosses come from the game's own encounter events, not from the Dungeon Journal addon.
- `snapshot.json`: `runs[]` (the last 10, newest first). Journal: `runStart`, `runLeft`, `runBack`,
  `boss`, `wipe`, `runEnd`.

## Unreleased (Windows app)

- **Windows works like the Mac app:** `Claude Companion.bat` (run once, and after an update) adds
  **Claude Companion** to the Start menu, with its icon (`web/icons/app.ico`), and the hidden server to
  Startup. Both shortcuts run PowerShell through `conhost --headless`, so no console window ever shows.
  The Start menu entry starts the server if it isn't running and opens the app in its own window (the
  installed Edge/Chrome app if there is one, else `--app`, no tabs or address bar).
- `server.ps1 -Open` (what the Start menu runs). `-Uninstall` removes both shortcuts.

## Unreleased (grinds end cleanly, one save per computer)

- **A grind no longer runs on by itself.** Logging out ends it at the logout. A `/reload` or Sync keeps
  it (a reload that wasn't recognised as one, seen as a logout and a login seconds apart, brings it back).
  If this computer's save last saw the grind more than 2 minutes before you log in (a crash, a long
  disconnect, or you played on the other computer, whose save this one never sees), it ends at its last
  counted kill or loot, so the hours away don't count. 30 minutes with nothing counted ends it the same way.
  The grind records why it ended (`ended`: logout, away, idle) and on which computer it ran (`device`).
- **Pausing needs Shift-click (#31).** A plain click on the grind panel does nothing, so a stray click in
  combat can't pause it. Paused shows in red with a chat line, and `grindPause` / `grindResume` go in the
  Journal. Right-click still stops.
- **snapshot.json says which computer wrote it (#11):** `device` {host, os}, from the server, and `grind`
  {running, recent[]}. The PC and the Mac each keep their own save and their own `snapshot.json`.
- Test harness: `hooksecurefunc("Name", fn)` mock fixed (it never called the hook), tickers can be run.

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
