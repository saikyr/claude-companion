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
check(JSON.stringify(son.schools.shadow) === JSON.stringify({ n: 2, full: 1, dmg: 1300, resisted: 250 }),
  'shadow on the Son: 2 casts (1 hit, 1 full resist; the DoT tick adds damage, not a cast), 1300 damage, 250 resisted ' + JSON.stringify(son.schools.shadow));
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

// logging restarted in the same file with advanced logging on: the new header line decides from there
const me = 'Player-1-A,"Me",0x511,0x0', mob = 'Creature-0-1-2-3-6137-0000A,"Son of Arkkoroc",0x10a48,0x0';
const advF = 'Creature-0-1-2-3-6137-0000A,0000000000000000,5000,6000,0,0,0,0,-1,0,0,0,1.5,2.5,16,1.5,58';
const restart = ['11/23/2026 02:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,0,BUILD_VERSION,1.15.8,PROJECT_ID,2',
  `11/23/2026 02:00:01.0000  SPELL_DAMAGE,${me},${mob},1,"x",0x20,100,0,32,0,0,0,nil,nil,nil,nil`,
  '11/23/2026 02:10:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.15.8,PROJECT_ID,2',
  `11/23/2026 02:10:01.0000  SPELL_DAMAGE,${me},${mob},1,"x",0x20,${advF},200,250,0,32,50,0,0,nil,nil,nil,nil`].join('\n') + '\n';
const st5 = C.fresh();
C.piece(st5, new TextEncoder().encode(restart), true, 'r.txt');
check(JSON.stringify(st5.npcs['Son of Arkkoroc'].schools.shadow) === JSON.stringify({ n: 2, full: 0, dmg: 300, resisted: 50 }) && st5.lines === 2,
  'a header written again mid-file switches to advanced logging there, and is not counted as a line ' + JSON.stringify(st5.npcs['Son of Arkkoroc'].schools.shadow));

// #90: your death names who hit you in the 10 s before: three hyenas (melee, plain and advanced logging), a fall
{
  const meF = 'Player-1-A,"Me",0x511,0x0', hy = (n) => `Creature-0-1-2-3-11360-000${n},"Gordok Hyena",0xa48,0x0`;
  const other = 'Player-1-B,"Someone",0x548,0x0', ogre = 'Creature-0-1-2-3-11441-0001,"Gordok Brute",0xa48,0x0';
  const L = ['11/23/2026 07:36:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,0,BUILD_VERSION,1.15.8,PROJECT_ID,2',
    `11/23/2026 07:36:20.0000  SWING_DAMAGE,${ogre},${meF},900,0,1,0,0,0,nil,nil,nil,nil`,                 // 44 s before: too early
    `11/23/2026 07:36:56.0000  SWING_DAMAGE,${hy(1)},${meF},400,0,1,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 07:36:57.0000  SWING_DAMAGE,${hy(2)},${meF},450,0,1,0,0,0,1,nil,nil,nil`,
    `11/23/2026 07:36:58.0000  SWING_DAMAGE,${hy(3)},${meF},350,0,1,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 07:37:00.0000  SPELL_DAMAGE,${hy(1)},${meF},17255,"Savage Bite",0x1,600,0,1,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 07:37:01.0000  SWING_DAMAGE,${hy(2)},${other},500,0,1,0,0,0,nil,nil,nil,nil`,           // hits someone else
    `11/23/2026 07:37:02.0000  SWING_DAMAGE,${meF},${hy(2)},200,0,1,0,0,0,nil,nil,nil,nil`,              // you hit it
    `11/23/2026 07:37:03.5000  SWING_DAMAGE,${hy(3)},${meF},300,50,1,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 07:37:04.0000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${meF}`,
    `11/23/2026 08:00:00.0000  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,${meF},Falling,2500,100,1,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 08:00:00.1000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${meF}`].join('\n') + '\n';
  const sd = C.fresh();
  C.piece(sd, new TextEncoder().encode(L), true, 'd.txt');
  const d = sd.deaths[0], h = d && d.by.find((x) => x.npc === 11360);
  check(sd.deaths.length === 2 && h && h.count === 3 && h.dmg === 2100 && h.hits === 5 && h.name === 'Gordok Hyena' && d.by.length === 1 && d.dmg === 2100,
    'a death: 3 Gordok Hyenas, 2100 damage in 5 hits in the last 10 s; the Brute 44 s before is left out ' + JSON.stringify(d));
  check(sd.deaths[1].by.length === 1 && sd.deaths[1].by[0].name === 'Falling' && sd.deaths[1].by[0].kind === 'world' && sd.deaths[1].by[0].dmg === 2500,
    'a fall: the world, not a creature, and the hyenas from 20 min before are not in it');
  check(sd.npcs['Gordok Hyena'].taken.dmg === 2100 && sd.npcs['Gordok Hyena'].taken.hits === 5 && sd.npcs['Gordok Brute'].taken.dmg === 900,
    'damage each creature did to you, in total (a hit on someone else is not yours)');
  const sm = C.summary(sd);
  check(sm.deaths.length === 2 && sm.deaths[0].by[0].name === 'Falling' && !JSON.stringify(sm).includes('Someone') && !JSON.stringify(sm).includes('Player-'),
    'the summary: newest death first, no player names or GUIDs');
  // advanced logging: the swing's suffix sits after the 17 unit fields
  const advU = 'Player-1-A,0000000000000000,5000,6000,0,0,0,0,-1,0,0,0,1.5,2.5,16,1.5,58';
  const A2 = ['11/23/2026 07:36:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.15.8,PROJECT_ID,2',
    `11/23/2026 07:36:58.0000  SWING_DAMAGE,${hy(1)},${meF},${advU},700,0,1,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 07:36:59.0000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${meF}`].join('\n') + '\n';
  const sa = C.fresh();
  C.piece(sa, new TextEncoder().encode(A2), true, 'e.txt');
  const advMe = 'Player-1-A,0000000000000000,5000,6000,0,0,0,0,-1,0,0,0,1.5,2.5,16,1.5,58';
  const A3 = ['11/23/2026 07:36:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.15.8,PROJECT_ID,2',
    `11/23/2026 07:40:00.0000  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,${meF},${advMe},Lava,900,0,4,0,0,0,nil,nil,nil,nil`,
    `11/23/2026 07:40:01.0000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${meF}`,
    `11/23/2026 07:50:00.0000  SPELL_CAST_SUCCESS,${meF},0000000000000000,nil,0x80000000,0x80000000,5384,"Feign Death",0x1,${advMe}`,
    `11/23/2026 07:50:00.1000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${meF}`,
    // a log without years: 31 Dec then 1 Jan; the hit 30 minutes before (by the clock going back) is not in the death
    `12/31 23:59:55.000  SWING_DAMAGE,${hy(1)},${meF},${advU},300,0,1,0,0,0,nil,nil,nil,nil`,
    `1/1 00:30:00.000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${meF}`].join('\n') + '\n';
  const sl = C.fresh();
  C.piece(sl, new TextEncoder().encode(A3), true, 'f.txt');
  check(sl.deaths.length === 2 && sl.deaths[0].by[0].name === 'Lava' && !JSON.stringify(sl.deaths).includes('Player-'),
    'advanced logging: a death in lava is named Lava, not your GUID; Feign Death is no death (' + JSON.stringify(sl.deaths) + ')');
  check(sl.deaths[1] && sl.deaths[1].by.length === 0, 'a clock that went back: a hit stamped after the death is not counted');
  check(sa.deaths[0] && sa.deaths[0].by[0].dmg === 700, 'advanced logging: the swing damage read past the unit fields (' + JSON.stringify(sa.deaths[0]) + ')');
  // read in pieces: the same deaths
  const bytes = new TextEncoder().encode(L), sp = C.fresh();
  let done = 0, grow = 0;
  while (done < bytes.length) { const u = C.piece(sp, bytes.subarray(done, Math.min(bytes.length, done + 50 + grow)), done === 0, 'd.txt'); if (u === 0) { grow += 50; continue; } grow = 0; done += u; }
  check(JSON.stringify(sp.deaths) === JSON.stringify(sd.deaths), 'read 50 bytes at a time: the same deaths');
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
