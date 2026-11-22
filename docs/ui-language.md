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

One page per spec (the switcher in the header; each spec is named by its biggest tree), four views:

- **Upgrades** (default): one block per slot with what the compared set has there and its score, then
  the options that beat it, best gain first: the best few plus the best of each other source, so a slot
  never shows six versions of one dungeon. Each option says its **source** in one word (Yours, On the AH,
  Dungeon, Quest, Crafted, Vendor, World drop; the AH and your own items get a coloured dot), the AH price
  with how many are listed and when they were seen, its score and its gain. Missing reputation or
  profession skill is its own amber "Needs ..." line, never hidden. Slots with nothing better are one
  line at the bottom. Source chips filter the page to one source.
- **Pre-BiS**: per slot the best item up to level 60 (raids left out), with up to four alternatives as
  buttons. Clicking one makes it your target (kept per character and spec); "use the best instead" undoes
  it. "Only what I can get now" leaves out items behind reputation or profession skill you don't have.
- **Auction House**: upgrades listed on your AH now (from the newest scan, at most 3 days old), sorted by
  gain, with gain per gold; then the random-suffix rolls worth searching for, per slot.
- **Class sets**: every item set for your class on Forever, pieces owned, bonuses active.

The four cards at the top link to the views; the last one names the weights in use and why ("default for
Holy" or "your pick"). Random-suffix items ("of Healing") are scored from their roll's exact stats
(data/suffixes.js), never from the base item.

## The Stat weights page

"Your specs" says which weights each spec uses and why ("Default: most of your talent points are in Holy"
or "Your pick"); the select changes it. Below, one profile at a time: its numbers as bars, biggest first,
then **Why these numbers**: a short paragraph, one line per stat, the guide's order, and the source.
Built-in profiles are named after their tree, nothing else ("Holy", "Protection (survival)").
