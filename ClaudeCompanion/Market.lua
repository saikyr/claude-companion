-- Auction house prices you see, auctions you post, your active auctions,
-- and the mailbox (including AH sale invoices = real sale prices).
local _, ns = ...
local Clean, Call, Copy = ns.Clean, ns.Call, ns.Copy
local AH = C_AuctionHouse

---------------------------------------------------------------- price records
-- ah.prices[key] = { id, suffix, name, q, icon, last, obs = { {t, min, qty, src}, ... } }
-- key = "itemID" or "itemID:suffix" (random-suffix items: the suffix number from the link, or, when the link
-- has none, the roll's name from the listing, "3192:of Healing"). min = per-unit copper.
local function Key(itemID, suffix)
    if not itemID then return nil end
    if suffix and suffix ~= 0 then return itemID .. ":" .. suffix end
    return tostring(itemID)
end

local lastObs = {}
local function Observe(itemID, suffix, unitPrice, qty, src, extra)
    itemID, unitPrice = Clean(itemID), Clean(unitPrice)
    if not ns.char or not itemID or not unitPrice or unitPrice <= 0 then return end
    local key = Key(itemID, Clean(suffix))
    local prices = ns.char.ah.prices
    local p = prices[key]
    if not p then p = { id = itemID, suffix = Clean(suffix), obs = {} }; prices[key] = p end
    if extra then for k, v in pairs(extra) do if p[k] == nil then p[k] = v end end end
    if not p.name then
        p.name = Clean(Call(C_Item and C_Item.GetItemNameByID or GetItemInfo, itemID))
    end
    local now = ns.Now()
    -- one observation per item per 5 minutes is plenty
    local prev = lastObs[key]
    if prev and now - prev.t < 300 then
        if unitPrice < prev.min then prev.min = unitPrice end
        prev.qty = math.max(prev.qty or 0, Clean(qty) or 0)
        return
    end
    local o = { t = now, min = unitPrice, qty = Clean(qty), src = src }
    lastObs[key] = o
    p.last = now
    ns.Push(p.obs, o, ns.LIMITS.priceObs)
end
ns.ObservePrice = Observe

---------------------------------------------------------------- modern AH (C_AuctionHouse)
local function ReadBrowse(results)
    if type(results) ~= "table" then return end
    for _, r in ipairs(results) do
        local k = type(r.itemKey) == "table" and r.itemKey or nil
        if k then
            Observe(k.itemID, k.itemSuffix, r.minPrice, r.totalQuantity, "browse", { ilvl = Clean(k.itemLevel) })
        end
    end
end

if AH then
    ns.On("AUCTION_HOUSE_BROWSE_RESULTS_UPDATED", function() ReadBrowse(Call(AH.GetBrowseResults)) end)
    ns.On("AUCTION_HOUSE_BROWSE_RESULTS_ADDED", function(added) ReadBrowse(added) end)

    ns.On("COMMODITY_SEARCH_RESULTS_UPDATED", function(itemID)
        itemID = Clean(itemID)
        if not itemID then return end
        local n = Clean(Call(AH.GetNumCommoditySearchResults, itemID)) or 0
        local qty, cheapest = 0, nil
        for i = 1, math.min(n, 50) do
            local r = Call(AH.GetCommoditySearchResultInfo, itemID, i)
            if type(r) == "table" then
                local up = Clean(r.unitPrice)
                if up and (not cheapest or up < cheapest) then cheapest = up end
                qty = qty + (Clean(r.quantity) or 0)
            end
        end
        if cheapest then Observe(itemID, nil, cheapest, qty, "search") end
    end)

    ns.On("ITEM_SEARCH_RESULTS_UPDATED", function(itemKey)
        if type(itemKey) ~= "table" or ns.IsSecret(itemKey) then return end
        local n = Clean(Call(AH.GetNumItemSearchResults, itemKey)) or 0
        local cheapest, qty, link = nil, 0, nil
        for i = 1, math.min(n, 50) do
            local r = Call(AH.GetItemSearchResultInfo, itemKey, i)
            if type(r) == "table" then
                local buy, q = Clean(r.buyoutAmount), Clean(r.quantity) or 1
                if buy and q > 0 then
                    local up = math.floor(buy / q)
                    if not cheapest or up < cheapest then cheapest = up; link = Clean(r.itemLink) end
                end
                qty = qty + q
            end
        end
        if cheapest then
            if link then ns.NoteItem(link) end
            Observe(itemKey.itemID, itemKey.itemSuffix, cheapest, qty, "search", { link = link })
        end
    end)

    -- what you post
    local function Posted(kind, loc, duration, qty, a, b)
        if not ns.char then return end
        local link = loc and Clean(Call(C_Item and C_Item.GetItemLink, loc))
        local itemID = loc and Clean(Call(C_Item and C_Item.GetItemID, loc))
        local unit
        if kind == "commodity" then unit = Clean(a) else
            local buyout = Clean(b) or Clean(a)
            if buyout and Clean(qty) and qty > 0 then unit = math.floor(buyout / qty) end
        end
        local post = { t = ns.Now(), kind = kind, link = link, item = ns.NoteItem(link), id = itemID, qty = Clean(qty),
            unit = unit, duration = Clean(duration) }
        ns.Push(ns.char.ah.posts, post, ns.LIMITS.posts)
        ns.Log("ahPost", { link = link, qty = post.qty, unit = unit })
    end
    if AH.PostItem then hooksecurefunc(AH, "PostItem", function(loc, dur, qty, bid, buyout) Posted("item", loc, dur, qty, bid, buyout) end) end
    if AH.PostCommodity then hooksecurefunc(AH, "PostCommodity", function(loc, dur, qty, unit) Posted("commodity", loc, dur, qty, unit) end) end

    -- your active auctions
    ns.On("OWNED_AUCTIONS_UPDATED", function()
        if not ns.char then return end
        local n = Clean(Call(AH.GetNumOwnedAuctions)) or 0
        local out = {}
        for i = 1, n do
            local r = Call(AH.GetOwnedAuctionInfo, i)
            if type(r) == "table" then
                local link = Clean(r.itemLink)
                out[#out + 1] = { link = link, item = ns.NoteItem(link), id = type(r.itemKey) == "table" and Clean(r.itemKey.itemID),
                    qty = Clean(r.quantity), buyout = Clean(r.buyoutAmount), bid = Clean(r.bidAmount),
                    status = Clean(r.status), left = Clean(r.timeLeftSeconds), auctionID = Clean(r.auctionID) }
            end
        end
        ns.char.ah.owned = { taken = ns.Now(), list = out }
    end)
end

---------------------------------------------------------------- classic AH fallback
ns.On("AUCTION_ITEM_LIST_UPDATE", function()
    if not GetNumAuctionItems then return end
    local n = Clean(Call(GetNumAuctionItems, "list")) or 0
    local best = {}
    for i = 1, n do
        local name, _, count, q, _, _, _, _, _, buyout, _, _, _, owner, _, _, itemID = Call(GetAuctionItemInfo, "list", i)
        count, buyout, itemID = Clean(count), Clean(buyout), Clean(itemID)
        if itemID and buyout and buyout > 0 and count and count > 0 then
            local up = math.floor(buyout / count)
            local b = best[itemID]
            if not b then best[itemID] = { min = up, qty = count, name = Clean(name), q = Clean(q) }
            else b.qty = b.qty + count; if up < b.min then b.min = up end end
        end
    end
    for id, b in pairs(best) do Observe(id, nil, b.min, b.qty, "scan", { name = b.name, q = b.q }) end
end)
if PostAuction then
    hooksecurefunc("PostAuction", function(minBid, buyout, runTime, stackSize, numStacks)
        if not ns.char then return end
        local name, _, count = Call(GetAuctionSellItemInfo)
        local size = Clean(stackSize) or Clean(count) or 1
        local post = { t = ns.Now(), kind = "classic", name = Clean(name), qty = size, stacks = Clean(numStacks),
            unit = Clean(buyout) and math.floor(buyout / math.max(1, size)), duration = Clean(runTime) }
        ns.Push(ns.char.ah.posts, post, ns.LIMITS.posts)
        ns.Log("ahPost", { name = post.name, qty = size, unit = post.unit })
    end)
end

---------------------------------------------------------------- AH system messages
local function Pat(fmt)
    if type(fmt) ~= "string" then return nil end
    local p = fmt:gsub("([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
    p = p:gsub("%%s", "(.+)")
    return "^" .. p .. "$"
end
local SYSTEM = {
    { Pat(ERR_AUCTION_SOLD_S), "ahSold" }, { Pat(ERR_AUCTION_EXPIRED_S), "ahExpired" },
    { Pat(ERR_AUCTION_OUTBID_S), "ahOutbid" }, { Pat(ERR_AUCTION_WON_S), "ahWon" },
    { Pat(ERR_AUCTION_REMOVED_S), "ahRemoved" },
}
ns.On("CHAT_MSG_SYSTEM", function(text)
    text = Clean(text)
    if not text or not ns.char then return end
    for _, p in ipairs(SYSTEM) do
        if p[1] then
            local item = text:match(p[1])
            if item then ns.Log(p[2], { name = item }); return end
        end
    end
end)

---------------------------------------------------------------- mailbox
local function ReadMail()
    local c = ns.char
    if not c then return end
    local n = Clean(Call(GetInboxNumItems)) or 0
    local list = {}
    local maxAtt = ATTACHMENTS_MAX_RECEIVE or 16
    ns.mailByLink = ns.mailByLink or {}
    for i = 1, n do
        local _, _, sender, subject, money, cod, daysLeft, itemCount, wasRead, wasReturned = Call(GetInboxHeaderInfo, i)
        local m = { sender = Clean(sender), subject = Clean(subject), money = Clean(money), cod = Clean(cod),
            daysLeft = Clean(daysLeft), items = {}, read = Clean(wasRead), returned = Clean(wasReturned) }
        if Clean(itemCount) and itemCount > 0 then
            for a = 1, maxAtt do
                local link = Clean(Call(GetInboxItemLink, i, a))
                if link then
                    local _, _, _, count = Call(GetInboxItem, i, a)
                    m.items[#m.items + 1] = { link = link, item = ns.NoteItem(link), count = Clean(count) }
                    ns.mailByLink[link] = { letter = m, at = GetTime() }
                end
            end
        end
        -- returns per warcraft.wiki.gg API_GetInboxInvoiceInfo (Forever 1.60.1 listed): the 11th is the count
        local invType, itemName, player, bid, buyout, deposit, consignment, _, _, _, count = Call(GetInboxInvoiceInfo, i)
        if Clean(invType) then
            m.invoice = { type = Clean(invType), item = Clean(itemName), player = Clean(player), bid = Clean(bid),
                buyout = Clean(buyout), deposit = Clean(deposit), cut = Clean(consignment), count = Clean(count) }
            -- a won item's letter carries the item itself: its stack size is the count when the invoice has none
            if not m.invoice.count and #m.items > 0 then
                local n = 0
                for _, x in ipairs(m.items) do n = n + (x.count or 1) end
                m.invoice.count = n
            end
            -- record each sale once (same item + price + days left = same letter)
            -- what you paid for things you won (for flip profit)
            if m.invoice.type == "buyer" then
                local id = table.concat({ "buy", tostring(m.invoice.item), tostring(m.invoice.bid),
                    tostring(m.daysLeft and math.floor(m.daysLeft * 24) or "") }, "|")
                c.ah.salesSeen = c.ah.salesSeen or {}
                c.ah.buys = c.ah.buys or {}
                if not c.ah.salesSeen[id] then
                    c.ah.salesSeen[id] = true
                    local boughtAt = m.daysLeft and (ns.Now() - math.floor((30 - m.daysLeft) * 86400)) or ns.Now()
                    ns.Push(c.ah.buys, { t = boughtAt, seenAt = ns.Now(), item = m.invoice.item, price = m.invoice.bid,
                        count = m.invoice.count, seller = m.invoice.player }, ns.LIMITS.sales)
                end
            end
            if m.invoice.type == "seller" then
                -- (not the letter's money: it drops to 0 once you take the gold)
                local id = table.concat({ tostring(m.invoice.item), tostring(m.invoice.bid),
                    tostring(m.daysLeft and math.floor(m.daysLeft * 24) or "") }, "|")
                c.ah.salesSeen = c.ah.salesSeen or {}
                if not c.ah.salesSeen[id] then
                    c.ah.salesSeen[id] = true
                    -- mail lasts 30 days: estimate when the sale happened
                    local soldAt = m.daysLeft and (ns.Now() - math.floor((30 - m.daysLeft) * 86400)) or ns.Now()
                    ns.Push(c.ah.sales, { t = soldAt, seenAt = ns.Now(), item = m.invoice.item, price = m.invoice.bid,
                        count = m.invoice.count, buyer = m.invoice.player, net = (m.invoice.bid or 0) + (m.invoice.deposit or 0) - (m.invoice.cut or 0), cut = m.invoice.cut, deposit = m.invoice.deposit }, ns.LIMITS.sales)
                end
            end
        end
        list[#list + 1] = m
    end
    c.mail = { taken = ns.Now(), list = list }
end
-- "won" / "expired" / "cancelled" / "sale" / a player's name
function ns.MailOrigin(link)
    local hit = ns.mailByLink and ns.mailByLink[link]
    if not hit then return nil end
    local m = hit.letter
    local inv = m.invoice and m.invoice.type
    local subj = (m.subject or ""):lower()
    local kind = inv == "buyer" and "won" or subj:find("expired") and "expired" or subj:find("cancel") and "cancelled"
        or subj:find("won") and "won" or (m.sender and "player") or "unknown"
    return { from = kind, sender = m.sender, subject = m.subject, paid = inv == "buyer" and m.invoice.bid or nil, returned = m.returned }
end
ns.On("MAIL_INBOX_UPDATE", function() if ns.char then ns.Soon("mail", 1, ReadMail) end end)
ns.On("MAIL_SHOW", function() if ns.char then ns.Soon("mail", 1, ReadMail) end end)

---------------------------------------------------------------- full AH scan
-- One button reads every auction on your realm at once (the game allows
-- this about every 15 minutes). For each item we keep the lowest price,
-- the median, and how many are up, as one dated observation, so prices
-- build up a history you can trust for sell / disenchant / craft calls.
--
-- A realm can have 200,000+ auctions. Reading them all in one go froze the game for seconds, and it
-- happened up to three times per scan. Now the list is read a slice at a time, a few milliseconds
-- per frame, with the progress on the button; item links (only needed to tell "of the Owl" from
-- "of the Eagle") are only asked for items whose name has " of "; and the second pass only rereads
-- the auctions whose details hadn't loaded yet.
local scan = { state = "idle" }
ns.ahScan = scan
local FRAME_MS = 6      -- time spent reading per frame
local FRAME_ROWS = 400  -- per frame, when the client has no millisecond clock
local QUIET = 2         -- the list has stopped growing for this many seconds: read it

local function Median(t)
    if #t == 0 then return nil end
    table.sort(t)
    return t[math.ceil(#t / 2)]
end

local function Refresh() if ns.ScanButtonRefresh then ns.ScanButtonRefresh() end end

-- run step(i) for i = first..last, a slice per frame, then done()
local function Sliced(first, last, step, done)
    local i = first
    local clock = type(debugprofilestop) == "function" and debugprofilestop or nil
    local function frame()
        if scan.state == "idle" then return end -- cancelled
        local t0 = clock and clock()
        local n = 0
        while i <= last do
            step(i)
            i = i + 1; n = n + 1
            if clock then
                if n % 50 == 0 and clock() - t0 > FRAME_MS then break end
            elseif n >= FRAME_ROWS then break end
        end
        scan.done = i - first
        Refresh()
        if i <= last then C_Timer.After(0, frame) else done() end
    end
    frame()
end

local function Row(by, i, missing)
    local name, _, count, quality, _, _, _, _, _, buyout, _, _, _, _, _, _, itemID, all = Call(AH.GetReplicateItemInfo, i)
    count, buyout, itemID, all, name = Clean(count), Clean(buyout), Clean(itemID), Clean(all), Clean(name)
    if not (itemID and buyout and buyout > 0 and count and count > 0) then return end
    local suffix, roll
    -- random-suffix items ("Gossamer Cape of Healing") need the link to tell the suffixes apart
    if name and name:find(" of ", 1, true) then
        if all == false then missing[#missing + 1] = i; return end
        local link = Clean(Call(AH.GetReplicateItemLink, i))
        local s = link and link:match("item:%d+:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:([%-%d]*)")
        suffix = tonumber(s)
        -- Forever's scan links leave that field empty (22 Nov: every roll of an item came back as one key).
        -- The listing name still says the roll: when it is the base name plus " of ...", key the roll by name
        -- ("3192:of Healing") and also count it in the item's own key (any roll).
        if not suffix then
            local base = Clean(Call(C_Item and C_Item.GetItemNameByID or GetItemInfo, itemID))
            if base and #name > #base + 4 and name:sub(1, #base + 4) == base .. " of " then roll = name:sub(#base + 2) end
        end
    end
    local unit = math.floor(buyout / count)
    local function add(key, sfx)
        local b = by[key]
        if not b then b = { id = itemID, suffix = sfx, units = {}, qty = 0, n = 0, name = name, q = Clean(quality) }; by[key] = b end
        b.qty = b.qty + count
        b.n = b.n + 1
        -- weight the median by stack size, capped so it stays cheap
        for _ = 1, math.min(count, 20) do b.units[#b.units + 1] = unit end
    end
    add(Key(itemID, suffix), suffix)
    if roll then add(itemID .. ":" .. roll, roll) end
end

-- turn what was read into one price observation per item (also a slice per frame)
local function Store(by, n, missing, again, onDone)
    local now = ns.Now()
    if not again then scan.t = now end
    local prices = ns.char.ah.prices
    local keys = {}
    for key in pairs(by) do keys[#keys + 1] = key end
    scan.phase = "saving"; scan.total = #keys
    Sliced(1, #keys, function(i)
        local key = keys[i]
        local b = by[key]
        local p = prices[key]
        if not p then p = { id = b.id, suffix = b.suffix, obs = {} }; prices[key] = p end
        p.name = p.name or b.name
        p.q = p.q or b.q
        p.last = now
        local min = b.units[1]
        for _, u in ipairs(b.units) do if u < min then min = u end end
        local o = { t = now, min = min, med = Median(b.units), qty = b.qty, n = b.n, src = "scan" }
        local lastO = p.obs[#p.obs]
        if again and lastO and lastO.src == "scan" and scan.t and lastO.t >= scan.t then p.obs[#p.obs] = o
        else ns.Push(p.obs, o, ns.LIMITS.priceObs) end
        lastObs[key] = nil
    end, function()
        local set = {}
        for _, key in ipairs(keys) do set[key] = true end
        if not again then
            -- items that were up last scan but are gone now: mark as none listed
            local prev = ns.char.ah.lastScan
            if prev and prev.keys then
                for key in pairs(prev.keys) do
                    local p = prices[key]
                    if p and not set[key] then ns.Push(p.obs, { t = now, qty = 0, src = "scan" }, ns.LIMITS.priceObs) end
                end
            end
            ns.char.ah.lastScan = { t = now, auctions = n, items = #keys, missingInfo = #missing, keys = set,
                secs = scan.started and math.floor(GetTime() - scan.started + 0.5) or nil }
        else
            local ls = ns.char.ah.lastScan
            for key in pairs(set) do ls.keys[key] = true end
            ls.pass, ls.missingInfo = again, #missing
            ls.items = 0; for _ in pairs(ls.keys) do ls.items = ls.items + 1 end
        end
        onDone()
    end)
end

local function Finish(by, n, missing)
    scan.state = "idle"; scan.phase = nil
    ns.char.ah.scans = (ns.char.ah.scans or 0) + 1
    local ls = ns.char.ah.lastScan
    ns.Log("ahScan", { auctions = n, items = ls.items, secs = ls.secs })
    ns.Print(string.format("AH scan done: %d auctions, %d different items. Sync to send it to the page.", n, ls.items))
    Refresh()
    -- some auctions arrive before their item details (needed to tell "of the Eagle" from "of the
    -- Owl"); read just those again once, a little later
    if #missing > 0 then
        local again = missing
        C_Timer.After(20, function()
            if scan.state ~= "idle" then return end
            scan.state, scan.phase, scan.total, scan.done = "rereading", "rereading", #again, 0
            local by2, still = {}, {}
            Sliced(1, #again, function(k) Row(by2, again[k], still) end, function()
                Store(by2, n, still, 2, function() scan.state = "idle"; scan.phase = nil; Refresh() end)
            end)
        end)
    end
end

local function Read()
    if scan.state ~= "scanning" then return end
    local n = Clean(Call(AH.GetNumReplicateItems)) or 0
    scan.state, scan.phase, scan.total, scan.done = "reading", "reading", n, 0
    Refresh()
    local by, missing = {}, {}
    Sliced(0, n - 1, function(i) Row(by, i, missing) end, function()
        Store(by, n, missing, nil, function() Finish(by, n, missing) end)
    end)
end

-- the list arrives in pieces: read it once it has stopped growing for QUIET seconds
local function WaitQuiet()
    if scan.waiting then return end
    scan.waiting = true
    local function check()
        if scan.state ~= "scanning" then scan.waiting = false; return end
        if GetTime() - (scan.lastUpdate or 0) >= QUIET then scan.waiting = false; ns.Try("ahScan", Read)
        else C_Timer.After(0.5, check) end
    end
    C_Timer.After(0.5, check)
end

function ns.AHScan()
    if not ns.char then return end
    if not (AH and AH.ReplicateItems and AH.GetNumReplicateItems and AH.GetReplicateItemInfo) then
        ns.Print("This client has no full-scan call, so prices come from what you search instead.")
        ns.char.caps = ns.char.caps or {}
        ns.char.caps.ahFullScan = false
        return
    end
    if scan.state ~= "idle" then ns.Print("A scan is already running."); return end
    local last = ns.char.ah.lastScan
    if last and ns.Now() - last.t < 15 * 60 then
        ns.Print(string.format("The game allows one full scan every 15 minutes. Next in %d min.", math.ceil((15 * 60 - (ns.Now() - last.t)) / 60)))
        return
    end
    scan.state = "scanning"
    scan.started = GetTime()
    scan.lastUpdate = GetTime()
    scan.phase, scan.done, scan.total = "waiting", 0, nil
    ns.char.caps = ns.char.caps or {}
    ns.char.caps.ahFullScan = true
    local ok, err = pcall(AH.ReplicateItems)
    if not ok then
        scan.state = "idle"
        ns.char.caps.ahFullScan = "error: " .. tostring(err)
        ns.Print("The full scan was refused: " .. tostring(err))
        Refresh()
        return
    end
    ns.Print("Scanning the whole auction house. Keep the AH open until the button says it's done.")
    Refresh()
    -- if the list never comes, stop waiting after a minute
    C_Timer.After(60, function()
        if scan.state == "scanning" and GetTime() - scan.started >= 59 then
            scan.state = "idle"
            ns.Print("The scan got no answer. Try again in 15 minutes.")
            Refresh()
        end
    end)
end

if AH then
    ns.On("REPLICATE_ITEM_LIST_UPDATE", function()
        if scan.state ~= "scanning" then return end
        scan.lastUpdate = GetTime()
        WaitQuiet()
    end)
end

-- closing the AH mid-read: the list is gone, so stop cleanly rather than read empty rows
local function Closed()
    if scan.state == "reading" or scan.state == "scanning" or scan.state == "rereading" then
        scan.state, scan.phase = "idle", nil
        ns.Print("AH closed before the scan finished. Open it and scan again (the game may make you wait 15 min).")
        Refresh()
    end
end
ns.On("AUCTION_HOUSE_CLOSED", Closed)

-- the "Scan AH" button sits just below the auction house window, at its right edge: the game's
-- own buttons and tabs are inside the window or below its left edge, so nothing can overlap it.
-- The line next to it says how the scan is going, or when the last one was.
local function MakeScanButton(parent)
    if ns.scanButton or not parent then return end
    local b = CreateFrame("Button", "ClaudeCompanionScanButton", parent, "UIPanelButtonTemplate")
    b:SetSize(104, 22)
    b:ClearAllPoints()
    b:SetPoint("TOPRIGHT", parent, "BOTTOMRIGHT", -2, -2)
    b:SetScript("OnClick", function() ns.AHScan() end)
    local status = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    status:SetPoint("RIGHT", b, "LEFT", -6, 0)
    status:SetJustifyH("RIGHT")
    b:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine("Claude Companion: scan the whole AH")
        GameTooltip:AddLine("Reads every auction once and saves today's prices (the game allows it every 15 min). It reads a little per frame, so the game keeps running.", 1, 1, 1, true)
        local last = ns.char and ns.char.ah.lastScan
        if last then GameTooltip:AddLine("Last scan " .. math.floor((ns.Now() - last.t) / 60) .. " min ago: " .. (last.items or 0) .. " items" .. (last.secs and (", " .. last.secs .. " s") or "") .. ".", 0.7, 0.7, 0.7) end
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    ns.scanButton = b
    function ns.ScanButtonRefresh()
        local st = scan.state
        if st == "idle" then
            b:SetText("Scan AH"); b:Enable()
            local last = ns.char and ns.char.ah.lastScan
            local wait = last and 15 * 60 - (ns.Now() - last.t)
            if wait and wait > 0 then status:SetText(string.format("|cff9a9890next scan in %d min|r", math.ceil(wait / 60)))
            elseif last then status:SetText(string.format("|cff9a9890last scan %d min ago|r", math.floor((ns.Now() - last.t) / 60)))
            else status:SetText("") end
        else
            b:Disable()
            local pct = scan.total and scan.total > 0 and math.floor(100 * (scan.done or 0) / scan.total) or nil
            if st == "scanning" then b:SetText("Waiting..."); status:SetText("|cffffd100the game is sending the list|r")
            elseif scan.phase == "saving" then b:SetText("Saving " .. (pct or 0) .. "%"); status:SetText("")
            else b:SetText((st == "rereading" and "Rereading " or "Reading ") .. (pct or 0) .. "%"); status:SetText(scan.total and ("|cff9a9890" .. scan.total .. " auctions|r") or "") end
        end
    end
    ns.ScanButtonRefresh()
end
ns.On("AUCTION_HOUSE_SHOW", function() pcall(MakeScanButton, AuctionHouseFrame or AuctionFrame); Refresh() end)
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", function(t)
    if ns.InteractionKind and ns.InteractionKind(Clean(t)) == "Auctioneer" then
        C_Timer.After(0.5, function() pcall(MakeScanButton, AuctionHouseFrame or AuctionFrame); Refresh() end)
    end
end)
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", function(t)
    if ns.InteractionKind and ns.InteractionKind(Clean(t)) == "Auctioneer" then Closed() end
end)
