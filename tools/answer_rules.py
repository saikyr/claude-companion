"""The answer rules: what a From Claude card or a chat answer may claim (CLAUDE.md, "Before answering").

One set of rules, three users:
  tools/check-cards.py   a cards.json file (on a friend's computer, or before writing online)
  tools/check-answer.py  a chat draft, as a self-check before sending
  private.check_cards    the same rules in Postgres (supabase/migrations/*_card_gate.sql), which also looks
                         every fact's `src` up and compares the number; claude_put_setting refuses a card
                         list that fails. test/web/cards-gate.test.js runs the same cases through both.

Chat is checked line by line. A card is checked by its lines (title, summary, steps, body paragraphs,
where, risk, sources) and its facts: on a card, rates and gold per hour belong in facts[], each with a src
the database looks up, so a rate or a gold-per-hour number anywhere else on a card is refused.
Rule ids are the same in both engines. All patterns are ASCII (Postgres reads \\d and \\s as ASCII).
"""
import re

A = re.ASCII
# never in anything he acts on (each cost him once)
BANNED = [
    (r'(^|[^a-z0-9])/(run|script|console|dump)\b', 'an in-game script (/run, /script): never send untested commands'),
    (r'\blayer(s|ing|ed)?\b|\blayer-?hop', 'layer tips: one cost him an empty layer'),
    (r'wowhead', 'no Wowhead links or numbers: quests go to foreverchanges.pro, game facts to the game schema'),
]
PROFIT = r'\bprofit'
FLIPS = r'\bflip'
PCT = r'\d(\.\d+)?\s*(%|percent\b)|\b(\d+|one|two|three|a) in (\d|ten|five|four|three|two)'
SAMPLE = r'\d[\d,]*\s*(corpses|kills|looted)|\bn\s*=\s*\d|\bclassic\b|\bunknown\b'
GPH_NUM = (r'\d[\d,.]*\s*k?\s*(g|gold)\s*(/|per|an|a|each|every)\s*(h|hr|hour)\b'
           r'|\d[\d,.]*\s*k?\s*(g|gold)\s*hourly\b|\d[\d,.]*\s*k\s*/\s*(h|hr|hour)\b')
GPH = GPH_NUM + r'|\bgph\b|gold per hour'
GPH_OK = r"\bmeasured\b|grinds tab|dungeons tab|\bunknown\b|\bapp'?s? (gph|says|shows|measured|tracked)"
DUO = r'\b(duo|duos|duoed|duoing|duoable|duo-able|solo|solos|soloed|soloing|soloable|solo-able|two-man|2-man|two man|2 man)\b'
DUO_OK = r'\bunknown\b|not measured|measured run|your (own )?measured'
CARD_DUO_OK = r'\bunknown\b|not measured'     # on a card: on a line that names the duo or solo claim, or a fact sourced to a run
# a fact's src: what the number is, so Postgres can look it up and compare
SRC = (r'game\.drop:\d{1,9}:\d{1,12}'                            # item id : creature id -> game.drop_rates
       r'|(grind|run):[^@#]+@\d{4}-\d\d-\d\dT[\d:.]+Z#(gph|gph_low|gph_high|kills|hours|deaths)'  # a grind or run in the snapshot: name@start#field
       r'|flips#(profit|sold|paid)'                              # snapshot ah.flips.totals (profit = sales matched to buys)
       r'|snapshot#[A-Za-z0-9_]+(\[[A-Za-z0-9_]+=[^\]]+\])?(\.[A-Za-z0-9_]+(\[[A-Za-z0-9_]+=[^\]]+\])?)*'  # any field of the newest snapshot: dot path,
                                                                 # a position as .n, or an entry by a field: gear[label=Holy].upgrades[name=X].gain
       r'|ah:[1-9]\d{0,8}@\d{9,11}#(min|med)')                         # the player's AH scan: item id @ scan time (unix) -> ah_obs


def has(pat, t): return re.search(pat, t, A) is not None


def line_rules(line):
    """Problems with one line of chat: [(rule, message)]."""
    t = line.lower()
    out = [('banned', why) for pat, why in BANNED if has(pat, t)]
    if has(PROFIT, t) and not has(FLIPS, t):
        out.append(('profit', '"profit" only for AH flips (sales matched to recorded buys); a sale alone is revenue'))
    if has(PCT, t) and not has(SAMPLE, t):
        out.append(('rate', 'a rate needs its sample (N corpses or kills), or says Classic, or unknown'))
    if has(GPH, t) and not has(GPH_OK, t):
        out.append(('gph', "gold per hour is only the app's measured gph (say so), or unknown"))
    if has(DUO, t) and not has(DUO_OK, t):
        out.append(('duo', 'duo or solo claims need a measured run, or say unknown'))
    return out


def text_lines(c):
    """A card's lines that are not facts."""
    lines = [c.get('title'), c.get('summary'), c.get('where'), c.get('risk')]
    steps = c.get('steps')
    lines += [s for s in steps if isinstance(s, str)] if isinstance(steps, list) else []
    lines += re.split(r'\n\s*\n', c['body'], flags=A) if isinstance(c.get('body'), str) else []
    srcs = c.get('sources')
    lines += [f'{s.get("label") or ""} {s.get("url") or ""}' for s in srcs if isinstance(s, dict)] if isinstance(srcs, list) else []
    return [l for l in lines if isinstance(l, str) and l.strip()]


def fact_list(c):
    return [f for f in c['facts'] if isinstance(f, dict)] if isinstance(c.get('facts'), list) else []


def fact_line(f):
    return f'{f.get("label")}: {f.get("value")}' + (f' ({f["note"]})' if f.get('note') else '')


def card_rules(c):
    """Problems with one card's claims: [(rule, message)]. Postgres also checks each src's number."""
    out = []
    facts = fact_list(c)
    srcs = [f.get('src') if isinstance(f.get('src'), str) else '' for f in facts]
    lines = text_lines(c)
    whole = ' '.join(lines + [fact_line(f) for f in facts]).lower()
    duo_ok = any(has(DUO, l.lower()) and has(CARD_DUO_OK, l.lower()) for l in lines + [fact_line(f) for f in facts]) or any(s.startswith('run:') for s in srcs)
    for l in lines + [fact_line(f) for f in facts]:
        t = l.lower()
        out += [('banned', f'{why}: "{l[:60]}"') for pat, why in BANNED if has(pat, t)]
        if has(PROFIT, t) and not has(FLIPS, t): out.append(('profit', f'"profit" only for AH flips: "{l[:60]}"'))
        if has(DUO, t) and not duo_ok: out.append(('duo', f'duo or solo claims need a run src or say unknown: "{l[:60]}"'))
    for l in lines:
        t = l.lower()
        if has(PCT, t): out.append(('rate', f'a rate goes in facts[] with its game.drop src: "{l[:60]}"'))
        if has(GPH_NUM, t): out.append(('gph', f'gold per hour goes in facts[] with its grind or run src: "{l[:60]}"'))
    for f, src in zip(facts, srcs):
        v, raw = str(f.get('value', '')), f.get('src')
        t = fact_line(f).lower()
        if raw is not None and not (isinstance(raw, str) and re.fullmatch(SRC, raw, A)):
            out.append(('src', f'fact "{f.get("label")}": src must be game.drop:<item>:<npc>, grind:<name>@<start>#<field>, run:<name>@<start>#<field>, flips#<field>, snapshot#<path> or ah:<item>@<scan time>#<min|med>'))
            continue
        if has(r'\d', v) and raw is None:
            out.append(('src', f'fact "{f.get("label")}": a number needs its src, so it can be checked'))
        if has(PCT, v.lower()) and not src.startswith(('game.drop:', 'snapshot#')):
            out.append(('rate', f'fact "{f.get("label")}": a rate comes from game.drop:<item>:<npc>'))
        elif has(PCT, v.lower()) and src.startswith('game.drop:') and not has(SAMPLE, t):
            out.append(('rate', f'fact "{f.get("label")}": quote the rate with its corpses, or say Classic or unknown'))
        if has(GPH_NUM, v.lower()) and not src.startswith(('grind:', 'run:')):
            out.append(('gph', f'fact "{f.get("label")}": gold per hour comes from grind:<name>@<start>#gph or run:...'))
    if has(PROFIT, whole) and 'flips#profit' not in srcs:
        out.append(('profit', 'a card that says profit needs a flips#profit fact'))
    if c.get('kind') == 'farm' and not (isinstance(c.get('risk'), str) and c['risk'].strip()):
        out.append(('risk', 'a farm card needs risk: deaths, elites, patrols, PvP, what goes wrong'))
    return out
