#!/usr/bin/env node
// A stand-in for Claude Code in test/web/server-api.test.js (the local servers start it as CC_CLAUDE): it answers
// `auth status`, and a `-p` run rewrites the card list the way claude/REFRESH.md asks, recording how it was started.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
// Its --help lists what 2.1.332 lists (not --max-turns, which works but is hidden). claude-run/fake-help (written by the test) makes it an older Claude Code: `old` has no --restricted (before 2.1.248),
// `older` no --setting-sources either, `liar` lists --restricted in --help but refuses it in a run
const mode = (() => { try { return fs.readFileSync(path.join('companion-data', 'claude-run', 'fake-help'), 'utf8').trim(); } catch (e) { return ''; } })();
if (args[0] === '--version') { process.stdout.write((mode ? '2.1.200' : '2.1.332') + ' (Claude Code)\n'); process.exit(0); }
if (args[0] === '--help') {
  const flags = ['-p, --print', '--setting-sources <sources>', '--strict-mcp-config', '--disable-slash-commands', '--tools <tools...>',
    '--disallowedTools, --disallowed-tools <tools...>', '--allowedTools, --allowed-tools <tools...>',
    '--permission-mode <mode>  (choices: "acceptEdits", "bypassPermissions", "default", "dontAsk", "plan")',
    '--output-format <format>', '-r, --resume [value]', '--restricted  Restricted mode']
    .filter((f) => !((mode === 'old' || mode === 'older') && f.startsWith('--restricted')) && !(mode === 'older' && f.startsWith('--setting-sources')));
  process.stdout.write('Usage: claude [options] [command] [prompt]\n\nOptions:\n' + flags.map((f) => '  ' + f).join('\n') + '\n');
  process.exit(0);
}
if (mode === 'liar' && args.includes('--restricted')) { process.stderr.write("error: unknown option '--restricted'\n"); process.exit(1); }
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
