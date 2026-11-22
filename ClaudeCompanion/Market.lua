-- Auction house prices you see, auctions you post, your active auctions,
-- and the mailbox (including AH sale invoices = real sale prices).
local _, ns = ...
local Clean, Call, Copy = ns.Clean, ns.Call, ns.Copy
local AH = C_AuctionHouse

---------------------------------------------------------------- price records
-- ah.prices[key] = { id, suffix, name, q, icon, last, obs = { {t, min, qty, src}, ... } }
-- key = "itemID" or "itemID:suffix" (random-suffix items). min = per-unit copper.
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
        local invType, itemName, player, bid, buyout, deposit, consignment = Call(GetInboxInvoiceInfo, i)
        if Clean(invType) then
            m.invoice = { type = Clean(invType), item = Clean(itemName), player = Clean(player), bid = Clean(bid),
                buyout = Clean(buyout), deposit = Clean(deposit), cut = Clean(consignment) }
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
                        seller = m.invoice.player }, ns.LIMITS.sales)
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
                        buyer = m.invoice.player, net = (m.invoice.bid or 0) + (m.invoice.deposit or 0) - (m.invoice.cut or 0), cut = m.invoice.cut, deposit = m.invoice.deposit }, ns.LIMITS.sales)
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
local scan = { state = "idle" }
ns.ahScan = scan

local function Median(t)
    if #t == 0 then return nil end
    table.sort(t)
    return t[math.ceil(#t / 2)]
end

local function FinishScan(again)
    local n = Clean(Call(AH.GetNumReplicateItems)) or 0
    local by, missing = {}, 0
    for i = 0, n - 1 do
        local r = { Call(AH.GetReplicateItemInfo, i) }
        -- name, icon, count, quality, usable, level, levelType, minBid, minInc, buyout, bid, highBidder,
        -- bidderFull, owner, ownerFull, saleStatus, itemID, hasAllInfo
        local count, buyout, itemID, all = Clean(r[3]), Clean(r[10]), Clean(r[17]), Clean(r[18])
        if itemID and buyout and buyout > 0 and count and count > 0 then
            local suffix
            if all ~= false then
                local link = Clean(Call(AH.GetReplicateItemLink, i))
                local s = link and link:match("item:%d+:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:([%-%d]*)")
                suffix = tonumber(s)
            else
                missing = missing + 1
            end
            local key = Key(itemID, suffix)
            local b = by[key]
            if not b then b = { id = itemID, suffix = suffix, units = {}, qty = 0, n = 0, name = Clean(r[1]), q = Clean(r[4]) }; by[key] = b end
            local unit = math.floor(buyout / count)
            b.qty = b.qty + count
            b.n = b.n + 1
            -- weight the median by stack size, capped so it stays cheap
            for _ = 1, math.min(count, 20) do b.units[#b.units + 1] = unit end
        end
    end
    local now, items = ns.Now(), 0
    if not again then scan.t = now end
    local prices = ns.char.ah.prices
    for key, b in pairs(by) do
        items = items + 1
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
    end
    -- items that were up last scan but are gone now: mark as none listed
    local prev = ns.char.ah.lastScan
    if prev and prev.keys then
        for key in pairs(prev.keys) do
            local p = prices[key]
            if p and not by[key] and not again then ns.Push(p.obs, { t = now, qty = 0, src = "scan" }, ns.LIMITS.priceObs) end
        end
    end
    local keys = {}
    for key in pairs(by) do keys[key] = true end
    ns.char.ah.lastScan = { t = now, auctions = n, items = items, missingInfo = missing, keys = keys }
    if again then ns.char.ah.lastScan.t = scan.t; ns.char.ah.lastScan.pass = again; return end
    ns.char.ah.scans = (ns.char.ah.scans or 0) + 1
    scan.state = "idle"
    ns.Log("ahScan", { auctions = n, items = items })
    ns.Print(string.format("AH scan done: %d auctions, %d different items. Sync to send it to the page.", n, items))
    -- some auctions arrive before their item details (needed to tell
    -- "of the Eagle" from "of the Owl"); read the list again once they load
    if missing > 0 then
        C_Timer.After(15, function() ns.Try("ahScan2", FinishScan, 2) end)
        C_Timer.After(45, function() ns.Try("ahScan3", FinishScan, 3) end)
    end
    if ns.ScanButtonRefresh then ns.ScanButtonRefresh() end
end

function ns.AHScan()
    if not ns.char then return end
    if not (AH and AH.ReplicateItems and AH.GetNumReplicateItems and AH.GetReplicateItemInfo) then
        ns.Print("This client has no full-scan call, so prices come from what you search instead.")
        ns.char.caps = ns.char.caps or {}
        ns.char.caps.ahFullScan = false
        return
    end
    if scan.state == "scanning" then ns.Print("A scan is already running."); return end
    local last = ns.char.ah.lastScan
    if last and ns.Now() - last.t < 15 * 60 then
        ns.Print(string.format("The game allows one full scan every 15 minutes. Next in %d min.", math.ceil((15 * 60 - (ns.Now() - last.t)) / 60)))
        return
    end
    scan.state = "scanning"
    scan.started = GetTime()
    ns.char.caps = ns.char.caps or {}
    ns.char.caps.ahFullScan = true
    local ok, err = pcall(AH.ReplicateItems)
    if not ok then
        scan.state = "idle"
        ns.char.caps.ahFullScan = "error: " .. tostring(err)
        ns.Print("The full scan was refused: " .. tostring(err))
        return
    end
    ns.Print("Scanning the whole auction house. Keep the AH open for a few seconds.")
    if ns.ScanButtonRefresh then ns.ScanButtonRefresh() end
    -- if the list event never comes, stop waiting after a minute
    C_Timer.After(60, function()
        if scan.state == "scanning" and GetTime() - scan.started >= 59 then
            scan.state = "idle"
            ns.Print("The scan got no answer. Try again in 15 minutes.")
            if ns.ScanButtonRefresh then ns.ScanButtonRefresh() end
        end
    end)
end

if AH then
    -- the list arrives in pieces; wait until it stops growing, then read it
    ns.On("REPLICATE_ITEM_LIST_UPDATE", function()
        if scan.state ~= "scanning" then return end
        ns.Soon("ahscan", 3, function() ns.Try("ahScan", FinishScan) end)
    end)
end

-- a small "Scan" button on the auction house window
local function MakeScanButton(parent)
    if ns.scanButton or not parent then return end
    local b = CreateFrame("Button", "ClaudeCompanionScanButton", parent, "UIPanelButtonTemplate")
    b:SetSize(110, 22)
    b:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -30, -26)
    b:SetScript("OnClick", function() ns.AHScan() end)
    b:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine("Claude Companion scan")
        GameTooltip:AddLine("Reads every auction once (allowed every 15 min).", 1, 1, 1, true)
        local last = ns.char and ns.char.ah.lastScan
        if last then GameTooltip:AddLine("Last scan " .. math.floor((ns.Now() - last.t) / 60) .. " min ago, " .. last.items .. " items.", 0.7, 0.7, 0.7) end
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    ns.scanButton = b
    function ns.ScanButtonRefresh()
        b:SetText(scan.state == "scanning" and "Scanning..." or "Claude scan")
    end
    ns.ScanButtonRefresh()
end
ns.On("AUCTION_HOUSE_SHOW", function() pcall(MakeScanButton, AuctionHouseFrame or AuctionFrame) end)
ns.On("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", function(t)
    if ns.InteractionKind and ns.InteractionKind(Clean(t)) == "Auctioneer" then
        C_Timer.After(0.5, function() pcall(MakeScanButton, AuctionHouseFrame or AuctionFrame) end)
    end
end)
