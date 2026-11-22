# A Claude project for Claude Companion (optional)

The app works fully on its own: install it ([README](../README.md)) and you have every score, plan and
tracker. A Claude project adds a coach that reads what the app computed and answers questions ("which
reward should I take?", "where do I farm Felcloth?"), and puts its suggestions in the app's
**From Claude** tab as cards you can tick off.

Claude never re-scores anything itself: it quotes the app's numbers, for every one of your specs. The
rules it follows are in [../CLAUDE.md](../CLAUDE.md).

## Two ways to connect Claude

| | Owner of the sync database | A friend |
| --- | --- | --- |
| Reads | The Supabase connector: your newest snapshot and all history, from any computer, even when the computers are off | `companion-data/snapshot.json` on your computer, through folder access in the Claude desktop app |
| Writes cards | Online (`private.claude_put_setting`): every one of your computers shows them | `companion-data/from-claude/cards.json` on that computer |
| Needs | the Supabase connector signed in to the sync project | the Claude desktop app, with your `AddOns/ClaudeCompanion/companion-data` folder shared |

The sync database belongs to the person who runs it, so a friend's Claude can't read it. A friend's
computers still sync with each other; their Claude reads the snapshot file the app keeps on disk.

## Set up (a friend)

1. Install the app and play once: `/cc sync` in game, then open the app. The app writes
   `AddOns/ClaudeCompanion/companion-data/snapshot.json`.
2. In Claude, create a project (for example "WoW Forever"). Paste the instructions below into the
   project's instructions, with your character filled in.
3. When Claude first needs your data it asks for folder access: choose your
   `World of Warcraft/_forever_/Interface/AddOns/ClaudeCompanion/companion-data` folder.

## Instructions to paste into the project

```
I play WoW Forever with the Claude Companion addon and app. Character: <name>, <race> <class>, <realm>.
Specs: <spec 1> and <spec 2>. Main spec: <spec>.

My data: the app's snapshot, AddOns/ClaudeCompanion/companion-data/snapshot.json (folder access).
Its fields are documented in companion-data/SCHEMA.md in the same folder.

Rules:
- Read the snapshot before any answer about my character. If savedInGame is old, say so.
- Gear, quest rewards, upgrades, best in slot: quote the app's own scores for ALL my specs:
  gear[] (upgrades, preBis and its alternatives), bagAdvice[], bestOwned[], and
  quests[].rewards[].specs[] (each quest's reward items, and quests[].next for the chain).
  Never score items yourself. If the app has no score for something, say so.
- Game facts (drop rates, quests, vendors): say where each number comes from, and say when
  it is Classic data rather than Forever.
- Suggestions I should act on go in the app as From Claude cards: write
  companion-data/from-claude/cards.json in the format in SCHEMA.md (the whole list each time;
  keep a card's id to update it). Read from-claude/state.json to see what I did with them.
  Never change any other file in that folder.
```

## Set up (the owner)

The owner's project uses the Supabase connector instead of folder access, so it never needs a session
on the player's computers. The project instructions point to [../CLAUDE.md](../CLAUDE.md), which has the
queries; the account id lives in project memory.
