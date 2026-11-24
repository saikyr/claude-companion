# Stat weights

How the app scores gear: an item's score is the sum of stat × weight for the profile a spec uses.
Code: `ClaudeCompanion/web/js/weights.js`. Pick and edit profiles on the **Stat weights** page.

## Where the default numbers come from

| Part | Source | What it gives |
| --- | --- | --- |
| Order | Icy Veins' WoW Forever stat priority page for each spec (all updated 4 Nov 2026, Enhancement 13 Nov; read 22 Nov 2026) | The order of stats. No numbers. |
| Cost | Measured from the game-data pack (Forever client tooltips via endgametools) | What one point of each stat uses of an item's stat budget |
| Conversions | foreverdb.net/stats (Forever client build 1.60.1) | 14 crit / 10 hit / 12 dodge / 15 parry / 5 block rating = 1%; 14 attack power = 1 weapon DPS; attack power per Strength and Agility by class |

**Cost.** On Forever gear an item's stat budget adds up as the square root of the sum of squares
(checked on 1,726 multi-stat items: median ratio 1.02 against single-stat items of the same item
level, slot group and quality; a plain sum gives 1.43). A stat's cost is the budget it uses divided
by its amount, Stamina = 1:

| Stat | Cost | Sample |
| --- | --- | --- |
| Strength, Agility, Intellect, Spirit, Stamina | 1 | 30-138 item groups |
| Spell power | 1 | 24 groups |
| Healing | 0.54 | 5 items (small) |
| Hit rating | 1.33 | 23 items |
| Crit rating | 0.86 | 20 items |
| MP5 | 2.33 | 20 items, wide spread (1.35-3.67) |
| Attack power | 0.5 | 53 items |
| Defense | 1.79 | 33 items |
| Dodge rating | 1.08 | 9 items |
| Expertise, Parry, Haste, Spell Pierce, bonus Armor | assumed (1.33, 1.08, 0.86, 1, 0.1) | no clean sample |

**Rule.** Starter weight = cost × 1, 0.8, 0.65, 0.5, 0.4, 0.32 for the 1st to 6th stat in the
guide's order; 0.3 for stats the guide says are "also valued"; 0 for the rest. Then:

- Spell power counts as spell damage, and as each school the spec casts (Fire for Fire mages,
  Shadow and Fire for Warlocks, ...). Healers: spell power = healing, 1 for 1. "Healing" items give
  damage specs a third of their value (they say "+X healing and +X/3 damage").
- Attack power: its own place in the order, or what the stat that gives it is worth (2 attack
  power per Strength for Warriors, Paladins, Shamans and Druids; half of Agility's weight for Rogues
  and Hunters, the other half being its crit). Weapon DPS = 14 × attack power.
- "%" lines (crit, hit, dodge, parry, block) count as rating with the conversions above.
- Weapon DPS is weighed per hand: **Melee weapon DPS** (`dps`) counts in full in the main hand and half in
  the off hand; **Ranged weapon DPS** (`rdps`) counts in the Ranged slot and only Hunters have it. Beast
  Mastery and Marksmanship weigh the bow alone, Survival both; nobody weighs a wand's DPS. Hunters weigh
  ranged attack power like attack power.
- A stat the guide doesn't rank still counts for the attack power it gives (Strength for Rogues and
  Survival Hunters: 1 attack power each).
- Tanks (both Protection Warrior profiles, Protection Paladin, bear survival) always weigh armor a little
  (0.03 a point when the guide doesn't rank it), so a cloth robe with the same stats never beats plate.

This turns "A before B" into "a budget spent on A is worth more than the same budget on B". It is
not a simulation. Spell hit has a cap: for spell weights, hit counts only up to the raid cap
(`data/rules.js` `spellHit`, 17% against raid bosses, from the Forever guides; the owner's choice, since
pre-raid gear is gear for raids), measured against your hit from the compared gear plus talents read
from their text at your rank (Shadow Focus, Elemental Precision...), with the client's own rating per 1%
(`stats.spellHitRating / spellHitBonus`); past the cap hit is worth nothing (`gear[].hit` in the snapshot).
Known gaps: melee hit and expertise caps aren't applied; weapon skill isn't scored; Use and proc effects aren't scored (marked "+ effect").

**Which weights a spec uses.** Each spec uses its biggest talent tree's profile (Holy 17/33/0 → Holy)
until you pick another on the Stat weights page. With no talent points yet it uses the tree the class levels in (Arms,
Retribution, Beast Mastery, Combat, Shadow, Frost, Affliction, Enhancement, Feral); a tie goes to that tree
when it is one of the tied ones (`js/weights.js` `pickTree`). Every built-in profile is named after its tree; trees
with two playstyles have two (Protection (threat) / (survival), Retribution (Unsealed Wrath) / (Holy
Shock), Feral (cat, bear threat) / (bear survival)), the first being the default.

**Priests** use numbers worked out for this project from Forever's own spell and regen data (18 Nov
2026), because the guides give no numbers and their order is for level-60 raids: **Holy** and
**Discipline** (Healing 1, Spell power 1, MP5 2.3, Intellect 1.6, Spirit 0.7, Crit 0.3: mana stats counted
for the half of pulls where you run out of mana) and **Shadow** (Spell power / Shadow damage 1, MP5 0.66,
Spirit 0.55, Intellect 0.35, Crit 0.3, Hit 1.66 up to the cap and 0 past it: built for questing with Spirit Tap). The Stat weights
page shows the reason for every number and the guide's order next to it. The guide-order Priest sets
are no longer offered as picks.

## Your own profiles

Copy any profile, edit its numbers, rename, reset to the profile it came from, or delete it. They
are saved in the browser (`localStorage` key `cc.weights.v1`), per class, so alts of one class share
them. Which profile a spec uses is kept per character and spec (`cc.gear.profile.<Name-Realm>.spec<1|2>`, mirrored to `companion-data/settings.json` and synced).
The old "Your own weights" list moves into a profile by itself the first time the app opens.
Moving these settings into a file next to the snapshot is issue #15.

## Every default

| Class | Profile | Guide order | Weights | Source |
| --- | --- | --- | --- | --- |
| Warrior | Arms | Weapon DPS > Hit > Expertise > Critical Strike > Strength (also: Haste, Agility, Attack Power) | Agi 0.3, Str 0.4, Hit 1.064, Crit 0.43, Haste 0.258, Exp 0.865, AP 0.2, DPS 2.8 | [link](https://www.icy-veins.com/wow-forever/arms-warrior-melee-dps-pve-stat-priority) |
| Warrior | Fury | Weapon DPS > Hit > Expertise > Critical Strike > Strength (also: Haste, Agility, Attack Power) | Agi 0.3, Str 0.4, Hit 1.064, Crit 0.43, Haste 0.258, Exp 0.865, AP 0.2, DPS 2.8 | [link](https://www.icy-veins.com/wow-forever/fury-warrior-melee-dps-pve-stat-priority) |
| Warrior | Protection (threat) | Expertise > Hit > Agility > Strength > Stamina | Agi 0.65, Str 0.5, Sta 0.4, Hit 1.064, Exp 1.33, AP 0.25, Armor 0.03 | [link](https://www.icy-veins.com/wow-forever/protection-warrior-tank-pve-stat-priority) |
| Warrior | Protection (survival) | Stamina > Armor > Agility > Avoidance (Dodge, Parry) > Defense | Agi 0.65, Sta 1, Def 0.716, Dodge 0.54, Parry 0.54, BlockV 0.171, Armor 0.08 | [link](https://www.icy-veins.com/wow-forever/protection-warrior-tank-pve-stat-priority) |
| Rogue | Assassination | Expertise > Hit > Agility > Weapon DPS > Critical Strike | Agi 0.65, Str 0.325, Hit 1.064, Crit 0.344, Exp 1.33, AP 0.325, DPS 4.55 | [link](https://www.icy-veins.com/wow-forever/assassination-rogue-melee-dps-pve-stat-priority) |
| Rogue | Combat | Expertise > Hit > Agility > Weapon DPS > Critical Strike | Agi 0.65, Str 0.325, Hit 1.064, Crit 0.344, Exp 1.33, AP 0.325, DPS 4.55 | [link](https://www.icy-veins.com/wow-forever/combat-rogue-melee-dps-pve-stat-priority) |
| Rogue | Subtlety | Weapon DPS > Expertise > Hit > Weapon Skill > Agility | Agi 0.4, Str 0.2, Hit 0.865, Exp 1.064, AP 0.2, DPS 2.8 | [link](https://www.icy-veins.com/wow-forever/subtlety-rogue-melee-dps-pve-stat-priority) |
| Hunter | Beast Mastery | Weapon DPS > Hit > Critical Strike > Agility > Attack Power | Agi 0.5, Hit 1.064, Crit 0.559, AP 0.2, RAP 0.2, Ranged DPS 2.8 | [link](https://www.icy-veins.com/wow-forever/beast-mastery-hunter-ranged-dps-pve-stat-priority) |
| Hunter | Marksmanship | Weapon DPS > Hit > Critical Strike > Agility > Attack Power | Agi 0.5, Hit 1.064, Crit 0.559, AP 0.2, RAP 0.2, Ranged DPS 2.8 | [link](https://www.icy-veins.com/wow-forever/marksmanship-hunter-ranged-dps-pve-stat-priority) |
| Hunter | Survival | Weapon DPS > Hit > Critical Strike > Agility > Attack Power | Agi 0.5, Str 0.2, Hit 1.064, Crit 0.559, AP 0.2, RAP 0.2, DPS 2.8, Ranged DPS 2.8 | [link](https://www.icy-veins.com/wow-forever/survival-hunter-melee-dps-pve-stat-priority) |
| Mage | Arcane | Hit > Spell Power > Critical Strike > Intellect > Spirit > MP5 | Int 0.5, Spi 0.4, Hit 1.33, Crit 0.559, Heal 0.267, SpDmg 0.8, MP5 0.746, SP 0.8, Arcane 0.8 | [link](https://www.icy-veins.com/wow-forever/arcane-mage-ranged-dps-pve-stat-priority) |
| Mage | Fire | Hit > Spell Power > Critical Strike > Intellect > Spirit > MP5 | Int 0.5, Spi 0.4, Hit 1.33, Crit 0.559, Heal 0.267, SpDmg 0.8, MP5 0.746, SP 0.8, Fire 0.8 | [link](https://www.icy-veins.com/wow-forever/fire-mage-ranged-dps-pve-stat-priority) |
| Mage | Frost | Hit > Spell Power > Critical Strike > Intellect > MP5 > Spirit | Int 0.5, Spi 0.32, Hit 1.33, Crit 0.559, Heal 0.267, SpDmg 0.8, MP5 0.932, SP 0.8, Frost 0.8 | [link](https://www.icy-veins.com/wow-forever/frost-mage-ranged-dps-pve-stat-priority) |
| Warlock | Affliction | Hit > Spell Power > Critical Strike > Haste > Intellect | Int 0.4, Hit 1.33, Crit 0.559, Haste 0.43, Heal 0.267, SpDmg 0.8, SP 0.8, Shadow 0.8 | [link](https://www.icy-veins.com/wow-forever/affliction-warlock-ranged-dps-pve-stat-priority) |
| Warlock | Demonology | Hit > Spell Power > Critical Strike > Haste > Intellect | Int 0.4, Hit 1.33, Crit 0.559, Haste 0.43, Heal 0.267, SpDmg 0.8, SP 0.8, Fire 0.8, Shadow 0.8 | [link](https://www.icy-veins.com/wow-forever/demonology-warlock-ranged-dps-pve-stat-priority) |
| Warlock | Destruction | Hit > Spell Power > Haste > Critical Strike > Intellect | Int 0.4, Hit 1.33, Crit 0.43, Haste 0.559, Heal 0.267, SpDmg 0.8, SP 0.8, Fire 0.8, Shadow 0.8 | [link](https://www.icy-veins.com/wow-forever/destruction-warlock-ranged-dps-pve-stat-priority) |
| Priest | Discipline (guide order, comparison only) | Healing Power > MP5 > Spirit > Intellect > Critical Strike | Int 0.5, Spi 0.65, Crit 0.344, Heal 0.54, MP5 1.864, SP 0.54 | [link](https://www.icy-veins.com/wow-forever/discipline-priest-healer-pve-stat-priority) |
| Priest | Holy (guide order, comparison only) | Healing Power > MP5 > Spirit > Intellect > Critical Strike | Int 0.5, Spi 0.65, Crit 0.344, Heal 0.54, MP5 1.864, SP 0.54 | [link](https://www.icy-veins.com/wow-forever/holy-priest-healer-pve-stat-priority) |
| Priest | Shadow (guide order, comparison only) | Hit > Spell Power > Critical Strike > Spell Pierce > Spirit | Spi 0.4, Hit 1.33, Crit 0.559, Heal 0.267, SpDmg 0.8, SP 0.8, Pierce 0.5, Shadow 0.8 | [link](https://www.icy-veins.com/wow-forever/shadow-priest-ranged-dps-pve-stat-priority) |
| Paladin | Holy | Healing Power > Intellect > Spirit > MP5 > Critical Strike | Int 0.8, Spi 0.65, Crit 0.344, Heal 0.54, MP5 1.165, SP 0.54 | [link](https://www.icy-veins.com/wow-forever/holy-paladin-healer-pve-stat-priority) |
| Paladin | Protection | Stamina > Defense > Spell Power > Intellect > Strength | Str 0.4, Int 0.5, Sta 1, Def 1.432, AP 0.2, Heal 0.217, SpDmg 0.65, SP 0.65, BlockV 0.171, Armor 0.03, Holy 0.65 | [link](https://www.icy-veins.com/wow-forever/protection-paladin-tank-pve-stat-priority) |
| Paladin | Retribution (Unsealed Wrath) | Weapon DPS > Hit > Expertise > Strength > Spell Power (also: Critical Strike, Agility, Intellect) | Agi 0.3, Str 0.5, Int 0.3, Hit 1.064, Crit 0.258, Exp 0.865, AP 0.25, Heal 0.133, SpDmg 0.4, SP 0.4, Holy 0.4, DPS 3.5 | [link](https://www.icy-veins.com/wow-forever/retribution-paladin-melee-dps-pve-stat-priority) |
| Paladin | Retribution (Holy Shock) | Weapon DPS > Hit > Spell Power > Critical Strike > Expertise (also: Strength, Agility, Intellect) | Agi 0.3, Str 0.3, Int 0.3, Hit 1.064, Crit 0.43, Exp 0.532, AP 0.15, Heal 0.217, SpDmg 0.65, SP 0.65, Holy 0.65, DPS 2.1 | [link](https://www.icy-veins.com/wow-forever/retribution-paladin-melee-dps-pve-stat-priority) |
| Shaman | Elemental | Spell Power > Hit > Critical Strike > Intellect > MP5 | Int 0.5, Hit 1.064, Crit 0.559, Heal 0.333, SpDmg 1, MP5 0.932, SP 1, Fire 1, Frost 1, Nature 1 | [link](https://www.icy-veins.com/wow-forever/elemental-shaman-ranged-dps-pve-stat-priority) |
| Shaman | Enhancement | Weapon DPS > Hit > Expertise > Strength > Intellect > Spell Power | Str 0.5, Int 0.4, Hit 1.064, Exp 0.865, AP 0.25, Heal 0.107, SpDmg 0.32, SP 0.32, Fire 0.32, Frost 0.32, Nature 0.32, DPS 3.5 | [link](https://www.icy-veins.com/wow-forever/enhancement-shaman-melee-dps-pve-stat-priority) |
| Shaman | Restoration | Healing Power > Critical Strike > Intellect > Spirit > MP5 | Int 0.65, Spi 0.5, Crit 0.688, Heal 0.54, MP5 0.932, SP 0.54 | [link](https://www.icy-veins.com/wow-forever/restoration-shaman-healer-pve-stat-priority) |
| Druid | Balance | Hit > Critical Strike > Spell Power > Intellect | Int 0.5, Hit 1.33, Crit 0.688, Heal 0.217, SpDmg 0.65, SP 0.65, Arcane 0.65, Nature 0.65 | [link](https://www.icy-veins.com/wow-forever/balance-druid-ranged-dps-pve-stat-priority) |
| Druid | Feral (cat, bear threat) | Weapon DPS > Expertise > Hit > Agility > Strength (also: Critical Strike, Attack Power) | Agi 0.5, Str 0.4, Hit 0.865, Crit 0.258, Exp 1.064, AP 0.25, DPS 3.5 | [link](https://www.icy-veins.com/wow-forever/feral-druid-melee-dps-and-tank-pve-stat-priority) |
| Druid | Feral (bear survival) | Armor > Defense > Stamina > Agility > Dodge | Agi 0.5, Sta 0.65, Def 1.432, Dodge 0.432, BlockV 0.171, Armor 0.1 | [link](https://www.icy-veins.com/wow-forever/feral-druid-melee-dps-and-tank-pve-stat-priority) |
| Druid | Restoration | Healing Power > Intellect > Spirit > MP5 > Critical Strike | Int 0.8, Spi 0.65, Crit 0.344, Heal 0.54, MP5 1.165, SP 0.54 | [link](https://www.icy-veins.com/wow-forever/restoration-druid-healer-pve-stat-priority) |
