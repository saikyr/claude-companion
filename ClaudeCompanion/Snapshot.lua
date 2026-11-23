-- Full character snapshot: taken at login, on Sync, /reload and logout.
-- Each part runs on its own, so one blocked API never stops the rest.
local _, ns = ...
local Clean, Copy, Call, Try = ns.Clean, ns.Copy, ns.Call, ns.Try

---------------------------------------------------------------- character
local function Character()
    local x = {}
    x.name = Clean(UnitName("player"))
    -- Forever's UnitName gives "World" for the player; try the other ways
    -- the game names you and keep the first real one (all saved for Claude)
    local guid = Clean(UnitGUID("player"))
    local tries = {
        unitFull = Clean((Call(UnitFullName, "player"))),
        getUnitName = Clean(Call(GetUnitName, "player", false)),
        unmodified = Clean((Call(UnitNameUnmodified, "player"))),
        byGUID = guid and Clean(select(6, Call(GetPlayerInfoByGUID, guid))) or nil,
        playerInfo = C_PlayerInfo and C_PlayerInfo.GetName and Clean(Call(C_PlayerInfo.GetName, PlayerLocation and PlayerLocation.CreateFromUnit and PlayerLocation:CreateFromUnit("player"))) or nil,
    }
    x.nameTries = tries
    if not x.name or x.name == "World" or x.name == UNKNOWNOBJECT then
        for _, k in ipairs({ "byGUID", "playerInfo", "unmodified", "getUnitName", "unitFull" }) do
            local v = tries[k]
            if v and v ~= "World" and v ~= "" and v ~= UNKNOWNOBJECT then x.name = v; break end
        end
    end
    x.realm = Clean(GetRealmName())
    x.level = Clean(UnitLevel("player"))
    x.race = Clean((UnitRace("player")))
    local className, classFile = UnitClass("player")
    x.class, x.classFile = Clean(className), Clean(classFile)
    x.sex = Clean(UnitSex("player"))
    x.faction = Clean((UnitFactionGroup("player")))
    x.guild, x.guildRank = Clean((Call(GetGuildInfo, "player"))), Clean(select(2, Call(GetGuildInfo, "player")))
    x.xp, x.xpMax = Clean(UnitXP("player")), Clean(UnitXPMax("player"))
    x.rested = Clean(Call(GetXPExhaustion))
    x.money = Clean(GetMoney())
    x.hearth = Clean(Call(GetBindLocation))
    x.resting = Clean(Call(IsResting))
    x.health, x.healthMax = Clean(UnitHealth("player")), Clean(UnitHealthMax("player"))
    x.manaMax = Clean(UnitPowerMax("player", 0))
    x.where = ns.Where()
    x.serverTime = Clean(Call(GetServerTime))
    local _, _, _, build = Call(GetBuildInfo)
    x.build = Clean(build)
    x.locale = Clean(Call(GetLocale))
    return x
end

---------------------------------------------------------------- stats
local function Stats()
    local s = { base = {} }
    local names = { "str", "agi", "sta", "int", "spi" }
    for i = 1, 5 do
        local base, stat, pos, neg = Call(UnitStat, "player", i)
        s.base[names[i]] = { base = Clean(base), total = Clean(stat), plus = Clean(pos), minus = Clean(neg) }
    end
    local _, armor = Call(UnitArmor, "player")
    s.armor = Clean(armor)
    s.healing = Clean(Call(GetSpellBonusHealing))
    s.spellDamage = {}
    local schools = { "holy", "fire", "nature", "frost", "shadow", "arcane" }
    for i = 2, 7 do s.spellDamage[schools[i - 1]] = Clean(Call(GetSpellBonusDamage, i)) end
    s.spellCrit = Clean(Call(GetSpellCritChance, 2))
    s.meleeCrit = Clean(Call(GetCritChance))
    s.spellHit = Clean(Call(GetSpellHitModifier))
    s.hit = Clean(Call(GetHitModifier))
    local base, casting = Call(GetManaRegen)
    s.manaRegen, s.manaRegenCasting = Clean(base), Clean(casting)
    s.resist = {}
    local rnames = { "physical", "holy", "fire", "nature", "frost", "shadow", "arcane" }
    for i = 0, 6 do local _, total = Call(UnitResistance, "player", i); s.resist[rnames[i + 1]] = Clean(total) end
    s.dodge, s.parry, s.block = Clean(Call(GetDodgeChance)), Clean(Call(GetParryChance)), Clean(Call(GetBlockChance))
    s.attackPower = Clean((Call(UnitAttackPower, "player")))
    s.speed = Clean((Call(GetUnitSpeed, "player")))
    return s
end

---------------------------------------------------------------- equipped
local SLOT_NAMES = { [0] = "Ammo", "Head", "Neck", "Shoulder", "Shirt", "Chest", "Waist", "Legs", "Feet", "Wrist",
    "Hands", "Finger1", "Finger2", "Trinket1", "Trinket2", "Back", "MainHand", "OffHand", "Ranged", "Tabard" }
ns.SLOT_NAMES = SLOT_NAMES

local function Equipped()
    local out = {}
    for slot = 0, 19 do
        local link = Clean(Call(GetInventoryItemLink, "player", slot))
        if link then
            local cur, max = Call(GetInventoryItemDurability, slot)
            out[#out + 1] = { slot = slot, slotName = SLOT_NAMES[slot], link = link, item = ns.NoteItem(link),
                icon = Clean(Call(GetInventoryItemTexture, "player", slot)),
                count = Clean(Call(GetInventoryItemCount, "player", slot)),
                dur = Clean(cur), durMax = Clean(max) }
        end
    end
    return out
end

---------------------------------------------------------------- containers
local CI = C_Container or {}
function ns.ReadBag(bag)
    local slots = Clean(Call(CI.GetContainerNumSlots or GetContainerNumSlots, bag))
    if not slots or slots <= 0 then return nil end
    local b = { id = bag, slots = slots, name = Clean(Call(CI.GetBagName or GetBagName, bag)), items = {} }
    if bag >= 1 and CI.ContainerIDToInventoryID then
        local inv = Call(CI.ContainerIDToInventoryID, bag)
        if inv then b.link = Clean(Call(GetInventoryItemLink, "player", inv)); ns.NoteItem(b.link) end
    end
    local used = 0
    for s = 1, slots do
        local info = Call(CI.GetContainerItemInfo, bag, s)
        if type(info) == "table" then
            local link = Clean(info.hyperlink)
            if link then
                used = used + 1
                b.items[#b.items + 1] = { slot = s, link = link, item = ns.NoteItem(link),
                    id = Clean(info.itemID), count = Clean(info.stackCount), q = Clean(info.quality),
                    icon = Clean(info.iconFileID), bound = Clean(info.isBound), noValue = Clean(info.hasNoValue),
                    locked = Clean(info.isLocked) }
            end
        end
    end
    b.used = used
    return b
end

local function Bags()
    local out = {}
    local ids = { 0, 1, 2, 3, 4 }
    if Enum and Enum.BagIndex then
        if Enum.BagIndex.ReagentBag then ids[#ids + 1] = Enum.BagIndex.ReagentBag end
        if Enum.BagIndex.Keyring then ids[#ids + 1] = Enum.BagIndex.Keyring end
    end
    if KEYRING_CONTAINER then ids[#ids + 1] = KEYRING_CONTAINER end
    local seen = {}
    for _, id in ipairs(ids) do
        if not seen[id] then
            seen[id] = true
            local b = ns.ReadBag(id)
            if b then out[#out + 1] = b end
        end
    end
    return out
end

---------------------------------------------------------------- gear sets
local function GearSets()
    local E = C_EquipmentSet
    if not E then return nil end
    local ids = Call(E.GetEquipmentSetIDs)
    if type(ids) ~= "table" then return nil end
    local out = {}
    for _, id in ipairs(ids) do
        local name, icon, setID, isEquipped, numItems, numEquipped, numInBags, numLost, numIgnored = Call(E.GetEquipmentSetInfo, id)
        local items = {}
        local itemIDs = Call(E.GetItemIDs, id)
        if type(itemIDs) == "table" then
            for slot, itemID in pairs(itemIDs) do
                if Clean(itemID) and itemID > 0 then items[#items + 1] = { slot = slot, slotName = SLOT_NAMES[slot], id = itemID } end
            end
        end
        local specIndex = E.GetEquipmentSetAssignedSpec and Clean(Call(E.GetEquipmentSetAssignedSpec, id))
        out[#out + 1] = { id = Clean(setID) or id, name = Clean(name), icon = Clean(icon), equipped = Clean(isEquipped),
            numItems = Clean(numItems), numEquipped = Clean(numEquipped), numInBags = Clean(numInBags),
            numLost = Clean(numLost), spec = specIndex, items = items }
    end
    return out
end

---------------------------------------------------------------- talents
-- Classic talent API, read for every talent group (dual spec), with the
-- modern trait-tree API as a fallback for the active spec only.
local function ClassicTalents(group)
    local tabs = Clean(Call(GetNumTalentTabs)) or 0
    if tabs == 0 then return nil end
    local out = { group = group, tabs = {} }
    for tab = 1, tabs do
        local r = { Call(GetTalentTabInfo, tab, false, false, group) }
        local tabName, tabIcon
        for _, v in ipairs(r) do
            v = Clean(v)
            if type(v) == "string" and not tabName and v ~= "" and not v:match("^%d+$") then tabName = v end
        end
        local t = { name = tabName, points = 0, talents = {} }
        local n = Clean(Call(GetNumTalents, tab, false, false)) or 0
        for i = 1, n do
            local name, icon, tier, column, rank, maxRank = Call(GetTalentInfo, tab, i, false, false, group)
            rank = Clean(rank) or 0
            t.talents[#t.talents + 1] = { i = i, name = Clean(name), icon = Clean(icon), tier = Clean(tier),
                col = Clean(column), rank = rank, max = Clean(maxRank) }
            t.points = t.points + rank
        end
        out.tabs[tab] = t
    end
    return out
end

-- Forever uses the modern talent system (C_ClassTalents / C_Traits) with
-- classic trees. We save every node with its position, so the page can
-- draw the tree, plus spell tooltips for each talent.
local function SpellName(id) return id and Clean(Call(C_Spell and C_Spell.GetSpellName or GetSpellInfo, id)) end

local function TraitTree(configID)
    if not (C_ClassTalents and C_Traits) then return nil end
    configID = configID or Clean(Call(C_ClassTalents.GetActiveConfigID))
    if not configID then return nil end
    local cfg = Call(C_Traits.GetConfigInfo, configID)
    if type(cfg) ~= "table" or type(cfg.treeIDs) ~= "table" then return nil end
    local out = { configID = configID, loadout = Clean(cfg.name), trees = {}, points = 0 }
    out.importString = Clean(Call(C_Traits.GenerateImportString, configID))
    for _, treeID in ipairs(cfg.treeIDs) do
        local tree = { id = Clean(treeID), nodes = {}, points = 0 }
        local nodes = Call(C_Traits.GetTreeNodes, treeID)
        if type(nodes) == "table" then
            for _, nodeID in ipairs(nodes) do
                local node = Call(C_Traits.GetNodeInfo, configID, nodeID)
                if type(node) == "table" and Clean(node.ID) ~= 0 and Clean(node.isVisible) ~= false then
                    local entryID = (type(node.activeEntry) == "table" and Clean(node.activeEntry.entryID))
                        or (type(node.entryIDs) == "table" and Clean(node.entryIDs[1]))
                    local spellID, icon
                    if entryID then
                        local entry = Call(C_Traits.GetEntryInfo, configID, entryID)
                        local defID = type(entry) == "table" and Clean(entry.definitionID)
                        local def = defID and Call(C_Traits.GetDefinitionInfo, defID)
                        if type(def) == "table" then
                            spellID = Clean(def.spellID) or Clean(def.overriddenSpellID)
                            icon = Clean(def.overrideIcon)
                        end
                    end
                    local rank = Clean(node.activeRank) or Clean(node.currentRank) or 0
                    local n = { node = Clean(nodeID), x = Clean(node.posX), y = Clean(node.posY), rank = rank,
                        max = Clean(node.maxRanks), spell = spellID, name = SpellName(spellID), sub = Clean(node.subTreeID) }
                    n.icon = icon or (spellID and Clean(Call(C_Spell and C_Spell.GetSpellTexture or GetSpellTexture, spellID)))
                    if spellID then ns.NoteSpell(spellID) end
                    if type(node.visibleEdges) == "table" then
                        for _, e in ipairs(node.visibleEdges) do
                            local t = type(e) == "table" and Clean(e.targetNode)
                            if t then n.to = n.to or {}; n.to[#n.to + 1] = t end
                        end
                    end
                    tree.nodes[#tree.nodes + 1] = n
                    tree.points = tree.points + rank
                end
            end
        end
        out.points = out.points + tree.points
        out.trees[#out.trees + 1] = tree
    end
    return out
end

-- Talents of the spec you're NOT in: the game may keep them as a saved
-- config. We look for every config ID it will tell us about and read
-- each one; caps.loadouts shows what Forever allows.
local function OtherConfigs()
    local c = ns.char
    if not (C_ClassTalents and C_Traits) then return end
    local active = Clean(Call(C_ClassTalents.GetActiveConfigID))
    local found, probe = {}, {}
    local function add(id, how)
        id = Clean(id)
        if type(id) == "number" and id ~= active and not found[id] then found[id] = how end
    end
    local S = C_SpecializationInfo
    local n = S and Clean(Call(S.GetNumSpecializations)) or 0
    probe.numSpecs = n
    for i = 1, n do
        local specID = Clean(Call(S.GetSpecializationInfo, i))
        local ids = specID and Call(C_ClassTalents.GetConfigIDsBySpecID, specID)
        if type(ids) == "table" then for _, id in ipairs(ids) do add(id, "spec" .. i) end end
    end
    for g = 1, 2 do
        local ids = Call(C_ClassTalents.GetConfigIDsBySpecID, g)
        if type(ids) == "table" then for _, id in ipairs(ids) do add(id, "group" .. g) end end
    end
    add(Call(C_ClassTalents.GetLastSelectedSavedConfigID, 0), "lastSaved")
    if C_Traits.GetConfigIDBySystemID then add(Call(C_Traits.GetConfigIDBySystemID, 1), "system1") end
    probe.active = active
    probe.found = {}
    c.loadouts = c.loadouts or {}
    for id, how in pairs(found) do
        local t = TraitTree(id)
        probe.found[#probe.found + 1] = { id = id, how = how, points = t and t.points }
        if t and t.points > 0 then t.how = how; t.taken = ns.Now(); c.loadouts[tostring(id)] = t end
    end
    c.caps = c.caps or {}
    c.caps.loadouts = probe
end

local function ActiveGroup()
    local g = Clean(Call(GetActiveTalentGroup))
    if not g and C_SpecializationInfo then g = Clean(Call(C_SpecializationInfo.GetActiveSpecGroup)) end
    return g or 1
end
ns.ActiveGroup = ActiveGroup

local function SpecInfo()
    if not C_SpecializationInfo then return nil end
    local idx = Clean(Call(C_SpecializationInfo.GetSpecialization))
    if not idx then return nil end
    local _, name, _, icon = Call(C_SpecializationInfo.GetSpecializationInfo, idx)
    return Clean(name), Clean(icon), idx
end

local function Talents()
    local c = ns.char
    local g = ActiveGroup()
    c.specs[g] = c.specs[g] or {}
    local sp = c.specs[g]
    local name, icon = SpecInfo()
    sp.specName, sp.specIcon = name, icon
    if GetTalentInfo then
        local t = ClassicTalents(g)
        if t then
            sp.talents = t
            local pts = {}
            for i, tab in ipairs(t.tabs) do pts[i] = tab.points end
            sp.summary = (name or "Spec " .. g) .. " " .. table.concat(pts, "/")
        end
    end
    local tree = TraitTree()
    if tree then
        sp.traits = tree
        sp.summary = (name or "Spec " .. g) .. " (" .. tree.points .. " points)"
    end
    Try("talents:other", OtherConfigs)
    sp.talentsTaken = ns.Now()
    local groups = Clean(Call(GetNumTalentGroups))
        or (C_SpecializationInfo and Clean(Call(C_SpecializationInfo.GetNumSpecGroups)))
    return { active = g, groups = groups, specName = name }
end

---------------------------------------------------------------- action bars
local BAR_BINDINGS = {
    { from = 1, to = 12, cmd = "ACTIONBUTTON" },
    { from = 61, to = 72, cmd = "MULTIACTIONBAR1BUTTON" },
    { from = 49, to = 60, cmd = "MULTIACTIONBAR2BUTTON" },
    { from = 25, to = 36, cmd = "MULTIACTIONBAR3BUTTON" },
    { from = 37, to = 48, cmd = "MULTIACTIONBAR4BUTTON" },
}

local function SlotKey(slot)
    for _, b in ipairs(BAR_BINDINGS) do
        if slot >= b.from and slot <= b.to then
            local k = Clean(Call(GetBindingKey, b.cmd .. (slot - b.from + 1)))
            return k
        end
    end
end

function ns.ActionBars()
    local out = {}
    for slot = 1, 180 do
        if Call(HasAction, slot) then
            local kind, id, sub = Call(GetActionInfo, slot)
            kind, id, sub = Clean(kind), Clean(id), Clean(sub)
            local a = { slot = slot, kind = kind, id = id, sub = sub, icon = Clean(Call(GetActionTexture, slot)), key = SlotKey(slot) }
            if kind == "spell" and id then
                a.name = Clean(Call(C_Spell and C_Spell.GetSpellName or GetSpellInfo, id))
                ns.NoteSpell(id)
            elseif kind == "item" and id then
                a.name = Clean(Call(C_Item and C_Item.GetItemNameByID or GetItemInfo, id))
            elseif kind == "macro" and id then
                local name, icon, body = Call(GetMacroInfo, id)
                a.name, a.body = Clean(name), Clean(body)
            end
            a.text = Clean(Call(GetActionText, slot))
            out[#out + 1] = a
        end
    end
    local c = ns.char
    local g = ActiveGroup()
    c.specs[g] = c.specs[g] or {}
    c.specs[g].actionBars = out
    c.specs[g].barsTaken = ns.Now()
    return #out
end

local function Macros()
    local global, perChar = Call(GetNumMacros)
    local out = {}
    local function add(i, scope)
        local name, icon, body = Call(GetMacroInfo, i)
        if Clean(name) then out[#out + 1] = { index = i, scope = scope, name = Clean(name), icon = Clean(icon), body = Clean(body) } end
    end
    for i = 1, Clean(global) or 0 do add(i, "account") end
    local base = MAX_ACCOUNT_MACROS or 120
    for i = base + 1, base + (Clean(perChar) or 0) do add(i, "character") end
    return out
end

local function KeyBindings()
    local out = {}
    local n = Clean(Call(GetNumBindings)) or 0
    for i = 1, n do
        local r = { Call(GetBinding, i) }
        local cmd = Clean(r[1])
        local keys = {}
        for j = 3, #r do local k = Clean(r[j]); if type(k) == "string" and k ~= "" then keys[#keys + 1] = k end end
        if cmd and #keys > 0 then out[#out + 1] = { cmd = cmd, keys = keys } end
    end
    return out
end

---------------------------------------------------------------- spellbook
local function Spellbook()
    local out = {}
    local SB = C_SpellBook
    if SB and SB.GetNumSpellBookSkillLines then
        local bank = (Enum and Enum.SpellBookSpellBank and Enum.SpellBookSpellBank.Player) or 0
        for line = 1, Clean(Call(SB.GetNumSpellBookSkillLines)) or 0 do
            local info = Call(SB.GetSpellBookSkillLineInfo, line)
            if type(info) == "table" then
                local tab = { name = Clean(info.name), spells = {} }
                local off, num = Clean(info.itemIndexOffset) or 0, Clean(info.numSpellBookItems) or 0
                for i = off + 1, off + num do
                    local s = Call(SB.GetSpellBookItemInfo, i, bank)
                    if type(s) == "table" then
                        if Clean(s.spellID) and not Clean(s.isOffSpec) then ns.NoteSpell(Clean(s.spellID)) end
                        tab.spells[#tab.spells + 1] = { name = Clean(s.name), rank = Clean(s.subName), id = Clean(s.spellID) or Clean(s.actionID),
                            icon = Clean(s.iconID), passive = Clean(s.isPassive), offSpec = Clean(s.isOffSpec) }
                    end
                end
                out[#out + 1] = tab
            end
        end
    elseif GetNumSpellTabs then
        for t = 1, Clean(Call(GetNumSpellTabs)) or 0 do
            local name, _, off, num = Call(GetSpellTabInfo, t)
            local tab = { name = Clean(name), spells = {} }
            for i = (Clean(off) or 0) + 1, (Clean(off) or 0) + (Clean(num) or 0) do
                local sname, rank, id = Call(GetSpellBookItemName, i, BOOKTYPE_SPELL or "spell")
                tab.spells[#tab.spells + 1] = { name = Clean(sname), rank = Clean(rank), id = Clean(id),
                    icon = Clean(Call(GetSpellBookItemTexture, i, BOOKTYPE_SPELL or "spell")) }
            end
            out[#out + 1] = tab
        end
    end
    return out
end

---------------------------------------------------------------- skills, reputation, currencies
local function Skills()
    local out = {}
    if C_SkillInfo and C_SkillInfo.GetNumSkillLines then
        for i = 1, Clean(Call(C_SkillInfo.GetNumSkillLines)) or 0 do
            local s = ns.Pick(Call(C_SkillInfo.GetSkillLineInfo, i), { "name", "skillID", "rank", "maxRank", "modifier", "isHeader", "skillLineCategoryID" })
            if s then out[#out + 1] = s end
        end
    elseif GetNumSkillLines then
        for i = 1, Clean(Call(GetNumSkillLines)) or 0 do
            local name, header, _, rank, temp, mod, max = Call(GetSkillLineInfo, i)
            out[#out + 1] = { name = Clean(name), isHeader = Clean(header), rank = Clean(rank), mod = Clean(mod), max = Clean(max) }
        end
    end
    return out
end

local function Reputation()
    local out = {}
    local R = C_Reputation
    if R and R.GetNumFactions and R.GetFactionDataByIndex then
        for i = 1, Clean(Call(R.GetNumFactions)) or 0 do
            local f = ns.Pick(Call(R.GetFactionDataByIndex, i), { "name", "factionID", "reaction", "currentStanding",
                "currentReactionThreshold", "nextReactionThreshold", "isHeader", "isHeaderWithRep", "isChild", "isWatched", "atWarWith" })
            if f then out[#out + 1] = f end
        end
    elseif GetNumFactions then
        for i = 1, Clean(Call(GetNumFactions)) or 0 do
            local name, _, standing, bmin, bmax, val, _, _, header, collapsed, hasRep, _, _, id = Call(GetFactionInfo, i)
            out[#out + 1] = { name = Clean(name), reaction = Clean(standing), currentReactionThreshold = Clean(bmin),
                nextReactionThreshold = Clean(bmax), currentStanding = Clean(val), isHeader = Clean(header),
                isCollapsed = Clean(collapsed), factionID = Clean(id) }
        end
    end
    return out
end

local function Currencies()
    local out = {}
    local CI2 = C_CurrencyInfo
    if CI2 and CI2.GetCurrencyListSize then
        for i = 1, Clean(Call(CI2.GetCurrencyListSize)) or 0 do
            local c = ns.Pick(Call(CI2.GetCurrencyListInfo, i), { "name", "currencyID", "quantity", "maxQuantity", "iconFileID", "isHeader", "quality" })
            if c then out[#out + 1] = c end
        end
    end
    local honor = Clean(Call(GetHonorCurrency)); if honor then out[#out + 1] = { name = "Honor", quantity = honor } end
    return out
end

---------------------------------------------------------------- quests
-- What a quest in your log pays: items, choice of items, gold, XP.
local function QuestRewards(id)
    local Q = C_QuestLog
    if not GetNumQuestLogRewards then return nil end
    local prev = Q.GetSelectedQuest and Clean(Call(Q.GetSelectedQuest))
    if Q.SetSelectedQuest then Call(Q.SetSelectedQuest, id) end
    local r = { items = {}, choices = {} }
    for i = 1, Clean(Call(GetNumQuestLogRewards, id)) or 0 do
        local name, tex, count, quality, usable, itemID = Call(GetQuestLogRewardInfo, i, id)
        local link = Clean(Call(GetQuestLogItemLink, "reward", i))
        itemID = Clean(itemID)
        if not link and itemID then
            -- item not loaded yet: ask the game for it and use a plain item string
            if C_Item and C_Item.RequestLoadItemDataByID then Call(C_Item.RequestLoadItemDataByID, itemID) end
            link = "item:" .. itemID
        end
        r.items[#r.items + 1] = { id = Clean(itemID), name = Clean(name), count = Clean(count), q = Clean(quality), link = link, item = ns.NoteItem(link) }
    end
    for i = 1, Clean(Call(GetNumQuestLogChoices, id)) or 0 do
        local name, tex, count, quality, usable, itemID = Call(GetQuestLogChoiceInfo, i)
        local link = Clean(Call(GetQuestLogItemLink, "choice", i))
        itemID = Clean(itemID)
        if not link and itemID then
            -- item not loaded yet: ask the game for it and use a plain item string
            if C_Item and C_Item.RequestLoadItemDataByID then Call(C_Item.RequestLoadItemDataByID, itemID) end
            link = "item:" .. itemID
        end
        r.choices[#r.choices + 1] = { id = Clean(itemID), name = Clean(name), count = Clean(count), q = Clean(quality), link = link, item = ns.NoteItem(link) }
    end
    r.money = Clean(Call(GetQuestLogRewardMoney, id))
    r.xp = Clean(Call(GetQuestLogRewardXP, id))
    local spell = Clean(Call(GetQuestLogRewardSpell))
    if spell then r.spell = spell end
    if prev and Q.SetSelectedQuest then Call(Q.SetSelectedQuest, prev) end
    if #r.items == 0 and #r.choices == 0 and not (r.money and r.money > 0) and not (r.xp and r.xp > 0) then return nil end
    return r
end

local function QuestLog()
    local out = {}
    local Q = C_QuestLog
    if Q and Q.GetNumQuestLogEntries and Q.GetInfo then
        local header
        for i = 1, Clean(Call(Q.GetNumQuestLogEntries)) or 0 do
            local info = Call(Q.GetInfo, i)
            if type(info) == "table" then
                if Clean(info.isHeader) then
                    header = Clean(info.title)
                else
                    local id = Clean(info.questID)
                    local q = { id = id, title = Clean(info.title), level = Clean(info.level), suggestedGroup = Clean(info.suggestedGroup),
                        header = header, objectives = {} }
                    if id then
                        q.complete = Clean(Call(Q.IsComplete, id))
                        q.ready = Clean(Call(Q.ReadyForTurnIn, id))
                        q.failed = Clean(Call(Q.IsFailed, id))
                        q.timer = Clean(Call(Q.GetTimeAllowed, id))
                        q.rewards = QuestRewards(id)
                        local objs = Call(Q.GetQuestObjectives, id)
                        if type(objs) == "table" then
                            for _, o in ipairs(objs) do
                                q.objectives[#q.objectives + 1] = { text = Clean(o.text), done = Clean(o.finished),
                                    have = Clean(o.numFulfilled), need = Clean(o.numRequired), type = Clean(o.type) }
                            end
                        end
                    end
                    out[#out + 1] = q
                end
            end
        end
    elseif GetNumQuestLogEntries then
        local header
        for i = 1, Clean(Call(GetNumQuestLogEntries)) or 0 do
            local title, level, group, isHeader, _, isComplete, _, id = Call(GetQuestLogTitle, i)
            if Clean(isHeader) then header = Clean(title)
            else out[#out + 1] = { id = Clean(id), title = Clean(title), level = Clean(level), complete = Clean(isComplete), header = header } end
        end
    end
    return out
end

local function CompletedQuests()
    if not (C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs) then return nil end
    local ids = Call(C_QuestLog.GetAllCompletedQuestIDs)
    if type(ids) ~= "table" then return nil end
    local out = {}
    for _, id in ipairs(ids) do id = Clean(id); if id then out[#out + 1] = id end end
    table.sort(out)
    return out
end

---------------------------------------------------------------- group
function ns.Group()
    local out = {}
    local n = Clean(Call(GetNumGroupMembers)) or 0
    if n == 0 then return out end
    local raid = Clean(Call(IsInRaid))
    for i = 1, (raid and n or n - 1) do
        local unit = (raid and "raid" or "party") .. i
        local name, realm = UnitName(unit)
        name = Clean(name)
        if name then
            local cls = select(2, UnitClass(unit))
            out[#out + 1] = { name = name, realm = Clean(realm), level = Clean(UnitLevel(unit)), class = Clean(cls),
                online = Clean(Call(UnitIsConnected, unit)) }
        end
    end
    return out
end

---------------------------------------------------------------- buffs (useful for consumables)
local function Buffs()
    local out = {}
    local A = C_UnitAuras
    for i = 1, 40 do
        local name, icon, count, duration, expires, spellID
        if A and A.GetAuraDataByIndex then
            local a = Call(A.GetAuraDataByIndex, "player", i, "HELPFUL")
            if type(a) ~= "table" then break end
            name, icon, count, duration, expires, spellID = a.name, a.icon, a.applications, a.duration, a.expirationTime, a.spellId
        else
            local r = { Call(UnitBuff, "player", i) }
            if not r[1] then break end
            name, icon, count, duration, expires, spellID = r[1], r[2], r[3], r[5], r[6], r[10]
        end
        name = Clean(name)
        if name then
            local left = Clean(expires) and Clean(expires) > 0 and (Clean(expires) - GetTime()) or nil
            out[#out + 1] = { name = name, icon = Clean(icon), stacks = Clean(count), spell = Clean(spellID), left = left and math.floor(left) or nil }
        end
    end
    return out
end

---------------------------------------------------------------- the full snapshot
local PARTS = {
    { "character", Character }, { "stats", Stats }, { "equipped", Equipped }, { "bags", Bags },
    { "gearSets", GearSets }, { "talents", Talents }, { "macros", Macros }, { "bindings", KeyBindings },
    { "spellbook", Spellbook }, { "skills", Skills }, { "reputation", Reputation }, { "currencies", Currencies },
    { "quests", QuestLog }, { "completedQuests", CompletedQuests }, { "group", ns.Group }, { "buffs", Buffs },
}

-- When PLAYER_LOGOUT fires the game has often already emptied the character: bags, worn gear,
-- spellbook, gear sets, completed quests and buffs read empty, and money and max mana read 0.
-- A logout snapshot taken then would replace good data with nothing, so on logout any part that
-- reads empty keeps the previous snapshot's value, and so do those zeros. snap.kept lists what was
-- kept (with its time in snap.keptFrom), so nothing kept passes as freshly read.
local function Empty(name, v)
    if type(v) ~= "table" or next(v) == nil then return true end
    if name == "bags" then                           -- bag frames can still report slots with no items in them
        for _, b in ipairs(v) do if b.items and #b.items > 0 then return false end end
        return true
    end
    if name == "skills" then                         -- at logout the game lists only the headers (Weapon Skills...), no skills
        for _, k in ipairs(v) do if type(k) == "table" and not k.isHeader then return false end end
        return true
    end
    return false
end
local KEEP_IF_ZERO = { "money", "manaMax", "healthMax" }
local function KeepAtLogout(snap, prev)
    if not prev then return end
    local kept = {}
    for _, p in ipairs(PARTS) do
        local name = p[1]
        if Empty(name, snap[name]) and not Empty(name, prev[name]) then snap[name] = prev[name]; kept[#kept + 1] = name end
    end
    local ch, old = snap.character, prev.character
    if type(ch) == "table" and type(old) == "table" then
        for _, k in ipairs(KEEP_IF_ZERO) do
            if (ch[k] == nil or ch[k] == 0) and (old[k] or 0) > 0 then ch[k] = old[k]; kept[#kept + 1] = "character." .. k end
        end
    end
    if #kept > 0 then snap.kept, snap.keptFrom = kept, prev.keptFrom or prev.taken end
end
ns.KeepAtLogout = KeepAtLogout

function ns.Snapshot(reason)
    local c = ns.char
    if not c then return end
    local snap = { taken = ns.Now(), reason = reason, version = ns.VERSION }
    for _, p in ipairs(PARTS) do
        local name, fn = p[1], p[2]
        Try("snap:" .. name, function() snap[name] = fn() end)
    end
    Try("snap:actionBars", ns.ActionBars)
    snap.activeSpec = ActiveGroup()
    if reason == "logout" then Try("snap:keep", KeepAtLogout, snap, c.snap) end
    c.snap = snap
    Try("bank:cache", ns.BankFromCache)
    -- one compact line per snapshot, for graphs over time
    local ch = snap.character or {}
    local last = c.history[#c.history]
    local line = { t = snap.taken, level = ch.level, xp = ch.xp, xpMax = ch.xpMax, money = ch.money,
        zone = ch.where and ch.where.zone, spec = snap.activeSpec, reason = reason }
    if not last or last.money ~= line.money or last.xp ~= line.xp or last.level ~= line.level or snap.taken - last.t > 3600 then
        ns.Push(c.history, line, ns.LIMITS.history)
    end
    return snap
end

ns.OnLogin(function()
    -- item data and talents finish loading a few seconds after login
    C_Timer.After(6, function() Try("snap:login", ns.Snapshot, "login") end)
    C_Timer.After(20, function() Try("items:refresh", ns.RefreshItems) end)
end)

ns.OnLogout(function()
    ns.Snapshot("logout")
    ns.RefreshItems()
    ns.char.lastSync = ns.Now()
    ns.char.syncs = (ns.char.syncs or 0) + 1
end)

-- keep the active spec's bars and talents fresh when they change
ns.On("ACTIONBAR_SLOT_CHANGED", function() if ns.char then ns.Soon("bars", 5, ns.ActionBars) end end)
ns.On("ACTIVE_TALENT_GROUP_CHANGED", function(new, old)
    if not ns.char then return end
    ns.Log("spec", { to = Clean(new), from = Clean(old) })
    C_Timer.After(2, function() Try("snap:actionBars", ns.ActionBars); Try("snap:talents", Talents) end)
end)
ns.On("CHARACTER_POINTS_CHANGED", function() if ns.char then ns.Soon("talents", 3, Talents) end end)
ns.On("PLAYER_TALENT_UPDATE", function() if ns.char then ns.Soon("talents", 3, Talents) end end)
