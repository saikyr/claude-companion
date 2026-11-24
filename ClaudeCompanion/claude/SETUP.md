# Claude Companion with Claude: set up in one paste

The Companion app works fully on its own. A Claude project adds a coach that reads what the app worked
out (your gear scores for every spec, quest rewards, gold per hour, flips) and answers questions like
"which reward should I take?" or "where should I farm?". Its suggestions show in the app's
**From Claude** tab as cards you can tick off.

Claude can also install the Companion for you, so you don't need to download anything first.

## What you need

- WoW Forever installed (English client), on Windows or a Mac.
- The **Claude desktop app** (Windows or Mac), signed in with a Claude plan that has projects (Pro or above).

## Set it up (once, about 5 minutes)

1. In the Claude desktop app, click **New project**. Name it **Claude Companion**.
2. Paste the whole text below into **What do you want to work on?**. Nothing to fill in.
3. Leave **Context** empty (no folder to create or add: Claude asks for the one it needs), and click
   **Create project**. If Claude doesn't start on its own, say **set me up**.

Claude then checks whether the Companion is installed. If it isn't, it runs the installer for you or gives
you one line to paste into PowerShell (Windows) or Terminal (Mac). Then it asks for access to your
`ClaudeCompanion` addon folder, reads your character, and is ready. In game, type `/reload` once so the app
has your data.

The guide Claude follows is in that folder (`claude/GUIDE.md`) and updates itself with the app.

## The text to paste into the project's instructions

```
I play WoW Forever. Set up the Claude Companion for me, then be my coach with it.
If you can't open my ClaudeCompanion addon folder yet: install it by running the line for my system
(if you can't run commands on my computer, give me the line to paste and wait until I say it's done).
It finds the game, installs the addon and opens the app.
On Windows, in PowerShell:
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $d="$env:TEMP\ClaudeCompanion-setup"; Remove-Item "$d","$d.zip" -Recurse -Force -EA 0; iwr -UseBasicParsing 'https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Windows.zip' -OutFile "$d.zip"; Expand-Archive "$d.zip" $d; powershell -NoProfile -ExecutionPolicy Bypass -File "$d\files\install.ps1"
On a Mac, in Terminal:
d="${TMPDIR:-/tmp}/ClaudeCompanion-setup"; rm -rf "$d" "$d.zip"; curl -fsSL -o "$d.zip" 'https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Mac.zip' && ditto -x -k "$d.zip" "$d" && "$d/Install Claude Companion.app/Contents/MacOS/install"
Then ask for access to World of Warcraft/_forever_/Interface/AddOns/ClaudeCompanion, tell me to
/reload in game, and say who you see. Before every answer, read claude/GUIDE.md in that folder and
follow it exactly.
```

## Already installed, or don't want Claude to install it?

Install it yourself from the download (`READ ME.txt` in the zip says how), then do steps 1 to 3 above: Claude
sees it's installed and goes straight to folder access.

- Windows: https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Windows.zip
- Mac: https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Mac.zip

## Good to know

- Cards your Claude writes show on the computer whose folder it uses. Your other computers don't get them.
- Your Claude reads only your own folder. It can't see anyone else's data, and nobody else's Claude can
  see yours.
- The app syncs your history between your own computers through the Companion's sync service. The person
  who runs that service can see what is stored there. To keep everything on one computer: the app's
  System tab, **Turn sync off on this computer**.
- Found something wrong or missing in the app? Tell the person who gave you the Companion.
