-- Journal (timeline of everything that happens) and play sessions
-- (time, zones, kills, loot, gold by source, XP).
local _, ns = ...
local Clean, Call = ns.Clean, ns.Call

local RESUME_SECONDS = 600 -- logged out for less than this = same session
-- A grind only carries over a /reload (Sync) or a quick relog after a disconnect. A real logout
-- ends it, and so does being away longer than GRIND_RESUME (a crash, or playing on the other
-- computer, whose saves this one never sees) or GRIND_IDLE with nothing counted.
local GRIND_RESUME = 120
local GRIND_IDLE = 30 * 60
local reloading = false -- set just before a /reload or Sync, so PLAYER_LOGOUT knows it isn't a logout
function ns.MarkReload() reloading = true end
pcall(hooksecurefunc, "ReloadUI", ns.MarkReload)
if C_UI and C_UI.Reload then pcall(hooksecurefunc, C_UI, "Reload", ns.MarkReload) end

-- "mac" or "pc": which computer this save belongs to (each keeps its own SavedVariables)
function ns.Device()
    local ok, mac = pcall(IsMacClient)
    return (ok and mac) and "mac" or "pc"
end

---------------------------------------------------------------- trackers
-- Two kinds of tracker share the same counters:
--   session: automatic, from login to logout (resumes after a short logout)
--   grind:   you start and stop it (/cc start, /cc stop); time logged out
--            or paused doesn't count.
local function NewTracker(name)
    local now = ns.Now()
    local money = Clean(GetMoney())
    local w = ns.Where()
    return { id = now, start = now, last = now, name = name, level = Clean(UnitLevel("player")),
        startZone = w.zone, startMoney = money, money = money, earned = 0, spent = 0, bySource = {},
        xp = 0, kills = 0, myKills = 0, killsBy = {}, loot = {}, lootCoin = 0, zones = {}, deaths = 0, quests = 0, pausedSecs = 0,
        rep = {}, disenchants = {} }
end

local function ActiveSecs(t)
    local now = t.finish or ns.Now()
    local secs = now - t.start - (t.pausedSecs or 0)
    if t.paused and t.pausedAt and not t.finish then secs = secs - (now - t.pausedAt) end
    return math.max(0, secs)
end
ns.ActiveSecs = ActiveSecs

-- apply fn to every tracker that is currently counting
local function Each(fn)
    local c = ns.char
    if not c then return end
    if not c.session then c.session = NewTracker() end
    c.session.last = ns.Now()
    fn(c.session)
    local g = c.grind
    if g and not g.paused then g.last = ns.Now(); fn(g) end
    local r = c.run
    if r and r.inside then r.last = ns.Now(); fn(r) end
end

function ns.EndSession()
    local c = ns.char
    local s = c and c.session
    if not s then return end
    s.finish = s.last
    s.secs = math.max(0, (s.last or s.start) - s.start)
    if s.kills > 0 or s.earned > 0 or s.spent > 0 or s.xp > 0 or next(s.loot) then
        ns.Push(c.sessions, s, ns.LIMITS.sessions)
    end
    c.session = nil
end

function ns.Session()
    local c = ns.char
    if not c then return nil end
    if not c.session then c.session = NewTracker() end
    return c.session
end

-- value of the items looted: vendor price, and AH price where you've seen one
-- what an item really sells for: median of the newest full AH scan,
-- else the lowest price seen while browsing; nil = never priced
function ns.PlanPrice(id)
    local p = ns.char and ns.char.ah and ns.char.ah.prices and ns.char.ah.prices[tostring(id)]
    if not p or type(p.obs) ~= "table" then return nil end
    for i = #p.obs, 1, -1 do
        local o = p.obs[i]
        if o.src == "scan" then return o.qty and o.qty > 0 and (o.med or o.min) or nil end
    end
    local o = p.obs[#p.obs]
    return o and o.min
end

function ns.LootValue(t)
    local vendor, ah = 0, 0
    local prices = ns.char and ns.char.ah and ns.char.ah.prices or {}
    for id, l in pairs(t.loot or {}) do
        local item = l.item and ClaudeCompanionDB.items[l.item]
        local sell = item and item.sell or 0
        vendor = vendor + sell * l.count
        ah = ah + (ns.PlanPrice(l.id or id) or sell) * l.count
    end
    return vendor, ah
end

function ns.TrackerLine(t)
    local secs = math.max(1, ActiveSecs(t))
    local hrs = secs / 3600
    local coin = (t.bySource and t.bySource.loot) or 0
    local vendor, ah = ns.LootValue(t)
    return string.format("%s%d min | loot gold %s + items %s = %s/hr | %d kills (%d/hr) | %d XP/hr",
        t.name and (t.name .. " | ") or "", math.floor(secs / 60), ns.Money(coin), ns.Money(ah),
        ns.Money(math.floor((coin + ah) / hrs)), t.kills, math.floor(t.kills / hrs), math.floor(t.xp / hrs))
end
function ns.SessionLine() return ns.TrackerLine(ns.Session()) end

---------------------------------------------------------------- grind (start / stop)
function ns.GrindStart(name)
    local c = ns.char
    if not c then return end
    if c.grind then ns.GrindStop(true) end
    local w = ns.Where()
    c.grind = NewTracker(name and name ~= "" and name or w.sub or w.zone or "Grind")
    c.grind.device = ns.Device()
    -- the items you farm here last time (/cc target) are targets again
    local saved = c.grindTargets and c.grindTargets[c.grind.name:lower()]
    if saved and #saved > 0 then
        c.grind.targets = {}
        for i, t in ipairs(saved) do c.grind.targets[i] = { id = t.id, name = t.name, link = t.link } end
    end
    ns.Log("grindStart", { name = c.grind.name, device = c.grind.device })
    if ns.GrindPanel then ns.GrindPanel() end
    return c.grind
end

-- at: when it resumed (default now); quiet: no journal entry
local function Unpause(g, at)
    at = at or ns.Now()
    g.pausedSecs = (g.pausedSecs or 0) + math.max(0, at - (g.pausedAt or at))
    g.paused, g.pausedAt = nil, nil
end

function ns.GrindPause()
    local g = ns.char and ns.char.grind
    if not g then return end
    if g.paused then
        local secs = ns.Now() - (g.pausedAt or ns.Now())
        Unpause(g)
        ns.Log("grindResume", { name = g.name, secs = secs })
        ns.Print("grind resumed: |cffffd100" .. (g.name or "Grind") .. "|r.")
    else
        g.paused, g.pausedAt = true, ns.Now()
        ns.Log("grindPause", { name = g.name })
        ns.Print("grind |cffff6060paused|r: kills and loot aren't counted. Shift-click the panel or /cc pause to resume.")
    end
    if ns.GrindPanel then ns.GrindPanel() end
    return g.paused == true
end

-- quiet: no chat summary. at: when it really ended (default now; an idle or stale grind ends at
-- its last counted event, so the time away doesn't count). why: "logout", "away", "idle" when
-- the addon ended it, nil when you did.
function ns.GrindStop(quiet, at, why)
    local c = ns.char
    local g = c and c.grind
    if not g then return nil end
    at = at or ns.Now()
    if g.paused then Unpause(g, math.max(at, g.pausedAt or at)) end
    g.finish = at
    g.ended = why
    g.secs = ActiveSecs(g)
    g.vendorValue, g.ahValue = ns.LootValue(g)
    g.coin = (g.bySource and g.bySource.loot) or 0
    for _, t in ipairs(g.targets or {}) do ns.TargetStats(g, t) end
    c.grinds = c.grinds or {}
    ns.Push(c.grinds, g, ns.LIMITS.sessions)
    c.grind = nil
    ns.Log("grindStop", { name = g.name, secs = g.secs, kills = g.kills, coin = g.coin, ah = g.ahValue, ended = why, at = at })
    -- a stop you made (or the addon's, when idle) leaves the summary on the panel
    if ns.GrindPanel then ns.GrindPanel((not quiet or why == "idle") and g or nil) end
    if not quiet then ns.GrindReport(g) end
    return g
end

---------------------------------------------------------------- targets (/cc target <item>)
-- Items you farm for. Each shows on the panel with how many dropped and how many the kills so far
-- should have given: the drop chance ForeverDB measured on Forever kills (Drops.lua; never a
-- Classic rate) times your kills of each creature that drops it. No Forever rate: "rate unknown",
-- and only your own count. Kept per grind name, so the next /cc start with that name has them again.
function ns.ItemFromText(text)
    text = strtrim(text or "")
    if text == "" then return nil end
    local id = tonumber(text:match("item:(%d+)")) or tonumber(text:match("^(%d+)$"))
    local link = text:match("(|c%x+|Hitem:.-|h|r)") or text:match("(|Hitem:.-|h)")
    local name = link and link:match("%[(.-)%]")
    if id then
        name = name or ns.Clean(ns.Call(C_Item and C_Item.GetItemNameByID, id))
        return id, name or ("item " .. id), link
    end
    -- a typed name: an item this computer has seen, else one the game knows
    local want = text:gsub("^%[", ""):gsub("%]$", ""):lower()
    for _, e in pairs(ClaudeCompanionDB.items or {}) do
        if e.id and e.name and e.name:lower() == want then return e.id, e.name, e.link end
    end
    local GetInfo = (C_Item and C_Item.GetItemInfo) or GetItemInfo
    local n, l = ns.Call(GetInfo, want)
    l = ns.Clean(l)
    id = l and tonumber(l:match("item:(%d+)"))
    if id then return id, ns.Clean(n) or want, l end
end

-- adds the item to the running grind's targets, or takes it off if it is one. Returns true when
-- added, false when removed, nil (and why) when it can't.
function ns.GrindTarget(text)
    local c = ns.char
    local g = c and c.grind
    if not g then return nil, "start a grind first: /cc start <name>" end
    local id, name, link = ns.ItemFromText(text)
    if not id then return nil, "shift-click the item into the command, e.g. /cc target [Pattern: Cindercloth Cloak]" end
    g.targets = g.targets or {}
    local added = true
    for i, t in ipairs(g.targets) do
        if t.id == id then table.remove(g.targets, i); added = false; break end
    end
    if added then
        if #g.targets >= 3 then return nil, "three targets at most: /cc target an item again to take it off" end
        g.targets[#g.targets + 1] = { id = id, name = name, link = link }
    end
    c.grindTargets = c.grindTargets or {}
    local keep = {}
    for i, t in ipairs(g.targets) do keep[i] = { id = t.id, name = t.name, link = t.link } end
    c.grindTargets[(g.name or "grind"):lower()] = keep
    ns.Log(added and "grindTarget" or "grindUntarget", { name = g.name, id = id, item = name })
    if ns.GrindPanel then ns.GrindPanel() end
    return added, name
end

-- got: how many dropped. expected: what your kills should have given, from Forever-measured chances
-- only; nil when there is no Forever rate for it (rated = false), when you killed nothing that drops
-- it, or when Drops.lua isn't loaded (it needs a game restart after the update that added it).
-- none: the chance of no drop at all after these kills. sample: the fewest Forever kills behind a
-- chance used. kills: kills of the creatures that drop it; with no rate, every kill of the grind.
function ns.TargetStats(g, t)
    local l = g.loot and g.loot[tostring(t.id)]
    t.got = l and l.count or 0
    local rows = ns.DROPS and ns.DROPS[t.id]
    t.expected, t.none, t.sample, t.rated, t.kills = nil, nil, nil, rows ~= nil, 0
    t.forever = nil -- older builds' Classic/Forever flag: only Forever rates are used now
    if rows then
        local exp, none, sample = 0, 1, nil
        for i = 1, #rows, 3 do
            local k = g.killsBy and g.killsBy[rows[i]]
            if k and k > 0 then
                local p = rows[i + 1] / 100
                exp = exp + k * p
                none = none * (1 - math.min(p, 1)) ^ k
                t.kills = t.kills + k
                sample = math.min(sample or rows[i + 2], rows[i + 2])
            end
        end
        if t.kills > 0 then t.expected, t.none, t.sample = exp, none, sample end
    else
        t.kills = g.kills or 0
    end
    return t
end

-- your own rate: got in kills, with a 95% range (Wilson), as drops per 100 kills
function ns.OwnRange(got, kills)
    if not kills or kills <= 0 then return nil end
    local z, n, p = 1.96, kills, math.min(1, got / kills) -- stacks and chests can give more than one per kill
    local d = 1 + z * z / n
    local mid = (p + z * z / (2 * n)) / d
    local half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p * 100, math.max(0, mid - half) * 100, math.min(1, mid + half) * 100
end

function ns.GrindReport(g)
    local hrs = math.max(1, g.secs or ActiveSecs(g)) / 3600
    local total = (g.coin or 0) + (g.ahValue or 0)
    ns.Print(string.format("|cffffd100%s|r finished: %d min, %d kills (%d/hr).", g.name or "Grind",
        math.floor((g.secs or 0) / 60), g.kills, math.floor(g.kills / hrs)))
    ns.Print(string.format("Gold looted %s, items worth %s (vendor %s). Total %s = |cffffd100%s/hr|r.",
        ns.Money(g.coin or 0), ns.Money(g.ahValue or 0), ns.Money(g.vendorValue or 0), ns.Money(total), ns.Money(math.floor(total / hrs))))
    local best = {}
    for _, l in pairs(g.loot) do best[#best + 1] = l end
    table.sort(best, function(a, b) return (a.q or 0) > (b.q or 0) or ((a.q or 0) == (b.q or 0) and a.count > b.count) end)
    local parts = {}
    for i = 1, math.min(5, #best) do parts[#parts + 1] = (best[i].link or best[i].name or "?") .. "x" .. best[i].count end
    if #parts > 0 then ns.Print("Drops: " .. table.concat(parts, ", ")) end
    for _, t in ipairs(g.targets or {}) do
        ns.Print(string.format("Target %s: %d dropped%s.", t.link or t.name or "?", t.got or 0,
            t.expected and string.format(", %.2f expected from %d kills (Forever rate)", t.expected, t.kills) or (t.rated and ", nothing you killed drops it" or ", Forever rate unknown")))
    end
end

---------------------------------------------------------------- money, with where it came from
local open = {}  -- which money windows are open right now
local recent = {} -- [kind] = GetTime() of a recent money-related event
local function Mark(kind) recent[kind] = GetTime() end
for ev, kind in pairs({ MERCHANT_SHOW = "vendor", AUCTION_HOUSE_SHOW = "ah", MAIL_SHOW = "mail", TRADE_SHOW = "trade",
    TRAINER_SHOW = "trainer", TAXIMAP_OPENED = "flight", LOOT_OPENED = "loot", BANKFRAME_OPENED = "bank",
    GOSSIP_SHOW = "npc", QUEST_DETAIL = "quest", QUEST_COMPLETE = "quest" }) do
    ns.On(ev, function() open[kind] = true; Mark(kind) end)
end
for ev, kind in pairs({ MERCHANT_CLOSED = "vendor", AUCTION_HOUSE_CLOSED = "ah", MAIL_CLOSED = "mail", TRADE_CLOSED = "trade",
    TRAINER_CLOSED = "trainer", TAXIMAP_CLOSED = "flight", LOOT_CLOSED = "loot", BANKFRAME_CLOSED = "bank",
    GOSSIP_CLOSED = "npc", QUEST_FINISHED = "quest" }) do
    ns.On(ev, function() open[kind] = nil; Mark(kind) end)
end

-- Newer clients open most NPC windows through one event with a type.
local PIM_KIND = { Merchant = "vendor", Auctioneer = "ah", MailInfo = "mail", TradePartner = "trade", Trainer = "trainer",
    TaxiNode = "flight", Banker = "bank", CharacterBanker = "bank", AccountBanker = "bank", Gossip = "npc" }
function ns.InteractionKind(kind)
    local T = Enum and Enum.PlayerInteractionType
    if type(T) ~= "table" then return nil end
    for name, v in pairs(T) do if v == kind then return name end end
end
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", function(t)
    local k = PIM_KIND[ns.InteractionKind(Clean(t)) or ""]
    if k then open[k] = true; Mark(k) end
end)
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", function(t)
    local k = PIM_KIND[ns.InteractionKind(Clean(t)) or ""]
    if k then open[k] = nil; Mark(k) end
end)

local ORDER = { "loot", "vendor", "ah", "mail", "trade", "trainer", "flight", "quest", "bank", "npc" }
local function MoneySource()
    for _, k in ipairs(ORDER) do if open[k] and k ~= "quest" and k ~= "npc" then return k end end
    if recent.questTurnIn and GetTime() - recent.questTurnIn < 3 then return "quest" end
    for _, k in ipairs(ORDER) do if open[k] then return k end end
    for _, k in ipairs(ORDER) do if recent[k] and GetTime() - recent[k] < 2 then return k end end
    return "other"
end

local lastMoney
ns.OnLogin(function() lastMoney = Clean(GetMoney()) end)
ns.On("PLAYER_MONEY", function()
    if not ns.char then return end
    local m = Clean(GetMoney())
    if not m or not lastMoney then lastMoney = m; return end
    local delta = m - lastMoney
    lastMoney = m
    if delta == 0 then return end
    local src = MoneySource()
    if src == "other" and recent.coinMsg and GetTime() - recent.coinMsg < 2 then src = "loot" end
    Each(function(s)
        s.money = m
        if delta > 0 then s.earned = s.earned + delta else s.spent = s.spent - delta end
        s.bySource[src] = (s.bySource[src] or 0) + delta
    end)
    local e = ns.Log("money", { amount = delta, source = src, balance = m })
    if src == "other" and delta > 0 then ns.lastOtherMoney = { t = GetTime(), delta = delta, entry = e } end
end)

-- party loot shares ("Your share of the loot is ...") often arrive with no
-- loot window open: when the chat line comes right after an unexplained
-- gain, that gain was loot.
function ns.ReclassifyCoin()
    recent.coinMsg = GetTime()
    local o = ns.lastOtherMoney
    if not o or GetTime() - o.t > 2 then return end
    ns.lastOtherMoney = nil
    if type(o.entry) == "table" then o.entry.source = "loot" end
    Each(function(s)
        s.bySource.other = (s.bySource.other or 0) - o.delta
        if s.bySource.other == 0 then s.bySource.other = nil end
        s.bySource.loot = (s.bySource.loot or 0) + o.delta
    end)
end

---------------------------------------------------------------- loot / craft / receive
local function Pattern(fmt)
    if type(fmt) ~= "string" then return nil end
    local p = fmt:gsub("([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
    p = p:gsub("%%s", "(.+)")
    p = p:gsub("%%d", "(%%d+)")
    return "^" .. p .. "$"
end
-- multiples first so "x5" isn't swallowed into the item name
local LOOT = {
    { Pattern(LOOT_ITEM_SELF_MULTIPLE), "loot" }, { Pattern(LOOT_ITEM_SELF), "loot" },
    { Pattern(LOOT_ITEM_PUSHED_SELF_MULTIPLE), "receive" }, { Pattern(LOOT_ITEM_PUSHED_SELF), "receive" },
    { Pattern(LOOT_ITEM_CREATED_SELF_MULTIPLE), "craft" }, { Pattern(LOOT_ITEM_CREATED_SELF), "craft" },
    { Pattern(LOOT_ITEM_BONUS_ROLL_SELF_MULTIPLE), "loot" }, { Pattern(LOOT_ITEM_BONUS_ROLL_SELF), "loot" },
}

ns.On("CHAT_MSG_LOOT", function(text)
    text = Clean(text)
    if not text or not ns.char then return end
    for _, p in ipairs(LOOT) do
        if p[1] then
            local link, n = text:match(p[1])
            if link then
                n = tonumber(n) or 1
                local key = ns.NoteItem(link)
                local item = key and ClaudeCompanionDB.items[key]
                local origin = p[2] == "receive" and ns.MailOrigin and ns.MailOrigin(link) or nil
                ns.Log(p[2], { link = link, item = key, count = n, q = item and item.q, mail = origin })
                local de = ns.dePending and GetTime() < ns.dePending.untilT and p[2] == "loot" and ns.dePending
                if de then
                    ns.RecordDisenchant(de, link, key, item, n)
                elseif p[2] == "loot" then
                    local itemID = item and item.id or tonumber(link:match("item:(%d+)"))
                    local id = itemID and tostring(itemID) or link
                    Each(function(s)
                        local l = s.loot[id] or { id = itemID, item = key, link = link, name = item and item.name or link:match("%[(.-)%]"),
                            q = item and item.q, count = 0 }
                        l.count = l.count + n
                        s.loot[id] = l
                    end)
                end
                return
            end
        end
    end
    ns.GroupLoot(text)
end)

-- Loot that went to someone else in the group, and the rolls for it, so "did the Scepter drop
-- for someone else?" has an answer. Greens and better (and anything whose quality is unknown).
-- Kept in the journal ("groupLoot", "roll") and in the dungeon run (run.groupLoot[]).
local OTHER, rolls = nil, {}
local function QualityOf(link) return tonumber(link:match("|cnIQ(%d)")) or (ns.QualityFromColor and ns.QualityFromColor(link)) end
function ns.GroupLoot(text)
    local FP = ns.FormatPattern
    if not FP then return end
    if not OTHER then
        OTHER = {}
        local function add(fmt, kind, order) if fmt then OTHER[#OTHER + 1] = { FP(fmt) .. "$", kind, order } end end
        add(LOOT_ROLL_YOU_WON or "You won: %s", "youWon", "l")
        add(LOOT_ROLL_WON or "%s won: %s", "won", "wl")
        add(LOOT_ITEM_MULTIPLE or "%s receives loot: %sx%d.", "loot", "wl")
        add(LOOT_ITEM or "%s receives loot: %s.", "loot", "wl")
        add(LOOT_ITEM_PUSHED or "%s receives item: %s.", "loot", "wl")
        add(LOOT_ROLL_ROLLED_NEED or "Need Roll - %d for %s by %s", "need", "lw")
        add(LOOT_ROLL_ROLLED_GREED or "Greed Roll - %d for %s by %s", "greed", "lw")
        add(LOOT_ROLL_NEED or "%s has selected Need for: %s", "needPick", "wl")
        add(LOOT_ROLL_GREED or "%s has selected Greed for: %s", "greedPick", "wl")
        add(LOOT_ROLL_PASSED or "%s passed on: %s", "pass", "wl")
        add(LOOT_ROLL_PASSED_AUTO or "%s automatically passed on: %s because he cannot loot that item.", "pass", "wl")
    end
    for _, p in ipairs(OTHER) do
        local a, b = text:match(p[1])
        if a then
            local who, link
            if p[3] == "l" then link, who = a, UnitName("player") elseif p[3] == "lw" then link, who = a, b else who, link = a, b end
            if not link or not link:find("|H") then return end
            local q = QualityOf(link)
            if q and q < 2 then return end
            local key = ns.NoteItem(link)
            local name = link:match("%[(.-)%]")
            local kind = p[2]
            if kind == "need" or kind == "greed" then
                local n = tonumber(text:match("(%d+)"))
                rolls[name] = rolls[name] or {}
                rolls[name][who] = { kind, n }
                return
            elseif kind == "needPick" or kind == "greedPick" or kind == "pass" then
                rolls[name] = rolls[name] or {}
                if not rolls[name][who] then rolls[name][who] = { kind == "pass" and "pass" or (kind == "needPick" and "need" or "greed") } end
                return
            end
            local won = kind == "won" or kind == "youWon"
            if kind == "loot" and who == UnitName("player") then return end -- own loot is counted above
            local list = {}
            for w, r in pairs(rolls[name] or {}) do list[#list + 1] = { who = w, choice = r[1], roll = r[2] } end
            rolls[name] = nil
            local e = { who = who, link = link, item = key, q = q, how = won and "won" or "loot", rolls = #list > 0 and list or nil }
            ns.Log("groupLoot", e)
            local r = ns.char and ns.char.run
            if r and r.inside then
                r.groupLoot = r.groupLoot or {}
                r.groupLoot[#r.groupLoot + 1] = { t = ns.Now(), who = who, item = key, link = link, q = q, how = e.how, rolls = e.rolls }
            end
            return
        end
    end
end

ns.On("CHAT_MSG_MONEY", function(text)
    text = Clean(text)
    if not text or not ns.char then return end
    -- "You loot 1 Gold 5 Silver" (also share messages); amount comes from PLAYER_MONEY
    ns.Log("coin", { text = text })
    ns.ReclassifyCoin()
    local g = tonumber(text:match("(%d+) " .. (GOLD_AMOUNT and GOLD_AMOUNT:gsub("%%d ", "") or "Gold"))) or 0
    local sv = tonumber(text:match("(%d+) " .. (SILVER_AMOUNT and SILVER_AMOUNT:gsub("%%d ", "") or "Silver"))) or 0
    local cp = tonumber(text:match("(%d+) " .. (COPPER_AMOUNT and COPPER_AMOUNT:gsub("%%d ", "") or "Copper"))) or 0
    Each(function(s) s.lootCoin = s.lootCoin + g * 10000 + sv * 100 + cp end)
end)

---------------------------------------------------------------- kills
-- Remember names/levels of units we see, since a kill only gives a GUID.
local seen = {}
local npcNames = {}   -- [npc id] = the name last seen for it, for a corpse that was never targeted (area loot)
local function Remember(unit)
    local guid = Clean(UnitGUID(unit))
    if not guid or UnitIsPlayer(unit) then return end
    seen[guid] = { name = Clean(UnitName(unit)), level = Clean(UnitLevel(unit)),
        class = Clean(Call(UnitClassification, unit)), type = Clean(Call(UnitCreatureType, unit)) }
    local id = guid and select(6, strsplit("-", guid))
    if id and seen[guid].name then npcNames[tonumber(id) or id] = seen[guid].name end
end
ns.On("PLAYER_TARGET_CHANGED", function() Remember("target") end)
ns.On("UPDATE_MOUSEOVER_UNIT", function() Remember("mouseover") end)
ns.On("NAME_PLATE_UNIT_ADDED", function(unit) Remember(unit) end)

local function NpcID(guid)
    if type(guid) ~= "string" then return nil end
    local kind, _, _, _, _, id = strsplit("-", guid)
    if kind == "Creature" or kind == "Vehicle" then return tonumber(id) end
end

-- GUIDs of everyone in the group (and their pets), so dungeon kills count
local groupGUIDs = {}
local function RefreshGroupGUIDs()
    groupGUIDs = {}
    local function add(u) local g = Clean(UnitGUID(u)); if g then groupGUIDs[g] = true end end
    if IsInRaid and Call(IsInRaid) then
        for i = 1, 40 do add("raid" .. i); add("raidpet" .. i) end
    else
        for i = 1, 4 do add("party" .. i); add("partypet" .. i) end
    end
end
ns.On("GROUP_ROSTER_UPDATE", RefreshGroupGUIDs)
ns.On("UNIT_PET", RefreshGroupGUIDs)
ns.OnLogin(RefreshGroupGUIDs)

local lastKill = {}
local recentKill = {} -- [name] = GetTime() of the last kill counted by name, so the XP line doesn't count it twice
local function Count(name, mine, fields)
    recentKill[name] = GetTime()
    Each(function(s)
        s.kills = s.kills + 1
        if mine then s.myKills = (s.myKills or 0) + 1 end
        s.killsBy[name] = (s.killsBy[name] or 0) + 1
    end)
    fields.name = name
    fields.instance = Clean(select(2, Call(IsInInstance)))
    ns.Log("kill", fields)
end
local function Kill(target, mine)
    target = Clean(target)
    if not target or lastKill[target] then return end
    lastKill[target] = true
    local info = seen[target] or {}
    local id = NpcID(target)
    Count(info.name or (id and npcNames[id]) or ("npc " .. tostring(id or "?")), mine,
        { npc = id, level = info.level, class = info.class, by = mine and "me" or "group" })
end
-- "Scarlet Monk dies, you gain 120 experience." Counted only when no kill event came for that name
-- in the last 2 seconds: inside instances the kill event's GUIDs read as secret, so this is often
-- the only sign of a kill. Kills that give no XP (level 60, grey mobs) aren't seen this way.
-- a game format string ("%s dies, you gain %d experience.") as a Lua pattern
local function FormatPattern(fmt)
    local p = fmt:gsub("%%%d?%$?([sd])", "\001%1")
    p = p:gsub("([%(%)%.%+%-%*%?%[%]%^%$%%])", "%%%1")
    p = p:gsub("\001s", "(.-)"):gsub("\001d", "%%d+")
    return "^" .. p
end
ns.FormatPattern = FormatPattern
local XP_KILL = FormatPattern(COMBATLOG_XPGAIN_FIRSTPERSON or "%s dies, you gain %d experience.")
ns.On("CHAT_MSG_COMBAT_XP_GAIN", function(text)
    text = Clean(text)
    if not text or not ns.char then return end
    local name = text:match(XP_KILL)
    if not name or name == "" then return end
    local t = recentKill[name]
    if t and GetTime() - t < 2 then return end
    Count(name, nil, { by = "xp" })
end)

ns.On("PARTY_KILL", function(attacker, target)
    attacker = Clean(attacker)
    local me, pet = Clean(UnitGUID("player")), Clean(UnitGUID("pet"))
    if not attacker then return end
    if attacker == me or (pet and attacker == pet) then Kill(target, true)
    elseif groupGUIDs[attacker] then Kill(target, false) end
end)
-- Classic-style fallback: "X dies." while we were fighting it
ns.On("CHAT_MSG_COMBAT_HOSTILE_DEATH", function(text)
    text = Clean(text)
    if not text or not ns.char then return end
    local tgt = Clean(UnitGUID("target"))
    local name = Clean(UnitName("target"))
    if tgt and name and text:find(name, 1, true) and Clean(UnitIsDead("target")) and not Clean(Call(UnitIsTapDenied, "target")) then
        seen[tgt] = seen[tgt] or { name = name, level = Clean(UnitLevel("target")) }
        Kill(tgt, true)
    end
end)

---------------------------------------------------------------- loot by corpse
-- With a loot window open, GetLootSourceInfo(slot) names the corpse (GUID) each slot came from, and
-- how many. Each corpse counts once (opened again, skinned later, or several at once with area loot),
-- so a tracker learns what each creature dropped and how many of its corpses were opened:
--   lootBy[name] = { npc = id, corpses = n, items = { ["<itemID>"] = count } }
-- A drop counts when the window shows it, taken or not. A corpse with nothing on it opens no window,
-- so the app gives a creature's own rate between drops per kill (killsBy) and drops per opened corpse.
-- Nothing is recorded when the GUID is secret or missing (caps.loot says which).
local opened, openedN = {}, 0
local function LootSources()
    if type(GetLootSourceInfo) ~= "function" or not ns.char then return end
    local n = Clean(Call(GetNumLootItems)) or 0
    local fresh, order = {}, {}   -- corpses not counted before: [guid] = { name, npc, items }
    for i = 1, n do
        local link = Clean(Call(GetLootSlotLink, i))
        local itemID = type(link) == "string" and tonumber(link:match("item:(%d+)")) or nil
        local src = { pcall(GetLootSourceInfo, i) }
        if src[1] then
            for j = 2, table.maxn(src), 2 do
                local guid = Clean(src[j])
                local npc = NpcID(guid)
                if npc and not opened[guid] then
                    local f = fresh[guid]
                    if not f then
                        local info = seen[guid] or {}
                        f = { name = info.name or npcNames[npc] or ("npc " .. npc), npc = npc, items = {} }
                        fresh[guid] = f; order[#order + 1] = guid
                    end
                    if itemID then f.items[tostring(itemID)] = (f.items[tostring(itemID)] or 0) + (tonumber(Clean(src[j + 1])) or 1) end
                end
            end
        end
    end
    for _, guid in ipairs(order) do
        local f = fresh[guid]
        opened[guid] = true; openedN = openedN + 1
        Each(function(s)
            s.lootBy = s.lootBy or {}
            local b = s.lootBy[f.name] or { npc = f.npc, corpses = 0, items = {} }
            b.corpses = b.corpses + 1
            for id, q in pairs(f.items) do b.items[id] = (b.items[id] or 0) + q end
            s.lootBy[f.name] = b
        end)
    end
    if openedN > 5000 then opened, openedN = {}, 0 end   -- a long session: forget old corpses (they despawned long ago)
end
ns.On("LOOT_OPENED", function() ns.Try("lootBy", LootSources) end)

---------------------------------------------------------------- xp and level
local lastXP, lastMax
ns.OnLogin(function() lastXP, lastMax = Clean(UnitXP("player")), Clean(UnitXPMax("player")) end)
ns.On("PLAYER_XP_UPDATE", function()
    if not ns.char then return end
    local xp, max = Clean(UnitXP("player")), Clean(UnitXPMax("player"))
    if not xp or not lastXP then lastXP, lastMax = xp, max; return end
    local gain = xp - lastXP
    if gain < 0 and lastMax then gain = (lastMax - lastXP) + xp end
    lastXP, lastMax = xp, max
    if gain > 0 then
        Each(function(s) s.xp = s.xp + gain end)
        ns.Log("xp", { amount = gain, xp = xp, max = max })
    end
end)
ns.On("PLAYER_LEVEL_UP", function(level)
    ns.Log("level", { level = Clean(level) })
    C_Timer.After(3, function() ns.Try("snap:levelup", ns.Snapshot, "levelup") end)
end)

---------------------------------------------------------------- quests
local function QuestTitle(id)
    return C_QuestLog and Clean(Call(C_QuestLog.GetTitleForQuestID, id))
end
local turnedIn = {}
ns.On("QUEST_ACCEPTED", function(a, b)
    -- modern clients pass (questID); classic passes (logIndex, questID)
    local id = Clean(b) or Clean(a)
    if not id then return end
    ns.Log("questAccept", { quest = id, title = QuestTitle(id) })
end)
ns.On("QUEST_TURNED_IN", function(id, xp, money)
    id = Clean(id)
    recent.questTurnIn = GetTime()
    if id then turnedIn[id] = true end
    Each(function(s) s.quests = s.quests + 1 end)
    ns.Log("questDone", { quest = id, title = id and QuestTitle(id), xp = Clean(xp), money = Clean(money) })
end)
ns.On("QUEST_REMOVED", function(id)
    id = Clean(id)
    if not id then return end
    C_Timer.After(1, function()
        if not turnedIn[id] then ns.Log("questDrop", { quest = id }) end
    end)
end)

---------------------------------------------------------------- world events
local lastZone
ns.On("ZONE_CHANGED_NEW_AREA", function()
    if not ns.char then return end
    local z = Clean(GetRealZoneText())
    if z and z ~= lastZone then
        lastZone = z
        Each(function(s) s.zones[z] = (s.zones[z] or 0) + 1 end)
        ns.Log("zone", { to = z, instance = Clean(select(2, Call(IsInInstance))) })
    end
end)
ns.On("PLAYER_DEAD", function()
    Each(function(s) s.deaths = s.deaths + 1 end)
    ns.Log("death", {})
end)
ns.On("PLAYER_EQUIPMENT_CHANGED", function(slot)
    slot = Clean(slot)
    if not slot or not ns.char then return end
    local link = Clean(Call(GetInventoryItemLink, "player", slot))
    ns.Log("equip", { slot = slot, slotName = ns.SLOT_NAMES and ns.SLOT_NAMES[slot], link = link, item = ns.NoteItem(link) })
end)
ns.On("CHAT_MSG_SKILL", function(text) text = Clean(text); if text then ns.Log("skill", { text = text }) end end)
local REP_UP = Pattern(FACTION_STANDING_INCREASED)
local REP_DOWN = Pattern(FACTION_STANDING_DECREASED)
ns.On("CHAT_MSG_COMBAT_FACTION_CHANGE", function(text)
    text = Clean(text)
    if not text then return end
    local faction, n, sign = nil, nil, 1
    if REP_UP then faction, n = text:match(REP_UP) end
    if not faction and REP_DOWN then faction, n = text:match(REP_DOWN); sign = -1 end
    n = tonumber(n)
    if faction and n then
        Each(function(s) s.rep = s.rep or {}; s.rep[faction] = (s.rep[faction] or 0) + sign * n end)
    end
    ns.Log("rep", { text = text, faction = faction, change = n and sign * n })
end)

---------------------------------------------------------------- disenchanting
-- Disenchant is cast on a bag item; while the cast runs that item is
-- locked, which tells us what is being disenchanted. The loot that
-- follows is the result. Results are kept per item (in the grind and in
-- c.deResults), so we learn what each kind of item really gives here.
local DE_SPELL = 13262
local function IsDisenchant(spellID)
    if spellID == DE_SPELL then return true end
    local name = spellID and Clean(Call(C_Spell and C_Spell.GetSpellName or GetSpellInfo, spellID))
    return name == "Disenchant"
end
local function LockedBagItem()
    local CI = C_Container or {}
    for bag = 0, (NUM_BAG_SLOTS or 4) + 1 do
        for slot = 1, Clean(Call(CI.GetContainerNumSlots or GetContainerNumSlots, bag)) or 0 do
            local info = Call(CI.GetContainerItemInfo, bag, slot)
            if type(info) == "table" and Clean(info.isLocked) and Clean(info.hyperlink) then
                return Clean(info.hyperlink), Clean(info.itemID)
            end
        end
    end
end
-- Forever doesn't always report the item as locked, so also remember the
-- last bag slot the game locked, and compare bags before and after.
local lastLock
ns.On("ITEM_LOCK_CHANGED", function(bag, slot)
    bag, slot = Clean(bag), Clean(slot)
    if not bag or not slot or bag < 0 then return end
    local info = Call(C_Container and C_Container.GetContainerItemInfo, bag, slot)
    local link = type(info) == "table" and Clean(info.hyperlink)
    if link then lastLock = { bag = bag, slot = slot, link = link, at = GetTime() } end
end)
local function BagMap()
    local CI, map = C_Container or {}, {}
    for bag = 0, (NUM_BAG_SLOTS or 4) + 1 do
        for slot = 1, Clean(Call(CI.GetContainerNumSlots or GetContainerNumSlots, bag)) or 0 do
            local info = Call(CI.GetContainerItemInfo, bag, slot)
            if type(info) == "table" and Clean(info.hyperlink) then map[bag .. ":" .. slot] = Clean(info.hyperlink) end
        end
    end
    return map
end
ns.BagMap = BagMap
function ns.DESource(de)
    if de.link or not de.before then return end
    local now = BagMap()
    for k, link in pairs(de.before) do
        if now[k] ~= link and not link:find("item:6948:") then
            de.link = link
            de.id = tonumber(link:match("item:(%d+)"))
            de.item = ns.NoteItem(link)
            return
        end
    end
end
ns.On("UNIT_SPELLCAST_START", function(unit, castGUID, spellID)
    if Clean(unit) ~= "player" or not ns.char then return end
    spellID = Clean(spellID)
    if not IsDisenchant(spellID) then return end
    local link, id = LockedBagItem()
    if not link and lastLock and GetTime() - lastLock.at < 5 then link = lastLock.link end
    ns.deCasting = { link = link, id = id or (link and tonumber(link:match("item:(%d+)"))), item = ns.NoteItem(link),
        before = not link and BagMap() or nil }
end)
ns.On("UNIT_SPELLCAST_SUCCEEDED", function(unit, castGUID, spellID)
    if Clean(unit) ~= "player" or not ns.char then return end
    spellID = Clean(spellID)
    if not IsDisenchant(spellID) or not ns.deCasting then return end
    ns.dePending = ns.deCasting
    ns.dePending.untilT = GetTime() + 10
    ns.dePending.t = ns.Now()
    ns.deCasting = nil
end)
for _, ev in ipairs({ "UNIT_SPELLCAST_FAILED", "UNIT_SPELLCAST_INTERRUPTED" }) do
    ns.On(ev, function(unit) if Clean(unit) == "player" then ns.deCasting = nil end end)
end
ns.On("LOOT_CLOSED", function()
    if ns.dePending and ns.dePending.got then ns.dePending = nil end
end)

function ns.RecordDisenchant(de, link, key, item, n)
    local c = ns.char
    ns.DESource(de)
    de.before = nil
    local src = de.item and ClaudeCompanionDB.items[de.item]
    local srcId = de.id and tostring(de.id) or "?"
    local outId = item and item.id or tonumber(link:match("item:(%d+)"))
    local first = not de.got
    de.got = true
    -- what this item gave, kept forever (one row per disenchant)
    c.deResults = c.deResults or {}
    if first then
        ns.Push(c.deResults, { t = de.t, id = de.id, item = de.item, link = de.link, ilvl = src and src.ilvl, q = src and src.q,
            class = src and src.class, out = {} }, ns.LIMITS.sales)
    end
    local row = c.deResults[#c.deResults]
    row.out[#row.out + 1] = { id = outId, item = key, count = n }
    ns.Log("disenchant", { link = de.link, item = de.item, out = link, outItem = key, count = n })
    Each(function(s)
        s.disenchants = s.disenchants or {}
        local d = s.disenchants[srcId] or { id = de.id, item = de.item, link = de.link, count = 0, out = {} }
        if first then
            d.count = d.count + 1
            -- the item turned into materials: take it out of this tracker's loot
            local l = s.loot[srcId]
            if l and l.count > 0 then l.count = l.count - 1; if l.count == 0 then s.loot[srcId] = nil end end
        end
        local o = d.out[tostring(outId)] or { id = outId, item = key, link = link, count = 0 }
        o.count = o.count + n
        d.out[tostring(outId)] = o
        s.disenchants[srcId] = d
        -- the materials count as loot, so the grind's value includes them
        local id = outId and tostring(outId) or link
        local l = s.loot[id] or { id = outId, item = key, link = link, name = item and item.name or link:match("%[(.-)%]"), q = item and item.q, count = 0 }
        l.count = l.count + n
        l.fromDE = (l.fromDE or 0) + n
        s.loot[id] = l
    end)
end
ns.On("LEARNED_SPELL_IN_TAB", function(spellID)
    spellID = Clean(spellID)
    ns.Log("learn", { spell = spellID, name = spellID and Clean(Call(C_Spell and C_Spell.GetSpellName or GetSpellInfo, spellID)) })
end)

local lastRoster = ""
ns.On("GROUP_ROSTER_UPDATE", function()
    if not ns.char then return end
    ns.Soon("group", 2, function()
        local g = ns.Group()
        local names = {}
        for _, m in ipairs(g) do names[#names + 1] = m.name .. ":" .. tostring(m.level) end
        local roster = table.concat(names, ",")
        if roster ~= lastRoster then lastRoster = roster; ns.Log("group", { members = g }) end
    end)
end)

---------------------------------------------------------------- dungeon runs
-- A run starts by itself when you enter a dungeon or raid and counts the same things as a grind
-- (time, kills, loot, gold, XP, deaths, quests, rep), plus bosses and who you were with. Leaving
-- doesn't end it at once: a run back after a wipe or a quest handed in outside keeps it. It ends
-- when you enter a different instance, the instance is reset, you have been out of it for
-- RUN_OUTSIDE, or (like a grind) this computer's save last saw it RUN_OUTSIDE before you log in.
local RUN_OUTSIDE = 15 * 60

local function InstanceNow()
    local inside, kind = Call(IsInInstance)
    kind = Clean(kind)
    if not Clean(inside) or (kind ~= "party" and kind ~= "raid") then return nil end
    local name, _, _, diffName, maxPlayers, _, _, mapID = Call(GetInstanceInfo)
    return { name = Clean(name) or Clean(GetRealZoneText()) or "Dungeon", kind = kind, map = Clean(mapID),
        difficulty = Clean(diffName), size = Clean(maxPlayers) }
end
ns.InstanceNow = InstanceNow

local function Roster()
    local out = {}
    for _, m in ipairs(ns.Group and ns.Group() or {}) do out[#out + 1] = { name = m.name, level = m.level, class = m.class } end
    return out
end

-- Boss kills logged by the ForeverDungeonJournal addon, if it's installed: it keeps a log of each
-- run with the boss of every encounter. Copied (read only) into c.bossLog, so runs from before this
-- addon tracked bosses, and any boss the encounter events missed, still show. Nothing depends on it.
function ns.ImportBossLog()
    local c = ns.char
    local db = rawget(_G, "ForeverDungeonJournalCharacterDB")
    local runs = c and type(db) == "table" and type(db.runLog) == "table" and db.runLog.runs
    if type(runs) ~= "table" then return end
    local out = {}
    for i = math.max(1, #runs - 29), #runs do
        local r = runs[i]
        if type(r) == "table" and type(r.kills) == "table" then
            local bosses, seen = {}, {}
            for _, k in ipairs(r.kills) do
                local b = type(k) == "table" and Clean(k.b)
                if type(b) == "string" and not seen[b] then seen[b] = true; bosses[#bosses + 1] = { name = b, t = Clean(k.t) } end
            end
            out[#out + 1] = { id = Clean(r.id), dungeon = Clean(r.dungeon) or Clean(r.instanceName), start = Clean(r.created),
                finish = Clean(r.endedAt) or Clean(r.lastSeen), bosses = bosses }
        end
    end
    c.bossLog = { from = "ForeverDungeonJournal", read = ns.Now(), runs = out }
    return out
end
-- bosses the journal addon logged between from and to in this dungeon
local function LoggedBosses(name, from, to)
    local log = ns.ImportBossLog() or {}
    local list = {}
    for _, r in ipairs(log) do
        if r.dungeon == name then
            for _, b in ipairs(r.bosses) do if b.t and b.t >= from and b.t <= to then list[#list + 1] = { name = b.name, t = b.t, source = "journal addon" } end end
        end
    end
    return list
end

-- at: when it ended (default: when you were last inside). why: left / other / reset / away / logout / you
function ns.RunEnd(why, at)
    local c = ns.char
    local r = c and c.run
    if not r then return nil end
    at = at or r.leftAt or ns.Now()
    r.finish = at
    r.ended = why
    -- a boss the encounter events didn't report (or none at all): take it from the journal addon's log
    local have = {}
    for _, b in ipairs(r.bosses or {}) do have[b.name] = true end
    for _, b in ipairs(LoggedBosses(r.name, r.start, at)) do
        if not have[b.name] then have[b.name] = true; r.bosses[#r.bosses + 1] = b end
    end
    r.secs = math.max(0, at - r.start - (r.outsideSecs or 0) - (r.pausedSecs or 0))
    r.vendorValue, r.ahValue = ns.LootValue(r)
    r.coin = (r.bySource and r.bySource.loot) or 0
    r.inside, r.leftAt = nil, nil
    c.runs = c.runs or {}
    ns.Push(c.runs, r, ns.LIMITS.sessions)
    c.run = nil
    ns.Log("runEnd", { name = r.name, secs = r.secs, kills = r.kills, bosses = #(r.bosses or {}), deaths = r.deaths, ended = why })
    return r
end

local function RunStart(inst)
    local c = ns.char
    local r = NewTracker(inst.name)
    r.kind, r.map, r.difficulty, r.size = inst.kind, inst.map, inst.difficulty, inst.size
    r.bosses, r.group, r.device, r.inside, r.outsideSecs = {}, Roster(), ns.Device(), true, 0
    c.run = r
    ns.Try("caps:instance", ns.ProbeInstance, r.name)
    ns.Log("runStart", { name = r.name, kind = r.kind, difficulty = r.difficulty, group = #r.group })
    return r
end

-- where are we now: start, continue, park or end the run
function ns.RunCheck()
    local c = ns.char
    if not c then return end
    local inst, r, now = InstanceNow(), c.run, ns.Now()
    if r and not r.inside and r.leftAt and now - r.leftAt > RUN_OUTSIDE then ns.RunEnd("left"); r = nil end
    if inst then
        if r and (r.map ~= inst.map or r.name ~= inst.name) then ns.RunEnd("other"); r = nil end
        if not r then RunStart(inst)
        elseif not r.inside then
            r.outsideSecs = (r.outsideSecs or 0) + math.max(0, now - (r.leftAt or now))
            r.inside, r.leftAt = true, nil
            ns.Log("runBack", { name = r.name })
        end
    elseif r and r.inside then
        r.inside, r.leftAt = nil, now
        r.last = now
        ns.Log("runLeft", { name = r.name })
    end
end
ns.On("PLAYER_ENTERING_WORLD", function() ns.Try("run", ns.RunCheck) end)
ns.On("LOOT_OPENED", function() ns.Try("caps:loot", ns.ProbeLoot) end)
ns.On("ZONE_CHANGED_NEW_AREA", function() ns.Try("run", ns.RunCheck) end)
C_Timer.NewTicker(30, function() ns.Try("run", ns.RunCheck) end)

-- bosses: the encounter events (name, id, success) still come through in instances
local function Boss(id, name, success, source)
    local r = ns.char and ns.char.run
    id, name = Clean(id), Clean(name)
    if not r or not name then return end
    for _, b in ipairs(r.bosses) do if (id and b.id == id) or b.name == name then return end end
    if success == 1 or success == true then
        r.bosses[#r.bosses + 1] = { id = id, name = name, t = ns.Now() }
        ns.Log("boss", { name = name, encounter = id, run = r.name, source = source })
    else
        r.wipes = (r.wipes or 0) + 1
        ns.Log("wipe", { name = name, encounter = id, run = r.name })
    end
end
ns.On("ENCOUNTER_END", function(id, name, _, _, success) Boss(id, name, Clean(success), "encounter") end)
ns.On("BOSS_KILL", function(id, name) Boss(id, name, 1, "bossKill") end)

-- "X has been reset." for the instance this run is in
ns.On("CHAT_MSG_SYSTEM", function(text)
    text = Clean(text)
    local r = ns.char and ns.char.run
    if not text or not r or r.inside then return end
    local name = text:match(ns.FormatPattern(INSTANCE_RESET_SUCCESS or "%s has been reset."))
    if name and name == r.name then ns.RunEnd("reset") end
end)

-- the roster can change mid-run: remember everyone who was there
ns.On("GROUP_ROSTER_UPDATE", function()
    local r = ns.char and ns.char.run
    if not r then return end
    ns.Soon("runRoster", 2, function()
        local known = {}
        for _, m in ipairs(r.group) do known[m.name] = m end
        for _, m in ipairs(Roster()) do if not known[m.name] then r.group[#r.group + 1] = m end end
    end)
end)

---------------------------------------------------------------- notes
function ns.AddNote(text)
    if not ns.char or not text or text == "" then return end
    local w = ns.Where()
    ns.Push(ns.char.notes, { t = ns.Now(), text = text, zone = w.zone, sub = w.sub, x = w.x, y = w.y,
        level = Clean(UnitLevel("player")), target = Clean(UnitName("target")) }, ns.LIMITS.notes)
    ns.Log("note", { text = text })
end

---------------------------------------------------------------- login / logout
ns.OnLogin(function()
    local c = ns.char
    local s = c.session
    if s and ns.Now() - (s.last or 0) > RESUME_SECONDS then ns.EndSession() end
    if not c.session then c.session = NewTracker() end
    -- 1.0 saved a fake bank (keyring + reagent bag) at login: drop it
    if c.bank and c.bank.bags and c.bank.bags[1] and type(c.bank.bags[1].name) == "string" and c.bank.bags[1].name:lower():find("keyring") then c.bank = nil end
    reloading = false
    lastZone = Clean(GetRealZoneText())
    ns.Log("login", { level = Clean(UnitLevel("player")), money = Clean(GetMoney()), device = ns.Device() })
    c.device = ns.Device()
    -- a grind carried over a /reload or a quick relog goes on, without the time logged out.
    -- Anything longer (a crash, a long disconnect, playing on the other computer) ends it at its
    -- last counted event, so it can't run on for hours by itself.
    -- a dungeon run survives a reload or relog while you're still in it (a disconnect, a crash) if
    -- you're back within RUN_OUTSIDE; longer than that, it ends when you were last seen in it
    local r = c.run
    if r then
        local seenAt = math.max(c.lastSeen or 0, r.last or r.start)
        if ns.Now() - seenAt > RUN_OUTSIDE then
            ns.RunEnd("away", r.inside and seenAt or r.leftAt)
        elseif r.inside then
            -- logged out inside: the time logged out doesn't count
            r.outsideSecs = (r.outsideSecs or 0) + math.max(0, ns.Now() - seenAt)
            r.last = ns.Now()
        end
    end
    C_Timer.After(2, function() ns.Try("run", ns.RunCheck) end)
    C_Timer.After(5, function() ns.Try("bossLog", ns.ImportBossLog) end)
    local g = c.grind
    -- a /reload that wasn't recognised as one ended the grind at "logout": seconds later, bring it back
    local last = c.grinds and c.grinds[#c.grinds]
    if not g and last and last.ended == "logout" and c.lastSeen and last.finish == c.lastSeen and ns.Now() - c.lastSeen <= 15 then
        c.grinds[#c.grinds] = nil
        last.finish, last.ended, last.secs, last.coin, last.vendorValue, last.ahValue = nil, nil, nil, nil, nil, nil
        c.grind = last; g = last
    end
    if g then
        local away = ns.Now() - math.max(c.lastSeen or 0, g.last or g.start or 0)
        if away > GRIND_RESUME then
            ns.GrindStop(true, math.max(g.last or g.start, g.pausedAt or 0), "away")
            ns.Print(string.format("grind |cffffd100%s|r ended: you were away %d min. /cc start for a new one.",
                g.name or "Grind", math.floor(away / 60)))
        elseif not g.paused and c.lastSeen and c.lastSeen > g.start then
            g.pausedSecs = (g.pausedSecs or 0) + math.max(0, ns.Now() - c.lastSeen)
        end
    end
end)
ns.OnLogout(function()
    local c = ns.char
    c.lastSeen = ns.Now()
    if c.session then c.session.last = ns.Now() end
    c.lastLogout = reloading and "reload" or "logout"
    -- a real logout ends the grind; a /reload (Sync) keeps it running
    if c.grind and not reloading then ns.GrindStop(true, nil, "logout") end
    -- a dungeon run stays open over a logout (a disconnect); the next login decides
    if c.run then c.run.last = ns.Now() end
    ns.Try("bossLog", ns.ImportBossLog)
    ns.Log("logout", { money = Clean(GetMoney()), reload = reloading or nil })
end)

-- a grind with nothing counted for GRIND_IDLE (or paused that long) ends by itself
C_Timer.NewTicker(60, function()
    local g = ns.char and ns.char.grind
    if not g then return end
    local since = g.paused and (g.pausedAt or g.last) or g.last or g.start
    if ns.Now() - since > GRIND_IDLE then
        ns.GrindStop(true, since, "idle")
        ns.Print(string.format("grind |cffffd100%s|r ended: nothing happened for %d min.", g.name or "Grind", math.floor(GRIND_IDLE / 60)))
    end
end)
