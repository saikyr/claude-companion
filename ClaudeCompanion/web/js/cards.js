// Claude Companion: "From Claude" cards (farm, flip, quest, gear... suggestions, one format for all,
// see companion-data/SCHEMA.md). Claude writes them one of two ways, and the app shows both as one list
// (docs/CLAUDE.md):
//   - online: the account setting cc.claude.cards (private.claude_put_setting), which every computer of
//     the account gets with its next sync
//   - on one computer: companion-data/from-claude/cards.json (folder access)
// What you do with them (done, dismissed, ticked steps) is saved to from-claude/state.json and to the
// synced setting cc.claude.cardsState, which Claude reads back. Each place has one writer.
// A cards.json on this computer is also sent to the account (js/sync.js pushCards, through the card gate), so
// the other computers get it too (#83); state.json's `upload` says how the last send went.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr;
  // icon images only, as in app.js (docs/ARCHITECTURE.md, Data sources)
  const ICON_URL = 'https://wow.zamimg.com/images/wow/icons/large/';
  // each kind's word, and its icon from the app's one icon map (app.js UI_ICON)
  const KIND_WORD = { farm: 'Farm', flip: 'AH flip', quest: 'Quest', gear: 'Gear', craft: 'Craft', route: 'Route', note: 'Note' };
  const KINDS = Object.fromEntries(Object.entries(KIND_WORD).map(([k, w]) => [k, [w, A.uiIcon(k)]]));
  const kindOf = (c) => (KINDS[c.kind] ? c.kind : 'note');
  const server = location.protocol.startsWith('http');
  const S = { cards: [], error: null, have: false, state: { schema: 1, cards: {} }, raw: '', rawState: '', kind: null, view: 'open', file: undefined, sent: null };
  // the synced copies (js/sync.js keeps every cc.* setting the same on all your computers)
  const SYNC_CARDS = 'cc.claude.cards', SYNC_STATE = 'cc.claude.cardsState';
  const synced = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

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
  // the steps you ticked on a card as it is now: saved with their text (stepTexts), so a step Claude moves or
  // rewrites isn't ticked by its old position (#150). An older save has positions only: they count while the card is
  // no newer than the ticks.
  function ticked(c, you) {
    const steps = arr(c.steps);
    if (Array.isArray(you.stepTexts)) { const t = new Set(you.stepTexts); return new Set(steps.map((s, i) => (t.has(s) ? i : -1)).filter((i) => i >= 0)); }
    const made = secs(you.at), card = secs(c.updated || c.created);
    return made != null && card != null && card > made ? new Set() : new Set(arr(you.steps).filter((i) => i < steps.length));
  }
  // a card's time for "updated ...": never ahead of now (a Claude clock running ahead, #150)
  const shownTime = (c) => { const t = c.updated || c.created; return t && secs(t) > Date.now() / 1000 ? new Date().toISOString() : t; };
  const CLOSED = { done: 'You marked it done', dismissed: 'You dismissed it', withdrawn: 'Claude withdrew it', expired: 'Expired' };
  const visible = () => S.cards.filter(mine);
  const open = () => visible().filter((c) => standing(c) === 'open');

  // ------------------------------------------------------------ reading and saving
  // both sources as one list: the same id in both = one card, the newer version wins (this computer's file on a
  // tie: what Claude wrote here last, also before the send reaches the account or when it was refused)
  function setCards(file, online) {
    S.raw = JSON.stringify([file, online]);
    S.have = file != null || online != null;
    const errs = [], by = {};
    [[online, 'Cards from your account', false], [file, 'cards.json', true]].forEach(([text, what, wins]) => {
      if (text == null) return;
      try {
        const d = JSON.parse(text);
        if (!d || !Array.isArray(d.cards)) throw new Error('no "cards" list');
        const seen = new Set();
        const ok = d.cards.filter((c) => c && typeof c.id === 'string' && c.id && typeof c.title === 'string' && !seen.has(c.id) && seen.add(c.id));
        ok.forEach((c) => { const had = by[c.id], a = secs(c.updated || c.created) || 0, b = had ? secs(had.updated || had.created) || 0 : 0; if (!had || a > b || (wins && a === b)) by[c.id] = c; });
        const bad = d.cards.length - ok.length;
        if (bad) errs.push(`${what}: ${bad} card${bad > 1 ? 's' : ''} skipped (each needs a unique id and a title)`);
      } catch (e) { errs.push(`${what} could not be read: ${e.message}`); }
    });
    S.error = errs.join(' · ') || null;
    S.cards = Object.values(by).sort((a, b) => (secs(b.updated || b.created) || 0) - (secs(a.updated || a.created) || 0));
  }
  // your choices, from this computer's file and from the account: per card, the newest wins
  function setState(file, online) {
    S.rawState = JSON.stringify([file, online]);
    const read = (t) => { try { const d = t ? JSON.parse(t) : null; return d && d.cards ? d.cards : {}; } catch (e) { return {}; } };
    const a = read(file), b = read(online), all = {};
    if (!S.sent) { try { S.sent = (JSON.parse(file || 'null') || {}).upload || null; } catch (e) { /* unreadable: no upload */ } }
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((id) => {
      const x = a[id], y = b[id];
      all[id] = !x ? y : !y ? x : ((secs(y.at) || 0) >= (secs(x.at) || 0) ? y : x);
    });
    S.state = { schema: 1, cards: all };
  }
  // 204 = that file doesn't exist yet
  const get = async (url) => { const r = await fetch(url, { cache: 'no-store' }); return r.status === 200 ? r.text() : null; };
  async function poll() {
    if (!server) return;
    try {
      const [c, st] = await Promise.all([get('api/cards'), get('api/cards-state')]);
      const oc = synced(SYNC_CARDS), ost = synced(SYNC_STATE);
      const rc = JSON.stringify([c, oc]), rst = JSON.stringify([st, ost]);
      if (rc === S.raw && rst === S.rawState) return;
      if (rc !== S.raw) setCards(c, oc);
      // Claude wrote a new cards.json: send it to the account now, not at the next save in game
      if (c !== S.file) { const was = S.file; S.file = c; if (was !== undefined && c != null && CC.syncNow) CC.syncNow(); }
      if (rst !== S.rawState) setState(st, ost);
      if (A.CH && !document.querySelector('input:focus')) A.render();
    } catch (e) { /* server gone: keep what we have */ }
  }
  async function save(id, change) {
    // re-read first so a second app window's choices are kept
    try { const st = await get('api/cards-state'); setState(st, synced(SYNC_STATE)); } catch (e) { /* offline: save what we have */ }
    const all = S.state.cards = S.state.cards || {};
    const rec = Object.assign({}, all[id], change, { at: new Date().toISOString() });
    if (rec.state == null) delete rec.state;
    all[id] = rec;
    S.state.schema = 1;
    S.state.written = rec.at;
    const body = stateBody();
    // the account copy: your other computers and Claude see it after the next sync
    try { localStorage.setItem(SYNC_STATE, JSON.stringify(S.state)); } catch (e) { /* private mode: the file still has it */ }
    S.rawState = JSON.stringify([body, synced(SYNC_STATE)]);
    A.render();
    fetch('api/cards-state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body }).catch(() => {});
  }

  // state.json: your choices, and how this computer's cards.json was last sent (`upload`, for Claude to read)
  const stateBody = () => JSON.stringify(Object.assign({}, S.state, S.sent ? { upload: S.sent } : {}), null, 1);
  CC.cardsSent = async (r) => {
    S.sent = r;
    try { const st = await get('api/cards-state'); setState(st, synced(SYNC_STATE)); } catch (e) { /* offline: save what we have */ }
    S.sent = r;
    fetch('api/cards-state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: stateBody() }).catch(() => {});
    if (A.CH && A.STATE.tab === 'claude') A.render();
  };
  // where this computer's cards.json stands with your other computers
  function sentLine() {
    if (S.file == null) return '';
    const st = (CC.sync && CC.sync.status) || {}, r = S.sent;
    if (st.off) return '<p class="meta">Sync is off on this computer: the cards Claude wrote here show on this computer only.</p>';
    if (!r) return '<p class="meta dim">The cards Claude wrote on this computer go to your other computers at the next sync.</p>';
    if (r.ok) return `<p class="meta">The cards Claude wrote on this computer were sent to your other computers ${A.ago(Date.parse(r.at) / 1000)}.${r.stale ? ` ${r.stale} number${r.stale > 1 ? 's have' : ' has'} changed since Claude wrote ${r.stale > 1 ? 'them' : 'it'}.` : ''}</p>`;
    // refused by the gate (Claude fixes the file) or not sent (no connection: the app tries again)
    if (r.refused) return `<p class="meta neg">The cards Claude wrote on this computer were not sent to your other computers: ${esc(r.error)}. They show here only until Claude fixes them.</p>`;
    return `<p class="meta dim">The cards Claude wrote on this computer haven't reached your other computers yet (${esc(r.error || 'not sent')}); the app tries again at the next sync.</p>`;
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
    const got = arr(c.items).map((x) => `${drops[x.id] || 0} ${A.itemLink(x.id)}`).join(' · ');
    const live = A.CH.grind && gs.includes(A.CH.grind);
    return `<div class="ctrack"><span class="tag${live ? ' ok' : ''}">${live ? 'tracking now' : 'tracked'}</span> ${gs.length} run${gs.length > 1 ? 's' : ''} as <b>${esc(t.grind)}</b>: ${A.dur(s)} · ${kills} kills · ${A.money(Math.round(val / (s / 3600)), { short: true })}/hr${mobs ? `<div class="sub">Kills: ${mobs}</div>` : ''}${got ? `<div class="sub">Drops: ${got}</div>` : ''}</div>`;
  }
  function itemRow(x) {
    const p = A.planPrice(x.id);
    return `<div class="li">${A.itemIconOf(x.id)}<div class="grow"><div>${A.itemLink(x.id)}</div>${x.note ? `<div class="sub">${esc(x.note)}</div>` : ''}</div><div class="num">${p != null ? A.money(p, { short: true }) + '<div class="sub">your AH</div>' : '<span class="dim small">not priced</span>'}</div></div>`;
  }
  const para = (t) => String(t).split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
  const link = (s) => (/^https?:\/\//.test(s.url || '') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a>` : esc(s.label || ''));
  function card(c, full) {
    const st = standing(c), you = (S.state.cards || {})[c.id] || {};
    const [kl, ki] = KINDS[kindOf(c)];
    const ticks = ticked(c, you);
    const steps = arr(c.steps);
    const acts = st === 'open'
      ? `<button class="btn" data-card="${esc(c.id)}" data-cact="done">Done</button><button class="btn ghost" data-card="${esc(c.id)}" data-cact="dismissed">Dismiss</button>`
      : st === 'done' || st === 'dismissed' ? `<button class="btn ghost" data-card="${esc(c.id)}" data-cact="open">Restore</button>` : '';
    const meta = [kl, c.where, c.updated || c.created ? 'updated ' + ago(shownTime(c)) : '', steps.length ? `${steps.filter((_, i) => ticks.has(i)).length}/${steps.length} steps` : '',
      st !== 'open' ? CLOSED[st] : c.expires ? 'until ' + A.fmtTime(secs(c.expires)) : ''].filter(Boolean).map(esc).join(' · ');
    const head = `<header><img class="kic" src="${ICON_URL}${ki}.jpg" alt=""><div class="grow"><div class="ttl">${esc(c.title)}</div><div class="sub">${meta}</div></div><div class="acts">${acts}</div></header>`;
    let body = '';
    if (c.summary) body += `<p class="sum">${esc(c.summary)}</p>`;
    // what can go wrong (required on a farm card by the card gate): shown before the numbers, so it is read
    if (c.risk) body += `<p class="crisk"><b>Risk</b> ${esc(c.risk)}</p>`;
    // a fact the database found changed since Claude wrote it (stale, private.claude_put_setting): kept, marked
    const stale = {};
    arr(c.stale).forEach((x) => { if (x && x.label) stale[x.label] = x; });
    if (arr(c.facts).length) body += `<dl class="facts">${arr(c.facts).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.note ? `<span class="sub">${esc(f.note)}</span>` : ''}${stale[f.label] ? `<span class="sub need">Changed since Claude wrote it: ${esc(stale[f.label].msg || '')}</span>` : ''}</dd></div>`).join('')}</dl>`;
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
    if (!server) return '<div class="empty">Claude\'s cards need the app\'s own window: open <b>Claude Companion.bat</b> (Windows) or <b>Claude Companion.app</b> (Mac) in AddOns/ClaudeCompanion/web.</div>';
    const all = visible();
    let h = '';
    if (S.error) h += `<div class="empty bad">${esc(S.error)}</div>`;
    h += sentLine();
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
    const c = S.cards.find((k) => k.id === id) || {}, steps = arr(c.steps);
    const ticks = ticked(c, (S.state.cards || {})[id] || {});
    if (x.checked) ticks.add(i); else ticks.delete(i);
    const at = [...ticks].sort((a, b) => a - b);
    save(id, { steps: at, stepTexts: at.map((k) => steps[k]) });
  });

  // overview(): the Overview page's short list (HTML). open(): the open cards for this character, newest
  // first, as Claude wrote them (fields in companion-data/SCHEMA.md, step included), for other pages.
  CC.cards = { overview, open: () => open().map((c) => Object.assign({}, c)), ticked };
  poll();
  setInterval(poll, 5000);
})();
