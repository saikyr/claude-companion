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
  if (!CC || !CC.api || !CC.V || !window.CCSteps) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr, ST = window.CCSteps;
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
    if (you.state === 'done') return you.by === 'app' ? 'finished' : 'done';
    if (you.state === 'dismissed') return 'dismissed';
    if (c.status === 'done' || c.status === 'withdrawn') return c.status;
    const ex = secs(c.expires);
    if (ex && ex < Date.now() / 1000) return 'expired';
    return 'open';
  }
  // a card's time for "updated ...": never ahead of now (a Claude clock running ahead, #150)
  const shownTime = (c) => { const t = c.updated || c.created; return t && secs(t) > Date.now() / 1000 ? new Date().toISOString() : t; };
  // Ticked steps follow the step's text, not its place (#150): Claude rewrites and reorders a card's steps, and a
  // tick saved as "step 3" would then mark a different step done. Each tick keeps the hash of its step's text
  // (`ticked`); `steps` (positions) and `v` (the card's updated time) are saved with it, for Claude to read.
  // An older record with positions only counts while the card hasn't changed since it was ticked; so does one
  // whose `ticked` no longer matches its `steps` (an older build, which writes positions only, changed it since).
  // Two steps with the same text get their own keys (the text's hash, then which time it comes).
  const hash = () => window.CCSync && window.CCSync.hash;
  const stepKeys = (steps) => ST.stepKeys(steps, hash());
  const legacyOk = (you, c) => (secs(you.at) || 0) >= (secs(c.updated || c.created) || 0);
  function ticksOf(c) {
    const you = (S.state.cards || {})[c.id] || {}, steps = arr(c.steps), out = new Set();
    if (Array.isArray(you.ticked) && you.ticked.length === arr(you.steps).length) {
      const keys = new Set(you.ticked);
      stepKeys(steps).forEach((k, i) => { if (keys.has(k)) out.add(i); });
    } else if (arr(you.steps).length && legacyOk(you, c)) {
      arr(you.steps).forEach((i) => { if (Number.isInteger(i) && i >= 0 && i < steps.length) out.add(i); });
    }
    return out;
  }
  // every step as it stands (js/cardsteps.js): ticked by you, done in game (its doneWhen check, now or on an
  // earlier save), or ticked by Claude (stepsDone); a step you unticked stays unticked
  let ctxMemo = null;
  const ctx = () => {
    const CH = A.CH, k = CH && CH.snap ? [(CH.snap.taken || 0), arr(CH.snap.completedQuests).length, (CH.bank || {}).taken || 0].join('|') : '';
    if (!ctxMemo || ctxMemo.CH !== CH || ctxMemo.k !== k) ctxMemo = { CH, k, v: CH && CH.snap ? ST.contextOf(CH) : null };
    return ctxMemo.v;
  };
  const recOf = (c) => (S.state.cards || {})[c.id] || {};
  // a card's game checks read the save of the character it names (the gate asks for one with doneWhen): a card for
  // any character would be ticked by whichever one was played last
  const stepsNow = (c) => ST.stepsOf(c, ticksOf(c), recOf(c), c.character ? ctx() : null, hash());
  const version = (c) => c.updated || c.created || null;
  // Claude's done is Claude's, yours is yours; finished = every step done, the last ones in game (the app closed it)
  const CLOSED = { done: 'You marked it done', finished: 'Finished: every step done', dismissed: 'You dismissed it', withdrawn: 'Claude withdrew it', expired: 'Expired' };
  const closedWhy = (c, st) => (st === 'done' && !(recOf(c).state === 'done') ? 'Claude marked it done' : CLOSED[st]);
  const visible = () => S.cards.filter(mine);
  // the open cards in the order Claude set (cards with an order first, then newest first)
  const open = () => ST.ordered(visible().filter((c) => standing(c) === 'open')).map((x) => x.card);

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
      document.dispatchEvent(new Event('cc:cards'));
      autoCheck();
    } catch (e) { /* server gone: keep what we have */ }
  }
  // change: the fields to set on the card's record (null removes one); or a function of the record as it is
  // after the re-read, returning that (null = nothing to change: the game's checks, which another window may
  // have saved already)
  const save = (id, change) => saveAll([[id, change]]);
  async function saveAll(changes) {
    // re-read first so a second app window's choices are kept
    try { const st = await get('api/cards-state'); setState(st, synced(SYNC_STATE)); } catch (e) { /* offline: save what we have */ }
    const all = S.state.cards = S.state.cards || {}, at = new Date().toISOString();
    let any = false;
    changes.forEach(([id, ch]) => {
      const prev = all[id] || {}, change = typeof ch === 'function' ? ch(prev) : ch;
      if (!change) return;
      const rec = Object.assign({}, prev, change, { at });
      Object.keys(rec).forEach((k) => { if (rec[k] == null) delete rec[k]; });
      // Done or Restore on a card Claude rewrote since its positions-only ticks: those ticks are for the old steps
      const c = S.cards.find((y) => y.id === id);
      if (c && !change.steps && arr(prev.steps).length && !(Array.isArray(prev.ticked) && prev.ticked.length === arr(prev.steps).length) && !legacyOk(prev, c)) {
        delete rec.steps; delete rec.ticked;
      }
      all[id] = rec; any = true;
    });
    if (!any) return;
    S.state.schema = 1;
    S.state.written = at;
    const body = stateBody();
    // the account copy: your other computers and Claude see it after the next sync
    try { localStorage.setItem(SYNC_STATE, JSON.stringify(S.state)); } catch (e) { /* private mode: the file still has it */ }
    S.rawState = JSON.stringify([body, synced(SYNC_STATE)]);
    A.render();
    fetch('api/cards-state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body }).catch(() => {});
    document.dispatchEvent(new Event('cc:cards'));
  }

  // The game's checks (doneWhen), at each poll and each new save: a step whose check passes is remembered as done
  // in game (`auto`, kept when the item is used up or handed in later), and a card whose every step is done, at
  // least one of them in game, closes itself as finished (`by: 'app'`). Restore keeps it open until Claude
  // changes the card (`reopened`). Only for the character played last: a check on another one would be its own.
  let checking = false;
  async function autoCheck() {
    if (checking || !A.CH || !A.CH.snap || (A.STATE && A.STATE.viewingOther) || !ctx()) return;
    const todo = [];
    visible().forEach((c) => {
      if (standing(c) !== 'open' || !c.character || !arr(c.doneWhen).some((x) => typeof x === 'string')) return;
      const steps = stepsNow(c), rec = recOf(c), had = new Set(arr(rec.auto));
      const fresh = steps.some((x) => x.met === true && !had.has(x.key));
      const finished = steps.length > 0 && steps.every((x) => x.done) && steps.some((x) => x.by === 'game') && rec.reopened !== version(c);
      if (!fresh && !finished) return;
      todo.push([c.id, (prev) => {
        const keys = new Set(steps.map((x) => x.key)), was = arr(prev.auto);
        const auto = [...new Set([...was, ...steps.filter((x) => x.met === true).map((x) => x.key)])].filter((k) => keys.has(k));
        const change = {};
        if (auto.length !== was.length || auto.some((k, i) => k !== was[i])) change.auto = auto;
        if (finished && prev.state == null && prev.reopened !== version(c)) Object.assign(change, { state: 'done', by: 'app', v: version(c) });
        return Object.keys(change).length ? change : null;
      }]);
    });
    if (!todo.length) return;
    checking = true;
    try { await saveAll(todo); } finally { checking = false; }
  }
  document.addEventListener('cc:loaded', () => { autoCheck(); });

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
  // a step's game check in words ("ticks itself when you have 5 Runecloth")
  function checkWords(check) {
    const k = ST.parse(check);
    if (!k) return '';
    if (k.kind === 'quest') { const q = ((A.GD && A.GD.quests) || {})[k.id]; return `you finish ${(q && q.t) || 'quest ' + k.id}`; }
    if (k.kind === 'item') return `you have ${k.count > 1 ? k.count + ' ' : ''}${A.anyItemName(k.id)}`;
    if (k.kind === 'rep') return `you are ${ST.STANDING[k.standing]} with ${k.faction}`;
    if (k.kind === 'level') return `you reach level ${k.level}`;
    return `your ${k.name} is ${k.rank}`;
  }
  const BY = { game: '<span class="tag ok">done in game</span>', claude: '<span class="tag">ticked by Claude</span>' };
  const OLD_DAYS = 7;
  const PLACE = { start: 'Start here', next: 'Next', later: 'After that' };
  function card(c, full, at) {
    const st = standing(c);
    const [kl, ki] = KINDS[kindOf(c)];
    const now = stepsNow(c), un = new Set(arr(recOf(c).unticked));
    const steps = arr(c.steps);
    const acts = st === 'open'
      ? `<button class="btn" data-card="${esc(c.id)}" data-cact="done">Done</button><button class="btn ghost" data-card="${esc(c.id)}" data-cact="dismissed">Dismiss</button>`
      : st === 'done' || st === 'dismissed' || st === 'finished' ? `<button class="btn ghost" data-card="${esc(c.id)}" data-cact="open">Restore</button>` : '';
    const meta = [kl, c.group ? (at && at.of ? `${c.group} ${at.of[0]} of ${at.of[1]}` : c.group) : '', c.where, c.updated || c.created ? 'updated ' + ago(shownTime(c)) : '',
      steps.length ? `${now.filter((x) => x.done).length}/${steps.length} steps` : '',
      st !== 'open' ? closedWhy(c, st) : c.expires ? 'until ' + A.fmtTime(secs(c.expires)) : ''].filter(Boolean).map(esc).join(' · ');
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
    if (steps.length) body += `<ol class="steps">${steps.map((s, i) => { const x = now[i]; return `<li class="${x.done ? 'done' : ''}"><label><input type="checkbox" data-cstep="${esc(c.id)}" data-i="${i}"${x.done ? ' checked' : ''}${st === 'open' ? '' : ' disabled'}><span class="stx">${esc(s)}</span>${x.done && BY[x.by] ? ' ' + BY[x.by] : ''}</label>${x.check && !x.done && !un.has(x.key) ? `<div class="sub chk">Ticks itself when ${esc(checkWords(x.check))}</div>` : ''}</li>`; }).join('')}</ol>`;
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
    if (CC.runLine) h += CC.runLine();   // Claude updating these cards in the background (js/runner.js)
    if (!all.length) return h + '<div class="empty">Nothing from Claude yet. When Claude suggests a farm, a flip, a quest route or a gear change, it lands here as a card you can tick off, finish or dismiss.</div>';
    const openList = all.filter((c) => standing(c) === 'open'), closed = all.filter((c) => standing(c) !== 'open');
    const kinds = {};
    openList.forEach((c) => { const k = kindOf(c); kinds[k] = (kinds[k] || 0) + 1; });
    if (S.kind && !kinds[S.kind]) S.kind = null;
    h += `<div class="seg"><button data-cview="open" class="${S.view === 'open' ? 'on' : ''}">Open <span class="n">${openList.length}</span></button><button data-cview="closed" class="${S.view === 'closed' ? 'on' : ''}">Done and dismissed <span class="n">${closed.length}</span></button></div>`;
    if (S.view === 'closed') return h + (closed.length ? `<div class="cardlist">${closed.map((c) => card(c, false)).join('')}</div>` : '<div class="empty">Nothing closed yet.</div>');
    if (Object.keys(kinds).length > 1) h += `<div class="chips">${Object.entries(kinds).map(([k, n]) => `<button data-ckind="${k}" class="${S.kind === k ? 'on' : ''}">${KINDS[k][0]} <span>${n}</span></button>`).join('')}</div>`;
    // in Claude's order: Start here, Next, After that (cards with an order), then the rest newest first; cards
    // without an order that Claude hasn't touched for a week fold away under Older
    const list = ST.ordered(openList.filter((c) => !S.kind || kindOf(c) === S.kind), all);
    if (!list.length) return h + '<div class="empty">All caught up: nothing open from Claude.</div>';
    const old = Date.now() / 1000 - OLD_DAYS * 86400;
    // a card with no time at all isn't old: its age isn't known
    const isOld = (x) => { const t = secs(x.card.updated || x.card.created); return !x.place && t != null && t < old; };
    const sections = [
      ['Start here', list.filter((x) => x.place === 'start')],
      ['Next', list.filter((x) => x.place === 'next')],
      ['After that', list.filter((x) => x.place === 'later')],
      [list.some((x) => x.place) ? 'Other suggestions' : '', list.filter((x) => !x.place && !isOld(x))],
    ].filter(([, xs]) => xs.length);
    h += sections.map(([t, xs]) => `${t ? `<h3 class="csec">${t}</h3>` : ''}<div class="cardlist">${xs.map((x) => card(x.card, true, x)).join('')}</div>`).join('');
    const older = list.filter(isOld);
    if (older.length) h += `<details class="cold"><summary><h3 class="csec">Older <span class="n">${older.length}</span></h3><span class="dim small">not updated by Claude for ${OLD_DAYS} days</span></summary><div class="cardlist">${older.map((x) => card(x.card, false, x)).join('')}</div></details>`;
    return h;
  };
  // a short list for the Overview page
  function overview() {
    const list = open();
    if (!server || (!list.length && !S.error)) return '';
    const places = new Map(ST.ordered(list).map((x) => [x.card.id, x.place]));
    return `<h2>From Claude <span class="n dim small">${list.length} open</span></h2><div class="list cov">${list.slice(0, 4).map((c) => {
      const [kl, ki] = KINDS[kindOf(c)], p = places.get(c.id);
      return `<div class="li link" data-tab="claude"><img class="kic" src="${ICON_URL}${ki}.jpg" alt=""><div class="grow"><div>${p ? `<span class="tag cplace p-${p}">${PLACE[p]}</span> ` : ''}${esc(c.title)}</div><div class="sub">${esc(kl)}${c.summary ? ' · ' + esc(c.summary) : ''}</div></div></div>`;
    }).join('')}${list.length > 4 ? `<div class="li link dim small" data-tab="claude">and ${list.length - 4} more</div>` : ''}${S.error ? `<div class="li neg small">${esc(S.error)}</div>` : ''}</div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cact]');
    if (b) {
      e.preventDefault();
      const id = b.dataset.card, c = S.cards.find((y) => y.id === id), how = b.dataset.cact;
      // Restore on a card the app closed: it stays open until Claude changes the card
      // (any Restore: one after Done on a card the app had closed before must not be closed again at once)
      save(id, how === 'open' ? { state: null, by: null, reopened: c ? version(c) : null } : { state: how, by: null });
      return;
    }
    const v = e.target.closest('[data-cview]');
    if (v) { S.view = v.dataset.cview; A.render(); return; }
    const k = e.target.closest('[data-ckind]');
    if (k) { S.kind = S.kind === k.dataset.ckind ? null : k.dataset.ckind; A.render(); }
  });
  document.addEventListener('change', (e) => {
    const x = e.target.closest('[data-cstep]');
    if (!x) return;
    const id = x.dataset.cstep, i = Number(x.dataset.i);
    const c = S.cards.find((y) => y.id === id);
    if (!c) return;
    const ticks = ticksOf(c), steps = arr(c.steps), keys = stepKeys(steps), un = new Set(arr(recOf(c).unticked));
    // unticking a step the game or Claude ticked: it stays unticked (`unticked`) until you tick it again
    if (x.checked) { ticks.add(i); un.delete(keys[i]); } else {
      ticks.delete(i);
      const would = ST.stepsOf(c, ticks, Object.assign({}, recOf(c), { unticked: [] }), ctx(), hash())[i];
      if (would && would.done) un.add(keys[i]);
    }
    const at = [...ticks].filter((j) => j < steps.length).sort((a, b) => a - b);
    const still = new Set(keys);
    save(id, { steps: at, ticked: at.map((j) => keys[j]), v: version(c), unticked: [...un].filter((k) => still.has(k)) });
  });

  // overview(): the Overview page's short list (HTML). open(): the open cards for this character, newest
  // first, as Claude wrote them (fields in companion-data/SCHEMA.md, step included), for other pages.
  // snapshot(): every card for this character as the app shows it, for Claude (snapshot.json cards[], js/claude.js):
  // where it stands and each step's state, who ticked it and its game check
  function snapshot() {
    const places = new Map(ST.ordered(open()).map((x) => [x.card.id, x.place]));
    return visible().map((c) => {
      const st = standing(c), rec = recOf(c);
      return Object.assign({ id: c.id, title: c.title, standing: st, place: places.get(c.id) || null },
        c.group ? { group: c.group } : {}, Number.isFinite(c.order) ? { order: c.order } : {},
        st !== 'open' ? { closedBy: st === 'finished' ? 'app' : st === 'expired' ? 'expiry' : st === 'withdrawn' || (st === 'done' && rec.state !== 'done') ? 'claude' : 'you' } : {},
        { version: version(c), steps: stepsNow(c).map((x, i) => Object.assign({ i, done: x.done, by: x.by }, x.check ? { check: x.check, met: x.met } : {})) });
    });
  }
  // all(): every card the app has (each character's, open or closed, from both sources), as Claude wrote them: what
  // a background Claude run rewrites (js/runner.js)
  CC.cards = { overview, snapshot, open: () => open().map((c) => Object.assign({}, c)), all: () => S.cards.map((c) => Object.assign({}, c)) };
  poll();
  setInterval(poll, 5000);
})();
