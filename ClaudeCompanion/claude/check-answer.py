#!/usr/bin/env python3
"""Self-check a chat answer before sending it (CLAUDE.md, "Before answering"): the same answer rules as
the From Claude cards (tools/answer_rules.py). Chat can't be checked by the database, so this is the check.

    python3 tools/check-answer.py draft.txt        (or text on stdin)   -> "ok" or the problems, exit 1

A line it flags is fixed by saying where the number comes from, not by rewording around the rule.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from answer_rules import line_rules


def check(text):
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        for rule, msg in line_rules(line):
            out.append(f'line {n}: [{rule}] {msg}: "{line.strip()[:70]}"')
    return out


if __name__ == '__main__':
    text = open(sys.argv[1], encoding='utf-8').read() if len(sys.argv) > 1 else sys.stdin.read()
    problems = check(text)
    print('\n'.join(problems) if problems else 'ok')
    sys.exit(1 if problems else 0)
