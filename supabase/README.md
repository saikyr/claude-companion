# Sync backend (Supabase)

Project **claude-companion**, ref `jucbngafdnyaizfxgplk`, region us-west-1, org "saikyr's Org", Free plan.
API URL `https://jucbngafdnyaizfxgplk.supabase.co`. The app only has the publishable key (in `js/sync.js`).

`migrations/20261122140000_sync.sql` is the whole schema as it runs on the project (it was applied on
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
