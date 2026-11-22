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
    .. "/cc start <name> tracks a grind, /cc target <item> counts an item you farm for, /cc stop ends it, /cc scan scans the Auction House."
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
-- Shown while a grind runs, and after /cc stop as the grind's summary until you close it.
-- Graphite, like the app: dark surface, one gold accent, quality colours on items, amber = needs you.
--   Shift-click: pause / resume (a plain click does nothing, so a stray click in combat can't pause it, #31).
--   Shift-right-click: stop (then the panel shows the summary; right-click or x closes it).
--   Alt-click a drop: make it a target, or take it off. Drag: move.
local C = { -- docs/ui-language.md, css/app.css :root
    bg = { 0.086, 0.090, 0.106, 0.92 }, line = { 0.141, 0.145, 0.169, 1 }, edge = { 0.188, 0.192, 0.224, 1 },
    t1 = { 0.925, 0.925, 0.933 }, t2 = { 0.639, 0.643, 0.678 }, t3 = { 0.424, 0.427, 0.467 },
    acc = { 0.886, 0.702, 0.271 }, pos = { 0.310, 0.765, 0.541 }, warn = { 0.914, 0.635, 0.231 },
}
local Q = { [0] = { 0.62, 0.62, 0.62 }, { 1, 1, 1 }, { 0.12, 1, 0 }, { 0, 0.44, 0.87 }, { 0.64, 0.21, 0.93 }, { 1, 0.5, 0 }, { 0.9, 0.8, 0.5 } }
local PW, PAD, ICON, NDROPS = 252, 10, 22, 8
local FONT = STANDARD_TEXT_FONT or "Fonts\\FRIZQT__.TTF"

local gp = CreateFrame("Button", "ClaudeCompanionGrind", UIParent, "BackdropTemplate")
gp:SetSize(PW, 120)
gp:SetPoint("TOP", UIParent, "TOP", 0, -140)
gp:SetMovable(true)
gp:SetClampedToScreen(true)
gp:SetFrameStrata("MEDIUM")
gp:RegisterForDrag("LeftButton")
gp:RegisterForClicks("LeftButtonUp", "RightButtonUp")
gp:SetScript("OnDragStart", gp.StartMoving)
gp:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, rel, x, y = self:GetPoint()
    ClaudeCompanionDB.grindPanel = { point = point, rel = rel, x = x, y = y }
end)
pcall(gp.SetBackdrop, gp, { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
pcall(gp.SetBackdropColor, gp, unpack(C.bg))
local function Edge(c) pcall(gp.SetBackdropBorderColor, gp, c[1], c[2], c[3], c[4] or 1) end
Edge(C.edge)
gp:Hide()

local function Text(parent, size, color, justify)
    local fs = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    pcall(fs.SetFont, fs, FONT, size, "")
    fs:SetTextColor(color[1], color[2], color[3])
    fs:SetJustifyH(justify or "LEFT")
    fs:SetWordWrap(false)
    return fs
end
local function Rule(y)
    local t = gp:CreateTexture(nil, "ARTWORK")
    t:SetColorTexture(unpack(C.line))
    t:SetHeight(1)
    t:SetPoint("TOPLEFT", PAD, y); t:SetPoint("TOPRIGHT", -PAD, y)
    return t
end

-- header: state dot, name, clock (or x when finished)
local dot = gp:CreateTexture(nil, "ARTWORK")
dot:SetSize(6, 6)
dot:SetPoint("TOPLEFT", PAD, -13)
local gName = Text(gp, 13, C.t1)
gName:SetPoint("TOPLEFT", PAD + 12, -9)
-- (its right edge is tied to the clock below, so a long name never runs under it)
local gClock = Text(gp, 13, C.t1, "RIGHT")
gClock:SetPoint("TOPRIGHT", -PAD, -9)
gName:SetPoint("RIGHT", gClock, "LEFT", -8, 0)
local closeBtn = CreateFrame("Button", nil, gp)
closeBtn:SetSize(16, 16)
closeBtn:SetPoint("TOPRIGHT", -6, -7)
local closeX = Text(closeBtn, 14, C.t2, "CENTER")
closeX:SetAllPoints()
closeX:SetText("x")
closeBtn:Hide()

-- three numbers: gold per hour, kills per hour, deaths
local tiles = {}
for i = 1, 3 do
    local x = PAD + (i - 1) * math.floor((PW - 2 * PAD) / 3)
    local v = Text(gp, i == 1 and 17 or 15, i == 1 and C.acc or C.t1)
    v:SetPoint("TOPLEFT", x, -30)
    local k = Text(gp, 10, C.t3)
    k:SetPoint("TOPLEFT", x, -50)
    k:SetWidth(math.floor((PW - 2 * PAD) / 3) - 4) -- a long label is cut, never drawn over the next one
    tiles[i] = { v = v, k = k }
end
-- where the gold comes from, per hour
local gSplit = Text(gp, 11, C.t2)
gSplit:SetPoint("TOPLEFT", PAD, -66)
gSplit:SetPoint("RIGHT", -PAD, 0)
local rule1 = Rule(-84)

-- targets: icon, name, dropped vs expected
local targetRows = {}
for i = 1, 3 do
    local b = CreateFrame("Button", nil, gp)
    b:SetHeight(18)
    local ic = b:CreateTexture(nil, "ARTWORK")
    ic:SetSize(14, 14); ic:SetPoint("LEFT", 0, 0)
    pcall(ic.SetTexCoord, ic, 0.08, 0.92, 0.08, 0.92)
    local v = Text(b, 11, C.t2, "RIGHT")
    v:SetPoint("RIGHT", 0, 0)
    local n = Text(b, 11, C.t1)
    n:SetPoint("LEFT", ic, "RIGHT", 6, 0); n:SetPoint("RIGHT", v, "LEFT", -8, 0)
    b.ic, b.n, b.v = ic, n, v
    b:Hide()
    targetRows[i] = b
end
local rule2 = Rule(-100)

-- notable drops, most valuable first
local dropBtns = {}
for i = 1, NDROPS do
    local b = CreateFrame("Button", nil, gp)
    b:SetSize(ICON, ICON)
    b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    local border = b:CreateTexture(nil, "BACKGROUND")
    border:SetAllPoints()
    local ic = b:CreateTexture(nil, "ARTWORK")
    ic:SetPoint("TOPLEFT", 1, -1); ic:SetPoint("BOTTOMRIGHT", -1, 1)
    pcall(ic.SetTexCoord, ic, 0.08, 0.92, 0.08, 0.92)
    local n = Text(b, 10, C.t1, "RIGHT")
    pcall(n.SetFont, n, FONT, 10, "OUTLINE")
    n:SetPoint("BOTTOMRIGHT", 1, 0)
    b.border, b.ic, b.n = border, ic, n
    b:Hide()
    dropBtns[i] = b
end
local gNone = Text(gp, 11, C.t3)
local gFoot = Text(gp, 10, C.t3)
gFoot:SetPoint("LEFT", PAD, 0); gFoot:SetPoint("RIGHT", -PAD, 0)

local function Clock(secs)
    secs = math.floor(secs)
    local h, m, s = math.floor(secs / 3600), math.floor(secs / 60) % 60, secs % 60
    return h > 0 and string.format("%d:%02d:%02d", h, m, s) or string.format("%d:%02d", m, s)
end
-- short money: 42.3g, 7g, 85s
local function Short(c)
    c = math.floor(c or 0)
    if math.abs(c) >= 1000000 then return string.format("%dg", math.floor(c / 10000)) end
    if math.abs(c) >= 10000 then return (string.format("%.1f", c / 10000):gsub("%.0$", "")) .. "g" end
    return string.format("%ds", math.floor(c / 100))
end
local function IconOf(l)
    local e = l.item and ClaudeCompanionDB.items[l.item]
    return (e and e.icon) or ns.Clean(ns.Call(C_Item and C_Item.GetItemIconByID, l.id)) or "Interface\\Icons\\INV_Misc_QuestionMark"
end
local function Quality(q) return Q[q or 1] or Q[1] end
local LINK_Q = { ["9d9d9d"] = 0, ffffff = 1, ["1eff00"] = 2, ["0070dd"] = 3, a335ee = 4, ff8000 = 5, e6cc80 = 6 }
local function QualityOf(t)
    local q = ns.Clean(ns.Call(C_Item and C_Item.GetItemQualityByID, t.id))
    if type(q) == "number" then return q end
    local hex = t.link and t.link:match("^|cff(%x%x%x%x%x%x)")
    return hex and LINK_Q[hex:lower()] or 1
end
local function Hex(c) return string.format("|cff%02x%02x%02x", c[1] * 255, c[2] * 255, c[3] * 255) end

-- the loot of a grind with its value (AH median of your newest scan, else vendor), best first;
-- grey items only when there is nothing else
local function Drops(g)
    local list = {}
    for id, l in pairs(g.loot or {}) do
        local e = l.item and ClaudeCompanionDB.items[l.item]
        local each = ns.PlanPrice(l.id or id)
        local priced = each ~= nil
        each = each or (e and e.sell) or 0
        list[#list + 1] = { l = l, value = each * l.count, priced = priced, q = l.q or (e and e.q) or 1 }
    end
    local any = false
    for _, d in ipairs(list) do if d.q >= 1 then any = true end end
    if any then
        local keep = {}
        for _, d in ipairs(list) do if d.q >= 1 then keep[#keep + 1] = d end end
        list = keep
    end
    table.sort(list, function(a, b)
        if a.value ~= b.value then return a.value > b.value end
        if a.q ~= b.q then return a.q > b.q end
        return a.l.count > b.l.count
    end)
    return list
end

local finished -- the grind the summary shows, after /cc stop
local function Current() return (ns.char and ns.char.grind) or finished end

local function TargetText(t)
    local got = t.got or 0
    local gotTxt = (got > 0 and Hex(C.pos) or Hex(C.t1)) .. got .. "|r"
    if t.expected then return gotTxt .. Hex(C.t3) .. string.format(" of %.2f", t.expected) .. "|r" end
    if t.rated then return gotTxt .. Hex(C.t3) .. " · none killed" .. "|r" end
    if got > 0 and (t.kills or 0) > 0 then return gotTxt .. Hex(C.t3) .. (got >= t.kills and " · 1+ per kill" or string.format(" · 1 per %d kills", math.floor(t.kills / got + 0.5))) .. "|r" end
    return gotTxt .. Hex(C.t3) .. " · rate unknown|r"
end

local function Layout(g)
    local y = -90
    local nt = 0
    for i, row in ipairs(targetRows) do
        local t = g.targets and g.targets[i]
        if t then
            ns.TargetStats(g, t)
            nt = nt + 1
            row:ClearAllPoints()
            row:SetPoint("TOPLEFT", PAD, y); row:SetPoint("RIGHT", -PAD, 0)
            local e = { id = t.id }
            row.ic:SetTexture(IconOf(e))
            local q = Quality(QualityOf(t))
            row.n:SetText(t.name or "?")
            row.n:SetTextColor(q[1], q[2], q[3])
            row.v:SetText(TargetText(t))
            row.t = t
            row:Show()
            y = y - 18
        else
            row:Hide()
        end
    end
    if nt > 0 then
        rule2:Show(); rule2:ClearAllPoints()
        rule2:SetPoint("TOPLEFT", PAD, y - 4); rule2:SetPoint("TOPRIGHT", -PAD, y - 4)
        y = y - 10
    else
        rule2:Hide()
    end
    local list = Drops(g)
    for i, b in ipairs(dropBtns) do
        local d = list[i]
        if d then
            b:ClearAllPoints()
            b:SetPoint("TOPLEFT", PAD + (i - 1) * (ICON + 6), y)
            b.ic:SetTexture(IconOf(d.l))
            local q = Quality(d.q)
            b.border:SetColorTexture(q[1] * 0.8, q[2] * 0.8, q[3] * 0.8, d.q >= 2 and 1 or 0.35)
            b.n:SetText(d.l.count > 1 and d.l.count or "")
            b.d = d
            b:Show()
        else
            b:Hide(); b.d = nil
        end
    end
    if #list == 0 then
        gNone:ClearAllPoints(); gNone:SetPoint("TOPLEFT", PAD, y - 4)
        gNone:SetText("No drops yet")
        gNone:Show()
        y = y - 20
    else
        gNone:Hide()
        y = y - ICON - 2
    end
    if finished and not (ns.char and ns.char.grind) then
        gFoot:ClearAllPoints(); gFoot:SetPoint("TOPLEFT", PAD, y - 6); gFoot:SetPoint("RIGHT", -PAD, 0)
        gFoot:SetText("Saved to the app at your next /reload or logout")
        gFoot:Show()
        y = y - 20
    else
        gFoot:Hide()
    end
    gp:SetHeight(-y + 8)
end

local function UpdatePanel()
    local g = Current()
    if not g then gp:Hide(); return end
    local running = g == (ns.char and ns.char.grind)
    local secs = g.secs or ns.ActiveSecs(g)
    local hrs = math.max(secs, 60) / 3600
    local coin = (g.bySource and g.bySource.loot) or 0
    local _, items = ns.LootValue(g)
    gName:SetText(g.name or "Grind")
    if not running then
        dot:SetColorTexture(C.t3[1], C.t3[2], C.t3[3], 1)
        gClock:SetText(Hex(C.t2) .. "done · " .. Clock(secs) .. "|r")
        gClock:ClearAllPoints(); gClock:SetPoint("TOPRIGHT", -26, -9)
        closeBtn:Show()
        Edge(C.edge)
    elseif g.paused then
        dot:SetColorTexture(C.warn[1], C.warn[2], C.warn[3], 1)
        gClock:SetText(Hex(C.warn) .. "Paused|r")
        gClock:ClearAllPoints(); gClock:SetPoint("TOPRIGHT", -PAD, -9)
        closeBtn:Hide()
        Edge(C.warn)
    else
        dot:SetColorTexture(C.pos[1], C.pos[2], C.pos[3], 1)
        gClock:SetText(Clock(secs))
        gClock:ClearAllPoints(); gClock:SetPoint("TOPRIGHT", -PAD, -9)
        closeBtn:Hide()
        Edge(C.edge)
    end
    tiles[1].v:SetText(Short((coin + items) / hrs))
    tiles[1].k:SetText("gold / hr")
    tiles[2].v:SetText(tostring(math.floor((g.kills or 0) / hrs + 0.5)))
    tiles[2].k:SetText(string.format("kills/hr · %d", g.kills or 0))
    tiles[3].v:SetText(tostring(g.deaths or 0))
    tiles[3].v:SetTextColor(unpack((g.deaths or 0) > 0 and C.warn or C.t1))
    tiles[3].k:SetText((g.deaths or 0) == 1 and "death" or "deaths")
    gSplit:SetText(string.format("Coin %s/hr  ·  Items %s/hr", Short(coin / hrs), Short(items / hrs)))
    Layout(g)
end
ns.UpdateGrindPanel = UpdatePanel

local ticker
function ns.GrindPanel(done)
    local g = ns.char and ns.char.grind
    if g then finished = nil elseif done then finished = done end
    if g or finished then
        gp:Show()
        UpdatePanel()
    else
        gp:Hide()
    end
    if g and not ticker then ticker = C_Timer.NewTicker(1, UpdatePanel)
    elseif not g and ticker then ticker:Cancel(); ticker = nil end
    if ns.UpdateGrindButton then ns.UpdateGrindButton() end
end
local function CloseSummary() finished = nil; ns.GrindPanel() end
closeBtn:SetScript("OnClick", CloseSummary)

gp:SetScript("OnClick", function(_, button)
    local running = ns.char and ns.char.grind
    if not running then
        if button == "RightButton" then CloseSummary() end
        return
    end
    if button == "RightButton" and IsShiftKeyDown() then ns.GrindStop()
    elseif button == "LeftButton" and IsShiftKeyDown() then ns.GrindPause() end
    if Current() then UpdatePanel() end
end)

local HINT = "Shift-click: pause or resume.  Shift-right-click: stop.  Alt-click a drop: make it a target.  Drag: move."
gp:SetScript("OnEnter", function(self)
    local g = Current()
    if not g then return end
    local secs = g.secs or ns.ActiveSecs(g)
    local hrs = math.max(secs, 60) / 3600
    local coin = (g.bySource and g.bySource.loot) or 0
    local vendor, items = ns.LootValue(g)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:SetText(g.name or "Grind")
    GameTooltip:AddDoubleLine("Time counted", Clock(secs), 0.64, 0.64, 0.68, 1, 1, 1)
    GameTooltip:AddDoubleLine("Gold looted", ns.Money(coin), 0.64, 0.64, 0.68, 1, 1, 1)
    GameTooltip:AddDoubleLine("Items (AH, else vendor)", ns.Money(items), 0.64, 0.64, 0.68, 1, 1, 1)
    GameTooltip:AddDoubleLine("Items at vendor", ns.Money(vendor), 0.64, 0.64, 0.68, 1, 1, 1)
    GameTooltip:AddDoubleLine("Total", ns.Money(coin + items) .. "  (" .. Short((coin + items) / hrs) .. "/hr)", 0.64, 0.64, 0.68, 0.89, 0.70, 0.27)
    local mobs = {}
    for n, k in pairs(g.killsBy or {}) do mobs[#mobs + 1] = { n, k } end
    table.sort(mobs, function(a, b) return a[2] > b[2] end)
    if #mobs > 0 then
        GameTooltip:AddLine(" ")
        for i = 1, math.min(6, #mobs) do
            GameTooltip:AddDoubleLine(mobs[i][1], string.format("%d  (%d/hr)", mobs[i][2], math.floor(mobs[i][2] / hrs + 0.5)), 1, 1, 1, 0.64, 0.64, 0.68)
        end
    end
    if (g.disenchants and next(g.disenchants)) then GameTooltip:AddLine("Disenchanted items count by what they gave.", 0.42, 0.43, 0.47, true) end
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine((ns.char and ns.char.grind) and HINT or "Right-click or x: close.", 0.42, 0.43, 0.47, true)
    GameTooltip:Show()
end)
gp:SetScript("OnLeave", function() GameTooltip:Hide() end)

for _, row in ipairs(targetRows) do
    row:SetScript("OnEnter", function(self)
        local t = self.t
        if not t then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        if t.link then GameTooltip:SetHyperlink(t.link) else GameTooltip:SetText(t.name or "?") end
        GameTooltip:AddLine(" ")
        GameTooltip:AddDoubleLine("Dropped", tostring(t.got or 0), 0.64, 0.64, 0.68, 1, 1, 1)
        if t.expected then
            GameTooltip:AddDoubleLine("Expected from " .. t.kills .. " kills", string.format("%.2f", t.expected), 0.64, 0.64, 0.68, 1, 1, 1)
            if (t.got or 0) == 0 then
                GameTooltip:AddDoubleLine("Chance of none by now", string.format("%d%%", math.floor(t.none * 100 + 0.5)), 0.64, 0.64, 0.68, 1, 1, 1)
            end
            GameTooltip:AddLine(string.format("Drop chances ForeverDB measured on Forever kills (at least %d kills each).", t.sample or 0), 0.42, 0.43, 0.47, true)
        elseif not ns.DROPS then
            GameTooltip:AddLine("Drop chances show after you restart the game (this update added them).", 0.91, 0.64, 0.23, true)
        elseif t.rated then
            GameTooltip:AddLine("Nothing you killed in this grind drops it.", 0.42, 0.43, 0.47, true)
        else
            GameTooltip:AddLine("Forever drop rate unknown: no one has measured it on Forever. Classic rates aren't used.", 0.42, 0.43, 0.47, true)
            local r, lo, hi = ns.OwnRange(t.got or 0, t.kills)
            if r then
                GameTooltip:AddDoubleLine(string.format("Yours: %d in %d kills", t.got or 0, t.kills),
                    string.format("%.1f%% (95%%: %.1f-%.1f%%)", r, lo, hi), 0.64, 0.64, 0.68, 1, 1, 1)
            end
        end
        local rows = ns.DROPS and ns.DROPS[t.id]
        if rows then
            GameTooltip:AddLine(" ")
            for i = 1, math.min(18, #rows), 3 do
                GameTooltip:AddDoubleLine(rows[i], string.format("%s%%  (%d kills)", rows[i + 1], rows[i + 2]), 1, 1, 1, 0.64, 0.64, 0.68)
            end
        end
        GameTooltip:AddLine((ns.char and ns.char.grind) and "/cc target the item again to take it off." or " ", 0.42, 0.43, 0.47, true)
        GameTooltip:Show()
    end)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

for _, b in ipairs(dropBtns) do
    b:SetScript("OnEnter", function(self)
        local d = self.d
        if not d then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        if d.l.link then GameTooltip:SetHyperlink(d.l.link) else GameTooltip:SetText(d.l.name or "?") end
        GameTooltip:AddLine(" ")
        GameTooltip:AddDoubleLine("Looted", "x" .. d.l.count, 0.64, 0.64, 0.68, 1, 1, 1)
        GameTooltip:AddDoubleLine(d.priced and "Worth (your AH scan)" or "Worth (vendor, no AH price)", ns.Money(d.value), 0.64, 0.64, 0.68, 1, 1, 1)
        if ns.char and ns.char.grind then GameTooltip:AddLine("Alt-click: make it a target (dropped vs expected).", 0.42, 0.43, 0.47, true) end
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    b:SetScript("OnClick", function(self)
        local d = self.d
        if d and IsAltKeyDown and IsAltKeyDown() and ns.char and ns.char.grind then
            local added, name = ns.GrindTarget(d.l.link or tostring(d.l.id or ""))
            if added == nil then ns.Print(name)
            else ns.Print((added and "target: " or "no longer a target: ") .. (d.l.link or name or "?")) end
        end
    end)
end

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
    "/cc target [item]  farm for an item: the panel shows dropped vs expected (again to take it off)",
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
    elseif cmd == "target" or cmd == "t" then
        local g = ns.char and ns.char.grind
        if rest == "" then
            if not g then ns.Print("no grind running. /cc start <name>, then /cc target <item>.")
            elseif not g.targets or #g.targets == 0 then ns.Print("no targets. Shift-click an item into /cc target, or alt-click a drop on the panel.")
            else for _, t in ipairs(g.targets) do ns.TargetStats(g, t); ns.Print((t.link or t.name or "?") .. ": " .. (t.got or 0) .. " dropped"
                .. (t.expected and string.format(", %.2f expected", t.expected) or "")) end end
        else
            local added, why = ns.GrindTarget(rest)
            if added == nil then ns.Print(why)
            else ns.Print((added and "target: " or "no longer a target: ") .. why .. (added and ". The panel shows dropped vs expected." or ".")) end
        end
    elseif cmd == "scan" then ns.AHScan()
    elseif cmd == "status" or cmd == "s" then
        local g = ns.char and ns.char.grind
        ns.Print(g and ns.TrackerLine(g) or ns.SessionLine())
    else for _, l in ipairs(HELP) do ns.Print(l) end end
end

SLASH_CLAUDECOMPANION1 = "/cc"
SLASH_CLAUDECOMPANION2 = "/claude"
SlashCmdList.CLAUDECOMPANION = Slash
