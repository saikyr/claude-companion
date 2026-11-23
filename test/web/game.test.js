// node test/web/game.test.js
// The game data in the database (supabase/migrations/*_game_data.sql) loaded from the real pack the app uses,
// the way the publish workflow loads it (tools/pack-to-rows.py, then public.game_load / game_finish as the
// service role): every row arrives, reads switch only to a complete pack, drop rates carry their label
// (Forever with a 95% range and corpses / Classic flagged / unknown), and known facts read back as the app has them.
const { sqlBackend } = require('../sql/backend.js');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const lit = (s) => '$j$' + s + '$j$';

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
  execFileSync('python3', [path.join(__dirname, '../../tools/pack-to-rows.py'), '--out', out]);
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'pack.json'), 'utf8'));
  const B = sqlBackend();
  try {
    const one = (sql) => JSON.parse(B.query(sql));
    check(one('select game.status()::text').pack === null, 'nothing loaded: game.status says so');
    const fails = (sql) => { try { B.query(sql); return ''; } catch (e) { return e.message; } };
    check(/permission denied/.test(fails(`set role anon; select public.game_load('0123456789abcdef', 'rules', '[]');`)), "the publishable key can't load game data");
    check(/permission denied/.test(fails(`set role anon; select game.item('Runecloth');`)), "the publishable key can't read the game schema (owner only)");

    // load as the publish function does: every chunk, then finish
    const t0 = Date.now();
    let loaded = 0;
    for (const f of meta.files) {
      const rows = fs.readFileSync(path.join(out, f.file), 'utf8');
      loaded += Number(B.query(`set role service_role; select public.game_load('${meta.hash}', '${f.table}', ${lit(rows)}::jsonb);`));
    }
    console.log(`     (loaded ${loaded} rows in ${Math.round((Date.now() - t0) / 1000)} s)`);
    check(one('select game.status()::text').pack === null, 'a pack being loaded is not read until it is finished');
    const short = JSON.parse(JSON.stringify(meta)); short.counts.items += 1;
    check(/incomplete/.test(fails(`set role service_role; select public.game_finish('${meta.hash}', ${lit(JSON.stringify(short))}::jsonb);`)), 'a pack missing rows is refused');
    B.query(`set role service_role; select public.game_finish('${meta.hash}', ${lit(JSON.stringify(meta))}::jsonb);`);
    const st = one('select game.status()::text');
    check(st.pack === meta.hash && Object.keys(meta.counts).every((k) => st.counts[k] === meta.counts[k]), `every row of the pack arrived (${JSON.stringify(st.counts)})`);
    check(B.query(`set role service_role; select public.game_pack();`) === meta.hash, 'the loaded pack hash is what the workflow compares with');

    // drop-rate labels
    const sh = one(`select row_to_json(r)::text from game.drop_rates r where item_name = 'Skeleton Finger' and source = 'Skeletal Horror'`);
    check(sh.rate === 'forever' && Number(sh.rate_pct) === 36.36 && sh.corpses === 220 && Number(sh.rate_low) < 36.36 && Number(sh.rate_high) > 36.36,
      `a Forever rate with its range and sample (${sh.label})`);
    check(/^36\.36% \(95% range 30\.\d+-42\.\d+%, 220 corpses, ForeverDB players\)$/.test(sh.label), 'the label says Forever range, corpses and who measured it');
    const silk = one(`select row_to_json(r)::text from game.drop_rates r where item_name = 'Silk Cloth' and source = 'Skeletal Horror'`);
    check(silk.corpses === 47 && Number(silk.rate_pct) === 2.13, 'a rate uses the measured corpses, never the seen count (Silk Cloth: 47, not 158)');
    const counts = one(`select json_object_agg(rate, n)::text from (select rate, count(*) n from game.drop_rates where kind = 'drop' group by rate) x`);
    check(counts.forever > 700 && counts.forever < 1000 && counts.classic > 1500 && counts.unknown > 30000, `drop rows by label: ${JSON.stringify(counts)}`);
    const cl = one(`select row_to_json(r)::text from game.drop_rates r where rate = 'classic' limit 1`);
    check(/^Classic rate .*never quote it as a Forever rate$/.test(cl.label) && cl.rate_pct === null && cl.classic_pct !== null, 'a Classic rate is labelled and kept out of rate_pct');
    const bad = B.query(`select count(*) from game.drop_rates where rate_pct is not null and rate <> 'forever'`);
    check(bad === '0', 'rate_pct only ever holds Forever-measured rates');

    // look-ups
    const it = one(`select game.item('Skeleton Finger')::text`)[0];
    check(it && it.id === 2378 && it.sources.some((s) => s.from === 'Skeletal Horror' && s.rate === 'forever'), 'game.item: an item with its sources, labelled');
    const npc = one(`select game.npc('Skeletal Horror')::text`)[0];
    check(npc && npc.zone === 'Duskwood' && npc.drops.length > 3 && /not published/.test(npc.resistances), 'game.npc: where it is, what it drops; resistances say there is no Forever source');
    const q = one(`select game.quest('5803')::text`)[0];
    check(q && q.title === "Araj's Scarab" && q.next.some((n) => n.id === 5505) && q.link === 'https://foreverchanges.pro/quest/5803', "game.quest: a quest with its chain and a ForeverChanges link (Araj's Scarab -> The Key to Scholomance)");
    const key = one(`select game.quest('5505')::text`)[0];
    check(key && key.unlocks === 'Scholomance', 'game.quest: a step of a key chain names what it unlocks');
    const brs = one(`select game.quest('4862')::text`)[0];
    check(brs && brs.dungeonQuest === true && brs.zone === 'Blackrock Spire', 'game.quest: a Blackrock Spire quest is a dungeon quest');
    const strat = one(`select game.instance('Stratholme')::text`);
    check(strat.bosses.length > 5 && strat.drops.length > 50 && strat.rules && strat.rules.raid === false && strat.unlocks.length >= 1, `game.instance: Stratholme bosses (${strat.bosses.length}), drops, not a raid, its service-entrance key`);

    // a second load of the same pack changes nothing; a new pack replaces the rows and reads follow it
    const before = B.query('select count(*) from game.drops');
    const f0 = meta.files.find((f) => f.table === 'rules');
    B.query(`set role service_role; select public.game_load('${meta.hash}', 'rules', ${lit(fs.readFileSync(path.join(out, f0.file), 'utf8'))}::jsonb);`);
    check(B.query('select count(*) from game.drops') === before, 'loading the same rows again adds nothing');
  } finally { B.drop(); fs.rmSync(out, { recursive: true, force: true }); }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
