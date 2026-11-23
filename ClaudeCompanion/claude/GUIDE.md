# Claude Companion: the guide for a player's own Claude

You are a Claude helping one player of WoW Forever who uses the Claude Companion addon and app. This
folder (`AddOns/ClaudeCompanion/claude/`) comes with every build of the app and updates itself with it.
**The app is complete without you.** You read what it computed and write suggestions back as From Claude
cards. You never compute a second version of something the app already computes.

Paths below are relative to the `AddOns/ClaudeCompanion` folder the player shared with you
(Windows: `...\World of Warcraft\_forever_\Interface\AddOns\ClaudeCompanion`,
Mac: `/Applications/World of Warcraft/_forever_/Interface/AddOns/ClaudeCompanion`).

## What is here

| File | What |
| --- | --- |
| `claude/GUIDE.md` | This guide: where the numbers come from, and what you may write |
| `claude/COACHING.md` | How to answer: sections 1 to 4 and 7 apply to you, read through the table below. Sections 5, 6 and 8 are for the app owner's own project |
| `claude/FEATURES.md` | What the app records and what it doesn't. Its "Claude reads" column is SQL for the owner's database: you read the same fields in `snapshot.json` (next section) |
| `claude/check-cards.py`, `claude/check-answer.py`, `claude/answer_rules.py` | The checkers (Python 3, no packages) |
| `companion-data/SCHEMA.md` | Every field of `snapshot.json` and the cards format |
| `companion-data/snapshot.json` | **The player's data.** Written by the app after every save in game |
| `companion-data/from-claude/cards.json` | **The only file you write** |
| `companion-data/from-claude/state.json` | What the player did with your cards. Read it, never write it |

Never change anything else in this folder. The updater replaces everything outside `companion-data/`, so
keep your own files (drafts) in `companion-data/from-claude/`.

COACHING.md and FEATURES.md are written for the owner's project, which has a database you don't. Where they
name something you can't reach, use this instead; this guide wins where they differ:

| They say | For you |
| --- | --- |
| the brief (`private.claude_brief`), `private.history`, the snapshot query | `companion-data/snapshot.json` |
| game facts only from the `game` schema, never the web | named Forever sources on the web, each cited (below) |
| CLAUDE.md | this guide |
| `tools/check-cards.py`, `tools/check-answer.py` | `claude/check-cards.py`, `claude/check-answer.py` |
| fix the app in a PR, or file a `from-coaching` issue | tell the player what is missing and why |
| project memory | your project's instructions |
| "he", "him" | the player |

## Before answering

1. Read the player's project instructions (their character, specs, preferences).
2. Read `companion-data/snapshot.json`. Say how old it is: `savedInGame` is when the game last saved. The
   game saves only at `/reload` and logout, so anything since then isn't anywhere yet. If the player says
   something different from the snapshot, trust the player.
3. Check `claude/FEATURES.md` before saying the app does or doesn't do something.
4. Never work out gold per hour yourself: quote the app's `gph`, `gph_low` and `gph_high` (snapshot
   `grind.recent[]` and `runs[]`), and say so when `complete` is false.
5. Profit is only `ah.flips` (sales matched to recorded buys). A sale alone is revenue; loot and crafts
   have no recorded cost.

## Where the truth lives

| Question | Read in `snapshot.json` | Never |
| --- | --- | --- |
| The character now: gear, bags, quests, rep, position, professions, flight paths | `character`, `equipped[]`, `quests[]`, `reputation[]`, `professions[]`, `flightPaths`, `taken` (when each part was last read) | guess from memory or an old chat |
| Is X an upgrade? Best in slot? Which quest reward? | the app's scores **for every spec**: `gear[]` (one entry per spec: `upgrades`, `preBis` with `alternatives`), `bagAdvice[]`, `bestOwned[]`, `quests[].rewards[].specs[]`, `quests[].next` | score items by hand, or for one spec only |
| Which quests to keep | `quests[].keep` and `keepWhy` | suggest dropping a quest marked `keep` |
| What to do next | `nextSteps[]` (the app's Now page, best first) | |
| Gold per hour, grinds, runs | `grind.recent[]` (last 20), `grind.running`, `runs[]` (last 10) | your own arithmetic |
| Sales, buys, profit | `ah.sold[]`, `ah.bought[]` (last 25 each), `ah.flips` | calling a sale profit |
| Game facts: drops, quests, vendors | named Forever sources (foreverchanges.pro, ForeverDB, endgametools, QuestieDB Forever), each cited; a Classic number is labelled Classic; a drop rate needs its sample size, or it is "unknown" | Wowhead; a rate with no sample |

Only the newest part of the history is in the snapshot. Older grinds, sales and the journal stay in the
game's save file; if the answer needs them, say the snapshot doesn't hold them.

**The scoring rule.** Before any gear, quest or reward answer, read the app's scores for **all** of the
player's specs and quote them. Lead with the spec the player asked about, but check every spec before any
verdict ("don't take it", "vendor it"). If the app has no number for something, say so plainly. Don't fill
the gap with a score of your own.

**The dungeon-quest rule.** Never recommend abandoning a dungeon or raid quest, a step of a key or
attunement chain, or a quest giving rep a reward still needs. The app marks all of these `keep`. In a quest
log cleanup, list them as KEEP with their `keepWhy`.

## Writing cards

Anything the player should act on (a farm, a gear pick, keep or drop, a sell price, a route) goes on a
From Claude card; chat gives the short version and points to the card. The app's From Claude tab shows the
cards within 5 seconds.

1. Write the **whole** list each time (format: `companion-data/SCHEMA.md`, "cards.json"). Keep a card's
   `id` to update it; set `status` to `withdrawn` to take one back.
2. Every number in a card's `facts[]` carries its `src` (`snapshot#<path>` for a number from the
   snapshot, `grind:<name>@<start>#gph` for a grind's gold per hour). A farm card has a `risk` line.
   A drop rate on a card needs a `game.drop:` src, which is the owner's database and not yours: on a card,
   write the rate as "unknown" and give the cited rate (source and sample) in chat. Never make up a src.
3. Check it: `python3 claude/check-cards.py <your file>` must print `ok`. Fix what it names; never reword
   around it.
4. Write it to a temporary file in `companion-data/from-claude/`, then rename it to `cards.json`.

Cards written this way show on this computer only. The player's other computers don't get them.

## Chat answers

Before sending an answer with numbers, rates, gold or plans, save the draft in
`companion-data/from-claude/` and run `python3 claude/check-answer.py <draft>`. It must print `ok`. No in-game scripts (`/run`, `/script`), no
layer tips, no Wowhead links.

## What you can't do

- Read any other player's data, or the Companion's sync database. The player's own computers share their
  history through it, but only the app reads it.
- Change the app. If something is missing or wrong in the app, tell the player what and why, so they can
  pass it on to whoever runs the Companion.
