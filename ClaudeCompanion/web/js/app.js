// Claude Companion character page (v2). Reads ClaudeCompanion.lua and shows
// it the way the game does: real icons, quality colours, in-game tooltips.
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]) : []);
  const ICON_URL = 'https://wow.zamimg.com/images/wow/icons/large/';
  const STANDING = ['', 'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
  const STANDING_COLOR = ['', '#cc2222', '#ff0000', '#ee6622', '#e6d200', '#33cc33', '#00cc88', '#00ccbb', '#00c8ff'];

  let DB = null, CH = null, ITEMS = {}, SPELLS = {}, ITEM_BY_ID = {};
  const STATE = { tab: 'overview' };

  // ------------------------------------------------------------ formatting
  function iconName(ic) {
    if (ic == null) return 'inv_misc_questionmark';
    if (typeof ic === 'string') {
      if (/^\d+$/.test(ic)) ic = Number(ic);
      else return ic.replace(/\\/g, '/').split('/').pop().replace(/\.blp$/i, '').toLowerCase();
    }
    return (window.CC_ICONS && window.CC_ICONS[ic]) || 'inv_misc_questionmark';
  }
  // one icon square. o: {item, spell, tip, q, count, key, size, cls, dim}
  function icon(ic, o) {
    o = o || {};
    const cls = ['ic', o.size || '', o.q != null ? 'q' + o.q + 'b' : '', o.dim ? 'dim' : '', o.cls || ''].join(' ').trim();
    let attrs = '';
    if (o.item) attrs = ` data-item="${esc(o.item)}"`;
    else if (o.spell) attrs = ` data-spell="${esc(o.spell)}"${o.rank != null ? ` data-rank="${o.rank}/${o.max}"` : ''}`;
    else if (o.tip) attrs = ` data-tip="${esc(JSON.stringify(o.tip))}"`;
    const cnt = o.count > 1 ? `<b class="cnt">${o.count}</b>` : '';
    const key = o.key ? `<b class="key">${esc(shortKey(o.key))}</b>` : '';
    const badge = o.badge != null ? `<b class="rk">${o.badge}</b>` : '';
    return `<span class="${cls}"${attrs}><img loading="lazy" src="${ICON_URL}${iconName(ic)}.jpg" alt="">${cnt}${key}${badge}</span>`;
  }
  const emptySlot = (label) => `<span class="ic empty"${label ? ` title="${esc(label)}"` : ''}></span>`;
  function shortKey(k) { return String(k).replace('SHIFT-', 's').replace('CTRL-', 'c').replace('ALT-', 'a').replace('NUMPAD', 'n').replace('BUTTON', 'm').replace('MOUSEWHEEL', 'w'); }
  function money(c, opts) {
    if (c == null) return '<span class="dim">–</span>';
    const short = opts && opts.short;
    const neg = c < 0; c = Math.abs(Math.round(c));
    const g = Math.floor(c / 10000), s = Math.floor(c / 100) % 100, cp = c % 100;
    const parts = [];
    if (g) parts.push(`${g.toLocaleString()}<i class="g"></i>`);
    if (s && !(short && g >= 100)) parts.push(`${s}<i class="s"></i>`);
    if ((cp && !(short && g)) || (!g && !s)) parts.push(`${cp}<i class="c"></i>`);
    return `<span class="money">${neg ? '−' : ''}${parts.join(' ')}</span>`;
  }
  const gph = (c) => money(Math.round(c / 100) * 100, { short: true });
  const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const fmtDay = (t) => (t ? new Date(t * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
  function ago(t) {
    if (!t) return 'never';
    const s = Date.now() / 1000 - t;
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  function dur(s) { s = Math.max(0, s || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; }
  const item = (key) => ITEMS[key] || null;
  function itemName(key, link) {
    const it = item(key);
    if (it && it.name) return it.name;
    const m = /\[(.+?)\]/.exec(link || (it && it.link) || '');
    return m ? m[1] : '?';
  }
  function itemIcon(key, o) {
    o = o || {};
    const it = item(key) || {};
    return icon(o.icon || it.icon, Object.assign({ item: key, q: o.q != null ? o.q : it.q }, o));
  }
  function itemName$(key, link, q) {
    const it = item(key) || {};
    const qq = q != null ? q : it.q != null ? it.q : 1;
    return `<span class="q${qq}" data-item="${esc(key || '')}">${esc(itemName(key, link))}</span>`;
  }
  const keyOf = (link) => { const m = /\|H(item:[^|]+)\|h/.exec(link || ''); return m ? m[1] : null; };
  const byId = (id) => ITEM_BY_ID[id] || null;
  let NPCS = {}, QUESTS = {};

  // ------------------------------------------------------------ game-data pack (data/gamedata.js)
  // Every Forever item, quest, drop source and vendor from ForeverDB, so the page
  // knows about things you haven't seen in game yet. Rebuild with
  // gamedata/fetch_gamedata.sh + build_gamedata.py.
  const GD = window.GAMEDATA || null;
  const QCOL = ['9d9d9d', 'ffffff', '1eff00', '0070dd', 'a335ee', 'ff8000'];
  const gdItem = (id) => (GD && GD.items[id]) || null;
  function gdSourceLines(id, max, skipQuests) {
    const all = (GD && GD.src[id]) || [];
    const out = [];
    const qs = all.filter((r) => r[0] === 'quest');
    if (qs.length && !skipQuests) out.push({ l: 'Quest reward: ' + [...new Set(qs.map((r) => questName(r[2])))].slice(0, 2).join(', '), lc: '9ad0ff' });
    const rows = all.filter((r) => r[0] !== 'quest');
    const fv = rows.filter((r) => r[10] === 'f'), cl = rows.filter((r) => r[10] === 'c');
    const kindWord = { drop: 'drops from', object: 'found in', container: 'inside', quest: 'reward from', craft: 'crafted', vendor: 'sold by', world: '' };
    const fmt = (r) => r[0] === 'world' ? r[1] : r[0] === 'quest' ? questName(r[2]) : `${r[1]}${r[6] ? ' (boss)' : ''}${typeof r[7] === 'string' && r[7] ? ' in ' + r[7] : ''}`;
    // a % is only called a Forever rate when ForeverDB checked it against Forever kills
    const rate = (r) => r[3] == null ? '' : r[11] === 'm' ? ` ${r[3]}% (ForeverDB, checked on ${r[12]} Forever kills)` : ` ${r[3]}% (Classic rate)`;
    if (fv.length) out.push({ l: 'Seen on Forever: ' + fv.slice(0, max || 3).map((r) => `${kindWord[r[0]] != null ? kindWord[r[0]] + ' ' : ''}${fmt(r)}${rate(r)}${r[4] ? ' · seen ×' + r[4] : ''}`.trim()).join(', '), lc: '9ad0ff' });
    if (cl.length) out.push({ l: 'Classic data only: ' + cl.slice(0, max || 3).map((r) => `${fmt(r)}${rate(r)}`).join(', '), lc: '8a8f98' });
    const v = (GD && GD.vend[id]) || [];
    if (v.length) out.push({ l: 'Vendor: ' + v.slice(0, 2).map((x) => `${x[0]}${x[1] ? ' (' + x[1] + ')' : ''}${x[5] ? '' : ' (Classic list)'}`).join(', '), lc: '9ad0ff' });
    return out;
  }
  function gdTip(id) {
    const g = gdItem(id);
    if (!g) return [{ l: '#' + id }];
    const lines = [{ l: g[0], lc: QCOL[g[1]] || 'ffffff' }];
    if (g[11] === 'e') {
      // the Forever client's own tooltip text, from endgametools
      arr(g[10]).forEach((l) => lines.push({ l, lc: /^(Equip|Use|Chance on hit):/.test(l) ? '1eff00' : /^Item level/.test(l) ? 'ffd100' : 'ffffff' }));
    } else {
      if (g[7] === 1) lines.push({ l: 'Binds when picked up' }); else if (g[7] === 2) lines.push({ l: 'Binds when equipped' });
      arr(g[8]).forEach(([k, v]) => lines.push({ l: `+${v} ${(GD.stat || {})[k] || 'stat ' + k}`, lc: k > 7 && k < 100 ? '1eff00' : 'ffffff' }));
      if (g[3]) lines.push({ l: 'Requires Level ' + g[3] });
      if (g[2]) lines.push({ l: 'Item level ' + g[2], lc: 'ffd100' });
      if (g[11] === 'f') lines.push({ l: 'Stats from ForeverDB (no endgametools page for this item)', lc: '8a8f98' });
    }
    return lines.concat(gdSourceLines(id));
  }
  // icon for any item id: your saved copy if you've seen it, else the pack
  // item id from a name, for old records saved without one (first exact match in the pack)
  let NAME_ID = null;
  const idByName = (name) => {
    if (!name || !GD) return null;
    if (!NAME_ID) { NAME_ID = {}; for (const [k, g] of Object.entries(GD.items)) if (!(g[0] in NAME_ID)) NAME_ID[g[0]] = Number(k); }
    return NAME_ID[name] || null;
  };
  // name for any item id: your saved copy if you've seen it, else the pack
  const anyItemName = (id, fallback) => { const mine = ITEM_BY_ID[id]; const g = gdItem(id); return (mine && mine.name) || (g && g[0]) || fallback || '#' + id; };
  function anyItemIcon(id, o) {
    o = o || {};
    const mine = ITEM_BY_ID[id];
    if (mine) return itemIcon(mine.key, o);
    const g = gdItem(id);
    return icon(g ? g[5] : null, Object.assign({ q: g ? g[1] : 1, tip: gdTip(id) }, o));
  }

  // AH price for an item id: the newest full-scan reading if there is one,
  // otherwise the newest price you saw while browsing.
  function priceOf(id) {
    const p = ((CH && CH.ah) || {}).prices || {};
    const rec = p[String(id)];
    if (!rec) return null;
    const obs = arr(rec.obs);
    for (let i = obs.length - 1; i >= 0; i--) {
      const o = obs[i];
      if (o.src === 'scan') return o.qty ? { min: o.min, med: o.med || o.min, qty: o.qty, t: o.t, src: 'scan' } : { none: true, t: o.t, src: 'scan' };
    }
    const o = obs[obs.length - 1];
    return o && o.min ? { min: o.min, med: o.min, qty: o.qty, t: o.t, src: o.src } : null;
  }
  // the price to plan with: median of a scan (what it really sells for), else lowest seen
  // plan with the newest scan; if it found none listed, with the last scan that had some
  const planPrice = (id) => {
    const p = priceOf(id);
    if (p && !p.none) return p.med || p.min;
    const obs = arr(((((CH && CH.ah) || {}).prices || {})[String(id)] || {}).obs);
    for (let i = obs.length - 1; i >= 0; i--) if (obs[i].min) return obs[i].med || obs[i].min;
    return null;
  };
  // pack titles come from QuestieDB; the game's own name fills any gap
  const questName = (id) => {
    const t = GD && GD.quests[id] && GD.quests[id].t;
    if (t && !/^Quest #/.test(t)) return t;
    const logQ = CH && arr((CH.snap || {}).quests).find((q) => q.id == id);
    return (logQ && logQ.title) || (QUESTS[id] && QUESTS[id].name) || t || '#' + id;
  };
  // where a quest ends, from the pack: 'Name, Place x, y'
  const gdWho = (w) => w ? `${w[1]}${w[2] ? ', ' + w[2] : ''}${w[3] != null ? ' ' + w[3] + ', ' + w[4] : ''}` : '';
  const npcName = (id) => (NPCS[id] && NPCS[id].name) || '#' + id;
  function npcWhere(id) {
    const n = NPCS[id];
    const z = n && arr(n.spawns)[0];
    if (!z) return '';
    const pt = arr(z.pts)[0];
    return `${z.zoneName || ''}${pt ? ' ' + arr(pt)[0] + ', ' + arr(pt)[1] : ''}`.trim();
  }
  function sourceLines(it) {
    const s = it && it.src;
    const out = [];
    if (!s || s.none) return out;
    const names = (ids, max) => arr(ids).slice(0, max).map((n) => { const x = NPCS[n]; return x ? x.name + (x.min ? ` (${x.min}${x.max && x.max !== x.min ? '-' + x.max : ''})` : '') : '#' + n; }).join(', ') + (arr(ids).length > max ? ` +${arr(ids).length - max} more` : '');
    if (arr(s.drops).length) out.push({ l: 'Dropped by: ' + names(s.drops, 3), lc: '9ad0ff' });
    if (arr(s.objectNames).length) out.push({ l: 'Found in: ' + arr(s.objectNames).slice(0, 3).join(', '), lc: '9ad0ff' });
    if (arr(s.vendors).length) out.push({ l: 'Sold by: ' + names(s.vendors, 2), lc: '9ad0ff' });
    if (arr(s.quests).length) out.push({ l: 'Quest reward: ' + arr(s.quests).slice(0, 2).map((q) => questName(q)).join(', '), lc: '9ad0ff' });
    if (s.starts) out.push({ l: 'Starts a quest: ' + questName(s.starts), lc: 'ffd100' });
    return out;
  }
  // QuestieDB lines (where to find it) plus the pack's drop sightings and rates
  function allSourceLines(it) {
    if (it && it.id && GD && gdItem(it.id)) return gdSourceLines(it.id, 3);
    return sourceLines(it);
  }

  // ------------------------------------------------------------ tooltip
  const tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);
  // game colour codes inside tooltip text (|cffRRGGBB ... |r) become coloured text
  const wowText = (t) => esc(t).replace(/\|c[0-9a-f]{2}([0-9a-f]{6})([\s\S]*?)(\|r|$)/gi, '<span style="color:#$1">$2</span>').replace(/\|r/g, '');
  const lineHTML = (ln) => `<div class="l"><span style="color:#${ln.lc || 'ffffff'}">${wowText(ln.l || '')}</span>${ln.r ? `<span class="r" style="color:#${ln.rc || 'ffffff'}">${wowText(ln.r)}</span>` : ''}</div>`;
  function itemTip(key) {
    const it = item(key);
    if (!it) return null;
    let h;
    if (it.tip && arr(it.tip).length) h = arr(it.tip).map(lineHTML).join('');
    else {
      h = `<div class="l q${it.q != null ? it.q : 1}">${esc(it.name || '?')}</div>`;
      if (it.sub) h += `<div class="l">${esc(it.sub)}</div>`;
      if (it.req) h += `<div class="l">Requires Level ${it.req}</div>`;
    }
    const extra = [];
    const pr = it.id && priceOf(it.id);
    if (pr && pr.none) extra.push(`<div class="l tipx">Auction House: none listed <span class="dim">(${ago(pr.t)})</span></div>`);
    else if (pr) extra.push(`<div class="l tipx">Auction House: ${money(pr.min)}${pr.med && pr.med !== pr.min ? ` · median ${money(pr.med)}` : ''} <span class="dim">${pr.qty ? pr.qty + ' up · ' : ''}${ago(pr.t)}</span></div>`);
    if (it.sell && !/No sell price/.test(h)) extra.push(`<div class="l tipx">Vendor: ${money(it.sell)}</div>`);
    allSourceLines(it).forEach((ln) => extra.push(lineHTML(ln)));
    if (extra.length) h += '<div class="tipsep"></div>' + extra.join('');
    return h;
  }
  function spellTip(id, rank) {
    const sp = SPELLS[id];
    if (!sp) return null;
    let lines = arr(sp.tip);
    if (!lines.length) lines = [{ l: sp.name || 'Spell ' + id }];
    let h = lines.map(lineHTML).join('');
    if (rank) h = lineHTML(lines[0]) + `<div class="l" style="color:#ffd100">Rank ${esc(rank)}</div>` + lines.slice(1).map(lineHTML).join('');
    return h;
  }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-item],[data-spell],[data-tip]');
    let html = null;
    if (el) {
      if (el.dataset.item) html = itemTip(el.dataset.item);
      else if (el.dataset.spell) html = spellTip(el.dataset.spell, el.dataset.rank);
      else { try { html = arr(JSON.parse(el.dataset.tip)).map(lineHTML).join(''); } catch (_) {} }
    }
    if (!html) { tip.style.display = 'none'; return; }
    tip.innerHTML = html;
    tip.style.display = 'block';
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.style.display !== 'block') return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 18, y = e.clientY + 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });

  // ------------------------------------------------------------ tabs
  const TABS = [
    ['overview', 'Overview', 'inv_misc_book_09'], ['character', 'Character', 'inv_chest_cloth_17'], ['bags', 'Bags & Bank', 'inv_misc_bag_08'],
    ['talents', 'Talents & Bars', 'spell_holy_holybolt'], ['grinds', 'Grinds', 'inv_misc_coin_02'], ['runs', 'Dungeons', 'inv_misc_key_10'], ['quests', 'Quests', 'inv_misc_note_01'],
    ['professions', 'Professions', 'trade_engraving'], ['rep', 'Reputation', 'inv_misc_tournaments_banner_human'], ['auction', 'Auction House', 'inv_misc_coin_17'],
    ['journal', 'Journal', 'inv_misc_book_11'], ['system', 'System', 'trade_engineering'], ['gear', 'Gear', 'inv_helmet_06'],
    ['claude', 'From Claude', 'inv_scroll_03'],
  ];
  // sidebar groups (layout only)
  const NAV_GROUPS = [
    [null, ['overview', 'claude']],
    ['Character', ['character', 'gear', 'bags', 'talents', 'rep']],
    ['Activity', ['quests', 'grinds', 'runs', 'journal']],
    ['Gold', ['professions', 'auction']],
  ];
  // How fresh each kind of saved data is. Things the game only shows while
  // a window is open (bank, professions, flight map, AH, other spec) can
  // fall behind; each is marked so nothing out of date passes as current.
  const HOUR = 3600;
  function freshness() {
    const now = Date.now() / 1000;
    const out = [];
    const add = (key, label, t, how, tab, staleAfter) => {
      const age = t ? now - t : null;
      const st = !t ? 'never' : age > (staleAfter || 24 * HOUR) ? 'old' : 'ok';
      out.push({ key, label, t, how, tab, st });
    };
    const s = CH.snap || {};
    add('snap', 'Character, bags, gear, quests', s.taken, 'Sync in game', 'character', 6 * HOUR);
    add('bank', 'Bank', (CH.bank || {}).taken, 'Open your bank, then Sync', 'bags', 3 * 24 * HOUR);
    const profs = Object.values(CH.professions || {}).filter((p) => p.name);
    const skills = arr(s.skills).filter((x) => /^(Alchemy|Blacksmithing|Enchanting|Engineering|Herbalism|Leatherworking|Mining|Skinning|Tailoring|Jewelcrafting|Inscription|Cooking|First Aid|Fishing)$/.test(x.name));
    skills.filter((x, i) => !/^(Herbalism|Mining|Skinning|Fishing)$/.test(x.name) && skills.findIndex((y) => y.name === x.name) === i).forEach((sk) => {
      const p = profs.find((q) => q.name === sk.name);
      add('prof:' + sk.name, sk.name + ' recipes', p && p.taken, `Open ${sk.name} in game, then Sync`, 'professions', 14 * 24 * HOUR);
    });
    const specs = CH.specs || {};
    [1, 2].forEach((g) => {
      const sp = specs[g] || specs[String(g)];
      add('spec' + g, `Spec ${g} talents and bars`, sp && (sp.barsTaken || sp.talentsTaken), `Switch to spec ${g} in game, then Sync`, 'talents', 14 * 24 * HOUR);
    });
    const taxi = Object.values(CH.taxi || {});
    add('taxi', 'Flight paths', taxi.length ? Math.max(...taxi.map((t) => t.last || 0)) : null, 'Talk to a flight master, then Sync', 'character', 30 * 24 * HOUR);
    add('ah', 'AH prices (full scan)', ((CH.ah || {}).lastScan || {}).t, 'Open the AH, press Claude scan, then Sync', 'auction', 2 * 24 * HOUR);
    add('mail', 'Mailbox', (CH.mail || {}).taken, 'Open a mailbox, then Sync', 'bags', 3 * 24 * HOUR);
    return out;
  }
  const FRESH_LABEL = { ok: 'up to date', old: 'out of date', never: 'never synced' };
  // small "saved 3 h ago" pill for a section heading
  function savedPill(t, staleAfter) {
    if (!t) return '<span class="pill never">never synced</span>';
    const old = Date.now() / 1000 - t > (staleAfter || 24 * HOUR);
    return `<span class="pill ${old ? 'old' : 'ok'}" title="${esc(fmtTime(t))}">${old ? 'out of date · ' : ''}saved ${ago(t)}</span>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { STATE.tab = b.dataset.tab; history.replaceState(null, '', '#' + STATE.tab); render(); window.scrollTo(0, 0); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { STATE.jf = f.dataset.filter === STATE.jf ? null : f.dataset.filter; render(); return; }
    const pf = e.target.closest('[data-prof]');
    if (pf) { STATE.prof = pf.dataset.prof; render(); return; }
    const rf = e.target.closest('[data-recf]');
    if (rf) { STATE.recF = rf.dataset.recf; render(); return; }
    const rs = e.target.closest('[data-recsort]');
    if (rs) { STATE.recSort = rs.dataset.recsort; render(); return; }
    const as = e.target.closest('[data-ahsec]');
    if (as) { STATE.ahSec = as.dataset.ahsec; render(); return; }
    const fu = e.target.closest('[data-flipused]');
    if (fu) {
      const set = usedSet();
      if (fu.dataset.flipused) set.add(fu.dataset.flipused); else set.clear();
      localStorage.setItem(usedKey(), JSON.stringify([...set])); render(); return;
    }
    const sp = e.target.closest('[data-spec]');
    if (sp) { STATE.spec = Number(sp.dataset.spec); render(); }
  });

  const V = {};

  // ------------------------------------------------------------ overview
  V.overview = function () {
    const s = CH.snap || {}, c = s.character || {};
    const bags = arr(s.bags);
    const used = bags.reduce((a, b) => a + (b.used || 0), 0), total = bags.reduce((a, b) => a + (b.slots || 0), 0);
    const last = arr(CH.grinds).slice(-1)[0];
    const lg = last && trackerStats(last);
    let h = `<div class="cards">
      <div class="card"><span class="k">Gold</span><span class="v">${money(c.money, { short: true })}</span></div>
      <div class="card"><span class="k">Level ${c.level || '?'}</span><span class="v">${c.xpMax ? Math.floor((100 * c.xp) / c.xpMax) : 0}%</span><span class="sub">${(c.xpMax - c.xp || 0).toLocaleString()} XP to go${c.rested ? ` · ${c.rested.toLocaleString()} rested` : ''}</span></div>
      <div class="card"><span class="k">Bags</span><span class="v">${total - used} free</span><span class="sub">${used}/${total} used</span></div>
      ${lg ? `<div class="card link" data-tab="grinds"><span class="k">Last grind</span><span class="v">${gph(lg.perHour)}/hr</span><span class="sub">${esc(last.name || '')} · ${dur(lg.secs)}</span></div>` : ''}
    </div>`;
    const cds = cooldowns();
    const ready = arr(s.quests).filter((q) => q.ready || q.complete);
    h += (window.CC.cards ? window.CC.cards.overview() : '') + '<div class="grid2"><section>';
    if (cds.length || ready.length) {
      h += '<h2>Now</h2><div class="list">';
      cds.forEach((c) => { h += `<div class="li">${icon(c.icon, { size: 'sm' })}<div class="grow">${esc(c.name)}${c.prof ? `<div class="sub">${esc(c.prof)} cooldown</div>` : ''}</div><div class="num">${cdWhen(c)}</div></div>`; });
      ready.forEach((q) => { const gq = GD && GD.quests[q.id]; const to = gq && arr(gq.to)[0]; h += `<div class="li"><span class="ic sm qmark">?</span><div class="grow">${esc(q.title)}<div class="sub">ready to turn in${to ? ' to ' + esc(gdWho(to)) : ''}</div></div></div>`; });
      h += '</div>';
    }
    else h += '<h2>Now</h2><div class="empty">Nothing waiting: no cooldowns or quests ready to turn in.</div>';
    h += '</section><section><h2>Saved data</h2><div class="list fresh">';
    freshness().forEach((f) => {
      h += `<div class="li${f.tab ? ' link' : ''}"${f.tab ? ` data-tab="${f.tab}"` : ''}><span class="dot ${f.st}"></span><div class="grow">${esc(f.label)}${f.st !== 'ok' ? `<div class="sub">${esc(f.how)}</div>` : ''}</div><div class="num"><span class="pill ${f.st}">${f.t ? (f.st === 'old' ? 'out of date · ' : '') + ago(f.t) : FRESH_LABEL.never}</span></div></div>`;
    });
    h += '</div></section></div>';
    return h;
  };

  // Profession cooldowns for any profession, read from the game: recipes it reported on cooldown when the
  // window was last open, plus crafts logged with a cooldown (so one stays listed, "ready now", after it ends).
  // Recipes that share one cooldown (all Transmutes) end at the same moment and show as one row.
  function cooldowns(prof) {
    const best = {}, iconOf = {};
    const put = (name, ends, icon, p) => { if (icon) iconOf[name] = icon; if (!best[name] || ends > best[name].ends) best[name] = { name, ends, prof: p || (best[name] || {}).prof }; };
    Object.values(CH.professions || {}).forEach((p) => arr(p.recipes).forEach((r) => { if (r.icon) iconOf[r.name] = r.icon; if (r.cooldownEnds) put(r.name, r.cooldownEnds, r.icon, p.name); }));
    arr(CH.journal).forEach((e) => { if (e && e.e === 'cooldownCraft' && e.name && e.readyAt) put(e.name, e.readyAt); });
    const groups = {};
    Object.values(best).forEach((c) => { const k = c.name.split(':')[0] + '|' + Math.round(c.ends / 300); (groups[k] = groups[k] || []).push(c); });
    return Object.values(groups).map((g) => {
      const c = g[0];
      return { name: g.length > 1 ? `${c.name.split(':')[0]} (${g.length} recipes share this cooldown)` : c.name, icon: iconOf[c.name], ends: Math.max(...g.map((x) => x.ends)), prof: g.map((x) => x.prof).find(Boolean) };
    }).filter((c) => !prof || c.prof === prof).sort((a, b) => a.ends - b.ends);
  }
  const cdWhen = (c) => (c.ends > Date.now() / 1000 ? 'ready ' + fmtTime(c.ends) : '<span class="pos">ready now</span>');

  // ------------------------------------------------------------ character
  const LEFT = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Shirt', 'Tabard', 'Wrist'];
  const RIGHT = ['Hands', 'Waist', 'Legs', 'Feet', 'Finger1', 'Finger2', 'Trinket1', 'Trinket2'];
  const WEAP = ['MainHand', 'OffHand', 'Ranged'];
  const LABEL = { Finger1: 'Ring', Finger2: 'Ring', Trinket1: 'Trinket', Trinket2: 'Trinket', MainHand: 'Main Hand', OffHand: 'Off Hand', Ranged: 'Wand', Back: 'Back' };
  V.character = function () {
    const s = CH.snap || {}, st = s.stats || {};
    const eq = {};
    arr(s.equipped).forEach((e) => (eq[e.slotName] = e));
    const slot = (name, side) => {
      const e = eq[name];
      if (!e) return `<div class="gs ${side}">${emptySlot(LABEL[name] || name)}<div class="gt"><span class="dim">${LABEL[name] || name}</span></div></div>`;
      const it = item(e.item) || {};
      const broken = e.durMax && e.dur / e.durMax < 0.25 ? ' <span class="neg">damaged</span>' : '';
      return `<div class="gs ${side}">${icon(e.icon || it.icon, { item: e.item, q: it.q, size: 'lg' })}<div class="gt">${itemName$(e.item, e.link)}<span class="sub">${it.ilvl ? 'ilvl ' + it.ilvl : ''}${broken}</span></div></div>`;
    };
    const b = st.base || {};
    const stat = (k, v) => `<div class="st"><span>${k}</span><b>${v == null ? '–' : v}</b></div>`;
    const sd = st.spellDamage || {};
    const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    const stats = `<div class="stats"><div>
      <h4>Attributes</h4>${stat('Strength', (b.str || {}).total)}${stat('Agility', (b.agi || {}).total)}${stat('Stamina', (b.sta || {}).total)}${stat('Intellect', (b.int || {}).total)}${stat('Spirit', (b.spi || {}).total)}${stat('Armor', st.armor)}</div><div>
      <h4>Spell</h4>${stat('Healing', st.healing)}${stat('Shadow damage', sd.shadow)}${stat('Holy damage', sd.holy)}${stat('Spell crit', r1(st.spellCrit) != null ? r1(st.spellCrit) + '%' : null)}${stat('Mana regen', st.manaRegen != null ? Math.round(st.manaRegen * 5) + ' mp5' : null)}${stat('Regen while casting', st.manaRegenCasting != null ? Math.round(st.manaRegenCasting * 5) + ' mp5' : null)}
    </div></div>`;
    let h = `<div class="charlay"><div class="cmain"><div class="sheet"><div class="col">${LEFT.map((n) => slot(n, 'l')).join('')}</div><div class="col">${RIGHT.map((n) => slot(n, 'r')).join('')}</div>
      <div class="weap">${WEAP.map((n) => slot(n, 'l')).join('')}</div></div>`;
    const taxi = Object.entries(CH.taxi || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const tl = taxi.length ? Math.max(...taxi.map(([, t]) => t.last || 0)) : null;
    h += `<h2>Flight paths <span class="dim small">${taxi.length} known</span> ${savedPill(tl, 30 * 24 * HOUR)}</h2>`;
    h += taxi.length ? `<div class="chips">${taxi.map(([n]) => `<span class="chip">${esc(n)}</span>`).join('')}</div>` : '<div class="empty">Talk to any flight master once, then Sync.</div>';
    h += `</div><div class="cside">${stats}`;
    const sets = arr(s.gearSets);
    if (sets.length) {
      h += `<h2>Gear sets</h2><div class="sets">`;
      sets.forEach((set) => {
        h += `<div class="set"><div class="sethd">${esc(set.name)}${set.equipped ? ' <span class="tag">worn</span>' : ''}${set.numLost ? ` <span class="neg small">${set.numLost} missing</span>` : ''}</div><div class="row">`;
        arr(set.items).forEach((x) => { const it = byId(x.id); h += it ? icon(it.icon, { item: it.key, q: it.q, size: 'sm' }) : anyItemIcon(x.id, { size: 'sm' }); });
        h += '</div></div>';
      });
      h += '</div>';
    }
    const buffs = arr(s.buffs);
    if (buffs.length) h += `<h2>Buffs at last Sync</h2><div class="row">${buffs.map((x) => icon(x.icon, { size: 'sm', spell: x.spell && SPELLS[x.spell] ? x.spell : null, tip: [{ l: x.name }, { l: x.left ? dur(x.left) + ' left' : '', lc: '9a9890' }] })).join('')}</div>`;
    return h + '</div></div>';
  };

  // ------------------------------------------------------------ bags
  function bagFrame(b, filter, label) {
    const bySlot = {};
    arr(b.items).forEach((x) => (bySlot[x.slot] = x));
    const cells = [];
    const compact = /keyring/i.test(b.name || '');
    for (let s = 1; s <= (b.slots || 0); s++) {
      const x = bySlot[s];
      if (!x) { if (!compact) cells.push(emptySlot()); continue; }
      const hide = filter && !itemName(x.item, x.link).toLowerCase().includes(filter);
      cells.push(icon(x.icon || (item(x.item) || {}).icon, { item: x.item, q: x.q, count: x.count, dim: hide }));
    }
    const name = label || (b.id === 0 ? 'Backpack' : b.name || 'Bag ' + b.id);
    return `<div class="bagf${b.slots > 24 && !compact ? ' wide' : ''}"><div class="baghd">${b.link ? itemIcon(keyOf(b.link), { size: 'xs' }) : ''}<span>${esc(name)}</span><span class="dim">${b.used || 0}/${b.slots}</span></div><div class="cells">${cells.join('')}</div></div>`;
  }
  V.bags = function () {
    const f = (STATE.bagFilter || '').toLowerCase();
    const s = CH.snap || {};
    const bags = arr(s.bags);
    const used = bags.reduce((a, b) => a + (b.used || 0), 0), total = bags.reduce((a, b) => a + (b.slots || 0), 0);
    let h = `<div class="toolbar lift"><input class="search" id="bagsearch" placeholder="Search bags and bank" value="${esc(STATE.bagFilter || '')}"><span class="dim">${used}/${total} slots used · ${money(((s.character || {}).money))}</span></div>`;
    h += `<div class="bags">${bags.map((b) => bagFrame(b, f)).join('') || '<div class="empty">Not saved yet.</div>'}</div>`;
    const bank = CH.bank;
    h += `<h2>Bank ${savedPill(bank && bank.taken, 3 * 24 * HOUR)}</h2>`;
    if (bank) {
      const frames = arr(bank.bags).filter((b) => !/keyring/i.test(b.name || '')).map((b) => ({ b, html: bagFrame(b, f, /bank|tab/i.test(b.name || '') || b.id > 5 && !b.link ? (b.name || 'Bank') : null) }));
      const wide = frames.filter((x) => x.b.slots > 24), rest = frames.filter((x) => x.b.slots <= 24);
      h += `<div class="bankwrap">${wide.map((x) => x.html).join('')}<div class="bags">${rest.map((x) => x.html).join('')}</div></div>`;
    } else h += '<div class="empty">Open your bank once in game, then Sync.</div>';
    const mail = CH.mail;
    if (mail && arr(mail.list).length) {
      h += `<h2>Mailbox <span class="dim small">saved ${ago(mail.taken)}</span></h2><div class="list">`;
      arr(mail.list).forEach((m) => {
        h += `<div class="li"><div class="grow"><div>${esc(m.subject)}</div><div class="sub">${esc(m.sender)} · ${m.daysLeft != null ? Math.floor(m.daysLeft) + ' days left' : ''}</div></div><div class="row">${arr(m.items).map((x) => itemIcon(x.item, { size: 'sm', count: x.count })).join('')}</div><div class="num">${m.money ? money(m.money) : ''}</div></div>`;
      });
      h += '</div>';
    }
    return h;
  };

  // ------------------------------------------------------------ talents
  // Lay out talent nodes from their in-game positions. If everything is
  // one tree, split it into columns of nodes where the x positions jump.
  // Lay out talent nodes from their in-game positions. Positions come on
  // a fixed grid (about 600 apart); a big jump in x starts the next tree.
  // Stray nodes far below the trees (the spec badge) are left out.
  function gridStep(vals) {
    const u = [...new Set(vals)].sort((a, b) => a - b);
    const d = u.slice(1).map((v, i) => v - u[i]).filter((x) => x > 0);
    if (!d.length) return 1;
    const count = {};
    d.forEach((x) => (count[x] = (count[x] || 0) + 1));
    return Number(Object.entries(count).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
  }
  function treeLayout(nodes) {
    nodes = nodes.filter((n) => n.x != null && n.y != null);
    if (!nodes.length) return [];
    const ys = nodes.map((n) => n.y).sort((a, b) => a - b);
    const ystep = gridStep(ys);
    const med = ys[Math.floor(ys.length / 2)];
    nodes = nodes.filter((n) => Math.abs(n.y - med) <= ystep * 12);
    const xstep = gridStep(nodes.map((n) => n.x));
    const xs = [...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b);
    const groups = [[xs[0]]];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] > xstep * 1.5) groups.push([]);
      groups[groups.length - 1].push(xs[i]);
    }
    const minY = Math.min(...nodes.map((n) => n.y));
    return groups.map((g) => {
      const lo = g[0];
      const set = new Set(g);
      const ns = nodes.filter((n) => set.has(n.x)).map((n) => Object.assign({ col: Math.round((n.x - lo) / xstep) + 1, row: Math.round((n.y - minY) / ystep) + 1 }, n));
      return { nodes: ns, cols: Math.max(...ns.map((n) => n.col)), rows: Math.max(...ns.map((n) => n.row)) };
    });
  }
  // the trees of a spec, laid out, each with its points
  function specTrees(sp) {
    let trees = arr(sp && sp.traits && sp.traits.trees).map((t) => arr(t.nodes)).filter((n) => n.length);
    if (!trees.length && sp && sp.traits && arr(sp.traits.nodes).length) trees = [arr(sp.traits.nodes)];
    if (!trees.length || trees.every((t) => t.every((n) => n.x == null))) return null;
    const laid = trees.length >= 2 ? trees.map((t) => { const L = treeLayout(t); return L.length ? { nodes: L.flatMap((g) => g.nodes), cols: Math.max(...L.map((g) => g.cols)), rows: Math.max(...L.map((g) => g.rows)) } : null; }).filter(Boolean) : treeLayout(trees[0]);
    laid.forEach((t) => (t.points = t.nodes.reduce((a, n) => a + (n.rank || 0), 0)));
    return laid;
  }
  function specLabel(sp) {
    if (!sp) return null;
    // Forever answers the spec-name call with the class ("Priest"), so name the spec by its biggest tree
    const cls = ((CH.snap || {}).character || {}).class;
    if (sp.specName && sp.specName !== cls) return sp.specName;
    const names = TREE_NAMES[((CH.snap || {}).character || {}).classFile] || [];
    const t = specTrees(sp);
    if (!t || !t.length) return null;
    let best = 0;
    t.forEach((x, i) => { if (x.points > t[best].points) best = i; });
    return `${names[best] || 'Tree ' + (best + 1)} ${t.map((x) => x.points).join('/')}`;
  }
  const TREE_NAMES = { PRIEST: ['Discipline', 'Holy', 'Shadow'], MAGE: ['Arcane', 'Fire', 'Frost'], WARLOCK: ['Affliction', 'Demonology', 'Destruction'], DRUID: ['Balance', 'Feral', 'Restoration'], PALADIN: ['Holy', 'Protection', 'Retribution'], SHAMAN: ['Elemental', 'Enhancement', 'Restoration'], WARRIOR: ['Arms', 'Fury', 'Protection'], ROGUE: ['Assassination', 'Combat', 'Subtlety'], HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'] };
  V.talents = function () {
    const raw = CH.specs || {};
    const specs = (Array.isArray(raw) ? raw.map((sp, i) => ({ sp, i: i + 1 })) : Object.entries(raw).map(([k, sp]) => ({ sp, i: Number(k) }))).filter((x) => x.sp);
    if (!specs.length) return '<div class="empty">Talents not saved yet.</div>';
    const active = (CH.snap || {}).activeSpec;
    const cur = STATE.spec && specs.find((x) => x.i === STATE.spec) ? STATE.spec : active || specs[0].i;
    let h = `<div class="seg">${[1, 2].map((i) => {
      const x = specs.find((s) => s.i === i);
      return `<button data-spec="${i}" class="${cur === i ? 'on' : ''}">${x ? esc(specLabel(x.sp) || 'Spec ' + i) : 'Spec ' + i}${active === i ? ' · active' : ''}</button>`;
    }).join('')}</div>`;
    let sp = (specs.find((x) => x.i === cur) || {}).sp;
    const lo = Object.values(CH.loadouts || {}).sort((a, b) => (b.taken || 0) - (a.taken || 0))[0];
    if ((!sp || !sp.traits) && lo && cur !== active) {
      sp = Object.assign({}, sp || {}, { traits: lo, talentsTaken: lo.taken });
      h += `<p class="dim small">Talents read from the game's saved build for your other spec, without switching.</p>`;
    }
    if (!sp) return h + `<div class="empty">This spec hasn't been seen yet. Switch to it in game and Sync.</div>`;
    const classFile = ((CH.snap || {}).character || {}).classFile;
    const names = TREE_NAMES[classFile] || [];
    if (sp.traits) {
      let trees = arr(sp.traits.trees).map((t) => arr(t.nodes)).filter((n) => n.length);
      if (!trees.length && arr(sp.traits.nodes).length) trees = [arr(sp.traits.nodes)]; // saved by addon 1.0
      if (trees.length && trees.every((t) => t.every((n) => n.x == null))) {
        // older save without positions: just list the talents taken
        h += `<div class="tree"><div class="row wrap">${trees.flat().map((n) => icon(n.icon || (SPELLS[n.spell] || {}).icon, { spell: SPELLS[n.spell] ? n.spell : null, tip: [{ l: n.name }, { l: `Rank ${n.rank}/${n.max}`, lc: 'ffd100' }], badge: `${n.rank}/${n.max}` })).join('')}</div><p class="dim small">Sync again with the new version to see the full trees.</p></div>`;
        trees = [];
      }
      const cols = trees.length ? specTrees(sp) || [] : [];
      h += `<div class="trees">${cols.map((t, i) => {
        const pts = t.points;
        const cells = t.nodes.map((n) => {
          const st = !n.rank ? 'off' : n.rank >= n.max ? 'max' : 'part';
          return `<div class="tn ${st}" style="grid-column:${n.col};grid-row:${n.row}">${icon(n.icon, { spell: n.spell, rank: n.rank, max: n.max, badge: `${n.rank}/${n.max}`, dim: !n.rank })}</div>`;
        }).join('');
        return `<div class="tree"><div class="treehd"><span>${esc(names[i] || 'Tree ' + (i + 1))}</span><b>${pts}</b></div><div class="tgrid" style="--cols:${t.cols}">${cells}</div></div>`;
      }).join('')}</div>`;
      h += `<p class="foot-note">${sp.traits.points} points ${savedPill(sp.talentsTaken, cur === active ? 6 * HOUR : 14 * 24 * HOUR)}</p>`;
    } else if (sp.talents) {
      h += `<div class="trees">${arr(sp.talents.tabs).map((tab) => `<div class="tree"><div class="treehd"><span>${esc(tab.name)}</span><b>${tab.points}</b></div><div class="tgrid" style="--cols:4">${arr(tab.talents).map((x) => `<div class="tn ${!x.rank ? 'off' : x.rank >= x.max ? 'max' : 'part'}" style="grid-column:${x.col};grid-row:${x.tier}">${icon(x.icon, { tip: [{ l: x.name }, { l: `Rank ${x.rank}/${x.max}`, lc: 'ffd100' }], badge: `${x.rank}/${x.max}`, dim: !x.rank })}</div>`).join('')}</div></div>`).join('')}</div>`;
    }
    const bars = arr(sp.actionBars);
    h += `<div class="grid2 tbars"><section><h2>Action bars ${savedPill(sp.barsTaken, cur === active ? 6 * HOUR : 14 * 24 * HOUR)}</h2>`;
    if (!bars.length) h += '<div class="empty">Not saved yet. Switch to this spec in game and Sync.</div>';
    else {
      const bySlot = {};
      bars.forEach((a) => (bySlot[a.slot] = a));
      const rows = [[1, 'Main'], [61, 'Bottom left'], [49, 'Bottom right'], [25, 'Right'], [37, 'Right 2'], [13, 'Page 2'], [73, 'Bar 7'], [85, 'Bar 8'], [97, 'Bar 9'], [109, 'Bar 10']];
      h += '<div class="abars">';
      rows.forEach(([start, lbl]) => {
        const cells = [];
        let any = false;
        for (let s = start; s < start + 12; s++) {
          const a = bySlot[s];
          if (!a) { cells.push(emptySlot()); continue; }
          any = true;
          if (a.kind === 'spell' && SPELLS[a.id]) cells.push(icon(a.icon, { spell: a.id, key: a.key }));
          else if (a.kind === 'item' && byId(a.id)) cells.push(icon(a.icon, { item: byId(a.id).key, key: a.key }));
          else {
            const lines = [{ l: a.name || a.kind }];
            if (a.kind === 'macro') { lines.push({ l: 'Macro', lc: '9a9890' }); (a.body || '').split('\n').filter(Boolean).forEach((ln) => lines.push({ l: ln, lc: 'cfd6e6' })); }
            cells.push(icon(a.icon, { tip: lines, key: a.key }));
          }
        }
        if (any) h += `<div class="abar"><span class="lbl">${lbl}</span>${cells.join('')}</div>`;
      });
      h += '</div>';
    }
    const macros = arr((CH.snap || {}).macros);
    h += '</section><section>';
    h += macros.length ? `<h2>Macros</h2><div class="list macros">${macros.map((m) => `<div class="li">${icon(m.icon, { size: 'sm' })}<div class="grow"><div>${esc(m.name)}</div><pre>${esc(m.body)}</pre></div></div>`).join('')}</div>` : '<h2>Macros</h2><div class="empty">No macros saved.</div>';
    return h + '</section></div>';
  };

  // ------------------------------------------------------------ grinds
  function trackerStats(t) {
    const secs = Math.max(1, t.secs || ((t.finish || t.last || t.start) - t.start - (t.pausedSecs || 0)));
    const hrs = secs / 3600;
    const coin = t.coin != null ? t.coin : (t.bySource || {}).loot || 0;
    // always re-price loot with today's prices (a grind saved before an AH scan
    // would otherwise keep vendor values forever); items never priced are counted
    let vendor = 0, ah = 0, unpriced = 0;
    Object.entries(t.loot || {}).forEach(([id, l]) => {
      const it = item(l.item) || byId(l.id || id) || {};
      vendor += (it.sell || 0) * l.count;
      const pp = planPrice(l.id || id);
      if (pp == null) unpriced += 1;
      ah += (pp != null ? pp : it.sell || 0) * l.count;
    });
    return { secs, hrs, coin, vendor, ah, unpriced, total: coin + ah, perHour: (coin + ah) / hrs };
  }
  function lootStrip(t, n) {
    const list = Object.entries(t.loot || {}).map(([id, l]) => Object.assign({ id }, l, { q: l.q != null ? l.q : (item(l.item) || {}).q || 0 }))
      .sort((a, b) => b.q - a.q || b.count - a.count);
    return list.slice(0, n || 24).map((l) => { const id = l.id || idByName(l.name); return l.item ? itemIcon(l.item, { count: l.count, size: 'sm' }) : gdItem(id) ? anyItemIcon(id, { count: l.count, size: 'sm' }) : icon(null, { size: 'sm', count: l.count, tip: [{ l: l.name || '?' }] }); }).join('');
  }
  function deStrip(g) {
    const d = Object.values(g.disenchants || {});
    if (!d.length) return '';
    return `<div class="destrip"><span class="dim small">Disenchanted</span>${d.map((x) => `${x.item ? itemIcon(x.item, { size: 'xs', count: x.count }) : ''}<span class="arrow">→</span>${Object.values(x.out || {}).map((o) => (o.item ? itemIcon(o.item, { size: 'xs', count: o.count }) : '')).join('')}`).join('<span class="gap"></span>')}</div>`;
  }
  function grindCard(g, live) {
    const s = trackerStats(g);
    const kills = Object.entries(g.killsBy || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, k]) => `${esc(n)} ×${k}`).join(', ');
    return `<div class="grind${live ? ' live' : ''}">
      <div class="ghd"><span class="gname">${esc(g.name || 'Grind')}</span>${live ? `<span class="tag">${g.paused ? 'paused' : 'running'}</span>` : ''}<span class="dim small">${fmtDay(g.start)} · ${dur(s.secs)}${g.startZone ? ' · ' + esc(g.startZone) : ''}</span></div>
      <div class="gnums"><div><span class="k">Per hour</span><span class="v">${gph(s.perHour)}</span></div><div><span class="k">Total</span><span class="v">${money(s.total, { short: true })}</span></div><div><span class="k">Gold looted</span><span class="v">${money(s.coin, { short: true })}</span></div><div><span class="k">Items</span><span class="v">${money(s.ah, { short: true })}</span></div><div><span class="k">Kills</span><span class="v">${g.kills || 0} <span class="dim small">${Math.round((g.kills || 0) / s.hrs)}/hr</span></span></div>${g.xp ? `<div><span class="k">XP/hr</span><span class="v">${Math.round(g.xp / s.hrs).toLocaleString()}</span></div>` : ''}</div>
      <div class="row wrap">${lootStrip(g) || '<span class="dim small">no drops</span>'}</div>
      ${deStrip(g)}
      ${Object.keys(g.rep || {}).length ? `<div class="small">${Object.entries(g.rep).map(([f, n]) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : ''}${n}</span> ${esc(f)}`).join(' · ')}</div>` : ''}
      ${kills ? `<div class="dim small">${kills}</div>` : ''}</div>`;
  }
  V.grinds = function () {
    let h = '';
    if (CH.grind) h += grindCard(CH.grind, true);
    const grinds = arr(CH.grinds).slice().reverse();
    if (!CH.grind && !grinds.length) h += `<div class="empty">No grinds yet. In game: <b>/cc start azshara</b> when you begin, <b>/cc stop</b> when you're done.</div>`;
    h += grinds.map((g) => grindCard(g)).join('');
    const sessions = arr(CH.sessions).slice().reverse();
    if (CH.session) sessions.unshift(Object.assign({ current: true }, CH.session));
    if (sessions.length) {
      h += `<h2>Play sessions <span class="dim small">automatic, login to logout</span></h2><div class="list">`;
      sessions.slice(0, 30).forEach((s) => {
        const t = trackerStats(s);
        h += `<div class="li"><div class="grow"><div>${fmtTime(s.start)}${s.current ? ' <span class="tag">now</span>' : ''}</div><div class="sub">${dur(t.secs)} · ${esc(Object.keys(s.zones || {}).join(', ') || s.startZone || '')} · ${s.kills || 0} kills</div></div><div class="row">${lootStrip(s, 8)}</div><div class="num">${gph(t.perHour)}/hr</div></div>`;
      });
      h += '</div>';
    }
    return h;
  };

  // ------------------------------------------------------------ quests
  V.quests = function () {
    const qs = arr((CH.snap || {}).quests);
    let h = `<div class="toolbar lift"><span class="dim">${qs.length} in log · ${arr((CH.snap || {}).completedQuests).length.toLocaleString()} completed</span></div><div class="flow2">`;
    if (!qs.length) return h + '<div class="empty">No quests saved.</div>';
    let header = null;
    qs.forEach((q, qi) => {
      if (qi === 0) header = Symbol('start');
      if (q.header !== header) { h += `${typeof header !== 'symbol' ? '</div></div>' : ''}<div class="grp"><h3>${esc(q.header || 'Other')}</h3><div class="panel">`; header = q.header; }
      const done = q.ready || q.complete;
      h += `<div class="quest"><div class="qt"><span class="qlvl">${q.level || ''}</span><span class="qname">${esc(q.title)}</span>${done ? '<span class="tag ok">complete</span>' : q.failed ? '<span class="tag bad">failed</span>' : ''}${q.id ? `<a class="dim small" href="https://www.wowhead.com/forever/quest=${q.id}" target="_blank">wowhead</a>` : ''}</div>`;
      arr(q.objectives).forEach((o) => { h += `<div class="qo ${o.done ? 'done' : ''}">${esc(o.text)}</div>`; });
      const rw = q.rewards;
      const gq = GD && GD.quests[q.id];
      if (gq) {
        const bits = [];
        const to = arr(gq.to)[0];
        if (to) bits.push(`<span>Turn in: <b>${esc(to[1])}</b>${to[2] ? ` <span class="dim">${esc(to[2])}${to[3] != null ? ' ' + to[3] + ', ' + to[4] : ''}</span>` : ''}</span>`);
        arr(gq.next).slice(0, 1).forEach((n) => bits.push(`<span>Next: ${esc(questName(n))}</span>`));
        arr(gq.rep).forEach((r) => bits.push(`<span class="pos">+${r[1]} ${esc(String(r[0]))}</span>`));
        if (gq.min) bits.push(`<span>Req. level ${gq.min}</span>`);
        if (gq.xp && !(rw && rw.xp)) bits.push(`<span>${gq.xp.toLocaleString()} XP${gq.xpLv ? ` <span class="dim">(at ${gq.xpLv})</span>` : ''}</span>`);
        arr(gq.repReq).forEach((r) => bits.push(`<span class="neg">Needs ${esc(JSON.stringify(r))}</span>`));
        if (bits.length) h += `<div class="qinfo small">${bits.join(' · ')}</div>`;
        if (!rw && arr(gq.rewardAny).length) h += `<div class="qrw">${arr(gq.rewardAny).map(([id]) => anyItemIcon(id, { size: 'sm' })).join('')}<span class="dim small">rewards (accept the quest to see which you choose)</span></div>`;
        if (!rw && (arr(gq.reward).length || arr(gq.choice).length)) {
          const its = arr(gq.reward).map(([id, n]) => anyItemIcon(id, { size: 'sm', count: n > 1 ? n : undefined })).join('');
          const ch = arr(gq.choice).map(([id, n]) => anyItemIcon(id, { size: 'sm', count: n > 1 ? n : undefined })).join('');
          h += `<div class="qrw">${its}${ch ? `<span class="dim small">choose one</span>${ch}` : ''}${gq.money ? ` ${money(gq.money)}` : ''}</div>`;
        }
      }
      if (rw) {
        const its = arr(rw.items).map((r) => (r.item ? itemIcon(r.item, { size: 'sm', count: r.count }) : '')).join('');
        const ch = arr(rw.choices).map((r) => (r.item ? itemIcon(r.item, { size: 'sm', count: r.count }) : '')).join('');
        h += `<div class="qrw">${its}${ch ? `<span class="dim small">choose one</span>${ch}` : ''}${rw.money ? ` ${money(rw.money)}` : ''}${rw.xp ? ` <span class="dim small">${rw.xp.toLocaleString()} XP</span>` : ''}</div>`;
      }
      h += '</div>';
    });
    return h + '</div></div></div>';
  };

  // ------------------------------------------------------------ professions
  // what a craft costs (reagents at AH median) against what the result sells for
  function craftProfit(r) {
    if (!r.output) return null;
    const v = planPrice(r.output);
    if (!v) return null;
    const makes = ((r.makesMin || 1) + (r.makesMax || r.makesMin || 1)) / 2;
    let cost = 0, missing = 0;
    arr(r.reagents).forEach((g) => {
      const p = planPrice(g.id);
      const it = byId(g.id);
      if (p) cost += p * (g.need || 1);
      else if (it && it.sell) cost += it.sell * 4 * (g.need || 1); // vendor-only reagents cost about 4x their sell price
      else missing++;
    });
    const value = Math.round(v * makes * 0.95); // AH takes 5% of the sale
    return { cost, value, profit: value - cost, missing };
  }
  // recipe sections: "Enchant Bracer - X" -> "Enchant Bracer"; otherwise the slot the result goes in
  const INV_SECTION = { 1: 'Head', 2: 'Neck', 3: 'Shoulders', 4: 'Shirts', 5: 'Chest', 20: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrists', 10: 'Hands', 11: 'Rings', 12: 'Trinkets', 16: 'Back', 18: 'Bags', 19: 'Tabards', 13: 'Weapons', 17: 'Weapons', 21: 'Weapons', 22: 'Off hand', 23: 'Off hand', 14: 'Off hand', 15: 'Ranged', 26: 'Ranged' };
  function recipeSection(r) {
    const m = /^(.+?) - /.exec(r.name || '');
    if (m) return m[1];
    const g = r.output && gdItem(r.output);
    return (g && INV_SECTION[g[4]]) || 'Materials and other';
  }
  // the game's skill-up colours: 0 orange, 1 yellow, 2 green, 3 grey
  const DIFF = [['optimal', 'Always gives a skill point'], ['medium', 'Usually gives a skill point'], ['easy', 'Rarely gives a skill point'], ['trivial', 'No skill points']];
  const PROF_ICON = { Tailoring: 'trade_tailoring', Enchanting: 'trade_engraving', Cooking: 'inv_misc_food_15', Alchemy: 'trade_alchemy', Blacksmithing: 'trade_blacksmithing', Engineering: 'trade_engineering', Leatherworking: 'trade_leatherworking', 'First Aid': 'spell_holy_sealofsacrifice' };
  V.professions = function () {
    const skills = arr((CH.snap || {}).skills).filter((s, i, all) => !s.isHeader && /^(Alchemy|Blacksmithing|Enchanting|Engineering|Herbalism|Leatherworking|Mining|Skinning|Tailoring|Cooking|First Aid|Fishing|Riding)$/.test(s.name) && all.findIndex((y) => y.name === s.name) === i);
    const profs = Object.values(CH.professions || {}).filter((p) => p.name).sort((a, b) => arr(b.recipes).length - arr(a.recipes).length);
    const skillStrip = `<div class="skills">${skills.map((s) => `<div class="skill"><div class="skt"><span>${esc(s.name)}</span><b>${s.rank}<span class="dim"> / ${s.maxRank}</span></b></div><div class="bar"><i style="width:${(100 * s.rank) / s.maxRank}%"></i></div></div>`).join('')}</div>`;
    let h = '';
    if (!profs.length) return skillStrip + '<div class="empty">Open each profession window once in game, then Sync.</div>';
    const p = profs.find((x) => x.name === STATE.prof) || profs[0];
    h += `<div class="seg">${profs.map((x) => `<button data-prof="${esc(x.name)}" class="${x === p ? 'on' : ''}">${PROF_ICON[x.name] ? `<img src="${ICON_URL}${PROF_ICON[x.name]}.jpg" alt="">` : ''}${esc(x.name)} <span class="n">${arr(x.recipes).length}</span></button>`).join('')}</div>` + skillStrip;
    const q = (STATE.recFilter || '').toLowerCase().trim();
    const flt = STATE.recF || 'all', sort = STATE.recSort || 'profit';
    const all = arr(p.recipes).map((r) => ({ r, cp: craftProfit(r), sec: recipeSection(r) }));
    const counts = { all: all.length, profit: all.filter((x) => x.cp && x.cp.profit > 0).length, skill: all.filter((x) => x.r.difficulty != null && x.r.difficulty < 3).length };
    const FILTERS = [['all', 'All'], ['profit', 'Makes a profit'], ['skill', 'Gives skill-ups']];
    h += `<div class="toolbar"><input class="search" id="recsearch" placeholder="Search ${esc(p.name)} recipes or reagents" value="${esc(STATE.recFilter || '')}">
      <div class="chips">${FILTERS.map(([k, l]) => `<button data-recf="${k}" class="${flt === k ? 'on' : ''}">${l} <span>${counts[k]}</span></button>`).join('')}</div>
      <div class="sortby"><span class="dim small">Sort</span>${[['profit', 'Profit'], ['name', 'Name']].map(([k, l]) => `<button data-recsort="${k}" class="${sort === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    cooldowns(p.name).forEach((c) => { h += `<div class="cd">${icon(c.icon, { size: 'xs' })}<b>${esc(c.name)}</b><span>cooldown, ${cdWhen(c)}</span></div>`; });
    const reagName = (id) => { const it = byId(id), g = gdItem(id); return ((it && it.name) || (g && g[0]) || '').toLowerCase(); };
    let rows = all.filter((x) => {
      if (flt === 'profit' && !(x.cp && x.cp.profit > 0)) return false;
      if (flt === 'skill' && !(x.r.difficulty != null && x.r.difficulty < 3)) return false;
      return !q || (x.r.name || '').toLowerCase().includes(q) || x.sec.toLowerCase().includes(q) || arr(x.r.reagents).some((g) => reagName(g.id).includes(q));
    });
    if (!rows.length) return h + `<div class="empty">No ${esc(p.name)} recipes match. Clear the search or pick another filter.</div>`;
    const byProfit = (a, b) => (b.cp ? b.cp.profit : -1e12) - (a.cp ? a.cp.profit : -1e12) || (a.r.name || '').localeCompare(b.r.name || '');
    rows.sort(sort === 'name' ? (a, b) => (a.r.name || '').localeCompare(b.r.name || '') : byProfit);
    // sections in the order of their best recipe
    const secs = [];
    rows.forEach((x) => { let g = secs.find((y) => y.name === x.sec); if (!g) secs.push((g = { name: x.sec, rows: [] })); g.rows.push(x); });
    if (sort === 'name') secs.sort((a, b) => a.name.localeCompare(b.name));
    const cell = (v, cls) => `<div class="c-num ${cls || ''}">${v == null ? '<span class="dim">–</span>' : v}</div>`;
    h += `<div class="table recipes"><div class="thead"><div>Recipe</div><div>Reagents</div><div class="c-num">Cost</div><div class="c-num">Sells for</div><div class="c-num">Profit</div></div>`;
    secs.forEach((sg) => {
      h += `<div class="tsec">${esc(sg.name)} <span>${sg.rows.length}</span></div>`;
      sg.rows.forEach(({ r, cp }) => {
        const out = r.output && byId(r.output);
        const reag = arr(r.reagents).map((g) => `<span class="rg">${anyItemIcon(g.id, { size: 'xs' })}<span>${g.need > 1 ? g.need + '×' : ''}</span></span>`).join('');
        const d = DIFF[r.difficulty];
        const name = out ? itemName$(out.key) : r.output && gdItem(r.output) ? `<span class="q${gdItem(r.output)[1]}" data-tip="${esc(JSON.stringify(gdTip(r.output)))}">${esc(r.name)}</span>` : esc(r.name);
        h += `<div class="tr">
          <div class="c-main">${out ? itemIcon(out.key, { size: 'sm' }) : r.output && gdItem(r.output) ? anyItemIcon(r.output, { size: 'sm' }) : icon(r.icon, { size: 'sm' })}<div class="grow"><div class="nm">${name}</div>${d ? `<div class="sub"><span class="diff ${d[0]}"></span>${d[1]}</div>` : ''}</div></div>
          <div class="c-reag">${reag}</div>
          ${cell(cp && !cp.missing ? money(cp.cost, { short: true }) : null)}${cell(cp ? money(cp.value, { short: true }) : null)}
          ${cell(cp && !cp.missing ? `<span class="${cp.profit >= 0 ? 'pos' : 'neg'}">${cp.profit >= 0 ? '+' : ''}${money(cp.profit, { short: true })}</span>` : null)}
        </div>`;
      });
    });
    h += '</div><p class="foot-note">${esc(p.name)} recipes ${savedPill(p.taken, 14 * 24 * HOUR)} · Cost = reagents at your AH scan median (vendor reagents at 4× their sell price). Sells for = AH median minus the 5% cut. A dash means no AH price yet.</p>';
    return h;
  };

  // ------------------------------------------------------------ reputation
  V.rep = function () {
    const reps = arr((CH.snap || {}).reputation);
    if (!reps.length) return '<div class="empty">Not saved yet.</div>';
    // Groups in game order, then split into two columns of about equal height.
    const groups = [];
    reps.forEach((r) => {
      if (r.isHeader && !r.isHeaderWithRep) { groups.push({ name: r.name, rows: [] }); return; }
      if (!groups.length) groups.push({ name: '', rows: [] });
      const lo = r.currentReactionThreshold || 0, hi = r.nextReactionThreshold || 1, v = r.currentStanding || 0;
      const pct = hi > lo ? Math.min(100, Math.max(0, (100 * (v - lo)) / (hi - lo))) : 100;
      const st = r.reaction || 4;
      groups[groups.length - 1].rows.push(`<div class="rep"><span class="rn">${esc(r.name)}</span><div class="bar"><i style="width:${pct}%;background:${STANDING_COLOR[st]}"></i></div><span class="rv"><b style="color:${STANDING_COLOR[st]}">${STANDING[st] || ''}</b>${hi > lo ? ` <span class="dim">${(v - lo).toLocaleString()} / ${(hi - lo).toLocaleString()}</span>` : ''}</span></div>`);
    });
    const live = groups.filter((g) => g.rows.length);
    const weight = (g) => g.rows.length + 2;
    const total = live.reduce((a, g) => a + weight(g), 0);
    const cols = [[], []];
    let acc = 0;
    live.forEach((g) => { (acc < total / 2 ? cols[0] : cols[1]).push(g); acc += weight(g); });
    const grp = (g) => `<div class="grp">${g.name ? `<h3>${esc(g.name)}</h3>` : ''}<div class="panel reps">${g.rows.join('')}</div></div>`;
    return `<div class="grid2">${cols.map((c) => `<section>${c.map(grp).join('')}</section>`).join('')}</div>`;
  };

  // ------------------------------------------------------------ auction
  function spark(vals) {
    const v = vals.slice(-20), lo = Math.min(...v), hi = Math.max(...v), w = 60, hgt = 18;
    const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(hgt - 2 - ((x - lo) / (hi - lo || 1)) * (hgt - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${hgt}"><polyline points="${pts}" fill="none" stroke="#8fd3ff" stroke-width="1.5"/></svg>`;
  }
  // Disenchant outcomes by item level. Uncommon rows: warcraft.wiki.gg
  // "Disenchanting tables" (same materials as wow-professions.com/forever);
  // rare/epic rows from the same page's summary. [lo, hi, [[material, chance, min, max], ...]]
  const DE_ARMOR = [
    [5, 15, [['Strange Dust', 0.8, 1, 2], ['Lesser Magic Essence', 0.2, 1, 2]]],
    [16, 20, [['Strange Dust', 0.75, 2, 3], ['Greater Magic Essence', 0.2, 1, 2], ['Small Glimmering Shard', 0.05, 1, 1]]],
    [21, 25, [['Strange Dust', 0.75, 4, 6], ['Lesser Astral Essence', 0.15, 1, 2], ['Small Glimmering Shard', 0.1, 1, 1]]],
    [26, 30, [['Soul Dust', 0.75, 1, 2], ['Greater Astral Essence', 0.2, 1, 2], ['Large Glimmering Shard', 0.05, 1, 1]]],
    [31, 35, [['Soul Dust', 0.75, 2, 5], ['Lesser Mystic Essence', 0.2, 1, 2], ['Small Glowing Shard', 0.05, 1, 1]]],
    [36, 40, [['Vision Dust', 0.75, 1, 2], ['Greater Mystic Essence', 0.2, 1, 2], ['Large Glowing Shard', 0.05, 1, 1]]],
    [41, 45, [['Vision Dust', 0.75, 2, 5], ['Lesser Nether Essence', 0.2, 1, 2], ['Small Radiant Shard', 0.05, 1, 1]]],
    [46, 50, [['Dream Dust', 0.75, 1, 2], ['Greater Nether Essence', 0.2, 1, 2], ['Large Radiant Shard', 0.05, 1, 1]]],
    [51, 55, [['Dream Dust', 0.75, 2, 5], ['Lesser Eternal Essence', 0.2, 1, 2], ['Small Brilliant Shard', 0.05, 1, 1]]],
    [56, 60, [['Illusion Dust', 0.75, 1, 2], ['Greater Eternal Essence', 0.2, 1, 2], ['Large Brilliant Shard', 0.05, 1, 1]]],
    [61, 65, [['Illusion Dust', 0.75, 2, 5], ['Greater Eternal Essence', 0.2, 2, 3], ['Large Brilliant Shard', 0.05, 1, 1]]],
  ];
  const DE_WEAPON = [
    [6, 15, [['Strange Dust', 0.2, 1, 2], ['Lesser Magic Essence', 0.8, 1, 2]]],
    [16, 20, [['Strange Dust', 0.2, 2, 3], ['Greater Magic Essence', 0.75, 1, 2], ['Small Glimmering Shard', 0.05, 1, 1]]],
    [21, 25, [['Strange Dust', 0.15, 4, 6], ['Lesser Astral Essence', 0.75, 1, 2], ['Small Glimmering Shard', 0.1, 1, 1]]],
    [26, 30, [['Soul Dust', 0.2, 1, 2], ['Greater Astral Essence', 0.75, 1, 2], ['Large Glimmering Shard', 0.05, 1, 1]]],
    [31, 35, [['Soul Dust', 0.2, 2, 5], ['Lesser Mystic Essence', 0.75, 1, 2], ['Small Glowing Shard', 0.05, 1, 1]]],
    [36, 40, [['Vision Dust', 0.2, 1, 2], ['Greater Mystic Essence', 0.75, 1, 2], ['Large Glowing Shard', 0.05, 1, 1]]],
    [41, 45, [['Vision Dust', 0.2, 2, 5], ['Lesser Nether Essence', 0.75, 1, 2], ['Small Radiant Shard', 0.05, 1, 1]]],
    [46, 50, [['Dream Dust', 0.2, 1, 2], ['Greater Nether Essence', 0.75, 1, 2], ['Large Radiant Shard', 0.05, 1, 1]]],
    [51, 55, [['Dream Dust', 0.22, 2, 5], ['Lesser Eternal Essence', 0.75, 1, 2], ['Small Brilliant Shard', 0.03, 1, 1]]],
    [56, 60, [['Illusion Dust', 0.22, 1, 2], ['Greater Eternal Essence', 0.75, 1, 2], ['Large Brilliant Shard', 0.03, 1, 1]]],
    [61, 65, [['Illusion Dust', 0.22, 2, 5], ['Greater Eternal Essence', 0.75, 2, 3], ['Large Brilliant Shard', 0.03, 1, 1]]],
  ];
  const DE_RARE = [
    [1, 25, [['Small Glimmering Shard', 1, 1, 1]]], [26, 30, [['Large Glimmering Shard', 1, 1, 1]]], [31, 35, [['Small Glowing Shard', 1, 1, 1]]],
    [36, 40, [['Large Glowing Shard', 1, 1, 1]]], [41, 45, [['Small Radiant Shard', 1, 1, 1]]], [46, 50, [['Large Radiant Shard', 1, 1, 1]]],
    [51, 55, [['Small Brilliant Shard', 1, 1, 1]]], [56, 65, [['Large Brilliant Shard', 0.995, 1, 1], ['Nexus Crystal', 0.005, 1, 1]]],
  ];
  const DE_EPIC = [
    [40, 45, [['Small Radiant Shard', 1, 2, 4]]], [46, 50, [['Large Radiant Shard', 1, 2, 4]]], [51, 55, [['Small Brilliant Shard', 1, 2, 4]]],
    [56, 60, [['Nexus Crystal', 1, 1, 1]]], [61, 88, [['Nexus Crystal', 1, 1, 2]]],
  ];
  let NAME_PRICE = null;
  function priceByName(name) {
    if (!NAME_PRICE) {
      NAME_PRICE = {};
      Object.entries(((CH && CH.ah) || {}).prices || {}).forEach(([k, p]) => { if (p.name && !k.includes(':') && NAME_PRICE[p.name] == null) NAME_PRICE[p.name] = { id: p.id, price: planPrice(p.id) }; });
    }
    return NAME_PRICE[name] || null;
  }
  function deOutcome(it) {
    const t = it.q === 2 ? (it.class === 2 ? DE_WEAPON : DE_ARMOR) : it.q === 3 ? DE_RARE : it.q === 4 ? DE_EPIC : null;
    const row = t && t.find((r) => it.ilvl >= r[0] && it.ilvl <= r[1]);
    if (!row) return null;
    let value = 0, missing = [];
    const mats = row[2].map(([name, ch, lo, hi]) => {
      const pr = priceByName(name);
      const avg = ch * (lo + hi) / 2;
      if (pr && pr.price) value += avg * pr.price; else missing.push(name);
      return { name, ch, lo, hi, id: pr && pr.id, price: pr && pr.price };
    });
    return { value: Math.round(value), mats, missing };
  }
  // items you wear or keep in an Equipment Manager set are never suggested
  function gearIds() {
    const ids = new Set();
    arr((CH.snap || {}).equipped).forEach((e) => { const m = e && /item:(\d+)/.exec(e.item || e.link || ''); if (m) ids.add(Number(m[1])); });
    arr((CH.snap || {}).gearSets).forEach((g) => arr(g.items).forEach((x) => x && x.id > 0 && ids.add(x.id)));
    return ids;
  }
  function deHelper() {
    const s = CH.snap || {};
    const keep = gearIds();
    const cands = [];
    const add = (x, where) => {
      const it = item(x.item) || {};
      if (!(it.q >= 2 && it.q <= 4) || !(it.class === 2 || it.class === 4) || !it.ilvl || keep.has(it.id)) return;
      const de = deOutcome(it);
      if (!de) return;
      const ahp = x.bound ? null : planPrice(it.id);
      const sell = ahp ? Math.round(ahp * 0.95) : it.sell || 0;
      const known = de.missing.length < de.mats.length;
      cands.push({ x, it, de, sell, how: ahp ? 'AH' : 'vendor', where, known, act: !known ? 'unknown' : de.value > sell ? 'de' : 'sell' });
    };
    arr(s.bags).forEach((b) => arr(b.items).forEach((x) => add(x, 'Bags')));
    arr((CH.bank || {}).bags).forEach((b) => arr(b.items).forEach((x) => add(x, 'Bank')));
    let h = '';
    if (!cands.length) return '<div class="empty">Nothing to decide: no unused greens, blues or purples in your bags or bank. Items you wear or keep in a gear set are never listed.</div>';
    const sum = (k) => cands.filter((c) => c.act === k);
    const de = sum('de'), sell = sum('sell'), unk = sum('unknown');
    const ls = (CH.ah || {}).lastScan;
    h += `<div class="cards c3">
      <div class="card"><span class="k">Disenchant</span><span class="v">${de.length} item${de.length === 1 ? '' : 's'}</span><span class="sub">worth ≈ ${money(de.reduce((a, c) => a + c.de.value, 0), { short: true })} in materials</span></div>
      <div class="card"><span class="k">Sell</span><span class="v">${sell.length} item${sell.length === 1 ? '' : 's'}</span><span class="sub">worth ≈ ${money(sell.reduce((a, c) => a + c.sell, 0), { short: true })} after the AH cut</span></div>
      <div class="card"><span class="k">Prices from</span><span class="v">${ls ? ago(ls.t) : 'no scan'}</span><span class="sub">${ls ? 'your last full AH scan' : 'open the AH in game and press Claude scan'}</span></div>
    </div>`;
    h += `<p class="meta">Every green, blue and purple in your bags and bank that you don't wear or keep in a gear set. Do what the right-hand column says.</p>`;
    const order = { de: 0, sell: 1, unknown: 2 };
    cands.sort((a, b) => order[a.act] - order[b.act] || Math.abs(b.de.value - b.sell) - Math.abs(a.de.value - a.sell));
    const likely = (c) => c.de.mats.slice().sort((a, b) => b.ch - a.ch).map((m) => `${m.lo === m.hi ? m.lo : m.lo + '–' + m.hi} ${esc(m.name)} <span class="dim">${Math.round(m.ch * 100)}%</span>`).join(' · ');
    h += `<div class="table de"><div class="thead"><div>Item</div><div class="c-num">Sell for</div><div class="c-num">Disenchant for</div><div class="c-num">Do this</div></div>`;
    cands.forEach((c) => {
      const verdict = c.act === 'de' ? '<span class="badge de">Disenchant</span>' : c.act === 'sell' ? `<span class="badge sell">Sell on ${c.how === 'AH' ? 'AH' : 'vendor'}</span>` : '<span class="badge">No dust price</span>';
      h += `<div class="tr">
        <div class="c-main">${itemIcon(c.x.item, { size: 'sm' })}<div class="grow"><div class="nm">${itemName$(c.x.item, c.x.link)}</div><div class="sub">${c.where} · ilvl ${c.it.ilvl}${c.x.bound ? ' · soulbound' : ''} · DE gives ${likely(c)}</div></div></div>
        <div class="c-num${c.act === 'sell' ? ' best' : ''}">${money(c.sell, { short: true })}</div>
        <div class="c-num${c.act === 'de' ? ' best' : ''}">${c.known ? '≈ ' + money(c.de.value, { short: true }) : '<span class="dim">–</span>'}</div>
        <div class="c-num">${verdict}</div></div>`;
    });
    h += `</div><details class="how"><summary>How this is worked out</summary><p>Disenchant value is the average result: chance × amount × your AH median for each material, from the disenchanting tables (warcraft.wiki.gg; wow-professions.com/forever lists the same materials). Sell value is the AH median minus the 5% cut, or the vendor price for soulbound items. Materials with no AH price count as zero, so scan the AH first.</p></details>`;
    return h;
  }
  // older versions saved a sale twice (again after the gold was taken)
  const salesOf = (ah) => arr(ah.sales).filter((x, i, all) => !(x.net === 0 && all.some((y) => y !== x && y.item === x.item && y.price === x.price && Math.abs(y.t - x.t) < 7200)));

  // Flips: AH purchases matched to later sales of the same item, unit by unit, oldest purchase first.
  // Buys and sales carry the stack size (count) from the AH letter; older records without one count as a
  // single unit. Deposit comes back when an auction sells, so profit = sale price - AH cut - what you paid.
  // A purchase you used yourself can be set aside ("Used, not a flip"), kept in this browser.
  const usedKey = () => 'cc.flips.used.' + (((CH.snap || {}).character || {}).name || '');
  const buyId = (b) => `${b.t}|${b.item}|${b.price}`;
  const usedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(usedKey()) || '[]')); } catch (e) { return new Set(); } };
  function flipsOf(ah) {
    const used = usedSet();
    const buys = arr(ah.buys).filter((b) => b && b.item && !used.has(buyId(b))).slice().sort((a, b) => a.t - b.t)
      .map((b) => ({ b, left: b.count || 1, unit: (b.price || 0) / (b.count || 1) }));
    const done = [];
    salesOf(ah).slice().sort((a, b) => a.t - b.t).forEach((x) => {
      const n = x.count || 1, unit = (x.price || 0) / n, cutU = (x.cut || 0) / n, depU = (x.deposit || 0) / n;
      let need = n;
      for (const lot of buys) {
        if (!need) break;
        if (lot.b.item !== x.item || lot.b.t > x.t || !lot.left) continue;
        const k = Math.min(need, lot.left);
        lot.left -= k; need -= k;
        const paid = Math.round(lot.unit * k), price = Math.round(unit * k), cut = Math.round(cutU * k);
        done.push({ item: x.item, units: k, bought: lot.b.t, sold: x.t, paid, price, cut, deposit: Math.round(depU * k), profit: price - cut - paid });
      }
    });
    // what is left of each purchase; listed if one of your auctions has that item (price per unit)
    const listed = {};
    arr(ah.owned && ah.owned.list).forEach((a) => { const nm = anyItemName(a.id); listed[nm] = (a.buyout || 0) / (a.qty || 1); });
    const open = buys.filter((l) => l.left > 0).map((l) => {
      const u = listed[l.b.item];
      return { id: buyId(l.b), item: l.b.item, t: l.b.t, units: l.left, paid: Math.round(l.unit * l.left), listedAt: u != null ? Math.round(u * l.left) : null };
    });
    const sum = (a, k) => a.reduce((t, x) => t + (x[k] || 0), 0);
    const tied = open.filter((o) => o.listedAt != null);
    return { done: done.reverse(), open: open.reverse(), set: used.size, totals: { flips: done.length, units: sum(done, 'units'), paid: sum(done, 'paid'), sold: sum(done, 'price'), cut: sum(done, 'cut'), profit: sum(done, 'profit'),
      unsold: open.length, listed: tied.length, tiedUp: sum(tied, 'paid'), notListed: open.length - tied.length, setAside: used.size } };
  }

  function flipsView(ah) {
    const F = flipsOf(ah), T = F.totals;
    if (!arr(ah.buys).length) return '<div class="empty">No AH purchases recorded yet. Buys are saved when the item arrives in your mailbox and you take it.</div>';
    const sign = (v) => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v < 0 ? '−' : ''}${money(Math.abs(v))}</span>`;
    const qty = (n) => (n > 1 ? ` <span class="dim">×${n}</span>` : '');
    let h = `<p class="meta">${T.flips} sold · ${sign(T.profit)} profit after the AH cut · ${T.listed} still listed (${money(T.tiedUp)} tied up) · ${T.notListed} bought, not listed${T.setAside ? ` · ${T.setAside} set aside as used` : ''}</p>`;
    if (F.done.length) {
      h += `<div class="table flips"><div class="thead"><div>Item</div><div class="c-num">Paid</div><div class="c-num">Sold for</div><div class="c-num">AH cut</div><div class="c-num">Deposit</div><div class="c-num">Profit</div></div>`;
      F.done.forEach((r) => (h += `<div class="tr"><div class="c-main"><div class="nm">${esc(r.item)}${qty(r.units)}</div><div class="sub">bought ${fmtTime(r.bought)} · sold ${fmtTime(r.sold)}</div></div><div class="c-num">${money(r.paid)}</div><div class="c-num">${money(r.price)}</div><div class="c-num dim">${money(r.cut)}</div><div class="c-num dim">${r.deposit ? money(r.deposit) + ' back' : '–'}</div><div class="c-num best">${sign(r.profit)}</div></div>`));
      h += `<div class="tr tsum"><div class="c-main"><div class="nm">Total</div></div><div class="c-num">${money(T.paid)}</div><div class="c-num">${money(T.sold)}</div><div class="c-num dim">${money(T.cut)}</div><div></div><div class="c-num best">${sign(T.profit)}</div></div></div>`;
    }
    if (F.open.length) {
      h += `<div class="table flips open"><div class="tsec">Bought, not sold yet</div><div class="thead"><div>Item</div><div class="c-num">Paid</div><div class="c-num">Listed at</div><div class="c-num">If it sells</div></div>`;
      F.open.forEach((o) => (h += `<div class="tr"><div class="c-main"><div class="nm">${esc(o.item)}${qty(o.units)}</div><div class="sub">bought ${fmtTime(o.t)} · <button class="linkbtn" data-flipused="${esc(o.id)}">Used, not a flip</button></div></div><div class="c-num">${money(o.paid)}</div><div class="c-num">${o.listedAt != null ? money(o.listedAt) : '<span class="dim">not listed</span>'}</div><div class="c-num">${o.listedAt != null ? sign(Math.round(o.listedAt * 0.95) - o.paid) : '<span class="dim">–</span>'}</div></div>`));
      h += '</div>';
    }
    if (T.setAside) h += `<p class="meta"><button class="linkbtn" data-flipused="">Count the ${T.setAside} set-aside purchase${T.setAside === 1 ? '' : 's'} as flips again</button></p>`;
    return h;
  }

  V.auction = function () {
    const ah = CH.ah || {};
    const prices = Object.entries(ah.prices || {}).map(([k, p]) => ({ k, p })).sort((a, b) => (b.p.last || 0) - (a.p.last || 0));
    const f = (STATE.ahFilter || '').toLowerCase();
    const ls = ah.lastScan;
    const SECS = [['prices', 'Prices'], ['de', 'Disenchant or sell'], ['sold', 'Sold'], ['flips', 'Flips'], ['mine', 'Your auctions'], ['posted', 'Posted']];
    const sec = STATE.ahSec || 'prices';
    const on = (k) => sec === k;
    let h = `<div class="seg">${SECS.map(([k, l]) => `<button data-ahsec="${k}" class="${sec === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    h += `<div class="toolbar">${on('prices') ? `<input class="search" id="ahsearch" placeholder="Search prices" value="${esc(STATE.ahFilter || '')}">` : ''}<span class="dim small">${prices.length.toLocaleString()} items priced · ${ls ? `last full scan ${ago(ls.t)} (${ls.auctions.toLocaleString()} auctions)` : 'no full scan yet: open the AH and press <b>Claude scan</b>'}</span></div>`;
    if (on('de')) h += deHelper();
    const sales = salesOf(ah).slice().reverse();
    if (on('flips')) h += flipsView(ah);
    if (on('sold') && !sales.length) h += '<div class="empty">No sales recorded yet. Sales show up after you take the gold from an AH mail.</div>';
    if (on('sold') && sales.length) {
      const shown = sales.slice(0, 50);
      h += `<p class="meta">${shown.length} sales · ${money(shown.reduce((a, x) => a + (x.net || 0), 0))} after the AH cut</p><div class="table sold"><div class="thead"><div>Item</div><div>Sold</div><div class="c-num">You got</div></div>`;
      shown.forEach((s) => (h += `<div class="tr"><div class="c-main"><div class="nm">${esc(s.item)}</div></div><div class="dim">${fmtTime(s.t)}${s.buyer ? ' · ' + esc(s.buyer) : ''}</div><div class="c-num best">${money(s.net)}</div></div>`));
      h += '</div>';
    }
    const owned = ah.owned && arr(ah.owned.list);
    if (on('mine') && !(owned && owned.length)) h += '<div class="empty">No auctions saved. Open the AH’s Auctions tab in game, then Sync.</div>';
    if (on('mine') && owned && owned.length) {
      h += `<p class="meta">Saved ${ago(ah.owned.taken)}</p><div class="list">`;
      owned.forEach((a) => (h += `<div class="li">${a.item ? itemIcon(a.item, { size: 'sm', count: a.qty }) : anyItemIcon(a.id, { size: 'sm', count: a.qty })}<div class="grow">${a.item ? itemName$(a.item, a.link) : esc(anyItemName(a.id))}${a.left ? `<div class="sub">${Math.round(a.left / 60)} min left when saved</div>` : ''}</div><div class="num">${money(a.buyout)}</div></div>`));
      h += '</div>';
    }
        if (!on('prices')) { /* other section shown */ }
    else if (!prices.length) h += '<div class="empty">Browse the Auction House in game, then Sync.</div>';
    else {
      h += `<div class="table prices"><div class="thead"><div>Item</div><div class="c-num">Listed</div><div>Last seen</div><div>Trend</div><div class="c-num">Lowest</div><div class="c-num">Median</div></div>`;
      prices.filter((x) => !f || anyItemName(x.p.id, x.p.name).toLowerCase().includes(f)).slice(0, 300).forEach(({ p }) => {
        const o = arr(p.obs), it = byId(p.id);
        const pr = priceOf(p.id) || {};
        const hist = o.filter((x) => x.min).map((x) => x.med || x.min);
        const g = !it && gdItem(p.id);
        h += `<div class="tr"><div class="c-main">${it ? itemIcon(it.key, { size: 'xs' }) : anyItemIcon(p.id, { size: 'xs' })}<div class="nm">${it ? itemName$(it.key) : g ? `<span class="q${g[1]}">${esc(g[0])}</span>` : esc(p.name || '#' + p.id)}</div></div>
          <div class="c-num">${pr.none ? '<span class="dim">none</span>' : pr.qty || ''}</div>
          <div class="dim">${ago(p.last)}${hist.length > 1 ? ` · ${hist.length}×` : ''}</div>
          <div>${hist.length > 2 ? spark(hist) : ''}</div>
          <div class="c-num best">${pr.none ? '<span class="dim">–</span>' : money(pr.min)}</div>
          <div class="c-num">${pr.med ? money(pr.med) : '<span class="dim">–</span>'}</div></div>`;
      });
      h += '</div>';
    }
    const posts = arr(ah.posts).slice().reverse().slice(0, 40);
    if (on('posted') && !posts.length) h += '<div class="empty">Nothing posted yet.</div>';
    if (on('posted') && posts.length) {
      h += `<div class="list">`;
      posts.forEach((p) => (h += `<div class="li">${p.item ? itemIcon(p.item, { size: 'sm', count: p.qty }) : ''}<div class="grow">${p.item ? itemName$(p.item, p.link) : esc(p.name || '')}<div class="sub">${fmtTime(p.t)}</div></div><div class="num">${money(p.unit)} each</div></div>`));
      h += '</div>';
    }
    return h;
  };

  // ------------------------------------------------------------ journal
  const EV = {
    loot: (e) => `${itemIcon(e.item, { size: 'xs', count: e.count })} ${itemName$(e.item, e.link)}${e.count > 1 ? ' ×' + e.count : ''}`,
    receive: (e) => EV.loot(e), craft: (e) => 'Made ' + EV.loot(e),
    kill: (e) => `${esc(e.name)}${e.level ? ` <span class="dim">${e.level}${e.class && e.class !== 'normal' ? ' ' + esc(e.class) : ''}</span>` : ''}`,
    money: (e) => `<span class="${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : ''}${money(e.amount)}</span> <span class="dim">${esc(e.source)}</span>`,
    xp: (e) => `+${(e.amount || 0).toLocaleString()} XP`, level: (e) => `<b>Level ${e.level}</b>`,
    questAccept: (e) => `Accepted <span class="qname">${esc(e.title || '#' + e.quest)}</span>`, questDone: (e) => `Completed <span class="qname">${esc(e.title || '#' + e.quest)}</span>`,
    questDrop: (e) => `Abandoned quest #${e.quest}`, zone: (e) => `Entered ${esc(e.to)}`, death: () => '<span class="neg">Died</span>', note: (e) => `<i>“${esc(e.text)}”</i>`,
    equip: (e) => (e.item ? `Equipped ${itemIcon(e.item, { size: 'xs' })} ${itemName$(e.item, e.link)}` : `Unequipped ${esc(e.slotName || e.slot)}`),
    spec: (e) => `Switched to spec ${e.to}`, session: (e) => `New session${e.label ? ': ' + esc(e.label) : ''}`,
    runStart: (e) => `Entered <b>${esc(e.name)}</b>: dungeon run started`, runEnd: (e) => `Dungeon run <b>${esc(e.name)}</b> over (${dur(e.secs)}, ${e.kills} kills, ${e.bosses || 0} bosses)`,
    runLeft: (e) => `Left ${esc(e.name)}`, runBack: (e) => `Back in ${esc(e.name)}`, boss: (e) => `<b>Killed ${esc(e.name)}</b>`, wipe: (e) => `<span class="neg">Wiped on ${esc(e.name)}</span>`,
    grindStart: (e) => `Started grind <b>${esc(e.name)}</b>`, grindStop: (e) => `Finished grind <b>${esc(e.name)}</b> (${dur(e.secs)}, ${e.kills} kills)`,
    ahPost: (e) => `Posted ${e.link ? itemName$(keyOf(e.link), e.link) : esc(e.name)} ×${e.qty || 1} at ${money(e.unit)}`,
    ahSold: (e) => `Sold ${esc(e.name)}`, ahExpired: (e) => `Expired ${esc(e.name)}`, ahWon: (e) => `Won ${esc(e.name)}`, ahOutbid: (e) => `Outbid on ${esc(e.name)}`, ahRemoved: (e) => `Cancelled ${esc(e.name)}`,
    flightPath: (e) => `New flight path: ${esc(e.name)}`, profession: (e) => `${esc(e.name)} ${e.rank}/${e.max}`,
    cooldownCraft: (e) => `${esc(e.name)}, ready again ${fmtTime(e.readyAt)}`, learn: (e) => `Learned ${esc(e.name || e.spell)}`,
    group: (e) => `Group: ${arr(e.members).map((m) => esc(m.name) + ' ' + (m.level || '')).join(', ') || 'solo'}`,
    disenchant: (e) => `Disenchanted ${e.item ? itemIcon(e.item, { size: 'xs' }) + ' ' + itemName$(e.item, e.link) : ''} → ${e.outItem ? itemIcon(e.outItem, { size: 'xs', count: e.count }) + ' ' + itemName$(e.outItem, e.out) : ''}${e.count > 1 ? ' ×' + e.count : ''}`,
    ahScan: (e) => `Scanned the auction house: ${(e.auctions || 0).toLocaleString()} auctions, ${(e.items || 0).toLocaleString()} items`,
    recipe: (e) => `Learned recipe ${esc(e.name || e.recipe)}`,
    login: () => 'Logged in', logout: () => 'Logged out', skill: (e) => esc(e.text), rep: (e) => esc(e.text), coin: (e) => esc(e.text),
  };
  const EV_LABEL = { xp: 'XP', money: 'Money', coin: 'Coin', loot: 'Loot', kill: 'Kills', ahPost: 'AH posts', receive: 'Received', zone: 'Zones', group: 'Group', flightPath: 'Flight paths', equip: 'Gear', craft: 'Crafts', skill: 'Skills', login: 'Logins', logout: 'Logouts', disenchant: 'Disenchants', profession: 'Professions', death: 'Deaths', grindStart: 'Grind start', grindStop: 'Grind end', runStart: 'Run start', runEnd: 'Run end', runLeft: 'Run left', runBack: 'Run back', boss: 'Bosses', wipe: 'Wipes', ahScan: 'AH scans', spec: 'Spec', questDone: 'Quests done', questAccept: 'Quests taken', questDrop: 'Quests dropped', level: 'Levels', note: 'Notes', session: 'Sessions', ahSold: 'AH sold', ahExpired: 'AH expired', ahWon: 'AH won', ahOutbid: 'AH outbid', ahRemoved: 'AH cancelled', cooldownCraft: 'Cooldowns', learn: 'Learned', recipe: 'Recipes', rep: 'Reputation' };
  const evRow = (e) => `<div class="ev"><span class="t">${fmtTime(e.t)}</span><span class="what">${EV[e.e] ? EV[e.e](e) : esc(e.e)}</span><span class="where">${esc(e.sub || e.zone || '')}</span></div>`;
  V.journal = function () {
    const all = arr(CH.journal);
    const notes = arr(CH.notes).slice().reverse();
    const kinds = {};
    all.forEach((e) => (kinds[e.e] = (kinds[e.e] || 0) + 1));
    let list = all.slice().reverse();
    if (STATE.jf) list = list.filter((e) => e.e === STATE.jf);
    let h = '';
    if (notes.length) h += `<h2>Your notes</h2><div class="list">${notes.slice(0, 20).map((n) => `<div class="li"><div class="grow"><div>${esc(n.text)}</div><div class="sub">${fmtTime(n.t)} · ${esc(n.sub || n.zone || '')}${n.x != null ? ` (${n.x}, ${n.y})` : ''}</div></div></div>`).join('')}</div>`;
    h += `<h2>Timeline</h2><div class="chips">${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button data-filter="${k}" class="${STATE.jf === k ? 'on' : ''}">${esc(EV_LABEL[k] || k)} <span>${n}</span></button>`).join('')}</div><div class="tl">${list.slice(0, 500).map(evRow).join('')}</div>`;
    return h;
  };

  // ------------------------------------------------------------ system
  V.system = function () {
    const caps = CH.caps || {};
    let h = `<p class="meta">For Claude: what the addon could read on Forever.</p><div class="diaglist">`;
    Object.entries(CH.diag || {}).sort().forEach(([k, d]) => (h += `<div class="diag${d.err ? ' bad' : ''}"><span class="k">${esc(k)}</span><span class="num">${d.ok || 0} ok${d.err ? ` · <span class="neg">${d.err} errors</span>` : ''}</span>${d.lastErr ? `<div class="sub neg">${esc(d.lastErr)}</div>` : ''}</div>`));
    h += '</div>';
    if (caps.secret) h += `<h3>Values</h3><div class="row wrap">${Object.entries(caps.secret).map(([k, v]) => `<span class="tag ${v === 'readable' ? 'ok' : 'bad'}">${esc(k)}: ${esc(v)}</span>`).join('')}</div>`;
    h += `<p class="dim small">Addon ${esc(DB.addonVersion)} · schema ${DB.schema} · ${Object.keys(ITEMS).length} items · ${Object.keys(SPELLS).length} spells · ${arr(CH.journal).length} events · ${CH.syncs || 0} syncs</p>`;
    return h;
  };

  // ------------------------------------------------------------ install as an app
  // Chrome and Edge offer to install the page as its own app (Dock / Start menu, own window);
  // Safari on a Mac does it with File > Add to Dock (support.apple.com/104996).
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; render(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; render(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-install]') || !installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => { installPrompt = null; render(); });
  });
  function installHint() {
    if (!location.protocol.startsWith('http') || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
    if (installPrompt) return '<button class="install" data-install title="Its own window, in your Dock or Start menu">Install as an app</button>';
    const ua = navigator.userAgent;
    if (/Macintosh/.test(ua) && /Version\/\d+.*Safari\//.test(ua) && !/Chrome|Edg\//.test(ua)) return '<div class="install hint">To keep it in your Dock: <b>File &gt; Add to Dock</b></div>';
    return '';
  }

  // ------------------------------------------------------------ render
  function render() {
    const app = $('#app');
    if (!CH) { app.innerHTML = `<div class="drop"><p><b>Claude Companion</b></p><p>${STATE.loading ? 'Loading your character…' : 'No data yet. Type <b>/cc sync</b> in game and this page fills in by itself.'}</p></div>`; return; }
    const s = CH.snap || {}, c = s.character || {}, w = c.where || {};
    const xpPct = c.xpMax ? (100 * c.xp) / c.xpMax : 0;
    const restPct = c.xpMax && c.rested ? Math.min(100 - xpPct, (100 * c.rested) / c.xpMax) : 0;
    let body;
    try { body = (V[STATE.tab] || V.overview)(); } catch (e) { body = `<div class="empty">This tab hit an error: ${esc(e.message)}</div>`; console.error(e); }
    const g = CH.grind;
    const fr = freshness();
    const warn = {};
    fr.forEach((f) => { if (f.tab && f.st !== 'ok') warn[f.tab] = true; });
    const tabLabel = (TABS.find((t) => t[0] === STATE.tab) || TABS[0])[1];
    const navBtn = (k) => { const [, l, ic] = TABS.find((t) => t[0] === k); return `<button data-tab="${k}" title="${l}" class="${STATE.tab === k ? 'on' : ''}"${STATE.tab === k ? ' aria-current="page"' : ''}><img src="${ICON_URL}${ic}.jpg" alt=""><span>${l}</span>${warn[k] ? '<span class="dot old" title="Some data here is out of date"></span>' : ''}</button>`; };
    app.innerHTML = `<aside class="side">
        <div class="me"><div class="av" title="Level ${c.level || '?'}">${c.level || '?'}</div><div class="nm">${esc(c.name && c.name !== 'World' ? c.name : 'Your character')}</div><div class="dim small">Level ${c.level || '?'} ${esc(c.race || '')} ${esc(c.class || '')}</div>
          <div class="xp" title="${(c.xp || 0).toLocaleString()} / ${(c.xpMax || 0).toLocaleString()} XP"><i style="width:${xpPct}%"></i><i class="rest" style="width:${restPct}%"></i></div>
          <div class="row sb"><span>${money(c.money, { short: true })}</span><span class="dim small">${esc(w.sub || w.zone || '')}</span></div></div>
        <nav>${NAV_GROUPS.map(([gl, keys]) => `<div class="navg">${gl ? `<div class="navh">${gl}</div>` : ''}${keys.filter((k) => V[k]).map(navBtn).join('')}</div>`).join('')}</nav>
        ${g ? `<div class="live-grind" data-tab="grinds"><span class="tag">${g.paused ? 'paused' : 'grinding'}</span> ${esc(g.name)}</div>` : ''}
        <div class="foot">${installHint()}<button data-tab="system" class="sys${STATE.tab === 'system' ? ' on' : ''}" title="What the addon can read"><img src="${ICON_URL}trade_engineering.jpg" alt="">System</button>
        <div class="sync ${STATE.live ? 'on' : ''}" title="${esc(fmtTime(s.taken))}"><span class="dot ${STATE.live ? 'ok' : 'never'}"></span>${STATE.live ? 'Live' : 'Offline copy'} · synced ${ago(s.taken)}</div></div>
      </aside>
      <section class="page"><header class="ph"><h1>${esc(tabLabel)}</h1><div class="ph-tools"></div></header><main>${body}</main></section>`;
    // a page's leading tab switcher (and any toolbar marked .lift) sits in the header bar
    const main = app.querySelector('section.page > main'), tools = app.querySelector('.ph-tools');
    while (main.firstElementChild && main.firstElementChild.matches('.seg, .toolbar.lift')) tools.appendChild(main.firstElementChild);
    for (const [id, keyName] of [['bagsearch', 'bagFilter'], ['recsearch', 'recFilter'], ['ahsearch', 'ahFilter']]) {
      const el = $('#' + id);
      if (el) el.addEventListener('input', (e) => { STATE[keyName] = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#' + id); n.focus(); n.setSelectionRange(pos, pos); });
    }
  }

  function load(db, opts) {
    DB = db || {};
    NAME_PRICE = null;
    const chars = DB.chars || {};
    const keys = Object.keys(chars).filter((k) => chars[k] && chars[k].snap);
    if (!keys.length) { CH = null; render(); return; }
    keys.sort((a, b) => ((chars[b].snap || {}).taken || 0) - ((chars[a].snap || {}).taken || 0));
    CH = chars[keys[0]];
    ITEMS = DB.items || {};
    SPELLS = DB.spells || {};
    NPCS = DB.npcs || {};
    QUESTS = DB.quests || {};
    ITEM_BY_ID = {};
    for (const [k, it] of Object.entries(ITEMS)) if (it.id && (!ITEM_BY_ID[it.id] || (it.tip && !ITEM_BY_ID[it.id].tip))) ITEM_BY_ID[it.id] = Object.assign({ key: k }, it);
    STATE.live = !!(opts && opts.live);
    render();
    document.dispatchEvent(new CustomEvent('cc:loaded', { detail: { live: STATE.live } }));
  }
  // Fixed-size layout that never gets cut off: when the window is narrower than
  // the design, the whole app is scaled down to fit
  // instead of reflowing. Wider windows show it at 100%.
  const loadText = (binary, opts) => load(window.CCLua.parse(binary).ClaudeCompanionDB, opts);
  // for view modules in their own files (js/gear.js): they add V.<tab> and use these helpers
  window.CC = {
    load, loadText, V,
    api: { get CH() { return CH; }, STATE, GD, esc, arr, money, icon, itemIcon, anyItemIcon, anyItemName, gdItem, gdTip,
      gdSourceLines, planPrice, priceOf, trackerStats, lootStrip, ago, dur, fmtTime, flipsOf, cooldowns, specTrees, specLabel, TREE_NAMES, gearIds, item, byId, render, QCOL },
  };

  // ------------------------------------------------------------ data sources
  // 1) data embedded in a published copy, 2) the local server (app mode), 3) drag and drop the saved file.
  const hashTab = (location.hash || '').slice(1);
  // any tab name: tabs from js/gear.js and js/cards.js register after this runs (an unknown one shows the Overview)
  if (/^[a-z]+$/.test(hashTab)) STATE.tab = hashTab;
  const embedded = document.getElementById('cc-embedded');
  const binary = (buf) => { const bytes = new Uint8Array(buf); let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return out; };
  if (embedded && embedded.textContent.trim().length > 2) {
    load(JSON.parse(embedded.textContent));
  } else if (location.protocol.startsWith('http')) {
    // app mode: the local Claude Companion server reads the game's saved
    // file directly; we ask every 3 seconds whether it changed
    let lastStamp = null, busy = false;
    STATE.loading = true;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const st = await (await fetch('api/stamp', { cache: 'no-store' })).json();
        if (st.host || st.os) STATE.device = { host: st.host || null, os: st.os || null };   // which computer (snapshot.device)
        if (st.stamp && st.stamp !== lastStamp) {
          const buf = await (await fetch('api/data', { cache: 'no-store' })).arrayBuffer();
          lastStamp = st.stamp;
          STATE.saveStamp = st.stamp;   // the save file's modified time this data came from (snapshot.saveModified)
          STATE.loading = false;
          loadText(binary(buf), { live: true });
        } else if (!st.stamp) { STATE.loading = false; if (!CH) render(); }
        if (STATE.live === false && CH) { STATE.live = true; render(); }
      } catch (e) {
        if (CH && STATE.live) { STATE.live = false; render(); }
      }
      busy = false;
    };
    poll();
    setInterval(poll, 3000);
    setInterval(() => { if (CH && !document.querySelector('input:focus')) render(); }, 60000);
  }
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadText(binary(r.result));
    r.readAsArrayBuffer(f);
  });
  render();
})();
