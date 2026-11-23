-- Claude Companion: core helpers, saved data layout, event dispatch.
--
-- Saved file: WTF\Account\<account>\SavedVariables\ClaudeCompanion.lua
-- Layout (schema 1):
--   ClaudeCompanionDB = {
--     schema = 1, addonVersion = "1.5.0", addonBuild = "<source commit>",
--     chars = { ["Name-Realm"] = <char> },
--     items = { [itemString] = { id, name, q, ilvl, ..., icon, tip = { {l,lc,r,rc}, ... } } },
--     cacheStats = { evicted, lastEvict, cap },   -- item cache housekeeping (oldest unused items make room)
--   }
--   <char> = {
--     key, created, lastSync, syncs,
--     snap = { taken = <epoch>, character = {...}, stats = {...}, equipped = {...}, ... },
--     bank = { taken, bags }, professions = { [name] = {...} }, taxi = {...}, mail = {...},
--     specs = { [1] = { taken, talents, actionBars }, [2] = {...} },
--     history = { {t, level, xp, money, ...}, ... },   -- one line per sync, for graphs
--     journal = { {t, e = "loot"|"kill"|..., ...}, ... }, -- event timeline
--     session = <current>, sessions = { <finished>, ... },
--     notes = { {t, text, zone, ...} }, ah = { prices, posts, owned, sales },
--     diag = { [module] = { ok, err, secret, last } },  -- what Forever allowed
--   }
-- All times are Unix epoch seconds (time()). Positions are map % (0-100).
local ADDON, ns = ...
ns.VERSION = "1.5.0"
ns.SCHEMA = 1
-- the source commit of this build: tools/publish-stable.py writes it here; "dev" in a checkout.
-- The app compares it with the build it runs itself, to say when the game still needs a /reload.
ns.BUILD = "614bed66d244"

BINDING_HEADER_CLAUDECOMPANION = "Claude Companion"
BINDING_NAME_CLAUDECOMPANION_TOGGLE = "Open or close Claude window"

local LIMITS = { journal = 6000, sessions = 300, history = 2000, notes = 1000,
                 priceObs = 30, posts = 1500, sales = 1500, items = 6000 }
ns.LIMITS = LIMITS

---------------------------------------------------------------- safety
-- Forever hands some values to addons as "secret": they can't be read or
-- compared. Everything we keep goes through Clean/Copy so a secret never
-- breaks the addon; diag counts how often each module hit one.
local issecret = issecretvalue
function ns.IsSecret(v)
    if v == nil or type(issecret) ~= "function" then return false end
    local ok, s = pcall(issecret, v)
    return (not ok) or s == true
end

function ns.Clean(v)
    if v == nil or ns.IsSecret(v) then return nil end
    local t = type(v)
    if t == "string" or t == "number" or t == "boolean" then return v end
    return nil
end

-- Copy plain fields out of an API table (any depth up to 4), dropping
-- secrets, functions and userdata. Lets us keep whatever fields Forever
-- returns without knowing their names in advance.
function ns.Copy(src, depth)
    depth = depth or 3
    if type(src) ~= "table" or ns.IsSecret(src) then return ns.Clean(src) end
    local out, any = {}, false
    local ok = pcall(function()
        for k, v in pairs(src) do
            local ck = ns.Clean(k)
            if ck ~= nil then
                local cv
                if type(v) == "table" then
                    if depth > 0 then cv = ns.Copy(v, depth - 1) end
                    -- ColorMixin and similar: keep as hex
                    if cv == nil and type(v.r) == "number" then cv = ns.Hex(v) end
                else
                    cv = ns.Clean(v)
                end
                if cv ~= nil then out[ck] = cv; any = true end
            end
        end
    end)
    if not ok then return nil end
    return any and out or nil
end

-- Copy only the named fields (keeps the saved file small).
function ns.Pick(src, fields)
    if type(src) ~= "table" or ns.IsSecret(src) then return nil end
    local out, any = {}, false
    for _, f in ipairs(fields) do
        local ok, v = pcall(function() return src[f] end)
        v = ok and ns.Clean(v) or nil
        if v ~= nil then out[f] = v; any = true end
    end
    return any and out or nil
end

-- pcall wrapper returning all results (or nothing on error / missing fn)
function ns.Call(fn, ...)
    if type(fn) ~= "function" then return end
    local r = { pcall(fn, ...) }
    if not r[1] then return end
    return unpack(r, 2, table.maxn(r))
end

function ns.Hex(c)
    if type(c) ~= "table" then return nil end
    local r, g, b = ns.Clean(c.r), ns.Clean(c.g), ns.Clean(c.b)
    if type(r) ~= "number" or type(g) ~= "number" or type(b) ~= "number" then return nil end
    return string.format("%02x%02x%02x", math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5), math.floor(b * 255 + 0.5))
end

function ns.Now() return time() end

---------------------------------------------------------------- diagnostics
local function Diag(module)
    local c = ns.char
    if not c then return nil end
    c.diag = c.diag or {}
    c.diag[module] = c.diag[module] or { ok = 0, err = 0 }
    return c.diag[module]
end

-- Run a capture step; record success or the error text so Claude can see
-- exactly what Forever blocked.
function ns.Try(module, fn, ...)
    local ok, err = pcall(fn, ...)
    local d = Diag(module)
    if d then
        if ok then d.ok = d.ok + 1; d.lastOk = ns.Now()
        else d.err = d.err + 1; d.lastErr = tostring(err):sub(1, 300); d.lastErrAt = ns.Now() end
    end
    return ok
end

---------------------------------------------------------------- location
function ns.Where()
    local w = { zone = ns.Clean(ns.Call(GetRealZoneText)), sub = ns.Clean(ns.Call(GetSubZoneText)) }
    if C_Map then
        local mapID = ns.Clean(ns.Call(C_Map.GetBestMapForUnit, "player"))
        w.map = mapID
        if mapID then
            local pos = ns.Call(C_Map.GetPlayerMapPosition, mapID, "player")
            if pos and not ns.IsSecret(pos) then
                local x, y = ns.Call(pos.GetXY, pos)
                x, y = ns.Clean(x), ns.Clean(y)
                if type(x) == "number" and type(y) == "number" and (x > 0 or y > 0) then
                    w.x = math.floor(x * 1000 + 0.5) / 10
                    w.y = math.floor(y * 1000 + 0.5) / 10
                end
            end
        end
    end
    if w.sub == "" then w.sub = nil end
    return w
end

---------------------------------------------------------------- item cache
-- itemString (the "item:..." part of a link) uniquely names an item
-- including its random suffix. We keep name, icon, stats and the exact
-- in-game tooltip lines so the website can show the same tooltip.
function ns.ItemString(link)
    if type(link) ~= "string" then return nil end
    return link:match("|H(item:[^|]+)|h") or (link:match("^item:") and link) or nil
end

local function TooltipLines(link)
    if not (C_TooltipInfo and C_TooltipInfo.GetHyperlink) then return nil end
    local data = ns.Call(C_TooltipInfo.GetHyperlink, link)
    if type(data) ~= "table" or type(data.lines) ~= "table" then return nil end
    local out = {}
    for _, line in ipairs(data.lines) do
        local l, r = ns.Clean(line.leftText), ns.Clean(line.rightText)
        if l or r then
            out[#out + 1] = { l = l, lc = ns.Hex(line.leftColor), r = r, rc = ns.Hex(line.rightColor) }
        end
    end
    return #out > 0 and out or nil
end

-- The cache is capped (LIMITS.items). When it is full, the items seen longest ago make room, a tenth
-- of the cap at a time, but never one that any character wears, carries, banks, has in the mail or
-- keeps in a gear set: those are what the Gear tab scores and the app names.
local function InUse()
    local keep, ids = {}, {}
    local function walk(list) -- {item = key} rows, directly or inside bags
        if type(list) ~= "table" then return end
        for _, x in pairs(list) do
            if type(x) == "table" then
                if type(x.item) == "string" then keep[x.item] = true end
                if x.items then walk(x.items) end
            end
        end
    end
    for _, c in pairs(ClaudeCompanionDB.chars or {}) do
        local s = c.snap or {}
        walk(s.equipped); walk(s.bags); walk(c.bank and c.bank.bags); walk(c.mail and c.mail.list)
        for _, g in pairs(s.gearSets or {}) do
            for _, x in pairs(type(g) == "table" and g.items or {}) do if type(x) == "table" and x.id then ids[x.id] = true end end
        end
    end
    return keep, ids
end

local itemCount = nil
local function MakeRoom(items)
    local keep, ids = InUse()
    local old = {}
    for k, e in pairs(items) do
        if not keep[k] and not ids[e.id] then old[#old + 1] = { k = k, seen = e.seen or 0 } end
    end
    table.sort(old, function(a, b) return a.seen < b.seen end)
    local drop = math.min(#old, math.max(1, math.floor(LIMITS.items / 10)))
    for i = 1, drop do items[old[i].k] = nil end
    itemCount = itemCount - drop
    local d = ClaudeCompanionDB.cacheStats or {}
    ClaudeCompanionDB.cacheStats = d
    d.evicted = (d.evicted or 0) + drop; d.lastEvict = ns.Now(); d.cap = LIMITS.items
    if drop == 0 then d.fullOfInUse = (d.fullOfInUse or 0) + 1 end
    return drop > 0
end

function ns.NoteItem(link)
    local key = ns.ItemString(link)
    if not key then return nil end
    local items = ClaudeCompanionDB.items
    local e = items[key]
    if e and e.name and e.tip then e.seen = ns.Now(); return key end
    if not e then
        if not itemCount then itemCount = 0; for _ in pairs(items) do itemCount = itemCount + 1 end end
        if itemCount >= LIMITS.items and not MakeRoom(items) then return key end
        e = {}; items[key] = e; itemCount = itemCount + 1
    end
    e.id = tonumber(key:match("^item:(%-?%d+)"))
    e.link = ns.Clean(link)
    e.seen = ns.Now()
    local GetInfo = (C_Item and C_Item.GetItemInfo) or GetItemInfo
    local name, _, q, ilvl, req, typ, sub, stack, loc, icon, sell, classID, subclassID, bind =
        ns.Call(GetInfo, link)
    if ns.Clean(name) then
        e.name, e.q, e.ilvl, e.req = ns.Clean(name), ns.Clean(q), ns.Clean(ilvl), ns.Clean(req)
        e.type, e.sub, e.stack, e.loc = ns.Clean(typ), ns.Clean(sub), ns.Clean(stack), ns.Clean(loc)
        e.icon, e.sell, e.class, e.subclass, e.bind = ns.Clean(icon), ns.Clean(sell), ns.Clean(classID), ns.Clean(subclassID), ns.Clean(bind)
    end
    local GetStats = (C_Item and C_Item.GetItemStats) or GetItemStats
    local stats = ns.Call(GetStats, link)
    if type(stats) == "table" then e.stats = ns.Copy(stats, 0) end
    e.tip = TooltipLines(link) or e.tip
    return key
end

-- Spells (talents, action bars, spellbook): name, icon and the exact
-- in-game tooltip, saved once per spell ID.
function ns.NoteSpell(id)
    id = ns.Clean(id)
    if type(id) ~= "number" or not ClaudeCompanionDB then return end
    local spells = ClaudeCompanionDB.spells
    local e = spells[id]
    if e and e.tip then return end
    e = e or {}
    spells[id] = e
    e.name = ns.Clean(ns.Call(C_Spell and C_Spell.GetSpellName or GetSpellInfo, id))
    e.icon = ns.Clean(ns.Call(C_Spell and C_Spell.GetSpellTexture or GetSpellTexture, id))
    if C_TooltipInfo and C_TooltipInfo.GetSpellByID then
        local data = ns.Call(C_TooltipInfo.GetSpellByID, id)
        if type(data) == "table" and type(data.lines) == "table" then
            local out = {}
            for _, line in ipairs(data.lines) do
                local l, r = ns.Clean(line.leftText), ns.Clean(line.rightText)
                if l or r then out[#out + 1] = { l = l, lc = ns.Hex(line.leftColor), r = r, rc = ns.Hex(line.rightColor) } end
            end
            if #out > 0 then e.tip = out end
        end
    end
end

-- Item info may not be loaded yet the first time; retry those later.
function ns.RefreshItems()
    local n = 0
    for _, e in pairs(ClaudeCompanionDB.items) do
        if (not e.name or not e.tip) and e.link and n < 400 then
            n = n + 1
            ns.NoteItem(e.link)
        end
    end
end

---------------------------------------------------------------- list helpers
function ns.Push(list, value, cap)
    list[#list + 1] = value
    if cap and #list > cap then
        local drop = #list - cap + math.floor(cap / 10)
        local keep = {}
        for i = drop + 1, #list do keep[#keep + 1] = list[i] end
        for i = #list, 1, -1 do list[i] = nil end
        for i = 1, #keep do list[i] = keep[i] end
    end
    return value
end

-- Journal entry with time and place. kind = short event name.
function ns.Log(kind, fields)
    local c = ns.char
    if not c then return end
    local e = fields or {}
    e.t = ns.Now(); e.e = kind
    local w = ns.Where()
    e.zone, e.sub, e.x, e.y = w.zone, w.sub, w.x, w.y
    ns.Push(c.journal, e, LIMITS.journal)
    return e
end

function ns.Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cff8fd3ffClaude:|r " .. msg)
end

function ns.Money(c)
    c = math.floor(tonumber(c) or 0)
    local neg = c < 0; c = math.abs(c)
    local g, sv, cp = math.floor(c / 10000), math.floor(c / 100) % 100, c % 100
    local s
    if g > 0 then s = string.format("%dg %ds", g, sv)
    elseif sv > 0 then s = string.format("%ds %dc", sv, cp)
    else s = string.format("%dc", cp) end
    return neg and ("-" .. s) or s
end

---------------------------------------------------------------- events
local frame = CreateFrame("Frame")
local handlers = {}
ns.frame = frame

-- ns.On("EVENT", fn): many modules can listen to one event.
-- Spellcast events fire for every unit around you (party, raid, nameplates) and the addon only ever
-- wants the player's own casts, so those are asked for the player only: no work for anyone else's.
function ns.On(event, fn)
    if not handlers[event] then
        handlers[event] = {}
        local unitOnly = event:find("^UNIT_SPELLCAST_") and frame.RegisterUnitEvent
            and pcall(frame.RegisterUnitEvent, frame, event, "player")
        if not unitOnly then pcall(frame.RegisterEvent, frame, event) end
    end
    table.insert(handlers[event], fn)
end

frame:SetScript("OnEvent", function(_, event, ...)
    local list = handlers[event]
    if not list then return end
    for i = 1, #list do
        local ok, err = pcall(list[i], ...)
        if not ok then
            local d = Diag("event:" .. event)
            if d then d.err = d.err + 1; d.lastErr = tostring(err):sub(1, 300); d.lastErrAt = ns.Now() end
        end
    end
end)

-- Throttled jobs: ns.Soon("bags", 3, fn) runs fn once, 3s after the last call.
local pending = {}
function ns.Soon(key, delay, fn)
    if pending[key] then return end
    pending[key] = true
    C_Timer.After(delay, function()
        pending[key] = nil
        ns.Try(key, fn)
    end)
end

---------------------------------------------------------------- startup
local function CharKey()
    local name = ns.Clean(UnitName("player")) or "Unknown"
    local realm = ns.Clean(GetRealmName())
    if not realm or realm == "" then realm = ns.Clean(ns.Call(GetNormalizedRealmName)) end
    if not realm or realm == "" then local _, r = ns.Call(UnitFullName, "player"); realm = ns.Clean(r) end
    if not realm or realm == "" then realm = "Realm" end
    return name .. "-" .. realm, name
end

ns.On("ADDON_LOADED", function(name)
    if name ~= ADDON then return end
    ClaudeCompanionDB = ClaudeCompanionDB or {}
    local db = ClaudeCompanionDB
    db.schema = ns.SCHEMA
    db.addonVersion = ns.VERSION
    db.addonBuild = ns.BUILD
    db.inboxSeen = nil   -- the old in-game message from Claude (Inbox.lua) was replaced by From Claude cards
    db.chars = db.chars or {}
    db.items = db.items or {}
    db.spells = db.spells or {}
    -- Quest, NPC and item-source facts come from the app's game-data pack (QuestieDB Forever, built
    -- offline: docs/ARCHITECTURE.md, Data sources). Saves from 1.4 and earlier also kept a copy read
    -- from the QuestieDB addon in game; it was never refreshed, so it is dropped here.
    db.npcs, db.quests = nil, nil
    for _, it in pairs(db.items) do if type(it) == "table" then it.src = nil end end
end)

-- Callbacks modules want after the character table exists.
ns.loginHooks = {}
function ns.OnLogin(fn) table.insert(ns.loginHooks, fn) end

ns.On("PLAYER_LOGIN", function()
    local db = ClaudeCompanionDB
    local key, name = CharKey()
    local c = db.chars[key]
    if not c then
        -- older versions saved a key with an empty realm ("Name-"): move it
        local old = db.chars[name .. "-"]
        if old then c = old; c.key = key; db.chars[key] = c; db.chars[name .. "-"] = nil end
    end
    if not c then c = { key = key, created = ns.Now(), syncs = 0 }; db.chars[key] = c end
    for _, f in ipairs({ "journal", "sessions", "grinds", "history", "notes", "specs", "professions", "diag" }) do
        c[f] = c[f] or {}
    end
    c.ah = c.ah or {}
    for _, f in ipairs({ "prices", "posts", "owned", "sales" }) do c.ah[f] = c.ah[f] or {} end
    c.taxi = c.taxi or {}
    c.loginAt = ns.Now()
    ns.char = c
    ns.Try("caps", ns.Capabilities)
    for _, fn in ipairs(ns.loginHooks) do ns.Try("login", fn) end
end)

ns.logoutHooks = {}
function ns.OnLogout(fn) table.insert(ns.logoutHooks, fn) end
ns.On("PLAYER_LOGOUT", function()
    if not ns.char then return end
    for _, fn in ipairs(ns.logoutHooks) do ns.Try("logout", fn) end
end)

---------------------------------------------------------------- capabilities
-- Which game APIs exist on this client, and which values come back
-- secret. Saved so Claude can see exactly what Forever allows.
local API_NAMES = { "C_AuctionHouse", "C_TooltipInfo", "C_EquipmentSet", "GetTalentInfo", "GetTalentTabInfo",
    "GetNumTalentGroups", "GetActiveTalentGroup", "C_ClassTalents", "C_Traits", "C_SpecializationInfo", "C_SpellBook",
    "GetSpellTabInfo", "C_TradeSkillUI", "GetTradeSkillLine", "C_SkillInfo", "GetSkillLineInfo", "C_Reputation",
    "GetFactionInfo", "C_CurrencyInfo", "C_QuestLog", "GetQuestLogTitle", "C_Container", "GetContainerItemInfo",
    "C_Map", "C_UnitAuras", "UnitBuff", "GetAuctionItemInfo", "PostAuction", "GetInboxInvoiceInfo", "NumTaxiNodes",
    "C_Item", "GetItemInfo", "GetItemStats", "issecretvalue", "CombatLogGetCurrentEventInfo", "GetSpellBonusHealing",
    "GetManaRegen", "C_Spell", "GetMacroInfo", "GetActionInfo", "GetNumBindings", "GetBindLocation",
    -- for measuring Forever drop rates and resistances (docs/ROADMAP.md): which mob each loot slot came
    -- from, and whether the combat log can be read or turned on by an addon
    "GetLootSourceInfo", "GetLootSlotLink", "GetNumLootItems", "LoggingCombat", "CombatLog_Object_IsA", "UnitTokenFromGUID" }

function ns.Capabilities()
    local caps = { api = {}, secret = {}, version = ns.VERSION, checked = ns.Now() }
    for _, name in ipairs(API_NAMES) do caps.api[name] = type(_G[name]) end
    local function probe(label, fn, ...)
        local ok, v = pcall(fn, ...)
        if not ok then caps.secret[label] = "error"
        elseif v == nil then caps.secret[label] = "nil"
        else caps.secret[label] = ns.IsSecret(v) and "secret" or "readable" end
    end
    probe("GetMoney", GetMoney)
    probe("UnitXP", UnitXP, "player")
    probe("UnitHealth", UnitHealth, "player")
    probe("UnitPower", UnitPower, "player", 0)
    probe("UnitPowerMax", UnitPowerMax, "player", 0)
    probe("UnitGUID", UnitGUID, "player")
    probe("GetManaRegen", GetManaRegen)
    probe("GetSpellBonusHealing", GetSpellBonusHealing)
    probe("LoggingCombat", LoggingCombat)               -- reading only: never turns logging on or off
    if type(LoggingCombat) == "function" then           -- and what it said: on, off, or nothing (can't tell)
        local ok, v = pcall(LoggingCombat)
        caps.loggingCombat = not ok and "error" or v == nil and "nil" or ns.IsSecret(v) and "secret" or (v and "on" or "off")
    end
    local _, build, _, toc = GetBuildInfo()
    caps.build, caps.toc = ns.Clean(build), ns.Clean(toc)
    if Enum and type(Enum.BagIndex) == "table" then
        caps.bagIndex = {}
        for k, v in pairs(Enum.BagIndex) do caps.bagIndex[k] = ns.Clean(v) end
    end
    caps.realm = { GetRealmName = ns.Clean(ns.Call(GetRealmName)), normalized = ns.Clean(ns.Call(GetNormalizedRealmName)) }
    -- probes that need a place: kept from the last time they ran (ns.ProbeInstance, ns.ProbeLoot)
    local old = ns.char.caps
    if type(old) == "table" then caps.instance, caps.loot = old.instance, old.loot end
    ns.char.caps = caps
end

-- Inside a dungeon: can the addon still read GUIDs there (Forever may hide them in instances)?
function ns.ProbeInstance(name)
    local caps = ns.char and ns.char.caps
    if type(caps) ~= "table" then return end
    local function state(fn, ...)
        local ok, v = pcall(fn, ...)
        if not ok then return "error" elseif v == nil then return "nil" end
        return ns.IsSecret(v) and "secret" or "readable"
    end
    caps.instance = { t = ns.Now(), name = name, UnitGUID = state(UnitGUID, "player"),
        target = UnitExists and UnitExists("target") and state(UnitGUID, "target") or "no target" }
end

-- With a loot window open: does GetLootSourceInfo say which corpse each slot came from?
function ns.ProbeLoot()
    local caps = ns.char and ns.char.caps
    if type(caps) ~= "table" or type(GetLootSourceInfo) ~= "function" or type(GetNumLootItems) ~= "function" then return end
    local n, ok, got = ns.Clean(ns.Call(GetNumLootItems)) or 0, 0, nil
    for i = 1, n do
        local okc, guid = pcall(GetLootSourceInfo, i)
        if okc and guid ~= nil then got = ns.IsSecret(guid) and "secret" or "readable"; ok = ok + 1 end
    end
    caps.loot = { t = ns.Now(), slots = n, sources = ok, value = got or (n > 0 and "nil" or "no slots") }
end
