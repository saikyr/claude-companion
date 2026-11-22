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
