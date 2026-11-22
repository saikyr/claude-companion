// Claude Companion: updates. The local server checks the project's stable branch (server.py /
// server.ps1, /api/update) and installs a new build by itself when auto-update is on, or when you
// click Install here. This shows a small card when there is something to say: an update is ready,
// one was just installed (the addon's Lua needs a /reload in game), or the check can't reach GitHub.
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
  function show(html) { box.innerHTML = html; box.style.display = html ? 'block' : 'none'; }

  function render() {
    if (busy || !st) return;
    const dismissed = localStorage.getItem(DISMISS);
    const inst = st.installed || {};
    const just = inst.at && Date.now() - Date.parse(inst.at) < 15 * 60 * 1000 && dismissed !== 'done:' + inst.tag;
    if (st.available && dismissed !== 'avail:' + st.latest.tag) {
      show(`<b>Update ready:</b> ${esc(st.latest.name)}<div style="color:#9a9890;margin:4px 0 8px">${st.auto ? 'It installs by itself within 30 minutes, or now:' : 'Auto-update is off.'}</div>
        <button data-u="install" style="${btn}">Install now</button><button data-u="later" style="${link}">Later</button>
        <div style="margin-top:8px"><button data-u="auto" style="${link}">${st.auto ? 'Turn auto-update off' : 'Turn auto-update on'}</button></div>`);
    } else if (just) {
      show(`<b>Updated to ${esc(inst.tag)}.</b> The app is already on the new version. In game, type <b>/reload</b> once to load the addon part.
        <div style="margin-top:8px"><button data-u="ok" style="${link}">OK</button></div>`);
    } else if (st.error && dismissed !== 'err:' + st.error) {
      show(`<span style="color:#e0a050">Can't check for updates.</span> <span style="color:#9a9890">${esc(st.error)}</span>
        <div style="margin-top:8px"><button data-u="dismiss-err" style="${link}">Hide</button></div>`);
    } else show('');
  }

  async function check(force) {
    try { st = await (await fetch('api/update' + (force ? '?force=1' : ''), { cache: 'no-store' })).json(); render(); } catch (e) { /* older server: no updates */ }
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
    else if (k === 'dismiss-err') { localStorage.setItem(DISMISS, 'err:' + st.error); render(); }
    else if (k === 'auto') { try { st = await post('api/update-auto?on=' + (st.auto ? 0 : 1)); } catch (err) { /* ignore */ } render(); }
  });

  check(false);
  setInterval(() => check(false), 10 * 60 * 1000);
  window.CCUpdate = { check, install };
})();
