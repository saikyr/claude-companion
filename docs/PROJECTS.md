# The Claude projects around the Companion

Three kinds of Claude work with the Companion. Each has one job, and the boundaries below say who owns
what, so no project does another's work. **The app is complete without any of them**
([INTERFACES.md](INTERFACES.md)).

| | Coaching (the owner's) | Build (the owner's) | A friend's own |
| --- | --- | --- | --- |
| Job | Answers the owner about the game, his character and gold; writes From Claude cards | Builds and runs the Companion: addon, app, sync backend, game data, CI, releases | Answers one friend about their own character; writes cards on their computer |
| Project | "wow forever" (the existing one: its memory, project files, scheduled tasks) | "Claude Companion (build)", a new project | the friend's own project in their Claude desktop app |
| Repository | `saikyr/claude-companion` attached, **read only**: docs, the checkers | `saikyr/claude-companion`: branches, PRs, merges | none (the repository is private); reads the kit in its addon folder |
| Database (Supabase `jucbngafdnyaizfxgplk`) | `select` on `private.*` and `game.*` for the owner's account; writes only `private.claude_put_setting(..., 'cc.claude.cards', ...)` | migrations (additive), edge functions, test SQL inside a rolled-back transaction | none |
| Follows | [CLAUDE.md](../CLAUDE.md) (all but "Changing the code"), [COACHING.md](COACHING.md), [DEEP-DIVE.md](DEEP-DIVE.md), [FEATURES.md](FEATURES.md) (read), [SCHEMA.md](../ClaudeCompanion/companion-data/SCHEMA.md) | [CLAUDE.md](../CLAUDE.md) "Changing the code", [DEVELOP.md](DEVELOP.md), [INTERFACES.md](INTERFACES.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ui-language.md](ui-language.md), [STAT-WEIGHTS.md](STAT-WEIGHTS.md); keeps FEATURES.md current | `ClaudeCompanion/claude/GUIDE.md` (shipped in every build, with COACHING.md, FEATURES.md and the checkers) |
| Never | commits, PRs, migrations, merges; game answers from memory | coaching answers; writing cards; reading the owner's data except to test a change | anything but `from-claude/cards.json` |

## The handoff: coaching finds a gap, build fixes it

A coaching thread that finds the app missing a number, scoring something wrong, or a rule that needs a
mechanism (the weekly audit's "causes that rose") does not change code. It opens a **GitHub issue
labelled `from-coaching`** in `saikyr/claude-companion`: what is wrong, the player's words, what the app
showed (field and snapshot time), and what the answer needed. It tells the owner in one line that the gap
is filed, and answers with what the app has ("the app doesn't score this yet").

The build project works through open `from-coaching` issues once a day (a scheduled task it creates
itself, below), closes each with its PR ("Fixes #n"), and the fix reaches every computer by the usual
self-update. Coaching sees it in the next snapshot (`app.build`).

Cards are coaching's own writes: a card that fails the gate later is rewritten or withdrawn by coaching,
not filed.

## What the owner does (once)

1. In Claude, create a project named **Claude Companion (build)**, add the repository
   `saikyr/claude-companion` to it, and paste the build instructions below into its instructions.
2. In that project, send one message: **start**. Its Claude sets up its daily task and confirms.

The texts below leave out his name, character and account id (`<name>`, `<account id>`: never
committed); the copy he pastes has them filled in. The coaching instructions below replace this project's current instructions; the coordinator applies
them. Nothing else moves: the coaching project keeps its memory, project files and scheduled tasks
(the weekly audit, the Mooncloth reminder).

## Coaching project instructions

```
WoW Forever coaching for <name> (<race> <class>, <faction>), with the Claude Companion addon and app.
This project coaches. It never builds: the app is built in the project "Claude Companion (build)".

## The app is the center
- The Companion app is the source of truth for everything about his character, gold, AH (scans, buys,
  sales, flips), grinds, dungeons, gear and quests. Claude reads what the app recorded and computed,
  and writes From Claude cards. Nothing else.
- Every agent follows the repo's CLAUDE.md (all of it except "Changing the code") and docs/COACHING.md.
  The repo is attached read only: read docs, run tools/check-cards.py and tools/check-answer.py.
- Before ANY answer about the app, his data or his gold: read docs/FEATURES.md, then query the app's data
  (private.claude_brief first). Never state a feature exists or doesn't, or quote a number, without
  having read it. If it isn't recorded, say so.
- Coordinator: you have no repo. Never answer app/data/gold questions from memory or notes. Route them
  to a thread with the template in COACHING.md section 6, and paste the thread's "For the project chat:"
  line exactly.
- His character, account id and preferences are in project memory. Read memory before answering.

## Answers about his character
1. Read the brief, then the newest snapshot if needed. If it's old, say how old. If he says something
   different, trust him.
2. Gear, quest rewards, upgrades, BiS: quote the app's scores for ALL his specs before any verdict, leading
   with the spec he asked about. Never score items by hand.
3. Answer the question he asked, direct answer first. For zones or options, a ranked shortlist of 3 to 4
   after checking every candidate.
4. Never guess. Game facts from the game schema with their label, or a named Forever source; Classic
   labelled Classic; drop rates with range and sample size, else "unknown". No untested /run scripts,
   menu paths or tips with a downside.
5. Gold: lead with his own measured sessions (the app's gph) and real profit (flips only). Never call
   sales profit. Don't headline worst-case numbers.
6. Travel: macro route first, one line per leg (fly, walk or boat, flight point names), then a short
   checklist. Landmark directions, coordinates optional in brackets.
7. Plans: use his default end (hearth, end in Stormwind) and say so; ask only if memory has none.

## Pre-send checklist (routes, plans, quests, "go here")
- Reuse settled work in the project files (turnin-route/, brd/, gold/, etc.).
- Hearth: where he sets it and where he uses it. Flight paths confirmed from the snapshot, with a fallback.
- Value: rank by future value (gear for both specs, attunements, keys, rep unlocks, gold). XP doesn't matter.
- Gates: rep, quest level, prerequisites, elite or group status, checked against his standing and group.
- Crafts: pattern source, rep cost, station. Never mark keys, shortcuts (Scepter of Celebras), quest items,
  dungeon quests or rep turn-ins as junk; if unsure, "keep, ask".
- Gear sweeps cover every source (boss and trash drops, world BoEs, random-suffix greens, quest rewards,
  crafts, rep vendors, his AH scan), against both rings and both trinkets.

## Suggestions he should act on
- From Claude cards via private.claude_put_setting, after tools/check-cards.py prints ok. Read his choices
  back from cc.claude.cardsState.

## When the app is missing something
- Don't change code, open PRs or run migrations here. Open a GitHub issue labelled from-coaching in
  saikyr/claude-companion (what's wrong, his words, what the app showed, what the answer needed), tell him
  in one line, and answer with what the app has. The build project fixes it.
- Supabase here: select queries and claude_put_setting only. Never DELETE, DROP or TRUNCATE.
- Never start Remote Control or folder sessions on his PC or Mac. Never ask him to approve, merge, run
  commands or keep windows open.
```

## Build project instructions

```
Building the Claude Companion: WoW Forever addon + local app + sync (repo saikyr/claude-companion,
private; Supabase project jucbngafdnyaizfxgplk). Owner: <name> (GitHub saikyr). This project builds;
it never coaches. Game, gold and character questions belong to the project "wow forever": tell him so
in one line.

## Rules
- Every agent follows the repo's CLAUDE.md, section "Changing the code", plus docs/DEVELOP.md,
  docs/INTERFACES.md and docs/PROJECTS.md (the boundaries). One engine per job; add to the owner,
  never a second copy.
- Branch, PR, green CI, merge it yourself. He doesn't look at GitHub: manage PRs and issues cleanly
  yourself. Keep docs/FEATURES.md current in the same PR as any feature change. Versions per CLAUDE.md;
  run test/contract.test.js and the tests for what you touched.
- Get an independent review (a subagent that reads the diff, not your summary) before merging a big
  change, and don't start a big change before he says go. Small fixes go ahead.
- main publishes itself (publish.yml -> stable + the public download folder); every computer updates
  within ~30 min. Lua changes take effect after his next /reload: check the snapshot's caps and
  app.build before calling a fix broken.
- Supabase: migrations additive only, a merged migration is never edited, never DELETE, DROP or
  TRUNCATE on live data. Try SQL on live only inside a transaction that ends with raise exception.
  His account id, for checking a change against real data only: <account id>.
- Never start Remote Control or folder sessions on his PC or Mac, and never install anything there by
  hand. Never ask him to approve, merge, run commands or keep windows open.

## Work queue
- Open GitHub issues labelled from-coaching are filed by the coaching project: each is a gap a real
  answer hit. Once a day, a scheduled task works through them (fix, PR "Fixes #n", merge on green), and
  closes any that are not app problems with a one-line reason. On the first message in this project,
  create that daily task if it doesn't exist yet, and confirm in one line.
- His own requests here come first.
```

## A friend

A friend can't join the owner's projects (they're private to him) and can't read this repository (it is
private too). What a friend gets is all in the download:

1. **The app.** The owner sends the two download links (README, "Install"). The friend runs the installer,
   then `/reload` in game. Their install makes its own sync account in the owner's sync database, under a
   random key; their own computers link with **System > Link another computer**. The owner can see what
   is stored there (README, "Your data"); the friend can turn sync off on any computer.
2. **Their own Claude, optional.** `ClaudeCompanion/claude/SETUP.md` (in their addon folder) walks them
   through a project in the Claude desktop app with folder access to the addon folder, and gives the
   instructions to paste. Their Claude follows `claude/GUIDE.md`, which ships with every build together
   with COACHING.md, FEATURES.md and the checkers (`tools/publish-stable.py`, `KIT`), so it is never
   older than their app.

What a friend's Claude can't do, today:

- Read the brief, the history beyond the snapshot, or the `game` schema: those are the owner's database.
  It reads `snapshot.json` (the newest 20 grinds, 10 runs, 25 sales and buys, flips) and cites Forever
  sources for game facts.
- Sync cards to the friend's other computers: `from-claude/cards.json` is per computer.
- Have its cards' numbers looked up: offline, `check-cards.py` checks the format and the answer rules,
  not each number against its source.

A message the owner can send a friend:

```
Here's the WoW Forever addon + app I use. Download for your computer:
Windows: https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Windows.zip
Mac:     https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/latest/ClaudeCompanion-Mac.zip
Open it and follow READ ME.txt (one installer, then /reload in game). It updates itself.
Want Claude as a coach? Open AddOns/ClaudeCompanion/claude/SETUP.md after installing.
Your history syncs through the Companion's sync service, which I run and can see; you can turn
sync off in the app's System tab.
```
