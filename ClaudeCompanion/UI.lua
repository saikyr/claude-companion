-- The only window: where Claude's advice is, a box to write Claude a note, and a Start/Stop grind button.
-- Hidden unless you open it (/cc). Claude's suggestions are cards in the app (From Claude tab).
local _, ns = ...

local W, H = 440, 330
local f = CreateFrame("Frame", "ClaudeCompanionFrame", UIParent, "BackdropTemplate")
f:SetSize(W, H)
f:SetPoint("CENTER", 0, 60)
f:SetFrameStrata("DIALOG")
f:SetMovable(true)
f:EnableMouse(true)
f:SetClampedToScreen(true)
f:RegisterForDrag("LeftButton")
f:SetScript("OnDragStart", f.StartMoving)
f:SetScript("OnDragStop", f.StopMovingOrSizing)
pcall(f.SetBackdrop, f, {
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 16,
    insets = { left = 4, right = 4, top = 4, bottom = 4 } })
pcall(f.SetBackdropColor, f, 0.05, 0.05, 0.08, 0.94)
pcall(f.SetBackdropBorderColor, f, 0.6, 0.6, 0.6, 1)
f:Hide()
table.insert(UISpecialFrames, "ClaudeCompanionFrame") -- Esc closes it

local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
title:SetPoint("TOPLEFT", 14, -12)
title:SetPoint("RIGHT", -36, 0)
title:SetJustifyH("LEFT")

local stamp = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
stamp:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -2)

local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
close:SetPoint("TOPRIGHT", -2, -2)

-- message text, scrollable
local scroll = CreateFrame("ScrollFrame", "ClaudeCompanionScroll", f, "UIPanelScrollFrameTemplate")
scroll:SetPoint("TOPLEFT", 14, -48)
scroll:SetPoint("BOTTOMRIGHT", -32, 84)
local child = CreateFrame("Frame", nil, scroll)
child:SetSize(W - 50, 10)
scroll:SetScrollChild(child)
local body = child:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
body:SetPoint("TOPLEFT")
body:SetWidth(W - 52)
body:SetJustifyH("LEFT")
body:SetJustifyV("TOP")
body:SetSpacing(2)

-- note box
local noteLabel = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
noteLabel:SetPoint("BOTTOMLEFT", 16, 64)
noteLabel:SetText("Note to Claude (Enter to save)")

local note = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
note:SetPoint("BOTTOMLEFT", 20, 40)
note:SetPoint("BOTTOMRIGHT", -16, 40)
note:SetHeight(20)
note:SetAutoFocus(false)
note:SetMaxLetters(500)
note:SetScript("OnEscapePressed", note.ClearFocus)
note:SetScript("OnEnterPressed", function(self)
    local text = strtrim(self:GetText() or "")
    if text ~= "" then ns.AddNote(text); ns.Print("note saved.") end
    self:SetText("")
    self:ClearFocus()
end)

-- footer: session line + Sync
local status = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
status:SetPoint("BOTTOMLEFT", 16, 16)
status:SetPoint("RIGHT", -100, 0)
status:SetJustifyH("LEFT")


local HELP = "Claude's suggestions (farms, flips, quests, gear) are cards in the Claude Companion app, in its From Claude tab.\n\n"
    .. "Leave Claude a note below. WoW saves addon data when you /reload or log out; the app shows it a few seconds later.\n\n"
    .. "/cc start <name> tracks a grind, /cc stop ends it, /cc scan scans the Auction House."
local function Refresh()
    title:SetText("Claude Companion")
    stamp:SetText(ns.VERSION and ("version " .. ns.VERSION) or "")
    body:SetText(HELP)
    child:SetHeight(math.max(10, body:GetStringHeight() + 6))
    if ns.char then
        local g = ns.char.grind
        status:SetText(g and ("Grind: " .. ns.TrackerLine(g)) or ("Session: " .. ns.SessionLine()))
        if ns.UpdateGrindButton then ns.UpdateGrindButton() end
    end
end
f:SetScript("OnShow", Refresh)

---------------------------------------------------------------- globals (key bindings use these)
function ClaudeCompanion_Toggle()
    if f:IsShown() then f:Hide() else f:Show() end
end


---------------------------------------------------------------- grind button in the window
local grindBtn = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
grindBtn:SetSize(100, 22)
grindBtn:SetPoint("BOTTOMRIGHT", -14, 12)
grindBtn:SetScript("OnClick", function()
    if ns.char and ns.char.grind then ns.GrindStop() else ns.GrindStart() end
    ns.UpdateGrindButton()
end)
function ns.UpdateGrindButton()
    grindBtn:SetText(ns.char and ns.char.grind and "Stop grind" or "Start grind")
end
status:SetPoint("RIGHT", grindBtn, "LEFT", -8, 0)

---------------------------------------------------------------- grind panel
-- Shown only while a grind runs. Shift-click: pause / resume (a plain click does nothing, so a
-- stray click in combat can't pause it, #31). Right-click: stop. Drag to move.
local gp = CreateFrame("Button", "ClaudeCompanionGrind", UIParent, "BackdropTemplate")
gp:SetSize(236, 62)
gp:SetPoint("TOP", UIParent, "TOP", 0, -140)
gp:SetMovable(true)
gp:SetClampedToScreen(true)
gp:RegisterForDrag("LeftButton")
gp:RegisterForClicks("LeftButtonUp", "RightButtonUp")
gp:SetScript("OnDragStart", gp.StartMoving)
gp:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, rel, x, y = self:GetPoint()
    ClaudeCompanionDB.grindPanel = { point = point, rel = rel, x = x, y = y }
end)
pcall(gp.SetBackdrop, gp, {
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12,
    insets = { left = 3, right = 3, top = 3, bottom = 3 } })
pcall(gp.SetBackdropColor, gp, 0.03, 0.03, 0.06, 0.82)
pcall(gp.SetBackdropBorderColor, gp, 0.45, 0.45, 0.45, 1)
gp:Hide()

local gTitle = gp:CreateFontString(nil, "OVERLAY", "GameFontNormal")
gTitle:SetPoint("TOPLEFT", 9, -8); gTitle:SetPoint("RIGHT", -60, 0); gTitle:SetJustifyH("LEFT"); gTitle:SetWordWrap(false)
local gTime = gp:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
gTime:SetPoint("TOPRIGHT", -9, -8)
local gGold = gp:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
gGold:SetPoint("TOPLEFT", 9, -26); gGold:SetPoint("RIGHT", -9, 0); gGold:SetJustifyH("LEFT")
local gLoot = gp:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
gLoot:SetPoint("TOPLEFT", 9, -42); gLoot:SetPoint("RIGHT", -9, 0); gLoot:SetJustifyH("LEFT"); gLoot:SetWordWrap(false)

local function Clock(secs)
    secs = math.floor(secs)
    local h, m, s = math.floor(secs / 3600), math.floor(secs / 60) % 60, secs % 60
    return h > 0 and string.format("%d:%02d:%02d", h, m, s) or string.format("%d:%02d", m, s)
end
local function Short(c)
    c = math.floor(c or 0)
    if math.abs(c) >= 10000 then return string.format("%.1fg", c / 10000) end
    return string.format("%ds", math.floor(c / 100))
end

local function UpdatePanel()
    local g = ns.char and ns.char.grind
    if not g then gp:Hide(); return end
    local secs = ns.ActiveSecs(g)
    local hrs = math.max(secs, 60) / 3600
    local coin = (g.bySource and g.bySource.loot) or 0
    local _, items = ns.LootValue(g)
    gTitle:SetText(g.paused and ("|cffff6060PAUSED|r  " .. (g.name or "Grind")) or (g.name or "Grind"))
    gTime:SetText(g.paused and "|cffff6060paused|r" or Clock(secs))
    if g.paused then pcall(gp.SetBackdropBorderColor, gp, 0.9, 0.2, 0.2, 1) else pcall(gp.SetBackdropBorderColor, gp, 0.45, 0.45, 0.45, 1) end
    gGold:SetText(string.format("|cffffd100%s|r/hr   %s looted   %d kills", Short((coin + items) / hrs), Short(coin + items), g.kills))
    local best
    for _, l in pairs(g.loot) do
        if not best or (l.q or 0) > (best.q or 0) or ((l.q or 0) == (best.q or 0) and l.count > best.count) then best = l end
    end
    gLoot:SetText(best and ("Best: " .. (best.link or best.name or "?") .. (best.count > 1 and (" x" .. best.count) or "")) or "|cff9a9890no drops yet|r")
end

local ticker
function ns.GrindPanel()
    local g = ns.char and ns.char.grind
    if g then
        gp:Show()
        UpdatePanel()
        if not ticker then ticker = C_Timer.NewTicker(1, UpdatePanel) end
    else
        gp:Hide()
        if ticker then ticker:Cancel(); ticker = nil end
    end
    if ns.UpdateGrindButton then ns.UpdateGrindButton() end
end

gp:SetScript("OnClick", function(_, button)
    if button == "RightButton" then ns.GrindStop()
    elseif IsShiftKeyDown() then ns.GrindPause() end
    UpdatePanel()
end)
gp:SetScript("OnEnter", function(self)
    local g = ns.char and ns.char.grind
    if not g then return end
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:SetText(g.name or "Grind")
    GameTooltip:AddLine(ns.TrackerLine(g), 1, 1, 1, true)
    local list = {}
    for _, l in pairs(g.loot) do list[#list + 1] = l end
    table.sort(list, function(a, b) return (a.q or 0) > (b.q or 0) or ((a.q or 0) == (b.q or 0) and a.count > b.count) end)
    for i = 1, math.min(12, #list) do GameTooltip:AddDoubleLine(list[i].link or list[i].name or "?", "x" .. list[i].count, 1, 1, 1, 1, 1, 1) end
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine("Shift-click: pause or resume.  Right-click: stop.  Drag: move.  Ends by itself when you log out or after 30 min with nothing to count.", 0.6, 0.6, 0.6, true)
    GameTooltip:Show()
end)
gp:SetScript("OnLeave", function() GameTooltip:Hide() end)

ns.OnLogin(function()
    local pos = ClaudeCompanionDB.grindPanel
    if pos and pos.point then gp:ClearAllPoints(); gp:SetPoint(pos.point, UIParent, pos.rel or pos.point, pos.x or 0, pos.y or 0) end
    ns.GrindPanel()
end)

---------------------------------------------------------------- slash commands
local HELP = {
    "/cc  open or close the Claude window",
    "/cc start [name]  start a grind, e.g. /cc start azshara",
    "/cc stop  finish the grind and show the summary",
    "/cc pause  pause or resume the grind",
    "/reload  saves everything (WoW writes addon data only on /reload and logout)",
    "/cc note <text>  leave Claude a note",
    "/cc status  gold, kills and XP per hour so far",
    "/cc scan  scan the whole auction house (AH open, every 15 min)",
}

local function Slash(msg)
    msg = strtrim(msg or "")
    local cmd, rest = msg:match("^(%S+)%s*(.-)$")
    cmd = (cmd or ""):lower()
    if cmd == "" then ClaudeCompanion_Toggle()
    elseif cmd == "sync" or cmd == "save" then ns.Print("/cc sync is gone: type /reload, it saves everything.")
    elseif cmd == "note" or cmd == "n" then
        if rest == "" then ns.Print("type /cc note followed by your note.")
        else ns.AddNote(rest); ns.Print("note saved.") end
    elseif cmd == "start" or cmd == "new" or cmd == "grind" then
        local g = ns.GrindStart(rest)
        if g then ns.Print("grind started: |cffffd100" .. g.name .. "|r. /cc stop when you're done.") end
    elseif cmd == "stop" or cmd == "end" or cmd == "finish" then
        if not ns.GrindStop() then ns.Print("no grind running. /cc start to begin one.")
        else ns.Print("the app shows it after the game saves: /reload now, or it goes at logout.") end
    elseif cmd == "pause" or cmd == "resume" then
        local paused = ns.GrindPause()
        if paused == nil then ns.Print("no grind running.") else ns.Print(paused and "grind paused." or "grind resumed.") end
    elseif cmd == "scan" then ns.AHScan()
    elseif cmd == "status" or cmd == "s" then
        local g = ns.char and ns.char.grind
        ns.Print(g and ns.TrackerLine(g) or ns.SessionLine())
    else for _, l in ipairs(HELP) do ns.Print(l) end end
end

SLASH_CLAUDECOMPANION1 = "/cc"
SLASH_CLAUDECOMPANION2 = "/claude"
SlashCmdList.CLAUDECOMPANION = Slash
