-- A link code over 64 characters is refused before any work (issue #154). The
-- game caps what it sends, but anyone signed in can call the function with a
-- string of many megabytes, and each call made the database clean it up first.
-- Otherwise the same as 20261013000000_link_code_retry.sql; create or replace
-- keeps the function's grants.
create or replace function public.redeem_link_code(p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean text;
  link public.link_codes;
  old_sid uuid;
  target public.saves;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if char_length(coalesce(p_code, '')) > 64 then raise exception 'link_code_invalid'; end if;
  -- Upper case, no spaces or dashes, and the look-alikes read as the digits.
  clean := translate(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'ILO', '110');
  if clean !~ '^[0-9A-Z]{10}$' then raise exception 'link_code_invalid'; end if;
  select * into link from public.link_codes c where c.code = clean for update;
  if not found then raise exception 'link_code_invalid'; end if;
  -- Used by another player: checked before expiry, so it never says more than a used code did.
  if link.redeemed_by is not null and link.redeemed_by <> uid then
    raise exception 'link_code_invalid';
  end if;
  if link.expires_at <= now() then raise exception 'link_code_expired'; end if;
  update public.link_codes c set redeemed_by = uid where c.code = clean;

  select m.save_id into old_sid from public.save_members m where m.user_id = uid;
  if old_sid is distinct from link.save_id then
    -- The orphan trigger deletes the old save if this was its last member.
    delete from public.save_members m where m.user_id = uid;
    insert into public.save_members (save_id, user_id) values (link.save_id, uid);
  end if;

  select * into target from public.saves s where s.id = link.save_id;
  return jsonb_build_object('save_id', target.id, 'data', target.data, 'rev', target.rev);
end;
$$;
