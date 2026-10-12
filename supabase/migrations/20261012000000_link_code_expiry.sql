-- Link codes keep saying "expired" after they expire (issue #104). Before this,
-- every new code anywhere deleted all expired codes, so a code tried a little
-- late was usually gone and read as "not valid". Now an expired code stays for a
-- day before cleanup, and a code replaced by a newer one for the same save is
-- expired instead of deleted. Only a code that was never issued, was used,
-- expired over a day ago, or is older than its save's 4 newest expired codes
-- reads as "not valid".

-- For the cleanup below.
create index if not exists link_codes_expires_at_idx on public.link_codes (expires_at);

-- Same as before except the cleanup and the replacement (see above).
create or replace function public.create_link_code() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(10);
  new_code text := '';
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select m.save_id into sid from public.save_members m where m.user_id = uid;
  if sid is null then raise exception 'not_a_member'; end if;
  -- 256 is a multiple of 32, so every character is equally likely.
  for i in 0..9 loop
    new_code := new_code || substr(alphabet, (get_byte(bytes, i) & 31) + 1, 1);
  end loop;
  -- Lock the save, so two calls at once for the same save run one after the
  -- other and the second expires the first's code.
  perform 1 from public.saves s where s.id = sid for no key update;
  -- Skip rows another call is already deleting, so two calls cannot deadlock.
  delete from public.link_codes c
    where c.code in (select c2.code from public.link_codes c2
                     where c2.expires_at < now() - interval '1 day'
                     for update skip locked);
  update public.link_codes c set expires_at = now()
    where c.save_id = sid and c.expires_at > now();
  -- Keep only the save's 4 newest expired codes, so calling this in a loop
  -- cannot grow the table.
  delete from public.link_codes c
    where c.code in (select c2.code from public.link_codes c2
                     where c2.save_id = sid and c2.expires_at <= now()
                     order by c2.expires_at desc offset 4);
  insert into public.link_codes (code, save_id, expires_at)
    values (new_code, sid, now() + interval '15 minutes');
  return jsonb_build_object('code', new_code, 'ttl', 900);
end;
$$;

-- Same as before except a code is expired from the moment it reaches expires_at
-- (`<=`), so a code replaced in this same transaction already counts as expired.
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
  if link.expires_at <= now() then raise exception 'link_code_expired'; end if;
  delete from public.link_codes c where c.code = clean;

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
