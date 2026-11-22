# Roadmap

Issues carry a type label (`bug`, `foundation`, `design`, `data`) and a priority (`P1` do next,
`P2` soon, `P3` later). Done since 1.4: tests and CI on Linux, Windows and macOS (#7), sync between
computers (#11), releases with one-click installers and self-update (#20), neutral defaults for
friends (#17, part), a contract between the parts checked in CI.

## Any character, any player
- P1 #4 character picker · #6 weapon DPS
- P2 #12 character key and shared AH prices · #13 dual wield, unique, set bonuses · #14 random-suffix items in gear advice · #15 gear settings per character · #17 disenchant helper keeps off-spec gear · #18 server port conflicts
- P3 #22 other client languages · #23 tooltip quality colours

## Correct numbers
- P2 #8 two identical AH sales in one hour · #9 one price rule · #10 profit filter with unpriced reagents · #16 item cooldowns
- P3 #21 use your own disenchant results

## Keep it current
- Weekly game-data pack rebuild (`gamedata/build.sh`) in CI, opened as a PR when the sources change

Work on a branch per issue and reference it in the commit (`Fixes #n`). How to develop: [DEVELOP.md](DEVELOP.md).
