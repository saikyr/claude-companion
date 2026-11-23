"""The answer rules: what a From Claude card or a chat answer may claim (CLAUDE.md, "Before answering").

One set of rules, three users:
  tools/check-cards.py   a cards.json file (on a friend's computer, or before writing online)
  tools/check-answer.py  a chat draft, as a self-check before sending
  private.check_cards    the same rules in Postgres (supabase/migrations/*_card_gate.sql), which also looks
                         every fact's `src` up and compares the number; claude_put_setting refuses a card
                         list that fails. test/web/cards-gate.test.js runs the same cases through both.

Each rule works on one line of text (a chat line; for a card: its title, summary, each step, each body
paragraph, each fact as "label: value (note)"). Rule ids are the same in both engines.
"""
import re

# never in anything he acts on (each cost him once)
BANNED = [
    (r'(^|\s)/(run|script|console|dump)\b', 'an in-game script (/run, /script): never send untested commands'),
    (r'\blayer(s|ing|ed)?\b|\blayer-?hop', 'layer tips: one cost him an empty layer'),
    (r'wowhead', 'no Wowhead links or numbers: quests go to foreverchanges.pro, game facts to the game schema'),
]
PROFIT = r'\bprofit'
FLIPS = r'\bflip'
PCT = r'\d(\.\d+)?\s*%'
SAMPLE = r'\d[\d,]*\s*(corpses|kills|looted)|\bn\s*=\s*\d|\bclassic\b|\bunknown\b'
GPH = r'\d[\d,.]*\s*k?\s*(g|gold)\s*(/|per|an|a)\s*(h|hr|hour)\b|\bgph\b|gold per hour'
GPH_OK = r'\bapp\b|\bmeasured\b|grinds tab|dungeons tab|\bunknown\b'
DUO = r'\b(duo|duos|duoed|duoable|duo-able|solo|solos|soloed|soloable|solo-able|two-man|2-man)\b'
DUO_OK = r'\bunknown\b|not measured|\bmeasured\b|your (own )?run'
# a fact's src: what the number is, so Postgres can look it up and compare
SRC = (r'game\.drop:\d+:\d+'                                     # item id : creature id -> game.drop_rates
       r'|(grind|run):[^@#]+@\d{4}-\d\d-\d\dT[\d:.]+Z#(gph|gph_low|gph_high|kills|hours|deaths)'  # a grind or run in the snapshot: name@start#field
       r'|flips#(profit|sold|paid)'                              # snapshot ah.flips.totals (profit = sales matched to buys)
       r'|snapshot#[A-Za-z0-9_.]+')                              # any field of the newest snapshot, dot path, [n] as .n


def line_rules(line):
    """Problems with one line of text: [(rule, message)]."""
    t = line.lower()
    out = []
    for pat, why in BANNED:
        if re.search(pat, t): out.append(('banned', why))
    if re.search(PROFIT, t) and not re.search(FLIPS, t):
        out.append(('profit', '"profit" only for AH flips (sales matched to recorded buys); a sale alone is revenue'))
    if re.search(PCT, t) and not re.search(SAMPLE, t):
        out.append(('rate', 'a rate needs its sample (N corpses or kills), or says Classic, or unknown'))
    if re.search(GPH, t) and not re.search(GPH_OK, t):
        out.append(('gph', "gold per hour is only the app's measured gph (say so), or unknown"))
    if re.search(DUO, t) and not re.search(DUO_OK, t):
        out.append(('duo', 'duo or solo claims need a measured run, or say unknown'))
    return out


def card_lines(c):
    """The lines of a card the rules read."""
    lines = [c.get('title'), c.get('summary')]
    lines += [s for s in c.get('steps', []) if isinstance(s, str)]
    lines += [p for p in str(c.get('body') or '').split('\n\n')]
    # a fact with a grind or run src is the app's measured number (the gph rule reads that from the src)
    lines += [f'{f.get("label")}: {f.get("value")}' + (f' ({f["note"]})' if f.get('note') else '')
              + (' (measured)' if str(f.get('src', '')).startswith(('grind:', 'run:')) else '')
              for f in c.get('facts', []) if isinstance(f, dict)]
    lines += [c.get('risk')]
    return [l for l in lines if isinstance(l, str) and l.strip()]


def card_rules(c):
    """Problems with one card's claims: [(rule, message)]. Postgres also checks each src's number."""
    out = []
    whole = ' '.join(card_lines(c)).lower()
    for l in card_lines(c):
        # a duo or solo claim may say it is unmeasured anywhere on the card
        out += [(r, f'{m}: "{l[:60]}"') for r, m in line_rules(l) if not (r == 'duo' and re.search(DUO_OK, whole))]
    facts = [f for f in c.get('facts', []) if isinstance(f, dict)]
    for f in facts:
        v, src = str(f.get('value', '')), f.get('src')
        if src is not None and not (isinstance(src, str) and re.fullmatch(SRC, src)):
            out.append(('src', f'fact "{f.get("label")}": src must be game.drop:<item>:<npc>, grind:<name>@<start>#<field>, run:<name>@<start>#<field>, flips#<field> or snapshot#<path>'))
        elif re.search(r'\d', v) and src is None:
            out.append(('src', f'fact "{f.get("label")}": a number needs its src, so it can be checked'))
        elif re.search(PCT, v) and not str(src).startswith('game.drop:'):
            out.append(('rate', f'fact "{f.get("label")}": a rate comes from game.drop:<item>:<npc>'))
    text = ' '.join(card_lines(c)).lower()
    if re.search(PROFIT, text) and not any(str(f.get('src', '')).startswith('flips#') for f in facts):
        out.append(('profit', 'a card that says profit needs a flips#profit fact'))
    if c.get('kind') == 'farm' and not (isinstance(c.get('risk'), str) and c['risk'].strip()):
        out.append(('risk', 'a farm card needs risk: deaths, elites, patrols, PvP, what goes wrong'))
    return out
