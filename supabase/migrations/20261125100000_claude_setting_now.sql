-- The account's current copy of a setting only Claude writes (cc.claude.cards), for a computer to check
-- what it shows against (#150). A computer gets settings through cc_pull's cursor, but keeps them in two
-- local files (settings.json, the browser's own storage) that more than one page writes: the app window,
-- a window left open from before an update, and the server's hidden browser. A page that loads an older
-- settings.json after the cursor has passed Claude's last write would keep showing old cards until Claude
-- writes again. js/sync.js asks this once per page, and takes the account's copy when it differs.
-- Read only; the row Claude writes: the account's own (claude_put_setting writes to the account others joined).
create or replace function public.cc_claude_setting(p_key text, p_k text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.devices; r public.records;
begin
  d := private.device_of(p_key);
  if d.id is null then raise exception 'unknown device'; end if;
  if p_k is distinct from 'cc.claude.cards' then raise exception 'only cc.claude.cards'; end if;
  select x.* into r from public.records x
   where x.account_id = (select coalesce(a.merged_into, a.id) from public.accounts a where a.id = d.account_id)
     and x.id = 'setting|' || p_k;
  if r.id is null then return jsonb_build_object('k', p_k, 'v', null, 't', null); end if;
  return jsonb_build_object('k', p_k, 'v', r.data->>'v', 't', coalesce((r.data->>'t')::bigint, r.t), 'seq', r.seq);
end $$;

revoke all on function public.cc_claude_setting(text, text) from public;
grant execute on function public.cc_claude_setting(text, text) to anon, authenticated;
