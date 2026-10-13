-- A failed link attempt no longer uses up the code (issue #103). Before this,
-- redeeming deleted the code at once, so if the reply was lost or the device
-- could not read the save, trying the same code again said "not valid". Now a
-- redeemed code is kept, marked with who redeemed it, and that same player may
-- redeem it again until it expires. Anyone else still reads it as "not valid",
-- so a code still joins only one device. Expiry, replacement and cleanup are as
-- before (20261012000000_link_code_expiry.sql).

-- Deleting the user deletes their redeemed codes, so a code never becomes
-- redeemable by anyone again.
alter table public.link_codes
  add column redeemed_by uuid references auth.users (id) on delete cascade;
-- For that cascade.
create index link_codes_redeemed_by_idx on public.link_codes (redeemed_by);

-- Same as before except a redeemed code is marked instead of deleted, and its
-- redeemer may redeem it again.
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
