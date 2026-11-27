# Developing Claude Companion

Agents: start with [../CLAUDE.md](../CLAUDE.md). Every interface and its check: [INTERFACES.md](INTERFACES.md);
how the parts work: [ARCHITECTURE.md](ARCHITECTURE.md). Work on a branch, open a pull request; CI (`checks.yml`) must pass, and merging to `main`
publishes the build (`publish.yml`) to the `stable` branch and to the public download folder, which
every installed app updates from and friends download from.

## Releases

- Every merge to `main` that passes CI **and changes something in `ClaudeCompanion/`** becomes a build:
  a commit on the `stable` branch, and the zips plus `latest.json` in the download folder
  (`supabase/functions/publish-build`), which installed apps update from. A merge that only touches
  docs, tests, CI or `.claude/` is not published, so no computer is asked to `/reload` for it. A manual
  run of `publish.yml` always publishes. The repository stays private.
- The version is `## Version` in `ClaudeCompanion/ClaudeCompanion.toc`; `Core.lua` `ns.VERSION` and the
  newest `CHANGELOG.md` section must say the same (CI checks). To start a new version, change all three
  in one PR.
- Write what changed for players in `CHANGELOG.md` under the current version.
- The upload function's source is `supabase/functions/publish-build/index.ts`; deploy it to the sync
  project with `verify_jwt` off (it checks the caller's GitHub OIDC token itself).
- The game-data loader is `supabase/functions/publish-game/index.ts` (same: `verify_jwt` off). A PR that adds
  a `game` table (tools/pack-to-rows.py) needs, before it merges: its migration applied live (`game_load` and
  `game_finish` must know the table, or every pack load ends "incomplete"), then this function redeployed with
  the table in `TABLES` (or it refuses the table's chunks). Both only add, so the live pack keeps loading.

## Repo hooks

Tested 22 Nov 2026: hooks in this repository's `.claude/settings.json` do **not** load in Claude project
threads (a report-only test hook never ran in a fresh thread), so nothing here relies on them. Checks
that must hold go in CI or in the database (for example `private.claude_put_setting`).

## Layout

| Path | What |
| --- | --- |
| `ClaudeCompanion/` | The addon folder exactly as installed: Lua, `.toc`, and `web/` (the app) |
| `ClaudeCompanion/web/` | App: `index.html`, `js/`, `css/`, `server.ps1` + `Claude Companion.bat` (Windows), `server.py` + `Claude Companion.app` (macOS) |
| `ClaudeCompanion/companion-data/SCHEMA.md` | The `snapshot.json` contract Claude reads, and the From Claude cards format |
| `gamedata/` | Builds the app's game data: `web/data/gamedata.js` (QuestieDB, endgametools, ForeverDB), `web/data/suffixes.js` (foreverchanges.pro), `web/js/icons.js` (wowdev listfile) |
| `test/harness.lua` | Runs the addon against a mock game API (Lua 5.1) |
| `tools/publish-stable.py` | Publishes a build to the `stable` branch (CI runs it after a merge to main) |
| `tools/make-release.py` | The first-install zips for Windows and Mac (CI attaches them to the release) |
| `installer/` | The installers in those zips: `windows/install.ps1` (+ `.bat`), `mac/Install Claude Companion.app` |
| `tools/make-icons.py` | Draws the app icon (PNG for the installed app, `.icns` for the Mac launcher) |
| `tools/check-cards.py` | Checks a From Claude `cards.json` before Claude writes it: the format, then the answer rules (`tools/answer_rules.py`), then each `game.drop:` fact against the pack (`tools/game.py`) |
| `tools/game.py` | The `game` schema's look-ups offline, from the pack (`tools/pack-to-rows.py` rows, the `game.drop_rates` labels); ships as `claude/game.py` for a friend's Claude. `test/web/game.test.js` compares every drop label and the look-ups with the database; `test/kit_test.py` runs the built kit without node |
| `tools/check-answer.py` | The same answer rules on a chat draft, line by line (Claude's self-check before sending) |
| `tools/audit.py` | The weekly correction audit: counts a week's correction log by cause against `docs/audit-baseline.json` ([COACHING.md](COACHING.md)) |
| `tools/answer_rules.py` | The answer rules; the Postgres card gate (`*_card_gate.sql`) is the same, kept equal by `test/web/cards-gate.test.js` |
| `tools/make-drops.py` | Writes `ClaudeCompanion/Drops.lua` (the pack's drop chances, for the grind panel) from `web/data/gamedata.js`; `--check` in CI |
| `CLAUDE.md` | The agent guide: where the truth lives, reading the app's scores, writing cards, rules for changes |
| `docs/INTERFACES.md` | Every interface between the parts: owner, format, version, CI check |
| `docs/HANDOFF.md` | The state at the coaching/build split (23 Nov): the owner's decisions and why, unfinished work, traps |
| `docs/PROJECTS.md` | The Claude projects (coaching, build, a friend's): what each owns, the `from-coaching` handoff, the instructions to paste |
| `ClaudeCompanion/claude/` | The Claude kit shipped in every build for a friend's Claude: `GUIDE.md`, `SETUP.md`; `publish-stable.py` adds COACHING.md, FEATURES.md and the checkers (`KIT`) |
| `docs/ARCHITECTURE.md` | How it fits together, data sources |
| `docs/ROADMAP.md` | What's next |
| `docs/STAT-WEIGHTS.md` | Default stat weights for every spec, and where the numbers come from |
| `docs/ui-language.md` | The words, marks and colours the app uses for item advice |

## Run the tests

    # addon tests (mock game API)
    cd /tmp && lua5.1 -e 'ADDONDIR="<repo>/ClaudeCompanion"' <repo>/test/harness.lua

    # app logic: stat weights and item advice (node)
    node test/web/advice.test.js
    node test/web/classes.test.js     # every class and spec: trees, weights, weapon DPS per hand, who wears what
    node test/web/bis-lists.test.js   # the real pack's pre-BiS shows the picks published Forever lists agree on

    # game data: one source per domain (docs/ARCHITECTURE.md, Data sources); rebuild ~10 min first time.
    # .github/workflows/pack.yml does all of this every Monday on a pack/rebuild-* branch (and starts checks.yml there);
    # the build project's scheduled task opens the PR and merges it when the checks pass. By hand:
    pip install lupa && sh gamedata/build.sh
    cp gamedata/work/out/{gamedata,suffixes}.js ClaudeCompanion/web/data/ && cp gamedata/work/out/icons.js ClaudeCompanion/web/js/
    cp gamedata/work/out/COVERAGE.md gamedata/
    python3 -I tools/make-drops.py   # the in-game grind panel's drop chances, from the new pack
    # check the shipped data is complete (CI runs both)
    python3 -I gamedata/test_pack.py ClaudeCompanion/web/data/gamedata.js && node test/web/data.test.js

    # the contract between addon, servers, page and sync backend (docs/INTERFACES.md)
    node test/contract.test.js origin/main

    # web tests: merge rules, self-update end to end (no network)
    node test/web/merge.test.js
    # Claude's cards through the real backend SQL (needs a local Postgres: PGHOST/PGPORT/PGUSER)
    node test/web/claude.test.js
    # From Claude cards (#163): the step engine in node, then the From Claude tab in Chromium
    node test/web/cardsteps.test.js && node test/web/cards-browser.js
    # Claude updates the cards after a save (#169): the page's side; the servers' side is in server-api.test.js
    # (start the server with CC_CLAUDE=test/fixtures/fake-claude.js, a stand-in for Claude Code)
    node test/web/runner-browser.js
    python3 test/update_test.py

    # the first-install zips (CI runs the installers on Windows and macOS: installers.yml)
    python3 tools/make-release.py dist

CI (`.github/workflows/checks.yml`) runs all of it, plus syntax checks, and refuses commits that
contain a saved file or snapshot. A merge to `main` that passes is published to `stable` by
`.github/workflows/publish.yml`, and every installed app picks it up by itself.

**Never commit personal data**: `SavedVariables`, `snapshot.json`, `web/data.js` and AH scans are
in `.gitignore`.
