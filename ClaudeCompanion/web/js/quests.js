// Claude Companion: which quests you can do, and how far a chain is from a goal.
// One owner for "is this quest open to you": the game-data pack (QuestieDB Forever: levels, faction, class,
// prerequisites, reputation needs) read against your save (completed quests, quest log, level, reputation).
// The Gear page uses it to leave out rewards you already took; the Now page to rank quests and chains.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api) return;
  const A = CC.api, arr = A.arr;
  // QuestieDB's class mask: one bit per class (classFile from the game)
  const CLASS_BIT = { WARRIOR: 1, PALADIN: 2, HUNTER: 4, ROGUE: 8, PRIEST: 16, SHAMAN: 64, MAGE: 128, WARLOCK: 256, DRUID: 1024 };
  const REP_FLOOR = ((window.GAMERULES || {}).repFloor) || [];
  const STANDING = ((window.GAMERULES || {}).standing) || [];

  const snap = () => (A.CH && A.CH.snap) || {};
  const pack = (id) => ((A.GD && A.GD.quests) || {})[id] || null;
  let memo = null;
  function state() {
    const s = snap(), done = arr(s.completedQuests);
    const key = (s.taken || 0) + '|' + done.length + '|' + arr(s.quests).length;
    if (memo && memo.key === key) return memo;
    const c = s.character || {};
    memo = {
      key, known: done.length > 0, done: new Set(done.map(Number)),
      log: new Map(arr(s.quests).filter((q) => q && q.id).map((q) => [Number(q.id), q])),
      level: c.level || 0, side: c.faction || '', bit: CLASS_BIT[c.classFile] || 0,
      rep: new Map(arr(s.reputation).filter((r) => r && r.name).map((r) => [r.name, r])),
    };
    return memo;
  }
  const isDone = (id) => state().done.has(Number(id));
  const inLog = (id) => state().log.get(Number(id)) || null;
  // the quest is for your faction and class (QuestieDB leaves both empty when anyone can take it)
  function forYou(id) {
    const q = pack(id), st = state();
    if (!q) return false;
    if (q.side && st.side && q.side !== st.side) return false;
    if (q.cls && st.bit && !(q.cls & st.bit)) return false;
    return true;
  }
  // your reputation with a faction, in QuestieDB's points (0 = the start of Neutral), from the game's own bar
  function repPoints(faction) {
    const r = state().rep.get(faction);
    if (!r) return null;
    if (r.currentStanding != null) return r.currentStanding;
    return r.reaction ? REP_FLOOR[r.reaction] : null;
  }
  // the reputation a quest needs that you don't have: { faction, need, standing, have } or null
  function repGap(id) {
    const rr = arr((pack(id) || {}).repReq)[0];
    if (!rr) return null;
    const have = repPoints(rr[0]);
    if (have != null && have >= rr[1]) return null;
    let st = 1;
    for (let i = 1; i < REP_FLOOR.length; i++) if (rr[1] >= REP_FLOOR[i]) st = i;
    return { faction: rr[0], need: rr[1], standing: STANDING[st] || '', have };
  }
  // The steps of a chain still to do, first to last, ending with `id`. QuestieDB keeps "every one of these"
  // and "any one of these" prerequisites in one list here, so a step counts as met when any of its
  // prerequisites for you is done (or in your log); otherwise the chain goes back through the first one for you.
  function chain(id, max) {
    const out = [], seen = new Set();
    let cur = Number(id);
    while (cur && !seen.has(cur) && out.length < (max || 40)) {
      seen.add(cur);
      if (isDone(cur)) break;
      out.unshift(cur);
      if (inLog(cur)) break;
      const prev = arr((pack(cur) || {}).prev).filter(forYou);
      if (!prev.length || prev.some((p) => isDone(p) || inLog(p))) break;
      cur = prev[0];
    }
    return out;
  }
  // Where a quest stands for you:
  //   done | ready (in your log, complete) | active (in your log) | open (you can take it now) |
  //   later (needs a level, earlier steps or reputation: see why) | no (not for your faction or class)
  function status(id) {
    id = Number(id);
    const q = pack(id), st = state();
    if (!q) return { id, state: 'unknown', why: [] };
    if (isDone(id)) return { id, state: 'done', why: [] };
    const lq = inLog(id);
    if (lq) return { id, state: lq.ready || lq.complete ? 'ready' : 'active', why: [], steps: [id] };
    if (!forYou(id)) return { id, state: 'no', why: [] };
    const steps = chain(id), why = [];
    const first = steps[0] != null ? steps[0] : id;
    const fq = pack(first) || q;
    if ((fq.min || 0) > st.level) why.push({ kind: 'level', level: fq.min });
    if (steps.length > 1) why.push({ kind: 'steps', first, count: steps.length - 1 });
    steps.forEach((s) => { const g = repGap(s); if (g && !why.some((w) => w.kind === 'rep' && w.faction === g.faction)) why.push(Object.assign({ kind: 'rep' }, g)); });
    return { id, state: why.length ? 'later' : 'open', why, steps, first };
  }
  // all quests that give an item (pack source rows), and whether any of them is still to do for you
  const rewardQuests = (itemId) => arr(((A.GD && A.GD.src) || {})[itemId]).filter((r) => r[0] === 'quest').map((r) => r[2]);
  function rewardGone(itemId) {
    const qs = rewardQuests(itemId);
    if (!qs.length || !state().known) return false;
    return qs.every((q) => isDone(q) || !forYou(q));
  }
  CC.quests = { pack, isDone, inLog, forYou, repGap, chain, status, rewardQuests, rewardGone, known: () => state().known };
})();
