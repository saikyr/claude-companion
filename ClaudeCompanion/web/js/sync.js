// Claude Companion: one character on every computer. Sync is off until you pick a cloud drive your
// computers already share (Google Drive for desktop, OneDrive, Dropbox, iCloud Drive); the server then
// keeps a "Claude Companion" folder in it, one subfolder per computer, and the page merges the other
// computers' saves with this one (js/merge.js). This card asks once, and says when something is wrong.
(function () {
  if (!location.protocol.startsWith('http') || /background=1/.test(location.search)) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let corner = document.getElementById('cc-corner');
  if (!corner) {
    corner = document.createElement('div');
    corner.id = 'cc-corner';
    corner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:50;display:flex;flex-direction:column;gap:10px;max-width:340px';
    document.body.appendChild(corner);
  }
  const box = document.createElement('div');
  box.id = 'cc-sync';
  box.style.cssText = 'background:#17181d;border:1px solid #34353d;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;' +
    'color:#e8e8ea;box-shadow:0 6px 24px rgba(0,0,0,.45);display:none';
  corner.prepend(box);
  const btn = 'background:#e2b345;color:#141414;border:0;border-radius:6px;padding:5px 10px;font-weight:600;cursor:pointer;margin:0 6px 6px 0';
  const link = 'background:none;border:0;color:#9a9890;cursor:pointer;padding:0;font-size:12px;text-decoration:underline';
  const LATER = 'cc.sync.later';
  let st = null;
  const show = (html) => { box.innerHTML = html; box.style.display = html ? 'block' : 'none'; };

  function render() {
    if (!st) return show('');
    if (st.enabled) {
      if (st.error) return show(`<b>Sync between computers</b> <span style="color:#e0a050">has a problem:</span> <span style="color:#9a9890">${esc(st.error)}</span>`);
      return show('');
    }
    if (localStorage.getItem(LATER) && Date.now() - Number(localStorage.getItem(LATER)) < 7 * 864e5) return show('');
    const drives = st.drives || [];
    show(`<b>Play on more than one computer?</b><div style="color:#9a9890;margin:4px 0 8px">Pick the cloud drive your computers share, and each one shows the same character (journal, grinds, runs, AH prices, settings). Do the same on the other computer.</div>
      ${drives.length ? drives.map((d, i) => `<button data-sync="${i}" style="${btn}" title="${esc(d.path)}">${esc(d.kind)}</button>`).join('')
        : '<div style="margin-bottom:6px">No cloud drive found on this computer. Install <b>Google Drive for desktop</b> (or OneDrive, Dropbox, iCloud Drive) and it shows up here.</div>'}
      <div><button data-sync="later" style="${link}">Not now</button></div>`);
  }

  async function check() {
    try { st = await (await fetch('api/devices', { cache: 'no-store' })).json(); render(); } catch (e) { /* older server */ }
  }

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sync]');
    if (!b) return;
    const k = b.dataset.sync;
    if (k === 'later') { localStorage.setItem(LATER, String(Date.now())); return render(); }
    const d = (st.drives || [])[Number(k)];
    if (!d) return;
    show('Setting up sync…');
    try {
      const r = await fetch('api/sync-config', { method: 'POST', headers: { 'X-CC': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: d.path }) });
      if (!r.ok) throw new Error(await r.text());
      st = await r.json();
      show(`<b>Sync is on.</b> This computer's save goes to <span style="color:#9a9890">${esc(st.folder)}</span>. Pick the same drive on your other computer.<div style="margin-top:8px"><button data-sync="later" style="${link}">OK</button></div>`);
    } catch (err) { show(`<span style="color:#e06060">Couldn't turn sync on:</span> ${esc(err.message)}`); }
  });

  check();
  setInterval(check, 5 * 60 * 1000);
  window.CCSync = { check };
})();
