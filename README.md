# Claude Companion

A World of Warcraft **Forever** addon plus a small local app. The addon records your character
(gear, bags, bank, talents for both specs, action bars, quests, professions, reputation, gold,
loot, grinds, auction house prices and sales). The app shows it all in one window on your own
computer and writes a compact `snapshot.json` that Claude reads when it coaches you. Claude's
suggestions (farms, flips, quests, gear) come back as cards in the app's **From Claude** tab.

Nothing leaves your computer: the app is a tiny server on `localhost` that reads the game's own
saved file.

## Install

1. Download `ClaudeCompanion-<version>.zip` from the [latest release](../../releases/latest).
   (Building from source: see [Develop](#develop); the zip already has the 12 MB game-data pack.)
2. Unzip it into your Forever AddOns folder, so you get `.../AddOns/ClaudeCompanion/ClaudeCompanion.toc`:
   - **Windows:** `C:\...\World of Warcraft\_forever_\Interface\AddOns\`
   - **macOS:** `/Applications/World of Warcraft/_forever_/Interface/AddOns/`
3. Start the game, log in, type `/cc sync` once. That saves everything the addon can see.
4. Set up the app, once:
   - **Windows:** double-click `AddOns\ClaudeCompanion\web\Claude Companion.bat`.
   - **macOS:** open `AddOns/ClaudeCompanion/web/Claude Companion.app`. The first time, macOS blocks it
     because it came from the internet and isn't from the App Store: choose **Done**, then
     **System Settings > Privacy & Security > Open Anyway** (macOS 15 and later; on older versions,
     Control-click the app and choose **Open**). It uses the Python 3
     that comes with Apple's Command Line Tools and offers to install them if they're missing.

   This makes the app's small server start by itself, hidden, whenever you sign in to your computer
   (no window to keep open), and opens the app in your browser. There, click **Install as an app**
   at the bottom of the sidebar (Chrome or Edge), or in Safari choose **File > Add to Dock**. From
   then on Claude Companion is a normal app: Dock, Launchpad and Spotlight on a Mac; Start menu and
   taskbar on Windows. After updating the addon, run the setup once more so the new server runs.
   To remove it from startup: `Claude Companion.bat uninstall` (Windows) or
   `/usr/bin/python3 server.py --uninstall` in that folder (macOS).
5. The app updates by itself a few seconds after each `/cc sync` (or logout) in game.

To fill in everything once: open your bank, each profession window, a flight master, a mailbox
and the auction house (press **Claude scan**), switch to your other spec, then `/cc sync`.
The Overview tab shows what is up to date and what isn't.

### Sharing with friends

Send them the release zip and this README. Their data stays on their computer. The addon works
for any class and character, with these limits today (see the [issues](../../issues)):
gear scoring only has default stat weights for Priest specs (other specs can type their own in
the Gear tab), and the app is English-only.

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
| `ClaudeCompanion/web/` | App: `index.html`, `js/`, `css/`, `server.ps1` + `Claude Companion.bat` (Windows), `server.py` + `Claude Companion.app` (macOS) |
| `ClaudeCompanion/companion-data/SCHEMA.md` | The `snapshot.json` contract Claude reads, and the From Claude cards format |
| `gamedata/` | Builds `web/data/gamedata.js` from QuestieDB, endgametools and ForeverDB |
| `test/harness.lua` | Runs the addon against a mock game API (Lua 5.1) |
| `tools/make-release.sh` | Builds the release zip |
| `tools/make-icons.py` | Draws the app icon (PNG for the installed app, `.icns` for the Mac launcher) |
| `tools/check-cards.py` | Checks a From Claude `cards.json` before Claude writes it |
| `docs/ARCHITECTURE.md` | How it fits together, data sources, contracts |
| `docs/ROADMAP.md` | What's next |

## Develop

    # addon tests (mock game API)
    cd /tmp && lua5.1 -e 'ADDONDIR="<repo>/ClaudeCompanion"' <repo>/test/harness.lua

    # game-data pack (~10 min first time)
    pip install lupa && sh gamedata/build.sh
    cp gamedata/work/out/gamedata.js ClaudeCompanion/web/data/

    # release zip
    sh tools/make-release.sh

CI (`.github/workflows/checks.yml`) runs the harness, Lua/JS/Python syntax checks, and refuses
commits that contain a saved file or snapshot.

**Never commit personal data**: `SavedVariables`, `snapshot.json`, `web/data.js` and AH scans are
in `.gitignore`.
