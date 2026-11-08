-- ============================================================================
-- Row Level Security. Everything below enable RLS by default, then opens
-- exactly the access the app needs. Helper functions are SECURITY DEFINER
-- so a policy on `languages` can safely consult `language_ownership` (and
-- vice versa) without recursive RLS evaluation.
-- ============================================================================

create or replace function is_admin() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin = true);
$$ language sql stable security definer set search_path = public;

-- "member" means an accepted owner, not merely invited/requested — an
-- invite or join-request must not itself grant access to a private language.
create or replace function is_language_owner_or_admin(target_language_id uuid) returns boolean as $$
  select is_admin() or exists (
    select 1 from language_ownership
    where language_id = target_language_id and user_id = auth.uid() and status = 'owner'
  );
$$ language sql stable security definer set search_path = public;

create or replace function can_view_language(target_language_id uuid) returns boolean as $$
  select exists (
    select 1 from languages
    where id = target_language_id
      and (visibility = 'public' or is_language_owner_or_admin(target_language_id))
  );
$$ language sql stable security definer set search_path = public;

-- Governs editing a language's CONTENT (lexemes/etymologies), not its
-- governance row. Natural languages are open to any signed-in editor;
-- constructed languages open up only when the owner has flipped
-- publicly_editable on — distinct from `languages` itself, which stays
-- owner/admin-only no matter what publicly_editable is set to.
create or replace function can_edit_language_content(target_language_id uuid) returns boolean as $$
  select
    is_language_owner_or_admin(target_language_id)
    or exists (
      select 1 from languages
      where id = target_language_id
        and auth.uid() is not null
        and (
          not is_constructed
          or (is_constructed and visibility = 'public' and publicly_editable)
        )
    );
$$ language sql stable security definer set search_path = public;

grant execute on function is_admin() to authenticated, anon;
grant execute on function is_language_owner_or_admin(uuid) to authenticated, anon;
grant execute on function can_view_language(uuid) to authenticated, anon;
grant execute on function can_edit_language_content(uuid) to authenticated, anon;

-- ─── PROFILES ────────────────────────────────────────────────────────────
alter table profiles enable row level security;

create policy profiles_select_all on profiles
  for select using (true);

create policy profiles_insert_self on profiles
  for insert with check (id = auth.uid());

create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Column-level grants, not RLS, are what actually stop a user promoting
-- themselves to admin: the UPDATE policy alone can't see OLD.is_admin.
revoke update on profiles from authenticated;
grant update (username, display_name, bio) on profiles to authenticated;

-- ─── LANGUAGES ───────────────────────────────────────────────────────────
alter table languages enable row level security;

create policy languages_select on languages
  for select using (visibility = 'public' or is_language_owner_or_admin(id));

create policy languages_insert on languages
  for insert with check (auth.uid() is not null and created_by = auth.uid());

-- Toggling publicly_editable/visibility/family_name etc. is governance,
-- not content — stays owner/admin-only regardless of publicly_editable.
create policy languages_update on languages
  for update using (is_language_owner_or_admin(id)) with check (is_language_owner_or_admin(id));

create policy languages_delete on languages
  for delete using (is_language_owner_or_admin(id));

-- ─── LANGUAGE GENEALOGY ──────────────────────────────────────────────────
alter table language_genealogy enable row level security;

create policy language_genealogy_select on language_genealogy
  for select using (can_view_language(child_language_id));

create policy language_genealogy_write on language_genealogy
  for all using (is_language_owner_or_admin(child_language_id))
  with check (is_language_owner_or_admin(child_language_id));

-- ─── LANGUAGE OWNERSHIP ──────────────────────────────────────────────────
alter table language_ownership enable row level security;

create policy language_ownership_select on language_ownership
  for select using (user_id = auth.uid() or is_language_owner_or_admin(language_id));

-- Three ways a row can come into being: the creator claiming initial
-- ownership, a user requesting to join a public constructed language, or
-- an existing owner/admin inviting someone (or adding themselves).
create policy language_ownership_insert on language_ownership
  for insert with check (
    (
      status = 'owner' and user_id = auth.uid()
      and exists (select 1 from languages where id = language_id and created_by = auth.uid())
    )
    or (
      status = 'requested' and user_id = auth.uid()
      and exists (
        select 1 from languages
        where id = language_id and is_constructed and visibility = 'public'
      )
    )
    or is_language_owner_or_admin(language_id)
  );

-- A user may update their own row (e.g. accept an invite by flipping
-- invited -> owner); owners/admins may update anyone's. Validating exactly
-- which status transitions are legal is left to an Edge Function — this
-- policy is deliberately permissive for the prototype.
create policy language_ownership_update on language_ownership
  for update using (user_id = auth.uid() or is_language_owner_or_admin(language_id))
  with check (user_id = auth.uid() or is_language_owner_or_admin(language_id));

create policy language_ownership_delete on language_ownership
  for delete using (user_id = auth.uid() or is_language_owner_or_admin(language_id));

-- ─── LEXEMES ─────────────────────────────────────────────────────────────
alter table lexemes enable row level security;

create policy lexemes_select on lexemes
  for select using (can_view_language(language_id));

create policy lexemes_write on lexemes
  for all using (can_edit_language_content(language_id))
  with check (can_edit_language_content(language_id));

-- ─── ETYMOLOGIES ─────────────────────────────────────────────────────────
alter table etymologies enable row level security;

-- Visible only if both sides are visible to you — a public claim can still
-- point at a private conlang's lexeme, and in that case you shouldn't be
-- able to resolve it either.
create policy etymologies_select on etymologies
  for select using (
    can_view_language((select language_id from lexemes where id = descendant_lexeme_id))
    and can_view_language((select language_id from lexemes where id = ancestor_lexeme_id))
  );

-- Adding/editing/removing an etymology is an edit to the DESCENDANT word's
-- entry; you don't need edit rights on the ancestor's language to cite it.
create policy etymologies_write on etymologies
  for all using (can_edit_language_content((select language_id from lexemes where id = descendant_lexeme_id)))
  with check (can_edit_language_content((select language_id from lexemes where id = descendant_lexeme_id)));

-- ─── REVISIONS ───────────────────────────────────────────────────────────
-- Public edit history is readable like a wiki history page. There are no
-- insert/update/delete policies on purpose: the audit trail must not be
-- forgeable by ordinary clients, so all revision writes go through a
-- trusted server-side path (an Edge Function using the service role key,
-- which bypasses RLS) rather than direct client inserts.
alter table revisions enable row level security;
alter table revision_dependencies enable row level security;

create policy revisions_select on revisions
  for select using (can_view_language(language_id));

create policy revision_dependencies_select on revision_dependencies
  for select using (
    exists (
      select 1 from revisions r
      where r.id = revision_dependencies.revision_id and can_view_language(r.language_id)
    )
  );
