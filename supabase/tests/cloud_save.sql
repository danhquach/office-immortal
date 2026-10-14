-- pgTAP tests for supabase/migrations/*_cloud_save.sql. Run locally with
-- `supabase test db` (needs Docker; see supabase/README.md). Not run in CI.
-- Everything happens in one transaction that is rolled back at the end.

begin;
select plan(48);

-- Two players, A and B, and a stranger C with no save.
insert into auth.users (id, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000a1', true),
  ('00000000-0000-0000-0000-0000000000b2', true),
  ('00000000-0000-0000-0000-0000000000c3', true);

-- Acts as that player from now on (until the next call or `reset role`).
create function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.save_text(n int) returns text language sql as $$
  select '{"v":6,"savedAt":' || n || ',"state":{}}'
$$;

-- A and B each start a save.
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select is((public.create_save(pg_temp.save_text(1)) ->> 'rev')::int, 1, 'create_save returns rev 1');
select throws_ok($$select public.create_save(pg_temp.save_text(1))$$, 'already_member',
  'a second create_save for the same player is refused');
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000b2');
select public.create_save(pg_temp.save_text(2));

-- Each player reads only their own save.
select is((public.get_save() ->> 'data'), pg_temp.save_text(2), 'B reads B''s save');
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select is((public.get_save() ->> 'data'), pg_temp.save_text(1), 'A reads A''s save');
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select is(public.get_save()::text, null, 'a player with no save gets null, never someone else''s');
select throws_ok($$select public.put_save(pg_temp.save_text(9), 1)$$, 'not_a_member',
  'a player with no save cannot put');

-- put_save: the current rev wins; a stale rev is a conflict that changes nothing.
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select is((public.put_save(pg_temp.save_text(3), 1) ->> 'rev')::int, 2, 'put at the current rev bumps it');
select is((public.put_save(pg_temp.save_text(4), 1) ->> 'ok')::boolean, false,
  'put at a stale rev is a conflict');
select is((public.put_save(pg_temp.save_text(4), 1) ->> 'data'), pg_temp.save_text(3),
  'the conflict reply carries the server data');
select is((public.get_save() ->> 'data'), pg_temp.save_text(3), 'a conflict leaves the save as it was');
select is((public.put_save(pg_temp.save_text(4), null) ->> 'ok')::boolean, false,
  'a null base rev is a conflict');

-- Size and shape checks.
select throws_ok(format('select public.put_save(%L, 2)', repeat('x', 200001)), 'save_too_large',
  'a save over 200000 characters is rejected');
select throws_ok($$select public.put_save('not json', 2)$$, 'bad_data', 'text that is not JSON is rejected');
select throws_ok($$select public.put_save('[1,2]', 2)$$, 'bad_data', 'a JSON array is rejected');
select throws_ok($$select public.put_save('{"v":6}', 2)$$, 'bad_data', 'an object missing keys is rejected');

-- Direct table access is denied, and so is the internal check function.
select throws_ok($$select * from public.saves$$, '42501', null, 'authenticated cannot select saves directly');
select throws_ok($$insert into public.saves (data) values ('{}')$$, '42501', null,
  'authenticated cannot insert into saves directly');
select throws_ok($$select * from public.link_codes$$, '42501', null, 'authenticated cannot select link_codes');
select throws_ok($$select public.cloud_check_data('{}')$$, '42501', null,
  'the internal check function is not callable');

-- The anon role (no sign-in) cannot execute any of the RPCs.
reset role;
select set_config('role', 'anon', true);
select throws_ok($$select public.get_save()$$, '42501', null, 'anon cannot execute get_save');
select throws_ok($$select public.create_save('{}')$$, '42501', null, 'anon cannot execute create_save');
select throws_ok($$select public.redeem_link_code('0000000000')$$, '42501', null,
  'anon cannot execute redeem_link_code');
select throws_ok($$select public.create_link_code()$$, '42501', null,
  'anon cannot execute create_link_code');

-- Link codes: B joins A's save, and B's own (sole-member) save is deleted.
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select set_config('t.code', public.create_link_code() ->> 'code', true);
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000b2');
select is((public.redeem_link_code(lower(current_setting('t.code'))) ->> 'data'), pg_temp.save_text(3),
  'a lower-case code redeems and returns the target save');
reset role;
select is((select count(*)::int from public.saves), 1, 'the old sole-member save is deleted, A''s stays');

-- A failed link can be retried with the same code by the same player only (issue #103).
select pg_temp.become('00000000-0000-0000-0000-0000000000b2');
select is((public.redeem_link_code(current_setting('t.code')) ->> 'data'), pg_temp.save_text(3),
  'the player who redeemed a code can redeem it again');
reset role;
select is((select count(*)::int from public.save_members
    where user_id = '00000000-0000-0000-0000-0000000000b2'), 1,
  'redeeming again leaves the player a member once');
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_invalid', 'a code used by another player is invalid');
reset role;
update public.link_codes set expires_at = now() - interval '1 minute'
  where code = current_setting('t.code');
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_invalid', 'a code used by another player is invalid after it expires too');
select pg_temp.become('00000000-0000-0000-0000-0000000000b2');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_expired', 'its own redeemer cannot redeem it after it expires');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000b2';
select is((select count(*)::int from public.link_codes where code = current_setting('t.code')), 0,
  'deleting the redeemer deletes the codes they redeemed');

-- An expired code is refused.
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select set_config('t.code', public.create_link_code() ->> 'code', true);
reset role;
update public.link_codes set expires_at = now() - interval '1 minute';
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_expired', 'an expired code is refused');

-- An expired code still says expired after other codes are made (issue #104).
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select public.create_save(pg_temp.save_text(7));
select public.create_link_code();
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_expired', 'an expired code still says expired after another save makes a code');
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select set_config('t.code2', public.create_link_code() ->> 'code', true);
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_expired', 'an expired code still says expired after its own save makes a new code');

-- A replaced code is expired; the new one works.
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select set_config('t.code3', public.create_link_code() ->> 'code', true);
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code2')),
  'link_code_expired', 'a code replaced by a newer one is expired');
reset role;
-- now() is fixed in this transaction, so the replaced code's expires_at equals
-- now(): this also checks that a code counts as expired from that moment.
select is((select count(*)::int from public.link_codes c
    where c.expires_at > now()
      and c.save_id = (select save_id from public.link_codes where code = current_setting('t.code3'))),
  1, 'a save has at most one live code');

-- Codes expired over a day ago are cleaned up (by any player's new code) and
-- then read as invalid.
update public.link_codes set expires_at = now() - interval '25 hours'
  where code = current_setting('t.code');
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select public.create_link_code();
reset role;
select is((select count(*)::int from public.link_codes where code = current_setting('t.code')), 0,
  'a code expired over a day ago is deleted');
select is((select count(*)::int from public.link_codes where code = current_setting('t.code2')), 1,
  'a code expired under a day ago is kept');
select pg_temp.become('00000000-0000-0000-0000-0000000000c3');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code')),
  'link_code_invalid', 'a cleaned-up code is invalid');
select throws_ok($$select public.redeem_link_code('ZZZZZZZZZZ')$$,
  'link_code_invalid', 'a code that was never issued is invalid');
select throws_ok($$select public.redeem_link_code(repeat('A', 100000))$$,
  'link_code_invalid', 'an oversized code is refused');
select throws_ok(format('select public.redeem_link_code(%L)', current_setting('t.code3') || repeat(' ', 60)),
  'link_code_invalid', 'a live code padded past 64 characters is refused');
select is((public.redeem_link_code(current_setting('t.code3')) ->> 'data'), pg_temp.save_text(3),
  'the newest code still redeems');

-- Making codes in a loop keeps at most 4 expired codes and 1 live one per save.
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select public.create_link_code() from generate_series(1, 20);
reset role;
select is((select count(*)::int from public.link_codes c
    where c.save_id = (select m.save_id from public.save_members m
                       where m.user_id = '00000000-0000-0000-0000-0000000000a1')),
  5, 'a save keeps at most 4 expired codes and 1 live one');

-- A save whose last member's anonymous user is deleted goes with it.
reset role;
insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-0000000000d4', true);
select pg_temp.become('00000000-0000-0000-0000-0000000000d4');
select public.create_save(pg_temp.save_text(5));
reset role;
select is((select count(*)::int from public.saves), 2, 'D has a save of their own');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d4';
select is((select count(*)::int from public.saves), 1, 'deleting the user deletes their orphaned save');

-- delete_save removes the save for every member, with its codes.
reset role;
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select public.delete_save();
reset role;
select is((select count(*)::int from public.save_members), 0, 'delete_save removes every member');
select is((select count(*)::int from public.link_codes), 0, 'delete_save removes its codes');

select * from finish();
rollback;
