# The Claude projects around the Companion

Three kinds of Claude work with the Companion. Each has one job, and the boundaries below say who owns
what, so no project does another's work. **The app is complete without any of them**
([INTERFACES.md](INTERFACES.md)).

| | Coaching (the owner's) | Build (the owner's) | A friend's own |
| --- | --- | --- | --- |
| Job | Answers the owner about the game, his character and gold; writes From Claude cards | Builds and runs the Companion: addon, app, sync backend, game data, CI, releases | Answers one friend about their own character; writes cards on their computer |
| Project | "wow forever" (the existing one: its memory, project files, scheduled tasks) | "Claude Companion (build)", a new project | the friend's own project in their Claude desktop app |
| Repository | `saikyr/claude-companion` attached: reads docs and code, runs the checkers, opens `from-coaching` issues; never pushes | `saikyr/claude-companion`: branches, PRs, merges | none (the repository is private); reads the kit in its addon folder |
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

## Keeping each project current

Coaching reads CLAUDE.md, COACHING.md and FEATURES.md fresh from `main`, so the build project keeps them
current in the same PR as the change, and coaching follows with no step from the owner. Only a change to
the coaching instructions text below needs pasting: the build PR that changes it gives him the new text in
its reply. What the build project inherited at the split (state, his decisions, traps):
[HANDOFF.md](HANDOFF.md).

## Setting it up (done 23 Nov)

1. The owner created a project named **Claude Companion (build)**, add the repository
   `saikyr/claude-companion` to it, and pasted the build instructions below into its instructions.
2. He sent it **start**; its Claude created its daily task.
3. The coordinator pasted the coaching instructions below into the coaching project ("wow forever").

The texts below leave out his name, character and account id (`<name>`, `<account id>`: never
committed); the pasted copies have them filled in. Nothing else moved: the coaching project keeps its memory, project files and scheduled tasks
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
  The repo is attached to read docs and code, run tools/check-cards.py and tools/check-answer.py,
  and open from-coaching issues (gh: env -u GH_TOKEN gh api ...). Never push to it.
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
- The older backlog (issues #4 to #23, from the 22 Nov gap audit) predates the foundation rebuild:
  on the first run, close the ones already fixed (with the PR that fixed them) and keep the rest.
- His own requests here come first.
```

## A friend

A friend can't join the owner's projects (they're private to him) and can't read this repository (it is
private too). What a friend gets is public: the download, and the text below that sets up their Claude:

1. **The app.** The friend downloads the zip for their computer (README, "Install"), runs the installer,
   then `/reload` in game. Their install makes its own sync account in the owner's sync database, under a
   random key; their own computers link with **System > Link another computer**. The owner can see what is
   stored there (README, "Your data"); the friend can turn sync off on any computer.
2. **Their own Claude, optional, in one paste.** The friend creates a project in the Claude desktop app and
   pastes the short text from `ClaudeCompanion/claude/SETUP.md` into "What do you want to work on?" in the
   New project dialog (Context stays empty). Claude asks for folder access to the addon folder and reads it;
   it never installs or runs anything (24 Nov: a friend's Claude asked to run an install line could neither
   run it nor fetch the zip to check it, warned about it, and confused the friend). Every rule is in
   `claude/GUIDE.md`, which the text sends Claude to before every answer, and which ships with every build
   together with COACHING.md, FEATURES.md and the checkers (`tools/publish-stable.py`, `KIT`), so it is
   never older than their app. `test/contract.test.js` checks the message below carries SETUP.md's two
   blocks unchanged.

What a friend's Claude can't do, today:

- Read the brief, the history beyond the snapshot, or the `game` schema (issue #80): those are the owner's database.
  It reads `snapshot.json` (the newest 20 grinds, 10 runs, 25 sales and buys, flips) and cites Forever
  sources for game facts.
- Sync cards to the friend's other computers: `from-claude/cards.json` is per computer (issue #83).
- Have its cards' numbers looked up: offline, `check-cards.py` checks the format and the answer rules,
  not each number against its source.

A message the owner can send a friend: SETUP.md's two blocks, word for word. Before it, the friend needs WoW
Forever (English client) on Windows or a Mac, and for the coach the Claude desktop app on a plan with
projects (Pro or above). The installer finds the game folder (or asks for it); a Mac without Python 3 is
offered Apple's free Command Line Tools.

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
