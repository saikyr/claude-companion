// Claude Companion: the steps of a From Claude card, and what changed between two saves (#163).
// One engine, used by js/cards.js (the From Claude tab), js/claude.js (snapshot.json `cards[]`) and
// js/sync.js (the `claude_wake` record each new save sends, so Claude can see what happened in game):
//   - a step's game check (`doneWhen`, companion-data/SCHEMA.md): quest:<id>, item:<id>[x<n>],
//     rep:<faction>>=<standing>, level:<n>, skill:<profession>>=<n>, read against the character as saved
//   - which steps are done and who did it: you (a tick in the app), the game (its check passed, now or
//     on an earlier save), Claude (`stepsDone`); a step you unticked stays unticked
//   - the order the open cards show in, and where each stands in its plan
//   - a save's digest (quests done, items, level, reputation, the cards' steps) and the change between two
// Pure functions: no page, no network (test/web/cardsteps.test.js runs them in node).
(function (root) {
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]) : []);
  const STANDING = ['', 'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
  // the grammar, here and in tools/check-cards.py CHECK and the database gate (private.check_cards)
  const CHECK = /^(?:quest:([0-9]{1,9})|item:([0-9]{1,9})(?:x([0-9]{1,4}))?|rep:([^\n]+?)>=(Hated|Hostile|Unfriendly|Neutral|Friendly|Honored|Revered|Exalted)|level:([0-9]{1,2})|skill:([^\n]+?)>=([0-9]{1,3}))$/;

  function parse(s) {
    const m = CHECK.exec(String(s == null ? '' : s));
    if (!m) return null;
    if (m[1]) return { kind: 'quest', id: Number(m[1]) };
    if (m[2]) return { kind: 'item', id: Number(m[2]), count: m[3] ? Number(m[3]) : 1 };
    if (m[4]) return { kind: 'rep', faction: m[4], standing: STANDING.indexOf(m[5]) };
    if (m[6]) return { kind: 'level', level: Number(m[6]) };
    return { kind: 'skill', name: m[7], rank: Number(m[8]) };
  }

  // what the checks read, from the character as the app has it (CH: snap, bank)
  function contextOf(CH) {
    const s = (CH && CH.snap) || {}, items = new Map();
    const take = (x) => { const m = x && /item:(\d+)/.exec(x.item || x.link || ''); if (m) items.set(Number(m[1]), (items.get(Number(m[1])) || 0) + (x.count || 1)); };
    arr(s.bags).forEach((b) => arr(b && b.items).forEach(take));
    arr(((CH && CH.bank) || {}).bags).forEach((b) => arr(b && b.items).forEach(take));
    arr(s.equipped).forEach(take);
    const done = arr(s.completedQuests).map(Number).filter((n) => n > 0);
    return {
      t: s.taken || 0,
      name: (s.character || {}).name || null,
      level: (s.character || {}).level || 0,
      quests: new Set(done),
      questsKnown: done.length > 0,
      items,
      rep: new Map(arr(s.reputation).filter((r) => r && r.name && !r.isHeader).map((r) => [r.name, r.reaction || 0])),
      skills: new Map(arr(s.skills).filter((r) => r && r.name).map((r) => [r.name, r.rank || 0])),
    };
  }

  // true / false, or null when the save can't tell (no completed-quest list, a faction you haven't met)
  function met(check, ctx) {
    const c = typeof check === 'string' ? parse(check) : check;
    if (!c || !ctx) return null;
    if (c.kind === 'quest') return ctx.questsKnown ? ctx.quests.has(c.id) : null;
    if (c.kind === 'item') return (ctx.items.get(c.id) || 0) >= c.count;
    if (c.kind === 'rep') return ctx.rep.has(c.faction) ? ctx.rep.get(c.faction) >= c.standing : null;
    if (c.kind === 'level') return ctx.level ? ctx.level >= c.level : null;
    if (c.kind === 'skill') return ctx.skills.has(c.name) ? ctx.skills.get(c.name) >= c.rank : false;
    return null;
  }

  // a step's key: a hash of its text, then which time that text comes (js/cards.js has kept ticks this way since #150)
  function stepKeys(steps, hash) {
    const seen = {};
    return arr(steps).map((s) => { const t = String(s == null ? '' : s).trim(), k = hash ? hash(t) : t; seen[k] = (seen[k] || 0) + 1; return seen[k] > 1 ? `${k}#${seen[k]}` : k; });
  }

  // every step of a card: { done, by ('you' | 'game' | 'claude' | null), check, met }
  //   mine: Set of the positions you ticked (js/cards.js ticksOf); rec: your record in cardsState
  //   (unticked: keys you unticked, auto: keys the game's check passed on an earlier save)
  function stepsOf(card, mine, rec, ctx, hash) {
    const steps = arr(card && card.steps), keys = stepKeys(steps, hash), when = arr(card && card.doneWhen);
    const un = new Set(arr(rec && rec.unticked)), auto = new Set(arr(rec && rec.auto));
    const claude = new Set(arr(card && card.stepsDone).filter((i) => Number.isInteger(i)));
    return steps.map((_, i) => {
      const check = typeof when[i] === 'string' ? when[i] : null, now = check ? met(check, ctx) : null;
      const by = mine && mine.has(i) ? 'you' : now === true || auto.has(keys[i]) ? 'game' : claude.has(i) ? 'claude' : null;
      const done = by === 'you' || (!!by && !un.has(keys[i]));
      return { done, by: done ? by : null, check, met: now, key: keys[i] };
    });
  }

  // the open cards in the order Claude set: cards with `order` first (lowest first; a group sits where its
  // first card does), then the rest newest first. Each ordered card gets its place: 'start' (the first),
  // 'next' (the second), 'later' (after that); `of` = its place in its plan and the plan's size, counted over
  // `all` (the closed cards too, so "3 of 4" says how far the plan is), by order.
  const secs = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t / 1000; };
  function ordered(cards, all) {
    const list = arr(cards).slice(), groupAt = {};
    list.forEach((c) => { if (Number.isFinite(c.order) && c.group) groupAt[c.group] = Math.min(groupAt[c.group] == null ? Infinity : groupAt[c.group], c.order); });
    const rank = (c) => (Number.isFinite(c.order) ? [c.group ? groupAt[c.group] : c.order, c.order] : null);
    list.sort((a, b) => {
      const x = rank(a), y = rank(b);
      if (x && y) return x[0] - y[0] || String(a.group || '').localeCompare(String(b.group || '')) || x[1] - y[1];
      if (x || y) return x ? -1 : 1;
      return secs(b.updated || b.created) - secs(a.updated || a.created);
    });
    const plans = {};
    arr(all || cards).forEach((c) => { if (c && c.group) (plans[c.group] = plans[c.group] || []).push(c); });
    list.forEach((c) => { if (c.group && !(plans[c.group] || []).some((x) => x.id === c.id)) (plans[c.group] = plans[c.group] || []).push(c); });
    const byOrder = (a, b) => (Number.isFinite(a.order) ? a.order : Infinity) - (Number.isFinite(b.order) ? b.order : Infinity) || String(a.id).localeCompare(String(b.id));
    Object.values(plans).forEach((xs) => xs.sort(byOrder));
    let n = 0;
    return list.map((c) => {
      const has = Number.isFinite(c.order);
      const place = has ? (n === 0 ? 'start' : n === 1 ? 'next' : 'later') : null;
      if (has) n++;
      const of = c.group ? [plans[c.group].findIndex((x) => x.id === c.id) + 1, plans[c.group].length] : null;
      return { card: c, place, of };
    });
  }

  // ------------------------------------------------------------ what changed between two saves
  // a save's digest: small enough to keep in companion-data/sync.json between saves
  function digestOf(ctx, cards) {
    if (!ctx) return null;
    return {
      t: ctx.t, name: ctx.name, level: ctx.level,
      quests: ctx.questsKnown ? [...ctx.quests].sort((a, b) => a - b) : null,
      items: Object.fromEntries([...ctx.items].sort((a, b) => a[0] - b[0])),
      rep: Object.fromEntries([...ctx.rep]),
      // cards[] as js/claude.js puts them in the snapshot: id -> {standing, done (positions), you (the player's own
      // ticks), closedBy}
      cards: Object.fromEntries(arr(cards).map((c) => [c.id, { title: c.title, standing: c.standing, done: arr(c.steps).filter((s) => s.done).map((s) => s.i),
        you: arr(c.steps).filter((s) => s.done && s.by === 'you').map((s) => s.i), closedBy: c.closedBy || null }])),
    };
  }
  const CAP = 40;
  // the change from a to b (both digests of the same character), or null when nothing that matters changed.
  // names: (kind, id) -> a name for a quest or an item, or null
  function wakeOf(a, b, names) {
    if (!a || !b || a.name !== b.name || !(b.t > a.t)) return null;
    const nm = (k, id) => (names ? names(k, id) : null) || null;
    const out = { since: new Date(a.t * 1000).toISOString(), at: new Date(b.t * 1000).toISOString(), character: b.name };
    if (b.level !== a.level) out.level = { from: a.level, to: b.level };
    if (a.quests && b.quests) {
      const had = new Set(a.quests), got = b.quests.filter((q) => !had.has(q));
      if (got.length) out.questsDone = got.slice(0, CAP).map((id) => ({ id, title: nm('quest', id) }));
      if (got.length > CAP) out.questsDoneMore = got.length - CAP;
    }
    const gained = [], lost = [];
    new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})]).forEach((k) => {
      const x = (a.items || {})[k] || 0, y = (b.items || {})[k] || 0;
      if (y > x) gained.push({ id: Number(k), name: nm('item', Number(k)), from: x, to: y });
      else if (y < x) lost.push({ id: Number(k), name: nm('item', Number(k)), from: x, to: y });
    });
    if (gained.length) out.itemsGained = gained.slice(0, CAP);
    if (lost.length) out.itemsLost = lost.slice(0, CAP);
    const rep = Object.keys(b.rep || {}).filter((f) => (a.rep || {})[f] != null && b.rep[f] !== a.rep[f])
      .map((f) => ({ faction: f, from: STANDING[a.rep[f]] || a.rep[f], to: STANDING[b.rep[f]] || b.rep[f] }));
    if (rep.length) out.rep = rep;
    const cards = [];
    Object.entries(b.cards || {}).forEach(([id, c]) => {
      const p = (a.cards || {})[id];
      if (!p) return;
      const was = new Set(p.done), ticked = c.done.filter((i) => !was.has(i)), unticked = p.done.filter((i) => !c.done.includes(i));
      const closed = p.standing === 'open' && c.standing !== 'open' ? c.standing : null;
      // you: the player did it (a tick or untick of their own, or closed the card), not the game's check or Claude
      const you = ticked.some((i) => arr(c.you).includes(i)) || unticked.length > 0 || (closed && c.closedBy === 'you');
      if (ticked.length || unticked.length || closed) cards.push(Object.assign({ id, title: c.title }, ticked.length ? { ticked } : {}, unticked.length ? { unticked } : {}, closed ? { closed } : {}, you ? { you: true } : {}));
    });
    if (cards.length) out.cards = cards;
    return Object.keys(out).length > 3 ? out : null;
  }

  const api = { CHECK, STANDING, parse, contextOf, met, stepKeys, stepsOf, ordered, digestOf, wakeOf };
  if (typeof module !== 'undefined') module.exports = api;
  root.CCSteps = api;
})(typeof window !== 'undefined' ? window : globalThis);
