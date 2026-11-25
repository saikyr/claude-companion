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

    // drop-rate labels, against the pack's own rows (the rates change with every weekly rebuild): a Forever
    // row is [kind, npc, id, pct, seen, ..., origin 'f', 'm', corpses]
    const vm = require('vm'), dc = {}; dc.window = dc; vm.createContext(dc);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../ClaudeCompanion/web/data/gamedata.js'), 'utf8'), dc);
    const GD = dc.GAMEDATA;
    const shRow = (GD.src[2378] || []).find((r) => r[1] === 'Skeletal Horror' && r[10] === 'f' && r[12] > 0);
    const sh = one(`select row_to_json(r)::text from game.drop_rates r where item_name = 'Skeleton Finger' and source = 'Skeletal Horror'`);
    check(shRow && sh.rate === 'forever' && Number(sh.rate_pct) === shRow[3] && sh.corpses === shRow[12] && Number(sh.rate_low) < shRow[3] && Number(sh.rate_high) > shRow[3],
      `a Forever rate with its range and sample (${sh.label}; pack ${shRow && shRow[3]}% of ${shRow && shRow[12]})`);
    check(new RegExp(`^${String(shRow[3]).replace('.', '\\.')}% \\(95% range [0-9.]+-[0-9.]+%, ${shRow[12]} corpses, ForeverDB players\\)$`).test(sh.label), 'the label says Forever range, corpses and who measured it');
    // a Forever row whose seen count differs from its corpses: the rate uses the corpses
    let odd = null;
    for (const [id, rows] of Object.entries(GD.src)) { const r = (rows || []).find((x) => x[0] === 'drop' && x[10] === 'f' && x[12] > 0 && x[4] > 0 && x[4] !== x[12]); if (r && GD.items[id]) { odd = [id, r]; break; } }
    const oddRate = odd && one(`select coalesce((select row_to_json(r)::text from game.drop_rates r where item_id = ${odd[0]} and source = ${lit(odd[1][1])} limit 1), 'null')`);
    check(odd && oddRate && oddRate.corpses === odd[1][12], `a rate uses the measured corpses, never the seen count (${odd && GD.items[odd[0]][0]}: ${odd && odd[1][12]}, not ${odd && odd[1][4]})`);
    const counts = one(`select json_object_agg(rate, n)::text from (select rate, count(*) n from game.drop_rates where kind = 'drop' group by rate) x`);
    // ForeverDB measures more kills every week: the Forever count only has a floor (each label itself is checked row by row above)
    check(counts.forever > 700 && counts.forever < counts.unknown && counts.classic > 1500 && counts.unknown > 30000, `drop rows by label: ${JSON.stringify(counts)}`);
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
    const av = one(`select json_agg(x)::text from (select (game.quest(id::text))->0->'dungeonQuest' d from game.quests q join game.live l on q.slot = l.slot and q.pack = l.hash where cat = 'Alterac Valley') x`);
    check(av.length > 10 && av.every((x) => x.d === false), `game.quest: battleground quests are not dungeon quests (Alterac Valley, ${av.length})`);
    const lore = one(`select game.quest('1159')::text`)[0];
    const pre = lore && lore.prev[0] ? one(`select game.quest('${lore.prev[0].id}')::text`)[0] : null;
    check(lore && lore.dungeonQuest && pre && pre.dungeonQuest && pre.keep.step, `game.quest: an earlier step of a dungeon chain is kept too (${pre && pre.title}: ${pre && JSON.stringify(pre.keep)})`);
    const scara = one(`select game.quest('5803')::text`)[0];
    check(scara.dungeonQuest && /Scholomance/.test(scara.keep.dungeon) && scara.keep.step.id === 5505, `game.quest: Araj's Scarab is kept for the Scholomance key (${JSON.stringify(scara.keep)})`);
    const scholo = one(`select game.instance('Scholomance')::text`);
    check(scholo.dropsTotal > 300 && scholo.drops.length === 300 && scholo.drops[0].boss === true, `game.instance: the best 300 of ${scholo.dropsTotal} drops, bosses first, with the total`);
    // recipes (#145): every profession recipe's tools and place, learned or not (VMaNGOS, Classic, labelled so)
    const rod = one(`select game.recipe('Runed Arcanite Rod')::text`);
    const mi = rod.recipes.find((r) => r.spell === 20036);
    check(rod.total >= 30 && mi && mi.name === 'Enchant 2H Weapon - Major Intellect' && mi.profession === 'Enchanting' && /Classic/.test(rod.from),
      `game.recipe: every recipe that needs a Runed Arcanite Rod (${rod.total}), Enchant 2H Weapon - Major Intellect among them, labelled Classic`);
    const one20036 = one(`select game.recipe('20036')::text`);
    check(one20036.total === 1 && JSON.stringify(one20036.recipes[0].tools) === JSON.stringify([{ id: 16207, name: 'Runed Arcanite Rod' }]), 'game.recipe: one recipe by spell id, its tool by id and name');
    const reaver = one(`select game.item('17015')::text`)[0];
    const rv = reaver && reaver.recipes.madeBy[0];
    check(rv && rv.tools[0].name === 'Blacksmith Hammer' && rv.place === 'The Black Anvil' && rv.taughtBy.some((t) => t.id === 17059),
      `game.item: the Dark Iron Reaver is made with a Blacksmith Hammer at The Black Anvil, taught by Plans: Dark Iron Reaver (${JSON.stringify(rv)})`);
    const rodItem = one(`select game.item('16207')::text`)[0];
    const needRod = rod.recipes.filter((r) => r.match === 'tool').length;
    check(needRod === rod.recipes.filter((r) => r.tools.some((t) => t.id === 16207)).length && rod.recipes.some((r) => r.match === 'name' && r.makes.some((m) => m.id === 16207)) && !rod.note,
      `game.recipe: each recipe says what matched: ${needRod} need the rod (tool), the rod's own recipe by its name`);
    check(one(`select game.recipe(' 20036 ')::text`).total === 1 && one(`select game.recipe('%')::text`).total === 0, 'game.recipe: the input is trimmed, and % is a character, not a wildcard');
    check(rodItem && rodItem.recipes.toolFor.length === needRod && rodItem.recipes.toolFor.some((r) => r.spell === 20036) && rodItem.recipes.madeBy.some((r) => r.name === 'Runed Arcanite Rod'),
      `game.item: the rod lists the ${needRod} recipes it is the tool for, and the recipe that makes it`);
    const plans = one(`select game.item('17059')::text`)[0];
    check(plans && plans.recipes.teaches.some((r) => r.spell === 20890), 'game.item: a recipe item says what it teaches and its tools');

    // tools/game.py (claude/game.py in every build: a friend's Claude has no database) reads the same rows and
    // labels them the same way: every drop row, and the look-ups, against the database
    const PY = `import sys, json; sys.path.insert(0, sys.argv[1]); from game import Game, jsonable; g = Game()
out = {'rates': sorted(json.dumps([r['item_id'], r['kind'], r['source'], r['source_id'], r['zone'], r['rate'], r['label']], ensure_ascii=False) for r in g.rates),
       'item': g.item('Skeleton Finger'), 'npc': g.npc('Skeletal Horror'), 'q': [g.quest(x) for x in ('5803', '5505', '4862', '1159')],
       'strat': g.instance('Stratholme'), 'status': g.status(),
       'rodItem': g.item('16207'), 'reaver': g.item('17015'), 'rod': g.recipe('Runed Arcanite Rod'), 'r20036': g.recipe('20036'), 'part': g.recipe('Major Intellect')}
print(json.dumps(out, ensure_ascii=False, default=jsonable))`;
    const py = JSON.parse(execFileSync('python3', ['-c', PY, path.join(__dirname, '../../tools')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    const pgRates = JSON.parse(B.query(`select json_agg(x order by x)::text from (select json_build_array(item_id, kind, source, source_id, zone, rate, label)::text x from game.drop_rates) s`))
      .map((x) => JSON.stringify(JSON.parse(x)));
    const pyRates = py.rates.map((x) => JSON.stringify(JSON.parse(x)));
    const a = new Set(pgRates), b = new Set(pyRates);
    const onlyPg = pgRates.filter((x) => !b.has(x)), onlyPy = pyRates.filter((x) => !a.has(x));
    check(pgRates.length === pyRates.length && !onlyPg.length && !onlyPy.length,
      `game.py: every drop row labelled as the database labels it (${pyRates.length} rows${onlyPg.length ? '; database only: ' + onlyPg.slice(0, 2).join(' ') + '; game.py only: ' + onlyPy.slice(0, 2).join(' ') : ''})`);
    // canonical: keys sorted (jsonb sorts them), lists of {id, title} by id (the database doesn't order them)
    const canon = (v) => Array.isArray(v) ? (v.every((e) => e && typeof e === 'object' && 'id' in e && 'title' in e) ? [...v].sort((p, q) => p.id - q.id) : v).map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    const diff = (p, q, at) => { const P = JSON.stringify(p), Q = JSON.stringify(q); if (P === Q) return null;
      if (p && q && typeof p === 'object' && typeof q === 'object') for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) { const d = diff(p[k], q[k], at + '.' + k); if (d) return d; }
      return `${at}: ${String(P).slice(0, 200)} vs ${String(Q).slice(0, 200)}`; };
    const same = (what, p, q) => { const d = diff(canon(p), canon(q), ''); check(!d, `game.py ${what} is the database's` + (d ? ` (${d})` : '')); };
    same('item', py.item, one(`select game.item('Skeleton Finger')::text`));
    // the database leaves rows of equal rate in no set order: drop lists compare as sets
    const asSet = (lst) => lst.map((x) => Object.assign({}, x, { drops: x.drops.map((d) => JSON.stringify(canon(d))).sort() }));
    same('npc', asSet(py.npc), asSet(one(`select game.npc('Skeletal Horror')::text`)));
    ['5803', '5505', '4862', '1159'].forEach((id, i) => same('quest ' + id, py.q[i], one(`select game.quest('${id}')::text`)));
    const ps = py.strat, ds = one(`select game.instance('Stratholme')::text`);
    same('instance (bosses, rules, unlocks, total)', [ps.bosses, ps.rules, ps.unlocks, ps.dropsTotal], [ds.bosses, ds.rules, ds.unlocks, ds.dropsTotal]);
    same('instance drops (as a set)', ps.drops.map((d) => JSON.stringify(canon(d))).sort(), ds.drops.map((d) => JSON.stringify(canon(d))).sort());
    same('item with recipes (a tool)', py.rodItem, one(`select game.item('16207')::text`));
    same('item with recipes (crafted)', py.reaver, one(`select game.item('17015')::text`));
    same('recipe by spell id', py.r20036, one(`select game.recipe('20036')::text`));
    // the order of equal-profession recipes by name is the database's collation: compared as sets
    const recSet = (x) => Object.assign({}, x, { recipes: x.recipes.map((r) => JSON.stringify(canon(r))).sort() });
    same('recipes by tool (as a set)', recSet(py.rod), recSet(one(`select game.recipe('Runed Arcanite Rod')::text`)));
    same('recipes by part of a name (as a set)', recSet(py.part), recSet(one(`select game.recipe('Major Intellect')::text`)));
    const dbst = one('select game.status()::text');
    check(py.status.pack === meta.hash && JSON.stringify(canon(py.status.counts)) === JSON.stringify(canon(dbst.counts)) && Date.parse(py.status.built) === Date.parse(dbst.built),
      `game.py status: the pack the database loaded, its counts and build time (${JSON.stringify(py.status.counts)})`);

    // reads stay whole while a new pack loads, and after a load that fails half-way (a slot of its own)
    const live = () => B.query('select count(*) from game.drop_rates') + '/' + B.query(`select count(*) from game.items i join game.live l on i.slot = l.slot and i.pack = l.hash`);
    const before = live();
    const f0 = meta.files.find((f) => f.table === 'drops');
    B.query(`set role service_role; select public.game_load('ffffffffffffffff', 'drops', ${lit(fs.readFileSync(path.join(out, f0.file), 'utf8'))}::jsonb);`);
    check(live() === before && one('select game.status()::text').pack === meta.hash, `a half-loaded new pack changes no read (${before})`);
    check(/incomplete/.test(fails(`set role service_role; select public.game_finish('ffffffffffffffff', ${lit(JSON.stringify(meta))}::jsonb);`)), 'and it is never switched to');
    check(/in use/.test(fails(`set role service_role; select public.game_load('${meta.hash}', 'rules', '[]');`)), 'the pack in use is never written');
    // a full second pack (same rows, another hash) switches reads to the other slot, whole
    for (const f of meta.files) B.query(`set role service_role; select public.game_load('eeeeeeeeeeeeeeee', '${f.table}', ${lit(fs.readFileSync(path.join(out, f.file), 'utf8'))}::jsonb);`);
    B.query(`set role service_role; select public.game_finish('eeeeeeeeeeeeeeee', ${lit(JSON.stringify(meta))}::jsonb);`);
    check(one('select game.status()::text').pack === 'eeeeeeeeeeeeeeee' && live() === before, `a finished pack replaces the old one whole (${live()})`);
  } finally { B.drop(); fs.rmSync(out, { recursive: true, force: true }); }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
