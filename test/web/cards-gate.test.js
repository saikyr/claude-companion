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
// Skeleton Finger from Skeletal Horror: its Forever rate and corpses from the pack, since the weekly rebuild
// changes them (the cases below are written with 36.36% of 220, and get the pack's numbers)
const PACK = (() => { const vm = require('vm'), dc = {}; dc.window = dc; vm.createContext(dc);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ClaudeCompanion/web/data/gamedata.js'), 'utf8'), dc); return dc.GAMEDATA; })();
const FINGER = (PACK.src[2378] || []).find((r) => r[2] === 202 && r[10] === 'f' && r[12] > 0);
const live = (x) => JSON.parse(JSON.stringify(x).replace(/36\.36%/g, FINGER[3] + '%').replace(/\b220 corpses/g, FINGER[12] + ' corpses'));

const START = '2026-11-22T22:00:00.000Z';
const snapshot = {
  schema: 1, savedInGame: new Date().toISOString(), character: { name: 'Ana', level: 59, hearth: 'Stormwind City', crit: 5.2, resting: true },
  grind: { running: null, recent: [{ name: 'cultists', start: START, hours: 1.2, kills: 80, deaths: 0, gph: 300000, gph_low: 250000, gph_high: 520000, complete: true, incomplete: [] },
    { name: 'ogres', start: '2026-11-22T20:00:00.000Z', hours: 0.5, kills: 30, gph: 600000, complete: false, incomplete: ['ended by the addon after time away or a crash'] }] },
  runs: [{ name: 'Stratholme', start: '2026-11-21T20:00:00.000Z', hours: 1.5, kills: 200, gph: 450000, complete: true }],
  ah: { flips: { totals: { profit: 810000, sold: 900000, paid: 90000 } } },
};
const farm = (extra) => Object.assign({ id: 'farm-fingers', kind: 'farm', title: 'Skeleton Fingers in Duskwood', risk: 'Level 30s mobs, no elites; low risk.',
  facts: [{ label: 'Drop rate', value: '36.36% (220 corpses)', src: 'game.drop:2378:202' }] }, extra || {});

// [name, card, rules both engines must report, rules only Postgres reports (it checks the snapshot's numbers;
// a game.drop fact both check, check-cards.py against the pack through tools/game.py)]
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
  ['a Classic rate with its src, not called Classic', farm({ facts: [{ label: 'Drop chance', value: '49.07% (3 kills seen)', src: 'game.drop:537:6033' }] }), ['value'], []],
  ['a Classic rate with its src, called Classic', farm({ facts: [{ label: 'Drop chance', value: '49.07% (Classic rate, not Forever)', src: 'game.drop:537:6033' }] }), [], []],
  ['a Forever rate without its corpses', farm({ facts: [{ label: 'Drop rate', value: '36.36%', src: 'game.drop:2378:202' }] }), ['rate', 'value'], []],
  ['a rate sourced to a drop with no rate', farm({ facts: [{ label: 'Drop rate', value: 'about 10%, 50 kills', src: 'game.drop:537:5185' }] }), ['value'], []],
  ['a rate with a non-drop src', farm({ facts: [{ label: 'Drop rate', value: '36.36% (220 corpses)', src: 'snapshot#character.level' }] }), [], ['value']],
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
  // from the review: numbers outside facts, wordings, bypasses
  ['a gph in the body, called measured', { id: 'body-gph', title: 'Cultists', body: 'Your measured gph there was 90g per hour.' }, ['gph'], []],
  ['a rate in the summary with a made-up sample', farm({ summary: 'Drops 60% (50 kills).' }), ['rate'], []],
  ['a rate written as 1 in N', farm({ summary: 'About 1 in 111 drop it.' }), ['rate'], []],
  ['a rate written as percent', farm({ body: 'Roughly 36 percent per kill.' }), ['rate'], []],
  ['gold per hour written as hourly', { id: 'hourly', title: 'Cultists', summary: 'About 31g hourly.' }, ['gph'], []],
  ['soloing', { id: 'soloing', title: 'Soloing Scholomance is easy' }, ['duo'], []],
  ['a 2 man run', { id: 'twoman', title: 'Strat as a 2 man run' }, ['duo'], []],
  ['a duo claim next to an unrelated grind fact', { id: 'duo-grind', title: 'Duo Strat Live', facts: [{ label: 'Gold per hour', value: '30.0g', src: `grind:cultists@${START}#gph` }] }, ['duo'], []],
  ['a duo claim with its measured run', { id: 'duo-run', title: 'Duo Stratholme again', facts: [{ label: 'Gold per hour', value: '45g', src: 'run:Stratholme@2026-11-21T20:00:00.000Z#gph' }] }, [], []],
  ['a /run in quotes', { id: 'run-q', title: 'Fix it', steps: ['Type "/run SetCVar(1)"'] }, ['banned'], []],
  ['a Wowhead source', { id: 'wh-src', title: 'Notes', sources: [{ label: 'Item page', url: 'https://www.wowhead.com/classic/item=1' }] }, ['banned'], []],
  ['a stat % from the snapshot', { id: 'crit', title: 'Crit', facts: [{ label: 'Crit', value: '5.2%', src: 'snapshot#character.crit' }] }, [], []],
  ['a gph from an incomplete grind, not said', { id: 'ogres', title: 'Ogres', facts: [{ label: 'Gold per hour', value: '60g', src: 'grind:ogres@2026-11-22T20:00:00.000Z#gph' }] }, [], ['value']],
  ['a gph from an incomplete grind, said', { id: 'ogres-ok', title: 'Ogres', facts: [{ label: 'Gold per hour', value: '60g (incomplete: ended away)', src: 'grind:ogres@2026-11-22T20:00:00.000Z#gph' }] }, [], []],
  ['a boolean snapshot field', { id: 'rest', title: 'Rested', facts: [{ label: 'Resting', value: 'true', src: 'snapshot#character.resting' }] }, [], []],
  ['a fact with src null and no number', { id: 'srcnull', title: 'Where', facts: [{ label: 'Spawn', value: 'east cave', src: null }] }, [], []],
  ['steps as one string', { id: 'steps-str', title: 'x', steps: 'Type /run X' }, ['format'], []],
  ['a null status', { id: 'st-null', title: 'x', status: null }, ['format'], []],
  ['a step that is not text', { id: 'steps-obj', title: 'x', steps: [{ a: 1 }] }, ['format'], []],
  ['a time that is not ISO', { id: 'iso', title: 'x', created: 'yesterday' }, ['format'], []],
  ['an updated time hours ahead of now (#150)', { id: 'ahead', title: 'x', updated: new Date(Date.now() + 3 * 3600e3).toISOString() }, ['format'], []],
  ['a created time a minute ahead (clocks differ a little)', { id: 'ahead-ok', title: 'x', created: new Date(Date.now() + 60e3).toISOString() }, [], []],
  ['an item id that is not a number', { id: 'item-x', title: 'x', items: [{ id: 'x' }] }, ['format'], []],
  ['a huge id in a src', { id: 'huge', title: 'x', facts: [{ label: 'Drop rate', value: '1% (5 kills)', src: 'game.drop:99999999999:202' }] }, ['src'], []],
  ['an impossible date', { id: 'date', title: 'x', expires: '2026-13-01T00:00:00Z' }, ['format'], []],
  ['mobs as one string', { id: 'mobs', title: 'x', track: { grind: 'g', mobs: 'ogre' } }, ['format'], []],
  // #163: Claude's order and plan, its own ticks, and the steps' game checks
  ['a plan card: order, group, Claude ticks and game checks', { id: 'plan-1', kind: 'quest', title: 'Virtuous set', order: 0, group: 'Virtuous plan', character: 'Ana',
    steps: ['Get the Ward of the Defiler', 'Hand in at the Argent Dawn', 'Honored with the Argent Dawn', 'Bring 5 Runecloth', 'Reach 60', 'Tailoring 300'],
    stepsDone: [0], doneWhen: [null, 'quest:5089', 'rep:Argent Dawn>=Honored', 'item:14047x5', 'level:60', 'skill:Tailoring>=300'] }, [], []],
  ['an order that is not a whole number', { id: 'ord', title: 'x', order: 1.5 }, ['format'], []],
  ['a negative order', { id: 'ord-neg', title: 'x', order: -1 }, ['format'], []],
  ['an order as text', { id: 'ord-str', title: 'x', order: '1' }, ['format'], []],
  ['a group that is not text', { id: 'grp', title: 'x', group: 3 }, ['format'], []],
  ['stepsDone past the last step', { id: 'sd', title: 'x', steps: ['a'], stepsDone: [1] }, ['format'], []],
  ['stepsDone twice the same step', { id: 'sd2', title: 'x', steps: ['a', 'b'], stepsDone: [0, 0] }, ['format'], []],
  ['stepsDone as text', { id: 'sd3', title: 'x', steps: ['a'], stepsDone: ['0'] }, ['format'], []],
  ['doneWhen longer than steps', { id: 'dw', title: 'x', steps: ['a'], doneWhen: [null, 'quest:1'] }, ['format'], []],
  ['a doneWhen check that is not one', { id: 'dw2', title: 'x', character: 'Ana', steps: ['a'], doneWhen: ['quest:Onyxia'] }, ['format'], []],
  ['a rep check without a standing name', { id: 'dw3', title: 'x', character: 'Ana', steps: ['a'], doneWhen: ['rep:Argent Dawn>=9000'] }, ['format'], []],
  ['game checks on a card for any character', { id: 'dw4', title: 'x', steps: ['a'], doneWhen: ['level:60'] }, ['format'], []],
  ['only nulls in doneWhen need no character', { id: 'dw5', title: 'x', steps: ['a'], doneWhen: [null] }, [], []],
  ['a faction name across two lines', { id: 'dw6', title: 'x', character: 'Ana', steps: ['a'], doneWhen: ['rep:Argent\nDawn>=Friendly'] }, ['format'], []],
  ['digits that are not 0-9', { id: 'dw7', title: 'x', character: 'Ana', steps: ['a'], doneWhen: ['quest:\u0661\u0662'] }, ['format'], []],
  ['a rate written as 2 in 5', farm({ summary: 'About 2 in 5 drop it.' }), ['rate'], []],
  ['gold each hour', { id: 'each', title: 'Cultists', summary: 'About 120 gold each hour.' }, ['gph'], []],
  ['a duo claim, unknown said about something else', farm({ id: 'duo-other', title: 'Duo Strat Live', risk: 'Deaths unknown.' }), ['duo'], []],
  ['a yes/no snapshot field', { id: 'rest-no', title: 'Rested', facts: [{ label: 'Resting', value: 'yes', src: 'snapshot#character.resting' }] }, [], []],
  ['an AH price from his own scan, right', { id: 'ah-ok', title: 'Destiny price', facts: [{ label: 'Destiny on your AH', value: '235g (lowest, your scan)', src: 'ah:647@1795369186#min' }] }, [], []],
  ['an AH price, wrong number', { id: 'ah-bad', title: 'Destiny price', facts: [{ label: 'Destiny on your AH', value: '250g', src: 'ah:647@1795369186#min' }] }, [], ['value']],
  ['an AH price from a scan that never happened', { id: 'ah-none', title: 'Destiny price', facts: [{ label: 'Destiny on your AH', value: '235g', src: 'ah:647@1795000000#min' }] }, [], ['value']],
  // #114: a list entry by a field, not its position (the order differs between computers)
  ['a grind picked by its name', { id: 'byname', title: 'Cultists', facts: [{ label: 'Kills', value: '80', src: 'snapshot#grind.recent[name=cultists].kills' }] }, [], []],
  ['a grind picked by its name, wrong number', { id: 'byname-bad', title: 'Cultists', facts: [{ label: 'Kills', value: '81', src: 'snapshot#grind.recent[name=cultists].kills' }] }, [], ['value']],
  ['a list entry that is not there', { id: 'byname-none', title: 'Trolls', facts: [{ label: 'Kills', value: '80', src: 'snapshot#grind.recent[name=trolls].kills' }] }, [], ['value']],
  ['a run picked by its name', { id: 'byname-run', title: 'Run', facts: [{ label: 'Kills', value: '200', src: 'snapshot#runs[name=Stratholme].kills' }] }, [], []],
  ['an unclosed entry pick', { id: 'byname-fmt', title: 'x', facts: [{ label: 'Kills', value: '80', src: 'snapshot#grind.recent[name=cultists.kills' }] }, ['src'], []],
  ['an AH price src without the scan time', { id: 'ah-fmt', title: 'Destiny price', facts: [{ label: 'Destiny on your AH', value: '235g', src: 'ah:647#min' }] }, ['src'], []],
  ['an AH price src with a leading zero', { id: 'ah-zero', title: 'Destiny price', facts: [{ label: 'Destiny on your AH', value: '235g', src: 'ah:0647@1795369186#min' }] }, ['src'], []],
  ['profit with only flips#sold', { id: 'sold', title: 'Flip profit', facts: [{ label: 'Sold', value: '90g', src: 'flips#sold' }] }, ['profit'], []],
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
  ['The app has no data; expect 120g/hr.', ['gph']],
  ['Drops about 36 percent of the time.', ['rate']],
  ['Soloing it is easy.', ['duo']],
  ['Type `/run ReloadUI()` to fix it.', ['banned']],
  ['Your measured gph there was 30g per hour (app, 1.2 hours).', []],
];

CASES.splice(0, CASES.length, ...live(CASES)); CHAT.splice(0, CHAT.length, ...live(CHAT));

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
  return r.stdout.trim().split('\n').map((l) => (/: \[(\w+)\] /.exec(l) || [, 'format'])[1]);
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
    // one AH scan of Destiny (item 647), as the app syncs it (kind ah_obs)
    B.query(`insert into public.records (account_id, id, device_id, char_key, kind, t, data) values ('${account}', 'Ana-Realm|ah_obs|1795369186|x', null, 'Ana-Realm', 'ah_obs', 1795369186,
      '{"t": 1795369186, "item": 647, "key": "647", "min": 2350000, "med": 2999999, "n": 13, "qty": 13, "src": "scan"}');`);
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
    // #114: a fact Claude already wrote that has drifted is marked on its card, not a reason to refuse the list;
    // new and edited facts are still checked
    const stored = () => { const raw = B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cards' and account_id = '${account}'`); return raw ? JSON.parse(raw) : null; };
    const lvl = { id: 'lvl-card', title: 'Level', facts: [{ label: 'Level', value: '59', src: 'snapshot#character.level' }, { label: 'Kills', value: '80', src: 'snapshot#grind.recent[name=cultists].kills' }] };
    check(put([CASES[0][1], lvl]) === '', 'a list with a level fact is written');
    await pc.client.pushSnapshot(Object.assign({}, snapshot, { character: Object.assign({}, snapshot.character, { level: 60 }) }));
    const fresh = { id: 'new-card', title: 'Crit', facts: [{ label: 'Crit', value: '5.2%', src: 'snapshot#character.crit' }] };
    const r1 = put([CASES[0][1], lvl, fresh]);
    const st = stored();
    const lc = st && st.cards.find((c) => c.id === 'lvl-card');
    check(r1 === '' && lc && lc.stale && lc.stale.length === 1 && lc.stale[0].label === 'Level' && /= 60/.test(lc.stale[0].msg) && st.cards.some((c) => c.id === 'new-card'),
      `the level moved to 60: the old fact is kept and marked stale, the new card is written (${r1.slice(0, 80)} ${JSON.stringify(lc && lc.stale)})`);
    check(!lc.stale.some((x) => x.label === 'Kills'), 'a fact that still matches is not marked');
    const r2 = put([CASES[0][1], Object.assign({}, lc), fresh]);
    check(r2 === '' && stored().cards.find((c) => c.id === 'lvl-card').stale.length === 1, 'sent back with its stale marks: the marks are dropped and worked out again');
    const edited = { id: 'lvl-card', title: 'Level', facts: [{ label: 'Level', value: '58', src: 'snapshot#character.level' }] };
    check(/cards refused/.test(put([CASES[0][1], edited])), 'an edited fact with the wrong number is refused');
    check(/cards refused/.test(put([CASES[0][1], lvl, { id: 'new-bad', title: 'Level', facts: [{ label: 'Level', value: '59', src: 'snapshot#character.level' }] }])), 'a new card with the old number is refused');
    check(/cards refused/.test(put([CASES[0][1], Object.assign({}, lvl, { title: 'Swap layers' })])), 'an old card that breaks another rule is still refused');
    const dup = Object.assign({}, lvl, { facts: lvl.facts.concat([{ label: 'Level', value: '42', src: 'snapshot#character.level' }]) });
    check(/cards refused/.test(put([CASES[0][1], dup])), 'a new wrong fact with the same label and src as an old one is still refused (one excuse per old fact)');
    const laund = { id: 'laund', title: 'Level', status: 'done', facts: [{ label: 'Level', value: '7', src: 'snapshot#character.level' }] };
    check(put([CASES[0][1], lvl, laund]) === '', 'a done card is not checked');
    check(/cards refused/.test(put([CASES[0][1], lvl, Object.assign({}, laund, { status: 'open' })])), 'a done card reopened: its never-checked fact is checked');
    check(!(stored().cards.find((c) => c.id === 'laund') || {}).stale, 'a done card is not marked stale');
    check(put([CASES[0][1], lvl]) === '', 'back to the list without it');
    await pc.client.pushSnapshot(snapshot);
    check(put([CASES[0][1], lvl]) === '' && !stored().cards.find((c) => c.id === 'lvl-card').stale, 'the number matches again: the mark goes');

    // the repo's example cards pass both engines
    const example = live(JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'cards.json'), 'utf8')));
    const exPg = JSON.parse(B.query(`select private.check_cards('${account}', ${lit(JSON.stringify(example))}::jsonb)::text`));
    check(exPg.length === 0, 'test/fixtures/cards.json passes the Postgres gate' + (exPg.length ? ': ' + JSON.stringify(exPg) : ''));
    const exPy = example.cards.flatMap(pyRules);
    check(exPy.length === 0, 'and check-cards.py, its game.drop facts against the pack' + (exPy.length ? ': ' + exPy.join(' ') : ''));

    // #83: a computer sends its from-claude/cards.json (a friend's Claude, no database) through the same gate,
    // merged into the stored list card by card (the file's copy unless the stored one is newer; a card this computer
    // sent before and the file dropped goes), written as Claude's (no device)
    const before = stored().cards.map((c) => c.id).sort();
    const T = (h) => new Date(Date.UTC(2026, 10, 24, h)).toISOString();
    const fileCard = { id: 'friend-1', title: 'Level', updated: T(10), facts: [{ label: 'Level', value: '59', src: 'snapshot#character.level' }] };
    const file = (cards) => JSON.stringify({ schema: 1, cards });
    const s1 = await pc.client.pushCards(file([fileCard]));
    const after1 = stored();
    check(s1 && s1.ok && after1.cards.some((c) => c.id === 'friend-1') && before.every((id) => after1.cards.some((c) => c.id === id)),
      `a computer's cards.json is sent and merged in: the stored cards stay (${JSON.stringify(s1)})`);
    check(B.query(`select coalesce(device_id::text, 'none') from public.records where id = 'setting|cc.claude.cards' and account_id = '${account}'`) === 'none', 'and written as Claude\'s, with no device (the one-writer rule holds)');
    check(await pc.client.pushCards(file([fileCard])) === null, 'the same file again is not sent again');
    const older = Object.assign({}, fileCard, { title: 'Older', updated: T(8) });
    await pc.client.pushCards(file([older]));
    check(stored().cards.find((c) => c.id === 'friend-1').title === 'Level', 'an older copy of a card (another computer\'s file) does not replace the newer one');
    const newer = Object.assign({}, fileCard, { title: 'Newer', updated: T(12) });
    await pc.client.pushCards(file([newer]));
    check(stored().cards.find((c) => c.id === 'friend-1').title === 'Newer', 'a newer one does');
    const wrongCard = { id: 'friend-2', title: 'Level', updated: T(13), facts: [{ label: 'Level', value: '42', src: 'snapshot#character.level' }] };
    const keep = JSON.stringify(stored());
    const s2 = await pc.client.pushCards(file([newer, wrongCard]));
    check(s2 && s2.ok === false && /cards refused/.test(s2.error) && /friend-2/.test(s2.error) && JSON.stringify(stored()) === keep,
      `a file with a fact that doesn't match is refused, saying why, and nothing is written (${s2 && String(s2.error).slice(0, 100)})`);
    check(pc.client.state.cards.ok === false && pc.client.state.live.cards, 'the refusal is kept for the app to show');
    const s3 = await pc.client.pushCards(file([newer, wrongCard]));
    check(s3 && s3.ok === false, 'a refused file is tried again at the next sync (a newer snapshot can make it match)');
    check(s2.refused === true && pc.client.state.cards.refused === true, 'a refusal says it is one (Claude fixes the file), not a lost connection');
    // an edit or a withdrawal that keeps the card's time: the file is what Claude wrote last, it wins the tie
    await pc.client.pushCards(file([Object.assign({}, newer, { title: 'Edited' })]));
    check(stored().cards.find((c) => c.id === 'friend-1').title === 'Edited', 'an edit without a new updated time counts');
    await pc.client.pushCards(file([Object.assign({}, newer, { title: 'Edited', status: 'withdrawn' })]));
    check(stored().cards.find((c) => c.id === 'friend-1').status === 'withdrawn', 'so does a withdrawal');
    // a card taken out of this computer's file goes; the owner's Claude's cards (never from this computer) stay
    const other = { id: 'friend-3', title: 'Another', updated: T(14) };
    const s5 = await pc.client.pushCards(file([other]));
    const after5 = stored().cards.map((c) => c.id);
    check(s5.ok && !after5.includes('friend-1') && after5.includes('friend-3') && before.every((id) => after5.includes(id)),
      `a card this computer sent and the file no longer has is taken off; the others stay (${after5.join(', ')})`);
    const from = JSON.parse(B.query(`select (data->'from')::text from public.records where id = 'setting|cc.claude.cards' and account_id = '${account}'`));
    check(from['friend-3'] === pc.client.state.device && !from[before[0]], 'the stored list remembers which computer each card came from');
    // a file too big once merged is a refusal, which Claude can fix by taking cards out
    const big = Array.from({ length: 140 }, (_, i) => ({ id: 'big-' + i, title: 'x'.repeat(400), updated: T(15) }));
    const s6 = await pc.client.pushCards(file(big));
    check(s6 && s6.ok === false && s6.refused === true && /60 KB/.test(s6.error), `too big: refused, saying so (${s6 && s6.error})`);
    check((await pc.client.pushCards(file(big.slice(0, 20)))).ok === true, 'and a shorter file goes');
    // the owner's Claude writing the whole list online: every card is then its own
    B.query(`select private.claude_put_setting('${account}', 'cc.claude.cards', ${lit(JSON.stringify(stored()))})`);
    check(B.query(`select coalesce((data->'from')::text, 'none') from public.records where id = 'setting|cc.claude.cards' and account_id = '${account}'`) === 'none',
      "a write by the owner's Claude clears which computer cards came from");
    const s4 = await pc.client.pushCards('not json');
    check(s4 && s4.ok === false && /not JSON/.test(s4.error), 'a file that is not JSON is refused, not an error');
    const fails = (sql) => { try { B.query(sql); return ''; } catch (e) { return e.message; } };
    check(/unknown device/.test(fails(`select public.cc_put_cards('${'x'.repeat(40)}', '{"schema":1,"cards":[]}')`)), 'an unknown computer key writes nothing');
  } finally { B.drop(); fs.rmSync(out, { recursive: true, force: true }); }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
