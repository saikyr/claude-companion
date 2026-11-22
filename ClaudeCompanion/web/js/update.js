// Claude Companion: updates. The local server checks the project's stable branch (server.py /
// server.ps1, /api/update) and installs a new build by itself when auto-update is on, or when you
// click Install here. This shows a small card when there is something to say: an update is ready,
// one was just installed, the game still runs an older addon build than the app (a /reload loads it),
// or the check can't reach GitHub.
(function () {
  if (!location.protocol.startsWith('http') || /background=1/.test(location.search)) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // small cards in the bottom-right corner stack in one column
  let corner = document.getElementById('cc-corner');
  if (!corner) {
    corner = document.createElement('div');
    corner.id = 'cc-corner';
    corner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:50;display:flex;flex-direction:column;gap:10px;max-width:340px';
    document.body.appendChild(corner);
  }
  const box = document.createElement('div');
  box.id = 'cc-update';
  box.style.cssText = 'background:#17181d;border:1px solid #34353d;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;' +
    'color:#e8e8ea;box-shadow:0 6px 24px rgba(0,0,0,.45);display:none';
  corner.appendChild(box);
  const btn = 'background:#e2b345;color:#141414;border:0;border-radius:6px;padding:5px 12px;font-weight:600;cursor:pointer;margin-right:8px';
  const link = 'background:none;border:0;color:#9a9890;cursor:pointer;padding:0;font-size:12px;text-decoration:underline';
  const DISMISS = 'cc.update.dismissed';
  let st = null, busy = false;

  const post = (url) => fetch(url, { method: 'POST', headers: { 'X-CC': '1' }, body: '{}' }).then((r) => r.json());
  // a build's name is "Build 1.4.0 from main 9679c9351d: <what changed>": show what changed, the build quietly
  function whatsNew(name) {
    const m = /^Build (\S+) from \S+ ([0-9a-f]+): ([\s\S]*)$/.exec(name || '');
    if (!m) return name ? ': ' + esc(name) : '';
    const notes = /^Merge (pull request|branch) /.test(m[3]) ? '' : m[3];
    return `${notes ? ': ' + esc(notes) : ''}<div style="color:#9a9890;font-size:12px">Version ${esc(m[1])} · build ${esc(m[2].slice(0, 7))}</div>`;
  }
  function show(html) { box.innerHTML = html; box.style.display = html ? 'block' : 'none'; }

  function render() {
    if (busy || !st) return;
    const dismissed = localStorage.getItem(DISMISS);
    const inst = st.installed || {};
    // the game runs the addon's Lua it loaded at login or its last /reload: until then it can be an
    // older build than the app (the addon names its build in every save: ClaudeCompanionDB.addonBuild)
    const b = st.builds || {};
    const stale = b.app && b.game != null && b.game !== b.app && dismissed !== 'done:' + inst.tag && dismissed !== 'game:' + b.app;
    const just = stale || (inst.at && Date.now() - Date.parse(inst.at) < 15 * 60 * 1000 && dismissed !== 'done:' + inst.tag);
    if (st.available && dismissed !== 'avail:' + st.latest.tag) {
      show(`<b>Update ready</b>${whatsNew(st.latest.name)}<div style="color:#9a9890;margin:4px 0 8px">${st.auto ? 'It installs by itself within 30 minutes, or now:' : 'Auto-update is off.'}</div>
        <button data-u="install" style="${btn}">Install now</button><button data-u="later" style="${link}">Later</button>
        <div style="margin-top:8px"><button data-u="auto" style="${link}">${st.auto ? 'Turn auto-update off' : 'Turn auto-update on'}</button></div>`);
    } else if (just) {
      show(stale
        ? `<b>The game still runs the previous addon.</b> The app is on the new version. In game, type <b>/reload</b> once (or it loads the next time you start the game).
        <div style="margin-top:8px"><button data-u="game-ok" style="${link}">OK</button></div>`
        : `<b>Updated to ${esc(inst.tag)}.</b> The app is already on the new version. In game, type <b>/reload</b> once to load the addon part.
        <div style="margin-top:8px"><button data-u="ok" style="${link}">OK</button></div>`);
    } else if (st.error && dismissed !== 'err:' + st.error) {
      show(`<span style="color:#e0a050">Can't check for updates.</span> <span style="color:#9a9890">${esc(st.error)}</span>
        <div style="margin-top:8px"><button data-u="dismiss-err" style="${link}">Hide</button></div>`);
    } else show('');
  }

  // An update installed while this window stays open (auto-update): the server runs the new build,
  // but this page still runs the old one. Load the new one at a quiet moment: at once if the window
  // is hidden or minimised, else after 2 minutes without a click or key in it.
  let loadedTag, lastInput = Date.now();
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
  function reloadWhenQuiet() {
    if (document.visibilityState === 'hidden' || Date.now() - lastInput > 2 * 60 * 1000) location.reload();
    else setTimeout(reloadWhenQuiet, 30 * 1000);
  }
  async function check(force) {
    try { st = await (await fetch('api/update' + (force ? '?force=1' : ''), { cache: 'no-store' })).json(); render(); } catch (e) { return; /* older server: no updates */ }
    const tag = (st.installed || {}).tag || null;
    if (loadedTag === undefined) loadedTag = tag;
    else if (tag && tag !== loadedTag && !busy) { loadedTag = tag; reloadWhenQuiet(); }
  }

  async function install() {
    busy = true;
    show('<b>Installing the update…</b><div style="color:#9a9890">Backing up the current version first. Your saved data and companion-data stay as they are.</div>');
    let r;
    try { r = await post('api/update'); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r.ok) { busy = false; show(`<span style="color:#e06060">The update didn't install:</span> ${esc(r.error)}<div style="margin-top:8px"><button data-u="ok" style="${link}">OK</button></div>`); return; }
    show(`<b>Installed ${esc(r.tag)}.</b> Restarting the app…`);
    // the server restarts on the new code; wait for it, then load the new page
    for (let i = 0; i < 60; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      try { if ((await (await fetch('api/ping', { cache: 'no-store' })).text()) === 'claude-companion' && i > 1) { location.reload(); return; } } catch (e) { /* restarting */ }
    }
    busy = false; show('The app server is taking long to restart. Open the app again from the Start menu or the Dock.');
  }

  box.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-u]') && e.target.closest('[data-u]').dataset.u;
    if (!k) return;
    if (k === 'install') install();
    else if (k === 'later') { localStorage.setItem(DISMISS, 'avail:' + st.latest.tag); render(); }
    else if (k === 'ok') { localStorage.setItem(DISMISS, 'done:' + ((st && st.installed) || {}).tag); show(''); check(); }
    else if (k === 'game-ok') { localStorage.setItem(DISMISS, 'game:' + ((st && st.builds) || {}).app); show(''); }
    else if (k === 'dismiss-err') { localStorage.setItem(DISMISS, 'err:' + st.error); render(); }
    else if (k === 'auto') { try { st = await post('api/update-auto?on=' + (st.auto ? 0 : 1)); } catch (err) { /* ignore */ } render(); }
  });

  check(false);
  setInterval(() => check(false), 5 * 60 * 1000);
  window.CCUpdate = { check, install };
})();
