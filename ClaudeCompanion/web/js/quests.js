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

  // the game's SkillLine ids for professions (QuestieDB's requiredSkill uses them)
  const SKILL_LINE = { 129: 'First Aid', 164: 'Blacksmithing', 165: 'Leatherworking', 171: 'Alchemy', 182: 'Herbalism', 185: 'Cooking',
    186: 'Mining', 197: 'Tailoring', 202: 'Engineering', 333: 'Enchanting', 356: 'Fishing', 393: 'Skinning' };
  const snap = () => (A.CH && A.CH.snap) || {};
  const skillRank = (name) => { const r = arr(snap().skills).find((x) => x && x.name === name); return r ? (r.rank != null ? r.rank : 0) : null; };
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
    if (!r) return state().rep.size ? 0 : null;       // a faction you haven't met yet stands at Neutral (0)
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
    // the highest level any step still to do needs (a chain can start low and need more later)
    const need = Math.max(fq.min || 0, ...steps.map((x) => (pack(x) || {}).min || 0), q.min || 0);
    if (need > st.level) why.push({ kind: 'level', level: need });
    // a profession skill a step needs: no profession at all = not for you
    for (const x of steps) {
      const sk = (pack(x) || {}).skill;
      if (!Array.isArray(sk) || !sk[0]) continue;
      const prof = SKILL_LINE[sk[0]], have = prof ? skillRank(prof) : null;
      if (prof && have == null) return { id, state: 'no', why: [] };
      if (prof && have < (sk[1] || 0) && !why.some((w) => w.kind === 'skill')) why.push({ kind: 'skill', prof, skill: sk[1], have });
    }
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
  // Raid content: the quest itself is a raid quest (pack type Raid, set in a raid, a starting item that drops
  // in one, a raid quest sort), or an earlier step of its chain is set in a raid, done or not (Fang of
  // Korialstrasz needs C'Thun; Atiesh, Naxxramas). An earlier step's type Raid alone doesn't count: that
  // also marks group quests such as The Battle of Darrowshire and Upper Blackrock Spire, whose follow-ups
  // are pre-raid gear. Instance names: data/rules.js.
  const INST = (window.GAMERULES || {}).instances || {};
  const RAID_ZONES = new Set(arr(INST.raids)), RAID_SORTS = new Set(arr(INST.raidQuestSorts));
  const raidZone = (z) => !!z && RAID_ZONES.has(z);
  const inRaid = (q) => raidZone(q.cat) || RAID_SORTS.has(q.cat) || arr(q.starter_item).some((it) => arr(((A.GD && A.GD.src) || {})[it]).some((r) => raidZone(r[7])));
  let RAID = new Map(), RAID_GD = null;
  function raid(id) {
    id = Number(id);
    if (RAID_GD !== A.GD) { RAID = new Map(); RAID_GD = A.GD; }
    if (RAID.has(id)) return RAID.get(id);
    const q = pack(id);
    let yes = !!q && (q.type === 'Raid' || inRaid(q));
    if (q && !yes) {
      const seen = new Set([id]), todo = arr(q.prev).slice();
      while (todo.length && !yes) {
        const p = Number(todo.shift());
        if (seen.has(p)) continue;
        seen.add(p);
        const pq = pack(p);
        if (!pq) continue;
        if (inRaid(pq)) yes = true;
        else todo.push(...arr(pq.prev));
      }
    }
    RAID.set(id, yes);
    return yes;
  }
  CC.quests = { pack, isDone, inLog, forYou, repGap, chain, status, rewardQuests, rewardGone, raid, known: () => state().known };
})();
