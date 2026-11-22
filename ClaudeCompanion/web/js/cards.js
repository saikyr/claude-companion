// Claude Companion: "From Claude" cards. Claude writes companion-data/from-claude/cards.json
// (farm, flip, quest, gear... suggestions, one format for all, see companion-data/SCHEMA.md);
// the app shows them and saves what you do with them (done, dismissed, ticked steps) to
// from-claude/state.json, which Claude reads back. Each file has one writer.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr;
  const ICON_URL = 'https://wow.zamimg.com/images/wow/icons/large/';
  const KINDS = {
    farm: ['Farm', 'inv_misc_coin_02'], flip: ['AH flip', 'inv_misc_coin_17'], quest: ['Quest', 'inv_misc_note_01'],
    gear: ['Gear', 'inv_helmet_06'], craft: ['Craft', 'trade_engraving'], route: ['Route', 'inv_misc_map_01'], note: ['Note', 'inv_scroll_03'],
  };
  const kindOf = (c) => (KINDS[c.kind] ? c.kind : 'note');
  const server = location.protocol.startsWith('http');
  const S = { cards: [], error: null, have: false, state: { schema: 1, cards: {} }, raw: '', rawState: '', kind: null, view: 'open' };

  const secs = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? null : t / 1000; };
  const mine = (c) => !c.character || !(A.CH && A.CH.snap) || c.character === ((A.CH.snap.character || {}).name);
  // where a card stands: 'open', or why it is closed. You decide first, then Claude's status, then the expiry.
  function standing(c) {
    const you = (S.state.cards || {})[c.id] || {};
    if (you.state === 'done') return 'done';
    if (you.state === 'dismissed') return 'dismissed';
    if (c.status === 'done' || c.status === 'withdrawn') return c.status;
    const ex = secs(c.expires);
    if (ex && ex < Date.now() / 1000) return 'expired';
    return 'open';
  }
  const CLOSED = { done: 'You marked it done', dismissed: 'You dismissed it', withdrawn: 'Claude withdrew it', expired: 'Expired' };
  const visible = () => S.cards.filter(mine);
  const open = () => visible().filter((c) => standing(c) === 'open');

  // ------------------------------------------------------------ reading and saving
  function setCards(text) {
    S.raw = text;
    S.have = text != null;
    S.error = null;
    if (text == null) { S.cards = []; return; }
    try {
      const d = JSON.parse(text);
      if (!d || !Array.isArray(d.cards)) throw new Error('no "cards" list');
      const seen = new Set();
      S.cards = d.cards.filter((c) => c && typeof c.id === 'string' && c.id && typeof c.title === 'string' && !seen.has(c.id) && seen.add(c.id))
        .sort((a, b) => (secs(b.updated || b.created) || 0) - (secs(a.updated || a.created) || 0));
      const bad = d.cards.length - S.cards.length;
      if (bad) S.error = `${bad} card${bad > 1 ? 's' : ''} skipped (each needs a unique id and a title)`;
    } catch (e) { S.cards = []; S.error = 'cards.json could not be read: ' + e.message; }
  }
  function setState(text) {
    S.rawState = text;
    try { const d = text ? JSON.parse(text) : null; S.state = d && d.cards ? d : { schema: 1, cards: {} }; } catch (e) { S.state = { schema: 1, cards: {} }; }
  }
  // 204 = that file doesn't exist yet
  const get = async (url) => { const r = await fetch(url, { cache: 'no-store' }); return r.status === 200 ? r.text() : null; };
  async function poll() {
    if (!server) return;
    try {
      const [c, st] = await Promise.all([get('api/cards'), get('api/cards-state')]);
      if (c === S.raw && st === S.rawState) return;
      if (c !== S.raw) setCards(c);
      if (st !== S.rawState) setState(st);
      if (A.CH && !document.querySelector('input:focus')) A.render();
    } catch (e) { /* server gone: keep what we have */ }
  }
  async function save(id, change) {
    // re-read first so a second app window's choices are kept
    try { const st = await get('api/cards-state'); if (st !== S.rawState) setState(st); } catch (e) { /* offline: save what we have */ }
    const all = S.state.cards = S.state.cards || {};
    const rec = Object.assign({}, all[id], change, { at: new Date().toISOString() });
    if (rec.state == null) delete rec.state;
    all[id] = rec;
    S.state.schema = 1;
    S.state.written = rec.at;
    const body = JSON.stringify(S.state, null, 1);
    S.rawState = body;
    A.render();
    fetch('api/cards-state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body }).catch(() => {});
  }

  // ------------------------------------------------------------ one card
  const ago = (iso) => { const t = secs(iso); return t ? A.ago(t) : ''; };
  function grinds(name) {
    if (!name || !A.CH) return [];
    const n = String(name).toLowerCase();
    return [...arr(A.CH.grinds), A.CH.grind].filter((g) => g && String(g.name || '').toLowerCase() === n);
  }
  function trackLine(c) {
    const t = c.track || {};
    const gs = grinds(t.grind);
    if (!t.grind) return '';
    if (!gs.length) return `<div class="ctrack dim">Not tracked yet. In game: <b>/cc start ${esc(t.grind)}</b>, and <b>/cc stop</b> when you finish.</div>`;
    let s = 0, val = 0, kills = 0;
    const by = {}, drops = {};
    gs.forEach((g) => {
      const st = A.trackerStats(g);
      s += st.secs; val += st.total; kills += g.kills || 0;
      Object.entries(g.killsBy || {}).forEach(([m, n]) => { by[m] = (by[m] || 0) + n; });
      Object.entries(g.loot || {}).forEach(([id, l]) => { const k = l.id || id; drops[k] = (drops[k] || 0) + (l.count || 0); });
    });
    const mobs = arr(t.mobs).map((m) => `${by[m] || 0} ${esc(m)}`).join(' · ');
    const got = arr(c.items).map((x) => `${drops[x.id] || 0} ${esc(A.anyItemName(x.id))}`).join(' · ');
    const live = A.CH.grind && gs.includes(A.CH.grind);
    return `<div class="ctrack"><span class="tag${live ? ' ok' : ''}">${live ? 'tracking now' : 'tracked'}</span> ${gs.length} run${gs.length > 1 ? 's' : ''} as <b>${esc(t.grind)}</b>: ${A.dur(s)} · ${kills} kills · ${A.money(Math.round(val / (s / 3600)), { short: true })}/hr${mobs ? `<div class="sub">Kills: ${mobs}</div>` : ''}${got ? `<div class="sub">Drops: ${got}</div>` : ''}</div>`;
  }
  function itemRow(x) {
    const p = A.planPrice(x.id);
    return `<div class="li">${A.anyItemIcon(x.id, { size: 'sm' })}<div class="grow"><div>${esc(A.anyItemName(x.id))}</div>${x.note ? `<div class="sub">${esc(x.note)}</div>` : ''}</div><div class="num">${p != null ? A.money(p, { short: true }) + '<div class="sub">your AH</div>' : '<span class="dim small">not priced</span>'}</div></div>`;
  }
  const para = (t) => String(t).split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
  const link = (s) => (/^https?:\/\//.test(s.url || '') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a>` : esc(s.label || ''));
  function card(c, full) {
    const st = standing(c), you = (S.state.cards || {})[c.id] || {};
    const [kl, ki] = KINDS[kindOf(c)];
    const ticks = new Set(arr(you.steps));
    const steps = arr(c.steps);
    const acts = st === 'open'
      ? `<button class="btn" data-card="${esc(c.id)}" data-cact="done">Done</button><button class="btn ghost" data-card="${esc(c.id)}" data-cact="dismissed">Dismiss</button>`
      : st === 'done' || st === 'dismissed' ? `<button class="btn ghost" data-card="${esc(c.id)}" data-cact="open">Restore</button>` : '';
    const meta = [kl, c.where, c.updated || c.created ? 'updated ' + ago(c.updated || c.created) : '', steps.length ? `${steps.filter((_, i) => ticks.has(i)).length}/${steps.length} steps` : '',
      st !== 'open' ? CLOSED[st] : c.expires ? 'until ' + A.fmtTime(secs(c.expires)) : ''].filter(Boolean).map(esc).join(' · ');
    const head = `<header><img class="kic" src="${ICON_URL}${ki}.jpg" alt=""><div class="grow"><div class="ttl">${esc(c.title)}</div><div class="sub">${meta}</div></div><div class="acts">${acts}</div></header>`;
    let body = '';
    if (c.summary) body += `<p class="sum">${esc(c.summary)}</p>`;
    if (arr(c.facts).length) body += `<dl class="facts">${arr(c.facts).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.note ? `<span class="sub">${esc(f.note)}</span>` : ''}</dd></div>`).join('')}</dl>`;
    if (arr(c.items).length) body += `<div class="list citems">${arr(c.items).map(itemRow).join('')}</div>`;
    body += trackLine(c);
    if (steps.length) body += `<ol class="steps">${steps.map((s, i) => `<li class="${ticks.has(i) ? 'done' : ''}"><label><input type="checkbox" data-cstep="${esc(c.id)}" data-i="${i}"${ticks.has(i) ? ' checked' : ''}${st === 'open' ? '' : ' disabled'}><span>${esc(s)}</span></label></li>`).join('')}</ol>`;
    if (c.body) body += `<div class="cbody">${para(c.body)}</div>`;
    if (arr(c.sources).length) body += `<div class="csrc">Sources: ${arr(c.sources).map(link).join(' · ')}</div>`;
    return full
      ? `<article class="ccard k-${kindOf(c)}">${head}<div class="cmain">${body}</div></article>`
      : `<details class="ccard closed k-${kindOf(c)}"><summary>${head}</summary><div class="cmain">${body}</div></details>`;
  }

  // ------------------------------------------------------------ views
  V.claude = function () {
    if (!server) return '<div class="empty">Claude\'s cards need the app\'s own window: start it with <b>Claude Companion.bat</b> (Windows) or <b>Claude Companion.command</b> (Mac).</div>';
    const all = visible();
    let h = '';
    if (S.error) h += `<div class="empty bad">${esc(S.error)}</div>`;
    if (!all.length) return h + '<div class="empty">Nothing from Claude yet. When Claude suggests a farm, a flip, a quest route or a gear change, it lands here as a card you can tick off, finish or dismiss.</div>';
    const openList = all.filter((c) => standing(c) === 'open'), closed = all.filter((c) => standing(c) !== 'open');
    const kinds = {};
    openList.forEach((c) => { const k = kindOf(c); kinds[k] = (kinds[k] || 0) + 1; });
    if (S.kind && !kinds[S.kind]) S.kind = null;
    h += `<div class="seg"><button data-cview="open" class="${S.view === 'open' ? 'on' : ''}">Open <span class="n">${openList.length}</span></button><button data-cview="closed" class="${S.view === 'closed' ? 'on' : ''}">Done and dismissed <span class="n">${closed.length}</span></button></div>`;
    if (S.view === 'closed') return h + (closed.length ? `<div class="cardlist">${closed.map((c) => card(c, false)).join('')}</div>` : '<div class="empty">Nothing closed yet.</div>');
    if (Object.keys(kinds).length > 1) h += `<div class="chips">${Object.entries(kinds).map(([k, n]) => `<button data-ckind="${k}" class="${S.kind === k ? 'on' : ''}">${KINDS[k][0]} <span>${n}</span></button>`).join('')}</div>`;
    const list = openList.filter((c) => !S.kind || kindOf(c) === S.kind);
    return h + (list.length ? `<div class="cardlist">${list.map((c) => card(c, true)).join('')}</div>` : '<div class="empty">All caught up: nothing open from Claude.</div>');
  };
  // a short list for the Overview page
  function overview() {
    const list = open();
    if (!server || (!list.length && !S.error)) return '';
    return `<h2>From Claude <span class="n dim small">${list.length} open</span></h2><div class="list cov">${list.slice(0, 4).map((c) => {
      const [kl, ki] = KINDS[kindOf(c)];
      return `<div class="li link" data-tab="claude"><img class="kic" src="${ICON_URL}${ki}.jpg" alt=""><div class="grow"><div>${esc(c.title)}</div><div class="sub">${esc(kl)}${c.summary ? ' · ' + esc(c.summary) : ''}</div></div></div>`;
    }).join('')}${list.length > 4 ? `<div class="li link dim small" data-tab="claude">and ${list.length - 4} more</div>` : ''}${S.error ? `<div class="li neg small">${esc(S.error)}</div>` : ''}</div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cact]');
    if (b) { e.preventDefault(); save(b.dataset.card, { state: b.dataset.cact === 'open' ? null : b.dataset.cact }); return; }
    const v = e.target.closest('[data-cview]');
    if (v) { S.view = v.dataset.cview; A.render(); return; }
    const k = e.target.closest('[data-ckind]');
    if (k) { S.kind = S.kind === k.dataset.ckind ? null : k.dataset.ckind; A.render(); }
  });
  document.addEventListener('change', (e) => {
    const x = e.target.closest('[data-cstep]');
    if (!x) return;
    const id = x.dataset.cstep, i = Number(x.dataset.i);
    const ticks = new Set(arr(((S.state.cards || {})[id] || {}).steps));
    if (x.checked) ticks.add(i); else ticks.delete(i);
    save(id, { steps: [...ticks].sort((a, b) => a - b) });
  });

  CC.cards = { overview };
  poll();
  setInterval(poll, 5000);
})();
