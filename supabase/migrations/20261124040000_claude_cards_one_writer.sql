-- cc.claude.cards has one writer, Claude (private.claude_put_setting, device_id null). A computer whose
-- browser still held an older copy pushed it back over new cards 90 s after they were written (#107).
-- The app no longer sends the key (js/sync.js CLAUDE_ONLY); this ignores it from any computer, so an
-- older build can't either. A computer's write of the row is skipped, not an error, so its push goes on.
create or replace function private.claude_cards_one_writer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.device_id is not null then
    return null;   -- skip this row: only Claude (no device) writes the cards
  end if;
  return new;
end $$;

create trigger claude_cards_one_writer before insert or update on public.records
  for each row when (new.id = 'setting|cc.claude.cards') execute function private.claude_cards_one_writer();
