#!/usr/bin/env python3
"""Turn out/coverage.json into a short, honest COVERAGE.md.   python3 -I coverage_md.py <coverage.json> <out.md>"""
import json, sys
r = json.load(open(sys.argv[1])); c = r['counts']
pct = lambda a, b: f"{100 * a / b:.0f}%" if b else '-'
gear = c.get('gear_tooltip_endgametools', 0) + c.get('gear_stats_foreverdb_fallback', 0) + c.get('gear_no_stats', 0)
L = [f"# Game-data coverage ({r['built']})", '',
     'Sources: ' + '; '.join(f'{k.replace("_", " ")}: {v}' for k, v in r['from'].items()), '',
     '| What | Covered | Gap |', '| --- | --- | --- |',
     f"| Quests (QuestieDB) | {c['quests']:,} incl. {c['quests_forever_only']:,} Forever-only | {c.get('quests_skipped_no_title', 0)} QuestieDB stubs with no title (the game's name fills them) |",
     f"| Quest giver / turn-in | {pct(c['quests_with_giver'], c['quests'])} / {pct(c['quests_with_turnin'], c['quests'])} | {c['quests'] - c['quests_with_turnin']:,} quests without a turn-in NPC |",
     f"| Quest XP | {c['quests_with_xp']:,} ({c['quests_with_xp_from_forever_traces']:,} measured by Forever players) | {c['quests'] - c['quests_with_xp']:,} without XP (your quest log shows XP once accepted) |",
     f"| Quest rewards split fixed / choose-one | {c['quests_with_reward_split']:,} | {c['quests_with_reward_items_unsplit']:,} only know which items, not the split (shown as \"rewards\") |",
     f"| Weapon and armor tooltips (endgametools) | {c['gear_tooltip_endgametools']:,} of {gear:,} ({pct(c['gear_tooltip_endgametools'], gear)}) | {c.get('gear_stats_foreverdb_fallback', 0):,} use ForeverDB stats (no endgametools page, mostly Season of Discovery items in the client); {c.get('gear_no_stats', 0):,} have no stats anywhere (not in the Forever client yet) |",
     f"| Item icons | {c['items_with_icon']:,} of {c['items']:,} | {c['items'] - c['items_with_icon']:,} without an icon in ForeverDB |",
     f"| Where items come from | {c['items_with_sources']:,} items | the rest have no known source |",
     f"| Seen dropping on Forever (player uploads) | {c['items_seen_dropping_on_forever']:,} items | |",
     f"| Drop chance | {c['items_with_drop_rate']:,} items | only {c['items_with_forever_rate']:,} are Forever-measured rates; the rest are labelled Classic rates |",
     f"| Vendors | {c['items_with_vendor']:,} items | |",
     '', f"Pack size {c['pack_kb'] / 1024:.1f} MB. endgametools pages missing: {c['egt_pages_missing']:,} (404: not on Forever, or test/monster items).",
     'The game always wins in the app: your own tooltips, quest log rewards and AH scans replace pack data.']
open(sys.argv[2], 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
