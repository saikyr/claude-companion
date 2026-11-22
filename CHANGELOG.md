# Changelog

Dates are UTC, 2026. The addon version is in `ClaudeCompanion.toc` / `Core.lua`.

## Unreleased (logout snapshot)

- Logging out no longer wipes the saved bags, worn gear, gold and other parts: the game empties them
  before `PLAYER_LOGOUT`, so a logout snapshot now keeps the previous value of any part that reads
  empty (and money / max mana / max health read as 0). `snap.kept` and `snap.keptFrom` say what was
  kept and from when. Harness test added. (#27)

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
