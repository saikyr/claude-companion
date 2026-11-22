# Changelog

Dates are UTC, 2026. The addon version is in `ClaudeCompanion.toc` / `Core.lua`.

## 1.5.0 (in progress: every merge to main updates itself)
- **Quest rewards are scored for every spec.** The Quest log shows, under each quest's rewards, which
  specs each item upgrades and by how much (the same engine as Bags and Gear), also for quests whose
  rewards come from the game-data pack. The snapshot carries the same scores per reward and for the
  chain's next quest, so Claude quotes the app instead of scoring items itself.
- **From Claude cards reach every computer.** Claude can now post cards to your account online; every
  computer shows them at its next sync, and what you do with them (done, dismissed, ticked steps) syncs
  too. Cards written to a computer's `from-claude/cards.json` still work, and both show as one list.
  Cards can name what they are about (`step`: a quest, dungeon, item, zone or NPC).
- **Docs for agents and friends:** `CLAUDE.md` (the agent guide: where the truth lives, reading the
  app's scores for all specs, writing cards), `docs/INTERFACES.md` (every interface, its owner and its
  check; the app is complete without Claude) and `docs/CLAUDE-PROJECT.md` (an optional Claude project,
  with instructions to paste). CI also checks that the card fields and Claude's backend function agree
  with their docs.
- **Sync can be turned off per computer.** System tab, Turn sync off on this computer: nothing is sent
  or fetched there and the app shows only that computer's save; turned back on, what waited is sent.
- **Ready to share: one download, one installer.** Every build now also goes to a public download folder
  (the repository stays private) as **ClaudeCompanion-Windows.zip** and **ClaudeCompanion-Mac.zip**,
  linked in the README. Installed apps update from the same folder, so no computer needs a GitHub
  token any more. Each zip has an
  **Install Claude Companion** that finds the WoW Forever folder (or asks), installs the addon and
  opens the app, which then updates itself. Each install gets its own sync account; Link another
  computer joins your own computers. Both installers are tested on real Windows and macOS in CI.
- **README for players** (install, several computers, your data, remove); developer notes moved to
  docs/DEVELOP.md; MIT license; roadmap refreshed. The Mac terminal installer (`tools/install.sh`) is
  replaced by the installer app.
- **Windows server:** serves only files inside its own folder (a sibling folder with a similar name
  no longer passes the check).

- **One contract between the parts, checked in CI.** New first CI step `test/contract.test.js`: the
  addon version is the same in the .toc, Core.lua and this changelog; every file the .toc loads exists
  and every addon file is loaded; the save and snapshot schemas agree with their docs; the Mac and Windows
  servers serve the same API and the page calls only that; every sync call has its backend function; a
  migration already on main is never edited. The table is in docs/INTERFACES.md.
- **The app knows when the game needs a /reload.** Each build stamps its commit into the addon
  (`addonBuild` in the save) and the app (`web/channel.json`). While the game still runs an older addon
  than the app, the app says so until you /reload, instead of only for 15 minutes after an update.
- **Updates leave no old files behind.** The updater copies exactly the build's files and removes files
  an older build had (they are in the backup); companion-data is never touched. The Windows server's
  update is now tested end to end in CI too.
- **Removed:** the old in-game message from Claude (`Inbox.lua`, a stale 1.3 note; Claude's suggestions
  are From Claude cards in the app; the `/cc` window says where they are), and the merge of QuestieDB
  quests and NPCs from saves (they come from the game-data pack since 1.4).

- **Gear page fixes.** The spec you are looking at is marked in the switcher again. The four cards read
  like the rest of the app (label, value, one line). Reputation names come from data/rules.js, and items
  whose source is "World Drop" are listed as world drops.

- **The active spec is right everywhere.** With both specs saved, the save's reader numbered them 0 and 1
  instead of the game's 1 and 2, and merging the PC's and Mac's copies mixed the two numberings, so the
  Talents page could show Shadow's name on the active (Holy) spec and spec 2 wouldn't open. Specs now keep
  the game's numbers from the moment the save is read (and when computers are merged), for Talents, Gear
  and Stat weights alike. Gear choices made before carry over.
- **Talents & Bars:** action bars use the game's own names (Action Bar 1 to 8, as in the Action Bars settings),
  plus Action Bar 1's second page and its Shadowform page, instead of guessed positions like "Bottom left".
- **Professions:** one selector (in the header) and the selected profession's skill bar; other skills in one
  line at the bottom. Hovering a recipe shows its reagents: how many you have and what each costs.
- **AH flips:** the same AH letter read on both computers counts once, and the Flips view explains exactly
  how purchases are matched to sales (and how many copies it left out).

- **One source per kind of game data, checked in CI.** docs/ARCHITECTURE.md (Data sources) names the one
  source for items, random-suffix rolls, quests, NPCs and spawns, drop rates, vendors, recipes, AH prices
  and icons. New CI step "Game data complete" (`gamedata/test_pack.py`, `test/web/data.test.js`).
- **NPCs come from the pack.** The pack now has every QuestieDB Forever NPC (15,561: levels, rank, zone,
  spawn points). The addon no longer keeps its own copy of QuestieDB answers in the save (it was never
  refreshed, and it moved spawn points in Mulgore, Eastern Plaguelands, Redridge and Stormwind a second
  time); it drops that copy on load, which makes the save smaller.
- **Game data rebuilt 22 Nov** from today's QuestieDB (e3c3bc4), ForeverDB and endgametools pages.
  endgametools changed its page layout today; "How to get it" now reads the new layout ("Boss Drop ·
  Herod · Scarlet Monastery · Level 30–46 · 5 players"), for 10,429 items instead of 1,994.
- **Icons rebuilt from the wowdev listfile** (`gamedata/icons.py`): 3,227 broken names (".blp.meta") gone.
- **Hand-kept game rules in one file** (`web/data/rules.js`): standings, reputation thresholds, AH cut and
  the disenchant tables, each with its source, instead of copies in app.js and advice.js.

- **Gear page, organised by slot.** A slot list (with Compare with on it) and the chosen slot in full:
  every upgrade at your level (best 15, then Show all), source chips with counts, and that slot's pre-BiS
  with your target on top and "Make target" on the rest. Random greens now count as upgrades even when
  they aren't on your AH.
- **The Gear page, rebuilt.** Four views per spec: **Upgrades** (slot by slot, what you have and several
  options that beat it, each with its source in one word: yours, on the AH, dungeon, quest, crafted,
  vendor, world drop; AH price and how many are listed; filter by source), **Pre-BiS** (best per slot up
  to 60 with alternatives you can click to make your target, and "only what I can get now"),
  **Auction House** (upgrades listed now, sorted by gain, and the random-suffix rolls worth searching
  for) and **Class sets**. Missing reputation or profession skill gets its own line.
- **AH greens count.** Random-suffix items ("Elegant Mantle of Healing") are scored from their roll's
  exact stats: every roll of 1,616 Forever items from foreverchanges.pro ("confirmed in game"), in the
  new `web/data/suffixes.js` (`gamedata/suffixes.py`).
- **The AH scan keeps each roll apart.** On Forever the scan's item links carry no suffix number, so every
  roll of an item was priced as one ("Short Bastard Sword of Healing" was really all its rolls). The scan
  now prices each roll by its listing name ("3192:of Healing"), and still keeps the item's all-rolls
  price. Needs a `/reload` after the update, then a new scan.
- **Stat weights: clean defaults.** Each spec uses the weights of its biggest talent tree unless you pick
  others, and the page says so. Profiles are named after their tree ("Holy", "Shadow"), and every number
  has its reason under "Why these numbers". Priests: Holy, Discipline and Shadow use the worked-out
  numbers; the guide's order shows next to them for comparison instead of as separate picks.
- Snapshot `gear[]`: `ahUpgrades`, `rollsToSearch`, pre-BiS `picked` and `alternatives`, `weightsChosen`,
  `source` and `ah` on each item (SCHEMA.md); `watch` stays as the older name for `ahUpgrades`.
- **Every computer shows what you have now.** Bags, gear, quests, talents, rep, bank, mail,
  professions and flight paths sync too: each part shows from whichever computer saved last, so
  opening the app on the Mac after playing on the PC shows the PC's bags and gear, not the Mac's
  older copy. Your own save file is never changed.
- **App review fixes.** Professions: the footer showed raw code (`${esc(p.name)} recipes ...`), and the skill
  bar could read "undefined / undefined". Quests: a reputation loss read "+-750" in green, and a reputation
  requirement showed raw data; it now says "Needs Friendly with Magram Clan Centaur" (red only if you don't
  have it). Journal: grind pause / resume have names, the loot-money chat line no longer repeats the money row,
  kills of a mob you never targeted take its name from QuestieDB when it's known. Bags: the main bank is called
  "Bank", not "Bag -1". Overview and sidebar: level 60 shows "Max level" instead of 0%. Dungeons: short visits
  with nothing done fold into one line. Update card: says what changed and the build, not the merge commit.
- **The Mac's local server only answers this computer's own page.** A web page could point its own domain at
  127.0.0.1 (DNS rebinding) and read the save and the sync key; requests for any host but localhost are now
  refused (the PC's server already did this). Part of #18.
- **Less work in game.** Spellcast events are registered for the player only, so other players' casts (party,
  raid, nameplates) no longer wake the addon.

- `snapshot.json` (and its copy online) names the app build each computer runs (`app`).
- **Claude can read where you are and your quest log from anywhere.** Each computer now also sends its
  current snapshot (position, quest log, gear and bag advice, professions, rep) online after every save,
  one per computer, only when it changed. Other computers don't download it.
- **An open app window picks up updates by itself.** After the server installs a new build, an open
  window loads it at a quiet moment (hidden or minimised, or 2 minutes without a click or key). Before,
  a window left open kept the old page, so a new feature (like sync) didn't start until it was reopened.
- **Even an app window left open from an older version can't hold sync back.** Until a window has loaded
  the page since the server last restarted (it restarts after every update), the server's hidden
  browser also runs after each save, so the new version's sync and snapshot happen anyway.
- The PC's server (server.ps1) is now tested in CI under Windows PowerShell 5.1.

- **The sidebar says how fresh the data really is.** WoW writes addon data to disk only on `/reload`,
  `/cc sync` and logout, so while you play the app shows your last save. Instead of "Live · synced 4 h
  ago" the sidebar now says "In game · last saved 4 h ago" while the game runs on this computer, and
  "Saved in game 4 h ago" when it doesn't, with a hover note on why (nothing is lost meanwhile: the addon
  keeps every change, such as a spec swap, and it all shows at the next save). `/api/stamp` gains
  `game` (true / false / null when the server can't tell).
- **History syncs between computers.** The journal, sessions, grinds, dungeon runs, notes, level and
  money history, disenchant results, AH prices, sales, buys and posts, and the app's settings go to
  a small Supabase backend after every save, and each computer shows its own save plus every other
  computer's history (js/sync.js, merged with the tested rules in js/merge.js). Records are keyed by
  their content, so nothing doubles and nothing conflicts; offline, the save itself is the queue. No
  sign-up: each install has its own device key, and System > Link another computer joins a second
  computer with a code. History the addon trims locally stays online. `snapshot.json` gains `sync`
  (the account id Claude reads the history with). Linking a computer keeps the settings you already
  have (a new computer takes the account's), a run or grind edited after it was sent updates
  everywhere, and the tests run the real backend SQL. Schema: `supabase/`; design: docs/ARCHITECTURE.md.
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
- **Bosses for older runs:** when the ForeverDungeonJournal addon is installed, its per-run boss log is
  copied (read only) into `c.bossLog` at login and logout. Runs rebuilt from the Journal, and tracked
  runs the encounter events missed, take their bosses from it. Without it, the Dungeons tab says "not
  recorded" instead of "?".
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
## Unreleased

- **Gear page rebuilt:** per spec, a summary (pre-BiS progress, upgrades now, class sets), a
  **pre-BiS checklist** (best item per slot up to 60, raids and PvP left out, with what you have
  in the compared set and whether you own the target: worn, bags, bank or missing), next upgrades,
  **class sets** and the AH watch list.
- **Class sets:** every item set for your class that Forever has, with pieces, where each comes
  from, which you own, and set bonuses (active ones highlighted). Data-driven for any class:
  set pieces from ForeverDB, set names and bonuses from the client tooltips (endgametools), class
  from item masks, "Classes:" lines and class quests (the dungeon set 0.5 chain). Pack key `sets`.
- PvP honor gear (sold in Champions' Hall / Hall of Legends or named after a PvP rank) is left out
  of PvE lists; sets sold only by the other faction's vendor are hidden.
- Snapshot: `gear[].classSets[]`, `preBis[].status`.
## Unreleased (logout snapshot)

- Logging out no longer wipes the saved bags, worn gear, gold and other parts: the game empties them
  before `PLAYER_LOGOUT`, so a logout snapshot now keeps the previous value of any part that reads
  empty (and money / max mana / max health read as 0). `snap.kept` and `snap.keptFrom` say what was
  kept and from when. Harness test added. (#27)
## Unreleased: item advice

- **One item engine** (`web/js/advice.js`): every item you own is scored once per spec with that
  spec's weights, against the gear that spec uses. Bags, Character, Gear and the snapshot all read it.
- **Bags & Bank:** a quiet mark on each item (Upgrade, Disenchant, Auction House, Vendor, Keep, ask)
  and the full verdict in its tooltip: score and gain per spec, disenchant value, AH and vendor price.
  Chips above the bags show only one kind. Quest items, keys, rep turn-ins, set items are never sold.
  Words and colours: `docs/ui-language.md`.
- **Character:** the worn slot something you own would beat is marked, with the item and the gain.
- **Gear:** "Best from what you own" per spec, which two rings and which two trinkets included, next
  to what that spec's set uses.
- **Stat weights page and defaults for every class and spec** (`web/js/weights.js`): order from Icy
  Veins' WoW Forever pages, numbers from what each stat costs on Forever gear (docs/STAT-WEIGHTS.md).
  Your own profiles: copy, edit, rename, reset, delete; pick one per spec. The old "Your own weights"
  move into a profile. Fixes #5. Weapon DPS is scored for weapon specs (part of #6).
- Removed: the Auction House tab's "Disenchant or sell" list (its verdicts now live on the items).
- Snapshot: `bagAdvice[]`, `bestOwned[]`, `weightProfiles[]`, `gear[].weightsName/weightsSource/weightValues`.
- Tests: `test/web/advice.test.js` (node, runs in CI).

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
