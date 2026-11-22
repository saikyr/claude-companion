// Game rules the app needs that no data source ships per item: one place, each with its source.
// Hand-kept (they change only with a game patch). Checked by test/web/data.test.js in CI.
// Per-item facts (stats, sources, drop rates, NPCs, quests, vendors) live in data/gamedata.js instead.
window.GAMERULES = {
  v: 1,
  // reputation standings, index = the game's standingID / reaction (1 Hated ... 8 Exalted)
  standing: ['', 'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'],
  // where each standing starts, in points from the start of Neutral (how QuestieDB gives reputation needs)
  repFloor: [null, -42000, -6000, -3000, 0, 3000, 9000, 21000, 42000],
  // the Auction House keeps 5% of a sale (checked on Gabriel's own sales, 22 Nov 2026); the deposit comes back on a sale
  ahCut: 0.05,
  // Disenchanting. Source: warcraft.wiki.gg "Disenchanting tables" (Classic; wow-professions.com/forever lists the
  // same materials). Not measured on Forever: the addon also logs your real results (Journal, "de").
  // Rows: [lowest item level, highest item level, [[material, chance, min, max], ...]]
  disenchant: {
    from: 'warcraft.wiki.gg Disenchanting tables (Classic numbers, not measured on Forever)',
    armor: [
    [5, 15, [['Strange Dust', 0.8, 1, 2], ['Lesser Magic Essence', 0.2, 1, 2]]],
    [16, 20, [['Strange Dust', 0.75, 2, 3], ['Greater Magic Essence', 0.2, 1, 2], ['Small Glimmering Shard', 0.05, 1, 1]]],
    [21, 25, [['Strange Dust', 0.75, 4, 6], ['Lesser Astral Essence', 0.15, 1, 2], ['Small Glimmering Shard', 0.1, 1, 1]]],
    [26, 30, [['Soul Dust', 0.75, 1, 2], ['Greater Astral Essence', 0.2, 1, 2], ['Large Glimmering Shard', 0.05, 1, 1]]],
    [31, 35, [['Soul Dust', 0.75, 2, 5], ['Lesser Mystic Essence', 0.2, 1, 2], ['Small Glowing Shard', 0.05, 1, 1]]],
    [36, 40, [['Vision Dust', 0.75, 1, 2], ['Greater Mystic Essence', 0.2, 1, 2], ['Large Glowing Shard', 0.05, 1, 1]]],
    [41, 45, [['Vision Dust', 0.75, 2, 5], ['Lesser Nether Essence', 0.2, 1, 2], ['Small Radiant Shard', 0.05, 1, 1]]],
    [46, 50, [['Dream Dust', 0.75, 1, 2], ['Greater Nether Essence', 0.2, 1, 2], ['Large Radiant Shard', 0.05, 1, 1]]],
    [51, 55, [['Dream Dust', 0.75, 2, 5], ['Lesser Eternal Essence', 0.2, 1, 2], ['Small Brilliant Shard', 0.05, 1, 1]]],
    [56, 60, [['Illusion Dust', 0.75, 1, 2], ['Greater Eternal Essence', 0.2, 1, 2], ['Large Brilliant Shard', 0.05, 1, 1]]],
    [61, 65, [['Illusion Dust', 0.75, 2, 5], ['Greater Eternal Essence', 0.2, 2, 3], ['Large Brilliant Shard', 0.05, 1, 1]]],
  
    ],
    weapon: [
    [6, 15, [['Strange Dust', 0.2, 1, 2], ['Lesser Magic Essence', 0.8, 1, 2]]],
    [16, 20, [['Strange Dust', 0.2, 2, 3], ['Greater Magic Essence', 0.75, 1, 2], ['Small Glimmering Shard', 0.05, 1, 1]]],
    [21, 25, [['Strange Dust', 0.15, 4, 6], ['Lesser Astral Essence', 0.75, 1, 2], ['Small Glimmering Shard', 0.1, 1, 1]]],
    [26, 30, [['Soul Dust', 0.2, 1, 2], ['Greater Astral Essence', 0.75, 1, 2], ['Large Glimmering Shard', 0.05, 1, 1]]],
    [31, 35, [['Soul Dust', 0.2, 2, 5], ['Lesser Mystic Essence', 0.75, 1, 2], ['Small Glowing Shard', 0.05, 1, 1]]],
    [36, 40, [['Vision Dust', 0.2, 1, 2], ['Greater Mystic Essence', 0.75, 1, 2], ['Large Glowing Shard', 0.05, 1, 1]]],
    [41, 45, [['Vision Dust', 0.2, 2, 5], ['Lesser Nether Essence', 0.75, 1, 2], ['Small Radiant Shard', 0.05, 1, 1]]],
    [46, 50, [['Dream Dust', 0.2, 1, 2], ['Greater Nether Essence', 0.75, 1, 2], ['Large Radiant Shard', 0.05, 1, 1]]],
    [51, 55, [['Dream Dust', 0.22, 2, 5], ['Lesser Eternal Essence', 0.75, 1, 2], ['Small Brilliant Shard', 0.03, 1, 1]]],
    [56, 60, [['Illusion Dust', 0.22, 1, 2], ['Greater Eternal Essence', 0.75, 1, 2], ['Large Brilliant Shard', 0.03, 1, 1]]],
    [61, 65, [['Illusion Dust', 0.22, 2, 5], ['Greater Eternal Essence', 0.75, 2, 3], ['Large Brilliant Shard', 0.03, 1, 1]]],
  
    ],
    rare: [
    [1, 25, [['Small Glimmering Shard', 1, 1, 1]]], [26, 30, [['Large Glimmering Shard', 1, 1, 1]]], [31, 35, [['Small Glowing Shard', 1, 1, 1]]],
    [36, 40, [['Large Glowing Shard', 1, 1, 1]]], [41, 45, [['Small Radiant Shard', 1, 1, 1]]], [46, 50, [['Large Radiant Shard', 1, 1, 1]]],
    [51, 55, [['Small Brilliant Shard', 1, 1, 1]]], [56, 65, [['Large Brilliant Shard', 0.995, 1, 1], ['Nexus Crystal', 0.005, 1, 1]]],
  
    ],
    epic: [
    [40, 45, [['Small Radiant Shard', 1, 2, 4]]], [46, 50, [['Large Radiant Shard', 1, 2, 4]]], [51, 55, [['Small Brilliant Shard', 1, 2, 4]]],
    [56, 60, [['Nexus Crystal', 1, 1, 1]]], [61, 88, [['Nexus Crystal', 1, 1, 2]]],
  
    ],
    // Enchanting skill needed by item level: [highest item level, skill]; epics need 225 (warcraft.wiki.gg "Disenchanting")
    skill: [[20, 1], [25, 25], [30, 50], [35, 75], [40, 100], [45, 125], [50, 150], [55, 175], [60, 200], [65, 225]],
    epicSkill: 225,
  },
};
