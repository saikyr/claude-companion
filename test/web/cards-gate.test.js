// node test/web/cards-gate.test.js
// The answer rules, in both engines: tools/check-cards.py / tools/check-answer.py (tools/answer_rules.py)
// and the Postgres card gate (supabase/migrations/*_card_gate.sql), on the same cases: the answers that
// went wrong (sales called profit, a Classic rate, a duo claim, a layer tip) and paraphrases, plus cards
// that pass. Each case gives the rule ids it must break; both engines must agree. Then Postgres compares
// each fact's number with its src (the real game pack, a snapshot online), and claude_put_setting refuses
// what fails and writes what passes.
const S = require('../../ClaudeCompanion/web/js/sync.js');
const { sqlBackend } = require('../sql/backend.js');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const lit = (s) => '$j$' + s + '$j$';
const set = (a) => [...new Set(a)].sort().join(',');

const START = '2026-11-22T22:00:00.000Z';
const snapshot = {
  schema: 1, savedInGame: new Date().toISOString(), character: { name: 'Ana', level: 59, hearth: 'Stormwind City' },
  grind: { running: null, recent: [{ name: 'cultists', start: START, hours: 1.2, kills: 80, deaths: 0, gph: 300000, gph_low: 250000, gph_high: 520000, complete: true, incomplete: [] }] },
  runs: [{ name: 'Stratholme', start: '2026-11-21T20:00:00.000Z', hours: 1.5, kills: 200, gph: 450000, complete: true }],
  ah: { flips: { totals: { profit: 810000, sold: 900000, paid: 90000 } } },
};
const farm = (extra) => Object.assign({ id: 'farm-fingers', kind: 'farm', title: 'Skeleton Fingers in Duskwood', risk: 'Level 30s mobs, no elites; low risk.',
  facts: [{ label: 'Drop rate', value: '36.36% (220 corpses)', src: 'game.drop:2378:202' }] }, extra || {});

// [name, card, rules both engines must report, rules only Postgres reports (it checks the numbers)]
const CASES = [
  ['a farm card with a sourced Forever rate, risk and the app gph', farm({ facts: [
    { label: 'Drop rate', value: '36.36% (220 corpses, ForeverDB players)', src: 'game.drop:2378:202' },
    { label: 'Your gold per hour', value: '30.0g (app, cultists)', src: `grind:cultists@${START}#gph` }] }), [], []],
  ['sales called profit (the 81g answer)', { id: 'gold-81', title: 'You made 81g profit from AH sales today' }, ['profit', 'profit'], []],
  ['paraphrase: profit in the body, no flips fact', { id: 'gold-body', title: 'AH day', body: 'That was a nice profit.' }, ['profit', 'profit'], []],
  ['profit from flips, sourced', { id: 'flips', title: 'Flip profit so far', facts: [{ label: 'Flip profit', value: '81g', src: 'flips#profit' }] }, [], []],
  ['flip profit with the wrong number', { id: 'flips-bad', title: 'Flip profit so far', facts: [{ label: 'Flip profit', value: '95g', src: 'flips#profit' }] }, [], ['value']],
  ['a Classic rate passed off as a rate (the 8% answer)', farm({ facts: [{ label: 'Drop chance', value: '8%' }] }), ['src', 'rate'], []],
  ['paraphrase: the rate in the summary, no sample', farm({ summary: 'About a 49% chance per kill.' }), ['rate'], []],
  ['a Classic rate with its src, not called Classic', farm({ facts: [{ label: 'Drop chance', value: '49.07% (3 kills seen)', src: 'game.drop:537:6033' }] }), [], ['value']],
  ['a Classic rate with its src, called Classic', farm({ facts: [{ label: 'Drop chance', value: '49.07% (Classic rate, not Forever)', src: 'game.drop:537:6033' }] }), [], []],
  ['a Forever rate without its corpses', farm({ facts: [{ label: 'Drop rate', value: '36.36%', src: 'game.drop:2378:202' }] }), ['rate'], ['value']],
  ['a rate sourced to a drop with no rate', farm({ facts: [{ label: 'Drop rate', value: 'about 10%, 50 kills', src: 'game.drop:537:5185' }] }), [], ['value']],
  ['a rate with a non-drop src', farm({ facts: [{ label: 'Drop rate', value: '36.36% (220 corpses)', src: 'snapshot#character.level' }] }), ['rate'], []],
  ['a duo claim (the duo Strat answer)', { id: 'strat-duo', title: 'Duo Stratholme Live with your friend' }, ['duo'], []],
  ['paraphrase: soloable', { id: 'solo', title: 'Scholomance is soloable for a priest' }, ['duo'], []],
  ['a duo plan that says it is unmeasured', { id: 'duo-ok', title: 'Try a duo Stratholme run', summary: 'Whether a duo clears it is unknown: not measured yet.' }, [], []],
  ['a layer tip', { id: 'layer', title: 'Swap layers to reset the spawns' }, ['banned'], []],
  ['a /run script', { id: 'run', title: 'Fix it', steps: ['Type /run SetCVar("x", 1)'] }, ['banned'], []],
  ['a Wowhead number', { id: 'wh', title: 'Drop rate per Wowhead' }, ['banned'], []],
  ['gold per hour without the app', { id: 'gph', title: 'Farm cultists', summary: 'Easy 120g per hour here.' }, ['gph'], []],
  ['the app gph with the wrong number', farm({ facts: [{ label: 'Drop rate', value: '36.36% (220 corpses)', src: 'game.drop:2378:202' },
    { label: 'Gold per hour', value: '50g', src: `grind:cultists@${START}#gph` }] }), [], ['value']],
  ['a gph from a grind that is not there', { id: 'gph-missing', title: 'Cultists', facts: [{ label: 'Gold per hour', value: '30g', src: 'grind:cultists@2026-01-01T00:00:00.000Z#gph' }] }, [], ['value']],
  ['a number with no src', { id: 'nosrc', title: 'Wool', facts: [{ label: 'Per hour', value: '40 cloth' }] }, ['src'], []],
  ['a malformed src', { id: 'badsrc', title: 'Wool', facts: [{ label: 'Per hour', value: '40', src: 'web:wowhead' }] }, ['src'], []],
  ['a snapshot field, right', { id: 'lvl', title: 'Level', facts: [{ label: 'Level', value: '59', src: 'snapshot#character.level' }] }, [], []],
  ['a snapshot field, wrong', { id: 'lvl-bad', title: 'Level', facts: [{ label: 'Level', value: '60', src: 'snapshot#character.level' }] }, [], ['value']],
  ['a farm card without risk', farm({ risk: undefined }), ['risk'], []],
  ['a withdrawn card is no longer advice', { id: 'old', title: 'You made 81g profit', status: 'withdrawn' }, [], []],
  ['an unknown field', { id: 'typo', title: 'x', summery: 'typo' }, ['format'], []],
];
// chat lines: [text, rules]
const CHAT = [
  ['You made 81g profit today.', ['profit']],
  ['Your flips made 81g profit (sales matched to buys).', []],
  ['Skeleton Finger drops 36.36% of the time.', ['rate']],
  ['Skeleton Finger: 36.36% (95% range 30.29-42.90%, 220 corpses, ForeverDB players).', []],
  ['Dull Frenzy Scale: 49% is a Classic rate, not Forever.', []],
  ['You two can duo Strat Live.', ['duo']],
  ['Whether you can duo Strat is unknown.', []],
  ['Hop layers to find a fresh spawn.', ['banned']],
  ['Expect about 120g/hr.', ['gph']],
  ['Your measured gph there was 30g per hour (app, 1.2 hours).', []],
];

function computer(fetch, name) {
  const files = { state: JSON.stringify({ key: crypto.randomBytes(32).toString('hex') }) };
  return { files, client: S.client({ fetch, now: () => Date.now(),
    loadState: async () => JSON.parse(files.state), saveState: async (s) => { files.state = JSON.stringify(s); },
    loadCache: async () => (files.cache ? JSON.parse(files.cache) : null), saveCache: async (c) => { files.cache = JSON.stringify(c); },
    device: { name, os: 'pc' } }) };
}
const save = () => ({ items: {}, chars: { 'Ana-Realm': { lastSeen: 1795000000, journal: [{ t: 1795000001, e: 'login' }], snap: { taken: 1795000000, character: { name: 'Ana' } } } } });

function pyRules(card) {
  const f = path.join(os.tmpdir(), 'cards-' + crypto.randomBytes(4).toString('hex') + '.json');
  fs.writeFileSync(f, JSON.stringify({ schema: 1, cards: [card] }));
  const r = spawnSync('python3', [path.join(ROOT, 'tools', 'check-cards.py'), f], { encoding: 'utf8' });
  fs.rmSync(f);
  if (r.status === 0) return [];
  return r.stdout.trim().split('\n').map((l) => (/\[(\w+)\]/.exec(l) || [, 'format'])[1]);
}

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
  execFileSync('python3', [path.join(ROOT, 'tools', 'pack-to-rows.py'), '--out', out]);
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'pack.json'), 'utf8'));
  const B = sqlBackend();
  try {
    for (const f of meta.files) B.query(`set role service_role; select public.game_load('${meta.hash}', '${f.table}', ${lit(fs.readFileSync(path.join(out, f.file), 'utf8'))}::jsonb);`);
    B.query(`set role service_role; select public.game_finish('${meta.hash}', ${lit(JSON.stringify(meta))}::jsonb);`);
    const pc = computer(B.fetch, 'PC');
    await pc.client.pull({}); await pc.client.push(save(), {});
    await pc.client.pushSnapshot(snapshot);
    const account = JSON.parse(pc.files.state).account;
    const pgRules = (card) => JSON.parse(B.query(`select private.check_cards('${account}', ${lit(JSON.stringify({ schema: 1, cards: [card] }))}::jsonb)::text`));

    for (const [name, card, both, pgOnly] of CASES) {
      const py = pyRules(card), pgp = pgRules(card), pg = pgp.map((p) => p.rule);
      const want = set(both), wantPg = set(both.concat(pgOnly));
      const ok = set(py) === want && set(pg) === wantPg;
      check(ok, `${name}: ${want || 'passes'}${pgOnly.length ? ' (+ Postgres ' + set(pgOnly) + ')' : ''}` +
        (ok ? '' : ` | python ${set(py) || '-'} | postgres ${set(pg) || '-'} ${JSON.stringify(pgp.map((p) => p.msg))}`));
    }
    for (const [text, rules] of CHAT) {
      const r = spawnSync('python3', [path.join(ROOT, 'tools', 'check-answer.py')], { input: text, encoding: 'utf8' });
      const py = r.status === 0 ? [] : r.stdout.trim().split('\n').map((l) => /\[(\w+)\]/.exec(l)[1]);
      const pg = JSON.parse(B.query(`select to_json(private.answer_line_rules(${lit(text)}))::text`));
      check(set(py) === set(rules) && set(pg) === set(rules), `chat: "${text}" -> ${set(rules) || 'ok'}` + (set(py) === set(rules) && set(pg) === set(rules) ? '' : ` | python ${set(py)} | postgres ${set(pg)}`));
    }

    // the gate on the write: a failing list is refused whole, a passing one is written
    const put = (cards) => { try { B.query(`select private.claude_put_setting('${account}', 'cc.claude.cards', ${lit(JSON.stringify({ schema: 1, cards }))})`); return ''; } catch (e) { return e.message; } };
    const refused = put([CASES[0][1], CASES[1][1]]);
    check(/cards refused/.test(refused) && /gold-81 \[profit\]/.test(refused), `a list with one bad card is refused, saying which and why (${refused.slice(0, 90)}...)`);
    check(B.query(`select count(*) from public.records where id = 'setting|cc.claude.cards'`) === '0', 'and nothing was written');
    check(put([CASES[0][1], CASES[3][1]]) === '', 'a list that passes is written');
    // the repo's example cards pass both engines
    const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'cards.json'), 'utf8'));
    const exPg = JSON.parse(B.query(`select private.check_cards('${account}', ${lit(JSON.stringify(example))}::jsonb)::text`));
    check(exPg.length === 0, 'test/fixtures/cards.json passes the Postgres gate' + (exPg.length ? ': ' + JSON.stringify(exPg) : ''));
  } finally { B.drop(); fs.rmSync(out, { recursive: true, force: true }); }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
