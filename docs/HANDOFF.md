# Handoff: from the old single project to the build project (23 Nov 2026)

Until 23 Nov one Claude project ("wow forever") both coached the owner and built the Companion. From then
on it only coaches, and the project **Claude Companion (build)** owns every change to this repository
([PROJECTS.md](PROJECTS.md)). The projects can't message each other, so this file is the handoff, together
with issue #85 and the `from-coaching` issues. It records what the repo docs don't say on their own: the
state as of the split, the owner's decisions and their reasons, what is unfinished, and the traps earlier
sessions hit. Where a repo doc covers something, it links that doc. The doc is the authority, and this
file is a snapshot.

## Where things stand

- **Version** 1.5.0 is in progress. Every merge to `main` that changes `ClaudeCompanion/` is a build, and
  every computer installs it within about 30 minutes ([ARCHITECTURE.md](ARCHITECTURE.md), "Delivery").
- **Shipped 22 and 23 Nov**, newest first. The full list is in [CHANGELOG.md](../CHANGELOG.md).

| PR | What |
| --- | --- |
| #79, #84 | The project split; the Claude kit for friends ships in every build |
| #78 | Deep-dive procedure; the weekly audit runs on a schedule |
| #77 | Loot by corpse; the app reads the combat log; risk shown on cards |
| #75 | COACHING.md; the weekly correction audit |
| #73, #74 | The card gate, so every card number is checked against its `src`; AH scan prices on cards |
| #70, #72, #76 | `private.claude_brief`, the first read, trimmed three times |
| #71 | The pack as the `game` schema, with labelled drop rates |
| #66 | Grind panel, using Forever-measured rates only |
| #62, #63 | Quest gates and the Now page |
| #60 | Quest rewards scored for every spec; cards through the account |
| #57 | The contract check |
| #50 to #56 | Gear page, recipes and gates |
| #41 to #49 | Sync |

- **Live backend** (Supabase `jucbngafdnyaizfxgplk`):
  - sync: `cc_*`, `private.history`, `now` rows, link codes;
  - the brief, the card gate and `claude_put_setting`;
  - the `game` schema, loaded by `publish.yml`;
  - the edge functions `publish-build` and `publish-game`, both checking the GitHub OIDC token, no stored secrets;
  - the public `releases` bucket, which installers and updaters read.

  Every migration in `supabase/migrations/` has been applied live.
- **The owner's computers:** a Windows PC and a MacBook, linked to one sync account. The account id is in
  the snapshot's `sync.account`; it is never committed. Each runs the app hidden at login and updates
  itself.

## Decisions the owner made, and why

These are settled. Don't reopen them unless he does.

| Decision | Why |
| --- | --- |
| **The repo stays private.** Downloads and updates come from the public Supabase `releases` bucket | He chose private on 22 Nov after first picking public |
| **No Claude session ever runs on his PC or Mac** (no Remote Control, no folder access, no installing by hand). Code reaches his computers only through merge, publish and self-update | Approval prompts on his devices blocked work over and over, and project-started Remote Control sessions can't run without prompts |
| **Claude manages GitHub alone**: branch, PR, CI, merge, close stale PRs and issues | "I'm not even looking at GH". Never hand him a GitHub chore, an approval, a merge or a command |
| **Independent review before a big change merges; no big change starts before he says go.** Small fixes go ahead | Sloppy shipped changes cost him; so did waiting on approvals |
| **The app is complete without Claude** ([INTERFACES.md](INTERFACES.md)). Every score and number is computed by the app, in one engine (`js/advice.js`, `js/gear.js`). Claude quotes them and never computes a second version | A hand-scored quest reward (Shadow only) contradicted the app, which had it as a Holy upgrade |
| **Drop rates: Forever-measured or "unknown", never Classic** (grind panel, cards, `game.drop_rates` labels) | He rejected Classic rates outright ("is this classic?") |
| **`/reload` is the one way to save.** `/cc sync` and the Sync button were removed (#64) | The game writes addon data only at /reload and logout, and a second path confused things |
| **A merge that doesn't touch `ClaudeCompanion/` is no build** (#68) | Each build asks every computer to /reload. Kit-only changes (COACHING.md, FEATURES.md, the checkers) ship with the next real build for the same reason |
| **Now page ranking is Hybrid** (every spec's gain added) | His pick |
| **Stats and tooltips use the app's own typeface and responsive layout** ([ui-language.md](ui-language.md)): rem tokens, no fixed sizes, one gold accent | He rejected a fixed-size window ("its tiny") and the in-game serif |
| **Additive migrations only. No DELETE, DROP or TRUNCATE on live data** | A merged migration has already run live. Also, a DELETE through the Supabase connector opens a confirmation he never sees, so the call hangs |

## How he wants build work done

- Read the issue or ask literally. Build the real fix, not a band-aid; if only a workaround exists, say
  so and why.
- Keep [FEATURES.md](FEATURES.md) current in the same PR as any feature change. Coaching reads it before
  saying a feature exists, and getting that wrong has made him furious.
- Batch addon (Lua) changes where you can: each one needs a /reload on both computers. A new `.toc`
  file needs a full game restart, not just a /reload. `Drops.lua` hit this.
- Replies to him are short and lead with the result. He skims.

## Unfinished and unverified

| Item | State | What to do |
| --- | --- | --- |
| `from-coaching` issues | #80 (friend has no game data), #81 (flight paths show undiscovered nodes), #82 (brief is 10.7 KB, target about 6), #83 (friend cards on one computer), #85 (this handoff) | The daily task works them |
| Old backlog #4 to #23 | From the 22 Nov gap audit, before the rebuild; several are fixed | On the first run, close each fixed one with its PR and keep the rest |
| Combat log (#77) | The dmg / resisted column layout hasn't been checked against a real Forever log | It needs `/combatlog` on in game. When snapshot `combat` fills, check the numbers. Until then empty is expected |
| Loot by corpse (#77) | Needs his first /reload on that build | Check `caps.loot` and `app.build` against the merge time before calling it broken |
| Brief size | 10.7 KB with both specs filled (#82) | The brief only selects. Trim what's selected, and never compute in it |
| Quest prerequisites | QuestieDB's "all of" and "any one of" are merged in the pack, so the check is lenient. The Dire Maul Crescent Key has no wing-level lock. MC has no date on the Forever timeline | Known limits of `js/quests.js`. Fix when an issue hits them |
| Game-data pack | Rebuilt by hand (`gamedata/build.sh`, about 10 min). CI warns when it's over 30 days old. #20 asks for a weekly rebuild | Open |

## Traps earlier sessions hit

- **Network:** cloud sessions can't reach the Supabase host over HTTPS (proxy CONNECT 403). Use the Supabase
  connector for SQL. CI talks to Supabase, sessions don't.
- **What sessions can't do:**
  - repo hooks (`.claude/settings.json`) don't load in project threads (tested, #69), so put enforcement in
    CI or the database;
  - sessions can't create GitHub releases or push tags (403);
  - deleting branches was refused by the session permission check twice.
- **Stale branches:** every branch except `main` and `stable` belongs to a merged PR. That's 14 old
  feature branches and `claude/project-thread-*`; commits that look unmerged were squash-merged. Delete
  them and turn on auto-delete if your session allows it. Otherwise leave them.
- **Retired sync accounts:** `fff05b79…` (CI), and `8d518109…` and `b02713e0…` (round-trip tests). Removing
  them needs a DELETE, so only with his explicit OK.
- **Testing on live:** try SQL inside a transaction that ends with `raise exception`, so nothing is left
  behind.
- **Endgametools page layout:** it changed on 22 Nov (a new line after the tooltip), and
  `gamedata/egt_parse.py` stops there. Check it on the next pack rebuild.
- **Icy Veins:** it blocks the cloud container. Stat weights cite it, but it can't be fetched from here.
- **Multi-row snapshot queries:** a snapshot row is large. Select the parts you need (`data->'gear'`), not
  `data::text`.

## Keeping the coaching project current

The coaching project's instructions are short and point at this repo: CLAUDE.md, COACHING.md and
FEATURES.md. Coaching threads read those fresh from `main` each time, so a merged doc change reaches
coaching with no step from him. Its instructions need pasting again only when the text in
[PROJECTS.md](PROJECTS.md), "Coaching project instructions", changes. When a PR changes that text, your
reply to him after the merge says so in one line and gives the new text to paste. That is the only way it
reaches him, because the projects can't talk to each other.
