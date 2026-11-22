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
