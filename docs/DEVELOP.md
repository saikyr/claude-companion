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

## Repo hooks (test)

`.claude/settings.json` holds a test hook (`.claude/hooks/hook-test.sh`) that only reports: at
session start it adds one line, "REPO HOOK TEST: …", saying whether hooks from this repository load
in a Claude session and whether the sync backend is reachable from there; tool calls are logged to
`/tmp/cc-hook-test.log`. It never blocks anything. It is replaced once the answer is recorded
(project-files `foundation/`).

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
| `tools/check-cards.py` | Checks a From Claude `cards.json` before Claude writes it |
| `CLAUDE.md` | The agent guide: where the truth lives, reading the app's scores, writing cards, rules for changes |
| `docs/INTERFACES.md` | Every interface between the parts: owner, format, version, CI check |
| `docs/CLAUDE-PROJECT.md` | Setting up an optional Claude project (owner or friend), with instructions to paste |
| `docs/ARCHITECTURE.md` | How it fits together, data sources |
| `docs/ROADMAP.md` | What's next |
| `docs/STAT-WEIGHTS.md` | Default stat weights for every spec, and where the numbers come from |
| `docs/ui-language.md` | The words, marks and colours the app uses for item advice |

## Run the tests

    # addon tests (mock game API)
    cd /tmp && lua5.1 -e 'ADDONDIR="<repo>/ClaudeCompanion"' <repo>/test/harness.lua

    # app logic: stat weights and item advice (node)
    node test/web/advice.test.js

    # game data: one source per domain (docs/ARCHITECTURE.md, Data sources); rebuild ~10 min first time
    pip install lupa && sh gamedata/build.sh
    cp gamedata/work/out/{gamedata,suffixes}.js ClaudeCompanion/web/data/ && cp gamedata/work/out/icons.js ClaudeCompanion/web/js/
    cp gamedata/work/out/COVERAGE.md gamedata/
    # check the shipped data is complete (CI runs both)
    python3 -I gamedata/test_pack.py ClaudeCompanion/web/data/gamedata.js && node test/web/data.test.js

    # the contract between addon, servers, page and sync backend (docs/INTERFACES.md)
    node test/contract.test.js origin/main

    # web tests: merge rules, self-update end to end (no network)
    node test/web/merge.test.js
    # Claude's cards through the real backend SQL (needs a local Postgres: PGHOST/PGPORT/PGUSER)
    node test/web/claude.test.js
    python3 test/update_test.py

    # the first-install zips (CI runs the installers on Windows and macOS: installers.yml)
    python3 tools/make-release.py dist

CI (`.github/workflows/checks.yml`) runs all of it, plus syntax checks, and refuses commits that
contain a saved file or snapshot. A merge to `main` that passes is published to `stable` by
`.github/workflows/publish.yml`, and every installed app picks it up by itself.

**Never commit personal data**: `SavedVariables`, `snapshot.json`, `web/data.js` and AH scans are
in `.gitignore`.
