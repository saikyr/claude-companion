// node test/web/combatlog.test.js
// The combat-log reader (js/combatlog.js) on sample logs: resists per school counted for your and your
// group's spells only, kills for you or your group, quoted names with commas, plain and advanced logging,
// a log without its header refused, and the same counts whether a file is read whole or in pieces.
'use strict';
const fs = require('fs'), path = require('path');
const C = require('../../ClaudeCompanion/web/js/combatlog.js');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));

const st = C.fresh();
const basic = read('combatlog-basic.txt');
check(C.piece(st, basic, true, 'a.txt') === basic.length, 'a whole file of whole lines is used up');
const son = st.npcs['Son of Arkkoroc'], gor = st.npcs['Gorlash, the Sea'];
check(son && son.npc === 6137, 'creatures by name, with their npc id from the GUID');
check(JSON.stringify(son.schools.shadow) === JSON.stringify({ n: 3, full: 1, dmg: 1300, resisted: 250 }),
  'shadow on the Son: 3 spells (2 hits, 1 full resist), 1300 damage, 250 resisted ' + JSON.stringify(son.schools.shadow));
check(son.schools.holy && son.schools.holy.n === 1 && son.schools.fire && son.schools.fire.n === 1 && son.schools.fire.resisted === 100,
  'holy counted; the group\'s fire counted, a stranger\'s fire resist not');
check(!son.schools.physical && Object.keys(son.schools).length === 3, 'melee and physical spells are left out');
check(son.kills === 1 && son.deaths === 2, 'kills only by you or your group (1), deaths seen at all (2)');
check(gor && gor.kills === 1 && gor.schools.shadow.full === 1 && gor.schools.shadow.n === 1, 'a name with a comma in quotes; the group\'s kill and resist');
check(st.lines === 15 && st.through === '11/22/2026 23:12:23.0000', 'lines and the last time stamp (' + st.lines + ', ' + st.through + ')');

// advanced logging (17 unit fields) and the baseAmount field, plus a half-written last line
const st2 = C.fresh();
const adv = read('combatlog-advanced.txt');
const used = C.piece(st2, adv, true, 'b.txt');
check(used > 0 && used < adv.length && String.fromCharCode(adv[used - 1]) === '\n', 'a half-written last line waits for the next read');
check(JSON.stringify(st2.npcs['Son of Arkkoroc'].schools.shadow) === JSON.stringify({ n: 3, full: 1, dmg: 1500, resisted: 250 }),
  'advanced logging: damage read from the end (900 with baseAmount, 600 without) ' + JSON.stringify(st2.npcs['Son of Arkkoroc'].schools.shadow));

// read in pieces of every size: the same counts
for (const size of [1, 7, 64, 333]) {
  const s3 = C.fresh();
  let done = 0, guard = 0;
  while (done < basic.length && guard++ < 100000) {
    const u = C.piece(s3, basic.subarray(done, Math.min(basic.length, done + size + (s3._grow || 0))), done === 0, 'a.txt');
    if (u === 0) { s3._grow = (s3._grow || 0) + size; continue; }   // the page asks for more next time; here, a bigger piece
    s3._grow = 0; done += u;
  }
  delete s3._grow;
  check(JSON.stringify(s3.npcs) === JSON.stringify(st.npcs) && s3.lines === st.lines, `read ${size} bytes at a time: the same counts`);
}

const st4 = C.fresh();
check(C.piece(st4, new TextEncoder().encode('hello\nworld\n'), true, 'x.txt') === -1 && st4.bad['x.txt'], 'a file without the COMBAT_LOG_VERSION header is refused');
check(Object.keys(st4.npcs).length === 0, 'and nothing is counted from it');

const sum = C.summary(st);
const text = JSON.stringify(sum);
check(sum.npcs[0].name === 'Son of Arkkoroc' && sum.creatures === 2, 'the summary: creatures with the most counts first');
check(!/Gabriel|Friend|Stranger|Player-/.test(text) && !/Mind Blast/.test(text), 'no player names, GUIDs or spell names leave the page');
check(C.summary(C.fresh()) === null, 'no log read: no combat section');
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
