# UI language: item advice

One small vocabulary for what the app says about an item, used the same way everywhere: Bags &
Bank, the Character sheet, the Gear page, tooltips and Claude's snapshot. Code:
`ClaudeCompanion/web/js/advice.js` (verdicts) and the "item advice" block in `css/app.css`.

## Principles

- **Quiet in the grid, full in the tooltip.** An item square gets at most one small mark. The reason,
  the score per spec and the money sit in the tooltip.
- **One engine.** Every view reads the same verdict (`CC.advice`). No view works out its own.
- **Colour means something.** Green = gain, purple = disenchant, gold coin = Auction House, silver
  coin = vendor, amber = needs you. Quality colours stay as they are; the marks never change a border.
- **Keep is the default.** Keeping needs no mark. Quest items, keys, rep turn-ins, dungeon shortcuts,
  gear-set items, profession tools, shirts and tabards are never flagged to sell.
- **Unsure means ask.** When the app can't tell (an effect it can't score, a sidegrade within 5%, no
  price), it says "Keep, ask" with the reason, never "Sell".

## The words

| Flag | Mark | Tooltip words | When |
| --- | --- | --- | --- |
| Upgrade | green corner wedge | "Upgrade for Shadow" / "Upgrade at level 60 for Holy" | Scores higher than what that spec's gear uses in that slot (the weaker ring or trinket) |
| Disenchant | purple dot | "Disenchant · ≈ 2g 92s" | You have Enchanting, and the materials are worth more than selling |
| Auction House | gold dot | "Sell on the Auction House · ≈ 7g" | Not bound, and your AH scan median (minus the 5% cut) beats vendor and disenchant |
| Vendor | silver dot | "Sell to a vendor · ≈ 45s" | Grey items, and gear where the vendor price is best |
| Keep, ask | amber ring | "Keep, ask" + why | The app isn't sure |
| Keep | none | "Keep: quest item", "Keep: key", "Keep: in your heals set", ... | Never sold off |

On the Character sheet, a worn slot that something you own would beat gets the same green wedge,
a soft glow, and one line under it: "Songstone of Ironforge (bags) +11.2 Holy". It is measured
against what you wear, for the spec whose gear set you have on.

## Numbers

Scores use the spec's weights (docs/STAT-WEIGHTS.md), one decimal. Gains are signed: "+12.0" green,
"−7.5" red. Money uses the coin format with `≈` for estimates. "Best from what you own" shows a ✓
when the set already uses the best you have.

## The Gear page

One page per spec (the switcher in the header; each spec is named by its biggest tree), three views:

- **By slot** (default): on the left, the slot list: every slot with what the compared gear has there, its
  score and the biggest gain you can get now. **Compare with** (what you wear, or one of your gear sets) sits
  at the top of that list, because it is what the list shows. Click a slot to see it in full on the right:
  - **Upgrades at your level**: every item that beats it, best gain first; the best 15 show, "Show all"
    shows the rest. Source chips with counts filter the list (Yours, On the AH, Dungeon, Quest, Crafted,
    Random green, Vendor, World drop). Each row says its source in one word, the AH price with how many are
    listed and when, its score and its gain. Missing reputation or profession skill is its own amber
    "Needs ..." line, never hidden.
  - **Pre-BiS**: the best up to level 60 (raids left out), with your target on top (two for rings and
    trinkets). "Make target" on any other row makes it your target (kept per character and spec); "use the
    best" undoes it. "Only what I can get now" leaves out items behind reputation or profession skill you
    don't have.
- **Auction House**: upgrades listed on your AH now (from the newest scan, at most 3 days old), sorted by
  gain, with gain per gold; then the random-suffix rolls worth searching for, per slot.
- **Class sets**: every item set for your class on Forever, pieces owned, bonuses active.

Random greens ("of Healing") are scored from their roll's exact stats (data/suffixes.js), never from the
base item. They count as upgrades whether or not they are on your AH: any creature of their level can drop
them. For each roll, the best base you can wear at your level is shown.

## The Now page

The Overview's main list: **what moves the character forward next**, ranked, computed by the app from the
save and the game data (`js/next.js`). Claude is not needed for it; Claude's cards sit beside it.

- **Ready now** (only when there is something): quests ready to turn in, with who takes them; cooldowns
  that are ready; upgrades already in your bags or bank.
- **From Claude**: open cards, at most four. A card whose `step` names a row shows on that row instead.
- **Next steps**: one row per step, best first. Filters: All, Gear, Quests, Dungeons, Professions, Unlocks.
  **Hybrid** (default) adds every spec's gain; a spec button ranks by that spec alone. A row opens in place.
  - *Dungeon*: bosses' levels, how many upgrades and quests; opened: each upgrade with its boss and drop
    chance ("Classic rate" unless ForeverDB measured it on Forever), then the dungeon's quests.
  - *Quest*: its zone, level, earlier chain steps still to do and where the first starts; opened: the
    chain and the reward. Under 60, quests that only give XP are grouped per zone ("Mount Hyjal · 40 quests").
  - *Item*: an upgrade no quest or dungeon above covers (Auction House, crafted, vendor, world drop).
  - *Profession*: "Tailoring 268 → 285" when that skill opens a crafted upgrade; opened: what it opens
    and the cheapest skill-up recipes now (orange and yellow, reagents at your AH prices).
  - *Unlock*: attunements and keys (`data/rules.js`), done, in progress or how it starts; raids say when they open.
- **Value**, the right column: gains in green per spec ("Holy +12.4 · Shadow +3.1"), and under 60 the XP as
  "% of a level". A dungeon's gain is one run's expected best upgrade per slot (drop chances), plus its quests.
  A quest's is its best reward; a profession step's and an unlock's, what they open.
- **Needs** lines are amber, as everywhere: a level, reputation, earlier steps, a key, a group member too low.
- What's out of date and changes the advice (character, bank, AH scan) shows above the list; the full
  list of saved data is on the System tab.

## The Stat weights page

"Your specs" says which weights each spec uses and why ("Default: most of your talent points are in Holy"
or "Your pick"); the select changes it. Below, one profile at a time: its numbers as bars, biggest first,
then **Why these numbers**: a short paragraph, one line per stat, the guide's order, and the source.
Built-in profiles are named after their tree, nothing else ("Holy", "Protection (survival)").

## Controls

The same few controls on every page (`css/app.css`):

- **Buttons:** `.btn` for the one main action, `.btn.ghost` for the others, `.linkbtn` inside text.
  Filters and choices are `.chips` buttons (`.on` = chosen).
- **Text fields:** `input.search` (with the magnifier) to filter a list, `input.field` for anything
  else typed in, the same height as the button next to it. `input.field.code` for codes.
- **Codes** to read off or type in (System, Link another computer): `.code`, monospace and spaced,
  shown in two groups of four ("ABCD EFGH"); spaces and dashes typed with a code don't matter.
- A row of controls is a `.toolbar`; no inline styles.
