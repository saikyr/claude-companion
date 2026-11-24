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
  // Spell hit for gear advice. A caster misses a target 2 levels above it 6% of the time and always misses at
  // least 1%, so against 5-man bosses (level 62 for a level-60 player) 5% hit is the most that counts (Classic
  // rule, warcraft.wiki.gg "Hit"; not yet measured on Forever). Talents that lower the chance to resist your
  // spells (Shadow Focus, Elemental Precision...) count as hit for the schools they name.
  spellHit: { cap: 5, against: '5-man bosses, 2 levels above you', src: 'Classic rule (warcraft.wiki.gg, Hit)' },
  // Instances that are raids or battlegrounds (zone names as the pack writes them). Raids: warcraft.wiki.gg "Raid"
  // (Classic) plus Forever's own, warcraft.wiki.gg/wiki/WoW_Forever (Barrow Deeps, Hyjal Summit). Item group sizes
  // in the pack can't tell them apart (most raid trash drops say nothing).
  instances: {
    raids: ['Molten Core', "Onyxia's Lair", 'Blackwing Lair', "Zul'Gurub", "Ruins of Ahn'Qiraj", "Temple of Ahn'Qiraj", 'Naxxramas', 'Barrow Deeps', 'Hyjal Summit'],
    battlegrounds: ['Alterac Valley', 'Warsong Gulch', 'Arathi Basin'],
    // QuestieDB quest sorts that are raid content though no raid zone is named (Atiesh, Thunderfury)
    raidQuestSorts: ['Legendary'],
    // 40-man world bosses and summoned group bosses outside instances (NPC ids in the pack, each with its
    // Forever copy): warcraft.wiki.gg "World boss" (Classic); the Abyssal High Council and the Silithus colossi
    // are summoned group bosses (warcraft.wiki.gg "Abyssal High Council"). Their loot is raid gear (#110).
    worldBosses: [6109, 278779, 12397, 230302, 278677, 14890, 235197, 14887, 235232, 14888, 235180, 14889, 234880,
      15203, 15305, 15205, 15204, 15740, 15741, 15742],
    // reputation only raids give: a quest that needs it is raid content (AQ40's Brood of Nozdormu chain)
    raidFactions: ['Brood of Nozdormu'],
    // battleground quartermasters and supply officers (the pack's vendor title): their goods are PvP gear
    pvpVendorWords: ['Stormpike', 'Frostwolf', 'Warsong', 'Silverwing', 'Arathor', 'Defilers'],
    // crafted gear whose reagents drop only in raids (Fiery Core, Lava Core, Core Leather: Molten Core;
    // Brilliant Chromatic Scale: Blackwing Lair; Souldarite, Bloodvine, Primal Bat Leather, Blood Tiger Hide:
    // Zul'Gurub). Recipes from warcraft.wiki.gg (Classic); the pack has no reagents. Item ids are the pack's.
    raidMatCrafts: [16979, 16980, 18263, 19156, 19165, 16982, 19162, 16983, 19163, 19149, 19164, 17013, 19148,
      18509, 19157, 19682, 19683, 19684, 19998, 19999, 19685, 19686, 19687, 19688, 19689,
      17015, 17016, 17193, 18282, 15138, 19690, 19691, 19692, 19693, 19694, 19695,
      22652, 22654, 22655, 22658, 22661, 22662, 22663, 22664, 22665, 22666, 22669, 22670, 22671],
  },
  // Attunements and keys: what opens an instance or a part of one, and the quests or items that give it.
  // Quest and item ids are the game-data pack's (QuestieDB Forever / ForeverDB); the app checks them against your
  // completed quests and what you own. Only the final quest is listed: the chain before it comes from the pack.
  // quests are per faction / class in the pack, so each list holds every variant and the app keeps the ones for you.
  // value: the bosses whose drops it opens (NPC ids), or the whole instance (its zone name in the pack); none for a
  // shortcut. who: 'each' = everyone in the group needs it, 'one' = one holder opens it for the group.
  // Sources (read 22 Nov 2026): conquestcapped.com/guides/wow-forever/wow-forever-attunements (updated 16 Nov 2026),
  // warcraft.wiki.gg/wiki/WoW_Forever (raid dates), pcgames.de Dalaran attunement guide (7 Oct 2026).
  unlocks: [
    { id: 'ubrs', name: 'Upper Blackrock Spire', kind: 'dungeon', who: 'one', quests: [4743], items: [12344],
      what: 'Seal of Ascension opens the door to Upper Blackrock Spire for your group',
      value: { npcs: [9816, 10264, 10509, 10899, 10339, 10429, 10430, 10363] }, src: 'warcraft.wiki.gg/wiki/WoW_Forever' },
    { id: 'scholo', name: 'Scholomance', kind: 'dungeon', who: 'one', quests: [5505, 5511], items: [13704],
      what: 'The Skeleton Key opens the front gate', value: { zone: 'Scholomance' }, src: 'conquestcapped.com/guides/wow-forever/wow-forever-attunements' },
    { id: 'dalaran', name: 'City of Dalaran', kind: 'dungeon', who: 'one', quests: [92458, 96984], items: [277507],
      what: 'The Dalaran Sewer Key (from the Image of Archmage Modera, with Heart of Disruption) opens the dungeon', value: { zone: 'City of Dalaran' },
      src: 'conquestcapped.com/guides/wow-forever/wow-forever-attunements' },
    { id: 'dm', name: 'Dire Maul West and North', kind: 'dungeon', who: 'one', quests: [], items: [18249],
      what: 'The Crescent Key (drops from Pusillin, Dire Maul East) opens the West and North wings', src: 'conquestcapped.com/guides/wow-forever/wow-forever-attunements' },
    { id: 'brd', name: 'Blackrock Depths shortcut', kind: 'shortcut', who: 'one', quests: [3802], items: [11000],
      what: 'The Shadowforge Key opens the Shadowforge doors, skipping the Detention Block', src: 'conquestcapped.com/guides/wow-forever/wow-forever-attunements' },
    { id: 'strat', name: 'Stratholme service entrance', kind: 'shortcut', who: 'one', quests: [], items: [12382],
      what: 'The Key to the City (drops from Magistrate Barthilas) opens the service entrance', src: 'conquestcapped.com/guides/wow-forever/wow-forever-attunements' },
    { id: 'ony', name: "Onyxia's Lair", kind: 'raid', who: 'each', quests: [6502, 6602], items: [16309], opens: '2026-12-09',
      what: 'Everyone in the raid needs the Drakefire Amulet in their bags', src: 'warcraft.wiki.gg/wiki/WoW_Forever' },
    { id: 'mc', name: 'Molten Core', kind: 'raid', who: 'each', quests: [7848], items: [], opens: null,
      what: 'Attunement to the Core lets you enter through the Blackrock Depths portal. Not on Forever\'s raid timeline yet', src: 'conquestcapped.com/guides/wow-forever/wow-forever-attunements' },
  ],
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
