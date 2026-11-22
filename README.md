# Claude Companion

A World of Warcraft **Forever** addon plus a small local app. The addon records your character
(gear, bags, bank, talents for both specs, action bars, quests, professions, reputation, gold,
loot, grinds, auction house prices and sales). The app shows it all in one window on your own
computer and writes a compact `snapshot.json` that Claude reads when it coaches you.

Nothing leaves your computer: the app is a tiny server on `localhost` that reads the game's own
saved file.

## Install

1. Download `ClaudeCompanion-<version>.zip` from the [latest release](../../releases/latest).
   (Building from source: see [Develop](#develop); the zip already has the 12 MB game-data pack.)
2. Unzip it into your Forever AddOns folder, so you get `.../AddOns/ClaudeCompanion/ClaudeCompanion.toc`:
   - **Windows:** `C:\...\World of Warcraft\_forever_\Interface\AddOns\`
   - **macOS:** `/Applications/World of Warcraft/_forever_/Interface/AddOns/`
3. Start the game, log in, type `/cc sync` once. That saves everything the addon can see.
4. Open the app:
   - **Windows:** double-click `AddOns\ClaudeCompanion\web\Claude Companion.bat`. It opens in an
     Edge app window. Leave the small minimised PowerShell window open; closing it stops the app.
   - **macOS:** right-click `AddOns/ClaudeCompanion/web/Claude Companion.command` and choose
     **Open** the first time (macOS asks once for files from the internet). After that a
     double-click is enough. It uses the Python 3 that comes with Apple's Command Line Tools and
     offers to install them if they're missing. Chrome or Edge open it as an app window; otherwise
     your default browser.
5. The app updates by itself a few seconds after each `/cc sync` (or logout) in game.

To fill in everything once: open your bank, each profession window, a flight master, a mailbox
and the auction house (press **Claude scan**), switch to your other spec, then `/cc sync`.
The Overview tab shows what is up to date and what isn't.

### Sharing with friends

Send them the release zip and this README. Their data stays on their computer. The addon works
for any class and character, with these limits today (see the [issues](../../issues)):
every class and spec has starter stat weights from its WoW Forever guide's stat order (see
docs/STAT-WEIGHTS.md; edit your own copy on the Stat weights page), and the app is English-only.

### Playing on two computers

Each computer has its own saved file and its own `snapshot.json`; they are not synced. Sync on the
computer you played on last before asking Claude about your character.

### Updating

Close the app window and its server window, delete the old `AddOns/ClaudeCompanion` folder,
unzip the new release in its place, start the app again. Your data is in the game's
`WTF/.../SavedVariables` folder, not in the addon folder, so it is kept.

## In game

| Command | What |
| --- | --- |
| `/cc` | Open the Claude window (message from Claude, note box, Sync) |
| `/cc sync` | Save everything now (reloads the UI) |
| `/cc start <name>` / `/cc stop` / `/cc pause` | Track a grind: time, kills, loot, gold and XP per hour |
| `/cc status` | Gold, kills and XP per hour so far |
| `/cc scan` | Full auction house scan (AH open; the game allows one every 15 min) |
| `/cc note <text>` | Leave Claude a note |

Key bindings: Options > Key Bindings > AddOns > Claude Companion.

## Repository

| Path | What |
| --- | --- |
| `ClaudeCompanion/` | The addon folder exactly as installed: Lua, `.toc`, and `web/` (the app) |
| `ClaudeCompanion/web/` | App: `index.html`, `js/`, `css/`, `server.ps1` (Windows), `server.py` (macOS) |
| `ClaudeCompanion/companion-data/SCHEMA.md` | The `snapshot.json` contract Claude reads |
| `gamedata/` | Builds `web/data/gamedata.js` from QuestieDB, endgametools and ForeverDB |
| `test/harness.lua` | Runs the addon against a mock game API (Lua 5.1) |
| `tools/make-release.sh` | Builds the release zip |
| `docs/ARCHITECTURE.md` | How it fits together, data sources, contracts |
| `docs/ROADMAP.md` | What's next |
| `docs/STAT-WEIGHTS.md` | Default stat weights for every spec, and where the numbers come from |
| `docs/ui-language.md` | The words, marks and colours the app uses for item advice |

## Develop

    # addon tests (mock game API)
    cd /tmp && lua5.1 -e 'ADDONDIR="<repo>/ClaudeCompanion"' <repo>/test/harness.lua

    # app logic: stat weights and item advice (node)
    node test/web/advice.test.js

    # game-data pack (~10 min first time)
    pip install lupa && sh gamedata/build.sh
    cp gamedata/work/out/gamedata.js ClaudeCompanion/web/data/

    # release zip
    sh tools/make-release.sh

CI (`.github/workflows/checks.yml`) runs the harness, Lua/JS/Python syntax checks, and refuses
commits that contain a saved file or snapshot.

**Never commit personal data**: `SavedVariables`, `snapshot.json`, `web/data.js` and AH scans are
in `.gitignore`.
