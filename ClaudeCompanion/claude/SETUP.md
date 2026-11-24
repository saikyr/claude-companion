# Claude Companion with Claude: set up

The Companion app works fully on its own. A Claude project adds a coach that reads what the app worked
out (your gear scores for every spec, quest rewards, gold per hour, flips) and answers questions like
"which reward should I take?" or "where should I farm?". Its suggestions show in the app's
**From Claude** tab as cards you can tick off.

## What you need

- WoW Forever installed (English client), on Windows or a Mac.
- For the coach: the **Claude desktop app**, signed in with a Claude plan that has projects (Pro or above).

## Set it up (once, about 5 minutes)

You install the Companion yourself, the normal way: a download and an installer you double-click. Claude
never runs anything on your computer; it only reads your addon folder, and writes its cards there.

```
1. Install the Companion (about 2 minutes):
   - Windows: download https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Windows.zip
     Right-click the zip, Extract All, open the folder, double-click Install Claude Companion.
     If Windows warns: More info, then Run anyway.
   - Mac: download https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Mac.zip
     Double-click the zip, then Install Claude Companion. The first time: System Settings,
     Privacy & Security, Open Anyway.
   It finds the game, installs the addon and opens the app. Then type /reload in game.
2. In the Claude desktop app: New project, name it Claude Companion, paste the text below into
   "What do you want to work on?", leave Context empty, click Create project.
   It asks for your addon folder: allow it.
```

## The text to paste into "What do you want to work on?"

```
I play WoW Forever with the Claude Companion addon and app. I install it myself; you are my coach.
1. Ask for access to my ClaudeCompanion addon folder. It is in my World of Warcraft folder, in
   _forever_/Interface/AddOns/ClaudeCompanion (Windows: usually C:\Program Files (x86)\World of Warcraft,
   Mac: /Applications/World of Warcraft). Use folder access only: never run, download or install anything.
2. If that folder isn't there yet, the Companion isn't installed: tell me to install it from the download
   I was given, type /reload in game, and tell you when it's done.
3. Then read claude/GUIDE.md and companion-data/snapshot.json in that folder, and tell me in a few lines
   who you see (character, level, specs, professions) and how old the data is.
Before every answer, read claude/GUIDE.md in that folder and follow it exactly.
```

## Good to know

- Cards your Claude writes show on the computer whose folder it uses. Your other computers don't get them.
- Your Claude reads only your own folder. It can't see anyone else's data, and nobody else's Claude can
  see yours.
- The app syncs your history between your own computers through the Companion's sync service. The person
  who runs that service can see what is stored there. To keep everything on one computer: the app's
  System tab, **Turn sync off on this computer**.
- Found something wrong or missing in the app? Tell the person who gave you the Companion.
