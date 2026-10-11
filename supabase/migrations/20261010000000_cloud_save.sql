-- Cloud save (docs/design.md §11). The server only stores: one text save per
-- player, with a revision number for conflict detection. The game validates
-- every download itself. Players are Supabase anonymous users; a one-time link
-- code joins another browser to the same save.
--
-- Security model: RLS is on and nobody gets table grants, so the tables cannot
-- be reached through the REST API at all. Every access goes through the
-- functions below. They are security definer (they run as the table owner),
-- pin search_path to empty, name every object in full, and check auth.uid()
-- themselves. Only the authenticated role may execute them.

create extension if not exists pgcrypto with schema extensions;

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  -- The game's own cap (MAX_SAVE_CHARS in src/storage/save.ts).
  data text not null check (char_length(data) <= 200000),
  rev bigint not null default 1
);

-- A player belongs to at most one save; a save can have several players.
create table public.save_members (
  save_id uuid not null references public.saves (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  primary key (save_id, user_id)
);

create table public.link_codes (
  code text primary key,
  save_id uuid not null references public.saves (id) on delete cascade,
  expires_at timestamptz not null
);
create index link_codes_save_id_idx on public.link_codes (save_id);

alter table public.saves enable row level security;
alter table public.save_members enable row level security;
alter table public.link_codes enable row level security;
-- Supabase grants new tables to anon and authenticated by default: take it back.
revoke all on public.saves, public.save_members, public.link_codes from public, anon, authenticated;

-- Shape and size check for an uploaded save: a JSON object with the game's three
-- top-level keys. Not callable from the API (revoked below); the functions that
-- use it run as owner.
create function public.cloud_check_data(p_data text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_data is null or char_length(p_data) > 200000 then
    raise exception 'save_too_large';
  end if;
  begin
    if jsonb_typeof(p_data::jsonb) <> 'object'
       or not (p_data::jsonb ?& array['v', 'savedAt', 'state']) then
      raise exception 'bad_data';
    end if;
  exception when invalid_text_representation or invalid_escape_sequence
            or untranslatable_character or character_not_in_repertoire then
    raise exception 'bad_data';
  end;
end;
$$;

-- A save with no members can never be reached again (a player left it, or their
-- anonymous user was deleted): delete it when its last member goes.
create function public.cloud_drop_orphan() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock the save first, so two last members leaving at once check one after the
  -- other (each then sees the other's row gone) and the save does not outlive both.
  perform 1 from public.saves s where s.id = old.save_id for update;
  if found and not exists (select 1 from public.save_members m where m.save_id = old.save_id) then
    delete from public.saves s where s.id = old.save_id;
  end if;
  return null;
end;
$$;
create trigger save_members_drop_orphan
  after delete on public.save_members
  for each row execute function public.cloud_drop_orphan();

-- Starts the caller's save. Fails if they already have one.
create function public.create_save(p_data text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public.cloud_check_data(p_data);
  if exists (select 1 from public.save_members m where m.user_id = uid) then
    raise exception 'already_member';
  end if;
  begin
    insert into public.saves (data) values (p_data) returning id into sid;
    insert into public.save_members (save_id, user_id) values (sid, uid);
  exception when unique_violation then
    -- Two calls at once for the same player: the other one won.
    raise exception 'already_member';
  end;
  return jsonb_build_object('save_id', sid, 'rev', 1);
end;
$$;

-- The caller's save, or null when they have none.
create function public.get_save() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select jsonb_build_object('save_id', s.id, 'data', s.data, 'rev', s.rev)
    into result
    from public.save_members m
    join public.saves s on s.id = m.save_id
    where m.user_id = uid;
  return result;
end;
$$;

-- Replaces the save only if it is still at p_base_rev. Otherwise changes nothing
-- and returns the current rev and data, so the client can tell the player.
create function public.put_save(p_data text, p_base_rev bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  new_rev bigint;
  current_row public.saves;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public.cloud_check_data(p_data);
  select m.save_id into sid from public.save_members m where m.user_id = uid;
  if sid is null then raise exception 'not_a_member'; end if;
  update public.saves s
    set data = p_data, rev = s.rev + 1
    where s.id = sid and s.rev = p_base_rev
    returning s.rev into new_rev;
  if found then
    return jsonb_build_object('ok', true, 'rev', new_rev);
  end if;
  select * into current_row from public.saves s where s.id = sid;
  return jsonb_build_object('ok', false, 'rev', current_row.rev, 'data', current_row.data);
end;
$$;

-- A one-time code (10 characters, 50 random bits, no look-alike letters) that
-- lets another browser join the caller's save for 15 minutes. Replaces any
-- earlier code for the save.
create function public.create_link_code() returns jsonb
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
  delete from public.link_codes c where c.save_id = sid or c.expires_at < now();
  insert into public.link_codes (code, save_id, expires_at)
    values (new_code, sid, now() + interval '15 minutes');
  return jsonb_build_object('code', new_code, 'ttl', 900);
end;
$$;

-- Moves the caller into the save a code belongs to and returns it. The code is
-- used up. The caller's previous save is deleted if they were its only member.
create function public.redeem_link_code(p_code text) returns jsonb
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
  if link.expires_at < now() then raise exception 'link_code_expired'; end if;
  delete from public.link_codes c where c.code = clean;

  select m.save_id into old_sid from public.save_members m where m.user_id = uid;
  if old_sid is distinct from link.save_id then
    -- The trigger below deletes the old save if this was its last member.
    delete from public.save_members m where m.user_id = uid;
    insert into public.save_members (save_id, user_id) values (link.save_id, uid);
  end if;

  select * into target from public.saves s where s.id = link.save_id;
  return jsonb_build_object('save_id', target.id, 'data', target.data, 'rev', target.rev);
end;
$$;

-- Deletes the caller's save for everyone linked to it (members and codes follow).
create function public.delete_save() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  delete from public.saves s
    where s.id in (select m.save_id from public.save_members m where m.user_id = uid);
  return jsonb_build_object('ok', true);
end;
$$;

-- Functions default to executable by everyone, and Supabase also grants them to
-- anon: take both back, then give the signed-in (including anonymous) role only
-- the functions the game calls.
revoke all on function public.cloud_check_data(text) from public, anon, authenticated;
revoke all on function public.cloud_drop_orphan() from public, anon, authenticated;
revoke all on function public.create_save(text) from public, anon;
revoke all on function public.get_save() from public, anon;
revoke all on function public.put_save(text, bigint) from public, anon;
revoke all on function public.create_link_code() from public, anon;
revoke all on function public.redeem_link_code(text) from public, anon;
revoke all on function public.delete_save() from public, anon;
grant execute on function public.create_save(text) to authenticated;
grant execute on function public.get_save() to authenticated;
grant execute on function public.put_save(text, bigint) to authenticated;
grant execute on function public.create_link_code() to authenticated;
grant execute on function public.redeem_link_code(text) to authenticated;
grant execute on function public.delete_save() to authenticated;
