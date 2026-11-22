// Claude Companion: dungeon and raid runs.
// The addon (1.5+) tracks a run by itself from entering an instance until you leave it for good
// (Journal.lua): time, kills, bosses, loot, gold, XP, deaths, quests, rep, group. Runs from before
// that are rebuilt here from the Journal (zone changes into an instance and what happened there),
// marked "from the journal": no bosses, and kills counted from XP gains.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr;
  const OUTSIDE = 15 * 60; // same as the addon: out longer than this = the run is over

  // runs rebuilt from journal events, for times the addon didn't track runs yet
  function fromJournal(CH, before) {
    const j = arr(CH.journal);
    const out = [];
    let r = null, inside = false, leftAt = null, lastT = 0;
    const close = (at) => {
      if (!r) return;
      r.finish = at; r.secs = Math.max(0, at - r.start - r.outsideSecs);
      if (r.kills || r.xp || Object.keys(r.loot).length || r.quests) out.push(r);
      r = null; inside = false; leftAt = null;
    };
    for (const e of j) {
      if (!e || !e.t) continue;
      if (before && e.t >= before) break;
      // a long gap (logged out, the other computer) ends it like the addon does
      if (r && e.t - (inside ? lastT : leftAt || lastT) > OUTSIDE) close(inside ? lastT : leftAt);
      if (e.e === 'zone') {
        const inst = e.instance === 'party' || e.instance === 'raid';
        if (inst) {
          if (r && r.name !== e.to) close(inside ? e.t : leftAt);
          if (!r) {
            r = { name: e.to, kind: e.instance, start: e.t, last: e.t, outsideSecs: 0, kills: 0, killsBy: {}, xp: 0, loot: {}, bySource: {},
              deaths: 0, quests: 0, questList: [], rep: {}, bosses: [], group: [], fromJournal: true };
            const g = [...j].reverse().find((x) => x.e === 'group' && x.t <= e.t);
            r.group = g ? arr(g.members).map((m) => ({ name: m.name, level: m.level, class: m.class })) : [];
          } else if (!inside) r.outsideSecs += e.t - leftAt;
          inside = true; leftAt = null;
        } else if (r && inside) { inside = false; leftAt = e.t; }
      } else if (e.e === 'logout' && r && inside) { lastT = e.t; }
      if (r && inside && e.zone === r.name) {
        r.last = e.t;
        if (e.e === 'xp') {
          // an XP gain with no quest handed in that second is a kill
          const quest = j.some((q) => q.e === 'questDone' && Math.abs(q.t - e.t) <= 1);
          r.xp += e.amount || 0;
          if (!quest) r.kills += 1;
        } else if (e.e === 'kill') { r.killsBy[e.name] = (r.killsBy[e.name] || 0) + 1; }
        else if (e.e === 'loot' && e.item) {
          const id = (/item:(\d+)/.exec(e.item) || [])[1];
          const l = r.loot[id] || { id: Number(id), item: e.item, link: e.link, q: e.q, count: 0 };
          l.count += e.count || 1; r.loot[id] = l;
        } else if (e.e === 'money' && e.source === 'loot') r.bySource.loot = (r.bySource.loot || 0) + (e.amount || 0);
        else if (e.e === 'death') r.deaths += 1;
        else if (e.e === 'questDone') { r.quests += 1; r.questList.push(e.title || '#' + e.quest); }
        else if (e.e === 'rep' && e.faction) r.rep[e.faction] = (r.rep[e.faction] || 0) + (e.change || 0);
      }
      lastT = e.t;
    }
    if (r) close(inside ? r.last : leftAt);
    return out;
  }

  // bosses for a run from the ForeverDungeonJournal addon's log (copied into CH.bossLog by the addon)
  function loggedBosses(CH, r) {
    const out = [];
    const to = r.finish || r.last || Date.now() / 1000;
    arr((CH.bossLog || {}).runs).forEach((x) => {
      if (x.dungeon !== r.name) return;
      arr(x.bosses).forEach((b) => { if (b.t >= r.start - 60 && b.t <= to + 60 && !out.some((o) => o.name === b.name)) out.push({ name: b.name, t: b.t, source: 'journal addon' }); });
    });
    return out.sort((a, b) => a.t - b.t);
  }

  // every run, newest first: the one going on, the addon's, then older ones from the journal
  function all(CH) {
    CH = CH || A.CH;
    if (!CH) return [];
    const tracked = arr(CH.runs);
    const first = tracked.length ? tracked[0].start : CH.run ? CH.run.start : null;
    const list = fromJournal(CH, first).concat(tracked);
    // runs with no boss list (rebuilt from the Journal, or the encounter events missed them)
    list.forEach((r) => {
      if (arr(r.bosses).length) return;
      const b = loggedBosses(CH, r);
      if (b.length) { r.bosses = b; r.bossSource = 'journal addon'; }
    });
    if (CH.run) list.push(Object.assign({ live: true }, CH.run));
    return list.sort((a, b) => b.start - a.start);
  }

  const ENDED = { left: 'left', other: 'went into another instance', reset: 'instance reset', away: 'away', logout: 'logged out' };
  function card(r) {
    const s = A.trackerStats(r);
    const xph = r.xp ? Math.round(r.xp / s.hrs) : 0;
    const epics = Object.values(r.loot || {}).filter((l) => (l.q != null ? l.q : ((A.item(l.item) || {}).q || 0)) >= 3);
    const kills = Object.entries(r.killsBy || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, k]) => `${esc(n)} ×${k}`).join(', ');
    const bosses = arr(r.bosses);
    return `<div class="grind${r.live ? ' live' : ''}">
      <div class="ghd"><span class="gname">${esc(r.name || 'Dungeon')}</span>${r.live ? `<span class="tag">${r.inside ? 'inside' : 'outside'}</span>` : ''}${r.fromJournal ? '<span class="tag" title="From before the addon tracked runs: rebuilt from the Journal, kills counted from XP gains">from the journal</span>' : ''}<span class="dim small">${A.fmtTime(r.start)} · ${A.dur(s.secs)}${r.difficulty ? ' · ' + esc(r.difficulty) : ''}${r.ended && ENDED[r.ended] ? ' · ended: ' + ENDED[r.ended] : ''}</span></div>
      <div class="gnums">
        <div><span class="k">Kills</span><span class="v">${r.kills || 0}</span></div>
        <div><span class="k">Bosses</span><span class="v">${bosses.length || !r.fromJournal ? bosses.length : '<span class="dim small" title="This run is from before the addon tracked bosses, and the Dungeon Journal addon has no log of it">not recorded</span>'}</span></div>
        <div><span class="k">Deaths</span><span class="v">${r.deaths || 0}${r.wipes ? ` <span class="dim small">${r.wipes} wipe${r.wipes > 1 ? 's' : ''}</span>` : ''}</span></div>
        <div><span class="k">XP</span><span class="v">${(r.xp || 0).toLocaleString()}${xph ? ` <span class="dim small">${xph.toLocaleString()}/hr</span>` : ''}</span></div>
        <div><span class="k">Gold looted</span><span class="v">${A.money(s.coin, { short: true })}</span></div>
        <div><span class="k">Items</span><span class="v">${A.money(s.ah, { short: true })}</span></div>
        <div><span class="k">Quests</span><span class="v">${r.quests || 0}</span></div>
      </div>
      ${bosses.length ? `<div class="small">Bosses: ${bosses.map((b) => esc(b.name)).join(', ')}${r.bossSource ? ' <span class="dim">(from the Dungeon Journal addon\'s log)</span>' : ''}</div>` : ''}
      ${epics.length ? `<div class="small">Blues and better: ${epics.map((l) => (l.item ? A.itemIcon(l.item, { size: 'xs' }) : '') + ' ' + esc(l.name || (A.item(l.item) || {}).name || (l.link || '').replace(/.*\[(.*)\].*/, '$1'))).join(', ')}</div>` : ''}
      <div class="row wrap">${A.lootStrip(r) || '<span class="dim small">no drops</span>'}</div>
      ${arr(r.groupLoot).length ? `<div class="small">Went to others: ${r.groupLoot.map((g) => `${g.item ? A.itemIcon(g.item, { size: 'xs' }) : ''} ${esc((g.link || '').replace(/.*\[(.*)\].*/, '$1'))} → <b>${esc(g.who)}</b>${g.how === 'won' ? ' (won' + (arr(g.rolls).length ? ': ' + g.rolls.map((x) => esc(x.who) + ' ' + esc(x.choice) + (x.roll != null ? ' ' + x.roll : '')).join(', ') : '') + ')' : ''}`).join(' · ')}</div>` : ''}
      ${arr(r.questList).length ? `<div class="small">Quests: ${r.questList.map(esc).join(', ')}</div>` : ''}
      ${Object.keys(r.rep || {}).length ? `<div class="small">${Object.entries(r.rep).map(([f, n]) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : ''}${n}</span> ${esc(f)}`).join(' · ')}</div>` : ''}
      ${arr(r.group).length ? `<div class="dim small">With ${r.group.map((m) => esc(m.name) + (m.level ? ' ' + m.level : '')).join(', ')}</div>` : ''}
      ${kills ? `<div class="dim small">${kills}</div>` : ''}</div>`;
  }

  V.runs = function () {
    const list = all();
    if (!list.length) return '<div class="empty">No dungeon runs yet. They start by themselves when you enter a dungeon or raid.</div>';
    return list.map(card).join('');
  };

  // for snapshot.json (js/claude.js)
  CC.runs = { all, fromJournal };
})();
