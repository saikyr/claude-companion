# Sync backend (Supabase)

Project **claude-companion**, ref `jucbngafdnyaizfxgplk`, region us-west-1, org "saikyr's Org", Free plan.
API URL `https://jucbngafdnyaizfxgplk.supabase.co`. The app only has the publishable key (in `js/sync.js`).

`migrations/20261122140000_sync.sql` is the whole schema as it runs on the project (it was applied on
22 Nov 2026 as the migrations `sync_tables`, `sync_functions`, `sync_merge_accounts`,
`sync_account_groups`, `sync_merge_precise`; this file is their combined end state). Change the schema
with a new migration file, applied with the Supabase connector (`apply_migration`).

Design and limits: `docs/ARCHITECTURE.md`, "Sync between computers".
