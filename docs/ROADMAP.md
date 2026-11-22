# Roadmap

Issues carry a type label (`bug`, `foundation`, `design`, `data`) and a priority (`P1` do next,
`P2` soon, `P3` later). Milestones group them by what they unlock.

## 1.5 Correct data
Numbers you act on must be right and current.
- P1 #1 item cache stops at 6,000 items · #2 flips ignore stack quantity · #3 snapshot stale when the app is closed · #7 tests and CI
- P2 #8 duplicate sales dropped · #9 two price rules · #10 profit filter with unpriced reagents · #16 item cooldowns · #18 local server hardening
- P3 #21 use your own disenchant results

## 1.6 Any character
Works for any class, spec, realm and several characters; ready to hand to friends.
- P1 #4 character picker · #5 default weights for every spec · #6 weapon DPS
- P2 #12 character key and shared AH prices · #13 dual wield, unique, set bonuses · #14 random-suffix items · #15 settings out of the browser · #17 neutral defaults for friends · #20 releases and updates
- P3 #23 tooltip quality colours

## 2.0 Claude writes back
- P2 #11 PC and Mac saves · #19 two-way channel (plans, gear decisions, to-dos)
- P3 #22 other client languages

Who works where: the "Review my latest play session" thread owns the addon, data and servers;
the "Redesign the Companion app UI" thread owns `web/css` and the views. Open a branch per issue
and reference it in the commit (`Fixes #n`).
