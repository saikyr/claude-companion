# Changelog

Dates are UTC, 2026. The addon version is in `ClaudeCompanion.toc` / `Core.lua`.

## 1.5.0 (in progress: every merge to main updates itself)
- **Ticked steps stay with their step.** When Claude rewrites or reorders a card, the steps you ticked stay ticked on the same step instead of on whichever step now sits in that position; ticks on a step Claude rewrote are cleared. A card's time can no longer be written ahead of the real time, which sorted an old card above its update (#150).
- **Enchants.** The Gear tab has an Enchants view for each spec and the gear it is compared with: every slot that can take a permanent enchant, what is on it and its score, the slots with none (in red), and the best enchant you can get for each, with the gain and how: a formula you know (with its reagents and tools), a trainer, a formula drop and the reputation it needs, or an item like an Arcanum. It also says the best you can apply yourself right now, and a raid enchant when one would beat that. Numbers come from the game where it has said (the item's "Enchanted:" line, a formula you know); Forever renamed some formulas (Superior Mana is Superior Intellect there), so those wait for the game's own text: open Enchanting once after a /reload. Gear sets now remember which copy of each item they use, so a set's enchants are its own. Claude's snapshot and brief have the same, and Claude can look any enchant up, plus every recipe's reagents and trainer skill (#147). Takes effect with the next game-data rebuild.
- **Tools for every recipe.** Recipes you haven't learned now say what they need too: a crafted item's tooltip says "To craft it: needs Blacksmith Hammer at The Black Anvil", a recipe item what it teaches and needs, and a tool how many recipes use it (the Runed Arcanite Rod: 30 Enchanting recipes). This is Classic data and says so; once you know a recipe, the game's own answer is used. Forever's own new recipes aren't covered until you learn them. Claude can look up every recipe that needs a given tool (#145). Takes effect with the next game-data rebuild.
- **Recipe tools.** Each known recipe now says which tools or places it needs (a Runed Arcanite Rod, an anvil) and which you lack, and isn't counted as craftable while one is missing (#145). Type /reload in game.
- **Turn-ins are kept.** Bag advice no longer says to sell an item a quest you are on still needs, such as Devout Gloves for Just Compensation: it says Keep and names the quest (#144).
- **Gray loot counts at vendor price.** The in-game grind line and the app's gold per hour no longer price gray items at an AH listing (one junk greatsword listed at 22g read as 22g of loot); grays only ever go to a vendor (#131).
- **Reputation gates at the right standing.** Recipes and rep gear showed the standing one step too low (Honored as Friendly), and Friendly-only recipes showed no gate; they now match Forever's tooltips (#129).
- **Where things are inside dungeons.** The addon now notes which part of a dungeon you saw each creature, quest giver and quest object in (the area name the game shows, like Hordemar City), and the app puts that with your boss kills and quest items, per dungeon. Claude's snapshot has it, and next to each quest in your log, where its objectives were found, so a dungeon prep can say where to look. It fills in as you play (your past boss kills and quest loot already count). Needs a /reload in game.
- **A friend's cards reach all their computers.** Cards a friend's own Claude writes on one computer are now sent to their account with the next sync, through the same checks as the owner's, so their other linked computers show them too. The From Claude tab says when they were sent, or what was wrong if they weren't.
- **A friend's Claude can look game facts up.** Every build now carries `claude/game.py`: items, drops with their rates labelled (measured on Forever with the number of corpses, Classic, or unknown), creatures, quests and their chains, instances, read from the app's own game data, with the same answers as the owner's database. A friend's Claude uses it instead of searching the web, and can put a drop rate on a From Claude card: the card checker looks it up.
- **Disenchant values from your own disenchants.** Once you have disenchanted 10 items of a kind in an item level band, what they really gave replaces the Classic table in the disenchant values (Bags & Bank, the buy list), and says how many it is from. Materials are now priced by item id.
- **Crit for healers is worked out from your heals.** The healer weights (Holy and Discipline Priest, Holy Paladin, Restoration Shaman and Druid) now value crit from your own heals (for a Priest, Greater Heal and Flash Heal): how big they are at your rank and +healing. At 60 with 500 +healing that is about 0.65 a point instead of the flat 0.3, so crit items score higher. The Gear tab says how it was worked out.
- **Set bonuses count.** An upgrade that completes a set bonus with stats (resistances, spell power, mana per 5) now gains that bonus, and one that breaks a bonus you have loses it; the Gear tab shows "set +N" under the gain. Takes effect once the game data's weekly rebuild reads the bonuses' stats. The Gear tab's pre-BiS also goes up to the level cap the game reports instead of a fixed 60.
- **What killed you.** With `/combatlog` on in game, the Grinds tab shows, for each death, what hit you in the 10 seconds before (three Gordok Hyenas, 2,100 damage in 5 hits), and which creatures hit you hardest per hit. Claude's snapshot has the same. The app reads your combat log again from the start once to fill this in (log files deleted since are no longer counted).
- **Your addons and macros.** Talents & Bars lists the addons you have installed, with their version and whether each is on for this character, and Claude's snapshot has them with your macros' text, so a macro suggestion can check what an addon already does. Needs a /reload in game.
- **Consumables Claude can see.** Claude's snapshot now lists every potion, elixir, flask, food, scroll and weapon oil in your bags and bank with what it does (from the game's own tooltip), the buffs on you, the enchant and any oil or stone on your weapons, and what an item wouldn't stack with right now (a Scroll of Spirit while Divine Spirit is on you, a second flask, an oil on a weapon that already has one). The game-data pack gets Forever's tooltips for consumables too at its next weekly rebuild. The weapon part needs a /reload in game.
- **How fast items sell on your AH.** Each full scan now remembers its listings and compares them with the next scan: an auction that is gone before its time could have run out, and whose seller didn't list a new one, probably sold. The buy list shows at least how many of an item sold a day and at what price, and says when your last two scans were too far apart to tell (under 12 hours works; 3 or 4 scans a day is best). Needs a /reload in game and two scans on the same computer. The app's local server also no longer risks writing an empty Claude snapshot when two saves come at once.
- **Positions.** A Positions section on the Auction House tab lists every open flip with how long you have held it, today's lowest and what it would make now after the cut, against your own rules: sell after 3 days, or when the lowest is 15% under what you paid, and an optional price you plan to sell at (all editable, and the same on every computer). It warns when more than 10% of your gold is in one item or 50% in all. Below that: flip profit per week, a market index (per price band, how prices moved between your last two full scans; a falling band tells the buy list not to hold), and paper trades: the price rules that aren't shown yet are listed under the buy list, and a row you mark as a paper buy is scored at the next scan, per rule, so you can see a rule work before trusting it. The sell-through and buy list tables also line up in columns now.
- **A buy list for your AH.** After a full scan, the Auction House tab's Buy list shows what is worth buying and why: listed under what a vendor pays for it (certain), under what disenchanting it gives at your AH's prices (if your Enchanting can), or sold by a vendor for less than your AH's lowest. Two price rules (well under an item's usual lowest; few listed far under the rest) are checked against every item's scan history first and shown only once that history says they made money: on your scans so far, buying a dip and relisting at the next scan's lowest lost money more often than not, so they stay hidden. Claude's snapshot has the same list.
- **How fast your auctions sell.** The Flips view now shows your sell-through: of what you posted, how much sold within 48 hours, per item and in total, how many hours it usually took, and the same for posts of 10g or more. Claude's snapshot has it too.
- **Craft margins use vendor prices.** A reagent a vendor sells (threads, dyes, vials) is priced at what the vendor asks on Forever when that is lower than your AH, instead of a guess from its sell price, and a reagent with no price at all leaves the margin unknown. Claude's snapshot now has every known recipe's margin, best first, so it quotes the app instead of pricing recipes itself.
- **A dungeon lists every upgrade it drops, by wing.** A dungeon on the Now page shows all its upgrades (it stopped at 12), each with the boss or creature, its wing (Lower or Upper Blackrock Spire, Dire Maul East, West or North, Stratholme Live or Undead) and the drop chance. Upper Blackrock Spire now has its trash and Lord Valthalak too, not only its bosses. Claude's snapshot has the same full list for every dungeon, so it can go through one wing's drops for every spec.
- **More than one character.** With alts in the save, a picker under your name lists them, the one you played last first. The app shows the one you played last; pick another to look at it, and it stays picked (also after closing the app) until you next log in on any character, which the app then follows. Claude's summary is always of the character you played last, never one you are only looking at. AH prices now belong to the auction house: every character on the same server and faction uses what any of them scanned or saw (each character from its next login, when the addon saves which server it is on) (the newest full scan counts for all), in the app and in game for loot values; sales, buys and posts stay each character's own.
- **An older Claude card no longer blocks new ones.** When a number on a card Claude wrote earlier changes (a grind's gold per hour re-priced by newer AH prices, a list your other computer saved in another order), Claude's next cards are still saved: the old card stays, and the changed fact says "Changed since Claude wrote it" with the app's number now. New and edited numbers are still checked, and Claude can point at a list entry by its name instead of its position.
- **Shadow at 60 weighs Spirit last.** From level 60 the Shadow default is the group weights: hit to the cap, then spell power, crit, spell penetration and Spirit (0.1, was 0.55), the order the Forever Shadow lists use, since Spirit Tap rarely fires in a group. Below 60 the questing weights stay; either can be picked on the Stat weights tab.
- **Spells only a book teaches are checked.** Talents & Bars lists the spells and ranks your class learns from a book (codex, tome, libram, tablet, grimoire, manual...) (no trainer has them: Prayer of Fortitude, Prayer of Shadow Protection, Arcane Brilliance, Gift of the Wild) that you don't know yet, with where the book comes from and what your AH asks; books only raids give are listed apart. A source whose zone name is wrong in the data but whose map is a raid (Gahz'ranka, written as Zul'Farrak) now counts as raid for gear too. It also says when you know a group buff but carry none of its reagent (Sacred Candle, Arcane Powder, Wild Thornroot, Symbol of Kings). Claude's brief has the same list, so a level-60 plan checks it before gear.
- **Forever's own gear shows up.** Items that only ForeverDB has stats for (no client tooltip page yet) were all left out, among them Forever's Tier 0.5 spec sets (the Shadow Virtuous Epaulets, Slippers, Cowl...). They now count once Forever was seen giving them (a drop, container or quest sighting); a vendor row alone still doesn't (ForeverDB lists Season of Discovery raid-token vendors). A class set's piece is offered only to its class (their tooltips don't say, so Rogues were offered Druid caps), and one with no known required level only at 60. The weekly data rebuild now also fetches client tooltips for every item ForeverDB knows, and reads "+1% spell crit" lines in either case (Eye of the Beast scored 0).
- **Pre-BiS is checked against published Forever lists.** A test runs the real game data and checks that the picks the Forever Shadow lists agree on are shown (`test/fixtures/bis-lists.json`); 13 of 15 are shown, the other two are offered lower and say why (crit is weighted low for Shadow; a tie).
- **Battleground reputation gear is labelled as such**, not as Honor gear (Alterac Valley, Warsong Gulch and Arathi Basin quartermasters sell for gold and reputation).
- **Spell hit is measured, and counts only up to the cap.** The addon saves your spell hit rating and what it gives, and the text of each talent you have at your rank (Shadow Focus says how much it adds). For spell weights, hit on an item counts until you reach the 17% that matters against raid bosses (what the Forever pre-raid lists build toward; Shadow Focus 5/5 gives 5%), and nothing past it; the Gear page shows your hit, where it comes from, and the room left. Shadow's hit weight below the cap is now 1.66 (the guide's order), not 0.2.
- **World drops count once your AH has seen one.** A world drop (Hand of Edward the Odd) comes from any creature of its level, so in practice from the AH: it's a pre-BiS pick or an upgrade only once your own AH scan or browsing has listed one, or you own it. Until then it's listed under "Raid, PvP and not in game yet" with why.
- **Character stats survive logout.** The game reads every stat as 0 while logging out, so the saved stats (Intellect, spell hit, crit...) were all zeros; the last good reading is kept instead, marked as kept.
- **The game data rebuilds itself every week** (drops, quests, items, from the same sources), and its age is on the System tab, and on Overview when it is more than two weeks old.
- **Item cooldowns.** Salt Shaker, Hearthstone and on-use trinkets are read from the game's own timers (at every snapshot and when you use one) and listed on Overview with profession cooldowns, in a Cooldowns list like the rest of the page: each says how long is left ("Ready in 47m", "Ready in 2d 3h") with the clock time under it, or "Ready now"; a long one (Salt Shaker) shows "ready now" on the Now page.
- **Two identical AH sales are both counted.** Two Mooncloth sold for the same price in one mailbox read were recorded as one sale; each letter is now one sale, and a letter read again isn't counted twice.
- **The in-game plan price is the app's**: the newest scan's median when that scan saw the item, else the newest price seen.
- **Gear picks per character and realm.** Weight profile, gear set and pre-BiS picks are kept per Name-Realm, so same-named characters on two realms don't share them; the old per-index keys (that let an old pick reach another spec) are no longer read.
- **Pre-BiS is what a 5-man group can get.** Loot from world bosses (the green dragons, Azuregos, Kazzak, the Abyssal Council), raid chests, the AQ reputation chain, battleground quartermasters (Alterac Valley, Warsong Gulch, Arathi Basin) and crafts that need raid materials (Molten Core, Onyxia, Blackwing Lair, Zul'Gurub, Naxxramas) now show under "Raid, PvP and not in game yet" with why, never as pre-BiS. World-drop epics that raid bosses also list (Maiden's Circle) stay world drops. An item's reputation need is the highest any source asks (Exalted, not Revered, for the Bronze Dragonflight ring).
- **Rewards of a finished quest are scored.** When the game reads a complete quest back with no rewards, the app scores the game data's rewards for every spec instead of none.
- **Claude's cards stay put.** A computer could send an old copy of the From Claude cards back over new ones a minute after Claude wrote them, so new cards never showed. Computers no longer send the cards, and the sync database ignores them from any computer.
- **"Makes a profit" only counts recipes whose every reagent has a price.** The rest sort last and say which reagent count has no price yet.
- **Item names in tooltips** use the same quality colours as everywhere else in the app.
- **Another program on the app's port** (47615): the Mac says so in a dialog instead of opening a page that doesn't load.
- **Gear advice checked for every class.** Weapon DPS now counts where the weapon hits: in full in the main
  hand, half for an off-hand weapon, and in the Ranged slot only for Hunters. Beast Mastery and Marksmanship
  Hunters were offered high-DPS axes with no stats over Agility staves, and Rogues and Warriors were told a
  faster bow was an upgrade; both are fixed. Hunters count ranged attack power. Rogues and Survival Hunters
  count Strength for the attack power it gives. Tanks always count armor, so a cloth robe no longer beats a
  plate chest for Protection. A shield the game data files as Miscellaneous is read as the shield its tooltip
  says, so Mages and Druids aren't offered it. A character with no talent points yet uses the tree its class
  levels in (a level-5 Paladin got Holy healer advice), and a tie goes to that tree. Your own Hunter profiles
  keep their weapon DPS number for the bow.
- **Coach set-up in one paste.** Install from the zip as usual, then create a project in the Claude desktop
  app and paste the text from `claude/SETUP.md` into "What do you want to work on?": Claude asks for your
  addon folder and reads your character. It only reads the folder and writes its cards there; it never runs
  or installs anything on your computer.
- **Spell ranks on your bars.** Talents & Bars now says when a spell on a spec's bars is below the best rank in
  your spellbook (the slot is marked, and the list above the bars says which rank you know). Open your class
  trainer once and the addon reads its whole list (every rank, the level and cost), so the app also lists the
  ranks to train now, what they cost in all, and what comes at your next level. It's the game's own list, so
  Forever's own spells and ranks are right. Claude's snapshot has all of it (`spells`).
- **Nothing saved is kept from Claude.** Macros, key bindings, buffs, currencies, every bag slot, the spellbook,
  completed quests and recipes were already synced online with the rest of your character, but Claude's guide
  only pointed at the summary, so Claude said the app didn't record them. The guide now points Claude at the
  full record too.
- **More gear in "not in game yet".** 1,068 items the Forever client has no tooltip for (their stats come from
  ForeverDB) were skipped by the Gear page. They now show in each slot's "Raid, PvP and not in game yet" list.
- **Raid gear out of pre-BiS, but still shown.** Pre-BiS listed Atiesh, the Qiraji staves and Fang of
  Korialstrasz: raid rewards whose quests the game data doesn't mark as raid. A quest now counts as raid
  content when it, or an earlier step of its chain, is set in a raid. Raid gear, PvP gear and items not seen
  on Forever yet are no longer dropped silently: each slot lists the best of them under "Raid, PvP and not in
  game yet", scored, with the reason, and Claude's snapshot has them too. Class sets from AQ40 and Naxxramas
  quests are now labelled Raid (they were "Dungeon set upgrade (quests)").
- **Weapons for dual-wielders.** With Dual Wield (Rogues, and Warriors and Hunters once trained), the off
  hand now offers one-handers and off-hand weapons, a one-hander is rated in whichever hand gains most, and
  Best from what you own can pick two one-handers. Without it, off-hand weapons are no longer suggested.
  A worn two-hander is now recognised from the game's own item data too, so the off hand under it shows as
  blocked rather than as an upgrade.
- **One way to show an item, everywhere.** A dungeon opened on the Overview (Dire Maul, say) now lists its
  drops like the Gear page does: icon, name in its quality colour, the tooltip on both. So do quest rewards,
  what a profession opens, Ready now, From Claude item lists, the AH and Best from what you own.
- **Icons that mean what they say.** Dungeons show a skull instead of an odd curly key; attunements a
  key; a profession step its own profession's icon; Talents & Bars your class's icon; Reputation your
  faction's banner. Every icon the app picks is now from the original game (two came from later expansions).
- **Dungeon quests counted once.** The game data has a few quests twice (Dire Maul's "Unfinished Gordok
  Business"), so a dungeon listed them twice and counted their rewards twice in its value. Now once.
- **The brief, sixth version.** Now that both specs' gear reaches it, the brief Claude reads first is trimmed again (10.7 to 9.4 KB on a real save): shorter reasons to keep a quest, sources cut to their first clause, mobs as "name ×kills", and the computers listed only when their builds differ. Nothing is lost: each part asked for by name is whole.
- **Flight paths: only the ones you know.** Greyed-out flight points on the flight map were saved as known (Cenarion Hold, for one). Now only the ones you can fly to count, and a path the map no longer shows as known is dropped the next time you open a flight map on that continent.
- **Claude for friends, in the download.** A friend's own Claude can't read the Companion's private code, so
  what it follows now comes with the app, in `AddOns/ClaudeCompanion/claude/`: its guide, how to set up a
  Claude project (with the text to paste), the answering rules, the feature list and the card checkers.
  It updates with the app.
- **Which creature each drop came from.** Where the game names the corpse of each loot slot, grinds, runs and
  sessions count every creature's corpses and what they held, so the app can give your own drop rate per
  creature with its sample (between drops per kill and drops per opened corpse). Shows after a /reload.
- **The combat log, read by the app.** With /combatlog on in game, the app reads the game's own log files
  and keeps, per creature, how often your and your group's spells were resisted by school, and kills. Only
  those counts leave the computer.
- **Risk on cards.** A farm card's risk (elites, patrols, deaths) shows as its own line under the summary.
- **Cards are checked by the database.** Every number on a From Claude card names where it comes from,
  and the database looks it up before the card reaches you: a wrong gold per hour, a drop rate without its
  sample, a Classic rate not called Classic, sales called profit, an unmeasured duo claim, a farm card with no
  risk, or a layer or /run tip is refused. Claude's chat answers go through the same rules first.
- **Prices from your own AH scans on cards.** A card can quote what an item cost on your AH, from the scan
  the app synced, and the database checks the number. The brief's grinds now say which mobs they killed and
  when they started.
- **A shorter brief.** The brief Claude reads first leaves out empty and repeated fields and keeps the top 3 upgrades per
  spec, the 4 next pre-BiS pieces and the 6 newest grinds and runs (each with its total); ask for a part by
  name to get it whole.
- **Game data in the database for Claude.** The same pack the app uses, loaded after every merge that changes
  it: items with every source, quests and their chains, creatures, vendors, instance rules. Every drop rate
  says what it is: measured on Forever (with its range and how many corpses), a Classic rate (never passed
  off as Forever), or unknown. Claude looks facts up there instead of on the web.
- **More quests marked keep.** Besides dungeon quests: every step of a key or attunement chain (Araj's
  Scarab leads to the Skeleton Key), and quests giving rep with a faction whose rewards you can still earn.
- **Gear advice and professions reach Claude again.** At logout the game lists only the skill headers
  (Weapon Skills, Armor Proficiencies...), and every save is a logout, so the snapshot had no skills: the
  gear advice for every spec and the professions list were empty online. A logout that reads only headers
  now keeps the skills read at login, like bags and gold.
- **One gold per hour, from the app.** Each grind and run in the snapshot carries `gph` (the Grinds tab's
  number), `gph_low` (loot at vendor price), `gph_high` (the best recent AH median), `hours`, and
  `complete` with the reasons when it isn't. Claude quotes these; it never works gold per hour out itself.
- **The brief.** `private.claude_brief(account)` on the sync backend: a few KB of where the player is now,
  with its age, built from the newest snapshot of any computer (gear per spec, quests with dungeon quests
  marked keep, flips as profit, sales as revenue, measured gold per hour).
- **What Forever lets addons read, measured in game.** At a loot window the addon notes whether the game
  names the corpse each item came from; inside an instance, whether GUIDs can be read; and whether combat
  logging can be read. Read-only: nothing changes in game. This decides how drop rates and resistances can
  be measured on Forever.
- **A run's bosses and loot names show on every computer.** The Dungeon Journal addon's boss log goes with
  each computer's "now" and the view joins both, so a run played on the PC lists its bosses on the Mac;
  run loot in the snapshot takes its name from the game-data pack when this computer never saw the item.
- **A new grind panel.** In the app's Graphite look: the time, gold per hour, kills per hour and
  deaths at a glance, coin per hour next to items per hour (at your AH prices), and your most valuable
  drops as icons. **Targets**: `/cc target [item]` (or alt-click a drop) counts an item you farm for,
  dropped against expected from your kills and its drop chance as measured on Forever (never a Classic
  rate: without one it says "rate unknown" and shows your own rate), with the odds of none so far in
  the tooltip; they come back the next time you `/cc start` the same name. `/cc stop` leaves the summary
  on the panel until you close it. Stop is now shift-right-click, so a stray click can't end a grind.
  Drop chances need one game restart after this update (a /reload doesn't load new files).
- **/reload is the one way to save.** `/cc sync`, the window's Sync button and its key binding are gone:
  they only did a /reload, and refused to in combat, so a stop could go unsaved. `/cc stop` now says
  the app shows it after your next /reload or logout; a running grind's tag says it's as of the last save.
- **Loot icons and tooltips always show.** An item this computer's item cache doesn't have (another
  computer's loot, an old grind) takes its icon and tooltip from the game-data pack instead of a "?".
- **The Now page shows your next steps**, ranked: dungeons (one run's expected upgrades, by drop chance,
  plus their quests), quests worth doing for their rewards (with the chain still to do), items to chase on
  the AH or to craft, profession skill that opens an upgrade (with the cheapest skill-ups), and attunements
  and keys. Under 60, quest XP counts too, grouped by zone. Hybrid by default, or one spec. Ready now
  (turn-ins, cooldowns, upgrades in your bags) sits on top, Claude's cards beside it; the full saved-data
  list moved to the System tab. Claude's snapshot carries the same list (`nextSteps`).
- **Gear no longer counts quest rewards you already took** (or quests for another class or faction) as
  a place to get an item. One shared check (`js/quests.js`) knows which quests you can do: faction,
  class, level, earlier steps of the chain and reputation, from QuestieDB Forever and your save.
- **Attunements and keys** (UBRS, Scholomance, City of Dalaran, Dire Maul, the Shadowforge and
  Stratholme keys, Onyxia, Molten Core) are listed once in `data/rules.js`, each with its source, for the
  coming Now page.
- **Quest rewards are scored for every spec.** The Quest log shows, under each quest's rewards, which
  specs each item upgrades and by how much (the same engine as Bags and Gear), also for quests whose
  rewards come from the game-data pack. The snapshot carries the same scores per reward and for the
  chain's next quest, so Claude quotes the app instead of scoring items itself.
- **From Claude cards reach every computer.** Claude can now post cards to your account online; every
  computer shows them at its next sync, and what you do with them (done, dismissed, ticked steps) syncs
  too. Cards written to a computer's `from-claude/cards.json` still work, and both show as one list.
  Cards can name what they are about (`step`: a quest, dungeon, item, zone or NPC).
- **Docs for agents and friends:** `CLAUDE.md` (the agent guide: where the truth lives, reading the
  app's scores for all specs, writing cards), `docs/INTERFACES.md` (every interface, its owner and its
  check; the app is complete without Claude) and `docs/CLAUDE-PROJECT.md` (an optional Claude project,
  with instructions to paste). CI also checks that the card fields and Claude's backend function agree
  with their docs.
- **Sync can be turned off per computer.** System tab, Turn sync off on this computer: nothing is sent
  or fetched there and the app shows only that computer's save; turned back on, what waited is sent.
- **Ready to share: one download, one installer.** Every build now also goes to a public download folder
  (the repository stays private) as **ClaudeCompanion-Windows.zip** and **ClaudeCompanion-Mac.zip**,
  linked in the README. Installed apps update from the same folder, so no computer needs a GitHub
  token any more. Each zip has an
  **Install Claude Companion** that finds the WoW Forever folder (or asks), installs the addon and
  opens the app, which then updates itself. Each install gets its own sync account; Link another
  computer joins your own computers. Both installers are tested on real Windows and macOS in CI.
- **README for players** (install, several computers, your data, remove); developer notes moved to
  docs/DEVELOP.md; MIT license; roadmap refreshed. The Mac terminal installer (`tools/install.sh`) is
  replaced by the installer app.
- **Windows server:** serves only files inside its own folder (a sibling folder with a similar name
  no longer passes the check).

- **One contract between the parts, checked in CI.** New first CI step `test/contract.test.js`: the
  addon version is the same in the .toc, Core.lua and this changelog; every file the .toc loads exists
  and every addon file is loaded; the save and snapshot schemas agree with their docs; the Mac and Windows
  servers serve the same API and the page calls only that; every sync call has its backend function; a
  migration already on main is never edited. The table is in docs/INTERFACES.md.
- **The app knows when the game needs a /reload.** Each build stamps its commit into the addon
  (`addonBuild` in the save) and the app (`web/channel.json`). While the game still runs an older addon
  than the app, the app says so until you /reload, instead of only for 15 minutes after an update.
- **Updates leave no old files behind.** The updater copies exactly the build's files and removes files
  an older build had (they are in the backup); companion-data is never touched. The Windows server's
  update is now tested end to end in CI too.
- **Removed:** the old in-game message from Claude (`Inbox.lua`, a stale 1.3 note; Claude's suggestions
  are From Claude cards in the app; the `/cc` window says where they are), and the merge of QuestieDB
  quests and NPCs from saves (they come from the game-data pack since 1.4).

- **Gear page fixes.** The spec you are looking at is marked in the switcher again. The four cards read
  like the rest of the app (label, value, one line). Reputation names come from data/rules.js, and items
  whose source is "World Drop" are listed as world drops.

- **The active spec is right everywhere.** With both specs saved, the save's reader numbered them 0 and 1
  instead of the game's 1 and 2, and merging the PC's and Mac's copies mixed the two numberings, so the
  Talents page could show Shadow's name on the active (Holy) spec and spec 2 wouldn't open. Specs now keep
  the game's numbers from the moment the save is read (and when computers are merged), for Talents, Gear
  and Stat weights alike. Gear choices made before carry over.
- **Talents & Bars:** action bars use the game's own names (Action Bar 1 to 8, as in the Action Bars settings),
  plus Action Bar 1's second page and its Shadowform page, instead of guessed positions like "Bottom left".
- **Professions:** one selector (in the header) and the selected profession's skill bar; other skills in one
  line at the bottom. Hovering a recipe shows its reagents: how many you have and what each costs.
- **AH flips:** the same AH letter read on both computers counts once, and the Flips view explains exactly
  how purchases are matched to sales (and how many copies it left out).

- **One source per kind of game data, checked in CI.** docs/ARCHITECTURE.md (Data sources) names the one
  source for items, random-suffix rolls, quests, NPCs and spawns, drop rates, vendors, recipes, AH prices
  and icons. New CI step "Game data complete" (`gamedata/test_pack.py`, `test/web/data.test.js`).
- **NPCs come from the pack.** The pack now has every QuestieDB Forever NPC (15,561: levels, rank, zone,
  spawn points). The addon no longer keeps its own copy of QuestieDB answers in the save (it was never
  refreshed, and it moved spawn points in Mulgore, Eastern Plaguelands, Redridge and Stormwind a second
  time); it drops that copy on load, which makes the save smaller.
- **Game data rebuilt 22 Nov** from today's QuestieDB (e3c3bc4), ForeverDB and endgametools pages.
  endgametools changed its page layout today; "How to get it" now reads the new layout ("Boss Drop ·
  Herod · Scarlet Monastery · Level 30–46 · 5 players"), for 10,429 items instead of 1,994.
- **Icons rebuilt from the wowdev listfile** (`gamedata/icons.py`): 3,227 broken names (".blp.meta") gone.
- **Hand-kept game rules in one file** (`web/data/rules.js`): standings, reputation thresholds, AH cut and
  the disenchant tables, each with its source, instead of copies in app.js and advice.js.

- **Gear page, organised by slot.** A slot list (with Compare with on it) and the chosen slot in full:
  every upgrade at your level (best 15, then Show all), source chips with counts, and that slot's pre-BiS
  with your target on top and "Make target" on the rest. Random greens now count as upgrades even when
  they aren't on your AH.
- **The Gear page, rebuilt.** Four views per spec: **Upgrades** (slot by slot, what you have and several
  options that beat it, each with its source in one word: yours, on the AH, dungeon, quest, crafted,
  vendor, world drop; AH price and how many are listed; filter by source), **Pre-BiS** (best per slot up
  to 60 with alternatives you can click to make your target, and "only what I can get now"),
  **Auction House** (upgrades listed now, sorted by gain, and the random-suffix rolls worth searching
  for) and **Class sets**. Missing reputation or profession skill gets its own line.
- **AH greens count.** Random-suffix items ("Elegant Mantle of Healing") are scored from their roll's
  exact stats: every roll of 1,616 Forever items from foreverchanges.pro ("confirmed in game"), in the
  new `web/data/suffixes.js` (`gamedata/suffixes.py`).
- **The AH scan keeps each roll apart.** On Forever the scan's item links carry no suffix number, so every
  roll of an item was priced as one ("Short Bastard Sword of Healing" was really all its rolls). The scan
  now prices each roll by its listing name ("3192:of Healing"), and still keeps the item's all-rolls
  price. Needs a `/reload` after the update, then a new scan.
- **Stat weights: clean defaults.** Each spec uses the weights of its biggest talent tree unless you pick
  others, and the page says so. Profiles are named after their tree ("Holy", "Shadow"), and every number
  has its reason under "Why these numbers". Priests: Holy, Discipline and Shadow use the worked-out
  numbers; the guide's order shows next to them for comparison instead of as separate picks.
- Snapshot `gear[]`: `ahUpgrades`, `rollsToSearch`, pre-BiS `picked` and `alternatives`, `weightsChosen`,
  `source` and `ah` on each item (SCHEMA.md); `watch` stays as the older name for `ahUpgrades`.
- **Every computer shows what you have now.** Bags, gear, quests, talents, rep, bank, mail,
  professions and flight paths sync too: each part shows from whichever computer saved last, so
  opening the app on the Mac after playing on the PC shows the PC's bags and gear, not the Mac's
  older copy. Your own save file is never changed.
- **App review fixes.** Professions: the footer showed raw code (`${esc(p.name)} recipes ...`), and the skill
  bar could read "undefined / undefined". Quests: a reputation loss read "+-750" in green, and a reputation
  requirement showed raw data; it now says "Needs Friendly with Magram Clan Centaur" (red only if you don't
  have it). Journal: grind pause / resume have names, the loot-money chat line no longer repeats the money row,
  kills of a mob you never targeted take its name from QuestieDB when it's known. Bags: the main bank is called
  "Bank", not "Bag -1". Overview and sidebar: level 60 shows "Max level" instead of 0%. Dungeons: short visits
  with nothing done fold into one line. Update card: says what changed and the build, not the merge commit.
- **The Mac's local server only answers this computer's own page.** A web page could point its own domain at
  127.0.0.1 (DNS rebinding) and read the save and the sync key; requests for any host but localhost are now
  refused (the PC's server already did this). Part of #18.
- **Less work in game.** Spellcast events are registered for the player only, so other players' casts (party,
  raid, nameplates) no longer wake the addon.

- `snapshot.json` (and its copy online) names the app build each computer runs (`app`).
- **Claude can read where you are and your quest log from anywhere.** Each computer now also sends its
  current snapshot (position, quest log, gear and bag advice, professions, rep) online after every save,
  one per computer, only when it changed. Other computers don't download it.
- **An open app window picks up updates by itself.** After the server installs a new build, an open
  window loads it at a quiet moment (hidden or minimised, or 2 minutes without a click or key). Before,
  a window left open kept the old page, so a new feature (like sync) didn't start until it was reopened.
- **Even an app window left open from an older version can't hold sync back.** Until a window has loaded
  the page since the server last restarted (it restarts after every update), the server's hidden
  browser also runs after each save, so the new version's sync and snapshot happen anyway.
- The PC's server (server.ps1) is now tested in CI under Windows PowerShell 5.1.

- **The sidebar says how fresh the data really is.** WoW writes addon data to disk only on `/reload`,
  `/cc sync` and logout, so while you play the app shows your last save. Instead of "Live · synced 4 h
  ago" the sidebar now says "In game · last saved 4 h ago" while the game runs on this computer, and
  "Saved in game 4 h ago" when it doesn't, with a hover note on why (nothing is lost meanwhile: the addon
  keeps every change, such as a spec swap, and it all shows at the next save). `/api/stamp` gains
  `game` (true / false / null when the server can't tell).
- **History syncs between computers.** The journal, sessions, grinds, dungeon runs, notes, level and
  money history, disenchant results, AH prices, sales, buys and posts, and the app's settings go to
  a small Supabase backend after every save, and each computer shows its own save plus every other
  computer's history (js/sync.js, merged with the tested rules in js/merge.js). Records are keyed by
  their content, so nothing doubles and nothing conflicts; offline, the save itself is the queue. No
  sign-up: each install has its own device key, and System > Link another computer joins a second
  computer with a code. History the addon trims locally stays online. `snapshot.json` gains `sync`
  (the account id Claude reads the history with). Linking a computer keeps the settings you already
  have (a new computer takes the account's), a run or grind edited after it was sent updates
  everywhere, and the tests run the real backend SQL. Schema: `supabase/`; design: docs/ARCHITECTURE.md.
- **Builds publish themselves.** When a PR merges to `main` and the checks pass, CI
  (`.github/workflows/publish.yml`) publishes it to the `stable` branch; nobody publishes by hand.
  The game-data pack is now in the repository so CI can build. With the repository variable
  `DIST_REPO` and secret `DIST_TOKEN` it also publishes to a public download repository for friends;
  each build carries `web/channel.json`, so an app keeps updating from where it came from.
- **The app updates itself.** Each tested build is on the `stable` branch
  (`tools/publish-stable.py`): the ClaudeCompanion folder as it goes in AddOns,
  with the game-data pack, plus `BUILD.json` with every file's SHA-256. The local server checks the
  branch every 30 minutes and installs a new build by itself (auto-update, on by default), or when you
  click **Install now** on the card the app shows. It downloads the build, checks every file against
  `BUILD.json` (a damaged download installs nothing), backs up the current addon folder (last 5, in
  `%LOCALAPPDATA%\Claude Companionackups` or `~/Library/Application Support/Claude Companion/backups`),
  copies the new files over and restarts itself. `companion-data/` (snapshot, settings, cards) and the
  game's saved data are never touched. The only step left per build is `/reload` in game.
- The repository is private, so downloads use a token: `companion-data/update.json` `"token"`, else
  `CC_GITHUB_TOKEN`, else the GitHub CLI's (`gh auth token`). A public repository needs none.
- `GET /api/update` (status, `?force=1` checks now), `POST /api/update` (install),
  `POST /api/update-auto?on=0|1`. `companion-data/installed.json` says which build is installed.
- Mac, once: `tools/install.sh` (see its first lines) puts this on a Mac; it updates itself after that.

## Unreleased (smooth AH scan)

- **The full AH scan no longer freezes the game.** With 200,000+ auctions it read everything in one
  frame, up to three times. Now it waits until the list stops growing, reads a slice per frame (about
  6 ms), only asks for item links on items whose name has " of " (random suffixes), and the second
  pass rereads only the auctions whose details hadn't loaded. Closing the AH mid-scan stops it cleanly.
  `lastScan.secs` says how long it took.
- **The button moved** just below the AH window's right edge ("Scan AH"), where the game's own
  buttons and tabs can't overlap it. It shows Waiting, Reading 45%, Saving, and next to it when the
  next scan is allowed.

## Unreleased (dungeon runs)

- **Dungeon and raid runs are tracked by themselves.** Entering an instance starts a run on the same
  tracker as grinds: time, kills, loot, gold, XP, deaths, quests and rep, plus bosses (`ENCOUNTER_END` /
  `BOSS_KILL`), wipes and everyone in the group. Leaving parks it, so a run back after a wipe or a quest
  handed in outside stays the same run (time outside doesn't count). It ends after 15 min outside, on
  entering another instance, on "X has been reset.", or (like a grind) when this computer's save last saw
  it more than 15 min before the next login. A /reload or a short disconnect inside keeps it.
- **Kills inside dungeons are counted again.** Forever hides the kill event's GUIDs in instances, so
  no kill at all was logged in BRD. Kills now also come from the XP line ("X dies, you gain N
  experience"), which still names the mob (kills that give no XP are still missed).
- **App: new Dungeons tab** with every run. Runs from before this update are rebuilt from the Journal
  ("from the journal": kills counted from XP gains, no boss list), so past BRD runs show up too.
- **Group loot and rolls:** items (green and better) that go to someone else, who won them and every
  Need / Greed / Pass and roll, from the loot chat lines. In the run (`groupLoot[]`), the Journal
  (`groupLoot`) and the Dungeons tab ("Went to others").
- **Flight paths by continent:** the flight map only lists the continent you're on. Paths were already
  kept across continents; now each notes its continent, `taxiRead` says which continent's map was read
  when, the app groups them and says which continent still needs a flight map opened, and
  `snapshot.json` has `flightPaths`. Old "zzOLD" nodes are dropped.
- Bosses come from the game's own encounter events, not from the Dungeon Journal addon.
- **Bosses for older runs:** when the ForeverDungeonJournal addon is installed, its per-run boss log is
  copied (read only) into `c.bossLog` at login and logout. Runs rebuilt from the Journal, and tracked
  runs the encounter events missed, take their bosses from it. Without it, the Dungeons tab says "not
  recorded" instead of "?".
- `snapshot.json`: `runs[]` (the last 10, newest first). Journal: `runStart`, `runLeft`, `runBack`,
  `boss`, `wipe`, `runEnd`.

## Unreleased (Windows app)

- **Windows works like the Mac app:** `Claude Companion.bat` (run once, and after an update) adds
  **Claude Companion** to the Start menu, with its icon (`web/icons/app.ico`), and the hidden server to
  Startup. Both shortcuts run PowerShell through `conhost --headless`, so no console window ever shows.
  The Start menu entry starts the server if it isn't running and opens the app in its own window (the
  installed Edge/Chrome app if there is one, else `--app`, no tabs or address bar).
- `server.ps1 -Open` (what the Start menu runs). `-Uninstall` removes both shortcuts.

## Unreleased (grinds end cleanly, one save per computer)

- **A grind no longer runs on by itself.** Logging out ends it at the logout. A `/reload` or Sync keeps
  it (a reload that wasn't recognised as one, seen as a logout and a login seconds apart, brings it back).
  If this computer's save last saw the grind more than 2 minutes before you log in (a crash, a long
  disconnect, or you played on the other computer, whose save this one never sees), it ends at its last
  counted kill or loot, so the hours away don't count. 30 minutes with nothing counted ends it the same way.
  The grind records why it ended (`ended`: logout, away, idle) and on which computer it ran (`device`).
- **Pausing needs Shift-click (#31).** A plain click on the grind panel does nothing, so a stray click in
  combat can't pause it. Paused shows in red with a chat line, and `grindPause` / `grindResume` go in the
  Journal. Right-click still stops.
- **snapshot.json says which computer wrote it (#11):** `device` {host, os}, from the server, and `grind`
  {running, recent[]}. The PC and the Mac each keep their own save and their own `snapshot.json`.
- Test harness: `hooksecurefunc("Name", fn)` mock fixed (it never called the hook), tickers can be run.

## Unreleased (background snapshot)

- `snapshot.json` now updates after every save in game even with the app closed (#3): the server
  notices the save and has a hidden (headless) Chrome or Edge load the page once, so there is still
  one snapshot implementation (`js/claude.js`). `by` says which wrote it.
- The app's own settings (gear weights and picks, flips set aside) are kept in
  `companion-data/settings.json` too (`GET`/`POST /api/settings`): they survive a cleared browser,
  carry over between browsers, and the hidden browser uses them. Part of #15.

## Unreleased (app launch)

- The app is a normal app now. **Claude Companion.app** (macOS, replaces the `.command`) and
  **Claude Companion.bat** (Windows) set the local server to start at login, hidden (a LaunchAgent /
  a Startup-folder shortcut), restart it so an update takes effect, and open the app. No Terminal or
  PowerShell window to keep open.
- The page installs as its own app (Chrome / Edge "Install as an app" button in the sidebar; Safari:
  File > Add to Dock): Dock, Launchpad and Spotlight on a Mac, Start menu and taskbar on Windows.
  New icon (`tools/make-icons.py`), manifest with local icons.
- `server.py --serve / --uninstall`, `server.ps1 -Serve / -Uninstall`. Removed the old file mode
  (`data.js` written next to the page when the server couldn't start).

## Unreleased (From Claude cards)

- New **From Claude** tab, and its open cards on the Overview: Claude's suggestions (farm, flip, quest,
  gear, craft, route, note) in one card format, with facts, items (icon, tooltip, your AH price), steps
  you tick off, sources, and live results from `/cc start <name>` runs. Done / Dismiss / Restore.
- Claude writes `companion-data/from-claude/cards.json`; the app saves your choices to
  `from-claude/state.json` (servers: `GET /api/cards`, `GET` and `POST /api/cards-state`). Format in SCHEMA.md;
  `tools/check-cards.py` checks a cards file and runs in CI.

## Unreleased (data fixes)

- **Item cache no longer stops at 6,000 (#1):** when full, the items seen longest ago make room (a
  tenth of the cap at a time), never one that any character wears, carries, banks, has in the mail
  or keeps in a gear set. `cacheStats` counts evictions. Harness test fills the cache past the cap.
- **Flips count stacks (#2):** buys and sales keep the stack size from the AH letter (invoice count,
  or the won item's stack); flips match unit by unit, oldest purchase first. A purchase can be set
  aside as "Used, not a flip".
- **Stale snapshot is detectable (#3):** `snapshot.json` gains `saveModified` (the save file time
  it was built from) and `taken` per part (bank, mail, flight paths, AH, professions, specs).
  SCHEMA.md tells Claude to compare `saveModified` with the save file before trusting it.
## Unreleased

- **Gear page rebuilt:** per spec, a summary (pre-BiS progress, upgrades now, class sets), a
  **pre-BiS checklist** (best item per slot up to 60, raids and PvP left out, with what you have
  in the compared set and whether you own the target: worn, bags, bank or missing), next upgrades,
  **class sets** and the AH watch list.
- **Class sets:** every item set for your class that Forever has, with pieces, where each comes
  from, which you own, and set bonuses (active ones highlighted). Data-driven for any class:
  set pieces from ForeverDB, set names and bonuses from the client tooltips (endgametools), class
  from item masks, "Classes:" lines and class quests (the dungeon set 0.5 chain). Pack key `sets`.
- PvP honor gear (sold in Champions' Hall / Hall of Legends or named after a PvP rank) is left out
  of PvE lists; sets sold only by the other faction's vendor are hidden.
- Snapshot: `gear[].classSets[]`, `preBis[].status`.
## Unreleased (logout snapshot)

- Logging out no longer wipes the saved bags, worn gear, gold and other parts: the game empties them
  before `PLAYER_LOGOUT`, so a logout snapshot now keeps the previous value of any part that reads
  empty (and money / max mana / max health read as 0). `snap.kept` and `snap.keptFrom` say what was
  kept and from when. Harness test added. (#27)
## Unreleased: item advice

- **One item engine** (`web/js/advice.js`): every item you own is scored once per spec with that
  spec's weights, against the gear that spec uses. Bags, Character, Gear and the snapshot all read it.
- **Bags & Bank:** a quiet mark on each item (Upgrade, Disenchant, Auction House, Vendor, Keep, ask)
  and the full verdict in its tooltip: score and gain per spec, disenchant value, AH and vendor price.
  Chips above the bags show only one kind. Quest items, keys, rep turn-ins, set items are never sold.
  Words and colours: `docs/ui-language.md`.
- **Character:** the worn slot something you own would beat is marked, with the item and the gain.
- **Gear:** "Best from what you own" per spec, which two rings and which two trinkets included, next
  to what that spec's set uses.
- **Stat weights page and defaults for every class and spec** (`web/js/weights.js`): order from Icy
  Veins' WoW Forever pages, numbers from what each stat costs on Forever gear (docs/STAT-WEIGHTS.md).
  Your own profiles: copy, edit, rename, reset, delete; pick one per spec. The old "Your own weights"
  move into a profile. Fixes #5. Weapon DPS is scored for weapon specs (part of #6).
- Removed: the Auction House tab's "Disenchant or sell" list (its verdicts now live on the items).
- Snapshot: `bagAdvice[]`, `bestOwned[]`, `weightProfiles[]`, `gear[].weightsName/weightsSource/weightValues`.
- Tests: `test/web/advice.test.js` (node, runs in CI).

## 1.4.0 (22 Nov), first release from this repository

Addon 1.4.0 plus the app as of 22 Nov 08:30 UTC.

- **Addon:** group kills and party coin share count as loot; disenchant source found even when
  Forever doesn't flag the item locked; mail origin for received items (AH win + price);
  AH purchases recorded (`ah.buys`); `ns.PlanPrice`.
- **Game-data pack v2:** one owner per field (QuestieDB / endgametools / ForeverDB), built by
  `gamedata/build.sh` with tests (`test_pack.py`) and `COVERAGE.md`.
- **Gear tab:** next upgrades, pre-BiS and a BoE watch list per spec. Wearable items come from
  your weapon and armor skills (any class); Ranged slot incl. relics; necks, rings, trinkets and
  cloaks included; compare against a gear set; "Your own weights" editor. Spec named by its
  biggest tree (Forever returns the class name).
- **Cooldowns:** any profession, from recipes and the cast log; shared cooldowns (Transmutes) grouped.
- **AH Flips:** each purchase matched to its later sale; profit after the 5% cut.
- **Claude snapshot:** `companion-data/snapshot.json` (see `SCHEMA.md`).
- **macOS:** `server.py` + `Claude Companion.command`, same endpoints as `server.ps1`.
- **UI:** Graphite theme, responsive rem layout (860 px to 1920 px+), item tooltips use the app
  font instead of the in-game serif.
- Fixed a stray `}` in `server.ps1`.

## 1.3.0 (22 Nov)

- The page became an app: `server.ps1` local server, Edge app window, live updates on Sync.
- Overview freshness list; disenchant-or-sell for every green/blue in bags and bank (skips worn
  and gear-set items); AH sales no longer counted twice.

## 1.2.0 (22 Nov)

- Full AH scan button (`/cc scan`, `C_AuctionHouse.ReplicateItems`; 242k auctions confirmed).
- Disenchant tracking, reputation per grind, interaction-manager hooks (bank, taxi, AH, money
  source), other-spec talents via loadout probe, quest rewards, QuestieDB enrichment.

## 1.1.0 (21 Nov)

- Grind tracker (`/cc start|stop|pause`, panel), full talent trees with tooltips, bank fix.

## 1.0.1 (21 Nov)

- Character key uses the normalized realm when `GetRealmName()` is empty; migrates old keys.

## 1.0.0 (21 Nov)

- First version: records character, gear, bags, bank, specs, bars, quests, professions, gold,
  loot and AH prices to SavedVariables; `/cc` window; Claude inbox.
