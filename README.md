# Claude Companion

An addon for **World of Warcraft Forever** plus a small app on your own computer. The addon records
your character: gear, bags and bank, both specs' talents and action bars, quests, professions,
reputation, gold, loot, grinds and dungeon runs, and auction house prices and sales. The app shows all
of it in one window, scores gear for your spec, tracks farms and flips, and writes a compact summary
that Claude reads when it coaches you. Claude's suggestions come back as cards in the app's
**From Claude** tab.

Works for any class and spec. English game client only, for now.

## Install

1. Download the newest build for your computer (no account needed):
   **[ClaudeCompanion-Windows.zip](https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Windows.zip)** or **[ClaudeCompanion-Mac.zip](https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Mac.zip)**.
2. Open it:
   - **Windows:** right-click the zip, **Extract All**, then double-click **Install Claude Companion** in
     the extracted folder. If Windows asks, choose **Run** (or **More info > Run anyway**).
   - **Mac:** double-click the zip, then **Install Claude Companion**. The first time, macOS says it can't
     check the app: click **Done**, open **System Settings > Privacy & Security**, scroll down and click
     **Open Anyway** (on macOS 14 and older: Control-click the app, **Open**). If the Mac has no Python 3
     yet, it offers Apple's free Command Line Tools; install them and open the app again.
3. The installer finds your WoW Forever folder (or asks you to pick the **World of Warcraft** folder),
   puts the addon in `_forever_/Interface/AddOns/ClaudeCompanion` and opens the app in your browser.
4. In game: `/reload` if the game was running, then `/cc sync`. The app shows your character a few
   seconds later.

From then on the app starts by itself (hidden) when you sign in to your computer, and **updates
itself**: every tested build installs within about 30 minutes; type `/reload` in game when the app
says so. To keep it handy: **Install as an app** in the app's sidebar (Chrome, Edge), or in Safari
**File > Add to Dock**. On Windows it is also in the Start menu.

To fill everything in once: open your bank, each profession window, a flight master, a mailbox and
the auction house (press **Claude scan**), switch to your other spec, then `/cc sync`. The Overview tab
shows what is up to date.

## Several computers

Each install makes its own private sync account, with no sign-up. To see the same history on another
computer, install there too, then on the first computer open **System > Link another computer** and
type the code it shows on the second one. Each computer shows your character as the computer that
played last saw it.

## In game

| Command | What |
| --- | --- |
| `/cc` | The Claude Companion window: a note to Claude, and Sync |
| `/cc sync` | Save everything now (reloads the UI) |
| `/cc start <name>` / `/cc stop` / `/cc pause` | Track a grind: time, kills, loot, gold and XP per hour |
| `/cc status` | Gold, kills and XP per hour so far |
| `/cc scan` | Full auction house scan (AH open; the game allows one every 15 min) |
| `/cc note <text>` | Leave Claude a note |

Key bindings: Options > Key Bindings > AddOns > Claude Companion.

## Your data

- The addon writes only the game's own saved file (`WTF/.../SavedVariables/ClaudeCompanion.lua`). The
  app reads it through a small server that answers only your own computer (`localhost:47615`).
- **Sync:** your history (journal, grinds, runs, AH prices and sales, settings) and your character's
  current state are sent to the Companion's sync database (Supabase), under a random key made on your
  computer, so your own computers can share them. The person who runs this project's sync database can
  see what is stored there. Nothing else leaves your computer. To keep it all on this computer, open
  the app's System tab and press **Turn sync off on this computer** (you can turn it back on there).
- Updates come from the same download folder as the zips, only builds that passed every test; every
  file is checked against the build's checksums before anything is installed, and a backup is kept
  (the last 5).

## Remove

- **Windows:** in `AddOns\ClaudeCompanion\web`, run `Claude Companion.bat uninstall` (from a Command
  Prompt in that folder), then delete the `AddOns\ClaudeCompanion` folder.
- **Mac:** in Terminal, `/usr/bin/python3 "<your AddOns folder>/ClaudeCompanion/web/server.py" --uninstall`,
  then delete the `AddOns/ClaudeCompanion` folder.

Your saved data stays in the game's `WTF` folder until you delete it.

## More

- What changed: [CHANGELOG.md](CHANGELOG.md)
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the source code itself is private)
- Developing, tests and releases: [docs/DEVELOP.md](docs/DEVELOP.md)
- License: [MIT](LICENSE). Not affiliated with Blizzard Entertainment.
