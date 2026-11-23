# Using Claude as your coach (optional)

The Companion app works fully on its own. A Claude project adds a coach that reads what the app worked
out (your gear scores for every spec, quest rewards, gold per hour, flips) and answers questions like
"which reward should I take?" or "where should I farm?". Its suggestions show in the app's
**From Claude** tab as cards you can tick off.

## What you need

- The Companion installed, and one `/reload` in game, so the app has written your data.
- The **Claude desktop app** (Windows or Mac), signed in with a Claude plan that has projects.

## Set it up (about 5 minutes, once)

1. In the Claude desktop app, create a project (for example "WoW Forever").
2. Paste the text below into the project's instructions, with your character filled in.
3. In a chat in that project, ask anything. When Claude first asks for folder access, choose your
   `ClaudeCompanion` addon folder:
   - Windows: `...\World of Warcraft\_forever_\Interface\AddOns\ClaudeCompanion`
   - Mac: `/Applications/World of Warcraft/_forever_/Interface/AddOns/ClaudeCompanion`

That's it. The guide Claude follows is in this folder (`claude/GUIDE.md`) and updates itself with the app.

## Instructions to paste into the project

```
I play WoW Forever with the Claude Companion addon and app.
Character: <name>, <race> <class>, <realm>. Specs: <spec 1> and <spec 2>. Main spec: <spec>.
Professions: <professions>. What I care about: <gold, gear for my main spec, raiding, ...>.

My data is in my AddOns/ClaudeCompanion folder (folder access). Before any answer about my
character, my gold or the app, read claude/GUIDE.md there and follow it exactly. In short:
- Read companion-data/snapshot.json first and say how old it is.
- Gear, quest rewards, upgrades: quote the app's own scores for ALL my specs. Never score items
  yourself; if the app has no score, say so.
- Never drop a quest the app marks keep. Never call a sale profit. Never work out gold per hour
  yourself. Game facts from Forever sources, cited; Classic numbers labelled Classic.
- Anything I should act on goes on a From Claude card, checked with claude/check-cards.py.
- The only file you write is companion-data/from-claude/cards.json.
```

## Good to know

- Cards your Claude writes show on the computer whose folder it uses. Your other computers don't get them.
- Your Claude reads only your own folder. It can't see anyone else's data, and nobody else's Claude can
  see yours.
- The app syncs your history between your own computers through the Companion's sync service. The person
  who runs that service can see what is stored there. To keep everything on one computer: the app's
  System tab, **Turn sync off on this computer**.
- Found something wrong or missing in the app? Tell the person who gave you the Companion.
