// Claude Companion: Claude updates your cards after each save (#169).
// Opt-in, on each computer: the player's own Claude Code, signed in with their own Claude plan, runs in the
// background on this computer when a save brings something a card can be about (js/cardsteps.js worthRun), and
// rewrites the From Claude cards. The local server starts and watches it (server.py / server.ps1, "Claude updates
// the cards"); this page tells it about each save and shows where it stands:
//   - after each snapshot (js/claude.js): this save's digest, the change since the save before (wakeOf), whether
//     that is worth a run, and every card the app has (what Claude rewrites) -> POST api/claude {action: 'save'}
//   - System tab: Connect (installs Claude Code if needed and opens the sign-in), on / off, Update now, the last run
//   - From Claude tab: a line while it runs, and how the last one went
// The cards it writes reach the account like any cards.json on this computer: js/sync.js pushCards, through the gate.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V || !window.CCSteps || !location.protocol.startsWith('http')) return;
  const A = CC.api, V = CC.V, esc = A.esc, ST = window.CCSteps;
  const BACKGROUND = new URLSearchParams(location.search).has('background');
  const post = (o) => fetch('api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(o) })
    .then((r) => (r.ok ? r.json() : null));
  // every card the app has, as written, for the run to rewrite (companion-data/claude-run/cards-now.json)
  const saveCards = () => fetch('api/claude-cards', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ schema: 1, cards: CC.cards && CC.cards.all ? CC.cards.all() : [] }, null, 1) })
    .then((r) => { if (!r.ok) throw new Error('the local server did not save the cards for Claude'); });
  const status = (check) => fetch('api/claude' + (check ? '?check=1' : ''), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let S = null, msg = '', checked = 0;

  // after each snapshot: the server keeps each character's last digest, so the change is from the save before
  // (on this computer), whichever window or the hidden browser saw it
  CC.claudeRun = async (digest) => {
    if (!digest || !digest.name) return;
    const st = await status(false);
    if (!st || !st.on) { S = st || S; return; }
    const prev = (st.digests || {})[digest.name];
    if (prev && prev.t >= digest.t) return;
    const wake = prev ? ST.wakeOf(prev, digest, CC.wakeNames) : null;
    const open = CC.cards && CC.cards.open ? CC.cards.open() : [], worth = ST.worthRun(wake, open);
    if (worth) await saveCards();
    S = await post({ action: 'save', name: digest.name, digest, wake, worth });
    if (!BACKGROUND) A.render();
  };

  const when = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  function lastLine(l) {
    if (!l) return 'No run yet: the first one starts after your next save that changes something on a card.';
    const at = when(l.at);
    if (!l.ok) return `<span class="neg">Last run ${at}: ${esc(l.error || 'it stopped')}</span>`;
    const gate = l.gate === 'ok' ? 'checked and sent to your account' : l.gate === 'no change' ? 'no card needed a change'
      : l.gate ? esc(l.gate) : l.wrote ? 'being checked' : 'no card needed a change';
    return `Last run ${at}: ${l.wrote || l.gate === 'no change' ? `${l.cards} card${l.cards === 1 ? '' : 's'}, ` : ''}${gate}.`;
  }
  // From Claude tab: one line, only when it is on
  CC.runLine = () => {
    if (!S || !S.on) return '';
    if (S.running) return '<p class="meta">Claude is updating these cards after your last save…</p>';
    return `<p class="meta dim">${lastLine(S.last)}</p>`;
  };

  // System tab
  const base = V.system;
  V.system = function () {
    if (Date.now() - checked > 15000) {
      checked = Date.now();
      status(true).then((st) => { if (st) { S = st; if (A.STATE.tab === 'system') A.render(); } });
    }
    let h = '<h2>Claude updates your cards</h2><p class="meta">After a save that changes something on a card (a quest done, a level, a step, an item a step counts), your own Claude rewrites your From Claude cards in the background, here on this computer, with your Claude plan (Pro or above). It reads only this addon folder and writes only its cards.</p>';
    if (!S) h += '<p class="dim">Checking…</p>';
    else if (!S.claude || S.signedIn === false) {
      h += `<p>${S.claude ? 'Claude Code is here but not signed in.' : 'Needs Claude Code on this computer.'} Connect ${S.claude ? 'opens' : 'installs it (no admin rights needed) and opens'} the sign-in to your Claude account, once.</p>
        <div class="toolbar"><button class="btn" data-crun="connect">Connect</button></div>`;
    } else {
      const state = S.running ? 'Updating your cards now…' : S.queued ? 'Waiting to update your cards…' : S.checking ? 'Checking the new cards…' : lastLine(S.last);
      h += S.on
        ? `<p>On · ${state} · ${S.runs} of ${S.cap} runs today</p>
          <div class="toolbar"><button class="btn ghost" data-crun="run"${S.running ? ' disabled' : ''}>Update now</button><button class="btn ghost" data-crun="off">Turn off</button></div>`
        : `<p>Off on this computer.</p><div class="toolbar"><button class="btn" data-crun="on">Turn on</button></div>`;
    }
    if (msg) h += `<p class="meta">${msg}</p>`;
    return h + base();
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-crun]');
    if (!b) return;
    msg = '';
    try {
      if (b.dataset.crun === 'run') await saveCards();
      const r = await post({ action: b.dataset.crun });
      if (b.dataset.crun === 'connect') {
        msg = r && r.ok ? 'A window opened: follow it to sign in, then come back here.' : esc((r && r.error) || 'It did not open.');
        checked = 0;
      } else if (r) S = r;
    } catch (err) { msg = `<span class="neg">${esc(err.message || err)}</span>`; }
    A.render();
  });
  // while a run goes, follow it
  if (!BACKGROUND) setInterval(async () => {
    if (!S || !(S.running || S.queued || S.checking)) return;
    const st = await status(false);
    if (st) { S = st; if (A.STATE.tab === 'system' || A.STATE.tab === 'claude') A.render(); }
  }, 5000);
  status(false).then((st) => { S = st; });
})();
