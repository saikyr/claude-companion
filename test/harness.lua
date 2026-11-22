-- Minimal WoW API mock to run the addon in plain Lua 5.1
local SECRET = setmetatable({}, {__tostring=function() return "SECRET" end})
function issecretvalue(v) return v == SECRET end
local timers = {}
local tickers = {}
C_Timer = { After = function(d, fn) table.insert(timers, fn) end,
  NewTicker = function(d, fn) local t = { fn = fn }; t.Cancel = function() t.fn = nil end; tickers[#tickers + 1] = t; return t end }
function RunTickers() for _, t in ipairs(tickers) do if t.fn then t.fn() end end end
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
  -- like the game: the event only reaches this frame for the given units
  rawset(f, "RegisterUnitEvent", function(self, ev, ...) frames[#frames+1] = {f=self, ev=ev, scripts=scripts, units={...}} end)
  rawset(f, "_scripts", scripts)
  if name then _G[name] = f end
  return f
end
function Fire(ev, ...)
  local unit = ...
  for _, r in ipairs(frames) do
    local wanted = not r.units
    if r.units then for _, u in ipairs(r.units) do if u == unit then wanted = true end end end
    if r.ev == ev and wanted and r.scripts.OnEvent then r.scripts.OnEvent(r.f, ev, ...) end
  end
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
function hooksecurefunc(t, name, fn) if type(t) == "string" then fn = name; local orig=_G[t]; _G[t]=function(...) local r={orig(...)} fn(...) return unpack(r) end else local orig=t[name]; t[name]=function(...) local r={orig(...)} fn(...) return unpack(r) end end end
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
-- the files the game loads, in its order: the .toc
local files = {}
for l in io.lines(ADDONDIR .. "/ClaudeCompanion.toc") do
  l = l:gsub("%s+$", "")
  if l ~= "" and not l:match("^#") then files[#files + 1] = l end
end
for _, f in ipairs(files) do local chunk = assert(loadfile(ADDONDIR .. "/" .. f)); chunk("ClaudeCompanion", ns) end
-- a save from 1.4: copies of QuestieDB facts the addon used to keep (now the app's pack owns them)
ClaudeCompanionDB = { npcs = { [1] = { name = "Old" } }, quests = { [1] = { name = "Old" } },
  items = { ["item:1"] = { id = 1, name = "Old", src = { drops = { 1 } } } } }
Fire("ADDON_LOADED", "ClaudeCompanion")
OLD_ITEM_KEPT = ClaudeCompanionDB.items["item:1"] and ClaudeCompanionDB.items["item:1"].name == "Old" and not ClaudeCompanionDB.items["item:1"].src
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
-- a party member's cast never reaches the addon (spellcast events are registered for the player only)
Fire("UNIT_SPELLCAST_START", "party1", "p", 13262)
print((ns.deCasting == nil and "PASS " or "FAIL ") .. "a party member's cast is not taken for yours"); if ns.deCasting ~= nil then FAILED = true end
SetDELock(true); Fire("UNIT_SPELLCAST_START", "player", "g", 13262); Fire("UNIT_SPELLCAST_SUCCEEDED", "player", "g", 13262); SetDELock(false)
Fire("LOOT_OPENED")
Fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:11176::|h[Dream Dust]|h|rx2.")
Fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:11177::|h[Small Radiant Shard]|h|r.")
Fire("LOOT_CLOSED")
Fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:4338::|h[Mageweave Cloth]|h|r.")
Fire("CHAT_MSG_COMBAT_FACTION_CHANGE", "Reputation with Timbermaw Hold increased by 15.")
Fire("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 21)
SlashCmdList.CLAUDECOMPANION("scan"); Fire("REPLICATE_ITEM_LIST_UPDATE"); Advance(3); RunTimers()
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
  check(c.ah.buys[1].count == 1, "AH purchase has its stack size from the letter (#2)")
  if FAILED then error("v1.4 checks failed") end
end
-- #1 item cache: full cache makes room (oldest first) and keeps items in use
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local worn = "item:777001::::::::58"
  c.snap.equipped = c.snap.equipped or {}
  c.snap.equipped[99] = { slot = 99, item = worn }
  ClaudeCompanionDB.items[worn] = { id = 777001, seen = 1 }           -- oldest of all, but worn
  local cap = ns.LIMITS.items
  for i = 1, cap + 50 do Advance(1); ns.NoteItem("|cffffffff|Hitem:" .. (800000 + i) .. "::|h[Filler]|h|r") end
  local n = 0; for _ in pairs(ClaudeCompanionDB.items) do n = n + 1 end
  local last = ClaudeCompanionDB.items["item:" .. (800000 + cap + 50) .. "::"]
  check(n <= cap, "item cache stays within its cap (" .. n .. " of " .. cap .. ")")
  check(last and last.name ~= nil, "newest item still saved with its name after the cache filled")
  check(ClaudeCompanionDB.items[worn] ~= nil, "worn item kept when the cache made room")
  check(ClaudeCompanionDB.items["item:800001::"] == nil, "oldest unused item made room")
  check((ClaudeCompanionDB.cacheStats or {}).evicted and ClaudeCompanionDB.cacheStats.evicted > 0, "evictions counted in cacheStats")
  c.snap.equipped[99] = nil; ClaudeCompanionDB.items[worn] = nil
  if FAILED then error("#1 checks failed") end
end
-- grinds end on logout, after time away (other computer, crash) and when idle; /reload keeps them
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local function relog(away, reload)
    if reload then ns.MarkReload() end
    Fire("PLAYER_LOGOUT"); Advance(away); Fire("PLAYER_LOGIN")
  end
  local n0 = #c.grinds
  -- 1. /reload (Sync) keeps the grind, and the 5 s reload doesn't count
  ns.GrindStart("reloadtest"); Advance(100); c.grind.last = ns.Now()
  relog(5, true)
  check(c.grind and c.grind.name == "reloadtest", "a /reload keeps the grind running")
  check(c.grind and ns.ActiveSecs(c.grind) == 100, "the reload's 5 s don't count (" .. tostring(c.grind and ns.ActiveSecs(c.grind)) .. ")")
  -- 2. a real logout ends it, at logout time
  Advance(50); c.grind.last = ns.Now(); local out = ns.Now()
  relog(3600, false)
  local g = c.grinds[#c.grinds]
  check(c.grind == nil and g.name == "reloadtest" and g.ended == "logout" and g.finish == out, "a logout ends the grind at the logout")
  check(g.secs == 150, "its time stops at the logout (" .. tostring(g.secs) .. ")")
  -- 3. a /reload missed by the hooks: logout seconds before login brings the grind back
  ns.GrindStart("missedreload"); Advance(30); c.grind.last = ns.Now()
  relog(4, false)
  check(c.grind and c.grind.name == "missedreload" and c.grind.finish == nil and c.grind.ended == nil, "an unflagged 4 s reload brings the grind back")
  ns.GrindStop(true)
  -- 4. the save on this computer last saw the grind hours ago (played on the Mac, or crashed):
  --    the grind ends at its last counted event, not hours later
  ns.GrindStart("jinthaalor"); Advance(600); c.grind.last = ns.Now(); local lastKill = ns.Now()
  ns.MarkReload(); Fire("PLAYER_LOGOUT")      -- last save was a Sync
  Advance(3 * 3600); Fire("PLAYER_LOGIN")      -- 3 h later, after playing elsewhere
  g = c.grinds[#c.grinds]
  check(c.grind == nil and g.name == "jinthaalor" and g.ended == "away" and g.finish == lastKill and g.secs == 600,
    "a grind last seen 3 h ago ends at its last event (" .. tostring(g.ended) .. ", " .. tostring(g.secs) .. " s)")
  -- 5. idle: nothing counted for 30 min ends it at the last event
  ns.GrindStart("idle"); Advance(120); c.grind.last = ns.Now(); local idleLast = ns.Now()
  Advance(29 * 60); RunTickers()
  check(c.grind ~= nil, "29 min idle: still running")
  Advance(2 * 60); RunTickers()
  g = c.grinds[#c.grinds]
  check(c.grind == nil and g.name == "idle" and g.ended == "idle" and g.finish == idleLast and g.secs == 120, "31 min idle ends it at the last event")
  -- 6. pause / resume are in the journal; a plain click doesn't pause (#31)
  ns.GrindStart("pausetest")
  local panel = ClaudeCompanionGrind
  panel._scripts.OnClick(panel, "LeftButton")
  check(not c.grind.paused, "a plain left-click on the panel doesn't pause")
  local shift = IsShiftKeyDown; IsShiftKeyDown = function() return true end
  panel._scripts.OnClick(panel, "LeftButton"); IsShiftKeyDown = shift
  check(c.grind.paused, "shift-click pauses")
  ns.GrindPause()
  local kinds = {}; for i = #c.journal - 3, #c.journal do kinds[#kinds + 1] = c.journal[i].e end
  local ks = table.concat(kinds, ",")
  check(ks:find("grindPause") and ks:find("grindResume"), "pause and resume are logged (" .. ks .. ")")
  -- 7. device
  check(c.grind.device == "pc" and c.device == "pc", "the grind and character know which computer (pc)")
  IsMacClient = function() return true end
  check(ns.Device() == "mac", "IsMacClient gives mac"); IsMacClient = nil
  ns.GrindStop(true)
  check(#c.grinds == n0 + 4 + 1, "finished grinds kept (" .. (#c.grinds - n0) .. ")")
  if FAILED then error("grind lifecycle checks failed") end
end
-- the grind panel: targets (dropped vs expected from the pack's drop chances), the summary on stop
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local panel = ClaudeCompanionGrind
  local PATTERN = "|cff1eff00|Hitem:14482::::::|h[Pattern: Cindercloth Cloak]|h|r"
  check(ns.DROPS and ns.DROPS[725] and ns.DROPS[725][1] == "Riverpaw Bandit" and ns.DROPS[725][3] == 87 and ns.DROPS[14482] == nil, "Drops.lua is loaded from the .toc and has only Forever-measured rows")
  local none, why = ns.GrindTarget(PATTERN)
  check(none == nil and why:find("start a grind"), "/cc target with no grind says to start one")
  ns.GrindStart("Thaurissan")
  check(ns.GrindTarget(PATTERN) == true, "a shift-clicked link becomes a target")
  local g = c.grind
  g.kills, g.killsBy = 27, { ["Thaurissan Firewalker"] = 27 }
  g.loot["4338"] = { id = 4338, name = "Mageweave Cloth", link = "|cffffffff|Hitem:4338::|h[Mageweave Cloth]|h|r", q = 1, count = 12 }
  local t = ns.TargetStats(g, g.targets[1])
  check(not ns.DROPS[14482] and t.got == 0 and t.expected == nil and t.rated == false and t.kills == 27,
    "no Forever-measured rate (Classic only): no expected, rate unknown, counted against all 27 kills")
  local r, lo, hi = ns.OwnRange(0, 27)
  check(r == 0 and lo < 1e-9 and hi > 10 and hi < 15, "own rate 0 in 27 kills has a 95% range up to " .. string.format("%.1f", hi) .. "%")
  -- an item ForeverDB measured on Forever: Riverpaw Gnoll drops 725 at 29.49% over 356 kills
  local gnoll = { id = 725, name = "Gnoll Paw" }
  g.killsBy["Riverpaw Gnoll"] = 10
  ns.TargetStats(g, gnoll)
  check(ns.DROPS[725] and math.abs(gnoll.expected - 10 * 0.2949) < 1e-9 and gnoll.sample == 356 and gnoll.kills == 10,
    "expected = kills x Forever-measured chance (" .. tostring(gnoll.expected) .. ", " .. tostring(gnoll.sample) .. " kills measured)")
  check(math.abs(gnoll.none - (1 - 0.2949) ^ 10) < 1e-9, "chance of none after 10 kills")
  g.killsBy["Riverpaw Gnoll"] = nil
  local ok, err = pcall(ns.UpdateGrindPanel)
  check(ok, "the panel draws a running grind with a target and drops (" .. tostring(err) .. ")")
  g.loot["14482"] = { id = 14482, name = "Pattern: Cindercloth Cloak", link = PATTERN, q = 2, count = 1 }
  check(ns.TargetStats(g, g.targets[1]).got == 1, "a target that dropped counts as got")
  check(ns.GrindTarget("14482") == false and #g.targets == 0, "/cc target the same item again takes it off")
  ns.GrindTarget(PATTERN)
  check(ns.GrindTarget("[test item]") == true and #g.targets == 2, "a typed name the item cache knows becomes a target")
  panel._scripts.OnClick(panel, "RightButton")
  check(c.grind == g, "a plain right-click doesn't stop the grind")
  local shift = IsShiftKeyDown; IsShiftKeyDown = function() return true end
  panel._scripts.OnClick(panel, "RightButton"); IsShiftKeyDown = shift
  local done = c.grinds[#c.grinds]
  check(c.grind == nil and done == g, "shift-right-click stops it")
  check(done.targets[1].id == 14482 and done.targets[1].got == 1 and done.targets[1].kills == 27, "the saved grind keeps each target's dropped count and kills")
  ok, err = pcall(ns.UpdateGrindPanel)
  check(ok, "the panel draws the finished grind's summary (" .. tostring(err) .. ")")
  panel._scripts.OnClick(panel, "RightButton")
  ns.GrindStart("thaurissan")
  check(c.grind.targets and #c.grind.targets == 2 and c.grind.targets[1].id == 14482 and (c.grind.targets[1].got or 0) == 0,
    "the next /cc start with that name has the same targets, counted from zero")
  local drops = ns.DROPS; ns.DROPS = nil
  t = ns.TargetStats(c.grind, c.grind.targets[1])
  check(t.expected == nil and t.rated == false and t.kills == 0, "without Drops.lua (no game restart yet) there's no expected, and no error")
  ok, err = pcall(ns.UpdateGrindPanel); ns.DROPS = drops
  check(ok, "the panel draws without Drops.lua (" .. tostring(err) .. ")")
  ns.GrindStop(true)
  if FAILED then error("grind panel checks failed") end
end
-- dungeon runs: start on entering, count kills from the XP line, bosses, leave and come back, end
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local where = nil -- nil = outdoors, else { name, map }
  local oldII, oldGI = IsInInstance, GetInstanceInfo
  IsInInstance = function() if where then return true, "party" end return false, "none" end
  GetInstanceInfo = function() if where then return where.name, "party", 1, "Normal", 5, 0, false, where.map end return "Burning Steppes", "none" end
  local function go(w) where = w; Fire("ZONE_CHANGED_NEW_AREA"); Fire("PLAYER_ENTERING_WORLD") end
  local BRD = { name = "Blackrock Depths", map = 230 }
  c.run = nil; c.runs = c.runs or {}
  local n0 = #c.runs
  local oldUN = UnitName; UnitName = function(u) if u == "party1" then return "Graky" end return oldUN(u) end
  go(BRD); UnitName = oldUN
  check(c.run and c.run.name == "Blackrock Depths" and c.run.kind == "party" and c.run.inside, "entering BRD starts a run")
  check(c.run and #c.run.group == 1, "the run remembers the group (" .. tostring(c.run and #c.run.group) .. ")")
  local start = c.run.start
  -- kills inside: the kill event's GUIDs are secret, the XP line still names the mob
  Advance(30); Fire("CHAT_MSG_COMBAT_XP_GAIN", "Shadowforge Flame Keeper dies, you gain 312 experience. (+62 exp group bonus)")
  Advance(30); Fire("CHAT_MSG_COMBAT_XP_GAIN", "Anvilrage Warden dies, you gain 300 experience.")
  check(c.run.kills == 2 and c.run.killsBy["Shadowforge Flame Keeper"] == 1, "XP lines count as kills, by name (" .. c.run.kills .. ")")
  local journalKill = c.journal[#c.journal]
  check(journalKill.e == "kill" and journalKill.by == "xp" and journalKill.name == "Anvilrage Warden", "XP kill logged with the mob's name")
  -- the same kill seen by both the kill event and the XP line counts once
  local before = c.run.kills
  Fire("CHAT_MSG_COMBAT_XP_GAIN", "Anvilrage Warden dies, you gain 300 experience.")
  check(c.run.kills == before, "the same name within 2 s isn't counted twice")
  -- a boss, a wipe, a death
  Advance(60); Fire("ENCOUNTER_END", 227, "High Interrogator Gerstahn", 1, 5, 0)
  Fire("ENCOUNTER_END", 227, "High Interrogator Gerstahn", 1, 5, 1)
  Fire("BOSS_KILL", 227, "High Interrogator Gerstahn")
  check(#c.run.bosses == 1 and c.run.bosses[1].name == "High Interrogator Gerstahn" and c.run.wipes == 1, "boss kill recorded once, wipe counted")
  Fire("PLAYER_DEAD")
  check(c.run.deaths == 1, "death counted in the run")
  -- run back outside (ghost) for 3 min: same run, outside time doesn't count
  Advance(60); go(nil)
  check(c.run and not c.run.inside, "leaving parks the run")
  Advance(180); go(BRD)
  check(c.run and c.run.inside and c.run.start == start and c.run.outsideSecs == 180, "back within 15 min: same run, 180 s outside")
  -- a quest handed in inside counts
  Fire("QUEST_TURNED_IN", 4362, 17407, 23144)
  check(c.run.quests == 1, "quest turned in counts in the run")
  -- a /reload inside keeps it, and so does a short disconnect
  Advance(120); ns.MarkReload(); Fire("PLAYER_LOGOUT"); Advance(5); Fire("PLAYER_LOGIN"); Fire("PLAYER_ENTERING_WORLD")
  check(c.run and c.run.start == start and c.run.inside, "a /reload inside keeps the run")
  Fire("PLAYER_LOGOUT"); Advance(240); Fire("PLAYER_LOGIN"); Fire("PLAYER_ENTERING_WORLD")
  check(c.run and c.run.start == start and c.run.outsideSecs == 180 + 5 + 240, "a 4 min disconnect keeps the run, minus the time away (" .. tostring(c.run and c.run.outsideSecs) .. ")")
  -- leave and stay out 16 min: it ends when you left
  Advance(600); go(nil); local leftAt = ns.Now()
  Advance(16 * 60); RunTickers()
  local r = c.runs[#c.runs]
  check(c.run == nil and #c.runs == n0 + 1 and r.ended == "left" and r.finish == leftAt, "16 min outside ends the run at the exit")
  check(r.secs == (leftAt - start) - (180 + 5 + 240), "run time leaves out time outside and logged out (" .. tostring(r.secs) .. ")")
  -- entering another instance ends the old run and starts a new one
  go(BRD); Advance(60); go({ name = "Lower Blackrock Spire", map = 229 })
  check(c.runs[#c.runs].name == "Blackrock Depths" and c.runs[#c.runs].ended == "other" and c.run.name == "Lower Blackrock Spire", "a different instance ends the old run")
  -- logged out inside, back 3 h later (played on the other computer): ends when last seen
  Advance(100); local lastIn = ns.Now(); c.run.last = lastIn
  Fire("PLAYER_LOGOUT"); Advance(3 * 3600); where = nil; Fire("PLAYER_LOGIN"); Fire("PLAYER_ENTERING_WORLD")
  r = c.runs[#c.runs]
  check(c.run == nil and r.name == "Lower Blackrock Spire" and r.ended == "away" and r.finish == lastIn, "back 3 h later: the run ended when last seen")
  -- reset while outside
  go(BRD); Advance(30); go(nil)
  Fire("CHAT_MSG_SYSTEM", "Blackrock Depths has been reset.")
  check(c.run == nil and c.runs[#c.runs].ended == "reset", "an instance reset ends the run")
  -- outdoors, a grind is not a run
  check(c.run == nil, "no run outdoors")
  IsInInstance, GetInstanceInfo = oldII, oldGI
  if FAILED then error("dungeon run checks failed") end
end
-- group loot and rolls; flight paths per continent
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local oldII, oldGI = IsInInstance, GetInstanceInfo
  IsInInstance = function() return true, "party" end
  GetInstanceInfo = function() return "Blackrock Depths", "party", 1, "Normal", 5, 0, false, 230 end
  c.run = nil; Fire("PLAYER_ENTERING_WORLD")
  local SC = "|cnIQ3:|Hitem:11932::::::::59:1487:::::::::|h[Guiding Stave of Wisdom]|h|r"
  local GREY = "|cnIQ0:|Hitem:4583::::::::58:1487:::::::::|h[Thick Furry Mane]|h|r"
  Fire("CHAT_MSG_LOOT", "Graky has selected Need for: " .. SC)
  Fire("CHAT_MSG_LOOT", "Sap has selected Greed for: " .. SC)
  Fire("CHAT_MSG_LOOT", "Need Roll - 87 for " .. SC .. " by Graky")
  Fire("CHAT_MSG_LOOT", "Greed Roll - 12 for " .. SC .. " by Sap")
  Fire("CHAT_MSG_LOOT", "Graky won: " .. SC)
  Fire("CHAT_MSG_LOOT", "Sap receives loot: " .. GREY .. ".")
  local gl = c.run.groupLoot or {}
  check(#gl == 1 and gl[1].who == "Graky" and gl[1].how == "won" and gl[1].q == 3, "who won the Stave is in the run (" .. #gl .. ")")
  local byWho = {}; for _, r in ipairs(gl[1] and gl[1].rolls or {}) do byWho[r.who] = r end
  check(byWho.Graky and byWho.Graky.choice == "need" and byWho.Graky.roll == 87 and byWho.Sap and byWho.Sap.roll == 12, "the rolls are kept with it")
  check(c.journal[#c.journal].e == "groupLoot" and c.journal[#c.journal].who == "Graky", "groupLoot in the journal; grey loot of others skipped")
  local before = #gl
  Fire("CHAT_MSG_LOOT", "You receive loot: " .. SC .. ".")
  check(#(c.run.groupLoot or {}) == before, "own loot isn't group loot")
  IsInInstance, GetInstanceInfo = oldII, oldGI
  c.run = nil
  -- flight paths: the map names its continent; paths from the other continent stay
  c.taxi = { ["Stormwind, Elwynn"] = { first = 1, last = 1 }, ["zzOLDRiverglades, Farholde Keep"] = { first = 1, last = 1 } }
  local oldTM, oldMap = GetTaxiMapID, C_Map
  GetTaxiMapID = function() return 1414 end
  C_Map = setmetatable({ GetMapInfo = function(id) return { name = id == 1414 and "Kalimdor" or "Eastern Kingdoms" } end }, { __index = oldMap })
  TaxiNodeGetType = TaxiNodeGetType or function() return "REACHABLE" end
  ns.ReadTaxi()
  check(c.taxi["Stormwind, Elwynn"] and c.taxi["Talrendis Point, Azshara"] and c.taxi["Talrendis Point, Azshara"].continent == "Kalimdor", "Kalimdor paths added, Eastern Kingdoms ones kept")
  check(c.taxi["zzOLDRiverglades, Farholde Keep"] == nil, "old zzOLD node dropped")
  check(c.taxiRead and c.taxiRead.Kalimdor, "which continent was read is saved")
  GetTaxiMapID, C_Map = oldTM, oldMap
  if FAILED then error("group loot / flight path checks failed") end
end
-- logout after the game has emptied bags, gear and money keeps the last good snapshot's values
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local good = c.snap                                         -- the logout above, with everything readable
  local items = 0; for _, b in ipairs(good.bags or {}) do items = items + #(b.items or {}) end
  local oldMoney, oldLink, oldInfo = GetMoney(), GetInventoryItemLink, C_Container.GetContainerItemInfo
  SetMoney(0); GetInventoryItemLink = function() return nil end; C_Container.GetContainerItemInfo = function() return nil end
  Advance(60); Fire("PLAYER_LOGOUT")
  local s = c.snap
  local items2 = 0; for _, b in ipairs(s.bags or {}) do items2 = items2 + #(b.items or {}) end
  local kept = table.concat(s.kept or {}, ",")
  check(items > 0 and items2 == items, "logout keeps bag contents the game already emptied (" .. items2 .. " of " .. items .. ")")
  check(#(good.equipped or {}) > 0 and #(s.equipped or {}) == #good.equipped, "logout keeps worn gear the game already emptied")
  check(s.character.money == good.character.money and good.character.money > 0, "logout keeps gold when the game reads 0")
  check(good.kept == nil, "a logout that reads everything keeps nothing")
  check(s.reason == "logout" and s.taken > good.taken and kept:find("bags") and kept:find("equipped") and kept:find("character.money") and s.keptFrom == good.taken,
    "logout snapshot lists what it kept and from when (" .. kept .. ")")
  SetMoney(oldMoney); GetInventoryItemLink = oldLink; C_Container.GetContainerItemInfo = oldInfo
  if FAILED then error("logout checks failed") end
end
-- bosses from the ForeverDungeonJournal addon's run log (same shape as Gabriel's save)
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local t0 = ns.Now()
  ForeverDungeonJournalCharacterDB = { runLog = { runs = { { id = 57, dungeon = "Blackrock Depths", created = t0, lastSeen = t0 + 2700, kills = {
    { a = 1, t = t0 + 10, m = "Anvilrage Overseer", x = 160 },
    { a = 1, t = t0 + 900, m = "Golem Lord Argelmach", b = "Golem Lord Argelmach" },
    { a = 1, t = t0 + 1500, m = "Anger'rel", b = "The Seven" }, { a = 1, t = t0 + 1600, m = "Gloom'rel", b = "The Seven" },
    { a = 1, t = t0 + 2600, m = "Emperor Dagran Thaurissan", b = "Emperor Dagran Thaurissan", f = 1 } } } } } }
  local log = ns.ImportBossLog()
  check(log and #log == 1 and #log[1].bosses == 3, "journal addon log read: 3 bosses, The Seven once (" .. tostring(log and #log[1].bosses) .. ")")
  check(c.bossLog and c.bossLog.runs[1].bosses[3].name == "Emperor Dagran Thaurissan", "kept in the save for the app")
  -- a tracked run whose encounter events didn't come gets them at the end
  local oldII, oldGI = IsInInstance, GetInstanceInfo
  IsInInstance = function() return true, "party" end
  GetInstanceInfo = function() return "Blackrock Depths", "party", 1, "Normal", 5, 0, false, 230 end
  c.run = nil
  local now0 = ns.Now
  ns.Now = function() return t0 end; Fire("PLAYER_ENTERING_WORLD")
  ns.Now = function() return t0 + 2700 end
  local r = ns.RunEnd("left", t0 + 2700)
  ns.Now = now0
  check(r and #r.bosses == 3 and r.bosses[1].source == "journal addon", "run with no encounter events gets its bosses from the log")
  ForeverDungeonJournalCharacterDB = nil
  check(ns.ImportBossLog() == nil, "without the journal addon nothing breaks")
  IsInInstance, GetInstanceInfo = oldII, oldGI
  if FAILED then error("boss log checks failed") end
end
-- AH scan: read a slice per frame with progress, only ask links for " of " items, reread only the missing
do
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local c; for _, v in pairs(ClaudeCompanionDB.chars) do c = v end
  local AHm = C_AuctionHouse
  local oldN, oldInfo, oldLink = AHm.GetNumReplicateItems, AHm.GetReplicateItemInfo, AHm.GetReplicateItemLink
  local N, loaded, linkCalls = 1000, false, 0
  AHm.GetNumReplicateItems = function() return N end
  AHm.GetReplicateItemInfo = function(i)
    if i % 10 == 0 then -- every 10th: a random-suffix cape, details not loaded on the first read
      return "Gossamer Cape of Healing", 1, 1, 2, true, 40, 0, 1, 1, 50000 + i, 0, false, nil, "x", "x", 0, 7524, loaded
    end
    return "Silk Cloth", 1, 20, 1, true, 40, 0, 1, 1, 2000 + i, 0, false, nil, "x", "x", 0, 4306, true
  end
  AHm.GetReplicateItemLink = function(i) linkCalls = linkCalls + 1; return "|cff1eff00|Hitem:7524::::::903:::|h[Gossamer Cape of Healing]|h|r" end
  c.ah.lastScan = nil
  local refreshes, pcts = 0, {}
  local oldRefresh = ns.ScanButtonRefresh
  ns.ScanButtonRefresh = function() refreshes = refreshes + 1; if ns.ahScan.total then pcts[#pcts + 1] = ns.ahScan.done end end
  local oldAfter, delayed = C_Timer.After, {}
  C_Timer.After = function(d, fn) if d >= 15 then delayed[#delayed + 1] = fn else oldAfter(d, fn) end end
  ns.AHScan()
  check(ns.ahScan.state == "scanning", "scan waits for the list")
  Fire("REPLICATE_ITEM_LIST_UPDATE"); Advance(1); RunTimers()
  -- a timer loop that keeps checking while updates arrive: still waiting, not read yet
  Fire("REPLICATE_ITEM_LIST_UPDATE")
  check(ns.ahScan.state == "scanning", "still waiting while the list grows")
  Advance(3)
  local frames = 0
  -- run timers one round at a time to count the frames the read takes
  for _ = 1, 100 do RunTimers(); frames = frames + 1; if ns.ahScan.state == "idle" then break end end
  local ls = c.ah.lastScan
  check(ls and ls.auctions == N, "all " .. N .. " auctions read (" .. tostring(ls and ls.auctions) .. ")")
  check(#pcts >= 3, "read in slices with progress (" .. #pcts .. " progress updates)")
  check(linkCalls == 0, "no link asked for plain items, and none for capes whose details weren't loaded (" .. linkCalls .. ")")
  check(ls and ls.missingInfo == 100, "100 capes waiting for details (" .. tostring(ls and ls.missingInfo) .. ")")
  local silk = c.ah.prices["4306"] or c.ah.prices[4306]
  check(silk and silk.obs[#silk.obs].qty == 900 * 20 and silk.obs[#silk.obs].min == 100, "Silk priced per unit from 900 auctions")
  -- the reread: only the 100 missing rows, now with details
  loaded = true; linkCalls = 0
  for _, fn in ipairs(delayed) do fn() end; delayed = {}
  for _ = 1, 100 do RunTimers(); if ns.ahScan.state == "idle" and c.ah.lastScan.pass then break end end
  ls = c.ah.lastScan
  check(ls.pass == 2 and ls.missingInfo == 0 and linkCalls == 100, "second pass rereads only the 100 capes (" .. linkCalls .. " links)")
  local capeKey; for k, p in pairs(c.ah.prices) do if p.id == 7524 and p.suffix == 903 then capeKey = k end end
  check(capeKey ~= nil, "the cape is priced with its suffix (of Healing)")
  -- closing the AH while reading stops cleanly
  c.ah.lastScan.t = c.ah.lastScan.t - 3600
  ns.AHScan(); Fire("REPLICATE_ITEM_LIST_UPDATE"); Advance(3)
  ns.ahScan.state = "reading" -- as if mid-read
  Fire("AUCTION_HOUSE_CLOSED")
  check(ns.ahScan.state == "idle", "closing the AH mid-scan stops it")
  -- Forever's scan links carry no suffix number: each roll is told apart by its listing name instead
  local oldNameByID = C_Item.GetItemNameByID
  C_Item.GetItemNameByID = function(id) if id == 3192 then return "Short Bastard Sword" end return oldNameByID(id) end
  N, loaded = 3, true
  AHm.GetReplicateItemInfo = function(i)
    local nm = ({ "Short Bastard Sword of Healing", "Short Bastard Sword of Healing", "Short Bastard Sword of the Owl" })[i + 1] or "Short Bastard Sword of the Owl"
    return nm, 1, 1, 2, true, 40, 0, 1, 1, (i + 1) * 1000, 0, false, nil, "x", "x", 0, 3192, true
  end
  AHm.GetReplicateItemLink = function() return "|cff1eff00|Hitem:3192::::::::59:1487:::::::::|h[Short Bastard Sword]|h|r" end
  c.ah.lastScan.t = c.ah.lastScan.t - 3600
  ns.AHScan(); Fire("REPLICATE_ITEM_LIST_UPDATE"); Advance(3)
  for _ = 1, 100 do RunTimers(); if ns.ahScan.state == "idle" then break end end
  local heal, owl, any = c.ah.prices["3192:of Healing"], c.ah.prices["3192:of the Owl"], c.ah.prices["3192"]
  check(heal and heal.suffix == "of Healing" and heal.obs[#heal.obs].min == 1000 and heal.obs[#heal.obs].qty == 2, "a roll with no suffix in its link is priced by its name (of Healing: 2 listed from 10s)")
  check(owl and owl.obs[#owl.obs].min == 3000 and owl.obs[#owl.obs].qty == 1, "each roll gets its own price (of the Owl: 1 listed at 30s)")
  check(any and any.obs[#any.obs].qty == 3, "the item's own key still counts every roll")
  -- a roll seen in both passes: the reread adds to the first pass's listings instead of replacing them
  N, loaded, delayed = 4, false, {}
  AHm.GetReplicateItemInfo = function(i)
    local nm = ({ "Short Bastard Sword of Healing", "Short Bastard Sword of Healing", "Short Bastard Sword of Healing", "Short Bastard Sword of the Owl" })[i + 1]
    return nm, 1, 1, 2, true, 40, 0, 1, 1, (i + 1) * 1000, 0, false, nil, "x", "x", 0, 3192, (i ~= 2) or loaded
  end
  c.ah.lastScan.t = c.ah.lastScan.t - 3600
  ns.AHScan(); Fire("REPLICATE_ITEM_LIST_UPDATE"); Advance(3)
  for _ = 1, 100 do RunTimers(); if ns.ahScan.state == "idle" then break end end
  loaded = true
  for _, fn in ipairs(delayed) do fn() end; delayed = {}
  for _ = 1, 100 do RunTimers(); if ns.ahScan.state == "idle" and c.ah.lastScan.pass then break end end
  heal, any = c.ah.prices["3192:of Healing"], c.ah.prices["3192"]
  check(heal and heal.obs[#heal.obs].qty == 3 and heal.obs[#heal.obs].min == 1000, "reread: of Healing keeps both passes (3 listed, from 10s; got " .. tostring(heal and heal.obs[#heal.obs].qty) .. ")")
  check(any and any.obs[#any.obs].qty == 4, "reread: the item's own key keeps both passes (4 listed)")
  C_Item.GetItemNameByID = oldNameByID
  ns.ScanButtonRefresh = oldRefresh; C_Timer.After = oldAfter
  AHm.GetNumReplicateItems, AHm.GetReplicateItemInfo, AHm.GetReplicateItemLink = oldN, oldInfo, oldLink
  if FAILED then error("AH scan checks failed") end
end
do -- one source for quests, NPCs and item sources: the app's pack, never a copy in the save
  local FAILED = false
  local function check(ok, what) print((ok and "PASS " or "FAIL ") .. what); if not ok then FAILED = true end end
  local db, src = ClaudeCompanionDB, 0
  for _, it in pairs(db.items) do if it.src then src = src + 1 end end
  check(db.npcs == nil and db.quests == nil, "no NPC or quest copies in the save (QuestieDB is loaded in this test)")
  check(src == 0, "no item-source copies in the save (" .. src .. " items have one)")
  check(OLD_ITEM_KEPT, "dropping old copies keeps the item itself")
  if FAILED then error("data source checks failed") end
end
local f = io.open("out.lua", "w"); f:write("ClaudeCompanionDB = " .. ser(ClaudeCompanionDB)); f:close()
print("DIAG:")
for k, d in pairs(ClaudeCompanionDB.chars["Gabriel-Atlas"].diag) do if d.err > 0 then print(k, d.err, d.lastErr) end end
print("DONE")
