// Claude Companion: what the game's combat log says about each creature (docs/FEATURES.md, "Combat log").
// The game writes _forever_/Logs/WoWCombatLog-*.txt while /combatlog is on. The local server hands the
// page its bytes (api/combatlog, read only); this file reads them a piece at a time from where it stopped
// and keeps only counts per creature, in companion-data/combat.json (api/combat):
//   spells by you, your pet and your group on it, per magic school: n (hits and misses), full resists,
//   damage done and damage resisted (partial resists); kills by you or your group (PARTY_KILL); its
//   deaths seen at all
// No player names, no lines, nothing else is kept. The snapshot carries the counts (combat), so a resist
// share comes with its sample size. Respawn times aren't measured.
(function () {
  'use strict';
  const SCHOOLS = { 2: 'holy', 4: 'fire', 8: 'nature', 16: 'frost', 32: 'shadow', 64: 'arcane' };
  const DAMAGE = new Set(['SPELL_DAMAGE', 'SPELL_PERIODIC_DAMAGE', 'RANGE_DAMAGE', 'DAMAGE_SHIELD']);
  const MISSED = new Set(['SPELL_MISSED', 'SPELL_PERIODIC_MISSED', 'RANGE_MISSED', 'DAMAGE_SHIELD_MISSED']);
  const CHUNK_RUN = 64 * 1024 * 1024;   // at most this much read per page load: a huge old log catches up over a few loads
  const TOP = 60;                       // creatures in the snapshot

  // the fields of one line after its time stamp; quoted strings may hold commas
  function fields(s) {
    const out = [];
    let i = 0;
    while (i <= s.length) {
      if (s[i] === '"') {
        const j = s.indexOf('"', i + 1);
        const end = j < 0 ? s.length : j;
        out.push(s.slice(i + 1, end));
        i = s.indexOf(',', end);
        if (i < 0) break;
        i++;
      } else {
        const j = s.indexOf(',', i);
        if (j < 0) { out.push(s.slice(i)); break; }
        out.push(s.slice(i, j));
        i = j + 1;
      }
    }
    return out;
  }
  // a unit's flags: affiliation mine (1), party (2) or raid (4), pets and guardians included
  const ours = (flags) => (parseInt(flags, 16) & 0x7) !== 0;
  const creature = (guid) => /^(Creature|Vehicle)-/.test(guid || '');
  const npcOf = (guid) => Number(String(guid).split('-')[5]) || null;
  const num = (x) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0; };
  const schoolOf = (x) => SCHOOLS[parseInt(x)] || null;   // "0x20" or "32"; physical and mixed schools aren't counted

  function fresh() { return { v: 1, files: {}, adv: {}, bad: {}, npcs: {}, lines: 0, through: null }; }

  function npc(st, name, guid) {
    const k = name || ('npc ' + npcOf(guid));
    return st.npcs[k] || (st.npcs[k] = { npc: npcOf(guid), kills: 0, deaths: 0, schools: {} });
  }

  // The damage suffix is amount, [baseAmount,] overkill, school, resisted, blocked, absorbed, critical,
  // glancing, crushing, isOffHand [, ST | AOE]. It starts right after the spell (field 12), or past the 17
  // unit fields advanced logging adds (the header says which), so its length says whether baseAmount is there.
  function damage(f, adv) {
    let e = f.length;
    if (f[e - 1] === 'ST' || f[e - 1] === 'AOE') e--;
    const suffix = e - 12 - (adv ? 17 : 0);
    return { amount: num(f[e - (suffix >= 11 ? 11 : 10)]), resisted: num(f[e - 7]) };
  }

  // one line: "11/22/2026 23:12:12.3450  EVENT,..." (older clients: "11/22 23:12:12.345  EVENT,...")
  function line(st, text, adv) {
    const at = text.indexOf('  ');
    if (at < 0) return;
    const f = fields(text.slice(at + 2));
    const ev = f[0];
    st.lines++;
    st.through = text.slice(0, at);
    if (ev === 'PARTY_KILL') {
      if (ours(f[3]) && creature(f[5])) npc(st, f[6], f[5]).kills++;
      return;
    }
    if (ev === 'UNIT_DIED') { if (creature(f[5])) npc(st, f[6], f[5]).deaths++; return; }
    if (!DAMAGE.has(ev) && !MISSED.has(ev)) return;
    if (!ours(f[3]) || !creature(f[5])) return;
    const sch = schoolOf(f[11]);
    if (!sch) return;
    const n = npc(st, f[6], f[5]);
    const s = n.schools[sch] || (n.schools[sch] = { n: 0, full: 0, dmg: 0, resisted: 0 });
    s.n++;
    if (MISSED.has(ev)) { if (f[12] === 'RESIST') s.full++; return; }
    const d = damage(f, adv);
    s.dmg += d.amount; s.resisted += d.resisted;
  }

  // a piece of a file: whole lines only; returns how many bytes were used (up to the last newline)
  function piece(st, bytes, atStart, name) {
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] !== 10) end--;
    if (end === 0) return bytes.length >= 4 * 1024 * 1024 ? bytes.length : 0;   // one 4 MB line: skip it
    const text = new TextDecoder('utf-8').decode(bytes.subarray(0, end));
    const ls = text.split(/\r?\n/);
    let i = 0;
    st.adv = st.adv || {};
    if (atStart) {
      if (!/COMBAT_LOG_VERSION,/.test(ls[0] || '')) { st.bad[name] = 'no COMBAT_LOG_VERSION header'; return -1; }
      st.adv[name] = /ADVANCED_LOG_ENABLED,1/.test(ls[0]) ? 1 : 0;
      i = 1;
    }
    for (; i < ls.length; i++) if (ls[i]) line(st, ls[i], st.adv[name]);
    return end;
  }

  // what goes in the snapshot: the creatures with the most to say, with their counts as they are
  function summary(st) {
    if (!st || !Object.keys(st.npcs || {}).length) return null;
    const weight = (x) => x.kills + Object.values(x.schools).reduce((a, s) => a + s.n, 0);
    const npcs = Object.entries(st.npcs).map(([name, x]) => ({ name, npc: x.npc, kills: x.kills, deaths: x.deaths, schools: x.schools }))
      .sort((a, b) => weight(b) - weight(a)).slice(0, TOP);
    return { files: Object.keys(st.files).length, lines: st.lines, through: st.through, creatures: Object.keys(st.npcs).length, npcs,
      bad: Object.keys(st.bad || {}).length ? st.bad : undefined };
  }

  const api = { fields, line, piece, summary, fresh, damage };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window === 'undefined') return;

  // ---------------------------------------------------------------- in the page
  const CC = window.CC;
  if (!CC) return;
  CC.combat = { state: null, api };
  if (location.protocol === 'file:') return;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body });
  async function run() {
    let st = null;
    try { const r = await fetch('api/combat', { cache: 'no-store' }); if (r.status === 200) st = await r.json(); } catch (e) { st = null; }
    if (!st || st.v !== 1) st = fresh();
    CC.combat.state = st;
    let list;
    try { list = (await (await fetch('api/combatlog', { cache: 'no-store' })).json()).files || []; } catch (e) { return; }
    let budget = CHUNK_RUN, changed = false;
    for (const file of list.slice().reverse()) {   // oldest first
      if (st.bad[file.name]) continue;
      let done = st.files[file.name] || 0;
      if (done > file.size) done = 0;              // a new file under the same name
      while (done < file.size && budget > 0) {
        const r = await fetch('api/combatlog?file=' + encodeURIComponent(file.name) + '&from=' + done, { cache: 'no-store' });
        if (!r.ok) break;
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.length) break;
        const used = piece(st, bytes, done === 0, file.name);
        changed = true;
        if (used < 0) { done = file.size; break; }
        if (used === 0) break;                     // a line still being written: next time
        done += used; budget -= used;
      }
      st.files[file.name] = done;
    }
    if (changed) { st.updated = new Date().toISOString(); await post('api/combat', JSON.stringify(st)).catch(() => {}); }
  }
  let running = null;
  document.addEventListener('cc:loaded', () => { if (!running) running = run().catch(() => {}).finally(() => { running = null; }); });
})();
