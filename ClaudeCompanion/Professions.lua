-- Things the game only shows while a window is open: profession recipes,
-- the bank, and flight masters. Each is saved the moment you open it.
local _, ns = ...
local Clean, Call, Copy = ns.Clean, ns.Call, ns.Copy

---------------------------------------------------------------- professions
local function ReadTradeSkill()
    local c = ns.char
    local T = C_TradeSkillUI
    if not c or not T then return end
    local base = Call(T.GetBaseProfessionInfo)
    local name, rank, max
    if type(base) == "table" then
        name, rank, max = Clean(base.professionName), Clean(base.skillLevel), Clean(base.maxSkillLevel)
    end
    if not name and GetTradeSkillLine then
        name, rank, max = Call(GetTradeSkillLine)
        name, rank, max = Clean(name), Clean(rank), Clean(max)
    end
    local child = Call(T.GetChildProfessionInfo)
    if type(child) == "table" and Clean(child.skillLevel) and Clean(child.skillLevel) > 0 then
        rank, max = Clean(child.skillLevel), Clean(child.maxSkillLevel) or max
        name = name or Clean(child.professionName)
    end
    if name == "" then name = nil end
    local ids = Call(T.GetAllRecipeIDs)
    if type(ids) ~= "table" or #ids == 0 then return end
    local recipes = {}
    local now = ns.Now()
    for _, id in ipairs(ids) do
        local info = Call(T.GetRecipeInfo, id)
        if type(info) == "table" and Clean(info.learned) then
            local r = { id = id, name = Clean(info.name), icon = Clean(info.icon), difficulty = Clean(info.relativeDifficulty),
                skillUps = Clean(info.numSkillUps), canCraft = Clean(info.craftable), numCraftable = Clean(info.numAvailable),
                category = Clean(info.categoryID) }
            local link = Clean(Call(T.GetRecipeLink, id))
            r.link = link
            local sch = Call(T.GetRecipeSchematic, id, false)
            if type(sch) == "table" then
                r.output = Clean(sch.outputItemID)
                r.makesMin, r.makesMax = Clean(sch.quantityMin), Clean(sch.quantityMax)
                r.reagents = {}
                if type(sch.reagentSlotSchematics) == "table" then
                    for _, slot in ipairs(sch.reagentSlotSchematics) do
                        local first = type(slot.reagents) == "table" and slot.reagents[1]
                        if first then
                            r.reagents[#r.reagents + 1] = { id = Clean(first.itemID), need = Clean(slot.quantityRequired) }
                        end
                    end
                end
            end
            local cd, isDay, charges, maxCharges = Call(T.GetRecipeCooldown, id)
            cd = Clean(cd)
            if cd and cd > 0 then r.cooldownEnds = now + math.floor(cd); r.dayCooldown = Clean(isDay) end
            if Clean(maxCharges) and maxCharges > 0 then r.charges, r.maxCharges = Clean(charges), Clean(maxCharges) end
            recipes[#recipes + 1] = r
        end
    end
    -- the window's own name can be blank while it switches profession;
    -- recipe links always say it ("Tailoring: Bolt of Silk Cloth")
    local votes, best, bestN = {}, nil, 0
    for _, r in ipairs(recipes) do
        local p = r.link and r.link:match("%[(.-): ")
        if p then votes[p] = (votes[p] or 0) + 1; if votes[p] > bestN then best, bestN = p, votes[p] end end
    end
    if best and bestN >= #recipes / 2 then
        if name and name ~= best then rank, max = nil, nil end -- rank shown belonged to another profession
        name = best
    end
    if not name or #recipes == 0 then return end
    if not rank and ns.char.snap and ns.char.snap.skills then
        for _, sk in ipairs(ns.char.snap.skills) do if sk.name == name then rank, max = sk.rank, sk.maxRank end end
    end
    c.professions[""] = nil
    local old = c.professions[name]
    c.professions[name] = { name = name, rank = rank, max = max, taken = now, recipes = recipes }
    if not old or old.rank ~= rank or #(old.recipes or {}) ~= #recipes then
        ns.Log("profession", { name = name, rank = rank, max = max, recipes = #recipes })
    end
end

ns.On("TRADE_SKILL_SHOW", function() if ns.char then ns.Soon("trade", 2, function() ns.Try("professions", ReadTradeSkill) end) end end)
ns.On("NEW_RECIPE_LEARNED", function(recipeID)
    recipeID = Clean(recipeID)
    if not ns.char or not recipeID then return end
    local info = C_TradeSkillUI and Call(C_TradeSkillUI.GetRecipeInfo, recipeID)
    ns.Log("recipe", { recipe = recipeID, name = type(info) == "table" and Clean(info.name) or nil })
end)
ns.On("TRADE_SKILL_LIST_UPDATE", function() if ns.char then ns.Soon("trade", 2, ReadTradeSkill) end end)
ns.On("TRADE_SKILL_DATA_SOURCE_CHANGED", function() if ns.char then ns.Soon("trade", 2, ReadTradeSkill) end end)

-- Crafts with a cooldown (Mooncloth...): the cast is logged so the
-- cooldown can be worked out even without the window open.
ns.On("UNIT_SPELLCAST_SUCCEEDED", function(unit, _, spellID)
    if Clean(unit) ~= "player" or not ns.char then return end
    spellID = Clean(spellID)
    if not spellID or not C_TradeSkillUI then return end
    C_Timer.After(1, function()
        local cd = Clean(Call(C_TradeSkillUI.GetRecipeCooldown, spellID))
        if cd and cd > 0 then
            ns.Log("cooldownCraft", { spell = spellID, name = Clean(Call(C_Spell and C_Spell.GetSpellName or GetSpellInfo, spellID)),
                readyAt = ns.Now() + math.floor(cd) })
        end
    end)
end)

---------------------------------------------------------------- bank
-- The bank can only be read while it is open. Forever's bank uses the
-- modern bag numbers (bank tabs), so we read every bank-type container
-- the game defines, plus the classic numbers as a fallback.
local bankOpen = false
local function BankIDs()
    local ids, seen = {}, {}
    local function add(id) if type(id) == "number" and not seen[id] then seen[id] = true; ids[#ids + 1] = id end end
    if Enum and type(Enum.BagIndex) == "table" then
        for k, v in pairs(Enum.BagIndex) do
            if type(k) == "string" and k:lower():find("bank") then add(v) end
        end
    end
    add(BANK_CONTAINER)
    local first = (NUM_BAG_SLOTS or 4) + 1
    if Enum and Enum.BagIndex and Enum.BagIndex.ReagentBag then first = Enum.BagIndex.ReagentBag + 1 end
    for i = first, first + (NUM_BANKBAGSLOTS or 7) - 1 do add(i) end
    table.sort(ids)
    return ids
end

local function ReadBank()
    local c = ns.char
    if not c or not bankOpen then return end
    local bags = {}
    local keyring = Enum and Enum.BagIndex and Enum.BagIndex.Keyring
    for _, id in ipairs(BankIDs()) do
        local isInventory = id >= 0 and id <= (NUM_BAG_SLOTS or 4)
        local isReagentBag = Enum and Enum.BagIndex and id == Enum.BagIndex.ReagentBag
        if not isInventory and not isReagentBag and id ~= keyring then
            local b = ns.ReadBag(id)
            if b and not (b.name and b.name:lower():find("keyring")) then bags[#bags + 1] = b end
        end
    end
    if #bags == 0 then return end
    c.bank = { taken = ns.Now(), bags = bags, bagSlotsBought = Clean(Call(GetNumBankSlots)), source = "open" }
end
-- Outside the bank the game may still hold what it last saw. We try at
-- every snapshot and keep it only if no real bank read exists yet.
function ns.BankFromCache()
    local c = ns.char
    if not c or bankOpen or (c.bank and c.bank.source ~= "cache") then return end
    local bags, items = {}, 0
    local keyring = Enum and Enum.BagIndex and Enum.BagIndex.Keyring
    for _, id in ipairs(BankIDs()) do
        local isInventory = id >= 0 and id <= (NUM_BAG_SLOTS or 4)
        local isReagentBag = Enum and Enum.BagIndex and id == Enum.BagIndex.ReagentBag
        if not isInventory and not isReagentBag and id ~= keyring then
            local b = ns.ReadBag(id)
            if b and b.used > 0 and not (b.name and b.name:lower():find("keyring")) then bags[#bags + 1] = b; items = items + b.used end
        end
    end
    c.caps = c.caps or {}
    c.caps.bankWhileClosed = items
    if items > 0 then c.bank = { taken = ns.Now(), bags = bags, source = "cache" } end
end

local function BankOpened()
    bankOpen = true
    if not ns.char then return end
    C_Timer.After(1, function() ns.Try("bank", ReadBank) end)
    C_Timer.After(4, function() ns.Try("bank", ReadBank) end)
end
local function BankClosed() if bankOpen then ns.Try("bank", ReadBank) end bankOpen = false end
ns.On("BANKFRAME_OPENED", BankOpened)
ns.On("BANKFRAME_CLOSED", BankClosed)
local BANKERS = { Banker = true, CharacterBanker = true, AccountBanker = true }
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", function(t)
    local k = ns.InteractionKind and ns.InteractionKind(Clean(t))
    if BANKERS[k or ""] and not bankOpen then BankOpened() end
    if k == "TaxiNode" and ns.char then ns.Soon("taxi", 0.5, function() ns.Try("taxi", ns.ReadTaxi) end) end
end)
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", function(t)
    local k = ns.InteractionKind and ns.InteractionKind(Clean(t))
    if BANKERS[k or ""] then BankClosed() end
end)
for _, ev in ipairs({ "PLAYERBANKSLOTS_CHANGED", "BAG_UPDATE_DELAYED", "BANK_TABS_CHANGED", "PLAYERREAGENTBANKSLOTS_CHANGED" }) do
    ns.On(ev, function() if ns.char and bankOpen then ns.Soon("bank", 2, ReadBank) end end)
end

---------------------------------------------------------------- flight paths
function ns.ReadTaxi()
    local c = ns.char
    if not c or not NumTaxiNodes then return end
    local n = Clean(Call(NumTaxiNodes)) or 0
    local now = ns.Now()
    -- the flight map only lists the continent you're on: note which one, so paths on the other
    -- continent are kept (they always were) and the app can say which continent hasn't been read
    local mapID = Clean(Call(GetTaxiMapID))
    local info = mapID and C_Map and C_Map.GetMapInfo and ns.Call(C_Map.GetMapInfo, mapID)
    local continent = (type(info) == "table" and Clean(info.name)) or (mapID and ("map " .. mapID)) or nil
    for i = 1, n do
        local name = Clean(Call(TaxiNodeName, i))
        local kind = Clean(Call(TaxiNodeGetType, i))
        if name and kind and kind ~= "NONE" and not name:find("^zzOLD") then
            local t = c.taxi[name]
            if not t then
                t = { first = now, last = now }
                c.taxi[name] = t
                ns.Log("flightPath", { name = name, continent = continent })
            else
                t.last = now
            end
            if continent then t.continent = continent end
            if kind == "CURRENT" then t.here = now end
        end
    end
    if continent then
        c.taxiRead = c.taxiRead or {}
        c.taxiRead[continent] = now
    end
    -- names the game no longer lists ("zzOLD...") are dropped
    for name in pairs(c.taxi) do if name:find("^zzOLD") then c.taxi[name] = nil end end
end
ns.On("TAXIMAP_OPENED", function() if ns.char then ns.Soon("taxi", 0.5, function() ns.Try("taxi", ns.ReadTaxi) end) end end)


----------------------------------------------------------------
-- Fills in what the game itself doesn't say, from the QuestieDB addon
-- (Forever build) when it is installed: who starts and ends each quest,
-- where those NPCs stand, quest chains and requirements, and where every
-- item you've seen comes from (drops, vendors, quest rewards).
-- One source for all of it, so the page and Claude read the same facts.

local MAX_POINTS, MAX_ZONES, MAX_LIST = 8, 3, 12

local function Have()
    return type(QuestDB) == "table" and type(ItemDB) == "table" and type(NpcDB) == "table"
end

local function F(db, field, id)
    local fn = db and db[field]
    if type(fn) ~= "function" then return nil end
    local ok, v = pcall(fn, id)
    if ok and v ~= 0 and v ~= "" then return v end
end

local function List(t, max)
    if type(t) ~= "table" then return nil end
    local out = {}
    for _, v in ipairs(t) do
        if type(v) == "number" then out[#out + 1] = v end
        if #out >= (max or MAX_LIST) then break end
    end
    return #out > 0 and out or nil
end

local function ToForever(zone, x, y)
    local L = LibQuestieDB
    if type(L) == "table" and type(L.EraToForever) == "function" then
        local ok, fx, fy = pcall(L.EraToForever, zone, x, y)
        if ok and fx then return fx, fy end
    end
    return x, y
end

-- spawns come as { [zoneID] = { {x, y}, ... } }
local function Spawns(sp)
    if type(sp) ~= "table" then return nil end
    local zones = {}
    for zone, pts in pairs(sp) do
        if type(pts) == "table" then zones[#zones + 1] = { zone = zone, pts = pts, n = #pts } end
    end
    table.sort(zones, function(a, b) return a.n > b.n end)
    local out = {}
    for i = 1, math.min(MAX_ZONES, #zones) do
        local z = zones[i]
        local o = { zone = z.zone, count = z.n, pts = {} }
        if C_Map and C_Map.GetAreaInfo then o.zoneName = Clean(Call(C_Map.GetAreaInfo, z.zone)) end
        local step = math.max(1, math.floor(z.n / MAX_POINTS))
        for j = 1, z.n, step do
            local p = z.pts[j]
            if type(p) == "table" and p[1] and p[1] >= 0 then
                local x, y = ToForever(z.zone, p[1], p[2])
                o.pts[#o.pts + 1] = { math.floor(x * 10 + 0.5) / 10, math.floor(y * 10 + 0.5) / 10 }
            end
            if #o.pts >= MAX_POINTS then break end
        end
        if #o.pts > 0 then out[#out + 1] = o end
    end
    return #out > 0 and out or nil
end

function ns.NpcInfo(id)
    local db = ClaudeCompanionDB
    db.npcs = db.npcs or {}
    if db.npcs[id] then return db.npcs[id] end
    if not Have() then return nil end
    local name = F(NpcDB, "name", id)
    if not name then return nil end
    local n = { name = name, sub = F(NpcDB, "subName", id), min = F(NpcDB, "minLevel", id), max = F(NpcDB, "maxLevel", id),
        rank = F(NpcDB, "rank", id), zone = F(NpcDB, "zoneID", id), spawns = Spawns(F(NpcDB, "spawns", id)) }
    db.npcs[id] = n
    return n
end

local function ObjectName(id)
    return type(ObjectDB) == "table" and F(ObjectDB, "name", id) or nil
end

-- startedBy / finishedBy come as { npcs, objects, items }
local function Givers(t)
    if type(t) ~= "table" then return nil end
    local out = { npcs = List(t[1] or t.npcs or t.creatureStart or t.creatureEnd, 4), objects = List(t[2] or t.objects, 4), items = List(t[3] or t.items, 4) }
    for _, id in ipairs(out.npcs or {}) do ns.NpcInfo(id) end
    if out.objects then
        out.objectNames = {}
        for _, id in ipairs(out.objects) do out.objectNames[#out.objectNames + 1] = ObjectName(id) or "?" end
    end
    return (out.npcs or out.objects or out.items) and out or nil
end

local function Pair(t)
    if type(t) ~= "table" then return nil end
    return { t[1], t[2] }
end

function ns.QuestInfo(id)
    local db = ClaudeCompanionDB
    db.quests = db.quests or {}
    if db.quests[id] then return db.quests[id] end
    if not Have() then return nil end
    local name = F(QuestDB, "name", id)
    if not name then return nil end
    local q = { name = name, level = F(QuestDB, "questLevel", id), req = F(QuestDB, "requiredLevel", id),
        starts = Givers(F(QuestDB, "startedBy", id)), ends = Givers(F(QuestDB, "finishedBy", id)),
        next = F(QuestDB, "nextQuestInChain", id), pre = List(F(QuestDB, "preQuestGroup", id)),
        preOne = List(F(QuestDB, "preQuestSingle", id)), exclusive = List(F(QuestDB, "exclusiveTo", id)),
        zone = F(QuestDB, "zoneOrSort", id), repMin = Pair(F(QuestDB, "requiredMinRep", id)),
        skill = Pair(F(QuestDB, "requiredSkill", id)), sourceItem = F(QuestDB, "sourceItemId", id) }
    local text = F(QuestDB, "objectivesText", id)
    if type(text) == "table" then q.text = table.concat(text, " ") end
    local rr = F(QuestDB, "reputationReward", id)
    if type(rr) == "table" then
        q.rep = {}
        for _, p in ipairs(rr) do if type(p) == "table" then q.rep[#q.rep + 1] = { p[1], p[2] } end end
    end
    db.quests[id] = q
    return q
end

function ns.ItemSources(key)
    local db = ClaudeCompanionDB
    local item = db.items[key]
    if not item or not item.id or item.src or not Have() then return end
    local id = item.id
    if not F(ItemDB, "name", id) then item.src = { none = true }; return end
    local s = { drops = List(F(ItemDB, "npcDrops", id)), objects = List(F(ItemDB, "objectDrops", id), 6),
        inside = List(F(ItemDB, "itemDrops", id), 6), quests = List(F(ItemDB, "questRewards", id), 6),
        vendors = List(F(ItemDB, "vendors", id), 6), starts = F(ItemDB, "startQuest", id),
        teaches = F(ItemDB, "teachesSpell", id), related = List(F(ItemDB, "relatedQuests", id), 6) }
    for _, n in ipairs(s.drops or {}) do ns.NpcInfo(n) end
    for _, n in ipairs(s.vendors or {}) do ns.NpcInfo(n) end
    for _, q in ipairs(s.quests or {}) do ns.QuestInfo(q) end
    if s.starts then ns.QuestInfo(s.starts) end
    if s.objects then
        s.objectNames = {}
        for _, o in ipairs(s.objects) do s.objectNames[#s.objectNames + 1] = ObjectName(o) or "?" end
    end
    item.src = s
end

-- Work list: quests in the log, quests in the journal, every saved item.
-- Runs in small steps so the game never stutters.
local queue, running = {}, false
local function Fill()
    local c = ns.char
    queue = {}
    local seen = {}
    local function q(kind, id) local k = kind .. id; if not seen[k] then seen[k] = true; queue[#queue + 1] = { kind, id } end end
    for _, quest in ipairs((c.snap and c.snap.quests) or {}) do if quest.id then q("quest", quest.id) end end
    for i = #c.journal, math.max(1, #c.journal - 1500), -1 do
        local e = c.journal[i]
        if e.quest then q("quest", e.quest) end
    end
    for key, item in pairs(ClaudeCompanionDB.items) do if not item.src then q("item", key) end end
end

function ns.Enrich(now)
    if not ns.char then return end
    local c = ns.char
    c.caps = c.caps or {}
    c.caps.questieDB = Have() and (type(QuestieDB) == "table" and (QuestieDB.version or QuestieDB.VERSION) or true) or false
    if not Have() then return end
    Fill()
    local function Step(n)
        for _ = 1, n do
            local job = table.remove(queue)
            if not job then return true end
            if job[1] == "quest" then ns.QuestInfo(job[2]) else ns.ItemSources(job[2]) end
        end
    end
    if now then Step(400); return end
    if running then return end
    running = true
    local ticker
    ticker = C_Timer.NewTicker(0.2, function()
        local ok, done = pcall(Step, 15)
        if not ok or done then running = false; ticker:Cancel() end
    end)
end

ns.OnLogout(function() if ns.char then ns.Try("enrich:logout", ns.Enrich, true) end end)
