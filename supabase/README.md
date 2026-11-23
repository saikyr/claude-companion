# Sync backend (Supabase)

Project **claude-companion**, ref `jucbngafdnyaizfxgplk`, region us-west-1, org "saikyr's Org", Free plan.
API URL `https://jucbngafdnyaizfxgplk.supabase.co`. The app only has the publishable key (in `js/sync.js`).

**Every file in `migrations/` has run on the live project, in name order** (each applied under its file
name, the same text), so the folder is the live schema. A new one goes live with the connector's
`apply_migration` right after its PR merges; a merged file is never edited (`test/contract.test.js`). Kinds
of files: sync (`*_sync*`, `*_now`), Claude's cards and their gate (`*_claude_cards`, `*_card_gate`), the
brief (`*_claude_brief*`, each version a new file replacing the function), game data (`*_game_data`).

The first ones in detail: `migrations/20261122140000_sync.sql` is the base schema as it runs on the project (it was applied on
22 Nov 2026 as the migrations `sync_tables`, `sync_functions`, `sync_merge_accounts`,
`sync_account_groups`, `sync_merge_precise`; this file is their combined end state). `migrations/20261122150000_sync_v2.sql` is
on top of it (applied 22 Nov 2026 as `sync_v2`): per-account lock, replaceable trackers, CSPRNG link
codes with an attempt limit, Cloudflare client IP, record counter, retired accounts, no table grants.
`migrations/20261122160000_sync_snapshot.sql`
(applied as `sync_snapshot`): each computer's current snapshot as one row, up to 2 MB, left out of pulls.
`migrations/20261122170000_sync_now.sql` (applied as `sync_now`): each computer's "now" per character
(kind `now`, up to 2 MB), pulled by the other computers but not by itself.
Change the schema with a new migration file, applied with the Supabase connector (`apply_migration`),
and keep the files identical to what runs on the project.

Design and limits: `docs/ARCHITECTURE.md`, "Sync between computers".
