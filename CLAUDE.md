# Agent guide (read this first)

For every Claude session that works **on** this repository or **with** the app's data. Short on
purpose; where a detail lives elsewhere, the link is the authority.

## What this is

Claude Companion = a WoW Forever addon + a local app on each player's computer + sync between their
computers (Supabase). **The app is complete without Claude.** Claude is an optional advisor: it reads
what the app computed and writes suggestions back as From Claude cards. Every boundary, its owner and
its CI check: [docs/INTERFACES.md](docs/INTERFACES.md).

## Before answering

0. **First read: the brief.** `select private.claude_brief('<account>');` (Supabase connector): where the
   player is now, its age, the app's gear scores for every spec, dungeon quests marked `keep`, and gold
   (flips = profit, sales = revenue, measured gold per hour per grind and run). Quote its numbers; it says
   how. More: `private.claude_brief('<account>', array['rep','bags','next','ah','runs'])`.
1. Read [docs/FEATURES.md](docs/FEATURES.md): what the app records, where, and what it doesn't. Never say a
   feature exists or doesn't without checking it there and in the code.
2. Query the app's own data (the snapshot and `private.history`) and say how old it is.
3. Never work out gold per hour yourself: quote the app's `gph` / `gph_low` / `gph_high` (brief `gold.measured[]`,
   snapshot `grind.recent[]`, `runs[]`), and say so when `complete` is false.
4. Never call money profit without a cost basis: profit is only `ah.flips` (sales matched to recorded
   buys). A sale alone is revenue; loot and crafts have no recorded cost.

## Where the truth lives

| Question | Read | Never |
| --- | --- | --- |
| The character now (gear, bags, quests, rep, position, professions) | the **snapshot** (below) | guess from memory or an old chat |
| Is X an upgrade? Best in slot? Which quest reward? | the snapshot's **app scores for every spec**: `gear[]` (`upgrades`, `preBis` with `alternatives`, `worn`), `bagAdvice[]`, `bestOwned[]`, `quests[].rewards[].specs[]` and `quests[].next` | score items by hand, or for one spec only |
| History (grinds, runs, sales, journal) | `private.history` (below) | |
| Game data (items, drops, quests, vendors) | the pack the app uses, one source per domain: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), Data sources | Classic data without saying it is Classic |
| Field meanings | [ClaudeCompanion/companion-data/SCHEMA.md](ClaudeCompanion/companion-data/SCHEMA.md) | |

**The scoring rule.** Before any gear, quest or reward answer, read the app's scores for **all** of the
player's specs (each `gear[]` entry is one spec; each `rewards[].specs[]` lists every spec), and quote
them. Lead with the spec the player asked about, but check every spec before any verdict ("don't take
it", "vendor it"): an item that is nothing for one spec can be an upgrade for the other. The app's
numbers are the answer. If a number is missing (an item the app doesn't score, a field
an older build doesn't write: check `data->'app'->>'build'`), say so plainly and fix the app in a PR;
don't fill the gap with a hand-made score. This rule exists because a hand-scored answer once judged a
quest reward for Shadow only while the app already showed it as a Holy upgrade.

**The dungeon-quest rule.** Never recommend abandoning a dungeon or raid quest, whatever its reward
scores. A quest counts if it, or any step of its chain, has its objective inside a dungeon or raid
(pack `quests[id].type` `Dungeon`, or `cat` / the objective naming an instance; `Raid` also marks
outdoor raid-group quests such as The Battle of Darrowshire, so check where the objective is). In a quest-log
cleanup, list those as KEEP, each tagged with its dungeon. Only open-world quests can go on a drop list.
This rule exists because a cleanup once told the player to drop Blackrock Spire and Scholomance quests
because their rewards scored low.

## Reading

**Project owner (Supabase connector, project `jucbngafdnyaizfxgplk`).** The account id is in the
snapshot's `sync.account` (and in project memory). Read-only SQL:

```sql
-- the newest snapshot of any of the account's computers (the whole snapshot.json)
select computer, at, data from private.history
 where account = '<account>' and kind = 'snapshot' order by t desc limit 1;

-- gear advice for every spec
select g->>'label' spec, g->'preBis' prebis, g->'upgrades' upgrades
  from (select data from private.history where account = '<account>' and kind = 'snapshot' order by t desc limit 1) s,
       jsonb_array_elements(s.data->'gear') g;

-- every quest reward in the log, scored for every spec (next = the chain's next quest)
select q->>'title' quest, r->>'name' item, r->>'how' how, r->'specs' specs, q->'next' next
  from (select data from private.history where account = '<account>' and kind = 'snapshot' order by t desc limit 1) s,
       jsonb_array_elements(s.data->'quests') q, jsonb_array_elements(coalesce(q->'rewards', '[]')) r;

-- history: kinds journal, session, grind, run, note, history, de, ah_obs, ah_sale, ah_buy, ah_post, live, setting
select * from private.history where account = '<account>' and kind = 'grind' order by t desc;
```

**A friend's own Claude project** has no access to the owner's database: it reads
`AddOns/ClaudeCompanion/companion-data/snapshot.json` on the friend's computer (folder access). Same
fields. Set-up: [docs/CLAUDE-PROJECT.md](docs/CLAUDE-PROJECT.md).

## Writing (cards only)

Claude writes nothing but **From Claude cards** (format: SCHEMA.md, "cards.json"). Check them first:
`python3 tools/check-cards.py cards.json` must print `ok`. Write the whole list each time; keep a card's
`id` to update it.

- Online (owner): `select private.claude_put_setting('<account>', 'cc.claude.cards', '<the cards.json text>');`
  Every computer of the account shows them at its next sync. Only that key can be written.
- On one computer (a friend): write `companion-data/from-claude/cards.json` (temp file, then rename).
- What the player did with them: `select data->>'v' from private.history where account = '<account>' and id = 'setting|cc.claude.cardsState';`
  (or `from-claude/state.json`). Claude reads it, never writes it.

## Changing the code

- Branch → PR → CI green → merge. `main` publishes itself (`publish.yml` → `stable` + the public
  download folder); every computer updates itself within ~30 min. Nothing is installed by hand on
  anyone's computer, and no agent opens a session on a player's computer to install or test.
- One engine per job: scores in `js/advice.js` + `js/gear.js`; game data from the pack; card rules in
  `tools/check-cards.py`. Add to the owner, never a second copy.
- The live database: migrations are **additive**, a merged migration is never edited (a new file
  instead), and no `DELETE`, `DROP` or `TRUNCATE` is run on live data. Try SQL on live only inside a
  transaction that ends with `raise exception` (rolled back).
- Versions: `ClaudeCompanion.toc` `## Version` = `Core.lua` `ns.VERSION` = newest `CHANGELOG.md` heading.
  `test/contract.test.js` checks this and every other contract; run it, plus the tests for what you
  touched ([docs/DEVELOP.md](docs/DEVELOP.md)).
- No Wowhead links (CI fails); quest links go to foreverchanges.pro. Words and colours in the app:
  [docs/ui-language.md](docs/ui-language.md).
