-- ============================================================================
-- Every language gets exactly one undeletable "main" genealogy display and
-- one undeletable "main" etymology display, auto-created alongside the
-- language. The main etymology display is a new kind of thing: unlike a
-- per-lexeme etymology display (root_lexeme_id), it's rooted at the
-- LANGUAGE itself and aggregates every lexeme in it plus their ancestors —
-- so the existing (kind, root_lexeme_id/root_language_id) constraint needs
-- loosening to allow an 'etymology'-kind display rooted at a language,
-- but only when is_main is set.
-- ============================================================================

alter table displays add column is_main boolean not null default false;

alter table displays drop constraint display_root_matches_kind;

alter table displays add constraint display_root_matches_kind check (
  (kind = 'etymology' and root_lexeme_id is not null and root_language_id is null and not is_main)
  or (kind = 'etymology' and is_main and root_language_id is not null and root_lexeme_id is null)
  or (kind = 'genealogy' and root_language_id is not null and root_lexeme_id is null)
);

-- At most one main display per (language, kind).
create unique index one_main_display_per_language_kind on displays (root_language_id, kind) where is_main;

-- A co-owner of a private language (other than whichever one happens to
-- be `owner_id` on the main display row) must still be able to see it —
-- otherwise they couldn't open it at all, let alone edit it.
drop policy displays_select on displays;

create policy displays_select on displays
  for select using (
    visibility = 'public'
    or owner_id = auth.uid()
    or is_admin()
    or (is_main and root_language_id is not null and is_language_owner_or_admin(root_language_id))
  );

-- Can't be removed, by anyone, at the database level — not just hidden
-- from the UI's delete button. Replaces the owner-only delete policy from
-- 0005 with the same rule plus "and not is_main".
drop policy displays_delete on displays;

create policy displays_delete on displays
  for delete using ((owner_id = auth.uid() or is_admin()) and not is_main);

-- A main display is jointly owned by every owner of its language, not
-- just whichever one happened to create it (the single `owner_id` on the
-- row) — replaces the single-owner update policy from 0005 with an OR for
-- that case.
drop policy displays_update on displays;

create policy displays_update on displays
  for update
  using (
    owner_id = auth.uid()
    or is_admin()
    or (is_main and root_language_id is not null and is_language_owner_or_admin(root_language_id))
  )
  with check (
    owner_id = auth.uid()
    or is_admin()
    or (is_main and root_language_id is not null and is_language_owner_or_admin(root_language_id))
  );

-- Backfill: every language that predates this migration (including the
-- ported legacy lexicon) gets its two main displays now, owned by whoever
-- created the language.
insert into displays (kind, title, owner_id, visibility, root_language_id, is_main)
select 'genealogy', l.name || ' — genealogy', l.created_by, l.visibility, l.id, true
from languages l
where not exists (
  select 1 from displays d where d.root_language_id = l.id and d.kind = 'genealogy' and d.is_main
);

insert into displays (kind, title, owner_id, visibility, root_language_id, is_main)
select 'etymology', l.name || ' — etymology', l.created_by, l.visibility, l.id, true
from languages l
where not exists (
  select 1 from displays d where d.root_language_id = l.id and d.kind = 'etymology' and d.is_main
);
