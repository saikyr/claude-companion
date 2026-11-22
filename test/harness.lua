-- Minimal WoW API mock to run the addon in plain Lua 5.1
local SECRET = setmetatable({}, {__tostring=function() return "SECRET" end})
function issecretvalue(v) return v == SECRET end
local timers = {}
C_Timer = { After = function(d, fn) table.insert(timers, fn) end, NewTicker = function() return { Cancel = function() end } end }
function IsShiftKeyDown() return false end
local function obj()
  local o = {}
  return setmetatable(o, {__index = function(t, k)
     if k == "GetStringHeight" then return function() return 100 end end
     if k == "IsShown" then return function() return false end end
     if k == "GetText" then return function() return "" end end
     if type(k)=="string" and k:match("^Create") then return function() return obj() end end
     return function(self, ...) return nil end end})
end
local frames = {}
function CreateFrame(kind, name, parent, tmpl)
  local f = obj()
  local scripts = {}
  rawset(f, "SetScript", function(self, k, fn) scripts[k] = fn end)
  rawset(f, "RegisterEvent", function(self, ev) frames[#frames+1] = {f=self, ev=ev, scripts=scripts} end)
  rawset(f, "_scripts", scripts)
  if name then _G[name] = f end
  return f
end
function Fire(ev, ...)
  for _, r in ipairs(frames) do if r.ev == ev and r.scripts.OnEvent then r.scripts.OnEvent(r.f, ev, ...) end end
end
function RunTimers() local n=0 while #timers > 0 and n < 50 do local t = timers; timers = {}; for _, fn in ipairs(t) do fn() end n=n+1 end end
UIParent = obj(); UISpecialFrames = {}; GameTooltip = obj(); SlashCmdList = {}
DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) print("CHAT: " .. m) end }
local clock = 1795200000
function time() return clock end
function Advance(s) clock = clock + s end
function GetTime() return clock - 1795000000 end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function strsplit(sep, s) local out = {} for p in (s..sep):gmatch("(.-)%"..sep) do out[#out+1]=p end return unpack(out) end
function hooksecurefunc(t, name, fn) if type(t) == "string" then local orig=_G[t]; _G[t]=function(...) local r={orig(...)} fn(...) return unpack(r) end else local orig=t[name]; t[name]=function(...) local r={orig(...)} fn(...) return unpack(r) end end end
function InCombatLockdown() return false end
function ReloadUI() print("RELOAD") end
function UnitName(u) if u=="player" then return "Gabriel" elseif u=="target" then return "Son of Arkkoroc" end return nil end
function GetRealmName() return "" end
function GetNormalizedRealmName() return "Atlas" end
function UnitLevel() return 58 end
function UnitRace() return "Human","Human" end
function UnitClass() return "Priest","PRIEST" end
function UnitSex() return 2 end
function UnitFactionGroup() return "Alliance" end
function GetGuildInfo() return nil end
local xp = 1000
function UnitXP() return xp end
function UnitXPMax() return 200000 end
function SetXP(v) xp = v end
function GetXPExhaustion() return 5000 end
local money = 480000
function GetMoney() return money end
function SetMoney(v) money = v end
function GetBindLocation() return "Stormwind" end
function IsResting() return false end
function UnitHealth() return SECRET end
function UnitHealthMax() return 3000 end
function UnitPowerMax() return SECRET end
function GetServerTime() return clock end
function GetBuildInfo() return "1.60.1","123","Nov","16001" end
function GetLocale() return "enUS" end
function GetRealZoneText() return "Azshara" end
function GetSubZoneText() return "" end
C_Map = { GetBestMapForUnit = function() return 1447 end, GetPlayerMapPosition = function() return { GetXY = function(self) return 0.4567, 0.789 end } end }
function UnitStat(u,i) return 50, 100+i, 5, 0 end
function UnitArmor() return 900, 1000 end
function GetSpellBonusHealing() return 450 end
function GetSpellBonusDamage(i) return 200 end
function GetSpellCritChance() return 5.5 end
function GetCritChance() return 3 end
function GetManaRegen() return SECRET, SECRET end
function UnitResistance(u,i) return 0, 10 end
function GetInventoryItemLink(u, slot) if slot == 1 then return "|cff0070dd|Hitem:10041::::::::58:::::|h[Dalaran Wizard's Robe]|h|r" end if slot==16 then return SECRET end end
function GetInventoryItemTexture() return 132644 end
function GetInventoryItemCount() return 1 end
function GetInventoryItemDurability() return 50, 60 end
C_Item = { GetItemInfo = function(link) return "Test Item", link, 3, 55, 50, "Armor", "Cloth", 1, "INVTYPE_CHEST", 132644, 1234, 4, 1, 1 end,
  GetItemStats = function() return { ITEM_MOD_INTELLECT_SHORT = 12, ITEM_MOD_SPIRIT_SHORT = SECRET } end,
  GetItemNameByID = function() return "Test Item" end, GetItemLink = function() return "|cff1eff00|Hitem:4338::|h[Mageweave Cloth]|h|r" end, GetItemID = function() return 4338 end }
C_TooltipInfo = { GetHyperlink = function() return { lines = { { leftText = "Test Item", leftColor = { r = 0, g = 0.44, b = 0.87 } }, { leftText = "Binds when equipped" }, { leftText = SECRET } } } end }
C_Container = {
  GetContainerNumSlots = function(b) if b == 0 then return 16 elseif b == -1 then return 24 elseif b==5 then return 20 end return 0 end,
  GetBagName = function(b) return "Bag " .. b end,
  GetContainerItemInfo = function(b, s) if s == 1 then return { hyperlink = "|cffffffff|Hitem:4338::|h[Mageweave Cloth]|h|r", stackCount = 20, itemID = 4338, quality = 1, iconFileID = 132892, isBound = false } end end,
  ContainerIDToInventoryID = function(b) return 19 + b end }
NUM_BAG_SLOTS = 4
C_EquipmentSet = { GetEquipmentSetIDs = function() return { 0, 1 } end, GetEquipmentSetInfo = function(id) return id==0 and "Holy" or "Shadow", 1234, id, id==0, 17, 17, 0, 0, 0 end, GetItemIDs = function() return { [1] = 10041, [5] = -1 } end }
C_SpecializationInfo = { GetActiveSpecGroup = function() return 2 end, GetSpecialization = function() return 3 end, GetSpecializationInfo = function() return 258, "Shadow", "", 136207 end, GetNumSpecGroups = function() return 2 end }
C_ClassTalents = { GetActiveConfigID = function() return 77 end }
C_Traits = { GetConfigInfo = function() return { name = "Shadow", treeIDs = { 1 } } end, GenerateImportString = function() return "ABC" end,
  GetTreeNodes = function() local t={} for g=0,2 do for r=0,6 do for c=0,3 do if (r+c+g)%2==0 then t[#t+1]=1000+g*100+r*10+c end end end end return t end,
  GetNodeInfo = function(cfg, id) local g=math.floor((id-1000)/100); local r=math.floor((id-1000)%100/10); local c=(id-1000)%10; return { ID = id, posX = g*4200 + c*600 + 300, posY = r*600+300, activeRank = (g==2 and r<5) and 2 or 0, maxRanks = (c%2==0) and 5 or 2, isVisible = true, activeEntry = { entryID = id + 1000 } } end,
  GetEntryInfo = function(cfg, e) return { definitionID = e } end, GetDefinitionInfo = function(d) return { spellID = 15259 } end }
C_TooltipInfo.GetSpellByID = function() return { lines = { { leftText = "Darkness", leftColor = { r = 1, g = 1, b = 1 } }, { leftText = "Increases shadow damage by 10%.", leftColor = { r = 1, g = 0.82, b = 0 } } } } end
function GetNumTalentTabs_unused() return 3 end
function GetTalentTabInfo(t) return 200+t, ({"Discipline","Holy","Shadow"})[t], "desc", 1234, 0 end
function GetNumTalents() return 3 end
function GetTalentInfo_unused(tab, i, a, b, g) return "Talent"..tab..i, 123, 1, i, (g==1 and tab==2) and 5 or (g==2 and tab==3 and 5 or 0), 5 end

function HasAction(s) return s <= 3 end
function GetActionInfo(s) if s==1 then return "spell", 2050 elseif s==2 then return "macro", 1 else return "item", 13444 end end
function GetActionTexture() return 135913 end
function GetActionText() return nil end
function GetBindingKey(cmd) if cmd=="ACTIONBUTTON1" then return "1" end end
C_Spell = { GetSpellName = function(id) return "Lesser Heal" end, GetSpellTexture = function() return 136223 end }
function GetMacroInfo(i) if i==1 or i==121 then return "Tag", 1234, "/cast Shadow Word: Pain" end end
function GetNumMacros() return 1, 1 end
function GetNumBindings() return 2 end
function GetBinding(i) if i==1 then return "MOVEFORWARD", "Movement", "W", "UP" else return "TOGGLEMAP", "UI" end end
C_SpellBook = { GetNumSpellBookSkillLines = function() return 1 end, GetSpellBookSkillLineInfo = function() return { name = "Holy", itemIndexOffset = 0, numSpellBookItems = 2 } end,
  GetSpellBookItemInfo = function(i) return { name = "Heal", subName = "Rank 4", spellID = 6064, iconID = 135913 } end }
Enum = { SpellBookSpellBank = { Player = 0 }, BagIndex = { Keyring = -2, Bank = -1 } }
C_SkillInfo = { GetNumSkillLines = function() return 1 end, GetSkillLineInfo = function() return { name = "Tailoring", skillRank = 255, skillMaxRank = 300, isHeader = false } end }
C_Reputation = { GetNumFactions = function() return 1 end, GetFactionDataByIndex = function() return { name = "Timbermaw Hold", reaction = 3, currentStanding = 1440, factionID = 576, description = "long" } end }
C_QuestLog = { GetNumQuestLogEntries = function() return 2 end,
  GetInfo = function(i) if i == 1 then return { title = "Azshara", isHeader = true } end return { title = "Kill things", questID = 3601, level = 55 } end,
  IsComplete = function() return false end, ReadyForTurnIn = function() return false end, IsFailed = function() return false end, GetTimeAllowed = function() return nil end,
  GetQuestObjectives = function() return { { text = "Sons slain: 3/8", finished = false, numFulfilled = 3, numRequired = 8, type = "monster" } } end,
  GetAllCompletedQuestIDs = function() return { 5, 3, SECRET, 1 } end, GetTitleForQuestID = function() return "Kill things" end }
function GetNumGroupMembers() return 2 end
function IsInRaid() return false end
function UnitIsConnected() return true end
C_UnitAuras = { GetAuraDataByIndex = function(u, i) if i == 1 then return { name = "Power Word: Fortitude", icon = 135987, applications = 0, duration = 1800, expirationTime = GetTime() + 600, spellId = 1245 } end end }
function UnitGUID(u) if u=="player" then return "Player-1-ABC" elseif u=="target" then return "Creature-0-1-2-3-6137-0000" end end
function UnitIsPlayer() return false end
function UnitClassification() return "normal" end
function UnitCreatureType() return "Giant" end
function UnitIsDead() return true end
LOOT_ITEM_SELF = "You receive loot: %s."
LOOT_ITEM_SELF_MULTIPLE = "You receive loot: %sx%d."
LOOT_ITEM_PUSHED_SELF = "You receive item: %s."
LOOT_ITEM_CREATED_SELF = "You create: %s."
GOLD_AMOUNT = "%d Gold"; SILVER_AMOUNT = "%d Silver"; COPPER_AMOUNT = "%d Copper"
ERR_AUCTION_SOLD_S = "A buyer has been found for your auction of %s."
C_AuctionHouse = { GetBrowseResults = function() return { { itemKey = { itemID = 4338, itemSuffix = 0, itemLevel = 40 }, minPrice = 2500, totalQuantity = 300 }, { itemKey = { itemID = 14111, itemSuffix = 1234 }, minPrice = SECRET } } end,
  PostCommodity = function() end, PostItem = function() end,
  GetNumOwnedAuctions = function() return 1 end, GetOwnedAuctionInfo = function() return { itemLink = "|cff1eff00|Hitem:4338::|h[Mageweave Cloth]|h|r", itemKey = { itemID = 4338 }, quantity = 20, buyoutAmount = 50000, status = 0 } end }
C_TradeSkillUI = { GetBaseProfessionInfo = function() return { professionName = "Tailoring", skillLevel = 255, maxSkillLevel = 300 } end,
  GetChildProfessionInfo = function() return nil end, GetAllRecipeIDs = function() return { 18560, 3914 } end,
  GetRecipeInfo = function(id) return { name = id == 18560 and "Mooncloth" or "Brown Linen Pants", learned = true, icon = 1, craftable = true, numAvailable = 1 } end,
  GetRecipeLink = function() return "|Henchant:18560|h[Tailoring: Mooncloth]|h" end,
  GetRecipeSchematic = function() return { outputItemID = 14342, quantityMin = 1, quantityMax = 1, reagentSlotSchematics = { { quantityRequired = 2, reagents = { { itemID = 14256 } } } } } end,
  GetRecipeCooldown = function(id) if id == 18560 then return 300000, true end return 0 end }
function GetInboxNumItems() return 1 end
function GetInboxHeaderInfo() return nil, nil, "Stormwind Auction House", "Auction successful: Mageweave Cloth", 47500, 0, 29.5, 0, false, false end
function GetInboxInvoiceInfo() return "seller", "Mageweave Cloth", "Buyer", 50000, 50000, 100, 2500 end
function NumTaxiNodes() return 2 end
function TaxiNodeName(i) return i==1 and "Talrendis Point, Azshara" or "Astranaar, Ashenvale" end
function TaxiNodeGetType(i) return i==1 and "CURRENT" or "REACHABLE" end
function GetNumBankSlots() return 6 end

-- v1.2 mocks
FACTION_STANDING_INCREASED = "Reputation with %s increased by %d."
FACTION_STANDING_DECREASED = "Reputation with %s decreased by %d."
C_ClassTalents.GetConfigIDsBySpecID = function(spec) return { 77, 88 } end
C_ClassTalents.GetLastSelectedSavedConfigID = function() return 88 end
C_SpecializationInfo.GetNumSpecializations = function() return 3 end
function GetNumQuestLogRewards() return 1 end
function GetQuestLogRewardInfo(i) return "Robe", 1, 1, 3, true, 10041 end
function GetNumQuestLogChoices() return 2 end
function GetQuestLogChoiceInfo(i) return "Choice " .. i, 1, 1, 2, true, 14111 end
function GetQuestLogItemLink(kind, i) return "|cff0070dd|Hitem:10041::|h[Dalaran Wizard's Robe]|h|r" end
function GetQuestLogRewardMoney() return 5000 end
function GetQuestLogRewardXP() return SECRET end
function GetQuestLogRewardSpell() return nil end
C_QuestLog.SetSelectedQuest = function() end
C_QuestLog.GetSelectedQuest = function() return 0 end
QuestDB = { name = function(id) return id == 3601 and "Kill things" or nil end, questLevel = function() return 55 end, requiredLevel = function() return 50 end,
  startedBy = function() return { { 8379 }, nil, nil } end, finishedBy = function() return { { 8379 } } end, nextQuestInChain = function() return 3602 end,
  objectivesText = function() return { "Kill 8 Sons." } end, reputationReward = function() return { { 576, 75 } } end, requiredMinRep = function() return nil end }
ItemDB = { name = function(id) return id == 4338 and "Mageweave Cloth" or nil end, npcDrops = function() return { 6137, 6138 } end, vendors = function() return nil end,
  questRewards = function() return { 3601 } end }
NpcDB = { name = function(id) return "Npc " .. id end, minLevel = function() return 55 end, maxLevel = function() return 56 end, zoneID = function() return 16 end,
  spawns = function() local t = {} for i = 1, 30 do t[i] = { 40 + i / 10, 50 } end return { [16] = t, [17] = { { -1, -1 } } } end }
ObjectDB = { name = function() return "Chest" end }
local deLocked = false
local oldInfo = C_Container.GetContainerItemInfo
C_Container.GetContainerItemInfo = function(b, s)
  if b == 0 and s == 2 then return { hyperlink = "|cff1eff00|Hitem:9999::|h[Green Pants]|h|r", itemID = 9999, stackCount = 1, quality = 2, isLocked = deLocked } end
  return oldInfo(b, s)
end
function SetDELock(v) deLocked = v end
local nrep = 0
C_AuctionHouse.ReplicateItems = function() end
C_AuctionHouse.GetNumReplicateItems = function() return 3 end
C_AuctionHouse.GetReplicateItemInfo = function(i)
  local rows = { { "Mageweave Cloth", 1, 20, 1, true, 40, 0, 1, 1, 40000, 0, false, nil, "x", "x", 0, 4338, true },
    { "Mageweave Cloth", 1, 10, 1, true, 40, 0, 1, 1, 30000, 0, false, nil, "x", "x", 0, 4338, true },
    { "Pants", 1, 1, 2, true, 40, 0, 1, 1, 90000, 0, false, nil, "x", "x", 0, 9999, false } }
  return unpack(rows[i + 1])
end
C_AuctionHouse.GetReplicateItemLink = function(i) return "|cff1eff00|Hitem:4338::::::|h[Mageweave Cloth]|h|r" end
Enum.PlayerInteractionType = { Banker = 8, TaxiNode = 5, Auctioneer = 21, Merchant = 1 }

-- load addon
local ns = {}
local files = { "Inbox.lua", "Core.lua", "Snapshot.lua", "Journal.lua", "Market.lua", "Professions.lua", "UI.lua" }
for _, f in ipairs(files) do local chunk = assert(loadfile(ADDONDIR .. "/" .. f)); chunk("ClaudeCompanion", ns) end
Fire("ADDON_LOADED", "ClaudeCompanion")
Fire("PLAYER_LOGIN")
RunTimers()
-- gameplay
SlashCmdList.CLAUDECOMPANION("start azshara sons")
Fire("PLAYER_TARGET_CHANGED")
Fire("PARTY_KILL", "Player-1-ABC", "Creature-0-1-2-3-6137-0000")
Fire("CHAT_MSG_COMBAT_HOSTILE_DEATH", "Son of Arkkoroc dies.")
Fire("LOOT_OPENED")
SetMoney(money + 12345); Fire("PLAYER_MONEY")
Fire("CHAT_MSG_MONEY", "You loot 1 Gold 23 Silver 45 Copper")
Fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:4338::|h[Mageweave Cloth]|h|rx3.")
Fire("CHAT_MSG_LOOT", "You receive loot: |cff0070dd|Hitem:10041::|h[Pattern: Thing]|h|r.")
Fire("CHAT_MSG_LOOT", SECRET)
Fire("LOOT_CLOSED")
Advance(1800)
SetXP(199000); Fire("PLAYER_XP_UPDATE"); SetXP(500); Fire("PLAYER_XP_UPDATE")
Fire("QUEST_ACCEPTED", 3601); Fire("QUEST_TURNED_IN", 3601, 5000, 10000); Fire("QUEST_REMOVED", 3601)
Fire("MERCHANT_SHOW"); SetMoney(money - 500); Fire("PLAYER_MONEY"); Fire("MERCHANT_CLOSED")
Fire("AUCTION_HOUSE_SHOW"); Fire("AUCTION_HOUSE_BROWSE_RESULTS_UPDATED")
C_AuctionHouse.PostCommodity({}, 2, 20, 2400)
Fire("OWNED_AUCTIONS_UPDATED"); Fire("AUCTION_HOUSE_CLOSED")
Fire("CHAT_MSG_SYSTEM", "A buyer has been found for your auction of Mageweave Cloth.")
Fire("MAIL_SHOW"); Fire("TRADE_SKILL_SHOW"); Fire("BANKFRAME_OPENED"); Fire("TAXIMAP_OPENED")
Fire("UNIT_SPELLCAST_SUCCEEDED", "player", "x", 18560)
Fire("PLAYER_EQUIPMENT_CHANGED", 1)
Fire("GROUP_ROSTER_UPDATE"); Fire("ACTIVE_TALENT_GROUP_CHANGED", 2, 1)
RunTimers()
-- v1.2: disenchant, rep, scan, interaction manager
Fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:9999::|h[Green Pants]|h|r.")
SetDELock(true); Fire("UNIT_SPELLCAST_START", "player", "g", 13262); Fire("UNIT_SPELLCAST_SUCCEEDED", "player", "g", 13262); SetDELock(false)
Fire("LOOT_OPENED")
Fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:11176::|h[Dream Dust]|h|rx2.")
Fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:11177::|h[Small Radiant Shard]|h|r.")
Fire("LOOT_CLOSED")
Fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:4338::|h[Mageweave Cloth]|h|r.")
Fire("CHAT_MSG_COMBAT_FACTION_CHANGE", "Reputation with Timbermaw Hold increased by 15.")
Fire("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 21)
SlashCmdList.CLAUDECOMPANION("scan"); Fire("REPLICATE_ITEM_LIST_UPDATE"); RunTimers()
SlashCmdList.CLAUDECOMPANION("scan")
Fire("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 8); RunTimers(); Fire("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", 8)
Fire("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 5); RunTimers()
Fire("NEW_RECIPE_LEARNED", 18560)
-- v1.4: group kills, party coin share, DE via lock event, mail origin
local oldGUID = UnitGUID
UnitGUID = function(u) if u == "party1" then return "Player-1-PARTY" end return oldGUID(u) end
Fire("GROUP_ROSTER_UPDATE")
Fire("PARTY_KILL", "Player-1-PARTY", "Creature-0-1-2-3-9019-0001")
Fire("PARTY_KILL", "Player-9-STRANGER", "Creature-0-1-2-3-9019-0002")
Fire("MAIL_CLOSED"); Fire("BANKFRAME_CLOSED"); Fire("TAXIMAP_CLOSED"); Fire("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", 21); Fire("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", 5); Fire("LOOT_CLOSED"); Advance(10)
SetMoney(money + 777); Fire("PLAYER_MONEY"); Fire("CHAT_MSG_MONEY", "Your share of the loot is 7 Silver 77 Copper.")
-- DE where the game does NOT mark the item locked: ITEM_LOCK_CHANGED + bag diff
local pantsGone = false
local oi2 = C_Container.GetContainerItemInfo
C_Container.GetContainerItemInfo = function(b, s) if b == 0 and s == 2 and pantsGone then return nil end return oi2(b, s) end
Fire("ITEM_LOCK_CHANGED", 0, 2)
Fire("UNIT_SPELLCAST_START", "player", "g2", 13262); Fire("UNIT_SPELLCAST_SUCCEEDED", "player", "g2", 13262)
pantsGone = true
Fire("LOOT_OPENED"); Fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:11176::|h[Dream Dust]|h|rx3."); Fire("LOOT_CLOSED")
-- won auction arriving by mail
GetInboxHeaderInfo = function() return nil, nil, "Stormwind Auction House", "Auction won: Crusader's Cloak", 0, 0, 29.9, 1, false, false end
GetInboxInvoiceInfo = function() return "buyer", "Crusader's Cloak", "Seller", 49500, 49500, 0, 0 end
GetInboxItemLink = function(i, a) if a == 1 then return "|cff1eff00|Hitem:10194::|h[Crusader's Cloak]|h|r" end end
GetInboxItem = function(i, a) return "Crusader's Cloak", 1, 1, 1 end
Fire("MAIL_SHOW"); RunTimers()
Fire("CHAT_MSG_LOOT", "You receive item: |cff1eff00|Hitem:10194::|h[Crusader's Cloak]|h|r.")
Fire("MAIL_CLOSED")
SlashCmdList.CLAUDECOMPANION("pause")
SlashCmdList.CLAUDECOMPANION("pause")
SlashCmdList.CLAUDECOMPANION("status")
SlashCmdList.CLAUDECOMPANION("stop")
SlashCmdList.CLAUDECOMPANION("stop")
SlashCmdList.CLAUDECOMPANION("note Pattern dropped at the beach camp")
SlashCmdList.CLAUDECOMPANION("status")
SlashCmdList.CLAUDECOMPANION("")
SlashCmdList.CLAUDECOMPANION("help")
SlashCmdList.CLAUDECOMPANION("sync")
Fire("PLAYER_LOGOUT")
-- serialize
local function ser(v, ind)
  ind = ind or ""
  if type(v) == "table" then
    if v == SECRET then error("SECRET LEAKED INTO DB") end
    local keys = {} for k in pairs(v) do keys[#keys+1] = k end
    table.sort(keys, function(a,b) return tostring(a) < tostring(b) end)
    local out = {"{"}
    for _, k in ipairs(keys) do out[#out+1] = ind .. "  [" .. (type(k)=="number" and tostring(k) or string.format("%q", k)) .. "] = " .. ser(v[k], ind .. "  ") .. "," end
    out[#out+1] = ind .. "}"
    return table.concat(out, "\n")
  elseif type(v) == "string" then return string.format("%q", v)
  elseif type(v) == "number" or type(v) == "boolean" then return tostring(v)
  else error("bad type in DB: " .. type(v)) end
end
-- v1.4 checks
do
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local kills, groupKills, shareLoot, deSrc, mailOrigin, buys = 0, 0, false, false, false, false
  for _, e in ipairs(c.journal) do
    if e.e == "kill" then kills = kills + 1; if e.by == "group" then groupKills = groupKills + 1 end end
    if e.e == "money" and e.amount == 777 then shareLoot = (e.source == "loot") end
    if e.e == "disenchant" and e.link and e.link:find("Green Pants") then deSrc = true end
    if e.e == "receive" and e.mail and e.mail.from == "won" and e.mail.paid == 49500 then mailOrigin = true end
  end
  buys = c.ah.buys and #c.ah.buys == 1 and c.ah.buys[1].price == 49500
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  check(groupKills == 1, "group member kill counted, stranger ignored (" .. groupKills .. ")")
  check(shareLoot, "party coin share classified as loot")
  check(deSrc, "disenchant source found without lock flag")
  check(mailOrigin, "mailed item knows it was an AH win + price")
  check(buys, "AH purchase recorded in ah.buys")
  if FAILED then error("v1.4 checks failed") end
end
local f = io.open("out.lua", "w"); f:write("ClaudeCompanionDB = " .. ser(ClaudeCompanionDB)); f:close()
print("DIAG:")
for k, d in pairs(ClaudeCompanionDB.chars["Gabriel-Atlas"].diag) do if d.err > 0 then print(k, d.err, d.lastErr) end end
print("DONE")
