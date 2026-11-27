#!/usr/bin/env node
// A stand-in for Claude Code in test/web/server-api.test.js (the local servers start it as CC_CLAUDE): it answers
// `auth status`, and a `-p` run rewrites the card list the way claude/REFRESH.md asks, recording how it was started.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
if (args[0] !== '-p') { process.stderr.write('unexpected: ' + args.join(' ')); process.exit(2); }
const run = path.join('companion-data', 'claude-run'), cards = path.join('companion-data', 'from-claude');
const job = JSON.parse(fs.readFileSync(path.join(run, 'run.json'), 'utf8'));
fs.writeFileSync(path.join(run, 'fake-args.json'), JSON.stringify({ args, cwd: process.cwd(), job, env: {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || null } }));
const list = JSON.parse(fs.readFileSync(path.join(run, 'cards-now.json'), 'utf8'));
// a card with id `drop` is left out, as a run that loses a card would
list.cards = list.cards.filter((c) => c.id !== 'drop');
if (list.cards[0]) Object.assign(list.cards[0], { title: list.cards[0].title.replace(/ \(updated.*$/, '') + ` (updated, ${job.why})`, updated: job.now });
fs.mkdirSync(cards, { recursive: true });
fs.writeFileSync(path.join(cards, 'cards.draft.json'), JSON.stringify(list, null, 1));
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'done', session_id: 'fake-session', num_turns: 3, permission_denials: [] }));
