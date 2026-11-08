-- ============================================================================
-- Auto-create a `profiles` row whenever a new auth user signs up, so every
-- later foreign key (languages.created_by, lexemes.created_by, etc.) has
-- something to point at without the client having to race to insert one.
-- ============================================================================

create or replace function handle_new_auth_user() returns trigger as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := split_part(new.email, '@', 1);
  final_username := base_username;

  while exists (select 1 from profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into profiles (id, username, display_name)
  values (new.id, final_username, base_username);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_handle_new_auth_user
after insert on auth.users
for each row execute function handle_new_auth_user();

-- Backfill: the trigger above only fires on NEW signups. Anyone who
-- already had an auth.users row before this migration ran (e.g. the
-- original single-user account) needs a profiles row created here, with
-- the same collision-safe username logic.
do $$
declare
  u record;
  base_username text;
  final_username text;
  suffix int;
begin
  for u in select id, email from auth.users where id not in (select id from profiles) loop
    base_username := split_part(u.email, '@', 1);
    final_username := base_username;
    suffix := 0;
    while exists (select 1 from profiles where username = final_username) loop
      suffix := suffix + 1;
      final_username := base_username || suffix::text;
    end loop;
    insert into profiles (id, username, display_name) values (u.id, final_username, base_username);
  end loop;
end $$;
